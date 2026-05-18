/**
 * layer-panel.js — visual overlay management panel for LayerRegistry.
 *
 * Renders a "🗂" button in the MapLibre control group.
 * Click opens a panel listing all registered overlays with visibility toggle and remove.
 *
 * Mobile-first: bottom sheet on small screens, dropdown panel on desktop.
 */

const TYPE_ICONS = {
  gpx: '🛤',
  geojson: '🗺',
  route: '🧭',
};

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

class LayerPanelControl {
  /** @param {import('./layers.js').LayerRegistry} registry */
  constructor(registry) {
    this._registry = registry;
    this._open = false;
    this._container = null;
    this._btn = null;
    this._panel = null;
    this._backdrop = null;
    this._listEl = null;
    this._emptyEl = null;
    this._countBadge = null;
    this._touchStartY = 0;
  }

  onAdd(map) {
    this._map = map;

    // Button
    this._container = el('div', 'maplibregl-ctrl maplibregl-ctrl-group');
    this._btn = el('button', 'maplibregl-ctrl-layer-panel');
    this._btn.type = 'button';
    this._btn.title = 'Layers';
    this._btn.setAttribute('aria-label', 'Layers');
    this._btn.textContent = '🗂';
    this._btn.addEventListener('click', () => this._toggle());
    this._container.appendChild(this._btn);

    // Count badge
    this._countBadge = el('span', 'layer-panel-badge', this._btn);
    this._updateBadge();

    // Backdrop (mobile only)
    this._backdrop = el('div', 'layer-panel-backdrop');
    this._backdrop.addEventListener('click', () => this._close());

    // Panel
    this._panel = el('div', 'layer-panel');
    this._panel.addEventListener('touchstart', (e) => this._onPanelTouchStart(e), { passive: true });
    this._panel.addEventListener('touchmove', (e) => this._onPanelTouchMove(e), { passive: false });
    this._panel.addEventListener('touchend', () => this._onPanelTouchEnd());

    // Panel header
    const header = el('div', 'layer-panel-header', this._panel);
    const title = el('span', 'layer-panel-title', header);
    title.textContent = 'Layers';
    const closeBtn = el('button', 'layer-panel-close', header);
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this._close());

    // Empty state
    this._emptyEl = el('div', 'layer-panel-empty', this._panel);
    this._emptyEl.textContent = 'No overlays loaded.\nDrag & drop a GPX file, load a GeoJSON URL, or plan a route.';

    // Layer list
    this._listEl = el('div', 'layer-panel-list', this._panel);

    // Append panel and backdrop to map container
    map.getContainer().appendChild(this._backdrop);
    map.getContainer().appendChild(this._panel);

    // Listen for registry changes (polling via MutationObserver-style — we refresh on open)
    this._map.on('moveend', () => {}); // keep a noop to satisfy IControl

    return this._container;
  }

  onRemove() {
    this._backdrop?.parentNode?.removeChild(this._backdrop);
    this._panel?.parentNode?.removeChild(this._panel);
    this._container?.parentNode?.removeChild(this._container);
    this._map = undefined;
  }

  getDefaultPosition() {
    return 'top-right';
  }

  // ── Toggle ────────────────────────────────────────────────────────

  _toggle() {
    if (this._open) this._close();
    else this._openPanel();
  }

  _openPanel() {
    this._open = true;
    this._refreshList();
    this._panel.classList.add('open');
    this._backdrop.classList.add('visible');
    this._btn.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  _close() {
    this._open = false;
    this._panel.classList.remove('open');
    this._backdrop.classList.remove('visible');
    this._btn.classList.remove('active');
    document.body.style.overflow = '';
  }

  // ── List rendering ────────────────────────────────────────────────

  _refreshList() {
    this._listEl.innerHTML = '';
    const layers = this._registry.list();

    if (layers.length === 0) {
      this._emptyEl.style.display = 'block';
      this._listEl.style.display = 'none';
      return;
    }

    this._emptyEl.style.display = 'none';
    this._listEl.style.display = 'block';

    for (const layer of layers) {
      const row = el('div', 'layer-panel-row', this._listEl);
      row.dataset.layerId = layer.id;

      // Type icon
      const icon = el('span', 'layer-panel-row-icon', row);
      icon.textContent = TYPE_ICONS[layer.type] || '📄';

      // Name
      const name = el('span', 'layer-panel-row-name', row);
      name.textContent = layer.name;
      name.title = layer.name;

      // Visibility toggle
      const visBtn = el('button', 'layer-panel-row-vis', row);
      visBtn.textContent = layer.visible ? '👁' : '👁‍🗨';
      visBtn.title = layer.visible ? 'Hide' : 'Show';
      visBtn.setAttribute('aria-label', layer.visible ? 'Hide layer' : 'Show layer');
      visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = !layer.visible;
        this._registry.setVisible(layer.id, next);
        this._refreshList();
      });

      // Remove
      const delBtn = el('button', 'layer-panel-row-del', row);
      delBtn.textContent = '✕';
      delBtn.title = 'Remove';
      delBtn.setAttribute('aria-label', 'Remove layer');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._registry.remove(layer.id);
        this._refreshList();
        this._updateBadge();
      });

      // Click row → fly to layer bounds (if available on metadata)
      row.addEventListener('click', () => {
        // For routes, we could fly to bounds — but metadata not yet exposed.
        // Future: store bounds in registry metadata.
      });
    }

    this._updateBadge();
  }

  _updateBadge() {
    const count = this._registry.size;
    if (count > 0) {
      this._countBadge.textContent = count > 9 ? '9+' : String(count);
      this._countBadge.style.display = 'flex';
    } else {
      this._countBadge.style.display = 'none';
    }
  }

  // ── Mobile swipe-to-dismiss ───────────────────────────────────────

  _onPanelTouchStart(e) {
    this._touchStartY = e.touches[0].clientY;
  }

  _onPanelTouchMove(e) {
    const dy = e.touches[0].clientY - this._touchStartY;
    if (dy > 60) {
      this._close();
    }
  }

  _onPanelTouchEnd() {
    this._touchStartY = 0;
  }

  // ── Public refresh (called externally when layers change) ─────────

  refresh() {
    if (this._open) this._refreshList();
    this._updateBadge();
  }
}

export { LayerPanelControl };
