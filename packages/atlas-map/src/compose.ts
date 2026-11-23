import mlcontour from 'maplibre-contour';
import { dropBaseRelief } from './style-base.js';
import { withRouteLineColors, withRouteStationColors } from './style-railway-colors.js';
import { hideTunnelAndBridgeMarks } from './style-railway-marks.js';
import { runWhenStyleInfrastructureReady, setGlobalStatePropertyWhenReady } from './style-ready.js';

export type MapLibreLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addProtocol?(protocol: string, handler: (...args: any[]) => unknown): void;
};

export type MapLike = {
  getSource(id: string): unknown;
  setTerrain(terrain: { source: string; exaggeration?: number } | null): unknown;
  hasImage(id: string): boolean;
  addImage(
    id: string,
    image: { width: number; height: number; data: Uint8ClampedArray },
    options?: { pixelRatio?: number; sdf?: boolean },
  ): void;
  on(event: string, listener: (e: { id: string }) => void): void;
  off(event: string, listener: (e: { id: string }) => void): void;
};

export const ORM_SOURCE = 'openrailwaymap';
export const MAPTERHORN_TERRAIN_URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
export const MAPTERHORN_TILEJSON_URL = 'https://tiles.mapterhorn.com/tilejson.json';
export const SATELLITE_URL = 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
export const SHOW_BASE_MAP_STATE = 'showBaseMap';
export const DEFAULT_GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

export type JsonRecord = Record<string, unknown>;

export type StyleLayerLike = JsonRecord & {
  id?: string;
  type?: string;
  source?: unknown;
  layout?: JsonRecord;
};

export type SpriteSpec = JsonRecord & { id: string; url: string };

export type StyleLike = JsonRecord & {
  version?: number;
  glyphs?: string;
  sprite?: string | Array<JsonRecord & { id?: string; url: string }>;
  sources?: Record<string, JsonRecord>;
  layers?: StyleLayerLike[];
  metadata?: JsonRecord;
  state?: Record<string, JsonRecord>;
  center?: [number, number] | { lng: number; lat: number } | { lon: number; lat: number };
  zoom?: number;
};

export type DemSourceLike = {
  setupMaplibre(maplibre: MapLibreLike): void;
  contourProtocolUrl(options: {
    thresholds?: Record<number, number | number[]>;
    contourLayer?: string;
    elevationKey?: string;
    levelKey?: string;
    multiplier?: number;
  }): string;
};

type SpriteAtlas = {
  prefix: string;
  index: Record<string, { x: number; y: number; width: number; height: number; pixelRatio?: number }>;
  image: CanvasImageSource;
  sdf: boolean;
};

export type OrmOptions = {
  /** Origin serving `/orm/*` and `/tiles/*` (e.g. "https://atlas-realm.example.com"). Defaults to current `window.location.origin`. */
  ormOrigin?: string;
  /** PMTiles archive name under `/tiles/<archive>/...`. Defaults to `"openrailwaymap"`. */
  tileArchive?: string;
  /** Override style URL (defaults to `${ormOrigin}/orm/style/standard.json`). */
  styleUrl?: string;
  /** Override tile template URL (skips `/tiles/<archive>/version` fetch). */
  tileUrl?: string;
  /** Pre-loaded ORM style JSON (skips fetching `styleUrl`). */
  ormStyle?: StyleLike;
  /** Wrap base layers with `global-state: showBaseMap` visibility (used by satellite toggle). */
  withBaseMapVisibility?: boolean;
};

export type TerrainOptions = {
  /** Required when adding contour vector source. Create via `setupMapterhornDem(maplibregl)`. */
  demSource: DemSourceLike;
  /** Hillshade/DEM tilejson URL. Defaults to Mapterhorn. */
  tileJsonUrl?: string;
  /** Minimum zoom for hillshade and contour lines. Defaults to 8. */
  minzoom?: number;
  /** Minimum zoom for contour elevation labels. Defaults to 10. */
  labelMinzoom?: number;
  /** Dark-mode friendly contour colors. Defaults to false (light basemap). */
  darkTheme?: boolean;
};

