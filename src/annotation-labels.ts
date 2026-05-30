import type { AnnotationFeaturePayload, AnnotationFeatureType, AnnotationRouteProfile } from './annotation-model.js';

type AnnotationLabelOptions = {
  profile?: AnnotationRouteProfile;
  distanceText?: string;
  durationText?: string;
  fromName?: string;
  toName?: string;
};

function normalizeLabelPart(value: unknown, maxLength = 48) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function routeProfileLabel(profile: AnnotationRouteProfile | undefined) {
  if (profile === 'walking') return 'Walking';
  if (profile === 'cycling') return 'Cycling';
  return 'Driving';
}

export function nextAnnotationFeatureNumber(
  features: readonly AnnotationFeaturePayload[],
  type: AnnotationFeatureType,
) {
  return features.filter((feature) => feature.type === type).length + 1;
}

export function defaultAnnotationFeatureLabel(
  features: readonly AnnotationFeaturePayload[],
  type: AnnotationFeatureType,
  options: AnnotationLabelOptions = {},
) {
  const number = nextAnnotationFeatureNumber(features, type);
  if (type === 'point') return `Marker ${number}`;
  if (type === 'text') return `Note ${number}`;
  if (type === 'path') return `Line ${number}`;
  if (type === 'polygon') return `Area ${number}`;

  const fromName = normalizeLabelPart(options.fromName);
  const toName = normalizeLabelPart(options.toName);
  const hasNamedEndpoints = fromName && toName && fromName !== toName;
  const base = hasNamedEndpoints ? `${fromName} to ${toName}` : `${routeProfileLabel(options.profile)} route ${number}`;
  return [base, normalizeLabelPart(options.distanceText, 24), normalizeLabelPart(options.durationText, 24)]
    .filter(Boolean)
    .join(' - ')
    .slice(0, 120);
}
