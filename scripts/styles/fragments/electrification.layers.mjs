import { electrification_linesLayers } from './electrification.lines.mjs'
import { electrification_textsLayers } from './electrification.texts.mjs'
import { electrification_substationsLayers } from './electrification.substations.mjs'

export const electrificationLayers = [
  ...electrification_linesLayers,
  ...electrification_textsLayers,
  ...electrification_substationsLayers,
]
