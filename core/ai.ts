// All model access lives here, so the rest of the app never imports a
// provider SDK directly. Captions (and later chat) go to Groq's free tier
// through the rate limiter; embeddings run locally on this machine.

import { groq } from "@ai-sdk/groq";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { APICallError, generateText, Output, streamText, type LanguageModelUsage, type ModelMessage } from "ai";
import { DailyLimitError, recordActualTokens, reserveCall, withRateLimit } from "./ratelimit";
import { CaptionSchema, type Caption } from "./types";

// ---------- models ----------

export const VISION_MODEL = process.env.GROQ_VISION_MODEL ?? "qwen/qwen3.8-27b";
export const CHAT_MODEL = process.env.GROQ_CHAT_MODEL ?? "openai/gpt-oss-20b";

/**
 * Local sentence-embedding model (384 dimensions, ~25 MB, downloaded from
 * Hugging Face on first use and cached). Changing it later means re-embedding
 * every photo: vectors from different models can't be compared.
 */
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

// ---------- errors ----------

/** Turn a provider error into a message that says how to fix it. */
export function describeProviderError(error: unknown): { status: number; message: string } {
  if (APICallError.isInstance(error)) {
    switch (error.statusCode) {
      case 401:
        return { status: 502, message: "Groq rejected the API key (401). Check GROQ_API_KEY in your .env file." };
      case 404:
        return {
          status: 502,
          message: `Groq doesn't recognise the model (404). It may have been retired; set GROQ_VISION_MODEL or GROQ_CHAT_MODEL in .env.`,
        };
      case 429:
        return { status: 429, message: "Groq's free-tier limit was reached. Wait a minute and try again." };
    }
    return { status: 502, message: `Groq request failed (${error.statusCode ?? "no response"}): ${error.message}` };
  }
  return { status: 500, message: error instanceof Error ? error.message : String(error) };
}

// ---------- captioning ----------

const CAPTION_SYSTEM =
  "You describe personal photos for a searchable photo library. " +
  "Reply with a single JSON object and nothing else.";

const CAPTION_PROMPT = `Describe this photo as a JSON object with exactly these keys:
- "caption": 1 to 2 sentences saying concretely what is in the photo (people, place, activity, food, objects). Never guess people's names.
- "labels": 3 to 8 short lowercase tags useful for search, e.g. "beach", "dog", "birthday", "sunset".
- "mood": one lowercase word for the overall feeling, e.g. "joyful", "calm".
- "objects": the main visible objects as short lowercase nouns.`;

const CAPTION_MAX_OUTPUT_TOKENS = 300;

// Groq counts every image as 2,048 input tokens; the prompt adds ~200 more.
// The estimate also reserves the maximum output, so the limiter never
// under-books a request.
export const CAPTION_ESTIMATED_TOKENS = 2_048 + 250 + CAPTION_MAX_OUTPUT_TOKENS;

/** Real token count from a response; falls back to the estimate if the provider didn't report one. */
function tokensFrom(usage: LanguageModelUsage, estimate: number): number {
  if (usage.totalTokens !== undefined) return usage.totalTokens;
  if (usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
    return usage.inputTokens + usage.outputTokens;
  }
  return estimate; // never under-count: the ledger is what keeps us inside the free tier
}

async function requestCaption(jpeg: Buffer): Promise<unknown> {
  return withRateLimit(VISION_MODEL, CAPTION_ESTIMATED_TOKENS, async () => {
    const response = await generateText({
      model: groq(VISION_MODEL),
      system: CAPTION_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: CAPTION_PROMPT },
            { type: "file", data: jpeg, mediaType: "image/jpeg" },
          ],
        },
      ],
      output: Output.json(), // Groq JSON mode: the reply must parse as JSON
      maxOutputTokens: CAPTION_MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      maxRetries: 0, // retries are handled by withRateLimit, which counts them
      providerOptions: {
        // No hidden "thinking" tokens: they would spend budget for no benefit here.
        groq: { reasoningEffort: "none" },
      },
    });
    return { result: response.output, tokensUsed: tokensFrom(response.usage, CAPTION_ESTIMATED_TOKENS) };
  });
}

/**
 * Caption a photo with the vision model. The reply is validated with Zod; on
 * an invalid reply (bad JSON, wrong shape, too many labels) it retries once.
 */
export async function captionImage(jpeg: Buffer): Promise<Caption> {
  let lastProblem = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let raw: unknown;
    try {
      raw = await requestCaption(jpeg);
    } catch (error) {
      // Rate limits and HTTP errors are not the model's fault: don't retry here.
      if (error instanceof DailyLimitError || APICallError.isInstance(error)) throw error;
      lastProblem = error instanceof Error ? error.message : String(error); // e.g. unparseable JSON
      continue;
    }
    const parsed = CaptionSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    lastProblem = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  throw new Error(`Vision model returned an invalid caption twice (${lastProblem})`);
}

// ---------- chat ----------

const CHAT_MAX_OUTPUT_TOKENS = 700;
// System prompt + up to 8 photo records + a few turns of history, plus the
// maximum output (which on a reasoning model includes its thinking tokens).
const CHAT_ESTIMATED_TOKENS = 1_800 + CHAT_MAX_OUTPUT_TOKENS;

/**
 * Stream a chat answer. The free-tier slot is reserved before the request and
 * corrected to the real usage when the stream finishes. Waits at most 15s for
 * a per-minute slot (then throws BusyError) so a chat never hangs for a minute.
 */
export async function streamChatAnswer(system: string, messages: ModelMessage[]) {
  const reservation = await reserveCall(CHAT_MODEL, CHAT_ESTIMATED_TOKENS, 15_000);
  return streamText({
    model: groq(CHAT_MODEL),
    system,
    messages,
    maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
    temperature: 0.3,
    maxRetries: 0, // see withRateLimit: hidden retries would bypass the ledger
    providerOptions: {
      // gpt-oss always reasons; "low" keeps those (billed) thinking tokens small.
      groq: { reasoningEffort: "low" },
    },
    onFinish: ({ totalUsage }) => recordActualTokens(reservation, tokensFrom(totalUsage, CHAT_ESTIMATED_TOKENS)),
    // On an error the estimate stays on the ledger (conservative). The route
    // turns the error into a message for the user.
    onError: ({ error }) => console.error("[chat] model error:", error instanceof Error ? error.message : error),
  });
}

// ---------- embeddings ----------

// Loading the model takes a few seconds, so do it once per process. The
// globalThis cache survives Next.js hot reloads in development.
const globalForAi = globalThis as unknown as { embedder?: Promise<FeatureExtractionPipeline> };

function getEmbedder(): Promise<FeatureExtractionPipeline> {
  globalForAi.embedder ??= pipeline("feature-extraction", EMBEDDING_MODEL, {
    dtype: "fp32",
  }) as Promise<FeatureExtractionPipeline>;
  return globalForAi.embedder;
}

/** Embed text locally. Vectors are unit length, so cosine similarity = dot product. */
export async function embedText(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const tensor = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(tensor.data as Float32Array);
}
