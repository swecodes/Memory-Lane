// DELETE /api/photos/:id — remove a photo, its album links and its stored files.

import fs from "node:fs/promises";
import { deletePhoto, resolveDataPath } from "@/core/db";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Photo id must be a positive whole number" }, { status: 400 });
  }

  // Database first: once the row is gone the photo has left the library. If a
  // file delete then fails, the leftover file is harmless and nothing points to it.
  const deleted = deletePhoto(id);
  if (!deleted) return Response.json({ error: `No photo with id ${id}` }, { status: 404 });

  await Promise.all(
    [deleted.imagePath, deleted.thumbPath].map((p) =>
      fs.rm(resolveDataPath(p), { force: true }).catch((error) => console.error(`[delete] couldn't remove ${p}:`, error)),
    ),
  );
  return Response.json({ deleted: id });
}
