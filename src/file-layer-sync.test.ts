import { describe, expect, it, vi } from 'vitest';
import {
  FILE_LAYER_SYNC_MAX_COMPRESSED_BYTES,
  buildFileLayerSyncAsset,
  decodeFileContentMessage,
  encodeFileContentMessage,
  materializeFileLayerContent,
  fileLayerManifestPatch,
} from './file-layer-sync.js';

const GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'A' },
      geometry: { type: 'Point', coordinates: [121.5, 31.2] },
    },
  ],
};

describe('file layer sync protocol', () => {
  it('builds and materializes a GeoJSON file layer asset', async () => {
    const asset = await buildFileLayerSyncAsset({
      id: 'local-file-layer',
      syncLayerId: 'shared-file-layer',
      type: 'geojson',
      name: '  Shared   GeoJSON  ',
      visible: true,
      color: '#ef4444',
      opacity: 0.8,
      lineWidth: 4,
      bounds: [
        [121.5, 31.2],
        [121.5, 31.2],
      ],
      layerIds: ['runtime-layer'],
      sourceId: 'runtime-source',
      rawText: 'not-used-for-geojson',
      data: GEOJSON,
    });

    expect(asset.envelope.id).toBe('shared-file-layer');
    expect(asset.envelope.manifest).toMatchObject({
      id: 'shared-file-layer',
      type: 'geojson',
      name: 'Shared GeoJSON',
      visible: true,
      color: '#ef4444',
      contentType: 'application/geo+json',
      syncVersion: 1,
      persistence: 'ephemeral',
    });
    expect(asset.envelope.manifest.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(asset.envelope.manifest.contentByteLength).toBe(asset.content.byteLength);
    expect(asset.envelope.manifest.rawByteLength).toBe(JSON.stringify(GEOJSON).length);
    expect(asset.envelope.manifest).not.toHaveProperty('layerIds');
    expect(asset.envelope.manifest).not.toHaveProperty('sourceId');
    expect(asset.envelope.manifest).not.toHaveProperty('data');
    expect(asset.envelope.manifest).not.toHaveProperty('rawText');

    await expect(materializeFileLayerContent(asset.envelope.manifest, asset.content)).resolves.toEqual(GEOJSON);
  });

  it('uses the original GPX text as synchronized content', async () => {
    const rawText = '<gpx><wpt lat="31.2" lon="121.5"><name>A</name></wpt></gpx>';
    const asset = await buildFileLayerSyncAsset({
      id: 'gpx-1',
      type: 'gpx',
      name: 'Track',
      data: { type: 'FeatureCollection', features: [] },
      rawText,
    });

    expect(asset.envelope.manifest).toMatchObject({
      id: 'gpx-1',
      type: 'gpx',
      contentType: 'application/gpx+xml',
    });
    await expect(materializeFileLayerContent(asset.envelope.manifest, asset.content)).resolves.toBe(rawText);
  });

  it('round-trips file layer binary content frames', () => {
    const contentHash = 'a'.repeat(64);
    const content = new Uint8Array([1, 2, 3, 255]);
    const encoded = encodeFileContentMessage(contentHash, content);

    expect(decodeFileContentMessage(encoded)).toEqual({ contentHash, content });
    expect(decodeFileContentMessage(encoded.buffer)).toEqual({ contentHash, content });
    expect(decodeFileContentMessage(new DataView(encoded.buffer))).toEqual({ contentHash, content });
  });

  it('rejects malformed binary frames', () => {
    expect(decodeFileContentMessage('not-binary')).toBeNull();
    expect(decodeFileContentMessage(new Uint8Array())).toBeNull();
    expect(decodeFileContentMessage(new Uint8Array([2, 0]))).toBeNull();
    expect(decodeFileContentMessage(new Uint8Array([1, 4, 97]))).toBeNull();
  });

  it('enforces the compressed sync size limit', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    try {
      await expect(
        buildFileLayerSyncAsset({
          id: 'too-large',
          type: 'geojson',
          name: 'Too large',
          data: {
            type: 'FeatureCollection',
            features: [],
            payload: 'x'.repeat(FILE_LAYER_SYNC_MAX_COMPRESSED_BYTES + 1),
          },
        }),
      ).rejects.toThrow('File layer is too large to sync');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('strips runtime-only fields from manifest patches', () => {
    expect(
      fileLayerManifestPatch({
        id: 'local-id',
        remoteLayerId: 'remote-id',
        syncLayerId: 'sync-id',
        type: 'geojson',
        name: '  ',
        visible: false,
        layerIds: ['layer'],
        sourceId: 'source',
        data: GEOJSON,
        rawText: '{}',
      }),
    ).toEqual({
      id: 'sync-id',
      type: 'geojson',
      name: 'sync-id',
      visible: false,
    });
  });
});
