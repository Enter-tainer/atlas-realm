import maplibregl from 'maplibre-gl';
import createIconElement from 'lucide/dist/esm/createElement.mjs';
import ChevronDownIcon from 'lucide/dist/esm/icons/chevron-down.mjs';
import CloudSunIcon from 'lucide/dist/esm/icons/cloud-sun.mjs';
import {
  ANNOTATION_DEFAULT_LAYER_ID,
  ANNOTATION_SOURCE_ID,
  ANNOTATION_TEXT_MAX_HEIGHT,
  ANNOTATION_TEXT_MAX_WIDTH,
  ANNOTATION_TEXT_MIN_HEIGHT,
  ANNOTATION_TEXT_MIN_WIDTH,
  sanitizeAnnotationTextHeight,
  sanitizeAnnotationTextWidth,
  sanitizeLngLat,
} from './annotation-model.js';
import {
  weatherAnnotationDashboardUrl,
  weatherAnnotationDayCount,
  weatherAnnotationDisplayName,
  weatherAnnotationSummaryLabel,
} from './annotation-weather.js';
import { renderMarkdown } from './markdown.js';
import { runWhenStyleInfrastructureReady } from './style-ready.js';
import { fetchWeatherDailySummary, weatherSummaryKey, type WeatherDaySummary } from './weather-summary.js';
import { weatherCondition, type WeatherCondition } from './weather-icons.js';
import type {
  AnnotationFeaturePayload,
  AnnotationPolygonPayload,
  AnnotationTextPayload,
  AnnotationWeatherPayload,
} from './annotation-model.js';
import type { AnnotationLayer } from './layer-model.js';
import type { LayerStore } from './layer-store.js';

export const ANNOTATION_RENDER_LAYER_IDS = {
  polygonFill: 'annotation-polygon-fill',
  polygonOutline: 'annotation-polygon-outline',
  lineStroke: 'annotation-line-stroke',
  line: 'annotation-line',
  lineLabels: 'annotation-line-labels',
  polygonLabels: 'annotation-polygon-labels',
  points: 'annotation-points',
  weatherPoints: 'annotation-weather-points',
  text: 'annotation-text',
  textLabels: 'annotation-text-labels',
  labels: 'annotation-labels',
  arrows: 'annotation-arrows',
} as const;
export const ANNOTATION_RENDER_LAYER_ROLE_ORDER = Object.keys(ANNOTATION_RENDER_LAYER_IDS) as Array<
  keyof typeof ANNOTATION_RENDER_LAYER_IDS
>;
const ANNOTATION_ARROW_ICON = 'annotation-direction-arrow-v1';
const TEXT_NOTE_COMPACT_LABEL_MIN_ZOOM = 7;
const TEXT_NOTE_FULL_MIN_ZOOM = 11;
const ANNOTATION_ACTIVE_FEATURE_EVENT = 'annotation:activefeaturechange';
export const ANNOTATION_WEATHER_LABEL_MIN_ZOOM = TEXT_NOTE_COMPACT_LABEL_MIN_ZOOM;

type AnnotationSource = {
  setData(data: object): void;
};
type AnnotationMap = {
  _styleInitialized?: boolean;
  _styleInfrastructureInitialized?: boolean;
  style?: { _loaded?: boolean };
  isStyleLoaded(): boolean | void;
  setGlobalStateProperty(propertyName: string, value: unknown): void;
  once(event: 'load' | 'style.load', callback: () => void): void;
  on?(event: 'load' | 'style.load' | 'zoom', callback: () => void): void;
  off?(event: 'load' | 'style.load' | 'zoom', callback: () => void): void;
  getZoom(): number;
  project(lngLat: maplibregl.LngLatLike): { x: number; y: number };
  unproject(point: [number, number]): { lng: number; lat: number };
  addSource(id: string, source: object): void;
  getSource(id: string): unknown;
  addLayer(layer: object): void;
  getLayer(id: string): object | undefined;
  hasImage(id: string): boolean;
  addImage(id: string, image: ImageData, options?: { pixelRatio?: number; sdf?: boolean }): void;
  removeLayer(id: string): void;
  removeSource(id: string): void;
  getContainer(): HTMLElement;
};
type AnnotationRenderLayerSet = {
  layerId: string;
  sourceId: string;
  layerIds: Record<keyof typeof ANNOTATION_RENDER_LAYER_IDS, string>;
};

type AnnotationTextMarker = {
  marker: maplibregl.Marker;
  element: HTMLElement;
};
type WeatherSummaryCache = {
  summaryKey: string;
  summaryAbort: AbortController | null;
};
type AnnotationWeatherCardMarker = WeatherSummaryCache & {
  kind: 'card';
  marker: maplibregl.Marker;
  element: HTMLElement;
  header: HTMLButtonElement;
  strip: HTMLElement;
  detail: HTMLElement;
  body: HTMLElement;
  frame: HTMLIFrameElement;
  title: HTMLElement;
  meta: HTMLElement;
  openLink: HTMLAnchorElement;
};
/** Zoomed-out form of a weather annotation: a dot plus one plain-text line. */
type AnnotationWeatherLabelMarker = WeatherSummaryCache & {
  kind: 'label';
  marker: maplibregl.Marker;
  element: HTMLElement;
  icon: HTMLElement;
  text: HTMLElement;
};
type AnnotationWeatherMarker = AnnotationWeatherCardMarker | AnnotationWeatherLabelMarker;
type AnnotationWeatherMode = 'card' | 'label';
type AnnotationVertexMarker = {
  marker: maplibregl.Marker;
  element: HTMLElement;
  cleanup: () => void;
};
type TextResizeCorner = 'nw' | 'ne' | 'se' | 'sw';
type ScreenPoint = { x: number; y: number };
type TextResizeState = {
  featureId: string;
  pointerId: number;
  marker: maplibregl.Marker;
  element: HTMLElement;
  handle: HTMLElement;
  corner: TextResizeCorner;
  startPointer: ScreenPoint;
  startDragged: ScreenPoint;
  opposite: ScreenPoint;
  nextCoordinate: AnnotationTextPayload['coordinate'];
  nextWidth: number;
  nextHeight: number;
  wasDraggable: boolean;
};
type AnnotationActiveFeatureDetail = {
  activeId?: unknown;
  selectedId?: unknown;
  editingId?: unknown;
};

function kindFilter(kinds: string[]) {
  return ['in', ['get', 'kind'], ['literal', kinds]];
}

function annotationLineDashExpression() {
  return [
    'match',
    ['get', 'line_style'],
    'dashed',
    ['literal', [1.8, 1.2]],
    'dotted',
    ['literal', [0.05, 1.45]],
    ['literal', [1, 0]],
  ];
}

