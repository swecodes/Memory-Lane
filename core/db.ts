import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { NewPhoto, Photo, PhotoRow } from "./types";

// ---------- paths ----------

/** Absolute path of the data directory (photos.db, images/, thumbs/). */
export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR ?? "./data");
}

/** Turn a path stored in the DB (relative to DATA_DIR) into an absolute one. */
export function resolveDataPath(relativePath: string): string {
  return path.join(dataDir(), relativePath);
}

// ---------- connection ----------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_hash   TEXT    NOT NULL UNIQUE,
  filename    TEXT    NOT NULL,
  image_path  TEXT    NOT NULL,
  thumb_path  TEXT    NOT NULL,
  taken_at    TEXT    NOT NULL,
  lat         REAL,
  lon         REAL,
  caption     TEXT    NOT NULL,
  labels      TEXT    NOT NULL DEFAULT '[]',
  mood        TEXT    NOT NULL,
  embedding   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_taken_at ON photos(taken_at);

CREATE TABLE IF NOT EXISTS albums (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS album_photos (
  album_id    INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  photo_id    INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  PRIMARY KEY (album_id, photo_id)
);
`;

// Next.js dev mode re-evaluates modules on hot reload; caching the connection
// on globalThis keeps us at one connection per process instead of leaking them.
const globalForDb = globalThis as unknown as { photoDb?: Database.Database };

/** The single shared connection. Creates the data dir and schema on first use. */
export function getDb(): Database.Database {
  if (globalForDb.photoDb) return globalForDb.photoDb;

  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(path.join(dir, "photos.db"));
  db.pragma("journal_mode = WAL"); // web app and MCP server can read/write concurrently
  db.pragma("foreign_keys = ON"); // off by default in SQLite; needed for ON DELETE CASCADE
  db.exec(SCHEMA);

  globalForDb.photoDb = db;
  return db;
}

// ---------- row mapping ----------

function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    fileHash: row.file_hash,
    filename: row.filename,
    imagePath: row.image_path,
    thumbPath: row.thumb_path,
    takenAt: row.taken_at,
    lat: row.lat,
    lon: row.lon,
    caption: row.caption,
    labels: JSON.parse(row.labels) as string[],
    mood: row.mood,
    embedding: JSON.parse(row.embedding) as number[],
    createdAt: row.created_at,
  };
}

// ---------- photo queries ----------

export function photoExistsByHash(fileHash: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM photos WHERE file_hash = ?")
    .get(fileHash);
  return row !== undefined;
}

/** Inserts a photo and returns its new id. */
export function insertPhoto(photo: NewPhoto): number {
  const result = getDb()
    .prepare(
      `INSERT INTO photos
         (file_hash, filename, image_path, thumb_path, taken_at, lat, lon,
          caption, labels, mood, embedding)
       VALUES
         (@fileHash, @filename, @imagePath, @thumbPath, @takenAt, @lat, @lon,
          @caption, @labels, @mood, @embedding)`,
    )
    .run({
      ...photo,
      labels: JSON.stringify(photo.labels),
      embedding: JSON.stringify(photo.embedding),
    });
  return Number(result.lastInsertRowid);
}

export function getPhoto(id: number): Photo | null {
  const row = getDb().prepare("SELECT * FROM photos WHERE id = ?").get(id) as
    | PhotoRow
    | undefined;
  return row ? toPhoto(row) : null;
}

/** All photos, newest first. */
export function listPhotos(): Photo[] {
  const rows = getDb()
    .prepare("SELECT * FROM photos ORDER BY taken_at DESC, id DESC")
    .all() as PhotoRow[];
  return rows.map(toPhoto);
}

export function countPhotos(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM photos").get() as {
    n: number;
  };
  return row.n;
}
