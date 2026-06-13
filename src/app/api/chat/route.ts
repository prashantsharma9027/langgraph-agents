import { NextRequest, NextResponse } from "next/server";
import { graph } from "@/lib/agents/multiAgent";
import { HumanMessage } from "@langchain/core/messages";

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();
    if (!message) return NextResponse.json({ error: "Missing message query" }, { status: 400 });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const eventStream = await graph.stream(
            { messages: [new HumanMessage({ content: message })] },
            { streamMode: "updates" }
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
