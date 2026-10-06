// POST /api/ingest — upload one photo (multipart form field "file").
// Optional field "lastModified" (epoch ms, from the browser's File object) is
// used as the date taken when the photo has no EXIF date.
//
// One file per request keeps it simple and lets the UI show per-file progress.
// A request can take a while: the rate limiter may wait for a free-tier slot.

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describeProviderError } from "@/core/ai";
import { getPhoto } from "@/core/db";
import { ingestPhoto } from "@/core/ingest";
import { DailyLimitError } from "@/core/ratelimit";

export const runtime = "nodejs";

const MAX_BYTES = 30 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  if (!process.env.GROQ_API_KEY) {
    return Response.json({ error: "GROQ_API_KEY is not set on the server" }, { status: 500 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: 'Expected a multipart form with a "file" field' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "File is larger than 30 MB" }, { status: 413 });
  }

  const lastModified = Number(form?.get("lastModified"));
  const fallbackTakenAt = Number.isFinite(lastModified) && lastModified > 0 ? new Date(lastModified) : undefined;

  // ingestPhoto works on paths, so park the upload in a temp file.
  const tempPath = path.join(os.tmpdir(), `photo-memory-${randomUUID()}${path.extname(file.name)}`);
  try {
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
    const result = await ingestPhoto(tempPath, { filename: file.name, fallbackTakenAt });
    if (result.status === "skipped") {
      return Response.json({ status: "skipped", filename: file.name });
    }
    const { embedding: _embedding, fileHash: _hash, ...photo } = getPhoto(result.id)!;
    return Response.json({ status: "added", photo });
  } catch (error) {
    if (error instanceof DailyLimitError) {
      return Response.json({ error: error.message, dailyLimit: true }, { status: 429 });
    }
    const { status, message } = describeProviderError(error);
    return Response.json({ error: message }, { status: status === 500 ? 422 : status });
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}
