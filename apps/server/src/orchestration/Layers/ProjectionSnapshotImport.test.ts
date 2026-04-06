import * as assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  CheckpointRef,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3sparks/contracts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProjectionSnapshotImportLive } from "./ProjectionSnapshotImport.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { ProjectionSnapshotImport } from "../Services/ProjectionSnapshotImport.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);
const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

const projectionSnapshotImportLayer = it.layer(
  Layer.mergeAll(ProjectionSnapshotImportLive, OrchestrationProjectionSnapshotQueryLive).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
);

projectionSnapshotImportLayer("ProjectionSnapshotImport", (it) => {
  it.effect("replaces the local projection state from an imported snapshot", () =>
    Effect.gen(function* () {
      const importer = yield* ProjectionSnapshotImport;
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      yield* importer.replaceSnapshot({
        snapshot: {
          snapshotSequence: 42,
          updatedAt: "2026-04-05T12:00:00.000Z",
          projects: [
            {
              id: asProjectId("project-1"),
              title: "Project One",
              workspaceRoot: "/Users/example/project-one",
              defaultModel: "gpt-5.4",
              scripts: [],
              createdAt: "2026-04-01T10:00:00.000Z",
              updatedAt: "2026-04-05T11:55:00.000Z",
              deletedAt: null,
            },
          ],
          threads: [
            {
              id: asThreadId("thread-1"),
              projectId: asProjectId("project-1"),
              title: "Thread One",
              model: "claude-opus-4.6",
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: "main",
              worktreePath: "/Users/example/project-one/.worktrees/thread-1",
              latestTurn: {
                turnId: asTurnId("turn-2"),
                state: "completed",
                requestedAt: "2026-04-05T11:56:00.000Z",
                startedAt: "2026-04-05T11:56:05.000Z",
                completedAt: "2026-04-05T11:56:20.000Z",
                assistantMessageId: asMessageId("message-2"),
              },
              createdAt: "2026-04-01T10:05:00.000Z",
              updatedAt: "2026-04-05T11:56:20.000Z",
              archivedAt: null,
              deletedAt: null,
              messages: [
                {
                  id: asMessageId("message-1"),
                  role: "user",
                  text: "Hello",
                  turnId: null,
                  streaming: false,
                  createdAt: "2026-04-05T11:55:50.000Z",
                  updatedAt: "2026-04-05T11:55:50.000Z",
                },
                {
                  id: asMessageId("message-2"),
                  role: "assistant",
                  text: "Hi there",
                  turnId: asTurnId("turn-2"),
                  streaming: false,
                  createdAt: "2026-04-05T11:56:20.000Z",
                  updatedAt: "2026-04-05T11:56:20.000Z",
                },
              ],
              proposedPlans: [
                {
                  id: "plan-1",
                  turnId: asTurnId("turn-2"),
                  planMarkdown: "1. Test\n2. Ship",
                  createdAt: "2026-04-05T11:56:00.000Z",
                  updatedAt: "2026-04-05T11:56:10.000Z",
                },
              ],
              activities: [
                {
                  id: asEventId("activity-1"),
                  tone: "info",
                  kind: "provider.turn.start.failed",
                  summary: "Started provider turn",
                  payload: { detail: "example" },
                  turnId: asTurnId("turn-2"),
                  sequence: 1,
                  createdAt: "2026-04-05T11:56:01.000Z",
                },
              ],
              checkpoints: [
                {
                  turnId: asTurnId("turn-1"),
                  checkpointTurnCount: 1,
                  checkpointRef: asCheckpointRef("checkpoint-1"),
                  status: "ready",
                  files: [],
                  assistantMessageId: null,
                  completedAt: "2026-04-05T11:55:59.000Z",
                },
              ],
              session: {
                threadId: asThreadId("thread-1"),
                status: "ready",
                providerName: "claudeAgent",
                runtimeMode: "full-access",
                activeTurnId: null,
                lastError: null,
                updatedAt: "2026-04-05T11:56:20.000Z",
              },
            },
          ],
        },
        projectBindings: [
          {
            projectId: asProjectId("project-1"),
            workspaceRoot: "C:/Users/example/project-one",
          },
        ],
      });

      const snapshot = yield* snapshotQuery.getSnapshot();

      assert.equal(snapshot.snapshotSequence, 42);
      assert.equal(snapshot.projects[0]?.workspaceRoot, "C:/Users/example/project-one");
      assert.equal(snapshot.threads[0]?.worktreePath, null);
      assert.equal(snapshot.threads[0]?.messages.length, 2);
      assert.equal(snapshot.threads[0]?.proposedPlans.length, 1);
      assert.equal(snapshot.threads[0]?.activities.length, 1);
      assert.equal(snapshot.threads[0]?.checkpoints.length, 1);
      assert.equal(snapshot.threads[0]?.session?.providerName, "claudeAgent");
      assert.equal(snapshot.threads[0]?.latestTurn?.turnId, "turn-2");
    }),
  );
});
