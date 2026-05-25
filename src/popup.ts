/**
 * OpenRailwayMap-vector popup system — standalone replication.
 *
 * Replicates the DOM-building popup from proxy/js/ui.js (popupContent)
 * with the feature catalog system from proxy/js/features.mjs.
 *
 * Usage:
 *   import { installOrmPopups } from './popup.js';
 *   installOrmPopups(map, featuresCatalog);
 */

// ---------------------------------------------------------------------------
// OSM element type icons (base64 SVGs from ORM upstream)
// ---------------------------------------------------------------------------
const OSM_ICONS = {
  node: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMTIiIGhlaWdodD0iMTIiIHZpZXdCb3g9IjAgMCAxMiAxMiI+CjxwYXRoIGZpbGwtcnVsZT0ibm9uemVybyIgZmlsbD0icmdiKDEwMCUsIDEwMCUsIDEwMCUpIiBmaWxsLW9wYWNpdHk9IjEiIGQ9Ik0gMS44MjgxMjUgMC4zMjgxMjUgTCAxMC4xNzE4NzUgMC4zMjgxMjUgQyAxMSAwLjMyODEyNSAxMS42NzE4NzUgMSAxMS42NzE4NzUgMS44MjgxMjUgTCAxMS42NzE4NzUgMTAuMTcxODc1IEMgMTEuNjcxODc1IDExIDExIDExLjY3MTg3NSAxMC4xNzE4NzUgMTEuNjcxODc1IEwgMS44MjgxMjUgMTEuNjcxODc1IEMgMSAxMS42NzE4NzUgMC4zMjgxMjUgMTEgMC4zMjgxMjUgMTAuMTcxODc1IEwgMC4zMjgxMjUgMS44MjgxMjUgQyAwLjMyODEyNSAxIDEgMC4zMjgxMjUgMS44MjgxMjUgMC4zMjgxMjUgWiBNIDEuODI4MTI1IDAuMzI4MTI1ICIvPgo8cGF0aCBmaWxsLXJ1bGU9Im5vbnplcm8iIGZpbGw9InJnYig3NC41MDk4MDQlLCA5MC4xOTYwNzglLCA3NC41MDk4MDQlKSIgZmlsbC1vcGFjaXR5PSIxIiBzdHJva2Utd2lkdGg9IjEwIiBzdHJva2UtbGluZWNhcD0iYnV0dCIgc3Ryb2tlLWxpbmVqb2luPSJtaXRlciIgc3Ryb2tlPSJyZ2IoMCUsIDAlLCAwJSkiIHN0cm9rZS1vcGFjaXR5PSIxIiBzdHJva2UtbWl0ZXJsaW1pdD0iNCIgZD0iTSAxNTIgMTI4IEMgMTUyIDE0MS4yNSAxNDEuMjUgMTUyIDEyOCAxNTIgQyAxMTQuNzUgMTUyIDEwNCAxNDEuMjUgMTA0IDEyOCBDIDEwNCAxMTQuNzUgMTE0Ljc1IDEwNCAxMjggMTA0IEMgMTQxLjI1IDEwNCAxNTIgMTE0Ljc1IDE1MiAxMjggWiBNIDE1MiAxMjggIiB0cmFuc2Zvcm09Im1hdHJpeCgwLjA0Njg3NSwgMCwgMCwgMC4wNDY4NzUsIDAsIDApIi8+CjxwYXRoIGZpbGw9Im5vbmUiIHN0cm9rZS13aWR0aD0iMTIiIHN0cm9rZS1saW5lY2FwPSJidXR0IiBzdHJva2UtbGluZWpvaW49Im1pdGVyIiBzdHJva2U9InJnYigwJSwgMCUsIDAlKSIgc3Ryb2tlLW9wYWNpdHk9IjEiIHN0cm9rZS1taXRlcmxpbWl0PSI0IiBkPSJNIDM5IDcgTCAyMTcgNyBDIDIzNC42NjY2NjcgNyAyNDkgMjEuMzMzMzMzIDI0OSAzOSBMIDI0OSAyMTcgQyAyNDkgMjM0LjY2NjY2NyAyMzQuNjY2NjY3IDI0OSAyMTcgMjQ5IEwgMzkgMjQ5IEMgMjEuMzMzMzMzIDI0OSA3IDIzNC42NjY2NjcgNyAyMTcgTCA3IDM5IEMgNyAyMS4zMzMzMzMgMjEuMzMzMzMzIDcgMzkgNyBaIE0gMzkgNyAiIHRyYW5zZm9ybT0ibWF0cml4KDAuMDQ2ODc1LCAwLCAwLCAwLjA0Njg3NSwgMCwgMCkiLz4KPC9zdmc+Cg==',
  way: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMTIiIGhlaWdodD0iMTIiIHZpZXdCb3g9IjAgMCAxMiAxMiI+CjxwYXRoIGZpbGwtcnVsZT0ibm9uemVybyIgZmlsbD0icmdiKDEwMCUsIDEwMCUsIDEwMCUpIiBmaWxsLW9wYWNpdHk9IjEiIGQ9Ik0gMS44MjgxMjUgMC4zMjgxMjUgTCAxMC4xNzE4NzUgMC4zMjgxMjUgQyAxMSAwLjMyODEyNSAxMS42NzE4NzUgMSAxMS42NzE4NzUgMS44MjgxMjUgTCAxMS42NzE4NzUgMTAuMTcxODc1IEMgMTEuNjcxODc1IDExIDExIDExLjY3MTg3NSAxMC4xNzE4NzUgMTEuNjcxODc1IEwgMS44MjgxMjUgMTEuNjcxODc1IEMgMSAxMS42NzE4NzUgMC4zMjgxMjUgMTEgMC4zMjgxMjUgMTAuMTcxODc1IEwgMC4zMjgxMjUgMS44MjgxMjUgQyAwLjMyODEyNSAxIDEgMC4zMjgxMjUgMS44MjgxMjUgMC4zMjgxMjUgWiBNIDEuODI4MTI1IDAuMzI4MTI1ICIvPgo8cGF0aCBmaWxsPSJub25lIiBzdHJva2Utd2lkdGg9IjE2IiBzdHJva2UtbGluZWNhcD0iYnV0dCIgc3Ryb2tlLWxpbmVqb2luPSJtaXRlciIgc3Ryb2tlPSJyZ2IoODAlLCA4MCUsIDgwJSkiIHN0cm9rZS1vcGFjaXR5PSIxIiBzdHJva2UtbWl0ZXJsaW1pdD0iNCIgZD0iTSAxNjkgNTggTCA1NyAxNDUgTCAxOTUgMTk5ICIgdHJhbnNmb3JtPSJtYXRyaXgoMC4wNDY4NzUsIDAsIDAsIDAuMDQ2ODc1LCAwLCAwKSIvPgo8cGF0aCBmaWxsLXJ1bGU9Im5vbnplcm8iIGZpbGw9InJnYigwJSwgMCUsIDAlKSIgZmlsbC1vcGFjaXR5PSIxIiBkPSJNIDkuMDQ2ODc1IDIuNzE4NzUgQyA5LjA0Njg3NSAzLjMzOTg0NCA4LjU0Mjk2OSAzLjg0Mzc1IDcuOTIxODc1IDMuODQzNzUgQyA3LjMwMDc4MSAzLjg0Mzc1IDYuNzk2ODc1IDMuMzM5ODQ0IDYuNzk2ODc1IDIuNzE4NzUgQyA2Ljc5Njg3NSAyLjA5NzY1NiA3LjMwMDc4MSAxLjU5Mzc1IDcuOTIxODc1IDEuNTkzNzUgQyA4LjU0Mjk2OSAxLjU5Mzc1IDkuMDQ2ODc1IDIuMDk3NjU2IDkuMDQ2ODc1IDIuNzE4NzUgWiBNIDkuMDQ2ODc1IDIuNzE4NzUgIi8+CjxwYXRoIGZpbGwtcnVsZT0ibm9uemVybyIgZmlsbD0icmdiKDAlLCAwJSwgMCUpIiBmaWxsLW9wYWNpdHk9IjEiIGQ9Ik0gMy43OTY4NzUgNi43OTY4NzUgQyAzLjc5Njg3NSA3LjQxNzk2OSAzLjI5Mjk2OSA3LjkyMTg3NSAyLjY3MTg3NSA3LjkyMTg3NSBDIDIuMDUwNzgxIDcuOTIxODc1IDEuNTQ2ODc1IDcuNDE3OTY5IDEuNTQ2ODc1IDYuNzk2ODc1IEMgMS41NDY4NzUgNi4xNzU3ODEgMi4wNTA3ODEgNS42NzE4NzUgMi42NzE4NzUgNS42NzE4NzUgQyAzLjI5Mjk2OSA1LjY3MTg3NSAzLjc5Njg3NSA2LjE3NTc4MSAzLjc5Njg3NSA2Ljc5Njg3NSBaIE0gMy43OTY4NzUgNi43OTY4NzUgIi8+CjxwYXRoIGZpbGwtcnVsZT0ibm9uemVybyIgZmlsbD0icmdiKDAlLCAwJSwgMCUpIiBmaWxsLW9wYWNpdHk9IjEiIGQ9Ik0gMTAuMjY1NjI1IDkuMzI4MTI1IEMgMTAuMjY1NjI1IDkuOTQ5MjE5IDkuNzYxNzE5IDEwLjQ1MzEyNSA5LjE0MDYyNSAxMC40NTMxMjUgQyA4LjUxOTUzMSAxMC40NTMxMjUgOC4wMTU2MjUgOS45NDkyMTkgOC4wMTU2MjUgOS4zMjgxMjUgQyA4LjAxNTYyNSA4LjcwNzAzMSA4LjUxOTUzMSA4LjIwMzEyNSA5LjE0MDYyNSA4LjIwMzEyNSBDIDkuNzYxNzE5IDguMjAzMTI1IDEwLjI2NTYyNSA4LjcwNzAzMSAxMC4yNjU2MjUgOS4zMjgxMjUgWiBNIDEwLjI2NTYyNSA5LjMyODEyNSAiLz4KPHBhdGggZmlsbD0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxMiIgc3Ryb2tlLWxpbmVjYXA9ImJ1dHQiIHN0cm9rZS1saW5lam9pbj0ibWl0ZXIiIHN0cm9rZT0icmdiKDAlLCAwJSwgMCUpIiBzdHJva2Utb3BhY2l0eT0iMSIgc3Ryb2tlLW1pdGVybGltaXQ9IjQiIGQ9Ik0gMzkgNyBMIDIxNyA3IEMgMjM0LjY2NjY2NyA3IDI0OSAyMS4zMzMzMzMgMjQ5IDM5IEwgMjQ5IDIxNyBDIDI0OSAyMzQuNjY2NjY3IDIzNC42NjY2NjcgMjQ5IDIxNyAyNDkgTCAzOSAyNDkgQyAyMS4zMzMzMzMgMjQ5IDcgMjM0LjY2NjY2NyA3IDIxNyBMIDcgMzkgQyA3IDIxLjMzMzMzMyAyMS4zMzMzMzMgNyAzOSA3IFogTSAzOSA3ICIgdHJhbnNmb3JtPSJtYXRyaXgoMC4wNDY4NzUsIDAsIDAsIDAuMDQ2ODc1LCAwLCAwKSIvPgo8L3N2Zz4K',
  relation:
    'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiIHhtbG5zOmNjPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyMiIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgdmVyc2lvbj0iMS4wIiBoZWlnaHQ9IjI1NiIgd2lkdGg9IjI1NiI+PHRpdGxlPk9wZW5TdHJlZXRNYXAgcmVsYXRpb24gZWxlbWVudCBpY29uPC90aXRsZT48bWV0YWRhdGE+PHJkZjpSREY+PGNjOldvcmsgcmRmOmFib3V0PSIiPjxkYzpmb3JtYXQ+aW1hZ2Uvc3ZnK3htbDwvZGM6Zm9ybWF0PjxkYzp0eXBlIHJkZjpyZXNvdXJjZT0iaHR0cDovL3B1cmwub3JnL2RjL2RjbWl0eXBlL1N0aWxsSW1hZ2UiLz48ZGM6dGl0bGU+T3BlblN0cmVldE1hcCByZWxhdGlvbiBlbGVtZW50IGljb248L2RjOnRpdGxlPjxjYzpsaWNlbnNlIHJkZjpyZXNvdXJjZT0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbGljZW5zZXMvYnkvMy4wLyIvPjxkYzpkYXRlPjIwMTQtMDMtMTA8L2RjOmRhdGU+PGRjOmNyZWF0b3I+PGNjOkFnZW50PjxkYzp0aXRsZT5odHRwczovL3dpa2kub3BlbnN0cmVldG1hcC5vcmcvd2lraS9Vc2VyOk1vcmVzYnk8L2RjOnRpdGxlPjwvY2M6QWdlbnQ+PC9kYzpjcmVhdG9yPjwvY2M6V29yaz48Y2M6TGljZW5zZSByZGY6YWJvdXQ9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL2xpY2Vuc2VzL2J5LzMuMC8iPjxjYzpwZXJtaXRzIHJkZjpyZXNvdXJjZT0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjUmVwcm9kdWN0aW9uIi8+PGNjOnBlcm1pdHMgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNEaXN0cmlidXRpb24iLz48Y2M6cmVxdWlyZXMgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNOb3RpY2UiLz48Y2M6cmVxdWlyZXMgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNBdHRyaWJ1dGlvbiIvPjxjYzpwZXJtaXRzIHJkZjpyZXNvdXJjZT0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjRGVyaXZhdGl2ZVdvcmtzIi8+PGNjOnJlcXVpcmVzIHJkZjpyZXNvdXJjZT0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjU2hhcmVBbGlrZSIvPjwvY2M6TGljZW5zZT48L3JkZjpSREY+PC9tZXRhZGF0YT48Zz48cmVjdCB3aWR0aD0iMjQyIiBoZWlnaHQ9IjI0MiIgc3Ryb2tlPSJub25lIiBmaWxsPSJ3aGl0ZSIgcnk9IjMyIiB4PSI3IiB5PSI3Ii8+PGc+PHBhdGggZD0iTSAwNjggMDY4IEwgMTk2IDA2MiIgc3Ryb2tlLXdpZHRoPSIxNiIgc3Ryb2tlPSIjY2NjIi8+PHBhdGggZD0iTSAwNjggMDY4IEwgMTk2IDE0MiIgc3Ryb2tlLXdpZHRoPSIxNiIgc3Ryb2tlPSIjY2NjIi8+PHBhdGggZD0iTSAwNjggMDY4IEwgMDYyIDE5NiIgc3Ryb2tlLXdpZHRoPSIxNiIgc3Ryb2tlPSIjY2NjIi8+PGNpcmNsZSBjeD0iMTk2IiBjeT0iMDYyIiByPSIwMjQiIGZpbGw9ImJsYWNrIi8+PGNpcmNsZSBjeD0iMTk2IiBjeT0iMTQyIiByPSIwMjQiIGZpbGw9ImJsYWNrIi8+PGNpcmNsZSBjeD0iMDYyIiBjeT0iMTk2IiByPSIwMjQiIGZpbGw9ImJsYWNrIi8+PC9nPjxnPjxwYXRoIGQ9Ik0gMDY4IDA2OCBMIDE0MiAxOTYiIHN0cm9rZS13aWR0aD0iMTYiIHN0cm9rZT0iI2NjYyIvPjxjaXJjbGUgY3g9IjE0MiIgY3k9IjE5NiIgcj0iMDI0IiBmaWxsPSJibGFjayIvPjxjaXJjbGUgY3g9IjA3MiIgY3k9IjA3MiIgcj0iMDMyIiBmaWxsPSIjYmVlNmJlIiBzdHJva2U9ImJsYWNrIiBzdHJva2Utd2lkdGg9IjgiLz48L2c+PHJlY3Qgd2lkdGg9IjI0MiIgaGVpZ2h0PSIyNDIiIHN0cm9rZT0iYmxhY2siIGZpbGw9Im5vbmUiIHN0cm9rZS13aWR0aD0iMTIiIHJ5PSIzMiIgeD0iNyIgeT0iNyIvPjwvZz48L3N2Zz4K',
};

