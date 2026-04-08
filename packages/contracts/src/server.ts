import { Schema } from "effect";
import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas";
import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings";
import { EditorId } from "./editor";
import { OrchestrationReadModel, ProviderKind } from "./orchestration";
import { CODEX_REASONING_EFFORT_OPTIONS } from "./model";

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderStatusState = Schema.Literals(["ready", "warning", "error"]);
export type ServerProviderStatusState = typeof ServerProviderStatusState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderModelReasoningEffort = Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS);
export type ServerProviderModelReasoningEffort = typeof ServerProviderModelReasoningEffort.Type;

export const ServerProviderModel = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  supportsReasoningEffort: Schema.Boolean,
  supportedReasoningEfforts: Schema.optional(Schema.Array(ServerProviderModelReasoningEffort)),
  defaultReasoningEffort: Schema.optional(ServerProviderModelReasoningEffort),
  billingMultiplier: Schema.optional(Schema.Number),
});
export type ServerProviderModel = typeof ServerProviderModel.Type;

export const ServerProviderQuotaSnapshot = Schema.Struct({
  key: TrimmedNonEmptyString,
  entitlementRequests: NonNegativeInt,
  usedRequests: NonNegativeInt,
  remainingRequests: NonNegativeInt,
  remainingPercentage: Schema.Number,
  overage: NonNegativeInt,
  overageAllowedWithExhaustedQuota: Schema.Boolean,
  resetDate: Schema.optional(IsoDateTime),
});
export type ServerProviderQuotaSnapshot = typeof ServerProviderQuotaSnapshot.Type;

export const ServerProviderStatus = Schema.Struct({
  provider: ProviderKind,
  status: ServerProviderStatusState,
  available: Schema.Boolean,
  authStatus: ServerProviderAuthStatus,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
  models: Schema.optional(Schema.Array(ServerProviderModel)),
  quotaSnapshots: Schema.optional(Schema.Array(ServerProviderQuotaSnapshot)),
});
export type ServerProviderStatus = typeof ServerProviderStatus.Type;

const ServerProviderStatuses = Schema.Array(ServerProviderStatus);

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviderStatuses,
  availableEditors: Schema.Array(EditorId),
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerImportSnapshotProjectBinding = Schema.Struct({
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
});
export type ServerImportSnapshotProjectBinding = typeof ServerImportSnapshotProjectBinding.Type;

export const ServerImportSnapshotInput = Schema.Struct({
  snapshot: OrchestrationReadModel,
  projectBindings: Schema.optional(Schema.Array(ServerImportSnapshotProjectBinding)),
});
export type ServerImportSnapshotInput = typeof ServerImportSnapshotInput.Type;

export const ServerImportSnapshotResult = Schema.Struct({
  importedProjectCount: NonNegativeInt,
  importedThreadCount: NonNegativeInt,
  snapshotSequence: NonNegativeInt,
});
export type ServerImportSnapshotResult = typeof ServerImportSnapshotResult.Type;

export const ServerCheckPathsInput = Schema.Struct({
  paths: Schema.Array(TrimmedNonEmptyString),
});
export type ServerCheckPathsInput = typeof ServerCheckPathsInput.Type;

export const ServerPathCheck = Schema.Struct({
  path: TrimmedNonEmptyString,
  exists: Schema.Boolean,
  isDirectory: Schema.Boolean,
});
export type ServerPathCheck = typeof ServerPathCheck.Type;

export const ServerCheckPathsResult = Schema.Struct({
  paths: Schema.Array(ServerPathCheck),
});
export type ServerCheckPathsResult = typeof ServerCheckPathsResult.Type;

export const ServerWarmLocalSpeechModelInput = Schema.Struct({
  model: TrimmedNonEmptyString,
});
export type ServerWarmLocalSpeechModelInput = typeof ServerWarmLocalSpeechModelInput.Type;

export const ServerWarmLocalSpeechModelResult = Schema.Struct({
  ready: Schema.Boolean,
});
export type ServerWarmLocalSpeechModelResult = typeof ServerWarmLocalSpeechModelResult.Type;

export const ServerTranscribeAudioInput = Schema.Struct({
  provider: Schema.Literals(["local", "together", "elevenlabs"]),
  apiKey: Schema.String.check(Schema.isMaxLength(4096)),
  model: TrimmedNonEmptyString,
  language: Schema.String.check(Schema.isMaxLength(16)),
  mimeType: Schema.String.check(Schema.isMaxLength(128)),
  audioBase64: Schema.String,
});
export type ServerTranscribeAudioInput = typeof ServerTranscribeAudioInput.Type;

export const ServerTranscribeAudioResult = Schema.Struct({
  text: Schema.String,
});
export type ServerTranscribeAudioResult = typeof ServerTranscribeAudioResult.Type;

export const ServerUpsertKeybindingInput = KeybindingRule;
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  providers: ServerProviderStatuses,
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;
