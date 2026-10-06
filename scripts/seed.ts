// Bulk-ingest a folder of photos:  npm run seed -- ./sample-photos
//
// One bad file never stops the batch: errors are collected and listed at the
// end. If the free-tier daily budget runs out, the batch stops cleanly; run
// the same command again later and photos already ingested are skipped.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { CAPTION_ESTIMATED_TOKENS, VISION_MODEL, describeProviderError } from "../core/ai";
import { ingestPhoto } from "../core/ingest";
import { DailyLimitError, SAFETY, dailyUsage } from "../core/ratelimit";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);
const CONCURRENCY = 2;

function findImages(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(dir, name))
    .sort();
}

function printBudget(): void {
  const { requests, tokens, limits } = dailyUsage(VISION_MODEL);
  const tokensLeft = Math.max(0, limits.tpd * SAFETY - tokens);
  console.log(
    `Vision budget (${VISION_MODEL}, last 24h): ${tokens.toLocaleString()} / ${limits.tpd.toLocaleString()} tokens, ` +
      `${requests} / ${limits.rpd} requests. Room for roughly ${Math.floor(tokensLeft / CAPTION_ESTIMATED_TOKENS)} more photos.`,
  );
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: npm run seed -- <folder>");
    process.exit(1);
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`Not a folder: ${dir}`);
    process.exit(1);
  }
  if (!process.env.GROQ_API_KEY) {
    console.error("GROQ_API_KEY is not set. Copy .env.example to .env and add your key.");
    process.exit(1);
  }

  const files = findImages(dir);
  console.log(`Found ${files.length} image file(s) in ${dir}`);
  printBudget();

  const added: string[] = [];
  const skipped: string[] = [];
  const failed: { file: string; reason: string }[] = [];
  let budgetStop: string | null = null;
  let next = 0;
  const start = Date.now();

  // A simple worker pool: CONCURRENCY workers pull files off a shared index.
  // (The rate limiter, not this pool, is what keeps Groq calls within limits.)
  async function worker(): Promise<void> {
    while (next < files.length && !budgetStop) {
      const file = files[next++];
      try {
        const result = await ingestPhoto(file);
        (result.status === "added" ? added : skipped).push(result.filename);
      } catch (error) {
        if (error instanceof DailyLimitError) {
          budgetStop = error.message; // this file wasn't captioned: counted as "not processed"
          return;
        }
        const reason = describeProviderError(error).message;
        console.error(`  [${path.basename(file)}] FAILED: ${reason}`);
        failed.push({ file: path.basename(file), reason });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const notProcessed = files.length - added.length - skipped.length - failed.length;
  console.log(`\nDone in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`  added:          ${added.length}`);
  console.log(`  already there:  ${skipped.length}`);
  console.log(`  failed:         ${failed.length}`);
  for (const f of failed) console.log(`    - ${f.file}: ${f.reason}`);
  if (budgetStop) {
    console.log(`  not processed:  ${notProcessed}`);
    console.log(`\nStopped early: ${budgetStop}`);
    console.log("Run the same command again later; photos already added are skipped automatically.");
  }
  printBudget();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