// ---------------------------------------------------------------------------
// External link templates
// ---------------------------------------------------------------------------
const LINKS = {
  wikimedia_commons: 'https://commons.wikimedia.org/wiki/%s',
  wikipedia: 'https://wikipedia.org/wiki/%s',
  wikidata: 'https://www.wikidata.org/wiki/%s',
  mapillary: 'https://www.mapillary.com/app/?pKey=%s',
};

const FEATURE_LINKS = {
  view: 'https://www.openstreetmap.org/{osm_type}/{osm_id}',
  edit: 'https://www.openstreetmap.org/edit?{osm_type}={osm_id}',
};

type JsonRecord = Record<string, unknown>;
type OsmElementType = 'node' | 'way' | 'relation';
type Coordinates = [number, number];
type FeatureContent = {
  name?: string;
  type?: string;
  country?: string;
  index?: number;
};
type FormatSpec = {
  map?: {
    key?: { format?: FormatSpec };
    value?: { format?: FormatSpec };
  };
  template?: string;
  lookup?: string;
  country_prefix?: unknown;
};
type ListSpec = {
  colorProperty: string;
  labelProperty: string;
  properties: string[];
  routeIdProperty?: string;
};
type FeatureLinks = typeof FEATURE_LINKS;
type FeaturePropertyDefinition = {
  name?: string;
  format?: FormatSpec;
  link?: string;
  paragraph?: boolean;
  list?: ListSpec;
  description?: string;
};
type FeatureCatalog = {
  featureProperty?: string;
  colorProperty?: string;
  labelProperties?: string[];
  featureLinks?: FeatureLinks;
  features?: Record<string, FeatureContent>;
  properties?: Record<string, FeaturePropertyDefinition>;
};
type FeaturesCatalog = Record<string, FeatureCatalog>;
type FormattedValue = string | Array<[string, string]>;
type PopupPropertyValue = {
  title: string;
  value: unknown;
  body: Array<[string | null, string]>;
  paragraph?: boolean;
  list?: ListSpec;
  link?: string;
  tooltip?: string;
};
type CommonsImageData = {
  file_name: string;
  thumbnail_url: string;
  view_url: string;
  description: string;
  attribution: string;
  license: string;
  license_url: string;
};
type LngLatLike = {
  distanceTo(other: LngLatLike): number;
  toArray(): Coordinates;
};
type MaplibreLike = {
  LngLat: {
    convert(value: unknown): LngLatLike;
  };
  Popup: new (options?: JsonRecord) => PopupBuilderLike;
};
type PopupLike = {
  remove(): void;
};
type PopupBuilderLike = PopupLike & {
  setLngLat(coordinates: unknown): PopupBuilderLike;
  setDOMContent(node: Node): PopupBuilderLike;
  addTo(map: MapLike): PopupBuilderLike;
  on(type: 'close', listener: () => void): unknown;
};
type RenderedFeatureLike = {
  id?: string | number;
  source: string;
  sourceLayer?: string;
  properties?: JsonRecord;
  geometry: {
    type: string;
    coordinates?: unknown;
  };
};
type FeatureStateTarget = {
  source: string;
  sourceLayer?: string;
  id: string | number;
};
type PopupMapEvent = {
  point: unknown;
  lngLat: unknown;
  originalEvent?: Event & {
    weatherPickerHandled?: boolean;
    routingHandled?: boolean;
  };
};
type MapLike = {
  getContainer(): HTMLElement;
  getCanvas(): HTMLCanvasElement;
  queryRenderedFeatures(point: unknown): RenderedFeatureLike[];
  setFeatureState(feature: FeatureStateTarget, state: JsonRecord): void;
  on(type: 'mousemove' | 'click', listener: (event: PopupMapEvent) => void): void;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value);
}

