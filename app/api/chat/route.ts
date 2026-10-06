// POST /api/chat  — streaming RAG answer over the photo library.
//
// Body: { messages: { role: "user" | "assistant", content: string }[] }
// Reply: plain text stream. Photos are cited inline as [photo:ID], which the
// UI turns into clickable thumbnails.

import { z } from "zod";
import { describeProviderError, streamChatAnswer } from "@/core/ai";
import { countPhotos } from "@/core/db";
import { BusyError, DailyLimitError } from "@/core/ratelimit";
import { searchPhotos } from "@/core/search";
import type { SearchResult } from "@/core/types";

export const runtime = "nodejs"; // native modules (SQLite, ONNX) need Node, not the edge runtime

const ChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4_000),
      }),
    )
    .min(1)
    .max(50),
});

const HISTORY_TURNS = 6; // older turns are dropped to keep each request small
const RETRIEVED_PHOTOS = 8;

const SYSTEM_PROMPT = `You are Memory Lane, an assistant that answers questions about the user's personal photo library.

You only know the photos in the PHOTO RECORDS below. Each record has an id, the date taken, labels and an AI-written caption. You cannot see the images themselves, only these descriptions.

Rules:
- Answer only from the records. Never invent photos, people, places, dates or details that aren't in them.
- Every time you mention a photo, cite it with its tag exactly as written, e.g. [photo:12]. Cite several like [photo:3] [photo:7].
- Each record has a relevance score from 0 to 1. Below about 0.3 a record is usually unrelated to the question; don't present it as a match.
- If no record fits the question, say plainly that you couldn't find matching photos and suggest what the user could search for instead.
- Be concise: a few sentences, or a short list when listing several photos.`;

function formatRecords(results: SearchResult[]): string {
  return results
    .map(
      (r) =>
        `[photo:${r.id}] taken ${r.takenAt.slice(0, 10)} | relevance ${r.score.toFixed(2)} | labels: ${r.labels.join(", ")}\n` +
        `caption: ${r.caption}`,
    )
    .join("\n\n");
}

/**
 * Wait for the model's first text before answering 200, so failures that
 * happen up front (bad key, unknown model, rate limit) become real HTTP
 * errors the UI can show, instead of an empty 200 stream.
 */
async function textStreamResponse(fullStream: AsyncIterable<{ type: string; text?: string; error?: unknown }>) {
  const parts = fullStream[Symbol.asyncIterator]();
  let firstText = "";
  for (;;) {
    const { done, value } = await parts.next();
    if (done) break;
    if (value.type === "error") throw value.error;
    if (value.type === "text-delta" && value.text) {
      firstText = value.text;
      break;
    }
  }
  if (!firstText) throw new Error("The model returned an empty answer.");

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(firstText));
    },
    // pull() must enqueue something or close before returning: if it returns
    // empty-handed (e.g. after a "step finished" event), the stream never
    // calls it again and the response hangs open. So skip non-text events here.
    async pull(controller) {
      for (;;) {
        const { done, value } = await parts.next();
        if (done) return controller.close();
        if (value.type === "text-delta" && value.text) return controller.enqueue(encoder.encode(value.text));
        if (value.type === "error") {
          controller.enqueue(encoder.encode(`\n\n(The answer was cut off: ${describeProviderError(value.error).message})`));
          return controller.close();
        }
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function errorResponse(status: number, message: string, headers?: HeadersInit): Response {
  return Response.json({ error: message }, { status, headers });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = ChatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Expected { messages: [{ role, content }] }");

  const history = parsed.data.messages.slice(-HISTORY_TURNS);
  const userTurns = history.filter((m) => m.role === "user");
  if (userTurns.length === 0) return errorResponse(400, "The conversation needs a user message");

  // Nothing to search: answer directly instead of spending an API call.
  if (countPhotos() === 0) {
    return new Response(
      "Your library is empty, so there's nothing to search yet. Upload some photos (or run `npm run seed -- <folder>`) and ask again.",
      { headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  if (!process.env.GROQ_API_KEY) return errorResponse(500, "GROQ_API_KEY is not set on the server");

  // Retrieve with the latest question plus the one before it, so short
  // follow-ups ("which of those was in March?") keep their context.
  const retrievalQuery = userTurns
    .slice(-2)
    .map((m) => m.content)
    .join("\n");
  const results = await searchPhotos({ query: retrievalQuery, limit: RETRIEVED_PHOTOS });
  const system = `${SYSTEM_PROMPT}\n\nPHOTO RECORDS (most relevant first):\n\n${formatRecords(results)}`;

  try {
    const result = await streamChatAnswer(system, history);
    return await textStreamResponse(result.fullStream);
  } catch (error) {
    if (error instanceof BusyError) {
      return errorResponse(429, error.message, { "Retry-After": String(error.retryAfterSec) });
    }
    if (error instanceof DailyLimitError) return errorResponse(429, error.message);
    const { status, message } = describeProviderError(error);
    return errorResponse(status, message);
  }
}