export type ComposeAtlasStyleOptions = {
  /** Drop OpenFreeMap's heavy `ne2_shaded` raster relief layer/source. Defaults to true. */
  dropRelief?: boolean;
  /** Overlay OpenRailwayMap vector layers & sprites. Pass `true` for defaults or an `OrmOptions` object. */
  orm?: boolean | OrmOptions;
  /** Add Mapterhorn hillshade + `maplibre-contour` lines/labels. */
  terrain?: TerrainOptions | false;
  /** Add hidden Google satellite raster layer (toggled via `satellite-layer` + `showBaseMap`). */
  satellite?: boolean | { url?: string };
};

export const STATE_DEFAULTS = {
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
  [SHOW_BASE_MAP_STATE]: true,
  electrificationRailwayLine: 'voltageFrequency',
  trackRailwayLine: 'gauge',
};

function normalizeOrigin(origin?: string): string {
  const raw = (origin ?? (typeof window !== 'undefined' ? window.location.origin : '')).trim();
  return raw.replace(/\/+$/, '');
}

function resolveOrmUrl(path: string, ormOrigin?: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const origin = normalizeOrigin(ormOrigin);
  if (path.startsWith('/orm/')) return `${origin}${path}`;
  if (path.startsWith('/')) return `${origin}/orm${path}`;
  return `${origin}/${path}`;
}

async function loadJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
  return (await res.json()) as T;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFontStack(value: unknown): value is string[] {
  return isStringArray(value) && value.some((fontName) => /(?:Noto Sans|Fira Code)/.test(fontName));
}

function coerceSpriteList(sprite: StyleLike['sprite'], defaultId: string): SpriteSpec[] {
  if (!sprite) return [];
  if (typeof sprite === 'string') return [{ id: defaultId, url: sprite }];
  return sprite.map((entry) => ({ ...entry, id: entry.id || defaultId }));
}

function normalizeOrmFontName(fontName: string): string {
  if (fontName.includes('Italic')) return 'Noto Sans Italic';
  if (fontName.includes('Bold') || fontName.includes('Fira Code')) return 'Noto Sans Bold';
  return 'Noto Sans Regular';
}

function normalizeTextFont(value: unknown): unknown {
  if (isFontStack(value)) return [normalizeOrmFontName(value[0] || 'Noto Sans Regular')];
  if (!Array.isArray(value)) return value;
  if (value[0] === 'literal' && isFontStack(value[1])) {
    return ['literal', [normalizeOrmFontName(value[1][0] || 'Noto Sans Regular')]];
  }
  return value.map((item) => normalizeTextFont(item));
}

function namespaceOrmImageId(id: string): string {
  if (!id || id.startsWith('sdf:') || id.startsWith('orm:')) return id;
  return `orm:${id}`;
}

function namespaceOrmImageReference(value: unknown): unknown {
  if (typeof value === 'string') return namespaceOrmImageId(value);
  if (!Array.isArray(value)) return value;

  const [operator, ...args] = value;
  if (operator === 'image') {
    return ['image', namespaceOrmImageReference(args[0])];
  }

  if (operator === 'concat') {
    const first = args[0];
    if (typeof first === 'string' && (first.startsWith('sdf:') || first.startsWith('orm:'))) return value;
    return ['concat', 'orm:', ...args];
  }

  if (operator === 'case') {
    return value.map((item, index) =>
      index >= 2 && (index % 2 === 0 || index === value.length - 1) ? namespaceOrmImageReference(item) : item,
    );
  }

  if (operator === 'match') {
    return value.map((item, index) =>
      (index > 2 && index % 2 === 1) || index === value.length - 1 ? namespaceOrmImageReference(item) : item,
    );
  }

  if (operator === 'step') {
    return value.map((item, index) =>
      index === 2 || (index > 3 && index % 2 === 0) ? namespaceOrmImageReference(item) : item,
    );
  }

  if (operator === 'coalesce') {
    return [operator, ...args.map(namespaceOrmImageReference)];
  }

  return ['concat', 'orm:', value];
}

