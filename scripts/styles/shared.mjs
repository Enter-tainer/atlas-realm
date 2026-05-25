import fs from 'fs'
import yaml from 'yaml'

export const signals_railway_line = yaml.parse(fs.readFileSync('features/train_protection.yaml', 'utf8'))
export const loading_gauges = yaml.parse(fs.readFileSync('features/loading_gauge.yaml', 'utf8'))
export const track_classes = yaml.parse(fs.readFileSync('features/track_class.yaml', 'utf8'))

export const knownStyles = ['standard', 'speed', 'signals', 'electrification', 'track', 'operator', 'route']

export const defaultDate = new Date().getFullYear()

export const themeSwitch = (light, dark) => ['case', ['==', ['global-state', 'theme'], 'light'], light, dark]

export const colors = {
  text: {
    main: themeSwitch('black', 'white'),
    halo: themeSwitch('white', 'black'),
  },
  halo: themeSwitch('white', '#333'),
  iconHalo: themeSwitch('white', '#ccc'),
  casing: themeSwitch('white', '#666'),
  hover: {
    main: themeSwitch('#ff0000', '#ff0000'),
    // High speed lines and 25kV are the hover color by default
    alternative: themeSwitch('#ffc107', '#ffc107'),
    textHalo: themeSwitch('yellow', '#28281e'),
    iconHalo: themeSwitch('yellow', '#E7E700'),
  },
  railwayLine: {
    text: themeSwitch('#585858', '#ccc'),
  },
  route: themeSwitch('hsla(312, 100%, 50%, 0.6)', 'hsla(312, 100%, 50%, 0.6)'),
  styles: {
    standard: {
      main: themeSwitch('#ff8100', '#ff8100'),
      highspeed: themeSwitch('#ff0c00', '#ff0c00'),
      branch: themeSwitch('#c4b600', '#c4b600'),
      narrowGauge: themeSwitch('#c0da00', '#c0da00'),
      no_usage: themeSwitch('#000000', '#000000'),
      disused: themeSwitch('#70584d', '#70584d'),
      tourism: themeSwitch('#5b4d70', '#5b4d70'),
      military: themeSwitch('#764765', '#764765'),
      test: themeSwitch('#3d634e', '#3d634e'),
      abandoned: themeSwitch('#7f6a62', '#7f6a62'),
      razed: themeSwitch('#94847e', '#94847e'),
      tram: themeSwitch('#d877b8', '#d877b8'),
      subway: themeSwitch('#0300c3', '#0300c3'),
      light_rail: themeSwitch('#00bd14', '#00bd14'),
      monorail: themeSwitch('#00bd8b', '#00bd8b'),
      miniature: themeSwitch('#7d7094', '#7d7094'),
      funicular: themeSwitch('#d87777', '#d87777'),
      siding: themeSwitch('#000000', '#000000'),
      crossover: themeSwitch('#000000', '#000000'),
      yard: themeSwitch('#000000', '#000000'),
      spur: themeSwitch('#87491d', '#87491d'),
      industrial: themeSwitch('#87491d', '#87491d'),
      ferry: themeSwitch('#1e81b0', '#1e81b0'),
      unknown: themeSwitch('#000000', '#000000'),
      casing: {
        railway: themeSwitch('#ffffff', '#ffffff'),
        bridge: themeSwitch('#000000', '#ddd'),
      },
      tunnelCover: themeSwitch('rgba(255, 255, 255, 50%)', 'rgba(0, 0, 0, 25%)'),
      turntable: {
        fill: themeSwitch('#ababab', '#ababab'),
        casing: themeSwitch('#808080', '#808080'),
      },
      stationsText: themeSwitch('blue', '#bdcfff'),
      yardText: themeSwitch('#87491D', '#ffa35f'),
      tramStopText: themeSwitch('#D877B8', '#f8c7e8'),
      lightRailText: themeSwitch('#0e5414', '#83ea8f'),
      monorailText: themeSwitch('#00674d', '#5fffd7'),
      miniatureText: themeSwitch('#503285', '#503285'),
      funicularText: themeSwitch('#d75656', '#daa3a3'),
      defaultText: themeSwitch('#616161', '#d2d2d2'),
      past: themeSwitch('#535353', '#dadada'),
      future: themeSwitch('#fff732', '#fffdcc'),
      signalBox: {
        text: themeSwitch('#404040', '#bfffb3'),
        halo: themeSwitch('#bfffb3', '#404040'),
      },
      track: {
        text: themeSwitch('white', 'white'),
        halo: themeSwitch('blue', '#00298d'),
        hover: themeSwitch('yellow', 'yellow'),
      },
      switch: {
        default: themeSwitch('#003687', '#a7c6fc'),
        localOperated: themeSwitch('#005129', '#85f5bd'),
        resetting: themeSwitch('#414925', '#bdc2ab'),
      },
      symbols: themeSwitch('black', 'white'),
      platform: themeSwitch('#aaa', '#aaa'),
      stationAreaGroup: themeSwitch('black', 'white'),
    },
    signals: {
      bufferStopDerailer: themeSwitch('#BF1A1D', '#E75454'),
    },
  },
  km: {
    text: themeSwitch('hsl(268, 100%, 40%)', 'hsl(268, 5%, 86%)'),
  },
  signals: {
    direction: themeSwitch('#a8d8bcff', '#a8d8bcff'),
  },
  catenary: themeSwitch('blue', 'blue'),
  substation: themeSwitch('hsl(152 100% 36.3%)', 'hsl(152 100% 25%)'),
  substationText: themeSwitch('hsl(152 100% 20.8%)', 'hsl(152 100% 50%)'),
}

export const font = {
  regular: [
    'Noto Sans Regular',
    'Noto Naskh Arabic Regular',
    'Noto Sans Armenian Regular',
    'Noto Sans Balinese Regular',
    'Noto Sans Bengali Regular',
    'Noto Sans Devanagari Regular',
    'Noto Sans Ethiopic Regular',
    'Noto Sans Georgian Regular',
    'Noto Sans Gujarati Regular',
    'Noto Sans Gurmukhi Regular',
    'Noto Sans Hebrew Regular',
    'Noto Sans Javanese Regular',
    'Noto Sans Kannada Regular',
    'Noto Sans Khmer Regular',
    'Noto Sans Lao Regular',
    'Noto Sans Mongolian Regular',
    'Noto Sans Myanmar Regular',
    'Noto Sans Oriya Regular',
    'Noto Sans Sinhala Regular',
    'Noto Sans Symbols Regular',
    'Noto Sans Tamil Regular',
    'Noto Sans Thai Regular',
    'Noto Sans Tibetan Regular',
    'Noto Sans Tifinagh Regular',
  ],
  bold: [
    'Noto Sans Bold',
    'Noto Naskh Arabic Bold',
    'Noto Sans Armenian Bold',
    'Noto Sans Bengali Bold',
    'Noto Sans Devanagari Bold',
    'Noto Sans Ethiopic Bold',
    'Noto Sans Georgian Bold',
    'Noto Sans Gujarati Bold',
    'Noto Sans Gurmukhi Bold',
    'Noto Sans Hebrew Bold',
    'Noto Sans Kannada Bold',
    'Noto Sans Khmer Bold',
    'Noto Sans Lao Bold',
    'Noto Sans Myanmar Bold',
    'Noto Sans Oriya Bold',
    'Noto Sans Sinhala Bold',
    'Noto Sans Symbols Bold',
    'Noto Sans Tamil Bold',
    'Noto Sans Thai Bold',
    'Noto Sans Tibetan Bold',
    // Fallback to regular fonts
    'Noto Sans Balinese Regular',
    'Noto Sans Javanese Regular',
    'Noto Sans Mongolian Regular',
    'Noto Sans Tifinagh Regular',
  ],
  italic: [
    'Noto Sans Italic',
    // Fallback to regular fonts
    'Noto Naskh Arabic Regular',
    'Noto Sans Armenian Regular',
    'Noto Sans Balinese Regular',
    'Noto Sans Bengali Regular',
    'Noto Sans Devanagari Regular',
    'Noto Sans Ethiopic Regular',
    'Noto Sans Georgian Regular',
    'Noto Sans Gujarati Regular',
    'Noto Sans Gurmukhi Regular',
    'Noto Sans Hebrew Regular',
    'Noto Sans Javanese Regular',
    'Noto Sans Kannada Regular',
    'Noto Sans Khmer Regular',
    'Noto Sans Lao Regular',
    'Noto Sans Mongolian Regular',
    'Noto Sans Myanmar Regular',
    'Noto Sans Oriya Regular',
    'Noto Sans Sinhala Regular',
    'Noto Sans Symbols Regular',
    'Noto Sans Tamil Regular',
    'Noto Sans Thai Regular',
    'Noto Sans Tibetan Regular',
    'Noto Sans Tifinagh Regular',
    'Noto Sans Regular',
  ],
}

