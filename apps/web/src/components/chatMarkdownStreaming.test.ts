import { describe, expect, it } from "vitest";

import { paragraphizeStreamingMarkdown } from "./chatMarkdownStreaming";

describe("paragraphizeStreamingMarkdown", () => {
  it("splits long plain prose into readable paragraphs while streaming", () => {
    const input =
      "This is the first sentence of a streamed response that keeps going without any explicit paragraph breaks. This is the second sentence that should be grouped with the first before the formatter creates some breathing room. This is the third sentence, which should begin a new paragraph instead of remaining in one giant block.";

    expect(paragraphizeStreamingMarkdown(input)).toBe(
      "This is the first sentence of a streamed response that keeps going without any explicit paragraph breaks. This is the second sentence that should be grouped with the first before the formatter creates some breathing room.\n\nThis is the third sentence, which should begin a new paragraph instead of remaining in one giant block.",
    );
  });

  it("preserves markdown lists and following prose", () => {
    const input = "- first\n- second\nHere is an explanation sentence that continues after the list. Here is another sentence that should remain readable.";

    expect(paragraphizeStreamingMarkdown(input)).toBe(
      "- first\n- second\nHere is an explanation sentence that continues after the list. Here is another sentence that should remain readable.",
    );
  });

  it("preserves fenced code blocks", () => {
    const input = [
      "Here is some setup text before the snippet. It should stay separate.",
      "```ts",
      "const answer = 42;",
      "console.log(answer);",
      "```",
      "After the code block there is more explanation. It should remain prose.",
    ].join("\n");

    expect(paragraphizeStreamingMarkdown(input)).toBe(
      [
        "Here is some setup text before the snippet. It should stay separate.",
        "```ts",
        "const answer = 42;",
        "console.log(answer);",
        "```",
        "After the code block there is more explanation. It should remain prose.",
      ].join("\n"),
    );
  });

  it("keeps explicit blank lines intact", () => {
    const input =
      "First paragraph is already present.\n\nSecond paragraph is already separated and should not be collapsed.";

    expect(paragraphizeStreamingMarkdown(input)).toBe(input);
  });
});
