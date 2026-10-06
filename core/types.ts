// Shared types for the photo library. Zod schemas for AI output and tool
// inputs are added alongside the phases that need them.

import { z } from "zod";

/**
 * What the vision model must return for each photo. Validation fails (and the
 * caller retries once) if the shape or the label count is wrong; the
 * transforms then normalise the casing so search and filters are consistent.
 */
export const CaptionSchema = z.object({
  caption: z.string().trim().min(1),
  labels: z
    .array(z.string().trim().min(1))
    .min(3)
    .max(8)
    .transform((labels) => [...new Set(labels.map((l) => l.toLowerCase()))]),
  // "One word" is easy for a model to get slightly wrong ("calm, peaceful"),
  // so keep the first word rather than rejecting the whole caption.
  mood: z
    .string()
    .trim()
    .min(1)
    .transform((m) => m.toLowerCase().split(/[\s,;/]+/)[0]),
  objects: z.array(z.string().trim().min(1)),
});

export type Caption = z.infer<typeof CaptionSchema>;

/** A row exactly as stored in the `photos` table (JSON columns are strings). */
export interface PhotoRow {
  id: number;
  file_hash: string;
  filename: string;
  image_path: string;
  thumb_path: string;
  taken_at: string;
  lat: number | null;
  lon: number | null;
  caption: string;
  labels: string;
  mood: string;
  embedding: string;
  created_at: string;
}

/** A photo as the rest of the app sees it: camelCase, JSON parsed. */
export interface Photo {
  id: number;
  fileHash: string;
  filename: string;
  /** Relative to DATA_DIR. */
  imagePath: string;
  /** Relative to DATA_DIR. */
  thumbPath: string;
  takenAt: string;
  lat: number | null;
  lon: number | null;
  caption: string;
  labels: string[];
  mood: string;
  embedding: number[];
  createdAt: string;
}

/** A photo without its embedding or hash: what the gallery and API responses need. */
export type PhotoSummary = Omit<Photo, "embedding" | "fileHash">;

/** One search hit, shared by the CLI, the chat route and the MCP server. */
export interface SearchResult {
  id: number;
  caption: string;
  labels: string[];
  takenAt: string;
  thumbPath: string;
  /** Cosine similarity, -1..1; higher is more similar. */
  score: number;
}

/** What ingestion hands to the database (id and created_at are generated). */
export type NewPhoto = Omit<Photo, "id" | "createdAt">;