export const turntable_casing_width = 2

export const trainProtectionColor = (field) => [
  'case',
  ['boolean', ['feature-state', 'hover'], false],
  colors.hover.main,
  ...signals_railway_line.train_protections.flatMap((train_protection) => [
    ['==', ['get', field], train_protection.train_protection],
    train_protection.color,
  ]),
  'grey',
]

export const railway_casing_add = 1
export const bridge_casing_add = 3

// TODO move to variable
export const abandoned_dasharray = [2.5, 2.5]
export const disused_dasharray = [2.5, 2.5]
export const razed_dasharray = [1, 5]
export const construction_dasharray = [4.5, 4.5]
export const proposed_dasharray = [1, 4]
export const present_dasharray = [1]

export const train_protection_construction_dasharray = [2, 8]

// Turbo color map
// See https://research.google/blog/turbo-an-improved-rainbow-colormap-for-visualization/
// See https://gist.github.com/mikhailov-work/ee72ba4191942acecc03fe6da94fc73f?permalink_comment_id=3708728#gistcomment-3708728
// See https://github.com/hiddewie/OpenRailwayMap-vector/issues/668
export const turboColorMap = (valueExpression, min, max, power) => [
  'interpolate-hcl',
  ['linear'],
  ['^', ['/', ['-', ['max', min, ['min', valueExpression, max]], min], max - min], power],
  0,
  'hsl(285 53.2% 15.1%)',
  25 / 255,
  'hsl(231 57% 53.5%)',
  50 / 255,
  'hsl(212 101.1% 62.7%)',
  75 / 255,
  'hsl(179 78.2% 46.7%)',
  100 / 255,
  'hsl(145 92% 45%)',
  125 / 255,
  'hsl(91 100% 45%)',
  150 / 255,
  'hsl(62 75.5% 55%)',
  175 / 255,
  'hsl(36 99% 60.2%)',
  200 / 255,
  'hsl(21 91.7% 52.5%)',
  225 / 255,
  'hsl(12 96.2% 41.4%)',
  250 / 255,
  'hsl(3 97.2% 27.8%)',
  255 / 255,
  'hsl(1 95.2% 24.7%)',
]

export const speedColor = [
  'case',
  ['==', ['get', 'maxspeed'], null],
  'gray',
  turboColorMap(['get', 'maxspeed'], 10, 380, 0.8),
]
export const speedHoverColor = [
  'case',
  ['all', ['!=', ['get', 'maxspeed'], null], ['>=', ['get', 'maxspeed'], 200], ['<=', ['get', 'maxspeed'], 340]],
  colors.hover.alternative,
  colors.hover.main,
]

export const electrification_construction_dashes = [2.5, 2.5]
export const electrification_proposed_dashes = [2, 4]

export const color_no = 'black'
export const color_delectrified = '#70584D'
export const color_lt750v_dc = '#FF79B8'
export const color_750v_dc = '#F930FF'
export const color_gt750v_lt1kv_dc = '#D033FF'
export const color_1kv_dc = '#5C1CCB'
export const color_gt1kv_lt1500v_dc = '#007ACB'
export const color_1500v_dc = '#0098CB'
export const color_gt1500v_lt3kv_dc = '#00B7CB'
export const color_3kv_dc = '#0000FF'
export const color_gt3kv_dc = '#1969FF'
export const color_lt15kv_ac = '#97FF2F'
export const color_gte15kv_lt25kv_ac = '#F1F100'
export const color_gte25kv_ac = '#FF9F19'
export const color_15kv_16_67hz = '#00FF00'
export const color_15kv_16_7hz = '#00CB66'
export const color_25kv_50hz = '#FF0000'
export const color_25kv_60hz = '#C00000'
export const color_12kv_25hz = '#CCCC00'
export const color_12_5kv_60hz = '#999900'
export const color_20kv_50hz = '#FFCC66'
export const color_20kv_60hz = '#FF9966'

export const electrificationVoltageFrequencyColor = (voltageProperty, frequencyProperty) => [
  'case',
  ['boolean', ['feature-state', 'hover'], false],
  ['case', ['==', ['get', voltageProperty], 25000], colors.hover.alternative, colors.hover.main],
  ['all', ['==', ['get', frequencyProperty], 60], ['==', ['get', voltageProperty], 25000]],
  color_25kv_60hz,
  ['all', ['==', ['get', frequencyProperty], 50], ['==', ['get', voltageProperty], 25000]],
  color_25kv_50hz,
  ['all', ['==', ['get', frequencyProperty], 60], ['==', ['get', voltageProperty], 20000]],
  color_20kv_60hz,
  ['all', ['==', ['get', frequencyProperty], 50], ['==', ['get', voltageProperty], 20000]],
  color_20kv_50hz,
  [
    'all',
    ['!=', ['get', frequencyProperty], null],
    ['<', 16.665, ['get', frequencyProperty]],
    ['<', ['get', frequencyProperty], 16.675],
    ['==', ['get', voltageProperty], 15000],
  ],
  color_15kv_16_67hz,
  [
    'all',
    ['!=', ['get', frequencyProperty], null],
    ['<', 16.65, ['get', frequencyProperty]],
    ['<', ['get', frequencyProperty], 16.75],
    ['==', ['get', voltageProperty], 15000],
  ],
  color_15kv_16_7hz,
  ['all', ['==', ['get', frequencyProperty], 60], ['==', ['get', voltageProperty], 12500]],
  color_12_5kv_60hz,
  ['all', ['==', ['get', frequencyProperty], 25], ['==', ['get', voltageProperty], 12000]],
  color_12kv_25hz,
  [
    'all',
    ['==', ['get', frequencyProperty], 0],
    ['!=', ['get', voltageProperty], null],
    ['>', ['get', voltageProperty], 3000],
  ],
  color_gt3kv_dc,
  ['all', ['==', ['get', frequencyProperty], 0], ['==', ['get', voltageProperty], 3000]],
  color_3kv_dc,
  [
    'all',
    ['==', ['get', frequencyProperty], 0],
    ['!=', ['get', voltageProperty], null],
    ['>', 3000, ['get', voltageProperty]],
    ['>', ['get', voltageProperty], 1500],
  ],
  color_gt1500v_lt3kv_dc,
  ['all', ['==', ['get', frequencyProperty], 0], ['==', ['get', voltageProperty], 1500]],
  color_1500v_dc,
  [
    'all',
    ['==', ['get', frequencyProperty], 0],
    ['!=', ['get', voltageProperty], null],
    ['>', 1500, ['get', voltageProperty]],
    ['>', ['get', voltageProperty], 1000],
  ],
  color_gt1kv_lt1500v_dc,
  ['all', ['==', ['get', frequencyProperty], 0], ['==', ['get', voltageProperty], 1000]],
  color_1kv_dc,
  [
    'all',
    ['==', ['get', frequencyProperty], 0],
    ['!=', ['get', voltageProperty], null],
    ['>', 1000, ['get', voltageProperty]],
    ['>', ['get', voltageProperty], 750],
  ],
  color_gt750v_lt1kv_dc,
  ['all', ['==', ['get', frequencyProperty], 0], ['==', ['get', voltageProperty], 750]],
  color_750v_dc,
  [
    'all',
    ['==', ['get', frequencyProperty], 0],
    ['!=', ['get', voltageProperty], null],
    ['>', 750, ['get', voltageProperty]],
  ],
  color_lt750v_dc,
  [
    'all',
    ['!=', ['get', frequencyProperty], 0],
    ['!=', ['get', voltageProperty], null],
    [
      'any',
      ['>', ['get', voltageProperty], 25000],
      [
        'all',
        ['!=', ['get', frequencyProperty], 50],
        ['!=', ['get', frequencyProperty], 60],
        ['>', ['get', voltageProperty], 25000],
      ],
    ],
  ],
  color_gte25kv_ac,
  [
    'all',
    ['!=', ['get', frequencyProperty], 0],
    ['!=', ['get', voltageProperty], null],
    ['all', ['>', 25000, ['get', voltageProperty]], ['>', ['get', voltageProperty], 15000]],
  ],
  color_gte15kv_lt25kv_ac,
  [
    'all',
    ['!=', ['get', frequencyProperty], 0],
    ['!=', ['get', voltageProperty], null],
    ['>', 15000, ['get', voltageProperty]],
  ],
  color_lt15kv_ac,
  [
    'any',
    ['==', ['get', 'electrification_state'], 'deelectrified'],
    ['==', ['get', 'electrification_state'], 'abandoned'],
  ],
  color_delectrified,
  [
    'any',
    ['==', ['get', 'electrification_state'], 'no'],
    ['==', ['get', 'electrification_state'], 'construction'],
    ['==', ['get', 'electrification_state'], 'proposed'],
  ],
  color_no,
  'gray',
]

