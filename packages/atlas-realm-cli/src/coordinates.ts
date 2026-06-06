import { parseJson } from './validation.js';
import type { JsonRecord, LngLatTuple } from './types.js';

export function parseCoordinate(value: unknown, label = 'coordinate'): LngLatTuple {
  if (Array.isArray(value)) {
    const lng = Number(value[0]);
    const lat = Number(value[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
  }
  const text = String(value || '').trim();
  if (text.startsWith('[')) return parseCoordinate(parseJson(text, label), label);
  const parts = text.split(',').map((part: string) => Number(part.trim()));
  if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) return [parts[0], parts[1]];
  throw new Error(`Invalid ${label}; expected [lng,lat] or "lng,lat"`);
}

export function parseCoordinateList(value: unknown, label: string): LngLatTuple[] | null {
  if (Array.isArray(value)) {
    const coords = value.map((item: unknown) => parseCoordinate(item, label));
    if (coords.length > 0) return coords;
  }
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.startsWith('[')) return parseCoordinateList(parseJson(text, label), label);
  return text
    .split(';')
    .map((pair: string) => pair.trim())
    .filter(Boolean)
    .map((pair: string) => parseCoordinate(pair, label));
}

export function coordinateFromOptions(options: JsonRecord, fallback: LngLatTuple | null = null): LngLatTuple | null {
  if (options.coordinate !== undefined) return parseCoordinate(options.coordinate, 'coordinate');
  if (options.lng !== undefined || options.lat !== undefined) {
    const lng = Number(options.lng);
    const lat = Number(options.lat);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
    throw new Error('Both --lng and --lat are required for a coordinate');
  }
  return fallback;
}

export function listFromOptions(
  options: JsonRecord,
  key: string,
  fallback: LngLatTuple[] | null = null,
): LngLatTuple[] | null {
  if (options[key] === undefined) return fallback;
  return parseCoordinateList(options[key], key);
}
