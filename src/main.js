import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import mlcontour from 'maplibre-contour';

const LOCAL_ORM_PREFIX = '/orm';
const STYLE_URL = `${LOCAL_ORM_PREFIX}/style/standard.json`;
const TILE_URL = 'https://orm-tiles.mgt.moe/openrailwaymap/{z}/{x}/{y}.mvt?v=20260315d';
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const MAPTERHORN_TERRAIN_URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
const FULLSCREEN_ACTIVE_CLASS = 'route-map-fullscreen-active';

const app = document.querySelector('#app');
app.innerHTML = `
  <div id="map"></div>
`;

const statusEl = null;
const layersEl = null;


function absoluteUrl(path) {
  return `${window.location.origin}${path}`;
}

function popupHtml(properties = {}) {
  const row = (label, value) => value === undefined || value === null || value === '' ? '' : `<div><strong>${label}：</strong>${value}</div>`;
  const title = properties.localized_name || properties.name || properties.standard_label || properties.label || properties.ref || '铁路要素';
  return `<div style="min-width:220px; font-size:13px; line-height:1.5;"><div style="font-weight:700; margin-bottom:6px;">${title}</div>${row('线路', properties.standard_label)}${row('编号', properties.ref || properties.label)}${row('类型', properties.feature || properties.station || properties.railway)}${row('状态', properties.state)}${row('用途', properties.usage)}${row('高速', properties.highspeed === true ? '是' : properties.highspeed === false ? '否' : '')}${row('桥梁', properties.bridge === true ? '是' : properties.bridge === false ? '否' : '')}${row('隧道', properties.tunnel === true ? '是' : properties.tunnel === false ? '否' : '')}${row('限速', properties.speed_label || properties.maxspeed)}${row('电化', properties.electrification_label || properties.electrification_state)}${row('电压', properties.voltage)}${row('频率', properties.frequency)}${row('轨距', properties.gauge_label)}${row('站点规模', properties.station_size)}${row('里程', properties.position)}</div>`;
}

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.json();
}

async function loadImage(url) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function rewriteOrmStyle(style) {
  style.glyphs = absoluteUrl('/orm/font/{fontstack}/{range}');

  if (Array.isArray(style.sprite)) {
    style.sprite = style.sprite.map((sprite) => ({ ...sprite, url: absoluteUrl(sprite.url.startsWith('/orm/') ? sprite.url : `/orm${sprite.url}`) }));
  } else if (style.sprite?.startsWith('/')) {
    style.sprite = absoluteUrl(`/orm${style.sprite}`);
  }

  const rewrittenSources = [];
  style.sources = Object.fromEntries(Object.entries(style.sources).map(([name, source]) => {
    if (source?.type === 'vector' && source.url?.startsWith('/')) {
      rewrittenSources.push(name);
      return [name, {
        type: 'vector',
        tiles: [TILE_URL],
        attribution: source.attribution,
        promoteId: source.promoteId,
        bounds: source.bounds,
        scheme: source.scheme,
        metadata: source.metadata,
        maxzoom: 15,
      }];
    }
    return [name, source];
  }));

  style.metadata = {
    ...(style.metadata || {}),
    ormClone: true,
    ormRewrittenSources: rewrittenSources,
  };

  return style;
}

function getFirstSymbolLayerId(style) {
  return (style.layers || []).find((layer) => layer.type === 'symbol')?.id;
}

