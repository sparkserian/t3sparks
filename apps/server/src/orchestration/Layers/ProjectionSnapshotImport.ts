import type {
  OrchestrationCheckpointSummary,
  OrchestrationLatestTurn,
  OrchestrationThread,
  ServerImportSnapshotInput,
  ServerImportSnapshotResult,
} from "@t3sparks/contracts";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import {
  ProjectionSnapshotImport,
  type ProjectionSnapshotImportShape,
} from "../Services/ProjectionSnapshotImport.ts";

interface ImportTurnRow {
  readonly threadId: string;
  readonly turnId: string;
  readonly pendingMessageId: string | null;
  readonly assistantMessageId: string | null;
  readonly state: "running" | "interrupted" | "completed" | "error";
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly checkpointTurnCount: number | null;
  readonly checkpointRef: string | null;
  readonly checkpointStatus: "ready" | "missing" | "error" | null;
  readonly checkpointFilesJson: string;
}

function buildCheckpointTurnRow(threadId: string, checkpoint: OrchestrationCheckpointSummary): ImportTurnRow {
  return {
    threadId,
    turnId: checkpoint.turnId,
    pendingMessageId: null,
    assistantMessageId: checkpoint.assistantMessageId,
    state: checkpoint.status === "error" ? "error" : "completed",
    requestedAt: checkpoint.completedAt,
    startedAt: checkpoint.completedAt,
    completedAt: checkpoint.completedAt,
    checkpointTurnCount: checkpoint.checkpointTurnCount,
    checkpointRef: checkpoint.checkpointRef,
    checkpointStatus: checkpoint.status,
    checkpointFilesJson: JSON.stringify(checkpoint.files),
  };
}

function mergeLatestTurn(
  existing: ImportTurnRow | undefined,
  threadId: string,
  latestTurn: OrchestrationLatestTurn,
): ImportTurnRow {
  return {
    threadId,
    turnId: latestTurn.turnId,
    pendingMessageId: existing?.pendingMessageId ?? null,
    assistantMessageId: latestTurn.assistantMessageId,
    state: latestTurn.state,
    requestedAt: latestTurn.requestedAt,
    startedAt: latestTurn.startedAt,
    completedAt: latestTurn.completedAt,
    checkpointTurnCount: existing?.checkpointTurnCount ?? null,
    checkpointRef: existing?.checkpointRef ?? null,
    checkpointStatus: existing?.checkpointStatus ?? null,
    checkpointFilesJson: existing?.checkpointFilesJson ?? "[]",
  };
}

function buildTurnRows(thread: OrchestrationThread): ReadonlyArray<ImportTurnRow> {
  const turns = new Map<string, ImportTurnRow>();

  for (const checkpoint of thread.checkpoints) {
    turns.set(checkpoint.turnId, buildCheckpointTurnRow(thread.id, checkpoint));
  }

  if (thread.latestTurn) {
    turns.set(
      thread.latestTurn.turnId,
      mergeLatestTurn(turns.get(thread.latestTurn.turnId), thread.id, thread.latestTurn),
    );
  }

  return [...turns.values()].sort((left, right) =>
    left.requestedAt.localeCompare(right.requestedAt) || left.turnId.localeCompare(right.turnId),
  );
}

function applyProjectBindings(
  input: ServerImportSnapshotInput,
): ServerImportSnapshotInput["snapshot"] {
  const bindingByProjectId = new Map(
    (input.projectBindings ?? []).map((binding) => [binding.projectId, binding.workspaceRoot] as const),
  );
  const reboundProjectIds = new Set<string>();

  const projects = input.snapshot.projects.map((project) => {
    const workspaceRoot = bindingByProjectId.get(project.id) ?? project.workspaceRoot;
    if (workspaceRoot !== project.workspaceRoot) {
      reboundProjectIds.add(project.id);
    }
    return {
      ...project,
      workspaceRoot,
    };
  });

  const threads = input.snapshot.threads.map((thread) => ({
    ...thread,
    worktreePath: reboundProjectIds.has(thread.projectId) ? null : thread.worktreePath,
  }));

  return {
    ...input.snapshot,
    projects,
    threads,
  };
}

