// Cuts the sprites down to the icons the standard style can draw.
//
// The ORM sprites hold the icons of every ORM style (2761 each, 1.85 MB at
// @2x), while the standard style uses about a hundred. This lists every icon
// name the style's expressions can produce, copies those icons out of the full
// sprites into public/orm/{sprite,sdf_sprite}/standard{,@2x}.{png,json} and
// points the style's sprites there. The full sprites stay: main.ts loads them
// when MapLibre reports an icon missing, so a gap here costs a download, not
// an icon.
//
// Usage: node scripts/styles/sprite-subset.mjs (run by `pnpm generate:style`)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

// Stands for a part of a name only known from feature data.
const UNKNOWN = '\u0000'

// An icon name taken whole from feature data (POI symbols use the feature's
// `feature` value) cannot be resolved from the style. The export only ships
// POIs from the general/ family (export-tippecanoe.sh, standard_railway_symbols),
// so such names resolve to every general/ icon.
const UNCONSTRAINED_ICON_PREFIX = 'general/'

const IMAGE_PROPERTIES = ['icon-image', 'line-pattern', 'fill-pattern', 'background-pattern']

const SPRITES = [
  { id: 'sdf', dir: 'sdf_sprite' },
  { id: 'default', dir: 'sprite' },
]

// The strings an expression can evaluate to; parts read from feature data
// become UNKNOWN.
export function expressionStrings(expression) {
  if (typeof expression === 'string') return new Set([expression])
  if (!Array.isArray(expression) || expression.length === 0) return new Set([UNKNOWN])
  const [op, ...args] = expression
  const union = (values) => new Set(values.flatMap((value) => [...expressionStrings(value)]))
  switch (op) {
    case 'image':
    case 'to-string':
      return expressionStrings(args[0])
    case 'string':
    case 'coalesce':
      return union(args)
    case 'match':
      // input, label, output, label, output, ..., fallback
      return union([...args.slice(1, -1).filter((_, index) => index % 2 === 1), args.at(-1)])
    case 'case':
      // condition, output, condition, output, ..., fallback
      return union([...args.filter((_, index) => index % 2 === 1), args.at(-1)])
    case 'step':
      // input, output, stop, output, stop, output, ...
      return union([args[1], ...args.slice(3).filter((_, index) => index % 2 === 0)])
    case 'let':
      return expressionStrings(args.at(-1))
    case 'concat': {
      let combinations = ['']
      for (const arg of args) {
        const parts = [...expressionStrings(arg)]
        combinations = combinations.flatMap((prefix) => parts.map((part) => prefix + part))
      }
      return new Set(combinations)
    }
    default:
      return new Set([UNKNOWN])
  }
}

// Every icon name the style can ask for, possibly with UNKNOWN parts.
export function styleIconNames(style) {
  const names = new Set()
  for (const layer of style.layers || []) {
    for (const section of [layer.layout, layer.paint]) {
      for (const property of IMAGE_PROPERTIES) {
        if (section?.[property] === undefined) continue
        for (const name of expressionStrings(section[property])) if (name !== '') names.add(name)
      }
    }
  }
  return names
}

// The icons of one sprite that the style can reference. Names of other sprites
// carry their id as a prefix (sdf:...); the default sprite's are bare.
export function spriteIconsFor(names, spriteId, spriteIndex) {
  const prefix = spriteId === 'default' ? '' : `${spriteId}:`
  const icons = new Set()
  for (const name of names) {
    const own = prefix ? name.startsWith(prefix) : !/^[a-z_]+:/.test(name)
    if (!own) continue
    const key = name.slice(prefix.length)
    if (!key.includes(UNKNOWN)) {
      if (spriteIndex[key]) icons.add(key)
      continue
    }
    const pattern =
      key === UNKNOWN
        ? new RegExp(`^${UNCONSTRAINED_ICON_PREFIX}`)
        : new RegExp(`^${key.split(UNKNOWN).map(escapeRegExp).join('.*')}$`)
    for (const candidate of Object.keys(spriteIndex)) if (pattern.test(candidate)) icons.add(candidate)
  }
  return [...icons].sort()
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Packs the icons into rows, tallest first, and copies them out of the atlas.
async function writeSubset(atlasBase, icons, outBase) {
  const index = JSON.parse(fs.readFileSync(`${atlasBase}.json`, 'utf8'))
  const ordered = icons
    .map((name) => [name, index[name]])
    .sort(([a, x], [b, y]) => y.height - x.height || a.localeCompare(b))
  const width = Math.max(256, ...ordered.map(([, icon]) => icon.width))
  const placed = {}
  let x = 0
  let y = 0
  let rowHeight = 0
  for (const [name, icon] of ordered) {
    if (x + icon.width > width) {
      x = 0
      y += rowHeight
      rowHeight = 0
    }
    placed[name] = { ...icon, x, y }
    x += icon.width
    rowHeight = Math.max(rowHeight, icon.height)
  }
  // Rows are copied as raw RGBA: compositing with sharp premultiplies alpha and
  // shifts semi-transparent colors by one.
  const { data: atlas, info } = await sharp(`${atlasBase}.png`)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const height = y + rowHeight
  const sheet = Buffer.alloc(width * height * 4)
  for (const [name, icon] of ordered) {
    const target = placed[name]
    for (let row = 0; row < icon.height; row += 1) {
      const from = ((icon.y + row) * info.width + icon.x) * 4
      atlas.copy(sheet, ((target.y + row) * width + target.x) * 4, from, from + icon.width * 4)
    }
  }
  await sharp(sheet, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(`${outBase}.png`)
  fs.writeFileSync(`${outBase}.json`, JSON.stringify(Object.fromEntries(icons.map((name) => [name, placed[name]]))))
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const ormDir = path.join(root, 'public/orm')
  const stylePath = path.join(ormDir, 'style/standard.json')
  const style = JSON.parse(fs.readFileSync(stylePath, 'utf8'))
  const names = styleIconNames(style)
  for (const { id, dir } of SPRITES) {
    const full = path.join(ormDir, dir, 'symbols')
    const icons = spriteIconsFor(names, id, JSON.parse(fs.readFileSync(`${full}@2x.json`, 'utf8')))
    for (const suffix of ['', '@2x']) {
      await writeSubset(`${full}${suffix}`, icons, path.join(ormDir, dir, `standard${suffix}`))
    }
    console.log(`${dir}: ${icons.length} icons`)
  }
  style.sprite = SPRITES.map(({ id, dir }) => ({ id, url: `/${dir}/standard` }))
  fs.writeFileSync(stylePath, JSON.stringify(style))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
