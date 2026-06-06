import './screenshot-fixture.css';

import {
  type AnnotationFeaturePayload,
  type AnnotationPathPayload,
  type AnnotationPointPayload,
  type AnnotationPolygonPayload,
} from './annotation-model.js';
import type { AgentParticipant, CollaborationFixtureState, Peer } from './collaboration.js';
import { METRO_LINE10_POINTS, WALK_NANJING_BUND_POINTS, WALK_WUKANG_ANFU_POINTS } from './screenshot-fixture-data.js';
import { initialSortKey, type AnnotationFeature, type Layer } from './layer-model.js';
import type { LayerStore } from './layer-store.js';

export type ScreenshotFixtureMode = 'overview' | 'layers' | 'annotations' | 'sharing';
type ScreenshotFixtureView = {
  center: [number, number];
  zoom: number;
};
type ScreenshotFixtureLocale = 'en' | 'zh';
type DemoFeaturePayload =
  | Omit<AnnotationPointPayload, 'createdAt' | 'updatedAt' | 'updatedBy'>
  | Omit<AnnotationPathPayload, 'createdAt' | 'updatedAt' | 'updatedBy'>
  | Omit<AnnotationPolygonPayload, 'createdAt' | 'updatedAt' | 'updatedBy'>;

const CITYWALK_LAYER_ID = 'citywalk';
const ROUTE_LAYER_ID = 'citywalk-route';
const STOPS_LAYER_ID = 'citywalk-stops';
const LANDMARKS_LAYER_ID = 'citywalk-landmarks';

const WUKANG_MANSION: [number, number] = [121.43373, 31.20626];
const ANFU_ROAD: [number, number] = [121.43804, 31.21562];
const NANJING_EAST_ROAD: [number, number] = [121.4801, 31.2395];
const BUND_ORIGIN: [number, number] = [121.48416, 31.24439];
const BUND_LIGHTS_COORDINATE: [number, number] = [121.48763, 31.23534];
const GARDEN_BRIDGE_COORDINATE: [number, number] = [121.48574, 31.24531];

export const SCREENSHOT_FIXTURE_VIEW = {
  center: [121.4562, 31.22727] as [number, number],
  zoom: 13.55,
};

function screenshotFixtureLocale(): ScreenshotFixtureLocale {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get('screenshotLocale') || params.get('locale');
  const locale = explicit || navigator.languages?.[0] || navigator.language || 'en-US';
  return /^zh\b/i.test(locale) ? 'zh' : 'en';
}

function fixtureText(en: string, zh: string) {
  return screenshotFixtureLocale() === 'zh' ? zh : en;
}

const FRENCH_CONCESSION_AREA: [number, number][] = [
  [121.456183, 31.215327],
  [121.455229, 31.217042],
  [121.454628, 31.218286],
  [121.454215, 31.219195],
  [121.453652, 31.220435],
  [121.453145, 31.222027],
  [121.456183, 31.215327],
  [121.45359, 31.214674],
  [121.451785, 31.214195],
  [121.44999, 31.213689],
  [121.448453, 31.213264],
  [121.445678, 31.212544],
  [121.445148, 31.212459],
  [121.443418, 31.212352],
  [121.443159, 31.212205],
  [121.44197, 31.211432],
  [121.441109, 31.210872],
  [121.438939, 31.209471],
  [121.435243, 31.207081],
  [121.433269, 31.205835],
  [121.433269, 31.205835],
  [121.433267, 31.205837],
  [121.433217, 31.205979],
  [121.433015, 31.206532],
  [121.432805, 31.207156],
  [121.432437, 31.208182],
  [121.43137, 31.210559],
  [121.431089, 31.211185],
  [121.430585, 31.212962],
  [121.430585, 31.212962],
  [121.430706, 31.212973],
  [121.430878, 31.21299],
  [121.430997, 31.213006],
  [121.431477, 31.21303],
  [121.431757, 31.213045],
  [121.432038, 31.213088],
  [121.432474, 31.213249],
  [121.433214, 31.213654],
  [121.433769, 31.214069],
  [121.434344, 31.214591],
  [121.434599, 31.215004],
  [121.434771, 31.215758],
  [121.43483, 31.216309],
  [121.43483, 31.216309],
  [121.434908, 31.216334],
  [121.43509, 31.216383],
  [121.439984, 31.217354],
  [121.442581, 31.217789],
  [121.443528, 31.217976],
  [121.443996, 31.218104],
  [121.447455, 31.219234],
  [121.447589, 31.219295],
  [121.447589, 31.219295],
  [121.447798, 31.219392],
  [121.451269, 31.221614],
  [121.451441, 31.221672],
  [121.451929, 31.221774],
  [121.453145, 31.222027],
];

