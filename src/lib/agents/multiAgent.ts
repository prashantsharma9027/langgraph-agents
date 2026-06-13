import { Annotation, MessagesAnnotation, StateGraph, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AIMessage } from "@langchain/core/messages";
import { readPdfFile } from "../utils/pdfReader";

const llm = new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash", temperature: 0 });

export const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  route: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "chat" }),
});

const routerLlm = llm.withStructuredOutput({
  type: "object",
  properties: {
    next_agent: { type: "string", enum: ["chat", "reader", "visualizer", "websearch", "FINISH"] }
  },
  required: ["next_agent"]
});

async function supervisorNode(state: typeof AgentState.State) {
  const history = state.messages.map((m) => `${m.name || m._getType()}: ${m.content}`).join("\n");
  const prompt = `You are a supervisor directing: 'reader', 'visualizer', 'websearch', and 'chat'.
Decide who goes next, or 'FINISH' if fully resolved.
1. 'websearch' if user asks for real-time/latest info and we haven't searched yet.
2. 'reader' if user asks to read/summarize PDF and we haven't read it yet.
3. 'visualizer' if user wants a chart, and we attempted to fetch data (MUST route to visualizer if chart requested).
4. 'chat' for general questions/chats.
5. 'FINISH' if resolved, or if 'chat' responded last (don't route to 'chat' twice consecutively).

History:
${history}`;

  try {
    const decision = await routerLlm.invoke(prompt);
    return { route: decision.next_agent };
  } catch {
    return { route: "FINISH" };
  }
}

async function chatNode(state: typeof AgentState.State) {
  return { messages: [await llm.invoke(state.messages)] };
}

async function readerNode(state: typeof AgentState.State) {
  try {
    const text = await readPdfFile("document.pdf");
    const query = state.messages.filter((m) => m._getType() === "human").pop()?.content || "";
    const res = await llm.invoke(`Summarize document based on user request: "${query}"\n\nContent:\n${text.slice(0, 15000)}`);
    return { messages: [new AIMessage({ content: res.content as string, name: "reader" })] };
  } catch (err) {
    return { messages: [new AIMessage({ content: `PDF Reader Error: ${err instanceof Error ? err.message : String(err)}`, name: "reader" })] };
  }
}

const groundedLlm = new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash", temperature: 0 }).bindTools([{ googleSearch: {} }]);

async function websearchNode(state: typeof AgentState.State) {
  try {
    const response = await groundedLlm.invoke(state.messages);
    return { messages: [new AIMessage({ content: response.content as string, name: "websearch" })] };
  } catch (err) {
    return { messages: [new AIMessage({ content: `Search Error: ${err instanceof Error ? err.message : String(err)}`, name: "websearch" })] };
  }
}

async function visualizerNode(state: typeof AgentState.State) {
  try {
    const chartExtractor = llm.withStructuredOutput({
      type: "object",
      properties: {
        title: { type: "string" },
        x_label: { type: "string" },
        y_label: { type: "string" },
        x_values: { type: "array", items: { type: "string" } },
        y_values: { type: "array", items: { type: "number" } }
      },
      required: ["title", "x_label", "y_label", "x_values", "y_values"]
    });

    const context = state.messages.filter((m) => m._getType() === "ai" && m.name !== "visualizer").map((m) => m.content).join("\n") ||
      state.messages.filter((m) => m._getType() === "human").pop()?.content || "";

    const data = await chartExtractor.invoke(`Extract data from context for a bar/line chart. If no numeric data is present, construct logical placeholder data related to the topic.\n\nContext:\n${context}`);

    return {
      messages: [new AIMessage({
        content: JSON.stringify({
          message: `Chart generated: ${data.title}`,
          chartData: { title: data.title, labels: data.x_values, values: data.y_values }
        }),
        name: "visualizer"
      })]
    };
  } catch (err) {
    return { messages: [new AIMessage({ content: `Visualization Error: ${err instanceof Error ? err.message : String(err)}`, name: "visualizer" })] };
  }
}

export const graph = new StateGraph(AgentState)
  .addNode("supervisor", supervisorNode)
  .addNode("chat", chatNode)
  .addNode("reader", readerNode)
  .addNode("visualizer", visualizerNode)
  .addNode("websearch", websearchNode)
  .setEntryPoint("supervisor")
  .addConditionalEdges("supervisor", (state) => state.route, {
    chat: "chat",
    reader: "reader",
    visualizer: "visualizer",
    websearch: "websearch",
    FINISH: END,
  })
  .addEdge("chat", "supervisor")
  .addEdge("reader", "supervisor")
  .addEdge("visualizer", "supervisor")
  .addEdge("websearch", "supervisor")
  .compile();
