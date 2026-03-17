<div align="center">

# 🔮 opencode-perplexity

**Use Perplexity Pro models in OpenCode — no API keys needed.**

Claude Sonnet 4.6 · GPT-5.4 · Gemini 3.1 Pro · Claude Opus 4.6 · Grok 4 · o3-Pro · and more

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org)
[![OpenCode](https://img.shields.io/badge/OpenCode-plugin-blue.svg)](https://opencode.ai)
[![Inspired by PerplexiCode](https://img.shields.io/badge/Inspired%20by-PerplexiCode-purple.svg)](https://github.com/yuki-20/PerplexiCode)

</div>

---

A plugin for [OpenCode](https://opencode.ai) that runs a local proxy server translating OpenCode's standard AI requests into Perplexity's web API — authenticated with your existing browser session. No API subscription, no extra billing.

Inspired by [PerplexiCode](https://github.com/yuki-20/PerplexiCode) (VS Code), adapted for OpenCode's terminal workflow.

## How It Works

```
OpenCode → local proxy (port 5768) → Perplexity web SSE API → your Pro subscription
```

1. The plugin starts a local OpenAI-compatible server on `http://127.0.0.1:5768`
2. OpenCode sends chat requests to it like any other provider
3. The proxy forwards them to Perplexity's internal API using your session cookies
4. Responses stream back in real-time

Your cookies are stored locally (never sent anywhere except Perplexity's own servers).

---

## Requirements

- [OpenCode](https://opencode.ai) installed
- Node.js **18+**
- A **Perplexity Pro** or **Max** subscription

---

## Installation

```bash
git clone https://github.com/unkn1wn0/opencode-perplexity.git
cd opencode-perplexity
npm install
npm run setup
```

The `setup` command builds the project **and installs it globally** into OpenCode:

- Plugin files → `~/.config/opencode/plugins/`
- Provider config → `~/.config/opencode/opencode.json`

After this, Perplexity models are available **in every project** — not just this folder.

### Uninstall

```bash
npm run unsetup
```

This removes plugin files and the Perplexity provider from the global config.

---

## Usage

### 1. Start OpenCode (from any directory)

```bash
opencode
```

### 2. Log In

The plugin registers a `perplexity_login` tool. Just tell the agent:

> "Log me in to Perplexity"

It will ask you to paste your browser cookies.

<details>
<summary><strong>How to get your cookies</strong></summary>

1. Open **Chrome** or **Edge** and go to [perplexity.ai](https://perplexity.ai) — make sure you're **logged in**
2. Press **F12** to open DevTools → click the **Network** tab
3. **Refresh the page** (F5)
4. Click any request in the list → open the **Headers** tab → scroll to **Request Headers**
5. Find the `Cookie` field → click and **copy the entire value**
6. Paste it when the agent prompts you

Cookies are saved to `~/.config/opencode-perplexity/cookies.json` so you only need to do this once per session expiry.

</details>

### 3. Select a Model

Use the `/models` command inside OpenCode. Perplexity models appear under the **"Perplexity (Pro Session)"** provider.

```
/models
```

Then start chatting — responses stream in real time.

---

## Available Models

| Model | ID | Tier |
|-------|-----|------|
| Best (Auto-Select) | `best` | Free |
| Sonar | `sonar` | Pro |
| Claude Sonnet 4.6 | `claude-4.6-sonnet` | Pro |
| Claude Sonnet 4.6 Thinking | `claude-4.6-sonnet-thinking` | Pro |
| GPT-5.4 | `gpt-5.4` | Pro |
| GPT-5.4 Thinking | `gpt-5.4-thinking` | Pro |
| Gemini 3.1 Pro | `gemini-3.1-pro` | Pro |
| Nemotron 3 Super | `nemotron-3-super` | Pro |
| Kimi K2.5 Thinking | `kimi-k2.5-thinking` | Pro |
| Claude Opus 4.6 | `claude-4.6-opus` | Max |
| Claude Opus 4.6 Thinking | `claude-4.6-opus-thinking` | Max |
| Grok 4 | `grok-4` | Max |
| o3-Pro | `o3-pro` | Max |

---

## Plugin Tools

These tools are available to the AI agent inside OpenCode:

| Tool | Description |
|------|-------------|
| `perplexity_login` | Paste your browser cookies to authenticate |
| `perplexity_logout` | Clear saved cookies and sign out |
| `perplexity_status` | Show session status and available models |

---

## Changelog

### v2.0.0 (Latest)
- **Tool Use Emulation**: Perplexity models can now use OpenCode tools (read/write files, run bash commands) via a custom prompt injection technique that bypasses safety filters.
- **SSE Streaming Fixes**: Fixed a bug where response reading would time out because Perplexity uses `\n\n` instead of `\r\n\r\n` for its SSE delimiter.
- **Port Conflict Native Handling**: If a previous OpenCode session didn't cleanly shut down, the new proxy will gracefully detect and reuse the existing healthy proxy instead of failing silently.
- **System Prompt Reinjection**: Agent personas and system instructions are now meticulously wrapped as task context to ensure Perplexity still adopts the OpenCode persona.
- **Keep-Alive Headers**: Added keep-alive packets during tool buffering to ensure OpenCode does not drop the connection.

### v1.0.0
- Initial release: Proxy server, SSE streaming, cookie authentication, and basic global installation.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Session expired` | Cookies have expired — re-run `perplexity_login` with fresh cookies |
| `Cloudflare is blocking` | Perplexity detected unusual access — wait a few minutes and retry |
| `Quota exhausted` | Hit subscription usage limits — wait for the daily reset |
| `Port 5768 already in use` | Another instance is running — close it or change `PROXY_PORT` in `src/plugin.ts` |
| Models missing in `/models` | Ensure you ran `npm run setup` and restarted OpenCode |

---

## Project Structure

```
opencode-perplexity/
├── src/
│   ├── plugin.ts            # OpenCode plugin entry (login/logout/status tools)
│   ├── proxy-server.ts      # Local OpenAI-compatible HTTP proxy
│   ├── perplexity-client.ts # Perplexity SSE web client (TLS fingerprinting)
│   ├── models.ts            # Model catalog
│   ├── cookie-store.ts      # Cookie parsing & persistence
│   ├── install.ts           # Global install script
│   └── uninstall.ts         # Global uninstall script
├── opencode.json            # Local OpenCode config (for dev)
├── package.json
└── tsconfig.json
```

---

## License

MIT — see [LICENSE](LICENSE)

> **Disclaimer:** This project uses Perplexity's private web API via session cookies. It is not affiliated with or endorsed by Perplexity AI. It may break if Perplexity changes their API. Use responsibly and in accordance with Perplexity's Terms of Service.
