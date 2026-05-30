export type AnnotationDraftMode = 'path' | 'polygon' | 'route';

export type AnnotationDraftCompletion =
  | { action: 'create' }
  | { action: 'discard'; status: string }
  | { action: 'wait'; status: string };

export function annotationDraftMinPoints(mode: AnnotationDraftMode) {
  return mode === 'polygon' ? 3 : 2;
}

export function canSubmitAnnotationDraft(mode: AnnotationDraftMode, pointCount: number) {
  if (mode === 'route') return pointCount >= annotationDraftMinPoints(mode);
  return pointCount > 0;
}

export function resolveAnnotationDraftCompletion(
  mode: AnnotationDraftMode,
  pointCount: number,
): AnnotationDraftCompletion {
  if (pointCount >= annotationDraftMinPoints(mode)) return { action: 'create' };
  if (mode === 'path' && pointCount > 0) return { action: 'discard', status: 'Line discarded' };
  if (mode === 'polygon' && pointCount > 0) return { action: 'discard', status: 'Area discarded' };
  if (mode === 'route') return { action: 'wait', status: 'Pick start and end' };
  return { action: 'wait', status: mode === 'polygon' ? 'Add at least 3 points' : 'Add at least 2 points' };
}
