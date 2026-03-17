/**
 * Local OpenAI-compatible proxy server.
 *
 * Translates standard /v1/chat/completions requests into Perplexity's
 * web SSE API calls, so OpenCode (via @ai-sdk/openai-compatible) can
 * talk to Perplexity through the user's Pro subscription.
 *
 * Supports tool/function calling emulation by injecting tool definitions
 * into the prompt and parsing structured tool call blocks from responses.
 */

import * as http from "node:http";
import { PerplexityWebClient } from "./perplexity-client.js";
import { MODEL_CATALOG, getModelById } from "./models.js";
import {
  buildToolSystemPrompt,
  parseToolCalls,
  formatToolResultMessage,
  type ToolDefinition,
  type ParsedToolCall,
} from "./tool-emulation.js";

const DEFAULT_PORT = 5768;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export class ProxyServer {
  private server: http.Server | null = null;
  private client: PerplexityWebClient | null = null;
  private port: number;

  constructor(port: number = DEFAULT_PORT) {
    this.port = port;
  }

  setClient(client: PerplexityWebClient): void {
    this.client = client;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          console.log(
            `[opencode-perplexity] Port ${this.port} already in use — checking if existing proxy is alive...`
          );
          // Check if existing proxy is healthy and reuse it
          this.checkExistingProxy()
            .then((alive) => {
              if (alive) {
                console.log(
                  `[opencode-perplexity] Existing proxy on port ${this.port} is healthy — reusing it.`
                );
                this.server = null; // Don't try to manage the existing server
                resolve();
              } else {
                console.error(
                  `[opencode-perplexity] Port ${this.port} is occupied by something else. Cannot start.`
                );
                reject(err);
              }
            })
            .catch(() => reject(err));
          return;
        }
        reject(err);
      });

      this.server.listen(this.port, "127.0.0.1", () => {
        console.log(
          `[opencode-perplexity] Proxy server listening on http://127.0.0.1:${this.port}`
        );
        resolve();
      });
    });
  }

  /**
   * Check if an existing proxy on our port is healthy.
   */
  private checkExistingProxy(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          method: "GET",
          hostname: "127.0.0.1",
          port: this.port,
          path: "/health",
          timeout: 3000,
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            resolve(res.statusCode === 200 && body.includes("ok"));
          });
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        console.log("[opencode-perplexity] Proxy server stopped.");
        resolve();
      });
    });
  }

  // -------------------------------------------------------------------------
  // Request routing
  // -------------------------------------------------------------------------

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? "/";

    if (url === "/health" && req.method === "GET") {
      this.handleHealth(res);
    } else if (url === "/v1/models" && req.method === "GET") {
      this.handleModels(res);
    } else if (url === "/v1/chat/completions" && req.method === "POST") {
      this.handleChatCompletions(req, res);
    } else {
      this.jsonError(res, 404, "Not found");
    }
  }

  // -------------------------------------------------------------------------
  // Endpoints
  // -------------------------------------------------------------------------

  private handleHealth(res: http.ServerResponse): void {
    this.json(res, 200, {
      status: "ok",
      hasClient: this.client !== null,
    });
  }

  private handleModels(res: http.ServerResponse): void {
    const models = MODEL_CATALOG.map((m) => ({
      id: m.id,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "perplexity",
      name: m.name,
      tier: m.tier,
    }));
    this.json(res, 200, { object: "list", data: models });
  }

  private handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    if (!this.client) {
      this.jsonError(
        res,
        503,
        "Not logged in. Use the perplexity_login tool in OpenCode to paste your cookies."
      );
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        this.jsonError(res, 400, "Invalid JSON body");
        return;
      }

      const modelId: string = parsed.model ?? "best";
      const messages: any[] = parsed.messages ?? [];
      const tools: ToolDefinition[] | undefined = parsed.tools;
      const hasTools = tools && tools.length > 0;

      // Build the query with tool support
      const query = messagesToQuery(messages, tools);
      if (!query) {
        this.jsonError(res, 400, "No user message found");
        return;
      }

      // When tools are present, always buffer the full response to parse
      // tool calls. This means both streaming and non-streaming paths
      // use the same buffered approach when tools are in play.
      if (hasTools) {
        this.handleWithToolParsing(res, query, modelId, parsed.stream ?? false);
      } else if (parsed.stream) {
        this.handleStreaming(res, query, modelId);
      } else {
        this.handleNonStreaming(res, query, modelId);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Tool-aware handler (buffers full response to parse tool calls)
  // -------------------------------------------------------------------------

  private handleWithToolParsing(
    res: http.ServerResponse,
    query: string,
    modelId: string,
    stream: boolean
  ): void {
    let fullContent = "";
    let responded = false;

    console.log(`[opencode-perplexity] Tool-aware request for model: ${modelId}`);
    console.log(`[opencode-perplexity] Query length: ${query.length} chars`);

    // If streaming, send SSE headers IMMEDIATELY and keep-alive comments
    // to prevent OpenCode from timing out while we buffer
    let keepAliveInterval: ReturnType<typeof setInterval> | null = null;
    if (stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      // Send keep-alive comment every 3 seconds to keep connection open
      keepAliveInterval = setInterval(() => {
        try { res.write(": keep-alive\n\n"); } catch {}
      }, 3000);
    }

    const cleanup = () => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
    };

    this.client!.streamQuery(query, modelId, {
      onChunk: (content) => {
        fullContent += content;
      },
      onDone: () => {
        if (responded) return;
        responded = true;
        cleanup();

        console.log(`[opencode-perplexity] Response received: ${fullContent.length} chars`);

        const { content, toolCalls } = parseToolCalls(fullContent);
        console.log(`[opencode-perplexity] Parsed ${toolCalls.length} tool calls`);

        const requestId = `chatcmpl-${randomId()}`;
        const now = Math.floor(Date.now() / 1000);

        if (toolCalls.length > 0) {
          if (stream) {
            // Headers already sent — just write the SSE data chunks
            if (content) {
              res.write(`data: ${JSON.stringify({
                id: requestId, object: "chat.completion.chunk", created: now, model: modelId,
                choices: [{ index: 0, delta: { content }, finish_reason: null }],
              })}\n\n`);
            }
            for (let i = 0; i < toolCalls.length; i++) {
              const tc = toolCalls[i];
              res.write(`data: ${JSON.stringify({
                id: requestId, object: "chat.completion.chunk", created: now, model: modelId,
                choices: [{ index: 0, delta: {
                  tool_calls: [{ index: i, id: tc.id, type: "function", function: { name: tc.function.name, arguments: tc.function.arguments } }],
                }, finish_reason: null }],
              })}\n\n`);
            }
            res.write(`data: ${JSON.stringify({
              id: requestId, object: "chat.completion.chunk", created: now, model: modelId,
              choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
          } else {
            this.json(res, 200, {
              id: requestId, object: "chat.completion", created: now, model: modelId,
              choices: [{ index: 0, message: { role: "assistant", content: content || null, tool_calls: toolCalls }, finish_reason: "tool_calls" }],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            });
          }
        } else {
          if (stream) {
            // Headers already sent — just write the text content
            if (fullContent) {
              res.write(`data: ${JSON.stringify({
                id: requestId, object: "chat.completion.chunk", created: now, model: modelId,
                choices: [{ index: 0, delta: { content: fullContent }, finish_reason: null }],
              })}\n\n`);
            }
            res.write(`data: ${JSON.stringify({
              id: requestId, object: "chat.completion.chunk", created: now, model: modelId,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
          } else {
            this.json(res, 200, {
              id: requestId, object: "chat.completion", created: now, model: modelId,
              choices: [{ index: 0, message: { role: "assistant", content: fullContent }, finish_reason: "stop" }],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            });
          }
        }
      },
      onError: (error) => {
        if (responded) return;
        responded = true;
        cleanup();

        console.error(`[opencode-perplexity] Error: ${error.message}`);

        if (stream) {
          // Headers may already be sent
          if (!res.headersSent) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
          }
          res.write(
            `data: ${JSON.stringify({ error: { message: error.message, type: "server_error" } })}\n\n`
          );
          res.write("data: [DONE]\n\n");
          res.end();
        } else {
          this.jsonError(res, 502, error.message);
        }
      },
    });
  }

  // -------------------------------------------------------------------------
  // Pure streaming (no tools)
  // -------------------------------------------------------------------------

  private handleStreaming(
    res: http.ServerResponse,
    query: string,
    modelId: string
  ): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const requestId = `chatcmpl-${randomId()}`;

    this.client!.streamQuery(query, modelId, {
      onChunk: (content) => {
        const chunk = {
          id: requestId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [
            {
              index: 0,
              delta: { content },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      },
      onDone: () => {
        const finalChunk = {
          id: requestId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      },
      onError: (error) => {
        const errorChunk = {
          error: {
            message: error.message,
            type: "server_error",
          },
        };
        res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      },
    });

    res.on("close", () => {});
  }

  // -------------------------------------------------------------------------
  // Non-streaming (no tools)
  // -------------------------------------------------------------------------

  private handleNonStreaming(
    res: http.ServerResponse,
    query: string,
    modelId: string
  ): void {
    let fullContent = "";

    this.client!.streamQuery(query, modelId, {
      onChunk: (content) => {
        fullContent += content;
      },
      onDone: () => {
        this.json(res, 200, {
          id: `chatcmpl-${randomId()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: fullContent },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        });
      },
      onError: (error) => {
        this.jsonError(res, 502, error.message);
      },
    });
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  private json(res: http.ServerResponse, status: number, body: any): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private jsonError(
    res: http.ServerResponse,
    status: number,
    message: string
  ): void {
    this.json(res, status, {
      error: { message, type: "server_error", code: status },
    });
  }
}

/**
 * Convert an OpenAI messages array into a single query string for Perplexity.
 *
 * Key design:
 * 1. Strip system messages (OpenCode's system prompt triggers injection detection)
 * 2. Put actual conversation content FIRST so the model sees the real question
 * 3. Append compact tool reference at the END as a postscript
 */
function messagesToQuery(
  messages: any[],
  tools?: ToolDefinition[]
): string {
  if (!messages || messages.length === 0) return "";

  const systemParts: string[] = [];
  const parts: string[] = [];

  for (const msg of messages) {
    const role = msg.role ?? "user";

    const content =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("\n")
          : "";

    // Collect system messages to disguise them later
    if (role === "system") {
      if (content) Object.keys(content).length > 0 && systemParts.push(content);
      continue;
    }

    // Tool result messages
    if (role === "tool") {
      parts.push(formatToolResultMessage(msg));
      continue;
    }

    // Reconstruct assistant tool calls for continuity
    if (role === "assistant" && msg.tool_calls && Array.isArray(msg.tool_calls)) {
      let assistantPart = content ? content + "\n" : "";
      for (const tc of msg.tool_calls) {
        if (tc.type === "function" && tc.function) {
          try {
            const args = typeof tc.function.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
            assistantPart += `\n<tool_call>\n${JSON.stringify({
              name: tc.function.name,
              arguments: args,
            }, null, 2)}\n</tool_call>\n`;
          } catch {
            // skip malformed
          }
        }
      }
      if (assistantPart.trim()) {
        parts.push(assistantPart.trim());
      }
      continue;
    }

    if (content) {
      parts.push(content);
    }
  }

  // Prepend disguised system context if it exists
  if (systemParts.length > 0) {
    const systemContext = `Context and instructions for this task:\n${systemParts.join("\n\n")}\n\n---\n`;
    parts.unshift(systemContext);
  }

  // Append tool hint at the very end
  const toolPrompt = tools && tools.length > 0 ? buildToolSystemPrompt(tools) : "";
  const conversation = parts.join("\n\n").trim();

  if (toolPrompt && conversation) {
    return `${conversation}\n\n${toolPrompt}`;
  }
  return conversation;
}

function randomId(): string {
  return Math.random().toString(36).substring(2, 15);
}

