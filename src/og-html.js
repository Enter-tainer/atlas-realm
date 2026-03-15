export function ogHtml(baseUrl, zoom, lat, lng, cacheKey) {
  const imageUrl = `${baseUrl}/og-image/${cacheKey}.png`;
  const pageUrl = `${baseUrl}/${zoom}/${lat}/${lng}`;
  const title = `mgt's map — ${lat}, ${lng} (z${Math.floor(zoom)})`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:type" content="website">
  <meta property="og:description" content="Interactive railway map">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:image" content="${imageUrl}">
  <meta http-equiv="refresh" content="0;url=${pageUrl}">
</head>
<body>
  <p>Redirecting to <a href="${pageUrl}">${title}</a>...</p>
</body>
</html>`;
}