function asAnnotationSource(source: unknown): AnnotationSource | null {
  return source && typeof (source as AnnotationSource).setData === 'function' ? (source as AnnotationSource) : null;
}

function ensureArrowIcon(map: AnnotationMap) {
  if (map.hasImage(ANNOTATION_ARROW_ICON)) return;
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
  map.addImage(ANNOTATION_ARROW_ICON, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

function renderSafeLayerId(layerId: string) {
  return layerId.replace(/[^0-9a-zA-Z_-]/g, '-');
}

export function annotationRenderSourceId(layerId: string) {
  return layerId === ANNOTATION_DEFAULT_LAYER_ID
    ? ANNOTATION_SOURCE_ID
    : `${ANNOTATION_SOURCE_ID}-${renderSafeLayerId(layerId)}`;
}

export function annotationRenderLayerIds(layerId: string): Record<keyof typeof ANNOTATION_RENDER_LAYER_IDS, string> {
  if (layerId === ANNOTATION_DEFAULT_LAYER_ID) return { ...ANNOTATION_RENDER_LAYER_IDS };
  const suffix = renderSafeLayerId(layerId);
  return Object.fromEntries(
    ANNOTATION_RENDER_LAYER_ROLE_ORDER.map((role) => [role, `${ANNOTATION_RENDER_LAYER_IDS[role]}-${suffix}`]),
  ) as Record<keyof typeof ANNOTATION_RENDER_LAYER_IDS, string>;
}

export function annotationRenderLayerSet(layerId: string): AnnotationRenderLayerSet {
  return {
    layerId,
    sourceId: annotationRenderSourceId(layerId),
    layerIds: annotationRenderLayerIds(layerId),
  };
}

export function annotationRenderLayerIdList(layerId: string) {
  const ids = annotationRenderLayerIds(layerId);
  return ANNOTATION_RENDER_LAYER_ROLE_ORDER.map((role) => ids[role]);
}

function ensureAnnotationLayers(map: AnnotationMap, store: LayerStore, layer: AnnotationLayer) {
  const renderLayer = annotationRenderLayerSet(layer.id);
  const { sourceId, layerIds } = renderLayer;
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: 'geojson',
      data: store.getLayerGeoJson(layer.id, { includeHidden: false }),
      tolerance: 0,
    });
  }
  ensureArrowIcon(map);

  if (!map.getLayer(layerIds.polygonFill)) {
    map.addLayer({
      id: layerIds.polygonFill,
      type: 'fill',
      source: sourceId,
      filter: ['==', ['get', 'kind'], 'annotation_polygon'],
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'fill-opacity': ['coalesce', ['get', 'fill_opacity'], 0.22],
      },
    });
  }

  if (!map.getLayer(layerIds.polygonOutline)) {
    map.addLayer({
      id: layerIds.polygonOutline,
      type: 'line',
      source: sourceId,
      filter: ['==', ['get', 'kind'], 'annotation_polygon_outline'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'line-width': ['coalesce', ['get', 'line-width'], 3],
        'line-opacity': ['coalesce', ['get', 'opacity'], 0.95],
        'line-dasharray': annotationLineDashExpression(),
      },
    });
  }

  if (!map.getLayer(layerIds.lineStroke)) {
    map.addLayer({
      id: layerIds.lineStroke,
      type: 'line',
      source: sourceId,
      filter: [
        'all',
        kindFilter(['annotation_path', 'annotation_route']),
        ['any', ['!', ['has', 'line_style']], ['==', ['get', 'line_style'], 'solid']],
      ],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#111827',
        'line-width': ['+', ['coalesce', ['get', 'line-width'], 4], 3],
        'line-opacity': ['*', ['coalesce', ['get', 'opacity'], 0.95], 0.85],
      },
    });
  }

  if (!map.getLayer(layerIds.line)) {
    map.addLayer({
      id: layerIds.line,
      type: 'line',
      source: sourceId,
      filter: kindFilter(['annotation_path', 'annotation_route']),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'line-width': ['coalesce', ['get', 'line-width'], 4],
        'line-opacity': ['coalesce', ['get', 'opacity'], 0.96],
        'line-dasharray': annotationLineDashExpression(),
      },
    });
  }

  if (!map.getLayer(layerIds.points)) {
    map.addLayer({
      id: layerIds.points,
      type: 'circle',
      source: sourceId,
      filter: ['==', ['get', 'kind'], 'annotation_point'],
      paint: {
        'circle-radius': 6,
        'circle-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': 0.95,
      },
    });
  }

  if (!map.getLayer(layerIds.weatherPoints)) {
    map.addLayer({
      id: layerIds.weatherPoints,
      type: 'circle',
      source: sourceId,
      maxzoom: ANNOTATION_WEATHER_LABEL_MIN_ZOOM,
      filter: ['==', ['get', 'kind'], 'annotation_weather'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 3.5, 7, 5],
        'circle-color': ['coalesce', ['get', 'color'], '#0ea5e9'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': 0.92,
      },
    });
  }

  if (!map.getLayer(layerIds.lineLabels)) {
    map.addLayer({
      id: layerIds.lineLabels,
      type: 'symbol',
      source: sourceId,
      filter: [
        'all',
        kindFilter(['annotation_path', 'annotation_route']),
        ['any', ['has', 'name'], ['has', 'description_plain']],
      ],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name'], ['get', 'description_plain'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
      },
    });
  }

  if (!map.getLayer(layerIds.polygonLabels)) {
    map.addLayer({
      id: layerIds.polygonLabels,
      type: 'symbol',
      source: sourceId,
      filter: [
        'all',
        ['==', ['get', 'kind'], 'annotation_polygon'],
        ['any', ['has', 'name'], ['has', 'description_plain']],
      ],
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'description_plain'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-anchor': 'center',
        'text-offset': [0, 0],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
      },
    });
  }

  if (!map.getLayer(layerIds.text)) {
    map.addLayer({
      id: layerIds.text,
      type: 'circle',
      source: sourceId,
      maxzoom: TEXT_NOTE_FULL_MIN_ZOOM,
      filter: ['==', ['get', 'kind'], 'annotation_text'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 3.5, 7, 4.75, 10.9, 6],
        'circle-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': 0.92,
      },
    });
  }

  if (!map.getLayer(layerIds.textLabels)) {
    map.addLayer({
      id: layerIds.textLabels,
      type: 'symbol',
      source: sourceId,
      minzoom: TEXT_NOTE_COMPACT_LABEL_MIN_ZOOM,
      maxzoom: TEXT_NOTE_FULL_MIN_ZOOM,
      filter: ['==', ['get', 'kind'], 'annotation_text'],
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'description_plain'], 'Note'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 10.9, 13],
        'text-offset': [0, 1.05],
        'text-anchor': 'top',
        'text-max-width': 10,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
      },
      paint: {
        'text-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
      },
    });
  }

  if (!map.getLayer(layerIds.labels)) {
    map.addLayer({
      id: layerIds.labels,
      type: 'symbol',
      source: sourceId,
      filter: ['==', ['get', 'kind'], 'annotation_point'],
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'description_plain'], ''],
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

  if (!map.getLayer(layerIds.arrows)) {
    map.addLayer({
      id: layerIds.arrows,
      type: 'symbol',
      source: sourceId,
      filter: ['==', ['get', 'kind'], 'annotation_arrow'],
      layout: {
        'icon-image': ANNOTATION_ARROW_ICON,
        'icon-size': ['interpolate', ['linear'], ['coalesce', ['get', 'width'], 4], 1, 0.5, 6, 0.76, 12, 1],
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-opacity': ['coalesce', ['get', 'opacity'], 0.9],
      },
    });
  }
}

