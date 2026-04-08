import { useCallback, useSyncExternalStore } from "react";
import { Option, Schema } from "effect";
import {
  CustomInstruction,
  type ProviderKind,
  type ProviderServiceTier,
} from "@t3sparks/contracts";
import { getDefaultModel, getModelOptions, normalizeModelSlug } from "@t3sparks/shared/model";
import { normalizeCustomInstructions } from "./customInstructions";

export const APP_SETTINGS_STORAGE_KEY = "t3sparks:app-settings:v1";
const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;
const MAX_PROJECT_HOME_PATH_LENGTH = 4096;
export const APP_SERVICE_TIER_OPTIONS = [
  {
    value: "auto",
    label: "Automatic",
    description: "Use Codex defaults without forcing a service tier.",
  },
  {
    value: "fast",
    label: "Fast",
    description: "Request the fast service tier when the model supports it.",
  },
  {
    value: "flex",
    label: "Flex",
    description: "Request the flex service tier when the model supports it.",
  },
] as const;
export type AppServiceTier = (typeof APP_SERVICE_TIER_OPTIONS)[number]["value"];
export const APP_TIMESTAMP_FORMAT_OPTIONS = [
  { value: "locale", label: "System default" },
  { value: "12-hour", label: "12-hour" },
  { value: "24-hour", label: "24-hour" },
] as const;
export type AppTimestampFormat = (typeof APP_TIMESTAMP_FORMAT_OPTIONS)[number]["value"];
const AppServiceTierSchema = Schema.Literals(["auto", "fast", "flex"]);
const AppTimestampFormatSchema = Schema.Literals(["locale", "12-hour", "24-hour"]);
const AppSpeechToTextModeSchema = Schema.Literals([
  "disabled",
  "local",
  "together",
  "elevenlabs",
]);
export type AppSpeechToTextMode = typeof AppSpeechToTextModeSchema.Type;
const MODELS_WITH_FAST_SUPPORT = new Set(["gpt-5.4"]);
const BUILT_IN_MODEL_SLUGS_BY_PROVIDER: Record<ProviderKind, ReadonlySet<string>> = {
  codex: new Set(getModelOptions("codex").map((option) => option.slug)),
  claudeAgent: new Set(getModelOptions("claudeAgent").map((option) => option.slug)),
  gemini: new Set(getModelOptions("gemini").map((option) => option.slug)),
  githubCopilot: new Set(getModelOptions("githubCopilot").map((option) => option.slug)),
};

const AppSettingsSchema = Schema.Struct({
  codexBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  codexHomePath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withConstructorDefault(() => Option.some(true))),
  enableAssistantStreaming: Schema.Boolean.pipe(
    Schema.withConstructorDefault(() => Option.some(false)),
  ),
  codexServiceTier: AppServiceTierSchema.pipe(Schema.withConstructorDefault(() => Option.some("auto"))),
  timestampFormat: AppTimestampFormatSchema.pipe(
    Schema.withConstructorDefault(() => Option.some("locale")),
  ),
  customCodexModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customGeminiModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customGitHubCopilotModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customInstructions: Schema.Array(CustomInstruction).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  projectHomePath: Schema.String.check(Schema.isMaxLength(MAX_PROJECT_HOME_PATH_LENGTH)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  hasSeenOnboarding: Schema.Boolean.pipe(
    Schema.withConstructorDefault(() => Option.some(false)),
  ),
  enableModelSwitchSummary: Schema.Boolean.pipe(
    Schema.withConstructorDefault(() => Option.some(true)),
  ),
  speechToTextMode: AppSpeechToTextModeSchema.pipe(
    Schema.withConstructorDefault(() => Option.some("disabled")),
  ),
  speechToTextLocalModel: Schema.String.check(Schema.isMaxLength(256)).pipe(
    Schema.withConstructorDefault(() => Option.some("onnx-community/whisper-tiny.en")),
  ),
  speechToTextTogetherApiKey: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  speechToTextTogetherModel: Schema.String.check(Schema.isMaxLength(256)).pipe(
    Schema.withConstructorDefault(() => Option.some("openai/whisper-large-v3")),
  ),
  speechToTextElevenLabsApiKey: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  speechToTextElevenLabsModel: Schema.String.check(Schema.isMaxLength(256)).pipe(
    Schema.withConstructorDefault(() => Option.some("scribe_v2")),
  ),
  speechToTextLanguage: Schema.String.check(Schema.isMaxLength(16)).pipe(
    Schema.withConstructorDefault(() => Option.some("auto")),
  ),
});
export type AppSettings = typeof AppSettingsSchema.Type;
export interface AppModelOption {
  slug: string;
  name: string;
  isCustom: boolean;
}

type AdditionalModelOption = Pick<AppModelOption, "slug" | "name">;

export function resolveAppServiceTier(serviceTier: AppServiceTier): ProviderServiceTier | null {
  return serviceTier === "auto" ? null : serviceTier;
}

export function shouldShowFastTierIcon(
  model: string | null | undefined,
  serviceTier: AppServiceTier,
): boolean {
  const normalizedModel = normalizeModelSlug(model);
  return (
    resolveAppServiceTier(serviceTier) === "fast" &&
    normalizedModel !== null &&
    MODELS_WITH_FAST_SUPPORT.has(normalizedModel)
  );
}

const DEFAULT_APP_SETTINGS = AppSettingsSchema.makeUnsafe({});

