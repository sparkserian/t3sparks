import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CheckpointRef,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3sparks/contracts";
import { Effect, Layer, ManagedRuntime, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { PersistenceSqlError } from "../../persistence/Errors.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { layerConfig, SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  OrchestrationEventStore,
  type OrchestrationEventStoreShape,
} from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { ProjectionSnapshotImportLive } from "./ProjectionSnapshotImport.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import {
  OrchestrationProjectionPipeline,
  type OrchestrationProjectionPipelineShape,
} from "../Services/ProjectionPipeline.ts";
import {
  ProjectionSnapshotImport,
  type ProjectionSnapshotImportShape,
} from "../Services/ProjectionSnapshotImport.ts";
import { ServerConfig } from "../../config.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);
const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.makeUnsafe(value);

async function createOrchestrationSystem() {
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(orchestrationLayer);
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  return {
    engine,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

function now() {
  return new Date().toISOString();
}

function createImportEngineStubLayer() {
  return Layer.succeed(OrchestrationEngineService, {
    getReadModel: () => Effect.die("getReadModel should not be called in import stub"),
    replaceReadModel: () => Effect.void,
    readEvents: () => Stream.empty,
    dispatch: () => Effect.die("dispatch should not be called in import stub"),
    streamDomainEvents: Stream.empty,
  } satisfies OrchestrationEngineShape);
}

async function createPersistentOrchestrationSystem(stateDir: string) {
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provideMerge(layerConfig),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), stateDir)),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(orchestrationLayer);
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  return {
    engine,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

async function createPersistentImportSystem(stateDir: string) {
  const importLayer = Layer.mergeAll(
    createImportEngineStubLayer(),
    OrchestrationProjectionSnapshotQueryLive,
    ProjectionSnapshotImportLive.pipe(Layer.provide(createImportEngineStubLayer())),
  ).pipe(
    Layer.provideMerge(layerConfig),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), stateDir)),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(importLayer);
  const importer = await runtime.runPromise(Effect.service(ProjectionSnapshotImport));
  return {
    importer,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

describe("OrchestrationEngine", () => {
  it("bootstraps restored threads from the persisted projection snapshot after restart", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3sparks-engine-restore-"));

    try {
      const importerSystem = await createPersistentImportSystem(stateDir);
      await importerSystem.run(
        importerSystem.importer.replaceSnapshot({
          snapshot: {
            snapshotSequence: 42,
            updatedAt: "2026-04-05T12:00:00.000Z",
            projects: [
              {
                id: asProjectId("project-restore"),
                title: "Restore Project",
                workspaceRoot: "C:/Users/example/project-restore",
                defaultModel: "gpt-5.4",
                scripts: [],
                createdAt: "2026-04-01T10:00:00.000Z",
                updatedAt: "2026-04-05T11:55:00.000Z",
                deletedAt: null,
              },
            ],
            threads: [
              {
                id: ThreadId.makeUnsafe("thread-restore"),
                projectId: asProjectId("project-restore"),
                title: "Restored thread",
                model: "claude-opus-4.6",
                runtimeMode: "full-access",
                interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
                branch: "main",
                worktreePath: null,
                latestTurn: null,
                createdAt: "2026-04-01T10:05:00.000Z",
                updatedAt: "2026-04-05T11:56:20.000Z",
                archivedAt: null,
                deletedAt: null,
                messages: [],
                proposedPlans: [],
                activities: [],
                checkpoints: [],
                session: null,
              },
            ],
          },
        }),
      );
      await importerSystem.dispose();

      const system = await createPersistentOrchestrationSystem(stateDir);
      const { engine } = system;
      const bootReadModel = await system.run(engine.getReadModel());
      expect(bootReadModel.threads.find((thread) => thread.id === "thread-restore")?.title).toBe(
        "Restored thread",
      );

      await system.run(
        engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-restored-thread-update"),
          threadId: ThreadId.makeUnsafe("thread-restore"),
          title: "Restored thread updated",
        }),
      );

      const updatedReadModel = await system.run(engine.getReadModel());
      expect(
        updatedReadModel.threads.find((thread) => thread.id === "thread-restore")?.title,
      ).toBe("Restored thread updated");
      await system.dispose();
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("returns deterministic read models for repeated reads", async () => {
    const createdAt = now();
    const system = await createOrchestrationSystem();
    const { engine } = system;

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-1-create"),
        projectId: asProjectId("project-1"),
        title: "Project 1",
        workspaceRoot: "/tmp/project-1",
        defaultModel: "gpt-5-codex",
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-1-create"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        projectId: asProjectId("project-1"),
        title: "Thread",
        model: "gpt-5-codex",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-1"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("msg-1"),
          role: "user",
          text: "hello",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt,
      }),
    );

    const readModelA = await system.run(engine.getReadModel());
    const readModelB = await system.run(engine.getReadModel());
    expect(readModelB).toEqual(readModelA);
    await system.dispose();
  });

  it("replays append-only events from sequence", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-replay-create"),
        projectId: asProjectId("project-replay"),
        title: "Replay Project",
        workspaceRoot: "/tmp/project-replay",
        defaultModel: "gpt-5-codex",
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-replay-create"),
        threadId: ThreadId.makeUnsafe("thread-replay"),
        projectId: asProjectId("project-replay"),
        title: "replay",
        model: "gpt-5-codex",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.delete",
        commandId: CommandId.makeUnsafe("cmd-thread-replay-delete"),
        threadId: ThreadId.makeUnsafe("thread-replay"),
      }),
    );

    const events = await system.run(
      Stream.runCollect(engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    expect(events.map((event) => event.type)).toEqual([
      "project.created",
      "thread.created",
      "thread.deleted",
    ]);
    await system.dispose();
  });

  it("updates archivedAt through archive and unarchive commands", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-archive-create"),
        projectId: asProjectId("project-archive"),
        title: "Archive Project",
        workspaceRoot: "/tmp/project-archive",
        defaultModel: "gpt-5-codex",
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-archive-create"),
        threadId: ThreadId.makeUnsafe("thread-archive"),
        projectId: asProjectId("project-archive"),
        title: "Archive thread",
        model: "gpt-5-codex",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.archive",
        commandId: CommandId.makeUnsafe("cmd-thread-archive"),
        threadId: ThreadId.makeUnsafe("thread-archive"),
      }),
    );

    const archivedReadModel = await system.run(engine.getReadModel());
    expect(archivedReadModel.threads[0]?.archivedAt).not.toBeNull();

    await system.run(
      engine.dispatch({
        type: "thread.unarchive",
        commandId: CommandId.makeUnsafe("cmd-thread-unarchive"),
        threadId: ThreadId.makeUnsafe("thread-archive"),
      }),
    );

    const unarchivedReadModel = await system.run(engine.getReadModel());
    expect(unarchivedReadModel.threads[0]?.archivedAt).toBeNull();
    await system.dispose();
  });

  it("streams persisted domain events in order", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-stream-create"),
        projectId: asProjectId("project-stream"),
        title: "Stream Project",
        workspaceRoot: "/tmp/project-stream",
        defaultModel: "gpt-5-codex",
        createdAt,
      }),
    );

    const eventTypes: string[] = [];
    await system.run(
      Effect.gen(function* () {
        const eventQueue = yield* Queue.unbounded<OrchestrationEvent>();
        yield* Effect.forkScoped(
          Stream.take(engine.streamDomainEvents, 2).pipe(
            Stream.runForEach((event) => Queue.offer(eventQueue, event).pipe(Effect.asVoid)),
          ),
        );
        yield* Effect.sleep("10 millis");
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-stream-thread-create"),
          threadId: ThreadId.makeUnsafe("thread-stream"),
          projectId: asProjectId("project-stream"),
          title: "domain-stream",
          model: "gpt-5-codex",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-stream-thread-update"),
          threadId: ThreadId.makeUnsafe("thread-stream"),
          title: "domain-stream-updated",
        });
        eventTypes.push((yield* Queue.take(eventQueue)).type);
        eventTypes.push((yield* Queue.take(eventQueue)).type);
      }).pipe(Effect.scoped),
    );

    expect(eventTypes).toEqual(["thread.created", "thread.meta-updated"]);
    await system.dispose();
  });

  it("stores completed checkpoint summaries even when no files changed", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-turn-diff-create"),
        projectId: asProjectId("project-turn-diff"),
        title: "Turn Diff Project",
        workspaceRoot: "/tmp/project-turn-diff",
        defaultModel: "gpt-5-codex",
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-turn-diff-create"),
        threadId: ThreadId.makeUnsafe("thread-turn-diff"),
        projectId: asProjectId("project-turn-diff"),
        title: "Turn diff thread",
        model: "gpt-5-codex",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.makeUnsafe("cmd-turn-diff-complete"),
        threadId: ThreadId.makeUnsafe("thread-turn-diff"),
        turnId: asTurnId("turn-1"),
        completedAt: createdAt,
        checkpointRef: asCheckpointRef("refs/t3/checkpoints/thread-turn-diff/turn/1"),
        status: "ready",
        files: [],
        checkpointTurnCount: 1,
        createdAt,
      }),
    );

    const thread = (await system.run(engine.getReadModel())).threads.find(
      (entry) => entry.id === "thread-turn-diff",
    );
    expect(thread?.checkpoints).toEqual([
      {
        turnId: asTurnId("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: asCheckpointRef("refs/t3/checkpoints/thread-turn-diff/turn/1"),
        status: "ready",
        files: [],
        assistantMessageId: null,
        completedAt: createdAt,
      },
    ]);
    await system.dispose();
  });

  it("keeps processing queued commands after a storage failure", async () => {
    type StoredEvent =
      ReturnType<OrchestrationEventStoreShape["append"]> extends Effect.Effect<infer A, any, any>
        ? A
        : never;
    const events: StoredEvent[] = [];
    let nextSequence = 1;
    let shouldFailFirstAppend = true;

    const flakyStore: OrchestrationEventStoreShape = {
      append(event) {
        if (shouldFailFirstAppend && event.commandId === CommandId.makeUnsafe("cmd-flaky-1")) {
          shouldFailFirstAppend = false;
          return Effect.fail(
            new PersistenceSqlError({
              operation: "test.append",
              detail: "append failed",
            }),
          );
        }
        const savedEvent = {
          ...event,
          sequence: nextSequence,
        } as StoredEvent;
        nextSequence += 1;
        events.push(savedEvent);
        return Effect.succeed(savedEvent);
      },
      readFromSequence(sequenceExclusive) {
        return Stream.fromIterable(events.filter((event) => event.sequence > sequenceExclusive));
      },
      readAll() {
        return Stream.fromIterable(events);
      },
    };

    const runtime = ManagedRuntime.make(
      OrchestrationEngineLive.pipe(
        Layer.provide(OrchestrationProjectionPipelineLive),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(OrchestrationEventStore, flakyStore)),
        Layer.provide(OrchestrationCommandReceiptRepositoryLive),
        Layer.provide(SqlitePersistenceMemory),
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
        Layer.provideMerge(NodeServices.layer),
      ),
    );
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const createdAt = now();

    await runtime.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-flaky-create"),
        projectId: asProjectId("project-flaky"),
        title: "Flaky Project",
        workspaceRoot: "/tmp/project-flaky",
        defaultModel: "gpt-5-codex",
        createdAt,
      }),
    );

    await expect(
      runtime.runPromise(
        engine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-flaky-1"),
          threadId: ThreadId.makeUnsafe("thread-flaky-fail"),
          projectId: asProjectId("project-flaky"),
          title: "flaky-fail",
          model: "gpt-5-codex",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt,
        }),
      ),
    ).rejects.toThrow("append failed");

    const result = await runtime.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-flaky-2"),
        threadId: ThreadId.makeUnsafe("thread-flaky-ok"),
        projectId: asProjectId("project-flaky"),
        title: "flaky-ok",
        model: "gpt-5-codex",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    expect(result.sequence).toBe(2);
    expect((await runtime.runPromise(engine.getReadModel())).snapshotSequence).toBe(2);
    await runtime.dispose();
  });

  it("rolls back all events for a multi-event command when projection fails mid-dispatch", async () => {
    let shouldFailRequestedProjection = true;
    const flakyProjectionPipeline: OrchestrationProjectionPipelineShape = {
      bootstrap: Effect.void,
      projectEvent: (event) => {
        if (
          shouldFailRequestedProjection &&
          event.commandId === CommandId.makeUnsafe("cmd-turn-start-atomic") &&
          event.type === "thread.turn-start-requested"
        ) {
          shouldFailRequestedProjection = false;
          return Effect.fail(
            new PersistenceSqlError({
              operation: "test.projection",
              detail: "projection failed",
            }),
          );
        }
        return Effect.void;
      },
    };

    const runtime = ManagedRuntime.make(
      OrchestrationEngineLive.pipe(
        Layer.provide(Layer.succeed(OrchestrationProjectionPipeline, flakyProjectionPipeline)),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(OrchestrationEventStoreLive),
        Layer.provide(OrchestrationCommandReceiptRepositoryLive),
        Layer.provide(SqlitePersistenceMemory),
      ),
    );
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const createdAt = now();

    await runtime.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-atomic-create"),
        projectId: asProjectId("project-atomic"),
        title: "Atomic Project",
        workspaceRoot: "/tmp/project-atomic",
        defaultModel: "gpt-5-codex",
        createdAt,
      }),
    );
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-atomic-create"),
        threadId: ThreadId.makeUnsafe("thread-atomic"),
        projectId: asProjectId("project-atomic"),
        title: "atomic",
        model: "gpt-5-codex",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    const turnStartCommand = {
      type: "thread.turn.start" as const,
      commandId: CommandId.makeUnsafe("cmd-turn-start-atomic"),
      threadId: ThreadId.makeUnsafe("thread-atomic"),
      message: {
        messageId: asMessageId("msg-atomic-1"),
        role: "user" as const,
        text: "hello",
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required" as const,
      createdAt,
    };

    await expect(runtime.runPromise(engine.dispatch(turnStartCommand))).rejects.toThrow(
      "projection failed",
    );

    const eventsAfterFailure = await runtime.runPromise(
      Stream.runCollect(engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    expect(eventsAfterFailure.map((event) => event.type)).toEqual([
      "project.created",
      "thread.created",
    ]);
    expect((await runtime.runPromise(engine.getReadModel())).snapshotSequence).toBe(2);

    const retryResult = await runtime.runPromise(engine.dispatch(turnStartCommand));
    expect(retryResult.sequence).toBe(4);

    const eventsAfterRetry = await runtime.runPromise(
      Stream.runCollect(engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    expect(eventsAfterRetry.map((event) => event.type)).toEqual([
      "project.created",
      "thread.created",
      "thread.message-sent",
      "thread.turn-start-requested",
    ]);
    expect(
      eventsAfterRetry.filter((event) => event.commandId === turnStartCommand.commandId),
    ).toHaveLength(2);

    await runtime.dispose();
  });

  it("reconciles in-memory state when append persists but projection fails", async () => {
    type StoredEvent =
      ReturnType<OrchestrationEventStoreShape["append"]> extends Effect.Effect<infer A, any, any>
        ? A
        : never;
    const events: StoredEvent[] = [];
    let nextSequence = 1;

    const nonTransactionalStore: OrchestrationEventStoreShape = {
      append(event) {
        const savedEvent = {
          ...event,
          sequence: nextSequence,
        } as StoredEvent;
        nextSequence += 1;
        events.push(savedEvent);
        return Effect.succeed(savedEvent);
      },
      readFromSequence(sequenceExclusive) {
        return Stream.fromIterable(events.filter((event) => event.sequence > sequenceExclusive));
      },
      readAll() {
        return Stream.fromIterable(events);
      },
    };

    let shouldFailProjection = true;
    const flakyProjectionPipeline: OrchestrationProjectionPipelineShape = {
      bootstrap: Effect.void,
      projectEvent: (event) => {
        if (
          shouldFailProjection &&
          event.commandId === CommandId.makeUnsafe("cmd-thread-meta-sync-fail")
        ) {
          shouldFailProjection = false;
          return Effect.fail(
            new PersistenceSqlError({
              operation: "test.projection",
              detail: "projection failed",
            }),
          );
        }
        return Effect.void;
      },
    };

    const runtime = ManagedRuntime.make(
      OrchestrationEngineLive.pipe(
        Layer.provide(Layer.succeed(OrchestrationProjectionPipeline, flakyProjectionPipeline)),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(OrchestrationEventStore, nonTransactionalStore)),
        Layer.provide(OrchestrationCommandReceiptRepositoryLive),
        Layer.provide(SqlitePersistenceMemory),
      ),
    );
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const createdAt = now();

    await runtime.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-sync-create"),
        projectId: asProjectId("project-sync"),
        title: "Sync Project",
        workspaceRoot: "/tmp/project-sync",
        defaultModel: "gpt-5-codex",
        createdAt,
      }),
    );
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-sync-create"),
        threadId: ThreadId.makeUnsafe("thread-sync"),
        projectId: asProjectId("project-sync"),
        title: "sync-before",
        model: "gpt-5-codex",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    await expect(
      runtime.runPromise(
        engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-thread-meta-sync-fail"),
          threadId: ThreadId.makeUnsafe("thread-sync"),
          title: "sync-after-failed-projection",
        }),
      ),
    ).rejects.toThrow("projection failed");

    const readModelAfterFailure = await runtime.runPromise(engine.getReadModel());
    const updatedThread = readModelAfterFailure.threads.find(
      (thread) => thread.id === "thread-sync",
    );
    expect(readModelAfterFailure.snapshotSequence).toBe(3);
    expect(updatedThread?.title).toBe("sync-after-failed-projection");

    await runtime.dispose();
  });

  it("fails command dispatch when command invariants are violated", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;

    await expect(
      system.run(
        engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe("cmd-invariant-missing-thread"),
          threadId: ThreadId.makeUnsafe("thread-missing"),
          message: {
            messageId: asMessageId("msg-missing"),
            role: "user",
            text: "hello",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: now(),
        }),
      ),
    ).rejects.toThrow("Thread 'thread-missing' does not exist");

    await system.dispose();
  });

  it("rejects duplicate thread creation", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-duplicate-create"),
        projectId: asProjectId("project-duplicate"),
        title: "Duplicate Project",
        workspaceRoot: "/tmp/project-duplicate",
        defaultModel: "gpt-5-codex",
        createdAt,
      }),
    );

    await system.run(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-duplicate-1"),
        threadId: ThreadId.makeUnsafe("thread-duplicate"),
        projectId: asProjectId("project-duplicate"),
        title: "duplicate",
        model: "gpt-5-codex",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    await expect(
      system.run(
        engine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-thread-duplicate-2"),
          threadId: ThreadId.makeUnsafe("thread-duplicate"),
          projectId: asProjectId("project-duplicate"),
          title: "duplicate",
          model: "gpt-5-codex",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt,
        }),
      ),
    ).rejects.toThrow("already exists");

    await system.dispose();
  });
});
