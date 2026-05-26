import { describe, expect, it } from 'vitest';
import { createEmptyDrawingDoc } from './drawing-model.js';
import { applyDrawingServerMessage, parseDrawingClientMessage, reduceDrawingClientMessage } from './drawing-sync.js';
import type { DrawingFeature } from './drawing-model.js';

const NOW = 1_700_000_000_000;

function routeFeature(): DrawingFeature {
  return {
    id: 'route-a',
    type: 'route',
    layerId: 'drawing-default',
    waypoints: [
      [121.5, 31.2],
      [121.6, 31.3],
    ],
    profile: 'driving',
    directed: true,
    width: 5,
    geometry: [
      [121.5, 31.2],
      [121.55, 31.25],
      [121.6, 31.3],
    ],
    distance: 1234,
    duration: 456,
    distanceText: '1.2 km',
    durationText: '8 min',
    label: 'Airport route',
    note: '',
    color: '#2563eb',
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: 'user-a',
  };
}

function polygonFeature(): DrawingFeature {
  return {
    id: 'area-a',
    type: 'polygon',
    layerId: 'drawing-default',
    points: [
      [121.5, 31.2],
      [121.55, 31.2],
      [121.55, 31.24],
    ],
    width: 3,
    fillOpacity: 0.22,
    label: 'Shared area',
    note: '',
    color: '#16a34a',
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: 'user-a',
  };
}

describe('drawing sync protocol', () => {
  it('parses and sanitizes client messages', () => {
    const parsed = parseDrawingClientMessage({
      type: 'drawing:feature:upsert',
      feature: {
        ...routeFeature(),
        profile: 'invalid',
        color: 'red',
        waypoints: [
          [200, 90],
          [121.6, 31.3],
        ],
      },
    });

    expect(parsed?.type).toBe('drawing:feature:upsert');
    if (parsed?.type !== 'drawing:feature:upsert') return;
    expect(parsed.feature).toMatchObject({
      id: 'route-a',
      profile: 'driving',
      color: '#2563eb',
      waypoints: [
        [180, 85],
        [121.6, 31.3],
      ],
    });
  });

  it('accepts polygon upserts as editable sync state', () => {
    const parsed = parseDrawingClientMessage({
      type: 'drawing:feature:upsert',
      feature: {
        ...polygonFeature(),
        color: 'not-a-color',
        fillOpacity: -1,
        points: [
          [200, 90],
          [121.55, 31.2],
          [121.55, 31.24],
        ],
      },
    });

    expect(parsed?.type).toBe('drawing:feature:upsert');
    if (parsed?.type !== 'drawing:feature:upsert') return;
    expect(parsed.feature).toMatchObject({
      id: 'area-a',
      type: 'polygon',
      color: '#2563eb',
      fillOpacity: 0.05,
      points: [
        [180, 85],
        [121.55, 31.2],
        [121.55, 31.24],
      ],
    });

    const reduced = reduceDrawingClientMessage(createEmptyDrawingDoc(NOW), parsed, NOW + 1);
    expect(reduced.outbound).toMatchObject({
      type: 'drawing:feature:upserted',
      revision: 1,
      feature: { id: 'area-a', type: 'polygon' },
    });
  });

  it('reduces client operations into server messages', () => {
    const doc = createEmptyDrawingDoc(NOW);
    const upsert = reduceDrawingClientMessage(
      doc,
      { type: 'drawing:feature:upsert', feature: routeFeature() },
      NOW + 1,
    );
    expect(upsert.outbound).toMatchObject({
      type: 'drawing:feature:upserted',
      revision: 1,
      feature: { id: 'route-a', type: 'route' },
    });

    const deleted = reduceDrawingClientMessage(
      upsert.doc,
      { type: 'drawing:feature:delete', featureId: 'route-a' },
      NOW + 2,
    );
    expect(deleted.outbound).toEqual({
      type: 'drawing:feature:deleted',
      revision: 2,
      featureId: 'route-a',
    });
    expect(deleted.doc.features['route-a']).toBeUndefined();
  });

  it('syncs drawing layer metadata as first-class protocol state', () => {
    const doc = createEmptyDrawingDoc(NOW);
    const reduced = reduceDrawingClientMessage(
      doc,
      {
        type: 'drawing:layer:upsert',
        layer: {
          ...doc.layers['drawing-default'],
          name: 'Tokyo plan',
          visible: false,
          stackOrder: 3,
          updatedAt: NOW + 1,
        },
      },
      NOW + 1,
    );

    expect(reduced.outbound).toMatchObject({
      type: 'drawing:layer:upserted',
      revision: 1,
      layer: {
        id: 'drawing-default',
        name: 'Tokyo plan',
        visible: false,
        stackOrder: 3,
      },
    });
    expect(reduced.doc.layers['drawing-default']).toMatchObject({
      name: 'Tokyo plan',
      visible: false,
      stackOrder: 3,
    });
  });

  it('applies server messages on clients', () => {
    let doc = createEmptyDrawingDoc(NOW);
    doc = applyDrawingServerMessage(doc, {
      type: 'drawing:layer:upserted',
      revision: 6,
      layer: {
        ...doc.layers['drawing-default'],
        name: 'Shared plan',
        visible: false,
        updatedAt: NOW + 1,
      },
    });
    expect(doc.layers['drawing-default']).toMatchObject({ name: 'Shared plan', visible: false });

    doc = applyDrawingServerMessage(doc, {
      type: 'drawing:feature:upserted',
      revision: 7,
      feature: routeFeature(),
    });

    expect(doc.revision).toBe(7);
    expect(doc.features['route-a']).toMatchObject({ label: 'Airport route' });

    doc = applyDrawingServerMessage(doc, {
      type: 'drawing:feature:reordered',
      revision: 8,
      orderedIds: ['route-a'],
    });
    expect(doc.revision).toBe(8);
    expect(doc.featureOrder).toEqual(['route-a']);
  });
});
