import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ConvexPackageManager = Schema.Literals(["bun", "npm", "pnpm", "yarn"]);
export type ConvexPackageManager = typeof ConvexPackageManager.Type;

export const ConvexStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ConvexStatusInput = typeof ConvexStatusInput.Type;

export const ConvexStatusResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  hasPackageJson: Schema.Boolean,
  packageManager: Schema.NullOr(ConvexPackageManager),
  hasConvexDependency: Schema.Boolean,
  hasConvexDirectory: Schema.Boolean,
  hasEnvLocal: Schema.Boolean,
  isConfigured: Schema.Boolean,
  installCommand: Schema.NullOr(TrimmedNonEmptyString),
  devCommand: Schema.NullOr(TrimmedNonEmptyString),
  deployCommand: Schema.NullOr(TrimmedNonEmptyString),
});
export type ConvexStatusResult = typeof ConvexStatusResult.Type;

export class ConvexStatusError extends Schema.TaggedErrorClass<ConvexStatusError>()(
  "ConvexStatusError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
