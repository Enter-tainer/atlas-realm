/**
 * 3D Terrain Export — generate GLB from Mapterhorn DEM + optional satellite texture.
 *
 * Flow: button click → dialog (pick zoom, texture toggle) → fetch tiles →
 *       decode → mesh → GLB → download.
 */

const EARTH_RADIUS = 6378137;
const TILE_SIZE = 512;
const HALF_CIRCUMFERENCE = Math.PI * EARTH_RADIUS;

// ---------------------------------------------------------------------------
//  Tile coordinate math (Web Mercator)
// ---------------------------------------------------------------------------

/** Mercator meters → lat/lng */
function mercatorToLatLng(mx, my) {
  const lng = (mx / HALF_CIRCUMFERENCE) * 180;
  const lat = (2 * Math.atan(Math.exp(my / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI);
  return { lng, lat };
}

/** Pixel (px, py) within tile (z, x, y) → (mx, my) in Mercator meters */
function tilePixelToMercator(z, x, y, px, py) {
  const worldPixels = 256 * (1 << z);         // standard Web Mercator world size in px
  const pixelX = (x * TILE_SIZE + px) / 2;      // convert from 512-based to 256-based
  const pixelY = (y * TILE_SIZE + py) / 2;
  return {
    mx: (pixelX / worldPixels - 0.5) * 2 * HALF_CIRCUMFERENCE,
    my: (0.5 - pixelY / worldPixels) * 2 * HALF_CIRCUMFERENCE,
  };
}

/** Bounding box of tile (z, x, y) in Mercator meters: {minX, minY, maxX, maxY} */
function tileBounds(z, x, y) {
  const sw = tilePixelToMercator(z, x, y, 0, TILE_SIZE);
  const ne = tilePixelToMercator(z, x, y, TILE_SIZE - 1, 0);
  return { minX: sw.mx, minY: sw.my, maxX: ne.mx, maxY: ne.my };
}

/** All tiles intersecting a Mercator bounding box at zoom z */
function getTilesInBounds(z, minX, minY, maxX, maxY) {
  const tiles = [];
  const worldPixels = 256 * (1 << z);
  const pxPerMeter = worldPixels / (2 * HALF_CIRCUMFERENCE);

  const txMin = Math.max(0, Math.floor((minX / (2 * HALF_CIRCUMFERENCE) + 0.5) * worldPixels * 2 / TILE_SIZE));
  const txMax = Math.min((1 << z) - 1, Math.ceil((maxX / (2 * HALF_CIRCUMFERENCE) + 0.5) * worldPixels * 2 / TILE_SIZE));
  const tyMin = Math.max(0, Math.floor((0.5 - maxY / (2 * HALF_CIRCUMFERENCE)) * worldPixels * 2 / TILE_SIZE));
  const tyMax = Math.min((1 << z) - 1, Math.ceil((0.5 - minY / (2 * HALF_CIRCUMFERENCE)) * worldPixels * 2 / TILE_SIZE));

  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      tiles.push({ z, x: tx, y: ty });
    }
  }
  return tiles;
}

/** Convert Mercator bounds to lat/lng for display */
function mercatorBoundsToLatLng(minX, minY, maxX, maxY) {
  const sw = mercatorToLatLng(minX, minY);
  const ne = mercatorToLatLng(maxX, maxY);
  return { minLat: sw.lat, minLng: sw.lng, maxLat: ne.lat, maxLng: ne.lng };
}

// ---------------------------------------------------------------------------
//  Fetch + decode tiles
// ---------------------------------------------------------------------------