function addMapterhornTerrain(style, demSource) {
  style.sources = {
    ...(style.sources || {}),
    hillshadeSource: {
      type: 'raster-dem',
      url: 'https://tiles.mapterhorn.com/tilejson.json',
    },
    contourSource: {
      type: 'vector',
      tiles: [demSource.contourProtocolUrl({
        thresholds: {
          9: [100, 500],
          10: [50, 250],
          11: [25, 100],
          12: [25, 100],
          13: [10, 50],
          14: [10, 40],
        },
        contourLayer: 'contours',
        elevationKey: 'ele',
        levelKey: 'level',
      })],
      maxzoom: 17,
    },
  };

  const terrainLayers = [
    {
      id: 'trip-hillshade',
      type: 'hillshade',
      source: 'hillshadeSource',
      paint: {
        'hillshade-shadow-color': 'rgba(20, 24, 36, 0.34)',
        'hillshade-highlight-color': 'rgba(255, 255, 255, 0.28)',
        'hillshade-illumination-direction': 315,
        'hillshade-exaggeration': 0.26,
      },
    },
    {
      id: 'trip-contour-lines',
      type: 'line',
      source: 'contourSource',
      'source-layer': 'contours',
      minzoom: 8,
      paint: {
        'line-color': ['match', ['get', 'level'], 0, 'rgba(45, 56, 78, 0.28)', 'rgba(34, 44, 64, 0.44)'],
        'line-width': ['match', ['get', 'level'], 0, 0.45, 1, 1.05, 1.35],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.26, 11, 0.42, 14, 0.65],
      },
    },
    {
      id: 'trip-contour-labels',
      type: 'symbol',
      source: 'contourSource',
      'source-layer': 'contours',
      filter: ['>', ['get', 'level'], 0],
      minzoom: 10,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 120,
        'text-size': 10,
        'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
        'text-font': ['Noto Sans Regular'],
      },
      paint: {
        'text-color': 'rgba(22, 31, 48, 0.6)',
        'text-halo-color': 'rgba(255, 255, 255, 0.82)',
        'text-halo-width': 1.1,
      },
    },
  ];

  const beforeId = getFirstSymbolLayerId(style);
  const insertIndex = beforeId ? style.layers.findIndex((layer) => layer.id === beforeId) : style.layers.length;
  style.layers.splice(insertIndex === -1 ? style.layers.length : insertIndex, 0, ...terrainLayers);
  return style;
}

function mergeBaseAndOrm(baseStyle, ormStyle) {
  const merged = structuredClone(baseStyle);
  merged.center = ormStyle.center || merged.center;
  merged.zoom = ormStyle.zoom || merged.zoom;
  merged.glyphs = ormStyle.glyphs || merged.glyphs;
  merged.sprite = ormStyle.sprite || merged.sprite;
  merged.state = ormStyle.state || merged.state;
  merged.metadata = { ...(merged.metadata || {}), ...(ormStyle.metadata || {}) };
  merged.sources = { ...(merged.sources || {}), ...(ormStyle.sources || {}) };
  merged.layers = [...(merged.layers || []), ...(ormStyle.layers || [])];
  return merged;
}

async function loadStyle(demSource) {
  const [baseStyle, ormStyleRaw] = await Promise.all([
    loadJson(OPENFREEMAP_STYLE),
    loadJson(STYLE_URL),
  ]);
  const merged = mergeBaseAndOrm(baseStyle, rewriteOrmStyle(ormStyleRaw));
  return addMapterhornTerrain(merged, demSource);
}

async function loadSpriteAtlases() {
  const specs = [
    { prefix: '', json: '/orm/sprite/symbols.json', png: '/orm/sprite/symbols.png', sdf: false },
    { prefix: 'sdf:', json: '/orm/sdf_sprite/symbols.json', png: '/orm/sdf_sprite/symbols.png', sdf: true },
  ];
  const atlases = [];
  for (const spec of specs) {
    const [index, image] = await Promise.all([loadJson(spec.json), loadImage(spec.png)]);
    atlases.push({ ...spec, index, image });
  }
  return atlases;
}

function installSpriteFallback(map, atlases) {
  map.on('styleimagemissing', (e) => {
    const id = e.id;
    for (const atlas of atlases) {
      const key = id.startsWith(atlas.prefix) ? id.slice(atlas.prefix.length) : null;
      if (key && atlas.index[key]) {
        const meta = atlas.index[key];
        const canvas = document.createElement('canvas');
        canvas.width = meta.width;
        canvas.height = meta.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(atlas.image, meta.x, meta.y, meta.width, meta.height, 0, 0, meta.width, meta.height);
        const data = ctx.getImageData(0, 0, meta.width, meta.height).data;
        if (!map.hasImage(id)) {
          map.addImage(id, { width: meta.width, height: meta.height, data }, { pixelRatio: meta.pixelRatio || 1, sdf: atlas.sdf });
        }
        return;
      }
    }
  });
}

