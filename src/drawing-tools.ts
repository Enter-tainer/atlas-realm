import createIconElement from 'lucide/dist/esm/createElement.mjs';
import CheckIcon from 'lucide/dist/esm/icons/check.mjs';
import CircleDotIcon from 'lucide/dist/esm/icons/circle-dot.mjs';
import MapPinIcon from 'lucide/dist/esm/icons/map-pin.mjs';
import MousePointerIcon from 'lucide/dist/esm/icons/mouse-pointer-2.mjs';
import PenLineIcon from 'lucide/dist/esm/icons/pen-line.mjs';
import PentagonIcon from 'lucide/dist/esm/icons/pentagon.mjs';
import PencilIcon from 'lucide/dist/esm/icons/pencil.mjs';
import RouteIcon from 'lucide/dist/esm/icons/route.mjs';
import TrashIcon from 'lucide/dist/esm/icons/trash-2.mjs';
import TypeIcon from 'lucide/dist/esm/icons/type.mjs';
import UndoIcon from 'lucide/dist/esm/icons/undo-2.mjs';
import XIcon from 'lucide/dist/esm/icons/x.mjs';
import { createDrawingId, sanitizeDrawingText } from './drawing-model.js';
import { buildRouteUrl, formatDistance, formatDuration, normalizeEndpoint } from './routing.js';
import { runWhenStyleReady } from './style-ready.js';
import { emitUiPanelOpen, isOtherUiPanelOpen, UI_PANEL_OPEN_EVENT } from './ui-panels.js';
import type { DrawingFeature, DrawingRouteProfile, LngLatTuple } from './drawing-model.js';
import type { DrawingStore } from './drawing-store.js';
import type { OsrmRouteResponse } from './routing.js';