const WUKANG_BUILDING_AREA: [number, number][] = [
  [121.433413, 31.206018],
  [121.433493, 31.206161],
  [121.433507, 31.206148],
  [121.433589, 31.2062],
  [121.433538, 31.20623],
  [121.433608, 31.206353],
  [121.433715, 31.206282],
  [121.433811, 31.206343],
  [121.43377, 31.206384],
  [121.433752, 31.206362],
  [121.433659, 31.206414],
  [121.433759, 31.206569],
  [121.433824, 31.206514],
  [121.433812, 31.206486],
  [121.433911, 31.206369],
  [121.433928, 31.206379],
  [121.433988, 31.206308],
  [121.433466, 31.205977],
  [121.433438, 31.205978],
  [121.433418, 31.205993],
  [121.433413, 31.206018],
];

const PEACE_HOTEL_AREA: [number, number][] = [
  [121.48375, 31.241419],
  [121.483822, 31.241286],
  [121.48394, 31.241052],
  [121.483973, 31.240935],
  [121.483927, 31.240924],
  [121.48387, 31.240911],
  [121.48392, 31.24076],
  [121.485293, 31.241001],
  [121.485319, 31.241036],
  [121.485315, 31.241214],
  [121.485253, 31.241263],
  [121.48375, 31.241419],
];

const CUSTOMS_BUILDING_AREA: [number, number][] = [
  [121.485292, 31.238766],
  [121.485298, 31.238715],
  [121.485326, 31.238508],
  [121.485335, 31.23844],
  [121.4854, 31.238447],
  [121.485518, 31.238458],
  [121.485579, 31.238464],
  [121.48557, 31.238532],
  [121.485542, 31.238745],
  [121.485536, 31.23879],
  [121.485462, 31.238782],
  [121.48535, 31.238771],
  [121.485292, 31.238766],
];

const MEET_WUKANG_MANSION: DemoFeaturePayload = {
  id: 'meet-wukang-mansion',
  layerId: CITYWALK_LAYER_ID,
  type: 'point',
  label: fixtureText('Meet at Wukang Mansion', '武康大楼 · 集合点'),
  note: fixtureText(
    'Meet at 14:00 beside the Huaihai Road landmark and agree on the city walk pace.',
    '14:00 在淮海中路地标建筑旁集合，先确认当天的 city walk 节奏。',
  ),
  color: '#4caf50',
  coordinate: WUKANG_MANSION,
};

const COFFEE_ANFU: DemoFeaturePayload = {
  id: 'coffee-anfu',
  layerId: CITYWALK_LAYER_ID,
  type: 'point',
  label: fixtureText('Coffee and photos on Anfu Road', '安福路 · 咖啡 & 拍照'),
  note: fixtureText(
    'Pause after Wukang Road for coffee, plane-tree shade, and street photos.',
    '武康路散步后在安福路休息，顺手拍梧桐树影和街景。',
  ),
  color: '#ff9800',
  coordinate: ANFU_ROAD,
};

const DINNER_BUND_ORIGIN: DemoFeaturePayload = {
  id: 'dinner-bund-origin',
  layerId: CITYWALK_LAYER_ID,
  type: 'point',
  label: fixtureText('Dinner at Rockbund', '外滩源 · 晚餐'),
  note: fixtureText(
    'Walk toward Yuanmingyuan Road for dinner after the Bund photo stop.',
    '外滩拍完照后步行到圆明园路附近吃晚饭。',
  ),
  color: '#e91e63',
  coordinate: BUND_ORIGIN,
};

