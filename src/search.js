/**
 * Photon POI search control for MapLibre.
 * Uses https://photon.komoot.io API (OSM-based geocoder).
 */

const PHOTON_API = 'https://photon.komoot.io/api/';

export function installPhotonSearch(map) {
  const search = new PhotonSearch(map);
  map.getContainer().appendChild(search.container);
  return search;
}

class PhotonSearch {
  constructor(map) {
    this._map = map;
    this._marker = null;
    this._abortController = null;

    this.container = document.createElement('div');
    this.container.className = 'photon-search';

    this.container.innerHTML = `
      <div class="photon-search-bar">
        <span class="photon-search-icon">🔍</span>
        <input type="text" class="photon-search-input" placeholder="搜索地点…" />
      </div>
      <div class="photon-results"></div>
    `;

    this._input = this.container.querySelector('.photon-search-input');
    this._resultsEl = this.container.querySelector('.photon-results');

    this._input.addEventListener('input', () => this._onInput());
    this._input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._closeResults();
      if (e.key === 'Enter') this._selectHighlighted();
      if (e.key === 'ArrowDown') this._highlightNext();
      if (e.key === 'ArrowUp') this._highlightPrev();
    });
    this._input.addEventListener('blur', () => {
      // Delay to allow click on result item to register
      setTimeout(() => this._closeResults(), 200);
    });
  }

  _onInput() {
    const q = this._input.value.trim();
    this._closeResults();
    if (this._abortController) {
      this._abortController.abort();
    }
    if (q.length < 2) return;
    this._debouncedSearch(q);
  }

  _debouncedSearch = (() => {
    let timer = null;
    return (q) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this._search(q), 300);
    };
  })();

  async _search(q) {
    this._abortController = new AbortController();
    const url = `${PHOTON_API}?q=${encodeURIComponent(q)}&limit=8`;
    try {
      const res = await fetch(url, { signal: this._abortController.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._showResults(data.features || []);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Photon search error:', err);
    }
  }

  _showResults(features) {
    this._resultsEl.innerHTML = '';
    if (features.length === 0) return;

    const list = document.createElement('div');
    list.className = 'photon-results-list';
    list.setAttribute('role', 'listbox');

    features.forEach((feat, idx) => {
      const props = feat.properties;
      const [lon, lat] = feat.geometry.coordinates;
      const label = this._formatLabel(props);
      const sublabel = this._formatSublabel(props);

      const item = document.createElement('div');
      item.className = 'photon-result-item';
      item.setAttribute('role', 'option');
      item.tabIndex = -1;
      item.innerHTML = `
        <div class="photon-result-name">${this._escape(label)}</div>
        <div class="photon-result-sub">${this._escape(sublabel)}</div>
      `;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._select(feat, lon, lat);
      });
      item.addEventListener('mouseenter', () => this._highlight(idx));
      list.appendChild(item);
    });

    this._resultsEl.appendChild(list);
    this._highlight(0);
  }

  _formatLabel(props) {
    const parts = [props.name].filter(Boolean);
    // Append osm_value as type hint, but skip generic ones
    const type = props.osm_value;
    if (type && !['yes', 'unknown'].includes(type)) {
      parts.push(`(${type})`);
    }
    return parts.join(' ') || props.osm_key || 'POI';
  }

  _formatSublabel(props) {
    const parts = [];
    if (props.city) parts.push(props.city);
    if (props.state && props.state !== props.city) parts.push(props.state);
    if (props.country) parts.push(props.country);
    return parts.join(' · ') || '';
  }

  _select(feature, lon, lat) {
    const { properties: props } = feature;
    const name = props.name || 'Selected location';
    const sublabel = this._formatSublabel(props);
    const label = [name, sublabel].filter(Boolean).join(', ');

    // Remove previous marker
    this._removeMarker();

    // Create marker
    const el = document.createElement('div');
    el.className = 'photon-marker';
    el.innerHTML = `
      <svg width="24" height="36" viewBox="0 0 24 36" fill="none">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24C24 5.37 18.63 0 12 0z" fill="#e74c3c"/>
        <circle cx="12" cy="12" r="5" fill="#fff"/>
      </svg>
    `;

    this._marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lon, lat])
      .setPopup(new maplibregl.Popup({ offset: 25, closeButton: true, closeOnClick: true })
        .setHTML(`<strong>${this._escape(name)}</strong>${sublabel ? '<br>' + this._escape(sublabel) : ''}`))
      .addTo(this._map);

    this._marker.togglePopup();

    // Fly to location
    this._map.flyTo({
      center: [lon, lat],
      zoom: Math.max(14, Math.min(17, this._map.getZoom() + 3)),
    });

    // Clear search
    this._input.value = '';
    this._closeResults();
  }

  _removeMarker() {
    if (this._marker) {
      this._marker.remove();
      this._marker = null;
    }
  }

  _highlight(idx) {
    const items = this._resultsEl.querySelectorAll('.photon-result-item');
    items.forEach((item, i) => item.classList.toggle('photon-result-highlighted', i === idx));
    this._highlightedIdx = idx;
  }

  _highlightNext() {
    const items = this._resultsEl.querySelectorAll('.photon-result-item');
    if (items.length === 0) return;
    const next = ((this._highlightedIdx ?? -1) + 1) % items.length;
    this._highlight(next);
    items[next]?.scrollIntoView({ block: 'nearest' });
  }

  _highlightPrev() {
    const items = this._resultsEl.querySelectorAll('.photon-result-item');
    if (items.length === 0) return;
    const prev = ((this._highlightedIdx ?? 1) - 1 + items.length) % items.length;
    this._highlight(prev);
    items[prev]?.scrollIntoView({ block: 'nearest' });
  }

  _selectHighlighted() {
    if (this._highlightedIdx == null) return;
    const items = this._resultsEl.querySelectorAll('.photon-result-item');
    const item = items[this._highlightedIdx];
    if (item) item.click();
  }

  _closeResults() {
    this._resultsEl.innerHTML = '';
    this._highlightedIdx = null;
  }

  _escape(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
