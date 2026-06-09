import { expect, type Page, type Route } from '@playwright/test';
const emptyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

type ExternalRouteOptions = {
  nominatim?: 'failure' | 'success';
};

const baseStyle = {
  version: 8,
  name: 'E2E base style',
  center: [121.4562, 31.22727],
  zoom: 13.55,
  glyphs: '/orm/font/{fontstack}/{range}',
  sources: {
    base: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [121.3, 31.1],
                  [121.65, 31.1],
                  [121.65, 31.35],
                  [121.3, 31.35],
                  [121.3, 31.1],
                ],
              ],
            },
          },
        ],
      },
    },
    search: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    },
  },
  layers: [
    {
      id: 'base-fill',
      type: 'fill',
      source: 'base',
      paint: {
        'fill-color': '#f6f3eb',
        'fill-opacity': 1,
      },
    },
    {
      id: 'base-line',
      type: 'line',
      source: 'base',
      paint: {
        'line-color': '#c7d2fe',
        'line-width': 2,
      },
    },
    {
      id: 'base-label',
      type: 'symbol',
      source: 'base',
      layout: {
        'text-field': 'Shanghai',
        'text-font': ['Noto Sans Regular'],
        'text-size': 14,
      },
      paint: {
        'text-color': '#334155',
      },
    },
    {
      id: 'search-point',
      type: 'circle',
      source: 'search',
      paint: {
        'circle-radius': 7,
        'circle-color': '#dc2626',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    },
  ],
};

const photonFixture = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [121.4685, 31.2221] },
      properties: {
        osm_type: 'N',
        osm_id: 1001,
        name: 'Shanghai Railway Station',
        osm_key: 'railway',
        osm_value: 'station',
        street: 'Moling Road',
        city: 'Shanghai',
        country: 'China',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [121.4558, 31.2192] },
      properties: {
        osm_type: 'W',
        osm_id: 1002,
        name: "Jing'an Temple",
        osm_key: 'amenity',
        osm_value: 'place_of_worship',
        district: "Jing'an",
        city: 'Shanghai',
        country: 'China',
      },
    },
  ],
};

const geoJsonFixture = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Fixture transfer point' },
      geometry: { type: 'Point', coordinates: [121.461, 31.226] },
    },
    {
      type: 'Feature',
      properties: { name: 'Fixture connector' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [121.453, 31.219],
          [121.461, 31.226],
          [121.472, 31.231],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Fixture works area' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [121.458, 31.221],
            [121.466, 31.221],
            [121.466, 31.228],
            [121.458, 31.228],
            [121.458, 31.221],
          ],
        ],
      },
    },
  ],
};

const gpxFixture = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="orm-pmtiles-demo-e2e">
  <metadata><name>Fixture GPX track</name></metadata>
  <wpt lat="31.224500" lon="121.462500"><name>Signal waypoint</name></wpt>
  <trk>
    <name>Fixture GPX track</name>
    <trkseg>
      <trkpt lat="31.220000" lon="121.450000"><ele>4</ele><time>2026-06-08T08:00:00Z</time></trkpt>
      <trkpt lat="31.224000" lon="121.462000"><ele>5</ele><time>2026-06-08T08:05:00Z</time></trkpt>
      <trkpt lat="31.230000" lon="121.476000"><ele>8</ele><time>2026-06-08T08:11:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const nominatimFixture = {
  name: 'E2E Weather Point',
  display_name: 'E2E Weather Point, Fuzhou Road, Shanghai, China',
  address: {
    road: 'Fuzhou Road',
    city: 'Shanghai',
    country: 'China',
  },
};

