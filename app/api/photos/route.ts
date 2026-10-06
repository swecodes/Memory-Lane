// GET /api/photos — every photo (without embeddings), newest first, for the gallery.

import { listPhotoSummaries } from "@/core/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // the library changes; never serve a cached list

export function GET(): Response {
  return Response.json({ photos: listPhotoSummaries() });
}