export const electrificationVoltageMaximumCurrentColor = (maximumCurrentProperty) => [
  'case',
  ['boolean', ['feature-state', 'hover'], false],
  colors.hover.main,
  ['!=', ['get', maximumCurrentProperty], null],
  turboColorMap(['get', maximumCurrentProperty], 300, 4400, 0.9),
  [
    'any',
    ['==', ['get', 'electrification_state'], 'deelectrified'],
    ['==', ['get', 'electrification_state'], 'abandoned'],
  ],
  color_delectrified,
  [
    'any',
    ['==', ['get', 'electrification_state'], 'no'],
    ['==', ['get', 'electrification_state'], 'construction'],
    ['==', ['get', 'electrification_state'], 'proposed'],
  ],
  color_no,
  'gray',
]

export const electrificationPowerColor = (voltageProperty, maximumCurrentProperty, frequencyProperty) => [
  'case',
  ['boolean', ['feature-state', 'hover'], false],
  colors.hover.main,
  [
    'all',
    ['!=', ['get', voltageProperty], null],
    ['!=', ['get', maximumCurrentProperty], null],
    ['!=', ['get', frequencyProperty], null],
    ['!=', ['get', frequencyProperty], 0],
  ],
  turboColorMap(
    ['*', ['get', voltageProperty], ['get', maximumCurrentProperty], 1 / Math.sqrt(2)],
    1_500_000,
    32_000_000,
    0.3,
  ),
  ['all', ['!=', ['get', voltageProperty], null], ['!=', ['get', maximumCurrentProperty], null]],
  turboColorMap(['*', ['get', voltageProperty], ['get', maximumCurrentProperty]], 1_500_000, 32_000_000, 0.3),
  [
    'any',
    ['==', ['get', 'electrification_state'], 'deelectrified'],
    ['==', ['get', 'electrification_state'], 'abandoned'],
  ],
  color_delectrified,
  [
    'any',
    ['==', ['get', 'electrification_state'], 'no'],
    ['==', ['get', 'electrification_state'], 'construction'],
    ['==', ['get', 'electrification_state'], 'proposed'],
  ],
  color_no,
  'gray',
]

export const gauge_construction_dashes = [3, 3]
export const dual_construction_dashes = [1.5, 4.5]
export const multi_construction_dashes = [0, 1, 1, 4]
export const gauge_dual_gauge_dashes = [4.5, 4.5]
export const gauge_multi_gauge_dashes = [0, 3, 3, 3]

export const color_gauge_0064 = '#006060'
export const color_gauge_0089 = '#008080'
export const color_gauge_0127 = '#00A0A0'
export const color_gauge_0184 = '#00C0C0'
export const color_gauge_0190 = '#00E0E0'
export const color_gauge_0260 = '#00FFFF'
export const color_gauge_0381 = '#80FFFF'
export const color_gauge_0500 = '#A0FFFF'
export const color_gauge_0597 = '#C0FFFF'
export const color_gauge_0600 = '#E0FFFF'
export const color_gauge_0610 = '#FFE0FF'
export const color_gauge_0700 = '#FFC0FF'
export const color_gauge_0750 = '#FFA0FF'
export const color_gauge_0760 = '#FF80FF'
export const color_gauge_0762 = '#FF60FF'
export const color_gauge_0785 = '#FF40FF'
export const color_gauge_0800 = '#FF00FF'
export const color_gauge_0891 = '#E000FF'
export const color_gauge_0900 = '#C000FF'
export const color_gauge_0914 = '#A000FF'
export const color_gauge_0950 = '#8000FF'
export const color_gauge_1000 = '#6000FF'
export const color_gauge_1009 = '#4000FF'
export const color_gauge_1050 = '#0000FF'
export const color_gauge_1067 = '#0000E0'
export const color_gauge_1100 = '#0000C0'
export const color_gauge_1200 = '#0000A0'
export const color_gauge_1372 = '#000080'
export const color_gauge_1422 = '#000060'
export const color_gauge_1432 = '#000040'
export const color_gauge_1435 = '#000000'
export const color_gauge_1440 = '#400000'
export const color_gauge_1445 = '#600000'
export const color_gauge_1450 = '#700000'
export const color_gauge_1458 = '#800000'
export const color_gauge_1495 = '#A00000'
export const color_gauge_1520 = '#C00000'
export const color_gauge_1522 = '#E00000'
export const color_gauge_1524 = '#FF0000'
export const color_gauge_1581 = '#FF6000'
export const color_gauge_1588 = '#FF8000'
export const color_gauge_1600 = '#FFA000'
export const color_gauge_1668 = '#FFC000'
export const color_gauge_1676 = '#FFE000'
export const color_gauge_1700 = '#FFFF00'
export const color_gauge_1800 = '#E0FF00'
export const color_gauge_1880 = '#C0FF00'
export const color_gauge_2000 = '#A0FF00'
export const color_gauge_miniature = '#80C0C0'
export const color_gauge_monorail = '#C0C080'
export const color_gauge_broad = '#FFC0C0'
export const color_gauge_narrow = '#C0C0FF'
export const color_gauge_standard = '#808080'
export const color_gauge_unknown = '#C0C0C0'

