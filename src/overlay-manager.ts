import { processOrQueueGpx, processOrQueueGeoJson, addGpxToMap, addGeoJsonToMap, isRemoteOverlayEvent } from './gpx.js';
import { overlayManifestPatch } from './overlay-sync.js';
import createIconElement from 'lucide/dist/esm/createElement.mjs';
import DownloadIcon from 'lucide/dist/esm/icons/download.mjs';
import EyeIcon from 'lucide/dist/esm/icons/eye.mjs';
import EyeOffIcon from 'lucide/dist/esm/icons/eye-off.mjs';
import GripVerticalIcon from 'lucide/dist/esm/icons/grip-vertical.mjs';
import LayersIcon from 'lucide/dist/esm/icons/layers.mjs';
import LinkIcon from 'lucide/dist/esm/icons/link.mjs';
import LocateFixedIcon from 'lucide/dist/esm/icons/locate-fixed.mjs';
import PlusIcon from 'lucide/dist/esm/icons/plus.mjs';
import TrashIcon from 'lucide/dist/esm/icons/trash-2.mjs';
import UploadIcon from 'lucide/dist/esm/icons/upload.mjs';
import XIcon from 'lucide/dist/esm/icons/x.mjs';

const DEFAULT_COLOR = '#3b82f6';
const COLOR_SWATCHES = ['#3b82f6', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899'];
const OVERLAY_SOURCE_TYPES = new Set(['gpx', 'geojson']);
type AnyRecord = Record<string | symbol, unknown>;
type OverlayBounds = [[number, number], [number, number]];
type BoundsLike = readonly (readonly number[])[];
type OverlayType = 'gpx' | 'geojson';
type OverlayData = object;
type OverlayContent = string | object;
type OverlayStyleValue = string | number | boolean | null | OverlayStyleValue[];
type OverlayFitBoundsOptions = {
  padding?: number | { top: number; right: number; bottom: number; left: number };
  maxZoom?: number;
  duration?: number;
};
type OverlayEaseOptions = {
  center: [number, number];
  zoom: number;
  duration: number;
};
type OverlayControl = {
  onAdd(map: OverlayMap): HTMLElement;
  onRemove(): void;
};
type OverlayLike = AnyRecord & {
  id: string;
  type: OverlayType;
  subType?: string | null;
  sourceId?: string;
  layerIds: string[];
  name: string;
  color?: string;
  opacity?: number;
  lineWidth?: number;
  visible: boolean;
  bounds?: OverlayBounds | null;
  data?: OverlayData;
  syncOverlayId?: string;
  remoteOverlayId?: string | null;
  contentHash?: string;
  points?: number;
  p99Speed?: number;
  lines?: number;
  polygons?: number;
  features?: number;
  distanceText?: string;
  durationText?: string;
  stepCount?: number;
  annotationSegmentCount?: number;
};
type OverlayLayer = { source?: string; type?: string };
type OverlayMap = {
  addControl(control: OverlayControl, position?: string): void;
  getContainer(): HTMLElement;
  addSource(id: string, source: object): void;
  addLayer(layer: object): void;
  hasImage(name: string): boolean;
  addImage(name: string, image: ImageData, options?: { pixelRatio?: number }): void;
  fitBounds(bounds: OverlayBounds, options?: OverlayFitBoundsOptions): void;
  easeTo(options: OverlayEaseOptions): void;
  getZoom(): number;
  getLayer(layerId: string): OverlayLayer | undefined;
  getSource(sourceId?: string): object | undefined;
  setLayoutProperty(layerId: string, name: string, value: OverlayStyleValue): void;
  setPaintProperty(layerId: string, name: string, value: OverlayStyleValue): void;
  getPaintProperty(layerId: string, name: string): unknown;
  removeLayer(layerId: string): void;
  removeSource(sourceId?: string): void;
  moveLayer(layerId: string): void;
};
type OverlayDragState = {
  id: string;
  pointerId: number;
  handle: HTMLElement;
  row: HTMLElement;
};
type OverlayMutationOptions = { emit?: boolean };
type MoveOverlayOptions = { render?: boolean; sync?: boolean };
type OverlayStylePatch = {
  color?: string;
  opacity?: number;
  lineWidth?: number;
};
type OverlayListDetail = { overlays?: OverlayLike[] };
type OverlayRemoteAddDetail = { manifest?: OverlayLike; content?: OverlayContent };
type OverlayImportResult = { bounds?: BoundsLike | null } | null;

function asOverlayBounds(value: BoundsLike | null | undefined): OverlayBounds | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const sw = value[0];
  const ne = value[1];
  if (!Array.isArray(sw) || !Array.isArray(ne)) return null;
  const minLng = Number(sw[0]);
  const minLat = Number(sw[1]);
  const maxLng = Number(ne[0]);
  const maxLat = Number(ne[1]);
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

function randomOverlaySyncId() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `overlay-${id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  parent?: Element | null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function appendIcon(parent: Element, icon: LucideIcon, className = 'overlay-manager-icon') {
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
  const labelNode = el('span', 'overlay-manager-action-label', parent);
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

function clamp(value: number | string | null | undefined, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function normalizeColor(value: string | null | undefined, fallback = DEFAULT_COLOR) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function formatOverlayType(type: OverlayType | string | null | undefined) {
  return type === 'gpx' ? 'GPX' : 'GeoJSON';
}

function formatOverlayMeta(overlay: OverlayLike) {
  if (overlay.subType === 'osrm') {
    const parts = [overlay.distanceText, overlay.durationText].filter(Boolean) as string[];
    if (Number.isFinite(overlay.stepCount)) parts.push(`${overlay.stepCount} steps`);
    if (Number.isFinite(overlay.annotationSegmentCount)) parts.push(`${overlay.annotationSegmentCount} speed segments`);
    return parts.join(' - ') || 'OSRM route';
  }

  if (overlay.type === 'gpx') {
    const parts: string[] = [];
    if (Number.isFinite(overlay.points)) parts.push(`${overlay.points} pts`);
    if (Number.isFinite(overlay.p99Speed) && overlay.p99Speed > 0) parts.push(`p99 ${overlay.p99Speed} km/h`);
    return parts.join(' - ') || 'GPX track';
  }

  const parts: string[] = [];
  if (overlay.lines) parts.push(`${overlay.lines} lines`);
  if (overlay.points) parts.push(`${overlay.points} points`);
  if (overlay.polygons) parts.push(`${overlay.polygons} polygons`);
  return parts.join(' - ') || `${overlay.features || 0} features`;
}

function fitOverlayBounds(map: OverlayMap, overlay: OverlayLike | null | undefined) {
  if (!overlay?.bounds) return;
  const [[minLng, minLat], [maxLng, maxLat]] = overlay.bounds;
  if (minLng === maxLng && minLat === maxLat) {
    map.easeTo({ center: [minLng, minLat], zoom: Math.max(map.getZoom(), 14), duration: 450 });
    return;
  }
  map.fitBounds(overlay.bounds, {
    padding: { top: 72, right: 72, bottom: 72, left: 72 },
    maxZoom: 16,
    duration: 450,
  });
}

function isOverlayStyleValue(value: unknown): value is OverlayStyleValue {
  return (
    value == null ||
    ['string', 'number', 'boolean'].includes(typeof value) ||
    (Array.isArray(value) && value.every(isOverlayStyleValue))
  );
}

function withFallbackColor(expression: unknown, color: string): OverlayStyleValue {
  if (!isOverlayStyleValue(expression)) return color;
  if (Array.isArray(expression)) {
    if (expression[0] === 'get' && (expression[1] === 'color' || expression[1] === 'stroke')) return color;
    return expression.map((item) => withFallbackColor(item, color));
  }
  if (typeof expression === 'string' && /^#|^rgb|^hsl/.test(expression)) return color;
  return expression;
}

function exportJson(data: OverlayData, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(String(objectUrl)), 1000);
}

function inferOverlayTypeFromUrl(url: string): OverlayType {
  try {
    const parsed = new URL(url, window.location.href);
    const path = parsed.protocol === 'data:' ? parsed.pathname : parsed.pathname.toLowerCase();
    if (path.includes('gpx') || path.endsWith('.gpx')) return 'gpx';
    return 'geojson';
  } catch {
    return /\.gpx(?:$|[?#])/i.test(url) ? 'gpx' : 'geojson';
  }
}

function importNameFromUrl(url: string, fallback: string) {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol === 'data:') return fallback;
    return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '') || fallback;
  } catch {
    return fallback;
  }
}

function ensureMarkerIcon(map: OverlayMap, color: string) {
  const imageName = `marker-dot-${color}`;
  if (map.hasImage(imageName)) return imageName;

  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size * 4;
  canvas.height = size * 4;
  const ctx = canvas.getContext('2d');
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  ctx.beginPath();
  ctx.arc(size * 2, size * 2, size - 2, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.stroke();

  map.addImage(imageName, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 });
  return imageName;
}

function isManagedLayer(layer: OverlayLayer | undefined) {
  return layer?.source && /^(gpx-track-|geojson-layer-)/.test(layer.source);
}

function hasSyncOrigin(overlay: OverlayLike | null | undefined) {
  return Boolean(overlay?.syncOverlayId || overlay?.remoteOverlayId);
}

function manifestOverlayMetadata(manifest: OverlayLike) {
  const metadata = overlayManifestPatch(manifest);
  delete metadata.id;
  return metadata;
}

class OverlayManagerControl {
  _map: OverlayMap;
  _control: HTMLElement;
  _button: HTMLButtonElement;
  _panel: HTMLElement;
  _title: HTMLElement;
  _summary: HTMLElement;
  _importButton: HTMLButtonElement;
  _closeButton: HTMLButtonElement;
  _dropZone: HTMLButtonElement;
  _fileInput: HTMLInputElement;
  _urlForm: HTMLFormElement;
  _urlInput: HTMLInputElement;
  _urlSubmit: HTMLButtonElement;
  _status: HTMLElement;
  _empty: HTMLElement;
  _list: HTMLElement;
  _details: HTMLElement;
  _detailsTitle: HTMLElement;
  _nameInput: HTMLInputElement;
  _colorField: HTMLElement;
  _swatches: HTMLElement;
  _customColor: HTMLInputElement;
  _widthField: HTMLElement;
  _widthValue: HTMLElement;
  _widthInput: HTMLInputElement;
  _opacityField: HTMLElement;
  _opacityValue: HTMLElement;
  _opacityInput: HTMLInputElement;
  _zoomButton: HTMLButtonElement;
  _exportButton: HTMLButtonElement;
  _deleteButton: HTMLButtonElement;
  _overlays: OverlayLike[];
  _selectedId: string | null;
  _expanded: boolean;
  _importStatusTimer: number;
  _isImportingUrl: boolean;
  _dragState: OverlayDragState | null;
  _boundOverlayAdded: (event: CustomEvent<OverlayLike>) => void;
  _boundOverlayRemoteAdd: (event: CustomEvent<OverlayRemoteAddDetail>) => void;
  _boundOverlayRemoteList: (event: CustomEvent<OverlayListDetail>) => void;
  _boundOverlayRemoteDelete: (event: CustomEvent<{ overlayId?: string }>) => void;
  _boundKeydown: (event: KeyboardEvent) => void;
  _boundViewportChange: () => void;
  _boundRoutingPanelOpen: () => void;

  constructor() {
    this._overlays = [];
    this._selectedId = null;
    this._expanded = false;
    this._importStatusTimer = 0;
    this._isImportingUrl = false;
    this._dragState = null;
    this._boundOverlayAdded = (event) => this._registerOverlay(event.detail);
    this._boundOverlayRemoteAdd = (event) => this._addRemoteOverlay(event.detail);
    this._boundOverlayRemoteList = (event) => this._applyRemoteOverlayList(event.detail);
    this._boundOverlayRemoteDelete = (event) => this._deleteRemoteOverlay(event.detail?.overlayId);
    this._boundKeydown = (event) => this._handleKeydown(event);
    this._boundViewportChange = () => this._syncViewportMode();
    this._boundRoutingPanelOpen = () => this.setExpanded(false);
  }

  onAdd(map: OverlayMap) {
    this._map = map;
    this._control = el('div', 'maplibregl-ctrl maplibregl-ctrl-group overlay-manager-control');
    this._button = el('button', 'maplibregl-ctrl-overlays', this._control);
    this._button.type = 'button';
    this._button.title = 'Layers';
    this._button.setAttribute('aria-label', 'Layers');
    this._button.setAttribute('aria-expanded', 'false');
    appendIcon(this._button, LayersIcon);
    this._button.addEventListener('click', () => this.setExpanded(!this._expanded));

    this._panel = el('section', 'overlay-manager-panel', map.getContainer());
    this._panel.setAttribute('aria-label', 'Overlay manager');
    this._panel.setAttribute('aria-hidden', 'true');
    stopMapControlPropagation(this._panel);

    const header = el('div', 'overlay-manager-header', this._panel);
    const titleWrap = el('div', 'overlay-manager-title-wrap', header);
    this._title = el('div', 'overlay-manager-title', titleWrap);
    this._title.textContent = 'Overlays';
    this._summary = el('div', 'overlay-manager-summary', titleWrap);

    this._importButton = el('button', 'overlay-manager-import', header);
    this._importButton.type = 'button';
    this._importButton.title = 'Import GPX or GeoJSON';
    this._importButton.setAttribute('aria-label', 'Import GPX or GeoJSON');
    appendIcon(this._importButton, PlusIcon);
    this._importButton.addEventListener('click', () => this._fileInput.click());

    this._closeButton = el('button', 'overlay-manager-close', header);
    this._closeButton.type = 'button';
    this._closeButton.title = 'Close layers';
    this._closeButton.setAttribute('aria-label', 'Close layers');
    appendIcon(this._closeButton, XIcon);
    this._closeButton.addEventListener('click', () => this.setExpanded(false));

    const body = el('div', 'overlay-manager-body', this._panel);
    const importRow = el('div', 'overlay-manager-import-row', body);
    this._dropZone = el('button', 'overlay-manager-dropzone', importRow);
    this._dropZone.type = 'button';
    appendIcon(this._dropZone, UploadIcon);
    const dropZoneText = el('span', 'overlay-manager-dropzone-label', this._dropZone);
    dropZoneText.textContent = 'Import GPX / GeoJSON';
    this._dropZone.addEventListener('click', () => this._fileInput.click());
    this._fileInput = el('input', 'overlay-manager-file-input', importRow);
    this._fileInput.type = 'file';
    this._fileInput.accept = '.gpx,.geojson,.json,application/geo+json,application/json';
    this._fileInput.multiple = true;
    this._fileInput.addEventListener('change', () => {
      const files = Array.from(this._fileInput.files || []);
      this._fileInput.value = '';
      this._importFiles(files);
    });

    this._urlForm = el('form', 'overlay-manager-url-form', body);
    this._urlInput = el('input', 'overlay-manager-url-input', this._urlForm);
    this._urlInput.type = 'url';
    this._urlInput.placeholder = 'https://example.com/track.gpx';
    this._urlInput.autocomplete = 'off';
    this._urlInput.spellcheck = false;
    this._urlInput.setAttribute('aria-label', 'Overlay URL');
    this._urlSubmit = el('button', 'overlay-manager-url-submit', this._urlForm);
    this._urlSubmit.type = 'submit';
    this._urlSubmit.title = 'Import from URL';
    this._urlSubmit.setAttribute('aria-label', 'Import from URL');
    appendIcon(this._urlSubmit, LinkIcon);
    this._urlForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this._importUrl(this._urlInput.value);
    });

    this._status = el('div', 'overlay-manager-status', body);
    this._status.setAttribute('role', 'status');
    this._status.setAttribute('aria-live', 'polite');

    this._empty = el('div', 'overlay-manager-empty', body);
    this._empty.textContent = 'No overlays yet';
    this._list = el('div', 'overlay-manager-list', body);
    this._list.setAttribute('role', 'list');

    this._details = el('div', 'overlay-manager-details', body);
    this._detailsTitle = el('div', 'overlay-manager-details-title', this._details);

    const nameField = el('label', 'overlay-manager-field', this._details);
    const nameLabel = el('span', 'overlay-manager-field-label', nameField);
    nameLabel.textContent = 'Name';
    this._nameInput = el('input', 'overlay-manager-name-input', nameField);
    this._nameInput.type = 'text';
    this._nameInput.maxLength = 80;
    this._nameInput.addEventListener('input', () => this._renameSelected(this._nameInput.value));

    this._colorField = el('div', 'overlay-manager-field', this._details);
    const colorLabel = el('span', 'overlay-manager-field-label', this._colorField);
    colorLabel.textContent = 'Color';
    this._swatches = el('div', 'overlay-manager-swatches', this._colorField);
    for (const swatchColor of COLOR_SWATCHES) {
      const swatch = el('button', 'overlay-manager-swatch', this._swatches);
      swatch.type = 'button';
      swatch.title = swatchColor;
      swatch.style.backgroundColor = swatchColor;
      swatch.dataset.color = swatchColor;
      swatch.addEventListener('click', () => this._updateSelectedStyle({ color: swatchColor }));
    }
    this._customColor = el('input', 'overlay-manager-color-input', this._colorField);
    this._customColor.type = 'color';
    this._customColor.value = DEFAULT_COLOR;
    this._customColor.addEventListener('input', () => this._updateSelectedStyle({ color: this._customColor.value }));

    this._widthField = el('label', 'overlay-manager-field', this._details);
    const widthHeader = el('span', 'overlay-manager-field-row', this._widthField);
    const widthLabel = el('span', 'overlay-manager-field-label', widthHeader);
    widthLabel.textContent = 'Width';
    this._widthValue = el('span', 'overlay-manager-value', widthHeader);
    this._widthInput = el('input', 'overlay-manager-range', this._widthField);
    this._widthInput.type = 'range';
    this._widthInput.min = '1';
    this._widthInput.max = '12';
    this._widthInput.step = '1';
    this._widthInput.addEventListener('input', () =>
      this._updateSelectedStyle({ lineWidth: Number(this._widthInput.value) }),
    );

    this._opacityField = el('label', 'overlay-manager-field', this._details);
    const opacityHeader = el('span', 'overlay-manager-field-row', this._opacityField);
    const opacityLabel = el('span', 'overlay-manager-field-label', opacityHeader);
    opacityLabel.textContent = 'Opacity';
    this._opacityValue = el('span', 'overlay-manager-value', opacityHeader);
    this._opacityInput = el('input', 'overlay-manager-range', this._opacityField);
    this._opacityInput.type = 'range';
    this._opacityInput.min = '20';
    this._opacityInput.max = '100';
    this._opacityInput.step = '5';
    this._opacityInput.addEventListener('input', () =>
      this._updateSelectedStyle({ opacity: Number(this._opacityInput.value) / 100 }),
    );

    const detailActions = el('div', 'overlay-manager-detail-actions', this._details);
    this._zoomButton = el('button', 'overlay-manager-action', detailActions);
    this._zoomButton.type = 'button';
    appendIconLabel(this._zoomButton, LocateFixedIcon, 'Zoom');
    this._zoomButton.addEventListener('click', () => fitOverlayBounds(this._map, this._selectedOverlay()));

    this._exportButton = el('button', 'overlay-manager-action', detailActions);
    this._exportButton.type = 'button';
    appendIconLabel(this._exportButton, DownloadIcon, 'Export');
    this._exportButton.addEventListener('click', () => this._exportSelected());

    this._deleteButton = el('button', 'overlay-manager-action overlay-manager-danger', detailActions);
    this._deleteButton.type = 'button';
    appendIconLabel(this._deleteButton, TrashIcon, 'Delete');
    this._deleteButton.addEventListener('click', () => this._removeSelected());

    this._panel.addEventListener('dragover', (event) => {
      event.preventDefault();
      this._panel.classList.add('overlay-manager-dragging');
    });
    this._panel.addEventListener('dragleave', () => this._panel.classList.remove('overlay-manager-dragging'));
    this._panel.addEventListener('drop', (event) => {
      event.preventDefault();
      this._panel.classList.remove('overlay-manager-dragging');
      this._importFiles(Array.from(event.dataTransfer?.files || []));
    });

    map.getContainer().addEventListener('overlay:add', this._boundOverlayAdded);
    map.getContainer().addEventListener('overlay-sync:remote-add', this._boundOverlayRemoteAdd);
    map.getContainer().addEventListener('overlay-sync:remote-list', this._boundOverlayRemoteList);
    map.getContainer().addEventListener('overlay-sync:remote-delete', this._boundOverlayRemoteDelete);
    map.getContainer().addEventListener('routing:panelopen', this._boundRoutingPanelOpen);
    window.addEventListener('keydown', this._boundKeydown);
    window.addEventListener('resize', this._boundViewportChange, { passive: true });
    this._syncViewportMode();
    this._syncPanelInteractivity();
    this._render();
    return this._control;
  }

  onRemove() {
    this._map.getContainer().removeEventListener('overlay:add', this._boundOverlayAdded);
    this._map.getContainer().removeEventListener('overlay-sync:remote-add', this._boundOverlayRemoteAdd);
    this._map.getContainer().removeEventListener('overlay-sync:remote-list', this._boundOverlayRemoteList);
    this._map.getContainer().removeEventListener('overlay-sync:remote-delete', this._boundOverlayRemoteDelete);
    this._map.getContainer().removeEventListener('routing:panelopen', this._boundRoutingPanelOpen);
    window.removeEventListener('keydown', this._boundKeydown);
    window.removeEventListener('resize', this._boundViewportChange);
    this._panel?.remove();
    this._control?.remove();
    this._map = undefined;
  }

  setExpanded(expanded: boolean) {
    this._expanded = Boolean(expanded);
    if (this._expanded) {
      this._map.getContainer().dispatchEvent(new CustomEvent('overlay-manager:panelopen'));
    }
    this._button.classList.toggle('maplibregl-ctrl-overlays-enabled', this._expanded);
    this._button.setAttribute('aria-expanded', this._expanded ? 'true' : 'false');
    this._panel.classList.toggle('overlay-manager-panel-visible', this._expanded);
    this._panel.setAttribute('aria-hidden', this._expanded ? 'false' : 'true');
    this._syncPanelInteractivity();
    this._syncDetails();
  }

  _syncPanelInteractivity() {
    if (!this._panel) return;
    for (const element of this._panel.querySelectorAll('button, input, select, textarea')) {
      (element as Element & { disabled: boolean }).disabled = !this._expanded;
    }
    if (this._expanded && this._isImportingUrl) {
      this._urlInput.disabled = true;
      this._urlSubmit.disabled = true;
    }
  }

  _registerOverlay(overlay: OverlayLike) {
    if (!overlay || !overlay.id || !OVERLAY_SOURCE_TYPES.has(overlay.type)) return;
    const remote = isRemoteOverlayEvent(overlay);
    const syncOverlayId =
      overlay.syncOverlayId || overlay.remoteOverlayId || (remote ? overlay.id : randomOverlaySyncId());
    const existingIndex = this._overlays.findIndex(
      (item) => item.id === overlay.id || (hasSyncOrigin(item) && item.syncOverlayId === syncOverlayId),
    );
    const normalized: OverlayLike = {
      color: DEFAULT_COLOR,
      opacity: 0.95,
      lineWidth: 5,
      visible: true,
      layerIds: [],
      syncOverlayId,
      ...overlay,
    };
    if (existingIndex === -1) {
      this._overlays.unshift(normalized);
      this._selectedId = normalized.id;
    } else {
      this._overlays[existingIndex] = { ...this._overlays[existingIndex], ...normalized };
    }
    if (remote) this._syncPanelInteractivity();
    else this.setExpanded(true);
    this._syncOverlayLayerOrder();
    this._render();
    if (!remote) this._emitOverlaySyncUpsert(normalized);
  }

  _emitOverlaySyncUpsert(overlay: OverlayLike) {
    if (!overlay?.data) return;
    this._map.getContainer().dispatchEvent(
      new CustomEvent('overlay-sync:local-upsert', {
        detail: { overlay },
      }),
    );
  }

  _emitOverlaySyncPatch(overlay: OverlayLike, patch: OverlayStylePatch | { name?: string; visible?: boolean }) {
    if (!overlay?.syncOverlayId) return;
    this._map.getContainer().dispatchEvent(
      new CustomEvent('overlay-sync:local-patch', {
        detail: { overlayId: overlay.syncOverlayId, patch },
      }),
    );
  }

  _emitOverlaySyncReorder() {
    this._map.getContainer().dispatchEvent(
      new CustomEvent('overlay-sync:local-reorder', {
        detail: {
          orderedIds: this._overlays.map((overlay) => overlay.syncOverlayId || overlay.id),
        },
      }),
    );
  }

  _emitOverlaySyncDelete(overlay: OverlayLike) {
    if (!overlay?.syncOverlayId) return;
    this._map.getContainer().dispatchEvent(
      new CustomEvent('overlay-sync:local-delete', {
        detail: { overlayId: overlay.syncOverlayId },
      }),
    );
  }

  _applyRemoteOverlayList(detail: OverlayListDetail) {
    const manifests = Array.isArray(detail?.overlays) ? detail.overlays : [];
    const order = new Map(manifests.map((manifest: OverlayLike, index: number) => [manifest.id, index]));
    const remoteIds = new Set(manifests.map((manifest: OverlayLike) => manifest.id));
    for (const overlay of this._overlays.slice()) {
      if (overlay.remoteOverlayId && !remoteIds.has(overlay.remoteOverlayId)) {
        this._removeOverlay(overlay, { emit: false });
      }
    }
    this._overlays.sort((a, b) => {
      const aOrder = order.has(a.remoteOverlayId || a.syncOverlayId)
        ? Number(order.get(a.remoteOverlayId || a.syncOverlayId))
        : Number.MAX_SAFE_INTEGER;
      const bOrder = order.has(b.remoteOverlayId || b.syncOverlayId)
        ? Number(order.get(b.remoteOverlayId || b.syncOverlayId))
        : Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });
    for (const manifest of manifests) {
      const overlay = this._overlays.find(
        (item) => item.remoteOverlayId === manifest.id || item.syncOverlayId === manifest.id,
      );
      if (!overlay) continue;
      const visibleChanged = overlay.visible !== (manifest.visible !== false);
      Object.assign(overlay, manifestOverlayMetadata(manifest), {
        syncOverlayId: manifest.id,
        remoteOverlayId: overlay.remoteOverlayId ? manifest.id : null,
      });
      if (visibleChanged) {
        for (const layerId of overlay.layerIds) {
          if (this._map.getLayer(layerId)) {
            this._map.setLayoutProperty(layerId, 'visibility', overlay.visible ? 'visible' : 'none');
          }
        }
      }
      if (manifest.type !== 'gpx' && manifest.subType !== 'osrm') this._applyOverlayStyle(overlay);
    }
    this._syncOverlayLayerOrder();
    this._render();
  }

  _addRemoteOverlay(detail: OverlayRemoteAddDetail) {
    const manifest = detail?.manifest;
    const content = detail?.content;
    if (!manifest || !content) return;
    if (
      this._overlays.some((overlay) => overlay.remoteOverlayId === manifest.id || overlay.syncOverlayId === manifest.id)
    )
      return;

    const overlay =
      manifest.type === 'gpx' && typeof content === 'string'
        ? addGpxToMap(this._map, content, {
            name: manifest.name,
            remote: true,
            remoteOverlayId: manifest.id,
            syncOverlayId: manifest.id,
            contentHash: manifest.contentHash,
          })
        : addGeoJsonToMap(this._map, content, {
            name: manifest.name,
            color: manifest.color,
            remote: true,
            remoteOverlayId: manifest.id,
            syncOverlayId: manifest.id,
            contentHash: manifest.contentHash,
          });
    if (!overlay) return;
    const local = this._overlays.find((item) => item.id === overlay.id);
    if (local) {
      Object.assign(local, manifestOverlayMetadata(manifest), {
        remoteOverlayId: manifest.id,
        syncOverlayId: manifest.id,
        contentHash: manifest.contentHash,
      });
      if (local.visible === false) {
        for (const layerId of local.layerIds) {
          if (this._map.getLayer(layerId)) this._map.setLayoutProperty(layerId, 'visibility', 'none');
        }
      }
      this._applyOverlayStyle(local);
      this._syncOverlayLayerOrder();
      this._render();
    }
  }

  async _importFiles(files: File[]) {
    const supported = files.filter((file) => /\.(gpx|geojson|json)$/i.test(file.name));
    if (supported.length === 0) {
      this._setStatus('No supported files');
      return;
    }

    let imported = 0;
    let bounds: OverlayBounds | null = null;
    this._setStatus('Importing...');

    for (const file of supported) {
      try {
        const text = await file.text();
        if (/\.gpx$/i.test(file.name)) {
          const result = await processOrQueueGpx(this._map, text, { name: file.name });
          if (result) {
            imported += 1;
            bounds = mergeBounds(bounds, asOverlayBounds(result.bounds));
          }
        } else {
          const result = processOrQueueGeoJson(this._map, JSON.parse(text), { name: file.name });
          if (result) {
            imported += 1;
            bounds = mergeBounds(bounds, asOverlayBounds(result.bounds));
          }
        }
      } catch (error) {
        console.error(`Failed to import overlay file: ${file.name}`, error);
      }
    }

    if (bounds) this._map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
    this._setStatus(imported > 0 ? `Imported ${imported}` : 'Import failed');
  }

  async _importUrl(value: string | null | undefined) {
    const url = String(value || '').trim();
    if (!url) {
      this._setStatus('Enter a URL');
      return;
    }

    const type = inferOverlayTypeFromUrl(url);
    this._isImportingUrl = true;
    this._syncPanelInteractivity();
    this._setStatus('Importing URL...');
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const name = importNameFromUrl(url, type === 'gpx' ? 'GPX URL' : 'GeoJSON URL');
      const result: OverlayImportResult =
        type === 'gpx'
          ? await processOrQueueGpx(this._map, await response.text(), { name })
          : (processOrQueueGeoJson(this._map, await response.json(), { name }) as OverlayImportResult);

      if (!result) {
        this._setStatus('Import failed');
        return;
      }
      const bounds = asOverlayBounds(result.bounds);
      if (bounds) this._map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      this._urlInput.value = '';
      this._setStatus('Imported URL');
    } catch (error) {
      console.error('Failed to import overlay URL:', url, error);
      this._setStatus('URL import failed');
    } finally {
      this._isImportingUrl = false;
      this._syncPanelInteractivity();
    }
  }

  _selectedOverlay() {
    return this._overlays.find((overlay) => overlay.id === this._selectedId) || null;
  }

  _selectOverlay(id: string) {
    this._selectedId = id;
    this._render();
  }

  _renameSelected(name: string) {
    const overlay = this._selectedOverlay();
    if (!overlay) return;
    overlay.name = name.replace(/\s+/g, ' ').trimStart() || formatOverlayType(overlay.type);
    this._renderList();
    this._syncDetails();
    this._emitOverlaySyncPatch(overlay, { name: overlay.name });
  }

  _updateSelectedStyle(changes: OverlayStylePatch) {
    const overlay = this._selectedOverlay();
    if (!overlay) return;
    if (overlay.type === 'gpx' || overlay.subType === 'osrm') return;
    if (changes.color) overlay.color = normalizeColor(changes.color, overlay.color);
    if (changes.opacity != null) overlay.opacity = clamp(changes.opacity, 0.2, 1);
    if (changes.lineWidth != null) overlay.lineWidth = clamp(changes.lineWidth, 1, 12);
    this._applyOverlayStyle(overlay);
    this._renderList();
    this._syncDetails();
    this._emitOverlaySyncPatch(overlay, {
      color: overlay.color,
      opacity: overlay.opacity,
      lineWidth: overlay.lineWidth,
    });
  }

  _toggleOverlayVisibility(overlay: OverlayLike) {
    overlay.visible = !overlay.visible;
    for (const layerId of overlay.layerIds) {
      if (this._map.getLayer(layerId)) {
        this._map.setLayoutProperty(layerId, 'visibility', overlay.visible ? 'visible' : 'none');
      }
    }
    this._renderList();
    this._syncDetails();
    this._emitOverlaySyncPatch(overlay, { visible: overlay.visible });
  }

  _applyOverlayStyle(overlay: OverlayLike) {
    if (overlay.type === 'gpx') return;
    const color = normalizeColor(overlay.color);
    const opacity = clamp(overlay.opacity, 0.2, 1);
    const lineWidth = clamp(overlay.lineWidth, 1, 12);
    const markerIcon = ensureMarkerIcon(this._map, color);

    for (const layerId of overlay.layerIds) {
      const layer = this._map.getLayer(layerId);
      if (!layer || !isManagedLayer(layer)) continue;

      if (layer.type === 'line') {
        if (/-osrm-segment$/.test(layerId)) {
          this._map.setPaintProperty(layerId, 'line-width', Math.max(2, lineWidth - 2));
          this._map.setPaintProperty(layerId, 'line-opacity', Math.min(0.8, opacity * 0.76));
        } else if (/-osrm-step$/.test(layerId)) {
          this._map.setPaintProperty(layerId, 'line-width', lineWidth + 4);
          this._map.setPaintProperty(layerId, 'line-opacity', 0.01);
        } else if (/-osrm-route-stroke$/.test(layerId)) {
          this._map.setPaintProperty(layerId, 'line-width', lineWidth + 3);
          this._map.setPaintProperty(layerId, 'line-opacity', Math.min(0.9, opacity));
        } else if (/-osrm-route$/.test(layerId)) {
          this._map.setPaintProperty(layerId, 'line-color', color);
          this._map.setPaintProperty(layerId, 'line-width', lineWidth);
          this._map.setPaintProperty(layerId, 'line-opacity', opacity);
        } else if (/-stroke$|line-stroke$/.test(layerId)) {
          this._map.setPaintProperty(layerId, 'line-width', lineWidth + 3);
          this._map.setPaintProperty(layerId, 'line-opacity', Math.min(0.9, opacity));
        } else if (/-gap-arc$/.test(layerId)) {
          this._map.setPaintProperty(layerId, 'line-opacity', Math.min(0.65, opacity));
        } else {
          const currentColor = this._map.getPaintProperty(layerId, 'line-color');
          this._map.setPaintProperty(layerId, 'line-color', withFallbackColor(currentColor || color, color));
          this._map.setPaintProperty(layerId, 'line-width', ['coalesce', ['get', 'line-width'], lineWidth]);
          this._map.setPaintProperty(layerId, 'line-opacity', opacity);
        }
      } else if (layer.type === 'fill') {
        this._map.setPaintProperty(layerId, 'fill-color', [
          'coalesce',
          ['get', 'fill'],
          ['get', 'marker-color'],
          color,
        ]);
        this._map.setPaintProperty(layerId, 'fill-opacity', Math.min(0.42, opacity * 0.42));
      } else if (layer.type === 'symbol') {
        if (markerIcon && !/-gap-arrow$/.test(layerId)) {
          this._map.setLayoutProperty(layerId, 'icon-image', markerIcon);
        }
        if (this._map.getPaintProperty(layerId, 'text-color') !== undefined) {
          this._map.setPaintProperty(layerId, 'text-color', color);
        }
        if (this._map.getPaintProperty(layerId, 'icon-opacity') !== undefined) {
          this._map.setPaintProperty(layerId, 'icon-opacity', opacity);
        }
      } else if (layer.type === 'circle' && /-osrm-maneuver$/.test(layerId)) {
        this._map.setPaintProperty(layerId, 'circle-stroke-color', color);
        this._map.setPaintProperty(layerId, 'circle-opacity', opacity);
        this._map.setPaintProperty(layerId, 'circle-stroke-opacity', opacity);
      }
    }
  }

  _removeSelected() {
    const overlay = this._selectedOverlay();
    if (!overlay) return;
    this._removeOverlay(overlay, { emit: true });
  }

  _removeOverlay(overlay: OverlayLike, { emit = true }: OverlayMutationOptions = {}) {
    for (const layerId of overlay.layerIds.slice().reverse()) {
      if (this._map.getLayer(layerId)) this._map.removeLayer(layerId);
    }
    if (this._map.getSource(overlay.sourceId)) this._map.removeSource(overlay.sourceId);
    this._overlays = this._overlays.filter((item) => item.id !== overlay.id);
    this._selectedId = this._overlays[0]?.id || null;
    this._render();
    if (emit) this._emitOverlaySyncDelete(overlay);
  }

  _deleteRemoteOverlay(remoteOverlayId?: string) {
    if (!remoteOverlayId) return;
    const overlay = this._overlays.find(
      (item) => item.remoteOverlayId === remoteOverlayId || item.syncOverlayId === remoteOverlayId,
    );
    if (overlay) this._removeOverlay(overlay, { emit: false });
  }

  _exportSelected() {
    const overlay = this._selectedOverlay();
    if (!overlay?.data) return;
    const baseName =
      overlay.name
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || overlay.id;
    exportJson(overlay.data, `${baseName}.geojson`);
  }

  _syncOverlayLayerOrder() {
    if (!this._map) return;
    for (const overlay of this._overlays.slice().reverse()) {
      for (const layerId of overlay.layerIds || []) {
        if (!this._map.getLayer(layerId)) continue;
        try {
          this._map.moveLayer(layerId);
        } catch (error) {
          console.warn(`Failed to reorder overlay layer: ${layerId}`, error);
        }
      }
    }
  }

  _moveOverlayToIndex(
    overlayId: string,
    destinationIndex: number,
    { render = true, sync = true }: MoveOverlayOptions = {},
  ) {
    const fromIndex = this._overlays.findIndex((overlay) => overlay.id === overlayId);
    if (fromIndex === -1) return false;

    const previousOrder = this._overlays.map((overlay) => overlay.id).join('\n');
    const [overlay] = this._overlays.splice(fromIndex, 1);
    const nextIndex = clamp(destinationIndex, 0, this._overlays.length);
    this._overlays.splice(nextIndex, 0, overlay);

    const changed = previousOrder !== this._overlays.map((item) => item.id).join('\n');
    if (!changed) return false;
    if (sync) this._syncOverlayLayerOrder();
    if (render) {
      this._renderList();
      this._syncDetails();
    }
    if (sync) this._emitOverlaySyncReorder();
    return true;
  }

  _focusReorderHandle(overlayId: string) {
    const list = this._list as HTMLElement;
    const row = Array.from(list.querySelectorAll<HTMLElement>('.overlay-manager-item')).find(
      (item) => item.dataset.overlayId === overlayId,
    );
    row?.querySelector<HTMLElement>('.overlay-manager-reorder-handle')?.focus();
  }

  _handleReorderKeydown(event: KeyboardEvent, overlayId: string) {
    const index = this._overlays.findIndex((overlay) => overlay.id === overlayId);
    if (index === -1) return;

    let destinationIndex: number | null = null;
    if (event.key === 'ArrowUp') destinationIndex = index - 1;
    if (event.key === 'ArrowDown') destinationIndex = index + 1;
    if (event.key === 'Home') destinationIndex = 0;
    if (event.key === 'End') destinationIndex = this._overlays.length - 1;
    if (destinationIndex == null) return;

    event.preventDefault();
    this._selectedId = overlayId;
    if (this._moveOverlayToIndex(overlayId, destinationIndex)) {
      this._focusReorderHandle(overlayId);
    }
  }

  _syncListSelection() {
    for (const row of this._list.querySelectorAll<HTMLElement>('.overlay-manager-item')) {
      row.classList.toggle('selected', row.dataset.overlayId === this._selectedId);
    }
  }

  _beginReorder(event: PointerEvent, overlayId: string) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    const row = handle.closest<HTMLElement>('.overlay-manager-item');
    if (!row) return;

    event.preventDefault();
    event.stopPropagation();
    this._selectedId = overlayId;
    this._syncListSelection();
    this._dragState = {
      id: overlayId,
      pointerId: event.pointerId,
      handle,
      row,
    };
    row.classList.add('reordering');
    this._list.classList.add('overlay-manager-list-reordering');
    handle.setPointerCapture?.(event.pointerId);
  }

  _updateReorder(event: PointerEvent) {
    const state = this._dragState;
    if (!state || state.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    const list = this._list as HTMLElement;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.overlay-manager-item')).filter(
      (row) => row !== state.row,
    );
    let destinationIndex = rows.length;
    for (let index = 0; index < rows.length; index += 1) {
      const rect = rows[index].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        destinationIndex = index;
        break;
      }
    }

    const nextSibling = rows[destinationIndex] || null;
    if (state.row.nextSibling !== nextSibling) {
      this._list.insertBefore(state.row, nextSibling);
    }
    this._moveOverlayToIndex(state.id, destinationIndex, { render: false, sync: false });
  }

  _finishReorder(event: PointerEvent | null) {
    const state = this._dragState;
    if (!state || (event && state.pointerId !== event.pointerId)) return;

    event?.preventDefault();
    event?.stopPropagation();
    if (state.handle.hasPointerCapture?.(state.pointerId)) {
      state.handle.releasePointerCapture(state.pointerId);
    }
    state.row.classList.remove('reordering');
    this._list.classList.remove('overlay-manager-list-reordering');
    this._dragState = null;
    this._syncOverlayLayerOrder();
    this._emitOverlaySyncReorder();
    this._renderList();
    this._syncDetails();
  }

  _setStatus(message: string) {
    window.clearTimeout(this._importStatusTimer);
    this._status.textContent = message;
    this._status.classList.toggle('visible', Boolean(message));
    if (message) {
      this._importStatusTimer = window.setTimeout(() => {
        this._status.textContent = '';
        this._status.classList.remove('visible');
      }, 2600);
    }
  }

  _handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (this._dragState) {
      this._finishReorder(null);
      return;
    }
    if (this._expanded) this.setExpanded(false);
  }

  _syncViewportMode() {
    this._panel.dataset.compact = window.matchMedia?.('(max-width: 640px)').matches ? 'true' : 'false';
  }

  _render() {
    if (!this._selectedId && this._overlays.length > 0) {
      this._selectedId = this._overlays[0].id;
    }
    this._summary.textContent =
      this._overlays.length === 0
        ? 'No overlays'
        : `${this._overlays.length} overlay${this._overlays.length === 1 ? '' : 's'}`;
    this._empty.hidden = this._overlays.length > 0;
    this._list.hidden = this._overlays.length === 0;
    this._details.hidden = this._overlays.length === 0;
    this._renderList();
    this._syncDetails();
  }

  _renderList() {
    while (this._list.firstChild) this._list.firstChild.remove();
    for (const overlay of this._overlays) {
      const row = el('div', 'overlay-manager-item', this._list);
      row.dataset.overlayId = overlay.id;
      row.classList.toggle('selected', overlay.id === this._selectedId);
      row.classList.toggle('muted', !overlay.visible);
      row.setAttribute('role', 'listitem');

      const reorder = el('button', 'overlay-manager-reorder-handle', row);
      reorder.type = 'button';
      reorder.title = 'Drag or use arrow keys to reorder';
      reorder.setAttribute('aria-label', `Reorder ${overlay.name}`);
      reorder.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Home End');
      appendIcon(reorder, GripVerticalIcon);
      reorder.addEventListener('pointerdown', (event) => this._beginReorder(event, overlay.id));
      reorder.addEventListener('pointermove', (event) => this._updateReorder(event));
      reorder.addEventListener('pointerup', (event) => this._finishReorder(event));
      reorder.addEventListener('pointercancel', (event) => this._finishReorder(event));
      reorder.addEventListener('keydown', (event) => this._handleReorderKeydown(event, overlay.id));

      const visibility = el('button', 'overlay-manager-icon-button', row);
      visibility.type = 'button';
      visibility.title = overlay.visible ? 'Hide overlay' : 'Show overlay';
      visibility.setAttribute('aria-label', visibility.title);
      visibility.classList.add('overlay-manager-visibility-button');
      visibility.classList.toggle('visible', overlay.visible);
      appendIcon(visibility, overlay.visible ? EyeIcon : EyeOffIcon);
      visibility.addEventListener('click', () => this._toggleOverlayVisibility(overlay));

      const main = el('button', 'overlay-manager-item-main', row);
      main.type = 'button';
      main.addEventListener('click', () => this._selectOverlay(overlay.id));
      const name = el('span', 'overlay-manager-item-name', main);
      name.textContent = overlay.name;
      const meta = el('span', 'overlay-manager-item-meta', main);
      meta.textContent = `${overlay.subType === 'osrm' ? 'OSRM' : formatOverlayType(overlay.type)} - ${formatOverlayMeta(overlay)}`;

      const zoom = el('button', 'overlay-manager-icon-button', row);
      zoom.type = 'button';
      zoom.title = 'Zoom to overlay';
      zoom.setAttribute('aria-label', 'Zoom to overlay');
      zoom.classList.add('overlay-manager-zoom-button');
      appendIcon(zoom, LocateFixedIcon);
      zoom.disabled = !overlay.bounds;
      zoom.addEventListener('click', () => fitOverlayBounds(this._map, overlay));
    }
  }

  _syncDetails() {
    const overlay = this._selectedOverlay();
    if (!overlay) {
      this._detailsTitle.textContent = '';
      this._nameInput.value = '';
      return;
    }

    this._detailsTitle.textContent = formatOverlayMeta(overlay);
    if (this._nameInput.value !== overlay.name) this._nameInput.value = overlay.name;

    const hasDataDrivenStyle = overlay.type === 'gpx' || overlay.subType === 'osrm';
    this._colorField.hidden = hasDataDrivenStyle;
    this._widthField.hidden = hasDataDrivenStyle;
    this._opacityField.hidden = hasDataDrivenStyle;
    const color = normalizeColor(overlay.color);
    this._customColor.value = color;
    for (const swatch of this._swatches.querySelectorAll<HTMLElement>('.overlay-manager-swatch')) {
      swatch.classList.toggle('selected', swatch.dataset.color === color);
    }

    const width = clamp(overlay.lineWidth, 1, 12);
    this._widthInput.value = String(width);
    this._widthValue.textContent = `${width}px`;

    const opacity = clamp(overlay.opacity, 0.2, 1);
    this._opacityInput.value = String(Math.round(opacity * 100));
    this._opacityValue.textContent = `${Math.round(opacity * 100)}%`;
    this._zoomButton.disabled = !overlay.bounds;
  }
}

function mergeBounds(a: OverlayBounds | null, b: BoundsLike | null | undefined): OverlayBounds | null {
  const next = asOverlayBounds(b);
  if (!a) return next;
  if (!next) return a;
  return [
    [Math.min(a[0][0], next[0][0]), Math.min(a[0][1], next[0][1])],
    [Math.max(a[1][0], next[1][0]), Math.max(a[1][1], next[1][1])],
  ];
}

export function installOverlayManager(map: OverlayMap) {
  map.addControl(new OverlayManagerControl(), 'top-right');
}
