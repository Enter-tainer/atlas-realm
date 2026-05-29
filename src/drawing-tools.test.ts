import { describe, expect, it } from 'vitest';
import { isDrawingPickerInteractionActive } from './drawing-tools.js';

describe('drawing tools map interaction state', () => {
  it('does not keep consuming map clicks when the annotation layer is hidden', () => {
    expect(
      isDrawingPickerInteractionActive({
        expanded: true,
        layerVisible: true,
        drawingReady: true,
        mode: 'route',
      }),
    ).toBe(true);

    expect(
      isDrawingPickerInteractionActive({
        expanded: true,
        layerVisible: false,
        drawingReady: true,
        mode: 'route',
      }),
    ).toBe(false);
  });
});
