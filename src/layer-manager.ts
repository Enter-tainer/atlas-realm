import {
  processOrQueueGpx,
  processOrQueueGeoJson,
  addGpxToMap,
  addGeoJsonToMap,
  isRemoteFileLayerEvent,
} from './gpx.js';
import { ANNOTATION_DEFAULT_LAYER_ID, createAnnotationId } from './annotation-model.js';
import { annotationRenderLayerIdList, annotationRenderSourceId } from './annotation-renderer.js';
import { initialSortKey } from './layer-model.js';
import { fileLayerManifestPatch } from './file-layer-sync.js';
import { emitUiPanelOpen, isOtherUiPanelOpen, UI_PANEL_OPEN_EVENT } from './ui-panels.js';
import createIconElement from 'lucide/dist/esm/createElement.mjs';
import DownloadIcon from 'lucide/dist/esm/icons/download.mjs';
import EyeIcon from 'lucide/dist/esm/icons/eye.mjs';
import EyeOffIcon from 'lucide/dist/esm/icons/eye-off.mjs';
import GripVerticalIcon from 'lucide/dist/esm/icons/grip-vertical.mjs';
import LayersIcon from 'lucide/dist/esm/icons/layers.mjs';
import LinkIcon from 'lucide/dist/esm/icons/link.mjs';
import LocateFixedIcon from 'lucide/dist/esm/icons/locate-fixed.mjs';
import PencilIcon from 'lucide/dist/esm/icons/pencil.mjs';
import PlusIcon from 'lucide/dist/esm/icons/plus.mjs';
import TrashIcon from 'lucide/dist/esm/icons/trash-2.mjs';
import UploadIcon from 'lucide/dist/esm/icons/upload.mjs';
import XIcon from 'lucide/dist/esm/icons/x.mjs';
import type { LayerStore, LayerStoreEvent } from './layer-store.js';

