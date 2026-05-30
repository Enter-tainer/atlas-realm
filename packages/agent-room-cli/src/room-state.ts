import type { AnnotationFeature, Layer } from './types.js';

function compareRows(
  a: { id: string; sortKey?: string; createdAt?: number },
  b: { id: string; sortKey?: string; createdAt?: number },
) {
  return (
    String(a.sortKey || '').localeCompare(String(b.sortKey || '')) ||
    Number(a.createdAt || 0) - Number(b.createdAt || 0) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  );
}

export function sortedLayers(layers: Layer[]): Layer[] {
  return layers.slice().sort(compareRows);
}

export function sortedAnnotationFeatures(features: AnnotationFeature[], layerId?: string): AnnotationFeature[] {
  return features.filter((feature) => !layerId || feature.layerId === layerId).sort(compareRows);
}

export function getLayer(layers: Layer[], id: string | undefined): Layer | null {
  return id ? layers.find((layer) => layer.id === id) || null : null;
}

export function getAnnotationFeature(features: AnnotationFeature[], id: string | undefined): AnnotationFeature | null {
  return id ? features.find((feature) => feature.id === id) || null : null;
}

export function nextSortKey(index: number): string {
  return String(Math.max(0, Math.round(index)) * 10 + 10).padStart(6, '0');
}

export function reorderUpdates(
  rows: Array<{ id: string; sortKey?: string; createdAt?: number }>,
  orderedIds: string[],
  keyName: 'layerId' | 'featureId',
): Array<Record<typeof keyName, string> & { sortKey: string }> {
  const requested = orderedIds.filter(Boolean);
  const requestedSet = new Set(requested);
  const fullOrder = [
    ...requested,
    ...rows
      .slice()
      .sort(compareRows)
      .map((row) => row.id)
      .filter((id) => !requestedSet.has(id)),
  ];
  return fullOrder.map(
    (id, index) =>
      ({ [keyName]: id, sortKey: nextSortKey(index) }) as Record<typeof keyName, string> & { sortKey: string },
  );
}