const BUND_LIGHTS: DemoFeaturePayload = {
  id: 'bund-lights',
  layerId: CITYWALK_LAYER_ID,
  type: 'point',
  label: fixtureText('Bund skyline photos', '外滩 · 开灯拍照'),
  note: fixtureText(
    'Use blue hour on the riverside platform to photograph the Pudong skyline.',
    '傍晚蓝调时间在外滩沿江平台拍浦东天际线。',
  ),
  color: '#ffd700',
  coordinate: BUND_LIGHTS_COORDINATE,
};

const WALK_WUKANG_ANFU: DemoFeaturePayload = {
  id: 'walk-wukang-anfu',
  layerId: CITYWALK_LAYER_ID,
  type: 'path',
  label: fixtureText('Wukang Road city walk', '武康路 City Walk'),
  note: fixtureText(
    'Start at Wukang Mansion, pass Ba Jin Residence and Romeo Balcony, then walk to Anfu Road.',
    '从武康大楼出发，路过巴金故居、罗密欧阳台，走到安福路。',
  ),
  color: '#4caf50',
  points: WALK_WUKANG_ANFU_POINTS,
  directed: true,
  width: 4,
  lineStyle: 'solid',
  opacity: 0.82,
};

const METRO_LINE10: DemoFeaturePayload = {
  id: 'metro-line10',
  layerId: CITYWALK_LAYER_ID,
  type: 'path',
  label: fixtureText('Metro Line 10: Shanghai Library to East Nanjing Road', '10号线 · 上海图书馆→南京东路'),
  note: fixtureText(
    'Use the metro to move from the former French Concession segment to the Bund segment.',
    '从衡复街区切到外滩段，中间坐地铁换场景。',
  ),
  color: '#9c27b0',
  points: METRO_LINE10_POINTS,
  directed: true,
  width: 3,
  lineStyle: 'dashed',
  opacity: 0.58,
};

const METRO_NANJING_EAST_ROAD: DemoFeaturePayload = {
  id: 'metro-nanjing-east-road',
  layerId: CITYWALK_LAYER_ID,
  type: 'point',
  label: fixtureText('East Nanjing Road station exit', '南京东路站 · 出站点'),
  note: fixtureText(
    'Exit the station and walk along East Nanjing Road toward the Peace Hotel and the Bund.',
    '出站后沿南京东路步行到和平饭店和外滩。',
  ),
  color: '#9c27b0',
  coordinate: NANJING_EAST_ROAD,
};

const WALK_NANJING_BUND: DemoFeaturePayload = {
  id: 'walk-nanjing-bund',
  layerId: CITYWALK_LAYER_ID,
  type: 'path',
  label: fixtureText('East Nanjing Road to the Bund', '南京东路 → 和平饭店 → 外滩源'),
  note: fixtureText(
    'Stop by the Peace Hotel and the Bund for photos, then continue north to Rockbund for dinner.',
    '先到和平饭店和外滩拍照，再往北走到外滩源吃饭。',
  ),
  color: '#4caf50',
  points: WALK_NANJING_BUND_POINTS,
  directed: true,
  width: 4,
  lineStyle: 'solid',
  opacity: 0.82,
};

const ROMEO_BALCONY: DemoFeaturePayload = {
  id: 'romeo-balcony',
  layerId: CITYWALK_LAYER_ID,
  type: 'point',
  label: fixtureText('Romeo Balcony', '罗密欧阳台'),
  note: fixtureText(
    'A Spanish-style residence on Wukang Road that works well as a mid-route stop.',
    '武康路上的西班牙式住宅，适合做中途停留点。',
  ),
  color: '#ab47bc',
  coordinate: [121.4348, 31.2095],
};

const BAJIN_RESIDENCE: DemoFeaturePayload = {
  id: 'bajin-residence',
  layerId: CITYWALK_LAYER_ID,
  type: 'point',
  label: fixtureText('Ba Jin Residence', '巴金故居'),
  note: fixtureText(
    'A literary stop on Wukang Road, grouped with the first walking segment.',
    '武康路沿线的人文停留点，和武康大楼同属第一段步行。',
  ),
  color: '#ab47bc',
  coordinate: [121.435, 31.2102],
};

