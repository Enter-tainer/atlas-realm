import { DRAWING_SOURCE_ID } from './drawing-model.js';
import { runWhenStyleReady } from './style-ready.js';
import type { DrawingStore } from './drawing-store.js';

export const DRAWING_LAYER_IDS = {
  polygonFill: 'drawing-plan-polygon-fill',
  polygonOutline: 'drawing-plan-polygon-outline',
  lineStroke: 'drawing-plan-line-stroke',
  line: 'drawing-plan-line',
  points: 'drawing-plan-points',
  text: 'drawing-plan-text',
  labels: 'drawing-plan-labels',
  arrows: 'drawing-plan-arrows',
} as const;
const DRAWING_ARROW_ICON = 'drawing-direction-arrow-v2';

type DrawingSource = {
  setData(data: object): void;
};
type DrawingMap = {
  _styleInitialized?: boolean;
  isStyleLoaded(): boolean | void;
  setGlobalStateProperty(propertyName: string, value: unknown): void;
  once(event: 'load', callback: () => void): void;
  addSource(id: string, source: object): void;
  getSource(id: string): unknown;
  addLayer(layer: object): void;
  getLayer(id: string): object | undefined;
  hasImage(id: string): boolean;
  addImage(id: string, image: ImageData, options?: { pixelRatio?: number; sdf?: boolean }): void;
  removeLayer(id: string): void;
  removeSource(id: string): void;
};

function kindFilter(kinds: string[]) {
  return ['in', ['get', 'kind'], ['literal', kinds]];
}

function asDrawingSource(source: unknown): DrawingSource | null {
  return source && typeof (source as DrawingSource).setData === 'function' ? (source as DrawingSource) : null;
}

function ensureArrowIcon(map: DrawingMap) {
  if (map.hasImage(DRAWING_ARROW_ICON)) return;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.fillStyle = '#111827';
  ctx.beginPath();
  ctx.moveTo(size / 2, 8);
  ctx.lineTo(49, 38);
  ctx.lineTo(39, 38);
  ctx.lineTo(39, 54);
  ctx.lineTo(25, 54);
  ctx.lineTo(25, 38);
  ctx.lineTo(15, 38);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  map.addImage(DRAWING_ARROW_ICON, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

function ensureDrawingLayers(map: DrawingMap, store: DrawingStore) {
  if (!map.getSource(DRAWING_SOURCE_ID)) {
    map.addSource(DRAWING_SOURCE_ID, {
      type: 'geojson',
      data: store.getGeoJson(),
      tolerance: 0,
    });
  }
  ensureArrowIcon(map);

  if (!map.getLayer(DRAWING_LAYER_IDS.polygonFill)) {
    map.addLayer({
      id: DRAWING_LAYER_IDS.polygonFill,
      type: 'fill',
      source: DRAWING_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'drawing_polygon'],
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'fill-opacity': ['coalesce', ['get', 'fill_opacity'], 0.22],
      },
    });
  }

  if (!map.getLayer(DRAWING_LAYER_IDS.polygonOutline)) {
    map.addLayer({
      id: DRAWING_LAYER_IDS.polygonOutline,
      type: 'line',
      source: DRAWING_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'drawing_polygon_outline'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'line-width': ['coalesce', ['get', 'line-width'], 3],
        'line-opacity': 0.95,
      },
    });
  }

  if (!map.getLayer(DRAWING_LAYER_IDS.lineStroke)) {
    map.addLayer({
      id: DRAWING_LAYER_IDS.lineStroke,
      type: 'line',
      source: DRAWING_SOURCE_ID,
      filter: kindFilter(['drawing_path', 'drawing_route']),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#111827',
        'line-width': ['+', ['coalesce', ['get', 'line-width'], 4], 3],
        'line-opacity': 0.82,
      },
    });
  }

  if (!map.getLayer(DRAWING_LAYER_IDS.line)) {
    map.addLayer({
      id: DRAWING_LAYER_IDS.line,
      type: 'line',
      source: DRAWING_SOURCE_ID,
      filter: kindFilter(['drawing_path', 'drawing_route']),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'line-width': ['coalesce', ['get', 'line-width'], 4],
        'line-opacity': 0.96,
      },
    });
  }

  if (!map.getLayer(DRAWING_LAYER_IDS.points)) {
    map.addLayer({
      id: DRAWING_LAYER_IDS.points,
      type: 'circle',
      source: DRAWING_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'drawing_point'],
      paint: {
        'circle-radius': 6,
        'circle-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': 0.95,
      },
    });
  }

  if (!map.getLayer(DRAWING_LAYER_IDS.text)) {
    map.addLayer({
      id: DRAWING_LAYER_IDS.text,
      type: 'symbol',
      source: DRAWING_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'drawing_text'],
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'description'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': 13,
        'text-anchor': 'center',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
      },
    });
  }

  if (!map.getLayer(DRAWING_LAYER_IDS.labels)) {
    map.addLayer({
      id: DRAWING_LAYER_IDS.labels,
      type: 'symbol',
      source: DRAWING_SOURCE_ID,
      filter: kindFilter(['drawing_label', 'drawing_point']),
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'description'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-offset': [0, 1.25],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
      },
    });
  }

  if (!map.getLayer(DRAWING_LAYER_IDS.arrows)) {
    map.addLayer({
      id: DRAWING_LAYER_IDS.arrows,
      type: 'symbol',
      source: DRAWING_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'drawing_arrow'],
      layout: {
        'icon-image': DRAWING_ARROW_ICON,
        'icon-size': ['interpolate', ['linear'], ['coalesce', ['get', 'width'], 4], 1, 0.5, 6, 0.76, 12, 1],
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-opacity': 0.9,
      },
    });
  }
}

export function installDrawingRenderer(map: DrawingMap, store: DrawingStore) {
  let disposed = false;
  const render = () => {
    if (disposed) return;
    runWhenStyleReady(map, () => {
      ensureDrawingLayers(map, store);
      asDrawingSource(map.getSource(DRAWING_SOURCE_ID))?.setData(store.getGeoJson());
    });
  };
  const unsubscribe = store.subscribe(render);
  render();
  return {
    destroy() {
      disposed = true;
      unsubscribe();
      for (const layerId of Object.values(DRAWING_LAYER_IDS).reverse()) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      }
      if (map.getSource(DRAWING_SOURCE_ID)) map.removeSource(DRAWING_SOURCE_ID);
    },
  };
}
