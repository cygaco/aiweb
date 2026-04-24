import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

const MCP_URL = process.env.AIWEB_MCP_URL ?? "https://aiweb-mcp.fly.dev/mcp";
const MCP_KEY = process.env.AIWEB_MCP_KEY;

const client = new Anthropic();

const SYSTEM = `You are the assistant for The AI Web. You can order pizza through the connected MCP tools — trust and follow the tool descriptions literally, they encode the product UX. Be concise and direct. Never bypass the confirmation step before place_order.`;

type ChatMessage = { role: "user" | "assistant"; content: string };

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function parseMcpResponse(text: string): {
  result?: JsonValue;
  error?: { message: string };
} {
  const match = text.match(/^data:\s*(.+)$/m);
  const payload = match ? match[1] : text;
  return JSON.parse(payload);
}

async function mcpCall(
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonValue> {
  if (!MCP_KEY) throw new Error("AIWEB_MCP_KEY not set");
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MCP_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });
  if (!res.ok) throw new Error(`MCP ${method} HTTP ${res.status}`);
  const data = parseMcpResponse(await res.text());
  if (data.error) throw new Error(`MCP ${method}: ${data.error.message}`);
  return data.result ?? null;
}

async function loadTools(): Promise<Anthropic.Tool[]> {
  const result = (await mcpCall("tools/list")) as {
    tools: { name: string; description: string; inputSchema: unknown }[];
  };
  return result.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
  }));
}

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: ChatMessage[] };

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const write = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        const tools = await loadTools();
        const convo: Anthropic.MessageParam[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const MAX_ITERATIONS = 10;
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const response = await client.messages.create({
            model: "claude-opus-4-7",
            max_tokens: 16000,
            thinking: { type: "adaptive" },
            system: [
              {
                type: "text",
                text: SYSTEM,
                cache_control: { type: "ephemeral" },
              },
            ],
            tools,
            messages: convo,
          });

          for (const block of response.content) {
            if (block.type === "text") write(block.text);
          }

          if (response.stop_reason === "end_turn") return;

          if (response.stop_reason === "tool_use") {
            const toolUses = response.content.filter(
              (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
            );
            convo.push({ role: "assistant", content: response.content });

            const results: Anthropic.ToolResultBlockParam[] = [];
            for (const tu of toolUses) {
              write(`\n\n_[calling ${tu.name}…]_\n\n`);
              try {
                const toolResult = (await mcpCall("tools/call", {
                  name: tu.name,
                  arguments: tu.input as Record<string, unknown>,
                })) as { content?: { type: string; text?: string }[] };
                const text =
                  toolResult.content?.[0]?.text ?? JSON.stringify(toolResult);
                results.push({
                  type: "tool_result",
                  tool_use_id: tu.id,
                  content: text,
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                results.push({
                  type: "tool_result",
                  tool_use_id: tu.id,
                  content: `Tool error: ${msg}`,
                  is_error: true,
                });
              }
            }
            convo.push({ role: "user", content: results });
            continue;
          }

          // Unexpected stop reason — bail
          write(`\n\n_[stopped: ${response.stop_reason}]_`);
          return;
        }

        write("\n\n_[max tool iterations reached]_");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        write(`\n\n[stream error: ${msg}]`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
