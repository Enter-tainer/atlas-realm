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
    lineStyle: 'solid',
    opacity: 0.95,
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
    lineStyle: 'solid',
    opacity: 0.95,
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

  it('preserves line breaks in annotation labels and notes', () => {
    expect(
      sanitizeAnnotationFeaturePayload({
        ...pointFeature(),
        label: '  First line  \nSecond\tline  ',
        note: 'Plan A\r\nPlan B\r\n\r\nPlan C',
        updatedBy: 'Agent\nName',
      }),
    ).toMatchObject({
      label: 'First line\nSecond line',
      note: 'Plan A\nPlan B\n\nPlan C',
      updatedBy: 'Agent Name',
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
      line_style: 'solid',
      opacity: 0.95,
    });
  });

  it('sanitizes line, route, and area style fields', () => {
    expect(
      sanitizeAnnotationFeaturePayload({
        ...pathFeature(),
        width: 99,
        lineStyle: 'dash',
        opacity: -1,
      }),
    ).toMatchObject({
      type: 'path',
      width: 12,
      lineStyle: 'dashed',
      opacity: 0.05,
    });

    expect(
      sanitizeAnnotationFeaturePayload({
        ...polygonFeature(),
        lineStyle: 'dot',
        opacity: 2,
        fillOpacity: 2,
      }),
    ).toMatchObject({
      type: 'polygon',
      lineStyle: 'dotted',
      opacity: 1,
      fillOpacity: 1,
    });
  });

  it('emits polygon fill and outline helpers', () => {
    const geojson = annotationFeaturePayloadsToGeoJson([polygonFeature()]);

    expect(geojson.features.map((feature) => feature.properties?.kind)).toEqual([
      'annotation_polygon',
      'annotation_polygon_outline',
    ]);
    expect(geojson.features[0].geometry.type).toBe('Polygon');
    expect(geojson.features[0].properties).toMatchObject({
      line_style: 'solid',
      opacity: 0.95,
      fill_opacity: 0.22,
    });
    expect(geojson.features[1].geometry.type).toBe('LineString');
    expect(geojson.features[1].properties).toMatchObject({
      line_style: 'solid',
      opacity: 0.95,
    });
  });

  it('can filter GeoJSON and bounds by annotation layer', () => {
    const features = [pointFeature('point-a', 'layer-a'), pathFeature('path-b', 'layer-b')];

    expect(annotationFeaturePayloadsToGeoJson(features, { layerId: 'layer-a' }).features).toHaveLength(1);
    expect(annotationFeaturePayloadsBounds(features, { layerId: 'layer-b' })).toEqual([
      [121.5, 31.2],
      [121.6, 31.3],
    ]);
  });

  it('includes description_plain with stripped markdown', () => {
    const geojson = annotationFeaturePayloadsToGeoJson([pointFeature('p', ANNOTATION_DEFAULT_LAYER_ID)]);

    expect(geojson.features[0].properties).toHaveProperty('description_plain');

    const withMd = annotationFeaturePayloadsToGeoJson([
      {
        ...pointFeature('m', ANNOTATION_DEFAULT_LAYER_ID),
        note: '**bold** and *italic* text',
      },
    ]);

    expect(withMd.features[0].properties?.description).toBe('**bold** and *italic* text');
    expect(withMd.features[0].properties?.description_plain).toBe('bold and italic text');
  });

  it('sets description_plain to undefined when note is empty', () => {
    const geojson = annotationFeaturePayloadsToGeoJson([pointFeature('empty', ANNOTATION_DEFAULT_LAYER_ID)]);
    expect(geojson.features[0].properties?.description).toBeUndefined();
    expect(geojson.features[0].properties?.description_plain).toBeUndefined();
  });
});
