import maplibregl from 'maplibre-gl';
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
import { runWhenStyleInfrastructureReady } from './style-ready.js';
import type { AnnotationFeaturePayload, AnnotationTextPayload } from './annotation-model.js';
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

  if (!map.getLayer(layerIds.lineLabels)) {
    map.addLayer({
      id: layerIds.lineLabels,
      type: 'symbol',
      source: sourceId,
      filter: [
        'all',
        kindFilter(['annotation_path', 'annotation_route']),
        ['any', ['has', 'name'], ['has', 'description']],
      ],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name'], ['get', 'description'], ''],
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
      filter: ['all', ['==', ['get', 'kind'], 'annotation_polygon'], ['any', ['has', 'name'], ['has', 'description']]],
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'description'], ''],
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
        'text-field': ['coalesce', ['get', 'name'], ['get', 'description'], 'Note'],
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
  if (body) body.textContent = textMarkerBody(feature);
}

function updateTextFeatureCoordinate(store: LayerStore, featureId: string, marker: maplibregl.Marker) {
  const feature = store.getAnnotationFeaturePayload(featureId);
  if (feature?.type !== 'text') return;
  const lngLat = marker.getLngLat();
  const coordinate = sanitizeLngLat([lngLat.lng, lngLat.lat]);
  if (!coordinate) return;
  const [lng, lat] = coordinate;
  if (feature.coordinate[0] === lng && feature.coordinate[1] === lat) return;
  store.upsertFeature({
    ...feature,
    coordinate,
    updatedAt: Date.now(),
  });
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
    store.upsertFeature({
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

export function installAnnotationRenderer(map: AnnotationMap, store: LayerStore) {
  let disposed = false;
  let currentZoom = map.getZoom();
  let activeFeatureId = '';
  const renderSets = new Map<string, AnnotationRenderLayerSet>();
  const textMarkers = new Map<string, AnnotationTextMarker>();
  const syncTextMarkerView = () => {
    if (disposed) return;
    currentZoom = map.getZoom();
    syncTextMarkers(map, store, textMarkers, { zoom: currentZoom, activeFeatureId });
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
    },
  };
}
