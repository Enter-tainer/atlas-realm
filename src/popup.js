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
  relation: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiIHhtbG5zOmNjPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyMiIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgdmVyc2lvbj0iMS4wIiBoZWlnaHQ9IjI1NiIgd2lkdGg9IjI1NiI+PHRpdGxlPk9wZW5TdHJlZXRNYXAgcmVsYXRpb24gZWxlbWVudCBpY29uPC90aXRsZT48bWV0YWRhdGE+PHJkZjpSREY+PGNjOldvcmsgcmRmOmFib3V0PSIiPjxkYzpmb3JtYXQ+aW1hZ2Uvc3ZnK3htbDwvZGM6Zm9ybWF0PjxkYzp0eXBlIHJkZjpyZXNvdXJjZT0iaHR0cDovL3B1cmwub3JnL2RjL2RjbWl0eXBlL1N0aWxsSW1hZ2UiLz48ZGM6dGl0bGU+T3BlblN0cmVldE1hcCByZWxhdGlvbiBlbGVtZW50IGljb248L2RjOnRpdGxlPjxjYzpsaWNlbnNlIHJkZjpyZXNvdXJjZT0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbGljZW5zZXMvYnkvMy4wLyIvPjxkYzpkYXRlPjIwMTQtMDMtMTA8L2RjOmRhdGU+PGRjOmNyZWF0b3I+PGNjOkFnZW50PjxkYzp0aXRsZT5odHRwczovL3dpa2kub3BlbnN0cmVldG1hcC5vcmcvd2lraS9Vc2VyOk1vcmVzYnk8L2RjOnRpdGxlPjwvY2M6QWdlbnQ+PC9kYzpjcmVhdG9yPjwvY2M6V29yaz48Y2M6TGljZW5zZSByZGY6YWJvdXQ9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL2xpY2Vuc2VzL2J5LzMuMC8iPjxjYzpwZXJtaXRzIHJkZjpyZXNvdXJjZT0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjUmVwcm9kdWN0aW9uIi8+PGNjOnBlcm1pdHMgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNEaXN0cmlidXRpb24iLz48Y2M6cmVxdWlyZXMgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNOb3RpY2UiLz48Y2M6cmVxdWlyZXMgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNBdHRyaWJ1dGlvbiIvPjxjYzpwZXJtaXRzIHJkZjpyZXNvdXJjZT0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjRGVyaXZhdGl2ZVdvcmtzIi8+PGNjOnJlcXVpcmVzIHJkZjpyZXNvdXJjZT0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjU2hhcmVBbGlrZSIvPjwvY2M6TGljZW5zZT48L3JkZjpSREY+PC9tZXRhZGF0YT48Zz48cmVjdCB3aWR0aD0iMjQyIiBoZWlnaHQ9IjI0MiIgc3Ryb2tlPSJub25lIiBmaWxsPSJ3aGl0ZSIgcnk9IjMyIiB4PSI3IiB5PSI3Ii8+PGc+PHBhdGggZD0iTSAwNjggMDY4IEwgMTk2IDA2MiIgc3Ryb2tlLXdpZHRoPSIxNiIgc3Ryb2tlPSIjY2NjIi8+PHBhdGggZD0iTSAwNjggMDY4IEwgMTk2IDE0MiIgc3Ryb2tlLXdpZHRoPSIxNiIgc3Ryb2tlPSIjY2NjIi8+PHBhdGggZD0iTSAwNjggMDY4IEwgMDYyIDE5NiIgc3Ryb2tlLXdpZHRoPSIxNiIgc3Ryb2tlPSIjY2NjIi8+PGNpcmNsZSBjeD0iMTk2IiBjeT0iMDYyIiByPSIwMjQiIGZpbGw9ImJsYWNrIi8+PGNpcmNsZSBjeD0iMTk2IiBjeT0iMTQyIiByPSIwMjQiIGZpbGw9ImJsYWNrIi8+PGNpcmNsZSBjeD0iMDYyIiBjeT0iMTk2IiByPSIwMjQiIGZpbGw9ImJsYWNrIi8+PC9nPjxnPjxwYXRoIGQ9Ik0gMDY4IDA2OCBMIDE0MiAxOTYiIHN0cm9rZS13aWR0aD0iMTYiIHN0cm9rZT0iI2NjYyIvPjxjaXJjbGUgY3g9IjE0MiIgY3k9IjE5NiIgcj0iMDI0IiBmaWxsPSJibGFjayIvPjxjaXJjbGUgY3g9IjA3MiIgY3k9IjA3MiIgcj0iMDMyIiBmaWxsPSIjYmVlNmJlIiBzdHJva2U9ImJsYWNrIiBzdHJva2Utd2lkdGg9IjgiLz48L2c+PHJlY3Qgd2lkdGg9IjI0MiIgaGVpZ2h0PSIyNDIiIHN0cm9rZT0iYmxhY2siIGZpbGw9Im5vbmUiIHN0cm9rZS13aWR0aD0iMTIiIHJ5PSIzMiIgeD0iNyIgeT0iNyIvPjwvZz48L3N2Zz4K',
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