const GARDEN_BRIDGE: DemoFeaturePayload = {
  id: 'garden-bridge',
  layerId: CITYWALK_LAYER_ID,
  type: 'point',
  label: fixtureText('Waibaidu Bridge', '外白渡桥'),
  note: fixtureText(
    'A classic bridge viewpoint near Rockbund, easy to visit before dinner.',
    '外滩源附近的经典桥梁机位，晚饭前可以顺路经过。',
  ),
  color: '#ab47bc',
  coordinate: GARDEN_BRIDGE_COORDINATE,
};

const PHOTO_WUKANG_MANSION: DemoFeaturePayload = {
  id: 'photo-wukang-mansion',
  layerId: CITYWALK_LAYER_ID,
  type: 'point',
  label: fixtureText('Wukang Mansion photo spot', '武康大楼机位'),
  note: fixtureText(
    'Near Xingguo Road and Huaihai Road, with a good angle for the full building.',
    '兴国路与淮海中路路口附近，适合拍完整楼体。',
  ),
  color: '#ff5722',
  coordinate: [121.4333, 31.2058],
};

const PHOTO_ANFU_STREET: DemoFeaturePayload = {
  id: 'photo-anfu-street',
  layerId: CITYWALK_LAYER_ID,
  type: 'point',
  label: fixtureText('Anfu Road street photo spot', '安福路街景机位'),
  note: fixtureText(
    'Plane trees, old houses, and street-photo texture are concentrated here.',
    '梧桐树、老房子和街拍氛围比较集中。',
  ),
  color: '#ff5722',
  coordinate: [121.4365, 31.2145],
};

const FRENCH_CONCESSION: DemoFeaturePayload = {
  id: 'french-concession-v2',
  layerId: CITYWALK_LAYER_ID,
  type: 'polygon',
  label: fixtureText('Hunan Road historic area', '湖南路历史风貌区'),
  note: fixtureText(
    'A plane-tree neighborhood in the Hengfu historic district that bounds the first city walk segment.',
    '衡复风貌区的一段梧桐街区，用来圈出第一段 city walk 的主要活动范围。',
  ),
  color: '#66bb6a',
  points: FRENCH_CONCESSION_AREA,
  width: 2,
  lineStyle: 'dashed',
  opacity: 0.72,
  fillOpacity: 0.18,
};

const WUKANG_BUILDING: DemoFeaturePayload = {
  id: 'wukang-building',
  layerId: CITYWALK_LAYER_ID,
  type: 'polygon',
  label: fixtureText('Wukang Mansion footprint', '武康大楼轮廓'),
  note: fixtureText(
    'Trace the landmark footprint so everyone can confirm the meeting point and photo angles.',
    '把地标建筑轮廓标出来，方便大家确认集合点和拍摄角度。',
  ),
  color: '#4caf50',
  points: WUKANG_BUILDING_AREA,
  width: 2,
  lineStyle: 'solid',
  opacity: 0.86,
  fillOpacity: 0.3,
};

const PEACE_HOTEL_BUILDING: DemoFeaturePayload = {
  id: 'peace-hotel-building',
  layerId: CITYWALK_LAYER_ID,
  type: 'polygon',
  label: fixtureText('Peace Hotel footprint', '和平饭店轮廓'),
  note: fixtureText(
    'A key Bund landmark used as the reference point from East Nanjing Road to the river.',
    '外滩段的关键地标，作为从南京东路走向外滩的参照。',
  ),
  color: '#ab47bc',
  points: PEACE_HOTEL_AREA,
  width: 2,
  lineStyle: 'solid',
  opacity: 0.82,
  fillOpacity: 0.24,
};

const CUSTOMS_BUILDING: DemoFeaturePayload = {
  id: 'customs-building',
  layerId: CITYWALK_LAYER_ID,
  type: 'polygon',
  label: fixtureText('Customs House footprint', '海关大楼轮廓'),
  note: fixtureText(
    'The Bund clock tower landmark sits directly on the evening photo route.',
    '外滩钟楼地标，拍照路线经过这里。',
  ),
  color: '#ab47bc',
  points: CUSTOMS_BUILDING_AREA,
  width: 2,
  lineStyle: 'solid',
  opacity: 0.82,
  fillOpacity: 0.24,
};

