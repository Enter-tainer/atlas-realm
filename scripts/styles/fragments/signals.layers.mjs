import { signals_linesLayers } from './signals.lines.mjs'
import { signals_symbolsLayers } from './signals.symbols.mjs'
import { signals_textsLayers } from './signals.texts.mjs'
import { signals_boxesLayers } from './signals.boxes.mjs'

export const signalsLayers = [
  ...signals_linesLayers,
  ...signals_symbolsLayers,
  ...signals_textsLayers,
  ...signals_boxesLayers,
]
