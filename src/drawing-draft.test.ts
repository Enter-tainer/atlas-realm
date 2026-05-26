import { describe, expect, it } from 'vitest';
import { canSubmitDrawingDraft, drawingDraftMinPoints, resolveDrawingDraftCompletion } from './drawing-draft.js';

describe('drawing draft rules', () => {
  it('uses line and route minimums of two points and polygon minimum of three points', () => {
    expect(drawingDraftMinPoints('path')).toBe(2);
    expect(drawingDraftMinPoints('route')).toBe(2);
    expect(drawingDraftMinPoints('polygon')).toBe(3);
  });

  it('allows incomplete line and polygon drafts to be submitted so they can be discarded', () => {
    expect(canSubmitDrawingDraft('path', 1)).toBe(true);
    expect(canSubmitDrawingDraft('polygon', 2)).toBe(true);
    expect(resolveDrawingDraftCompletion('path', 1)).toEqual({ action: 'discard', status: 'Line discarded' });
    expect(resolveDrawingDraftCompletion('polygon', 2)).toEqual({ action: 'discard', status: 'Area discarded' });
  });

  it('keeps route submission disabled until both endpoints exist', () => {
    expect(canSubmitDrawingDraft('route', 1)).toBe(false);
    expect(resolveDrawingDraftCompletion('route', 1)).toEqual({ action: 'wait', status: 'Pick start and end' });
    expect(resolveDrawingDraftCompletion('route', 2)).toEqual({ action: 'create' });
  });
});
