import * as shared from '../shared.mjs'
import { sources } from './sources.mjs'
const { signals_railway_line, loading_gauges, track_classes, knownStyles, defaultDate, themeSwitch, colors, font, turntable_casing_width, trainProtectionColor, railway_casing_add, bridge_casing_add, abandoned_dasharray, disused_dasharray, razed_dasharray, construction_dasharray, proposed_dasharray, present_dasharray, train_protection_construction_dasharray, turboColorMap, speedColor, speedHoverColor, electrification_construction_dashes, electrification_proposed_dashes, color_no, color_delectrified, color_lt750v_dc, color_750v_dc, color_gt750v_lt1kv_dc, color_1kv_dc, color_gt1kv_lt1500v_dc, color_1500v_dc, color_gt1500v_lt3kv_dc, color_3kv_dc, color_gt3kv_dc, color_lt15kv_ac, color_gte15kv_lt25kv_ac, color_gte25kv_ac, color_15kv_16_67hz, color_15kv_16_7hz, color_25kv_50hz, color_25kv_60hz, color_12kv_25hz, color_12_5kv_60hz, color_20kv_50hz, color_20kv_60hz, electrificationVoltageFrequencyColor, electrificationVoltageMaximumCurrentColor, electrificationPowerColor, gauge_construction_dashes, dual_construction_dashes, multi_construction_dashes, gauge_dual_gauge_dashes, gauge_multi_gauge_dashes, color_gauge_0064, color_gauge_0089, color_gauge_0127, color_gauge_0184, color_gauge_0190, color_gauge_0260, color_gauge_0381, color_gauge_0500, color_gauge_0597, color_gauge_0600, color_gauge_0610, color_gauge_0700, color_gauge_0750, color_gauge_0760, color_gauge_0762, color_gauge_0785, color_gauge_0800, color_gauge_0891, color_gauge_0900, color_gauge_0914, color_gauge_0950, color_gauge_1000, color_gauge_1009, color_gauge_1050, color_gauge_1067, color_gauge_1100, color_gauge_1200, color_gauge_1372, color_gauge_1422, color_gauge_1432, color_gauge_1435, color_gauge_1440, color_gauge_1445, color_gauge_1450, color_gauge_1458, color_gauge_1495, color_gauge_1520, color_gauge_1522, color_gauge_1524, color_gauge_1581, color_gauge_1588, color_gauge_1600, color_gauge_1668, color_gauge_1676, color_gauge_1700, color_gauge_1800, color_gauge_1880, color_gauge_2000, color_gauge_miniature, color_gauge_monorail, color_gauge_broad, color_gauge_narrow, color_gauge_standard, color_gauge_unknown, gaugeColor, loadingGaugeFillColor, trackClassFillColor, searchResults, railwayLine, historicalRailwayLine, railwayKmText, preferredDirectionLayer, imageLayerWithOutline, hillshade, route, routeText, routeStops, DATA_MAX_ZOOM, capSourcesForDataMaxZoom, capLayersForDataMaxZoom, makeStyle } = shared
export const route_linesLayers = [
  hillshade,
  {
      id: 'railway_grouped_stations',
      type: 'fill',
      minzoom: 13,
      source: 'openrailwaymap_standard',
      'source-layer': 'standard_railway_grouped_stations',
      filter: ['all',
        ['!', ['in', ['get', 'feature'], ['literal', ['yard', 'site', 'junction', 'spur_junction']]]], // Yards only have an outline and sites and junctions show an icon
        ['match', ['get', 'state'],
          'construction', ['global-state', 'showConstructionInfrastructure'],
          'proposed', ['global-state', 'showProposedInfrastructure'],
          'abandoned', ['global-state', 'showAbandonedInfrastructure'],
          'razed', ['global-state', 'showRazedInfrastructure'],
          true,
        ],
      ],
      paint: {
        'fill-color': ['get', 'operator_color'],
        'fill-opacity': ['case',
          ['boolean', ['feature-state', 'hover'], false], 0.3,
          0.2,
        ],
      },
    },
  ...Object.entries({
      present: present_dasharray,
      disused: disused_dasharray,
      abandoned: abandoned_dasharray,
      preserved: disused_dasharray,
      construction: construction_dasharray,
      proposed: proposed_dasharray,
    }).map(([state, dasharray]) => ({
      id: `railway_grouped_stations_outline_${state}`,
      type: 'line',
      minzoom: 13,
      source: 'openrailwaymap_standard',
      'source-layer': 'standard_railway_grouped_stations',
      filter: ['all',
        ['==', ['get', 'state'], state],
        ['!', ['in', ['get', 'feature'], ['literal', ['site', 'junction', 'spur_junction']]]], // Sites and junctions show an icon
      ],
      paint: {
        'line-color': ['case',
          ['boolean', ['feature-state', 'hover'], false], colors.hover.main,
          ['get', 'operator_color'],
        ],
        'line-opacity': ['match', ['get', 'feature'],
          'yard', 0.2,
          0.3,
        ],
        'line-width': ['match', ['get', 'feature'],
          'yard', 6,
          2,
        ],
        'line-dasharray': dasharray,
      },
      layout: {
        'visibility': ['case',
          state === 'construction' ? ['global-state', 'showConstructionInfrastructure']
            : state === 'proposed' ? ['global-state', 'showProposedInfrastructure']
              : state === 'abandoned' ? ['global-state', 'showAbandonedInfrastructure']
                : state === 'razed' ? ['global-state', 'showRazedInfrastructure']
                  : true, 'visible',
          'none',
        ],
      }
    })),
  ...railwayLine(
      ['coalesce', ['get', 'standard_label'], ''],
      [
        {
          id: 'railway_line_low',
          minzoom: 0,
          maxzoom: 7,
          source: 'route_railway_line_low',
          sourceLayer: 'route_railway_line_low',
          states: {
            present: undefined,
          },
          width: ["interpolate", ["exponential", 1.2], ["zoom"],
            0, 0.5,
            7, 2,
          ],
          color: ['match', ['coalesce', ['get', 'route_count']],
            0, 'gray',
            turboColorMap(['get', 'route_count'], 0, 25, 0.5),
          ],
        },
        {
          id: 'railway_line_med',
          minzoom: 7,
          maxzoom: 8,
          source: 'openrailwaymap_low',
          states: {
            present: undefined,
          },
          width: 2,
          color: ['match', ['coalesce', ['get', 'route_count']],
            0, 'gray',
            turboColorMap(['get', 'route_count'], 0, 25, 0.5),
          ],
        },
        {
          id: 'railway_line_high',
          minzoom: 8,
          source: 'high',
          states: {
            present: undefined,
            construction: construction_dasharray,
            proposed: proposed_dasharray,
            disused: disused_dasharray,
            preserved: disused_dasharray,
          },
          width: ["interpolate", ["exponential", 1.2], ["zoom"],
            14, 2,
            16, 3,
          ],
          color: ['match', ['coalesce', ['get', 'route_count']],
            0, 'gray',
            turboColorMap(['get', 'route_count'], 0, 25, 0.5),
          ],
        },
      ],
    ),
  route,
  routeStops,
  searchResults
]
