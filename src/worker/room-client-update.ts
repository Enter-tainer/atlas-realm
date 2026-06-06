import type { Connection } from 'partyserver';
import { encodeMessage } from './json-utils.js';
import { sanitizePeerId } from './room-auth.js';
import {
  emptyLocation,
  publicPeer,
  sanitizeAction,
  sanitizeCursor,
  sanitizeLocation,
  sanitizeUser,
  sanitizeViewport,
  sanitizeViewState,
} from './room-presence.js';
import type { RoomMessageContext } from './room-message-types.js';
import type { PeerState } from './room-types.js';

export function handleClientUpdateMessage(
  room: RoomMessageContext,
  connection: Connection<PeerState>,
  payload: Record<string, unknown>,
): void {
  if (payload.type !== 'client:update') return;

  const previous = connection.state || {};
  if (previous.clientType === 'agent' && previous.user) {
    room._touchAgentParticipant(previous.user, sanitizeAction(payload.action, 'client:update'));
    return;
  }
  if (previous.clientType !== 'human' || previous.presenceVisible === false) return;

  const followingId = sanitizePeerId(payload.followingId);
  const next: PeerState = {
    ...previous,
    user: sanitizeUser(payload.user, previous.user),
    clientType: previous.clientType,
    presenceVisible: previous.presenceVisible,
    viewport: sanitizeViewport(payload.viewport) || previous.viewport || null,
    cursor: sanitizeCursor(payload.cursor),
    location: sanitizeLocation(payload.location, previous.location || emptyLocation()),
    followingId: followingId === connection.id ? null : followingId,
    viewState: sanitizeViewState(payload.viewState, previous.viewState || { terrain: false, satellite: false }),
    updatedAt: Date.now(),
  };

  connection.setState(next);

  room.broadcast(
    encodeMessage({
      type: 'presence:update',
      peer: publicPeer(connection),
    }),
    [connection.id],
  );
}
