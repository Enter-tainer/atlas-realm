export const UI_PANEL_OPEN_EVENT = 'ui-panel:open';

export type UiPanelId = 'annotations' | 'layers' | 'routing' | 'weather' | 'collaboration';

export type UiPanelOpenDetail = {
  id: UiPanelId;
};

export function emitUiPanelOpen(container: HTMLElement, id: UiPanelId) {
  container.dispatchEvent(new CustomEvent<UiPanelOpenDetail>(UI_PANEL_OPEN_EVENT, { detail: { id } }));
}

export function isOtherUiPanelOpen(event: Event, id: UiPanelId) {
  if (!(event instanceof CustomEvent)) return false;
  return event.detail?.id && event.detail.id !== id;
}
