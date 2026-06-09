import { expect, type Page } from '@playwright/test';
import { openRealBackendApp } from './map-fixture';

type AnnotationProperties = {
  kind?: unknown;
  name?: unknown;
  label?: unknown;
  description?: unknown;
  annotation_id?: unknown;
  feature_type?: unknown;
};
type GeoJsonFeature = {
  properties?: AnnotationProperties | null;
  geometry?: { type?: string; coordinates?: unknown };
};
type GeoJsonSourceData = {
  type?: string;
  features?: GeoJsonFeature[];
};
type MapSource = {
  _data?: GeoJsonSourceData | { geojson?: GeoJsonSourceData } | string;
  getData?: () => Promise<GeoJsonSourceData | unknown>;
};
type IntrospectionMap = {
  getStyle?: () => { sources?: Record<string, unknown>; layers?: Array<{ id?: string; source?: string }> };
  getSource?: (sourceId: string) => MapSource | undefined;
  querySourceFeatures?: (sourceId: string) => GeoJsonFeature[];
  project?: (coordinate: [number, number]) => { x: number; y: number };
  getLayoutProperty?: (layerId: string, name: string) => unknown;
};

export async function clickMap(page: Page, xRatio = 0.5, yRatio = 0.5) {
  const box = await page.locator('#map canvas').boundingBox();
  expect(box, 'map canvas should have a rendered box').not.toBeNull();
  if (!box) return;
  await page.mouse.click(box.x + box.width * xRatio, box.y + box.height * yRatio);
}

export async function openLayers(page: Page) {
  const panel = page.locator('.layer-manager-panel');
  if ((await panel.getAttribute('aria-hidden')) !== 'false') {
    await page.locator('.maplibregl-ctrl-layers').click();
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
  }
  return panel;
}

export async function closeLayers(page: Page) {
  const panel = page.locator('.layer-manager-panel');
  if ((await panel.getAttribute('aria-hidden')) === 'false') {
    await page.getByRole('button', { name: 'Close layers' }).click();
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
  }
}

export async function openAnnotations(page: Page) {
  const panel = page.locator('.annotation-panel');
  if ((await panel.getAttribute('aria-hidden')) !== 'false') {
    await page.locator('.maplibregl-ctrl-annotation').click();
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
  }
  return panel;
}

export async function openRouting(page: Page) {
  const panel = page.locator('.routing-panel');
  if ((await panel.getAttribute('aria-hidden')) !== 'false') {
    await page.getByRole('button', { name: 'Routing' }).click();
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
  }
  return panel;
}

export async function selectLayer(page: Page, name: string) {
  const panel = await openLayers(page);
  const row = panel.locator('.layer-manager-item', {
    has: page.locator('.layer-manager-item-name', { hasText: name }),
  });
  await expect(row).toBeVisible();
  await row.locator('.layer-manager-item-main').click();
  return panel;
}

export async function createAnnotationLayerFromUi(page: Page, name: string) {
  await openLayers(page);
  await page.getByRole('button', { name: 'New annotation layer' }).click();
  const nameInput = page.locator('.layer-manager-name-input');
  await expect(nameInput).toBeEnabled();
  await nameInput.fill(name);
  await expect(page.locator('.layer-manager-item-name', { hasText: name })).toBeVisible();
  await closeLayers(page);
}

export async function openAnnotationsForLayer(page: Page, layerName: string) {
  await openAnnotations(page);
  await page.locator('.annotation-layer-field select').selectOption({ label: layerName });
}

export async function openRealCollaborationRoom(page: Page, room: string) {
  await openRealBackendApp(page, { room });
  await expect(page.locator('.collab-panel')).toHaveAttribute('data-connection', 'live');
  await expect(page.locator('#map')).toHaveAttribute('data-collaboration-can-edit', 'true');
}

export async function layerNames(page: Page) {
  await openLayers(page);
  const names = await page.locator('.layer-manager-item-name').allTextContents();
  await closeLayers(page);
  return names.map((name) => name.trim()).filter(Boolean);
}

export async function expectLayerVisible(page: Page, name: string) {
  await expect.poll(() => layerNames(page)).toContain(name);
}

export async function expectLayerMissing(page: Page, name: string) {
  await expect.poll(() => layerNames(page)).not.toContain(name);
}