function osrmFixtureResponse(url: URL) {
  const coordinateText = url.pathname.split('/').pop() || '';
  const points = coordinateText
    .split(';')
    .map((part) => {
      const [lng, lat] = part.split(',').map(Number);
      return Number.isFinite(lng) && Number.isFinite(lat) ? ([lng, lat] as [number, number]) : null;
    })
    .filter(Boolean) as Array<[number, number]>;
  const from = points[0] || [121.45, 31.22];
  const to = points[points.length - 1] || [121.48, 31.23];
  const middle: [number, number] = [
    Number(((from[0] + to[0]) / 2 + 0.002).toFixed(6)),
    Number(((from[1] + to[1]) / 2 + 0.001).toFixed(6)),
  ];
  const coordinates = [from, middle, to];
  return {
    code: 'Ok',
    routes: [
      {
        geometry: { type: 'LineString', coordinates },
        distance: 2140,
        duration: 560,
        weight: 560,
        weight_name: 'routability',
        legs: [
          {
            steps: [
              {
                name: 'Fixture Avenue',
                ref: 'E2E',
                mode: 'driving',
                distance: 1040,
                duration: 260,
                geometry: { type: 'LineString', coordinates: [from, middle] },
                maneuver: { type: 'depart', modifier: 'straight', location: from },
              },
              {
                name: 'Sync Road',
                ref: 'QA',
                mode: 'driving',
                distance: 1100,
                duration: 300,
                geometry: { type: 'LineString', coordinates: [middle, to] },
                maneuver: { type: 'arrive', modifier: 'right', location: to },
              },
            ],
            annotation: {
              distance: [1040, 1100],
              duration: [260, 300],
              speed: [4, 3.7],
              nodes: [101, 102, 103],
            },
          },
        ],
      },
    ],
    waypoints: [
      { name: 'Fixture start', location: from, distance: 0 },
      { name: 'Fixture end', location: to, distance: 0 },
    ],
  };
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

async function fulfillPng(route: Route) {
  await route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: `data:image/png;base64,${emptyPngBase64}`,
  });
}

async function fulfillVectorTile(route: Route) {
  await route.fulfill({
    status: 204,
    contentType: 'application/x-protobuf',
    body: '',
  });
}

async function fulfillText(route: Route, status = 404) {
  await route.fulfill({
    status,
    contentType: 'text/plain; charset=utf-8',
    body: '',
  });
}

async function fulfillXml(route: Route, body: string) {
  await route.fulfill({
    status: 200,
    contentType: 'application/gpx+xml; charset=utf-8',
    body,
  });
}

async function fulfillHtml(route: Route) {
  await route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><title>E2E weather dashboard</title><body>Weather fixture</body>',
  });
}

async function routeExternalMapResources(page: Page, options: ExternalRouteOptions = {}) {
  await page.route('https://tiles.openfreemap.org/styles/liberty', (route) => fulfillJson(route, baseStyle));
  await page.route('https://tiles.mapterhorn.com/tilejson.json', (route) =>
    fulfillJson(route, {
      tilejson: '3.0.0',
      tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
      minzoom: 0,
      maxzoom: 17,
      bounds: [-180, -85, 180, 85],
    }),
  );
  await page.route(/https:\/\/tiles\.mapterhorn\.com\/\d+\/\d+\/\d+\.webp.*/, fulfillPng);
  await page.route(/https:\/\/mt1\.google\.com\/vt\/.*/, fulfillPng);
  await page.route(/\/tiles\/openrailwaymap\/.*/, fulfillVectorTile);
  await page.route(/https:\/\/vtiles\.openhistoricalmap\.org\/.*/, fulfillVectorTile);
  await page.route(/https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/.*/, fulfillPng);
  await page.route(/https:\/\/nominatim\.openstreetmap\.org\/.*/, (route) =>
    options.nominatim === 'success' ? fulfillJson(route, nominatimFixture) : fulfillText(route, 503),
  );
  await page.route(/https:\/\/weather\.mgt\.moe\/.*/, fulfillHtml);
  await page.route(/https:\/\/photon\.komoot\.io\/api\/.*/, (route) => fulfillJson(route, photonFixture));
  await page.route(/https:\/\/router\.project-osrm\.org\/route\/v1\/.*/, (route) =>
    fulfillJson(route, osrmFixtureResponse(new URL(route.request().url()))),
  );
  await page.route(
    (url) => /^\/fixtures\/.+\.geojson$/.test(url.pathname),
    (route) => fulfillJson(route, geoJsonFixture),
  );
  await page.route(
    (url) => /^\/fixtures\/.+\.gpx$/.test(url.pathname),
    (route) => fulfillXml(route, gpxFixture),
  );
}

