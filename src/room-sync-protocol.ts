export * from '../packages/atlas-realm-cli/src/sync-protocol.js';
// These are local UI intents, not accepted wire messages.
import {
  parseLayerClientMessage,
  parseAnnotationFeatureClientMessage,
  type LayerClientMessage,
  type AnnotationFeatureClientMessage,
} from './layer-sync.js';
export type RoomMutation = LayerClientMessage | AnnotationFeatureClientMessage;
export function parseRoomMutation(value: unknown): RoomMutation | null {
  return parseLayerClientMessage(value) || parseAnnotationFeatureClientMessage(value);
}
