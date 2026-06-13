"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  id: string;
  sender: "user" | "supervisor" | "chat" | "reader" | "visualizer" | "websearch";
  content: string;
  timestamp: string;
  chartData?: {
    title: string;
    labels: string[];
    values: number[];
  };
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      sender: "chat",
      content: "Hello! I am your LangGraph assistant. How can I help you today?",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;

    const userQuery = input;
    const userMessage: Message = {
      id: Date.now().toString(),
      sender: "user",
      content: userQuery,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    callAgentApi(userQuery);
  };

  const callAgentApi = async (query: string) => {
    const timeString = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    try {
      setActiveNode("supervisor");

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: query }),
      });

      if (!response.ok) throw new Error(`API error: ${response.statusText}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Failed to read server response body stream.");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const payload = JSON.parse(line);

            if (payload.node === "supervisor") {
              if (payload.route) {
                setActiveNode(payload.route);
              }
            } else if (payload.node === "error") {
              setMessages((prev) => [
                ...prev,
                {
                  id: `error-${Date.now()}-${Math.random()}`,
                  sender: "supervisor",
                  content: payload.content,
                  timestamp: timeString(),
                },
              ]);
            } else {
              let content = payload.content;
              let chartData = undefined;

              if (payload.node === "visualizer") {
                try {
                  const parsed = JSON.parse(payload.content);
                  content = parsed.message;
                  chartData = parsed.chartData;
                } catch {}
              }

              setActiveNode(payload.node);
              setMessages((prev) => [
                ...prev,
                {
                  id: `${payload.node}-${Date.now()}-${Math.random()}`,
                  sender: payload.node as any,
                  content: content,
                  timestamp: timeString(),
                  chartData: chartData,
                },
              ]);
            }
          } catch (e) {
            console.error("Failed to parse event line:", e);
          }
        }
      }
    } catch (error) {
      console.error("API streaming error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          sender: "supervisor",
          content: `API Error: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: timeString(),
        },
      ]);
    } finally {
      setIsTyping(false);
      setActiveNode(null);
    }
  };

  const getAgentColor = (sender: Message["sender"]) => {
    switch (sender) {
      case "supervisor":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "chat":
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case "reader":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "visualizer":
        return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      case "websearch":
        return "bg-sky-500/10 text-sky-400 border-sky-500/20";
      default:
        return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
    }
  };

  const getAgentName = (sender: Message["sender"]) => {
    if (sender === "user") return "You";
    return sender.toUpperCase();
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-950 text-zinc-100 font-sans antialiased selection:bg-indigo-500/30">
      <header className="flex h-14 items-center justify-between border-b border-zinc-900 bg-zinc-950 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-md shadow-indigo-600/10">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">LangGraph Multi-Agent</h1>
            <p className="text-[10px] text-zinc-500">Dual-loop supervisor architecture</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.map((msg) => {
            const isUser = msg.sender === "user";
            return (
              <div
                key={msg.id}
                className={`flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}
              >
                <div className="flex items-center gap-2 px-1 text-[11px] text-zinc-500">
                  <span className={`rounded px-1.5 py-0.5 border font-mono text-[9px] ${getAgentColor(msg.sender)}`}>
                    {getAgentName(msg.sender)}
                  </span>
                  <span>{msg.timestamp}</span>
                </div>

                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed shadow-sm border ${
                    isUser
                      ? "bg-indigo-600 text-white border-indigo-500"
                      : msg.sender === "supervisor"
                      ? "bg-zinc-900/40 text-zinc-300 border-zinc-900/60 font-mono text-xs"
                      : "bg-zinc-900 text-zinc-100 border-zinc-900"
                  }`}
                >
                  <p className="white-space-pre-wrap">{msg.content}</p>

                  {msg.chartData && (
                    <div className="mt-4 rounded-lg bg-zinc-950 p-4 border border-zinc-800">
                      <h4 className="text-xs font-semibold text-zinc-400 mb-4 text-center">
                        {msg.chartData.title}
                      </h4>
                      <div className="flex items-end justify-around h-44 pt-2">
                        {msg.chartData.values.map((val, idx) => {
                          const max = Math.max(...msg.chartData!.values) || 1;
                          const pct = Math.max((val / max) * 100, 2);
                          return (
                            <div key={idx} className="flex flex-col items-center gap-2 w-16">
                              <div className="relative w-full h-32 flex items-end justify-center">
                                <div
                                  className="w-8 rounded-t bg-gradient-to-t from-violet-600 to-indigo-500 hover:from-violet-500 hover:to-indigo-400 transition-all duration-300 group cursor-pointer"
                                  style={{ height: `${pct}%` }}
                                >
                                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 scale-0 group-hover:scale-100 rounded bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-200 transition-all font-mono z-10 shadow-lg">
                                    {val}
                                  </div>
                                </div>
                              </div>
                              <span className="text-[10px] text-zinc-400 truncate w-full text-center" title={msg.chartData!.labels[idx]}>
                                {msg.chartData!.labels[idx]}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isTyping && (
            <div className="flex flex-col gap-1.5 items-start">
              <div className="flex items-center gap-2 px-1 text-[11px] text-zinc-500">
                <span className={`rounded px-1.5 py-0.5 border font-mono text-[9px] ${getAgentColor(activeNode as any || "supervisor")}`}>
                  {(activeNode || "supervisor").toUpperCase()}
                </span>
                <span className="animate-pulse">Thinking...</span>
              </div>
              <div className="rounded-xl px-4 py-3 bg-zinc-900 border border-zinc-900">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      </main>

      <footer className="border-t border-zinc-900 bg-zinc-950 px-4 py-4 md:px-8">
        <form onSubmit={handleSend} className="mx-auto max-w-3xl">
          <div className="flex flex-wrap gap-2 mb-3">
            {[
              "Search Virat Kohli IPL 2024 stats",
              "Read document.pdf and summarize experience",
              "Plot exp metrics vs users",
            ].map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setInput(prompt)}
                disabled={isTyping}
                className="rounded-full border border-zinc-800 bg-zinc-900/30 px-3 py-1 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition duration-150 disabled:opacity-50 disabled:pointer-events-none"
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className="relative flex items-center rounded-xl bg-zinc-900 border border-zinc-800/80 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/50 shadow-inner px-2 py-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything... (type 'search', 'pdf', or 'chart' to trigger specific agents)"
              disabled={isTyping}
              className="flex-1 bg-transparent px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 transition shadow-sm"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        </form>
      </footer>
    </div>
  );
}