const KEY_STOPS = [
  MEET_WUKANG_MANSION,
  COFFEE_ANFU,
  METRO_NANJING_EAST_ROAD,
  BUND_LIGHTS,
  DINNER_BUND_ORIGIN,
  GARDEN_BRIDGE,
];
const WUKANG_DETAILS = [
  MEET_WUKANG_MANSION,
  PHOTO_WUKANG_MANSION,
  WALK_WUKANG_ANFU,
  ROMEO_BALCONY,
  BAJIN_RESIDENCE,
  PHOTO_ANFU_STREET,
  COFFEE_ANFU,
  WUKANG_BUILDING,
  FRENCH_CONCESSION,
];
const OVERVIEW_FEATURES = [
  ...KEY_STOPS,
  WALK_WUKANG_ANFU,
  METRO_LINE10,
  WALK_NANJING_BUND,
  WUKANG_BUILDING,
  PEACE_HOTEL_BUILDING,
  CUSTOMS_BUILDING,
];

const SCREENSHOT_VIEWS: Record<ScreenshotFixtureMode, ScreenshotFixtureView> = {
  overview: SCREENSHOT_FIXTURE_VIEW,
  layers: { center: [121.4408, 31.2134], zoom: 14.45 },
  annotations: { center: [121.4356, 31.2107], zoom: 15.45 },
  sharing: SCREENSHOT_FIXTURE_VIEW,
};

export function getScreenshotFixtureView(mode: ScreenshotFixtureMode): ScreenshotFixtureView {
  const view = SCREENSHOT_VIEWS[mode] || SCREENSHOT_FIXTURE_VIEW;
  const isMobileOverview = mode === 'overview' && window.matchMedia?.('(max-width: 640px)').matches;
  return isMobileOverview ? { center: [121.4428, 31.2114], zoom: 14.48 } : view;
}

function now() {
  return 1_782_918_000_000;
}

export function getScreenshotFixtureMode(): ScreenshotFixtureMode | null {
  const value = new URLSearchParams(window.location.search).get('screenshot');
  if (value === 'overview' || value === 'layers' || value === 'annotations' || value === 'sharing') {
    return value;
  }
  return null;
}

function annotationLayer(id: string, name: string, sortIndex: number): Layer {
  return {
    id,
    kind: 'annotation',
    name,
    visible: true,
    sortKey: initialSortKey(sortIndex),
    payload: { version: 1 },
    revision: 1,
    createdAt: now(),
    updatedAt: now(),
    updatedBy: 'fixture',
  };
}

function baseFeature(payload: DemoFeaturePayload, layerId = payload.layerId): AnnotationFeaturePayload {
  return {
    label: '',
    note: '',
    color: '#2563eb',
    createdAt: now(),
    updatedAt: now(),
    updatedBy: 'fixture',
    ...payload,
    layerId,
  } as AnnotationFeaturePayload;
}

function featureFromPayload(
  payload: DemoFeaturePayload,
  sortIndex: number,
  layerId = payload.layerId,
): AnnotationFeature {
  const featurePayload = baseFeature(payload, layerId);
  return {
    id: `${layerId}-${payload.id}`,
    layerId,
    featureType: featurePayload.type,
    payload: { ...featurePayload, id: `${layerId}-${payload.id}` } as AnnotationFeaturePayload,
    sortKey: initialSortKey(sortIndex),
    revision: 1,
    createdAt: now(),
    updatedAt: now(),
    updatedBy: 'fixture',
  };
}

function citywalkFeatures(payloads: DemoFeaturePayload[], layerId = CITYWALK_LAYER_ID) {
  return payloads.map((payload, index) => featureFromPayload(payload, index, layerId));
}

function viewportCorners(center: [number, number], widthLng: number, aspectRatio: number): [number, number][] {
  const halfWidth = widthLng / 2;
  const halfHeight = widthLng / aspectRatio / 2;
  return [
    [center[0] - halfWidth, center[1] - halfHeight],
    [center[0] + halfWidth, center[1] - halfHeight],
    [center[0] + halfWidth, center[1] + halfHeight],
    [center[0] - halfWidth, center[1] + halfHeight],
  ];
}