const DEFAULT_COLOR = '#3b82f6';
const DEFAULT_OPACITY = 0.95;
const DEFAULT_LINE_WIDTH = 5;
const GEOJSON_POLYGON_FILL_OPACITY = 0.18;
const GEOJSON_POLYGON_OUTLINE_OPACITY = 0.8;
const GEOJSON_POLYGON_OUTLINE_WIDTH = 2;
const COLOR_SWATCHES = ['#3b82f6', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899'];
const FILE_LAYER_SOURCE_TYPES = new Set(['gpx', 'geojson']);
const ANNOTATION_LAYER_ITEM_PREFIX = 'annotation-layer-';
const ANNOTATION_ACTIVE_LAYER_EVENT = 'annotation:activelayerchange';
type AnyRecord = Record<string | symbol, unknown>;
type LayerBounds = [[number, number], [number, number]];
type BoundsLike = readonly (readonly number[])[];
type LayerItemType = 'gpx' | 'geojson' | 'annotation';
type LayerItemData = object;
type LayerItemContent = string | object;
type LayerStyleValue = string | number | boolean | null | LayerStyleValue[];
type LayerFitBoundsOptions = {
  padding?: number | { top: number; right: number; bottom: number; left: number };
  maxZoom?: number;
  duration?: number;
};
type LayerEaseOptions = {
  center: [number, number];
  zoom: number;
  duration: number;
};
type MapControlLike = {
  onAdd(map: LayerManagerMap): HTMLElement;
  onRemove(): void;
};
type LayerItem = AnyRecord & {
  id: string;
  type: LayerItemType;
  subType?: string | null;
  sourceId?: string;
  layerIds: string[];
  name: string;
  color?: string;
  opacity?: number;
  lineWidth?: number;
  visible: boolean;
  bounds?: LayerBounds | null;
  data?: LayerItemData;
  syncLayerId?: string;
  remoteLayerId?: string | null;
  contentHash?: string;
  points?: number;
  p99Speed?: number;
  lines?: number;
  polygons?: number;
  features?: number;
  annotationLayerId?: string;
  distanceText?: string;
  durationText?: string;
  stepCount?: number;
  annotationSegmentCount?: number;
};
type MapStyleLayer = { source?: string; type?: string };
type LayerManagerMap = {
  addControl(control: MapControlLike, position?: string): void;
  getContainer(): HTMLElement;
  addSource(id: string, source: object): void;
  addLayer(layer: object): void;
  hasImage(name: string): boolean;
  addImage(name: string, image: ImageData, options?: { pixelRatio?: number }): void;
  fitBounds(bounds: LayerBounds, options?: LayerFitBoundsOptions): void;
  easeTo(options: LayerEaseOptions): void;
  getZoom(): number;
  getLayer(layerId: string): MapStyleLayer | undefined;
  getSource(sourceId?: string): object | undefined;
  setLayoutProperty(layerId: string, name: string, value: LayerStyleValue): void;
  setPaintProperty(layerId: string, name: string, value: LayerStyleValue): void;
  getPaintProperty(layerId: string, name: string): unknown;
  removeLayer(layerId: string): void;
  removeSource(sourceId?: string): void;
  moveLayer(layerId: string): void;
};
type LayerDragState = {
  id: string;
  pointerId: number;
  handle: HTMLElement;
  row: HTMLElement;
};
type LayerMutationOptions = { emit?: boolean };
type MoveLayerItemOptions = { render?: boolean; sync?: boolean };
type LayerStylePatch = {
  color?: string;
  opacity?: number;
  lineWidth?: number;
};
type FileLayerListDetail = { fileLayers?: LayerItem[] };
type FileLayerRemoteAddDetail = { manifest?: LayerItem; content?: LayerItemContent };
type FileLayerRemoteDeleteDetail = { layerId?: string };
type LayerImportResult = { bounds?: BoundsLike | null } | null;
type AnnotationLayerItemOptions = {
  force?: boolean;
  select?: boolean;
  render?: boolean;
};

function asLayerItemBounds(value: BoundsLike | null | undefined): LayerBounds | null {
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

function randomFileLayerSyncId() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `file-layer-${id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)}`;
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

function appendIcon(parent: Element, icon: LucideIcon, className = 'layer-manager-icon') {
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
  const labelNode = el('span', 'layer-manager-action-label', parent);
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

function formatLayerItemType(type: LayerItemType | string | null | undefined) {
  if (type === 'osrm') return 'OSRM';
  if (type === 'annotation') return 'Annotation';
  return type === 'gpx' ? 'GPX' : 'GeoJSON';
}

function formatLayerItemMeta(layerItem: LayerItem) {
  if (layerItem.type === 'annotation') {
    const count = Number(layerItem.features) || 0;
    return `${count} feature${count === 1 ? '' : 's'}`;
  }

  if (layerItem.subType === 'osrm') {
    const parts = [layerItem.distanceText, layerItem.durationText].filter(Boolean) as string[];
    if (Number.isFinite(layerItem.stepCount)) parts.push(`${layerItem.stepCount} steps`);
    if (Number.isFinite(layerItem.annotationSegmentCount))
      parts.push(`${layerItem.annotationSegmentCount} speed segments`);
    return parts.join(' - ') || 'OSRM route';
  }

  if (layerItem.type === 'gpx') {
    const parts: string[] = [];
    if (Number.isFinite(layerItem.points)) parts.push(`${layerItem.points} pts`);
    if (Number.isFinite(layerItem.p99Speed) && layerItem.p99Speed > 0) parts.push(`p99 ${layerItem.p99Speed} km/h`);
    return parts.join(' - ') || 'GPX track';
  }

  const parts: string[] = [];
  if (layerItem.lines) parts.push(`${layerItem.lines} lines`);
  if (layerItem.points) parts.push(`${layerItem.points} points`);
  if (layerItem.polygons) parts.push(`${layerItem.polygons} polygons`);
  return parts.join(' - ') || `${layerItem.features || 0} features`;
}

function fitLayerItemBounds(map: LayerManagerMap, layerItem: LayerItem | null | undefined) {
  if (!layerItem?.bounds) return;
  const [[minLng, minLat], [maxLng, maxLat]] = layerItem.bounds;
  if (minLng === maxLng && minLat === maxLat) {
    map.easeTo({ center: [minLng, minLat], zoom: Math.max(map.getZoom(), 14), duration: 450 });
    return;
  }
  map.fitBounds(layerItem.bounds, {
    padding: { top: 72, right: 72, bottom: 72, left: 72 },
    maxZoom: 16,
    duration: 450,
  });
}

function isLayerStyleValue(value: unknown): value is LayerStyleValue {
  return (
    value == null ||
    ['string', 'number', 'boolean'].includes(typeof value) ||
    (Array.isArray(value) && value.every(isLayerStyleValue))
  );
}

export function withFallbackColor(expression: unknown, color: string): LayerStyleValue {
  if (!isLayerStyleValue(expression)) return color;
  if (Array.isArray(expression)) {
    if (expression[0] === 'get' && (expression[1] === 'color' || expression[1] === 'stroke')) return expression;
    return expression.map((item) => withFallbackColor(item, color));
  }
  if (typeof expression === 'string' && /^#|^rgb|^hsl/.test(expression)) return color;
  return expression;
}

export function scaledGeoJsonFillOpacity(opacity: number | string | null | undefined) {
  return Math.min(
    GEOJSON_POLYGON_FILL_OPACITY,
    (clamp(opacity, 0.2, 1) * GEOJSON_POLYGON_FILL_OPACITY) / DEFAULT_OPACITY,
  );
}

export function scaledGeoJsonPolygonOutlineOpacity(opacity: number | string | null | undefined) {
  return Math.min(
    GEOJSON_POLYGON_OUTLINE_OPACITY,
    (clamp(opacity, 0.2, 1) * GEOJSON_POLYGON_OUTLINE_OPACITY) / DEFAULT_OPACITY,
  );
}

export function scaledGeoJsonPolygonOutlineWidth(lineWidth: number | string | null | undefined) {
  return Math.max(1, clamp(lineWidth, 1, 12) - (DEFAULT_LINE_WIDTH - GEOJSON_POLYGON_OUTLINE_WIDTH));
}

function exportJson(data: LayerItemData, filename: string) {
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

function inferLayerItemTypeFromUrl(url: string): LayerItemType {
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

function ensureMarkerIcon(map: LayerManagerMap, color: string) {
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

function isManagedLayer(layer: MapStyleLayer | undefined) {
  return layer?.source && /^(gpx-track-|geojson-layer-)/.test(layer.source);
}

function isAnnotationLayerItem(
  layerItem: LayerItem | null | undefined,
): layerItem is LayerItem & { type: 'annotation' } {
  return layerItem?.type === 'annotation';
}

function annotationLayerItemId(layerId: string) {
  return `${ANNOTATION_LAYER_ITEM_PREFIX}${layerId}`;
}

function isFileLayerItem(
  layerItem: LayerItem | null | undefined,
): layerItem is LayerItem & { type: 'gpx' | 'geojson' } {
  return layerItem?.type === 'gpx' || layerItem?.type === 'geojson';
}

function hasSyncOrigin(layerItem: LayerItem | null | undefined) {
  return Boolean(layerItem?.syncLayerId || layerItem?.remoteLayerId);
}

type LayerOrderLike = {
  id?: string;
  syncLayerId?: string;
  remoteLayerId?: string | null;
};
type LayerStackSyncItem = { kind: 'file'; layerId: string } | { kind: 'annotation'; layerId: string };

function layerItemSyncOrderId(layerItem: LayerOrderLike | null | undefined) {
  return layerItem?.remoteLayerId || layerItem?.syncLayerId || layerItem?.id || '';
}

function layerItemStoreLayerId(layerItem: LayerItem | null | undefined) {
  if (!layerItem) return '';
  if (isAnnotationLayerItem(layerItem)) return layerItem.annotationLayerId || ANNOTATION_DEFAULT_LAYER_ID;
  return layerItem.syncLayerId || layerItem.remoteLayerId || layerItem.id || '';
}

export function applyRemoteFileLayerManifestOrder<T extends LayerOrderLike>(
  layerItems: readonly T[],
  manifestIds: readonly string[],
): T[] {
  const order = new Map<string, number>();
  for (const id of manifestIds) {
    if (typeof id === 'string' && id && !order.has(id)) order.set(id, order.size);
  }
  if (order.size === 0) return layerItems.slice();

  return layerItems
    .map((layerItem, index) => ({ layerItem, index }))
    .sort((a, b) => {
      const aId = layerItemSyncOrderId(a.layerItem);
      const bId = layerItemSyncOrderId(b.layerItem);
      const aOrder = order.get(aId);
      const bOrder = order.get(bId);
      const aHasOrder = aOrder !== undefined;
      const bHasOrder = bOrder !== undefined;
      if (aHasOrder && bHasOrder) return aOrder - bOrder || a.index - b.index;
      if (aHasOrder) return -1;
      if (bHasOrder) return 1;
      return a.index - b.index;
    })
    .map((item) => item.layerItem);
}

export function layerStackSyncItems<
  T extends { id?: string; type?: string; syncLayerId?: string; annotationLayerId?: string },
>(layerItems: readonly T[]): LayerStackSyncItem[] {
  return layerItems
    .map((layerItem) =>
      layerItem.type === 'annotation'
        ? { kind: 'annotation' as const, layerId: layerItem.annotationLayerId || ANNOTATION_DEFAULT_LAYER_ID }
        : { kind: 'file' as const, layerId: layerItem.syncLayerId || layerItem.id || '' },
    )
    .filter((item) => Boolean(item.layerId));
}

function fileLayerManifestMetadata(manifest: LayerItem & { type: 'gpx' | 'geojson' }) {
  const metadata = fileLayerManifestPatch(manifest);
  delete metadata.id;
  return metadata;
}

class LayerManagerControl {
  _map: LayerManagerMap;
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
  _editButton: HTMLButtonElement;
  _exportButton: HTMLButtonElement;
  _deleteButton: HTMLButtonElement;
  _layerStore?: LayerStore;
  _unsubscribeLayerStore: (() => void) | null;
  _layerItems: LayerItem[];
  _selectedId: string | null;
  _expanded: boolean;
  _importStatusTimer: number;
  _isImportingUrl: boolean;
  _dragState: LayerDragState | null;
  _remoteFileLayerOrder: string[];
  _boundLayerAdded: (event: CustomEvent<LayerItem>) => void;
  _boundFileLayerRemoteAdd: (event: CustomEvent<FileLayerRemoteAddDetail>) => void;
  _boundFileLayerRemoteList: (event: CustomEvent<FileLayerListDetail>) => void;
  _boundFileLayerRemoteDelete: (event: CustomEvent<FileLayerRemoteDeleteDetail>) => void;
  _boundKeydown: (event: KeyboardEvent) => void;
  _boundReorderPointerMove: (event: PointerEvent) => void;
  _boundReorderPointerUp: (event: PointerEvent) => void;
  _boundReorderPointerCancel: (event: PointerEvent) => void;
  _boundViewportChange: () => void;
  _boundRoutingPanelOpen: () => void;
  _boundActiveLayerChange: (event: Event) => void;
  _boundAnyPanelOpen: (event: Event) => void;

  constructor(layerStore?: LayerStore) {
    this._layerStore = layerStore;
    this._unsubscribeLayerStore = null;
    this._layerItems = [];
    this._selectedId = null;
    this._expanded = false;
    this._importStatusTimer = 0;
    this._isImportingUrl = false;
    this._dragState = null;
    this._remoteFileLayerOrder = [];
    this._boundLayerAdded = (event) => this._registerLayerItem(event.detail);
    this._boundFileLayerRemoteAdd = (event) => this._addRemoteFileLayer(event.detail);
    this._boundFileLayerRemoteList = (event) => this._applyRemoteFileLayerList(event.detail);
    this._boundFileLayerRemoteDelete = (event) => this._deleteRemoteFileLayer(event.detail?.layerId);
    this._boundKeydown = (event) => this._handleKeydown(event);
    this._boundReorderPointerMove = (event) => this._updateReorder(event);
    this._boundReorderPointerUp = (event) => this._finishReorder(event);
    this._boundReorderPointerCancel = (event) => this._finishReorder(event);
    this._boundViewportChange = () => this._syncViewportMode();
    this._boundRoutingPanelOpen = () => this.setExpanded(false);
    this._boundActiveLayerChange = (event) => this._handleActiveLayerChange(event);
    this._boundAnyPanelOpen = (event) => {
      if (isOtherUiPanelOpen(event, 'layers')) this.setExpanded(false);
    };
  }

  onAdd(map: LayerManagerMap) {
    this._map = map;
    this._control = el('div', 'maplibregl-ctrl maplibregl-ctrl-group layer-manager-control');
    this._button = el('button', 'maplibregl-ctrl-layers', this._control);
    this._button.type = 'button';
    this._button.title = 'Layers';
    this._button.setAttribute('aria-label', 'Layers');
    this._button.setAttribute('aria-expanded', 'false');
    appendIcon(this._button, LayersIcon);
    this._button.addEventListener('click', () => this.setExpanded(!this._expanded));

    this._panel = el('section', 'layer-manager-panel', map.getContainer());
    this._panel.setAttribute('aria-label', 'Layer manager');
    this._panel.setAttribute('aria-hidden', 'true');
    stopMapControlPropagation(this._panel);

    const header = el('div', 'layer-manager-header', this._panel);
    const titleWrap = el('div', 'layer-manager-title-wrap', header);
    this._title = el('div', 'layer-manager-title', titleWrap);
    this._title.textContent = 'Layers';
    this._summary = el('div', 'layer-manager-summary', titleWrap);

    this._importButton = el('button', 'layer-manager-import', header);
    this._importButton.type = 'button';
    this._importButton.title = 'New annotation layer';
    this._importButton.setAttribute('aria-label', 'New annotation layer');
    appendIcon(this._importButton, PlusIcon);
    this._importButton.addEventListener('click', () => this._createAnnotationLayer());

    this._closeButton = el('button', 'layer-manager-close', header);
    this._closeButton.type = 'button';
    this._closeButton.title = 'Close layers';
    this._closeButton.setAttribute('aria-label', 'Close layers');
    appendIcon(this._closeButton, XIcon);
    this._closeButton.addEventListener('click', () => this.setExpanded(false));

    const body = el('div', 'layer-manager-body', this._panel);
    const importRow = el('div', 'layer-manager-import-row', body);
    this._dropZone = el('button', 'layer-manager-dropzone', importRow);
    this._dropZone.type = 'button';
    appendIcon(this._dropZone, UploadIcon);
    const dropZoneText = el('span', 'layer-manager-dropzone-label', this._dropZone);
    dropZoneText.textContent = 'Import GPX / GeoJSON';
    this._dropZone.addEventListener('click', () => this._fileInput.click());
    this._fileInput = el('input', 'layer-manager-file-input', importRow);
    this._fileInput.type = 'file';
    this._fileInput.accept = '.gpx,.geojson,.json,application/geo+json,application/json';
    this._fileInput.multiple = true;
    this._fileInput.addEventListener('change', () => {
      const files = Array.from(this._fileInput.files || []);
      this._fileInput.value = '';
      this._importFiles(files);
    });

    this._urlForm = el('form', 'layer-manager-url-form', body);
    this._urlInput = el('input', 'layer-manager-url-input', this._urlForm);
    this._urlInput.type = 'url';
    this._urlInput.placeholder = 'https://example.com/track.gpx';
    this._urlInput.autocomplete = 'off';
    this._urlInput.spellcheck = false;
    this._urlInput.setAttribute('aria-label', 'Layer URL');
    this._urlSubmit = el('button', 'layer-manager-url-submit', this._urlForm);
    this._urlSubmit.type = 'submit';
    this._urlSubmit.title = 'Import from URL';
    this._urlSubmit.setAttribute('aria-label', 'Import from URL');
    appendIcon(this._urlSubmit, LinkIcon);
    this._urlForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this._importUrl(this._urlInput.value);
    });

    this._status = el('div', 'layer-manager-status', body);
    this._status.setAttribute('role', 'status');
    this._status.setAttribute('aria-live', 'polite');

    this._empty = el('div', 'layer-manager-empty', body);
    this._empty.textContent = 'No layers yet';
    this._list = el('div', 'layer-manager-list', body);
    this._list.setAttribute('role', 'list');

    this._details = el('div', 'layer-manager-details', body);
    this._detailsTitle = el('div', 'layer-manager-details-title', this._details);

    const nameField = el('label', 'layer-manager-field', this._details);
    const nameLabel = el('span', 'layer-manager-field-label', nameField);
    nameLabel.textContent = 'Name';
    this._nameInput = el('input', 'layer-manager-name-input', nameField);
    this._nameInput.type = 'text';
    this._nameInput.maxLength = 80;
    this._nameInput.addEventListener('input', () => this._renameSelected(this._nameInput.value));

    this._colorField = el('div', 'layer-manager-field', this._details);
    const colorLabel = el('span', 'layer-manager-field-label', this._colorField);
    colorLabel.textContent = 'Color';
    this._swatches = el('div', 'layer-manager-swatches', this._colorField);
    for (const swatchColor of COLOR_SWATCHES) {
      const swatch = el('button', 'layer-manager-swatch', this._swatches);
      swatch.type = 'button';
      swatch.title = swatchColor;
      swatch.style.backgroundColor = swatchColor;
      swatch.dataset.color = swatchColor;
      swatch.addEventListener('click', () => this._updateSelectedStyle({ color: swatchColor }));
    }
    this._customColor = el('input', 'layer-manager-color-input', this._colorField);
    this._customColor.type = 'color';
    this._customColor.value = DEFAULT_COLOR;
    this._customColor.addEventListener('input', () => this._updateSelectedStyle({ color: this._customColor.value }));

    this._widthField = el('label', 'layer-manager-field', this._details);
    const widthHeader = el('span', 'layer-manager-field-row', this._widthField);
    const widthLabel = el('span', 'layer-manager-field-label', widthHeader);
    widthLabel.textContent = 'Width';
    this._widthValue = el('span', 'layer-manager-value', widthHeader);
    this._widthInput = el('input', 'layer-manager-range', this._widthField);
    this._widthInput.type = 'range';
    this._widthInput.min = '1';
    this._widthInput.max = '12';
    this._widthInput.step = '1';
    this._widthInput.addEventListener('input', () =>
      this._updateSelectedStyle({ lineWidth: Number(this._widthInput.value) }),
    );

    this._opacityField = el('label', 'layer-manager-field', this._details);
    const opacityHeader = el('span', 'layer-manager-field-row', this._opacityField);
    const opacityLabel = el('span', 'layer-manager-field-label', opacityHeader);
    opacityLabel.textContent = 'Opacity';
    this._opacityValue = el('span', 'layer-manager-value', opacityHeader);
    this._opacityInput = el('input', 'layer-manager-range', this._opacityField);
    this._opacityInput.type = 'range';
    this._opacityInput.min = '20';
    this._opacityInput.max = '100';
    this._opacityInput.step = '5';
    this._opacityInput.addEventListener('input', () =>
      this._updateSelectedStyle({ opacity: Number(this._opacityInput.value) / 100 }),
    );

    const detailActions = el('div', 'layer-manager-detail-actions', this._details);
    this._zoomButton = el('button', 'layer-manager-action', detailActions);
    this._zoomButton.type = 'button';
    appendIconLabel(this._zoomButton, LocateFixedIcon, 'Zoom');
    this._zoomButton.addEventListener('click', () => fitLayerItemBounds(this._map, this._selectedLayerItem()));

    this._editButton = el('button', 'layer-manager-action layer-manager-edit', detailActions);
    this._editButton.type = 'button';
    appendIconLabel(this._editButton, PencilIcon, 'Edit');
    this._editButton.addEventListener('click', () => this._editSelected());

    this._exportButton = el('button', 'layer-manager-action', detailActions);
    this._exportButton.type = 'button';
    appendIconLabel(this._exportButton, DownloadIcon, 'Export');
    this._exportButton.addEventListener('click', () => this._exportSelected());

    this._deleteButton = el('button', 'layer-manager-action layer-manager-danger', detailActions);
    this._deleteButton.type = 'button';
    appendIconLabel(this._deleteButton, TrashIcon, 'Delete');
    this._deleteButton.addEventListener('click', () => this._removeSelected());

    this._panel.addEventListener('dragover', (event) => {
      event.preventDefault();
      this._panel.classList.add('layer-manager-dragging');
    });
    this._panel.addEventListener('dragleave', () => this._panel.classList.remove('layer-manager-dragging'));
    this._panel.addEventListener('drop', (event) => {
      event.preventDefault();
      this._panel.classList.remove('layer-manager-dragging');
      this._importFiles(Array.from(event.dataTransfer?.files || []));
    });

    map.getContainer().addEventListener('layer:add', this._boundLayerAdded);
    map.getContainer().addEventListener('layer-sync:remote-add', this._boundFileLayerRemoteAdd);
    map.getContainer().addEventListener('layer-sync:remote-list', this._boundFileLayerRemoteList);
    map.getContainer().addEventListener('layer-sync:remote-delete', this._boundFileLayerRemoteDelete);
    map.getContainer().addEventListener('routing:panelopen', this._boundRoutingPanelOpen);
    map.getContainer().addEventListener(ANNOTATION_ACTIVE_LAYER_EVENT, this._boundActiveLayerChange);
    map.getContainer().addEventListener(UI_PANEL_OPEN_EVENT, this._boundAnyPanelOpen);
    window.addEventListener('keydown', this._boundKeydown);
    window.addEventListener('resize', this._boundViewportChange, { passive: true });
    this._unsubscribeLayerStore = this._layerStore?.subscribe((event) => this._handleLayerStoreEvent(event)) || null;
    this._upsertAnnotationLayerItems({ force: true, render: false });
    this._syncViewportMode();
    this._syncPanelInteractivity();
    this._render();
    return this._control;
  }

  onRemove() {
    this._map.getContainer().removeEventListener('layer:add', this._boundLayerAdded);
    this._map.getContainer().removeEventListener('layer-sync:remote-add', this._boundFileLayerRemoteAdd);
    this._map.getContainer().removeEventListener('layer-sync:remote-list', this._boundFileLayerRemoteList);
    this._map.getContainer().removeEventListener('layer-sync:remote-delete', this._boundFileLayerRemoteDelete);
    this._map.getContainer().removeEventListener('routing:panelopen', this._boundRoutingPanelOpen);
    this._map.getContainer().removeEventListener(ANNOTATION_ACTIVE_LAYER_EVENT, this._boundActiveLayerChange);
    this._map.getContainer().removeEventListener(UI_PANEL_OPEN_EVENT, this._boundAnyPanelOpen);
    this._cancelReorderListeners();
    window.removeEventListener('keydown', this._boundKeydown);
    window.removeEventListener('resize', this._boundViewportChange);
    this._unsubscribeLayerStore?.();
    this._unsubscribeLayerStore = null;
    this._map.getContainer().dataset.layerManagerPanelOpen = 'false';
    this._panel?.remove();
    this._control?.remove();
    this._map = undefined;
  }

  setExpanded(expanded: boolean) {
    this._expanded = Boolean(expanded);
    if (this._expanded) {
      emitUiPanelOpen(this._map.getContainer(), 'layers');
      this._map.getContainer().dispatchEvent(new CustomEvent('layer-manager:panelopen'));
    }
    this._button.classList.toggle('maplibregl-ctrl-layers-enabled', this._expanded);
    this._button.setAttribute('aria-expanded', this._expanded ? 'true' : 'false');
    this._panel.classList.toggle('layer-manager-panel-visible', this._expanded);
    this._panel.setAttribute('aria-hidden', this._expanded ? 'false' : 'true');
    this._map.getContainer().dataset.layerManagerPanelOpen = this._expanded ? 'true' : 'false';
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

  _registerLayerItem(layerItem: LayerItem) {
    if (!layerItem || !layerItem.id || !FILE_LAYER_SOURCE_TYPES.has(layerItem.type)) return;
    const remote = isRemoteFileLayerEvent(layerItem);
    const syncLayerId =
      layerItem.syncLayerId || layerItem.remoteLayerId || (remote ? layerItem.id : randomFileLayerSyncId());
    const existingIndex = this._layerItems.findIndex(
      (item) => item.id === layerItem.id || (hasSyncOrigin(item) && item.syncLayerId === syncLayerId),
    );
    const normalized: LayerItem = {
      color: DEFAULT_COLOR,
      opacity: DEFAULT_OPACITY,
      lineWidth: DEFAULT_LINE_WIDTH,
      visible: true,
      layerIds: [],
      syncLayerId,
      ...layerItem,
    };
    if (existingIndex === -1) {
      this._layerItems.unshift(normalized);
      this._selectedId = normalized.id;
    } else {
      this._layerItems[existingIndex] = { ...this._layerItems[existingIndex], ...normalized };
    }
    if (remote) this._sortLayerItemsByRemoteManifestOrder();
    else this._placeLayerItemsByLayerSortOrder();
    if (remote) this._syncPanelInteractivity();
    else this.setExpanded(true);
    this._syncMapStyleLayerOrder();
    this._render();
    if (!remote) this._emitLayerSyncUpsert(normalized);
  }

  _handleLayerStoreEvent(_event: LayerStoreEvent) {
    this._upsertAnnotationLayerItems({ force: true, render: true });
  }

  _upsertAnnotationLayerItems({ force = false, select = false, render = true }: AnnotationLayerItemOptions = {}) {
    if (!this._layerStore) return;
    const layers = this._layerStore.getAnnotationLayers();
    const liveLayerItemIds = new Set<string>();
    for (const [layerOrder, layer] of layers.entries()) {
      const layerId = layer.id;
      const layerItemId = annotationLayerItemId(layerId);
      liveLayerItemIds.add(layerItemId);
      const featureCount = this._layerStore.getAnnotationFeatureCount(layerId);
      const existingIndex = this._layerItems.findIndex((layerItem) => layerItem.id === layerItemId);
      if (!force && existingIndex === -1 && featureCount === 0) continue;

      const layerItem: LayerItem = {
        id: layerItemId,
        type: 'annotation',
        subType: 'annotation',
        name: layer.name || 'Annotations',
        color: DEFAULT_COLOR,
        opacity: 1,
        lineWidth: 4,
        visible: layer.visible !== false,
        bounds: this._layerStore.getLayerBounds(layerId),
        data: this._layerStore.getLayerGeoJson(layerId, { includeHidden: true }),
        sourceId: annotationRenderSourceId(layerId),
        layerIds: annotationRenderLayerIdList(layerId),
        annotationLayerId: layerId,
        features: featureCount,
      };

      if (existingIndex === -1) {
        const index = layerOrder === -1 ? this._layerItems.length : Math.min(this._layerItems.length, layerOrder);
        this._layerItems.splice(index, 0, layerItem);
      } else {
        this._layerItems[existingIndex] = { ...this._layerItems[existingIndex], ...layerItem };
      }
      this._applyAnnotationVisibility(layerItem);
    }
    this._layerItems = this._layerItems.filter(
      (layerItem) => !isAnnotationLayerItem(layerItem) || liveLayerItemIds.has(layerItem.id),
    );
    this._placeLayerItemsByLayerSortOrder();
    if (select || !this._selectedId || !this._layerItems.some((layerItem) => layerItem.id === this._selectedId)) {
      this._selectedId = this._layerItems[0]?.id || null;
    }
    this._syncMapStyleLayerOrder();
    if (render) this._render();
  }

  _applyAnnotationVisibility(layerItem: LayerItem) {
    if (!isAnnotationLayerItem(layerItem)) return;
    for (const layerId of layerItem.layerIds) {
      if (this._map.getLayer(layerId)) {
        this._map.setLayoutProperty(layerId, 'visibility', layerItem.visible ? 'visible' : 'none');
      }
    }
  }

  _emitLayerSyncUpsert(layerItem: LayerItem) {
    if (!layerItem?.data) return;
    const index = Math.max(
      0,
      this._layerItems.findIndex((item) => item.id === layerItem.id),
    );
    this._map.getContainer().dispatchEvent(
      new CustomEvent('layer-sync:local-upsert', {
        detail: { layer: { ...layerItem, sortKey: initialSortKey(index) } },
      }),
    );
  }

  _emitLayerSyncPatch(layerItem: LayerItem, patch: LayerStylePatch | { name?: string; visible?: boolean }) {
    if (isAnnotationLayerItem(layerItem)) return;
    if (!layerItem?.syncLayerId) return;
    this._map.getContainer().dispatchEvent(
      new CustomEvent('layer-sync:local-patch', {
        detail: { layerId: layerItem.syncLayerId, patch },
      }),
    );
  }

  _emitLayerSyncReorder() {
    this._map.getContainer().dispatchEvent(
      new CustomEvent('layer-sync:local-reorder', {
        detail: {
          stackItems: layerStackSyncItems(this._layerItems),
        },
      }),
    );
  }

  _emitLayerSyncDelete(layerItem: LayerItem) {
    if (isAnnotationLayerItem(layerItem)) return;
    if (!layerItem?.syncLayerId) return;
    this._map.getContainer().dispatchEvent(
      new CustomEvent('layer-sync:local-delete', {
        detail: { layerId: layerItem.syncLayerId },
      }),
    );
  }

  _applyRemoteFileLayerList(detail: FileLayerListDetail) {
    const manifests = Array.isArray(detail?.fileLayers) ? detail.fileLayers : [];
    this._remoteFileLayerOrder = manifests.map((manifest: LayerItem) => manifest.id).filter(Boolean);
    const remoteIds = new Set(manifests.map((manifest: LayerItem) => manifest.id));
    for (const layerItem of this._layerItems.slice()) {
      if (isAnnotationLayerItem(layerItem)) continue;
      if (layerItem.remoteLayerId && !remoteIds.has(layerItem.remoteLayerId)) {
        this._removeLayerItem(layerItem, { emit: false });
      }
    }
    for (const manifest of manifests) {
      if (!isFileLayerItem(manifest)) continue;
      const layerItem = this._layerItems.find(
        (item) => item.remoteLayerId === manifest.id || item.syncLayerId === manifest.id,
      );
      if (!layerItem) continue;
      const visibleChanged = layerItem.visible !== (manifest.visible !== false);
      Object.assign(layerItem, fileLayerManifestMetadata(manifest), {
        syncLayerId: manifest.id,
        remoteLayerId: layerItem.remoteLayerId ? manifest.id : null,
      });
      if (visibleChanged) {
        for (const layerId of layerItem.layerIds) {
          if (this._map.getLayer(layerId)) {
            this._map.setLayoutProperty(layerId, 'visibility', layerItem.visible ? 'visible' : 'none');
          }
        }
      }
      if (manifest.type !== 'gpx' && manifest.subType !== 'osrm') this._applyFileLayerStyle(layerItem);
    }
    this._sortLayerItemsByRemoteManifestOrder();
    this._syncMapStyleLayerOrder();
    this._render();
  }

  _addRemoteFileLayer(detail: FileLayerRemoteAddDetail) {
    const manifest = detail?.manifest;
    const content = detail?.content;
    if (!manifest || !content) return;
    if (!isFileLayerItem(manifest)) return;
    if (
      this._layerItems.some(
        (layerItem) => layerItem.remoteLayerId === manifest.id || layerItem.syncLayerId === manifest.id,
      )
    )
      return;

    const layerItem =
      manifest.type === 'gpx' && typeof content === 'string'
        ? addGpxToMap(this._map, content, {
            name: manifest.name,
            remote: true,
            remoteLayerId: manifest.id,
            syncLayerId: manifest.id,
            contentHash: manifest.contentHash,
          })
        : addGeoJsonToMap(this._map, content, {
            name: manifest.name,
            color: manifest.color,
            remote: true,
            remoteLayerId: manifest.id,
            syncLayerId: manifest.id,
            contentHash: manifest.contentHash,
          });
    if (!layerItem) return;
    const local = this._layerItems.find((item) => item.id === layerItem.id);
    if (local) {
      Object.assign(local, fileLayerManifestMetadata(manifest), {
        remoteLayerId: manifest.id,
        syncLayerId: manifest.id,
        contentHash: manifest.contentHash,
      });
      if (local.visible === false) {
        for (const layerId of local.layerIds) {
          if (this._map.getLayer(layerId)) this._map.setLayoutProperty(layerId, 'visibility', 'none');
        }
      }
      this._applyFileLayerStyle(local);
      this._sortLayerItemsByRemoteManifestOrder();
      this._syncMapStyleLayerOrder();
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
    let bounds: LayerBounds | null = null;
    this._setStatus('Importing...');

    for (const file of supported) {
      try {
        const text = await file.text();
        if (/\.gpx$/i.test(file.name)) {
          const result = await processOrQueueGpx(this._map, text, { name: file.name });
          if (result) {
            imported += 1;
            bounds = mergeBounds(bounds, asLayerItemBounds(result.bounds));
          }
        } else {
          const result = processOrQueueGeoJson(this._map, JSON.parse(text), { name: file.name });
          if (result) {
            imported += 1;
            bounds = mergeBounds(bounds, asLayerItemBounds(result.bounds));
          }
        }
      } catch (error) {
        console.error(`Failed to import layer file: ${file.name}`, error);
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

    const type = inferLayerItemTypeFromUrl(url);
    this._isImportingUrl = true;
    this._syncPanelInteractivity();
    this._setStatus('Importing URL...');
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const name = importNameFromUrl(url, type === 'gpx' ? 'GPX URL' : 'GeoJSON URL');
      const result: LayerImportResult =
        type === 'gpx'
          ? await processOrQueueGpx(this._map, await response.text(), { name })
          : (processOrQueueGeoJson(this._map, await response.json(), { name }) as LayerImportResult);

      if (!result) {
        this._setStatus('Import failed');
        return;
      }
      const bounds = asLayerItemBounds(result.bounds);
      if (bounds) this._map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      this._urlInput.value = '';
      this._setStatus('Imported URL');
    } catch (error) {
      console.error('Failed to import layer URL:', url, error);
      this._setStatus('URL import failed');
    } finally {
      this._isImportingUrl = false;
      this._syncPanelInteractivity();
    }
  }

  _selectedLayerItem() {
    return this._layerItems.find((layerItem) => layerItem.id === this._selectedId) || null;
  }

  _selectLayerItem(id: string) {
    this._selectedId = id;
    const layerItem = this._selectedLayerItem();
    if (isAnnotationLayerItem(layerItem)) {
      this._map.getContainer().dispatchEvent(
        new CustomEvent(ANNOTATION_ACTIVE_LAYER_EVENT, {
          detail: { layerId: layerItem.annotationLayerId || ANNOTATION_DEFAULT_LAYER_ID },
        }),
      );
    }
    this._render();
  }

  _handleActiveLayerChange(event: Event) {
    const layerId = (event as CustomEvent<{ layerId?: unknown }>).detail?.layerId;
    if (typeof layerId !== 'string') return;
    const layerItemId = annotationLayerItemId(layerId);
    if (!this._layerItems.some((layerItem) => layerItem.id === layerItemId)) {
      this._upsertAnnotationLayerItems({ force: true, render: false });
    }
    if (!this._layerItems.some((layerItem) => layerItem.id === layerItemId) || this._selectedId === layerItemId) return;
    this._selectedId = layerItemId;
    this._renderList();
    this._syncDetails();
  }

  _createAnnotationLayer() {
    if (!this._layerStore) return;
    const now = Date.now();
    const layerId = createAnnotationId('annotation-layer');
    const count = this._layerStore.getAnnotationLayers().length + 1;
    const layer = this._layerStore.upsertLayer({
      id: layerId,
      name: `Annotations ${count}`,
      visible: true,
      sortKey: initialSortKey(this._layerItems.length),
      kind: 'annotation',
      payload: { version: 1 },
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    if (!layer) return;
    this._selectedId = annotationLayerItemId(layer.id);
    this._upsertAnnotationLayerItems({ force: true, select: true, render: true });
    this._map
      .getContainer()
      .dispatchEvent(new CustomEvent(ANNOTATION_ACTIVE_LAYER_EVENT, { detail: { layerId: layer.id } }));
  }

  _renameSelected(name: string) {
    const layerItem = this._selectedLayerItem();
    if (!layerItem) return;
    layerItem.name = name.replace(/\s+/g, ' ').trimStart() || formatLayerItemType(layerItem.type);
    if (isAnnotationLayerItem(layerItem)) {
      this._layerStore?.patchLayer(layerItem.annotationLayerId || ANNOTATION_DEFAULT_LAYER_ID, {
        name: layerItem.name,
      });
    }
    this._renderList();
    this._syncDetails();
    this._emitLayerSyncPatch(layerItem, { name: layerItem.name });
  }

  _updateSelectedStyle(changes: LayerStylePatch) {
    const layerItem = this._selectedLayerItem();
    if (!layerItem) return;
    if (layerItem.type === 'gpx' || layerItem.subType === 'osrm') return;
    if (changes.color) layerItem.color = normalizeColor(changes.color, layerItem.color);
    if (changes.opacity != null) layerItem.opacity = clamp(changes.opacity, 0.2, 1);
    if (changes.lineWidth != null) layerItem.lineWidth = clamp(changes.lineWidth, 1, 12);
    this._applyFileLayerStyle(layerItem);
    this._renderList();
    this._syncDetails();
    this._emitLayerSyncPatch(layerItem, {
      color: layerItem.color,
      opacity: layerItem.opacity,
      lineWidth: layerItem.lineWidth,
    });
  }

  _toggleLayerItemVisibility(layerItem: LayerItem) {
    layerItem.visible = !layerItem.visible;
    if (isAnnotationLayerItem(layerItem)) {
      this._layerStore?.patchLayer(layerItem.annotationLayerId || ANNOTATION_DEFAULT_LAYER_ID, {
        visible: layerItem.visible,
      });
    }
    for (const layerId of layerItem.layerIds) {
      if (this._map.getLayer(layerId)) {
        this._map.setLayoutProperty(layerId, 'visibility', layerItem.visible ? 'visible' : 'none');
      }
    }
    this._renderList();
    this._syncDetails();
    this._emitLayerSyncPatch(layerItem, { visible: layerItem.visible });
  }

  _applyFileLayerStyle(layerItem: LayerItem) {
    if (layerItem.type === 'gpx') return;
    const color = normalizeColor(layerItem.color);
    const opacity = clamp(layerItem.opacity, 0.2, 1);
    const lineWidth = clamp(layerItem.lineWidth, 1, 12);
    const markerIcon = ensureMarkerIcon(this._map, color);

    for (const layerId of layerItem.layerIds) {
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
        } else if (/-polygon-outline$/.test(layerId)) {
          const currentColor = this._map.getPaintProperty(layerId, 'line-color');
          this._map.setPaintProperty(layerId, 'line-color', withFallbackColor(currentColor || color, color));
          this._map.setPaintProperty(layerId, 'line-width', [
            'coalesce',
            ['get', 'stroke-width'],
            scaledGeoJsonPolygonOutlineWidth(lineWidth),
          ]);
          this._map.setPaintProperty(layerId, 'line-opacity', scaledGeoJsonPolygonOutlineOpacity(opacity));
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
        this._map.setPaintProperty(layerId, 'fill-opacity', scaledGeoJsonFillOpacity(opacity));
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
    const layerItem = this._selectedLayerItem();
    if (!layerItem) return;
    this._removeLayerItem(layerItem, { emit: true });
  }

  _removeLayerItem(layerItem: LayerItem, { emit = true }: LayerMutationOptions = {}) {
    if (isAnnotationLayerItem(layerItem)) {
      const layerId = layerItem.annotationLayerId || ANNOTATION_DEFAULT_LAYER_ID;
      if (layerId === ANNOTATION_DEFAULT_LAYER_ID) {
        this._layerStore?.clearLayer(layerId, { hidden: true });
        this._selectedId = layerItem.id;
      } else {
        this._layerStore?.deleteLayer(layerId);
        this._layerItems = this._layerItems.filter((item) => item.id !== layerItem.id);
        this._selectedId = this._layerItems[0]?.id || null;
      }
      this._upsertAnnotationLayerItems({ force: true, render: true });
      return;
    }
    for (const layerId of layerItem.layerIds.slice().reverse()) {
      if (this._map.getLayer(layerId)) this._map.removeLayer(layerId);
    }
    if (this._map.getSource(layerItem.sourceId)) this._map.removeSource(layerItem.sourceId);
    this._layerItems = this._layerItems.filter((item) => item.id !== layerItem.id);
    this._selectedId = this._layerItems[0]?.id || null;
    this._render();
    if (emit) this._emitLayerSyncDelete(layerItem);
  }

  _deleteRemoteFileLayer(remoteLayerId?: string) {
    if (!remoteLayerId) return;
    const layerItem = this._layerItems.find(
      (item) => item.remoteLayerId === remoteLayerId || item.syncLayerId === remoteLayerId,
    );
    if (layerItem) this._removeLayerItem(layerItem, { emit: false });
  }

  _exportSelected() {
    const layerItem = this._selectedLayerItem();
    if (!layerItem?.data) return;
    const baseName =
      layerItem.name
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || layerItem.id;
    exportJson(layerItem.data, `${baseName}.geojson`);
  }

  _editSelected() {
    const layerItem = this._selectedLayerItem();
    if (!isAnnotationLayerItem(layerItem)) return;
    this.setExpanded(false);
    this._map.getContainer().dispatchEvent(
      new CustomEvent('annotation:open', {
        detail: { layerId: layerItem.annotationLayerId || ANNOTATION_DEFAULT_LAYER_ID },
      }),
    );
  }

  _syncMapStyleLayerOrder() {
    if (!this._map) return;
    for (const layerItem of this._layerItems.slice().reverse()) {
      for (const layerId of layerItem.layerIds || []) {
        if (!this._map.getLayer(layerId)) continue;
        try {
          this._map.moveLayer(layerId);
        } catch (error) {
          console.warn(`Failed to reorder map layer: ${layerId}`, error);
        }
      }
    }
  }

  _placeLayerItemsByLayerSortOrder() {
    const layers = this._layerStore?.getLayers?.() || [];
    if (layers.length === 0) return false;
    const order = new Map(layers.map((layer, index) => [layer.id, index]));
    const ordered = this._layerItems.map((layerItem, index) => {
      const layerId = layerItemStoreLayerId(layerItem);
      return { layerItem, index, order: order.get(layerId) };
    });
    if (ordered.some((item) => item.order === undefined)) return false;
    this._layerItems = ordered.sort((a, b) => a.order - b.order || a.index - b.index).map((item) => item.layerItem);
    return true;
  }

  _sortLayerItemsByRemoteManifestOrder() {
    if (this._placeLayerItemsByLayerSortOrder()) return;
    this._layerItems = applyRemoteFileLayerManifestOrder(this._layerItems, this._remoteFileLayerOrder);
  }

  _moveLayerItemToIndex(
    layerItemId: string,
    destinationIndex: number,
    { render = true, sync = true }: MoveLayerItemOptions = {},
  ) {
    const fromIndex = this._layerItems.findIndex((layerItem) => layerItem.id === layerItemId);
    if (fromIndex === -1) return false;

    const previousOrder = this._layerItems.map((layerItem) => layerItem.id).join('\n');
    const [layerItem] = this._layerItems.splice(fromIndex, 1);
    const nextIndex = clamp(destinationIndex, 0, this._layerItems.length);
    this._layerItems.splice(nextIndex, 0, layerItem);

    const changed = previousOrder !== this._layerItems.map((item) => item.id).join('\n');
    if (!changed) return false;
    if (sync) this._syncMapStyleLayerOrder();
    if (sync) this._persistLayerStackOrder();
    if (render) {
      this._renderList();
      this._syncDetails();
    }
    if (sync) this._emitLayerSyncReorder();
    return true;
  }

  _persistLayerStackOrder() {
    const orderedIds = this._layerItems.map((layerItem) => layerItemStoreLayerId(layerItem)).filter(Boolean);
    if (orderedIds.length > 0) this._layerStore?.reorderLayers(orderedIds, { remote: true });
  }

  _focusReorderHandle(layerItemId: string) {
    const list = this._list as HTMLElement;
    const row = Array.from(list.querySelectorAll<HTMLElement>('.layer-manager-item')).find(
      (item) => item.dataset.layerItemId === layerItemId,
    );
    row?.querySelector<HTMLElement>('.layer-manager-reorder-handle')?.focus();
  }

  _handleReorderKeydown(event: KeyboardEvent, layerItemId: string) {
    const index = this._layerItems.findIndex((layerItem) => layerItem.id === layerItemId);
    if (index === -1) return;

    let destinationIndex: number | null = null;
    if (event.key === 'ArrowUp') destinationIndex = index - 1;
    if (event.key === 'ArrowDown') destinationIndex = index + 1;
    if (event.key === 'Home') destinationIndex = 0;
    if (event.key === 'End') destinationIndex = this._layerItems.length - 1;
    if (destinationIndex == null) return;

    event.preventDefault();
    this._selectedId = layerItemId;
    if (this._moveLayerItemToIndex(layerItemId, destinationIndex)) {
      this._focusReorderHandle(layerItemId);
    }
  }

  _syncListSelection() {
    for (const row of this._list.querySelectorAll<HTMLElement>('.layer-manager-item')) {
      row.classList.toggle('selected', row.dataset.layerItemId === this._selectedId);
    }
  }

  _beginReorder(event: PointerEvent, layerItemId: string) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    const row = handle.closest<HTMLElement>('.layer-manager-item');
    if (!row) return;

    event.preventDefault();
    event.stopPropagation();
    this._selectedId = layerItemId;
    this._syncListSelection();
    this._dragState = {
      id: layerItemId,
      pointerId: event.pointerId,
      handle,
      row,
    };
    row.classList.add('reordering');
    this._list.classList.add('layer-manager-list-reordering');
    handle.setPointerCapture?.(event.pointerId);
    this._watchReorderPointerEvents();
  }

  _watchReorderPointerEvents() {
    window.addEventListener('pointermove', this._boundReorderPointerMove);
    window.addEventListener('pointerup', this._boundReorderPointerUp);
    window.addEventListener('pointercancel', this._boundReorderPointerCancel);
  }

  _cancelReorderListeners() {
    window.removeEventListener('pointermove', this._boundReorderPointerMove);
    window.removeEventListener('pointerup', this._boundReorderPointerUp);
    window.removeEventListener('pointercancel', this._boundReorderPointerCancel);
  }

  _updateReorder(event: PointerEvent) {
    const state = this._dragState;
    if (!state || state.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    const list = this._list as HTMLElement;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.layer-manager-item')).filter(
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
    this._moveLayerItemToIndex(state.id, destinationIndex, { render: false, sync: false });
  }

  _finishReorder(event: PointerEvent | null) {
    const state = this._dragState;
    if (!state || (event && state.pointerId !== event.pointerId)) return;

    event?.preventDefault();
    event?.stopPropagation();
    if (state.handle.hasPointerCapture?.(state.pointerId)) {
      state.handle.releasePointerCapture(state.pointerId);
    }
    this._cancelReorderListeners();
    state.row.classList.remove('reordering');
    this._list.classList.remove('layer-manager-list-reordering');
    this._dragState = null;
    this._syncMapStyleLayerOrder();
    this._persistLayerStackOrder();
    this._emitLayerSyncReorder();
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
    if (!this._selectedId && this._layerItems.length > 0) {
      this._selectedId = this._layerItems[0].id;
    }
    this._summary.textContent =
      this._layerItems.length === 0
        ? 'No layers'
        : `${this._layerItems.length} layer${this._layerItems.length === 1 ? '' : 's'}`;
    this._empty.hidden = this._layerItems.length > 0;
    this._list.hidden = this._layerItems.length === 0;
    this._details.hidden = this._layerItems.length === 0;
    this._renderList();
    this._syncDetails();
  }

  _renderList() {
    while (this._list.firstChild) this._list.firstChild.remove();
    for (const layerItem of this._layerItems) {
      const row = el('div', 'layer-manager-item', this._list);
      row.dataset.layerItemId = layerItem.id;
      row.classList.toggle('selected', layerItem.id === this._selectedId);
      row.classList.toggle('muted', !layerItem.visible);
      row.setAttribute('role', 'listitem');

      const reorder = el('button', 'layer-manager-reorder-handle', row);
      reorder.type = 'button';
      reorder.title = 'Drag or use arrow keys to reorder';
      reorder.setAttribute('aria-label', `Reorder ${layerItem.name}`);
      reorder.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Home End');
      appendIcon(reorder, GripVerticalIcon);
      reorder.addEventListener('pointerdown', (event) => this._beginReorder(event, layerItem.id));
      reorder.addEventListener('pointermove', (event) => this._updateReorder(event));
      reorder.addEventListener('pointerup', (event) => this._finishReorder(event));
      reorder.addEventListener('pointercancel', (event) => this._finishReorder(event));
      reorder.addEventListener('keydown', (event) => this._handleReorderKeydown(event, layerItem.id));

      const visibility = el('button', 'layer-manager-icon-button', row);
      visibility.type = 'button';
      visibility.title = layerItem.visible ? 'Hide layer' : 'Show layer';
      visibility.setAttribute('aria-label', visibility.title);
      visibility.classList.add('layer-manager-visibility-button');
      visibility.classList.toggle('visible', layerItem.visible);
      appendIcon(visibility, layerItem.visible ? EyeIcon : EyeOffIcon);
      visibility.addEventListener('click', () => this._toggleLayerItemVisibility(layerItem));

      const main = el('button', 'layer-manager-item-main', row);
      main.type = 'button';
      main.addEventListener('click', () => this._selectLayerItem(layerItem.id));
      const name = el('span', 'layer-manager-item-name', main);
      name.textContent = layerItem.name;
      const meta = el('span', 'layer-manager-item-meta', main);
      meta.textContent = `${formatLayerItemType(layerItem.subType === 'osrm' ? 'osrm' : layerItem.type)} - ${formatLayerItemMeta(layerItem)}`;

      const zoom = el('button', 'layer-manager-icon-button', row);
      zoom.type = 'button';
      zoom.title = 'Zoom to layer';
      zoom.setAttribute('aria-label', 'Zoom to layer');
      zoom.classList.add('layer-manager-zoom-button');
      appendIcon(zoom, LocateFixedIcon);
      zoom.disabled = !layerItem.bounds;
      zoom.addEventListener('click', () => fitLayerItemBounds(this._map, layerItem));
    }
  }

  _syncDetails() {
    const layerItem = this._selectedLayerItem();
    if (!layerItem) {
      this._detailsTitle.textContent = '';
      this._nameInput.value = '';
      return;
    }

    this._detailsTitle.textContent = formatLayerItemMeta(layerItem);
    if (this._nameInput.value !== layerItem.name) this._nameInput.value = layerItem.name;

    const hasDataDrivenStyle =
      layerItem.type === 'gpx' || layerItem.subType === 'osrm' || layerItem.type === 'annotation';
    this._colorField.hidden = hasDataDrivenStyle;
    this._widthField.hidden = hasDataDrivenStyle;
    this._opacityField.hidden = hasDataDrivenStyle;
    const color = normalizeColor(layerItem.color);
    this._customColor.value = color;
    for (const swatch of this._swatches.querySelectorAll<HTMLElement>('.layer-manager-swatch')) {
      swatch.classList.toggle('selected', swatch.dataset.color === color);
    }

    const width = clamp(layerItem.lineWidth, 1, 12);
    this._widthInput.value = String(width);
    this._widthValue.textContent = `${width}px`;

    const opacity = clamp(layerItem.opacity, 0.2, 1);
    this._opacityInput.value = String(Math.round(opacity * 100));
    this._opacityValue.textContent = `${Math.round(opacity * 100)}%`;
    this._zoomButton.disabled = !layerItem.bounds;
    this._editButton.hidden = !isAnnotationLayerItem(layerItem);
    this._deleteButton.querySelector('.layer-manager-action-label').textContent = isAnnotationLayerItem(layerItem)
      ? layerItem.annotationLayerId === ANNOTATION_DEFAULT_LAYER_ID
        ? 'Clear'
        : 'Delete'
      : 'Delete';
  }
}

function mergeBounds(a: LayerBounds | null, b: BoundsLike | null | undefined): LayerBounds | null {
  const next = asLayerItemBounds(b);
  if (!a) return next;
  if (!next) return a;
  return [
    [Math.min(a[0][0], next[0][0]), Math.min(a[0][1], next[0][1])],
    [Math.max(a[1][0], next[1][0]), Math.max(a[1][1], next[1][1])],
  ];
}

export function installLayerManager(map: LayerManagerMap, layerStore?: LayerStore) {
  map.addControl(new LayerManagerControl(layerStore), 'top-right');
}
