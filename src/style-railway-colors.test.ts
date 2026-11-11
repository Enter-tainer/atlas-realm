import { describe, expect, it } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { applyRouteColors, withRouteLineColors, withRouteStationColors } from './style-railway-colors.js';

const USAGE = '#ff0c00';

// The style spec hands back Color objects; compare in hex.
function hex(color: unknown) {
  if (typeof color === 'string') return color;
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(color));
  if (!match) return String(color);
  return `#${match
    .slice(1, 4)
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function colorOf(id: string, properties: Record<string, unknown>, hover = false) {
  const layer = withRouteLineColors({ id, type: 'line', paint: { 'line-color': USAGE } });
  const created = createExpression(layer.paint?.['line-color'] as never, { type: 'color' } as never);
  if (created.result !== 'success') throw new Error(JSON.stringify(created.value));
  return hex(
    created.value.evaluate({ zoom: 13 } as never, { type: 1, properties } as never, hover ? { hover: true } : {}),
  );
}

const routes = (...colors: string[]) =>
  colors.map((color, index) => `${index + 1}\u001e${color}\u001eLine ${index + 1}`).join('\u001d');

describe('withRouteLineColors', () => {
  it('draws a line in its first colored route', () => {
    expect(colorOf('railway_line_subway_fill_present', { line_routes: routes('#178ABB', '#00997A') })).toBe('#178abb');
    expect(colorOf('railway_line_subway_fill_present', { line_routes: routes('', '', 'red') })).toBe('#ff0000');
  });

  it('keeps the usage color without a colored route', () => {
    expect(colorOf('railway_line_main_high_fill_present', {})).toBe(USAGE);
    expect(colorOf('railway_line_main_high_fill_present', { line_routes: routes('', '') })).toBe(USAGE);
    expect(colorOf('railway_line_main_high_fill_present', { line_routes: routes('', '', '', '', '#178ABB') })).toBe(
      USAGE,
    );
  });

  it('keeps the usage color for a color the renderer cannot parse', () => {
    expect(colorOf('railway_line_main_high_fill_present', { line_routes: routes('Line 1 color') })).toBe(USAGE);
    expect(colorOf('railway_line_main_high_fill_present', { line_routes: routes('red;white') })).toBe(USAGE);
  });

  it('hovers route-colored lines red, and red routes amber', () => {
    expect(colorOf('railway_line_subway_fill_present', { line_routes: routes('#178ABB') }, true)).toBe('#ff0000');
    expect(colorOf('railway_line_subway_fill_present', { line_routes: routes('#c23a30') }, true)).toBe('#ffc107');
    expect(colorOf('railway_line_subway_fill_present', {}, true)).toBe(USAGE);
  });

  it('colors the direction arrows too', () => {
    const layer = withRouteLineColors({
      id: 'railway_line_main_high_preferred_direction',
      type: 'symbol',
      paint: { 'icon-color': USAGE },
    });
    const created = createExpression(layer.paint?.['icon-color'] as never, { type: 'color' } as never);
    if (created.result !== 'success') throw new Error(JSON.stringify(created.value));
    const color = created.value.evaluate(
      { zoom: 15 } as never,
      {
        type: 1,
        properties: { line_routes: routes('#178ABB') },
      } as never,
    );
    expect(hex(color)).toBe('#178abb');
  });

  it('leaves tracks that are out of use, ferries and other layers alone', () => {
    for (const id of [
      'railway_line_main_high_fill_disused',
      'railway_line_main_high_fill_abandoned',
      'railway_line_main_high_fill_razed',
      'railway_platform_fill',
    ]) {
      const layer = { id, type: 'line', paint: { 'line-color': USAGE } };
      expect(withRouteLineColors(layer)).toBe(layer);
    }
    const withoutColor = { id: 'railway_line_main_high_fill_present', type: 'line', paint: {} };
    expect(withRouteLineColors(withoutColor)).toBe(withoutColor);
  });
});

describe('applyRouteColors', () => {
  it('rewrites only the line fills of a style', () => {
    const style = {
      layers: [
        { id: 'railway_line_main_high_fill_present', type: 'line', paint: { 'line-color': USAGE } },
        { id: 'water', type: 'fill', paint: { 'fill-color': '#0000ff' } },
      ],
    };
    const result = applyRouteColors(style);
    expect(JSON.stringify(result.layers?.[0])).toContain('routeColor');
    expect(result.layers?.[1]).toBe(style.layers[1]);
  });
});

function stationLayer(properties: Record<string, unknown>) {
  return withRouteStationColors({
    id: 'railway_text_stations_med',
    type: 'symbol',
    paint: { 'icon-color': '#0000ff', 'icon-halo-color': '#ffffff', 'icon-halo-width': 2 },
    layout: { 'icon-image': 'small', 'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.55, 12, 1] },
  });
}

function stationColor(
  properties: Record<string, unknown>,
  theme = 'light',
  featureState: Record<string, unknown> = {},
) {
  const created = createExpression(stationLayer(properties).paint?.['icon-color'] as never, { type: 'color' } as never);
  if (created.result !== 'success') throw new Error(JSON.stringify(created.value));
  return hex(
    created.value.evaluate(
      { zoom: 13, globalState: { theme } } as never,
      { type: 1, properties } as never,
      featureState,
    ),
  );
}

describe('withRouteStationColors', () => {
  it('draws a station on one line in that line color', () => {
    expect(stationColor({ station_routes: routes('#178ABB', '#178abc') })).toBe('#178abb');
  });

  it('rings a station where differently colored routes meet', () => {
    expect(stationColor({ station_routes: routes('#178ABB', '#00997A') })).toBe('#ffffff');
    expect(stationColor({ station_routes: routes('#178ABB', '#00997A') }, 'dark')).toBe('#1e293b');
  });

  it('uses gray dots for stations without a colored route, and lighter for those out of use', () => {
    expect(stationColor({})).toBe('#3f3f46');
    expect(stationColor({}, 'dark')).toBe('#d4d4d8');
    expect(stationColor({ state: 'construction' })).toBe('#a1a1aa');
  });

  it('rings interchanges in dark gray, unless hovered', () => {
    const haloOf = (properties: Record<string, unknown>, featureState: Record<string, unknown> = {}) => {
      const created = createExpression(
        stationLayer(properties).paint?.['icon-halo-color'] as never,
        { type: 'color' } as never,
      );
      if (created.result !== 'success') throw new Error(JSON.stringify(created.value));
      return hex(
        created.value.evaluate(
          { zoom: 13, globalState: { theme: 'light' } } as never,
          { type: 1, properties } as never,
          featureState,
        ),
      );
    };
    expect(haloOf({ station_routes: routes('#178ABB', '#00997A') })).toBe('#334155');
    expect(haloOf({ station_routes: routes('#178ABB', '#00997A') }, { hover: true })).toBe('#ffffff');
    expect(haloOf({ station_routes: routes('#178ABB') })).toBe('#ffffff');
  });

  it('draws one icon and makes large stations bigger', () => {
    const layer = stationLayer({});
    expect(layer.layout?.['icon-image']).toBe('sdf:general/station-normal');
    const created = createExpression(layer.layout?.['icon-size'] as never);
    if (created.result !== 'success') throw new Error(JSON.stringify(created.value));
    const sizeAt = (properties: Record<string, unknown>) =>
      created.value.evaluate({ zoom: 12 } as never, { type: 1, properties } as never);
    expect(sizeAt({ station_size: 'large' })).toBeCloseTo(1.3);
    expect(sizeAt({ station_size: 'normal' })).toBeCloseTo(1);
  });

  it('leaves other symbol layers alone', () => {
    for (const id of ['railway_line_main_high_text', 'standard_station_entrances', 'station_entrance']) {
      const layer = { id, type: 'symbol', paint: { 'icon-color': '#0000ff' } };
      expect(withRouteStationColors(layer)).toBe(layer);
    }
  });
});
