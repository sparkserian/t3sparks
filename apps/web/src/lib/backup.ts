/**
 * Backup & Restore utility for t3sparks threads and projects.
 *
 * Export: fetches the full server snapshot (all projects, threads with
 * messages, sessions, checkpoints) plus client-side localStorage state,
 * and saves it as a single JSON file.
 *
 * Restore: reads a backup file and dispatches commands to recreate any
 * missing projects and threads. Message history is included in the backup
 * for reference but full message-level replay requires a server-side
 * import endpoint (planned for v2).
 */

import type { OrchestrationReadModel } from "@t3sparks/contracts";
import { ensureNativeApi } from "../nativeApi";

const APP_SETTINGS_KEY = "t3sparks:app-settings:v1";
const COMPOSER_DRAFTS_KEY = "t3sparks:composer-drafts:v1";
const RENDERER_STATE_KEY = "t3sparks:renderer-state:v8";

export interface T3SparksBackup {
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

/**
 * Create a full backup of all projects, threads, messages, and settings.
 * Triggers a JSON file download in the browser.
 */
export async function createBackup(): Promise<void> {
  const api = ensureNativeApi();
  const serverSnapshot = await api.orchestration.getSnapshot();

  const backup: T3SparksBackup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    serverSnapshot,
    localStorage: {
      appSettings: safeParseLocalStorageItem(APP_SETTINGS_KEY),
      composerDrafts: safeParseLocalStorageItem(COMPOSER_DRAFTS_KEY),
      rendererState: safeParseLocalStorageItem(RENDERER_STATE_KEY),
    },
  };

  const dateStr = new Date().toISOString().slice(0, 10);
  const projectCount = serverSnapshot.projects?.length ?? 0;
  const threadCount = serverSnapshot.threads?.length ?? 0;
  downloadJson(
    backup,
    `t3sparks-backup-${dateStr}-${projectCount}p-${threadCount}t.json`,
  );
}

/**
 * Read a backup file and validate its structure.
 */
export async function readBackupFile(file: File): Promise<T3SparksBackup> {
  const text = await file.text();
  const parsed = JSON.parse(text);

  if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
    throw new Error(
      "Invalid backup file. Expected a t3sparks backup with version 1.",
    );
  }

  if (!parsed.serverSnapshot || typeof parsed.serverSnapshot !== "object") {
    throw new Error("Backup file is missing the server snapshot data.");
  }

  return parsed as T3SparksBackup;
}

export interface RestoreResult {
  projectsRestored: number;
  threadsRestored: number;
  projectsSkipped: number;
  threadsSkipped: number;
  localStorageRestored: boolean;
}

/**
 * Restore projects and threads from a backup file.
 *
 * - Projects/threads that already exist (by ID) are skipped.
 * - localStorage state (settings, drafts, expanded projects) is restored.
 * - Message history is NOT replayed (messages are in the backup for
 *   reference; a full message restore requires server-side support).
 * - After restore, the page should be reloaded to rehydrate stores.
 */
export async function restoreBackup(backup: T3SparksBackup): Promise<RestoreResult> {
  const api = ensureNativeApi();
  const currentSnapshot = await api.orchestration.getSnapshot();

  const existingProjectIds = new Set(
    (currentSnapshot.projects ?? []).map((p: { id: string }) => p.id),
  );
  const existingThreadIds = new Set(
    (currentSnapshot.threads ?? []).map((t: { id: string }) => t.id),
  );

  let projectsRestored = 0;
  let projectsSkipped = 0;
  let threadsRestored = 0;
  let threadsSkipped = 0;

  // Restore projects
  for (const project of backup.serverSnapshot.projects ?? []) {
    if (existingProjectIds.has(project.id)) {
      projectsSkipped++;
      continue;
    }
    try {
      await api.orchestration.dispatchCommand({
        type: "project.create",
        commandId: crypto.randomUUID(),
        projectId: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        defaultModel: project.defaultModel ?? undefined,
        createdAt: project.createdAt,
      } as any);
      projectsRestored++;
    } catch {
      projectsSkipped++;
    }
  }

  // Restore threads (structure only, not message history)
  for (const thread of backup.serverSnapshot.threads ?? []) {
    if (existingThreadIds.has(thread.id)) {
      threadsSkipped++;
      continue;
    }
    // Ensure the project exists
    if (!existingProjectIds.has(thread.projectId) && projectsRestored === 0) {
      threadsSkipped++;
      continue;
    }
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.create",
        commandId: crypto.randomUUID(),
        threadId: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        model: thread.model,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        createdAt: thread.createdAt,
      } as any);
      threadsRestored++;
    } catch {
      threadsSkipped++;
    }
  }

  // Restore localStorage state
  let localStorageRestored = false;
  try {
    if (backup.localStorage.appSettings) {
      window.localStorage.setItem(
        APP_SETTINGS_KEY,
        JSON.stringify(backup.localStorage.appSettings),
      );
      localStorageRestored = true;
    }
    if (backup.localStorage.composerDrafts) {
      window.localStorage.setItem(
        COMPOSER_DRAFTS_KEY,
        JSON.stringify(backup.localStorage.composerDrafts),
      );
      localStorageRestored = true;
    }
    if (backup.localStorage.rendererState) {
      window.localStorage.setItem(
        RENDERER_STATE_KEY,
        JSON.stringify(backup.localStorage.rendererState),
      );
      localStorageRestored = true;
    }
  } catch {
    // Ignore storage write failures
  }

  return {
    projectsRestored,
    threadsRestored,
    projectsSkipped,
    threadsSkipped,
    localStorageRestored,
  };
}