function firstRecord(value: unknown): JsonRecord | null {
  return Array.isArray(value) && isRecord(value[0]) ? value[0] : null;
}

function stripHtml(value: unknown): string {
  return stringValue(value).replace(/<[^>]*>/g, '');
}

function metadataValue(metadata: JsonRecord, key: string): string {
  const item = metadata[key];
  return isRecord(item) ? stringValue(item.value) : '';
}

// ---------------------------------------------------------------------------
// Country flag emoji helper
// ---------------------------------------------------------------------------
function getFlagEmoji(countryCode: string) {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return codePoints.length ? String.fromCodePoint(...(codePoints as [number, ...number[]])) : '';
}

// ---------------------------------------------------------------------------
// Natural sort comparator
// ---------------------------------------------------------------------------
function naturalSort(a: string | number, b: string | number) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// DOM helper — mirrors ORM's createDomElement()
// ---------------------------------------------------------------------------
function el<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  container?: Element,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tagName);
  if (className !== undefined) e.className = className;
  if (container) container.appendChild(e);
  return e;
}

// ---------------------------------------------------------------------------
// Construct catalog key from a property value
// Removes variable parts in {} braces and icon position after @
// ---------------------------------------------------------------------------
function constructCatalogKey(propertyValue: unknown) {
  if (typeof propertyValue !== 'string') {
    return {
      catalogKey: propertyValue === undefined || propertyValue === null ? undefined : String(propertyValue),
      keyVariable: null,
    };
  }
  const catalogKey = propertyValue.replace(/\{[^}]+}/, '{}').replace(/@([^|]+|$)/g, '');
  const keyVariable = propertyValue.match(/\{([^}]+)}/)?.[1] ?? null;
  return { catalogKey, keyVariable };
}

// ---------------------------------------------------------------------------
// Determine default OSM element type from properties / feature content
// ---------------------------------------------------------------------------
function determineDefaultOsmType(properties: JsonRecord, featureContent?: FeatureContent): OsmElementType {
  if (properties.osm_type) {
    return properties.osm_type === 'N' ? 'node' : properties.osm_type === 'R' ? 'relation' : 'way';
  }
  const featureType = (featureContent && featureContent.type) || 'point';
  return featureType === 'point' ? 'node' : featureType === 'relation' ? 'relation' : 'way';
}

// ---------------------------------------------------------------------------
// Parse osm_id / osm_type into an array of {id, type} objects
// Multiple IDs are separated by \u001e (record separator)
// ---------------------------------------------------------------------------
function determineOsmFeatures(
  properties: JsonRecord,
  featureContent?: FeatureContent,
): Array<{ id: string; type: OsmElementType }> {
  const osmIds = properties.osm_id ? String(properties.osm_id).split('\u001e') : [];
  const defaultOsmType = determineDefaultOsmType(properties, featureContent);
  const osmTypes = properties.osm_type ? String(properties.osm_type).split('\u001e') : [];

  return osmIds.map((osm_id, index) => {
    const osmType: OsmElementType =
      osmTypes.length > index
        ? osmTypes[index] === 'N'
          ? 'node'
          : osmTypes[index] === 'R'
            ? 'relation'
            : 'way'
        : defaultOsmType;
    return { id: osm_id, type: osmType };
  });
}

// ---------------------------------------------------------------------------
// Format a property value according to its format specification
// ---------------------------------------------------------------------------
function formatPropertyValue(value: unknown, format?: FormatSpec, features?: FeaturesCatalog): FormattedValue {
  if (format?.map) {
    const keyFormat = format.map.key?.format;
    const valueFormat = format.map.value?.format;
    let sortKey = (v: string): string | number => v;
    if (keyFormat?.lookup && features?.[keyFormat.lookup]?.features) {
      const catalog = features[keyFormat.lookup].features ?? {};
      sortKey = (v: string) => catalog[v]?.index ?? Number.MAX_SAFE_INTEGER;
    }

    return String(value)
      .split('\u001d')
      .map((item) => item.split('\u001e'))
      .toSorted(([keyA], [keyB]) => naturalSort(sortKey(keyA), sortKey(keyB)))
      .map(([key, val]) => [
        String(formatPropertyValue(key, keyFormat, features)),
        String(formatPropertyValue(val, valueFormat, features)),
      ]);
  }

  return String(value)
    .split('\u001e')
    .map((stringValue) => {
      if (!format) {
        return stringValue;
      } else if (format.template) {
        return format.template
          .replace('%s', () => stringValue)
          .replace(/%(\.(\d+))?d/, (_1, _2, decimals: string | undefined) => Number(value).toFixed(Number(decimals)));
      } else if (format.lookup) {
        const lookupCatalog = features?.[format.lookup];
        if (!lookupCatalog) {
          return stringValue;
        }
        const { catalogKey: lookUpCatalogKey, keyVariable: lookUpKeyVariable } = constructCatalogKey(value);
        const lookedUpValue = lookUpCatalogKey ? lookupCatalog.features?.[lookUpCatalogKey] : undefined;
        if (!lookedUpValue) {
          return stringValue;
        }
        return `${lookedUpValue.name}${lookUpKeyVariable ? ` (${lookUpKeyVariable})` : ''}${lookedUpValue.country ? ` ${getFlagEmoji(lookedUpValue.country)}` : ''}`;
      } else if (format.country_prefix) {
        if (stringValue && stringValue.length >= 3 && stringValue[2] === ':') {
          return stringValue.substr(3);
        }
        return stringValue;
      }
      return stringValue;
    })
    .join(', ');
}

