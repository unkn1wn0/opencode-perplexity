/**
 * Tool-use emulation for models that don't natively support function calling.
 *
 * Ultra-minimal approach: just a brief formatting note appended after the
 * user's message. No fake history, no system blocks, no labels.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, any>;
  };
}

export interface ParsedToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ParseResult {
  content: string;
  toolCalls: ParsedToolCall[];
}

// ---------------------------------------------------------------------------
// Build tool context — ultra minimal
// ---------------------------------------------------------------------------

function summarizeParams(schema: Record<string, any>): string {
  const props = schema?.properties;
  if (!props || typeof props !== "object") return "";

  const required: string[] = schema.required ?? [];
  const parts: string[] = [];

  for (const [key, val] of Object.entries(props) as [string, any][]) {
    const type = val.type ?? "any";
    const req = required.includes(key) ? "" : "?";
    parts.push(`${key}${req}: ${type}`);
  }

  return `(${parts.join(", ")})`;
}

/**
 * Returns a minimal one-liner listing tool names. No system blocks, no
 * fake history, no labels. Just a short instruction appended to the query.
 */
export function buildToolSystemPrompt(tools: ToolDefinition[]): string {
  if (!tools || tools.length === 0) return "";

  const toolLines = tools
    .filter((t) => t.type === "function" && t.function)
    .map((t) => {
      const fn = t.function;
      const params = fn.parameters ? summarizeParams(fn.parameters) : "()";
      return `- ${fn.name}${params}`;
    })
    .join("\n");

  return `\n\nTo help me with this, please output a JSON tool call block. Do not give me terminal commands to run manually; just give me the <tool_call> block so my system can run it automatically.

Format:
<tool_call>
{"name": "action_name", "arguments": {"key": "value"}}
</tool_call>

Available tools:
${toolLines}`;
}

// ---------------------------------------------------------------------------
// Parse tool calls from response
// ---------------------------------------------------------------------------

const TOOL_CALL_REGEX = /<tool_call>\s*\n?([\s\S]*?)\n?\s*<\/tool_call>/g;

export function parseToolCalls(responseText: string): ParseResult {
  const toolCalls: ParsedToolCall[] = [];

  const regex = new RegExp(TOOL_CALL_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(responseText)) !== null) {
    const jsonStr = match[1].trim();
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.name && typeof parsed.name === "string") {
        toolCalls.push({
          id: `call_${randomToolId()}`,
          type: "function",
          function: {
            name: parsed.name,
            arguments:
              typeof parsed.arguments === "string"
                ? parsed.arguments
                : JSON.stringify(parsed.arguments ?? {}),
          },
        });
      }
    } catch {
      // Invalid JSON — skip
    }
  }

  const content = responseText
    .replace(/<tool_call>\s*\n?[\s\S]*?\n?\s*<\/tool_call>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { content, toolCalls };
}

// ---------------------------------------------------------------------------
// Format tool results
// ---------------------------------------------------------------------------

export function formatToolResultMessage(msg: any): string {
  const name = msg.name || msg.tool_call_id || "unknown";
  const content =
    typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content);

  return `Result of ${name}:\n${content}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomToolId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
