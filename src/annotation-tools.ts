import createIconElement from 'lucide/dist/esm/createElement.mjs';
import CheckIcon from 'lucide/dist/esm/icons/check.mjs';
import MapPinIcon from 'lucide/dist/esm/icons/map-pin.mjs';
import MousePointerIcon from 'lucide/dist/esm/icons/mouse-pointer-2.mjs';
import PenLineIcon from 'lucide/dist/esm/icons/pen-line.mjs';
import PencilIcon from 'lucide/dist/esm/icons/pencil.mjs';
import PentagonIcon from 'lucide/dist/esm/icons/pentagon.mjs';
import RouteIcon from 'lucide/dist/esm/icons/route.mjs';
import TrashIcon from 'lucide/dist/esm/icons/trash-2.mjs';
import TypeIcon from 'lucide/dist/esm/icons/type.mjs';
import UndoIcon from 'lucide/dist/esm/icons/undo-2.mjs';
import XIcon from 'lucide/dist/esm/icons/x.mjs';
import maplibregl from 'maplibre-gl';
import { canSubmitAnnotationDraft, resolveAnnotationDraftCompletion } from './annotation-draft.js';
import { defaultAnnotationFeatureLabel } from './annotation-labels.js';
import {
  ANNOTATION_DEFAULT_LAYER_ID,
  ANNOTATION_SOURCE_ID,
  ANNOTATION_TEXT_DEFAULT_HEIGHT,
  ANNOTATION_TEXT_DEFAULT_WIDTH,
  sanitizeAnnotationFillOpacity,
  sanitizeAnnotationLineStyle,
  sanitizeAnnotationOpacity,
  createAnnotationId,
  sanitizeAnnotationText,
} from './annotation-model.js';
import { buildRouteUrl, formatDistance, formatDuration, normalizeEndpoint } from './routing.js';
import { runWhenStyleInfrastructureReady } from './style-ready.js';
import { emitUiPanelOpen, isOtherUiPanelOpen, UI_PANEL_OPEN_EVENT } from './ui-panels.js';
import {
  collaborationCanEdit,
  COLLABORATION_ACCESS_EVENT,
  type CollaborationAccessDetail,
} from './collaboration-permissions.js';
import type { AnnotationDraftMode } from './annotation-draft.js';
import type {
  AnnotationFeaturePayload,
  AnnotationLineStyle,
  AnnotationRouteProfile,
  LngLatTuple,
} from './annotation-model.js';
import type { LayerStore } from './layer-store.js';
import type { OsrmRouteResponse } from './routing.js';

const ANNOTATION_PICKER_DATASET_KEY = 'annotationPickerActive';
const ANNOTATION_ENDPOINT_KEY = 'orm-annotation-osrm-endpoint';
const ANNOTATION_ACTIVE_FEATURE_EVENT = 'annotation:activefeaturechange';
const ANNOTATION_ACTIVE_LAYER_EVENT = 'annotation:activelayerchange';
const DEFAULT_COLOR = '#2563eb';
const DEFAULT_LINE_STYLE: AnnotationLineStyle = 'solid';
const DEFAULT_LINE_OPACITY = 0.95;
const DEFAULT_FILL_OPACITY = 0.22;
const COLOR_SWATCHES = ['#2563eb', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#7c3aed', '#db2777'];

type LngLatLike = { lng: number; lat: number };
type AnnotationMode = 'select' | 'point' | 'text' | 'path' | 'polygon' | 'route';
type AnnotationMapClickEvent = {
  lngLat: LngLatLike;
  point: unknown;
  preventDefault?: () => void;
  originalEvent?: Event & { annotationHandled?: boolean };
};
type AnnotationMapDblClickEvent = AnnotationMapClickEvent;
type RenderedFeatureLike = {
  source?: string;
  properties?: Record<string, unknown>;
};
type AnnotationFeaturePayloadEventDetail = {
  id?: unknown;
};
type AnnotationLayerEventDetail = {
  layerId?: unknown;
};
type AnnotationSource = {
  setData(data: object): void;
};
type AnnotationControl = {
  onAdd(map: AnnotationMap): HTMLElement;
  onRemove(): void;
};
type AnnotationMap = {
  _styleInitialized?: boolean;
  _styleInfrastructureInitialized?: boolean;
  style?: { _loaded?: boolean };
  isStyleLoaded(): boolean | void;
  setGlobalStateProperty(propertyName: string, value: unknown): void;
  once(event: 'load' | 'style.load', callback: () => void): void;
  on(event: 'load', handler: () => void): void;
  on(event: 'style.load', handler: () => void): void;
  off(event: 'load', handler: () => void): void;
  off(event: 'style.load', handler: () => void): void;
  addControl(control: AnnotationControl, position?: string): void;
  getContainer(): HTMLElement;
  on(event: 'click', handler: (event: AnnotationMapClickEvent) => void): void;
  on(event: 'dblclick', handler: (event: AnnotationMapDblClickEvent) => void): void;
  off(event: 'click', handler: (event: AnnotationMapClickEvent) => void): void;
  off(event: 'dblclick', handler: (event: AnnotationMapDblClickEvent) => void): void;
  addSource(id: string, source: object): void;
  addLayer(layer: object): void;
  getSource(id: string): unknown;
  getLayer(id: string): object | undefined;
  removeLayer(id: string): void;
  removeSource(id: string): void;
  queryRenderedFeatures(point: unknown): RenderedFeatureLike[];
};

function el<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  parent?: Element,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function appendIcon(parent: Element, icon: LucideIcon, className = 'annotation-icon') {
  const svg = createIconElement(icon, {
    class: className,
    'aria-hidden': 'true',
    focusable: 'false',
  });
  parent.appendChild(svg);
  return svg;
}

function appendIconLabel(parent: Element, icon: LucideIcon, label: string) {
  appendIcon(parent, icon);
  const labelNode = el('span', 'annotation-action-label', parent);
  labelNode.textContent = label;
  return labelNode;
}

function stopMapControlPropagation(node: Element) {
  node.addEventListener('contextmenu', (event: Event) => event.stopPropagation());
  node.addEventListener('click', (event: Event) => event.stopPropagation());
  node.addEventListener('dblclick', (event: Event) => event.stopPropagation());
  node.addEventListener('mousedown', (event: Event) => event.stopPropagation());
  node.addEventListener('touchstart', (event: Event) => event.stopPropagation(), { passive: true });
  node.addEventListener('wheel', (event: Event) => event.stopPropagation(), { passive: true });
}

function safeGetStorage(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function safeSetStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore private browsing and disabled storage.
  }
}

function asLngLatTuple(point: LngLatLike): LngLatTuple {
  return [Number(point.lng.toFixed(6)), Number(point.lat.toFixed(6))];
}

function lngLatObject(point: LngLatTuple) {
  return { lng: point[0], lat: point[1] };
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] as object[] };
}

function lineFeature(points: LngLatTuple[], color: string, lineStyle: AnnotationLineStyle) {
  return {
    type: 'Feature',
    properties: { color, line_style: lineStyle, 'line-width': 4 },
    geometry: { type: 'LineString', coordinates: points },
  };
}

function closedRing(points: LngLatTuple[]) {
  const ring = points.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first);
  return ring;
}

function polygonFeature(points: LngLatTuple[], color: string, fillOpacity: number) {
  return {
    type: 'Feature',
    properties: { color, fill_opacity: fillOpacity },
    geometry: { type: 'Polygon', coordinates: [closedRing(points)] },
  };
}

function featureIdFromRendered(feature: RenderedFeatureLike) {
  const source = String(feature?.source || '');
  const id = feature?.properties?.annotation_id;
  return source.startsWith(ANNOTATION_SOURCE_ID) && typeof id === 'string' ? id : '';
}

