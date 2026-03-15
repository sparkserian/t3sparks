import { describe, expect, it } from "vitest";

import {
  clearProjectNotes,
  createProjectNote,
  deleteProjectNote,
  getProjectNotesSnapshot,
  PROJECT_NOTES_STORAGE_KEY,
  updateProjectNote,
} from "./projectNotes";

function withMockWindow(test: (store: Map<string, string>) => void) {
  const store = new Map<string, string>();
  const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;

  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => {
            store.set(key, value);
          },
        },
      },
    });

    test(store);
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
}

describe("project notes", () => {
  it("returns an empty list when a project has no saved notes", () => {
    withMockWindow(() => {
      expect(getProjectNotesSnapshot("/tmp/project")).toEqual([]);
    });
  });

  it("persists multiple named notes per project cwd", () => {
    withMockWindow(() => {
      createProjectNote("/tmp/project-a", { title: "Billing", content: "Ship billing flow" });
      createProjectNote("/tmp/project-a", { title: "Signup", content: "Fix signup edge cases" });
      createProjectNote("/tmp/project-b", { title: "Marketing", content: "Rewrite homepage" });

      expect(getProjectNotesSnapshot("/tmp/project-a")).toHaveLength(2);
      expect(getProjectNotesSnapshot("/tmp/project-b")).toHaveLength(1);
    });
  });

  it("migrates the old single-note shape into a named note", () => {
    withMockWindow((store) => {
      store.set(
        PROJECT_NOTES_STORAGE_KEY,
        JSON.stringify({
          notesByProjectCwd: {
            "/tmp/project-a": {
              text: "Legacy note body",
              updatedAt: "2026-03-11T00:00:00.000Z",
            },
          },
        }),
      );

      expect(getProjectNotesSnapshot("/tmp/project-a")).toEqual([
        {
          id: "legacy-project-note",
          title: "Project note",
          content: "Legacy note body",
          createdAt: "2026-03-11T00:00:00.000Z",
          updatedAt: "2026-03-11T00:00:00.000Z",
        },
      ]);
    });
  });

  it("updates and deletes an individual note", () => {
    withMockWindow(() => {
      const created = createProjectNote("/tmp/project-a", {
        title: "Launch",
        content: "Draft launch checklist",
      });
      const updated = updateProjectNote("/tmp/project-a", created.id, {
        title: "Launch plan",
        content: "Finalize launch checklist",
      });

      expect(updated?.title).toBe("Launch plan");
      expect(getProjectNotesSnapshot("/tmp/project-a")[0]?.content).toBe(
        "Finalize launch checklist",
      );

      deleteProjectNote("/tmp/project-a", created.id);
      expect(getProjectNotesSnapshot("/tmp/project-a")).toEqual([]);
    });
  });

  it("clears a persisted note explicitly", () => {
    withMockWindow(() => {
      createProjectNote("/tmp/project-a", { title: "Launch", content: "Write launch email" });
      clearProjectNotes("/tmp/project-a");

      expect(getProjectNotesSnapshot("/tmp/project-a")).toEqual([]);
    });
  });
});
