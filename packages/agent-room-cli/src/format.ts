import type { HumanFormatter, JsonRecord } from './types.js';

export function formatOutput(
  result: JsonRecord,
  { json = false, pretty = false }: { json?: boolean; pretty?: boolean } = {},
  humanFormatter?: HumanFormatter,
): string {
  if (json || pretty) return JSON.stringify(result, null, pretty ? 2 : 0);
  if (humanFormatter) return humanFormatter(result);
  return JSON.stringify(result, null, 2);
}

export function overlayListText(data: JsonRecord): string {
  return data.overlays.length
    ? data.overlays.map((overlay: JsonRecord) => `${overlay.id}\t${overlay.type}\t${overlay.name}`).join('\n')
    : 'No layers';
}

export function annotationListText(data: JsonRecord): string {
  return data.annotations.length
    ? data.annotations
        .map((feature: JsonRecord) => `${feature.id}\t${feature.type}\t${feature.layerId}\t${feature.label || ''}`)
        .join('\n')
    : 'No annotations';
}

export function annotationLayerListText(data: JsonRecord): string {
  return data.layers.map((layer: JsonRecord) => `${layer.id}\t${layer.visible !== false}\t${layer.name}`).join('\n');
}
