/**
 * route.js — OSRM routing for orm-pmtiles-demo.
 *
 * Provides right-click → set start/end → auto-route with driving / cycling / walking.
 * Routes render as styled GeoJSON lines on the MapLibre map.
 *
 * Usage:
 *   import { installRouting } from './route.js';
 *   installRouting(map, maplibregl, layerRegistry);
 */

import { LayerRegistry } from './layers.js';

// ── Constants ──────────────────────────────────────────────────────────────
const OSRM_BASE = 'https://router.project-osrm.org';

const PROFILES = {
  driving:  { name: 'Driving',  emoji: '🚗', color: '#2563eb' },
  cycling:  { name: 'Cycling',  emoji: '🚴', color: '#16a34a' },
  walking:  { name: 'Walking',  emoji: '🚶', color: '#d97706' },
};

const DEFAULT_PROFILE = 'driving';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatStepInstruction(step) {
  const name = step.name || 'unnamed road';
  const dist = formatDistance(step.distance);
  // OSRM step.maneuver.type → human-readable
  const maneuvers = {
    'turn': 'Turn',
    'new name': 'Continue onto',
    'depart': 'Start',
    'arrive': 'Arrive',
    'roundabout': 'Enter roundabout',
    'merge': 'Merge onto',
    'fork': 'Fork',
    'end of road': 'Turn',
    'continue': 'Continue',
    'off ramp': 'Take exit',
  };
  const action = maneuvers[step.maneuver?.type] || 'Go';
  const modifier = step.maneuver?.modifier || '';
  const dir = modifier ? ` ${modifier}` : '';
  return `${action}${dir} onto ${name} · ${dist}`;
}

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

// ── Route Counter ──────────────────────────────────────────────────────────
let routeIdCounter = 0;

// ── RouteController (MapLibre IControl) ────────────────────────────────────

class RouteController {
  /**
   * @param {maplibregl.Map} map
   * @param {typeof maplibregl} ml
   * @param {LayerRegistry} registry
   */
  constructor(map, ml, registry) {
    this._map = map;
    this._ml = ml;
    this._registry = registry;
    this._profile = DEFAULT_PROFILE;
    this._start = null;       // {lng, lat}
    this._end = null;         // {lng, lat}
    this._routeEntryId = null;
    this._clickHandler = null;

    // DOM refs
    this._container = null;
    this._ctxMenu = null;
    this._modeBar = null;
    this._popup = null;
  }

  // ── IControl interface ────────────────────────────────────────────────

