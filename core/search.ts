// searchPhotos(): the one retrieval function shared by the web chat, the CLI
// and the MCP server.
//
// Vectors are stored as JSON in SQLite and compared here in TypeScript. That
// is plenty fast for a few thousand photos; for much larger libraries,
// swap rankPhotos() for a sqlite-vec query and nothing else has to change.

import { embedText } from "./ai";
import { listPhotosForSearch, type PhotoFilters } from "./db";
import type { SearchResult } from "./types";

export interface SearchOptions extends PhotoFilters {
  query: string;
  limit?: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    // Happens if the embedding model was changed without re-ingesting.
    throw new Error(`Embedding size mismatch (${a.length} vs ${b.length}); re-ingest your photos`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

/** Filter by metadata first (in SQL), then rank what's left by similarity. */
export function rankPhotos(queryVector: number[], filters: PhotoFilters, limit: number): SearchResult[] {
  return listPhotosForSearch(filters)
    .map((photo) => ({
      id: photo.id,
      caption: photo.caption,
      labels: photo.labels,
      takenAt: photo.takenAt,
      thumbPath: photo.thumbPath,
      score: cosineSimilarity(queryVector, photo.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function searchPhotos({ query, limit = 8, ...filters }: SearchOptions): Promise<SearchResult[]> {
  const queryVector = await embedText(query);
  return rankPhotos(queryVector, filters, limit);
}