async function routeMockAppApis(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/auth/me',
    (route) => fulfillJson(route, { user: null }),
  );
  await page.route(
    (url) => url.pathname === '/api/rooms',
    (route) =>
      fulfillJson(route, {
        room: {
          roomId: 'e2e-sync-room',
          ownerUserId: null,
          createdByKind: 'guest',
          persistence: 'persistent',
          linkAccess: 'edit',
        },
      }),
  );
  await page.route(
    (url) => /^\/api\/rooms\/[^/]+\/access$/.test(url.pathname),
    (route) =>
      fulfillJson(route, {
        role: 'manage',
        canView: true,
        canEdit: true,
        canManage: true,
        room: {
          roomId: 'e2e-sync-room',
          ownerUserId: null,
          createdByKind: 'guest',
          persistence: 'persistent',
          linkAccess: 'edit',
        },
      }),
  );
  await page.route(/\/api\/rooms\/[^/]+\/grants.*/, (route) =>
    fulfillJson(route, {
      grants: [
        {
          userId: 'user-mei',
          githubLogin: 'mei-citywalk',
          displayName: 'Mei',
          avatarUrl: null,
          role: 'edit',
        },
        {
          userId: 'user-lin',
          githubLogin: 'lin-camera',
          displayName: 'Lin',
          avatarUrl: null,
          role: 'view',
        },
        {
          userId: 'user-chen',
          githubLogin: 'chen-metro',
          displayName: 'Chen',
          avatarUrl: null,
          role: 'view',
        },
      ],
    }),
  );
}

function isExpectedBrowserMessage(text: string) {
  return (
    /MapLibre resource load skipped/i.test(text) ||
    /Failed to load resource: the server responded with a status of (204|404|503)/i.test(text) ||
    /WebGL warning/i.test(text) ||
    /GPU stall due to ReadPixels/i.test(text)
  );
}

export async function installBrowserErrorWatch(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!isExpectedBrowserMessage(text)) consoleErrors.push(text);
  });

  return {
    assertNoErrors() {
      expect(pageErrors, 'unexpected page errors').toEqual([]);
      expect(consoleErrors, 'unexpected console errors').toEqual([]);
    },
  };
}

export async function openFixture(page: Page, mode: 'overview' | 'layers' | 'annotations' | 'sharing' = 'overview') {
  await routeExternalMapResources(page);
  await routeMockAppApis(page);
  await page.goto(`/?screenshot=${mode}&room=shanghai-citywalk`);
  await page.waitForFunction(() => document.body.dataset.screenshotReady === 'true');
  await waitForMapShell(page);
}

export async function openApp(page: Page, params: Record<string, string> = {}, options: ExternalRouteOptions = {}) {
  await routeExternalMapResources(page, options);
  await routeMockAppApis(page);
  const query = new URLSearchParams(params);
  await page.goto(query.size ? `/?${query}` : '/');
  await waitForMapShell(page);
}

export async function openRealBackendApp(page: Page, params: Record<string, string> = {}) {
  await routeExternalMapResources(page);
  const query = new URLSearchParams(params);
  await page.goto(query.size ? `/?${query}` : '/');
  await waitForMapShell(page);
}

async function waitForMapShell(page: Page) {
  await page.waitForFunction(() => {
    const map = window._mlmap as FixtureMap | null | undefined;
    return Boolean(map?.style?._loaded || map?.isStyleLoaded?.());
  });
  await expect(page.locator('#map canvas')).toBeVisible();
}

export async function mapState(page: Page) {
  return await page.evaluate(() => {
    const map = window._mlmap as FixtureMap | null | undefined;
    return {
      hasMap: Boolean(map),
      loaded: Boolean(map?.loaded?.()),
      styleLoaded: Boolean(map?.style?._loaded || map?.isStyleLoaded?.()),
      terrain: Boolean(map?.getTerrain?.()),
      satelliteVisibility: map?.getLayoutProperty?.('satellite-layer', 'visibility'),
      viewState: map?.getCollaborationViewState?.(),
      styleLayerCount: map?.getStyle?.().layers?.length ?? 0,
    };
  });
}

type FixtureMap = {
  loaded?: () => boolean;
  isStyleLoaded?: () => boolean;
  style?: { _loaded?: boolean };
  getTerrain?: () => unknown;
  getLayoutProperty?: (layerId: string, name: string) => unknown;
  getCollaborationViewState?: () => { terrain: boolean; satellite: boolean };
  getStyle?: () => { layers?: unknown[] };
};
