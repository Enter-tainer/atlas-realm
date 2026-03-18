import { speed_railwayLineLayers, speed_signalImageLayers } from './speed.lines.mjs'
import { speed_signalDirectionLayer, speed_signalTextLayer } from './speed.texts.mjs'
import { route, routeText, routeStops, searchResults } from '../shared.mjs'

// Layer ordering matches the reference OpenRailwayMap-vector implementation.
export const speedLayers = [
  ...speed_railwayLineLayers,
  route,
  routeText,
  ...speed_signalDirectionLayer,
  ...speed_signalImageLayers,
  ...speed_signalTextLayer,
  routeStops,
  searchResults,
]
