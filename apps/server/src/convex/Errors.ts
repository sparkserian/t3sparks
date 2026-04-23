import { Schema } from "effect";

export class ConvexError extends Schema.TaggedErrorClass<ConvexError>()("ConvexError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}