function asAnnotationSource(source: unknown): AnnotationSource | null {
  return source && typeof (source as AnnotationSource).setData === 'function' ? (source as AnnotationSource) : null;
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

function isAnnotationDraftMode(mode: AnnotationMode): mode is AnnotationDraftMode {
  return mode === 'path' || mode === 'polygon' || mode === 'route';
}

export function isAnnotationPickerInteractionActive({
  expanded,
  layerVisible,
  annotationReady,
  canEdit = true,
  mode,
}: {
  expanded: boolean;
  layerVisible: boolean;
  annotationReady: boolean;
  canEdit?: boolean;
  mode: string;
}) {
  return Boolean(canEdit && expanded && layerVisible && annotationReady && mode !== 'select');
}

function profileFromValue(value: string): AnnotationRouteProfile {
  if (value === 'walking' || value === 'cycling') return value;
  return 'driving';
}

function osrmWaypointName(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  return sanitizeAnnotationText((value as { name?: unknown }).name, 48);
}

function coordinateAt(points: LngLatTuple[], fraction: number): LngLatTuple {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0];
  const index = Math.min(points.length - 2, Math.max(0, Math.floor((points.length - 1) * fraction)));
  const start = points[index];
  const end = points[index + 1];
  return [Number(((start[0] + end[0]) / 2).toFixed(6)), Number(((start[1] + end[1]) / 2).toFixed(6))];
}

function averageCoordinate(points: LngLatTuple[]): LngLatTuple {
  const total = points.reduce(
    (acc, point) => {
      acc[0] += point[0];
      acc[1] += point[1];
      return acc;
    },
    [0, 0] as LngLatTuple,
  );
  const count = Math.max(1, points.length);
  return [Number((total[0] / count).toFixed(6)), Number((total[1] / count).toFixed(6))];
}

function featureAnchor(feature: AnnotationFeaturePayload): LngLatTuple {
  if (feature.type === 'point' || feature.type === 'text') return feature.coordinate;
  if (feature.type === 'polygon') return averageCoordinate(feature.points);
  return coordinateAt(feature.type === 'route' ? feature.geometry : feature.points, 0.5);
}

function annotationTypeLabel(feature: AnnotationFeaturePayload) {
  if (feature.type === 'point') return 'Marker';
  if (feature.type === 'text') return 'Text';
  if (feature.type === 'path') return 'Line';
  if (feature.type === 'polygon') return 'Area';
  return 'Route';
}

class AnnotationToolsControl {
  _store: LayerStore;
  _map: AnnotationMap;
  _control: HTMLElement;
  _button: HTMLButtonElement;
  _panel: HTMLElement;
  _title: HTMLElement;
  _summary: HTMLElement;
  _closeButton: HTMLButtonElement;
  _modeButtons: Record<AnnotationMode, HTMLButtonElement>;
  _layerSelect: HTMLSelectElement;
  _labelInput: HTMLInputElement;
  _noteInput: HTMLTextAreaElement;
  _colorSwatches: HTMLElement;
  _customColor: HTMLInputElement;
  _directedInput: HTMLInputElement;
  _lineStyleSelect: HTMLSelectElement;
  _opacityInput: HTMLInputElement;
  _opacityValue: HTMLElement;
  _fillOpacityInput: HTMLInputElement;
  _fillOpacityValue: HTMLElement;
  _profileSelect: HTMLSelectElement;
  _endpointInput: HTMLInputElement;
  _undoButton: HTMLButtonElement;
  _doneButton: HTMLButtonElement;
  _deleteButton: HTMLButtonElement;
  _status: HTMLElement;
  _selectHint: HTMLElement;
  _lineControls: HTMLElement;
  _editorPopup: maplibregl.Popup | null = null;
  _editorFeatureId = '';
  _editorLabelInput: HTMLInputElement | null = null;
  _editorNoteInput: HTMLTextAreaElement | null = null;
  _editorColorInput: HTMLInputElement | null = null;
  _editorDirectedInput: HTMLInputElement | null = null;
  _editorLineStyleSelect: HTMLSelectElement | null = null;
  _editorOpacityInput: HTMLInputElement | null = null;
  _editorFillOpacityInput: HTMLInputElement | null = null;
  _editorSwatches: HTMLElement | null = null;
  _expanded = false;
  _mode: AnnotationMode = 'select';
  _activeLayerId = ANNOTATION_DEFAULT_LAYER_ID;
  _selectedId = '';
  _editingId = '';
  _lastActiveFeatureId = '';
  _draftPoints: LngLatTuple[] = [];
  _isRouting = false;
  _annotationReady = false;
  _color = DEFAULT_COLOR;
  _lineStyle: AnnotationLineStyle = DEFAULT_LINE_STYLE;
  _opacity = DEFAULT_LINE_OPACITY;
  _fillOpacity = DEFAULT_FILL_OPACITY;
  _abortController: AbortController | null = null;
  _canEdit = true;
  _boundMapClick: (event: AnnotationMapClickEvent) => void;
  _boundMapDblClick: (event: AnnotationMapDblClickEvent) => void;
  _boundFeatureClick: (event: Event) => void;
  _boundFeatureDblClick: (event: Event) => void;
  _boundKeydown: (event: KeyboardEvent) => void;
  _boundAccessChange: (event: Event) => void;
  _boundOverlayPanelOpen: () => void;
  _boundRoutingPanelOpen: () => void;
  _boundAnnotationOpen: (event: Event) => void;
  _boundActiveLayerChange: (event: Event) => void;
  _boundAnyPanelOpen: (event: Event) => void;
  _unsubscribeStore: (() => void) | null = null;

  constructor(store: LayerStore) {
    this._store = store;
    this._modeButtons = {} as Record<AnnotationMode, HTMLButtonElement>;
    this._boundMapClick = (event) => this._handleMapClick(event);
    this._boundMapDblClick = (event) => this._handleMapDblClick(event);
    this._boundFeatureClick = (event) => this._handleFeatureClick(event);
    this._boundFeatureDblClick = (event) => this._handleFeatureDblClick(event);
    this._boundKeydown = (event) => this._handleKeydown(event);
    this._boundAccessChange = (event) => {
      const detail = (event as CustomEvent<CollaborationAccessDetail>).detail;
      this._setCanEdit(detail?.canEdit !== false);
    };
    this._boundOverlayPanelOpen = () => this.setExpanded(false);
    this._boundRoutingPanelOpen = () => this.setExpanded(false);
    this._boundAnnotationOpen = (event) => {
      const layerId = (event as CustomEvent<AnnotationLayerEventDetail>).detail?.layerId;
      if (typeof layerId === 'string') this._setActiveLayer(layerId, { emit: false });
      this.setExpanded(true);
    };
    this._boundActiveLayerChange = (event) => {
      const layerId = (event as CustomEvent<AnnotationLayerEventDetail>).detail?.layerId;
      if (typeof layerId === 'string') this._setActiveLayer(layerId, { emit: false });
    };
    this._boundAnyPanelOpen = (event) => {
      if (isOtherUiPanelOpen(event, 'annotations')) this.setExpanded(false);
    };
  }

