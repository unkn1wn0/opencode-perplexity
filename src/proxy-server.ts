/**
 * Local OpenAI-compatible proxy server.
 *
 * Translates standard /v1/chat/completions requests into Perplexity's
 * web SSE API calls, so OpenCode (via @ai-sdk/openai-compatible) can
 * talk to Perplexity through the user's Pro subscription.
 */

import * as http from "node:http";
import { PerplexityWebClient } from "./perplexity-client.js";
import { MODEL_CATALOG, getModelById } from "./models.js";

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
          console.error(
            `[opencode-perplexity] Port ${this.port} is already in use. Is another instance running?`
          );
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

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
      const stream: boolean = parsed.stream ?? false;

      // Combine all messages into a single query for Perplexity
      const query = messagesToQuery(messages);
      if (!query) {
        this.jsonError(res, 400, "No user message found");
        return;
      }

      if (stream) {
        this.handleStreaming(res, query, modelId);
      } else {
        this.handleNonStreaming(res, query, modelId);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Streaming
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
      onDone: (_fullContent) => {
        // Send final chunk with finish_reason
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

    // Handle client disconnect
    req_onClose(res, () => {});
  }

  // -------------------------------------------------------------------------
  // Non-streaming
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an OpenAI messages array into a single query string for Perplexity.
 * We send the full conversation context as a formatted prompt.
 */
function messagesToQuery(messages: any[]): string {
  if (!messages || messages.length === 0) return "";

  // If there's a system message, include it as context
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

    if (!content) continue;

    if (role === "system") {
      parts.push(`[System Instructions]\n${content}\n`);
    } else if (role === "user") {
      parts.push(`[User]\n${content}\n`);
    } else if (role === "assistant") {
      parts.push(`[Assistant]\n${content}\n`);
    }
  }

  return parts.join("\n").trim();
}

function randomId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/** Attach a close handler to a response (handles client disconnect) */
function req_onClose(res: http.ServerResponse, fn: () => void): void {
  res.on("close", fn);
}