// ---------------------------------------------------------------------------
// Country flag emoji helper
// ---------------------------------------------------------------------------
function getFlagEmoji(countryCode) {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt());
  return String.fromCodePoint(...codePoints);
}

// ---------------------------------------------------------------------------
// Natural sort comparator
// ---------------------------------------------------------------------------
function naturalSort(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// DOM helper — mirrors ORM's createDomElement()
// ---------------------------------------------------------------------------
function el(tagName, className, container) {
  const e = document.createElement(tagName);
  if (className !== undefined) e.className = className;
  if (container) container.appendChild(e);
  return e;
}

// ---------------------------------------------------------------------------
// Construct catalog key from a property value
// Removes variable parts in {} braces and icon position after @
// ---------------------------------------------------------------------------
function constructCatalogKey(propertyValue) {
  const catalogKey =
    propertyValue && typeof propertyValue === 'string'
      ? propertyValue.replace(/\{[^}]+}/, '{}').replace(/@([^|]+|$)/g, '')
      : propertyValue;
  const keyVariable =
    propertyValue && typeof propertyValue === 'string'
      ? propertyValue.match(/\{([^}]+)}/)?.[1]
      : null;
  return { catalogKey, keyVariable };
}

// ---------------------------------------------------------------------------
// Determine default OSM element type from properties / feature content
// ---------------------------------------------------------------------------
function determineDefaultOsmType(properties, featureContent) {
  if (properties.osm_type) {
    return properties.osm_type === 'N'
      ? 'node'
      : properties.osm_type === 'R'
        ? 'relation'
        : 'way';
  }
  const featureType = (featureContent && featureContent.type) || 'point';
  return featureType === 'point'
    ? 'node'
    : featureType === 'relation'
      ? 'relation'
      : 'way';
}

