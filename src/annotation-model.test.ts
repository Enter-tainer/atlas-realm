import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_DEFAULT_LAYER_ID,
  annotationFeaturePayloadsBounds,
  annotationFeaturePayloadsToGeoJson,
  sanitizeAnnotationFeaturePayload,
  type AnnotationFeaturePayload,
} from './annotation-model.js';

const NOW = 1_700_000_000_000;

function pointFeature(id = 'point-a', layerId = ANNOTATION_DEFAULT_LAYER_ID): AnnotationFeaturePayload {
  return {
    id,
    layerId,
    type: 'point',
    coordinate: [121.5, 31.2],
    label: 'Point A',
    note: '',
    color: '#2563eb',
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: '',
  };
}

function pathFeature(id = 'path-a', layerId = ANNOTATION_DEFAULT_LAYER_ID): AnnotationFeaturePayload {
  return {
    id,
    layerId,
    type: 'path',
    points: [
      [121.5, 31.2],
      [121.6, 31.3],
    ],
    directed: true,
    width: 4,
    label: 'Path A',
    note: 'Walk',
    color: '#dc2626',
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: '',
  };
}

function polygonFeature(id = 'polygon-a', layerId = ANNOTATION_DEFAULT_LAYER_ID): AnnotationFeaturePayload {
  return {
    id,
    layerId,
    type: 'polygon',
    points: [
      [121.5, 31.2],
      [121.7, 31.2],
      [121.6, 31.4],
    ],
    width: 3,
    fillOpacity: 0.22,
    label: 'Area A',
    note: '',
    color: '#16a34a',
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: '',
  };
}

describe('annotation model', () => {
  it('sanitizes annotation payloads without a document wrapper', () => {
    expect(
      sanitizeAnnotationFeaturePayload({
        ...pointFeature(),
        layerId: 'custom-layer',
        coordinate: [999, -999],
        color: 'bad',
        label: '  Marker   label  ',
      }),
    ).toMatchObject({
      id: 'point-a',
      layerId: 'custom-layer',
      type: 'point',
      coordinate: [180, -85],
      color: '#2563eb',
      label: 'Marker label',
    });
  });

  it('projects annotation features to annotation GeoJSON properties', () => {
    const geojson = annotationFeaturePayloadsToGeoJson([pathFeature()]);

    expect(geojson.features.map((feature) => feature.properties?.kind)).toEqual([
      'annotation_path',
      'annotation_arrow',
    ]);
    expect(geojson.features[0].properties).toMatchObject({
      source: 'Annotation',
      annotation_id: 'path-a',
      feature_type: 'path',
      name: 'Path A',
      description: 'Walk',
      directed: true,
    });
  });

  it('emits polygon fill and outline helpers', () => {
    const geojson = annotationFeaturePayloadsToGeoJson([polygonFeature()]);

    expect(geojson.features.map((feature) => feature.properties?.kind)).toEqual([
      'annotation_polygon',
      'annotation_polygon_outline',
    ]);
    expect(geojson.features[0].geometry.type).toBe('Polygon');
    expect(geojson.features[1].geometry.type).toBe('LineString');
  });

  it('can filter GeoJSON and bounds by annotation layer', () => {
    const features = [pointFeature('point-a', 'layer-a'), pathFeature('path-b', 'layer-b')];

    expect(annotationFeaturePayloadsToGeoJson(features, { layerId: 'layer-a' }).features).toHaveLength(1);
    expect(annotationFeaturePayloadsBounds(features, { layerId: 'layer-b' })).toEqual([
      [121.5, 31.2],
      [121.6, 31.3],
    ]);
  });
});
