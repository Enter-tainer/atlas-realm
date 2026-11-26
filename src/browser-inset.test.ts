import { describe, expect, it } from 'vitest';
import { floatingToolbarInset } from './browser-inset.js';

const SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const WEB_VIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

// An iPhone 16 Pro (393 x 852) whose page starts below the status bar and
// ends `bottom` points above the screen's bottom edge.
function iphone(bottom: number, userAgent = SAFARI, extra: { standalone?: boolean; landscape?: boolean } = {}) {
  const height = 852 - 62 - bottom;
  return {
    innerWidth: extra.landscape ? 852 : 393,
    innerHeight: extra.landscape ? 340 : height,
    navigator: { userAgent, standalone: extra.standalone },
    screen: { height: 852 },
  };
}

describe('floatingToolbarInset', () => {
  it('keeps clear of Safari’s floating toolbar where the page runs under it', () => {
    expect(floatingToolbarInset(iphone(0))).toBe(80);
  });

  it('adds nothing where the toolbar sits below or above the page', () => {
    // iOS 18's bottom bar, or iOS 26 with the address bar at the top.
    expect(floatingToolbarInset(iphone(83))).toBe(0);
    expect(floatingToolbarInset({ ...iphone(0), innerHeight: 852 - 62 - 56 })).toBe(0);
  });

  it('adds nothing outside Safari, at home screen, or in landscape', () => {
    expect(floatingToolbarInset(iphone(0, WEB_VIEW))).toBe(0);
    expect(floatingToolbarInset(iphone(0, ANDROID))).toBe(0);
    expect(floatingToolbarInset(iphone(0, SAFARI, { standalone: true }))).toBe(0);
    expect(floatingToolbarInset(iphone(0, SAFARI, { landscape: true }))).toBe(0);
  });
});
