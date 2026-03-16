/**
 * Install script — copies the built plugin to the global OpenCode
 * plugins directory and merges provider config into global opencode.json.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getGlobalConfigDir(): string {
  if (process.platform === "win32") {
    return path.join(os.homedir(), ".config", "opencode");
  }
  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "opencode"
  );
}

const GLOBAL_CONFIG_DIR = getGlobalConfigDir();
const GLOBAL_PLUGINS_DIR = path.join(GLOBAL_CONFIG_DIR, "plugins");

function getGlobalConfigPath(): string {
  const jsoncPath = path.join(GLOBAL_CONFIG_DIR, "opencode.jsonc");
  if (fs.existsSync(jsoncPath)) {
    return jsoncPath;
  }
  return path.join(GLOBAL_CONFIG_DIR, "opencode.json");
}

// ---------------------------------------------------------------------------
// Provider config to merge
// ---------------------------------------------------------------------------

const PROVIDER_CONFIG = {
  perplexity: {
    npm: "@ai-sdk/openai-compatible",
    name: "Perplexity (Pro Session)",
    options: {
      baseURL: "http://127.0.0.1:5768/v1",
      apiKey: "not-needed",
    },
    models: {
      best: { name: "Best (Auto-Select)", limit: { context: 128000, output: 4096 } },
      sonar: { name: "Sonar", limit: { context: 200000, output: 8192 } },
      "claude-4.6-sonnet": { name: "Claude Sonnet 4.6", limit: { context: 200000, output: 65536 } },
      "claude-4.6-sonnet-thinking": { name: "Claude Sonnet 4.6 Thinking", limit: { context: 200000, output: 65536 } },
      "gpt-5.4": { name: "GPT-5.4", limit: { context: 200000, output: 32768 } },
      "gpt-5.4-thinking": { name: "GPT-5.4 Thinking", limit: { context: 200000, output: 32768 } },
      "gemini-3.1-pro": { name: "Gemini 3.1 Pro", limit: { context: 200000, output: 65536 } },
      "nemotron-3-super": { name: "Nemotron 3 Super", limit: { context: 200000, output: 32768 } },
      "kimi-k2.5-thinking": { name: "Kimi K2.5 Thinking", limit: { context: 200000, output: 32768 } },
      "claude-4.6-opus": { name: "Claude Opus 4.6", limit: { context: 200000, output: 65536 } },
      "claude-4.6-opus-thinking": { name: "Claude Opus 4.6 Thinking", limit: { context: 200000, output: 65536 } },
      "grok-4": { name: "Grok 4", limit: { context: 200000, output: 32768 } },
      "o3-pro": { name: "o3-Pro", limit: { context: 200000, output: 32768 } },
    },
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("🔮 opencode-perplexity installer\n");

  // 1. Ensure global dirs exist
  fs.mkdirSync(GLOBAL_PLUGINS_DIR, { recursive: true });
  console.log(`📁 Plugin directory: ${GLOBAL_PLUGINS_DIR}`);

  // 2. Copy the bundled file to global plugins dir
  const distDir = path.join(process.cwd(), "dist");
  const bundlePath = path.join(distDir, "opencode-perplexity.js");

  if (!fs.existsSync(bundlePath)) {
    console.error(`❌ Bundle not found at ${bundlePath}. Run 'npm run build' first.`);
    process.exit(1);
  }

  // Before copying, remove any old un-bundled files we might have placed before
  const oldFiles = [
    "plugin.js", "proxy-server.js", "perplexity-client.js", "models.js", "cookie-store.js",
    "install.js", "uninstall.js"
  ];
  for (const file of oldFiles) {
    const fullPath = path.join(GLOBAL_PLUGINS_DIR, file);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  fs.copyFileSync(bundlePath, path.join(GLOBAL_PLUGINS_DIR, "opencode-perplexity.js"));
  console.log(`✅ Copied opencode-perplexity.js to plugins directory`);

  // 3. Merge provider config into global config file
  const configPath = getGlobalConfigPath();
  let globalConfig: any = { $schema: "https://opencode.ai/config.json" };

  if (fs.existsSync(configPath)) {
    try {
      // NOTE: Using standard JSON.parse. Will work for jsonc if there are no comments.
      const raw = fs.readFileSync(configPath, "utf-8");
      // Basic strip of trailing commas for robustness before parsing
      const cleaned = raw.replace(/\,(?!\s*?[\{\[\"\'\w])/g, '');
      globalConfig = JSON.parse(cleaned);
    } catch (e) {
      console.warn(`⚠️  Could not parse existing config at ${configPath}. Ensure it is valid JSON. Error: ${e}`);
      console.warn("Creating fresh config...");
      globalConfig = { $schema: "https://opencode.ai/config.json" };
    }
  }

  // Merge provider
  if (!globalConfig.provider) globalConfig.provider = {};
  globalConfig.provider.perplexity = PROVIDER_CONFIG.perplexity;

  // We write it pretty-printed. If it was jsonc, it stays valid.
  fs.writeFileSync(configPath, JSON.stringify(globalConfig, null, 2), "utf-8");
  console.log(`✅ Provider config merged into ${configPath}`);

  console.log("\n🎉 Done! The Perplexity provider is now available globally in OpenCode.");
  console.log('   Run "opencode" in any directory and use /models to see Perplexity models.');
  console.log('   First time? Tell the agent "Log me in to Perplexity" to paste your cookies.\n');
}

main();