function stopTextMarkerPropagation(node: Element) {
  node.addEventListener('contextmenu', (event) => event.stopPropagation());
  node.addEventListener('click', (event) => event.stopPropagation());
  node.addEventListener('dblclick', (event) => event.stopPropagation());
  node.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
}

function stopVertexMarkerPropagation(node: Element) {
  node.addEventListener('contextmenu', (event) => event.stopPropagation());
  node.addEventListener('click', (event) => event.stopPropagation());
  node.addEventListener('dblclick', (event) => event.stopPropagation());
  node.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
}

function stopTextResizeHandleEvent(event: Event) {
  event.preventDefault();
  event.stopPropagation();
}

function visibleTextFeatures(store: LayerStore, { zoom, activeFeatureId }: { zoom: number; activeFeatureId: string }) {
  const showAllFullNotes = zoom >= TEXT_NOTE_FULL_MIN_ZOOM;
  return store
    .getAnnotationFeatures()
    .map((feature) => feature.payload)
    .filter((feature): feature is AnnotationTextPayload => {
      return Boolean(
        feature?.type === 'text' &&
        store.getAnnotationLayer(feature.layerId)?.visible !== false &&
        (showAllFullNotes || feature.id === activeFeatureId),
      );
    });
}

function textMarkerBody(feature: AnnotationTextPayload) {
  return feature.note || feature.label || 'Note';
}

function markerFeatureEvent(
  type: 'annotation:featureclick' | 'annotation:featuredblclick',
  feature: AnnotationFeaturePayload,
) {
  return new CustomEvent(type, { detail: { id: feature.id } });
}

function textFeatureSize(feature: AnnotationTextPayload) {
  return {
    width: sanitizeAnnotationTextWidth(feature.width),
    height: sanitizeAnnotationTextHeight(feature.height),
  };
}

function pointerPoint(map: AnnotationMap, event: PointerEvent): ScreenPoint {
  const rect = map.getContainer().getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function textMarkerCorner(center: ScreenPoint, width: number, height: number, corner: TextResizeCorner): ScreenPoint {
  return {
    x: center.x + (corner.includes('e') ? width / 2 : -width / 2),
    y: center.y + (corner.includes('s') ? height / 2 : -height / 2),
  };
}

function oppositeTextMarkerCorner(corner: TextResizeCorner): TextResizeCorner {
  if (corner === 'nw') return 'se';
  if (corner === 'ne') return 'sw';
  if (corner === 'se') return 'nw';
  return 'ne';
}

function clampResizeEdge(value: number, opposite: number, direction: number, min: number, max: number) {
  const minEdge = opposite + direction * min;
  const maxEdge = opposite + direction * max;
  return direction > 0 ? Math.min(maxEdge, Math.max(minEdge, value)) : Math.max(maxEdge, Math.min(minEdge, value));
}

function applyTextMarkerSize(element: HTMLElement, width: number, height: number) {
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
}

function createTextMarkerElement(map: AnnotationMap, feature: AnnotationTextPayload, activeFeatureId: string) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'annotation-text-note';
  element.dataset.annotationId = feature.id;
  element.style.setProperty('--annotation-note-color', feature.color || '#2563eb');
  element.title = feature.label || 'Note';
  element.setAttribute('aria-label', feature.label || 'Note');
  stopTextMarkerPropagation(element);
  element.addEventListener('click', () => {
    map.getContainer().dispatchEvent(markerFeatureEvent('annotation:featureclick', feature));
  });
  element.addEventListener('dblclick', () => {
    map.getContainer().dispatchEvent(markerFeatureEvent('annotation:featuredblclick', feature));
  });
  const title = document.createElement('div');
  title.className = 'annotation-text-note-title';
  element.appendChild(title);
  const body = document.createElement('div');
  body.className = 'annotation-text-note-body';
  element.appendChild(body);
  for (const corner of ['nw', 'ne', 'se', 'sw'] as const) {
    const handle = document.createElement('span');
    handle.className = `annotation-text-note-resize-handle annotation-text-note-resize-${corner}`;
    handle.dataset.corner = corner;
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('mousedown', stopTextResizeHandleEvent);
    handle.addEventListener('touchstart', stopTextResizeHandleEvent);
    handle.addEventListener('click', stopTextResizeHandleEvent);
    handle.addEventListener('dblclick', stopTextResizeHandleEvent);
    element.appendChild(handle);
  }
  updateTextMarkerElement(element, feature, activeFeatureId);
  return element;
}

function updateTextMarkerElement(element: HTMLElement, feature: AnnotationTextPayload, activeFeatureId: string) {
  const { width, height } = textFeatureSize(feature);
  element.dataset.annotationId = feature.id;
  element.style.setProperty('--annotation-note-color', feature.color || '#2563eb');
  applyTextMarkerSize(element, width, height);
  element.classList.toggle('annotation-text-note-active', feature.id === activeFeatureId);
  element.title = feature.label || 'Note';
  element.setAttribute('aria-label', feature.label || 'Note');
  const title = element.querySelector<HTMLElement>('.annotation-text-note-title');
  const body = element.querySelector<HTMLElement>('.annotation-text-note-body');
  if (title) title.textContent = feature.label || 'Note';
  if (body) body.innerHTML = renderMarkdown(textMarkerBody(feature));
}

