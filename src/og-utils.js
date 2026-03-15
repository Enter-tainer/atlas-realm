const BOT_USER_AGENTS = [
  'twitterbot',
  'facebookexternalhit',
  'linkedinbot',
  'slackbot',
  'telegrambot',
  'discordbot',
  'whatsapp',
  'googlebot',
  'bingbot',
];

export function isBot(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some(bot => ua.includes(bot));
}

function precisionForZoom(zoom) {
  if (zoom <= 5) return 0;
  if (zoom <= 9) return 1;
  if (zoom <= 12) return 2;
  if (zoom <= 16) return 3;
  return 4;
}

export function toCacheKey(zoom, lat, lng) {
  const roundedZoom = Math.floor(zoom) + 0.5;
  const precision = precisionForZoom(roundedZoom);
  const roundedLat = parseFloat(lat.toFixed(precision));
  const roundedLng = parseFloat(lng.toFixed(precision));
  return `${roundedZoom}/${roundedLat}/${roundedLng}`;
}

export function parseMapPath(pathname) {
  const ogMatch = pathname.match(/^\/og-image\/([\d.]+)\/([-\d.]+)\/([-\d.]+)\.png$/);
  if (ogMatch) {
    return {
      type: 'og-image',
      zoom: parseFloat(ogMatch[1]),
      lat: parseFloat(ogMatch[2]),
      lng: parseFloat(ogMatch[3]),
    };
  }

  const mapMatch = pathname.match(/^\/([\d.]+)\/([-\d.]+)\/([-\d.]+)$/);
  if (mapMatch) {
    return {
      type: 'map',
      zoom: parseFloat(mapMatch[1]),
      lat: parseFloat(mapMatch[2]),
      lng: parseFloat(mapMatch[3]),
    };
  }

  return null;
}
