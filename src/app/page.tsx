"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

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
  files?: { name: string; type: string }[];
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      sender: "chat",
      content: "Hello! I am your LangGraph assistant. Upload TXT, CSV, DOCX, or PDF files to chat with them and visualize the data!",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentResponseId, setCurrentResponseId] = useState<string | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    setUploadedFiles((prev) => [...prev, ...fileList]);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeFile = (fileName: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.name !== fileName));
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;

    const userQuery = input;
    const userMessage: Message = {
      id: Date.now().toString(),
      sender: "user",
      content: userQuery,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      files: uploadedFiles.map(f => ({
        name: f.name,
        type: f.name.split(".").pop()?.toLowerCase() || ""
      }))
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    callAgentApi(userQuery, uploadedFiles);
    setUploadedFiles([]);
  };

  const callAgentApi = async (query: string, filesToUpload: File[]) => {
    const timeString = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const responseMessageId = `assistant-${Date.now()}`;
    setCurrentResponseId(responseMessageId);

    try {
      setActiveNode("supervisor");

      const formData = new FormData();
      formData.append("message", query);
      for (const file of filesToUpload) {
        formData.append("files", file);
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        body: formData,
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
              
              setMessages((prev) => {
                const existingMsgIdx = prev.findIndex((m) => m.id === responseMessageId);

                if (existingMsgIdx > -1) {
                  const updated = [...prev];
                  const existingMsg = updated[existingMsgIdx];
                  const newContent = content 
                    ? (existingMsg.content ? `${existingMsg.content}\n\n${content}` : content)
                    : existingMsg.content;

                  updated[existingMsgIdx] = {
                    ...existingMsg,
                    content: newContent,
                    sender: payload.node as any,
                    chartData: chartData || existingMsg.chartData,
                  };
                  return updated;
                } else {
                  return [
                    ...prev,
                    {
                      id: responseMessageId,
                      sender: payload.node as any,
                      content: content,
                      timestamp: timeString(),
                      chartData: chartData,
                    },
                  ];
                }
              });
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
      setCurrentResponseId(null);
    }
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

        <div className="flex items-center gap-2">
          {activeNode ? (
            <div className="flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/5 px-2.5 py-1 text-xs text-indigo-400 backdrop-blur-sm shadow-inner transition-all animate-pulse">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              <span className="font-medium tracking-wide uppercase font-mono text-[10px]">
                {activeNode}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/30 px-2.5 py-1 text-xs text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-600"></span>
              <span className="font-medium uppercase font-mono text-[10px]">idle</span>
            </div>
          )}
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
                  <span className={`font-semibold tracking-wider text-[9px] uppercase ${isUser ? "text-indigo-400" : "text-zinc-400"}`}>
                    {isUser ? "You" : "AI"}
                  </span>
                  <span>•</span>
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
                  <div className="markdown-content">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>

                  {msg.files && msg.files.length > 0 && (
                    <div className={`flex flex-wrap gap-1.5 mt-2 pt-2 border-t ${isUser ? "border-indigo-400/30" : "border-zinc-800"}`}>
                      {msg.files.map((file, idx) => {
                        let icon = "📄";
                        let badgeColor = isUser 
                          ? "bg-indigo-700/50 border-indigo-500/30 text-indigo-100" 
                          : "bg-zinc-950/50 border-zinc-800 text-zinc-300";
                          
                        if (file.type === "csv") {
                          icon = "📊";
                          badgeColor = isUser 
                            ? "bg-emerald-600/30 border-emerald-500/20 text-emerald-100" 
                            : "bg-emerald-950/20 border-emerald-900/40 text-emerald-300";
                        } else if (file.type === "pdf") {
                          icon = "📕";
                          badgeColor = isUser 
                            ? "bg-rose-600/30 border-rose-500/20 text-rose-100" 
                            : "bg-rose-950/20 border-rose-900/40 text-rose-300";
                        } else if (file.type === "docx") {
                          icon = "📝";
                          badgeColor = isUser 
                            ? "bg-blue-600/30 border-blue-500/20 text-blue-100" 
                            : "bg-blue-950/20 border-blue-900/40 text-blue-300";
                        } else if (file.type === "txt") {
                          icon = "📝";
                          badgeColor = isUser 
                            ? "bg-amber-600/30 border-amber-500/20 text-amber-100" 
                            : "bg-amber-950/20 border-amber-900/40 text-amber-300";
                        }

                        return (
                          <span
                            key={idx}
                            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] border font-medium ${badgeColor}`}
                          >
                            <span>{icon}</span>
                            <span>{file.name}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}

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

          {isTyping && !messages.some((m) => m.id === currentResponseId) && (
            <div className="flex flex-col gap-1.5 items-start">
              <div className="flex items-center gap-2 px-1 text-[11px] text-zinc-500">
                <span className="font-semibold tracking-wider text-[9px] uppercase text-zinc-400">
                  AI
                </span>
                <span>•</span>
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
              "Read and summarize my uploaded files",
              "Plot a chart of data in my CSV file",
              "Search Virat Kohli IPL 2024 stats",
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

          {uploadedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3 max-h-32 overflow-y-auto p-1">
              {uploadedFiles.map((file) => {
                const ext = file.name.split(".").pop()?.toLowerCase();
                let colorClass = "bg-zinc-800 text-zinc-300 border-zinc-700";
                let icon = "📄";
                
                if (ext === "csv") {
                  colorClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                  icon = "📊";
                } else if (ext === "pdf") {
                  colorClass = "bg-rose-500/10 text-rose-400 border-rose-500/20";
                  icon = "📕";
                } else if (ext === "docx") {
                  colorClass = "bg-blue-500/10 text-blue-400 border-blue-500/20";
                  icon = "📝";
                } else if (ext === "txt") {
                  colorClass = "bg-amber-500/10 text-amber-400 border-amber-500/20";
                  icon = "📝";
                }
                
                return (
                  <div
                    key={file.name}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${colorClass} transition-all`}
                  >
                    <span>{icon}</span>
                    <span className="truncate max-w-[150px]" title={file.name}>{file.name}</span>
                    
                    <button
                      type="button"
                      onClick={() => removeFile(file.name)}
                      className="ml-1 text-zinc-500 hover:text-zinc-200 transition-colors focus:outline-none"
                      title="Remove file"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="relative flex items-center rounded-xl bg-zinc-900 border border-zinc-800/80 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/50 shadow-inner px-2 py-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isTyping}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50 disabled:pointer-events-none"
              title="Upload files (.txt, .csv, .docx, .pdf)"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              accept=".txt,.csv,.docx,.pdf"
              className="hidden"
            />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question or analyze files..."
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