export const gaugeColor = (gaugeProperty, gaugeIntProperty) => [
  'case',
  ['boolean', ['feature-state', 'hover'], false],
  [
    'case',
    [
      'all',
      ['!=', ['get', gaugeIntProperty], null],
      ['>=', 1450, ['get', gaugeIntProperty]],
      ['<=', ['get', gaugeIntProperty], 1524],
    ],
    colors.hover.alternative,
    colors.hover.main,
  ],
  // monorails or tracks with monorail gauge value
  [
    'any',
    ['==', ['get', 'feature'], 'monorail'],
    [
      'all',
      ['==', ['get', gaugeProperty], 'monorail'],
      [
        'any',
        ['==', ['get', 'feature'], 'rail'],
        ['==', ['get', 'feature'], 'light_rail'],
        ['==', ['get', 'feature'], 'subway'],
        ['==', ['get', 'feature'], 'tram'],
      ],
    ],
  ],
  color_gauge_monorail,
  // other tracks with inaccurate gauge value
  [
    'all',
    ['==', ['get', gaugeProperty], 'standard'],
    [
      'any',
      ['==', ['get', 'feature'], 'rail'],
      ['==', ['get', 'feature'], 'light_rail'],
      ['==', ['get', 'feature'], 'subway'],
      ['==', ['get', 'feature'], 'tram'],
    ],
  ],
  color_gauge_standard,
  [
    'all',
    ['==', ['get', gaugeProperty], 'broad'],
    [
      'any',
      ['==', ['get', 'feature'], 'rail'],
      ['==', ['get', 'feature'], 'light_rail'],
      ['==', ['get', 'feature'], 'subway'],
      ['==', ['get', 'feature'], 'tram'],
    ],
  ],
  color_gauge_broad,
  [
    'any',
    [
      'all',
      ['==', ['get', gaugeProperty], 'narrow'],
      [
        'any',
        ['==', ['get', 'feature'], 'rail'],
        ['==', ['get', 'feature'], 'light_rail'],
        ['==', ['get', 'feature'], 'subway'],
        ['==', ['get', 'feature'], 'tram'],
      ],
    ],
    [
      'all',
      ['==', ['get', 'feature'], 'narrow_gauge'],
      [
        'any',
        ['==', ['get', gaugeProperty], 'narrow'],
        ['==', ['get', gaugeProperty], 'broad'],
        ['==', ['get', gaugeProperty], 'standard'],
        ['==', ['get', gaugeProperty], 'unknown'],
        ['==', ['get', gaugeProperty], null],
      ],
    ],
  ],
  color_gauge_narrow,
  // miniature tracks with inaccurate gauge value
  [
    'all',
    ['==', ['get', 'feature'], 'miniature'],
    [
      'any',
      ['==', ['get', gaugeProperty], 'narrow'],
      ['==', ['get', gaugeProperty], 'broad'],
      ['==', ['get', gaugeProperty], 'standard'],
      ['==', ['get', gaugeProperty], 'unknown'],
      ['==', ['get', gaugeProperty], null],
    ],
  ],
  color_gauge_miniature,
  // unknown high numeric gauge values
  ['all', ['!=', ['get', gaugeIntProperty], null], ['>=', ['get', gaugeIntProperty], 3000]],
  color_gauge_unknown,
  // colors for numeric gauge values
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 88, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 63],
  ],
  color_gauge_0064,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 127, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 88],
  ],
  color_gauge_0089,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 184, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 127],
  ],
  color_gauge_0127,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 190, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 184],
  ],
  color_gauge_0184,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 260, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 190],
  ],
  color_gauge_0190,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 380, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 260],
  ],
  color_gauge_0260,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 500, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 380],
  ],
  color_gauge_0381,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 597, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 500],
  ],
  color_gauge_0500,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 600, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 597],
  ],
  color_gauge_0597,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 609, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 600],
  ],
  color_gauge_0600,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 700, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 609],
  ],
  color_gauge_0610,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 750, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 700],
  ],
  color_gauge_0700,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 760, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 750],
  ],
  color_gauge_0750,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 762, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 760],
  ],
  color_gauge_0760,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 785, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 762],
  ],
  color_gauge_0762,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 800, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 785],
  ],
  color_gauge_0785,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 891, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 800],
  ],
  color_gauge_0800,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 900, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 891],
  ],
  color_gauge_0891,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 914, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 900],
  ],
  color_gauge_0900,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 950, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 914],
  ],
  color_gauge_0914,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1000, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 950],
  ],
  color_gauge_0950,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1009, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1000],
  ],
  color_gauge_1000,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1050, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1009],
  ],
  color_gauge_1009,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1066, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1050],
  ],
  color_gauge_1050,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1100, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1066],
  ],
  color_gauge_1067,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1200, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1100],
  ],
  color_gauge_1100,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1372, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1200],
  ],
  color_gauge_1200,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1422, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1372],
  ],
  color_gauge_1372,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1432, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1422],
  ],
  color_gauge_1422,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1435, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1432],
  ],
  color_gauge_1432,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1440, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1435],
  ],
  color_gauge_1435,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1445, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1440],
  ],
  color_gauge_1440,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1450, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1445],
  ],
  color_gauge_1445,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1458, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1450],
  ],
  color_gauge_1450,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1495, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1458],
  ],
  color_gauge_1458,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1520, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1495],
  ],
  color_gauge_1495,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1522, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1520],
  ],
  color_gauge_1520,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1524, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1522],
  ],
  color_gauge_1522,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1581, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1524],
  ],
  color_gauge_1524,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1588, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1581],
  ],
  color_gauge_1581,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1600, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1588],
  ],
  color_gauge_1588,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1668, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1600],
  ],
  color_gauge_1600,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1672, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1668],
  ],
  color_gauge_1668,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1700, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1672],
  ],
  color_gauge_1676,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1800, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1700],
  ],
  color_gauge_1700,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 1880, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1800],
  ],
  color_gauge_1800,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 2000, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 1880],
  ],
  color_gauge_1880,
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 3000, ['get', gaugeIntProperty]],
    ['>=', ['get', gaugeIntProperty], 2000],
  ],
  color_gauge_2000,
  // color for unknown low numeric gauge values
  [
    'all',
    ['!=', ['get', gaugeIntProperty], null],
    ['>', 63, ['get', gaugeIntProperty]],
    ['>', ['get', gaugeIntProperty], 0],
  ],
  color_gauge_unknown,
  'gray',
]

export const loadingGaugeFillColor = [
  'match',
  ['get', 'loading_gauge'],
  ...loading_gauges.loading_gauges.flatMap((loading_gauge) => [loading_gauge.value, loading_gauge.color]),
  'gray',
]
export const trackClassFillColor = [
  'match',
  ['get', 'track_class'],
  ...track_classes.track_classes.flatMap((track_class) => [track_class.value, track_class.color]),
  'gray',
]

export const searchResults = {
  id: 'search',
  type: 'circle',
  source: 'search',
  paint: {
    'circle-radius': 8,
    'circle-color': 'rgba(183, 255, 0, 0.7)',
    'circle-stroke-width': 2,
    'circle-stroke-color': 'black',
  },
}

