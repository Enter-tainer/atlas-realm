import { describe, expect, it } from 'vitest';
import { createEmptyDrawingDoc } from './drawing-model.js';
import {
  applyDrawingServerMessage,
  buildDrawingSnapshotMessage,
  parseDrawingClientMessage,
  reduceDrawingClientMessage,
} from './drawing-sync.js';
import {
  DRAWING_RANDOM_TEST_NOW,
  generateDrawingClientMessages,
  reduceDrawingClientMessages,
} from './drawing-random-test-helper.js';
import type { DrawingDoc, DrawingFeature } from './drawing-model.js';

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

function textFeature(): DrawingFeature {
  return {
    id: 'text-a',
    type: 'text',
    layerId: 'drawing-default',
    coordinate: [121.5, 31.2],
    width: 210,
    height: 104,
    label: 'Shared note',
    note: 'Resize me',
    color: '#ca8a04',
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: 'user-a',
  };
}

function comparableDoc(doc: DrawingDoc) {
  return {
    revision: doc.revision,
    layerOrder: doc.layerOrder,
    featureOrder: doc.featureOrder,
    layers: doc.layers,
    features: doc.features,
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

  it('preserves resized text annotation dimensions through sync', () => {
    const parsed = parseDrawingClientMessage({
      type: 'drawing:feature:upsert',
      feature: {
        ...textFeature(),
        width: 999,
        height: 20,
      },
    });

    expect(parsed?.type).toBe('drawing:feature:upsert');
    if (parsed?.type !== 'drawing:feature:upsert') return;
    expect(parsed.feature).toMatchObject({
      id: 'text-a',
      type: 'text',
      width: 420,
      height: 48,
    });

    const reduced = reduceDrawingClientMessage(createEmptyDrawingDoc(NOW), parsed, NOW + 1);
    expect(reduced.outbound).toMatchObject({
      type: 'drawing:feature:upserted',
      feature: { id: 'text-a', type: 'text', width: 420, height: 48 },
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

  it('allows trusted collaborators to edit the same feature with last write winning', () => {
    const initial = reduceDrawingClientMessage(
      createEmptyDrawingDoc(NOW),
      { type: 'drawing:feature:upsert', feature: routeFeature() },
      NOW + 1,
    );
    const editedByFriend = reduceDrawingClientMessage(
      initial.doc,
      {
        type: 'drawing:feature:upsert',
        feature: {
          ...routeFeature(),
          label: 'Dinner route',
          note: 'Edited by a collaborator',
          color: '#dc2626',
          updatedAt: NOW + 2,
          updatedBy: 'user-b',
        },
      },
      NOW + 2,
    );

    expect(editedByFriend.outbound).toMatchObject({
      type: 'drawing:feature:upserted',
      revision: 2,
      feature: {
        id: 'route-a',
        label: 'Dinner route',
        note: 'Edited by a collaborator',
        color: '#dc2626',
        updatedBy: 'user-b',
      },
    });
    expect(editedByFriend.doc.features['route-a']).toMatchObject({
      label: 'Dinner route',
      updatedBy: 'user-b',
    });

    if (!initial.outbound || !editedByFriend.outbound) throw new Error('Expected drawing server messages');
    let clientA = createEmptyDrawingDoc(NOW);
    let clientB = createEmptyDrawingDoc(NOW);
    clientA = applyDrawingServerMessage(clientA, initial.outbound);
    clientA = applyDrawingServerMessage(clientA, editedByFriend.outbound);
    clientB = applyDrawingServerMessage(clientB, initial.outbound);
    clientB = applyDrawingServerMessage(clientB, editedByFriend.outbound);

    expect(clientA).toEqual(clientB);
    expect(clientA.features['route-a']).toMatchObject({
      label: 'Dinner route',
      note: 'Edited by a collaborator',
      updatedBy: 'user-b',
    });
  });

  it('allows collaborators to reorder and delete shared features without ownership checks', () => {
    let reduced = reduceDrawingClientMessage(
      createEmptyDrawingDoc(NOW),
      { type: 'drawing:feature:upsert', feature: routeFeature() },
      NOW + 1,
    );
    reduced = reduceDrawingClientMessage(
      reduced.doc,
      { type: 'drawing:feature:upsert', feature: { ...polygonFeature(), updatedBy: 'user-b' } },
      NOW + 2,
    );
    reduced = reduceDrawingClientMessage(
      reduced.doc,
      { type: 'drawing:feature:reorder', orderedIds: ['area-a', 'route-a'] },
      NOW + 3,
    );

    expect(reduced.outbound).toEqual({
      type: 'drawing:feature:reordered',
      revision: 3,
      orderedIds: ['area-a', 'route-a'],
    });
    expect(reduced.doc.featureOrder).toEqual(['area-a', 'route-a']);

    reduced = reduceDrawingClientMessage(
      reduced.doc,
      { type: 'drawing:feature:delete', featureId: 'route-a' },
      NOW + 4,
    );

    expect(reduced.outbound).toEqual({
      type: 'drawing:feature:deleted',
      revision: 4,
      featureId: 'route-a',
    });
    expect(reduced.doc.featureOrder).toEqual(['area-a']);
    expect(reduced.doc.features['route-a']).toBeUndefined();
    expect(reduced.doc.features['area-a']).toMatchObject({ updatedBy: 'user-b' });
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

  it('syncs drawing layer order as first-class protocol state', () => {
    let doc = createEmptyDrawingDoc(NOW);
    doc = reduceDrawingClientMessage(
      doc,
      {
        type: 'drawing:layer:upsert',
        layer: {
          id: 'custom-a',
          name: 'Custom A',
          visible: true,
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
      NOW + 1,
    ).doc;
    doc = reduceDrawingClientMessage(
      doc,
      {
        type: 'drawing:layer:upsert',
        layer: {
          id: 'custom-b',
          name: 'Custom B',
          visible: true,
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
      NOW + 2,
    ).doc;

    const parsed = parseDrawingClientMessage({
      type: 'drawing:layer:reorder',
      orderedIds: ['custom-b', 'bad/id', 'drawing-default'],
    });
    expect(parsed).toEqual({
      type: 'drawing:layer:reorder',
      orderedIds: ['custom-b', 'drawing-default'],
    });
    if (!parsed || parsed.type !== 'drawing:layer:reorder') return;

    const reduced = reduceDrawingClientMessage(doc, parsed, NOW + 3);
    expect(reduced.outbound).toEqual({
      type: 'drawing:layer:reordered',
      revision: 3,
      orderedIds: ['custom-b', 'drawing-default', 'custom-a'],
    });

    const client = applyDrawingServerMessage(createEmptyDrawingDoc(NOW), buildDrawingSnapshotMessage(doc));
    expect(applyDrawingServerMessage(client, reduced.outbound).layerOrder).toEqual([
      'custom-b',
      'drawing-default',
      'custom-a',
    ]);
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
      type: 'drawing:layer:reordered',
      revision: 8,
      orderedIds: ['drawing-default'],
    });
    expect(doc.revision).toBe(8);
    expect(doc.layerOrder).toEqual(['drawing-default']);

    doc = applyDrawingServerMessage(doc, {
      type: 'drawing:feature:reordered',
      revision: 9,
      orderedIds: ['route-a'],
    });
    expect(doc.revision).toBe(9);
    expect(doc.featureOrder).toEqual(['route-a']);
  });

  it('keeps clients converged under deterministic randomized collaborative operations', () => {
    const seeds = [1, 42, 2_024_052_7, 0xdecafbad];
    for (const seed of seeds) {
      const messages = generateDrawingClientMessages(seed, 260);
      expect(generateDrawingClientMessages(seed, 260)).toEqual(messages);

      let server = createEmptyDrawingDoc(DRAWING_RANDOM_TEST_NOW);
      let clientA = createEmptyDrawingDoc(DRAWING_RANDOM_TEST_NOW);
      let clientB = createEmptyDrawingDoc(DRAWING_RANDOM_TEST_NOW);
      let staleClient = createEmptyDrawingDoc(DRAWING_RANDOM_TEST_NOW);

      messages.forEach((message, index) => {
        const result = reduceDrawingClientMessage(server, message, DRAWING_RANDOM_TEST_NOW + 1_000 + index);
        server = result.doc;
        if (!result.outbound) return;
        clientA = applyDrawingServerMessage(clientA, result.outbound);
        clientB = applyDrawingServerMessage(clientB, result.outbound);
        if (index < Math.floor(messages.length / 3)) {
          staleClient = applyDrawingServerMessage(staleClient, result.outbound);
        }
      });

      const reduced = reduceDrawingClientMessages(messages);
      const expectedFeatureIds = Object.keys(server.features).sort();
      expect(server.revision).toBe(messages.length);
      expect(new Set(server.featureOrder).size).toBe(server.featureOrder.length);
      expect(server.featureOrder.slice().sort()).toEqual(expectedFeatureIds);
      expect(comparableDoc(clientA)).toEqual(comparableDoc(server));
      expect(comparableDoc(clientB)).toEqual(comparableDoc(server));
      expect(comparableDoc(reduced)).toEqual(comparableDoc(server));

      staleClient = applyDrawingServerMessage(staleClient, buildDrawingSnapshotMessage(server));
      expect(comparableDoc(staleClient)).toEqual(comparableDoc(server));
    }
  });
});
