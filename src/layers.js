/**
 * LayerRegistry — unified overlay tracking for GPX / GeoJSON / Route layers.
 *
 * Every overlay added to the map registers here so we can:
 *   - list all active overlays
 *   - toggle visibility
 *   - remove (clean up MapLibre sources + layers)
 *
 * Usage:
 *   const registry = new LayerRegistry(map);
 *   const entry = registry.register('gpx-0', { name: 'Track 1', type: 'gpx', sourceIds: ['gpx-track-0'], layerIds: [...] });
 *   registry.remove('gpx-0');
 */

export class LayerRegistry {
  /** @param {maplibregl.Map} map */
  constructor(map) {
    this._map = map;
    /** @type {Map<string, {name: string, type: string, sourceIds: string[], layerIds: string[], visible: boolean}>} */
    this._entries = new Map();
  }

  /**
   * Register a new overlay.
   * @param {string} id - unique overlay id
   * @param {{name: string, type: string, sourceIds: string[], layerIds: string[]}} opts
   */
  register(id, { name, type, sourceIds, layerIds }) {
    this._entries.set(id, { name, type, sourceIds, layerIds, visible: true });
  }

  /**
   * Remove an overlay: strips all MapLibre layers + sources, then unregisters.
   * @param {string} id
   */
  remove(id) {
    const entry = this._entries.get(id);
    if (!entry) return;
    // Remove layers in reverse order (child layers depend on source)
    for (const layerId of [...entry.layerIds].reverse()) {
      if (this._map.getLayer(layerId)) this._map.removeLayer(layerId);
    }
    for (const sourceId of entry.sourceIds) {
      if (this._map.getSource(sourceId)) this._map.removeSource(sourceId);
    }
    this._entries.delete(id);
  }

  /**
   * Toggle visibility of an overlay.
   * @param {string} id
   * @param {boolean} visible
   */
  setVisible(id, visible) {
    const entry = this._entries.get(id);
    if (!entry) return;
    entry.visible = visible;
    const visibility = visible ? 'visible' : 'none';
    for (const layerId of entry.layerIds) {
      if (this._map.getLayer(layerId)) {
        this._map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    }
  }

  /**
   * @returns {Array<{id: string, name: string, type: string, visible: boolean}>}
   */
  list() {
    return [...this._entries.entries()].map(([id, e]) => ({
      id,
      name: e.name,
      type: e.type,
      visible: e.visible,
    }));
  }

  /**
   * Number of registered overlays.
   */
  get size() {
    return this._entries.size;
  }
}