export async function annotationSourceSnapshot(page: Page) {
  return await page.evaluate(() => {
    const map = window._mlmap as IntrospectionMap | null | undefined;
    if (!map?.getStyle || !map.getSource) return [] as Array<{ sourceId: string; features: GeoJsonFeature[] }>;
    return Object.keys(map.getStyle().sources || {})
      .filter((sourceId) => sourceId.startsWith('annotation-source'))
      .map((sourceId) => {
        const rawData = map.getSource?.(sourceId)?._data;
        const data = typeof rawData === 'string' ? null : rawData;
        const sourceFeatures = data?.type === 'FeatureCollection' ? data.features || [] : [];
        const renderedFeatures = map.querySourceFeatures?.(sourceId) || [];
        return { sourceId, features: [...sourceFeatures, ...renderedFeatures] };
      });
  });
}

export async function annotationLabels(page: Page) {
  const snapshot = await annotationSourceSnapshot(page);
  const labels = new Set<string>();
  for (const source of snapshot) {
    for (const feature of source.features) {
      const properties = feature.properties || {};
      for (const value of [properties.label, properties.name, properties.description]) {
        if (typeof value === 'string' && value.trim()) labels.add(value.trim());
      }
    }
  }
  return Array.from(labels);
}

export async function annotationKinds(page: Page) {
  const snapshot = await annotationSourceSnapshot(page);
  const kinds = new Set<string>();
  for (const source of snapshot) {
    for (const feature of source.features) {
      const kind = feature.properties?.kind;
      if (typeof kind === 'string' && kind.trim()) kinds.add(kind.trim());
    }
  }
  return Array.from(kinds);
}

export async function annotationFeatureTypes(page: Page) {
  const snapshot = await annotationSourceSnapshot(page);
  const types = new Set<string>();
  for (const source of snapshot) {
    for (const feature of source.features) {
      const type = feature.properties?.feature_type;
      if (typeof type === 'string' && type.trim()) types.add(type.trim());
    }
  }
  return Array.from(types);
}

export async function expectFeatureLabel(page: Page, label: string) {
  await expect.poll(() => annotationLabels(page)).toContain(label);
}

export async function openAnnotationEditorFromCanvas(page: Page, label: string) {
  await expectFeatureLabel(page, label);
  await openAnnotations(page);
  await page.getByRole('button', { name: 'Select' }).click();

  const point = await page.waitForFunction((targetLabel) => {
    const map = window._mlmap as IntrospectionMap | null | undefined;
    if (!map?.getStyle || !map.getSource || !map.project) return null;

    for (const sourceId of Object.keys(map.getStyle().sources || {})) {
      if (!sourceId.startsWith('annotation-source')) continue;
      const rawData = map.getSource(sourceId)?._data;
      if (!rawData || typeof rawData === 'string') continue;
      const data = 'geojson' in rawData ? rawData.geojson : rawData;
      if (data?.type !== 'FeatureCollection') continue;

      for (const feature of data.features || []) {
        const properties = feature.properties || {};
        const labels = [properties.label, properties.name, properties.description];
        if (!labels.some((value) => typeof value === 'string' && value.trim() === targetLabel)) continue;
        if (feature.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) continue;
        const [lng, lat] = feature.geometry.coordinates;
        if (typeof lng !== 'number' || typeof lat !== 'number') continue;
        return map.project([lng, lat]);
      }
    }
    return null;
  }, label);

  const canvasBox = await page.locator('#map canvas').boundingBox();
  expect(canvasBox, 'map canvas should have a rendered box').not.toBeNull();
  const projected = await point.jsonValue();
  expect(projected, `annotation "${label}" should project to a screen point`).toEqual(
    expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
    }),
  );
  if (!canvasBox || !projected) return;

  await page.mouse.dblclick(canvasBox.x + projected.x, canvasBox.y + projected.y);
  const editor = page.locator('.annotation-editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('input.annotation-input')).toHaveValue(label);
}

export async function expectFeatureMissing(page: Page, label: string) {
  await expect.poll(() => annotationLabels(page)).not.toContain(label);
}

export async function searchSourceFeatureCount(page: Page) {
  return await page.evaluate(() => {
    const map = window._mlmap as IntrospectionMap | null | undefined;
    const source = map?.getSource?.('search');
    const featureCount = (data: GeoJsonSourceData | undefined | null) =>
      data?.type === 'FeatureCollection' ? data.features?.length || 0 : 0;

    if (source?.getData) {
      return source.getData().then((data) => {
        return featureCount(data as GeoJsonSourceData | undefined);
      });
    }

    const rawData = source?._data;
    if (!rawData || typeof rawData === 'string') return 0;
    const data = 'geojson' in rawData ? rawData.geojson : rawData;
    return featureCount(data);
  });
}

export async function mapLayerVisibility(page: Page, layerId: string) {
  return await page.evaluate((id) => {
    const map = window._mlmap as IntrospectionMap | null | undefined;
    return map?.getLayoutProperty?.(id, 'visibility') ?? null;
  }, layerId);
}
