import maplibregl from 'maplibre-gl';
import {
  DRAWING_SOURCE_ID,
  DRAWING_TEXT_MAX_HEIGHT,
  DRAWING_TEXT_MAX_WIDTH,
  DRAWING_TEXT_MIN_HEIGHT,
  DRAWING_TEXT_MIN_WIDTH,
  sanitizeDrawingTextHeight,
  sanitizeDrawingTextWidth,
  sanitizeLngLat,
} from './drawing-model.js';
import { runWhenStyleInfrastructureReady } from './style-ready.js';
import type { DrawingFeature, DrawingTextFeature } from './drawing-model.js';
import type { DrawingStore } from './drawing-store.js';

export const DRAWING_LAYER_IDS = {
  polygonFill: 'drawing-plan-polygon-fill',
  polygonOutline: 'drawing-plan-polygon-outline',
  lineStroke: 'drawing-plan-line-stroke',
  line: 'drawing-plan-line',
  lineLabels: 'drawing-plan-line-labels',
  polygonLabels: 'drawing-plan-polygon-labels',
  points: 'drawing-plan-points',
  text: 'drawing-plan-text',
  textLabels: 'drawing-plan-text-labels',
  labels: 'drawing-plan-labels',
  arrows: 'drawing-plan-arrows',
} as const;
const DRAWING_ARROW_ICON = 'drawing-direction-arrow-v2';
const TEXT_NOTE_COMPACT_LABEL_MIN_ZOOM = 7;
const TEXT_NOTE_FULL_MIN_ZOOM = 11;
const DRAWING_ACTIVE_FEATURE_EVENT = 'drawing:activefeaturechange';

