import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildFeatureFromParts } from '../src/annotation-feature.js';
import { buildFileLayerAssetFromText } from '../src/file-layer-asset.js';
import { buildSocketUrl, createConfig } from '../src/config.js';
import { executeCommand } from '../src/commands.js';

const NOW = 1_700_000_000_000;

class FakeRoomClient {
  constructor() {
    this.config = { room: 'test-room', agentName: 'Agent', timeoutMs: 1000 };
    this.layers = [
      {
        id: 'annotation-default',
        kind: 'annotation',
        name: 'Annotations',
        visible: true,
        sortKey: '000010',
        payload: { version: 1 },
        revision: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    this.annotationFeatures = [];
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
    this.sentJson = [];
    this.sentBinary = [];
  }

  sendJson(message) {
    this.sentJson.push(message);
  }

  sendBinary(bytes) {
    this.sentBinary.push(bytes);
  }

  async waitFor(_predicate, label) {
    if (label.startsWith('file content store')) {
      const contentHash = label.split(' ').at(-1);
      return { json: { type: 'file:content:stored', contentHash } };
    }
    if (label.startsWith('layer create')) {
      const layer = this.sentJson.at(-1)?.layer;
      this.upsertLayer(layer);
      return { json: { type: 'layer:created', layer } };
    }
    if (label.startsWith('layer update') || label.startsWith('annotation layer update')) {
      const message = this.sentJson.at(-1);
      const layer = this.layers.find((item) => item.id === message.layerId);
      const next = { ...layer, ...message.patch, updatedAt: NOW + 1 };
      if (message.patch?.payload?.style && next.payload?.style) {
        next.payload = { ...next.payload, style: { ...next.payload.style, ...message.patch.payload.style } };
      }
      this.upsertLayer(next);
      return { json: { type: 'layer:updated', layer: next } };
    }
    if (label.startsWith('layer delete') || label.startsWith('annotation layer delete')) {
      const layerId = this.sentJson.at(-1)?.layerId;
      this.layers = this.layers.filter((layer) => layer.id !== layerId);
      return { json: { type: 'layer:deleted', layerId } };
    }
    if (label === 'layer reorder' || label === 'annotation layer reorder') {
      for (const update of this.sentJson.at(-1)?.updates || []) {
        const layer = this.layers.find((item) => item.id === update.layerId);
        if (layer) layer.sortKey = update.sortKey;
      }
      this.layers.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      return { json: { type: 'layer:reordered', layers: this.layers } };
    }
    if (label.startsWith('annotation feature upsert') || label.startsWith('annotation feature update')) {
      const feature = this.sentJson.at(-1)?.feature;
      const index = this.annotationFeatures.findIndex((item) => item.id === feature.id);
      if (index === -1) this.annotationFeatures.push(feature);
      else this.annotationFeatures[index] = feature;
      return { json: { type: 'annotation-feature:upserted', feature } };
    }
    if (label.startsWith('annotation feature delete')) {
      const featureId = this.sentJson.at(-1)?.featureId;
      return { json: { type: 'annotation-feature:deleted', featureId } };
    }
    if (label === 'annotation feature reorder') {
      for (const update of this.sentJson.at(-1)?.updates || []) {
        const feature = this.annotationFeatures.find((item) => item.id === update.featureId);
        if (feature) feature.sortKey = update.sortKey;
      }
      this.annotationFeatures.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      return { json: { type: 'annotation-feature:reordered', features: this.annotationFeatures } };
    }
    throw new Error(`Unexpected waitFor: ${label}`);
  }

  upsertLayer(layer) {
    const index = this.layers.findIndex((item) => item.id === layer.id);
    if (index === -1) this.layers.push(layer);
    else this.layers[index] = layer;
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
    expect(snapshot.result.layers[0]).toMatchObject({ id: 'annotation-default', kind: 'annotation' });
    expect(presence.result.agents[0]).toMatchObject({ id: 'agent-a', lastAction: 'connect' });
    expect(presence.result.peers).toEqual([]);
  });

  it('builds file layer assets with metadata and compressed content', () => {
    const asset = buildFileLayerAssetFromText(
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

  it('builds point annotation payloads from command options', () => {
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

  it('sends file content upload followed by layer:create for file layers', async () => {
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
      type: 'layer:create',
      layer: {
        id: 'route-layer',
        kind: 'file',
        name: 'Route layer',
        payload: { fileType: 'geojson' },
      },
    });
    expect(response.result.layer.id).toBe('route-layer');
  });

  it('sends annotation-feature upsert and delete protocol messages for annotations', async () => {
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
      type: 'annotation-feature:upsert',
      feature: { id: 'stop-a', featureType: 'point', payload: { type: 'point' } },
    });
    expect(client.sentJson[1]).toEqual({ type: 'annotation-feature:delete', featureId: 'stop-a' });
    expect(upsert.result.annotation.id).toBe('stop-a');
    expect(deleted.result.annotationId).toBe('stop-a');
  });

  it('sends layer:reorder messages for annotation layers', async () => {
    const client = new FakeRoomClient();
    client.layers.push({
      id: 'custom-layer',
      kind: 'annotation',
      name: 'Custom layer',
      visible: true,
      sortKey: '000020',
      payload: { version: 1 },
      revision: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const response = await executeCommand(client, {
      subject: 'annotations',
      action: 'layers',
      layerAction: 'reorder',
      ids: ['custom-layer', 'annotation-default'],
    });

    expect(client.sentJson[0]).toEqual({
      type: 'layer:reorder',
      updates: [
        { layerId: 'custom-layer', sortKey: '000010' },
        { layerId: 'annotation-default', sortKey: '000020' },
      ],
    });
    expect(response.result.orderedIds).toEqual(['custom-layer', 'annotation-default']);
  });
});