// ---------------------------------------------------------------------------
// Closest point on a line to a given point (for LineString popup placement)
// ---------------------------------------------------------------------------
function closestPointOnLine(maplibregl: MaplibreLike, point: unknown, line: unknown[]): Coordinates | null {
  const lngLatPoint = maplibregl.LngLat.convert(point);
  const { closest0, closest1 } = line
    .map((item) => maplibregl.LngLat.convert(item))
    .reduce<{
      closest0: LngLatLike | null;
      closest1: LngLatLike | null;
    }>(
      (acc, cur) => {
        const d = lngLatPoint.distanceTo(cur);
        if (acc.closest0 == null || d < lngLatPoint.distanceTo(acc.closest0)) {
          return { closest0: cur, closest1: acc.closest0 };
        } else if (acc.closest1 == null || d < lngLatPoint.distanceTo(acc.closest1)) {
          return { closest0: acc.closest0, closest1: cur };
        }
        return acc;
      },
      { closest0: null, closest1: null },
    );

  if (closest0 == null && closest1 == null) return null;

  const closest0Array = closest0.toArray();
  if (closest1 == null) return closest0Array;
  const closest1Array = closest1.toArray();
  const pt = lngLatPoint.toArray();

  const abx = closest1Array[0] - closest0Array[0];
  const aby = closest1Array[1] - closest0Array[1];
  const acx = pt[0] - closest0Array[0];
  const acy = pt[1] - closest0Array[1];
  const coeff = (abx * acx + aby * acy) / (abx * abx + aby * aby);
  return [closest0Array[0] + abx * coeff, closest0Array[1] + aby * coeff];
}

