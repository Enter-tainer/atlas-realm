const WEATHER_DASHBOARD_URL = import.meta.env.VITE_WEATHER_DASHBOARD_URL || 'https://weather.mgt.moe/';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const PICKER_ACTIVE_DATASET_KEY = 'weatherPickerActive';
const WEATHER_ROUTE_DAYS = 7;
const WEATHER_COMPACT = true;

function el(tagName, className, parent) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function formatDateLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCoord(value) {
  return value.toFixed(5);
}

function formatDisplayCoord(lngLat) {
  return `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`;
}

function formatNominatimAddress(data = {}) {
  const address = data.address || {};
  const street = [address.road, address.house_number].filter(Boolean).join(' ');
  const locality = address.city || address.town || address.village || address.county || address.state;
  const parts = [
    data.name,
    street,
    address.neighbourhood || address.suburb || address.city_district || address.district,
    locality,
    address.country,
  ].filter((part, index, arr) => part && arr.indexOf(part) === index);
  return parts.join(', ') || data.display_name || '';
}

function sanitizeDisplayName(displayName) {
  return displayName.replace(/[~:;]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function reverseGeocode(lngLat, signal) {
  const url = new URL(NOMINATIM_REVERSE_URL);
  url.searchParams.set('lat', lngLat.lat.toFixed(6));
  url.searchParams.set('lon', lngLat.lng.toFixed(6));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '16');
  url.searchParams.set('accept-language', navigator.language || 'zh-CN');

  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Nominatim reverse geocoding failed: ${response.status}`);

  const data = await response.json();
  return formatNominatimAddress(data) || formatDisplayCoord(lngLat);
}

function buildWeatherUrl(lngLat, displayName = formatDisplayCoord(lngLat)) {
  const url = new URL(WEATHER_DASHBOARD_URL, window.location.href);
  const safeDisplayName = sanitizeDisplayName(displayName) || formatDisplayCoord(lngLat);
  const routeEntries = [];
  const today = new Date();

  for (let i = 0; i < WEATHER_ROUTE_DAYS; i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    routeEntries.push(`${formatCoord(lngLat.lat)},${formatCoord(lngLat.lng)}~${safeDisplayName}:${formatDateLocal(date)}`);
  }

  url.searchParams.set('route', routeEntries.join(';'));
  if (WEATHER_COMPACT) url.searchParams.set('compact', '1');
  else url.searchParams.delete('compact');
  return url.toString();
}

function stopMapControlPropagation(node) {
  node.addEventListener('contextmenu', (event) => event.stopPropagation());
  node.addEventListener('dblclick', (event) => event.stopPropagation());
  node.addEventListener('mousedown', (event) => event.stopPropagation());
  node.addEventListener('touchstart', (event) => event.stopPropagation(), { passive: true });
  node.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
}

class WeatherPointPicker {
  constructor(maplibregl) {
    this._maplibregl = maplibregl;
    this._active = false;
    this._marker = null;
    this._selectedLngLat = null;
    this._abortController = null;
    this._isResolving = false;
    this._weatherUrl = '';
    this._boundClick = (event) => this._handleMapClick(event);
    this._boundEscape = (event) => this._handleKeydown(event);
  }

  onAdd(map) {
    this._map = map;
    this._map.on('click', this._boundClick);
    window.addEventListener('keydown', this._boundEscape);

    this._control = el('div', 'maplibregl-ctrl maplibregl-ctrl-group');
    this._button = el('button', 'maplibregl-ctrl-weather', this._control);
    this._button.type = 'button';
    this._button.title = 'Pick a point for weather';
    this._button.setAttribute('aria-label', 'Pick a point for weather');
    this._button.textContent = 'Wx';
    this._button.addEventListener('click', () => this.setActive(!this._active));

    this._panel = el('section', 'weather-panel', map.getContainer());
    this._panel.setAttribute('aria-label', 'Weather forecast');
    this._panel.dataset.weatherCompact = WEATHER_COMPACT ? 'true' : 'false';
    stopMapControlPropagation(this._panel);

    const header = el('div', 'weather-panel-header', this._panel);
    const titleWrap = el('div', 'weather-panel-title-wrap', header);
    this._title = el('div', 'weather-panel-title', titleWrap);
    this._title.textContent = 'Weather';
    this._meta = el('div', 'weather-panel-meta', titleWrap);
    this._meta.textContent = 'No point selected';

    this._openLink = el('a', 'weather-panel-open', header);
    this._openLink.target = '_blank';
    this._openLink.rel = 'noopener noreferrer';
    this._openLink.textContent = 'Open';

    this._closeButton = el('button', 'weather-panel-close', header);
    this._closeButton.type = 'button';
    this._closeButton.title = 'Close weather';
    this._closeButton.setAttribute('aria-label', 'Close weather');
    this._closeButton.textContent = 'x';
    this._closeButton.addEventListener('click', () => this.setActive(false));

    const body = el('div', 'weather-panel-body', this._panel);
    this._empty = el('div', 'weather-panel-empty', body);
    this._empty.textContent = 'Select a point on the map';
    this._status = el('div', 'weather-panel-status', body);
    this._status.textContent = 'Resolving address...';
    this._iframe = el('iframe', 'weather-panel-frame', body);
    this._iframe.title = 'Weather forecast';
    this._iframe.loading = 'lazy';
    this._iframe.referrerPolicy = 'no-referrer-when-downgrade';

    this._sync();
    return this._control;
  }

  onRemove() {
    this._map.off('click', this._boundClick);
    window.removeEventListener('keydown', this._boundEscape);
    this._abortController?.abort();
    this._marker?.remove();
    this._panel?.remove();
    this._control?.remove();
    this._map.getContainer().dataset[PICKER_ACTIVE_DATASET_KEY] = 'false';
    this._map = undefined;
  }

  setActive(active) {
    const next = Boolean(active);
    if (this._active === next) return;
    this._active = next;
    if (!next) {
      this._selectedLngLat = null;
      this._abortController?.abort();
      this._abortController = null;
      this._isResolving = false;
      this._weatherUrl = '';
      this._marker?.remove();
      this._marker = null;
      this._iframe.removeAttribute('src');
    }
    this._sync();
  }

  _handleKeydown(event) {
    if (event.key === 'Escape' && this._active) {
      this.setActive(false);
    }
  }

  _handleMapClick(event) {
    if (!this._active) return;
    if (event.originalEvent) event.originalEvent.weatherPickerHandled = true;
    this._selectPoint(event.lngLat);
  }

  _selectPoint(lngLat) {
    this._selectedLngLat = { lng: lngLat.lng, lat: lngLat.lat };
    this._abortController?.abort();
    this._abortController = new AbortController();
    this._isResolving = true;
    this._weatherUrl = '';

    const fallbackName = formatDisplayCoord(this._selectedLngLat);
    this._openLink.removeAttribute('href');
    this._iframe.removeAttribute('src');
    this._status.textContent = 'Resolving address...';

    if (!this._marker) {
      this._marker = new this._maplibregl.Marker({ color: '#0ea5e9' });
    }
    this._marker.setLngLat([lngLat.lng, lngLat.lat]).addTo(this._map);
    this._sync();
    this._meta.textContent = `Resolving ${fallbackName}`;

    reverseGeocode(this._selectedLngLat, this._abortController.signal)
      .then((displayName) => {
        if (!this._selectedLngLat) return;
        this._isResolving = false;
        const nextUrl = buildWeatherUrl(this._selectedLngLat, displayName);
        this._weatherUrl = nextUrl;
        this._openLink.href = nextUrl;
        this._iframe.src = nextUrl;
        this._sync();
        this._meta.textContent = displayName;
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        console.warn(error);
        this._isResolving = false;
        this._weatherUrl = '';
        this._openLink.removeAttribute('href');
        this._iframe.removeAttribute('src');
        this._status.textContent = 'Address lookup failed';
        this._sync();
        this._meta.textContent = `Address lookup failed for ${fallbackName}`;
      });
  }

  _sync() {
    const hasSelection = Boolean(this._selectedLngLat);
    const showForecast = hasSelection && !this._isResolving && Boolean(this._weatherUrl);
    this._map.getContainer().dataset[PICKER_ACTIVE_DATASET_KEY] = this._active ? 'true' : 'false';
    if (!this._active) this._map.getCanvas().style.cursor = '';
    this._button.classList.toggle('maplibregl-ctrl-weather-enabled', this._active);
    this._button.setAttribute('aria-pressed', this._active ? 'true' : 'false');
    this._panel.classList.toggle('weather-panel-visible', this._active && hasSelection);
    this._empty.hidden = hasSelection;
    this._status.hidden = !hasSelection || showForecast;
    this._iframe.hidden = !showForecast;
    this._openLink.toggleAttribute('hidden', !showForecast);

    if (!hasSelection) {
      this._meta.textContent = 'No point selected';
    }
  }
}

export function installWeatherPointPicker(map, maplibregl) {
  map.addControl(new WeatherPointPicker(maplibregl), 'top-right');
}
