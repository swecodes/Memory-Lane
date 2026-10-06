// Search the library from the terminal, before any UI exists:
//   npm run search -- "dog at the park"
//   npm run search -- "dinner" --from 2024-01-01 --to 2024-12-31 --label food --limit 5
// Runs entirely locally: embedding the query needs no API call.

import "dotenv/config";
import { parseArgs } from "node:util";
import { searchPhotos } from "../core/search";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: "string" },
      to: { type: "string" },
      label: { type: "string" },
      limit: { type: "string", default: "8" },
    },
  });
  const query = positionals.join(" ").trim();
  if (!query) {
    console.error('Usage: npm run search -- "your query" [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--label tag] [--limit n]');
    process.exit(1);
  }

  const results = await searchPhotos({
    query,
    limit: Number(values.limit),
    dateFrom: values.from,
    dateTo: values.to,
    label: values.label,
  });

  if (results.length === 0) {
    console.log("No photos match those filters.");
    return;
  }
  console.log(`Top ${results.length} for "${query}":\n`);
  for (const r of results) {
    console.log(`  ${r.score.toFixed(3)}  #${r.id}  ${r.takenAt.slice(0, 10)}  [${r.labels.join(", ")}]`);
    console.log(`         ${r.caption}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
