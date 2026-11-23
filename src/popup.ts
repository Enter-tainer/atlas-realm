import { buildFeatureCatalog, installOrmPopups as installBaseOrmPopups } from '../packages/atlas-map/src/popup.js';
import { renderMarkdown } from './markdown.js';
import { buildWeatherDashboardUrl, buildWeatherRouteSummary } from './weather-dashboard.js';
import { installSheetCollapse, isSheetLayout, sheetClosed, sheetOpened } from './bottom-sheet.js';

export { buildFeatureCatalog };

type PopupWrapperMap = {
  panBy?: (offset: [number, number]) => unknown;
  project?: (lngLat: unknown) => { y: number };
  getContainer(): HTMLElement;
};

type PopupWrapper = {
  getElement?(): HTMLElement | undefined;
  remove(): void;
  on(event: string, listener: () => void): void;
  getLngLat?(): unknown;
};

function installInfoSheet(mapUnknown: unknown, popupUnknown: unknown) {
  const map = mapUnknown as PopupWrapperMap;
  const popup = popupUnknown as PopupWrapper;
  const element = popup.getElement?.();
  if (!element) return;

  const grabber = document.createElement('button');
  const closeButton = document.createElement('button');
  closeButton.className = 'orm-sheet-close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close info box');
  closeButton.innerText = '\u00D7';
  closeButton.addEventListener('click', () => popup.remove());
  element.insertBefore(closeButton, element.firstChild);
  element.insertBefore(grabber, closeButton);

  installSheetCollapse(element, grabber, {
    label: 'info box',
    peek: () => {
      const scroller = element.querySelector('.maplibregl-popup-content');
      if (scroller) scroller.scrollTop = 0;
      const head = element.querySelector('.orm-popup-label') || element.querySelector('.orm-popup-title');
      const top = element.getBoundingClientRect().top;
      return head ? Math.ceil(head.getBoundingClientRect().bottom - top + 12) : 64;
    },
  });

  sheetOpened(element);
  popup.on('close', () => sheetClosed(element));

  if (isSheetLayout() && map.panBy && map.project) {
    const height = map.getContainer().clientHeight;
    const visible = height - element.getBoundingClientRect().height;
    const y = map.project(popup.getLngLat?.()).y;
    if (visible > 80 && y > visible - 24) map.panBy([0, y - visible / 2]);
  }
}

export function installOrmPopups(
  map: Parameters<typeof installBaseOrmPopups>[0],
  maplibregl: Parameters<typeof installBaseOrmPopups>[1],
  featuresCatalog: Parameters<typeof installBaseOrmPopups>[2],
) {
  installBaseOrmPopups(map, maplibregl, featuresCatalog, {
    renderDescription: renderMarkdown,
    buildWeatherInfo: ({ coordinate, displayName, startDate, days }) => ({
      summary: buildWeatherRouteSummary({ startDate, days }),
      dashboardUrl: buildWeatherDashboardUrl({
        coordinate,
        displayName,
        startDate,
        days,
        compact: false,
      }),
    }),
    onPopupOpen: installInfoSheet,
  });
}