function updateTextFeatureCoordinate(store: LayerStore, featureId: string, marker: maplibregl.Marker) {
  const feature = store.getAnnotationFeaturePayload(featureId);
  if (feature?.type !== 'text') return;
  const lngLat = marker.getLngLat();
  const coordinate = sanitizeLngLat([lngLat.lng, lngLat.lat]);
  if (!coordinate) return;
  const [lng, lat] = coordinate;
  if (feature.coordinate[0] === lng && feature.coordinate[1] === lat) return;
  store.updateFeature({
    ...feature,
    coordinate,
    updatedAt: Date.now(),
  });
}

function activePolygonFeature(store: LayerStore, activeFeatureId: string): AnnotationPolygonPayload | null {
  const feature = store.getAnnotationFeaturePayload(activeFeatureId);
  if (feature?.type !== 'polygon') return null;
  if (store.getAnnotationLayer(feature.layerId)?.visible === false) return null;
  return feature;
}

function vertexMarkerKey(featureId: string, vertexIndex: number) {
  return `${featureId}:${vertexIndex}`;
}

function createPolygonVertexElement(map: AnnotationMap, feature: AnnotationPolygonPayload, vertexIndex: number) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'annotation-polygon-vertex';
  element.dataset.annotationId = feature.id;
  element.dataset.vertexIndex = String(vertexIndex);
  element.title = `Move area vertex ${vertexIndex + 1}`;
  element.setAttribute('aria-label', `Move area vertex ${vertexIndex + 1}`);
  stopVertexMarkerPropagation(element);
  element.addEventListener('click', () => {
    map.getContainer().dispatchEvent(markerFeatureEvent('annotation:featureclick', feature));
  });
  element.addEventListener('dblclick', () => {
    map.getContainer().dispatchEvent(markerFeatureEvent('annotation:featuredblclick', feature));
  });
  updatePolygonVertexElement(element, feature, vertexIndex);
  return element;
}

function updatePolygonVertexElement(element: HTMLElement, feature: AnnotationPolygonPayload, vertexIndex: number) {
  element.dataset.annotationId = feature.id;
  element.dataset.vertexIndex = String(vertexIndex);
  element.style.setProperty('--annotation-vertex-color', feature.color || '#2563eb');
  element.title = `Move area vertex ${vertexIndex + 1}`;
  element.setAttribute('aria-label', `Move area vertex ${vertexIndex + 1}`);
}

function updatePolygonVertexCoordinate(
  store: LayerStore,
  featureId: string,
  vertexIndex: number,
  marker: maplibregl.Marker,
  options: { force?: boolean; remote?: boolean } = {},
) {
  const feature = store.getAnnotationFeaturePayload(featureId);
  if (feature?.type !== 'polygon') return;
  if (vertexIndex < 0 || vertexIndex >= feature.points.length) return;
  const lngLat = marker.getLngLat();
  const coordinate = sanitizeLngLat([lngLat.lng, lngLat.lat]);
  if (!coordinate) return;
  const current = feature.points[vertexIndex];
  if (!options.force && current[0] === coordinate[0] && current[1] === coordinate[1]) return;
  const points = feature.points.slice();
  points[vertexIndex] = coordinate;
  store.updateFeature(
    {
      ...feature,
      points,
      updatedAt: Date.now(),
    },
    { remote: options.remote },
  );
}

function installPolygonVertexDrag(
  store: LayerStore,
  marker: maplibregl.Marker,
  featureId: string,
  vertexIndex: number,
) {
  let frame = 0;
  const cancelLocalUpdate = () => {
    if (!frame) return;
    globalThis.cancelAnimationFrame(frame);
    frame = 0;
  };
  const scheduleLocalUpdate = () => {
    if (frame) return;
    frame = globalThis.requestAnimationFrame(() => {
      frame = 0;
      updatePolygonVertexCoordinate(store, featureId, vertexIndex, marker, { remote: true });
    });
  };
  const commitUpdate = () => {
    cancelLocalUpdate();
    updatePolygonVertexCoordinate(store, featureId, vertexIndex, marker, { force: true });
  };
  marker.on('drag', scheduleLocalUpdate);
  marker.on('dragend', commitUpdate);
  return () => {
    cancelLocalUpdate();
    marker.off('drag', scheduleLocalUpdate);
    marker.off('dragend', commitUpdate);
  };
}

function updateTextMarkerResize(
  map: AnnotationMap,
  state: TextResizeState,
  event: PointerEvent,
): { coordinate: AnnotationTextPayload['coordinate']; width: number; height: number } | null {
  const pointer = pointerPoint(map, event);
  const directionX = state.corner.includes('e') ? 1 : -1;
  const directionY = state.corner.includes('s') ? 1 : -1;
  const dragged = {
    x: state.startDragged.x + pointer.x - state.startPointer.x,
    y: state.startDragged.y + pointer.y - state.startPointer.y,
  };
  const edgeX = clampResizeEdge(
    dragged.x,
    state.opposite.x,
    directionX,
    ANNOTATION_TEXT_MIN_WIDTH,
    ANNOTATION_TEXT_MAX_WIDTH,
  );
  const edgeY = clampResizeEdge(
    dragged.y,
    state.opposite.y,
    directionY,
    ANNOTATION_TEXT_MIN_HEIGHT,
    ANNOTATION_TEXT_MAX_HEIGHT,
  );
  const width = Math.round(Math.abs(edgeX - state.opposite.x));
  const height = Math.round(Math.abs(edgeY - state.opposite.y));
  const center = {
    x: (edgeX + state.opposite.x) / 2,
    y: (edgeY + state.opposite.y) / 2,
  };
  const lngLat = map.unproject([center.x, center.y]);
  const coordinate = sanitizeLngLat([lngLat.lng, lngLat.lat]);
  if (!coordinate) return null;
  applyTextMarkerSize(state.element, width, height);
  state.marker.setLngLat(coordinate);
  state.nextCoordinate = coordinate;
  state.nextWidth = width;
  state.nextHeight = height;
  return { coordinate, width, height };
}