function normalizeOrmLayerFonts<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalizeOrmLayerFonts) as T;
  if (!value || typeof value !== 'object') return value;
  const normalized: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'text-font') {
      normalized[key] = normalizeTextFont(child);
    } else if (key === 'icon-image' || key === 'fill-pattern' || key === 'line-pattern') {
      normalized[key] = namespaceOrmImageReference(child);
    } else {
      normalized[key] = normalizeOrmLayerFonts(child);
    }
  }
  return normalized as T;
}

export function rewriteOrmStyle(style: StyleLike, tileUrl: string, ormOrigin?: string): StyleLike {
  const cloned = structuredClone(style);
  if (typeof cloned.glyphs === 'string') {
    cloned.glyphs = resolveOrmUrl(cloned.glyphs, ormOrigin);
  }
  cloned.layers = cloned.layers
    ?.map(normalizeOrmLayerFonts)
    .map(withRouteLineColors)
    .map(withRouteStationColors)
    .map(hideTunnelAndBridgeMarks);
  cloned.sprite = coerceSpriteList(cloned.sprite, 'orm').map((sprite) => ({
    ...sprite,
    id: sprite.id === 'default' ? 'orm' : sprite.id,
    url: resolveOrmUrl(sprite.url, ormOrigin),
  }));

  const localVectorSources = Object.entries(cloned.sources || {}).filter(
    ([, source]) => source?.type === 'vector' && typeof source.url === 'string' && source.url.startsWith('/'),
  );
  const rewrittenSources = localVectorSources.map(([name]) => name);
  if (localVectorSources.length > 0) {
    const [, firstSource] = localVectorSources[0];
    const sources = { ...(cloned.sources || {}) };
    for (const [name] of localVectorSources) delete sources[name];
    sources[ORM_SOURCE] = {
      type: 'vector',
      tiles: [tileUrl],
      attribution: firstSource.attribution,
      bounds: firstSource.bounds,
      maxzoom: 15,
    };
    cloned.sources = sources;
    cloned.layers = cloned.layers?.map((layer) =>
      layer.source && rewrittenSources.includes(String(layer.source)) ? { ...layer, source: ORM_SOURCE } : layer,
    );
  }

  cloned.metadata = {
    ...(cloned.metadata || {}),
    ormClone: true,
    ormRewrittenSources: rewrittenSources,
  };

  return cloned;
}

function mergeStyleSprites(baseSprite: StyleLike['sprite'], ormSprite: StyleLike['sprite']): SpriteSpec[] | undefined {
  const mergedSprites = [...coerceSpriteList(baseSprite, 'default'), ...coerceSpriteList(ormSprite, 'orm')];
  const seenIds = new Set<string>();
  const uniqueSprites = mergedSprites.filter((sprite) => {
    if (seenIds.has(sprite.id)) return false;
    seenIds.add(sprite.id);
    return true;
  });
  return uniqueSprites.length > 0 ? uniqueSprites : undefined;
}

export function withGlobalStateVisibility(layer: StyleLayerLike, stateName: string): StyleLayerLike {
  const layout = { ...(layer.layout || {}) };
  const originalVisibility = structuredClone(layout.visibility ?? 'visible');
  layout.visibility = ['case', ['global-state', stateName], originalVisibility, 'none'];
  return { ...layer, layout };
}

export function mergeBaseAndOrm(
  baseStyle: StyleLike,
  ormStyle: StyleLike,
  options: { withBaseMapVisibility?: boolean } = {},
): StyleLike {
  const base = dropBaseRelief(baseStyle);
  const merged = structuredClone(base);
  const withVisibility = options.withBaseMapVisibility ?? true;
  const baseLayers = (base.layers || []).map((layer) =>
    withVisibility ? withGlobalStateVisibility(layer, SHOW_BASE_MAP_STATE) : layer,
  );
  merged.center = ormStyle.center || merged.center;
  merged.zoom = ormStyle.zoom || merged.zoom;
  merged.glyphs = merged.glyphs || ormStyle.glyphs;
  merged.sprite = mergeStyleSprites(merged.sprite, ormStyle.sprite);

  const state = { ...(merged.state || {}), ...(ormStyle.state || {}) };
  for (const [key, value] of Object.entries(STATE_DEFAULTS)) {
    state[key] = {
      ...(state[key] || {}),
      default: value,
    };
  }
  merged.state = state;
  merged.metadata = { ...(merged.metadata || {}), ...(ormStyle.metadata || {}) };
  merged.sources = { ...(merged.sources || {}), ...(ormStyle.sources || {}) };
  merged.layers = [...baseLayers, ...(ormStyle.layers || [])];
  return merged;
}

