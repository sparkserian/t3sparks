import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type ProjectId,
  ThreadId,
  type ProviderKind,
  type ServerConfig,
  type ServerProviderStatus,
} from "@t3sparks/contracts";
import { getModelOptions, normalizeModelSlug } from "@t3sparks/shared/model";
import { ZapIcon } from "lucide-react";

import {
  APP_SERVICE_TIER_OPTIONS,
  APP_TIMESTAMP_FORMAT_OPTIONS,
  type AppTimestampFormat,
  MAX_CUSTOM_MODEL_LENGTH,
  shouldShowFastTierIcon,
  useAppSettings,
} from "../appSettings";
import {
  getDesktopUpdateActionError,
  getDesktopUpdatePrimaryActionLabel,
  getDesktopUpdateSummary,
  isDesktopUpdateCheckActionDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowDesktopUpdateCheckAction,
} from "../components/desktopUpdate.logic";
import { deriveCopilotQuotaSummary } from "../components/copilotProviderStatus";
import { isElectron } from "../env";
import { useDesktopUpdate } from "../hooks/useDesktopUpdate";
import { useThreadActions } from "../hooks/useThreadActions";
import { useTheme } from "../hooks/useTheme";
import { createBackup, createBackupData, readBackupFile, restoreBackup } from "../lib/backup";
import { serverConfigQueryOptions, serverQueryKeys } from "../lib/serverReactQuery";
import {
  downloadSyncBackup,
  getSupabaseSession,
  isSupabaseSyncConfigured,
  listDeviceProjectBindings,
  onSupabaseAuthStateChange,
  signInWithSupabasePassword,
  signOutFromSupabase,
  signUpWithSupabasePassword,
  upsertDeviceProjectBinding,
  uploadSyncBackup,
} from "../lib/supabaseSync";
import {
  findMissingProviderStatuses,
  findProjectsNeedingBindings,
  inferProvidersRequiredBySnapshot,
} from "../lib/syncReadiness";
import { ensureNativeApi } from "../nativeApi";
import { requestOpenOnboarding } from "../onboarding";
import { useStore } from "../store";
import {
  getSyncProjectBindingsSnapshot,
  getSyncDeviceSnapshot,
  replaceSyncProjectBindingsSnapshot,
  useSyncDevice,
  useSyncProjectBindings,
} from "../syncDeviceState";
import { preferredTerminalEditor } from "../terminal-links";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { toastManager } from "../components/ui/toast";
import { SidebarInset } from "~/components/ui/sidebar";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
    description: "Match your OS appearance setting.",
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme.",
  },
] as const;

