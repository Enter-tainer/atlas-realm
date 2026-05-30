import { describe, expect, it } from 'vitest';
import { isAnnotationPickerInteractionActive } from './annotation-tools.js';

describe('annotation tools map interaction state', () => {
  it('does not keep consuming map clicks when the annotation layer is hidden', () => {
    expect(
      isAnnotationPickerInteractionActive({
        expanded: true,
        layerVisible: true,
        annotationReady: true,
        mode: 'route',
      }),
    ).toBe(true);

    expect(
      isAnnotationPickerInteractionActive({
        expanded: true,
        layerVisible: false,
        annotationReady: true,
        mode: 'route',
      }),
    ).toBe(false);
  });
});
