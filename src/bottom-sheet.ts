// On phones the info box (popup.ts) is a sheet along the bottom of the map,
// resting at one of three heights, like Apple Maps' sheets: half the map (where
// it opens, so what it shows on the map stays visible in the upper half),
// nearly all of it (up to just below the search box), or collapsed to its head.
// A sheet with little in it is only as tall as that. A grabber along its top
// taps it between collapsed and half, or drags it to any of the three. The
// height is the sheet's --sheet-max (style.css); collapsing moves it down with
// `translate` (by --sheet-peek), as dragging below half does (by --sheet-drag),
// which adds to whatever transform it already has, keeping its bottom padding
// (the home indicator's safe area) in view below its head.
//
// Ported from SharzyL/map (src/bottom-sheet.ts).
export const SHEET_MEDIA_QUERY = '(max-width: 640px)';
const DRAG_THRESHOLD = 24;
const HALF = 0.5;
// The room a full sheet leaves at the map's top, for the search box.
const FULL_TOP_GAP = 72;

export function isSheetLayout() {
  return window.matchMedia?.(SHEET_MEDIA_QUERY).matches ?? false;
}

export type SheetDetent = 'collapsed' | 'half' | 'full';
const DETENTS: SheetDetent[] = ['collapsed', 'half', 'full'];

export type SheetOptions = {
  // Named in the grabber's label: "Collapse <label>".
  label: string;
  // How much of the sheet shows when collapsed, from its top.
  peek: () => number;
  // Where a drag can start besides the grabber, such as a panel's header.
  handles?: HTMLElement[];
  // Where a tap opens a collapsed sheet again.
  expandZone?: HTMLElement;
};

