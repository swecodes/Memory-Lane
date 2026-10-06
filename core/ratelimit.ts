// Keeps every Groq call inside the free tier.
//
// Each request is recorded in the `ai_usage` table *before* it is sent (a
// "reservation" using an estimated token count), then corrected to the real
// count once the response arrives. Because the table lives in SQLite, the seed
// script, the web app and the MCP server all see the same totals.
//
// Two windows are checked against the free-tier limits:
//   - last 60 seconds -> if full, wait until enough old requests age out
//   - last 24 hours   -> if full, stop with DailyLimitError (don't wait hours)
// A rolling 24h window is never looser than a calendar-day one, so it is safe
// whichever way Groq resets its daily counters.

import { APICallError } from "ai";
import { getDb } from "./db";

export interface ModelLimits {
  rpm: number; // requests per minute
  rpd: number; // requests per day
  tpm: number; // tokens per minute
  tpd: number; // tokens per day
}

// Groq free tier, from https://console.groq.com/docs/rate-limits (checked 2026-10-04).
const FREE_TIER_LIMITS: Record<string, ModelLimits> = {
  "qwen/qwen3.8-27b": { rpm: 30, rpd: 1_000, tpm: 8_000, tpd: 200_000 },
  "openai/gpt-oss-20b": { rpm: 30, rpd: 1_000, tpm: 8_000, tpd: 200_000 },
};

// Used for any model not listed above, deliberately lower than the known ones.
const UNKNOWN_MODEL_LIMITS: ModelLimits = { rpm: 20, rpd: 500, tpm: 6_000, tpd: 100_000 };

// Use at most 90% of each limit, leaving headroom for estimate errors and
// for Groq counting tokens slightly differently than we do.
export const SAFETY = 0.9;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MAX_429_RETRIES = 2;

export class DailyLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DailyLimitError";
  }
}

export function limitsFor(model: string): ModelLimits {
  return FREE_TIER_LIMITS[model] ?? UNKNOWN_MODEL_LIMITS;
}

interface WindowTotals {
  requests: number;
  tokens: number;
}

function totalsSince(model: string, sinceMs: number): WindowTotals {
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(tokens), 0) AS tokens
       FROM ai_usage WHERE model = ? AND at > ?`,
    )
    .get(model, sinceMs) as WindowTotals;
}

/** Usage over the last 24h, for progress messages ("~40 photos left today"). */
export function dailyUsage(model: string): WindowTotals & { limits: ModelLimits } {
  return { ...totalsSince(model, Date.now() - DAY_MS), limits: limitsFor(model) };
}

type Reservation = { id: number } | { waitMs: number };

/**
 * Check both windows and, if there is room, record the request — all inside
 * one IMMEDIATE transaction, so two processes can't both grab the last slot.
 */
function tryReserve(model: string, estimatedTokens: number): Reservation {
  const db = getDb();
  const limits = limitsFor(model);

  const reserve = db.transaction((): Reservation => {
    const now = Date.now();

    const day = totalsSince(model, now - DAY_MS);
    if (day.requests + 1 > limits.rpd * SAFETY || day.tokens + estimatedTokens > limits.tpd * SAFETY) {
      throw new DailyLimitError(
        `Daily free-tier budget for ${model} is used up ` +
          `(${day.requests} requests, ${day.tokens} tokens in the last 24h). ` +
          `Try again later; it frees up gradually as requests turn 24h old.`,
      );
    }

    const minute = totalsSince(model, now - MINUTE_MS);
    if (minute.requests + 1 > limits.rpm * SAFETY || minute.tokens + estimatedTokens > limits.tpm * SAFETY) {
      // Wait until the oldest request in the window turns 60s old, then re-check.
      const oldest = db
        .prepare("SELECT MIN(at) AS at FROM ai_usage WHERE model = ? AND at > ?")
        .get(model, now - MINUTE_MS) as { at: number };
      return { waitMs: oldest.at + MINUTE_MS - now + 250 };
    }

    const result = db
      .prepare("INSERT INTO ai_usage (at, model, tokens) VALUES (?, ?, ?)")
      .run(now, model, estimatedTokens);
    return { id: Number(result.lastInsertRowid) };
  });

  return reserve.immediate();
}

/** Replace a reservation's estimate with the real token count once it's known. */
export function recordActualTokens(id: number, tokens: number): void {
  getDb().prepare("UPDATE ai_usage SET tokens = ? WHERE id = ?").run(tokens, id);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Thrown when the caller won't wait as long as the per-minute window needs. */
export class BusyError extends Error {
  constructor(readonly retryAfterSec: number) {
    super(`Free-tier per-minute limit reached; try again in ${retryAfterSec}s`);
    this.name = "BusyError";
  }
}

/**
 * Wait until the minute window has room, then record the request; returns the
 * reservation id. Use this directly for streaming calls (record the real usage
 * with recordActualTokens when the stream ends); otherwise use withRateLimit.
 * With maxWaitMs, gives up with BusyError instead of waiting longer than that.
 */
export async function reserveCall(model: string, estimatedTokens: number, maxWaitMs = Infinity): Promise<number> {
  for (;;) {
    const r = tryReserve(model, estimatedTokens);
    if ("id" in r) return r.id;
    if (r.waitMs > maxWaitMs) throw new BusyError(Math.ceil(r.waitMs / 1000));
    console.error(`  [ratelimit] ${model}: per-minute limit reached, waiting ${(r.waitMs / 1000).toFixed(1)}s`);
    await sleep(r.waitMs);
  }
}

/**
 * Run one API call inside the free-tier limits.
 *
 * `call` must return the real token count from the response so the ledger
 * stays accurate. Pass `maxRetries: 0` to the AI SDK inside `call`: its own
 * hidden retries would spend budget this limiter can't see.
 */
export async function withRateLimit<T>(
  model: string,
  estimatedTokens: number,
  call: () => Promise<{ result: T; tokensUsed: number }>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const id = await reserveCall(model, estimatedTokens);
    try {
      const { result, tokensUsed } = await call();
      recordActualTokens(id, tokensUsed);
      return result;
    } catch (error) {
      if (APICallError.isInstance(error) && error.statusCode === 429) {
        // Rejected before any work was done: no tokens spent.
        recordActualTokens(id, 0);
        const retryAfterSec = Number(error.responseHeaders?.["retry-after"] ?? "10");
        if (retryAfterSec > 120) {
          throw new DailyLimitError(`Groq says ${model} is rate limited for ${retryAfterSec}s; try again later.`);
        }
        if (attempt < MAX_429_RETRIES) {
          console.error(`  [ratelimit] ${model}: Groq returned 429, retrying in ${retryAfterSec}s`);
          await sleep(retryAfterSec * 1000);
          continue;
        }
      }
      // Any other failure (e.g. unparseable output) may have used tokens we
      // can't see, so the estimate stays on the ledger.
      throw error;
    }
  }
}