  onAdd() {
    // Context menu (hidden by default)
    this._ctxMenu = el('div', 'route-ctx-menu');
    this._ctxMenu.style.display = 'none';
    this._ctxMenu.addEventListener('contextmenu', (e) => e.preventDefault());

    // Mode bar (hidden by default)
    this._modeBar = el('div', 'route-mode-bar');
    this._modeBar.style.display = 'none';
    this._renderModeBar();

    // Container
    this._container = el('div', 'route-overlay');
    this._container.appendChild(this._ctxMenu);
    this._container.appendChild(this._modeBar);

    // Right-click handler (desktop)
    this._map.getCanvas().addEventListener('contextmenu', this._onContextMenu);

    // Long-press handler (mobile — touch devices don't have right-click)
    let longPressTimer = null;
    const LONG_PRESS_MS = 500;
    this._map.getCanvas().addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        // Use the touch's offset within the canvas
        const rect = this._map.getCanvas().getBoundingClientRect();
        const offsetX = touch.clientX - rect.left;
        const offsetY = touch.clientY - rect.top;
        const ctxEvent = new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true,
          clientX: touch.clientX, clientY: touch.clientY,
          offsetX, offsetY, button: 2,
        });
        this._map.getCanvas().dispatchEvent(ctxEvent);
      }, LONG_PRESS_MS);
    }, { passive: true });
    this._map.getCanvas().addEventListener('touchend', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    });
    this._map.getCanvas().addEventListener('touchmove', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }, { passive: true });

    // Click on map (for closing context menu)
    this._map.on('click', this._onMapClick);

    return this._container;
  }

  onRemove() {
    this._map.getCanvas().removeEventListener('contextmenu', this._onContextMenu);
    this._map.off('click', this._onMapClick);
    this._clearRoute();
    this._container?.parentNode?.removeChild(this._container);
    this._map = undefined;
  }

  getDefaultPosition() {
    return 'top-left';
  }

  // ── Context Menu ──────────────────────────────────────────────────────

  _onContextMenu = (e) => {
    e.preventDefault();
    const lngLat = this._map.unproject([e.offsetX, e.offsetY]);
    const { lng, lat } = lngLat;
    this._showContextMenu(e.clientX, e.clientY, lng, lat);
  };

  _showContextMenu(x, y, lng, lat) {
    // Build menu items dynamically
    this._ctxMenu.innerHTML = '';
    const hasStart = this._start != null;

    if (!hasStart) {
      this._addContextItem(this._ctxMenu, '🟢 Set as start', () => {
        this._setStart(lng, lat);
        this._hideContextMenu();
      });
    } else {
      this._addContextItem(this._ctxMenu, `🔴 Route here (${PROFILES[this._profile].emoji})`, () => {
        this._setEnd(lng, lat);
        this._hideContextMenu();
        this._fetchRoute();
      });
      this._addContextItem(this._ctxMenu, '🟢 Reset start', () => {
        this._setStart(lng, lat);
        this._hideContextMenu();
      });
    }

    // Position
    this._ctxMenu.style.display = 'block';
    this._ctxMenu.style.left = `${x}px`;
    this._ctxMenu.style.top = `${y}px`;

    // Keep menu on screen
    const rect = this._ctxMenu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      this._ctxMenu.style.top = `${y - rect.height}px`;
    }
    if (rect.right > window.innerWidth) {
      this._ctxMenu.style.left = `${x - rect.width}px`;
    }
  }

  _addContextItem(parent, text, onClick) {
    const btn = el('button', 'route-ctx-item', parent);
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    return btn;
  }

  _hideContextMenu() {
    this._ctxMenu.style.display = 'none';
  }

  // ── Mode Bar ──────────────────────────────────────────────────────────

  _renderModeBar() {
    this._modeBar.innerHTML = '';

    // Mode selector
    const modes = el('div', 'route-mode-selector', this._modeBar);
    for (const [key, prof] of Object.entries(PROFILES)) {
      const btn = el('button', 'route-mode-btn', modes);
      btn.textContent = `${prof.emoji} ${prof.name}`;
      if (key === this._profile) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this._profile = key;
        this._renderModeBar();
        // If both start and end are set, re-route with new mode
        if (this._start && this._end) this._fetchRoute();
      });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Status
    const status = el('span', 'route-mode-status', this._modeBar);
    if (this._routeEntryId != null) {
      // Route loaded — show summary
      const route = this._lastRoute;
      if (route) {
        status.textContent = `${PROFILES[this._profile].emoji} ${formatDistance(route.distance)} · ${formatDuration(route.duration)}`;
      }
      const clear = el('button', 'route-mode-clear', this._modeBar);
      clear.textContent = '✕ Clear';
      clear.addEventListener('click', () => this._clearRoute());
      clear.addEventListener('contextmenu', (e) => e.preventDefault());
    } else if (this._start) {
      const name = this._startName || `${this._start.lat.toFixed(4)}, ${this._start.lng.toFixed(4)}`;
      status.textContent = `Start: ${name}`;
      const cancel = el('button', 'route-mode-clear', this._modeBar);
      cancel.textContent = '✕ Cancel';
      cancel.addEventListener('click', () => this._clearRoute());
      cancel.addEventListener('click', (e) => e.preventDefault());
    }
  }

  _showModeBar() {
    this._modeBar.style.display = 'flex';
  }

  _hideModeBar() {
    this._modeBar.style.display = 'none';
  }

  // ── Waypoints ─────────────────────────────────────────────────────────

  _setStart(lng, lat) {
    this._start = { lng, lat };
    this._startName = null;
    this._end = null;
    this._clearRouteLayers();
    this._addStartMarker(lng, lat);
    this._showModeBar();
    this._renderModeBar();
  }

  _setEnd(lng, lat) {
    this._end = { lng, lat };
    this._addEndMarker(lng, lat);
    this._renderModeBar();
  }

  // ── Markers ───────────────────────────────────────────────────────────

  _addStartMarker(lng, lat) {
    this._removeMarkerSource('route-start');
    this._map.addSource('route-start', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] },
          properties: {},
        }],
      },
    });
    this._map.addLayer({
      id: 'route-start-marker',
      type: 'circle',
      source: 'route-start',
      paint: {
        'circle-radius': 7,
        'circle-color': '#16a34a',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    });
  }

  _addEndMarker(lng, lat) {
    this._removeMarkerSource('route-end');
    this._map.addSource('route-end', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] },
          properties: {},
        }],
      },
    });
    this._map.addLayer({
      id: 'route-end-marker',
      type: 'circle',
      source: 'route-end',
      paint: {
        'circle-radius': 7,
        'circle-color': '#dc2626',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    });
  }

  _removeMarkerSource(sourceId) {
    // Remove layers tied to this source first
    const style = this._map.getStyle();
    if (style?.layers) {
      for (const layer of style.layers) {
        if (layer.source === sourceId) {
          if (this._map.getLayer(layer.id)) this._map.removeLayer(layer.id);
        }
      }
    }
    if (this._map.getSource(sourceId)) this._map.removeSource(sourceId);
  }

  // ── OSRM API ──────────────────────────────────────────────────────────

  async _fetchRoute() {
    if (!this._start || !this._end) return;

    const coords = `${this._start.lng},${this._start.lat};${this._end.lng},${this._end.lat}`;
    const url = `${OSRM_BASE}/route/v1/${this._profile}/${coords}?geometries=geojson&overview=full&steps=true&alternatives=true&annotations=true`;

    this._modeBar.classList.add('loading');

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`OSRM ${res.status}`);
      const data = await res.json();
      if (data.code !== 'Ok') throw new Error(`OSRM: ${data.code}`);
      this._renderRoutes(data);
    } catch (err) {
      console.error('Route fetch failed:', err);
      // Show error in status
      this._renderModeBar();
    } finally {
      this._modeBar.classList.remove('loading');
    }
  }

  // ── Route Rendering ───────────────────────────────────────────────────

  _renderRoutes(osrmData) {
    this._clearRouteLayers();

    const profile = PROFILES[this._profile];
    const routes = osrmData.routes || [];
    if (routes.length === 0) return;

    const main = routes[0];
    this._lastRoute = main;
    const id = `route-${++routeIdCounter}`;
    this._routeEntryId = id;

    // Build GeoJSON FeatureCollection with all routes
    const features = routes.map((route, i) => ({
      type: 'Feature',
      properties: {
        isAlternative: i > 0,
        distance: route.distance,
        duration: route.duration,
        steps: JSON.stringify(route.legs?.[0]?.steps || []),
      },
      geometry: route.geometry,
    }));

    this._map.addSource(id, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    // Main route: outline + colored line
    this._map.addLayer({
      id: `${id}-stroke`,
      type: 'line',
      source: id,
      filter: ['!=', ['get', 'isAlternative'], true],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#000000',
        'line-width': 8,
        'line-opacity': 0.35,
      },
    });
    this._map.addLayer({
      id: `${id}-line`,
      type: 'line',
      source: id,
      filter: ['!=', ['get', 'isAlternative'], true],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': profile.color,
        'line-width': 5,
        'line-opacity': 0.9,
      },
    });

    // Alternative routes: thinner, more transparent
    this._map.addLayer({
      id: `${id}-alt-stroke`,
      type: 'line',
      source: id,
      filter: ['==', ['get', 'isAlternative'], true],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#000000',
        'line-width': 5,
        'line-opacity': 0.2,
      },
    });
    this._map.addLayer({
      id: `${id}-alt-line`,
      type: 'line',
      source: id,
      filter: ['==', ['get', 'isAlternative'], true],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': profile.color,
        'line-width': 3,
        'line-opacity': 0.45,
        'line-dasharray': [2, 3],
      },
    });

    // Click handler on route lines → popup
    this._clickHandler = (e) => {
      if (!e.features?.[0]) return;

      // Click should only trigger on our route layers
      const layerId = e.features[0].layer?.id;
      if (!layerId?.startsWith('route-')) return;

      const props = e.features[0].properties;
      if (!props) return;

      this._showRoutePopup(e.lngLat, props);
    };
    this._map.on('click', `${id}-line`, this._clickHandler);
    this._map.on('click', `${id}-alt-line`, this._clickHandler);

    // Change cursor on hover
    this._map.on('mouseenter', `${id}-line`, () => {
      this._map.getCanvas().style.cursor = 'pointer';
    });
    this._map.on('mouseleave', `${id}-line`, () => {
      this._map.getCanvas().style.cursor = '';
    });

    // Register with layer registry
    const layerIds = [
      `${id}-stroke`, `${id}-line`,
      `${id}-alt-stroke`, `${id}-alt-line`,
    ];
    this._registry.register(id, {
      name: `Route ${routeIdCounter} (${PROFILES[this._profile].emoji})`,
      type: 'route',
      sourceIds: [id],
      layerIds,
    });

    // Fit map to route bounds
    this._fitRouteBounds(routes);

    this._renderModeBar();
    // Refresh layer panel to show new route in the list
    this._map._layerPanel?.refresh();
  }

  _fitRouteBounds(routes) {
    if (!routes.length) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const route of routes) {
      const coords = route.geometry?.coordinates;
      if (!coords) continue;
      for (const [lng, lat] of coords) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
    if (isFinite(minLng)) {
      this._map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 80, maxZoom: 15 });
    }
  }

  // ── Route Popup ───────────────────────────────────────────────────────

  _showRoutePopup(lngLat, props) {
    this._popup?.remove();
    const content = this._buildPopupContent(props);
    this._popup = new this._ml.Popup({ offset: 16, maxWidth: '340px' })
      .setLngLat(lngLat)
      .setDOMContent(content)
      .addTo(this._map);
  }

  _buildPopupContent(props) {
    const container = el('div', 'route-popup');
    const header = el('div', 'route-popup-header', container);

    const mode = el('span', 'route-popup-mode', header);
    mode.textContent = `${PROFILES[this._profile].emoji} ${PROFILES[this._profile].name}`;

    const summary = el('span', 'route-popup-summary', header);
    summary.textContent = `${formatDistance(props.distance)} · ${formatDuration(props.duration)}`;

    // Steps list
    let steps = [];
    try { steps = JSON.parse(props.steps || '[]'); } catch { /* ignore */ }
    if (steps.length > 0) {
      const stepsList = el('ol', 'route-popup-steps', container);
      for (const step of steps) {
        const li = el('li', 'route-popup-step', stepsList);
        li.textContent = formatStepInstruction(step);
      }
    }

    return container;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  _clearRouteLayers() {
    if (this._routeEntryId != null) {
      // Unbind click handler
      if (this._clickHandler) {
        this._map.off('click', `${this._routeEntryId}-line`, this._clickHandler);
        this._map.off('click', `${this._routeEntryId}-alt-line`, this._clickHandler);
        this._clickHandler = null;
      }
      this._registry.remove(this._routeEntryId);
      this._routeEntryId = null;
    }
    this._lastRoute = null;
    this._popup?.remove();
    this._popup = null;
    this._map.getCanvas().style.cursor = '';
  }

  _clearRoute() {
    this._clearRouteLayers();
    this._removeMarkerSource('route-start');
    this._removeMarkerSource('route-end');
    this._start = null;
    this._startName = null;
    this._end = null;
    this._hideModeBar();
    this._hideContextMenu();
    this._renderModeBar();
    this._map._layerPanel?.refresh();
  }

  // ── Map click handler (close context menu) ────────────────────────────

  _onMapClick = () => {
    this._hideContextMenu();
  };
}

// ── Install ────────────────────────────────────────────────────────────────

/**
 * @param {maplibregl.Map} map
 * @param {typeof maplibregl} maplibregl
 * @param {LayerRegistry} registry
 */
export function installRouting(map, maplibregl, registry) {
  const ctrl = new RouteController(map, maplibregl, registry);
  map.addControl(ctrl, 'top-left');
}
