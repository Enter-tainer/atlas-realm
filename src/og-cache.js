const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS og_images (
  path_key TEXT PRIMARY KEY,
  image BLOB NOT NULL,
  version TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

const TTL_SECONDS = 30 * 24 * 60 * 60;

export async function ensureTable(db) {
  await db.prepare(SCHEMA_SQL).run();
}

export async function getCachedImage(db, pathKey, version) {
  const row = await db.prepare(
    'SELECT image, created_at FROM og_images WHERE path_key = ? AND version = ?'
  ).bind(pathKey, version).first();

  if (!row) return null;

  const age = Math.floor(Date.now() / 1000) - row.created_at;
  if (age > TTL_SECONDS) {
    await db.prepare('DELETE FROM og_images WHERE path_key = ?').bind(pathKey).run();
    return null;
  }

  // D1 returns BLOB as ArrayBuffer; wrap in Uint8Array for Response compatibility
  return new Uint8Array(row.image);
}

export async function setCachedImage(db, pathKey, imageBuffer, version) {
  await db.prepare(
    'INSERT OR REPLACE INTO og_images (path_key, image, version, created_at) VALUES (?, ?, ?, ?)'
  ).bind(pathKey, imageBuffer, version, Math.floor(Date.now() / 1000)).run();
}
