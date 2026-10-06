"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { PhotoSummary } from "@/core/types";
import { citedIds, parseAnswer } from "./citations";
import { PALETTE } from "./colors";
import { imageUrl } from "./ContactSheet";

type Message =
  | { role: "user" | "assistant"; content: string }
  | { role: "error"; content: string };

const SUGGESTIONS = [
  "What did I eat recently?",
  "Show me photos taken outdoors",
  "Which photos have friends or family in them?",
];

interface ChatPanelProps {
  photosById: Map<number, PhotoSummary>;
  /** Each photo's dominant color, used to tint its citation chip. */
  colors: Map<number, string>;
  onOpen: (id: number) => void;
  /** Called when an answer finishes, with the photo ids it cited. */
  onCited: (ids: number[]) => void;
  onHoverCitation: (id: number | null) => void;
}

/** Minimal formatting for model output: **bold** only; line breaks are kept by CSS. */
function renderText(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
    chunk.startsWith("**") && chunk.endsWith("**") ? (
      <strong key={`${keyPrefix}-${i}`}>{chunk.slice(2, -2)}</strong>
    ) : (
      chunk
    ),
  );
}

function Answer({ text, photosById, colors, onOpen, onHoverCitation }: { text: string } & Omit<ChatPanelProps, "onCited">) {
  return (
    <div className="whitespace-pre-wrap leading-relaxed">
      {parseAnswer(text).map((part, i) => {
        if (part.type === "text") return <span key={i}>{renderText(part.text, String(i))}</span>;
        const photo = photosById.get(part.id);
        if (!photo) {
          // The model cited an id that isn't in the library: show it, don't hide it.
          return (
            <span key={i} className="text-muted line-through" title="This photo doesn't exist in your library">
              #{part.id}
            </span>
          );
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => onOpen(photo.id)}
            onMouseEnter={() => onHoverCitation(photo.id)}
            onMouseLeave={() => onHoverCitation(null)}
            onFocus={() => onHoverCitation(photo.id)}
            onBlur={() => onHoverCitation(null)}
            style={{ backgroundColor: colors.get(photo.id) ?? "var(--grape)" }}
            className="mx-0.5 inline-flex items-center gap-1.5 rounded-full p-0.5 pr-2.5 align-middle text-[0.75rem] font-bold text-white tabular-nums [text-shadow:0_1px_2px_rgb(0_0_0/0.45)] hover:brightness-110"
            aria-label={`Open photo ${photo.id}`}
          >
            <img src={imageUrl(photo.thumbPath)} alt="" className="h-6 w-6 rounded-full object-cover ring-2 ring-white" />
            {photo.id}
          </button>
        );
      })}
    </div>
  );
}

export function ChatPanel({ photosById, colors, onOpen, onCited, onHoverCitation }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const history = [...messages.filter((m) => m.role !== "error"), { role: "user" as const, content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    let answer = "";
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `The server answered with ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: answer }]);
      }
      if (!answer.trim()) throw new Error("No answer came back. Check the server terminal for the error.");
      onCited(citedIds(answer));
    } catch (error) {
      setMessages([...history, { role: "error", content: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask(input);
    }
  }

  return (
    <aside className="flex h-[34rem] flex-col bg-surface shadow-[0_-1px_0_var(--line)] lg:sticky lg:top-0 lg:h-screen lg:shadow-[-1px_0_0_var(--line)]">
      <header className="border-b border-line px-5 py-5">
        <h2 className="text-2xl font-extrabold tracking-tight">Ask about your photos</h2>
        <p className="text-sm text-muted">Answers are based on your photo captions and link the photos they use.</p>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-5 text-[0.95rem]" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted">Try one of these:</p>
            {SUGGESTIONS.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => void ask(s)}
                style={{ backgroundColor: PALETTE[i].tint, color: PALETTE[i].text }}
                className="block w-full rounded-2xl px-4 py-2.5 text-left text-sm font-semibold hover:brightness-95"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((message, i) =>
          message.role === "user" ? (
            <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-grape px-4 py-2.5 font-medium text-white">
              {message.content}
            </p>
          ) : message.role === "error" ? (
            <p key={i} role="alert" className="rounded-2xl bg-[#ffe4e8] px-4 py-2.5 text-sm text-coral">
              {message.content}
            </p>
          ) : message.content ? (
            <Answer
              key={i}
              text={message.content}
              photosById={photosById}
              colors={colors}
              onOpen={onOpen}
              onHoverCitation={onHoverCitation}
            />
          ) : (
            <p key={i} className="text-sm text-muted">
              Looking through your photos…
            </p>
          ),
        )}
      </div>

      <form onSubmit={onSubmit} className="flex gap-2 border-t border-line p-3">
        <label htmlFor="chat-input" className="sr-only">
          Ask about your photos
        </label>
        <textarea
          id="chat-input"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="What did I eat in Tokyo?"
          className="min-h-11 flex-1 resize-none rounded-2xl border-2 border-line bg-bg px-4 py-2.5 text-[0.95rem] placeholder:text-muted focus:border-grape focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="self-end rounded-full bg-grape px-5 py-3 text-sm font-bold text-white hover:brightness-110 disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </aside>
  );
}
