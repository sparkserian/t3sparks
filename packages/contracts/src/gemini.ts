import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";
import { ServerProviderAuthStatus } from "./server";

export const GeminiStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type GeminiStatusInput = typeof GeminiStatusInput.Type;

export const GeminiStatusResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  available: Schema.Boolean,
  installed: Schema.Boolean,
  executableCommand: TrimmedNonEmptyString,
  setupCommand: TrimmedNonEmptyString,
  headlessCommand: TrimmedNonEmptyString,
  settingsPath: TrimmedNonEmptyString,
  authType: Schema.NullOr(TrimmedNonEmptyString),
  authStatus: ServerProviderAuthStatus,
  message: Schema.optional(TrimmedNonEmptyString),
});
export type GeminiStatusResult = typeof GeminiStatusResult.Type;
