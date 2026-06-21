import type { Connection } from 'partyserver';
import { sanitizeAnnotationFeature, type AnnotationFeature } from '../layer-model.js';
import { parseAnnotationFeatureClientMessage } from '../layer-sync.js';
import { encodeMessage, stableJson } from './json-utils.js';
import type { RoomMessageContext, MessageHandlerResult } from './room-message-types.js';
import type { PeerState } from './room-types.js';

function featurePayloadContent(value: AnnotationFeature['payload']) {
  const { ...content } = value;
  return content;
}

function featureContentEquals(a: AnnotationFeature, b: AnnotationFeature) {
  return (
    a.layerId === b.layerId &&
    a.featureType === b.featureType &&
    a.sortKey === b.sortKey &&
    a.updatedBy === b.updatedBy &&
    stableJson(featurePayloadContent(a.payload)) === stableJson(featurePayloadContent(b.payload))
  );
}

export async function handleAnnotationFeatureMessage(
  room: RoomMessageContext,
  connection: Connection<PeerState>,
  payload: Record<string, unknown>,
): Promise<MessageHandlerResult> {
  const annotationMessage = parseAnnotationFeatureClientMessage(payload);
  if (!annotationMessage) return 'unhandled';
  if (annotationMessage.type === 'annotation-feature:list:request') {
    connection.send(
      encodeMessage({
        type: 'annotation-feature:list',
        layerId: annotationMessage.layerId,
        features: room._listAnnotationFeatures(annotationMessage.layerId),
      }),
    );
    return 'handled';
  }
  if (annotationMessage.type === 'annotation-feature:upsert') {
    if (!room._canEdit(connection)) {
      connection.send(encodeMessage({ type: 'permission:denied', action: 'annotation-feature:upsert' }));
      return 'handled';
    }
    const parent = room._getLayer(annotationMessage.feature.layerId);
    if (!parent) {
      connection.send(
        encodeMessage({
          type: 'annotation-feature:rejected',
          featureId: annotationMessage.feature.id,
          layerId: annotationMessage.feature.layerId,
          reason: 'missing-layer',
        }),
      );
      return 'handled';
    }
    if (parent.kind !== 'annotation') {
      connection.send(
        encodeMessage({
          type: 'annotation-feature:rejected',
          featureId: annotationMessage.feature.id,
          layerId: annotationMessage.feature.layerId,
          layerKind: parent.kind,
          reason: 'wrong-layer-kind',
        }),
      );
      return 'handled';
    }
    const existing = room._getAnnotationFeature(annotationMessage.feature.id);
    const feature = sanitizeAnnotationFeature(
      {
        ...annotationMessage.feature,
        revision: Number(existing?.revision || 0) + 1,
        createdAt: Number(existing?.createdAt || annotationMessage.feature.createdAt),
        updatedAt: Date.now(),
      },
      Date.now(),
    );
    if (!feature) {
      connection.send(
        encodeMessage({
          type: 'annotation-feature:rejected',
          featureId: annotationMessage.feature.id,
          layerId: annotationMessage.feature.layerId,
          reason: 'invalid-feature',
        }),
      );
      return 'handled';
    }
    if (existing && featureContentEquals(existing, feature)) {
      connection.send(encodeMessage({ type: 'annotation-feature:upserted', feature: existing }));
      return 'handled';
    }
    if (
      existing &&
      Number(annotationMessage.feature.revision || 0) > 0 &&
      annotationMessage.feature.revision <= existing.revision
    ) {
      connection.send(encodeMessage({ type: 'annotation-feature:upserted', feature: existing }));
      return 'handled';
    }
    room._upsertAnnotationFeatureRow(feature);
    connection.send(encodeMessage({ type: 'annotation-feature:upserted', feature }));
    room.broadcast(encodeMessage({ type: 'annotation-feature:upserted', feature }), [connection.id]);
    return 'handled';
  }
  if (annotationMessage.type === 'annotation-feature:delete') {
    if (!room._canEdit(connection)) {
      connection.send(encodeMessage({ type: 'permission:denied', action: 'annotation-feature:delete' }));
      return 'handled';
    }
    void room.sql`DELETE FROM annotation_features WHERE feature_id = ${annotationMessage.featureId}`;
    connection.send(encodeMessage({ type: 'annotation-feature:deleted', featureId: annotationMessage.featureId }));
    room.broadcast(encodeMessage({ type: 'annotation-feature:deleted', featureId: annotationMessage.featureId }), [
      connection.id,
    ]);
    return 'handled';
  }
  if (annotationMessage.type === 'annotation-feature:reorder') {
    if (!room._canEdit(connection)) {
      connection.send(encodeMessage({ type: 'permission:denied', action: 'annotation-feature:reorder' }));
      return 'handled';
    }
    for (const update of annotationMessage.updates) {
      void room.sql`
        UPDATE annotation_features
        SET sort_key = ${update.sortKey}, revision = revision + 1, updated_at = ${Date.now()}
        WHERE feature_id = ${update.featureId}
      `;
    }
    const features = room._listAnnotationFeatures();
    connection.send(encodeMessage({ type: 'annotation-feature:reordered', features }));
    room.broadcast(encodeMessage({ type: 'annotation-feature:reordered', features }), [connection.id]);
    return 'handled';
  }
  return 'handled';
}