function installTextMarkerResize(
  map: AnnotationMap,
  store: LayerStore,
  marker: maplibregl.Marker,
  element: HTMLElement,
  featureId: string,
) {
  let resizeState: TextResizeState | null = null;
  const beginResize = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    const corner = handle.dataset.corner as TextResizeCorner | undefined;
    if (corner !== 'nw' && corner !== 'ne' && corner !== 'se' && corner !== 'sw') return;
    const feature = store.getAnnotationFeaturePayload(featureId);
    if (feature?.type !== 'text') return;

    event.preventDefault();
    event.stopPropagation();
    const { width, height } = textFeatureSize(feature);
    const center = map.project(feature.coordinate);
    const startCenter = { x: center.x, y: center.y };
    const opposite = textMarkerCorner(startCenter, width, height, oppositeTextMarkerCorner(corner));
    resizeState = {
      featureId,
      pointerId: event.pointerId,
      marker,
      element,
      handle,
      corner,
      startPointer: pointerPoint(map, event),
      startDragged: textMarkerCorner(startCenter, width, height, corner),
      opposite,
      nextCoordinate: feature.coordinate,
      nextWidth: width,
      nextHeight: height,
      wasDraggable: marker.isDraggable(),
    };
    marker.setDraggable(false);
    element.classList.add('annotation-text-note-resizing');
    handle.setPointerCapture?.(event.pointerId);
  };
  const moveResize = (event: PointerEvent) => {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateTextMarkerResize(map, resizeState, event);
  };
  const finishResize = (event: PointerEvent) => {
    const state = resizeState;
    if (!state || state.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    if (state.handle.hasPointerCapture?.(state.pointerId)) state.handle.releasePointerCapture(state.pointerId);
    state.element.classList.remove('annotation-text-note-resizing');
    state.marker.setDraggable(state.wasDraggable);
    resizeState = null;

    const feature = store.getAnnotationFeaturePayload(state.featureId);
    if (feature?.type !== 'text') return;
    if (
      feature.width === state.nextWidth &&
      feature.height === state.nextHeight &&
      feature.coordinate[0] === state.nextCoordinate[0] &&
      feature.coordinate[1] === state.nextCoordinate[1]
    ) {
      return;
    }
    store.updateFeature({
      ...feature,
      coordinate: state.nextCoordinate,
      width: state.nextWidth,
      height: state.nextHeight,
      updatedAt: Date.now(),
    });
  };

  for (const handle of element.querySelectorAll<HTMLElement>('.annotation-text-note-resize-handle')) {
    handle.addEventListener('pointerdown', beginResize);
    handle.addEventListener('pointermove', moveResize);
    handle.addEventListener('pointerup', finishResize);
    handle.addEventListener('pointercancel', finishResize);
  }
}

function syncTextMarkers(
  map: AnnotationMap,
  store: LayerStore,
  markers: Map<string, AnnotationTextMarker>,
  viewState: { zoom: number; activeFeatureId: string },
) {
  const features = visibleTextFeatures(store, viewState);
  const visibleIds = new Set(features.map((feature) => feature.id));
  for (const [id, entry] of markers) {
    if (!visibleIds.has(id)) {
      entry.marker.remove();
      markers.delete(id);
    }
  }
  for (const feature of features) {
    const existing = markers.get(feature.id);
    if (existing) {
      updateTextMarkerElement(existing.element, feature, viewState.activeFeatureId);
      existing.marker.setLngLat(feature.coordinate);
      continue;
    }
    const element = createTextMarkerElement(map, feature, viewState.activeFeatureId);
    const marker = new maplibregl.Marker({ element, anchor: 'center', draggable: true })
      .setLngLat(feature.coordinate)
      .addTo(map as unknown as maplibregl.Map);
    marker.on('dragend', () => updateTextFeatureCoordinate(store, feature.id, marker));
    installTextMarkerResize(map, store, marker, element, feature.id);
    markers.set(feature.id, { marker, element });
  }
}

function stopWeatherCardPropagation(node: Element) {
  // Keep card interactions local, but let drag-start events reach MapLibre so
  // the card can still be dragged to a new query location.
  node.addEventListener('contextmenu', (event) => event.stopPropagation());
  node.addEventListener('click', (event) => event.stopPropagation());
  node.addEventListener('dblclick', (event) => event.stopPropagation());
  node.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
}

/**
 * A weather annotation only has two shapes: the dot-plus-one-line label, and the
 * full card once expanded. Zoom decides whether every annotation shows at all —
 * below `ANNOTATION_WEATHER_LABEL_MIN_ZOOM` only the selected one survives.
 */
function visibleWeatherFeatures(
  store: LayerStore,
  { zoom, activeFeatureId }: { zoom: number; activeFeatureId: string },
) {
  const showAll = zoom >= ANNOTATION_WEATHER_LABEL_MIN_ZOOM;
  return store
    .getAnnotationFeatures()
    .map((feature) => feature.payload)
    .filter((feature): feature is AnnotationWeatherPayload => {
      return Boolean(
        feature?.type === 'weather' &&
        store.getAnnotationLayer(feature.layerId)?.visible !== false &&
        (showAll || feature.id === activeFeatureId),
      );
    });
}

// The embed keeps the dashboard's compact timeline and only hides its chrome.
function weatherCardDashboardUrl(feature: AnnotationWeatherPayload) {
  return weatherAnnotationDashboardUrl(feature, { compact: true, immersive: true });
}

/** The external link opens the real dashboard, with its own controls restored. */
function weatherCardExternalUrl(feature: AnnotationWeatherPayload) {
  return weatherAnnotationDashboardUrl(feature, { compact: false, immersive: false });
}

function updateWeatherFeatureCoordinate(store: LayerStore, featureId: string, marker: maplibregl.Marker) {
  const feature = store.getAnnotationFeaturePayload(featureId);
  if (feature?.type !== 'weather') return;
  const lngLat = marker.getLngLat();
  const coordinate = sanitizeLngLat([lngLat.lng, lngLat.lat]);
  if (!coordinate) return;
  const [lng, lat] = coordinate;
  if (feature.coordinate[0] === lng && feature.coordinate[1] === lat) return;
  store.updateFeature({ ...feature, coordinate, updatedAt: Date.now() });
}