export function installScreenshotFixtureData(layerStore: LayerStore, mode: ScreenshotFixtureMode) {
  if (mode === 'layers') {
    layerStore.setLayerList([
      annotationLayer(ROUTE_LAYER_ID, fixtureText('Routes: Wukang Road, metro, Bund', '路线：武康路、地铁、外滩'), 0),
      annotationLayer(
        STOPS_LAYER_ID,
        fixtureText('Stops: meetup, coffee, photos, dinner', '停留点：集合、咖啡、拍照、晚餐'),
        1,
      ),
      annotationLayer(LANDMARKS_LAYER_ID, fixtureText('Landmarks and historic buildings', '地标和历史建筑'), 2),
    ]);
    layerStore.setAnnotationFeatureList([
      featureFromPayload(WALK_WUKANG_ANFU, 0, ROUTE_LAYER_ID),
      featureFromPayload(METRO_LINE10, 1, ROUTE_LAYER_ID),
      featureFromPayload(WALK_NANJING_BUND, 2, ROUTE_LAYER_ID),
      ...citywalkFeatures(KEY_STOPS, STOPS_LAYER_ID),
      ...citywalkFeatures(
        [
          PHOTO_WUKANG_MANSION,
          PHOTO_ANFU_STREET,
          ROMEO_BALCONY,
          BAJIN_RESIDENCE,
          FRENCH_CONCESSION,
          WUKANG_BUILDING,
          PEACE_HOTEL_BUILDING,
          CUSTOMS_BUILDING,
        ],
        LANDMARKS_LAYER_ID,
      ),
    ]);
    return;
  }

  layerStore.setLayerList([
    annotationLayer(CITYWALK_LAYER_ID, fixtureText('Shanghai weekend city walk', '上海周末 City Walk'), 0),
  ]);
  const features =
    mode === 'overview'
      ? citywalkFeatures(OVERVIEW_FEATURES)
      : mode === 'annotations'
        ? citywalkFeatures(WUKANG_DETAILS)
        : citywalkFeatures(OVERVIEW_FEATURES);
  layerStore.setAnnotationFeatureList(features);
}

export function installScreenshotFixtureMapLayers(_map: unknown, _mode: ScreenshotFixtureMode) {
  // The README tour uses the same annotation data that exists in the shanghai-citywalk room.
}

export function createScreenshotCollaborationFixture(
  mode: ScreenshotFixtureMode,
  nowMs = Date.now(),
): CollaborationFixtureState {
  const view = getScreenshotFixtureView(mode);
  const currentUser: NonNullable<CollaborationFixtureState['currentUser']> = {
    userId: 'user-demo-owner',
    githubLogin: 'shanghai-planner',
    displayName: fixtureText('Shanghai Weekend Plan', '上海周末计划'),
    avatarUrl: null,
  };
  const peers: Peer[] =
    mode === 'overview' || mode === 'sharing'
      ? [
          {
            id: 'peer-lin',
            user: { id: 'peer-lin', name: fixtureText('Lin', '阿林'), color: '#2563eb' },
            viewport: {
              center: [121.486, 31.2408] as [number, number],
              zoom: view.zoom,
              bearing: 0,
              pitch: 0,
              corners: viewportCorners([121.486, 31.2408], 0.011, 16 / 10),
            },
            cursor: { visible: true, lngLat: BUND_LIGHTS_COORDINATE },
            location: { enabled: false, lngLat: null, accuracy: null, heading: null, speed: null, updatedAt: null },
            updatedAt: nowMs,
          },
          {
            id: 'peer-mei',
            user: { id: 'peer-mei', name: fixtureText('Mei', '小梅'), color: '#dc2626' },
            viewport: {
              center: [121.4359, 31.2124] as [number, number],
              zoom: view.zoom,
              bearing: 0,
              pitch: 0,
              corners: viewportCorners([121.4359, 31.2124], 0.0062, 9 / 19.5),
            },
            cursor: { visible: true, lngLat: [121.4365, 31.2145] },
            location: {
              enabled: true,
              lngLat: ANFU_ROAD,
              accuracy: 120,
              heading: 28,
              speed: null,
              updatedAt: nowMs,
            },
            updatedAt: nowMs,
          },
          {
            id: 'peer-chen',
            user: { id: 'peer-chen', name: fixtureText('Chen', '陈同学'), color: '#0f766e' },
            viewport: {
              center: [121.4802, 31.2396] as [number, number],
              zoom: view.zoom,
              bearing: 0,
              pitch: 0,
              corners: viewportCorners([121.4802, 31.2396], 0.0104, 4 / 3),
            },
            cursor: { visible: true, lngLat: NANJING_EAST_ROAD },
            location: { enabled: false, lngLat: null, accuracy: null, heading: null, speed: null, updatedAt: null },
            updatedAt: nowMs,
          },
        ]
      : [];
  const agents: AgentParticipant[] =
    mode === 'overview' || mode === 'sharing'
      ? [
          {
            id: 'agent-planner',
            user: { id: 'agent-planner', name: 'Agent', color: '#7c3aed' },
            clientType: 'agent',
            active: true,
            lastSeenAt: nowMs,
            expiresAt: nowMs + 60_000,
            lastAction: fixtureText('Organized the Wukang Road and Bund annotations', '整理了武康路和外滩段标注'),
          },
        ]
      : [];

  return {
    roomId: 'shanghai-citywalk',
    currentUser,
    roomAccess: {
      role: 'manage',
      canView: true,
      canEdit: true,
      canManage: true,
      linkAccess: 'edit',
      room: {
        ownerUserId: currentUser.userId,
        createdByKind: 'user',
        persistence: 'persistent',
      },
    },
    grants: [
      {
        userId: 'user-mei',
        githubLogin: 'mei-citywalk',
        displayName: fixtureText('Mei', '小梅'),
        avatarUrl: null,
        role: 'edit',
      },
      {
        userId: 'user-lin',
        githubLogin: 'lin-camera',
        displayName: fixtureText('Lin', '阿林'),
        avatarUrl: null,
        role: 'view',
      },
      {
        userId: 'user-chen',
        githubLogin: 'chen-metro',
        displayName: fixtureText('Chen', '陈同学'),
        avatarUrl: null,
        role: 'view',
      },
    ],
    peers,
    agents,
    connectionState: 'live',
    connectionLabel: 'Live',
  };
}

