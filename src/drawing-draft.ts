export type DrawingDraftMode = 'path' | 'polygon' | 'route';

export type DrawingDraftCompletion =
  | { action: 'create' }
  | { action: 'discard'; status: string }
  | { action: 'wait'; status: string };

export function drawingDraftMinPoints(mode: DrawingDraftMode) {
  return mode === 'polygon' ? 3 : 2;
}

export function canSubmitDrawingDraft(mode: DrawingDraftMode, pointCount: number) {
  if (mode === 'route') return pointCount >= drawingDraftMinPoints(mode);
  return pointCount > 0;
}

export function resolveDrawingDraftCompletion(mode: DrawingDraftMode, pointCount: number): DrawingDraftCompletion {
  if (pointCount >= drawingDraftMinPoints(mode)) return { action: 'create' };
  if (mode === 'path' && pointCount > 0) return { action: 'discard', status: 'Line discarded' };
  if (mode === 'polygon' && pointCount > 0) return { action: 'discard', status: 'Area discarded' };
  if (mode === 'route') return { action: 'wait', status: 'Pick start and end' };
  return { action: 'wait', status: mode === 'polygon' ? 'Add at least 3 points' : 'Add at least 2 points' };
}
