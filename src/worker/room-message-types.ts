import type { Connection } from 'partyserver';
import type { AnnotationFeature, Layer } from '../layer-model.js';
import type { PeerState, RoomPersistence } from './room-types.js';

export type SqlValue = string | number | boolean | null | ArrayBuffer;

export interface RoomMessageContext {
  ctx: {
    storage: DurableObjectStorage;
  };
  sql<T extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: SqlValue[]
  ): T[];
  broadcast(message: string | ArrayBuffer | ArrayBufferView, exclude?: string[]): void;
  _canEdit(connection: Connection<PeerState>): boolean;
  _canManage(connection: Connection<PeerState>): boolean;
  _roomStatus(): Record<string, unknown>;
  _setRoomPersistence(persistence: RoomPersistence): Promise<Record<string, unknown>>;
  _listLayers(): Layer[];
  _getLayer(layerId: string): Layer | null;
  _upsertLayerRow(layer: Layer): void;
  _pruneUnreferencedFileContent(options?: { immediate?: boolean }): void;
  _listAnnotationFeatures(layerId?: string): AnnotationFeature[];
  _getAnnotationFeature(featureId: string): AnnotationFeature | null;
  _upsertAnnotationFeatureRow(feature: AnnotationFeature): void;
  _getFileContent(contentHash: string): ArrayBuffer | null;
  _touchAgentParticipant(user: NonNullable<PeerState['user']>, action?: string): unknown;
}

export type MessageHandlerResult = 'handled' | 'unhandled';
