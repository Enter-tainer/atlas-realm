import * as shared from '../shared.mjs'
import { sources } from './sources.mjs'
const { signals_railway_line, loading_gauges, track_classes, knownStyles, defaultDate, themeSwitch, colors, font, turntable_casing_width, trainProtectionColor, railway_casing_add, bridge_casing_add, abandoned_dasharray, disused_dasharray, razed_dasharray, construction_dasharray, proposed_dasharray, present_dasharray, train_protection_construction_dasharray, turboColorMap, speedColor, speedHoverColor, electrification_construction_dashes, electrification_proposed_dashes, color_no, color_delectrified, color_lt750v_dc, color_750v_dc, color_gt750v_lt1kv_dc, color_1kv_dc, color_gt1kv_lt1500v_dc, color_1500v_dc, color_gt1500v_lt3kv_dc, color_3kv_dc, color_gt3kv_dc, color_lt15kv_ac, color_gte15kv_lt25kv_ac, color_gte25kv_ac, color_15kv_16_67hz, color_15kv_16_7hz, color_25kv_50hz, color_25kv_60hz, color_12kv_25hz, color_12_5kv_60hz, color_20kv_50hz, color_20kv_60hz, electrificationVoltageFrequencyColor, electrificationVoltageMaximumCurrentColor, electrificationPowerColor, gauge_construction_dashes, dual_construction_dashes, multi_construction_dashes, gauge_dual_gauge_dashes, gauge_multi_gauge_dashes, color_gauge_0064, color_gauge_0089, color_gauge_0127, color_gauge_0184, color_gauge_0190, color_gauge_0260, color_gauge_0381, color_gauge_0500, color_gauge_0597, color_gauge_0600, color_gauge_0610, color_gauge_0700, color_gauge_0750, color_gauge_0760, color_gauge_0762, color_gauge_0785, color_gauge_0800, color_gauge_0891, color_gauge_0900, color_gauge_0914, color_gauge_0950, color_gauge_1000, color_gauge_1009, color_gauge_1050, color_gauge_1067, color_gauge_1100, color_gauge_1200, color_gauge_1372, color_gauge_1422, color_gauge_1432, color_gauge_1435, color_gauge_1440, color_gauge_1445, color_gauge_1450, color_gauge_1458, color_gauge_1495, color_gauge_1520, color_gauge_1522, color_gauge_1524, color_gauge_1581, color_gauge_1588, color_gauge_1600, color_gauge_1668, color_gauge_1676, color_gauge_1700, color_gauge_1800, color_gauge_1880, color_gauge_2000, color_gauge_miniature, color_gauge_monorail, color_gauge_broad, color_gauge_narrow, color_gauge_standard, color_gauge_unknown, gaugeColor, loadingGaugeFillColor, trackClassFillColor, searchResults, railwayLine, historicalRailwayLine, railwayKmText, preferredDirectionLayer, imageLayerWithOutline, hillshade, route, routeText, routeStops, DATA_MAX_ZOOM, capSourcesForDataMaxZoom, capLayersForDataMaxZoom, makeStyle } = shared
export const signals_boxesLayers = [
  {
      id: 'signal_boxes_point',
      type: 'circle',
      minzoom: 10,
      source: 'openrailwaymap_signals',
      'source-layer': 'signals_signal_boxes',
      filter: ['==', ["geometry-type"], 'Point'],
      paint: {
        'circle-color': ['case',
          ['boolean', ['feature-state', 'hover'], false], colors.hover.main,
          '#008206',
        ],
        'circle-radius': 4,
        'circle-stroke-color': 'white',
        'circle-stroke-width': 1,
      },
    },
  {
      id: 'signal_boxes_polygon',
      type: 'fill',
      minzoom: 14,
      source: 'openrailwaymap_signals',
      'source-layer': 'signals_signal_boxes',
      filter: ['any',
        ['==', ["geometry-type"], 'Polygon'],
        ['==', ["geometry-type"], 'MultiPolygon'],
      ],
      paint: {
        'fill-color': ['case',
          ['boolean', ['feature-state', 'hover'], false], colors.hover.main,
          '#008206',
        ],
        'fill-outline-color': 'white',
      },
    },
  {
      id: 'signal_boxes_polygon_outline',
      type: 'line',
      minzoom: 14,
      source: 'openrailwaymap_signals',
      'source-layer': 'signals_signal_boxes',
      filter: ['any',
        ['==', ["geometry-type"], 'Polygon'],
        ['==', ["geometry-type"], 'MultiPolygon'],
      ],
      paint: {
        'line-color': 'white',
        'line-width': 1,
      },
    },
  {
      id: 'signal_boxes_text_medium',
      type: 'symbol',
      minzoom: 12,
      maxzoom: 15,
      source: 'openrailwaymap_signals',
      'source-layer': 'signals_signal_boxes',
      filter: ['!=', ['get', 'ref'], null],
      paint: {
        'text-color': colors.styles.standard.signalBox.text,
        'text-halo-color': ['case',
          ['boolean', ['feature-state', 'hover'], false], colors.hover.textHalo,
          colors.styles.standard.signalBox.halo,
        ],
        'text-halo-width': 1.5,
      },
      layout: {
        'text-field': '{ref}',
        'text-font': font.bold,
        'text-size': 11,
        'text-offset': ['literal', [0, 1]],
      }
    },
  {
      id: 'signal_boxes_text_high',
      type: 'symbol',
      minzoom: 15,
      source: 'openrailwaymap_signals',
      'source-layer': 'signals_signal_boxes',
      filter: ['any',
        ['!=', ['get', 'name'], null],
        ['!=', ['get', 'ref'], null],
      ],
      paint: {
        'text-color': colors.styles.standard.signalBox.text,
        'text-halo-color': ['case',
          ['boolean', ['feature-state', 'hover'], false], colors.hover.textHalo,
          colors.styles.standard.signalBox.halo,
        ],
        'text-halo-width': 1.5,
      },
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'ref'], ''],
        'text-font': font.bold,
        'text-size': 11,
      }
    }
]