const makeProjectionSnapshotImport = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const clearImportedState = Effect.gen(function* () {
    yield* sql`DELETE FROM checkpoint_diff_blobs`;
    yield* sql`DELETE FROM projection_pending_approvals`;
    yield* sql`DELETE FROM projection_thread_proposed_plans`;
    yield* sql`DELETE FROM projection_thread_activities`;
    yield* sql`DELETE FROM projection_thread_messages`;
    yield* sql`DELETE FROM projection_thread_sessions`;
    yield* sql`DELETE FROM projection_turns`;
    yield* sql`DELETE FROM projection_threads`;
    yield* sql`DELETE FROM projection_projects`;
    yield* sql`DELETE FROM projection_state`;
    yield* sql`DELETE FROM provider_session_runtime`;
    yield* sql`DELETE FROM orchestration_command_receipts`;
    yield* sql`DELETE FROM orchestration_events`;
    yield* sql`DELETE FROM sqlite_sequence WHERE name = 'orchestration_events'`;
  });

  const replaceSnapshot: ProjectionSnapshotImportShape["replaceSnapshot"] = (input) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const snapshot = applyProjectBindings(input);

        yield* clearImportedState;

        if (snapshot.snapshotSequence > 0) {
          yield* sql`
            INSERT INTO sqlite_sequence (name, seq)
            VALUES ('orchestration_events', ${snapshot.snapshotSequence})
          `;
        }

        for (const project of snapshot.projects) {
          yield* sql`
            INSERT INTO projection_projects (
              project_id,
              title,
              workspace_root,
              default_model,
              scripts_json,
              created_at,
              updated_at,
              deleted_at
            )
            VALUES (
              ${project.id},
              ${project.title},
              ${project.workspaceRoot},
              ${project.defaultModel},
              ${JSON.stringify(project.scripts)},
              ${project.createdAt},
              ${project.updatedAt},
              ${project.deletedAt}
            )
          `;
        }

        for (const thread of snapshot.threads) {
          yield* sql`
            INSERT INTO projection_threads (
              thread_id,
              project_id,
              title,
              model,
              runtime_mode,
              interaction_mode,
              branch,
              worktree_path,
              latest_turn_id,
              created_at,
              updated_at,
              archived_at,
              deleted_at
            )
            VALUES (
              ${thread.id},
              ${thread.projectId},
              ${thread.title},
              ${thread.model},
              ${thread.runtimeMode},
              ${thread.interactionMode},
              ${thread.branch},
              ${thread.worktreePath},
              ${thread.latestTurn?.turnId ?? null},
              ${thread.createdAt},
              ${thread.updatedAt},
              ${thread.archivedAt},
              ${thread.deletedAt}
            )
          `;

          for (const message of thread.messages) {
            yield* sql`
              INSERT INTO projection_thread_messages (
                message_id,
                thread_id,
                turn_id,
                role,
                text,
                attachments_json,
                is_streaming,
                created_at,
                updated_at
              )
              VALUES (
                ${message.id},
                ${thread.id},
                ${message.turnId},
                ${message.role},
                ${message.text},
                ${message.attachments ? JSON.stringify(message.attachments) : null},
                ${message.streaming ? 1 : 0},
                ${message.createdAt},
                ${message.updatedAt}
              )
            `;
          }

          for (const activity of thread.activities) {
            yield* sql`
              INSERT INTO projection_thread_activities (
                activity_id,
                thread_id,
                turn_id,
                tone,
                kind,
                summary,
                payload_json,
                sequence,
                created_at
              )
              VALUES (
                ${activity.id},
                ${thread.id},
                ${activity.turnId},
                ${activity.tone},
                ${activity.kind},
                ${activity.summary},
                ${JSON.stringify(activity.payload)},
                ${activity.sequence ?? null},
                ${activity.createdAt}
              )
            `;
          }

          for (const plan of thread.proposedPlans) {
            yield* sql`
              INSERT INTO projection_thread_proposed_plans (
                plan_id,
                thread_id,
                turn_id,
                plan_markdown,
                created_at,
                updated_at
              )
              VALUES (
                ${plan.id},
                ${thread.id},
                ${plan.turnId},
                ${plan.planMarkdown},
                ${plan.createdAt},
                ${plan.updatedAt}
              )
            `;
          }

          if (thread.session) {
            yield* sql`
              INSERT INTO projection_thread_sessions (
                thread_id,
                status,
                provider_name,
                runtime_mode,
                active_turn_id,
                last_error,
                updated_at
              )
              VALUES (
                ${thread.id},
                ${thread.session.status},
                ${thread.session.providerName},
                ${thread.session.runtimeMode},
                ${thread.session.activeTurnId},
                ${thread.session.lastError},
                ${thread.session.updatedAt}
              )
            `;
          }

          for (const turn of buildTurnRows(thread)) {
            yield* sql`
              INSERT INTO projection_turns (
                thread_id,
                turn_id,
                pending_message_id,
                assistant_message_id,
                state,
                requested_at,
                started_at,
                completed_at,
                checkpoint_turn_count,
                checkpoint_ref,
                checkpoint_status,
                checkpoint_files_json
              )
              VALUES (
                ${turn.threadId},
                ${turn.turnId},
                ${turn.pendingMessageId},
                ${turn.assistantMessageId},
                ${turn.state},
                ${turn.requestedAt},
                ${turn.startedAt},
                ${turn.completedAt},
                ${turn.checkpointTurnCount},
                ${turn.checkpointRef},
                ${turn.checkpointStatus},
                ${turn.checkpointFilesJson}
              )
            `;
          }
        }

        for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
          yield* sql`
            INSERT INTO projection_state (
              projector,
              last_applied_sequence,
              updated_at
            )
            VALUES (
              ${projector},
              ${snapshot.snapshotSequence},
              ${snapshot.updatedAt}
            )
          `;
        }

        return {
          importedProjectCount: snapshot.projects.length,
          importedThreadCount: snapshot.threads.length,
          snapshotSequence: snapshot.snapshotSequence,
        } satisfies ServerImportSnapshotResult;
      }),
    ).pipe(Effect.mapError(toPersistenceSqlError("ProjectionSnapshotImport.replaceSnapshot:query")));

  return {
    replaceSnapshot,
  } satisfies ProjectionSnapshotImportShape;
});

export const ProjectionSnapshotImportLive = Layer.effect(
  ProjectionSnapshotImport,
  makeProjectionSnapshotImport,
);
