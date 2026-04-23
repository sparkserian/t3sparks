import { describe, expect, it } from "vitest";

import {
  inferPathSeparator,
  joinPathSegments,
  sanitizeProjectDirectoryName,
  splitParentPath,
  suggestProjectDirectoryName,
} from "./onboarding";

describe("sanitizeProjectDirectoryName", () => {
  it("normalizes beginner-friendly folder names into predictable slugs", () => {
    expect(sanitizeProjectDirectoryName(" My First Website! ")).toBe("my-first-website");
  });

  it("removes path separators and punctuation", () => {
    expect(sanitizeProjectDirectoryName("client/app v2")).toBe("client-app-v2");
  });
});

describe("suggestProjectDirectoryName", () => {
  it("falls back to a safe default when the input has no usable characters", () => {
    expect(suggestProjectDirectoryName("!!!")).toBe("new-project");
  });
});

describe("joinPathSegments", () => {
  it("joins POSIX paths without duplicating separators", () => {
    expect(joinPathSegments("/Users/william/Downloads/", "my-projects")).toBe(
      "/Users/william/Downloads/my-projects",
    );
  });

  it("joins Windows paths with backslashes", () => {
    expect(joinPathSegments("C:\\Users\\Will\\Downloads", "my-projects")).toBe(
      "C:\\Users\\Will\\Downloads\\my-projects",
    );
  });
});

describe("inferPathSeparator", () => {
  it("prefers backslashes for windows-style paths", () => {
    expect(inferPathSeparator("C:\\Users\\Will")).toBe("\\");
  });
});

describe("splitParentPath", () => {
  it("splits a project home path into parent and folder name", () => {
    expect(splitParentPath("/Users/william/Downloads/my-projects")).toEqual({
      parentPath: "/Users/william/Downloads",
      directoryName: "my-projects",
    });
  });
});
