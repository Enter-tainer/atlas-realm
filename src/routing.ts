import { processOrQueueGeoJson } from './gpx.js';
import createIconElement from 'lucide/dist/esm/createElement.mjs';
import CrosshairIcon from 'lucide/dist/esm/icons/crosshair.mjs';
import MapPinIcon from 'lucide/dist/esm/icons/map-pin.mjs';
import PlusIcon from 'lucide/dist/esm/icons/plus.mjs';
import RouteIcon from 'lucide/dist/esm/icons/route.mjs';
import TrashIcon from 'lucide/dist/esm/icons/trash-2.mjs';
import XIcon from 'lucide/dist/esm/icons/x.mjs';
import { emitUiPanelOpen, isOtherUiPanelOpen, UI_PANEL_OPEN_EVENT } from './ui-panels.js';

export const DEFAULT_OSRM_ENDPOINT = 'https://router.project-osrm.org';
export const ROUTING_ENDPOINT_KEY = 'orm-routing-osrm-endpoint';
const ROUTING_PICKER_DATASET_KEY = 'routingPickerActive';
const ROUTE_COLOR = '#0f766e';
const FROM_COLOR = '#16a34a';
const TO_COLOR = '#dc2626';
const MAX_STORED_STEPS = 80;
const MAX_STORED_NODE_IDS = 240;
const OSRM_ROUTE_KIND = 'osrm_route';
const OSRM_STEP_KIND = 'osrm_step';
const OSRM_MANEUVER_KIND = 'osrm_maneuver';
const OSRM_SEGMENT_KIND = 'osrm_segment';

