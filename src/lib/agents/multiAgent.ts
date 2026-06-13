import { Annotation, MessagesAnnotation, StateGraph, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AIMessage } from "@langchain/core/messages";

const llm = new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash", temperature: 0 });

export const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  route: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "chat" }),
  files: Annotation<{ name: string; content: string }[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
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
  const fileNames = state.files && state.files.length > 0
    ? state.files.map(f => f.name).join(", ")
    : "None";

  const prompt = `You are a supervisor directing: 'reader', 'visualizer', 'websearch', and 'chat'.
Decide who goes next, or 'FINISH' if fully resolved.

Currently Uploaded Files in Context: ${fileNames}

1. 'websearch' if user asks for real-time/latest info and we haven't searched yet.
2. 'reader' if there are uploaded files in context and the user asks to analyze/summarize them or has text questions about them, and we haven't answered yet.
3. 'visualizer' if the user explicitly requests a chart, plot, or visualization of data (which could be in the uploaded files or provided directly in the chat history/message text), and we haven't generated it yet.
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
    if (!state.files || state.files.length === 0) {
      return {
        messages: [new AIMessage({
          content: "No files have been uploaded yet. Please upload files (TXT, CSV, DOCX, PDF) first to analyze them.",
          name: "reader"
        })]
      };
    }

    const fileContents = state.files.map(f => `[File: ${f.name}]\n${f.content}`).join("\n\n---\n\n");
    const query = state.messages.filter((m) => m._getType() === "human").pop()?.content || "";

    const res = await llm.invoke(
      `Analyze and answer the user query based on the uploaded file contents:
Query: "${query}"

Uploaded Files Content:
${fileContents.slice(0, 30000)}

Formulate a helpful, direct response summarizing or answering the query. Do not output raw lists of dates and values unless the user specifically asked to see the raw table data.`
    );

    return { messages: [new AIMessage({ content: res.content as string, name: "reader" })] };
  } catch (err) {
    return { messages: [new AIMessage({ content: `Reader Error: ${err instanceof Error ? err.message : String(err)}`, name: "reader" })] };
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

    const fileContents = state.files && state.files.length > 0
      ? state.files.map(f => `[File: ${f.name}]\n${f.content}`).join("\n\n")
      : "";

    const userQuery = state.messages.filter((m) => m._getType() === "human").pop()?.content || "";

    const prompt = `You are a data visualizer agent. Extract numeric data from the uploaded files or from the user query/chat history directly to build a bar or line chart based on the user's request:
User Request: "${userQuery}"

Uploaded Files Content:
${fileContents}

Extract the matching labels (x_values) and values (y_values) accurately. Provide a clear title for the chart.`;

    const data = await chartExtractor.invoke(prompt);

    return {
      messages: [new AIMessage({
        content: JSON.stringify({
          message: "",
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