export const railwayLine = (text, layers) => [
  // Tunnels

  ...layers.flatMap(({ id, minzoom, maxzoom, source, sourceLayer, visibility, filter, width, states, sort }) =>
    Object.entries(states).map(([state, dash]) => ({
      id: `${id}_tunnel_casing_${state}`,
      type: 'line',
      minzoom,
      maxzoom,
      source,
      'source-layer': sourceLayer || 'railway_line_high',
      filter: ['all', ['==', ['get', 'state'], state], ['==', ['get', 'tunnel'], true], filter ?? true].filter(
        (it) => it !== true,
      ),
      layout: {
        visibility: [
          'case',
          visibility ? ['==', visibility, false] : false,
          'none',
          ['<', ['global-state', 'date'], defaultDate],
          'none',
          state === 'construction'
            ? ['global-state', 'showConstructionInfrastructure']
            : state === 'proposed'
              ? ['global-state', 'showProposedInfrastructure']
              : state === 'abandoned'
                ? ['global-state', 'showAbandonedInfrastructure']
                : state === 'razed'
                  ? ['global-state', 'showRazedInfrastructure']
                  : true,
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': dash ? 'butt' : 'round',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': colors.casing,
        'line-width': width,
        'line-gap-width': railway_casing_add,
        'line-dasharray': dash ?? undefined,
      },
    })),
  ),
  ...layers.flatMap(
    ({ id, minzoom, maxzoom, source, sourceLayer, visibility, filter, width, color, hoverColor, states, sort }) => [
      ...Object.entries(states).map(([state, dash]) => ({
        id: `${id}_tunnel_fill_${state}`,
        type: 'line',
        minzoom,
        maxzoom,
        source,
        'source-layer': sourceLayer || 'railway_line_high',
        filter: ['all', ['==', ['get', 'state'], state], ['==', ['get', 'tunnel'], true], filter ?? true].filter(
          (it) => it !== true,
        ),
        layout: {
          visibility: [
            'case',
            visibility ? ['==', visibility, false] : false,
            'none',
            ['<', ['global-state', 'date'], defaultDate],
            'none',
            state === 'construction'
              ? ['global-state', 'showConstructionInfrastructure']
              : state === 'proposed'
                ? ['global-state', 'showProposedInfrastructure']
                : state === 'abandoned'
                  ? ['global-state', 'showAbandonedInfrastructure']
                  : state === 'razed'
                    ? ['global-state', 'showRazedInfrastructure']
                    : true,
            'visible',
            'none',
          ],
          'line-join': 'round',
          'line-cap': dash ? 'butt' : 'round',
          'line-sort-key': sort,
        },
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            hoverColor || colors.hover.main,
            color,
          ],
          'line-width': width,
          'line-dasharray': dash ?? undefined,
        },
      })),
    ],
  ),
  ...layers.flatMap(({ id, minzoom, maxzoom, source, sourceLayer, visibility, filter, width, states, sort }) => ({
    id: `${id}_tunnel_cover`,
    type: 'line',
    minzoom: Math.max(minzoom, 8),
    maxzoom,
    source,
    'source-layer': sourceLayer || 'railway_line_high',
    filter: [
      'all',
      [
        'any',
        ...Object.keys(states).map((state) =>
          state === 'construction'
            ? ['all', ['global-state', 'showConstructionInfrastructure'], ['==', ['get', 'state'], state]]
            : state === 'proposed'
              ? ['all', ['global-state', 'showProposedInfrastructure'], ['==', ['get', 'state'], state]]
              : state === 'abandoned'
                ? ['all', ['global-state', 'showAbandonedInfrastructure'], ['==', ['get', 'state'], state]]
                : state === 'razed'
                  ? ['all', ['global-state', 'showRazedInfrastructure'], ['==', ['get', 'state'], state]]
                  : ['==', ['get', 'state'], state],
        ),
      ],
      ['==', ['get', 'tunnel'], true],
      ['>=', ['get', 'way_length'], ['interpolate', ['exponential', 0.5], ['zoom'], 8, 1500, 16, 0]],
      filter ?? true,
    ].filter((it) => it !== true),
    layout: {
      visibility: [
        'case',
        visibility ? ['==', visibility, false] : false,
        'none',
        ['<', ['global-state', 'date'], defaultDate],
        'none',
        'visible',
      ],
      'line-join': 'round',
      'line-cap': 'butt',
      'line-sort-key': sort,
    },
    paint: {
      'line-color': colors.styles.standard.tunnelCover,
      'line-width': width,
    },
  })),
  ...layers.flatMap(({ id, visibility, filter, color, states }) =>
    preferredDirectionLayer(
      `${id}_tunnel_preferred_direction`,
      [
        'all',
        ['==', ['get', 'tunnel'], true],
        [
          'any',
          ...Object.keys(states).map((state) =>
            state === 'construction'
              ? ['all', ['global-state', 'showConstructionInfrastructure'], ['==', ['get', 'state'], state]]
              : state === 'proposed'
                ? ['all', ['global-state', 'showProposedInfrastructure'], ['==', ['get', 'state'], state]]
                : state === 'abandoned'
                  ? ['all', ['global-state', 'showAbandonedInfrastructure'], ['==', ['get', 'state'], state]]
                  : state === 'razed'
                    ? ['all', ['global-state', 'showRazedInfrastructure'], ['==', ['get', 'state'], state]]
                    : ['==', ['get', 'state'], state],
          ),
        ],
        [
          'any',
          ['==', ['get', 'preferred_direction'], 'forward'],
          ['==', ['get', 'preferred_direction'], 'backward'],
          ['==', ['get', 'preferred_direction'], 'both'],
        ],
        filter ?? true,
      ].filter((it) => it !== true),
      color,
      visibility,
    ),
  ),

  // Ground

  ...layers.flatMap(({ id, minzoom, maxzoom, source, sourceLayer, visibility, filter, width, states, sort }) =>
    Object.entries(states).map(([state, dash]) => ({
      id: `${id}_casing_${state}`,
      type: 'line',
      minzoom,
      maxzoom,
      source,
      'source-layer': sourceLayer || 'railway_line_high',
      filter: [
        'all',
        ['==', ['get', 'state'], state],
        ['!=', ['==', ['get', 'bridge'], true], true],
        ['!=', ['get', 'tunnel'], true],
        filter ?? true,
      ].filter((it) => it !== true),
      layout: {
        visibility: [
          'case',
          visibility ? ['==', visibility, false] : false,
          'none',
          ['<', ['global-state', 'date'], defaultDate],
          'none',
          state === 'construction'
            ? ['global-state', 'showConstructionInfrastructure']
            : state === 'proposed'
              ? ['global-state', 'showProposedInfrastructure']
              : state === 'abandoned'
                ? ['global-state', 'showAbandonedInfrastructure']
                : state === 'razed'
                  ? ['global-state', 'showAbandonedInfrastructure']
                  : true,
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': 'butt',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': colors.casing,
        'line-width': width,
        'line-gap-width': railway_casing_add,
        'line-dasharray': dash ?? undefined,
      },
    })),
  ),
  ...layers.flatMap(
    ({ id, minzoom, maxzoom, source, sourceLayer, visibility, filter, width, color, hoverColor, states, sort }) => [
      ...Object.entries(states).map(([state, dash]) => ({
        id: `${id}_fill_${state}`,
        type: 'line',
        minzoom,
        maxzoom,
        source,
        'source-layer': sourceLayer || 'railway_line_high',
        filter: [
          'all',
          ['==', ['get', 'state'], state],
          ['!=', ['==', ['get', 'bridge'], true], true],
          ['!=', ['get', 'tunnel'], true],
          filter ?? true,
        ].filter((it) => it !== true),
        layout: {
          visibility: [
            'case',
            visibility ? ['==', visibility, false] : false,
            'none',
            ['<', ['global-state', 'date'], defaultDate],
            'none',
            state === 'construction'
              ? ['global-state', 'showConstructionInfrastructure']
              : state === 'proposed'
                ? ['global-state', 'showProposedInfrastructure']
                : state === 'abandoned'
                  ? ['global-state', 'showAbandonedInfrastructure']
                  : state === 'razed'
                    ? ['global-state', 'showRazedInfrastructure']
                    : true,
            'visible',
            'none',
          ],
          'line-join': 'round',
          'line-cap': dash ? 'butt' : 'round',
          'line-sort-key': sort,
        },
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            hoverColor || colors.hover.main,
            color,
          ],
          'line-width': width,
          'line-dasharray': dash ?? undefined,
        },
      })),
    ],
  ),

  // Bridges

  ...layers
    .filter(({ states }) => 'present' in states)
    .flatMap(({ id, minzoom, maxzoom, source, sourceLayer, visibility, filter, width, sort }) => [
      {
        id: `${id}_bridge_railing`,
        type: 'line',
        minzoom: Math.max(minzoom, 8),
        maxzoom,
        source,
        'source-layer': sourceLayer || 'railway_line_high',
        filter: [
          'all',
          ['==', ['get', 'state'], 'present'],
          ['==', ['get', 'bridge'], true],
          ['>=', ['get', 'way_length'], ['interpolate', ['exponential', 0.5], ['zoom'], 8, 1500, 16, 0]],
          filter ?? true,
        ].filter((it) => it !== true),
        layout: {
          visibility: [
            'case',
            visibility ? ['==', visibility, false] : false,
            'none',
            ['<', ['global-state', 'date'], defaultDate],
            'none',
            'visible',
          ],
          'line-join': 'round',
          'line-cap': 'butt',
          'line-sort-key': sort,
        },
        paint: {
          'line-color': colors.styles.standard.casing.bridge,
          'line-width': width,
          'line-gap-width': bridge_casing_add,
        },
      },
      {
        id: `${id}_bridge_casing`,
        type: 'line',
        minzoom: Math.max(minzoom, 8),
        maxzoom,
        source,
        'source-layer': sourceLayer || 'railway_line_high',
        filter: [
          'all',
          ['==', ['get', 'state'], 'present'],
          ['==', ['get', 'bridge'], true],
          ['>=', ['get', 'way_length'], ['interpolate', ['exponential', 0.5], ['zoom'], 8, 1500, 16, 0]],
          filter ?? true,
        ].filter((it) => it !== true),
        layout: {
          visibility: [
            'case',
            visibility ? ['==', visibility, false] : false,
            'none',
            ['<', ['global-state', 'date'], defaultDate],
            'none',
            'visible',
          ],
          'line-join': 'round',
          'line-cap': 'butt',
          'line-sort-key': sort,
        },
        paint: {
          'line-color': colors.casing,
          'line-width': width,
          'line-gap-width': railway_casing_add,
        },
      },
    ]),

  ...layers.flatMap(
    ({ id, minzoom, maxzoom, source, sourceLayer, visibility, filter, width, color, hoverColor, states, sort }) => [
      ...Object.entries(states).map(([state, dash]) => ({
        id: `${id}_bridge_fill_${state}`,
        type: 'line',
        minzoom,
        maxzoom,
        source,
        'source-layer': sourceLayer || 'railway_line_high',
        filter: ['all', ['==', ['get', 'state'], state], ['==', ['get', 'bridge'], true], filter ?? true].filter(
          (it) => it !== true,
        ),
        layout: {
          visibility: [
            'case',
            visibility ? ['==', visibility, false] : false,
            'none',
            ['<', ['global-state', 'date'], defaultDate],
            'none',
            state === 'construction'
              ? ['global-state', 'showConstructionInfrastructure']
              : state === 'proposed'
                ? ['global-state', 'showProposedInfrastructure']
                : state === 'abandoned'
                  ? ['global-state', 'showAbandonedInfrastructure']
                  : state === 'razed'
                    ? ['global-state', 'showRazedInfrastructure']
                    : true,
            'visible',
            'none',
          ],
          'line-join': 'round',
          'line-cap': dash ? 'butt' : 'round',
          'line-sort-key': sort,
        },
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            hoverColor || colors.hover.main,
            color,
          ],
          'line-width': width,
          'line-dasharray': dash ?? undefined,
        },
      })),
    ],
  ),

  // Preferred direction

  ...layers.flatMap(({ id, visibility, filter, color, states }) =>
    preferredDirectionLayer(
      `${id}_preferred_direction`,
      [
        'all',
        [
          'any',
          ...Object.keys(states).map((state) =>
            state === 'construction'
              ? ['all', ['global-state', 'showConstructionInfrastructure'], ['==', ['get', 'state'], state]]
              : state === 'proposed'
                ? ['all', ['global-state', 'showProposedInfrastructure'], ['==', ['get', 'state'], state]]
                : state === 'abandoned'
                  ? ['all', ['global-state', 'showAbandonedInfrastructure'], ['==', ['get', 'state'], state]]
                  : state === 'razed'
                    ? ['all', ['global-state', 'showRazedInfrastructure'], ['==', ['get', 'state'], state]]
                    : ['==', ['get', 'state'], state],
          ),
        ],
        ['!=', ['get', 'tunnel'], true],
        [
          'any',
          ['==', ['get', 'preferred_direction'], 'forward'],
          ['==', ['get', 'preferred_direction'], 'backward'],
          ['==', ['get', 'preferred_direction'], 'both'],
        ],
        filter ?? true,
      ].filter((it) => it !== true),
      color,
      visibility,
    ),
  ),

  // Text layers

  railwayKmText,

  ...layers.flatMap(({ id, minzoom, maxzoom, source, sourceLayer, visibility, filter, states }) => ({
    id: `${id}_text`,
    type: 'symbol',
    minzoom,
    maxzoom,
    source,
    'source-layer': sourceLayer || 'railway_line_high',
    filter: [
      'all',
      [
        'any',
        ...Object.keys(states).map((state) =>
          state === 'construction'
            ? ['all', ['global-state', 'showConstructionInfrastructure'], ['==', ['get', 'state'], state]]
            : state === 'proposed'
              ? ['all', ['global-state', 'showProposedInfrastructure'], ['==', ['get', 'state'], state]]
              : state === 'abandoned'
                ? ['all', ['global-state', 'showAbandonedInfrastructure'], ['==', ['get', 'state'], state]]
                : state === 'razed'
                  ? ['all', ['global-state', 'showRazedInfrastructure'], ['==', ['get', 'state'], state]]
                  : ['==', ['get', 'state'], state],
        ),
      ],
      filter ?? true,
    ].filter((it) => it !== true),
    paint: {
      'text-color': colors.railwayLine.text,
      'text-halo-color': ['case', ['boolean', ['feature-state', 'hover'], false], colors.hover.textHalo, colors.halo],
      'text-halo-width': 2,
    },
    layout: {
      visibility: [
        'case',
        visibility ? ['==', visibility, false] : false,
        'none',
        ['<', ['global-state', 'date'], defaultDate],
        'none',
        'visible',
      ],
      'symbol-z-order': 'source',
      'symbol-placement': 'line',
      'text-field': text,
      'text-font': font.bold,
      'text-size': 11,
      'text-padding': 10,
      'text-max-width': 5,
      'symbol-spacing': 200,
    },
  })),
]

