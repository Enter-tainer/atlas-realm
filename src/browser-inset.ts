// Safari on iOS 26 draws its toolbar as a floating capsule over the bottom of
// the page instead of below it, and reports it nowhere: the page runs down to
// the screen's edge, and env(safe-area-inset-bottom) stays 0 in portrait. Where
// the page reaches that far, --browser-inset-bottom (style.css) keeps the bottom
// sheet's head and the bottom map controls above the toolbar.
//
// Ported from SharzyL/map (src/browser-inset.ts).
export const BROWSER_INSET_PROPERTY = '--browser-inset-bottom';
// From the screen's bottom edge to the top of the toolbar's capsule.
const FLOATING_TOOLBAR_HEIGHT = 80;
// The most a status bar takes off the top of the screen: a page that starts
// lower has browser chrome above it or below it.
const STATUS_BAR_MAX = 70;

type InsetWindow = Pick<Window, 'innerWidth' | 'innerHeight'> & {
  navigator: { userAgent: string; standalone?: boolean };
  screen: { height: number };
};

export function floatingToolbarInset(win: InsetWindow) {
  const { userAgent, standalone } = win.navigator;
  // Safari itself, not an app's web view (no Safari/ token) or a home screen app.
  if (!/iPhone/.test(userAgent) || !/Safari\//.test(userAgent) || standalone) return 0;
  // In landscape the toolbar moves aside and the sheets give way to panels.
  if (win.innerWidth > win.innerHeight) return 0;
  // The screen's height stays its portrait height.
  return win.screen.height - win.innerHeight <= STATUS_BAR_MAX ? FLOATING_TOOLBAR_HEIGHT : 0;
}

export function installBrowserInset(win: Window = window) {
  const root = win.document.documentElement;
  const update = () => {
    const inset = floatingToolbarInset(win);
    if (inset > 0) root.style.setProperty(BROWSER_INSET_PROPERTY, `${inset}px`);
    else root.style.removeProperty(BROWSER_INSET_PROPERTY);
  };
  update();
  win.addEventListener('resize', update, { passive: true });
}