function createWeatherCardElement(
  map: AnnotationMap,
  feature: AnnotationWeatherPayload,
  onToggle: (featureId: string) => void,
): Omit<AnnotationWeatherCardMarker, 'marker'> {
  const element = document.createElement('article');
  element.className = 'annotation-weather-card';
  element.dataset.annotationId = feature.id;
  stopWeatherCardPropagation(element);

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'annotation-weather-card-header';
  element.appendChild(header);

  const icon = document.createElement('span');
  icon.className = 'annotation-weather-card-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.appendChild(
    createIconElement(CloudSunIcon, { class: 'annotation-weather-icon', 'aria-hidden': 'true', focusable: 'false' }),
  );
  header.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'annotation-weather-card-text';
  header.appendChild(text);
  const title = document.createElement('span');
  title.className = 'annotation-weather-card-title';
  text.appendChild(title);
  const detail = document.createElement('span');
  detail.className = 'annotation-weather-card-detail';
  text.appendChild(detail);
  const meta = document.createElement('span');
  meta.className = 'annotation-weather-card-meta';
  detail.appendChild(meta);

  const chevron = document.createElement('span');
  chevron.className = 'annotation-weather-card-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.appendChild(
    createIconElement(ChevronDownIcon, { class: 'annotation-weather-icon', 'aria-hidden': 'true', focusable: 'false' }),
  );
  header.appendChild(chevron);

  const strip = document.createElement('div');
  strip.className = 'annotation-weather-card-strip';
  strip.setAttribute('aria-label', 'Daily forecast');
  element.appendChild(strip);

  const body = document.createElement('div');
  body.className = 'annotation-weather-card-body';
  element.appendChild(body);

  const frame = document.createElement('iframe');
  frame.className = 'annotation-weather-card-frame';
  frame.title = 'Weather forecast';
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer-when-downgrade';
  body.appendChild(frame);

  const actions = document.createElement('div');
  actions.className = 'annotation-weather-card-actions';
  body.appendChild(actions);

  // A visible rename/edit entry point: without it the only way in was an
  // undiscoverable double-click on the header.
  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'annotation-weather-card-edit';
  editButton.textContent = 'Edit card';
  editButton.title = 'Rename and edit this weather card';
  editButton.addEventListener('click', () => {
    map.getContainer().dispatchEvent(markerFeatureEvent('annotation:featuredblclick', feature));
  });
  actions.appendChild(editButton);

  const openLink = document.createElement('a');
  openLink.className = 'annotation-weather-card-open';
  openLink.target = '_blank';
  openLink.rel = 'noopener noreferrer';
  openLink.textContent = 'Open weather.mgt.moe';
  actions.appendChild(openLink);

  header.addEventListener('click', () => {
    onToggle(feature.id);
    map.getContainer().dispatchEvent(markerFeatureEvent('annotation:featureclick', feature));
  });
  header.addEventListener('dblclick', () => {
    map.getContainer().dispatchEvent(markerFeatureEvent('annotation:featuredblclick', feature));
  });

  return {
    kind: 'card',
    element,
    header,
    strip,
    detail,
    body,
    frame,
    title,
    meta,
    openLink,
    summaryKey: '',
    summaryAbort: null,
  };
}

function createWeatherLabelElement(
  map: AnnotationMap,
  feature: AnnotationWeatherPayload,
  onToggle: (featureId: string) => void,
): Omit<AnnotationWeatherLabelMarker, 'marker'> {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'annotation-weather-label';
  element.dataset.annotationId = feature.id;
  stopWeatherCardPropagation(element);

  const dot = document.createElement('span');
  dot.className = 'annotation-weather-label-dot';
  dot.setAttribute('aria-hidden', 'true');
  element.appendChild(dot);

  const icon = document.createElement('span');
  icon.className = 'annotation-weather-label-icon';
  icon.setAttribute('aria-hidden', 'true');
  element.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'annotation-weather-label-text';
  element.appendChild(text);

  element.addEventListener('click', () => {
    // One click goes straight to the full card; the label is the collapsed state.
    onToggle(feature.id);
    map.getContainer().dispatchEvent(markerFeatureEvent('annotation:featureclick', feature));
  });
  element.addEventListener('dblclick', () => {
    map.getContainer().dispatchEvent(markerFeatureEvent('annotation:featuredblclick', feature));
  });

  return { kind: 'label', element, icon, text, summaryKey: '', summaryAbort: null };
}

function formatWeatherDayLabel(date: string) {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return `${Number(match[1])}/${Number(match[2])}`;
}

function formatWeatherTemp(value: number | null) {
  return value == null ? '–' : `${Math.round(value)}°`;
}

function createWeatherConditionIcon(condition: WeatherCondition) {
  const icon = document.createElement('span');
  icon.className = 'annotation-weather-card-day-icon';
  icon.title = condition.label;
  icon.appendChild(
    createIconElement(condition.icon, {
      class: 'annotation-weather-card-day-glyph',
      color: condition.color,
      'aria-hidden': 'true',
      focusable: 'false',
    }),
  );
  return icon;
}

function formatWeatherHumidity(value: number | null) {
  return value == null ? '–' : `${Math.round(value)}%`;
}

/** Precipitation totals read better at millimetre precision. */
function formatWeatherPrecipitation(value: number | null) {
  return value == null ? '–' : `${Number(value.toFixed(1))}mm`;
}

function weatherDayDetail(day: WeatherDaySummary) {
  return `${formatWeatherTemp(day.tempMax)}/${formatWeatherTemp(day.tempMin)} · ${formatWeatherHumidity(day.humidity)} · ${formatWeatherPrecipitation(day.precipitation)}`;
}

function renderWeatherStrip(strip: HTMLElement, summary: WeatherDaySummary[] | null, state: string) {
  strip.dataset.state = state;
  strip.replaceChildren();
  if (state !== 'ready' || !summary || summary.length === 0) {
    const note = document.createElement('span');
    note.className = 'annotation-weather-card-strip-note';
    note.textContent = state === 'loading' ? 'Loading forecast…' : 'Forecast unavailable';
    strip.appendChild(note);
    return;
  }
  // A single day is the common case: keep it to one compact line.
  if (summary.length === 1) {
    const [day] = summary;
    const condition = weatherCondition(day.weatherCode);
    strip.appendChild(createWeatherConditionIcon(condition));
    const temps = document.createElement('span');
    temps.className = 'annotation-weather-card-day-temps';
    temps.textContent = `${formatWeatherTemp(day.tempMax)}/${formatWeatherTemp(day.tempMin)}`;
    strip.appendChild(temps);
    const detail = document.createElement('span');
    detail.className = 'annotation-weather-card-day-detail';
    detail.textContent = `${formatWeatherHumidity(day.humidity)} · ${formatWeatherPrecipitation(day.precipitation)}`;
    strip.appendChild(detail);
    strip.title = `${formatWeatherDayLabel(day.date)}: ${condition.label}, ${weatherDayDetail(day)}`;
    return;
  }
  for (const day of summary) {
    const cell = document.createElement('span');
    cell.className = 'annotation-weather-card-day';
    const date = document.createElement('span');
    date.className = 'annotation-weather-card-day-date';
    date.textContent = formatWeatherDayLabel(day.date);
    const condition = weatherCondition(day.weatherCode);
    const temps = document.createElement('span');
    temps.className = 'annotation-weather-card-day-temps';
    temps.textContent = `${formatWeatherTemp(day.tempMax)} ${formatWeatherTemp(day.tempMin)}`;
    cell.appendChild(date);
    cell.appendChild(createWeatherConditionIcon(condition));
    cell.appendChild(temps);
    cell.title = `${date.textContent}: ${condition.label} · ${formatWeatherHumidity(day.humidity)} · ${formatWeatherPrecipitation(day.precipitation)}`;
    strip.appendChild(cell);
  }
}