// ---------------------------------------------------------------------------
// Parse osm_id / osm_type into an array of {id, type} objects
// Multiple IDs are separated by \u001e (record separator)
// ---------------------------------------------------------------------------
function determineOsmFeatures(properties, featureContent) {
  const osmIds = properties.osm_id
    ? String(properties.osm_id).split('\u001e')
    : [];
  const defaultOsmType = determineDefaultOsmType(properties, featureContent);
  const osmTypes = properties.osm_type
    ? String(properties.osm_type).split('\u001e')
    : [];

  return osmIds.map((osm_id, index) => {
    const osmType =
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
function formatPropertyValue(value, format, features) {
  if (format && format.map) {
    let sortKey = (v) => v;
    if (
      format.map.key.format &&
      format.map.key.format.lookup &&
      features &&
      features[format.map.key.format.lookup]
    ) {
      const catalog = features[format.map.key.format.lookup].features ?? {};
      sortKey = (v) => (catalog[v] ?? {}).index ?? Number.MAX_SAFE_INTEGER;
    }

    return String(value)
      .split('\u001d')
      .map((item) => item.split('\u001e'))
      .toSorted(([keyA], [keyB]) => naturalSort(sortKey(keyA), sortKey(keyB)))
      .map(([key, val]) => [
        formatPropertyValue(key, format.map.key.format, features),
        formatPropertyValue(val, format.map.value.format, features),
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
          .replace(
            /%(\.(\d+))?d/,
            (_1, _2, decimals) =>
              Number(value).toFixed(Number(decimals)),
          );
      } else if (format.lookup) {
        const lookupCatalog = features && features[format.lookup];
        if (!lookupCatalog) {
          return stringValue;
        }
        const { catalogKey: lookUpCatalogKey, keyVariable: lookUpKeyVariable } =
          constructCatalogKey(value);
        const lookedUpValue = lookupCatalog.features[lookUpCatalogKey];
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
function closestPointOnLine(maplibregl, point, line) {
  const lngLatPoint = maplibregl.LngLat.convert(point);
  let { closest0, closest1 } = line
    .map(maplibregl.LngLat.convert)
    .reduce(
      (acc, cur) => {
        const d = lngLatPoint.distanceTo(cur);
        if (acc.closest0 == null || d < lngLatPoint.distanceTo(acc.closest0)) {
          return { closest0: cur, closest1: acc.closest0 };
        } else if (
          acc.closest1 == null ||
          d < lngLatPoint.distanceTo(acc.closest1)
        ) {
          return { closest0: acc.closest0, closest1: cur };
        }
        return acc;
      },
      { closest0: null, closest1: null },
    );

  if (closest0 == null && closest1 == null) return null;

  closest0 = closest0.toArray();
  if (closest1 == null) return closest0;
  closest1 = closest1.toArray();
  const pt = lngLatPoint.toArray();

  const abx = closest1[0] - closest0[0];
  const aby = closest1[1] - closest0[1];
  const acx = pt[0] - closest0[0];
  const acy = pt[1] - closest0[1];
  const coeff = (abx * acx + aby * acy) / (abx * abx + aby * aby);
  return [closest0[0] + abx * coeff, closest0[1] + aby * coeff];
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

function renderImageData(linkEl, data, abortController) {
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
      const licEl = el(data.license_url ? 'a' : 'span', 'orm-hide-collapsed', attr);
      if (data.license_url) {
        licEl.href = data.license_url;
        licEl.target = '_blank';
      }
      licEl.innerText = data.license;
    }
    if (data.attribution) {
      const attrEl = el('span', 'orm-hide-collapsed', attr);
      attrEl.innerText = data.attribution;
    }
  }
}

function fetchCommonsImageData(fileName, signal) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query' +
    `&titles=File:${encodeURIComponent(fileName)}` +
    '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=330&format=json&origin=*';
  return fetch(url, { signal })
    .then((r) => r.json())
    .then((json) => {
      const pages = json.query && json.query.pages;
      if (!pages) return null;
      const page = Object.values(pages)[0];
      if (!page || !page.imageinfo || !page.imageinfo[0]) return null;
      const info = page.imageinfo[0];
      const meta = info.extmetadata || {};
      const artist = meta.Artist ? meta.Artist.value.replace(/<[^>]*>/g, '') : '';
      const license = meta.LicenseShortName ? meta.LicenseShortName.value : '';
      const licenseUrl = meta.LicenseUrl ? meta.LicenseUrl.value : '';
      const description = meta.ImageDescription
        ? meta.ImageDescription.value.replace(/<[^>]*>/g, '').slice(0, 200)
        : '';
      return {
        file_name: fileName,
        thumbnail_url: info.thumburl || info.url,
        view_url: info.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}`,
        description,
        attribution: artist,
        license,
        license_url: licenseUrl,
      };
    });
}

function fetchWikidataImage(linkEl, wikidataId, abortController) {
  const url =
    'https://www.wikidata.org/w/api.php?action=wbgetclaims' +
    `&entity=${encodeURIComponent(wikidataId)}` +
    '&property=P18&format=json&origin=*';
  fetch(url, { signal: abortController.signal })
    .then((r) => r.json())
    .then((json) => {
      const claims = json.claims && json.claims.P18;
      if (!claims || !claims[0]) return;
      const fileName = claims[0].mainsnak.datavalue.value;
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

function fetchCommonsImage(linkEl, commonsFile, abortController) {
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

function popupContent(feature, featuresCatalog, abortController) {
  const properties = feature.properties;
  const layerSource = `${feature.source}${feature.sourceLayer ? `-${feature.sourceLayer}` : ''}`;

  const featureCatalog = featuresCatalog[layerSource];
  if (!featureCatalog) {
    // Fallback: render a simple property dump
    return fallbackPopupContent(properties, layerSource);
  }

  const featureProperty = featureCatalog.featureProperty || 'feature';
  const colorProperty = featureCatalog.colorProperty || 'color';
  const featureLinks = featureCatalog.featureLinks || FEATURE_LINKS;

  const { catalogKey, keyVariable } = constructCatalogKey(
    properties[featureProperty],
  );
  const featureContent =
    featureCatalog.features && featureCatalog.features[catalogKey];

  // Unique labels
  const labels = [
    ...new Set(
      (featureCatalog.labelProperties || [])
        .map((lp) => properties[lp])
        .filter(Boolean),
    ),
  ];
  const featureDescription = featureContent
    ? `${featureContent.name}${keyVariable ? ` (${keyVariable})` : ''}${featureContent.country ? ` ${getFlagEmoji(featureContent.country)}` : ''}`
    : properties[featureProperty] || 'Unknown feature';
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
    .map(([property, { name, format, link, paragraph, list, description: tooltip }]) => {
      const value =
        properties[property] === true
          ? ''
          : formatPropertyValue(properties[property], format, featuresCatalog);

      const body = Array.isArray(value) ? value : [[null, value]];

      return { title: name, value: properties[property], body, paragraph, list, link, tooltip };
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
      span.title = properties.railway || '';
      span.innerText = properties.icon;
    } else {
      if (color) {
        const marker = el('span', 'orm-color-marker', popupLabel);
        marker.style.backgroundColor = color;
      }
      if (labels.length > 0) {
        const labelSpan = el('span', undefined, popupLabel);
        labelSpan.innerText = labels.join(' \u2022 ');
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
      viewLink.href = featureLinks.view
        .replace('{osm_type}', type)
        .replace('{osm_id}', id);
      viewLink.target = '_blank';
      viewLink.innerText = 'View';

      const editLink = el('a', 'orm-btn orm-btn-action', group);
      editLink.title = 'Edit on OpenStreetMap';
      editLink.href = featureLinks.edit
        .replace('{osm_type}', type)
        .replace('{osm_id}', id);
      editLink.target = '_blank';
      editLink.innerText = 'Edit';
    });
  }

  // Wikidata / Wikimedia Commons / direct image
  if (
    properties.wikidata ||
    properties.wikimedia_commons_file ||
    properties.image
  ) {
    const imgContainer = el('p', 'orm-popup-images', popupContainer);

    if (properties.wikidata) {
      const link = el('a', 'orm-popup-image-link', imgContainer);
      link.target = '_blank';
      fetchWikidataImage(link, properties.wikidata, abortController);
    }
    if (properties.wikimedia_commons_file) {
      const link = el('a', 'orm-popup-image-link', imgContainer);
      link.target = '_blank';
      fetchCommonsImage(link, properties.wikimedia_commons_file, abortController);
    }
    if (properties.image) {
      const link = el('a', undefined, imgContainer);
      link.href = properties.image;
      link.target = '_blank';
      link.title = `Image: ${properties.image}`;
      const img = el('img', 'orm-popup-image', link);
      img.src = properties.image;
      img.alt = `Image: ${properties.image}`;
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
      const groups = value
        .split('\u001d')
        .map((group) => {
          const split = group.split('\u001e');
          return Object.fromEntries(
            list.properties.map((property, index) => [
              property,
              split[index] || null,
            ]),
          );
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
function fallbackPopupContent(properties, layerSource) {
  const container = el('div', 'orm-popup');

  const title = el('h5', 'orm-popup-title', container);
  title.innerText =
    properties.localized_name ||
    properties.name ||
    properties.standard_label ||
    properties.label ||
    properties.ref ||
    'Railway feature';

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
    valSpan.innerText =
      val === true ? 'yes' : typeof val === 'string' ? val : String(val);
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
    code.innerText = properties.osm_id;
    const viewLink = el('a', 'orm-btn orm-btn-action', group);
    viewLink.href = `https://www.openstreetmap.org/${osmType}/${properties.osm_id}`;
    viewLink.target = '_blank';
    viewLink.innerText = 'View';
  }

  return container;
}

// ---------------------------------------------------------------------------
// Install ORM-style popups on a MapLibre GL map
// ---------------------------------------------------------------------------
export function installOrmPopups(map, maplibregl, featuresCatalog) {
  let popup = null;
  let hoveredFeature = null;

  // Build set of ORM source names for fast lookup
  const ormSources = new Set(
    Object.keys(featuresCatalog)
      .filter((k) => k.includes('-'))
      .map((k) => k.split('-')[0]),
  );
  const isOrmFeature = (f) => ormSources.has(f.source);

  // Hover cursor
  map.on('mousemove', (event) => {
    const features = map
      .queryRenderedFeatures(event.point)
      .filter(isOrmFeature);
    if (features.length > 0) {
      map.getCanvas().style.cursor = 'pointer';

      const feature = features[0];
      if (hoveredFeature && hoveredFeature.id !== feature.id) {
        map.setFeatureState(hoveredFeature, { hover: false });
        hoveredFeature = null;
      }
      if (
        feature.id &&
        !(hoveredFeature && hoveredFeature.id === feature.id)
      ) {
        hoveredFeature = {
          source: feature.source,
          sourceLayer: feature.sourceLayer,
          id: feature.id,
        };
        map.setFeatureState(hoveredFeature, { hover: true });
      }
    } else {
      map.getCanvas().style.cursor = '';
      if (hoveredFeature) {
        map.setFeatureState(hoveredFeature, { hover: false });
        hoveredFeature = null;
      }
    }
  });

  // Click popup
  map.on('click', (event) => {
    const features = map
      .queryRenderedFeatures(event.point)
      .filter(isOrmFeature);
    if (features.length === 0) return;

    const feature = features[0];

    // Determine popup coordinates
    const coordinates =
      feature.geometry.type === 'Point'
        ? feature.geometry.coordinates.slice()
        : feature.geometry.type === 'LineString'
          ? closestPointOnLine(
              maplibregl,
              event.lngLat,
              feature.geometry.coordinates,
            )
          : event.lngLat;

    const iconHeight = 20;
    const iconWidth = 10;
    const popupOffsets = {
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
    const content = popupContent(feature, featuresCatalog, abortController);
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
