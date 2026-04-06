import { describe, expect, it } from "vitest";

import { ProjectId, ThreadId } from "@t3sparks/contracts";

import {
  findMissingProviderStatuses,
  findProjectsNeedingBindings,
  inferProvidersRequiredBySnapshot,
} from "./syncReadiness";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

describe("syncReadiness", () => {
  it("infers required providers from thread sessions and models", () => {
    const providers = inferProvidersRequiredBySnapshot({
      snapshotSequence: 1,
      updatedAt: "2026-04-05T00:00:00.000Z",
      projects: [],
      threads: [
        {
          id: asThreadId("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Claude thread",
          model: "claude-opus-4.6",
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          latestTurn: null,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: {
            threadId: asThreadId("thread-1"),
            status: "ready",
            providerName: "claudeAgent",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: "2026-04-05T00:00:00.000Z",
          },
        },
        {
          id: asThreadId("thread-2"),
          projectId: asProjectId("project-1"),
          title: "Codex thread",
          model: "gpt-5.4",
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          latestTurn: null,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: {
            threadId: asThreadId("thread-2"),
            status: "ready",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: "2026-04-05T00:00:00.000Z",
          },
        },
      ],
    });

    expect(providers).toEqual(["claudeAgent", "codex"]);
  });

  it("reports providers that are still unavailable or unauthenticated", () => {
    const missing = findMissingProviderStatuses(
      ["githubCopilot", "codex"],
      [
        {
          provider: "githubCopilot",
          status: "error",
          available: true,
          authStatus: "unauthenticated",
          checkedAt: "2026-04-05T00:00:00.000Z",
          message: "Sign in first",
        },
        {
          provider: "codex",
          status: "ready",
          available: true,
          authStatus: "authenticated",
          checkedAt: "2026-04-05T00:00:00.000Z",
        },
      ],
    );

    expect(missing).toHaveLength(1);
    expect(missing[0]?.provider).toBe("githubCopilot");
  });

  it("identifies projects that still need a device-local folder binding", () => {
    const needs = findProjectsNeedingBindings({
      snapshot: {
        snapshotSequence: 1,
        updatedAt: "2026-04-05T00:00:00.000Z",
        projects: [
          {
            id: asProjectId("project-1"),
            title: "One",
            workspaceRoot: "/Users/example/one",
            defaultModel: null,
            scripts: [],
            createdAt: "2026-04-05T00:00:00.000Z",
            updatedAt: "2026-04-05T00:00:00.000Z",
            deletedAt: null,
          },
          {
            id: asProjectId("project-2"),
            title: "Two",
            workspaceRoot: "/Users/example/two",
            defaultModel: null,
            scripts: [],
            createdAt: "2026-04-05T00:00:00.000Z",
            updatedAt: "2026-04-05T00:00:00.000Z",
            deletedAt: null,
          },
        ],
        threads: [],
      },
      bindingsByProjectId: {
        [asProjectId("project-2")]: "C:/Users/example/two",
      },
      pathChecks: [
        {
          path: "/Users/example/one",
          exists: false,
          isDirectory: false,
        },
        {
          path: "C:/Users/example/two",
          exists: true,
          isDirectory: true,
        },
      ],
    });

    expect(needs).toHaveLength(1);
    expect(needs[0]?.projectId).toBe("project-1");
  });
});
