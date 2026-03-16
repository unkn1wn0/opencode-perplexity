/**
 * Model catalog mapping OpenAI-style model IDs to Perplexity internal IDs.
 */

export interface ModelEntry {
  /** ID used in OpenAI-compatible API requests */
  id: string;
  /** Display name */
  name: string;
  /** Perplexity internal model ID */
  perplexityId: string;
  /** Perplexity search mode */
  searchMode: "search" | "research" | "agentic_research";
  /** Perplexity request mode */
  requestMode: "CONCISE" | "COPILOT";
  /** Required subscription tier */
  tier: "free" | "pro" | "max";
  /** Max context tokens */
  contextWindow: number;
  /** Max output tokens */
  maxOutput: number;
}

export const MODEL_CATALOG: ModelEntry[] = [
  // --- Free ---
  {
    id: "best",
    name: "Best (Auto-Select)",
    perplexityId: "turbo",
    searchMode: "search",
    requestMode: "CONCISE",
    tier: "free",
    contextWindow: 128_000,
    maxOutput: 4_096,
  },

  // --- Pro tier ---
  {
    id: "sonar",
    name: "Sonar",
    perplexityId: "experimental",
    searchMode: "search",
    requestMode: "COPILOT",
    tier: "pro",
    contextWindow: 200_000,
    maxOutput: 8_192,
  },
  {
    id: "claude-4.6-sonnet",
    name: "Claude Sonnet 4.6",
    perplexityId: "claude46sonnet",
    searchMode: "search",
    requestMode: "COPILOT",
    tier: "pro",
    contextWindow: 200_000,
    maxOutput: 65_536,
  },
  {
    id: "claude-4.6-sonnet-thinking",
    name: "Claude Sonnet 4.6 Thinking",
    perplexityId: "claude46sonnetthinking",
    searchMode: "search",
    requestMode: "COPILOT",
    tier: "pro",
    contextWindow: 200_000,
    maxOutput: 65_536,
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    perplexityId: "gpt54",
    searchMode: "search",
    requestMode: "COPILOT",
    tier: "pro",
    contextWindow: 200_000,
    maxOutput: 32_768,
  },
  {
    id: "gpt-5.4-thinking",
    name: "GPT-5.4 Thinking",
    perplexityId: "gpt54_thinking",
    searchMode: "search",
    requestMode: "COPILOT",
    tier: "pro",
    contextWindow: 200_000,
    maxOutput: 32_768,
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    perplexityId: "gemini31pro_high",
    searchMode: "search",
    requestMode: "COPILOT",
    tier: "pro",
    contextWindow: 200_000,
    maxOutput: 65_536,
  },
  {
    id: "nemotron-3-super",
    name: "Nemotron 3 Super",
    perplexityId: "nemotron_3_super",
    searchMode: "search",
    requestMode: "COPILOT",
    tier: "pro",
    contextWindow: 200_000,
    maxOutput: 32_768,
  },
  {
    id: "kimi-k2.5-thinking",
    name: "Kimi K2.5 Thinking",
    perplexityId: "kimi_k2_5_thinking",
    searchMode: "search",
    requestMode: "COPILOT",
    tier: "pro",
    contextWindow: 200_000,
    maxOutput: 32_768,
  },

  // --- Max tier ---
  {
    id: "claude-4.6-opus",
    name: "Claude Opus 4.6",
    perplexityId: "claude46opus",
    searchMode: "search",
    requestMode: "COPILOT",
    tier: "max",
    contextWindow: 200_000,
    maxOutput: 65_536,
  },
  {
    id: "claude-4.6-opus-thinking",
    name: "Claude Opus 4.6 Thinking",
    perplexityId: "claude46opusthinking",
    searchMode: "search",
    requestMode: "COPILOT",
    tier: "max",
    contextWindow: 200_000,
    maxOutput: 65_536,
  },
  {
    id: "grok-4",
    name: "Grok 4",
    perplexityId: "grok_4",
    searchMode: "search",
    requestMode: "COPILOT",
    tier: "max",
    contextWindow: 200_000,
    maxOutput: 32_768,
  },
  {
    id: "o3-pro",
    name: "o3-Pro",
    perplexityId: "o3_pro",
    searchMode: "search",
    requestMode: "COPILOT",
    tier: "max",
    contextWindow: 200_000,
    maxOutput: 32_768,
  },
];

/** Lookup a model by its OpenAI-compatible ID */
export function getModelById(id: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

/** Lookup a model by its Perplexity internal ID */
export function getModelByPerplexityId(pid: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((m) => m.perplexityId === pid);
}
