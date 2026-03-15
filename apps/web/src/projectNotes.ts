import { useSyncExternalStore } from "react";

export const PROJECT_NOTES_STORAGE_KEY = "t3code:project-notes:v1";
export const MAX_PROJECT_NOTE_LENGTH = 20_000;
const MAX_PROJECT_NOTE_TITLE_LENGTH = 120;

export interface ProjectNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface PersistedProjectNotesState {
  notesByProjectCwd: Record<string, ProjectNote[]>;
}

const EMPTY_PROJECT_NOTES = Object.freeze([]) as readonly ProjectNote[];

const EMPTY_PROJECT_NOTES_STATE: PersistedProjectNotesState = {
  notesByProjectCwd: {},
};

let listeners: Array<() => void> = [];
let cachedRawProjectNotes: string | null | undefined;
let cachedProjectNotesState: PersistedProjectNotesState = EMPTY_PROJECT_NOTES_STATE;

function emitProjectNotesChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function createProjectNoteId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProjectNoteContent(input: string): string {
  return input.replaceAll("\r\n", "\n").slice(0, MAX_PROJECT_NOTE_LENGTH);
}

function normalizeProjectNoteTitle(input: string): string {
  return input.replaceAll("\r\n", " ").trim().slice(0, MAX_PROJECT_NOTE_TITLE_LENGTH);
}