function installPopups(map) {
  let popup = null;
  map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point).filter((f) => {
      const src = f.source || '';
      const layer = f.layer?.id || '';
      return src.includes('openrailwaymap') || src.includes('railway') || layer.includes('railway') || layer.includes('station') || layer.includes('platform') || layer.includes('signal');
    });
    if (!features.length) return;
    const feature = features[0];
    popup?.remove();
    popup = new maplibregl.Popup({ maxWidth: '320px' }).setLngLat(e.lngLat).setHTML(popupHtml(feature.properties || {})).addTo(map);
  });

  map.on('mousemove', (e) => {
    const features = map.queryRenderedFeatures(e.point).filter((f) => {
      const src = f.source || '';
      const layer = f.layer?.id || '';
      return src.includes('openrailwaymap') || src.includes('railway') || layer.includes('railway') || layer.includes('station') || layer.includes('platform') || layer.includes('signal');
    });
    map.getCanvas().style.cursor = features.length ? 'pointer' : '';
  });
}

function parseLocationPath() {
  const match = window.location.pathname.match(/^\/([\d.]+)\/([-\d.]+)\/([-\d.]+)$/);
  if (match) {
    return { zoom: parseFloat(match[1]), lat: parseFloat(match[2]), lng: parseFloat(match[3]) };
  }
  return null;
}

function updateLocationPath(map) {
  const center = map.getCenter();
  const zoom = Math.round(map.getZoom() * 100) / 100;
  // Match MapLibre's hash precision: 512px * 2^z / 360 / 10^d < 0.5px
  const precision = Math.ceil((zoom * Math.LN2 + Math.log(512 / 360 / 0.5)) / Math.LN10);
  const m = Math.pow(10, precision);
  const lat = Math.round(center.lat * m) / m;
  const lng = Math.round(center.lng * m) / m;
  const path = `/${zoom}/${lat}/${lng}`;
  window.history.replaceState(null, '', path);
}

async function init() {
  try {
    const demSource = new mlcontour.DemSource({
      url: MAPTERHORN_TERRAIN_URL,
      encoding: 'terrarium',
      maxzoom: 17,
      worker: true,
    });
    demSource.setupMaplibre(maplibregl);
    const [style, atlases] = await Promise.all([loadStyle(demSource), loadSpriteAtlases()]);


    const pos = parseLocationPath();
    const map = new maplibregl.Map({
      container: 'map',
      style,
      center: pos ? [pos.lng, pos.lat] : [105, 35],
      zoom: pos ? pos.zoom : 4,
      attributionControl: true,
      renderWorldCopies: false,
      maxZoom: 20,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.FullscreenControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

    installSpriteFallback(map, atlases);

    map.on('load', () => {
      const defaults = {
        date: 2026,
        allDates: false,
        theme: 'light',
        stationLowZoomLabel: 'label',
        openHistoricalMap: true,
        showAbandonedInfrastructure: false,
        showRazedInfrastructure: false,
        showConstructionInfrastructure: true,
        showProposedInfrastructure: true,
        hillshade: false,
        electrificationRailwayLine: 'voltageFrequency',
        trackRailwayLine: 'gauge',
      };
      for (const [key, value] of Object.entries(defaults)) {
        try { map.setGlobalStateProperty(key, value); } catch {}
      }
      installPopups(map);
      map.on('idle', () => {
        window.__MAP_READY = true;
      });
      let resizeFrame = 0;
      const scheduleResize = () => {
        if (resizeFrame) return;
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = 0;
          map.resize();
        });
      };
      const syncFullscreenState = () => {
        const isFullscreen = document.fullscreenElement === map.getContainer() || document.webkitFullscreenElement === map.getContainer();
        document.body.classList.toggle(FULLSCREEN_ACTIVE_CLASS, isFullscreen);
        scheduleResize();
      };
      scheduleResize();
      setTimeout(scheduleResize, 240);
      setTimeout(scheduleResize, 800);
      window.addEventListener('resize', scheduleResize, { passive: true });
      new ResizeObserver(() => scheduleResize()).observe(map.getContainer());
      syncFullscreenState();
      document.addEventListener('fullscreenchange', syncFullscreenState, { passive: true });
      document.addEventListener('webkitfullscreenchange', syncFullscreenState, { passive: true });
      map.on('moveend', () => updateLocationPath(map));
      if (pos) updateLocationPath(map);
    });

    map.on('error', (e) => console.error('MapLibre error:', e));
  } catch (error) {
    console.error(error);
    console.error(error);
  }
}

init();
