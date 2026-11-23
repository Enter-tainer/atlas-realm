import { describe, expect, it } from 'vitest';
import {
  ORM_SOURCE,
  addMapterhornTerrain,
  mergeBaseAndOrm,
  rewriteOrmStyle,
  type DemSourceLike,
  type StyleLike,
} from '@atlas-realm/map';

describe('@atlas-realm/map compose', () => {
  it('rewrites glyphs, sprite URLs, and local vector sources with ormOrigin', () => {
    const rawStyle: StyleLike = {
      version: 8,
      glyphs: '/font/{fontstack}/{range}',
      sprite: [{ id: 'default', url: '/sprite/standard' }],
      sources: {
        rail_source: {
          type: 'vector',
          url: '/tiles/openrailwaymap.json',
          attribution: 'ORM',
        },
      },
      layers: [
        {
          id: 'rail-label',
          type: 'symbol',
          source: 'rail_source',
          layout: {
            'text-font': ['Fira Code Bold'],
            'icon-image': 'station_circle',
          },
        },
      ],
    };

    const rewritten = rewriteOrmStyle(
      rawStyle,
      'https://map.mgt.moe/tiles/openrailwaymap/{z}/{x}/{y}.mvt?v=1',
      'https://map.mgt.moe/',
    );

    expect(rewritten.glyphs).toBe('https://map.mgt.moe/orm/font/{fontstack}/{range}');
    expect(rewritten.sprite).toEqual([{ id: 'orm', url: 'https://map.mgt.moe/orm/sprite/standard' }]);
    expect(rewritten.sources?.[ORM_SOURCE]).toMatchObject({
      type: 'vector',
      tiles: ['https://map.mgt.moe/tiles/openrailwaymap/{z}/{x}/{y}.mvt?v=1'],
      maxzoom: 15,
    });
    expect(rewritten.sources?.rail_source).toBeUndefined();
    expect(rewritten.layers?.[0]).toMatchObject({
      source: ORM_SOURCE,
      layout: {
        'text-font': ['Noto Sans Bold'],
        'icon-image': 'orm:station_circle',
      },
    });
  });

  it('merges base style with ORM style and strips ne2_shaded relief', () => {
    const baseStyle: StyleLike = {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384',
      sources: {
        ne2_shaded: { type: 'raster', url: 'https://example.com/ne2' },
        openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      },
      layers: [
        { id: 'relief', type: 'raster', source: 'ne2_shaded' },
        { id: 'water', type: 'fill', source: 'openmaptiles' },
      ],
    };
    const ormStyle: StyleLike = {
      glyphs: 'https://map.mgt.moe/orm/font/{fontstack}/{range}',
      sprite: [{ id: 'orm', url: 'https://map.mgt.moe/orm/sprite/standard' }],
      sources: { [ORM_SOURCE]: { type: 'vector', tiles: ['https://map.mgt.moe/tiles/orm/{z}/{x}/{y}.mvt'] } },
      layers: [{ id: 'rail', type: 'line', source: ORM_SOURCE }],
    };

    const merged = mergeBaseAndOrm(baseStyle, ormStyle, { withBaseMapVisibility: false });

    expect(merged.sources?.ne2_shaded).toBeUndefined();
    expect(merged.layers?.map((l) => l.id)).toEqual(['water', 'rail']);
    expect(merged.sprite).toEqual([
      { id: 'default', url: 'https://tiles.openfreemap.org/sprites/ofm_f384' },
      { id: 'orm', url: 'https://map.mgt.moe/orm/sprite/standard' },
    ]);
  });

  it('adds Mapterhorn hillshade and contour layers before symbols and contour labels last', () => {
    const style: StyleLike = {
      version: 8,
      sources: {},
      layers: [
        { id: 'land', type: 'fill' },
        { id: 'place_label', type: 'symbol' },
      ],
    };
    const demSource: DemSourceLike = {
      setupMaplibre() {},
      contourProtocolUrl: () => 'contour://mapterhorn/{z}/{x}/{y}',
    };

    const withTerrain = addMapterhornTerrain(style, demSource);
    expect(withTerrain.sources?.hillshadeSource).toBeDefined();
    expect(withTerrain.sources?.contourSource).toBeDefined();
    expect(withTerrain.layers?.map((l) => l.id)).toEqual([
      'land',
      'trip-hillshade',
      'trip-contour-lines',
      'place_label',
      'trip-contour-labels',
    ]);
  });
});
