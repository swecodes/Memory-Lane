// GET /api/image/images/<hash>.jpg  or  /api/image/thumbs/<hash>.jpg
// Serves the compressed copies and thumbnails stored under DATA_DIR.

import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/core/db";

export const runtime = "nodejs";

const ALLOWED_FOLDERS = new Set(["images", "thumbs"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const segments = (await params).path;

  // Only files directly inside images/ or thumbs/, and nothing that could
  // climb out of the data folder ("..", absolute paths, encoded slashes).
  if (segments.length !== 2 || !ALLOWED_FOLDERS.has(segments[0])) {
    return new Response("Not found", { status: 404 });
  }
  const root = dataDir();
  const filePath = path.resolve(root, segments[0], segments[1]);
  if (path.dirname(filePath) !== path.join(root, segments[0]) || !filePath.endsWith(".jpg")) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await fs.readFile(filePath);
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "image/jpeg",
        // File names are content hashes, so a given URL never changes content.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
