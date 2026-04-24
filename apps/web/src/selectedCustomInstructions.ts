/**
 * Per-thread selection of custom instruction IDs.
 *
 * Persists to localStorage so selections survive reloads. Library of
 * instructions themselves lives in ClientSettings (see customInstructions in
 * `@t3tools/contracts` settings).
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { normalizeSelectedCustomInstructionIds } from "~/customInstructions";

const STORAGE_KEY = "t3sparks:selected-custom-instructions:v1";

type Store = Record<string, readonly string[]>;

const listeners = new Set<() => void>();
let snapshot: Store = loadInitial();

function loadInitial(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Store = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      out[key] = normalizeSelectedCustomInstructionIds(value);
    }
    return out;
  } catch {
    return {};
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore quota/serialization errors
  }
}

function emit() {
  for (const l of listeners) l();
}

function getSnapshot(): Store {
  return snapshot;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getSelectedInstructionIds(threadKey: string): readonly string[] {
  return snapshot[threadKey] ?? [];
}

export function setSelectedInstructionIds(threadKey: string, ids: readonly string[]): void {
  const normalized = normalizeSelectedCustomInstructionIds(ids);
  const current = snapshot[threadKey] ?? [];
  if (
    current.length === normalized.length &&
    current.every((v, i) => v === normalized[i])
  ) {
    return;
  }
  if (normalized.length === 0) {
    const { [threadKey]: _removed, ...rest } = snapshot;
    snapshot = rest;
  } else {
    snapshot = { ...snapshot, [threadKey]: normalized };
  }
  persist();
  emit();
}

export function useSelectedInstructionIds(
  threadKey: string,
): {
  selectedIds: readonly string[];
  setSelectedIds: (ids: readonly string[]) => void;
} {
  const store = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const selectedIds = useMemo(() => store[threadKey] ?? [], [store, threadKey]);
  const setSelectedIds = useCallback(
    (ids: readonly string[]) => {
      setSelectedInstructionIds(threadKey, ids);
    },
    [threadKey],
  );
  return { selectedIds, setSelectedIds };
}

export function __resetSelectedInstructionsForTests(): void {
  snapshot = {};
  listeners.clear();
}
