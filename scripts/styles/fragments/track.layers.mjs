import { track_linesLayers } from './track.lines.mjs'
import { track_textsLayers } from './track.texts.mjs'

export const trackLayers = [
  ...track_linesLayers,
  ...track_textsLayers,
]
