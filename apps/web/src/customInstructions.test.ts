import { describe, expect, it } from "vitest";

import {
  normalizeCustomInstructions,
  normalizeSelectedCustomInstructionIds,
  resolveSelectedCustomInstructions,
  summarizeCustomInstructionBody,
} from "./customInstructions";

describe("normalizeCustomInstructions", () => {
  it("trims values, removes invalid entries, and deduplicates by id", () => {
    expect(
      normalizeCustomInstructions([
        {
          id: " review ",
          title: " Keep diffs tight ",
          body: " Prefer smaller changes and point out risks. ",
        },
        {
          id: "review",
          title: "Duplicate",
          body: "This should be ignored.",
        },
        {
          id: "",
          title: "Missing id",
          body: "Ignored.",
        },
      ]),
    ).toEqual([
      {
        id: "review",
        title: "Keep diffs tight",
        body: "Prefer smaller changes and point out risks.",
      },
    ]);
  });
});

describe("normalizeSelectedCustomInstructionIds", () => {
  it("deduplicates and trims selected ids", () => {
    expect(
      normalizeSelectedCustomInstructionIds([" review ", "notes", "review", "", null]),
    ).toEqual(["review", "notes"]);
  });
});

describe("resolveSelectedCustomInstructions", () => {
  it("resolves selected instructions in checkbox order and drops stale ids", () => {
    const library = normalizeCustomInstructions([
      { id: "review", title: "Review", body: "Review carefully." },
      { id: "notes", title: "Notes", body: "Track follow-ups." },
    ]);

    expect(resolveSelectedCustomInstructions(library, ["notes", "missing", "review"])).toEqual([
      { id: "notes", title: "Notes", body: "Track follow-ups." },
      { id: "review", title: "Review", body: "Review carefully." },
    ]);
  });
});

describe("summarizeCustomInstructionBody", () => {
  it("returns a compact single-line summary", () => {
    expect(
      summarizeCustomInstructionBody(
        "Prefer smaller diffs.\n\nCall out risky assumptions before editing anything large.",
        40,
      ),
    ).toBe("Prefer smaller diffs. Call out risky…");
  });
});