/** Fetch (and cache per coordinate/date range) the daily forecast for a marker. */
function syncWeatherSummary(
  entry: WeatherSummaryCache,
  feature: AnnotationWeatherPayload,
  render: (summary: WeatherDaySummary[] | null, state: string) => void,
) {
  const [lng, lat] = feature.coordinate;
  const query = { coordinate: { lng, lat }, startDate: feature.date, days: feature.days };
  const key = weatherSummaryKey(query);
  if (entry.summaryKey === key) return;
  entry.summaryKey = key;
  entry.summaryAbort?.abort();
  const controller = new AbortController();
  entry.summaryAbort = controller;
  render(null, 'loading');
  fetchWeatherDailySummary(query, controller.signal)
    .then((summary) => {
      if (controller.signal.aborted) return;
      render(summary, summary ? 'ready' : 'empty');
    })
    .catch(() => {
      if (controller.signal.aborted) return;
      render(null, 'empty');
    });
}

function disposeWeatherSummary(entry: WeatherSummaryCache) {
  entry.summaryAbort?.abort();
  entry.summaryAbort = null;
}

/** Zoomed-out weather line: condition icon plus highs, lows, humidity and rain. */
function renderWeatherLabel(
  entry: Omit<AnnotationWeatherLabelMarker, 'marker'>,
  summary: WeatherDaySummary[] | null,
  state: string,
) {
  entry.element.dataset.state = state;
  entry.icon.replaceChildren();
  if (state !== 'ready' || !summary || summary.length === 0) {
    entry.text.textContent = state === 'loading' ? '…' : '–';
    entry.icon.title = state === 'loading' ? 'Loading forecast' : 'Forecast unavailable';
    entry.icon.appendChild(
      createIconElement(CloudSunIcon, {
        class: 'annotation-weather-label-glyph',
        'aria-hidden': 'true',
        focusable: 'false',
      }),
    );
    return;
  }
  // A range collapses to its first day here; zoom in for the full strip.
  const [day] = summary;
  const condition = weatherCondition(day.weatherCode);
  entry.icon.title = condition.label;
  entry.icon.appendChild(
    createIconElement(condition.icon, {
      class: 'annotation-weather-label-glyph',
      color: condition.color,
      'aria-hidden': 'true',
      focusable: 'false',
    }),
  );
  entry.text.textContent = weatherDayDetail(day);
}

function updateWeatherLabelElement(
  entry: Omit<AnnotationWeatherLabelMarker, 'marker'>,
  feature: AnnotationWeatherPayload,
) {
  const name = weatherAnnotationDisplayName(feature);
  const note = typeof feature.note === 'string' ? feature.note.trim() : '';
  entry.element.dataset.annotationId = feature.id;
  entry.element.style.setProperty('--annotation-weather-color', feature.color || '#0ea5e9');
  entry.element.setAttribute('aria-label', `${name} weather`);
  const heading = note ? `${name}\n${note}` : `${name} — ${weatherAnnotationSummaryLabel(feature)}`;
  // The click-to-expand behaviour is invisible, so the hover tooltip spells it out.
  entry.element.title = `${heading}\nClick for the full forecast`;
  syncWeatherSummary(entry, feature, (summary, state) => renderWeatherLabel(entry, summary, state));
}

function updateWeatherMarker(entry: AnnotationWeatherMarker, feature: AnnotationWeatherPayload) {
  if (entry.kind === 'card') updateWeatherCardElement(entry, feature);
  else updateWeatherLabelElement(entry, feature);
}

/** The card markup only ever exists in the expanded state. */
function updateWeatherCardElement(
  entry: Omit<AnnotationWeatherCardMarker, 'marker'>,
  feature: AnnotationWeatherPayload,
) {
  const name = weatherAnnotationDisplayName(feature);
  const summary = weatherAnnotationSummaryLabel(feature);
  const note = typeof feature.note === 'string' ? feature.note.trim() : '';
  entry.element.dataset.annotationId = feature.id;
  const singleDay = weatherAnnotationDayCount(feature) <= 1;
  entry.element.dataset.days = singleDay ? '1' : 'multi';
  // A one-day card folds the forecast into the title row so it stays a compact
  // chip; longer ranges keep the scrollable strip below the header.
  if (singleDay && entry.strip.parentElement !== entry.detail) {
    entry.detail.appendChild(entry.strip);
  } else if (!singleDay && entry.strip.parentElement !== entry.element) {
    entry.element.insertBefore(entry.strip, entry.body);
  }
  entry.element.style.setProperty('--annotation-weather-color', feature.color || '#0ea5e9');
  entry.element.classList.add('annotation-weather-card-expanded');
  entry.header.setAttribute('aria-expanded', 'true');
  entry.header.title = note ? `${name}\n${note}` : `${name} — ${summary}`;
  entry.title.textContent = name;
  entry.meta.textContent = summary;
  syncWeatherSummary(entry, feature, (days, state) => renderWeatherStrip(entry.strip, days, state));

  const url = weatherCardDashboardUrl(feature);
  if (entry.frame.dataset.weatherUrl !== url) {
    entry.frame.dataset.weatherUrl = url;
    entry.frame.src = url;
  }
  entry.openLink.href = weatherCardExternalUrl(feature);
  entry.body.hidden = false;
}

function syncWeatherCards(
  map: AnnotationMap,
  store: LayerStore,
  markers: Map<string, AnnotationWeatherMarker>,
  viewState: { zoom: number; activeFeatureId: string },
  expandedIds: Set<string>,
  onToggle: (featureId: string) => void,
) {
  const features = visibleWeatherFeatures(store, viewState);
  // Expansion picks the shape: the label collapses, the card is the expanded form.
  const modes = new Map<string, AnnotationWeatherMode>(
    features.map((feature) => [feature.id, expandedIds.has(feature.id) ? 'card' : 'label']),
  );
  // Toggling or a zoom change can swap the forms, so an entry whose kind no
  // longer matches is dropped and rebuilt in the other one.
  for (const [id, entry] of markers) {
    if (modes.get(id) !== entry.kind) {
      disposeWeatherSummary(entry);
      entry.marker.remove();
      markers.delete(id);
    }
  }
  for (const feature of features) {
    const existing = markers.get(feature.id);
    if (existing) {
      updateWeatherMarker(existing, feature);
      existing.marker.setLngLat(feature.coordinate);
      continue;
    }
    if (modes.get(feature.id) === 'card') {
      const card = createWeatherCardElement(map, feature, onToggle);
      const marker = createWeatherMarker(map, card.element, 'bottom', feature.coordinate);
      marker.on('dragend', () => updateWeatherFeatureCoordinate(store, feature.id, marker));
      const entry: AnnotationWeatherCardMarker = { ...card, marker };
      updateWeatherCardElement(entry, feature);
      markers.set(feature.id, entry);
    } else {
      const label = createWeatherLabelElement(map, feature, onToggle);
      const marker = createWeatherMarker(map, label.element, 'left', feature.coordinate);
      marker.on('dragend', () => updateWeatherFeatureCoordinate(store, feature.id, marker));
      const entry: AnnotationWeatherLabelMarker = { ...label, marker };
      updateWeatherLabelElement(entry, feature);
      markers.set(feature.id, entry);
    }
  }
}

