import { standardHistoricalLayers } from './standard.historical.mjs'
import { standardLinesLayers } from './standard.lines.mjs'
import { standardStationsLayers } from './standard.stations.mjs'
import { standardPlatformsLayers } from './standard.platforms.mjs'
import { standardSymbolsLayers } from './standard.symbols.mjs'

export const standardLayers = [
  ...standardHistoricalLayers,
  ...standardLinesLayers,
  ...standardStationsLayers,
  ...standardPlatformsLayers,
  ...standardSymbolsLayers,
]