// ---------------------------------------------------------------------------
// Build a feature catalog for the layers in our app.
//
// The catalog is keyed by "${source}-${sourceLayer}".
// The upstream ORM features.mjs generates this at build time from YAML;
// here we define the subset we need inline.
// ---------------------------------------------------------------------------
export function buildFeatureCatalog() {
  const railwayLineFeatures = {
    labelProperties: ['standard_label'],
    featureLinks: FEATURE_LINKS,
    features: {
      rail: { name: 'Railway', type: 'line' },
      tram: { name: 'Tram', type: 'line' },
      light_rail: { name: 'Light rail', type: 'line' },
      subway: { name: 'Subway', type: 'line' },
      monorail: { name: 'Monorail', type: 'line' },
      narrow_gauge: { name: 'Narrow gauge railway', type: 'line' },
      miniature: { name: 'Miniature railway', type: 'line' },
      funicular: { name: 'Funicular', type: 'line' },
      ferry: { name: 'Ferry', type: 'line' },
      construction: { name: 'Railway under construction', type: 'line' },
      proposed: { name: 'Proposed railway', type: 'line' },
      disused: { name: 'Disused railway', type: 'line' },
      abandoned: { name: 'Abandoned railway', type: 'line' },
      razed: { name: 'Razed railway', type: 'line' },
      preserved: { name: 'Preserved railway', type: 'line' },
    },
    properties: {
      state: { name: 'State' },
      usage: { name: 'Usage' },
      service: { name: 'Service' },
      highspeed: { name: 'High speed' },
      preferred_direction: { name: 'Preferred direction' },
      tunnel: { name: 'Tunnel' },
      bridge: { name: 'Bridge' },
      ref: { name: 'Reference' },
      track_ref: { name: 'Track' },
      speed_label: { name: 'Speed' },
      train_protection: { name: 'Train protection' },
      electrification_state: { name: 'Electrification' },
      frequency: { name: 'Frequency', format: { template: '%.2d Hz' } },
      voltage: { name: 'Voltage', format: { template: '%d V' } },
      maximum_current: { name: 'Maximum current', format: { template: '%d A' } },
      future_frequency: { name: 'Future frequency', format: { template: '%.2d Hz' } },
      future_voltage: { name: 'Future voltage', format: { template: '%d V' } },
      gauge_label: { name: 'Gauge' },
      loading_gauge: { name: 'Loading gauge' },
      track_class: { name: 'Track class' },
      reporting_marks: { name: 'Reporting marks' },
      operator: { name: 'Operator' },
      owner: { name: 'Owner' },
      traffic_mode: { name: 'Traffic mode' },
      radio: { name: 'Radio' },
      wikidata: { name: 'Wikidata', link: LINKS.wikidata },
      wikimedia_commons: { name: 'Wikimedia', link: LINKS.wikimedia_commons },
      mapillary: { name: 'Mapillary', link: LINKS.mapillary },
      wikipedia: { name: 'Wikipedia', link: LINKS.wikipedia, format: { country_prefix: {} } },
      note: { name: 'Note', paragraph: true },
      description: { name: 'Description', paragraph: true },
      line_routes: {
        name: 'Routes',
        list: {
          routeIdProperty: 'route_id',
          colorProperty: 'color',
          labelProperty: 'label',
          properties: ['route_id', 'color', 'label'],
        },
      },
    },
  };

  const stationFeatures = {
    featureProperty: 'feature',
    labelProperties: ['localized_name', 'name'],
    featureLinks: FEATURE_LINKS,
    features: {
      station: { name: 'Station' },
      halt: { name: 'Halt' },
      tram_stop: { name: 'Tram stop' },
      service_station: { name: 'Service station' },
      yard: { name: 'Railway yard' },
      junction: { name: 'Junction' },
      spur_junction: { name: 'Spur junction' },
      crossover: { name: 'Crossover' },
      site: { name: 'Railway site' },
    },
    properties: {
      station: { name: 'Type' },
      state: { name: 'State' },
      references: {
        name: 'References',
        format: {
          map: {
            key: { format: { lookup: 'station_references' } },
            value: {},
          },
        },
      },
      operator: { name: 'Operator' },
      network: { name: 'Network' },
      position: { name: 'Position' },
      yard_purpose: { name: 'Yard purpose' },
      yard_hump: { name: 'Yard hump' },
      wikidata: { name: 'Wikidata', link: LINKS.wikidata },
      wikimedia_commons: { name: 'Wikimedia', link: LINKS.wikimedia_commons },
      mapillary: { name: 'Mapillary', link: LINKS.mapillary },
      wikipedia: { name: 'Wikipedia', link: LINKS.wikipedia, format: { country_prefix: {} } },
      note: { name: 'Note', paragraph: true },
      description: { name: 'Description', paragraph: true },
      station_routes: {
        name: 'Routes',
        list: {
          routeIdProperty: 'route_id',
          colorProperty: 'color',
          labelProperty: 'label',
          properties: ['route_id', 'color', 'label'],
        },
      },
    },
  };

  const signalProperties = {
    feature: { name: 'Signal' },
    feature0: { name: 'Primary signal' },
    feature1: { name: 'Secondary signal' },
    ref: { name: 'Reference' },
    caption: { name: 'Caption' },
    type: { name: 'Type' },
    deactivated0: { name: 'Primary deactivated' },
    deactivated1: { name: 'Secondary deactivated' },
    direction_both: { name: 'both directions' },
    position: { name: 'Position' },
    wikidata: { name: 'Wikidata', link: LINKS.wikidata },
    wikimedia_commons: { name: 'Wikimedia', link: LINKS.wikimedia_commons },
    mapillary: { name: 'Mapillary', link: LINKS.mapillary },
    wikipedia: { name: 'Wikipedia', link: LINKS.wikipedia },
    note: { name: 'Note', paragraph: true },
    description: { name: 'Description', paragraph: true },
  };

  const signalFeatures = {
    featureProperty: 'railway',
    featureLinks: FEATURE_LINKS,
    features: {
      signal: { name: 'Signal' },
      buffer_stop: { name: 'Buffer stop' },
      derail: { name: 'Derailer' },
      vacancy_detection: { name: 'Vacancy detection' },
    },
    properties: signalProperties,
  };

  const poiFeatures = {
    labelProperties: ['name'],
    featureLinks: FEATURE_LINKS,
    features: {
      'general/border': { name: 'Border crossing' },
      'general/owner-change': { name: 'Owner change' },
      'general/radio-mast': { name: 'Radio mast' },
      'general/radio-antenna': { name: 'Radio antenna' },
      'general/container-terminal': { name: 'Container terminal' },
      'general/ferry-terminal': { name: 'Ferry terminal' },
      'general/lubricator': { name: 'Lubricator' },
      'general/fuel': { name: 'Fuel' },
      'general/sand_store': { name: 'Sand store' },
      'general/defect_detector': { name: 'Defect detector' },
      'general/aei': { name: 'AEI' },
      'general/hump': { name: 'Hump' },
      'general/loading_ramp': { name: 'Loading ramp' },
      'general/preheating': { name: 'Preheating' },
      'general/wash': { name: 'Wash' },
      'general/water_crane': { name: 'Water crane' },
      'general/phone': { name: 'Phone' },
      'general/coaling_facility': { name: 'Coaling facility' },
    },
    properties: {
      ref: { name: 'Reference' },
      position: { name: 'Position' },
      wikidata: { name: 'Wikidata', link: LINKS.wikidata },
      wikimedia_commons: { name: 'Wikimedia', link: LINKS.wikimedia_commons },
      mapillary: { name: 'Mapillary', link: LINKS.mapillary },
      wikipedia: { name: 'Wikipedia', link: LINKS.wikipedia, format: { country_prefix: {} } },
      note: { name: 'Note', paragraph: true },
      description: { name: 'Description', paragraph: true },
    },
  };

  const milestoneFeatures = {
    featureProperty: 'railway',
    featureLinks: FEATURE_LINKS,
    features: {
      milestone: { name: 'Milestone' },
      level_crossing: { name: 'Level crossing' },
      crossing: { name: 'Crossing' },
    },
    properties: {
      pos: { name: 'Position' },
      pos_exact: { name: 'Exact position' },
      type: { name: 'Type' },
      operator: { name: 'Operator' },
      wikidata: { name: 'Wikidata', link: LINKS.wikidata },
      wikimedia_commons: { name: 'Wikimedia', link: LINKS.wikimedia_commons },
      mapillary: { name: 'Mapillary', link: LINKS.mapillary },
      wikipedia: { name: 'Wikipedia', link: LINKS.wikipedia },
      note: { name: 'Note', paragraph: true },
      description: { name: 'Description', paragraph: true },
    },
  };

  const switchFeatures = {
    featureProperty: 'railway',
    featureLinks: FEATURE_LINKS,
    features: {
      switch: { name: 'Switch' },
      railway_crossing: { name: 'Railway crossing' },
    },
    properties: {
      ref: { name: 'Reference' },
      type: { name: 'Type' },
      turnout_side: { name: 'Turnout side' },
      local_operated: { name: 'Operated locally' },
      resetting: { name: 'Resetting' },
      position: { name: 'Position' },
      wikidata: { name: 'Wikidata', link: LINKS.wikidata },
      wikimedia_commons: { name: 'Wikimedia', link: LINKS.wikimedia_commons },
      mapillary: { name: 'Mapillary', link: LINKS.mapillary },
      wikipedia: { name: 'Wikipedia', link: LINKS.wikipedia },
      note: { name: 'Note', paragraph: true },
      description: { name: 'Description', paragraph: true },
    },
  };

  const signalBoxFeatures = {
    labelProperties: ['name'],
    featureLinks: FEATURE_LINKS,
    features: {
      signal_box: { name: 'Signal box' },
      crossing_box: { name: 'Crossing box' },
      blockpost: { name: 'Block post' },
    },
    properties: {
      ref: { name: 'Reference' },
      position: { name: 'Position' },
      operator: { name: 'Operator' },
      wikidata: { name: 'Wikidata', link: LINKS.wikidata },
      wikimedia_commons: { name: 'Wikimedia', link: LINKS.wikimedia_commons },
      mapillary: { name: 'Mapillary', link: LINKS.mapillary },
      wikipedia: { name: 'Wikipedia', link: LINKS.wikipedia },
      note: { name: 'Note', paragraph: true },
      description: { name: 'Description', paragraph: true },
    },
  };

  const platformFeatures = {
    featureLinks: FEATURE_LINKS,
    features: { platform: { name: 'Platform', type: 'polygon' } },
    labelProperties: ['name'],
    properties: {
      ref: { name: 'Reference' },
      height: { name: 'Height', format: { template: '%.2d m' } },
      surface: { name: 'Surface' },
      elevator: { name: 'Elevator' },
      shelter: { name: 'Shelter' },
      lit: { name: 'Lit' },
      bin: { name: 'Bin' },
      bench: { name: 'Bench' },
      wheelchair: { name: 'Wheelchair accessible' },
      departures_board: { name: 'Departures board' },
      tactile_paving: { name: 'Tactile paving' },
      platform_routes: {
        name: 'Routes',
        list: {
          routeIdProperty: 'route_id',
          colorProperty: 'color',
          labelProperty: 'label',
          properties: ['route_id', 'color', 'label'],
        },
      },
    },
  };

  const stopPositionFeatures = {
    featureLinks: FEATURE_LINKS,
    labelProperties: ['name'],
    featureProperty: 'type',
    features: {
      train: { name: 'Train stop' },
      tram: { name: 'Tram stop' },
      subway: { name: 'Subway stop' },
      light_rail: { name: 'Light rail stop' },
    },
    properties: {
      ref: { name: 'Reference' },
      local_ref: { name: 'Local reference' },
      stop_position_routes: {
        name: 'Routes',
        list: {
          routeIdProperty: 'route_id',
          colorProperty: 'color',
          labelProperty: 'label',
          properties: ['route_id', 'color', 'label'],
        },
      },
    },
  };

  const turntableFeatures = {
    featureLinks: FEATURE_LINKS,
    features: {
      turntable: { name: 'Turntable', type: 'polygon' },
      traverser: { name: 'Transfer table', type: 'polygon' },
    },
  };

  const platformEdgeFeatures = {
    featureLinks: FEATURE_LINKS,
    features: { platform_edge: { name: 'Platform edge', type: 'line' } },
    labelProperties: ['ref'],
    properties: {
      height: { name: 'Height', format: { template: '%.2d m' } },
      tactile_paving: { name: 'Tactile paving' },
    },
  };

  const stationEntranceFeatures = {
    featureLinks: FEATURE_LINKS,
    featureProperty: 'type',
    features: {
      subway: { name: 'Subway entrance' },
      train: { name: 'Train station entrance' },
    },
    properties: {
      name: { name: 'Name' },
      ref: { name: 'Reference' },
      wikidata: { name: 'Wikidata', link: LINKS.wikidata },
      wikimedia_commons: { name: 'Wikimedia', link: LINKS.wikimedia_commons },
      mapillary: { name: 'Mapillary', link: LINKS.mapillary },
      wikipedia: { name: 'Wikipedia', link: LINKS.wikipedia },
      note: { name: 'Note', paragraph: true },
      description: { name: 'Description', paragraph: true },
    },
  };

  const catenaryFeatures = {
    featureProperty: 'feature',
    featureLinks: FEATURE_LINKS,
    features: {
      mast: { name: 'Catenary mast' },
      portal: { name: 'Catenary portal' },
    },
    properties: {
      ref: { name: 'Reference' },
      position: { name: 'Position' },
      transition: { name: 'Transition point' },
      structure: { name: 'Structure' },
      supporting: { name: 'Supporting' },
      attachment: { name: 'Attachment' },
      tensioning: { name: 'Tensioning' },
      insulator: { name: 'Insulator' },
      note: { name: 'Note', paragraph: true },
      description: { name: 'Description', paragraph: true },
    },
  };

  const substationFeatures = {
    featureProperty: 'feature',
    featureLinks: FEATURE_LINKS,
    labelProperties: ['name'],
    features: { traction: { name: 'Traction substation', type: 'polygon' } },
    properties: {
      ref: { name: 'Reference' },
      location: { name: 'Location' },
      operator: { name: 'Operator' },
      voltage: { name: 'Voltage', format: { template: '%s V' } },
      wikidata: { name: 'Wikidata', link: LINKS.wikidata },
      wikimedia_commons: { name: 'Wikimedia', link: LINKS.wikimedia_commons },
      mapillary: { name: 'Mapillary', link: LINKS.mapillary },
      wikipedia: { name: 'Wikipedia', link: LINKS.wikipedia, format: { country_prefix: {} } },
      note: { name: 'Note', paragraph: true },
      description: { name: 'Description', paragraph: true },
    },
  };

  // The lookup-only catalogs (not tied to a source-layer, used by format.lookup)
  const stationReferences = {
    features: {
      'railway-ref': { name: 'Railway reference', index: 0 },
      uic: { name: 'UIC', index: 1 },
      ibnr: { name: 'IBNR', index: 2 },
      ifopt: { name: 'IFOPT', index: 3 },
      iata: { name: 'IATA', index: 4 },
      'eu-plc': { name: 'PLC', index: 5 },
      'db-de': { name: 'DB', index: 6 },
      'gb-crs': { name: 'CRS', index: 7 },
      'gb-tiploc': { name: 'TIPLOC', index: 8 },
    },
  };

  // Map of "${source}-${sourceLayer}" -> catalog entry
  // These keys must match what maplibregl reports as feature.source + '-' + feature.sourceLayer
  return {
    // Railway lines (all map styles share the same line catalog)
    'high-railway_line_high': railwayLineFeatures,
    'openrailwaymap_low-railway_line_high': railwayLineFeatures,
    'standard_railway_line_low-standard_railway_line_low': railwayLineFeatures,
    'speed_railway_line_low-speed_railway_line_low': railwayLineFeatures,
    'signals_railway_line_low-signals_railway_line_low': railwayLineFeatures,
    'electrification_railway_line_low-electrification_railway_line_low': railwayLineFeatures,
    'track_railway_line_low-track_railway_line_low': railwayLineFeatures,
    'operator_railway_line_low-operator_railway_line_low': railwayLineFeatures,

    // Stations
    'standard_railway_text_stations_low-standard_railway_text_stations_low': stationFeatures,
    'standard_railway_text_stations_med-standard_railway_text_stations_med': stationFeatures,
    'openrailwaymap_standard-standard_railway_text_stations': stationFeatures,
    'openrailwaymap_standard-standard_railway_grouped_stations': stationFeatures,

    // Standard layer features
    'openrailwaymap_standard-standard_railway_turntables': turntableFeatures,
    'openrailwaymap_standard-standard_railway_platforms': platformFeatures,
    'openrailwaymap_standard-standard_railway_platform_edges': platformEdgeFeatures,
    'openrailwaymap_standard-standard_railway_stop_positions': stopPositionFeatures,
    'openrailwaymap_standard-standard_station_entrances': stationEntranceFeatures,
    'openrailwaymap_standard-standard_railway_symbols': poiFeatures,
    'openrailwaymap_standard-standard_railway_switch_ref': switchFeatures,

    // Milestones
    'high-railway_text_km': milestoneFeatures,

    // Speed signals
    'openrailwaymap_speed-speed_railway_signals': signalFeatures,

    // Signal layer
    'openrailwaymap_signals-signals_railway_signals': signalFeatures,
    'openrailwaymap_signals-signals_signal_boxes': signalBoxFeatures,

    // Electrification
    'openrailwaymap_electrification-electrification_signals': signalFeatures,
    'openrailwaymap_electrification-electrification_railway_symbols': poiFeatures,
    'openrailwaymap_electrification-electrification_catenary': catenaryFeatures,
    'openrailwaymap_electrification-electrification_substation': substationFeatures,

    // Operator
    'openrailwaymap_operator-operator_railway_symbols': poiFeatures,

    // Lookup-only catalogs (used by format.lookup, not tied to a source-layer)
    station_references: stationReferences,
  };
}

