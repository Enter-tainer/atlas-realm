import {
  DRAWING_DEFAULT_LAYER_ID,
  DRAWING_TEXT_DEFAULT_HEIGHT,
  DRAWING_TEXT_DEFAULT_WIDTH,
  createEmptyDrawingDoc,
} from './drawing-model.js';
import { reduceDrawingClientMessage } from './drawing-sync.js';
import type { DrawingClientMessage } from './drawing-sync.js';
import type {
  DrawingDoc,
  DrawingFeature,
  DrawingFeatureType,
  DrawingLayer,
  DrawingRouteProfile,
  LngLatTuple,
} from './drawing-model.js';

export const DRAWING_RANDOM_TEST_NOW = 1_700_010_000_000;

type RandomFn = () => number;

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2'] as const;
const FEATURE_TYPES: readonly DrawingFeatureType[] = ['point', 'text', 'path', 'polygon', 'route'];
const ROUTE_PROFILES: readonly DrawingRouteProfile[] = ['driving', 'walking', 'cycling'];
const USERS = ['alice', 'bob', 'carol', 'dave'] as const;

export function createSeededRandom(seed: number): RandomFn {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomInt(random: RandomFn, maxExclusive: number): number {
  return Math.floor(random() * maxExclusive);
}

function pick<T>(random: RandomFn, values: readonly T[]): T {
  return values[Math.min(values.length - 1, randomInt(random, values.length))];
}

function coordinate(random: RandomFn, step: number, offset = 0): LngLatTuple {
  const lng = 121.2 + ((step * 17 + offset * 11) % 70) * 0.01 + random() * 0.004;
  const lat = 30.9 + ((step * 13 + offset * 7) % 55) * 0.01 + random() * 0.004;
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

function linePoints(random: RandomFn, step: number, minLength: number, maxLength: number): LngLatTuple[] {
  const length = minLength + randomInt(random, maxLength - minLength + 1);
  const start = coordinate(random, step, 0);
  return Array.from({ length }, (_, index) => [
    Number((start[0] + index * (0.006 + random() * 0.004)).toFixed(6)),
    Number((start[1] + index * (0.003 + random() * 0.003)).toFixed(6)),
  ]);
}

function polygonPoints(random: RandomFn, step: number): LngLatTuple[] {
  const count = 3 + randomInt(random, 5);
  const center = coordinate(random, step, 2);
  const radius = 0.01 + random() * 0.025;
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + random() * 0.12;
    return [
      Number((center[0] + Math.cos(angle) * radius).toFixed(6)),
      Number((center[1] + Math.sin(angle) * radius).toFixed(6)),
    ];
  });
}

function shuffled<T>(random: RandomFn, values: readonly T[]): T[] {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(random, index + 1);
    const value = result[index];
    result[index] = result[swapIndex];
    result[swapIndex] = value;
  }
  return result;
}

function buildFeature(random: RandomFn, id: string, step: number): DrawingFeature {
  const type = pick(random, FEATURE_TYPES);
  const at = DRAWING_RANDOM_TEST_NOW + step;
  const base = {
    id,
    layerId: DRAWING_DEFAULT_LAYER_ID,
    label: `${type} ${id} ${step}`,
    note: random() < 0.55 ? `note ${step}` : '',
    color: pick(random, COLORS),
    createdAt: DRAWING_RANDOM_TEST_NOW + Math.max(0, step - 30),
    updatedAt: at,
    updatedBy: pick(random, USERS),
  };

  if (type === 'point') {
    return {
      ...base,
      type,
      coordinate: coordinate(random, step),
    };
  }
  if (type === 'text') {
    return {
      ...base,
      type,
      coordinate: coordinate(random, step),
      width: DRAWING_TEXT_DEFAULT_WIDTH + randomInt(random, 120),
      height: DRAWING_TEXT_DEFAULT_HEIGHT + randomInt(random, 80),
    };
  }
  if (type === 'path') {
    return {
      ...base,
      type,
      points: linePoints(random, step, 2, 9),
      directed: random() < 0.5,
      width: 1 + randomInt(random, 9),
    };
  }
  if (type === 'polygon') {
    return {
      ...base,
      type,
      points: polygonPoints(random, step),
      width: 1 + randomInt(random, 8),
      fillOpacity: Number((0.08 + random() * 0.52).toFixed(2)),
    };
  }

  const geometry = linePoints(random, step, 3, 12);
  const first = geometry[0];
  const last = geometry[geometry.length - 1];
  return {
    ...base,
    type,
    waypoints: [first, last],
    profile: pick(random, ROUTE_PROFILES),
    directed: random() < 0.7,
    width: 2 + randomInt(random, 8),
    geometry,
    distance: 500 + randomInt(random, 40_000),
    duration: 300 + randomInt(random, 9_000),
    distanceText: `${1 + randomInt(random, 80)} km`,
    durationText: `${5 + randomInt(random, 180)} min`,
  };
}

function layerPatchFromDoc(random: RandomFn, doc: DrawingDoc, step: number): DrawingLayer {
  const existing =
    doc.layers[DRAWING_DEFAULT_LAYER_ID] ||
    createEmptyDrawingDoc(DRAWING_RANDOM_TEST_NOW).layers[DRAWING_DEFAULT_LAYER_ID];
  return {
    ...existing,
    id: DRAWING_DEFAULT_LAYER_ID,
    name: `Shared plan ${step}-${randomInt(random, 1000)}`,
    visible: random() > 0.18,
    stackOrder: randomInt(random, 8),
    updatedAt: DRAWING_RANDOM_TEST_NOW + step,
  };
}

export function generateDrawingClientMessages(seed: number, count: number): DrawingClientMessage[] {
  const random = createSeededRandom(seed);
  const idPool = Array.from({ length: 32 }, (_, index) => `random-${index}`);
  const messages: DrawingClientMessage[] = [];
  let shadow = createEmptyDrawingDoc(DRAWING_RANDOM_TEST_NOW);

  for (let step = 0; step < count; step += 1) {
    const existingIds = shadow.featureOrder.slice();
    const roll = random();
    let message: DrawingClientMessage;

    if (roll < 0.56 || existingIds.length === 0) {
      const reuseExisting = existingIds.length > 0 && random() < 0.62;
      const id = reuseExisting ? pick(random, existingIds) : pick(random, idPool);
      message = {
        type: 'drawing:feature:upsert',
        feature: buildFeature(random, id, step),
      };
    } else if (roll < 0.72) {
      message = {
        type: 'drawing:feature:delete',
        featureId: pick(random, existingIds),
      };
    } else if (roll < 0.88) {
      const orderedIds = shuffled(random, existingIds);
      if (orderedIds.length > 0 && random() < 0.35) {
        orderedIds.splice(randomInt(random, orderedIds.length + 1), 0, `missing-${step}`);
      }
      message = {
        type: 'drawing:feature:reorder',
        orderedIds,
      };
    } else {
      message = {
        type: 'drawing:layer:upsert',
        layer: layerPatchFromDoc(random, shadow, step),
      };
    }

    messages.push(message);
    shadow = reduceDrawingClientMessage(shadow, message, DRAWING_RANDOM_TEST_NOW + step).doc;
  }

  return messages;
}

export function reduceDrawingClientMessages(messages: readonly DrawingClientMessage[]): DrawingDoc {
  let doc = createEmptyDrawingDoc(DRAWING_RANDOM_TEST_NOW);
  messages.forEach((message, index) => {
    doc = reduceDrawingClientMessage(doc, message, DRAWING_RANDOM_TEST_NOW + 10_000 + index).doc;
  });
  return doc;
}
