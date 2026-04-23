import { Schema } from "effect";

export class GeminiError extends Schema.TaggedErrorClass<GeminiError>()("GeminiError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}