// ---------------------------------------------------------------------------
// Main popup content builder — mirrors ORM popupContent()
// Builds DOM (not innerHTML) to avoid XSS, exactly like upstream.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Client-side Wikidata / Wikimedia Commons image fetching
// (replaces ORM backend proxy endpoints /api/wikidata/ and /api/wikimedia/)
// ---------------------------------------------------------------------------

function renderImageData(linkEl: HTMLAnchorElement, data: CommonsImageData, _abortController: AbortController) {
  const img = el('img', 'orm-popup-image', linkEl);
  img.style.display = 'none';
  img.onload = () => (img.style.display = 'block');

  const desc = `Image ${data.file_name}${data.description ? `: ${data.description}` : ''}`;
  img.src = data.thumbnail_url;
  img.title = desc;
  img.alt = desc;
  linkEl.href = data.view_url;
  linkEl.title = desc;

  if (data.license || data.attribution) {
    const attr = el('span', 'orm-img-attribution collapsed', linkEl);
    const copy = el('span', 'orm-img-copyright', attr);
    copy.innerText = '\u00A9';
    copy.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      attr.classList.toggle('collapsed');
    };
    if (data.license) {
      if (data.license_url) {
        const licEl = el('a', 'orm-hide-collapsed', attr);
        licEl.href = data.license_url;
        licEl.target = '_blank';
        licEl.innerText = data.license;
      } else {
        const licEl = el('span', 'orm-hide-collapsed', attr);
        licEl.innerText = data.license;
      }
    }
    if (data.attribution) {
      const attrEl = el('span', 'orm-hide-collapsed', attr);
      attrEl.innerText = data.attribution;
    }
  }
}

function fetchCommonsImageData(fileName: string, signal: AbortSignal): Promise<CommonsImageData | null> {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query' +
    `&titles=File:${encodeURIComponent(fileName)}` +
    '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=330&format=json&origin=*';
  return fetch(url, { signal })
    .then((r) => r.json())
    .then((json: unknown) => {
      const pages = isRecord(json) && isRecord(json.query) && isRecord(json.query.pages) ? json.query.pages : null;
      if (!pages) return null;
      const page = Object.values(pages).find(isRecord);
      const info = firstRecord(page?.imageinfo);
      if (!info) return null;
      const meta = isRecord(info.extmetadata) ? info.extmetadata : {};
      const artist = stripHtml(metadataValue(meta, 'Artist'));
      const license = metadataValue(meta, 'LicenseShortName');
      const licenseUrl = metadataValue(meta, 'LicenseUrl');
      const description = stripHtml(metadataValue(meta, 'ImageDescription')).slice(0, 200);
      const thumbnailUrl = stringValue(info.thumburl || info.url);
      if (!thumbnailUrl) return null;
      return {
        file_name: fileName,
        thumbnail_url: thumbnailUrl,
        view_url:
          stringValue(info.descriptionurl) || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}`,
        description,
        attribution: artist,
        license,
        license_url: licenseUrl,
      };
    });
}

function fetchWikidataImage(linkEl: HTMLAnchorElement, wikidataId: string, abortController: AbortController) {
  const url =
    'https://www.wikidata.org/w/api.php?action=wbgetclaims' +
    `&entity=${encodeURIComponent(wikidataId)}` +
    '&property=P18&format=json&origin=*';
  fetch(url, { signal: abortController.signal })
    .then((r) => r.json())
    .then((json: unknown) => {
      const claims = isRecord(json) && isRecord(json.claims) && Array.isArray(json.claims.P18) ? json.claims.P18 : null;
      const claim = firstRecord(claims);
      const mainsnak = isRecord(claim?.mainsnak) ? claim.mainsnak : null;
      const datavalue = isRecord(mainsnak?.datavalue) ? mainsnak.datavalue : null;
      const fileName = stringValue(datavalue?.value);
      if (!fileName) return null;
      return fetchCommonsImageData(fileName, abortController.signal);
    })
    .then((data) => {
      if (data) {
        data.view_url = `https://www.wikidata.org/wiki/${wikidataId}#/media/File:${encodeURIComponent(data.file_name)}`;
        renderImageData(linkEl, data, abortController);
      }
    })
    .catch((err) => {
      if (!abortController.signal.aborted) {
        console.error('Error fetching Wikidata image', err);
      }
    });
}

function fetchCommonsImage(linkEl: HTMLAnchorElement, commonsFile: string, abortController: AbortController) {
  fetchCommonsImageData(commonsFile, abortController.signal)
    .then((data) => {
      if (data) renderImageData(linkEl, data, abortController);
    })
    .catch((err) => {
      if (!abortController.signal.aborted) {
        console.error('Error fetching Commons image', err);
      }
    });
}

