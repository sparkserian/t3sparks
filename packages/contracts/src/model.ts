import { Schema } from "effect";
import { ProviderKind } from "./orchestration";

export const CODEX_REASONING_EFFORT_OPTIONS = ["xhigh", "high", "medium", "low"] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORT_OPTIONS)[number];

export const CLAUDE_CODE_EFFORT_OPTIONS = ["low", "medium", "high", "max", "ultrathink"] as const;
export type ClaudeCodeEffort = (typeof CLAUDE_CODE_EFFORT_OPTIONS)[number];

export type ProviderReasoningEffort = CodexReasoningEffort | ClaudeCodeEffort;

export const CodexModelOptions = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
});
export type CodexModelOptions = typeof CodexModelOptions.Type;

export const ClaudeModelOptions = Schema.Struct({
  thinking: Schema.optional(Schema.Boolean),
  effort: Schema.optional(Schema.Literals(CLAUDE_CODE_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
});
export type ClaudeModelOptions = typeof ClaudeModelOptions.Type;

export const GeminiModelOptions = Schema.Struct({});
export type GeminiModelOptions = typeof GeminiModelOptions.Type;

export const ProviderModelOptions = Schema.Struct({
  codex: Schema.optional(CodexModelOptions),
  claudeAgent: Schema.optional(ClaudeModelOptions),
  gemini: Schema.optional(GeminiModelOptions),
});
export type ProviderModelOptions = typeof ProviderModelOptions.Type;

type ModelOption = {
  readonly slug: string;
  readonly name: string;
};

export const MODEL_OPTIONS_BY_PROVIDER = {
  codex: [
    { slug: "gpt-5.4", name: "GPT-5.4" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { slug: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark" },
    { slug: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    { slug: "gpt-5.2", name: "GPT-5.2" },
  ],
  claudeAgent: [
    { slug: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { slug: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  gemini: [
    { slug: "auto", name: "Auto" },
    {
      slug: "gemini-3.1-pro-preview",
      name: "Gemini 3.1 Pro (Preview, may be unavailable)",
    },
    { slug: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { slug: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { slug: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
  ],
} as const satisfies Record<ProviderKind, readonly ModelOption[]>;
export type ModelOptionsByProvider = typeof MODEL_OPTIONS_BY_PROVIDER;

type BuiltInModelSlug = ModelOptionsByProvider[ProviderKind][number]["slug"];
export type ModelSlug = BuiltInModelSlug | (string & {});

export const DEFAULT_MODEL_BY_PROVIDER = {
  codex: "gpt-5.4",
  claudeAgent: "claude-sonnet-4-6",
  gemini: "auto",
} as const satisfies Record<ProviderKind, ModelSlug>;

export const MODEL_SLUG_ALIASES_BY_PROVIDER = {
  codex: {
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  claudeAgent: {
    opus: "claude-opus-4-6",
    "opus-4.6": "claude-opus-4-6",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-opus-4-6-20251117": "claude-opus-4-6",
    sonnet: "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4-6-20251117": "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
    "haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  },
  gemini: {
    "3.1-pro": "gemini-3.1-pro-preview",
    "gemini-3.1-pro": "gemini-3.1-pro-preview",
    "3-pro": "gemini-3.1-pro-preview",
    "gemini-3-pro-preview": "gemini-3.1-pro-preview",
    pro: "gemini-2.5-pro",
    flash: "gemini-2.5-flash",
    "flash-lite": "gemini-2.5-flash-lite",
    "2.5-pro": "gemini-2.5-pro",
    "2.5-flash": "gemini-2.5-flash",
    "2.5-flash-lite": "gemini-2.5-flash-lite",
  },
} as const satisfies Record<ProviderKind, Record<string, ModelSlug>>;

export const REASONING_EFFORT_OPTIONS_BY_PROVIDER = {
  codex: CODEX_REASONING_EFFORT_OPTIONS,
  claudeAgent: CLAUDE_CODE_EFFORT_OPTIONS,
  gemini: [],
} as const satisfies Record<ProviderKind, readonly ProviderReasoningEffort[]>;

export const DEFAULT_REASONING_EFFORT_BY_PROVIDER = {
  codex: "high",
  claudeAgent: "high",
  gemini: null,
} as const satisfies Record<ProviderKind, ProviderReasoningEffort | null>;
