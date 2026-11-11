// Hides the style's tunnel and bridge marks: a pale cover over tunnels and dark
// railings along bridges. Most metro lines run in tunnels, so the cover washed
// their route colors out halfway to white, and the railings read as extra track
// edges at city zoom. The marks are matched by layer id, which catches the
// OpenHistoricalMap lines too.

type StyleLayerLike = {
  id?: string;
  layout?: Record<string, unknown>;
};

const TUNNEL_AND_BRIDGE_MARK = /^railway_.*_(tunnel_cover|bridge_railing)$/;

export function hideTunnelAndBridgeMarks<T extends StyleLayerLike>(layer: T): T {
  if (!TUNNEL_AND_BRIDGE_MARK.test(layer.id || '')) return layer;
  return { ...layer, layout: { ...(layer.layout || {}), visibility: 'none' } };
}

export function hideTunnelAndBridgeMarksInStyle<T extends { layers?: StyleLayerLike[] }>(style: T): T {
  return { ...style, layers: style.layers?.map(hideTunnelAndBridgeMarks) };
}
