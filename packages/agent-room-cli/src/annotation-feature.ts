import { readFile } from 'node:fs/promises';
import { coordinateFromOptions, listFromOptions } from './coordinates.js';
import { coerceBoolean, coerceNumber, normalizeColor, normalizeId, parseJson, randomId } from './validation.js';
import type { AgentRoomConfig, AnnotationFeaturePayload, JsonRecord } from './types.js';

export async function buildFeatureFromOptions(
  options: JsonRecord = {},
  config: Partial<AgentRoomConfig> = {},
  typeHint?: string,
  existing: JsonRecord | null = null,
  now = Date.now(),
): Promise<AnnotationFeaturePayload> {
  const fullFeature = await readJsonOption(options.featureFile, options.featureJson, 'feature');
  const patch = await readJsonOption(options.patchFile, options.patchJson, 'patch');
  return buildFeatureFromParts({ options, config, typeHint, existing, fullFeature, patch, now });
}

export function buildFeatureFromParts({
  options = {},
  config = {},
  typeHint,
  existing = null,
  fullFeature,
  patch,
  now,
}: {
  options?: JsonRecord;
  config?: Partial<AgentRoomConfig>;
  typeHint?: string;
  existing?: JsonRecord | null;
  fullFeature?: JsonRecord | null;
  patch?: JsonRecord | null;
  now: number;
}): AnnotationFeaturePayload {
  const seed = {
    ...(existing || {}),
    ...(patch || {}),
    ...(fullFeature || {}),
  } as JsonRecord;
  const type = options.type || typeHint || seed.type || 'point';
  const id = normalizeId(options.id, seed.id || randomId('annotation'));
  const layerId = normalizeId(options.layerId, seed.layerId || 'annotation-default');
  const feature: AnnotationFeaturePayload = {
    ...seed,
    id,
    layerId,
    type,
    label: options.label !== undefined ? String(options.label) : seed.label || seed.name || '',
    note: options.note !== undefined ? String(options.note) : seed.note || seed.description || '',
    color: normalizeColor(options.color, seed.color || '#2563eb'),
    createdAt: Number.isFinite(Number(seed.createdAt)) ? Number(seed.createdAt) : now,
    updatedAt: now,
    updatedBy: options.updatedBy || config.agentName || 'Agent',
  };

  if (type === 'point' || type === 'text') {
    feature.coordinate = coordinateFromOptions(options, seed.coordinate);
    if (!feature.coordinate) throw new Error(`${type} annotations require --lng/--lat or --coordinate`);
    if (type === 'text') {
      feature.width = coerceNumber(options.width, seed.width || 154);
      feature.height = coerceNumber(options.height, seed.height || 64);
    }
  } else if (type === 'path') {
    feature.points = listFromOptions(options, 'points', seed.points);
    if (!Array.isArray(feature.points) || feature.points.length < 2) {
      throw new Error('path annotations require at least two --points');
    }
    feature.directed = coerceBoolean(options.directed, seed.directed !== false);
    feature.width = coerceNumber(options.width, seed.width || 4);
  } else if (type === 'polygon') {
    feature.points = listFromOptions(options, 'points', seed.points);
    if (!Array.isArray(feature.points) || feature.points.length < 3) {
      throw new Error('polygon annotations require at least three --points');
    }
    feature.width = coerceNumber(options.width, seed.width || 3);
    feature.fillOpacity = coerceNumber(options.fillOpacity, seed.fillOpacity ?? seed.fill_opacity ?? 0.22);
  } else if (type === 'route') {
    feature.waypoints = listFromOptions(options, 'waypoints', seed.waypoints);
    if (!Array.isArray(feature.waypoints) || feature.waypoints.length < 2) {
      throw new Error('route annotations require at least two --waypoints');
    }
    feature.geometry = listFromOptions(options, 'geometry', seed.geometry || feature.waypoints);
    feature.profile = ['walking', 'cycling', 'driving'].includes(String(options.profile))
      ? options.profile
      : seed.profile || 'driving';
    feature.directed = coerceBoolean(options.directed, seed.directed !== false);
    feature.width = coerceNumber(options.width, seed.width || 5);
    feature.distance = coerceNumber(options.distance, seed.distance ?? null);
    feature.duration = coerceNumber(options.duration, seed.duration ?? null);
    feature.distanceText = options.distanceText || seed.distanceText || seed.distance_text || '';
    feature.durationText = options.durationText || seed.durationText || seed.duration_text || '';
  } else {
    throw new Error(`Unsupported annotation type: ${type}`);
  }

  return feature;
}

async function readJsonOption(file: unknown, json: unknown, label: string): Promise<JsonRecord | null> {
  if (file) return parseJson(await readFile(String(file), 'utf8'), `${label}-file`);
  if (json) return parseJson(String(json), `${label}-json`);
  return null;
}
