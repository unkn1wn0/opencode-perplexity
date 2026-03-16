/**
 * OpenCode plugin entry point.
 *
 * - Starts the local proxy server on init
 * - Registers custom tools for cookie management
 * - Loads/saves cookies to disk
 */

import { type Plugin, tool } from "@opencode-ai/plugin";
import { PerplexityWebClient } from "./perplexity-client.js";
import { ProxyServer } from "./proxy-server.js";
import {
  parseCookies,
  saveCookies,
  loadCookies,
  clearCookies,
} from "./cookie-store.js";
import { MODEL_CATALOG } from "./models.js";

const PROXY_PORT = 5768;

export const PerplexityPlugin: Plugin = async (ctx) => {
  const proxy = new ProxyServer(PROXY_PORT);
  let client: PerplexityWebClient | null = null;
  let sessionValid = false;

  // -----------------------------------------------------------------------
  // Try loading saved cookies on start
  // -----------------------------------------------------------------------
  const saved = loadCookies();
  if (saved) {
    client = new PerplexityWebClient(
      saved.sessionToken,
      saved.csrfToken,
      saved.fullCookies
    );
    proxy.setClient(client);

    try {
      sessionValid = await client.validateSession();
      if (sessionValid) {
        console.log("[opencode-perplexity] Loaded saved session — cookies are valid.");
      } else {
        console.log(
          "[opencode-perplexity] Saved cookies found but session is invalid. Use perplexity_login to re-authenticate."
        );
      }
    } catch {
      console.log(
        "[opencode-perplexity] Could not validate saved session. Use perplexity_login to re-authenticate."
      );
    }
  } else {
    console.log(
      "[opencode-perplexity] No saved cookies found. Use perplexity_login to authenticate."
    );
  }

  // -----------------------------------------------------------------------
  // Start the proxy
  // -----------------------------------------------------------------------
  try {
    await proxy.start();
  } catch (err: any) {
    console.error(
      `[opencode-perplexity] Failed to start proxy: ${err.message}`
    );
  }

  // -----------------------------------------------------------------------
  // Return hooks + custom tools
  // -----------------------------------------------------------------------
  return {
    tool: {
      // -------------------------------------------------------------------
      // perplexity_login — paste cookies to authenticate
      // -------------------------------------------------------------------
      perplexity_login: tool({
        description:
          'Log in to Perplexity by pasting browser cookies. To get cookies: open Microsoft Edge/Chrome, go to perplexity.ai (make sure you\'re logged in), press F12 → Network tab → refresh the page → click any request → find "Cookie" in Request Headers → copy the entire value.',
        args: {
          cookies: tool.schema.string(
            "Full Cookie header value from your browser"
          ),
        },
        async execute(args) {
          try {
            const parsed = parseCookies(args.cookies);

            client = new PerplexityWebClient(
              parsed.sessionToken,
              parsed.csrfToken,
              parsed.fullCookies
            );

            const valid = await client.validateSession();
            if (!valid) {
              return "⚠️ Cookies were parsed but the session appears invalid. Make sure you're logged into Perplexity and copied the cookies from a recent request.";
            }

            proxy.setClient(client);
            saveCookies(parsed);
            sessionValid = true;

            return `✅ Successfully logged in! Session is valid.\n\nYou can now use Perplexity models. Switch models with /models and look for models under the "Perplexity" provider.\n\nAvailable models:\n${MODEL_CATALOG.map((m) => `  • ${m.name} (${m.id}) [${m.tier}]`).join("\n")}`;
          } catch (err: any) {
            return `❌ Login failed: ${err.message}`;
          }
        },
      }),

      // -------------------------------------------------------------------
      // perplexity_logout — clear saved cookies
      // -------------------------------------------------------------------
      perplexity_logout: tool({
        description: "Log out from Perplexity and clear saved cookies.",
        args: {},
        async execute() {
          clearCookies();
          client = null;
          sessionValid = false;
          proxy.setClient(null as any);
          return "✅ Logged out. Saved cookies have been cleared.";
        },
      }),

      // -------------------------------------------------------------------
      // perplexity_status — show session and model info
      // -------------------------------------------------------------------
      perplexity_status: tool({
        description:
          "Check the current Perplexity session status, available models, and proxy server state.",
        args: {},
        async execute() {
          const lines: string[] = [];

          lines.push("## Perplexity Plugin Status\n");

          // Session
          if (client) {
            try {
              const valid = await client.validateSession();
              sessionValid = valid;
              lines.push(
                valid
                  ? "🟢 **Session**: Active and valid"
                  : "🟡 **Session**: Cookies loaded but session is invalid — re-login with perplexity_login"
              );
            } catch {
              lines.push(
                "🔴 **Session**: Could not validate (network error)"
              );
            }
          } else {
            lines.push(
              "🔴 **Session**: Not logged in — use perplexity_login"
            );
          }

          // Proxy
          lines.push(`\n📡 **Proxy**: http://127.0.0.1:${PROXY_PORT}`);

          // Models
          lines.push("\n### Available Models\n");
          const byTier = { free: [], pro: [], max: [] } as Record<
            string,
            typeof MODEL_CATALOG
          >;
          for (const m of MODEL_CATALOG) {
            byTier[m.tier]?.push(m);
          }
          for (const [tier, models] of Object.entries(byTier)) {
            if (models.length === 0) continue;
            lines.push(`**${tier.toUpperCase()} tier:**`);
            for (const m of models) {
              lines.push(`  • ${m.name} → \`${m.id}\``);
            }
            lines.push("");
          }

          return lines.join("\n");
        },
      }),
    },
  };
};
