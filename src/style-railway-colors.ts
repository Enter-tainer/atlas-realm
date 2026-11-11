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

export function applyRouteLineColors<T extends { layers?: StyleLayerLike[] }>(style: T): T {
  return { ...style, layers: style.layers?.map(withRouteLineColors) };
}
