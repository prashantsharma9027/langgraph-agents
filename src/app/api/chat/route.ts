import { NextRequest, NextResponse } from "next/server";
import { graph } from "@/lib/agents/multiAgent";
import { HumanMessage } from "@langchain/core/messages";
import pdf from "pdf-parse";
import mammoth from "mammoth";

async function parseFile(file: File): Promise<{ name: string; content: string }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name;
  const extension = fileName.split(".").pop()?.toLowerCase();

  let content = "";
  if (extension === "txt" || extension === "csv") {
    content = buffer.toString("utf-8");
  } else if (extension === "pdf") {
    const data = await pdf(buffer);
    content = data.text || "";
  } else if (extension === "docx") {
    const data = await mammoth.extractRawText({ buffer });
    content = data.value || "";
  } else {
    throw new Error(`Unsupported file type: .${extension}`);
  }

  return { name: fileName, content: content.trim() };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const message = formData.get("message") as string;
    const fileObjects = formData.getAll("files") as File[];
    if (!message) {
      return NextResponse.json({ error: "Missing message query" }, { status: 400 });
    }

    // Parse each attached file
    const parsedFiles: { name: string; content: string }[] = [];
    for (const file of fileObjects) {
      if (file && file.size > 0) {
        try {
          const parsed = await parseFile(file);
          parsedFiles.push(parsed);
        } catch (err) {
          console.error(`[API /api/chat] Error parsing file ${file.name}:`, err);
          return NextResponse.json(
            { error: `Failed to parse file ${file.name}: ${err instanceof Error ? err.message : String(err)}` },
            { status: 400 }
          );
        }
      }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const eventStream = await graph.stream(
            { 
              messages: [new HumanMessage({ content: message })],
              files: parsedFiles
            },
            { streamMode: "updates", recursionLimit: 100 }
          );

          for await (const chunk of eventStream) {
            for (const [node, output] of Object.entries(chunk)) {
              if (output && typeof output === "object") {
                if ("messages" in output && Array.isArray((output as any).messages)) {
                  for (const msg of (output as any).messages) {
                    controller.enqueue(encoder.encode(JSON.stringify({
                      node,
                      content: msg.content,
                      name: msg.name || node,
                      type: msg._getType(),
                    }) + "\n"));
                  }
                } else if (node === "supervisor" && "route" in output) {
                  controller.enqueue(encoder.encode(JSON.stringify({
                    node,
                    route: (output as any).route,
                  }) + "\n"));
                }
              }
            }
          }
          controller.close();
        } catch (error) {
          controller.enqueue(encoder.encode(JSON.stringify({
            node: "error",
            content: error instanceof Error ? error.message : String(error),
          }) + "\n"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