function popupContent(
  feature: RenderedFeatureLike,
  featuresCatalog: FeaturesCatalog,
  abortController: AbortController,
) {
  const properties = feature.properties || {};
  const layerSource = `${feature.source}${feature.sourceLayer ? `-${feature.sourceLayer}` : ''}`;

  const featureCatalog = featuresCatalog[layerSource];
  if (!featureCatalog) {
    // Fallback: render a simple property dump
    return fallbackPopupContent(properties, layerSource);
  }

  const featureProperty = featureCatalog.featureProperty || 'feature';
  const colorProperty = featureCatalog.colorProperty || 'color';
  const featureLinks = featureCatalog.featureLinks || FEATURE_LINKS;

  const { catalogKey, keyVariable } = constructCatalogKey(properties[featureProperty]);
  const featureContent = featureCatalog.features && featureCatalog.features[catalogKey];

  // Unique labels
  const labels = [...new Set((featureCatalog.labelProperties || []).map((lp) => properties[lp]).filter(Boolean))];
  const featureDescription = featureContent
    ? `${featureContent.name}${keyVariable ? ` (${keyVariable})` : ''}${featureContent.country ? ` ${getFlagEmoji(featureContent.country)}` : ''}`
    : stringValue(properties[featureProperty]) || 'Unknown feature';
  const color = properties[colorProperty];

  // --- Build property values ---
  const propertyValues = Object.entries(featureCatalog.properties || {})
    .filter(
      ([property]) =>
        properties[property] !== undefined &&
        properties[property] !== null &&
        properties[property] !== '' &&
        properties[property] !== false,
    )
    .map(([property, definition]): PopupPropertyValue => {
      const { name, format, link, paragraph, list, description: tooltip } = definition;
      const value =
        properties[property] === true ? '' : formatPropertyValue(properties[property], format, featuresCatalog);

      const body: Array<[string | null, string]> = Array.isArray(value) ? value : [[null, value]];

      return {
        title: name || property,
        value: properties[property],
        body,
        paragraph,
        list,
        link,
        tooltip,
      };
    });

  const osmFeatures = determineOsmFeatures(properties, featureContent);

  // === Build DOM ===
  const popupContainer = el('div', 'orm-popup');

  // Title
  const popupTitle = el('h5', 'orm-popup-title', popupContainer);
  popupTitle.innerText = featureDescription;

  // Label row (icon / color marker / name labels)
  if (properties.icon || labels.length > 0 || color) {
    const popupLabel = el('h6', 'orm-popup-label', popupContainer);
    if (properties.icon) {
      const span = el('span', undefined, popupLabel);
      span.title = stringValue(properties.railway);
      span.innerText = stringValue(properties.icon);
    } else {
      if (typeof color === 'string') {
        const marker = el('span', 'orm-color-marker', popupLabel);
        marker.style.backgroundColor = color;
      }
      if (labels.length > 0) {
        const labelSpan = el('span', undefined, popupLabel);
        labelSpan.innerText = labels.map(stringValue).join(' \u2022 ');
      }
    }
  }

  // OSM ID buttons
  if (osmFeatures.length > 0) {
    const osmRow = el('h6', 'orm-popup-osm', popupContainer);
    osmFeatures.forEach(({ id, type }) => {
      const group = el('div', 'orm-btn-group', osmRow);

      const idBtn = el('button', 'orm-btn orm-btn-id', group);
      idBtn.type = 'button';
      idBtn.disabled = true;

      const icon = el('img', 'orm-osm-icon', idBtn);
      icon.src = OSM_ICONS[type] || OSM_ICONS.node;
      icon.alt = type;

      const code = el('code', undefined, idBtn);
      code.innerText = id;

      const viewLink = el('a', 'orm-btn orm-btn-action', group);
      viewLink.title = 'View on OpenStreetMap';
      viewLink.href = featureLinks.view.replace('{osm_type}', type).replace('{osm_id}', id);
      viewLink.target = '_blank';
      viewLink.innerText = 'View';

      const editLink = el('a', 'orm-btn orm-btn-action', group);
      editLink.title = 'Edit on OpenStreetMap';
      editLink.href = featureLinks.edit.replace('{osm_type}', type).replace('{osm_id}', id);
      editLink.target = '_blank';
      editLink.innerText = 'Edit';
    });
  }

  // Wikidata / Wikimedia Commons / direct image
  if (properties.wikidata || properties.wikimedia_commons_file || properties.image) {
    const imgContainer = el('p', 'orm-popup-images', popupContainer);

    if (properties.wikidata) {
      const link = el('a', 'orm-popup-image-link', imgContainer);
      link.target = '_blank';
      fetchWikidataImage(link, stringValue(properties.wikidata), abortController);
    }
    if (properties.wikimedia_commons_file) {
      const link = el('a', 'orm-popup-image-link', imgContainer);
      link.target = '_blank';
      fetchCommonsImage(link, stringValue(properties.wikimedia_commons_file), abortController);
    }
    if (properties.image) {
      const link = el('a', undefined, imgContainer);
      const imageUrl = stringValue(properties.image);
      link.href = imageUrl;
      link.target = '_blank';
      link.title = `Image: ${imageUrl}`;
      const img = el('img', 'orm-popup-image', link);
      img.src = imageUrl;
      img.alt = `Image: ${imageUrl}`;
      img.style.display = 'none';
      img.onload = () => (img.style.display = 'block');
    }
  }

  // Property badges (non-paragraph, non-list)
  const badgeProps = propertyValues.filter((it) => !it.paragraph && !it.list);
  if (badgeProps.length > 0) {
    const badgeContainer = el('h6', 'orm-popup-badges', popupContainer);
    badgeProps.forEach(({ title, body, value, link, tooltip }) => {
      const badge = el('span', 'orm-badge', badgeContainer);
      if (tooltip) {
        badge.title = tooltip;
        badge.style.cursor = 'help';
      }

      const titleSpan = el('span', 'orm-badge-title', badge);
      titleSpan.innerText = `${title}: `;

      let first = true;
      body.forEach(([key, bodyValue]) => {
        if (!bodyValue) return;
        if (first) {
          first = false;
        } else {
          const sep = el('span', undefined, badge);
          sep.innerText = ' \u2022 ';
        }
        if (key) {
          const keySpan = el('span', 'orm-badge-title', badge);
          keySpan.innerText = `${key} `;
        }
        if (link) {
          const wrapper = el('span', undefined, badge);
          const a = el('a', undefined, wrapper);
          a.href = link.replace('%s', () => encodeURIComponent(String(value)));
          a.target = '_blank';
          const text = el('span', undefined, a);
          text.innerText = bodyValue;
        } else {
          const span = el('span', undefined, badge);
          span.innerText = bodyValue;
        }
      });
    });
  }

  // Paragraph properties (note, description)
  const paraProps = propertyValues.filter((it) => it.paragraph);
  if (paraProps.length > 0) {
    const paraContainer = el('div', 'orm-popup-paragraphs', popupContainer);
    paraProps.forEach(({ title, body }) => {
      const p = el('p', undefined, paraContainer);
      const titleSpan = el('span', 'orm-badge-title', p);
      titleSpan.innerText = `${title}: `;

      let first = true;
      body.forEach(([key, value]) => {
        if (!value) return;
        if (first) {
          first = false;
        } else {
          const sep = el('span', undefined, p);
          sep.innerText = ' \u2022 ';
        }
        if (key) {
          const keySpan = el('span', 'orm-badge-title', p);
          keySpan.innerText = `${key} `;
        }
        const span = el('span', undefined, p);
        span.innerText = value;
      });
    });
  }

  // List properties (routes)
  const listProps = propertyValues.filter((it) => it.list);
  if (listProps.length > 0) {
    const listContainer = el('div', 'orm-popup-lists', popupContainer);
    listProps.forEach(({ title, value, list }) => {
      if (!list) return;
      const groups = stringValue(value)
        .split('\u001d')
        .map((group) => {
          const split = group.split('\u001e');
          return Object.fromEntries(list.properties.map((property, index) => [property, split[index] || null]));
        });

      const header = el('span', 'orm-badge-title', listContainer);
      header.innerText = `${title} (${groups.length}):`;

      const ul = el('ul', 'orm-popup-route-list', listContainer);
      groups.forEach((group) => {
        const groupColor = group[list.colorProperty];
        const label = group[list.labelProperty];

        const li = el('li', undefined, ul);
        if (groupColor) {
          const marker = el('span', 'orm-color-marker', li);
          marker.style.backgroundColor = groupColor;
        }
        if (label) {
          const labelSpan = el('span', undefined, li);
          labelSpan.innerText = label;
        }
      });
    });
  }

  return popupContainer;
}

// ---------------------------------------------------------------------------
// Fallback popup for layers not in the catalog
// ---------------------------------------------------------------------------
function fallbackPopupContent(properties: JsonRecord, _layerSource: string) {
  const container = el('div', 'orm-popup');

  const title = el('h5', 'orm-popup-title', container);
  title.innerText =
    stringValue(
      properties.localized_name || properties.name || properties.standard_label || properties.label || properties.ref,
    ) || 'Railway feature';

  const badges = el('h6', 'orm-popup-badges', container);

  const showProps = [
    ['feature', 'Feature'],
    ['railway', 'Railway'],
    ['state', 'State'],
    ['usage', 'Usage'],
    ['service', 'Service'],
    ['ref', 'Reference'],
    ['speed_label', 'Speed'],
    ['electrification_state', 'Electrification'],
    ['voltage', 'Voltage'],
    ['frequency', 'Frequency'],
    ['gauge_label', 'Gauge'],
    ['operator', 'Operator'],
    ['station', 'Station type'],
    ['position', 'Position'],
  ];

  showProps.forEach(([key, label]) => {
    const val = properties[key];
    if (val === undefined || val === null || val === '' || val === false) return;
    const badge = el('span', 'orm-badge', badges);
    const titleSpan = el('span', 'orm-badge-title', badge);
    titleSpan.innerText = `${label}: `;
    const valSpan = el('span', undefined, badge);
    valSpan.innerText = val === true ? 'yes' : typeof val === 'string' ? val : String(val);
  });

  // OSM link
  if (properties.osm_id) {
    const osmRow = el('h6', 'orm-popup-osm', container);
    const osmType = properties.osm_type === 'N' ? 'node' : properties.osm_type === 'R' ? 'relation' : 'way';
    const group = el('div', 'orm-btn-group', osmRow);
    const idBtn = el('button', 'orm-btn orm-btn-id', group);
    idBtn.type = 'button';
    idBtn.disabled = true;
    const icon = el('img', 'orm-osm-icon', idBtn);
    icon.src = OSM_ICONS[osmType] || OSM_ICONS.node;
    icon.alt = osmType;
    const code = el('code', undefined, idBtn);
    code.innerText = stringValue(properties.osm_id);
    const viewLink = el('a', 'orm-btn orm-btn-action', group);
    viewLink.href = `https://www.openstreetmap.org/${osmType}/${properties.osm_id}`;
    viewLink.target = '_blank';
    viewLink.innerText = 'View';
  }

  return container;
}

