import { describe, expect, it } from 'vitest';
import { hideTunnelAndBridgeMarks, hideTunnelAndBridgeMarksInStyle } from './style-railway-marks.js';

describe('hideTunnelAndBridgeMarks', () => {
  it('hides tunnel covers and bridge railings', () => {
    for (const id of [
      'railway_line_main_tunnel_cover',
      'railway_line_subway_bridge_railing',
      'railway_line_historical_main_tunnel_cover',
    ]) {
      expect(hideTunnelAndBridgeMarks({ id, layout: { 'line-cap': 'butt' } })).toEqual({
        id,
        layout: { 'line-cap': 'butt', visibility: 'none' },
      });
    }
  });

  it('replaces an existing visibility expression', () => {
    const layer = {
      id: 'railway_line_main_tunnel_cover',
      layout: { visibility: ['case', ['get', 'x'], 'visible', 'none'] },
    };
    expect(hideTunnelAndBridgeMarks(layer).layout?.visibility).toBe('none');
  });

  it('leaves other railway layers, and their layout, alone', () => {
    for (const id of [
      'railway_line_main_fill_present',
      'railway_line_main_tunnel_fill_present',
      'railway_text_stations_med',
      'tunnel_cover',
    ]) {
      const layer = { id, layout: { 'line-cap': 'butt' } };
      expect(hideTunnelAndBridgeMarks(layer)).toBe(layer);
    }
  });
});

describe('hideTunnelAndBridgeMarksInStyle', () => {
  it('hides the marks of a style', () => {
    const style = {
      layers: [{ id: 'railway_line_main_fill_present' }, { id: 'railway_line_main_tunnel_cover', layout: {} }],
    };
    const result = hideTunnelAndBridgeMarksInStyle(style);
    expect(result.layers?.[0]).toEqual({ id: 'railway_line_main_fill_present' });
    expect(result.layers?.[1]).toEqual({ id: 'railway_line_main_tunnel_cover', layout: { visibility: 'none' } });
  });
});