function createWeatherMarker(
  map: AnnotationMap,
  element: HTMLElement,
  anchor: 'bottom' | 'left',
  coordinate: [number, number],
): maplibregl.Marker {
  // `setLngLat` has to come first: `addTo` projects the position right away, so
  // attaching a marker with no coordinate throws inside MapLibre and leaves an
  // untracked element behind on every render.
  return new maplibregl.Marker({ element, anchor, draggable: true })
    .setLngLat(coordinate)
    .addTo(map as unknown as maplibregl.Map);
}

function syncPolygonVertexMarkers(
  map: AnnotationMap,
  store: LayerStore,
  markers: Map<string, AnnotationVertexMarker>,
  activeFeatureId: string,
) {
  const feature = activePolygonFeature(store, activeFeatureId);
  const visibleKeys = new Set(feature?.points.map((_point, index) => vertexMarkerKey(feature.id, index)) || []);
  for (const [key, entry] of markers) {
    if (!visibleKeys.has(key)) {
      entry.cleanup();
      entry.marker.remove();
      markers.delete(key);
    }
  }
  if (!feature) return;

  for (const [index, point] of feature.points.entries()) {
    const key = vertexMarkerKey(feature.id, index);
    const existing = markers.get(key);
    if (existing) {
      updatePolygonVertexElement(existing.element, feature, index);
      existing.marker.setLngLat(point);
      continue;
    }
    const element = createPolygonVertexElement(map, feature, index);
    const marker = new maplibregl.Marker({ element, anchor: 'center', draggable: true })
      .setLngLat(point)
      .addTo(map as unknown as maplibregl.Map);
    const cleanup = installPolygonVertexDrag(store, marker, feature.id, index);
    markers.set(key, { marker, element, cleanup });
  }
}

export function installAnnotationRenderer(map: AnnotationMap, store: LayerStore) {
  let disposed = false;
  let currentZoom = map.getZoom();
  let activeFeatureId = '';
  const renderSets = new Map<string, AnnotationRenderLayerSet>();
  const textMarkers = new Map<string, AnnotationTextMarker>();
  const weatherMarkers = new Map<string, AnnotationWeatherMarker>();
  const expandedWeatherCards = new Set<string>();
  const vertexMarkers = new Map<string, AnnotationVertexMarker>();
  const toggleWeatherCard = (featureId: string) => {
    if (expandedWeatherCards.has(featureId)) expandedWeatherCards.delete(featureId);
    else expandedWeatherCards.add(featureId);
    syncTextMarkerView();
  };
  const syncTextMarkerView = () => {
    if (disposed) return;
    currentZoom = map.getZoom();
    syncTextMarkers(map, store, textMarkers, { zoom: currentZoom, activeFeatureId });
    syncWeatherCards(
      map,
      store,
      weatherMarkers,
      { zoom: currentZoom, activeFeatureId },
      expandedWeatherCards,
      toggleWeatherCard,
    );
    syncPolygonVertexMarkers(map, store, vertexMarkers, activeFeatureId);
  };
  const render = () => {
    if (disposed) return;
    runWhenStyleInfrastructureReady(map, () => {
      if (disposed) return;
      const layers = store.getAnnotationLayers();
      const liveLayerIds = new Set(layers.map((layer) => layer.id));
      for (const [layerId, set] of renderSets) {
        if (liveLayerIds.has(layerId)) continue;
        for (const mapLayerId of Object.values(set.layerIds).reverse()) {
          if (map.getLayer(mapLayerId)) map.removeLayer(mapLayerId);
        }
        if (map.getSource(set.sourceId)) map.removeSource(set.sourceId);
        renderSets.delete(layerId);
      }
      for (const layer of layers) {
        const layerId = layer.id;
        ensureAnnotationLayers(map, store, layer);
        const set = annotationRenderLayerSet(layerId);
        renderSets.set(layerId, set);
        asAnnotationSource(map.getSource(set.sourceId))?.setData(
          store.getLayerGeoJson(layerId, { includeHidden: false }),
        );
      }
      syncTextMarkerView();
    });
  };
  const handleZoom = () => syncTextMarkerView();
  const handleActiveFeatureChange = (event: Event) => {
    const detail = (event as CustomEvent<AnnotationActiveFeatureDetail>).detail;
    const nextId = typeof detail?.activeId === 'string' ? detail.activeId : '';
    if (activeFeatureId === nextId) return;
    activeFeatureId = nextId;
    syncTextMarkerView();
  };
  const unsubscribe = store.subscribe(render);
  map.on?.('zoom', handleZoom);
  map.getContainer().addEventListener(ANNOTATION_ACTIVE_FEATURE_EVENT, handleActiveFeatureChange);
  render();
  return {
    destroy() {
      disposed = true;
      unsubscribe();
      map.off?.('zoom', handleZoom);
      map.getContainer().removeEventListener(ANNOTATION_ACTIVE_FEATURE_EVENT, handleActiveFeatureChange);
      for (const set of renderSets.values()) {
        for (const layerId of Object.values(set.layerIds).reverse()) {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
        }
        if (map.getSource(set.sourceId)) map.removeSource(set.sourceId);
      }
      renderSets.clear();
      for (const entry of textMarkers.values()) entry.marker.remove();
      textMarkers.clear();
      for (const entry of weatherMarkers.values()) {
        disposeWeatherSummary(entry);
        entry.marker.remove();
      }
      weatherMarkers.clear();
      expandedWeatherCards.clear();
      for (const entry of vertexMarkers.values()) {
        entry.cleanup();
        entry.marker.remove();
      }
      vertexMarkers.clear();
    },
  };
}