function getFirstSymbolLayerId(style: StyleLike) {
  return (style.layers || []).find((layer) => layer.type === 'symbol')?.id;
}

export function addMapterhornTerrain<T extends StyleLike>(
  style: T,
  optionsOrDemSource: TerrainOptions | DemSourceLike,
): T {
  const options: TerrainOptions =
    'contourProtocolUrl' in optionsOrDemSource ? { demSource: optionsOrDemSource } : optionsOrDemSource;
  const result = structuredClone(style);
  const minzoom = options.minzoom ?? 8;
  const labelMinzoom = options.labelMinzoom ?? 10;
  const dark = Boolean(options.darkTheme);

  if (!result.glyphs) {
    result.glyphs = DEFAULT_GLYPHS_URL;
  }

  result.sources = {
    ...(result.sources || {}),
    hillshadeSource: {
      type: 'raster-dem',
      url: options.tileJsonUrl ?? MAPTERHORN_TILEJSON_URL,
    },
    contourSource: {
      type: 'vector',
      tiles: [
        options.demSource.contourProtocolUrl({
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
        }),
      ],
      maxzoom: 17,
    },
  };

  const terrainBaseLayers: StyleLayerLike[] = [
    {
      id: 'trip-hillshade',
      type: 'hillshade',
      source: 'hillshadeSource',
      minzoom,
      paint: {
        'hillshade-shadow-color': dark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(20, 24, 36, 0.34)',
        'hillshade-highlight-color': dark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(255, 255, 255, 0.28)',
        'hillshade-illumination-direction': 315,
        'hillshade-exaggeration': dark ? 0.32 : 0.26,
      },
    },
    {
      id: 'trip-contour-lines',
      type: 'line',
      source: 'contourSource',
      'source-layer': 'contours',
      minzoom,
      paint: {
        'line-color': [
          'match',
          ['get', 'level'],
          0,
          dark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(45, 56, 78, 0.28)',
          dark ? 'rgba(203, 213, 225, 0.36)' : 'rgba(34, 44, 64, 0.44)',
        ],
        'line-width': ['match', ['get', 'level'], 0, 0.45, 1, 1.05, 1.35],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.26, 11, 0.42, 14, 0.65],
      },
    },
  ];

  const contourLabelLayer: StyleLayerLike = {
    id: 'trip-contour-labels',
    type: 'symbol',
    source: 'contourSource',
    'source-layer': 'contours',
    filter: ['>', ['get', 'level'], 0],
    minzoom: labelMinzoom,
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 200,
      'text-size': 10,
      'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
      'text-font': ['Noto Sans Regular'],
      'text-max-angle': 90,
      'text-padding': 1,
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': dark ? 'rgba(226, 232, 240, 0.72)' : 'rgba(22, 31, 48, 0.6)',
      'text-halo-color': dark ? 'rgba(11, 19, 36, 0.88)' : 'rgba(255, 255, 255, 0.82)',
      'text-halo-width': 1.1,
    },
  };

  const layers = [...(result.layers || [])];
  const beforeId = getFirstSymbolLayerId(result);
  const insertIndex = beforeId ? layers.findIndex((layer) => layer.id === beforeId) : layers.length;
  layers.splice(insertIndex === -1 ? layers.length : insertIndex, 0, ...terrainBaseLayers);
  layers.push(contourLabelLayer);
  result.layers = layers;
  return result;
}

