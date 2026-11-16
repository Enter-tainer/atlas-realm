// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { installSheetCollapse, sheetClosed, sheetOpened } from './bottom-sheet.js';

function sheetFixture(className = 'sheet') {
  const sheet = document.createElement('div');
  sheet.className = className;
  const grabber = document.createElement('button');
  sheet.appendChild(grabber);
  document.body.appendChild(sheet);
  return { sheet, grabber };
}

const covered = (sheet: HTMLElement) => sheet.classList.contains('sheet-covered');

describe('installSheetCollapse', () => {
  it('opens at half, and the grabber taps it down to its head and back', () => {
    const { sheet, grabber } = sheetFixture();
    installSheetCollapse(sheet, grabber, { label: 'info box', peek: () => 64 });

    expect(grabber.classList.contains('sheet-grabber')).toBe(true);
    expect(grabber.getAttribute('aria-label')).toBe('Collapse info box');
    expect(grabber.getAttribute('aria-expanded')).toBe('true');
    expect(sheet.classList.contains('sheet-collapsed')).toBe(false);

    grabber.click();
    expect(sheet.classList.contains('sheet-collapsed')).toBe(true);
    expect(sheet.style.getPropertyValue('--sheet-peek')).toBe('64px');
    expect(grabber.getAttribute('aria-label')).toBe('Expand info box');
    expect(grabber.getAttribute('aria-expanded')).toBe('false');

    grabber.click();
    expect(sheet.classList.contains('sheet-collapsed')).toBe(false);
  });
});

describe('the stack of open sheets', () => {
  it('shows only the latest, and the one below again once it closes', () => {
    const first = sheetFixture('first').sheet;
    const second = sheetFixture('second').sheet;

    sheetOpened(first);
    expect(covered(first)).toBe(false);

    // A sheet opened over another covers it, as it was left.
    first.classList.add('sheet-collapsed');
    sheetOpened(second);
    expect(covered(first)).toBe(true);
    expect(covered(second)).toBe(false);

    sheetClosed(second);
    expect(covered(first)).toBe(false);
    expect(first.classList.contains('sheet-collapsed')).toBe(true);
  });

  it('keeps the sheet that is still open covered until it too closes', () => {
    const bottom = sheetFixture('bottom').sheet;
    const middle = sheetFixture('middle').sheet;
    const top = sheetFixture('top').sheet;

    sheetOpened(bottom);
    sheetOpened(middle);
    sheetOpened(top);
    expect([covered(bottom), covered(middle), covered(top)]).toEqual([true, true, false]);

    sheetClosed(top);
    expect([covered(bottom), covered(middle)]).toEqual([true, false]);
    sheetClosed(middle);
    expect(covered(bottom)).toBe(false);
  });
});
