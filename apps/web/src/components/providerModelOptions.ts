import type { ProviderKind } from "@t3sparks/contracts";
import { getAppModelOptions } from "../appSettings";

const EMPTY_MODEL_OPTIONS: ReadonlyArray<{ slug: string; name: string }> = [];

export function getCustomModelOptionsByProvider(settings: {
  customCodexModels: readonly string[];
  customGeminiModels: readonly string[];
}): Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>> {
  return {
    codex: getAppModelOptions("codex", settings.customCodexModels),
    claudeAgent: getAppModelOptions("claudeAgent", []),
    gemini: getAppModelOptions("gemini", settings.customGeminiModels),
  };
}

export function normalizeActiveComposerProvider(
  provider: string | null | undefined,
): ProviderKind {
  switch (provider) {
    case "gemini":
      return "codex";
    case "codex":
    case "claudeAgent":
      return provider;
    default:
      return "codex";
  }
}

export function getModelOptionsForProvider(
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>,
  provider: string | null | undefined,
): ReadonlyArray<{ slug: string; name: string }> {
  return modelOptionsByProvider[normalizeActiveComposerProvider(provider)] ?? EMPTY_MODEL_OPTIONS;
}
