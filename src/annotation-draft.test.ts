import { describe, expect, it } from 'vitest';
import {
  annotationDraftMinPoints,
  canSubmitAnnotationDraft,
  resolveAnnotationDraftCompletion,
} from './annotation-draft.js';

describe('annotation draft rules', () => {
  it('uses line and route minimums of two points and polygon minimum of three points', () => {
    expect(annotationDraftMinPoints('path')).toBe(2);
    expect(annotationDraftMinPoints('route')).toBe(2);
    expect(annotationDraftMinPoints('polygon')).toBe(3);
  });

  it('allows incomplete line and polygon drafts to be submitted so they can be discarded', () => {
    expect(canSubmitAnnotationDraft('path', 1)).toBe(true);
    expect(canSubmitAnnotationDraft('polygon', 2)).toBe(true);
    expect(resolveAnnotationDraftCompletion('path', 1)).toEqual({ action: 'discard', status: 'Line discarded' });
    expect(resolveAnnotationDraftCompletion('polygon', 2)).toEqual({ action: 'discard', status: 'Area discarded' });
  });

  it('keeps route submission disabled until both endpoints exist', () => {
    expect(canSubmitAnnotationDraft('route', 1)).toBe(false);
    expect(resolveAnnotationDraftCompletion('route', 1)).toEqual({ action: 'wait', status: 'Pick start and end' });
    expect(resolveAnnotationDraftCompletion('route', 2)).toEqual({ action: 'create' });
  });
});