export function addSatelliteSourceAndLayer<T extends StyleLike>(style: T, url = SATELLITE_URL): T {
  const result = structuredClone(style);
  result.sources = {
    ...(result.sources || {}),
    satellite: {
      type: 'raster',
      tiles: [url],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 22,
      attribution: '&copy; Google',
    },
  };

  const layers = [...(result.layers || [])];
  const insertIdx = layers.findIndex((l) => l.id === 'trip-hillshade');
  const satelliteLayer: StyleLayerLike = {
    id: 'satellite-layer',
    type: 'raster',
    source: 'satellite',
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 1 },
  };

  if (insertIdx !== -1) {
    layers.splice(insertIdx, 0, satelliteLayer);
  } else {
    layers.push(satelliteLayer);
  }
  result.layers = layers;
  return result;
}

export async function fetchOrmTileUrl(ormOrigin?: string, tileArchive = 'openrailwaymap'): Promise<string> {
  const origin = normalizeOrigin(ormOrigin);
  let version: string | undefined;
  try {
    const res = await fetch(`${origin}/tiles/${tileArchive}/version`);
    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      version = data.version;
    }
  } catch {
    // Fallback to unversioned URL
  }
  const query = version ? `?v=${encodeURIComponent(version)}` : '';
  return `${origin}/tiles/${tileArchive}/{z}/{x}/{y}.mvt${query}`;
}

export async function composeAtlasStyle<T extends StyleLike>(
  baseStyle: T,
  options: ComposeAtlasStyleOptions = {},
): Promise<T> {
  let composed: StyleLike = options.dropRelief === false ? structuredClone(baseStyle) : dropBaseRelief(baseStyle);

  if (options.orm) {
    const ormOpts: OrmOptions = options.orm === true ? {} : options.orm;
    const origin = normalizeOrigin(ormOpts.ormOrigin);
    const styleUrl = ormOpts.styleUrl ?? `${origin}/orm/style/standard.json`;
    const [ormRaw, tileUrl] = await Promise.all([
      ormOpts.ormStyle ? Promise.resolve(ormOpts.ormStyle) : loadJson<StyleLike>(styleUrl),
      ormOpts.tileUrl ? Promise.resolve(ormOpts.tileUrl) : fetchOrmTileUrl(origin, ormOpts.tileArchive),
    ]);
    const rewrittenOrm = rewriteOrmStyle(ormRaw, tileUrl, origin);
    composed = mergeBaseAndOrm(composed, rewrittenOrm, {
      withBaseMapVisibility: ormOpts.withBaseMapVisibility ?? Boolean(options.satellite),
    });
  }

  if (options.terrain) {
    composed = addMapterhornTerrain(composed, options.terrain);
  }

  if (options.satellite) {
    const satUrl = typeof options.satellite === 'object' ? options.satellite.url : undefined;
    composed = addSatelliteSourceAndLayer(composed, satUrl);
  }

  return composed as T;
}

let sharedDemSource: DemSourceLike | null = null;

export function setupMapterhornDem(
  maplibre: MapLibreLike,
  options: { url?: string; maxzoom?: number; worker?: boolean } = {},
): DemSourceLike {
  if (sharedDemSource) return sharedDemSource;
  const demSource = new mlcontour.DemSource({
    url: options.url ?? MAPTERHORN_TERRAIN_URL,
    encoding: 'terrarium',
    maxzoom: options.maxzoom ?? 17,
    worker: options.worker ?? true,
  }) as unknown as DemSourceLike;
  demSource.setupMaplibre(maplibre);
  sharedDemSource = demSource;
  return demSource;
}

const SPRITE_ATLAS_PREFIXES = ['orm:', 'sdf:'];