const DRAWING_PICKER_DATASET_KEY = 'drawingPickerActive';
const DRAWING_ENDPOINT_KEY = 'orm-drawing-osrm-endpoint';
const DEFAULT_COLOR = '#2563eb';
const COLOR_SWATCHES = ['#2563eb', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#7c3aed', '#db2777'];

type LngLatLike = { lng: number; lat: number };
type DrawingMode = 'select' | 'point' | 'text' | 'path' | 'polygon' | 'route';
type DrawingMapClickEvent = {
  lngLat: LngLatLike;
  point: unknown;
  originalEvent?: Event & { drawingHandled?: boolean };
};
type RenderedFeatureLike = {
  source?: string;
  properties?: Record<string, unknown>;
};
type DrawingSource = {
  setData(data: object): void;
};
type DrawingControl = {
  onAdd(map: DrawingMap): HTMLElement;
  onRemove(): void;
};
type DrawingMap = {
  _styleInitialized?: boolean;
  isStyleLoaded(): boolean | void;
  setGlobalStateProperty(propertyName: string, value: unknown): void;
  once(event: 'load', callback: () => void): void;
  addControl(control: DrawingControl, position?: string): void;
  getContainer(): HTMLElement;
  on(event: 'click', handler: (event: DrawingMapClickEvent) => void): void;
  off(event: 'click', handler: (event: DrawingMapClickEvent) => void): void;
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

function appendIcon(parent: Element, icon: LucideIcon, className = 'drawing-icon') {
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
  const labelNode = el('span', 'drawing-action-label', parent);
  labelNode.textContent = label;
  return labelNode;
}

function stopMapControlPropagation(node: Element) {
  node.addEventListener('contextmenu', (event: Event) => event.stopPropagation());
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

function lineFeature(points: LngLatTuple[], color: string) {
  return {
    type: 'Feature',
    properties: { color, 'line-width': 4 },
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

function polygonFeature(points: LngLatTuple[], color: string) {
  return {
    type: 'Feature',
    properties: { color, fill_opacity: 0.2 },
    geometry: { type: 'Polygon', coordinates: [closedRing(points)] },
  };
}

function featureIdFromRendered(feature: RenderedFeatureLike) {
  const source = String(feature?.source || '');
  const id = feature?.properties?.drawing_id;
  return source === 'drawing-plan-source' && typeof id === 'string' ? id : '';
}

function asDrawingSource(source: unknown): DrawingSource | null {
  return source && typeof (source as DrawingSource).setData === 'function' ? (source as DrawingSource) : null;
}

function profileFromValue(value: string): DrawingRouteProfile {
  if (value === 'walking' || value === 'cycling') return value;
  return 'driving';
}

class DrawingToolsControl {
  _store: DrawingStore;
  _map: DrawingMap;
  _control: HTMLElement;
  _button: HTMLButtonElement;
  _panel: HTMLElement;
  _title: HTMLElement;
  _summary: HTMLElement;
  _closeButton: HTMLButtonElement;
  _modeButtons: Record<DrawingMode, HTMLButtonElement>;
  _labelInput: HTMLInputElement;
  _noteInput: HTMLTextAreaElement;
  _colorSwatches: HTMLElement;
  _customColor: HTMLInputElement;
  _directedInput: HTMLInputElement;
  _profileSelect: HTMLSelectElement;
  _endpointInput: HTMLInputElement;
  _undoButton: HTMLButtonElement;
  _doneButton: HTMLButtonElement;
  _deleteButton: HTMLButtonElement;
  _status: HTMLElement;
  _selectHint: HTMLElement;
  _lineControls: HTMLElement;
  _expanded = false;
  _mode: DrawingMode = 'select';
  _selectedId = '';
  _draftPoints: LngLatTuple[] = [];
  _isRouting = false;
  _color = DEFAULT_COLOR;
  _abortController: AbortController | null = null;
  _boundMapClick: (event: DrawingMapClickEvent) => void;
  _boundKeydown: (event: KeyboardEvent) => void;
  _boundOverlayPanelOpen: () => void;
  _boundRoutingPanelOpen: () => void;
  _boundDrawingOpen: () => void;
  _boundAnyPanelOpen: (event: Event) => void;
  _unsubscribeStore: (() => void) | null = null;

  constructor(store: DrawingStore) {
    this._store = store;
    this._modeButtons = {} as Record<DrawingMode, HTMLButtonElement>;
    this._boundMapClick = (event) => this._handleMapClick(event);
    this._boundKeydown = (event) => this._handleKeydown(event);
    this._boundOverlayPanelOpen = () => this.setExpanded(false);
    this._boundRoutingPanelOpen = () => this.setExpanded(false);
    this._boundDrawingOpen = () => this.setExpanded(true);
    this._boundAnyPanelOpen = (event) => {
      if (isOtherUiPanelOpen(event, 'annotations')) this.setExpanded(false);
    };
  }

  onAdd(map: DrawingMap) {
    this._map = map;
    this._control = el('div', 'maplibregl-ctrl maplibregl-ctrl-group drawing-control');
    this._button = el('button', 'maplibregl-ctrl-drawing', this._control);
    this._button.type = 'button';
    this._button.title = 'Annotations';
    this._button.setAttribute('aria-label', 'Annotations');
    this._button.setAttribute('aria-expanded', 'false');
    appendIcon(this._button, PencilIcon);
    this._button.addEventListener('click', () => this.setExpanded(!this._expanded));

    this._panel = el('section', 'drawing-panel', map.getContainer());
    this._panel.setAttribute('aria-label', 'Annotations');
    this._panel.setAttribute('aria-hidden', 'true');
    stopMapControlPropagation(this._panel);

    const header = el('div', 'drawing-header', this._panel);
    const titleWrap = el('div', 'drawing-title-wrap', header);
    this._title = el('div', 'drawing-title', titleWrap);
    this._title.textContent = 'Annotations';
    this._summary = el('div', 'drawing-summary', titleWrap);

    this._closeButton = el('button', 'drawing-close', header);
    this._closeButton.type = 'button';
    this._closeButton.title = 'Close annotations';
    this._closeButton.setAttribute('aria-label', 'Close annotations');
    appendIcon(this._closeButton, XIcon);
    this._closeButton.addEventListener('click', () => this.setExpanded(false));

    const body = el('div', 'drawing-body', this._panel);

    const modes = el('div', 'drawing-mode-grid', body);
    this._appendModeButton(modes, 'select', MousePointerIcon, 'Select');
    this._appendModeButton(modes, 'point', MapPinIcon, 'Marker');
    this._appendModeButton(modes, 'text', TypeIcon, 'Text');
    this._appendModeButton(modes, 'path', PenLineIcon, 'Line');
    this._appendModeButton(modes, 'polygon', PentagonIcon, 'Area');
    this._appendModeButton(modes, 'route', RouteIcon, 'Route');

    this._selectHint = el('div', 'drawing-select-hint', body);
    this._selectHint.textContent = 'Tap an annotation on the map to edit it';

    const labelField = el('label', 'drawing-field', body);
    const labelLabel = el('span', 'drawing-field-label', labelField);
    labelLabel.textContent = 'Label';
    this._labelInput = el('input', 'drawing-input', labelField);
    this._labelInput.type = 'text';
    this._labelInput.maxLength = 120;
    this._labelInput.placeholder = 'Hotel, day 1, lunch...';
    this._labelInput.addEventListener('input', () => this._updateSelectedFromForm());

    const noteField = el('label', 'drawing-field', body);
    const noteLabel = el('span', 'drawing-field-label', noteField);
    noteLabel.textContent = 'Note';
    this._noteInput = el('textarea', 'drawing-note', noteField);
    this._noteInput.maxLength = 1200;
    this._noteInput.rows = 3;
    this._noteInput.addEventListener('input', () => this._updateSelectedFromForm());

    const styleField = el('div', 'drawing-field', body);
    const styleLabel = el('span', 'drawing-field-label', styleField);
    styleLabel.textContent = 'Color';
    this._colorSwatches = el('div', 'drawing-swatches', styleField);
    for (const color of COLOR_SWATCHES) {
      const swatch = el('button', 'drawing-swatch', this._colorSwatches);
      swatch.type = 'button';
      swatch.title = color;
      swatch.style.backgroundColor = color;
      swatch.dataset.color = color;
      swatch.addEventListener('click', () => this._setColor(color));
    }
    this._customColor = el('input', 'drawing-color-input', styleField);
    this._customColor.type = 'color';
    this._customColor.value = this._color;
    this._customColor.addEventListener('input', () => this._setColor(this._customColor.value));

    this._lineControls = el('div', 'drawing-line-controls', body);
    const directedField = el('label', 'drawing-check-field', this._lineControls);
    this._directedInput = el('input', undefined, directedField);
    this._directedInput.type = 'checkbox';
    this._directedInput.checked = true;
    const directedLabel = el('span', undefined, directedField);
    directedLabel.textContent = 'Directed';
    this._directedInput.addEventListener('change', () => this._updateSelectedFromForm());

    const profileField = el('label', 'drawing-field drawing-profile-field', this._lineControls);
    const profileLabel = el('span', 'drawing-field-label', profileField);
    profileLabel.textContent = 'Profile';
    this._profileSelect = el('select', 'drawing-input', profileField);
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

    const endpointField = el('label', 'drawing-field drawing-endpoint-field', body);
    const endpointLabel = el('span', 'drawing-field-label', endpointField);
    endpointLabel.textContent = 'Routing endpoint';
    this._endpointInput = el('input', 'drawing-input', endpointField);
    this._endpointInput.type = 'url';
    this._endpointInput.autocomplete = 'off';
    this._endpointInput.spellcheck = false;
    this._endpointInput.value = safeGetStorage(DRAWING_ENDPOINT_KEY, 'https://router.project-osrm.org');
    this._endpointInput.addEventListener('change', () => {
      const endpoint = normalizeEndpoint(this._endpointInput.value);
      this._endpointInput.value = endpoint;
      safeSetStorage(DRAWING_ENDPOINT_KEY, endpoint);
    });

    const actions = el('div', 'drawing-actions', body);
    this._undoButton = el('button', 'drawing-action', actions);
    this._undoButton.type = 'button';
    appendIconLabel(this._undoButton, UndoIcon, 'Undo');
    this._undoButton.addEventListener('click', () => this._undoDraftPoint());

    this._doneButton = el('button', 'drawing-action drawing-action-primary', actions);
    this._doneButton.type = 'button';
    appendIconLabel(this._doneButton, CheckIcon, 'Done');
    this._doneButton.addEventListener('click', () => this._finishDraftLine());

    this._deleteButton = el('button', 'drawing-action drawing-danger', actions);
    this._deleteButton.type = 'button';
    appendIconLabel(this._deleteButton, TrashIcon, 'Delete');
    this._deleteButton.addEventListener('click', () => this._deleteSelected());

    this._status = el('div', 'drawing-status', body);
    this._status.setAttribute('role', 'status');
    this._status.setAttribute('aria-live', 'polite');

    this._installDraftLayer();
    this._unsubscribeStore = this._store.subscribe(() => this._sync());
    map.on('click', this._boundMapClick);
    map.getContainer().addEventListener('overlay-manager:panelopen', this._boundOverlayPanelOpen);
    map.getContainer().addEventListener('routing:panelopen', this._boundRoutingPanelOpen);
    map.getContainer().addEventListener('drawing:open', this._boundDrawingOpen);
    map.getContainer().addEventListener(UI_PANEL_OPEN_EVENT, this._boundAnyPanelOpen);
    window.addEventListener('keydown', this._boundKeydown);
    this._sync();
    return this._control;
  }

  onRemove() {
    this._abortController?.abort();
    this._unsubscribeStore?.();
    this._map.off('click', this._boundMapClick);
    this._map.getContainer().removeEventListener('overlay-manager:panelopen', this._boundOverlayPanelOpen);
    this._map.getContainer().removeEventListener('routing:panelopen', this._boundRoutingPanelOpen);
    this._map.getContainer().removeEventListener('drawing:open', this._boundDrawingOpen);
    this._map.getContainer().removeEventListener(UI_PANEL_OPEN_EVENT, this._boundAnyPanelOpen);
    window.removeEventListener('keydown', this._boundKeydown);
    this._removeDraftLayer();
    this._panel?.remove();
    this._control?.remove();
    this._map.getContainer().dataset[DRAWING_PICKER_DATASET_KEY] = 'false';
    this._map.getContainer().dataset.drawingPanelOpen = 'false';
    this._map = undefined;
  }

  _appendModeButton(parent: Element, mode: DrawingMode, icon: LucideIcon, label: string) {
    const button = el('button', 'drawing-mode-button', parent);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    appendIcon(button, icon);
    const text = el('span', undefined, button);
    text.textContent = label;
    button.addEventListener('click', () => this._setMode(mode));
    this._modeButtons[mode] = button;
  }

  setExpanded(expanded: boolean) {
    this._expanded = Boolean(expanded);
    if (this._expanded) {
      emitUiPanelOpen(this._map.getContainer(), 'annotations');
      this._map.getContainer().dispatchEvent(new CustomEvent('drawing:panelopen'));
    } else {
      this._setMode('select');
      this._clearDraft();
    }
    this._map.getContainer().dataset.drawingPanelOpen = this._expanded ? 'true' : 'false';
    this._button.classList.toggle('maplibregl-ctrl-drawing-enabled', this._expanded);
    this._button.setAttribute('aria-expanded', this._expanded ? 'true' : 'false');
    this._panel.classList.toggle('drawing-panel-visible', this._expanded);
    this._panel.setAttribute('aria-hidden', this._expanded ? 'false' : 'true');
    this._sync();
  }

  _setMode(mode: DrawingMode) {
    const previousMode = this._mode;
    this._mode = mode;
    const isDraftMode = mode === 'path' || mode === 'polygon' || mode === 'route';
    if (!isDraftMode || previousMode !== mode) this._clearDraft();
    if (mode !== 'select') this._selectedId = '';
    this._sync();
  }

  _setColor(color: string) {
    this._color = /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_COLOR;
    this._customColor.value = this._color;
    this._updateSelectedFromForm();
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
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      if (this._draftPoints.length) {
        event.preventDefault();
        this._undoDraftPoint();
      }
    }
    if (event.key === 'Enter' && (this._mode === 'path' || this._mode === 'polygon' || this._mode === 'route')) {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
      this._finishDraftLine();
    }
  }

  _handleMapClick(event: DrawingMapClickEvent) {
    if (!this._expanded) return;
    const container = this._map.getContainer();
    if (container.dataset.weatherPickerActive === 'true' || container.dataset.routingPickerActive === 'true') return;
    this._store.patchLayer('drawing-default', { visible: true });
    if (this._mode === 'select') {
      this._selectFeatureAt(event.point);
      return;
    }

    if (event.originalEvent) event.originalEvent.drawingHandled = true;
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

  _featureBase(type: DrawingFeature['type']) {
    const now = Date.now();
    return {
      id: createDrawingId(`drawing-${type}`),
      layerId: 'drawing-default',
      type,
      label: sanitizeDrawingText(this._labelInput.value, 120),
      note: sanitizeDrawingText(this._noteInput.value, 1200),
      color: this._color,
      createdAt: now,
      updatedAt: now,
      updatedBy: '',
    };
  }

  _addPoint(coordinate: LngLatTuple) {
    const feature = {
      ...this._featureBase('point'),
      type: 'point' as const,
      coordinate,
    };
    this._store.upsertFeature(feature);
    this._selectedId = feature.id;
    this._mode = 'select';
    this._setStatus('Marker added');
    this._syncFormFromSelected();
    this._sync();
  }

  _addText(coordinate: LngLatTuple) {
    const label = sanitizeDrawingText(this._labelInput.value, 120) || sanitizeDrawingText(this._noteInput.value, 1200);
    if (!label) {
      this._setStatus('Add label or note');
      return;
    }
    const feature = {
      ...this._featureBase('text'),
      type: 'text' as const,
      label,
      coordinate,
    };
    this._store.upsertFeature(feature);
    this._selectedId = feature.id;
    this._mode = 'select';
    this._setStatus('Text added');
    this._syncFormFromSelected();
    this._sync();
  }

  async _finishDraftLine() {
    if (this._mode === 'path') {
      if (this._draftPoints.length < 2) {
        this._setStatus('Add at least 2 points');
        return;
      }
      const feature = {
        ...this._featureBase('path'),
        type: 'path' as const,
        points: this._draftPoints.slice(),
        directed: this._directedInput.checked,
        width: 4,
      };
      this._store.upsertFeature(feature);
      this._selectedId = feature.id;
      this._mode = 'select';
      this._clearDraft();
      this._setStatus('Line added');
      this._syncFormFromSelected();
      this._sync();
      return;
    }
    if (this._mode === 'polygon') {
      if (this._draftPoints.length < 3) {
        this._setStatus('Add at least 3 points');
        return;
      }
      const feature = {
        ...this._featureBase('polygon'),
        type: 'polygon' as const,
        points: this._draftPoints.slice(),
        width: 3,
        fillOpacity: 0.22,
      };
      this._store.upsertFeature(feature);
      this._selectedId = feature.id;
      this._mode = 'select';
      this._clearDraft();
      this._setStatus('Area added');
      this._syncFormFromSelected();
      this._sync();
      return;
    }
    if (this._mode !== 'route') return;
    if (this._draftPoints.length < 2) {
      this._setStatus('Pick start and end');
      return;
    }
    await this._addRoute(this._draftPoints[0], this._draftPoints[this._draftPoints.length - 1]);
  }

  async _addRoute(from: LngLatTuple, to: LngLatTuple) {
    this._abortController?.abort();
    this._abortController = new AbortController();
    this._isRouting = true;
    this._setStatus('Routing...');
    this._sync();
    try {
      const endpoint = normalizeEndpoint(this._endpointInput.value);
      const profile = profileFromValue(this._profileSelect.value);
      this._endpointInput.value = endpoint;
      safeSetStorage(DRAWING_ENDPOINT_KEY, endpoint);
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
      const feature = {
        ...this._featureBase('route'),
        type: 'route' as const,
        waypoints: [from, to],
        profile,
        directed: this._directedInput.checked,
        width: 5,
        geometry: route.geometry.coordinates as LngLatTuple[],
        distance: Number.isFinite(distance) ? distance : null,
        duration: Number.isFinite(duration) ? duration : null,
        distanceText: formatDistance(distance),
        durationText: formatDuration(duration),
      };
      this._store.upsertFeature(feature);
      this._selectedId = feature.id;
      this._mode = 'select';
      this._clearDraft();
      this._setStatus(['Route added', feature.distanceText, feature.durationText].filter(Boolean).join(' - '));
      this._syncFormFromSelected();
      this._sync();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Drawing route failed:', error);
      this._setStatus(error instanceof Error ? error.message : 'Route failed');
    } finally {
      this._isRouting = false;
      this._abortController = null;
      this._sync();
    }
  }

  _selectFeatureAt(point: unknown) {
    const features = this._map.queryRenderedFeatures(point);
    const feature = features.find((item) => featureIdFromRendered(item));
    const id = feature ? featureIdFromRendered(feature) : '';
    this._selectedId = id;
    this._syncFormFromSelected();
    this._sync();
  }

  _selectedFeature() {
    return this._selectedId ? this._store.getDoc().features[this._selectedId] || null : null;
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
    }
    if (feature.type === 'route') {
      this._profileSelect.value = feature.profile;
    }
  }

  _updateSelectedFromForm() {
    const feature = this._selectedFeature();
    if (!feature || this._mode !== 'select') return;
    const next: DrawingFeature = {
      ...feature,
      label: sanitizeDrawingText(this._labelInput.value, 120),
      note: sanitizeDrawingText(this._noteInput.value, 1200),
      color: this._color,
      updatedAt: Date.now(),
    } as DrawingFeature;
    if (next.type === 'path' || next.type === 'route') {
      next.directed = this._directedInput.checked;
    }
    if (next.type === 'route') {
      next.profile = profileFromValue(this._profileSelect.value);
    }
    this._store.upsertFeature(next);
  }

  _deleteSelected() {
    const id = this._selectedId;
    if (!id) return;
    this._store.deleteFeature(id);
    this._selectedId = '';
    this._setStatus('Deleted');
    this._sync();
  }

  _undoDraftPoint() {
    this._draftPoints.pop();
    this._syncDraftSource();
    this._sync();
  }

  _clearDraft() {
    this._draftPoints = [];
    this._syncDraftSource();
  }

  _installDraftLayer() {
    runWhenStyleReady(this._map, () => {
      if (!this._map.getSource('drawing-draft-source')) {
        this._map.addSource('drawing-draft-source', {
          type: 'geojson',
          data: emptyFeatureCollection(),
        });
      }
      if (!this._map.getLayer('drawing-draft-fill')) {
        this._map.addLayer({
          id: 'drawing-draft-fill',
          type: 'fill',
          source: 'drawing-draft-source',
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: {
            'fill-color': ['coalesce', ['get', 'color'], DEFAULT_COLOR],
            'fill-opacity': ['coalesce', ['get', 'fill_opacity'], 0.2],
          },
        });
      }
      if (!this._map.getLayer('drawing-draft-line')) {
        this._map.addLayer({
          id: 'drawing-draft-line',
          type: 'line',
          source: 'drawing-draft-source',
          filter: ['==', ['geometry-type'], 'LineString'],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['coalesce', ['get', 'color'], DEFAULT_COLOR],
            'line-width': 4,
            'line-dasharray': [1.5, 1.2],
            'line-opacity': 0.92,
          },
        });
      }
      if (!this._map.getLayer('drawing-draft-points')) {
        this._map.addLayer({
          id: 'drawing-draft-points',
          type: 'circle',
          source: 'drawing-draft-source',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 5,
            'circle-color': ['coalesce', ['get', 'color'], DEFAULT_COLOR],
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 2,
          },
        });
      }
      this._syncDraftSource();
    });
  }

  _removeDraftLayer() {
    if (this._map.getLayer('drawing-draft-points')) this._map.removeLayer('drawing-draft-points');
    if (this._map.getLayer('drawing-draft-line')) this._map.removeLayer('drawing-draft-line');
    if (this._map.getLayer('drawing-draft-fill')) this._map.removeLayer('drawing-draft-fill');
    if (this._map.getSource('drawing-draft-source')) this._map.removeSource('drawing-draft-source');
  }

  _syncDraftSource() {
    const features = [];
    if (this._mode === 'polygon' && this._draftPoints.length >= 3) {
      features.push(polygonFeature(this._draftPoints, this._color));
      features.push(lineFeature(closedRing(this._draftPoints), this._color));
    } else if (this._draftPoints.length >= 2) {
      features.push(lineFeature(this._draftPoints, this._color));
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
    asDrawingSource(this._map?.getSource('drawing-draft-source'))?.setData({
      type: 'FeatureCollection',
      features,
    });
  }

  _setStatus(message: string) {
    this._status.textContent = message;
    this._status.classList.toggle('visible', Boolean(message));
  }

  _sync() {
    if (!this._map) return;
    const doc = this._store.getDoc();
    const featureCount = doc.featureOrder.length;
    const selected = this._selectedFeature();
    const draftCount = this._draftPoints.length;
    this._summary.textContent =
      draftCount > 0
        ? `${draftCount} draft point${draftCount === 1 ? '' : 's'}`
        : selected
          ? `${selected.type} selected`
          : `${featureCount} feature${featureCount === 1 ? '' : 's'}`;
    this._map.getContainer().dataset[DRAWING_PICKER_DATASET_KEY] =
      this._expanded && this._mode !== 'select' ? 'true' : 'false';

    for (const [mode, button] of Object.entries(this._modeButtons) as Array<[DrawingMode, HTMLButtonElement]>) {
      button.classList.toggle('active', mode === this._mode);
      button.disabled = !this._expanded || this._isRouting;
    }

    const isDraftMode = this._mode === 'path' || this._mode === 'polygon' || this._mode === 'route';
    const isLineMode = this._mode === 'path' || this._mode === 'route';
    const isLineSelected = selected?.type === 'path' || selected?.type === 'route';
    const isRouteMode = this._mode === 'route' || selected?.type === 'route';
    const showFeatureFields = this._mode !== 'select' || Boolean(selected);
    this._selectHint.hidden = this._mode !== 'select' || Boolean(selected);
    this._labelInput.closest<HTMLElement>('.drawing-field').hidden = !showFeatureFields;
    this._noteInput.closest<HTMLElement>('.drawing-field').hidden = !showFeatureFields;
    this._customColor.closest<HTMLElement>('.drawing-field').hidden = !showFeatureFields;
    this._lineControls.hidden = !(isLineMode || isLineSelected);
    this._endpointInput.closest<HTMLElement>('.drawing-field').hidden = !isRouteMode;
    this._profileSelect.closest<HTMLElement>('.drawing-field').hidden = !isRouteMode;
    this._directedInput.disabled = !this._expanded || this._isRouting || !(isLineMode || isLineSelected);
    this._undoButton.hidden = !isDraftMode;
    this._doneButton.hidden = !isDraftMode;
    this._deleteButton.hidden = !selected;
    this._undoButton.disabled = !this._expanded || this._isRouting || this._draftPoints.length === 0;
    this._doneButton.disabled =
      !this._expanded ||
      this._isRouting ||
      !isDraftMode ||
      this._draftPoints.length < (this._mode === 'polygon' ? 3 : 2);
    this._deleteButton.disabled = !this._expanded || this._isRouting || !selected;
    this._labelInput.disabled = !this._expanded || this._isRouting;
    this._noteInput.disabled = !this._expanded || this._isRouting;
    this._customColor.disabled = !this._expanded || this._isRouting;
    this._syncSwatches();
  }

  _syncSwatches() {
    for (const swatch of this._colorSwatches.querySelectorAll<HTMLElement>('.drawing-swatch')) {
      swatch.classList.toggle('selected', swatch.dataset.color === this._color);
      (swatch as HTMLButtonElement).disabled = !this._expanded || this._isRouting;
    }
  }
}

export function installDrawingTools(map: DrawingMap, store: DrawingStore) {
  map.addControl(new DrawingToolsControl(store), 'top-right');
}
