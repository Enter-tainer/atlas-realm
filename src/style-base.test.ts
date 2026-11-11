import { describe, expect, it } from 'vitest';
import { BASE_RELIEF_SOURCE, dropBaseRelief } from './style-base.js';

const reliefLayer = { id: 'natural_earth', type: 'raster', source: BASE_RELIEF_SOURCE };
const baseStyle = () => ({
  sources: {
    [BASE_RELIEF_SOURCE]: { type: 'raster', tiles: ['https://example.invalid/{z}/{x}/{y}.png'] },
    openmaptiles: { type: 'vector', url: 'https://example.invalid/planet' },
  },
  layers: [
    { id: 'background', type: 'background' },
    reliefLayer,
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
  ],
});

describe('dropBaseRelief', () => {
  it('removes the relief layer and its unused source', () => {
    const style = dropBaseRelief(baseStyle());

    expect(style.layers?.map((layer) => layer.id)).toEqual(['background', 'water']);
    expect(Object.keys(style.sources ?? {})).toEqual(['openmaptiles']);
  });

  it('returns the style untouched when there is no relief layer', () => {
    const style = { sources: { openmaptiles: {} }, layers: [{ id: 'background', type: 'background' }] };

    expect(dropBaseRelief(style)).toBe(style);
  });
});
