import { describe, expect, it } from "vitest";

import { formatChatMarkdownDisplayText } from "./chatMarkdownDisplay";

describe("formatChatMarkdownDisplayText", () => {
  it("keeps paragraph spacing stable when a streamed response pauses", () => {
    const input =
      "This is the first sentence of a response that keeps arriving in chunks without explicit paragraph breaks. This is the second sentence that should stay grouped with the first. This is the third sentence that should remain in its own paragraph even if the provider pauses.";

    expect(formatChatMarkdownDisplayText(input, true)).toBe(
      formatChatMarkdownDisplayText(input, false),
    );
    expect(formatChatMarkdownDisplayText(input, false)).toBe(
      "This is the first sentence of a response that keeps arriving in chunks without explicit paragraph breaks. This is the second sentence that should stay grouped with the first.\n\nThis is the third sentence that should remain in its own paragraph even if the provider pauses.",
    );
  });
});
