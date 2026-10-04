// Shared types for the photo library. Zod schemas for AI output and tool
// inputs are added alongside the phases that need them.

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

/** What ingestion hands to the database (id and created_at are generated). */
export type NewPhoto = Omit<Photo, "id" | "createdAt">;