export const historicalRailwayLine = (text, layers) => [
  // Tunnels

  ...layers.flatMap(({ id, minzoom, maxzoom, filter, width, sort, dash }) => [
    {
      id: `${id}_tunnel_casing`,
      type: 'line',
      minzoom,
      maxzoom,
      source: 'openhistoricalmap',
      'source-layer': 'transport_lines',
      filter: ['all', ['==', ['get', 'tunnel'], 1], filter ?? true].filter((it) => it !== true),
      layout: {
        visibility: [
          'case',
          ['all', ['global-state', 'allDates'], ['global-state', 'openHistoricalMap']],
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': 'butt',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': colors.casing,
        'line-width': width,
        'line-gap-width': railway_casing_add,
        'line-dasharray': abandoned_dasharray,
      },
    },
    {
      id: `${id}_tunnel_casing_historical`,
      type: 'line',
      minzoom,
      maxzoom,
      source: 'openhistoricalmap',
      'source-layer': 'transport_lines',
      filter: [
        'all',
        ['<=', ['coalesce', ['get', 'start_decdate'], 0.0], ['global-state', 'date']],
        ['<=', ['global-state', 'date'], ['coalesce', ['get', 'end_decdate'], 9999.0]],
        ['==', ['get', 'tunnel'], 1],
        filter ?? true,
      ].filter((it) => it !== true),
      layout: {
        visibility: [
          'case',
          ['all', ['<', ['global-state', 'date'], defaultDate], ['global-state', 'openHistoricalMap']],
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': dash ? 'butt' : 'round',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': colors.casing,
        'line-width': width,
        'line-gap-width': railway_casing_add,
        'line-dasharray': dash ?? undefined,
      },
    },
  ]),
  ...layers.flatMap(({ id, minzoom, maxzoom, filter, width, color, hoverColor, sort, dash }) => [
    {
      id: `${id}_tunnel_fill`,
      type: 'line',
      minzoom,
      maxzoom,
      source: 'openhistoricalmap',
      'source-layer': 'transport_lines',
      filter: ['all', ['==', ['get', 'tunnel'], 1], filter ?? true].filter((it) => it !== true),
      layout: {
        visibility: [
          'case',
          ['all', ['global-state', 'allDates'], ['global-state', 'openHistoricalMap']],
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': 'butt',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], hoverColor || colors.hover.main, color],
        'line-width': width,
        'line-dasharray': abandoned_dasharray,
      },
    },
    {
      id: `${id}_tunnel_fill_historical`,
      type: 'line',
      minzoom,
      maxzoom,
      source: 'openhistoricalmap',
      'source-layer': 'transport_lines',
      filter: [
        'all',
        ['<=', ['coalesce', ['get', 'start_decdate'], 0.0], ['global-state', 'date']],
        ['<=', ['global-state', 'date'], ['coalesce', ['get', 'end_decdate'], 9999.0]],
        ['==', ['get', 'tunnel'], 1],
        filter ?? true,
      ].filter((it) => it !== true),
      layout: {
        visibility: [
          'case',
          ['all', ['<', ['global-state', 'date'], defaultDate], ['global-state', 'openHistoricalMap']],
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': dash ? 'butt' : 'round',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], hoverColor || colors.hover.main, color],
        'line-width': width,
        'line-dasharray': dash ?? undefined,
      },
    },
  ]),
  ...layers.map(({ id, minzoom, maxzoom, filter, width, sort }) => ({
    id: `${id}_tunnel_cover`,
    type: 'line',
    minzoom: Math.max(minzoom, 8),
    maxzoom,
    source: 'openhistoricalmap',
    'source-layer': 'transport_lines',
    filter: [
      'all',
      ['<=', ['coalesce', ['get', 'start_decdate'], 0.0], ['global-state', 'date']],
      ['<=', ['global-state', 'date'], ['coalesce', ['get', 'end_decdate'], 9999.0]],
      ['==', ['get', 'tunnel'], 1],
      filter ?? true,
    ].filter((it) => it !== true),
    layout: {
      visibility: [
        'case',
        [
          'all',
          ['!', ['global-state', 'allDates']],
          ['<', ['global-state', 'date'], defaultDate],
          ['global-state', 'openHistoricalMap'],
        ],
        'visible',
        'none',
      ],
      'line-join': 'round',
      'line-cap': 'butt',
      'line-sort-key': sort,
    },
    paint: {
      'line-color': colors.styles.standard.tunnelCover,
      'line-width': width,
    },
  })),

  // Ground

  ...layers.flatMap(({ id, minzoom, maxzoom, filter, width, sort, dash }) => [
    {
      id: `${id}_casing`,
      type: 'line',
      minzoom,
      maxzoom,
      source: 'openhistoricalmap',
      'source-layer': 'transport_lines',
      filter: ['all', ['!=', ['get', 'bridge'], 1], ['!=', ['get', 'tunnel'], 1], filter ?? true].filter(
        (it) => it !== true,
      ),
      layout: {
        visibility: [
          'case',
          ['all', ['global-state', 'allDates'], ['global-state', 'openHistoricalMap']],
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': 'butt',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': colors.casing,
        'line-width': width,
        'line-gap-width': railway_casing_add,
        'line-dasharray': abandoned_dasharray,
      },
    },
    {
      id: `${id}_casing_historical`,
      type: 'line',
      minzoom,
      maxzoom,
      source: 'openhistoricalmap',
      'source-layer': 'transport_lines',
      filter: [
        'all',
        ['<=', ['coalesce', ['get', 'start_decdate'], 0.0], ['global-state', 'date']],
        ['<=', ['global-state', 'date'], ['coalesce', ['get', 'end_decdate'], 9999.0]],
        ['!=', ['get', 'bridge'], 1],
        ['!=', ['get', 'tunnel'], 1],
        filter ?? true,
      ].filter((it) => it !== true),
      layout: {
        visibility: [
          'case',
          ['all', ['<', ['global-state', 'date'], defaultDate], ['global-state', 'openHistoricalMap']],
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': 'butt',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': colors.casing,
        'line-width': width,
        'line-gap-width': railway_casing_add,
        'line-dasharray': dash ?? undefined,
      },
    },
  ]),
  ...layers.flatMap(({ id, minzoom, maxzoom, filter, width, color, hoverColor, sort, dash }) => [
    {
      id: `${id}_fill`,
      type: 'line',
      minzoom,
      maxzoom,
      source: 'openhistoricalmap',
      'source-layer': 'transport_lines',
      filter: ['all', ['!=', ['get', 'bridge'], 1], ['!=', ['get', 'tunnel'], 1], filter ?? true].filter(
        (it) => it !== true,
      ),
      layout: {
        visibility: [
          'case',
          ['all', ['global-state', 'allDates'], ['global-state', 'openHistoricalMap']],
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': 'butt',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], hoverColor || colors.hover.main, color],
        'line-width': width,
        'line-dasharray': abandoned_dasharray,
      },
    },
    {
      id: `${id}_fill_historical`,
      type: 'line',
      minzoom,
      maxzoom,
      source: 'openhistoricalmap',
      'source-layer': 'transport_lines',
      filter: [
        'all',
        ['<=', ['coalesce', ['get', 'start_decdate'], 0.0], ['global-state', 'date']],
        ['<=', ['global-state', 'date'], ['coalesce', ['get', 'end_decdate'], 9999.0]],
        ['!=', ['get', 'bridge'], 1],
        ['!=', ['get', 'tunnel'], 1],
        filter ?? true,
      ].filter((it) => it !== true),
      layout: {
        visibility: [
          'case',
          ['all', ['<', ['global-state', 'date'], defaultDate], ['global-state', 'openHistoricalMap']],
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': dash ? 'butt' : 'round',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], hoverColor || colors.hover.main, color],
        'line-width': width,
        'line-dasharray': dash ?? undefined,
      },
    },
  ]),

  // Bridges

  ...layers.flatMap(({ id, minzoom, maxzoom, filter, width, sort }) => [
    {
      id: `${id}_bridge_railing`,
      type: 'line',
      minzoom: Math.max(minzoom, 8),
      maxzoom,
      source: 'openhistoricalmap',
      'source-layer': 'transport_lines',
      filter: [
        'all',
        [
          'any',
          ['global-state', 'allDates'],
          [
            'all',
            ['<=', ['coalesce', ['get', 'start_decdate'], 0.0], ['global-state', 'date']],
            ['<=', ['global-state', 'date'], ['coalesce', ['get', 'end_decdate'], 9999.0]],
          ],
        ],
        ['==', ['get', 'bridge'], 1],
        filter ?? true,
      ].filter((it) => it !== true),
      layout: {
        visibility: [
          'case',
          [
            'all',
            ['any', ['global-state', 'allDates'], ['<', ['global-state', 'date'], defaultDate]],
            ['global-state', 'openHistoricalMap'],
          ],
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': 'butt',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': colors.styles.standard.casing.bridge,
        'line-width': width,
        'line-gap-width': bridge_casing_add,
      },
    },
    {
      id: `${id}_bridge_casing`,
      type: 'line',
      minzoom: Math.max(minzoom, 8),
      maxzoom,
      source: 'openhistoricalmap',
      'source-layer': 'transport_lines',
      filter: [
        'all',
        [
          'any',
          ['global-state', 'allDates'],
          [
            'all',
            ['<=', ['coalesce', ['get', 'start_decdate'], 0.0], ['global-state', 'date']],
            ['<=', ['global-state', 'date'], ['coalesce', ['get', 'end_decdate'], 9999.0]],
          ],
        ],
        ['==', ['get', 'bridge'], 1],
        filter ?? true,
      ].filter((it) => it !== true),
      layout: {
        visibility: [
          'case',
          [
            'all',
            ['any', ['global-state', 'allDates'], ['<', ['global-state', 'date'], defaultDate]],
            ['global-state', 'openHistoricalMap'],
          ],
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': 'butt',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': colors.casing,
        'line-width': width,
        'line-gap-width': railway_casing_add,
      },
    },
  ]),

  ...layers.flatMap(({ id, minzoom, maxzoom, filter, width, color, hoverColor, sort, dash }) => [
    {
      id: `${id}_bridge_fill`,
      type: 'line',
      minzoom,
      maxzoom,
      source: 'openhistoricalmap',
      'source-layer': 'transport_lines',
      filter: ['all', ['==', ['get', 'bridge'], 1], filter ?? true].filter((it) => it !== true),
      layout: {
        visibility: [
          'case',
          ['all', ['global-state', 'allDates'], ['global-state', 'openHistoricalMap']],
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': 'butt',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], hoverColor || colors.hover.main, color],
        'line-width': width,
        'line-dasharray': abandoned_dasharray,
      },
    },
    {
      id: `${id}_bridge_fill_historical`,
      type: 'line',
      minzoom,
      maxzoom,
      source: 'openhistoricalmap',
      'source-layer': 'transport_lines',
      filter: [
        'all',
        ['<=', ['coalesce', ['get', 'start_decdate'], 0.0], ['global-state', 'date']],
        ['<=', ['global-state', 'date'], ['coalesce', ['get', 'end_decdate'], 9999.0]],
        ['==', ['get', 'bridge'], 1],
        filter ?? true,
      ].filter((it) => it !== true),
      layout: {
        visibility: [
          'case',
          ['all', ['<', ['global-state', 'date'], defaultDate], ['global-state', 'openHistoricalMap']],
          'visible',
          'none',
        ],
        'line-join': 'round',
        'line-cap': dash ? 'butt' : 'round',
        'line-sort-key': sort,
      },
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], hoverColor || colors.hover.main, color],
        'line-width': width,
        'line-dasharray': dash ?? undefined,
      },
    },
  ]),

  // Text layers

  ...layers.flatMap(({ id, minzoom, maxzoom, filter }) => ({
    id: `${id}_text`,
    type: 'symbol',
    minzoom,
    maxzoom,
    source: 'openhistoricalmap',
    'source-layer': 'transport_lines',
    filter: [
      'all',
      [
        'any',
        ['global-state', 'allDates'],
        [
          'all',
          ['<=', ['coalesce', ['get', 'start_decdate'], 0.0], ['global-state', 'date']],
          ['<=', ['global-state', 'date'], ['coalesce', ['get', 'end_decdate'], 9999.0]],
        ],
      ],
      filter ?? true,
    ].filter((it) => it !== true),
    paint: {
      'text-color': colors.railwayLine.text,
      'text-halo-color': ['case', ['boolean', ['feature-state', 'hover'], false], colors.hover.textHalo, colors.halo],
      'text-halo-width': 2,
    },
    layout: {
      visibility: [
        'case',
        [
          'all',
          ['any', ['global-state', 'allDates'], ['<', ['global-state', 'date'], defaultDate]],
          ['global-state', 'openHistoricalMap'],
        ],
        'visible',
        'none',
      ],
      'symbol-z-order': 'source',
      'symbol-placement': 'line',
      'text-field': text,
      'text-font': font.bold,
      'text-size': 11,
      'text-padding': 10,
      'text-max-width': 5,
      'symbol-spacing': 400,
    },
  })),
]

export const railwayKmText = {
  id: 'railway_text_km',
  type: 'symbol',
  minzoom: 10,
  source: 'high',
  'source-layer': 'railway_text_km',
  paint: {
    'text-color': colors.km.text,
    'text-halo-color': ['case', ['boolean', ['feature-state', 'hover'], false], colors.hover.textHalo, colors.halo],
    'text-halo-width': 1,
  },
  layout: {
    visibility: ['case', ['<', ['global-state', 'date'], defaultDate], 'none', 'visible'],
    'symbol-z-order': 'source',
    'text-field': ['step', ['zoom'], ['get', 'pos_int'], 13, ['get', 'pos']],
    'text-font': ['Fira Code Bold'],
    'text-size': 11,
  },
}

export const preferredDirectionLayer = (id, filter, color, visibility) => ({
  id,
  type: 'symbol',
  minzoom: 15,
  source: 'high',
  'source-layer': 'railway_line_high',
  filter,
  paint: {
    'icon-color': ['case', ['boolean', ['feature-state', 'hover'], false], colors.hover.main, color],
    'icon-halo-color': ['case', ['boolean', ['feature-state', 'hover'], false], colors.hover.textHalo, colors.halo],
    'icon-halo-width': 2.0,
  },
  layout: {
    visibility: [
      'case',
      visibility ? ['==', visibility, false] : false,
      'none',
      ['<', ['global-state', 'date'], defaultDate],
      'none',
      'visible',
    ],
    'symbol-placement': 'line',
    'symbol-spacing': 750,
    'icon-overlap': 'always',
    'icon-image': [
      'match',
      ['get', 'preferred_direction'],
      'forward',
      'sdf:general/line-direction',
      'backward',
      'sdf:general/line-direction',
      'both',
      'sdf:general/line-direction-both',
      '',
    ],
    'icon-rotate': ['match', ['get', 'preferred_direction'], 'backward', 180, 0],
  },
})

export const imageLayerWithOutline = (id, spriteExpression, layer) => [
  {
    id: `${id}_outline`,
    ...layer,
    paint: {
      'icon-halo-color': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        colors.hover.iconHalo,
        colors.iconHalo,
      ],
      'icon-halo-blur': ['case', ['boolean', ['feature-state', 'hover'], false], 1.0, 0.0],
      'icon-halo-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3.0, 2.0],
    },
    layout: {
      ...(layer.layout || {}),
      visibility: ['case', ['<', ['global-state', 'date'], defaultDate], 'none', 'visible'],
      'icon-image': ['image', ['concat', 'sdf:', spriteExpression]],
    },
  },
  {
    id: `${id}_image`,
    ...layer,
    layout: {
      ...(layer.layout || {}),
      visibility: ['case', ['<', ['global-state', 'date'], defaultDate], 'none', 'visible'],
      'icon-image': ['image', spriteExpression],
    },
  },
]

export const hillshade = {
  id: 'hillshade',
  type: 'hillshade',
  source: 'dem',
  paint: {
    'hillshade-method': 'combined',
    'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 8, 0.2, 12, 0.4, 15, 0.8],
  },
  layout: {
    visibility: ['case', ['global-state', 'hillshade'], 'visible', 'none'],
  },
}

export const route = {
  id: 'route',
  type: 'line',
  source: 'route',
  layout: {
    visibility: ['case', ['<', ['global-state', 'date'], defaultDate], 'none', 'visible'],
    'line-join': 'round',
    'line-cap': 'round',
  },
  paint: {
    'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], colors.hover.main, colors.route],
    'line-width': 5,
  },
}
export const routeText = {
  id: 'route_text',
  type: 'symbol',
  source: 'route',
  paint: {
    'text-color': colors.railwayLine.text,
    'text-halo-color': ['case', ['boolean', ['feature-state', 'hover'], false], colors.hover.textHalo, colors.halo],
    'text-halo-width': 2,
  },
  layout: {
    visibility: ['case', ['<', ['global-state', 'date'], defaultDate], 'none', 'visible'],
    'symbol-z-order': 'source',
    'symbol-placement': 'line',
    'text-field': ['coalesce', ['get', 'name'], ['get', 'ref'], ''],
    'text-font': font.bold,
    'text-size': 11,
    'text-padding': 10,
    'text-max-width': 5,
    'symbol-spacing': 200,
  },
}
export const routeStops = {
  id: 'route_stops',
  type: 'circle',
  source: 'route_stops',
  paint: {
    'circle-color': 'white',
    'circle-radius': 3,
    'circle-stroke-width': 2,
    'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], colors.hover.main, colors.route],
  },
}

/**
 * Strategy for displaying railway lines
 *
 * Variables:
 * - state
 * - feature
 * - usage
 * - service
 *
 * Display tools, configurable per zoom level
 * - show/not show
 * - line width
 * - line color
 * - line dashes
 */

export const DATA_MAX_ZOOM = 15

export const capSourcesForDataMaxZoom = (originalSources) =>
  Object.fromEntries(
    Object.entries(originalSources).map(([name, source]) => {
      if (source?.type === 'vector' && source.url) {
        return [
          name,
          {
            ...source,
            maxzoom: DATA_MAX_ZOOM,
          },
        ]
      }
      return [name, source]
    }),
  )

export const capLayersForDataMaxZoom = (originalLayers) =>
  originalLayers.map((layer) => {
    const next = { ...layer }

    if (typeof next.minzoom === 'number' && next.minzoom > DATA_MAX_ZOOM) {
      next.minzoom = DATA_MAX_ZOOM
    }

    if (typeof next.maxzoom === 'number' && next.maxzoom > DATA_MAX_ZOOM) {
      delete next.maxzoom
    }

    return next
  })

export const makeStyle = (selectedStyle) => ({
  center: [12.55, 51.14], // default
  zoom: 3.75, // default
  glyphs: '/font/{fontstack}/{range}',
  metadata: {
    dataMaxZoom: DATA_MAX_ZOOM,
    z15Capped: true,
  },
  name: `OpenRailwayMap ${selectedStyle}`,
  sources: capSourcesForDataMaxZoom(sources),
  sprite: [
    {
      id: 'sdf',
      url: '/sdf_sprite/symbols',
    },
    {
      id: 'default',
      url: '/sprite/symbols',
    },
  ],
  version: 8,
  layers: capLayersForDataMaxZoom(layers[selectedStyle]),
  state: {
    date: {
      default: defaultDate,
    },
    allDates: {
      default: false,
    },
    theme: {
      default: 'light',
    },
    stationLowZoomLabel: {
      default: 'label',
    },
    showConstructionInfrastructure: {
      default: true,
    },
    showProposedInfrastructure: {
      default: true,
    },
    showAbandonedInfrastructure: {
      default: false,
    },
    showRazedInfrastructure: {
      default: false,
    },
    openHistoricalMap: {
      default: true,
    },
    hillshade: {
      default: false,
    },
    electrificationRailwayLine: {
      default: 'voltageFrequency',
    },
    trackRailwayLine: {
      default: 'gauge',
    },
  },
})
