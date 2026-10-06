// Splits a chat answer into text and photo citations.
// Handles "[photo:12]" and the grouped form models sometimes write: "[photo:3, photo:7]".

export type AnswerPart = { type: "text"; text: string } | { type: "photo"; id: number };

const CITATION_GROUP = /\[\s*(photo:\s*\d+(?:\s*,\s*photo:\s*\d+)*)\s*\]/g;

export function parseAnswer(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION_GROUP)) {
    if (match.index > last) parts.push({ type: "text", text: text.slice(last, match.index) });
    for (const id of match[1].matchAll(/\d+/g)) parts.push({ type: "photo", id: Number(id[0]) });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}

export function citedIds(text: string): number[] {
  return [...new Set(parseAnswer(text).flatMap((p) => (p.type === "photo" ? [p.id] : [])))];
}