export function installSheetCollapse(sheet: HTMLElement, grabber: HTMLButtonElement, options: SheetOptions) {
  const { label, peek, handles = [], expandZone = sheet } = options;
  grabber.type = 'button';
  grabber.classList.add('sheet-grabber');

  const room = () => sheet.parentElement?.clientHeight || window.innerHeight;
  const maxHeight = (detent: SheetDetent) =>
    detent === 'full' ? Math.max(0, room() - FULL_TOP_GAP) : Math.round(room() * HALF);
  const inset = () => parseFloat(getComputedStyle(sheet).paddingBottom) || 0;
  let detent: SheetDetent = 'half';
  const setDetent = (next: SheetDetent) => {
    detent = next;
    // Collapsing keeps half's height; only the head shows.
    sheet.style.setProperty('--sheet-max', `${maxHeight(next === 'full' ? 'full' : 'half')}px`);
    if (next === 'collapsed') sheet.style.setProperty('--sheet-peek', `${peek()}px`);
    sheet.classList.toggle('sheet-collapsed', next === 'collapsed');
    sheet.classList.toggle('sheet-full', next === 'full');
    grabber.setAttribute('aria-label', `${next === 'collapsed' ? 'Expand' : 'Collapse'} ${label}`);
    grabber.setAttribute('aria-expanded', String(next !== 'collapsed'));
  };
  const isCollapsed = () => detent === 'collapsed';
  const setCollapsed = (collapsed: boolean) => setDetent(collapsed ? 'collapsed' : 'half');
  setDetent('half');
  window.addEventListener('resize', () => setDetent(detent), { passive: true });

  // A drag moves the sheet's top with the pointer: above half by growing the
  // sheet, below by sliding it down. It ends at the resting height it moved
  // toward, or the nearer one when it moved only a little. A tap on the
  // grabber toggles collapsed and half (as a click, so keys work too).
  type Drag = {
    pointerId: number;
    startY: number;
    from: SheetDetent;
    // The visible height at the start, and at each resting height.
    start: number;
    heights: Record<SheetDetent, number> | null;
    visible: number;
  };
  let drag: Drag | null = null;
  let dragged = false;
  // The sheet's height with `max` as its --sheet-max, read with transitions off.
  const heightWith = (max: number) => {
    sheet.style.setProperty('--sheet-max', `${max}px`);
    return sheet.getBoundingClientRect().height;
  };
  const beginDrag = (current: Drag) => {
    const height = sheet.getBoundingClientRect().height;
    const collapsed = peek() + inset();
    current.start = detent === 'collapsed' ? collapsed : height;
    sheet.style.setProperty('--sheet-drag', `${height - current.start}px`);
    sheet.classList.add('sheet-dragging');
    sheet.classList.remove('sheet-collapsed');
    const half = heightWith(maxHeight('half'));
    const full = heightWith(maxHeight('full'));
    current.heights = { collapsed, half, full };
    current.visible = current.start;
  };
  const show = (visible: number) => {
    const heights = drag?.heights;
    if (!drag || !heights) return;
    drag.visible = Math.min(heights.full, Math.max(heights.collapsed, visible));
    if (drag.visible >= heights.half) {
      sheet.style.setProperty('--sheet-max', `${drag.visible}px`);
      sheet.style.setProperty('--sheet-drag', '0px');
    } else {
      sheet.style.setProperty('--sheet-max', `${maxHeight('half')}px`);
      sheet.style.setProperty('--sheet-drag', `${heights.half - drag.visible}px`);
    }
  };
  const startDrag = (handle: HTMLElement) => (event: PointerEvent) => {
    if (!isSheetLayout() || event.button > 0) return;
    if (handle !== grabber && (event.target as Element).closest?.('button, a, input, select, [role="button"]')) return;
    drag = { pointerId: event.pointerId, startY: event.clientY, from: detent, start: 0, heights: null, visible: 0 };
    dragged = false;
    handle.setPointerCapture?.(event.pointerId);
  };
  const moveDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!dragged && Math.abs(event.clientY - drag.startY) <= 4) return;
    if (!dragged) beginDrag(drag);
    dragged = true;
    show(drag.start - (event.clientY - drag.startY));
  };
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    drag = null;
    if (!dragged) return;
    // Past the click this drag ends in (below).
    setTimeout(() => (dragged = false));
    const { heights, start, visible } = current;
    if (!heights) return;
    // Full only where it is taller than half: a short sheet has two heights.
    const detents = DETENTS.filter((it) => it !== 'full' || heights.full - heights.half > 4);
    const moved = visible - start;
    const toward =
      Math.abs(moved) >= DRAG_THRESHOLD
        ? detents.filter((it) => (moved > 0 ? heights[it] > start + 1 : heights[it] < start - 1))
        : detents;
    const target = (toward.length ? toward : detents).reduce((best, it) =>
      Math.abs(heights[it] - visible) < Math.abs(heights[best] - visible) ? it : best,
    );
    sheet.classList.remove('sheet-dragging');
    setDetent(target);
  };
  for (const handle of [grabber, ...handles]) {
    handle.addEventListener('pointerdown', startDrag(handle));
    handle.addEventListener('pointermove', moveDrag);
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }
  // A drag ends in a click on the element it started on; that click is the
  // drag's, not a tap.
  sheet.addEventListener(
    'click',
    (event) => {
      if (!dragged) return;
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );
  grabber.addEventListener('click', () => setCollapsed(!isCollapsed()));
  expandZone.addEventListener('click', (event) => {
    if (!isCollapsed() || event.target === grabber) return;
    if ((event.target as Element).closest?.('a, button, [role="button"]')) return;
    setCollapsed(false);
  });

  return {
    setCollapsed,
    isCollapsed,
    setDetent,
    get detent() {
      return detent;
    },
  };
}

// The sheets open on a phone, oldest first. Only the latest shows: those under
// it slide away (`.sheet-covered`, style.css) until it closes, as a card pushed
// onto Apple Maps' stack covers the one it was opened from; then the one below
// comes back as it was left, collapsed or not.
const openSheets: HTMLElement[] = [];

function uncoverTop() {
  openSheets.forEach((sheet, index) => sheet.classList.toggle('sheet-covered', index < openSheets.length - 1));
}

export function sheetOpened(sheet: HTMLElement) {
  const index = openSheets.indexOf(sheet);
  if (index >= 0) openSheets.splice(index, 1);
  openSheets.push(sheet);
  uncoverTop();
}

export function sheetClosed(sheet: HTMLElement) {
  const index = openSheets.indexOf(sheet);
  if (index < 0) return;
  openSheets.splice(index, 1);
  sheet.classList.remove('sheet-covered');
  uncoverTop();
}
