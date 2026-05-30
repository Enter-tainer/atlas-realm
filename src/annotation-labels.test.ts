import { describe, expect, it } from 'vitest';
import { defaultAnnotationFeatureLabel, nextAnnotationFeatureNumber } from './annotation-labels.js';
import { ANNOTATION_DEFAULT_LAYER_ID, type AnnotationFeaturePayload } from './annotation-model.js';

const NOW = 1_700_000_000_000;

function pointFeature(id: string): AnnotationFeaturePayload {
  return {
    id,
    type: 'point',
    layerId: ANNOTATION_DEFAULT_LAYER_ID,
    coordinate: [121.5, 31.2],
    label: id,
    note: '',
    color: '#2563eb',
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: '',
  };
}

describe('annotation labels', () => {
  it('generates stable numbered defaults per annotation type', () => {
    const features = [pointFeature('point-a')];

    expect(nextAnnotationFeatureNumber(features, 'point')).toBe(2);
    expect(defaultAnnotationFeatureLabel(features, 'point')).toBe('Marker 2');
    expect(defaultAnnotationFeatureLabel(features, 'text')).toBe('Note 1');
    expect(defaultAnnotationFeatureLabel(features, 'path')).toBe('Line 1');
    expect(defaultAnnotationFeatureLabel(features, 'polygon')).toBe('Area 1');
  });

  it('uses route profile, distance, duration, and endpoint names when available', () => {
    const features: AnnotationFeaturePayload[] = [];

    expect(
      defaultAnnotationFeatureLabel(features, 'route', {
        profile: 'walking',
        distanceText: '3.2 km',
        durationText: '42 min',
      }),
    ).toBe('Walking route 1 - 3.2 km - 42 min');

    expect(
      defaultAnnotationFeatureLabel(features, 'route', {
        profile: 'driving',
        distanceText: '12 km',
        durationText: '20 min',
        fromName: 'Tokyo Station',
        toName: 'Shinjuku',
      }),
    ).toBe('Tokyo Station to Shinjuku - 12 km - 20 min');
  });
});