function openControl(selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button?.classList.contains(`${selector.slice(1)}-enabled`)) button?.click();
}

function preparePanelState(mode: ScreenshotFixtureMode) {
  if (mode === 'layers') {
    openControl('.maplibregl-ctrl-layers');
  } else if (mode === 'annotations') {
    openControl('.maplibregl-ctrl-annotation');
    const layerSelect = document.querySelector('.annotation-layer-field select') as unknown as HTMLSelectElement | null;
    if (layerSelect) {
      layerSelect.value = CITYWALK_LAYER_ID;
      layerSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const areaButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.annotation-mode-button')).find(
      (button) => button.textContent?.includes('Area'),
    );
    areaButton?.click();
  } else if (mode === 'sharing') {
    document.querySelector<HTMLButtonElement>('.collab-compact-toggle')?.click();
    document.querySelector<HTMLButtonElement>('.collab-share-button')?.click();
  }
}

type ScreenshotReadyMap = {
  loaded(): boolean;
  areTilesLoaded?(): boolean;
  once(event: 'load' | 'idle', callback: () => void): void;
};

function markReadyWhenMapSettles(map?: ScreenshotReadyMap) {
  let ready = false;
  const markReady = () => {
    if (ready) return;
    ready = true;
    window.setTimeout(() => (document.body.dataset.screenshotReady = 'true'), 300);
  };
  const waitForIdle = () => {
    if (map?.areTilesLoaded?.()) {
      markReady();
      return;
    }
    map?.once('idle', markReady);
    window.setTimeout(markReady, 3_500);
  };

  if (!map) {
    window.setTimeout(markReady, 1_600);
  } else if (map.loaded()) {
    waitForIdle();
  } else {
    map.once('load', waitForIdle);
    window.setTimeout(markReady, 4_500);
  }
}

export function applyScreenshotFixtureScene(mode: ScreenshotFixtureMode, map?: ScreenshotReadyMap) {
  document.documentElement.dataset.screenshotFixture = mode;
  document.documentElement.setAttribute('data-screenshot-fixture', mode);
  window.setTimeout(() => preparePanelState(mode), 240);
  markReadyWhenMapSettles(map);
}
