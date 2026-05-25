import { route_linesLayers } from './route.lines.mjs'
import { route_textsLayers } from './route.texts.mjs'

export const routeLayers = [...route_linesLayers, ...route_textsLayers]
