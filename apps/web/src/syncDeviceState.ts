import { useCallback, useSyncExternalStore } from "react";

import { ProjectId } from "@t3sparks/contracts";

const SYNC_DEVICE_STORAGE_KEY = "t3sparks:sync-device:v1";
const SYNC_PROJECT_BINDINGS_STORAGE_KEY = "t3sparks:sync-project-bindings:v1";

interface SyncDeviceState {
  readonly deviceId: string;
  readonly deviceName: string;
}

interface SyncProjectBindingsState {
  readonly bindingsByProjectId: Record<ProjectId, string>;
}

const EMPTY_BINDINGS_STATE: SyncProjectBindingsState = {
  bindingsByProjectId: {},
};

let listeners: Array<() => void> = [];
let cachedDeviceState: SyncDeviceState | null = null;
let cachedBindingsRaw: string | null | undefined;
let cachedBindingsState: SyncProjectBindingsState = EMPTY_BINDINGS_STATE;

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function defaultDeviceName(): string {
  const platform = typeof navigator === "undefined" ? "Desktop" : navigator.platform || "Desktop";
  if (/win/i.test(platform)) return "Windows device";
  if (/mac/i.test(platform)) return "Mac device";
  if (/linux/i.test(platform)) return "Linux device";
  return "Desktop device";
}

function readPersistedDeviceState(): SyncDeviceState {
  if (typeof window === "undefined") {
    return {
      deviceId: "server-render",
      deviceName: "Desktop device",
    };
  }

  if (cachedDeviceState) {
    return cachedDeviceState;
  }

  try {
    const raw = window.localStorage.getItem(SYNC_DEVICE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SyncDeviceState>;
      if (typeof parsed.deviceId === "string" && parsed.deviceId.length > 0) {
        cachedDeviceState = {
          deviceId: parsed.deviceId,
          deviceName:
            typeof parsed.deviceName === "string" && parsed.deviceName.trim().length > 0
              ? parsed.deviceName.trim()
              : defaultDeviceName(),
        };
        return cachedDeviceState;
      }
    }
  } catch {
    // Fall through to regeneration.
  }

  cachedDeviceState = {
    deviceId: crypto.randomUUID(),
    deviceName: defaultDeviceName(),
  };

  try {
    window.localStorage.setItem(SYNC_DEVICE_STORAGE_KEY, JSON.stringify(cachedDeviceState));
  } catch {
    // Ignore local storage write failures.
  }

  return cachedDeviceState;
}

function parseProjectBindings(raw: string | null): SyncProjectBindingsState {
  if (!raw) {
    return EMPTY_BINDINGS_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as { bindingsByProjectId?: unknown };
    if (!parsed.bindingsByProjectId || typeof parsed.bindingsByProjectId !== "object") {
      return EMPTY_BINDINGS_STATE;
    }

    const bindingsByProjectId: Record<ProjectId, string> = {} as Record<ProjectId, string>;
    for (const [projectId, workspaceRoot] of Object.entries(parsed.bindingsByProjectId)) {
      if (
        typeof projectId === "string" &&
        projectId.length > 0 &&
        typeof workspaceRoot === "string" &&
        workspaceRoot.trim().length > 0
      ) {
        bindingsByProjectId[projectId as ProjectId] = workspaceRoot.trim();
      }
    }

    return { bindingsByProjectId };
  } catch {
    return EMPTY_BINDINGS_STATE;
  }
}

function readProjectBindingsState(): SyncProjectBindingsState {
  if (typeof window === "undefined") {
    return EMPTY_BINDINGS_STATE;
  }

  try {
    const raw = window.localStorage.getItem(SYNC_PROJECT_BINDINGS_STORAGE_KEY);
    if (raw === cachedBindingsRaw) {
      return cachedBindingsState;
    }
    cachedBindingsRaw = raw;
    cachedBindingsState = parseProjectBindings(raw);
    return cachedBindingsState;
  } catch {
    return EMPTY_BINDINGS_STATE;
  }
}

function writeProjectBindingsState(nextState: SyncProjectBindingsState): void {
  if (typeof window === "undefined") return;
  try {
    const raw = JSON.stringify(nextState);
    window.localStorage.setItem(SYNC_PROJECT_BINDINGS_STORAGE_KEY, raw);
    cachedBindingsRaw = raw;
    cachedBindingsState = nextState;
    emitChange();
  } catch {
    // Ignore local storage write failures.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

export function getSyncDeviceSnapshot(): SyncDeviceState {
  return readPersistedDeviceState();
}

export function useSyncDevice() {
  return useSyncExternalStore(subscribe, readPersistedDeviceState, readPersistedDeviceState);
}

export function useSyncProjectBindings() {
  const snapshot = useSyncExternalStore(subscribe, readProjectBindingsState, readProjectBindingsState);
  const setProjectBinding = useCallback((projectId: ProjectId, workspaceRoot: string) => {
    const trimmedWorkspaceRoot = workspaceRoot.trim();
    if (trimmedWorkspaceRoot.length === 0) {
      return;
    }
    writeProjectBindingsState({
      bindingsByProjectId: {
        ...readProjectBindingsState().bindingsByProjectId,
        [projectId]: trimmedWorkspaceRoot,
      },
    });
  }, []);
  const removeProjectBinding = useCallback((projectId: ProjectId) => {
    const current = readProjectBindingsState().bindingsByProjectId;
    if (!(projectId in current)) {
      return;
    }
    const nextBindings = { ...current };
    delete nextBindings[projectId];
    writeProjectBindingsState({ bindingsByProjectId: nextBindings });
  }, []);

  return {
    bindingsByProjectId: snapshot.bindingsByProjectId,
    setProjectBinding,
    removeProjectBinding,
  } as const;
}

export function getSyncProjectBindingsSnapshot(): Record<ProjectId, string> {
  return { ...readProjectBindingsState().bindingsByProjectId };
}

export function replaceSyncProjectBindingsSnapshot(
  bindingsByProjectId: Partial<Record<ProjectId, string>>,
): void {
  const nextBindings: Record<ProjectId, string> = {} as Record<ProjectId, string>;
  for (const [projectId, workspaceRoot] of Object.entries(bindingsByProjectId)) {
    if (typeof workspaceRoot === "string" && workspaceRoot.trim().length > 0) {
      nextBindings[projectId as ProjectId] = workspaceRoot.trim();
    }
  }
  writeProjectBindingsState({ bindingsByProjectId: nextBindings });
}
