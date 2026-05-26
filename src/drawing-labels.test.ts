import { describe, expect, it } from 'vitest';
import { defaultDrawingFeatureLabel, nextDrawingFeatureNumber } from './drawing-labels.js';
import { applyDrawingFeatureUpsert, createEmptyDrawingDoc } from './drawing-model.js';
import type { DrawingFeature } from './drawing-model.js';

const NOW = 1_700_000_000_000;

function pointFeature(id: string): DrawingFeature {
  return {
    id,
    type: 'point',
    layerId: 'drawing-default',
    coordinate: [121.5, 31.2],
    label: id,
    note: '',
    color: '#2563eb',
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: '',
  };
}

describe('drawing labels', () => {
  it('generates stable numbered defaults per annotation type', () => {
    let doc = createEmptyDrawingDoc(NOW);
    doc = applyDrawingFeatureUpsert(doc, pointFeature('point-a'), { now: NOW + 1 });

    expect(nextDrawingFeatureNumber(doc, 'point')).toBe(2);
    expect(defaultDrawingFeatureLabel(doc, 'point')).toBe('Marker 2');
    expect(defaultDrawingFeatureLabel(doc, 'text')).toBe('Note 1');
    expect(defaultDrawingFeatureLabel(doc, 'path')).toBe('Line 1');
    expect(defaultDrawingFeatureLabel(doc, 'polygon')).toBe('Area 1');
  });

  it('uses route profile, distance, duration, and endpoint names when available', () => {
    const doc = createEmptyDrawingDoc(NOW);

    expect(
      defaultDrawingFeatureLabel(doc, 'route', {
        profile: 'walking',
        distanceText: '3.2 km',
        durationText: '42 min',
      }),
    ).toBe('Walking route 1 - 3.2 km - 42 min');

    expect(
      defaultDrawingFeatureLabel(doc, 'route', {
        profile: 'driving',
        distanceText: '12 km',
        durationText: '20 min',
        fromName: 'Tokyo Station',
        toName: 'Shinjuku',
      }),
    ).toBe('Tokyo Station to Shinjuku - 12 km - 20 min');
  });
});