type DrawingSource = {
  setData(data: object): void;
};
type DrawingMap = {
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

type DrawingTextMarker = {
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
  nextCoordinate: DrawingTextFeature['coordinate'];
  nextWidth: number;
  nextHeight: number;
  wasDraggable: boolean;
};
type DrawingActiveFeatureDetail = {
  activeId?: unknown;
  selectedId?: unknown;
  editingId?: unknown;
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

  if (!map.getLayer(DRAWING_LAYER_IDS.lineLabels)) {
    map.addLayer({
      id: DRAWING_LAYER_IDS.lineLabels,
      type: 'symbol',
      source: DRAWING_SOURCE_ID,
      filter: ['all', kindFilter(['drawing_path', 'drawing_route']), ['any', ['has', 'name'], ['has', 'description']]],
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

  if (!map.getLayer(DRAWING_LAYER_IDS.polygonLabels)) {
    map.addLayer({
      id: DRAWING_LAYER_IDS.polygonLabels,
      type: 'symbol',
      source: DRAWING_SOURCE_ID,
      filter: ['all', ['==', ['get', 'kind'], 'drawing_polygon'], ['any', ['has', 'name'], ['has', 'description']]],
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

  if (!map.getLayer(DRAWING_LAYER_IDS.text)) {
    map.addLayer({
      id: DRAWING_LAYER_IDS.text,
      type: 'circle',
      source: DRAWING_SOURCE_ID,
      maxzoom: TEXT_NOTE_FULL_MIN_ZOOM,
      filter: ['==', ['get', 'kind'], 'drawing_text'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 3.5, 7, 4.75, 10.9, 6],
        'circle-color': ['coalesce', ['get', 'color'], '#2563eb'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': 0.92,
      },
    });
  }

  if (!map.getLayer(DRAWING_LAYER_IDS.textLabels)) {
    map.addLayer({
      id: DRAWING_LAYER_IDS.textLabels,
      type: 'symbol',
      source: DRAWING_SOURCE_ID,
      minzoom: TEXT_NOTE_COMPACT_LABEL_MIN_ZOOM,
      maxzoom: TEXT_NOTE_FULL_MIN_ZOOM,
      filter: ['==', ['get', 'kind'], 'drawing_text'],
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

  if (!map.getLayer(DRAWING_LAYER_IDS.labels)) {
    map.addLayer({
      id: DRAWING_LAYER_IDS.labels,
      type: 'symbol',
      source: DRAWING_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'drawing_point'],
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

function visibleTextFeatures(
  store: DrawingStore,
  { zoom, activeFeatureId }: { zoom: number; activeFeatureId: string },
) {
  const doc = store.getDoc();
  const showAllFullNotes = zoom >= TEXT_NOTE_FULL_MIN_ZOOM;
  return doc.featureOrder
    .map((id) => doc.features[id])
    .filter((feature): feature is DrawingTextFeature => {
      return Boolean(
        feature?.type === 'text' &&
        doc.layers[feature.layerId]?.visible !== false &&
        (showAllFullNotes || feature.id === activeFeatureId),
      );
    });
}

function textMarkerBody(feature: DrawingTextFeature) {
  return feature.note || feature.label || 'Note';
}

function markerFeatureEvent(type: 'drawing:featureclick' | 'drawing:featuredblclick', feature: DrawingFeature) {
  return new CustomEvent(type, { detail: { id: feature.id } });
}

function textFeatureSize(feature: DrawingTextFeature) {
  return {
    width: sanitizeDrawingTextWidth(feature.width),
    height: sanitizeDrawingTextHeight(feature.height),
  };
}

function pointerPoint(map: DrawingMap, event: PointerEvent): ScreenPoint {
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

function createTextMarkerElement(map: DrawingMap, feature: DrawingTextFeature, activeFeatureId: string) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'drawing-text-note';
  element.dataset.drawingId = feature.id;
  element.style.setProperty('--drawing-note-color', feature.color || '#2563eb');
  element.title = feature.label || 'Note';
  element.setAttribute('aria-label', feature.label || 'Note');
  stopTextMarkerPropagation(element);
  element.addEventListener('click', () => {
    map.getContainer().dispatchEvent(markerFeatureEvent('drawing:featureclick', feature));
  });
  element.addEventListener('dblclick', () => {
    map.getContainer().dispatchEvent(markerFeatureEvent('drawing:featuredblclick', feature));
  });
  const title = document.createElement('div');
  title.className = 'drawing-text-note-title';
  element.appendChild(title);
  const body = document.createElement('div');
  body.className = 'drawing-text-note-body';
  element.appendChild(body);
  for (const corner of ['nw', 'ne', 'se', 'sw'] as const) {
    const handle = document.createElement('span');
    handle.className = `drawing-text-note-resize-handle drawing-text-note-resize-${corner}`;
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

function updateTextMarkerElement(element: HTMLElement, feature: DrawingTextFeature, activeFeatureId: string) {
  const { width, height } = textFeatureSize(feature);
  element.dataset.drawingId = feature.id;
  element.style.setProperty('--drawing-note-color', feature.color || '#2563eb');
  applyTextMarkerSize(element, width, height);
  element.classList.toggle('drawing-text-note-active', feature.id === activeFeatureId);
  element.title = feature.label || 'Note';
  element.setAttribute('aria-label', feature.label || 'Note');
  const title = element.querySelector<HTMLElement>('.drawing-text-note-title');
  const body = element.querySelector<HTMLElement>('.drawing-text-note-body');
  if (title) title.textContent = feature.label || 'Note';
  if (body) body.textContent = textMarkerBody(feature);
}

function updateTextFeatureCoordinate(store: DrawingStore, featureId: string, marker: maplibregl.Marker) {
  const feature = store.getDoc().features[featureId];
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
  map: DrawingMap,
  state: TextResizeState,
  event: PointerEvent,
): { coordinate: DrawingTextFeature['coordinate']; width: number; height: number } | null {
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
    DRAWING_TEXT_MIN_WIDTH,
    DRAWING_TEXT_MAX_WIDTH,
  );
  const edgeY = clampResizeEdge(
    dragged.y,
    state.opposite.y,
    directionY,
    DRAWING_TEXT_MIN_HEIGHT,
    DRAWING_TEXT_MAX_HEIGHT,
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
  map: DrawingMap,
  store: DrawingStore,
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
    const feature = store.getDoc().features[featureId];
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
    element.classList.add('drawing-text-note-resizing');
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
    state.element.classList.remove('drawing-text-note-resizing');
    state.marker.setDraggable(state.wasDraggable);
    resizeState = null;

    const feature = store.getDoc().features[state.featureId];
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

  for (const handle of element.querySelectorAll<HTMLElement>('.drawing-text-note-resize-handle')) {
    handle.addEventListener('pointerdown', beginResize);
    handle.addEventListener('pointermove', moveResize);
    handle.addEventListener('pointerup', finishResize);
    handle.addEventListener('pointercancel', finishResize);
  }
}

function syncTextMarkers(
  map: DrawingMap,
  store: DrawingStore,
  markers: Map<string, DrawingTextMarker>,
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

export function installDrawingRenderer(map: DrawingMap, store: DrawingStore) {
  let disposed = false;
  let currentZoom = map.getZoom();
  let activeFeatureId = '';
  const textMarkers = new Map<string, DrawingTextMarker>();
  const syncTextMarkerView = () => {
    if (disposed) return;
    currentZoom = map.getZoom();
    syncTextMarkers(map, store, textMarkers, { zoom: currentZoom, activeFeatureId });
  };
  const render = () => {
    if (disposed) return;
    runWhenStyleInfrastructureReady(map, () => {
      if (disposed) return;
      ensureDrawingLayers(map, store);
      asDrawingSource(map.getSource(DRAWING_SOURCE_ID))?.setData(store.getGeoJson());
      syncTextMarkerView();
    });
  };
  const handleZoom = () => syncTextMarkerView();
  const handleActiveFeatureChange = (event: Event) => {
    const detail = (event as CustomEvent<DrawingActiveFeatureDetail>).detail;
    const nextId = typeof detail?.activeId === 'string' ? detail.activeId : '';
    if (activeFeatureId === nextId) return;
    activeFeatureId = nextId;
    syncTextMarkerView();
  };
  const unsubscribe = store.subscribe(render);
  map.on?.('zoom', handleZoom);
  map.getContainer().addEventListener(DRAWING_ACTIVE_FEATURE_EVENT, handleActiveFeatureChange);
  render();
  return {
    destroy() {
      disposed = true;
      unsubscribe();
      map.off?.('zoom', handleZoom);
      map.getContainer().removeEventListener(DRAWING_ACTIVE_FEATURE_EVENT, handleActiveFeatureChange);
      for (const layerId of Object.values(DRAWING_LAYER_IDS).reverse()) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      }
      for (const entry of textMarkers.values()) entry.marker.remove();
      textMarkers.clear();
      if (map.getSource(DRAWING_SOURCE_ID)) map.removeSource(DRAWING_SOURCE_ID);
    },
  };
}