function isSpriteIndex(value: unknown): value is SpriteAtlas['index'] {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadSpriteAtlases(ormOrigin?: string): Promise<SpriteAtlas[]> {
  const origin = normalizeOrigin(ormOrigin);
  const specs = [
    { prefix: 'orm:', json: `${origin}/orm/sprite/symbols.json`, png: `${origin}/orm/sprite/symbols.png`, sdf: false },
    {
      prefix: 'sdf:',
      json: `${origin}/orm/sdf_sprite/symbols.json`,
      png: `${origin}/orm/sdf_sprite/symbols.png`,
      sdf: true,
    },
  ];
  const atlases: SpriteAtlas[] = [];
  for (const spec of specs) {
    const [index, image] = await Promise.all([loadJson<unknown>(spec.json), loadImage(spec.png)]);
    atlases.push({ ...spec, index: isSpriteIndex(index) ? index : {}, image });
  }
  return atlases;
}

function addSpriteImage(map: MapLike, id: string, atlases: SpriteAtlas[]): void {
  for (const atlas of atlases) {
    const key = id.startsWith(atlas.prefix) ? id.slice(atlas.prefix.length) : null;
    if (key && atlas.index[key]) {
      const meta = atlas.index[key];
      const canvas = document.createElement('canvas');
      canvas.width = meta.width;
      canvas.height = meta.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(atlas.image, meta.x, meta.y, meta.width, meta.height, 0, 0, meta.width, meta.height);
      const data = ctx.getImageData(0, 0, meta.width, meta.height).data;
      if (!map.hasImage(id)) {
        map.addImage(
          id,
          { width: meta.width, height: meta.height, data },
          { pixelRatio: meta.pixelRatio || 1, sdf: atlas.sdf },
        );
      }
      return;
    }
  }
}

export function installSpriteFallback(map: MapLike, options: { ormOrigin?: string } = {}): () => void {
  let atlases: Promise<SpriteAtlas[]> | null = null;
  const onMissing = (e: { id: string }) => {
    const id = e.id;
    if (!SPRITE_ATLAS_PREFIXES.some((prefix) => id.startsWith(prefix))) return;
    atlases ??= loadSpriteAtlases(options.ormOrigin);
    atlases
      .then((loaded) => addSpriteImage(map, id, loaded))
      .catch((error) => console.warn('Sprite fallback failed:', error));
  };
  map.on('styleimagemissing', onMissing);
  return () => {
    map.off('styleimagemissing', onMissing);
  };
}

export type ToggleOptions = { silent?: boolean };

export class TerrainToggleControl {
  _onChange?: (enabled: boolean) => void;
  _map?: MapLike;
  _enabled = false;
  _container?: HTMLElement;
  _btn?: HTMLButtonElement;
  _exaggeration: number;

  constructor(
    options: { onChange?: (enabled: boolean) => void; exaggeration?: number } | ((enabled: boolean) => void) = {},
  ) {
    if (typeof options === 'function') {
      this._onChange = options;
      this._exaggeration = 1.0;
    } else {
      this._onChange = options.onChange;
      this._exaggeration = options.exaggeration ?? 1.0;
    }
  }

  onAdd(map: MapLike) {
    this._map = map;
    this._enabled = false;
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this._btn = document.createElement('button');
    this._btn.type = 'button';
    this._btn.title = '3D Terrain';
    this._btn.setAttribute('aria-label', '3D Terrain');
    this._btn.className = 'maplibregl-ctrl-terrain';
    this._btn.textContent = '3D';
    this._btn.addEventListener('click', () => this.setEnabled(!this._enabled));
    this._container.appendChild(this._btn);
    return this._container;
  }

  setEnabled(enabled: boolean, options: ToggleOptions = {}) {
    const next = Boolean(enabled);
    if (this._enabled === next) return;
    this._enabled = next;
    if (this._map) {
      const map = this._map;
      runWhenStyleInfrastructureReady(map as unknown as Parameters<typeof runWhenStyleInfrastructureReady>[0], () => {
        if (!map.getSource('hillshadeSource')) return;
        map.setTerrain(next ? { source: 'hillshadeSource', exaggeration: this._exaggeration } : null);
      });
    }
    this._btn?.classList.toggle('maplibregl-ctrl-terrain-enabled', next);
    if (!options.silent) this._onChange?.(next);
  }

  onRemove() {
    this._container?.parentNode?.removeChild(this._container);
    this._map = undefined;
  }
}

export { runWhenStyleInfrastructureReady, setGlobalStatePropertyWhenReady };
