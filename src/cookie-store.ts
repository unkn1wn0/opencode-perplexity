/**
 * Cookie store — persists Perplexity session cookies to disk.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredCookies {
  sessionToken: string;
  csrfToken: string;
  fullCookies: string;
  savedAt: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getConfigDir(): string {
  const base =
    process.env.XDG_CONFIG_HOME ||
    (process.platform === "win32"
      ? path.join(os.homedir(), "AppData", "Roaming")
      : path.join(os.homedir(), ".config"));
  return path.join(base, "opencode-perplexity");
}

function getCookiePath(): string {
  return path.join(getConfigDir(), "cookies.json");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw cookie string and extract the session & CSRF tokens.
 */
export function parseCookies(raw: string): StoredCookies {
  const sessionMatch = raw.match(
    /__Secure-next-auth\.session-token=([^;]+)/
  );
  const csrfMatch = raw.match(/next-auth\.csrf-token=([^;]+)/);

  const sessionToken = sessionMatch?.[1]?.trim() ?? "";
  const csrfToken = csrfMatch?.[1]?.trim() ?? "";

  if (!sessionToken) {
    throw new Error(
      "Could not find __Secure-next-auth.session-token in cookies. Make sure you copied the full Cookie header from your browser."
    );
  }

  return {
    sessionToken,
    csrfToken,
    fullCookies: raw.trim(),
    savedAt: new Date().toISOString(),
  };
}

/**
 * Save cookies to disk.
 */
export function saveCookies(cookies: StoredCookies): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getCookiePath(), JSON.stringify(cookies, null, 2), "utf-8");
}

/**
 * Load cookies from disk. Returns null if no cookies file exists.
 */
export function loadCookies(): StoredCookies | null {
  const cookiePath = getCookiePath();
  if (!fs.existsSync(cookiePath)) return null;

  try {
    const raw = fs.readFileSync(cookiePath, "utf-8");
    const data = JSON.parse(raw) as StoredCookies;
    if (!data.sessionToken) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Clear saved cookies.
 */
export function clearCookies(): void {
  const cookiePath = getCookiePath();
  if (fs.existsSync(cookiePath)) {
    fs.unlinkSync(cookiePath);
  }
}