export type LngLatLike = { lng: number; lat: number };
export type OsrmProfile = 'driving' | 'walking' | 'cycling';
type RoutePointKind = 'from' | 'to';
type RoutingMapClickEvent = {
  lngLat: LngLatLike;
  originalEvent?: Event & { routingHandled?: boolean };
};
type OverlayBounds = [[number, number], [number, number]];
type FitBoundsOptions = {
  padding?: number | { top: number; right: number; bottom: number; left: number };
  maxZoom?: number;
  duration?: number;
};
type RoutingControl = {
  onAdd(map: RoutingMap): HTMLElement;
  onRemove(): void;
};
function asOverlayBounds(value: readonly (readonly number[])[] | null | undefined): OverlayBounds | null {
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
type RoutingMap = {
  addControl(control: RoutingControl, position?: string): void;
  on(event: 'click', handler: (event: RoutingMapClickEvent) => void): void;
  off(event: 'click', handler: (event: RoutingMapClickEvent) => void): void;
  getContainer(): HTMLElement;
  addSource(id: string, source: object): void;
  addLayer(layer: object): void;
  hasImage(name: string): boolean;
  addImage(name: string, image: ImageData, options?: { pixelRatio?: number }): void;
  fitBounds(bounds: OverlayBounds, options?: FitBoundsOptions): void;
};
type RoutingMarker = {
  on(event: 'dragend', handler: () => void): void;
  getLngLat(): LngLatLike;
  setLngLat(lngLat: [number, number]): RoutingMarker;
  addTo(map: RoutingMap): RoutingMarker;
  remove(): void;
};
type RoutingMarkerOptions = {
  color?: string;
  draggable?: boolean;
};
type RoutingMaplibre = {
  Marker: new (options?: RoutingMarkerOptions) => RoutingMarker;
};
type Coordinates = [number, number];
type NumericValue = number | string | null;
type OsrmNodeId = number | string;
type OsrmLineStringGeometry = { type?: string; coordinates?: Coordinates[] };
type OsrmWaypoint = {
  name?: string;
  location?: number[];
  distance?: number;
};
type OsrmStep = {
  name?: string;
  ref?: string;
  mode?: string;
  distance?: number;
  duration?: number;
  geometry?: OsrmLineStringGeometry;
  maneuver?: {
    type?: string;
    modifier?: string;
    exit?: number;
    location?: number[];
  };
};
type OsrmAnnotation = {
  distance?: NumericValue[];
  duration?: NumericValue[];
  speed?: NumericValue[];
  nodes?: OsrmNodeId[];
};
type OsrmLeg = {
  steps?: OsrmStep[];
  annotation?: OsrmAnnotation;
};
type OsrmRoute = {
  geometry?: OsrmLineStringGeometry;
  distance?: number;
  duration?: number;
  weight?: number;
  weight_name?: string;
  legs?: OsrmLeg[];
};
type CompactStep = {
  leg: number;
  index: number;
  name: string;
  ref: string;
  mode: string;
  distance: number | null;
  duration: number | null;
  maneuver: string;
  modifier: string;
  exit: number | null;
  location: Coordinates | null;
};
type StepRecord = { raw: OsrmStep; compact: CompactStep };
export type OsrmRouteResponse = {
  code?: string;
  message?: string;
  routes?: OsrmRoute[];
  waypoints?: OsrmWaypoint[];
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

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : '';
}

function appendIcon(parent: Element, icon: LucideIcon, className = 'routing-icon') {
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
  const labelNode = el('span', 'routing-action-label', parent);
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

export function normalizeEndpoint(value: string | null | undefined) {
  const endpoint = String(value || '')
    .trim()
    .replace(/\/+$/, '');
  if (!endpoint) return DEFAULT_OSRM_ENDPOINT;
  try {
    const url = new URL(endpoint, window.location.href);
    return url.href.replace(/\/+$/, '');
  } catch {
    return DEFAULT_OSRM_ENDPOINT;
  }
}

function parseLngLatInput(value: string | number | null | undefined): LngLatLike | null {
  const matches = String(value || '').match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length < 2) return null;
  const a = Number(matches[0]);
  const b = Number(matches[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  if (Math.abs(a) <= 180 && Math.abs(b) <= 90) return { lng: a, lat: b };
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lng: b, lat: a };
  return null;
}

function formatCoord(point: LngLatLike | null) {
  if (!point) return '';
  return `${point.lng.toFixed(6)}, ${point.lat.toFixed(6)}`;
}

export function formatDistance(meters: number | string | null | undefined) {
  if (meters == null) return '';
  const value = Number(meters);
  if (!Number.isFinite(value)) return '';
  if (value < 1000) return `${Math.round(value)} m`;
  if (value < 10000) return `${(value / 1000).toFixed(1)} km`;
  return `${Math.round(value / 1000)} km`;
}

export function formatDuration(seconds: number | string | null | undefined) {
  if (seconds == null) return '';
  const value = Number(seconds);
  if (!Number.isFinite(value)) return '';
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function buildRouteUrl(endpoint: string, from: LngLatLike, to: LngLatLike, profile: OsrmProfile = 'driving') {
  return buildRouteUrlFromPoints(endpoint, [from, to], profile);
}

export function buildRouteUrlFromPoints(endpoint: string, points: LngLatLike[], profile: OsrmProfile = 'driving') {
  const coordinates = points.map((point) => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`).join(';');
  const url = new URL(`/route/v1/${profile}/${coordinates}`, normalizeEndpoint(endpoint));
  url.searchParams.set('alternatives', 'false');
  url.searchParams.set('steps', 'true');
  url.searchParams.set('annotations', 'duration,distance,speed,nodes');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('overview', 'full');
  return url.href;
}

function normalizeOsrmLocation(value: number[] | null | undefined, fallback: Coordinates | null): Coordinates | null {
  if (!Array.isArray(value) || value.length < 2) return fallback;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return fallback;
  return [lng, lat];
}

function roundedNumber(value: number | string | null | undefined, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(digits));
}

function compactWaypoint(waypoint: OsrmWaypoint | undefined, fallback: Coordinates) {
  const location = normalizeOsrmLocation(waypoint?.location, fallback);
  return {
    name: String(waypoint?.name || ''),
    location,
    distance: roundedNumber(waypoint?.distance, 1),
  };
}

function compactStep(step: OsrmStep, legIndex: number, stepIndex: number): CompactStep {
  const maneuver = step?.maneuver || {};
  const location = normalizeOsrmLocation(maneuver.location, null);
  return {
    leg: legIndex,
    index: stepIndex,
    name: String(step?.name || ''),
    ref: String(step?.ref || ''),
    mode: String(step?.mode || ''),
    distance: roundedNumber(step?.distance, 1),
    duration: roundedNumber(step?.duration, 1),
    maneuver: String(maneuver.type || ''),
    modifier: String(maneuver.modifier || ''),
    exit: maneuver.exit == null ? null : Number(maneuver.exit),
    location,
  };
}

function getRouteStepRecords(route: OsrmRoute): StepRecord[] {
  return (route.legs || []).flatMap((leg, legIndex) =>
    (leg.steps || []).map((step, stepIndex) => ({
      raw: step,
      compact: compactStep(step, legIndex, stepIndex),
    })),
  );
}

function getRoadNames(steps: CompactStep[]) {
  return Array.from(new Set(steps.map((step) => step.name).filter(Boolean))).slice(0, 16);
}

function formatManeuverTitle(step: CompactStep) {
  const words = [step.maneuver, step.modifier].filter(Boolean).join(' ');
  if (!words) return 'Route step';
  return words.replace(/\b\w/g, (char: string) => char.toUpperCase());
}

function stepProperties(step: CompactStep, kind: string) {
  return {
    kind,
    source: 'OSRM',
    name: step.name,
    road_name: step.name,
    ref: step.ref,
    mode: step.mode,
    leg_index: step.leg,
    step_index: step.index,
    maneuver: step.maneuver,
    modifier: step.modifier,
    exit: step.exit,
    title: formatManeuverTitle(step),
    distance: step.distance,
    duration: step.duration,
    distance_text: formatDistance(step.distance),
    duration_text: formatDuration(step.duration),
  };
}

function buildStepFeatures(stepRecords: StepRecord[]) {
  return stepRecords.flatMap(({ raw, compact }) => {
    if (
      raw?.geometry?.type !== 'LineString' ||
      !Array.isArray(raw.geometry.coordinates) ||
      raw.geometry.coordinates.length < 2
    ) {
      return [];
    }
    return [
      {
        type: 'Feature',
        properties: stepProperties(compact, OSRM_STEP_KIND),
        geometry: raw.geometry,
      },
    ];
  });
}

function buildManeuverFeatures(stepRecords: StepRecord[]) {
  return stepRecords.flatMap(({ compact }) => {
    if (!compact.location) return [];
    return [
      {
        type: 'Feature',
        properties: stepProperties(compact, OSRM_MANEUVER_KIND),
        geometry: {
          type: 'Point',
          coordinates: compact.location,
        },
      },
    ];
  });
}

function getRouteAnnotationArrays(route: OsrmRoute) {
  const annotations = (route.legs || []).map((leg) => leg.annotation).filter(Boolean);
  return {
    distances: annotations.flatMap((annotation: OsrmAnnotation) => annotation.distance || []),
    durations: annotations.flatMap((annotation: OsrmAnnotation) => annotation.duration || []),
    speeds: annotations.flatMap((annotation: OsrmAnnotation) => annotation.speed || []),
    nodes: annotations.flatMap((annotation: OsrmAnnotation) => annotation.nodes || []),
  };
}

function summarizeAnnotations(route: OsrmRoute) {
  const { distances, durations, speeds: rawSpeeds, nodes } = getRouteAnnotationArrays(route);
  const speeds = rawSpeeds.map((speed) => Number(speed)).filter((speed) => Number.isFinite(speed));
  const avgSpeed =
    speeds.length > 0 ? speeds.reduce((sum: number, speed: number) => sum + speed, 0) / speeds.length : null;

  return {
    segmentCount: distances.length || durations.length || speeds.length,
    nodeCount: nodes.length,
    minSpeed: speeds.length ? roundedNumber(Math.min(...speeds), 1) : null,
    maxSpeed: speeds.length ? roundedNumber(Math.max(...speeds), 1) : null,
    avgSpeed: roundedNumber(avgSpeed, 1),
    nodeIds: nodes.slice(0, MAX_STORED_NODE_IDS),
  };
}

function buildSegmentFeatures(route: OsrmRoute) {
  const coordinates = route.geometry?.coordinates || [];
  const { distances, durations, speeds, nodes } = getRouteAnnotationArrays(route);
  if (!Array.isArray(coordinates) || coordinates.length < 2) return [];

  const segmentCount = Math.min(
    coordinates.length - 1,
    Math.max(distances.length, durations.length, speeds.length, nodes.length - 1),
  );

  const features = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    if (!Array.isArray(start) || !Array.isArray(end)) continue;

    const distance = roundedNumber(distances[index], 1);
    const duration = roundedNumber(durations[index], 1);
    const speedMps = roundedNumber(speeds[index], 1);
    const speedKmh = speedMps == null ? null : roundedNumber(speedMps * 3.6, 1);
    features.push({
      type: 'Feature',
      properties: {
        kind: OSRM_SEGMENT_KIND,
        source: 'OSRM',
        segment_index: index,
        distance,
        duration,
        distance_text: formatDistance(distance),
        duration_text: formatDuration(duration),
        speed: speedKmh,
        speed_kmh: speedKmh,
        speed_mps: speedMps,
        node_from: nodes[index] ?? null,
        node_to: nodes[index + 1] ?? null,
      },
      geometry: {
        type: 'LineString',
        coordinates: [start, end],
      },
    });
  }
  return features;
}

export function routeToGeoJson(
  route: OsrmRoute,
  waypoints: OsrmWaypoint[] | undefined,
  from: LngLatLike,
  to: LngLatLike,
) {
  const distance = Number(route.distance);
  const duration = Number(route.duration);
  const distanceText = formatDistance(distance);
  const durationText = formatDuration(duration);
  const name = ['OSRM route', distanceText, durationText].filter(Boolean).join(' - ');
  const start = normalizeOsrmLocation(waypoints?.[0]?.location, [from.lng, from.lat]);
  const end = normalizeOsrmLocation(waypoints?.[waypoints.length - 1]?.location, [to.lng, to.lat]);
  const compactWaypoints = [
    compactWaypoint(waypoints?.[0], [from.lng, from.lat]),
    compactWaypoint(waypoints?.[waypoints.length - 1], [to.lng, to.lat]),
  ];
  const stepRecords = getRouteStepRecords(route);
  const steps = stepRecords.map((record: StepRecord) => record.compact);
  const storedSteps = steps.slice(0, MAX_STORED_STEPS);
  const roadNames = getRoadNames(steps);
  const annotation = summarizeAnnotations(route);
  const routeProperties = {
    name,
    kind: OSRM_ROUTE_KIND,
    source: 'OSRM',
    color: ROUTE_COLOR,
    stroke: ROUTE_COLOR,
    'line-width': 5,
    distance,
    duration,
    distance_text: distanceText,
    duration_text: durationText,
    weight: roundedNumber(route.weight, 1),
    weight_name: String(route.weight_name || ''),
    from_lng: from.lng,
    from_lat: from.lat,
    to_lng: to.lng,
    to_lat: to.lat,
    snapped_from_lng: start[0],
    snapped_from_lat: start[1],
    snapped_to_lng: end[0],
    snapped_to_lat: end[1],
    waypoint_count: compactWaypoints.length,
    step_count: steps.length,
    stored_step_count: storedSteps.length,
    annotation_segment_count: annotation.segmentCount,
    annotation_node_count: annotation.nodeCount,
    annotation_min_speed_mps: annotation.minSpeed,
    annotation_max_speed_mps: annotation.maxSpeed,
    annotation_avg_speed_mps: annotation.avgSpeed,
    annotation_avg_speed_kmh: annotation.avgSpeed == null ? null : roundedNumber(annotation.avgSpeed * 3.6, 1),
    road_names: roadNames.join('; '),
    osrm_waypoints: JSON.stringify(compactWaypoints),
    osrm_steps: JSON.stringify(storedSteps),
    osrm_node_ids: JSON.stringify(annotation.nodeIds),
  };
  const features = [
    {
      type: 'Feature',
      properties: routeProperties,
      geometry: route.geometry,
    },
    ...buildStepFeatures(stepRecords),
    ...buildManeuverFeatures(stepRecords),
    ...buildSegmentFeatures(route),
  ];

  return {
    name,
    geojson: {
      type: 'FeatureCollection',
      features,
    },
    distanceText,
    durationText,
    stepCount: steps.length,
    nodeCount: annotation.nodeCount,
  };
}

class OsrmRoutingControl {
  _maplibregl: RoutingMaplibre;
  _map: RoutingMap;
  _control: HTMLElement;
  _button: HTMLButtonElement;
  _panel: HTMLElement;
  _title: HTMLElement;
  _summary: HTMLElement;
  _closeButton: HTMLButtonElement;
  _endpointInput: HTMLInputElement;
  _fromInput: HTMLInputElement;
  _toInput: HTMLInputElement;
  _fromPickButton: HTMLButtonElement;
  _toPickButton: HTMLButtonElement;
  _routeButton: HTMLButtonElement;
  _clearButton: HTMLButtonElement;
  _status: HTMLElement;
  _expanded: boolean;
  _from: LngLatLike | null;
  _to: LngLatLike | null;
  _picking: RoutePointKind | null;
  _isRouting: boolean;
  _abortController: AbortController | null;
  _markers: Record<RoutePointKind, RoutingMarker | null>;
  _boundKeydown: (event: KeyboardEvent) => void;
  _boundMapClick: (event: RoutingMapClickEvent) => void;
  _boundViewportChange: () => void;
  _boundOverlayPanelOpen: () => void;
  _boundAnyPanelOpen: (event: Event) => void;

  constructor(maplibregl: RoutingMaplibre) {
    this._maplibregl = maplibregl;
    this._expanded = false;
    this._from = null;
    this._to = null;
    this._picking = null;
    this._isRouting = false;
    this._abortController = null;
    this._markers = { from: null, to: null };
    this._boundKeydown = (event) => this._handleKeydown(event);
    this._boundMapClick = (event) => this._handleMapClick(event);
    this._boundViewportChange = () => this._syncViewportMode();
    this._boundOverlayPanelOpen = () => this.setExpanded(false);
    this._boundAnyPanelOpen = (event) => {
      if (isOtherUiPanelOpen(event, 'routing')) this.setExpanded(false);
    };
  }

  onAdd(map: RoutingMap) {
    this._map = map;
    this._control = el('div', 'maplibregl-ctrl maplibregl-ctrl-group routing-control');
    this._button = el('button', 'maplibregl-ctrl-routing', this._control);
    this._button.type = 'button';
    this._button.title = 'Routing';
    this._button.setAttribute('aria-label', 'Routing');
    this._button.setAttribute('aria-expanded', 'false');
    appendIcon(this._button, RouteIcon);
    this._button.addEventListener('click', () => this.setExpanded(!this._expanded));

    this._panel = el('section', 'routing-panel', map.getContainer());
    this._panel.setAttribute('aria-label', 'Routing');
    this._panel.setAttribute('aria-hidden', 'true');
    stopMapControlPropagation(this._panel);

    const header = el('div', 'routing-header', this._panel);
    const titleWrap = el('div', 'routing-title-wrap', header);
    this._title = el('div', 'routing-title', titleWrap);
    this._title.textContent = 'Routing';
    this._summary = el('div', 'routing-summary', titleWrap);
    this._summary.textContent = 'OSRM driving';

    this._closeButton = el('button', 'routing-close', header);
    this._closeButton.type = 'button';
    this._closeButton.title = 'Close routing';
    this._closeButton.setAttribute('aria-label', 'Close routing');
    appendIcon(this._closeButton, XIcon);
    this._closeButton.addEventListener('click', () => this.setExpanded(false));

    const body = el('div', 'routing-body', this._panel);

    const endpointField = el('label', 'routing-field', body);
    const endpointLabel = el('span', 'routing-field-label', endpointField);
    endpointLabel.textContent = 'OSRM endpoint';
    this._endpointInput = el('input', 'routing-input', endpointField);
    this._endpointInput.type = 'url';
    this._endpointInput.autocomplete = 'off';
    this._endpointInput.spellcheck = false;
    this._endpointInput.value = safeGetStorage(ROUTING_ENDPOINT_KEY, DEFAULT_OSRM_ENDPOINT);
    this._endpointInput.addEventListener('change', () => {
      const endpoint = normalizeEndpoint(this._endpointInput.value);
      this._endpointInput.value = endpoint;
      safeSetStorage(ROUTING_ENDPOINT_KEY, endpoint);
    });

    this._fromInput = this._appendPointField(body, 'from', 'From', FROM_COLOR);
    this._toInput = this._appendPointField(body, 'to', 'To', TO_COLOR);

    const actions = el('div', 'routing-actions', body);
    this._routeButton = el('button', 'routing-action routing-action-primary', actions);
    this._routeButton.type = 'button';
    appendIconLabel(this._routeButton, PlusIcon, 'Add route');
    this._routeButton.addEventListener('click', () => this._route());

    this._clearButton = el('button', 'routing-action', actions);
    this._clearButton.type = 'button';
    appendIconLabel(this._clearButton, TrashIcon, 'Clear');
    this._clearButton.addEventListener('click', () => this._clear());

    this._status = el('div', 'routing-status', body);
    this._status.setAttribute('role', 'status');
    this._status.setAttribute('aria-live', 'polite');

    map.on('click', this._boundMapClick);
    map.getContainer().addEventListener('layer-manager:panelopen', this._boundOverlayPanelOpen);
    map.getContainer().addEventListener(UI_PANEL_OPEN_EVENT, this._boundAnyPanelOpen);
    window.addEventListener('keydown', this._boundKeydown);
    window.addEventListener('resize', this._boundViewportChange, { passive: true });
    this._syncViewportMode();
    this._syncPanelInteractivity();
    this._sync();
    return this._control;
  }

  onRemove() {
    this._abortController?.abort();
    this._map.off('click', this._boundMapClick);
    this._map.getContainer().removeEventListener('layer-manager:panelopen', this._boundOverlayPanelOpen);
    this._map.getContainer().removeEventListener(UI_PANEL_OPEN_EVENT, this._boundAnyPanelOpen);
    window.removeEventListener('keydown', this._boundKeydown);
    window.removeEventListener('resize', this._boundViewportChange);
    this._removeMarkers();
    this._panel?.remove();
    this._control?.remove();
    this._map.getContainer().dataset[ROUTING_PICKER_DATASET_KEY] = 'false';
    this._map = undefined;
  }

  _appendPointField(parent: Element, kind: RoutePointKind, label: string, color: string) {
    const field = el('label', 'routing-field', parent);
    const header = el('span', 'routing-field-row', field);
    const labelNode = el('span', 'routing-field-label', header);
    labelNode.textContent = label;
    const dot = el('span', 'routing-point-dot', header);
    dot.style.backgroundColor = color;

    const row = el('span', 'routing-point-row', field);
    const input = el('input', 'routing-input', row);
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = '116.391000, 39.907000';
    input.addEventListener('change', () => this._commitPointInput(kind));
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this._commitPointInput(kind);
      }
    });

    const pickButton = el('button', `routing-pick routing-pick-${kind}`, row);
    pickButton.type = 'button';
    pickButton.title = `Pick ${label}`;
    pickButton.setAttribute('aria-label', `Pick ${label}`);
    appendIcon(pickButton, kind === 'from' ? CrosshairIcon : MapPinIcon);
    pickButton.addEventListener('click', () => this._startPicking(kind));
    if (kind === 'from') this._fromPickButton = pickButton;
    if (kind === 'to') this._toPickButton = pickButton;
    return input;
  }

  setExpanded(expanded: boolean) {
    this._expanded = Boolean(expanded);
    if (this._expanded) {
      emitUiPanelOpen(this._map.getContainer(), 'routing');
      this._map.getContainer().dispatchEvent(new CustomEvent('routing:panelopen'));
    }
    if (!this._expanded) this._setPicking(null);
    this._button.classList.toggle('maplibregl-ctrl-routing-enabled', this._expanded);
    this._button.setAttribute('aria-expanded', this._expanded ? 'true' : 'false');
    this._panel.classList.toggle('routing-panel-visible', this._expanded);
    this._panel.setAttribute('aria-hidden', this._expanded ? 'false' : 'true');
    this._syncPanelInteractivity();
    this._sync();
  }

  _syncPanelInteractivity() {
    if (!this._panel) return;
    for (const element of this._panel.querySelectorAll('button, input, select, textarea')) {
      (element as Element & { disabled: boolean }).disabled = !this._expanded || this._isRouting;
    }
    if (this._expanded && this._isRouting) {
      this._closeButton.disabled = false;
    }
  }

  _syncViewportMode() {
    this._panel.dataset.compact = window.matchMedia?.('(max-width: 640px)').matches ? 'true' : 'false';
  }

  _handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this._picking) {
      this._setPicking(null);
      return;
    }
    if (event.key === 'Escape' && this._expanded) this.setExpanded(false);
  }

  _handleMapClick(event: RoutingMapClickEvent) {
    if (!this._picking) return;
    if (this._map.getContainer().dataset.weatherPickerActive === 'true') return;
    if (event.originalEvent) event.originalEvent.routingHandled = true;

    const kind = this._picking;
    this._setPoint(kind, event.lngLat);
    if (kind === 'from' && !this._to) {
      this._setPicking('to');
    } else {
      this._setPicking(null);
    }
  }

  _startPicking(kind: RoutePointKind) {
    if (!this._expanded) this.setExpanded(true);
    this._setPicking(this._picking === kind ? null : kind);
  }

  _setPicking(kind: RoutePointKind | null) {
    this._picking = kind === 'from' || kind === 'to' ? kind : null;
    if (this._map) {
      this._map.getContainer().dataset[ROUTING_PICKER_DATASET_KEY] = this._picking ? 'true' : 'false';
    }
    this._sync();
  }

  _commitPointInput(kind: RoutePointKind) {
    const input = kind === 'from' ? this._fromInput : this._toInput;
    const point = parseLngLatInput(input.value);
    if (!point) {
      this._setStatus(`${kind === 'from' ? 'From' : 'To'} needs lng, lat`);
      input.value = formatCoord(kind === 'from' ? this._from : this._to);
      return;
    }
    this._setPoint(kind, point);
  }

  _setPoint(kind: RoutePointKind, lngLat: LngLatLike) {
    const point = { lng: Number(lngLat.lng), lat: Number(lngLat.lat) };
    if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) return;

    if (kind === 'from') {
      this._from = point;
      this._fromInput.value = formatCoord(point);
    } else {
      this._to = point;
      this._toInput.value = formatCoord(point);
    }
    this._syncMarker(kind);
    this._sync();
  }

  _syncMarker(kind: RoutePointKind) {
    const point = kind === 'from' ? this._from : this._to;
    if (!point) {
      this._markers[kind]?.remove();
      this._markers[kind] = null;
      return;
    }

    if (!this._markers[kind]) {
      const marker = new this._maplibregl.Marker({
        color: kind === 'from' ? FROM_COLOR : TO_COLOR,
        draggable: true,
      });
      marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        this._setPoint(kind, lngLat);
      });
      this._markers[kind] = marker;
    }
    this._markers[kind].setLngLat([point.lng, point.lat]).addTo(this._map);
  }

  _removeMarkers() {
    this._markers.from?.remove();
    this._markers.to?.remove();
    this._markers.from = null;
    this._markers.to = null;
  }

  _clear() {
    this._abortController?.abort();
    this._abortController = null;
    this._from = null;
    this._to = null;
    this._fromInput.value = '';
    this._toInput.value = '';
    this._setPicking(null);
    this._removeMarkers();
    this._setStatus('');
    this._sync();
  }

  async _route() {
    this._commitPointInput('from');
    this._commitPointInput('to');
    if (!this._from || !this._to) {
      this._setStatus('Set From and To');
      return;
    }

    this._abortController?.abort();
    this._abortController = new AbortController();
    this._isRouting = true;
    this._syncPanelInteractivity();
    this._setStatus('Routing...');

    try {
      const endpoint = normalizeEndpoint(this._endpointInput.value);
      this._endpointInput.value = endpoint;
      safeSetStorage(ROUTING_ENDPOINT_KEY, endpoint);

      const response = await fetch(buildRouteUrl(endpoint, this._from, this._to), {
        signal: this._abortController.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = (await response.json()) as OsrmRouteResponse;
      if (data.code !== 'Ok') throw new Error(data.message || data.code || 'Route failed');
      const route = data.routes?.[0];
      if (!route?.geometry || route.geometry.type !== 'LineString') throw new Error('No route geometry');

      const result = routeToGeoJson(route, data.waypoints, this._from, this._to);
      const layer = processOrQueueGeoJson(this._map, result.geojson, {
        name: result.name,
        color: ROUTE_COLOR,
      });
      const bounds = asOverlayBounds(layer?.bounds);
      if (bounds) this._map.fitBounds(bounds, { padding: 70, maxZoom: 16 });
      this._removeMarkers();
      this._setPicking(null);
      this._setStatus(
        ['Added route', result.distanceText, result.durationText, result.stepCount ? `${result.stepCount} steps` : '']
          .filter(Boolean)
          .join(' - '),
      );
    } catch (error: unknown) {
      if (errorName(error) === 'AbortError') return;
      console.error('OSRM route failed:', error);
      this._setStatus(errorMessage(error, 'Route failed'));
    } finally {
      this._isRouting = false;
      this._abortController = null;
      this._syncPanelInteractivity();
      this._sync();
    }
  }

  _setStatus(message: string) {
    this._status.textContent = message;
    this._status.classList.toggle('visible', Boolean(message));
  }

  _sync() {
    const pickingFrom = this._picking === 'from';
    const pickingTo = this._picking === 'to';
    this._fromPickButton?.classList.toggle('active', pickingFrom);
    this._toPickButton?.classList.toggle('active', pickingTo);

    if (this._isRouting) {
      this._summary.textContent = 'Routing...';
    } else if (pickingFrom) {
      this._summary.textContent = 'Pick From';
    } else if (pickingTo) {
      this._summary.textContent = 'Pick To';
    } else if (this._from && this._to) {
      this._summary.textContent = 'Ready';
    } else {
      this._summary.textContent = 'OSRM driving';
    }

    this._routeButton.disabled = !this._expanded || this._isRouting || !this._from || !this._to;
    this._clearButton.disabled = !this._expanded || this._isRouting || (!this._from && !this._to);
  }
}

export function installOsrmRouting(map: RoutingMap, maplibregl: RoutingMaplibre) {
  map.addControl(new OsrmRoutingControl(maplibregl), 'top-right');
}