function addPopupBadge(container: Element, label: string, value: unknown) {
  if (value === undefined || value === null || value === '' || value === false) return;
  const badge = el('span', 'orm-badge', container);
  const titleSpan = el('span', 'orm-badge-title', badge);
  titleSpan.innerText = `${label}: `;
  const valueSpan = el('span', undefined, badge);
  valueSpan.innerText = value === true ? 'yes' : String(value);
}

function formatOsrmKind(kind: unknown) {
  return String(kind || '')
    .replace(/^osrm_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char: string) => char.toUpperCase());
}

function formatOsrmSpeed(properties: JsonRecord) {
  const speed = Number(properties.speed_kmh ?? properties.speed);
  return Number.isFinite(speed) ? `${speed.toFixed(speed >= 10 ? 0 : 1)} km/h` : '';
}

function osrmPopupTitle(properties: JsonRecord) {
  const kind = String(properties.kind || '');
  if (kind === 'osrm_route') return stringValue(properties.name) || 'OSRM route';
  if (kind === 'osrm_segment') return 'Speed segment';
  if (kind === 'osrm_maneuver')
    return stringValue(properties.title) || formatOsrmKind(properties.maneuver) || 'Maneuver';
  if (kind === 'osrm_step') return stringValue(properties.title || properties.name) || 'Route step';
  return formatOsrmKind(kind) || 'OSRM feature';
}

function osrmPopupContent(feature: RenderedFeatureLike) {
  const properties = feature.properties || {};
  const kind = String(properties.kind || '');
  const container = el('div', 'orm-popup');

  const title = el('h5', 'orm-popup-title', container);
  title.innerText = osrmPopupTitle(properties);

  const label = el('h6', 'orm-popup-label', container);
  const marker = el('span', 'orm-color-marker', label);
  marker.style.backgroundColor = stringValue(properties.color || properties.stroke) || '#0f766e';
  const labelText = el('span', undefined, label);
  labelText.innerText = kind === 'osrm_route' ? 'OSRM route' : formatOsrmKind(kind);

  const badges = el('h6', 'orm-popup-badges', container);
  if (kind === 'osrm_route') {
    addPopupBadge(badges, 'Distance', properties.distance_text);
    addPopupBadge(badges, 'Duration', properties.duration_text);
    addPopupBadge(badges, 'Steps', properties.step_count);
    addPopupBadge(badges, 'Roads', properties.road_names);
    addPopupBadge(
      badges,
      'Avg speed',
      properties.annotation_avg_speed_kmh ? `${properties.annotation_avg_speed_kmh} km/h` : '',
    );
    addPopupBadge(badges, 'OSM nodes', properties.annotation_node_count);
  } else if (kind === 'osrm_segment') {
    addPopupBadge(badges, 'Speed', formatOsrmSpeed(properties));
    addPopupBadge(badges, 'Distance', properties.distance_text);
    addPopupBadge(badges, 'Duration', properties.duration_text);
    addPopupBadge(badges, 'Segment', properties.segment_index);
    if (properties.node_from || properties.node_to) {
      addPopupBadge(badges, 'Nodes', `${properties.node_from || '?'} -> ${properties.node_to || '?'}`);
    }
  } else {
    addPopupBadge(badges, 'Road', properties.road_name || properties.name);
    addPopupBadge(badges, 'Maneuver', [properties.maneuver, properties.modifier].filter(Boolean).join(' '));
    addPopupBadge(badges, 'Distance', properties.distance_text);
    addPopupBadge(badges, 'Duration', properties.duration_text);
    addPopupBadge(badges, 'Step', properties.step_index);
  }

  return container;
}

// ---------------------------------------------------------------------------
// Install ORM-style popups on a MapLibre GL map
// ---------------------------------------------------------------------------
export function installOrmPopups(map: MapLike, maplibregl: MaplibreLike, featuresCatalog: FeaturesCatalog) {
  let popup: PopupBuilderLike | null = null;
  let hoveredFeature: FeatureStateTarget | null = null;

  // Build set of ORM source names for fast lookup
  const ormSources = new Set(
    Object.keys(featuresCatalog)
      .filter((k) => k.includes('-'))
      .map((k) => k.split('-')[0]),
  );
  const isOrmFeature = (f: RenderedFeatureLike) => ormSources.has(f.source);
  const isOsrmFeature = (f: RenderedFeatureLike) =>
    String(f?.source || '').startsWith('geojson-layer-') && String(f?.properties?.kind || '').startsWith('osrm_');
  const isWeatherPickerActive = () => map.getContainer().dataset.weatherPickerActive === 'true';
  const isRoutingPickerActive = () => map.getContainer().dataset.routingPickerActive === 'true';
  const osrmPriority = (feature: RenderedFeatureLike) => {
    switch (feature?.properties?.kind) {
      case 'osrm_maneuver':
        return 0;
      case 'osrm_segment':
        return 1;
      case 'osrm_step':
        return 2;
      case 'osrm_route':
        return 3;
      default:
        return 4;
    }
  };

  function clearHover() {
    if (!hoveredFeature) return;
    map.setFeatureState(hoveredFeature, { hover: false });
    hoveredFeature = null;
  }

  // Hover cursor
  map.on('mousemove', (event: PopupMapEvent) => {
    if (isWeatherPickerActive() || isRoutingPickerActive()) {
      map.getCanvas().style.cursor = 'crosshair';
      clearHover();
      return;
    }

    const renderedFeatures = map.queryRenderedFeatures(event.point);
    const osrmFeatures = renderedFeatures.filter(isOsrmFeature);
    const ormFeatures = renderedFeatures.filter(isOrmFeature);
    if (osrmFeatures.length > 0 || ormFeatures.length > 0) {
      map.getCanvas().style.cursor = 'pointer';

      if (osrmFeatures.length > 0) {
        clearHover();
        return;
      }

      const feature = ormFeatures[0];
      if (hoveredFeature && hoveredFeature.id !== feature.id) {
        map.setFeatureState(hoveredFeature, { hover: false });
        hoveredFeature = null;
      }
      if (feature.id && !(hoveredFeature && hoveredFeature.id === feature.id)) {
        hoveredFeature = {
          source: feature.source,
          sourceLayer: feature.sourceLayer,
          id: feature.id,
        };
        map.setFeatureState(hoveredFeature, { hover: true });
      }
    } else {
      map.getCanvas().style.cursor = '';
      clearHover();
    }
  });

  // Click popup
  map.on('click', (event: PopupMapEvent) => {
    if (
      isWeatherPickerActive() ||
      isRoutingPickerActive() ||
      event.originalEvent?.weatherPickerHandled ||
      event.originalEvent?.routingHandled
    )
      return;

    const renderedFeatures = map.queryRenderedFeatures(event.point);
    const osrmFeatures = renderedFeatures.filter(isOsrmFeature).sort((a, b) => osrmPriority(a) - osrmPriority(b));
    const ormFeatures = renderedFeatures.filter(isOrmFeature);
    if (osrmFeatures.length === 0 && ormFeatures.length === 0) return;

    const feature = osrmFeatures[0] || ormFeatures[0];
    const isOsrmPopup = osrmFeatures.length > 0;

    // Determine popup coordinates
    const coordinates =
      feature.geometry.type === 'Point'
        ? Array.isArray(feature.geometry.coordinates)
          ? feature.geometry.coordinates.slice()
          : event.lngLat
        : feature.geometry.type === 'LineString' && Array.isArray(feature.geometry.coordinates)
          ? closestPointOnLine(maplibregl, event.lngLat, feature.geometry.coordinates)
          : event.lngLat;

    const iconHeight = 20;
    const iconWidth = 10;
    const popupOffsets: Record<string, Coordinates> = {
      top: [0, iconHeight],
      'top-left': [iconWidth, iconHeight],
      'top-right': [-iconWidth, iconHeight],
      bottom: [0, -iconHeight],
      'bottom-left': [iconWidth, -iconHeight],
      'bottom-right': [-iconWidth, -iconHeight],
      left: [iconWidth, 0],
      right: [-iconWidth, 0],
    };

    if (popup) popup.remove();

    const abortController = new AbortController();
    const content = isOsrmPopup ? osrmPopupContent(feature) : popupContent(feature, featuresCatalog, abortController);
    if (!content) return;

    popup = new maplibregl.Popup({ offset: popupOffsets, maxWidth: '340px' })
      .setLngLat(coordinates)
      .setDOMContent(content)
      .addTo(map);

    popup.on('close', () => {
      abortController.abort('Popup closed');
    });
  });
}
