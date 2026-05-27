import type { DrawingDoc, DrawingFeature, DrawingLayer } from './types.js';

export function drawingFeatures(doc: DrawingDoc | null): DrawingFeature[] {
  const features = doc?.features && typeof doc.features === 'object' ? doc.features : {};
  const order = Array.isArray(doc?.featureOrder) ? doc.featureOrder : Object.keys(features);
  return order.map((id: string) => features[id]).filter(Boolean);
}

export function drawingLayers(doc: DrawingDoc | null): DrawingLayer[] {
  const layers = doc?.layers && typeof doc.layers === 'object' ? doc.layers : {};
  const order = Array.isArray(doc?.layerOrder) ? doc.layerOrder : Object.keys(layers);
  return order.map((id: string) => layers[id]).filter(Boolean);
}

export function getDrawingFeature(doc: DrawingDoc | null, id: string): DrawingFeature | null {
  return doc?.features && typeof doc.features === 'object' ? doc.features[id] || null : null;
}

export function getDrawingLayer(doc: DrawingDoc | null, id: string): DrawingLayer | null {
  return doc?.layers && typeof doc.layers === 'object' ? doc.layers[id] || null : null;
}
