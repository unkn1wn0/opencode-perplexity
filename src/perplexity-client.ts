/**
 * Perplexity web client — communicates with Perplexity AI using session cookies
 * and the web SSE API, bypassing the need for API keys.
 *
 * Adapted from PerplexiCode's approach.
 */

import * as https from "node:https";
import * as tls from "node:tls";
import { getModelById, type ModelEntry } from "./models.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERPLEXITY_HOST = "www.perplexity.ai";
const API_VERSION = "2.18";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const MAX_RETRIES = 2;

// Chrome-like TLS cipher suite ordering to avoid Cloudflare JA3 detection
const CHROME_CIPHERS = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
  "AES128-SHA",
  "AES256-SHA",
].join(":");

const chromeAgent = new https.Agent({
  keepAlive: true,
  ciphers: CHROME_CIPHERS,
  minVersion: "TLSv1.2" as tls.SecureVersion,
  maxVersion: "TLSv1.3" as tls.SecureVersion,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamCallbacks {
  onChunk: (content: string) => void;
  onDone: (fullContent: string) => void;
  onError: (error: Error) => void;
}

export interface PerplexityError extends Error {
  isSession?: boolean;
  isCloudflare?: boolean;
  isQuota?: boolean;
  isRateLimit?: boolean;
  isAccessDenied?: boolean;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class PerplexityWebClient {
  private sessionToken: string;
  private csrfToken: string;
  private fullCookies?: string;

  constructor(sessionToken: string, csrfToken: string, fullCookies?: string) {
    this.sessionToken = sessionToken;
    this.csrfToken = csrfToken;
    this.fullCookies = fullCookies;
  }

  updateTokens(
    sessionToken: string,
    csrfToken: string,
    fullCookies?: string
  ): void {
    this.sessionToken = sessionToken;
    this.csrfToken = csrfToken;
    this.fullCookies = fullCookies;
  }

  /**
   * Validate the current session by hitting the auth endpoint.
   */
  async validateSession(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = https.request(
        {
          method: "GET",
          hostname: PERPLEXITY_HOST,
          path: "/api/auth/session",
          agent: chromeAgent,
          headers: {
            Accept: "application/json",
            Cookie: this.buildCookie(),
            "User-Agent": USER_AGENT,
          },
          timeout: 15_000,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on("end", () => {
            if (
              !res.statusCode ||
              res.statusCode < 200 ||
              res.statusCode >= 400
            ) {
              resolve(false);
              return;
            }
            resolve(body.trim() !== "{}" && body.trim().length > 0);
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

  /**
   * Stream a query to Perplexity and return chunks via callbacks.
   */
  streamQuery(
    query: string,
    modelId: string,
    callbacks: StreamCallbacks
  ): AbortController {
    const abortController = new AbortController();
    const model = getModelById(modelId);

    const perplexityModelId = model?.perplexityId ?? modelId;
    const searchMode = model?.searchMode ?? "search";
    const requestMode = model?.requestMode ?? "COPILOT";

    this.doRequest(
      query,
      perplexityModelId,
      searchMode,
      requestMode,
      callbacks,
      abortController,
      0
    );
    return abortController;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private doRequest(
    query: string,
    perplexityModelId: string,
    searchMode: string,
    requestMode: string,
    callbacks: StreamCallbacks,
    abortController: AbortController,
    retryCount: number
  ): void {
    const body = JSON.stringify({
      query_str: query,
      params: {
        attachments: [],
        frontend_context_uuid: uuid(),
        frontend_uuid: uuid(),
        is_incognito: false,
        language: "en-US",
        last_backend_uuid: null,
        mode: requestMode,
        model_preference: perplexityModelId,
        search_mode: searchMode,
        source: "default",
        sources: ["web"],
        version: API_VERSION,
      },
    });

    const cookie = this.buildCookie();

    const req = https.request(
      {
        method: "POST",
        hostname: PERPLEXITY_HOST,
        path: "/rest/sse/perplexity_ask",
        agent: chromeAgent,
        headers: {
          Accept: "text/event-stream",
          "Accept-Language": "en-US,en;q=0.9",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Cookie: cookie,
          Origin: "https://www.perplexity.ai",
          Referer: "https://www.perplexity.ai/",
          "User-Agent": USER_AGENT,
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
        timeout: 60_000,
      },
      (res) => {
        if (res.statusCode && res.statusCode !== 200) {
          let errorBody = "";
          res.on("data", (chunk: Buffer) => {
            errorBody += chunk.toString();
          });
          res.on("end", () => {
            if (
              res.statusCode &&
              res.statusCode >= 500 &&
              retryCount < MAX_RETRIES
            ) {
              const delay = Math.pow(2, retryCount) * 1000;
              setTimeout(() => {
                this.doRequest(
                  query,
                  perplexityModelId,
                  searchMode,
                  requestMode,
                  callbacks,
                  abortController,
                  retryCount + 1
                );
              }, delay);
              return;
            }
            callbacks.onError(
              toRequestError(res.statusCode || 0, errorBody)
            );
          });
          return;
        }

        let fullContent = "";
        let buffer = "";
        let done = false;

        const finalize = () => {
          if (done) return;
          done = true;
          callbacks.onDone(fullContent);
        };

        res.on("data", (chunk: Buffer) => {
          if (abortController.signal.aborted || done) {
            res.destroy();
            return;
          }

          buffer += chunk.toString();
          // Split on double newlines — SSE uses \n\n or \r\n\r\n
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() || "";

          for (const event of events) {
            const trimmed = event.trim();
            if (!trimmed) continue;

            if (
              trimmed.includes("event: end_of_stream") ||
              trimmed === "data: [DONE]"
            ) {
              finalize();
              return;
            }

            const delta = extractDelta(trimmed, fullContent);
            if (delta !== null) {
              fullContent += delta;
              callbacks.onChunk(delta);
            }
          }
        });

        res.on("end", () => {
          if (abortController.signal.aborted) return;

          // Process any remaining buffer
          if (buffer.trim()) {
            const delta = extractDelta(buffer.trim(), fullContent);
            if (delta !== null) {
              fullContent += delta;
              callbacks.onChunk(delta);
            }
          }

          finalize();
        });

        res.on("error", (error: Error) => {
          callbacks.onError(error);
        });

        res.setTimeout(120_000, () => {
          res.destroy();
          callbacks.onError(new Error("Response timed out."));
        });
      }
    );

    req.on("error", (error: Error) => {
      if (abortController.signal.aborted) return;

      if (retryCount < MAX_RETRIES) {
        const delay = Math.pow(2, retryCount) * 1000;
        setTimeout(() => {
          this.doRequest(
            query,
            perplexityModelId,
            searchMode,
            requestMode,
            callbacks,
            abortController,
            retryCount + 1
          );
        }, delay);
        return;
      }

      callbacks.onError(new Error(`Connection failed: ${error.message}`));
    });

    req.on("timeout", () => {
      req.destroy();
      callbacks.onError(new Error("Connection timed out."));
    });

    abortController.signal.addEventListener("abort", () => {
      req.destroy();
    });

    req.write(body);
    req.end();
  }

  private buildCookie(): string {
    if (this.fullCookies) {
      return this.fullCookies;
    }
    return `__Secure-next-auth.session-token=${this.sessionToken}; next-auth.csrf-token=${this.csrfToken}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Extract new text delta from an SSE event payload, given the content
 * accumulated so far.
 */
function extractDelta(event: string, currentContent: string): string | null {
  let payload: any;

  // Try "event: message\ndata: {...}" format
  if (event.includes("event: message")) {
    const match = event.match(/data:\s*(.*)/s);
    if (!match) return null;
    try {
      payload = JSON.parse(match[1].trim());
    } catch {
      return null;
    }
  }
  // Try "data: {...}" format
  else if (event.startsWith("data: ")) {
    const raw = event.slice(6).trim();
    if (!raw || raw === "[DONE]") return null;
    try {
      payload = JSON.parse(raw);
    } catch {
      // Plain string data
      return raw;
    }
  } else {
    return null;
  }

  if (!payload || typeof payload !== "object") return null;

  // Check for answer field (full replacement text)
  if (typeof payload.answer === "string" && payload.answer.length > currentContent.length) {
    return payload.answer.slice(currentContent.length);
  }

  // Check for text field (may be nested JSON)
  if (typeof payload.text === "string") {
    const parsed = extractTextFromPayload(payload.text);
    if (parsed.length > currentContent.length) {
      return parsed.slice(currentContent.length);
    }
  }

  // Check for OpenAI-style delta
  if (typeof payload.choices?.[0]?.delta?.content === "string") {
    return payload.choices[0].delta.content;
  }

  return null;
}

function extractTextFromPayload(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      for (const step of parsed) {
        if (step?.step_type === "FINAL" && step?.content?.answer) {
          try {
            const answer = JSON.parse(step.content.answer);
            return answer?.answer || "";
          } catch {
            return step.content.answer;
          }
        }
      }
    }
  } catch {
    return rawText;
  }
  return rawText;
}

function toRequestError(
  statusCode: number,
  body: string
): PerplexityError {
  const low = body.toLowerCase();
  const err = new Error() as PerplexityError;

  if (
    statusCode === 401 ||
    (statusCode === 403 && hasAny(low, ["session expired", "unauthorized", "not authenticated", "csrf", "login"]))
  ) {
    err.message = "Session expired. Please re-login to your Perplexity account.";
    err.isSession = true;
    return err;
  }

  if (statusCode === 403 && hasAny(low, ["cloudflare", "challenge-platform", "just a moment", "ray id"])) {
    err.message = "Cloudflare is blocking this request.";
    err.isCloudflare = true;
    return err;
  }

  if ((statusCode === 403 || statusCode === 429) && low.includes("quota")) {
    err.message = "Quota exhausted for this account.";
    err.isQuota = true;
    return err;
  }

  if (statusCode === 429) {
    err.message = "Rate limited. Please wait before sending more queries.";
    err.isRateLimit = true;
    return err;
  }

  if (statusCode === 400 && hasAny(low, ["model_preference", "invalid model", "unsupported model"])) {
    err.message = "The selected model was rejected by Perplexity. Try another model.";
    err.isAccessDenied = true;
    return err;
  }

  if (statusCode === 403) {
    err.message = `Access denied (403): ${body.substring(0, 200)}`;
    err.isAccessDenied = true;
    return err;
  }

  err.message = `Perplexity error ${statusCode}: ${body.substring(0, 300)}`;
  return err;
}

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}