let listeners: Array<() => void> = [];
let cachedRawSettings: string | null | undefined;
let cachedSnapshot: AppSettings = DEFAULT_APP_SETTINGS;

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  provider: ProviderKind = "codex",
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();
  const builtInModelSlugs = BUILT_IN_MODEL_SLUGS_BY_PROVIDER[provider];

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

function normalizeAppSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    customCodexModels: normalizeCustomModelSlugs(settings.customCodexModels, "codex"),
    customGeminiModels: normalizeCustomModelSlugs(settings.customGeminiModels, "gemini"),
    customGitHubCopilotModels: normalizeCustomModelSlugs(
      settings.customGitHubCopilotModels,
      "githubCopilot",
    ),
    customInstructions: normalizeCustomInstructions(settings.customInstructions),
  };
}

export function getAppModelOptions(
  provider: ProviderKind,
  customModels: readonly string[],
  selectedModel?: string | null,
  additionalOptions: readonly AdditionalModelOption[] = [],
): AppModelOption[] {
  const options: AppModelOption[] = [];
  const seen = new Set<string>();
  const appendBuiltInOption = (option: AdditionalModelOption) => {
    if (seen.has(option.slug)) {
      return;
    }
    seen.add(option.slug);
    options.push({
      slug: option.slug,
      name: option.name,
      isCustom: false,
    });
  };

  for (const option of getModelOptions(provider)) {
    appendBuiltInOption(option);
  }

  for (const option of additionalOptions) {
    const normalizedSlug = normalizeModelSlug(option.slug, provider);
    const name = option.name.trim();
    if (!normalizedSlug || !name) {
      continue;
    }
    appendBuiltInOption({ slug: normalizedSlug, name });
  }

  for (const slug of normalizeCustomModelSlugs(customModels, provider)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({
      slug,
      name: slug,
      isCustom: true,
    });
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  if (normalizedSelectedModel && !seen.has(normalizedSelectedModel)) {
    options.push({
      slug: normalizedSelectedModel,
      name: normalizedSelectedModel,
      isCustom: true,
    });
  }

  return options;
}

export function resolveAppModelSelection(
  provider: ProviderKind,
  customModels: readonly string[],
  selectedModel: string | null | undefined,
  additionalOptions: readonly AdditionalModelOption[] = [],
): string {
  const options = getAppModelOptions(provider, customModels, selectedModel, additionalOptions);
  const trimmedSelectedModel = selectedModel?.trim();
  if (trimmedSelectedModel) {
    const direct = options.find((option) => option.slug === trimmedSelectedModel);
    if (direct) {
      return direct.slug;
    }

    const byName = options.find(
      (option) => option.name.toLowerCase() === trimmedSelectedModel.toLowerCase(),
    );
    if (byName) {
      return byName.slug;
    }
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  if (!normalizedSelectedModel) {
    return getDefaultModel(provider);
  }

  return (
    options.find((option) => option.slug === normalizedSelectedModel)?.slug ??
    getDefaultModel(provider)
  );
}

export function getSlashModelOptions(
  provider: ProviderKind,
  customModels: readonly string[],
  query: string,
  selectedModel?: string | null,
  additionalOptions: readonly AdditionalModelOption[] = [],
): AppModelOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  const options = getAppModelOptions(provider, customModels, selectedModel, additionalOptions);
  if (!normalizedQuery) {
    return options;
  }

  return options.filter((option) => {
    const searchSlug = option.slug.toLowerCase();
    const searchName = option.name.toLowerCase();
    return searchSlug.includes(normalizedQuery) || searchName.includes(normalizedQuery);
  });
}

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function parsePersistedSettings(value: string | null): AppSettings {
  if (!value) {
    return DEFAULT_APP_SETTINGS;
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return DEFAULT_APP_SETTINGS;
    }
    return normalizeAppSettings(
      Schema.decodeSync(AppSettingsSchema)({
        ...DEFAULT_APP_SETTINGS,
        ...parsed,
        customInstructions: normalizeCustomInstructions(
          Array.isArray((parsed as { customInstructions?: unknown }).customInstructions)
            ? (parsed as { customInstructions: unknown[] }).customInstructions
            : [],
        ),
      }),
    );
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function getAppSettingsSnapshot(): AppSettings {
  if (typeof window === "undefined") {
    return DEFAULT_APP_SETTINGS;
  }

  const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
  if (raw === cachedRawSettings) {
    return cachedSnapshot;
  }

  cachedRawSettings = raw;
  cachedSnapshot = parsePersistedSettings(raw);
  return cachedSnapshot;
}

function persistSettings(next: AppSettings): void {
  if (typeof window === "undefined") return;

  const raw = JSON.stringify(next);
  try {
    if (raw !== cachedRawSettings) {
      window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, raw);
    }
  } catch {
    // Best-effort persistence only.
  }

  cachedRawSettings = raw;
  cachedSnapshot = next;
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key === APP_SETTINGS_STORAGE_KEY) {
      emitChange();
    }
  };

  window.addEventListener("storage", onStorage);
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useAppSettings() {
  const settings = useSyncExternalStore(
    subscribe,
    getAppSettingsSnapshot,
    () => DEFAULT_APP_SETTINGS,
  );

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    const next = normalizeAppSettings(
      Schema.decodeSync(AppSettingsSchema)({
        ...getAppSettingsSnapshot(),
        ...patch,
      }),
    );
    persistSettings(next);
    emitChange();
  }, []);

  const resetSettings = useCallback(() => {
    persistSettings(DEFAULT_APP_SETTINGS);
    emitChange();
  }, []);

  return {
    settings,
    updateSettings,
    resetSettings,
    defaults: DEFAULT_APP_SETTINGS,
  } as const;
}