/** Fetch a single DEM tile (WebP) → Uint16Array of elevations in meters */
async function fetchDemTile(z, x, y) {
  const url = `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`;
  const res = await fetch(url, { headers: { Accept: 'image/webp' } });
  if (!res.ok) throw new Error(`DEM tile ${z}/${x}/${y}: HTTP ${res.status}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width !== TILE_SIZE || bitmap.height !== TILE_SIZE) {
    throw new Error(`Unexpected tile size: ${bitmap.width}x${bitmap.height}`);
  }
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  const pixels = imgData.data;                       // RGBA bytes

  // Terrarium encoding: elevation = R*256 + G + B/256 - 32768
  const elev = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
    const off = i * 4;
    elev[i] = pixels[off] * 256 + pixels[off + 1] + pixels[off + 2] / 256 - 32768;
  }
  return elev;
}

/** Fetch satellite tiles for the same area, composite into one ImageData */
async function fetchCompositeSatellite(tiles, z) {
  const tilePx = 256;  // ArcGIS serves 256px tiles
  // We know the layout: tiles array is row-major, compute grid dimensions
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tiles) {
    if (t.x < minX) minX = t.x;
    if (t.x > maxX) maxX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.y > maxY) maxY = t.y;
  }
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const canvas = new OffscreenCanvas(cols * tilePx, rows * tilePx);
  const ctx = canvas.getContext('2d');

  for (const t of tiles) {
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${t.y}/${t.x}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'image/jpeg' } });
      if (!res.ok) continue;   // silently skip missing tiles
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      const dx = (t.x - minX) * tilePx;
      const dy = (t.y - minY) * tilePx;
      ctx.drawImage(bitmap, dx, dy);
    } catch {
      // skip failed tiles
    }
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// ---------------------------------------------------------------------------
//  Mesh generation
// ---------------------------------------------------------------------------

function generateMesh(tiles, demData, centerMx, centerMz) {
  // demData[i] = Float32Array for tiles[i]
  // Layout: tiles are in row-major order
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tiles) {
    if (t.x < minX) minX = t.x;
    if (t.x > maxX) maxX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.y > maxY) maxY = t.y;
  }
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;

  // Build a flat vertex grid. Each tile is TILE_SIZE × TILE_SIZE.
  // Total vertices per tile: (TILE_SIZE+1 if adjacent, but tiles share edges)
  // Strategy: create a single grid for the whole area.
  const gx = cols * (TILE_SIZE - 1) + 1;    // total grid points in x direction
  const gy = rows * (TILE_SIZE - 1) + 1;    // total grid points in y direction

  const positions = new Float32Array(gx * gy * 3);
  const uvs = new Float32Array(gx * gy * 2);
  let minElev = Infinity, maxElev = -Infinity;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tileIdx = row * cols + col;
      const elev = demData[tileIdx];
      const tile = tiles[tileIdx];
      for (let py = 0; py < TILE_SIZE; py++) {
        for (let px = 0; px < TILE_SIZE; px++) {
          const gix = col * (TILE_SIZE - 1) + px;
          const giy = row * (TILE_SIZE - 1) + py;
          const gi = (giy * gx + gix);

          // Mercator coordinates → local meters
          const { mx, my } = tilePixelToMercator(tile.z, tile.x, tile.y, px, py);
          positions[gi * 3]     = mx - centerMx;          // X: easting
          positions[gi * 3 + 1] = elev[py * TILE_SIZE + px]; // Y: elevation
          positions[gi * 3 + 2] = my - centerMz;          // Z: northing

          // UV for full composite texture
          uvs[gi * 2]     = (gix) / (gx - 1);
          uvs[gi * 2 + 1] = (giy) / (gy - 1);

          if (elev[py * TILE_SIZE + px] < minElev) minElev = elev[py * TILE_SIZE + px];
          if (elev[py * TILE_SIZE + px] > maxElev) maxElev = elev[py * TILE_SIZE + px];
        }
      }
    }
  }

  // Indices: two triangles per grid quad
  const triCols = gx - 1;
  const triRows = gy - 1;
  const indices = new Uint32Array(triCols * triRows * 6);
  let idxOff = 0;
  for (let row = 0; row < triRows; row++) {
    for (let col = 0; col < triCols; col++) {
      const a = row * gx + col;
      const b = row * gx + col + 1;
      const c = (row + 1) * gx + col;
      const d = (row + 1) * gx + col + 1;
      indices[idxOff++] = a;
      indices[idxOff++] = b;
      indices[idxOff++] = c;
      indices[idxOff++] = b;
      indices[idxOff++] = d;
      indices[idxOff++] = c;
    }
  }

  // Normals: compute per vertex by averaging face normals
  const normals = new Float32Array(gx * gy * 3);
  // Accumulate
  const nAcc = new Float32Array(gx * gy * 3);
  const nCount = new Uint16Array(gx * gy);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i], ib = indices[i + 1], ic = indices[i + 2];
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
    // Edge vectors
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    // Cross product
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) { nx /= len; ny /= len; nz /= len; }
    nAcc[ia * 3] += nx;     nAcc[ia * 3 + 1] += ny;     nAcc[ia * 3 + 2] += nz;     nCount[ia]++;
    nAcc[ib * 3] += nx;     nAcc[ib * 3 + 1] += ny;     nAcc[ib * 3 + 2] += nz;     nCount[ib]++;
    nAcc[ic * 3] += nx;     nAcc[ic * 3 + 1] += ny;     nAcc[ic * 3 + 2] += nz;     nCount[ic]++;
  }
  for (let i = 0; i < gx * gy; i++) {
    if (nCount[i] > 0) {
      const len = Math.sqrt(nAcc[i * 3] ** 2 + nAcc[i * 3 + 1] ** 2 + nAcc[i * 3 + 2] ** 2);
      if (len > 0) {
        normals[i * 3] = nAcc[i * 3] / len;
        normals[i * 3 + 1] = nAcc[i * 3 + 1] / len;
        normals[i * 3 + 2] = nAcc[i * 3 + 2] / len;
      } else {
        normals[i * 3] = 0; normals[i * 3 + 1] = 1; normals[i * 3 + 2] = 0;
      }
    } else {
      normals[i * 3] = 0; normals[i * 3 + 1] = 1; normals[i * 3 + 2] = 0;
    }
  }

  return { positions, normals, uvs, indices, vertexCount: gx * gy, indexCount: indices.length, minElev, maxElev };
}

// ---------------------------------------------------------------------------
//  GLB binary writer
// ---------------------------------------------------------------------------

async function buildGlb(mesh, textureImageData) {
  const { positions, normals, uvs, indices } = mesh;

  // Interleave vertex data for compactness: position(12) + normal(12) + uv(8)
  const vertexStride = 4 * (3 + 3 + 2); // 32 bytes per vertex
  const vertexData = new ArrayBuffer(mesh.vertexCount * vertexStride);
  const vw = new DataView(vertexData);
  for (let i = 0; i < mesh.vertexCount; i++) {
    const off = i * vertexStride;
    vw.setFloat32(off,     positions[i * 3], true);
    vw.setFloat32(off + 4, positions[i * 3 + 1], true);
    vw.setFloat32(off + 8, positions[i * 3 + 2], true);
    vw.setFloat32(off + 12, normals[i * 3], true);
    vw.setFloat32(off + 16, normals[i * 3 + 1], true);
    vw.setFloat32(off + 20, normals[i * 3 + 2], true);
    vw.setFloat32(off + 24, uvs[i * 2], true);
    vw.setFloat32(off + 28, uvs[i * 2 + 1], true);
  }

  // Indices as Uint32
  const indexBuffer = indices.buffer;

  // Texture
  let textureData = null;
  let textureBufferView = null;
  if (textureImageData) {
    // Encode as PNG in-memory — we use a data URI trick
    const { width, height, data } = textureImageData;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(textureImageData, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    textureData = await blob.arrayBuffer();
  }

  // Build buffer views and accessors
  // Buffer 0 = vertex data, Buffer 1 = indices, Buffer 2 = texture (if any)
  // For GLB all buffers go in a single bin chunk, so we concatenate.
  // But GLTF accessors reference bufferViews which reference a buffer.
  // With GLB: all bufferViews point to buffer 0, which is the bin chunk.

  let offset = 0;
  const vertexBv = { buffer: 0, byteOffset: offset, byteLength: vertexData.byteLength, byteStride: vertexStride, target: 34962 };
  offset += vertexData.byteLength;

  // Align to 4 bytes
  if (offset % 4 !== 0) offset += 4 - (offset % 4);
  const indexBv = { buffer: 0, byteOffset: offset, byteLength: indexBuffer.byteLength, target: 34963 };
  offset += indexBuffer.byteLength;

  let textureBv = null;
  if (textureData) {
    if (offset % 4 !== 0) offset += 4 - (offset % 4);
    textureBv = { buffer: 0, byteOffset: offset, byteLength: textureData.byteLength };
    offset += textureData.byteLength;
  }

  // Total bin size
  const binSize = offset;

  // Build the GLTF JSON
  const gltf = {
    asset: { version: '2.0', generator: 'map.mgt.moe' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        indices: 3,
        ...(textureData ? { material: 0 } : {}),
      }],
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: mesh.vertexCount, type: 'VEC3', byteOffset: 0 },
      { bufferView: 0, componentType: 5126, count: mesh.vertexCount, type: 'VEC3', byteOffset: 12 },
      { bufferView: 0, componentType: 5126, count: mesh.vertexCount, type: 'VEC2', byteOffset: 24 },
      { bufferView: 1, componentType: 5125, count: mesh.indexCount, type: 'SCALAR' },
    ],
    bufferViews: [vertexBv, indexBv],
    buffers: [{ byteLength: binSize }],
  };

  if (textureData) {
    gltf.bufferViews.push(textureBv);
    gltf.textures = [{ sampler: 0, source: 0 }];
    gltf.images = [{ mimeType: 'image/png', bufferView: 2 }];
    gltf.samplers = [{ magFilter: 9729, minFilter: 9729, wrapS: 33648, wrapT: 33648 }];
    gltf.materials = [{
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0, texCoord: 0 },
        metallicFactor: 0,
        roughnessFactor: 0.95,
      },
      doubleSided: false,
    }];
  }

  // ---- Encode ----
  const jsonStr = JSON.stringify(gltf);
  // Pad JSON to 4-byte alignment
  const jsonPad = (4 - (jsonStr.length + 8) % 4) % 4; // +8 for "JSON" + 4-byte length
  const jsonLen = jsonStr.length + jsonPad;
  const jsonChunkLen = jsonLen + 8;  // +8 for chunk header

  const headerLen = 12; // magic(4) + version(4) + length(4)
  const totalLen = headerLen + jsonChunkLen + 8 + binSize; // +8 for bin chunk header

  const glb = new ArrayBuffer(totalLen);
  const dw = new DataView(glb);
  let wOff = 0;

  // Header
  dw.setUint32(wOff, 0x46546C67, true); wOff += 4; // "glTF"
  dw.setUint32(wOff, 2, true); wOff += 4;            // version 2
  dw.setUint32(wOff, totalLen, true); wOff += 4;      // total length

  // JSON chunk
  dw.setUint32(wOff, jsonLen, true); wOff += 4;       // chunk length
  dw.setUint32(wOff, 0x4E4F534A, true); wOff += 4;    // "JSON"
  for (let i = 0; i < jsonStr.length; i++) {
    dw.setUint8(wOff, jsonStr.charCodeAt(i)); wOff++;
  }
  wOff += jsonPad;  // skip padding bytes (already zero)

  // BIN chunk
  dw.setUint32(wOff, binSize, true); wOff += 4;
  dw.setUint32(wOff, 0x004E4942, true); wOff += 4;    // "BIN\0"

  // Vertex data
  new Uint8Array(glb).set(new Uint8Array(vertexData), wOff);
  wOff += vertexData.byteLength;

  // Pad to 4
  while (wOff % 4 !== 0) { dw.setUint8(wOff, 0); wOff++; }

  // Index data
  new Uint8Array(glb).set(new Uint8Array(indexBuffer), wOff);
  wOff += indexBuffer.byteLength;

  // Pad to 4
  while (wOff % 4 !== 0) { dw.setUint8(wOff, 0); wOff++; }

  // Texture data
  if (textureData) {
    new Uint8Array(glb).set(new Uint8Array(textureData), wOff);
    wOff += textureData.byteLength;
  }

  return glb;
}

// ---------------------------------------------------------------------------
//  UI
// ---------------------------------------------------------------------------

export function installExport3d(map, maplibregl) {
  // Add button to the control group
  const container = document.createElement('div');
  container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = 'Export 3D Terrain';
  btn.setAttribute('aria-label', 'Export 3D Terrain');
  btn.className = 'maplibregl-ctrl-export3d';
  btn.textContent = '3D↓';
  btn.addEventListener('click', () => showExportDialog(map, btn));
  container.appendChild(btn);

  // Insert after the satellite control — find the top-right control group
  // We'll add directly to the map
  map.addControl({ onAdd: () => container, onRemove: () => {} }, 'top-right');
}

function showExportDialog(map, triggerBtn) {
  const bounds = map.getBounds();
  const center = map.getCenter();
  const currentZoom = map.getZoom();

  const z = Math.min(Math.floor(currentZoom), 17);

  // Convert bounds to Mercator
  const swM = latLngToMercator(bounds.getSouth(), bounds.getWest());
  const neM = latLngToMercator(bounds.getNorth(), bounds.getEast());
  const bbox = { minX: swM.mx, minY: swM.my, maxX: neM.mx, maxY: neM.my };

  // Overlay
  const overlay = document.createElement('div');
  overlay.className = 'export3d-overlay';
  overlay.innerHTML = `
    <div class="export3d-dialog">
      <h3>🗻 导出 3D 地形</h3>
      <div class="export3d-info">
        <div>范围：当前视口</div>
        <div>中心：${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}</div>
      </div>
      <div class="export3d-field">
        <label>缩放级别（分辨率）</label>
        <div class="export3d-slider-row">
          <input type="range" class="export3d-zoom-slider" min="10" max="17" value="${z}" step="1" />
          <span class="export3d-zoom-value">z${z}</span>
        </div>
        <div class="export3d-hint" id="export3d-tile-count"></div>
      </div>
      <div class="export3d-field">
        <label class="export3d-check-label">
          <input type="checkbox" class="export3d-texture-toggle" checked />
          卫星纹理（ArcGIS World Imagery）
        </label>
      </div>
      <div class="export3d-actions">
        <button class="export3d-btn export3d-cancel">取消</button>
        <button class="export3d-btn export3d-export">导出 GLB</button>
      </div>
      <div class="export3d-progress" style="display:none">
        <div class="export3d-progress-bar"><div class="export3d-progress-fill"></div></div>
        <div class="export3d-progress-text">准备中…</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const zoomSlider = overlay.querySelector('.export3d-zoom-slider');
  const zoomValueEl = overlay.querySelector('.export3d-zoom-value');
  const tileCountEl = overlay.querySelector('#export3d-tile-count');
  const textureToggle = overlay.querySelector('.export3d-texture-toggle');
  const progressEl = overlay.querySelector('.export3d-progress');
  const progressFill = overlay.querySelector('.export3d-progress-fill');
  const progressText = overlay.querySelector('.export3d-progress-text');
  const exportBtn = overlay.querySelector('.export3d-export');
  const cancelBtn = overlay.querySelector('.export3d-cancel');

  function updateTileCount() {
    const zoom = parseInt(zoomSlider.value);
    zoomValueEl.textContent = `z${zoom}`;
    const tiles = getTilesInBounds(zoom, bbox.minX, bbox.minY, bbox.maxX, bbox.maxY);
    const n = tiles.length;
    const verts = n * TILE_SIZE * TILE_SIZE;
    const tris = n * (TILE_SIZE - 1) * (TILE_SIZE - 1) * 2;
    tileCountEl.textContent = `${n} 瓦片 · ${(verts/1000).toFixed(0)}k 顶点 · ${(tris/1000).toFixed(0)}k 三角面`;
  }
  zoomSlider.addEventListener('input', updateTileCount);
  updateTileCount();

  cancelBtn.addEventListener('click', () => overlay.remove());

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  exportBtn.addEventListener('click', async () => {
    const zoom = parseInt(zoomSlider.value);
    const useTexture = textureToggle.checked;
    exportBtn.disabled = true;
    cancelBtn.disabled = true;
    progressEl.style.display = 'block';

    try {
      await doExport(map, zoom, bbox, useTexture, progressFill, progressText);
      progressFill.style.width = '100%';
      progressText.textContent = '✅ 下载中…';
      setTimeout(() => overlay.remove(), 1500);
    } catch (err) {
      console.error('Export failed:', err);
      progressText.textContent = `❌ 失败: ${err.message}`;
      exportBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });
}

async function doExport(map, zoom, bbox, useTexture, progressFill, progressText) {
  const tiles = getTilesInBounds(zoom, bbox.minX, bbox.minY, bbox.maxX, bbox.maxY);
  const n = tiles.length;
  if (n === 0) throw new Error('No tiles in current viewport');

  // Center of the area in Mercator meters
  const centerMx = (bbox.minX + bbox.maxX) / 2;
  const centerMz = (bbox.minY + bbox.maxY) / 2;

  progressText.textContent = `下载 DEM 瓦片 (0/${n})…`;

  // Fetch all DEM tiles
  const demData = [];
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    try {
      const elev = await fetchDemTile(t.z, t.x, t.y);
      demData.push(elev);
    } catch (err) {
      // Fill with zeros for missing tiles
      demData.push(new Float32Array(TILE_SIZE * TILE_SIZE));
      console.warn(`Failed to fetch DEM tile ${t.z}/${t.x}/${t.y}:`, err.message);
    }
    progressFill.style.width = `${((i + 1) / (n + (useTexture ? n : 0)) * 50)}%`;
    progressText.textContent = `下载 DEM 瓦片 (${i + 1}/${n})…`;
  }

  // Fetch satellite texture
  let textureImageData = null;
  if (useTexture) {
    progressText.textContent = `下载卫星纹理 (0/${n})…`;
    try {
      textureImageData = await fetchCompositeSatellite(tiles, zoom);
    } catch (err) {
      console.warn('Satellite texture failed, exporting without texture:', err.message);
    }
    progressFill.style.width = '75%';
    progressText.textContent = '卫星纹理完成';
  }

  // Generate mesh
  progressText.textContent = '生成网格…';
  const mesh = generateMesh(tiles, demData, centerMx, centerMz);
  progressFill.style.width = '85%';
  progressText.textContent = '网格生成完成';

  // Build GLB
  progressText.textContent = '编码 GLB…';
  const glbBuffer = await buildGlb(mesh, textureImageData);
  progressFill.style.width = '95%';
  progressText.textContent = '编码完成';

  // Download
  const ll = mercatorBoundsToLatLng(bbox.minX, bbox.minY, bbox.maxX, bbox.maxY);
  const label = `${ll.minLat.toFixed(3)}_${ll.minLng.toFixed(3)}`.replace('.', 'p');
  const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `terrain_z${zoom}_${label}.glb`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Convert lat/lng to Mercator meters */
function latLngToMercator(lat, lng) {
  const mx = (lng / 180) * HALF_CIRCUMFERENCE;
  const latRad = lat * Math.PI / 180;
  const my = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return { mx, my };
}
