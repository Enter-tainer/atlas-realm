// Draws railway lines in the color of their route instead of the style's usage
// colors, and stations as metro-map dots in their line's color.
//
// Both colors come from the archive: every line segment carries `line_color`
// (the color of its line by length-weighted majority of its routes, else the
// first color set among its own routes), and every station carries
// `station_color` and `station_kind` (`line`, `interchange`, `plain` or
// `inactive`). The archive works them out because MapLibre copies a layer's
// data-driven paint expression into every tile result its workers send: reading
// a station's first 16 route colors here meant some 650k expression nodes per
// paint property, which cost up to 350 ms per railway tile on the main thread.
//
// The rewrite happens once at load time on the style: each line fill's
// `line-color` and each direction arrow's `icon-color` gets a `case` that picks
// the line color and otherwise keeps the expression the style shipped with,
// hover included.

type Expression = unknown;

type StyleLayerLike = {
  id?: string;
  type?: string;
  paint?: Record<string, Expression>;
  layout?: Record<string, Expression>;
};

const IS_HOVERED: Expression = ['boolean', ['feature-state', 'hover'], false];
const HOVER_COLOR = '#ff0000';
const ALTERNATIVE_HOVER_COLOR = '#ffc107';
const UNPARSEABLE_COLOR = '#b8b8b8';

const IS_LIGHT_THEME: Expression = ['==', ['global-state', 'theme'], 'light'];
const INTERCHANGE_RING: Expression = ['case', IS_LIGHT_THEME, '#334155', '#cbd5e1'];
const INTERCHANGE_FILL: Expression = ['case', IS_LIGHT_THEME, '#ffffff', '#1e293b'];
const PLAIN_STATION: Expression = ['case', IS_LIGHT_THEME, '#3f3f46', '#d4d4d8'];
const INACTIVE_STATION: Expression = ['case', IS_LIGHT_THEME, '#a1a1aa', '#71717a'];

// A segment's line color, `''` when the archive has none (segments outside a
// colored line), which keeps the original color.
const LINE_COLOR: Expression = ['case', ['has', 'line_color'], ['to-string', ['get', 'line_color']], ''];

// Hovered route-colored lines glow red, and red ones amber so the feedback stays
// visible.
const ROUTE_HOVER_COLOR: Expression = [
  'let',
  'routeRgba',
  ['to-rgba', ['to-color', ['var', 'routeColor'], UNPARSEABLE_COLOR]],
  [
    'case',
    [
      'all',
      ['>=', ['at', 0, ['var', 'routeRgba']], 150],
      ['<', ['at', 1, ['var', 'routeRgba']], 110],
      ['<', ['at', 2, ['var', 'routeRgba']], 110],
    ],
    ALTERNATIVE_HOVER_COLOR,
    HOVER_COLOR,
  ],
];

function withRouteColor(original: Expression): Expression {
  return [
    'let',
    'routeColor',
    LINE_COLOR,
    [
      'case',
      ['==', ['var', 'routeColor'], ''],
      original,
      IS_HOVERED,
      ROUTE_HOVER_COLOR,
      // A color the renderer cannot parse keeps the original color.
      ['to-color', ['var', 'routeColor'], original],
    ],
  ];
}

// Fills of lines in use. Abandoned, razed and disused tracks keep their muted
// colors, and ferries their own.
const RECOLORED_FILL = /^railway_line_.*_fill_(present|construction|proposed|preserved)$/;
const RECOLORED_ARROWS = /^railway_line_.*_preferred_direction$/;

export function withRouteLineColors<T extends StyleLayerLike>(layer: T): T {
  const id = layer.id || '';
  const property = RECOLORED_FILL.test(id) ? 'line-color' : RECOLORED_ARROWS.test(id) ? 'icon-color' : null;
  const original = property ? layer.paint?.[property] : undefined;
  if (!property || original === undefined) return layer;
  return { ...layer, paint: { ...layer.paint, [property]: withRouteColor(original) } };
}

// Station icons follow the lines, as on a metro map: a dot in the line's color
// for a station on one line, a white dot ringed in dark gray where lines of
// different colors meet, light gray for stations out of use and dark gray for
// stations without a colored route.
const STATION_ICON_LAYERS = new Set([
  'railway_text_stations_low1',
  'railway_text_stations_low2',
  'railway_text_stations_med',
  'railway_text_stations',
]);
const STATION_KIND: Expression = ['to-string', ['coalesce', ['get', 'station_kind'], 'plain']];

const ZOOM_CURVES = ['interpolate', 'interpolate-hcl', 'interpolate-lab', 'step'];

function isZoomCurve(value: Expression): value is unknown[] {
  return (
    Array.isArray(value) &&
    ZOOM_CURVES.includes(value[0] as string) &&
    JSON.stringify(value[value[0] === 'step' ? 1 : 2]) === '["zoom"]'
  );
}

// MapLibre only allows a zoom curve at the top of an expression, so curves are
// rewritten stop by stop when an output has to change shape.
function mapZoomOutputs(value: Expression, wrap: (output: Expression) => Expression): Expression {
  if (value === undefined || value === null) return value;
  if (isZoomCurve(value)) {
    const firstOutput = value[0] === 'step' ? 2 : 4;
    return value.map((item, index) =>
      index >= firstOutput && (index - firstOutput) % 2 === 0 ? mapZoomOutputs(item, wrap) : item,
    );
  }
  return wrap(value);
}

export function withRouteStationColors<T extends StyleLayerLike>(layer: T): T {
  if (!STATION_ICON_LAYERS.has(layer.id || '')) return layer;
  const paint: Record<string, Expression> = { ...layer.paint };
  const layout: Record<string, Expression> = { ...(layer.layout as Record<string, Expression>) };
  paint['icon-color'] = [
    'match',
    STATION_KIND,
    'line',
    ['to-color', ['to-string', ['coalesce', ['get', 'station_color'], '']], PLAIN_STATION],
    'interchange',
    INTERCHANGE_FILL,
    'inactive',
    INACTIVE_STATION,
    PLAIN_STATION,
  ];
  if (paint['icon-halo-color'] !== undefined) {
    paint['icon-halo-color'] = mapZoomOutputs(paint['icon-halo-color'], (original) => [
      'case',
      ['all', ['==', STATION_KIND, 'interchange'], ['!', IS_HOVERED]],
      INTERCHANGE_RING,
      original,
    ]);
  }
  // One icon shape; the size carries the difference, so a station keeps its
  // glyph across zoom steps.
  layout['icon-image'] = 'sdf:general/station-normal';
  const size = layout['icon-size'] ?? 1;
  layout['icon-size'] = mapZoomOutputs(size, (original) => [
    'case',
    ['==', ['get', 'station_size'], 'large'],
    ['*', original, 1.3],
    original,
  ]);
  return { ...layer, paint, layout };
}

export function applyRouteColors<T extends { layers?: StyleLayerLike[] }>(style: T): T {
  return { ...style, layers: style.layers?.map((layer) => withRouteStationColors(withRouteLineColors(layer))) };
}
