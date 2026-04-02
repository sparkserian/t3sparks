import { describe, expect, it } from "vitest";
import type { ProviderKind } from "@t3sparks/contracts";
import {
  getModelOptionsForProvider,
  normalizeActiveComposerProvider,
} from "./providerModelOptions";

const MODEL_OPTIONS_BY_PROVIDER = {
  codex: [{ slug: "gpt-5.4", name: "GPT-5.4" }],
  claudeAgent: [{ slug: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }],
  gemini: [{ slug: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }],
  githubCopilot: [{ slug: "copilot:claude-opus-4.6", name: "Claude Opus 4.6" }],
} satisfies Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>;

describe("normalizeActiveComposerProvider", () => {
  it("falls back to codex for unknown runtime values", () => {
    expect(normalizeActiveComposerProvider("claude" as ProviderKind)).toBe("codex");
  });

  it("keeps supported providers and remaps gemini to codex", () => {
    expect(normalizeActiveComposerProvider("codex")).toBe("codex");
    expect(normalizeActiveComposerProvider("claudeAgent")).toBe("claudeAgent");
    expect(normalizeActiveComposerProvider("githubCopilot")).toBe("githubCopilot");
    expect(normalizeActiveComposerProvider("gemini")).toBe("codex");
  });
});

describe("getModelOptionsForProvider", () => {
  it("returns codex options when the provider value is unknown", () => {
    expect(getModelOptionsForProvider(MODEL_OPTIONS_BY_PROVIDER, "claude" as ProviderKind)).toBe(
      MODEL_OPTIONS_BY_PROVIDER.codex,
    );
  });

  it("returns an empty list when the normalized provider options are missing", () => {
    const corruptedOptions = {
      ...MODEL_OPTIONS_BY_PROVIDER,
      codex: undefined,
    } as unknown as Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>;

    expect(getModelOptionsForProvider(corruptedOptions, "unknown-provider")).toEqual([]);
  });
});
