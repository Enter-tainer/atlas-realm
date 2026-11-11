// Draws railway lines in the color of their route instead of the style's usage
// colors: a line takes the first color set among its first few `line_routes`,
// which the archive carries from zoom 7 (groups of `id\x1Ecolor\x1Elabel`
// joined by `\x1D`, sorted by route id). Lines without a colored route, every
// line in the low-zoom tiles (they carry no routes), and colors MapLibre cannot
// parse keep the original color.
//
// The rewrite happens once at load time on the style: each line fill's
// `line-color` and each direction arrow's `icon-color` gets a `case` that picks
// the route color and otherwise keeps the expression the style shipped with,
// hover included.

type Expression = unknown;

type StyleLayerLike = {
  id?: string;
  type?: string;
  paint?: Record<string, Expression>;
  layout?: Record<string, Expression>;
};

const ROUTES_CHECKED = 4;

const ROUTES = ['var', 'routes'];
const routeColorAt = (index: number) => ['at', 1, ['split', ['at', index, ROUTES], '\u001e']];

// `''` when the line has no colored route, which sends it back to the original
// color; `let` scopes keep the split routes shared by the cases.
const ROUTE_COLOR: Expression = [
  'case',
  ['has', 'line_routes'],
  [
    'let',
    'routes',
    ['split', ['to-string', ['get', 'line_routes']], '\u001d'],
    [
      'case',
      ...Array.from({ length: ROUTES_CHECKED }, (_, index) => [
        ['all', ['>', ['length', ROUTES], index], ['!=', routeColorAt(index), '']],
        routeColorAt(index),
      ]).flat(),
      '',
    ],
  ],
  '',
];

const IS_HOVERED: Expression = ['boolean', ['feature-state', 'hover'], false];
const HOVER_COLOR = '#ff0000';
const ALTERNATIVE_HOVER_COLOR = '#ffc107';
const UNPARSEABLE_COLOR = '#b8b8b8';

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
    ROUTE_COLOR,
    [
      'case',
      ['==', ['var', 'routeColor'], ''],
      original,
      IS_HOVERED,
      ROUTE_HOVER_COLOR,
      // An OSM colour the renderer cannot parse (`Line 1 color`, `red;white`)
      // also keeps the original color.
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

// Station icons follow the lines, as on a metro map: a dot for a station on one
// line, in that line's color, and a white dot ringed in dark gray where routes
// of different colors meet. Major stations are a little larger, stations not in
// use are light gray, and stations without a colored route are dark gray. The
// colors come from `station_routes`, the same `id\x1Ecolor\x1Elabel` groups as
// `line_routes`, sorted by route id; a line usually has a route per direction
// and service pattern, so colors within a shade of each other count as one line
// (OSM gives the Hibiya Line's through services a different gray, for example).
const STATION_ROUTES_CHECKED = 16;
const SAME_LINE_CHANNEL_DIFFERENCE = 48;
const STATION_ICON_LAYERS = new Set([
  'railway_text_stations_low1',
  'railway_text_stations_low2',
  'railway_text_stations_med',
  'railway_text_stations',
]);
const STATION_COLOR: Expression = ['var', 'stationColor'];
const STATION_KIND: Expression = ['var', 'stationKind'];
const STATION_ROUTE_INDEXES = Array.from({ length: STATION_ROUTES_CHECKED }, (_, index) => index);
const stationRouteColorAt = (index: number): Expression => ['var', `stationRouteColor${index}`];
const rgba = (color: Expression): Expression => ['to-rgba', ['to-color', color, '#000000']];

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

function isOtherLineColor(index: number): Expression {
  const color: Expression = ['var', `stationRouteRgba${index}`];
  const first: Expression = ['var', 'stationRgba'];
  const channelDifference = (channel: number) => ['abs', ['-', ['at', channel, color], ['at', channel, first]]];
  return [
    'all',
    ['!=', stationRouteColorAt(index), ''],
    [
      'let',
      `stationRouteRgba${index}`,
      rgba(stationRouteColorAt(index)),
      ['>', ['max', channelDifference(0), channelDifference(1), channelDifference(2)], SAME_LINE_CHANNEL_DIFFERENCE],
    ],
  ];
}

// Binds stationKind ('line', 'interchange', 'plain' or 'inactive') and
// stationColor for `body`.
function withStationKind(body: Expression): Expression {
  const routes: Expression = ['var', 'stationRoutes'];
  return [
    'let',
    'stationRoutes',
    ['split', ['to-string', ['coalesce', ['get', 'station_routes'], '']], '\u001d'],
    [
      'let',
      ...STATION_ROUTE_INDEXES.flatMap((index) => [
        `stationRouteColor${index}`,
        [
          'case',
          ['all', ['has', 'station_routes'], ['>', ['length', routes], index]],
          ['downcase', ['at', 1, ['split', ['at', index, routes], '\u001e']]],
          '',
        ],
      ]),
      [
        'let',
        'stationColor',
        [
          'case',
          ...STATION_ROUTE_INDEXES.flatMap((index) => [
            ['!=', stationRouteColorAt(index), ''],
            stationRouteColorAt(index),
          ]),
          '',
        ],
        [
          'let',
          'stationKind',
          [
            'case',
            ['!=', ['coalesce', ['get', 'state'], 'present'], 'present'],
            'inactive',
            ['==', STATION_COLOR, ''],
            'plain',
            ['let', 'stationRgba', rgba(STATION_COLOR), ['any', ...STATION_ROUTE_INDEXES.map(isOtherLineColor)]],
            'interchange',
            'line',
          ],
          body,
        ],
      ],
    ],
  ];
}

const IS_HOVERED_STATION: Expression = ['boolean', ['feature-state', 'hover'], false];
const IS_LIGHT_THEME: Expression = ['==', ['global-state', 'theme'], 'light'];
const INTERCHANGE_RING: Expression = ['case', IS_LIGHT_THEME, '#334155', '#cbd5e1'];
const INTERCHANGE_FILL: Expression = ['case', IS_LIGHT_THEME, '#ffffff', '#1e293b'];
const PLAIN_STATION: Expression = ['case', IS_LIGHT_THEME, '#3f3f46', '#d4d4d8'];
const INACTIVE_STATION: Expression = ['case', IS_LIGHT_THEME, '#a1a1aa', '#71717a'];

export function withRouteStationColors<T extends StyleLayerLike>(layer: T): T {
  if (!STATION_ICON_LAYERS.has(layer.id || '')) return layer;
  const paint: Record<string, Expression> = { ...layer.paint };
  const layout: Record<string, Expression> = { ...(layer.layout as Record<string, Expression>) };
  paint['icon-color'] = withStationKind([
    'match',
    STATION_KIND,
    'line',
    ['to-color', STATION_COLOR, PLAIN_STATION],
    'interchange',
    INTERCHANGE_FILL,
    'inactive',
    INACTIVE_STATION,
    PLAIN_STATION,
  ]);
  if (paint['icon-halo-color'] !== undefined) {
    paint['icon-halo-color'] = mapZoomOutputs(paint['icon-halo-color'], (original) =>
      withStationKind([
        'case',
        ['all', ['==', STATION_KIND, 'interchange'], ['!', IS_HOVERED_STATION]],
        INTERCHANGE_RING,
        original,
      ]),
    );
  }
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
