import fs from 'fs'
import { createExpression, latest } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'

const style = JSON.parse(fs.readFileSync(new URL('../../public/orm/style/standard.json', import.meta.url), 'utf8'))
const layer = (id) => style.layers.find((candidate) => candidate.id === id)

function sortKey(id, properties) {
  const parsed = createExpression(layer(id).layout['symbol-sort-key'], latest.layout_symbol['symbol-sort-key'])
  expect(parsed.result).toBe('success')
  return parsed.value.evaluate({ zoom: 9 }, { type: 1, properties })
}

const routes = (count) =>
  Array.from({ length: count }, (_, index) => `${index}\u001e\u001eRoute ${index}`).join('\u001d')

describe('zoomed-out station placement', () => {
  for (const id of ['railway_text_stations_med', 'railway_text_stations']) {
    it(`lets ${id} stations give way, busiest first`, () => {
      expect(layer(id).layout['icon-overlap']).toBe('never')
      // Tokyo's train station: 94 routes, but a subway station 405 m away ranks above it.
      const hub = sortKey(id, { station_routes: routes(94), discr_iso: 405 })
      const isolatedHalt = sortKey(id, { station_routes: routes(4), discr_iso: 25000 })
      const nearbyHalt = sortKey(id, { station_routes: routes(4), discr_iso: 600 })
      expect(hub).toBeLessThan(isolatedHalt)
      expect(isolatedHalt).toBeLessThan(nearbyHalt)
      expect(sortKey(id, {})).toBeGreaterThan(nearbyHalt)
    })
  }
})
