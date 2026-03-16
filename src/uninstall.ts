/**
 * Uninstall script — removes plugin files from global OpenCode directory
 * and removes the Perplexity provider from global opencode.json.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

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

function main() {
  console.log("🔮 opencode-perplexity uninstaller\n");

  // 1. Remove plugin files
  const bundlePath = path.join(GLOBAL_PLUGINS_DIR, "opencode-perplexity.js");
  if (fs.existsSync(bundlePath)) {
    fs.unlinkSync(bundlePath);
    console.log(`✅ Removed opencode-perplexity.js from ${GLOBAL_PLUGINS_DIR}`);
  }

  // Remove any old un-bundled files
  const oldFiles = [
    "plugin.js", "proxy-server.js", "perplexity-client.js", "models.js", "cookie-store.js",
    "install.js", "uninstall.js", "plugin.d.ts", "models.d.ts", "proxy-server.d.ts"
  ];
  for (const file of oldFiles) {
    const fullPath = path.join(GLOBAL_PLUGINS_DIR, file);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch {}
    }
  }

  // 2. Remove provider from global config
  const configPath = getGlobalConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const cleaned = raw.replace(/\,(?!\s*?[\{\[\"\'\w])/g, '');
      const config = JSON.parse(cleaned);

      if (config.provider?.perplexity) {
        delete config.provider.perplexity;
        if (Object.keys(config.provider).length === 0) {
          delete config.provider;
        }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
        console.log(`✅ Removed Perplexity provider from ${configPath}`);
      }
    } catch {
      console.warn(`⚠️  Could not parse or update ${configPath}`);
    }
  }

  console.log("\n🎉 Uninstall complete. Perplexity provider has been removed from OpenCode.\n");
}

main();