function sortProjectNotes(notes: readonly ProjectNote[]): ProjectNote[] {
  return notes.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function sanitizeProjectNoteArray(value: unknown): ProjectNote[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const notes: ProjectNote[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const id = "id" in candidate && typeof candidate.id === "string" ? candidate.id : null;
    const title =
      "title" in candidate && typeof candidate.title === "string" ? candidate.title : "";
    const content =
      "content" in candidate && typeof candidate.content === "string" ? candidate.content : "";
    const updatedAt =
      "updatedAt" in candidate && typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : null;
    const createdAt =
      "createdAt" in candidate && typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : updatedAt;
    if (!id || !updatedAt || !createdAt) {
      continue;
    }

    notes.push({
      id,
      title: normalizeProjectNoteTitle(title) || "Untitled note",
      content: normalizeProjectNoteContent(content),
      createdAt,
      updatedAt,
    });
  }

  return sortProjectNotes(notes);
}

function parsePersistedProjectNotes(value: string | null): PersistedProjectNotesState {
  if (!value) return EMPTY_PROJECT_NOTES_STATE;

  try {
    const parsed = JSON.parse(value) as { notesByProjectCwd?: unknown };
    const source = parsed.notesByProjectCwd;
    if (!source || typeof source !== "object") {
      return EMPTY_PROJECT_NOTES_STATE;
    }

    const notesByProjectCwd: Record<string, ProjectNote[]> = {};
    for (const [cwd, entry] of Object.entries(source)) {
      if (!cwd || typeof cwd !== "string" || !entry || typeof entry !== "object") {
        continue;
      }

      const migratedNotes = sanitizeProjectNoteArray(entry);
      if (migratedNotes.length > 0) {
        notesByProjectCwd[cwd] = migratedNotes;
        continue;
      }

      const legacyText = "text" in entry && typeof entry.text === "string" ? entry.text : "";
      const legacyUpdatedAt =
        "updatedAt" in entry && typeof entry.updatedAt === "string"
          ? entry.updatedAt
          : new Date().toISOString();
      const normalizedLegacyText = normalizeProjectNoteContent(legacyText);
      if (normalizedLegacyText.trim().length === 0) {
        continue;
      }

      notesByProjectCwd[cwd] = [
        {
          id: "legacy-project-note",
          title: "Project note",
          content: normalizedLegacyText,
          createdAt: legacyUpdatedAt,
          updatedAt: legacyUpdatedAt,
        },
      ];
    }

    return { notesByProjectCwd };
  } catch {
    return EMPTY_PROJECT_NOTES_STATE;
  }
}

function readProjectNotesState(): PersistedProjectNotesState {
  if (typeof window === "undefined") {
    return EMPTY_PROJECT_NOTES_STATE;
  }

  try {
    const raw = window.localStorage.getItem(PROJECT_NOTES_STORAGE_KEY);
    if (raw === cachedRawProjectNotes) {
      return cachedProjectNotesState;
    }

    cachedRawProjectNotes = raw;
    cachedProjectNotesState = parsePersistedProjectNotes(raw);
    return cachedProjectNotesState;
  } catch {
    return EMPTY_PROJECT_NOTES_STATE;
  }
}

function writeProjectNotesState(nextState: PersistedProjectNotesState): void {
  if (typeof window === "undefined") return;

  try {
    const nextRaw = JSON.stringify(nextState);
    window.localStorage.setItem(PROJECT_NOTES_STORAGE_KEY, nextRaw);
    cachedRawProjectNotes = nextRaw;
    cachedProjectNotesState = nextState;
    emitProjectNotesChange();
  } catch {
    // Ignore storage errors so notes do not break the rest of the UI.
  }
}

export function getProjectNotesSnapshot(
  projectCwd: string | null | undefined,
): readonly ProjectNote[] {
  if (!projectCwd) {
    return EMPTY_PROJECT_NOTES;
  }

  return readProjectNotesState().notesByProjectCwd[projectCwd] ?? EMPTY_PROJECT_NOTES;
}

export function createProjectNote(
  projectCwd: string,
  input?: { title?: string; content?: string },
): ProjectNote {
  const currentState = readProjectNotesState();
  const now = new Date().toISOString();
  const nextNote: ProjectNote = {
    id: createProjectNoteId(),
    title: normalizeProjectNoteTitle(input?.title ?? "") || "Untitled note",
    content: normalizeProjectNoteContent(input?.content ?? ""),
    createdAt: now,
    updatedAt: now,
  };
  writeProjectNotesState({
    notesByProjectCwd: {
      ...currentState.notesByProjectCwd,
      [projectCwd]: sortProjectNotes([nextNote, ...(currentState.notesByProjectCwd[projectCwd] ?? [])]),
    },
  });
  return nextNote;
}

export function updateProjectNote(
  projectCwd: string,
  noteId: string,
  changes: { title?: string; content?: string },
): ProjectNote | null {
  const currentState = readProjectNotesState();
  const currentNotes = currentState.notesByProjectCwd[projectCwd] ?? [];
  let nextNote: ProjectNote | null = null;
  const nextNotes = currentNotes.map((note) => {
    if (note.id !== noteId) {
      return note;
    }

    nextNote = {
      ...note,
      title:
        changes.title === undefined
          ? note.title
          : normalizeProjectNoteTitle(changes.title) || "Untitled note",
      content:
        changes.content === undefined
          ? note.content
          : normalizeProjectNoteContent(changes.content),
      updatedAt: new Date().toISOString(),
    };
    return nextNote;
  });

  if (!nextNote) {
    return null;
  }

  writeProjectNotesState({
    notesByProjectCwd: {
      ...currentState.notesByProjectCwd,
      [projectCwd]: sortProjectNotes(nextNotes),
    },
  });
  return nextNote;
}

export function saveProjectNotes(projectCwd: string, text: string): ProjectNote {
  const currentState = readProjectNotesState();
  const existingNote = currentState.notesByProjectCwd[projectCwd]?.[0] ?? null;
  if (existingNote) {
    return (
      updateProjectNote(projectCwd, existingNote.id, { content: text }) ?? existingNote
    );
  }

  return createProjectNote(projectCwd, {
    title: "Project note",
    content: text,
  });
}

export function deleteProjectNote(projectCwd: string, noteId: string): void {
  const currentState = readProjectNotesState();
  const currentNotes = currentState.notesByProjectCwd[projectCwd] ?? [];
  const nextNotes = currentNotes.filter((note) => note.id !== noteId);
  if (nextNotes.length === currentNotes.length) {
    return;
  }

  if (nextNotes.length === 0) {
    const nextNotesByProjectCwd = { ...currentState.notesByProjectCwd };
    delete nextNotesByProjectCwd[projectCwd];
    writeProjectNotesState({ notesByProjectCwd: nextNotesByProjectCwd });
    return;
  }

  writeProjectNotesState({
    notesByProjectCwd: {
      ...currentState.notesByProjectCwd,
      [projectCwd]: sortProjectNotes(nextNotes),
    },
  });
}

export function clearProjectNotes(projectCwd: string): void {
  const currentState = readProjectNotesState();
  if (!(projectCwd in currentState.notesByProjectCwd)) {
    return;
  }

  const nextNotesByProjectCwd = { ...currentState.notesByProjectCwd };
  delete nextNotesByProjectCwd[projectCwd];
  writeProjectNotesState({ notesByProjectCwd: nextNotesByProjectCwd });
}

function subscribeProjectNotes(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

export function useProjectNotes(
  projectCwd: string | null | undefined,
): readonly ProjectNote[] {
  return useSyncExternalStore(
    subscribeProjectNotes,
    () => getProjectNotesSnapshot(projectCwd),
    () => EMPTY_PROJECT_NOTES,
  );
}
