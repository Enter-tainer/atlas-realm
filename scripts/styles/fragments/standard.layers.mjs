import { standardHistoricalLanduseLayers, standardHistoricalRailwayLineLayers, standardHistoricalStationsLayer } from './standard.historical.mjs'
import { standardRailwayLineLayers, standardTurntableLayers } from './standard.lines.mjs'
import { standardStationAreaLayers, standardStationTextLowLayers, standardStationTextHighLayers } from './standard.stations.mjs'
import { standardPlatformGeometryLayers, standardStopPositionsLayer, standardPlatformTextLayers } from './standard.platforms.mjs'
import { standardSymbolImageLayers, standardSymbolTrackLayers } from './standard.symbols.mjs'
import { hillshade, route, routeText, routeStops, searchResults } from '../shared.mjs'

// Layer ordering matches the reference OpenRailwayMap-vector implementation.
// Later layers render on top of earlier layers.
export const standardLayers = [
  hillshade,
  ...standardHistoricalLanduseLayers,
  ...standardStationAreaLayers,
  ...standardHistoricalRailwayLineLayers,
  ...standardPlatformGeometryLayers,
  ...standardRailwayLineLayers,
  route,
  routeText,
  ...standardStationTextLowLayers,
  ...standardTurntableLayers,
  ...standardStopPositionsLayer,
  ...standardSymbolImageLayers,
  ...standardPlatformTextLayers,
  ...standardSymbolTrackLayers,
  ...standardStationTextHighLayers,
  ...standardHistoricalStationsLayer,
  routeStops,
  searchResults,
]
