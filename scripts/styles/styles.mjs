import fs from 'fs'
import yaml from 'yaml'
import { knownStyles, defaultDate } from './shared.mjs'
import { sources } from './fragments/sources.mjs'
import { standardLayers } from './fragments/standard.layers.mjs'
import { speedLayers } from './fragments/speed.layers.mjs'
import { signalsLayers } from './fragments/signals.layers.mjs'
import { electrificationLayers } from './fragments/electrification.layers.mjs'
import { trackLayers } from './fragments/track.layers.mjs'
import { operatorLayers } from './fragments/operator.layers.mjs'
import { routeLayers } from './fragments/route.layers.mjs'

const layers = { standard: standardLayers, speed: speedLayers, signals: signalsLayers, electrification: electrificationLayers, track: trackLayers, operator: operatorLayers, route: routeLayers };

const DATA_MAX_ZOOM = 14;

const capSourcesForDataMaxZoom = originalSources =>
  Object.fromEntries(
    Object.entries(originalSources).map(([name, source]) => {
      if (source?.type === 'vector' && source.url) {
        return [name, {
          ...source,
          maxzoom: DATA_MAX_ZOOM,
        }];
      }
      return [name, source];
    })
  );

const capLayersForDataMaxZoom = originalLayers =>
  originalLayers.map(layer => {
    const next = {...layer};

    if (typeof next.minzoom === 'number' && next.minzoom > DATA_MAX_ZOOM) {
      next.minzoom = DATA_MAX_ZOOM;
    }

    if (typeof next.maxzoom === 'number' && next.maxzoom > DATA_MAX_ZOOM) {
      delete next.maxzoom;
    }

    return next;
  });

const makeStyle = selectedStyle => ({
  center: [12.55, 51.14], // default
  zoom: 3.75, // default
  glyphs: '/font/{fontstack}/{range}',
  metadata: {
    dataMaxZoom: DATA_MAX_ZOOM,
    z14Capped: true,
  },
  name: `OpenRailwayMap ${selectedStyle}`,
  sources: capSourcesForDataMaxZoom(sources),
  sprite: [
    {
      id: 'sdf',
      url: '/sdf_sprite/symbols'
    },
    {
      id: 'default',
      url: '/sprite/symbols'
    }
  ],
  version: 8,
  layers: capLayersForDataMaxZoom(layers[selectedStyle]),
  state: {
    date: {
      default: defaultDate,
    },
    allDates: {
      default: false,
    },
    theme: {
      default: 'light',
    },
    stationLowZoomLabel: {
      default: 'label',
    },
    showConstructionInfrastructure: {
      default: true,
    },
    showProposedInfrastructure: {
      default: true,
    },
    showAbandonedInfrastructure: {
      default: false,
    },
    showRazedInfrastructure: {
      default: false,
    },
    openHistoricalMap: {
      default: true,
    },
    hillshade: {
      default: false,
    },
    electrificationRailwayLine: {
      default: 'voltageFrequency',
    },
    trackRailwayLine: {
      default: 'gauge',
    },
  },
});

knownStyles.forEach(style => {
  fs.writeFileSync(`${style}.json`, JSON.stringify(makeStyle(style)));
});
