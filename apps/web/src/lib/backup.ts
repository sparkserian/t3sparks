import type { OrchestrationReadModel, ProjectId } from "@t3sparks/contracts";

import { APP_SETTINGS_STORAGE_KEY } from "../appSettings";
import { COMPOSER_DRAFT_STORAGE_KEY } from "../composerDraftStore";
import { THEME_STORAGE_KEY } from "../hooks/useTheme";
import { ensureNativeApi } from "../nativeApi";
import { PROJECT_NOTES_STORAGE_KEY } from "../projectNotes";
import { PERSISTED_STATE_KEY } from "../store";
import { TERMINAL_STATE_STORAGE_KEY } from "../terminalStateStore";

const LEGACY_RENDERER_STATE_KEY = "t3sparks:renderer-state:v8";

type BackupLocalStorageState = {
  appSettings: unknown | null;
  composerDrafts: unknown | null;
  rendererState: unknown | null;
  projectNotes: unknown | null;
  terminalState: unknown | null;
  theme: unknown | null;
};

export interface T3SparksBackup {
  version: 2;
  exportedAt: string;
  serverSnapshot: OrchestrationReadModel;
  localStorage: BackupLocalStorageState;
}

interface LegacyT3SparksBackupV1 {
  version: 1;
  exportedAt: string;
  serverSnapshot: OrchestrationReadModel;
  localStorage: {
    appSettings: unknown | null;
    composerDrafts: unknown | null;
    rendererState: unknown | null;
  };
}

function safeParseLocalStorageItem(key: string): unknown | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readThemeStorageValue(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function downloadJson(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function normalizeBackup(parsed: unknown): T3SparksBackup {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid backup file.");
  }

  const maybeVersion = "version" in parsed ? parsed.version : null;
  if (maybeVersion === 2) {
    const candidate = parsed as Partial<T3SparksBackup>;
    if (!candidate.serverSnapshot || typeof candidate.serverSnapshot !== "object") {
      throw new Error("Backup file is missing the server snapshot data.");
    }
    return {
      version: 2,
      exportedAt:
        typeof candidate.exportedAt === "string" ? candidate.exportedAt : new Date().toISOString(),
      serverSnapshot: candidate.serverSnapshot,
      localStorage: {
        appSettings: candidate.localStorage?.appSettings ?? null,
        composerDrafts: candidate.localStorage?.composerDrafts ?? null,
        rendererState: candidate.localStorage?.rendererState ?? null,
        projectNotes: candidate.localStorage?.projectNotes ?? null,
        terminalState: candidate.localStorage?.terminalState ?? null,
        theme: candidate.localStorage?.theme ?? null,
      },
    };
  }

  if (maybeVersion === 1) {
    const legacy = parsed as LegacyT3SparksBackupV1;
    if (!legacy.serverSnapshot || typeof legacy.serverSnapshot !== "object") {
      throw new Error("Backup file is missing the server snapshot data.");
    }
    return {
      version: 2,
      exportedAt: legacy.exportedAt,
      serverSnapshot: legacy.serverSnapshot,
      localStorage: {
        appSettings: legacy.localStorage?.appSettings ?? null,
        composerDrafts: legacy.localStorage?.composerDrafts ?? null,
        rendererState: legacy.localStorage?.rendererState ?? null,
        projectNotes: null,
        terminalState: null,
        theme: null,
      },
    };
  }

  throw new Error("Invalid backup file. Expected a t3sparks backup with version 1 or 2.");
}

export async function createBackupData(): Promise<T3SparksBackup> {
  const api = ensureNativeApi();
  const serverSnapshot = await api.orchestration.getSnapshot();
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    serverSnapshot,
    localStorage: {
      appSettings: safeParseLocalStorageItem(APP_SETTINGS_STORAGE_KEY),
      composerDrafts: safeParseLocalStorageItem(COMPOSER_DRAFT_STORAGE_KEY),
      rendererState: safeParseLocalStorageItem(PERSISTED_STATE_KEY ?? LEGACY_RENDERER_STATE_KEY),
      projectNotes: safeParseLocalStorageItem(PROJECT_NOTES_STORAGE_KEY),
      terminalState: safeParseLocalStorageItem(TERMINAL_STATE_STORAGE_KEY),
      theme: readThemeStorageValue(),
    },
  };
}

export async function createBackup(): Promise<void> {
  const backup = await createBackupData();
  const dateStr = new Date().toISOString().slice(0, 10);
  const projectCount = backup.serverSnapshot.projects?.length ?? 0;
  const threadCount = backup.serverSnapshot.threads?.length ?? 0;
  downloadJson(backup, `t3sparks-backup-${dateStr}-${projectCount}p-${threadCount}t.json`);
}

export async function readBackupFile(file: File): Promise<T3SparksBackup> {
  const text = await file.text();
  return normalizeBackup(JSON.parse(text));
}

export interface RestoreResult {
  projectsRestored: number;
  threadsRestored: number;
  projectsSkipped: number;
  threadsSkipped: number;
  localStorageRestored: boolean;
}

export interface RestoreBackupOptions {
  readonly projectBindingsByProjectId?: Partial<Record<ProjectId, string>>;
}

export async function restoreBackup(
  backup: T3SparksBackup,
  options?: RestoreBackupOptions,
): Promise<RestoreResult> {
  const api = ensureNativeApi();
  const projectBindings = Object.entries(options?.projectBindingsByProjectId ?? {}).flatMap(
    ([projectId, workspaceRoot]) =>
      typeof workspaceRoot === "string" && workspaceRoot.trim().length > 0
        ? [{ projectId: projectId as ProjectId, workspaceRoot: workspaceRoot.trim() }]
        : [],
  );

  const importResult = await api.server.importSnapshot({
    snapshot: backup.serverSnapshot,
    ...(projectBindings.length > 0 ? { projectBindings } : {}),
  });

  let localStorageRestored = false;
  const storageWrites: Array<[string, unknown | null]> = [
    [APP_SETTINGS_STORAGE_KEY, backup.localStorage.appSettings],
    [COMPOSER_DRAFT_STORAGE_KEY, backup.localStorage.composerDrafts],
    [PERSISTED_STATE_KEY, backup.localStorage.rendererState],
    [PROJECT_NOTES_STORAGE_KEY, backup.localStorage.projectNotes],
    [TERMINAL_STATE_STORAGE_KEY, backup.localStorage.terminalState],
  ];

  try {
    for (const [key, value] of storageWrites) {
      if (value === null || value === undefined) {
        continue;
      }
      window.localStorage.setItem(key, JSON.stringify(value));
      localStorageRestored = true;
    }
    if (typeof backup.localStorage.theme === "string" && backup.localStorage.theme.length > 0) {
      window.localStorage.setItem(THEME_STORAGE_KEY, backup.localStorage.theme);
      localStorageRestored = true;
    }
  } catch {
    // Ignore storage write failures.
  }

  return {
    projectsRestored: importResult.importedProjectCount,
    threadsRestored: importResult.importedThreadCount,
    projectsSkipped: 0,
    threadsSkipped: 0,
    localStorageRestored,
  };
}
