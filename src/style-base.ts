type BaseStyleLayer = Record<string, unknown> & {
  id?: string;
  source?: unknown;
};

type BaseStyle = Record<string, unknown> & {
  layers?: BaseStyleLayer[];
  sources?: Record<string, unknown>;
};

/**
 * The OpenFreeMap base style ships a pre-rendered Natural Earth shaded relief
 * raster (`ne2_shaded`, ~12 MB across the world at low zoom). It duplicates the
 * relief that the Mapterhorn hillshade already draws from real elevation data,
 * and it is the single largest download of the map startup.
 *
 * Drop the layer (and the source, when nothing else uses it) before the base
 * style is merged with the ORM style.
 */
export const BASE_RELIEF_SOURCE = 'ne2_shaded';

export function dropBaseRelief<T extends BaseStyle>(style: T): T {
  const layers = style.layers ?? [];
  const keptLayers = layers.filter((layer) => layer.source !== BASE_RELIEF_SOURCE);
  if (keptLayers.length === layers.length) return style;

  const sources = { ...(style.sources ?? {}) };
  if (!keptLayers.some((layer) => layer.source === BASE_RELIEF_SOURCE)) {
    delete sources[BASE_RELIEF_SOURCE];
  }
  return { ...style, layers: keptLayers, sources };
}
