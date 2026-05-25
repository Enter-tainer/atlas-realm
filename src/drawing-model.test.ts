import { describe, expect, it } from 'vitest';
import {
  applyDrawingFeatureDelete,
  applyDrawingFeatureReorder,
  applyDrawingFeatureUpsert,
  applyDrawingLayerUpsert,
  createEmptyDrawingDoc,
  drawingDocBounds,
  drawingDocToGeoJson,
  normalizeDrawingDoc,
  sanitizeDrawingFeature,
} from './drawing-model.js';
import type { DrawingFeature } from './drawing-model.js';

const NOW = 1_700_000_000_000;

function pointFeature(id = 'point-a'): DrawingFeature {
  return {
    id,
    type: 'point',
    layerId: 'drawing-default',
    coordinate: [121.5, 31.2],
    label: 'Cafe',
    note: 'Meet here',
    color: '#2563eb',
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: 'user-a',
  };
}

function pathFeature(id = 'path-a'): DrawingFeature {
  return {
    id,
    type: 'path',
    layerId: 'drawing-default',
    points: [
      [121.5, 31.2],
      [121.51, 31.21],
      [121.52, 31.22],
    ],
    directed: true,
    width: 4,
    label: 'Walk',
    note: 'Morning path',
    color: '#dc2626',
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: 'user-a',
  };
}

function polygonFeature(id = 'polygon-a'): DrawingFeature {
  return {
    id,
    type: 'polygon',
    layerId: 'drawing-default',
    points: [
      [121.5, 31.2],
      [121.54, 31.2],
      [121.54, 31.23],
      [121.5, 31.23],
    ],
    width: 3,
    fillOpacity: 0.22,
    label: 'Park area',
    note: 'Good picnic option',
    color: '#16a34a',
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: 'user-a',
  };
}

describe('drawing model', () => {
  it('normalizes malformed documents into a default editable plan', () => {
    const doc = normalizeDrawingDoc(
      {
        version: 99,
        layers: {
          bad: { id: '../bad' },
          custom: { id: 'custom', name: '  Day   1 ', visible: false },
        },
        layerOrder: ['custom', '../bad'],
        features: {
          good: pointFeature(),
          bad: { id: '../bad', type: 'point', coordinate: [999, 999] },
        },
        featureOrder: ['point-a', '../bad'],
      },
      NOW,
    );

    expect(doc.layerOrder).toEqual(['drawing-default', 'custom']);
    expect(doc.layers.custom).toMatchObject({ name: 'Day 1', visible: false });
    expect(doc.featureOrder).toEqual(['point-a']);
    expect(doc.features['point-a']).toMatchObject({ coordinate: [121.5, 31.2], label: 'Cafe' });
  });

  it('upserts, reorders, and deletes features', () => {
    let doc = createEmptyDrawingDoc(NOW);
    doc = applyDrawingFeatureUpsert(doc, pointFeature('point-a'), { now: NOW + 1 });
    doc = applyDrawingFeatureUpsert(doc, pathFeature('path-a'), { now: NOW + 2 });
    expect(doc.featureOrder).toEqual(['point-a', 'path-a']);
    expect(doc.revision).toBe(2);

    doc = applyDrawingFeatureReorder(doc, ['path-a', 'point-a'], { now: NOW + 3 });
    expect(doc.featureOrder).toEqual(['path-a', 'point-a']);
    expect(doc.revision).toBe(3);

    doc = applyDrawingFeatureDelete(doc, 'path-a', { now: NOW + 4 });
    expect(doc.featureOrder).toEqual(['point-a']);
    expect(doc.features['path-a']).toBeUndefined();
    expect(doc.revision).toBe(4);
  });

  it('projects editable features into GeoJSON render features', () => {
    let doc = createEmptyDrawingDoc(NOW);
    doc = applyDrawingFeatureUpsert(doc, pathFeature(), { now: NOW + 1 });
    const geojson = drawingDocToGeoJson(doc);

    expect(geojson.features.map((feature) => feature.properties?.kind)).toEqual([
      'drawing_path',
      'drawing_label',
      'drawing_arrow',
    ]);
    expect(geojson.features[0]).toMatchObject({
      geometry: { type: 'LineString' },
      properties: {
        drawing_id: 'path-a',
        directed: true,
        name: 'Walk',
        description: 'Morning path',
        color: '#dc2626',
      },
    });
  });

  it('sanitizes and projects polygon annotations as closed GeoJSON areas', () => {
    expect(
      sanitizeDrawingFeature({
        ...polygonFeature(),
        id: 'bad-polygon',
        points: [
          [121.5, 31.2],
          [121.54, 31.2],
        ],
      }),
    ).toBeNull();

    let doc = createEmptyDrawingDoc(NOW);
    doc = applyDrawingFeatureUpsert(
      doc,
      {
        ...polygonFeature(),
        color: 'green',
        fillOpacity: 9,
      } as DrawingFeature,
      { now: NOW + 1 },
    );
    const saved = doc.features['polygon-a'];
    expect(saved).toMatchObject({ type: 'polygon', color: '#2563eb', fillOpacity: 0.7 });

    const geojson = drawingDocToGeoJson(doc);
    expect(geojson.features.map((feature) => feature.properties?.kind)).toEqual([
      'drawing_polygon',
      'drawing_polygon_outline',
      'drawing_label',
    ]);
    expect(geojson.features[0]).toMatchObject({
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [121.5, 31.2],
            [121.54, 31.2],
            [121.54, 31.23],
            [121.5, 31.23],
            [121.5, 31.2],
          ],
        ],
      },
      properties: {
        drawing_id: 'polygon-a',
        feature_type: 'polygon',
        fill_opacity: 0.7,
        name: 'Park area',
      },
    });
    expect(drawingDocBounds(doc)).toEqual([
      [121.5, 31.2],
      [121.54, 31.23],
    ]);
  });

  it('keeps hidden layers out of rendered GeoJSON while preserving export data', () => {
    let doc = createEmptyDrawingDoc(NOW);
    doc = applyDrawingFeatureUpsert(doc, pathFeature(), { now: NOW + 1 });
    doc = applyDrawingLayerUpsert(
      doc,
      {
        ...doc.layers['drawing-default'],
        visible: false,
        stackOrder: 2,
        updatedAt: NOW + 2,
      },
      { now: NOW + 2 },
    );

    expect(drawingDocToGeoJson(doc).features).toHaveLength(0);
    expect(drawingDocToGeoJson(doc, { includeHidden: true }).features).toHaveLength(3);
    expect(drawingDocBounds(doc)).toEqual([
      [121.5, 31.2],
      [121.52, 31.22],
    ]);
    expect(doc.layers['drawing-default'].stackOrder).toBe(2);
  });
});