  onAdd(map: AnnotationMap) {
    this._map = map;
    this._control = el('div', 'maplibregl-ctrl maplibregl-ctrl-group annotation-control');
    this._button = el('button', 'maplibregl-ctrl-annotation', this._control);
    this._button.type = 'button';
    this._button.title = 'Annotations';
    this._button.setAttribute('aria-label', 'Annotations');
    this._button.setAttribute('aria-expanded', 'false');
    appendIcon(this._button, PencilIcon);
    this._button.addEventListener('click', () => this.setExpanded(!this._expanded));

    this._panel = el('section', 'annotation-panel', map.getContainer());
    this._panel.setAttribute('aria-label', 'Annotations');
    this._panel.setAttribute('aria-hidden', 'true');
    stopMapControlPropagation(this._panel);

    const header = el('div', 'annotation-header', this._panel);
    const titleWrap = el('div', 'annotation-title-wrap', header);
    this._title = el('div', 'annotation-title', titleWrap);
    this._title.textContent = 'Annotations';
    this._summary = el('div', 'annotation-summary', titleWrap);

    this._closeButton = el('button', 'annotation-close', header);
    this._closeButton.type = 'button';
    this._closeButton.title = 'Close annotations';
    this._closeButton.setAttribute('aria-label', 'Close annotations');
    appendIcon(this._closeButton, XIcon);
    this._closeButton.addEventListener('click', () => this.setExpanded(false));

    const body = el('div', 'annotation-body', this._panel);

    const modes = el('div', 'annotation-mode-grid', body);
    this._appendModeButton(modes, 'select', MousePointerIcon, 'Select');
    this._appendModeButton(modes, 'point', MapPinIcon, 'Marker');
    this._appendModeButton(modes, 'text', TypeIcon, 'Text');
    this._appendModeButton(modes, 'path', PenLineIcon, 'Line');
    this._appendModeButton(modes, 'polygon', PentagonIcon, 'Area');
    this._appendModeButton(modes, 'route', RouteIcon, 'Route');

    const layerField = el('label', 'annotation-field annotation-layer-field', body);
    const layerLabel = el('span', 'annotation-field-label', layerField);
    layerLabel.textContent = 'Layer';
    this._layerSelect = el('select', 'annotation-input', layerField);
    this._layerSelect.addEventListener('change', () => this._setActiveLayer(this._layerSelect.value));

    this._selectHint = el('div', 'annotation-select-hint', body);
    this._selectHint.textContent = 'Tap an annotation on the map to edit it';

    const labelField = el('label', 'annotation-field', body);
    const labelLabel = el('span', 'annotation-field-label', labelField);
    labelLabel.textContent = 'Label';
    this._labelInput = el('input', 'annotation-input', labelField);
    this._labelInput.type = 'text';
    this._labelInput.maxLength = 120;
    this._labelInput.placeholder = 'Hotel, day 1, lunch...';
    this._labelInput.addEventListener('input', () => this._updateSelectedFromForm());

    const noteField = el('label', 'annotation-field', body);
    const noteLabel = el('span', 'annotation-field-label', noteField);
    noteLabel.textContent = 'Note';
    this._noteInput = el('textarea', 'annotation-note', noteField);
    this._noteInput.maxLength = 1200;
    this._noteInput.rows = 3;
    this._noteInput.addEventListener('input', () => this._updateSelectedFromForm());

    const styleField = el('div', 'annotation-field', body);
    const styleLabel = el('span', 'annotation-field-label', styleField);
    styleLabel.textContent = 'Color';
    this._colorSwatches = el('div', 'annotation-swatches', styleField);
    for (const color of COLOR_SWATCHES) {
      const swatch = el('button', 'annotation-swatch', this._colorSwatches);
      swatch.type = 'button';
      swatch.title = color;
      swatch.style.backgroundColor = color;
      swatch.dataset.color = color;
      swatch.addEventListener('click', () => this._setColor(color));
    }
    this._customColor = el('input', 'annotation-color-input', styleField);
    this._customColor.type = 'color';
    this._customColor.value = this._color;
    this._customColor.addEventListener('input', () => this._setColor(this._customColor.value));

    this._lineControls = el('div', 'annotation-line-controls', body);

    const lineStyleField = el('label', 'annotation-field annotation-line-style-field', this._lineControls);
    const lineStyleLabel = el('span', 'annotation-field-label', lineStyleField);
    lineStyleLabel.textContent = 'Line style';
    this._lineStyleSelect = el('select', 'annotation-input', lineStyleField);
    for (const [value, label] of [
      ['solid', 'Solid'],
      ['dashed', 'Dashed'],
      ['dotted', 'Dotted'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      this._lineStyleSelect.appendChild(option);
    }
    this._lineStyleSelect.value = this._lineStyle;
    this._lineStyleSelect.addEventListener('change', () => this._setLineStyle(this._lineStyleSelect.value));

    const opacityField = el('label', 'annotation-field annotation-opacity-field', this._lineControls);
    const opacityHeader = el('span', 'annotation-field-row', opacityField);
    const opacityLabel = el('span', 'annotation-field-label', opacityHeader);
    opacityLabel.textContent = 'Opacity';
    this._opacityValue = el('span', 'annotation-value', opacityHeader);
    this._opacityInput = el('input', 'annotation-range', opacityField);
    this._opacityInput.type = 'range';
    this._opacityInput.min = '5';
    this._opacityInput.max = '100';
    this._opacityInput.step = '5';
    this._opacityInput.value = String(Math.round(this._opacity * 100));
    this._opacityInput.addEventListener('input', () => this._setOpacity(Number(this._opacityInput.value) / 100));

    const fillOpacityField = el('label', 'annotation-field annotation-fill-opacity-field', this._lineControls);
    const fillOpacityHeader = el('span', 'annotation-field-row', fillOpacityField);
    const fillOpacityLabel = el('span', 'annotation-field-label', fillOpacityHeader);
    fillOpacityLabel.textContent = 'Fill';
    this._fillOpacityValue = el('span', 'annotation-value', fillOpacityHeader);
    this._fillOpacityInput = el('input', 'annotation-range', fillOpacityField);
    this._fillOpacityInput.type = 'range';
    this._fillOpacityInput.min = '5';
    this._fillOpacityInput.max = '100';
    this._fillOpacityInput.step = '5';
    this._fillOpacityInput.value = String(Math.round(this._fillOpacity * 100));
    this._fillOpacityInput.addEventListener('input', () =>
      this._setFillOpacity(Number(this._fillOpacityInput.value) / 100),
    );

    const directedField = el('label', 'annotation-check-field', this._lineControls);
    this._directedInput = el('input', undefined, directedField);
    this._directedInput.type = 'checkbox';
    this._directedInput.checked = true;
    const directedLabel = el('span', undefined, directedField);
    directedLabel.textContent = 'Directed';
    this._directedInput.addEventListener('change', () => this._updateSelectedFromForm());

    const profileField = el('label', 'annotation-field annotation-profile-field', this._lineControls);
    const profileLabel = el('span', 'annotation-field-label', profileField);
    profileLabel.textContent = 'Profile';
    this._profileSelect = el('select', 'annotation-input', profileField);
    for (const [value, label] of [
      ['driving', 'Driving'],
      ['walking', 'Walking'],
      ['cycling', 'Cycling'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      this._profileSelect.appendChild(option);
    }
    this._profileSelect.addEventListener('change', () => this._updateSelectedFromForm());

    const endpointField = el('label', 'annotation-field annotation-endpoint-field', body);
    const endpointLabel = el('span', 'annotation-field-label', endpointField);
    endpointLabel.textContent = 'Routing endpoint';
    this._endpointInput = el('input', 'annotation-input', endpointField);
    this._endpointInput.type = 'url';
    this._endpointInput.autocomplete = 'off';
    this._endpointInput.spellcheck = false;
    this._endpointInput.value = safeGetStorage(ANNOTATION_ENDPOINT_KEY, 'https://router.project-osrm.org');
    this._endpointInput.addEventListener('change', () => {
      const endpoint = normalizeEndpoint(this._endpointInput.value);
      this._endpointInput.value = endpoint;
      safeSetStorage(ANNOTATION_ENDPOINT_KEY, endpoint);
    });

    const actions = el('div', 'annotation-actions', body);
    this._undoButton = el('button', 'annotation-action', actions);
    this._undoButton.type = 'button';
    appendIconLabel(this._undoButton, UndoIcon, 'Undo');
    this._undoButton.addEventListener('click', () => this._undoDraftPoint());

    this._doneButton = el('button', 'annotation-action annotation-action-primary', actions);
    this._doneButton.type = 'button';
    appendIconLabel(this._doneButton, CheckIcon, 'Done');
    this._doneButton.addEventListener('click', () => this._finishDraftLine());

    this._deleteButton = el('button', 'annotation-action annotation-danger', actions);
    this._deleteButton.type = 'button';
    appendIconLabel(this._deleteButton, TrashIcon, 'Delete');
    this._deleteButton.addEventListener('click', () => this._deleteSelected());

    this._status = el('div', 'annotation-status', body);
    this._status.setAttribute('role', 'status');
    this._status.setAttribute('aria-live', 'polite');

    this._installDraftLayer();
    this._unsubscribeStore = this._store.subscribe(() => this._sync());
    map.on('click', this._boundMapClick);
    map.on('dblclick', this._boundMapDblClick);
    map.getContainer().addEventListener('annotation:featureclick', this._boundFeatureClick);
    map.getContainer().addEventListener('annotation:featuredblclick', this._boundFeatureDblClick);
    map.getContainer().addEventListener('layer-manager:panelopen', this._boundOverlayPanelOpen);
    map.getContainer().addEventListener('routing:panelopen', this._boundRoutingPanelOpen);
    map.getContainer().addEventListener('annotation:open', this._boundAnnotationOpen);
    map.getContainer().addEventListener(ANNOTATION_ACTIVE_LAYER_EVENT, this._boundActiveLayerChange);
    map.getContainer().addEventListener(UI_PANEL_OPEN_EVENT, this._boundAnyPanelOpen);
    map.getContainer().addEventListener(COLLABORATION_ACCESS_EVENT, this._boundAccessChange);
    this._canEdit = collaborationCanEdit(map.getContainer());
    window.addEventListener('keydown', this._boundKeydown);
    this._sync();
    return this._control;
  }

  onRemove() {
    this._abortController?.abort();
    this._unsubscribeStore?.();
    this._map.off('click', this._boundMapClick);
    this._map.off('dblclick', this._boundMapDblClick);
    this._map.getContainer().removeEventListener('annotation:featureclick', this._boundFeatureClick);
    this._map.getContainer().removeEventListener('annotation:featuredblclick', this._boundFeatureDblClick);
    this._map.getContainer().removeEventListener('layer-manager:panelopen', this._boundOverlayPanelOpen);
    this._map.getContainer().removeEventListener('routing:panelopen', this._boundRoutingPanelOpen);
    this._map.getContainer().removeEventListener('annotation:open', this._boundAnnotationOpen);
    this._map.getContainer().removeEventListener(ANNOTATION_ACTIVE_LAYER_EVENT, this._boundActiveLayerChange);
    this._map.getContainer().removeEventListener(UI_PANEL_OPEN_EVENT, this._boundAnyPanelOpen);
    this._map.getContainer().removeEventListener(COLLABORATION_ACCESS_EVENT, this._boundAccessChange);
    window.removeEventListener('keydown', this._boundKeydown);
    this._closeEditor();
    this._removeDraftLayer();
    this._panel?.remove();
    this._control?.remove();
    this._map.getContainer().dataset[ANNOTATION_PICKER_DATASET_KEY] = 'false';
    this._map.getContainer().dataset.annotationPanelOpen = 'false';
    this._map = undefined;
  }

  _appendModeButton(parent: Element, mode: AnnotationMode, icon: LucideIcon, label: string) {
    const button = el('button', 'annotation-mode-button', parent);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    appendIcon(button, icon);
    const text = el('span', undefined, button);
    text.textContent = label;
    button.addEventListener('click', () => this._setMode(mode));
    this._modeButtons[mode] = button;
  }

  _setCanEdit(canEdit: boolean) {
    if (this._canEdit === canEdit) return;
    this._canEdit = canEdit;
    this._sync();
  }

  setExpanded(expanded: boolean) {
    this._expanded = Boolean(expanded);
    if (this._expanded) {
      emitUiPanelOpen(this._map.getContainer(), 'annotations');
      this._map.getContainer().dispatchEvent(new CustomEvent('annotation:panelopen'));
    } else {
      this._setMode('select');
      this._clearDraft();
      this._closeEditor();
    }
    this._map.getContainer().dataset.annotationPanelOpen = this._expanded ? 'true' : 'false';
    this._button.classList.toggle('maplibregl-ctrl-annotation-enabled', this._expanded);
    this._button.setAttribute('aria-expanded', this._expanded ? 'true' : 'false');
    this._panel.classList.toggle('annotation-panel-visible', this._expanded);
    this._panel.setAttribute('aria-hidden', this._expanded ? 'false' : 'true');
    this._sync();
  }

  _setMode(mode: AnnotationMode) {
    if (!this._canEdit && mode !== 'select') return;
    const previousMode = this._mode;
    this._mode = mode;
    const isDraftMode = mode === 'path' || mode === 'polygon' || mode === 'route';
    if (!isDraftMode || previousMode !== mode) this._clearDraft();
    if (mode !== 'select') this._selectedId = '';
    this._editingId = '';
    this._closeEditor({ cleanupBlankText: true });
    this._sync();
  }

  _isActiveLayerVisible() {
    const layer = this._store.getAnnotationLayer(this._activeLayerId);
    return Boolean(layer && layer.visible !== false);
  }

  _emitActiveLayerChange(layerId: string) {
    this._map.getContainer().dispatchEvent(new CustomEvent(ANNOTATION_ACTIVE_LAYER_EVENT, { detail: { layerId } }));
  }

  _fallbackActiveLayerId() {
    return this._store.getAnnotationLayers()[0]?.id || ANNOTATION_DEFAULT_LAYER_ID;
  }

  _setActiveLayer(layerId: string, { emit = true }: { emit?: boolean } = {}) {
    const nextLayerId = this._store.getAnnotationLayer(layerId) ? layerId : this._fallbackActiveLayerId();
    if (this._activeLayerId === nextLayerId) return;
    this._activeLayerId = nextLayerId;
    this._clearDraft();
    if (this._mode !== 'select') this._selectedId = '';
    if (emit) this._emitActiveLayerChange(nextLayerId);
    this._sync();
  }

  _setColor(color: string) {
    if (!this._canEdit) return;
    this._color = /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_COLOR;
    this._customColor.value = this._color;
    this._updateSelectedFromForm();
    this._sync();
  }

  _setLineStyle(value: string) {
    if (!this._canEdit) return;
    this._lineStyle = sanitizeAnnotationLineStyle(value);
    this._lineStyleSelect.value = this._lineStyle;
    this._updateSelectedFromForm();
    this._syncDraftSource();
    this._sync();
  }

  _setOpacity(value: number) {
    if (!this._canEdit) return;
    this._opacity = sanitizeAnnotationOpacity(value);
    this._opacityInput.value = String(Math.round(this._opacity * 100));
    this._updateSelectedFromForm();
    this._syncDraftSource();
    this._sync();
  }

  _setFillOpacity(value: number) {
    if (!this._canEdit) return;
    this._fillOpacity = sanitizeAnnotationFillOpacity(value);
    this._fillOpacityInput.value = String(Math.round(this._fillOpacity * 100));
    this._updateSelectedFromForm();
    this._syncDraftSource();
    this._sync();
  }

  _handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (this._draftPoints.length) {
        this._clearDraft();
        return;
      }
      if (this._expanded) this.setExpanded(false);
    }
    if (this._canEdit && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      if (this._draftPoints.length) {
        event.preventDefault();
        this._undoDraftPoint();
      }
    }
    if (
      this._canEdit &&
      event.key === 'Enter' &&
      (this._mode === 'path' || this._mode === 'polygon' || this._mode === 'route')
    ) {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
      this._finishDraftLine();
    }
  }

  _handleMapClick(event: AnnotationMapClickEvent) {
    if (!this._expanded) return;
    const container = this._map.getContainer();
    if (container.dataset.weatherPickerActive === 'true' || container.dataset.routingPickerActive === 'true') return;
    if (this._dismissEditorFromMapClick(event)) return;
    if (this._mode === 'select') {
      if (this._selectFeatureAt(event.point) && event.originalEvent) event.originalEvent.annotationHandled = true;
      return;
    }
    if (!this._canEdit) return;
    if (!this._annotationReady) {
      this._setStatus('Map style loading...');
      return;
    }
    this._store.patchLayer(this._activeLayerId, { visible: true });

    if (event.originalEvent) event.originalEvent.annotationHandled = true;
    const coordinate = asLngLatTuple(event.lngLat);
    if (this._mode === 'point') {
      this._addPoint(coordinate);
      return;
    }
    if (this._mode === 'text') {
      this._addText(coordinate);
      return;
    }
    this._draftPoints.push(coordinate);
    this._syncDraftSource();
    this._sync();
    if (this._mode === 'route' && this._draftPoints.length >= 2) this._finishDraftLine();
  }

  _handleMapDblClick(event: AnnotationMapDblClickEvent) {
    if (!this._canEdit) return;
    if (!this._annotationReady) return;
    const id = this._featureIdAt(event.point);
    if (!id) return;
    event.preventDefault?.();
    event.originalEvent?.preventDefault();
    event.originalEvent?.stopPropagation();
    if (event.originalEvent) event.originalEvent.annotationHandled = true;
    this._editFeatureById(id);
  }

  _handleFeatureClick(event: Event) {
    const id = (event as CustomEvent<AnnotationFeaturePayloadEventDetail>).detail?.id;
    if (typeof id !== 'string' || !this._expanded || this._mode !== 'select') return;
    this._selectFeatureById(id);
  }

  _handleFeatureDblClick(event: Event) {
    if (!this._canEdit) return;
    const id = (event as CustomEvent<AnnotationFeaturePayloadEventDetail>).detail?.id;
    if (typeof id !== 'string') return;
    this._editFeatureById(id);
  }

  _selectFeatureById(id: string) {
    const feature = this._store.getAnnotationFeaturePayload(id);
    if (!feature) return false;
    if (this._activeLayerId !== feature.layerId) {
      this._activeLayerId = feature.layerId;
      this._emitActiveLayerChange(feature.layerId);
    }
    this._selectedId = id;
    this._editingId = '';
    this._closeEditor({ cleanupBlankText: true });
    this._syncFormFromSelected();
    this._sync();
    return true;
  }

  _editFeatureById(id: string) {
    if (!this._canEdit) return false;
    const feature = this._store.getAnnotationFeaturePayload(id);
    if (!feature) return false;
    if (!this._expanded) this.setExpanded(true);
    if (this._activeLayerId !== feature.layerId) {
      this._activeLayerId = feature.layerId;
      this._emitActiveLayerChange(feature.layerId);
    }
    this._selectedId = id;
    this._editingId = id;
    this._mode = 'select';
    this._clearDraft();
    this._syncFormFromSelected();
    this._sync();
    return true;
  }

  _featureBase(
    type: AnnotationFeaturePayload['type'],
    label = defaultAnnotationFeatureLabel(this._store.getAnnotationFeaturePayloads(), type),
  ) {
    const now = Date.now();
    return {
      id: createAnnotationId(`annotation-${type}`),
      layerId: this._activeLayerId,
      type,
      label,
      note: '',
      color: this._color,
      createdAt: now,
      updatedAt: now,
      updatedBy: '',
    };
  }

  _addPoint(coordinate: LngLatTuple) {
    if (!this._canEdit) return;
    const feature = {
      ...this._featureBase('point'),
      type: 'point' as const,
      coordinate,
    };
    this._store.upsertFeature(feature);
    this._selectedId = feature.id;
    this._editingId = feature.id;
    this._setStatus('Marker added');
    this._syncFormFromSelected();
    this._sync();
  }

  _addText(coordinate: LngLatTuple) {
    if (!this._canEdit) return;
    const feature = {
      ...this._featureBase('text'),
      type: 'text' as const,
      coordinate,
      width: ANNOTATION_TEXT_DEFAULT_WIDTH,
      height: ANNOTATION_TEXT_DEFAULT_HEIGHT,
    };
    this._store.upsertFeature(feature);
    this._selectedId = feature.id;
    this._editingId = feature.id;
    this._setStatus('Text added');
    this._syncFormFromSelected();
    this._sync();
  }

  async _finishDraftLine() {
    if (!this._canEdit) return;
    if (!isAnnotationDraftMode(this._mode)) return;
    const completion = resolveAnnotationDraftCompletion(this._mode, this._draftPoints.length);
    if (completion.action === 'discard') {
      this._clearDraft();
      this._setStatus(completion.status);
      this._sync();
      return;
    }
    if (completion.action === 'wait') {
      this._setStatus(completion.status);
      return;
    }

    if (this._mode === 'path') {
      const feature = {
        ...this._featureBase('path'),
        type: 'path' as const,
        points: this._draftPoints.slice(),
        directed: this._directedInput.checked,
        width: 4,
        lineStyle: this._lineStyle,
        opacity: this._opacity,
      };
      this._store.upsertFeature(feature);
      this._selectedId = feature.id;
      this._editingId = feature.id;
      this._clearDraft();
      this._setStatus('Line added');
      this._syncFormFromSelected();
      this._sync();
      return;
    }
    if (this._mode === 'polygon') {
      const feature = {
        ...this._featureBase('polygon'),
        type: 'polygon' as const,
        points: this._draftPoints.slice(),
        width: 3,
        lineStyle: this._lineStyle,
        opacity: this._opacity,
        fillOpacity: this._fillOpacity,
      };
      this._store.upsertFeature(feature);
      this._selectedId = feature.id;
      this._editingId = feature.id;
      this._clearDraft();
      this._setStatus('Area added');
      this._syncFormFromSelected();
      this._sync();
      return;
    }
    await this._addRoute(this._draftPoints[0], this._draftPoints[this._draftPoints.length - 1]);
  }

  async _addRoute(from: LngLatTuple, to: LngLatTuple) {
    if (!this._canEdit) return;
    this._abortController?.abort();
    this._abortController = new AbortController();
    this._isRouting = true;
    this._setStatus('Routing...');
    this._sync();
    try {
      const endpoint = normalizeEndpoint(this._endpointInput.value);
      const profile = profileFromValue(this._profileSelect.value);
      this._endpointInput.value = endpoint;
      safeSetStorage(ANNOTATION_ENDPOINT_KEY, endpoint);
      const response = await fetch(buildRouteUrl(endpoint, lngLatObject(from), lngLatObject(to), profile), {
        signal: this._abortController.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as OsrmRouteResponse;
      if (data.code !== 'Ok') throw new Error(data.message || data.code || 'Route failed');
      const route = data.routes?.[0];
      if (!route?.geometry || route.geometry.type !== 'LineString' || !Array.isArray(route.geometry.coordinates)) {
        throw new Error('No route geometry');
      }
      const distance = Number(route.distance);
      const duration = Number(route.duration);
      const distanceText = formatDistance(distance);
      const durationText = formatDuration(duration);
      const waypoints = data.waypoints || [];
      const routeLabel = defaultAnnotationFeatureLabel(this._store.getAnnotationFeaturePayloads(), 'route', {
        profile,
        distanceText,
        durationText,
        fromName: osrmWaypointName(waypoints[0]),
        toName: osrmWaypointName(waypoints[waypoints.length - 1]),
      });
      const feature = {
        ...this._featureBase('route', routeLabel),
        type: 'route' as const,
        waypoints: [from, to],
        profile,
        directed: this._directedInput.checked,
        width: 5,
        lineStyle: this._lineStyle,
        opacity: this._opacity,
        geometry: route.geometry.coordinates as LngLatTuple[],
        distance: Number.isFinite(distance) ? distance : null,
        duration: Number.isFinite(duration) ? duration : null,
        distanceText,
        durationText,
      };
      this._store.upsertFeature(feature);
      this._selectedId = feature.id;
      this._editingId = feature.id;
      this._clearDraft();
      this._setStatus(['Route added', feature.distanceText, feature.durationText].filter(Boolean).join(' - '));
      this._syncFormFromSelected();
      this._sync();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Annotation route failed:', error);
      this._setStatus(error instanceof Error ? error.message : 'Route failed');
    } finally {
      this._isRouting = false;
      this._abortController = null;
      this._sync();
    }
  }

  _selectFeatureAt(point: unknown) {
    const id = this._featureIdAt(point);
    if (!id) {
      this._selectedId = '';
      this._editingId = '';
      this._closeEditor({ cleanupBlankText: true });
      this._syncFormFromSelected();
      this._sync();
      return false;
    }
    return this._selectFeatureById(id);
  }

  _featureIdAt(point: unknown) {
    if (!this._annotationReady) return '';
    const features = this._map.queryRenderedFeatures(point);
    const feature = features.find((item) => featureIdFromRendered(item));
    return feature ? featureIdFromRendered(feature) : '';
  }

  _selectedFeature() {
    return this._selectedId ? this._store.getAnnotationFeaturePayload(this._selectedId) || null : null;
  }

  _syncFormFromSelected() {
    const feature = this._selectedFeature();
    if (!feature) return;
    this._labelInput.value = feature.label || '';
    this._noteInput.value = feature.note || '';
    this._color = feature.color || DEFAULT_COLOR;
    this._customColor.value = this._color;
    if (feature.type === 'path' || feature.type === 'route') {
      this._directedInput.checked = feature.directed !== false;
      this._lineStyle = feature.lineStyle || DEFAULT_LINE_STYLE;
      this._opacity = sanitizeAnnotationOpacity(feature.opacity);
    }
    if (feature.type === 'polygon') {
      this._lineStyle = feature.lineStyle || DEFAULT_LINE_STYLE;
      this._opacity = sanitizeAnnotationOpacity(feature.opacity);
      this._fillOpacity = sanitizeAnnotationFillOpacity(feature.fillOpacity);
    }
    this._lineStyleSelect.value = this._lineStyle;
    this._opacityInput.value = String(Math.round(this._opacity * 100));
    this._fillOpacityInput.value = String(Math.round(this._fillOpacity * 100));
    if (feature.type === 'route') {
      this._profileSelect.value = feature.profile;
    }
  }

  _updateSelectedFromForm() {
    if (!this._canEdit) return;
    const feature = this._selectedFeature();
    if (!feature || this._mode !== 'select') return;
    const next: AnnotationFeaturePayload = {
      ...feature,
      label: sanitizeAnnotationText(this._labelInput.value, 120),
      note: sanitizeAnnotationText(this._noteInput.value, 1200),
      color: this._color,
      updatedAt: Date.now(),
    } as AnnotationFeaturePayload;
    if (next.type === 'path' || next.type === 'route') {
      next.directed = this._directedInput.checked;
      next.lineStyle = this._lineStyle;
      next.opacity = this._opacity;
    }
    if (next.type === 'polygon') {
      next.lineStyle = this._lineStyle;
      next.opacity = this._opacity;
      next.fillOpacity = this._fillOpacity;
    }
    if (next.type === 'route') {
      next.profile = profileFromValue(this._profileSelect.value);
    }
    this._store.upsertFeature(next);
  }

  _updateEditingFromEditor() {
    if (!this._canEdit) return;
    const feature = this._selectedFeature();
    if (!feature || this._editingId !== feature.id) return;
    const color = this._editorColorInput?.value || feature.color || DEFAULT_COLOR;
    const next: AnnotationFeaturePayload = {
      ...feature,
      label: sanitizeAnnotationText(this._editorLabelInput?.value || '', 120),
      note: sanitizeAnnotationText(this._editorNoteInput?.value || '', 1200),
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_COLOR,
      updatedAt: Date.now(),
    } as AnnotationFeaturePayload;
    if (next.type === 'path' || next.type === 'route') {
      next.directed = this._editorDirectedInput?.checked !== false;
      next.lineStyle = sanitizeAnnotationLineStyle(this._editorLineStyleSelect?.value ?? next.lineStyle);
      next.opacity = sanitizeAnnotationOpacity(Number(this._editorOpacityInput?.value) / 100, next.opacity);
    }
    if (next.type === 'polygon') {
      next.lineStyle = sanitizeAnnotationLineStyle(this._editorLineStyleSelect?.value ?? next.lineStyle);
      next.opacity = sanitizeAnnotationOpacity(Number(this._editorOpacityInput?.value) / 100, next.opacity);
      next.fillOpacity = sanitizeAnnotationFillOpacity(
        Number(this._editorFillOpacityInput?.value) / 100,
        next.fillOpacity,
      );
    }
    this._store.upsertFeature(next);
    this._syncEditorSwatches(next.color);
  }

  _setEditorColor(color: string) {
    if (!this._canEdit) return;
    const sanitized = /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_COLOR;
    if (this._editorColorInput) this._editorColorInput.value = sanitized;
    this._updateEditingFromEditor();
  }

  _closeEditor({ cleanupBlankText = false }: { cleanupBlankText?: boolean } = {}) {
    const id = this._editorFeatureId;
    this._editorPopup?.remove();
    this._editorPopup = null;
    this._editorFeatureId = '';
    this._editorLabelInput = null;
    this._editorNoteInput = null;
    this._editorColorInput = null;
    this._editorDirectedInput = null;
    this._editorLineStyleSelect = null;
    this._editorOpacityInput = null;
    this._editorFillOpacityInput = null;
    this._editorSwatches = null;
    if (this._canEdit && cleanupBlankText && id) {
      const feature = this._store.getAnnotationFeaturePayload(id);
      if (feature?.type === 'text' && !feature.label && !feature.note) {
        this._store.deleteFeature(id);
        if (this._selectedId === id) this._selectedId = '';
        if (this._editingId === id) this._editingId = '';
      }
    }
  }

  _dismissEditorFromMapClick(event: AnnotationMapClickEvent) {
    if (!this._editorPopup || !this._editorFeatureId) return false;
    const target = event.originalEvent?.target;
    if (target instanceof Element && target.closest('.annotation-edit-popup')) return false;
    event.preventDefault?.();
    event.originalEvent?.preventDefault();
    event.originalEvent?.stopPropagation();
    if (event.originalEvent) event.originalEvent.annotationHandled = true;
    this._editingId = '';
    this._closeEditor({ cleanupBlankText: true });
    this._sync();
    return true;
  }

  _openEditor(feature: AnnotationFeaturePayload) {
    if (!this._canEdit) return;
    if (this._editorPopup && this._editorFeatureId === feature.id) {
      this._editorPopup.setLngLat(featureAnchor(feature));
      return;
    }
    this._closeEditor({ cleanupBlankText: true });
    this._map.getContainer().dispatchEvent(new CustomEvent('annotation:editopen', { detail: { id: feature.id } }));

    const editor = el('div', 'annotation-editor');
    stopMapControlPropagation(editor);

    const header = el('div', 'annotation-editor-header', editor);
    const title = el('div', 'annotation-editor-title', header);
    title.textContent = annotationTypeLabel(feature);
    const closeButton = el('button', 'annotation-editor-close', header);
    closeButton.type = 'button';
    closeButton.title = 'Close editor';
    closeButton.setAttribute('aria-label', 'Close editor');
    appendIcon(closeButton, XIcon);
    closeButton.addEventListener('click', () => {
      this._editingId = '';
      this._closeEditor({ cleanupBlankText: true });
      this._sync();
    });

    const labelField = el('label', 'annotation-editor-field', editor);
    const labelText = el('span', 'annotation-field-label', labelField);
    labelText.textContent = 'Label';
    this._editorLabelInput = el('input', 'annotation-input', labelField);
    this._editorLabelInput.type = 'text';
    this._editorLabelInput.maxLength = 120;
    this._editorLabelInput.value = feature.label || '';
    this._editorLabelInput.placeholder = feature.type === 'text' ? 'Text on map' : 'Label';
    this._editorLabelInput.addEventListener('input', () => this._updateEditingFromEditor());

    const noteField = el('label', 'annotation-editor-field', editor);
    const noteText = el('span', 'annotation-field-label', noteField);
    noteText.textContent = 'Note';
    this._editorNoteInput = el('textarea', 'annotation-note', noteField);
    this._editorNoteInput.maxLength = 1200;
    this._editorNoteInput.rows = 3;
    this._editorNoteInput.value = feature.note || '';
    this._editorNoteInput.addEventListener('input', () => this._updateEditingFromEditor());

    const styleField = el('div', 'annotation-editor-field', editor);
    const styleText = el('span', 'annotation-field-label', styleField);
    styleText.textContent = 'Color';
    this._editorSwatches = el('div', 'annotation-swatches', styleField);
    for (const color of COLOR_SWATCHES) {
      const swatch = el('button', 'annotation-swatch', this._editorSwatches);
      swatch.type = 'button';
      swatch.title = color;
      swatch.style.backgroundColor = color;
      swatch.dataset.color = color;
      swatch.addEventListener('click', () => this._setEditorColor(color));
    }
    this._editorColorInput = el('input', 'annotation-color-input', styleField);
    this._editorColorInput.type = 'color';
    this._editorColorInput.value = feature.color || DEFAULT_COLOR;
    this._editorColorInput.addEventListener('input', () =>
      this._setEditorColor(this._editorColorInput?.value || DEFAULT_COLOR),
    );

    if (feature.type === 'path' || feature.type === 'route' || feature.type === 'polygon') {
      const lineStyleField = el('label', 'annotation-editor-field', editor);
      const lineStyleText = el('span', 'annotation-field-label', lineStyleField);
      lineStyleText.textContent = 'Line style';
      this._editorLineStyleSelect = el('select', 'annotation-input', lineStyleField);
      for (const [value, label] of [
        ['solid', 'Solid'],
        ['dashed', 'Dashed'],
        ['dotted', 'Dotted'],
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        this._editorLineStyleSelect.appendChild(option);
      }
      this._editorLineStyleSelect.value = feature.lineStyle || DEFAULT_LINE_STYLE;
      this._editorLineStyleSelect.addEventListener('change', () => this._updateEditingFromEditor());

      const opacityField = el('label', 'annotation-editor-field', editor);
      const opacityHeader = el('span', 'annotation-field-row', opacityField);
      const opacityText = el('span', 'annotation-field-label', opacityHeader);
      opacityText.textContent = 'Opacity';
      const opacityValue = el('span', 'annotation-value', opacityHeader);
      this._editorOpacityInput = el('input', 'annotation-range', opacityField);
      this._editorOpacityInput.type = 'range';
      this._editorOpacityInput.min = '5';
      this._editorOpacityInput.max = '100';
      this._editorOpacityInput.step = '5';
      this._editorOpacityInput.value = String(Math.round(sanitizeAnnotationOpacity(feature.opacity) * 100));
      const syncOpacityValue = () => {
        opacityValue.textContent = `${this._editorOpacityInput?.value || 95}%`;
      };
      syncOpacityValue();
      this._editorOpacityInput.addEventListener('input', () => {
        syncOpacityValue();
        this._updateEditingFromEditor();
      });
    }

    if (feature.type === 'polygon') {
      const fillOpacityField = el('label', 'annotation-editor-field', editor);
      const fillOpacityHeader = el('span', 'annotation-field-row', fillOpacityField);
      const fillOpacityText = el('span', 'annotation-field-label', fillOpacityHeader);
      fillOpacityText.textContent = 'Fill';
      const fillOpacityValue = el('span', 'annotation-value', fillOpacityHeader);
      this._editorFillOpacityInput = el('input', 'annotation-range', fillOpacityField);
      this._editorFillOpacityInput.type = 'range';
      this._editorFillOpacityInput.min = '5';
      this._editorFillOpacityInput.max = '100';
      this._editorFillOpacityInput.step = '5';
      this._editorFillOpacityInput.value = String(Math.round(sanitizeAnnotationFillOpacity(feature.fillOpacity) * 100));
      const syncFillOpacityValue = () => {
        fillOpacityValue.textContent = `${this._editorFillOpacityInput?.value || 22}%`;
      };
      syncFillOpacityValue();
      this._editorFillOpacityInput.addEventListener('input', () => {
        syncFillOpacityValue();
        this._updateEditingFromEditor();
      });
    }

    if (feature.type === 'path' || feature.type === 'route') {
      const directedField = el('label', 'annotation-check-field', editor);
      this._editorDirectedInput = el('input', undefined, directedField);
      this._editorDirectedInput.type = 'checkbox';
      this._editorDirectedInput.checked = feature.directed !== false;
      const directedText = el('span', undefined, directedField);
      directedText.textContent = 'Directed';
      this._editorDirectedInput.addEventListener('change', () => this._updateEditingFromEditor());
    }

    const actions = el('div', 'annotation-editor-actions', editor);
    const deleteButton = el('button', 'annotation-action annotation-danger', actions);
    deleteButton.type = 'button';
    appendIconLabel(deleteButton, TrashIcon, 'Delete');
    deleteButton.addEventListener('click', () => this._deleteSelected());

    this._editorFeatureId = feature.id;
    this._syncEditorSwatches(feature.color);
    this._editorPopup = new maplibregl.Popup({
      className: 'annotation-edit-popup',
      closeButton: false,
      closeOnClick: false,
      maxWidth: '320px',
      offset: 12,
    })
      .setLngLat(featureAnchor(feature))
      .setDOMContent(editor)
      .addTo(this._map as unknown as maplibregl.Map);
    this._editorLabelInput.focus();
    this._editorLabelInput.select();
  }

  _syncEditorSwatches(color: string) {
    if (!this._editorSwatches) return;
    for (const swatch of this._editorSwatches.querySelectorAll<HTMLElement>('.annotation-swatch')) {
      swatch.classList.toggle('selected', swatch.dataset.color === color);
    }
  }

  _deleteSelected() {
    if (!this._canEdit) return;
    const id = this._selectedId;
    if (!id) return;
    this._store.deleteFeature(id);
    this._selectedId = '';
    this._editingId = '';
    this._closeEditor();
    this._setStatus('Deleted');
    this._sync();
  }

  _undoDraftPoint() {
    if (!this._canEdit) return;
    this._draftPoints.pop();
    this._syncDraftSource();
    this._sync();
  }

  _clearDraft() {
    this._draftPoints = [];
    this._syncDraftSource();
  }

  _installDraftLayer() {
    runWhenStyleInfrastructureReady(this._map, () => {
      if (!this._map) return;
      if (!this._map.getSource('annotation-draft-source')) {
        this._map.addSource('annotation-draft-source', {
          type: 'geojson',
          data: emptyFeatureCollection(),
        });
      }
      if (!this._map.getLayer('annotation-draft-fill')) {
        this._map.addLayer({
          id: 'annotation-draft-fill',
          type: 'fill',
          source: 'annotation-draft-source',
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: {
            'fill-color': ['coalesce', ['get', 'color'], DEFAULT_COLOR],
            'fill-opacity': ['coalesce', ['get', 'fill_opacity'], 0.2],
          },
        });
      }
      if (!this._map.getLayer('annotation-draft-line')) {
        this._map.addLayer({
          id: 'annotation-draft-line',
          type: 'line',
          source: 'annotation-draft-source',
          filter: ['==', ['geometry-type'], 'LineString'],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['coalesce', ['get', 'color'], DEFAULT_COLOR],
            'line-width': 4,
            'line-dasharray': annotationLineDashExpression(),
            'line-opacity': 0.92,
          },
        });
      }
      if (!this._map.getLayer('annotation-draft-points')) {
        this._map.addLayer({
          id: 'annotation-draft-points',
          type: 'circle',
          source: 'annotation-draft-source',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 5,
            'circle-color': ['coalesce', ['get', 'color'], DEFAULT_COLOR],
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 2,
          },
        });
      }
      this._annotationReady = true;
      this._syncDraftSource();
      this._sync();
    });
  }

  _removeDraftLayer() {
    if (this._map.getLayer('annotation-draft-points')) this._map.removeLayer('annotation-draft-points');
    if (this._map.getLayer('annotation-draft-line')) this._map.removeLayer('annotation-draft-line');
    if (this._map.getLayer('annotation-draft-fill')) this._map.removeLayer('annotation-draft-fill');
    if (this._map.getSource('annotation-draft-source')) this._map.removeSource('annotation-draft-source');
  }

  _syncDraftSource() {
    const features = [];
    if (this._mode === 'polygon' && this._draftPoints.length >= 3) {
      features.push(polygonFeature(this._draftPoints, this._color, this._fillOpacity));
      features.push(lineFeature(closedRing(this._draftPoints), this._color, this._lineStyle));
    } else if (this._draftPoints.length >= 2) {
      features.push(lineFeature(this._draftPoints, this._color, this._lineStyle));
    }
    if (this._draftPoints.length > 0) {
      features.push(
        ...this._draftPoints.map((point) => ({
          type: 'Feature',
          properties: { color: this._color },
          geometry: { type: 'Point', coordinates: point },
        })),
      );
    }
    asAnnotationSource(this._map?.getSource('annotation-draft-source'))?.setData({
      type: 'FeatureCollection',
      features,
    });
  }

  _setStatus(message: string) {
    this._status.textContent = message;
    this._status.classList.toggle('visible', Boolean(message));
  }

  _syncActiveFeatureState() {
    const activeId = this._editingId || this._selectedId;
    if (activeId === this._lastActiveFeatureId) return;
    this._lastActiveFeatureId = activeId;
    this._map.getContainer().dispatchEvent(
      new CustomEvent(ANNOTATION_ACTIVE_FEATURE_EVENT, {
        detail: {
          activeId,
          selectedId: this._selectedId,
          editingId: this._editingId,
        },
      }),
    );
  }

  _sync() {
    if (!this._map) return;
    if (!this._store.getAnnotationLayer(this._activeLayerId)) this._activeLayerId = this._fallbackActiveLayerId();
    this._syncLayerSelect();
    const layerVisible = this._isActiveLayerVisible();
    if ((!this._canEdit || !layerVisible) && this._mode !== 'select') {
      this._mode = 'select';
      this._clearDraft();
      this._editingId = '';
      this._closeEditor({ cleanupBlankText: true });
    } else if (!this._canEdit) {
      this._clearDraft();
      this._editingId = '';
      this._closeEditor({ cleanupBlankText: true });
    }
    this._syncActiveFeatureState();
    const featureCount = this._store.getAnnotationFeatureCount();
    const selected = this._selectedFeature();
    const draftCount = this._draftPoints.length;
    const mapLoading = !this._annotationReady;
    this._summary.textContent = mapLoading
      ? 'Map style loading'
      : draftCount > 0
        ? `${draftCount} draft point${draftCount === 1 ? '' : 's'}`
        : selected
          ? `${selected.type} selected`
          : `${featureCount} feature${featureCount === 1 ? '' : 's'}`;
    this._map.getContainer().dataset[ANNOTATION_PICKER_DATASET_KEY] = isAnnotationPickerInteractionActive({
      expanded: this._expanded,
      layerVisible,
      annotationReady: this._annotationReady,
      canEdit: this._canEdit,
      mode: this._mode,
    })
      ? 'true'
      : 'false';

    for (const [mode, button] of Object.entries(this._modeButtons) as Array<[AnnotationMode, HTMLButtonElement]>) {
      button.classList.toggle('active', mode === this._mode);
      button.disabled =
        !this._expanded ||
        this._isRouting ||
        !layerVisible ||
        (mapLoading && mode !== 'select') ||
        (!this._canEdit && mode !== 'select');
    }

    const draftMode = isAnnotationDraftMode(this._mode) ? this._mode : null;
    const isDraftMode = Boolean(draftMode);
    const isLineMode = this._mode === 'path' || this._mode === 'route';
    const isLineSelected = selected?.type === 'path' || selected?.type === 'route';
    const isAreaMode = this._mode === 'polygon';
    const isAreaSelected = selected?.type === 'polygon';
    const hasLineStyleControls = isLineMode || isLineSelected || isAreaMode || isAreaSelected;
    const isRouteMode = this._mode === 'route' || selected?.type === 'route';
    const isEditingSelected = Boolean(selected && this._editingId === selected.id);
    const showDraftStyle = this._canEdit && this._mode !== 'select' && !isEditingSelected;
    this._selectHint.hidden = this._mode !== 'select' || Boolean(selected);
    this._labelInput.closest<HTMLElement>('.annotation-field').hidden = true;
    this._noteInput.closest<HTMLElement>('.annotation-field').hidden = true;
    this._customColor.closest<HTMLElement>('.annotation-field').hidden = !showDraftStyle;
    this._lineControls.hidden = isEditingSelected || !hasLineStyleControls;
    this._directedInput.closest<HTMLElement>('.annotation-check-field').hidden = !(isLineMode || isLineSelected);
    this._fillOpacityInput.closest<HTMLElement>('.annotation-field').hidden = !(isAreaMode || isAreaSelected);
    this._endpointInput.closest<HTMLElement>('.annotation-field').hidden = isEditingSelected || !isRouteMode;
    this._profileSelect.closest<HTMLElement>('.annotation-field').hidden = isEditingSelected || !isRouteMode;
    const styleDisabled =
      !this._canEdit || !this._expanded || this._isRouting || !layerVisible || mapLoading || !hasLineStyleControls;
    this._directedInput.disabled =
      !this._canEdit ||
      !this._expanded ||
      this._isRouting ||
      !layerVisible ||
      mapLoading ||
      !(isLineMode || isLineSelected);
    this._lineStyleSelect.disabled = styleDisabled;
    this._opacityInput.disabled = styleDisabled;
    this._fillOpacityInput.disabled =
      !this._canEdit ||
      !this._expanded ||
      this._isRouting ||
      !layerVisible ||
      mapLoading ||
      !(isAreaMode || isAreaSelected);
    this._lineStyleSelect.value = this._lineStyle;
    this._opacityInput.value = String(Math.round(this._opacity * 100));
    this._opacityValue.textContent = `${Math.round(this._opacity * 100)}%`;
    this._fillOpacityInput.value = String(Math.round(this._fillOpacity * 100));
    this._fillOpacityValue.textContent = `${Math.round(this._fillOpacity * 100)}%`;
    this._undoButton.hidden = isEditingSelected || !isDraftMode;
    this._doneButton.hidden = isEditingSelected || !isDraftMode;
    this._deleteButton.hidden = !selected || isEditingSelected;
    this._undoButton.disabled =
      !this._canEdit || !this._expanded || this._isRouting || mapLoading || this._draftPoints.length === 0;
    this._doneButton.disabled =
      !this._canEdit ||
      !this._expanded ||
      this._isRouting ||
      mapLoading ||
      !draftMode ||
      !canSubmitAnnotationDraft(draftMode, this._draftPoints.length);
    this._deleteButton.disabled = !this._canEdit || !this._expanded || this._isRouting || !selected;
    this._labelInput.disabled = !this._canEdit || !this._expanded || this._isRouting;
    this._noteInput.disabled = !this._canEdit || !this._expanded || this._isRouting;
    this._customColor.disabled = !this._canEdit || !this._expanded || this._isRouting || !layerVisible || mapLoading;
    this._layerSelect.disabled = !this._expanded || this._isRouting;
    if (this._expanded && mapLoading) this._setStatus('Map style loading...');
    if (!mapLoading && this._status.textContent === 'Map style loading...') this._setStatus('');
    this._syncSwatches();
    if (selected && this._editingId === selected.id) this._openEditor(selected);
    if (!selected || this._editingId !== selected.id) this._closeEditor();
  }

  _syncSwatches() {
    for (const swatch of this._colorSwatches.querySelectorAll<HTMLElement>('.annotation-swatch')) {
      swatch.classList.toggle('selected', swatch.dataset.color === this._color);
      (swatch as HTMLButtonElement).disabled =
        !this._canEdit || !this._expanded || this._isRouting || !this._isActiveLayerVisible() || !this._annotationReady;
    }
  }

  _syncLayerSelect() {
    const layerOptions = this._store.getAnnotationLayers();
    const currentOptionIds = Array.from(this._layerSelect.options).map((option) => option.value);
    const nextOptionIds = layerOptions.map((layer) => layer.id);
    if (currentOptionIds.join('\n') !== nextOptionIds.join('\n')) {
      while (this._layerSelect.firstChild) this._layerSelect.firstChild.remove();
      for (const layer of layerOptions) {
        const option = document.createElement('option');
        option.value = layer.id;
        option.textContent = layer.name || 'Annotations';
        this._layerSelect.appendChild(option);
      }
    } else {
      for (const option of Array.from(this._layerSelect.options)) {
        const layer = layerOptions.find((item) => item.id === option.value);
        if (layer && option.textContent !== layer.name) option.textContent = layer.name || 'Annotations';
      }
    }
    this._layerSelect.value = this._activeLayerId;
  }
}

export function installAnnotationTools(map: AnnotationMap, store: LayerStore) {
  map.addControl(new AnnotationToolsControl(store), 'top-right');
}
