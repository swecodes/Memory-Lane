// MCP server (stdio): exposes the photo library as tools for Claude Desktop or
// any MCP client. Uses the same core/ code as the web app.
//
// Run:     npm run mcp
// Inspect: npx @modelcontextprotocol/inspector npx tsx mcp/server.ts

import "./stdout-guard"; // must stay first: keeps stdout clean for the protocol

import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { z } from "zod";
import { buildEmbeddingText } from "../core/ingest";
import { embedText } from "../core/ai";
import {
  createAlbum,
  existingPhotoIds,
  getPhoto,
  listAlbums,
  listLabels,
  resolveDataPath,
  updateLabels,
} from "../core/db";
import { searchPhotos } from "../core/search";

// Clients like Claude Desktop start this process from an arbitrary folder, so
// resolve .env and a relative DATA_DIR against the project, not the cwd.
const projectRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });
process.env.DATA_DIR = path.resolve(projectRoot, process.env.DATA_DIR ?? "./data");

const server = new McpServer({ name: "memory-lane", version: "1.0.0" });

/** Tool results are text; JSON keeps them easy for the model to read. */
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("Date as YYYY-MM-DD (inclusive)");

server.registerTool(
  "search_photos",
  {
    title: "Search photos",
    description:
      "Semantic search over the user's photo library by what is in the photos (captions, labels, mood). " +
      "Optionally filter by date range or an exact label first. Returns the best matches with a similarity score (0-1; below ~0.3 is usually unrelated).",
    inputSchema: {
      query: z.string().min(1).describe('What to look for, in plain language, e.g. "dog at the park"'),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum results (default 8)"),
      date_from: isoDate.optional(),
      date_to: isoDate.optional(),
      label: z.string().optional().describe("Only photos with this exact label (see list_labels)"),
    },
  },
  async ({ query, limit, date_from, date_to, label }) => {
    const results = await searchPhotos({ query, limit, dateFrom: date_from, dateTo: date_to, label });
    return json(
      results.map((r) => ({
        id: r.id,
        caption: r.caption,
        labels: r.labels,
        date: r.takenAt.slice(0, 10),
        score: Number(r.score.toFixed(3)),
      })),
    );
  },
);

server.registerTool(
  "get_photo",
  {
    title: "Get photo",
    description: "Full details of one photo, including absolute file paths of the stored image and thumbnail.",
    inputSchema: { id: z.number().int().positive().describe("Photo id") },
  },
  async ({ id }) => {
    const photo = getPhoto(id);
    if (!photo) return fail(`No photo with id ${id}`);
    const { embedding: _embedding, fileHash: _hash, ...details } = photo;
    return json({
      ...details,
      imageFile: resolveDataPath(photo.imagePath),
      thumbnailFile: resolveDataPath(photo.thumbPath),
    });
  },
);

server.registerTool(
  "list_labels",
  {
    title: "List labels",
    description: "Every label in the library with how many photos have it, most common first.",
  },
  async () => json(listLabels()),
);

server.registerTool(
  "add_label",
  {
    title: "Add label",
    description: "Add a label (tag) to a photo. Labels are stored lowercase. The photo's search index is updated too.",
    inputSchema: {
      id: z.number().int().positive().describe("Photo id"),
      label: z.string().trim().min(1).max(40).describe('The label to add, e.g. "vacation"'),
    },
  },
  async ({ id, label }) => {
    const photo = getPhoto(id);
    if (!photo) return fail(`No photo with id ${id}`);
    const normalized = label.toLowerCase();
    if (photo.labels.includes(normalized)) return json({ id, labels: photo.labels, changed: false });

    const labels = [...photo.labels, normalized];
    // Labels are part of the embedded text, so re-embed to keep search in sync.
    // (Runs locally: no API call, no free-tier budget used.)
    const embedding = await embedText(
      buildEmbeddingText({ caption: photo.caption, labels, mood: photo.mood, objects: [] }, photo.takenAt),
    );
    updateLabels(id, labels, embedding);
    return json({ id, labels, changed: true });
  },
);

server.registerTool(
  "create_album",
  {
    title: "Create album",
    description: "Create a named album containing the given photos. Ids that don't exist are reported and skipped.",
    inputSchema: {
      name: z.string().trim().min(1).max(100).describe("Album name"),
      photo_ids: z.array(z.number().int().positive()).min(1).describe("Ids of the photos to put in the album"),
    },
  },
  async ({ name, photo_ids }) => {
    const unique = [...new Set(photo_ids)];
    const found = existingPhotoIds(unique);
    if (found.length === 0) return fail(`None of those photo ids exist: ${unique.join(", ")}`);
    const albumId = createAlbum(name, found);
    const missing = unique.filter((id) => !found.includes(id));
    return json({ albumId, name, photoCount: found.length, ...(missing.length ? { skippedMissingIds: missing } : {}) });
  },
);

server.registerTool(
  "list_albums",
  {
    title: "List albums",
    description: "All albums with how many photos each contains, newest first.",
  },
  async () => json(listAlbums()),
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  console.error(`memory-lane MCP server ready (data: ${process.env.DATA_DIR})`);
}

main().catch((error) => {
  console.error("MCP server failed to start:", error);
  process.exit(1);
});
