import * as shared from '../shared.mjs'
import { sources } from './sources.mjs'
const { signals_railway_line, loading_gauges, track_classes, knownStyles, defaultDate, themeSwitch, colors, font, turntable_casing_width, trainProtectionColor, railway_casing_add, bridge_casing_add, abandoned_dasharray, disused_dasharray, razed_dasharray, construction_dasharray, proposed_dasharray, present_dasharray, train_protection_construction_dasharray, turboColorMap, speedColor, speedHoverColor, electrification_construction_dashes, electrification_proposed_dashes, color_no, color_delectrified, color_lt750v_dc, color_750v_dc, color_gt750v_lt1kv_dc, color_1kv_dc, color_gt1kv_lt1500v_dc, color_1500v_dc, color_gt1500v_lt3kv_dc, color_3kv_dc, color_gt3kv_dc, color_lt15kv_ac, color_gte15kv_lt25kv_ac, color_gte25kv_ac, color_15kv_16_67hz, color_15kv_16_7hz, color_25kv_50hz, color_25kv_60hz, color_12kv_25hz, color_12_5kv_60hz, color_20kv_50hz, color_20kv_60hz, electrificationVoltageFrequencyColor, electrificationVoltageMaximumCurrentColor, electrificationPowerColor, gauge_construction_dashes, dual_construction_dashes, multi_construction_dashes, gauge_dual_gauge_dashes, gauge_multi_gauge_dashes, color_gauge_0064, color_gauge_0089, color_gauge_0127, color_gauge_0184, color_gauge_0190, color_gauge_0260, color_gauge_0381, color_gauge_0500, color_gauge_0597, color_gauge_0600, color_gauge_0610, color_gauge_0700, color_gauge_0750, color_gauge_0760, color_gauge_0762, color_gauge_0785, color_gauge_0800, color_gauge_0891, color_gauge_0900, color_gauge_0914, color_gauge_0950, color_gauge_1000, color_gauge_1009, color_gauge_1050, color_gauge_1067, color_gauge_1100, color_gauge_1200, color_gauge_1372, color_gauge_1422, color_gauge_1432, color_gauge_1435, color_gauge_1440, color_gauge_1445, color_gauge_1450, color_gauge_1458, color_gauge_1495, color_gauge_1520, color_gauge_1522, color_gauge_1524, color_gauge_1581, color_gauge_1588, color_gauge_1600, color_gauge_1668, color_gauge_1676, color_gauge_1700, color_gauge_1800, color_gauge_1880, color_gauge_2000, color_gauge_miniature, color_gauge_monorail, color_gauge_broad, color_gauge_narrow, color_gauge_standard, color_gauge_unknown, gaugeColor, loadingGaugeFillColor, trackClassFillColor, searchResults, railwayLine, historicalRailwayLine, railwayKmText, preferredDirectionLayer, imageLayerWithOutline, hillshade, route, routeText, routeStops, DATA_MAX_ZOOM, capSourcesForDataMaxZoom, capLayersForDataMaxZoom, makeStyle } = shared
export const speed_linesLayers = [
  hillshade,
  ...railwayLine(
      ['coalesce', ['get', 'speed_label'], ''],
      [
        {
          id: 'speed_low',
          minzoom: 0,
          maxzoom: 7,
          source: 'speed_railway_line_low',
          sourceLayer: 'speed_railway_line_low',
          states: {
            present: undefined,
          },
          filter: ['!=', ['get', 'feature'], 'ferry'],
          width: ["interpolate", ["exponential", 1.2], ["zoom"],
            0, 0.5,
            7, 2,
          ],
          color: speedColor,
          hoverColor: speedHoverColor,
        },
        {
          id: 'speed_med',
          minzoom: 7,
          maxzoom: 8,
          source: 'openrailwaymap_low',
          states: {
            present: undefined,
            construction: construction_dasharray,
            proposed: proposed_dasharray,
          },
          filter: ['!=', ['get', 'feature'], 'ferry'],
          width: 2,
          color: speedColor,
          hoverColor: speedHoverColor,
        },
        {
          id: 'speed_high',
          minzoom: 8,
          source: 'high',
          states: {
            present: undefined,
            construction: construction_dasharray,
            proposed: proposed_dasharray,
            disused: disused_dasharray,
            preserved: disused_dasharray,
          },
          filter: ['!=', ['get', 'feature'], 'ferry'],
          width: ["interpolate", ["exponential", 1.2], ["zoom"],
            14, 2,
            16, 3,
          ],
          color: speedColor,
          hoverColor: speedHoverColor,
        },
      ],
    ),
  route,
  ...[0, 1].flatMap(featureIndex => [
      ...imageLayerWithOutline(
        `speed_railway_signals_${featureIndex}`,
        ['get', `feature${featureIndex}`],
        {
          type: 'symbol',
          minzoom: 13,
          source: 'openrailwaymap_speed',
          'source-layer': 'speed_railway_signals',
          filter: ['step', ['zoom'],
            ['all',
              ['!=', ['get', `feature${featureIndex}`], null],
              ['==', ['get', 'type'], 'line'],
            ],
            14,
            ['all',
              ['!=', ['get', `feature${featureIndex}`], null],
              ['any',
                ['==', ['get', 'type'], 'line'],
                ['==', ['get', 'type'], 'tram'],
              ]
            ],
            16,
            ['!=', ['get', `feature${featureIndex}`], null],
          ],
          layout: {
            'symbol-z-order': 'source',
            'icon-overlap': 'always',
            'icon-offset': featureIndex === 0
              ? ['literal', [0, 0]]
              : ['interpolate', ['linear'],
                // Gap of 2 pixels for halo and spacing
                ['+', ['get', `offset${featureIndex}`], 2 * featureIndex],
                0, ['literal', [0, 0]],
                1000, ['literal', [0, -1000]],
              ],
          },
        },
      ),
      {
        id: `speed_railway_signals_deactivated_${featureIndex}`,
        type: 'symbol',
        minzoom: 13,
        source: 'openrailwaymap_speed',
        'source-layer': 'speed_railway_signals',
        filter: ['==', ['get', `deactivated${featureIndex}`], true],
        layout: {
          'symbol-z-order': 'source',
          'icon-overlap': 'always',
          'icon-image': 'general/signal-deactivated',
          'icon-offset': featureIndex === 0
            ? ['literal', [0, 0]]
            : ['interpolate', ['linear'],
              // Gap of 2 pixels for halo and spacing
              ['+', ['get', `offset${featureIndex}`], 2 * featureIndex],
              0, ['literal', [0, 0]],
              1000, ['literal', [0, -1000]],
            ],
        }
      },
    ]),
  routeStops,
  searchResults
]
