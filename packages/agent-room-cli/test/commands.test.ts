import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildFeatureFromParts } from '../src/drawing-feature.js';
import { buildOverlayAssetFromText } from '../src/overlay-asset.js';
import { buildSocketUrl, createConfig } from '../src/config.js';
import { executeCommand } from '../src/commands.js';

const NOW = 1_700_000_000_000;

class FakeRoomClient {
  constructor() {
    this.config = { room: 'test-room', agentName: 'Agent', timeoutMs: 1000 };
    this.overlays = [];
    this.peers = [];
    this.agents = [
      {
        id: 'agent-a',
        user: { id: 'agent-a', name: 'Agent', color: '#4f46e5' },
        clientType: 'agent',
        active: true,
        lastSeenAt: NOW,
        expiresAt: NOW + 300_000,
        lastAction: 'connect',
      },
    ];
    this.drawingDoc = {
      layers: {
        'drawing-default': {
          id: 'drawing-default',
          name: 'Annotations',
          visible: true,
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
      layerOrder: ['drawing-default'],
      features: {},
      featureOrder: [],
    };
    this.sentJson = [];
    this.sentBinary = [];
  }

  sendJson(message) {
    this.sentJson.push(message);
  }

  sendBinary(bytes) {
    this.sentBinary.push(bytes);
  }

  async waitFor(predicate, label) {
    if (label.startsWith('overlay content store')) {
      const contentHash = label.split(' ').at(-1);
      return { json: { type: 'overlay:content:stored', contentHash } };
    }
    if (label.startsWith('overlay upsert')) {
      const manifest = this.sentJson.at(-1)?.manifest;
      this.overlays.unshift(manifest);
      return { json: { type: 'overlay:upserted', manifest } };
    }
    if (label.startsWith('overlay patch')) {
      const overlayId = this.sentJson.at(-1)?.overlayId;
      const patch = this.sentJson.at(-1)?.patch;
      const existing = this.overlays.find((overlay) => overlay.id === overlayId);
      const manifest = { ...existing, ...patch, id: overlayId };
      return { json: { type: 'overlay:patched', manifest } };
    }
    if (label.startsWith('drawing feature upsert')) {
      const feature = this.sentJson.at(-1)?.feature;
      this.drawingDoc.features[feature.id] = feature;
      if (!this.drawingDoc.featureOrder.includes(feature.id)) this.drawingDoc.featureOrder.push(feature.id);
      return { json: { type: 'drawing:feature:upserted', feature, revision: 1 } };
    }
    if (label.startsWith('drawing feature delete')) {
      const featureId = this.sentJson.at(-1)?.featureId;
      return { json: { type: 'drawing:feature:deleted', featureId, revision: 2 } };
    }
    throw new Error(`Unexpected waitFor: ${label}`);
  }
}

describe('agent-room CLI package', () => {
  it('builds PartyServer WebSocket URLs from config', () => {
    const config = createConfig({
      host: 'https://example.com/app/',
      room: 'trip-room',
      party: 'map-collaboration',
      clientId: 'agent-a',
      agentName: 'Planner',
      agentColor: '#2563eb',
    });

    expect(buildSocketUrl(config)).toBe(
      'wss://example.com/app/parties/map-collaboration/trip-room?_pk=agent-a&userId=agent-a&name=Planner&color=%232563eb&clientType=agent',
    );
  });

  it('can query live peers and recent agents from the room snapshot', async () => {
    const client = new FakeRoomClient();

    const snapshot = await executeCommand(client, { subject: 'snapshot' });
    const presence = await executeCommand(client, { subject: 'presence', action: 'list' });

    expect(snapshot.result.presence.agents[0]).toMatchObject({ id: 'agent-a', active: true });
    expect(presence.result.agents[0]).toMatchObject({ id: 'agent-a', lastAction: 'connect' });
    expect(presence.result.peers).toEqual([]);
  });

  it('builds overlay assets with manifest metadata and compressed content', () => {
    const asset = buildOverlayAssetFromText(
      'route.geojson',
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Walk' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [121.5, 31.2],
                [121.51, 31.21],
              ],
            },
          },
        ],
      }),
      { id: 'route-layer', name: 'Route layer', color: '#ef4444' },
      NOW,
    );

    expect(asset.manifest).toMatchObject({
      id: 'route-layer',
      type: 'geojson',
      name: 'Route layer',
      color: '#ef4444',
      bounds: [
        [121.5, 31.2],
        [121.51, 31.21],
      ],
      lines: 1,
      features: 1,
      contentEncoding: 'gzip',
      syncVersion: 1,
    });
    expect(asset.content.byteLength).toBeGreaterThan(0);
  });

  it('builds point annotations from command options', () => {
    const feature = buildFeatureFromParts({
      options: {
        id: 'stop-a',
        label: 'Station',
        lng: 121.5,
        lat: 31.2,
      },
      config: { agentName: 'Planner' },
      typeHint: 'point',
      now: NOW,
    });

    expect(feature).toMatchObject({
      id: 'stop-a',
      type: 'point',
      label: 'Station',
      updatedBy: 'Planner',
      coordinate: [121.5, 31.2],
    });
  });

  it('sends overlay upload protocol messages for layer upsert', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-room-cli-'));
    const file = join(dir, 'route.geojson');
    await writeFile(
      file,
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Walk' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [121.5, 31.2],
                [121.51, 31.21],
              ],
            },
          },
        ],
      }),
    );

    const client = new FakeRoomClient();
    let response;
    try {
      response = await executeCommand(client, {
        subject: 'layers',
        action: 'add',
        file,
        id: 'route-layer',
        name: 'Route layer',
        type: 'geojson',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    expect(client.sentBinary).toHaveLength(1);
    expect(client.sentJson).toHaveLength(1);
    expect(client.sentJson[0]).toMatchObject({
      type: 'overlay:upsert',
      manifest: { id: 'route-layer', name: 'Route layer' },
    });
    expect(response.result.overlay.id).toBe('route-layer');
  });

  it('sends drawing upsert and delete protocol messages for annotations', async () => {
    const client = new FakeRoomClient();
    const upsert = await executeCommand(client, {
      subject: 'annotations',
      action: 'add',
      featureType: 'point',
      type: 'point',
      id: 'stop-a',
      lng: 121.5,
      lat: 31.2,
      label: 'Station',
    });
    const deleted = await executeCommand(client, {
      subject: 'annotations',
      action: 'delete',
      id: 'stop-a',
    });

    expect(client.sentJson[0]).toMatchObject({
      type: 'drawing:feature:upsert',
      feature: { id: 'stop-a', type: 'point' },
    });
    expect(client.sentJson[1]).toEqual({ type: 'drawing:feature:delete', featureId: 'stop-a' });
    expect(upsert.result.annotation.id).toBe('stop-a');
    expect(deleted.result.annotationId).toBe('stop-a');
  });
});
