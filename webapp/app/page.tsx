"use client";

import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Holds the AbortController for the current in-flight fetch so we can cancel
  // it on unmount or when a new send() races an existing stream.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Cancel any in-flight stream when the component unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    // Abort any previous in-flight request before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setStreaming(true);

    let res: Response;
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
        signal: controller.signal,
      });
    } catch (err) {
      // AbortError means the user navigated away or sent a new message — exit silently.
      if (err instanceof DOMException && err.name === "AbortError") {
        setStreaming(false);
        return;
      }
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Network error — please try again." },
      ]);
      setStreaming(false);
      return;
    }

    if (!res.ok || !res.body) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Error: ${res.status}` },
      ]);
      setStreaming(false);
      return;
    }

    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = {
            ...copy[copy.length - 1],
            content: copy[copy.length - 1].content + chunk,
          };
          return copy;
        });
      }
    } catch (err) {
      // AbortError during streaming — clean exit, no error message shown.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = {
            ...copy[copy.length - 1],
            content: copy[copy.length - 1].content + "\n\n[stream interrupted]",
          };
          return copy;
        });
      }
    }
    setStreaming(false);
  }

  return (
    <main>
      <div className="messages" ref={scrollRef}>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="role">{m.role}</div>
            {m.content}
          </div>
        ))}
      </div>
      <form onSubmit={send}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(e as unknown as React.FormEvent);
            }
          }}
          placeholder="Message Claude…"
          disabled={streaming}
        />
        <button type="submit" disabled={streaming || !input.trim()}>
          {streaming ? "…" : "Send"}
        </button>
      </form>
    </main>
  );
}