const MODEL_PROVIDER_SETTINGS: Array<{
  provider: ProviderKind;
  title: string;
  description: string;
  placeholder: string;
  example: string;
}> = [
  {
    provider: "codex",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
  {
    provider: "gemini",
    title: "Gemini",
    description: "Save additional Gemini model slugs for the picker and `/model` command.",
    placeholder: "your-gemini-model-slug",
    example: "gemini-3-pro-preview",
  },
  {
    provider: "githubCopilot",
    title: "GitHub Copilot",
    description: "Save additional Copilot model slugs for the picker and `/model` command.",
    placeholder: "claude-opus-4.6",
    example: "gpt-5.2-codex",
  },
] as const;

function getCustomModelsForProvider(
  settings: ReturnType<typeof useAppSettings>["settings"],
  provider: ProviderKind,
) {
  switch (provider) {
    case "codex":
      return settings.customCodexModels;
    case "gemini":
      return settings.customGeminiModels;
    case "githubCopilot":
      return settings.customGitHubCopilotModels;
    default:
      return settings.customCodexModels;
  }
}

function getDefaultCustomModelsForProvider(
  defaults: ReturnType<typeof useAppSettings>["defaults"],
  provider: ProviderKind,
) {
  switch (provider) {
    case "codex":
      return defaults.customCodexModels;
    case "gemini":
      return defaults.customGeminiModels;
    case "githubCopilot":
      return defaults.customGitHubCopilotModels;
    default:
      return defaults.customCodexModels;
  }
}

function patchCustomModels(provider: ProviderKind, models: string[]) {
  switch (provider) {
    case "codex":
      return { customCodexModels: models };
    case "gemini":
      return { customGeminiModels: models };
    case "githubCopilot":
      return { customGitHubCopilotModels: models };
    default:
      return { customCodexModels: models };
  }
}

function formatProviderStatusLabel(status: ServerProviderStatus["status"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "warning":
      return "Warning";
    case "error":
      return "Error";
  }
}

function formatProviderAuthStatusLabel(status: ServerProviderStatus["authStatus"]): string {
  switch (status) {
    case "authenticated":
      return "Authenticated";
    case "unauthenticated":
      return "Not authenticated";
    case "unknown":
      return "Unknown";
  }
}

function copilotStatusTone(status: ServerProviderStatus["status"]): string {
  switch (status) {
    case "ready":
      return "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-200";
    case "warning":
      return "border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-200";
    case "error":
      return "border-rose-500/30 bg-rose-500/8 text-rose-700 dark:text-rose-200";
  }
}

function replaceProviderStatus(
  config: ServerConfig | undefined,
  status: ServerProviderStatus,
): ServerConfig | undefined {
  if (!config) return config;
  const existingIndex = config.providers.findIndex((entry) => entry.provider === status.provider);
  const providers =
    existingIndex === -1
      ? [...config.providers, status]
      : config.providers.map((entry, index) => (index === existingIndex ? status : entry));
  return {
    ...config,
    providers,
  };
}

function SettingsRouteView() {
  const queryClient = useQueryClient();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { settings, defaults, updateSettings } = useAppSettings();
  const {
    state: desktopUpdateState,
    isSupported: isDesktopUpdateSupported,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  } = useDesktopUpdate();
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const [refreshedCopilotStatus, setRefreshedCopilotStatus] = useState<ServerProviderStatus | null>(
    null,
  );
  const [isCheckingCopilotHealth, setIsCheckingCopilotHealth] = useState(false);
  const [copilotHealthCheckError, setCopilotHealthCheckError] = useState<string | null>(null);
  const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false);
  const [openKeybindingsError, setOpenKeybindingsError] = useState<string | null>(null);
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({
    codex: "",
    claudeAgent: "",
    gemini: "",
    githubCopilot: "",
  });
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});

  const codexBinaryPath = settings.codexBinaryPath;
  const codexHomePath = settings.codexHomePath;
  const codexServiceTier = settings.codexServiceTier;
  const keybindingsConfigPath = serverConfigQuery.data?.keybindingsConfigPath ?? null;
  const copilotStatus =
    refreshedCopilotStatus ??
    serverConfigQuery.data?.providers.find((status) => status.provider === "githubCopilot") ??
    null;
  const copilotQuotaSummary = useMemo(
    () => deriveCopilotQuotaSummary(copilotStatus?.quotaSnapshots),
    [copilotStatus?.quotaSnapshots],
  );
  const copilotModelPreview = useMemo(
    () => copilotStatus?.models?.slice(0, 6) ?? [],
    [copilotStatus?.models],
  );
  const archivedThreadsByProject = useMemo(() => {
    const projectNameById = new Map(projects.map((project) => [project.id, project.name] as const));
    return threads
      .filter((thread) => thread.archivedAt !== null)
      .toSorted((left, right) => {
        const leftArchivedAt = left.archivedAt ?? left.createdAt;
        const rightArchivedAt = right.archivedAt ?? right.createdAt;
        return rightArchivedAt.localeCompare(leftArchivedAt) || right.id.localeCompare(left.id);
      })
      .reduce<
        Array<{
          projectId: string;
          projectName: string;
          threads: typeof threads;
        }>
      >((groups, thread) => {
        const existing = groups.find((group) => group.projectId === thread.projectId);
        if (existing) {
          existing.threads.push(thread);
          return groups;
        }
        groups.push({
          projectId: thread.projectId,
          projectName: projectNameById.get(thread.projectId) ?? "Unknown project",
          threads: [thread],
        });
        return groups;
      }, []);
  }, [projects, threads]);

  const openKeybindingsFile = useCallback(() => {
    if (!keybindingsConfigPath) return;
    setOpenKeybindingsError(null);
    setIsOpeningKeybindings(true);
    const api = ensureNativeApi();
    void api.shell
      .openInEditor(keybindingsConfigPath, preferredTerminalEditor())
      .catch((error) => {
        setOpenKeybindingsError(
          error instanceof Error ? error.message : "Unable to open keybindings file.",
        );
      })
      .finally(() => {
        setIsOpeningKeybindings(false);
      });
  }, [keybindingsConfigPath]);

  const runCopilotHealthCheck = useCallback(async () => {
    setIsCheckingCopilotHealth(true);
    setCopilotHealthCheckError(null);
    try {
      const api = ensureNativeApi();
      const status = await api.server.checkGitHubCopilotStatus();
      setRefreshedCopilotStatus(status);
      queryClient.setQueryData<ServerConfig | undefined>(serverQueryKeys.config(), (existing) =>
        replaceProviderStatus(existing, status),
      );
      if (status.status === "ready") {
        toastManager.add({
          type: "success",
          title: "GitHub Copilot health check passed",
          description: "SDK status and Copilot account metadata loaded successfully.",
        });
        return;
      }
      toastManager.add({
        type: status.status === "error" ? "error" : "warning",
        title: "GitHub Copilot health check finished",
        description: status.message ?? "GitHub Copilot returned a non-ready status.",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to run GitHub Copilot health check.";
      setCopilotHealthCheckError(message);
      toastManager.add({
        type: "error",
        title: "GitHub Copilot health check failed",
        description: message,
      });
    } finally {
      setIsCheckingCopilotHealth(false);
    }
  }, [queryClient]);

  const addCustomModel = useCallback((provider: ProviderKind) => {
    const customModelInput = customModelInputByProvider[provider];
    const customModels = getCustomModelsForProvider(settings, provider);
    const normalized = normalizeModelSlug(customModelInput, provider);
    const builtInModels = getModelOptions(provider);
    if (!normalized) {
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: "Enter a model slug.",
      }));
      return;
    }
    if (builtInModels.some((option) => option.slug === normalized)) {
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: "That model is already built in.",
      }));
      return;
    }
    if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
      }));
      return;
    }
    if (customModels.includes(normalized)) {
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: "That custom model is already saved.",
      }));
      return;
    }

    updateSettings(patchCustomModels(provider, [...customModels, normalized]));
    setCustomModelInputByProvider((existing) => ({
      ...existing,
      [provider]: "",
    }));
    setCustomModelErrorByProvider((existing) => ({
      ...existing,
      [provider]: null,
    }));
  }, [customModelInputByProvider, settings, updateSettings]);

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      updateSettings(patchCustomModels(provider, customModels.filter((model) => model !== slug)));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings, updateSettings],
  );

  const handleUnarchiveThread = useCallback(
    async (threadId: ThreadId) => {
      try {
        await unarchiveThread(threadId);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to unarchive thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [unarchiveThread],
  );

  const handleDeleteThread = useCallback(
    async (threadId: ThreadId) => {
      try {
        await confirmAndDeleteThread(threadId);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to delete thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [confirmAndDeleteThread],
  );

  const desktopUpdateSummary = desktopUpdateState
    ? getDesktopUpdateSummary(desktopUpdateState)
    : null;
  const desktopUpdatePrimaryAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const desktopUpdatePrimaryActionLabel = desktopUpdateState
    ? getDesktopUpdatePrimaryActionLabel(desktopUpdateState)
    : null;
  const showDesktopUpdateCheckAction = shouldShowDesktopUpdateCheckAction(desktopUpdateState);
  const desktopUpdateCheckActionDisabled = isDesktopUpdateCheckActionDisabled(desktopUpdateState);
  const desktopUpdateProgressPercent =
    typeof desktopUpdateState?.downloadPercent === "number"
      ? Math.max(2, Math.min(100, Math.floor(desktopUpdateState.downloadPercent)))
      : null;

  const handleCheckForUpdates = useCallback(async () => {
    const result = await checkForUpdates();
    if (!result) return;
    const actionError = getDesktopUpdateActionError(result);
    if (!actionError) return;
    toastManager.add({
      type: "error",
      title: "Could not check for updates",
      description: actionError,
    });
  }, [checkForUpdates]);

  const handleDesktopUpdatePrimaryAction = useCallback(async () => {
    if (!desktopUpdateState) return;

    if (desktopUpdatePrimaryAction === "download") {
      const result = await downloadUpdate();
      if (!result) return;
      if (result.completed) {
        toastManager.add({
          type: "success",
          title: "Update downloaded",
          description: "Restart the app to install the update.",
        });
      }
      const actionError = getDesktopUpdateActionError(result);
      if (!actionError) return;
      toastManager.add({
        type: "error",
        title: "Could not download update",
        description: actionError,
      });
      return;
    }

    if (desktopUpdatePrimaryAction === "install") {
      const result = await installUpdate();
      if (!result) return;
      const actionError = getDesktopUpdateActionError(result);
      if (!actionError) return;
      toastManager.add({
        type: "error",
        title: "Could not install update",
        description: actionError,
      });
    }
  }, [desktopUpdatePrimaryAction, desktopUpdateState, downloadUpdate, installUpdate]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Settings
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Configure app-level preferences for this device.
              </p>
            </header>

            {isElectron ? (
              <section className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-sm font-medium text-foreground">App Updates</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Published GitHub releases are checked automatically after launch and while the
                      app is running.
                    </p>
                  </div>
                  {desktopUpdateState ? (
                    <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                      Current version {desktopUpdateState.currentVersion}
                    </span>
                  ) : null}
                </div>

                {isDesktopUpdateSupported && desktopUpdateState && desktopUpdateSummary ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-border bg-background/60 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">
                            {desktopUpdateSummary.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {desktopUpdateSummary.description}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {desktopUpdateState.checkedAt
                            ? `Last checked ${formatRelativeTimeLabel(desktopUpdateState.checkedAt)}`
                            : "Not checked yet"}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-lg border border-border bg-card px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
                            Installed
                          </div>
                          <div className="mt-1 text-sm font-medium text-foreground">
                            {desktopUpdateState.currentVersion}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border bg-card px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
                            Newest found
                          </div>
                          <div className="mt-1 text-sm font-medium text-foreground">
                            {desktopUpdateState.downloadedVersion ??
                              desktopUpdateState.availableVersion ??
                              desktopUpdateState.currentVersion}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border bg-card px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
                            Status
                          </div>
                          <div className="mt-1 text-sm font-medium capitalize text-foreground">
                            {desktopUpdateState.status.replaceAll("-", " ")}
                          </div>
                        </div>
                      </div>

                      {desktopUpdateState.status === "downloading" ? (
                        <div className="mt-4 space-y-2">
                          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <span>Download progress</span>
                            <span>{desktopUpdateProgressPercent ?? 0}%</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-sky-500 transition-[width]"
                              style={{ width: `${desktopUpdateProgressPercent ?? 0}%` }}
                            />
                          </div>
                        </div>
                      ) : null}

                      {desktopUpdateState.message ? (
                        <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/8 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
                          {desktopUpdateState.message}
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {showDesktopUpdateCheckAction ? (
                          <Button
                            variant="outline"
                            onClick={() => {
                              void handleCheckForUpdates();
                            }}
                            disabled={desktopUpdateCheckActionDisabled}
                          >
                            {desktopUpdateCheckActionDisabled ? "Checking..." : "Check for updates"}
                          </Button>
                        ) : null}

                        {desktopUpdatePrimaryAction !== "none" && desktopUpdatePrimaryActionLabel ? (
                          <Button
                            onClick={() => {
                              void handleDesktopUpdatePrimaryAction();
                            }}
                            disabled={desktopUpdateState.status === "downloading"}
                          >
                            {desktopUpdatePrimaryActionLabel}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-background/60 p-4 text-xs text-muted-foreground">
                    Automatic updates are only available in packaged desktop builds.
                  </div>
                )}
              </section>
            ) : null}

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-medium text-foreground">Beginner Setup Guide</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Replay the first-run guide to pick a project home or revisit the beginner GitHub
                    walkthrough.
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Current project home:{" "}
                    <span className="font-medium text-foreground">
                      {settings.projectHomePath || "Not configured yet"}
                    </span>
                  </p>
                </div>
                <Button variant="outline" onClick={requestOpenOnboarding}>
                  Replay setup guide
                </Button>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Appearance</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose how T3 Sparks handles light and dark mode.
                </p>
              </div>

              <div className="space-y-2" role="radiogroup" aria-label="Theme preference">
                {THEME_OPTIONS.map((option) => {
                  const selected = theme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                        selected
                          ? "border-primary/60 bg-primary/8 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-accent"
                      }`}
                      onClick={() => setTheme(option.value)}
                    >
                      <span className="flex flex-col">
                        <span className="text-sm font-medium">{option.label}</span>
                        <span className="text-xs">{option.description}</span>
                      </span>
                      {selected ? (
                        <span className="rounded bg-primary/14 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                          Selected
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <p className="mt-4 text-xs text-muted-foreground">
                Active theme: <span className="font-medium text-foreground">{resolvedTheme}</span>
              </p>

              <div className="mt-4 space-y-1">
                <span className="text-xs font-medium text-foreground">Time format</span>
                <Select
                  items={APP_TIMESTAMP_FORMAT_OPTIONS.map((option) => ({
                    label: option.label,
                    value: option.value,
                  }))}
                    value={settings.timestampFormat}
                    onValueChange={(value) => {
                      if (!value) return;
                      updateSettings({ timestampFormat: value as AppTimestampFormat });
                    }}
                  >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {APP_TIMESTAMP_FORMAT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    Controls absolute timestamps in chat messages, plans, and diffs.
                  </span>
                  {settings.timestampFormat !== defaults.timestampFormat ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        updateSettings({
                          timestampFormat: defaults.timestampFormat,
                        })
                      }
                    >
                      Restore default
                    </Button>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Codex App Server</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  These overrides apply to new sessions and let you use a non-default Codex install.
                </p>
              </div>

              <div className="space-y-4">
                <label htmlFor="codex-binary-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Codex binary path</span>
                  <Input
                    id="codex-binary-path"
                    value={codexBinaryPath}
                    onChange={(event) => updateSettings({ codexBinaryPath: event.target.value })}
                    placeholder="codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Leave blank to use <code>codex</code> from your PATH.
                  </span>
                </label>

                <label htmlFor="codex-home-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">CODEX_HOME path</span>
                  <Input
                    id="codex-home-path"
                    value={codexHomePath}
                    onChange={(event) => updateSettings({ codexHomePath: event.target.value })}
                    placeholder="/Users/you/.codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Optional custom Codex home/config directory.
                  </span>
                </label>

                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <p>
                    Binary source:{" "}
                    <span className="font-medium text-foreground">{codexBinaryPath || "PATH"}</span>
                  </p>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        codexBinaryPath: defaults.codexBinaryPath,
                        codexHomePath: defaults.codexHomePath,
                      })
                    }
                  >
                    Reset codex overrides
                  </Button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-sm font-medium text-foreground">GitHub Copilot Health</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Runs the GitHub Copilot SDK startup check and shows what metadata was actually
                    confirmed for this machine and account.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    void runCopilotHealthCheck();
                  }}
                  disabled={isCheckingCopilotHealth}
                >
                  {isCheckingCopilotHealth ? "Checking..." : "Run health check"}
                </Button>
              </div>

              {copilotStatus ? (
                <div className="space-y-4">
                  <div className={`rounded-xl border px-4 py-3 ${copilotStatusTone(copilotStatus.status)}`}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">
                          {formatProviderStatusLabel(copilotStatus.status)}
                        </p>
                        <p className="mt-1 text-xs">
                          {copilotStatus.message ??
                            "No additional GitHub Copilot diagnostics were returned."}
                        </p>
                      </div>
                      <div className="text-xs">
                        Checked{" "}
                        <span className="font-medium text-foreground">
                          {formatRelativeTimeLabel(copilotStatus.checkedAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
                        Auth
                      </div>
                      <div className="mt-1 text-sm font-medium text-foreground">
                        {formatProviderAuthStatusLabel(copilotStatus.authStatus)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
                        Reachability
                      </div>
                      <div className="mt-1 text-sm font-medium text-foreground">
                        {copilotStatus.available ? "Reachable" : "Unavailable"}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
                        Models
                      </div>
                      <div className="mt-1 text-sm font-medium text-foreground">
                        {copilotStatus.models?.length ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
                        Quota buckets
                      </div>
                      <div className="mt-1 text-sm font-medium text-foreground">
                        {copilotStatus.quotaSnapshots?.length ?? 0}
                      </div>
                    </div>
                  </div>

                  {copilotQuotaSummary ? (
                    <div className="rounded-xl border border-border bg-background/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {copilotQuotaSummary.title}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {copilotQuotaSummary.detail}
                          </p>
                        </div>
                        <div className="text-sm font-medium text-foreground">
                          {Math.round(copilotQuotaSummary.remainingPercent)}%
                        </div>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-[width] ${
                            copilotQuotaSummary.progressTone === "danger"
                              ? "bg-rose-500"
                              : copilotQuotaSummary.progressTone === "warning"
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                          }`}
                          style={{ width: `${copilotQuotaSummary.remainingPercent}%` }}
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-border bg-background/50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">Discovered models</p>
                      <p className="text-xs text-muted-foreground">
                        {copilotStatus.models?.length
                          ? `Showing ${Math.min(copilotModelPreview.length, copilotStatus.models.length)} of ${copilotStatus.models.length}`
                          : "No SDK model list returned"}
                      </p>
                    </div>
                    {copilotModelPreview.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {copilotModelPreview.map((model) => (
                          <div
                            key={model.id}
                            className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground"
                            title={model.id}
                          >
                            {model.name}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-muted-foreground">
                        This check did not return an SDK model list. The picker will continue to
                        use the built-in Copilot fallback catalog.
                      </p>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    This health check verifies the GitHub Copilot SDK path. Copilot chat sessions
                    can still work through the ACP runtime even when the SDK startup check is slow
                    or incomplete.
                  </p>

                  {copilotHealthCheckError ? (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/8 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
                      {copilotHealthCheckError}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                  No GitHub Copilot health snapshot is available yet.
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Models</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Save additional provider model slugs so they appear in the chat model picker and
                  `/model` command suggestions.
                </p>
              </div>

              <div className="space-y-5">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Default service tier</span>
                  <Select
                    items={APP_SERVICE_TIER_OPTIONS.map((option) => ({
                      label: option.label,
                      value: option.value,
                    }))}
                    value={codexServiceTier}
                    onValueChange={(value) => {
                      if (!value) return;
                      updateSettings({ codexServiceTier: value });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      {APP_SERVICE_TIER_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <div className="flex min-w-0 items-center gap-2">
                            {option.value === "fast" ? (
                              <ZapIcon className="size-3.5 text-amber-500" />
                            ) : (
                              <span className="size-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="truncate">{option.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    {APP_SERVICE_TIER_OPTIONS.find((option) => option.value === codexServiceTier)
                      ?.description ?? "Use Codex defaults without forcing a service tier."}
                  </span>
                </label>

                {MODEL_PROVIDER_SETTINGS.map((providerSettings) => {
                  const provider = providerSettings.provider;
                  const customModels = getCustomModelsForProvider(settings, provider);
                  const customModelInput = customModelInputByProvider[provider];
                  const customModelError = customModelErrorByProvider[provider] ?? null;
                  return (
                    <div
                      key={provider}
                      className="rounded-xl border border-border bg-background/50 p-4"
                    >
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-foreground">
                          {providerSettings.title}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {providerSettings.description}
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <label
                            htmlFor={`custom-model-slug-${provider}`}
                            className="block flex-1 space-y-1"
                          >
                            <span className="text-xs font-medium text-foreground">
                              Custom model slug
                            </span>
                            <Input
                              id={`custom-model-slug-${provider}`}
                              value={customModelInput}
                              onChange={(event) => {
                                const value = event.target.value;
                                setCustomModelInputByProvider((existing) => ({
                                  ...existing,
                                  [provider]: value,
                                }));
                                if (customModelError) {
                                  setCustomModelErrorByProvider((existing) => ({
                                    ...existing,
                                    [provider]: null,
                                  }));
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                addCustomModel(provider);
                              }}
                              placeholder={providerSettings.placeholder}
                              spellCheck={false}
                            />
                            <span className="text-xs text-muted-foreground">
                              Example: <code>{providerSettings.example}</code>
                            </span>
                          </label>

                          <Button
                            className="sm:mt-6"
                            type="button"
                            onClick={() => addCustomModel(provider)}
                          >
                            Add model
                          </Button>
                        </div>

                        {customModelError ? (
                          <p className="text-xs text-destructive">{customModelError}</p>
                        ) : null}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <p>Saved custom models: {customModels.length}</p>
                            {customModels.length > 0 ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  updateSettings(
                                    patchCustomModels(
                                      provider,
                                      [...getDefaultCustomModelsForProvider(defaults, provider)],
                                    ),
                                  )
                                }
                              >
                                Reset custom models
                              </Button>
                            ) : null}
                          </div>

                          {customModels.length > 0 ? (
                            <div className="space-y-2">
                              {customModels.map((slug) => (
                                <div
                                  key={`${provider}:${slug}`}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-2">
                                    {provider === "codex" && shouldShowFastTierIcon(slug, codexServiceTier) ? (
                                      <ZapIcon className="size-3.5 shrink-0 text-amber-500" />
                                    ) : null}
                                    <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                                      {slug}
                                    </code>
                                  </div>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => removeCustomModel(provider, slug)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                              No custom models saved yet.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Responses</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Control how assistant output is rendered during a turn.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Stream assistant messages</p>
                  <p className="text-xs text-muted-foreground">
                    Show token-by-token output while a response is in progress.
                  </p>
                </div>
                <Switch
                  checked={settings.enableAssistantStreaming}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      enableAssistantStreaming: Boolean(checked),
                    })
                  }
                  aria-label="Stream assistant messages"
                />
              </div>

              {settings.enableAssistantStreaming !== defaults.enableAssistantStreaming ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        enableAssistantStreaming: defaults.enableAssistantStreaming,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}

              <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Context summary on model switch</p>
                  <p className="text-xs text-muted-foreground">
                    When you switch models mid-thread, automatically prepend a summary of the
                    conversation so the new model has full context.
                  </p>
                </div>
                <Switch
                  checked={settings.enableModelSwitchSummary}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      enableModelSwitchSummary: Boolean(checked),
                    })
                  }
                  aria-label="Context summary on model switch"
                />
              </div>

              {settings.enableModelSwitchSummary !== defaults.enableModelSwitchSummary ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        enableModelSwitchSummary: defaults.enableModelSwitchSummary,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Keybindings</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open the persisted <code>keybindings.json</code> file to edit advanced bindings
                  directly.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">Config file path</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {keybindingsConfigPath ?? "Resolving keybindings path..."}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!keybindingsConfigPath || isOpeningKeybindings}
                    onClick={openKeybindingsFile}
                  >
                    {isOpeningKeybindings ? "Opening..." : "Open keybindings.json"}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Opens in your preferred editor selection.
                </p>
                {openKeybindingsError ? (
                  <p className="text-xs text-destructive">{openKeybindingsError}</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Archived threads</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Restore archived threads to the sidebar or permanently delete them.
                </p>
              </div>

              {archivedThreadsByProject.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                  No archived threads yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {archivedThreadsByProject.map((group) => (
                    <div
                      key={group.projectId}
                      className="rounded-xl border border-border bg-background/50 p-4"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-medium text-foreground">{group.projectName}</h3>
                          <p className="text-xs text-muted-foreground">
                            {group.threads.length} archived thread{group.threads.length === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {group.threads.map((thread) => (
                          <div
                            key={thread.id}
                            className="flex flex-col gap-3 rounded-lg border border-border bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">
                                {thread.title}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Archived {formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => {
                                  void handleUnarchiveThread(thread.id);
                                }}
                              >
                                Unarchive
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                  void handleDeleteThread(thread.id);
                                }}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Safety</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Additional guardrails for destructive local actions.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Confirm thread deletion</p>
                  <p className="text-xs text-muted-foreground">
                    Ask for confirmation before deleting a thread and its chat history.
                  </p>
                </div>
                <Switch
                  checked={settings.confirmThreadDelete}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      confirmThreadDelete: Boolean(checked),
                    })
                  }
                  aria-label="Confirm thread deletion"
                />
              </div>

              {settings.confirmThreadDelete !== defaults.confirmThreadDelete ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        confirmThreadDelete: defaults.confirmThreadDelete,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <CloudSyncSection
              serverConfig={serverConfigQuery.data}
              projects={projects}
            />
            <BackupRestoreSection />
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

function BackupRestoreSection() {
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    setBackupStatus(null);
    try {
      await createBackup();
      setBackupStatus("Backup exported successfully.");
    } catch (err) {
      setBackupStatus(
        `Export failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setIsExporting(false);
    }
  }, []);

  const handleRestore = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    // Reset file input so the same file can be re-selected
    event.target.value = "";

    setIsRestoring(true);
    setRestoreStatus(null);
    try {
      const backup = await readBackupFile(file);
      const result = await restoreBackup(backup);

      const parts: string[] = [];
      if (result.projectsRestored > 0) {
        parts.push(`${result.projectsRestored} project(s) restored`);
      }
      if (result.threadsRestored > 0) {
        parts.push(`${result.threadsRestored} thread(s) restored`);
      }
      if (result.projectsSkipped > 0) {
        parts.push(`${result.projectsSkipped} project(s) skipped (already exist)`);
      }
      if (result.threadsSkipped > 0) {
        parts.push(`${result.threadsSkipped} thread(s) skipped (already exist)`);
      }
      if (result.localStorageRestored) {
        parts.push("settings restored");
      }

      setRestoreStatus(
        parts.length > 0
          ? `Restore complete: ${parts.join(", ")}. Reload to apply fully.`
          : "Nothing to restore (all items already exist).",
      );
    } catch (err) {
      setRestoreStatus(
        `Restore failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setIsRestoring(false);
    }
  }, []);

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-foreground">Data backup</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Export all your projects, threads, messages, and settings to a JSON file.
          Restore from a backup to replace the local app state with that snapshot.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
          <div>
            <p className="text-sm font-medium text-foreground">Export backup</p>
            <p className="text-xs text-muted-foreground">
              Download all projects, threads, conversation history, and settings as a JSON file.
            </p>
          </div>
          <Button
            size="xs"
            variant="outline"
            disabled={isExporting}
            onClick={handleExport}
          >
            {isExporting ? "Exporting..." : "Export"}
          </Button>
        </div>

        {backupStatus ? (
          <p className="text-xs text-muted-foreground">{backupStatus}</p>
        ) : null}

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
          <div>
            <p className="text-sm font-medium text-foreground">Restore from backup</p>
            <p className="text-xs text-muted-foreground">
              Replace the current local snapshot with a previously exported backup file.
              Reload after restore so every screen rehydrates from the imported state.
            </p>
          </div>
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleRestore}
              disabled={isRestoring}
            />
            <span className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-medium border border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 px-2">
              {isRestoring ? "Restoring..." : "Restore"}
            </span>
          </label>
        </div>

        {restoreStatus ? (
          <p className="text-xs text-muted-foreground">{restoreStatus}</p>
        ) : null}
      </div>
    </section>
  );
}

function CloudSyncSection({
  serverConfig,
  projects,
}: {
  serverConfig: ServerConfig | undefined;
  projects: ReadonlyArray<{ id: ProjectId; cwd: string; name: string }>;
}) {
  const queryClient = useQueryClient();
  const syncConfigured = isSupabaseSyncConfigured();
  const device = useSyncDevice();
  const { bindingsByProjectId, setProjectBinding } = useSyncProjectBindings();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [cloudBackup, setCloudBackup] = useState<Awaited<ReturnType<typeof downloadSyncBackup>>>(null);
  const [pathCheckStatus, setPathCheckStatus] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [isSyncingUp, setIsSyncingUp] = useState(false);
  const [isSyncingDown, setIsSyncingDown] = useState(false);
  const [isRefreshingCloudState, setIsRefreshingCloudState] = useState(false);
  const [isBindingProjectId, setIsBindingProjectId] = useState<ProjectId | null>(null);
  const [pathChecksByPath, setPathChecksByPath] = useState<Record<string, { exists: boolean; isDirectory: boolean }>>(
    {},
  );

  const refreshCloudState = useCallback(async () => {
    if (!syncConfigured) {
      setCloudBackup(null);
      setSessionEmail(null);
      return;
    }

    setIsRefreshingCloudState(true);
    setSyncStatus(null);
    try {
      const session = await getSupabaseSession();
      setSessionEmail(session?.user.email ?? null);
      if (!session) {
        setCloudBackup(null);
        return;
      }

      const [backup, remoteBindings] = await Promise.all([
        downloadSyncBackup(),
        listDeviceProjectBindings(device.deviceId),
      ]);
      const mergedBindings = {
        ...remoteBindings,
        ...getSyncProjectBindingsSnapshot(),
      };
      replaceSyncProjectBindingsSnapshot(mergedBindings);
      setCloudBackup(backup);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Failed to load cloud sync state.");
    } finally {
      setIsRefreshingCloudState(false);
    }
  }, [device.deviceId, syncConfigured]);

  useEffect(() => {
    if (!syncConfigured) {
      return;
    }
    const unsubscribe = onSupabaseAuthStateChange((session) => {
      setSessionEmail(session?.user.email ?? null);
    });
    void refreshCloudState();
    return unsubscribe;
  }, [refreshCloudState, syncConfigured]);

  useEffect(() => {
    if (!cloudBackup) {
      setPathChecksByPath({});
      setPathCheckStatus(null);
      return;
    }

    const api = ensureNativeApi();
    const targetPaths = Array.from(
      new Set(
        cloudBackup.serverSnapshot.projects.map((project) => bindingsByProjectId[project.id] ?? project.workspaceRoot),
      ),
    );
    let cancelled = false;

    void api.server
      .checkPaths({ paths: targetPaths })
      .then((result) => {
        if (cancelled) return;
        const nextPathChecksByPath: Record<string, { exists: boolean; isDirectory: boolean }> = {};
        for (const entry of result.paths) {
          nextPathChecksByPath[entry.path] = {
            exists: entry.exists,
            isDirectory: entry.isDirectory,
          };
        }
        setPathChecksByPath(nextPathChecksByPath);
      })
      .catch((error) => {
        if (cancelled) return;
        setPathCheckStatus(error instanceof Error ? error.message : "Failed to inspect local project paths.");
      });

    return () => {
      cancelled = true;
    };
  }, [bindingsByProjectId, cloudBackup]);

  const requiredProviders = useMemo(
    () => inferProvidersRequiredBySnapshot(cloudBackup?.serverSnapshot),
    [cloudBackup],
  );
  const missingProviders = useMemo(
    () => findMissingProviderStatuses(requiredProviders, serverConfig?.providers ?? []),
    [requiredProviders, serverConfig?.providers],
  );
  const projectsNeedingBindings = useMemo(
    () =>
      findProjectsNeedingBindings({
        snapshot: cloudBackup?.serverSnapshot,
        bindingsByProjectId,
        pathChecks: Object.entries(pathChecksByPath).map(([path, result]) => ({
          path,
          exists: result.exists,
          isDirectory: result.isDirectory,
        })),
      }),
    [bindingsByProjectId, cloudBackup, pathChecksByPath],
  );

  const handleSignIn = useCallback(async () => {
    setIsSigningIn(true);
    setAuthStatus(null);
    try {
      await signInWithSupabasePassword(email.trim(), password);
      setAuthStatus("Signed in.");
      await refreshCloudState();
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setIsSigningIn(false);
    }
  }, [email, password, refreshCloudState]);

  const handleSignUp = useCallback(async () => {
    setIsSigningUp(true);
    setAuthStatus(null);
    try {
      await signUpWithSupabasePassword(email.trim(), password);
      setAuthStatus("Sign-up request sent. Check your inbox if confirmation is enabled.");
      await refreshCloudState();
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Sign-up failed.");
    } finally {
      setIsSigningUp(false);
    }
  }, [email, password, refreshCloudState]);

  const handleSignOut = useCallback(async () => {
    setAuthStatus(null);
    try {
      await signOutFromSupabase();
      setCloudBackup(null);
      setSessionEmail(null);
      setAuthStatus("Signed out.");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Sign-out failed.");
    }
  }, []);

  const handleUpload = useCallback(async () => {
    setIsSyncingUp(true);
    setSyncStatus(null);
    try {
      const backup = await createBackupData();
      await uploadSyncBackup(backup);
      for (const project of projects) {
        await upsertDeviceProjectBinding({
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          projectId: project.id,
          workspaceRoot: bindingsByProjectId[project.id] ?? project.cwd,
        });
      }
      setCloudBackup(backup);
      setSyncStatus("Cloud sync uploaded successfully.");
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setIsSyncingUp(false);
    }
  }, [bindingsByProjectId, device.deviceId, device.deviceName, projects]);

  const handleDownload = useCallback(async () => {
    setIsSyncingDown(true);
    setSyncStatus(null);
    try {
      const backup = await downloadSyncBackup();
      if (!backup) {
        setSyncStatus("No cloud snapshot exists for this account yet.");
        return;
      }
      const result = await restoreBackup(backup, {
        projectBindingsByProjectId: bindingsByProjectId,
      });
      setCloudBackup(backup);
      await queryClient.invalidateQueries({ queryKey: serverQueryKeys.config() });
      setSyncStatus(
        `Cloud snapshot restored: ${result.projectsRestored} project(s), ${result.threadsRestored} thread(s). Reload the app to fully rehydrate the UI.`,
      );
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Download restore failed.");
    } finally {
      setIsSyncingDown(false);
    }
  }, [bindingsByProjectId, queryClient]);

  const handleBindProject = useCallback(
    async (projectId: ProjectId) => {
      setIsBindingProjectId(projectId);
      setPathCheckStatus(null);
      try {
        const api = ensureNativeApi();
        const selectedPath = await api.dialogs.pickFolder();
        if (!selectedPath) {
          return;
        }
        setProjectBinding(projectId, selectedPath);
        await upsertDeviceProjectBinding({
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          projectId,
          workspaceRoot: selectedPath,
        });
        const existingProject = projects.find((project) => project.id === projectId);
        if (existingProject) {
          await api.orchestration.dispatchCommand({
            type: "project.meta.update",
            commandId: crypto.randomUUID(),
            projectId,
            workspaceRoot: selectedPath,
          } as never);
        }
      } catch (error) {
        setPathCheckStatus(error instanceof Error ? error.message : "Failed to bind project folder.");
      } finally {
        setIsBindingProjectId(null);
      }
    },
    [device.deviceId, device.deviceName, projects, setProjectBinding],
  );

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-foreground">Cloud sync</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Sign in with Supabase to sync your snapshot across Mac and Windows, then bind local folders
          per device where the workspace paths differ.
        </p>
      </div>

      {!syncConfigured ? (
        <div className="rounded-lg border border-border bg-background px-3 py-3 text-xs text-muted-foreground">
          Supabase sync is not configured yet. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
          for the desktop/web app, then reopen Settings.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
            <Input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              type="email"
            />
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              type="password"
            />
            <Button size="xs" variant="outline" onClick={handleSignIn} disabled={isSigningIn}>
              {isSigningIn ? "Signing in..." : "Sign in"}
            </Button>
            <Button size="xs" variant="outline" onClick={handleSignUp} disabled={isSigningUp}>
              {isSigningUp ? "Signing up..." : "Sign up"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Device: {device.deviceName}</span>
            <span>Device ID: {device.deviceId}</span>
            <span>Account: {sessionEmail ?? "Not signed in"}</span>
            {sessionEmail ? (
              <Button size="xs" variant="outline" onClick={handleSignOut}>
                Sign out
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="outline"
              onClick={() => void refreshCloudState()}
              disabled={isRefreshingCloudState}
            >
              {isRefreshingCloudState ? "Refreshing..." : "Refresh"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="xs" variant="outline" onClick={handleUpload} disabled={!sessionEmail || isSyncingUp}>
              {isSyncingUp ? "Uploading..." : "Upload current state"}
            </Button>
            <Button size="xs" variant="outline" onClick={handleDownload} disabled={!sessionEmail || isSyncingDown}>
              {isSyncingDown ? "Restoring..." : "Restore cloud state"}
            </Button>
          </div>

          {authStatus ? <p className="text-xs text-muted-foreground">{authStatus}</p> : null}
          {syncStatus ? <p className="text-xs text-muted-foreground">{syncStatus}</p> : null}
          {pathCheckStatus ? <p className="text-xs text-muted-foreground">{pathCheckStatus}</p> : null}

          {cloudBackup ? (
            <div className="rounded-lg border border-border bg-background px-3 py-3">
              <p className="text-sm font-medium text-foreground">Latest cloud snapshot</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Exported {formatRelativeTimeLabel(cloudBackup.exportedAt)} with{" "}
                {cloudBackup.serverSnapshot.projects.length} project(s) and{" "}
                {cloudBackup.serverSnapshot.threads.length} thread(s).
              </p>
            </div>
          ) : null}

          {missingProviders.length > 0 ? (
            <div className="rounded-lg border border-border bg-background px-3 py-3">
              <p className="text-sm font-medium text-foreground">Providers to set up on this device</p>
              <div className="mt-2 space-y-2">
                {missingProviders.map((status) => (
                  <div key={status.provider} className="text-xs text-muted-foreground">
                    {status.provider}: {formatProviderStatusLabel(status.status)} /{" "}
                    {formatProviderAuthStatusLabel(status.authStatus)}
                    {status.message ? ` - ${status.message}` : ""}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {projectsNeedingBindings.length > 0 ? (
            <div className="rounded-lg border border-border bg-background px-3 py-3">
              <p className="text-sm font-medium text-foreground">Projects needing a local folder</p>
              <div className="mt-2 space-y-2">
                {projectsNeedingBindings.map((project) => (
                  <div
                    key={project.projectId}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground">{project.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        Remote path: {project.workspaceRoot}
                      </p>
                      {project.boundWorkspaceRoot ? (
                        <p className="truncate text-xs text-muted-foreground">
                          Bound here: {project.boundWorkspaceRoot}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => void handleBindProject(project.projectId)}
                      disabled={isBindingProjectId === project.projectId}
                    >
                      {isBindingProjectId === project.projectId ? "Choosing..." : "Choose folder"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});
