import type { NativeApi } from "@t3sparks/contracts";
import { describe, expect, it, vi } from "vitest";

import { openResolvedLinkTarget, resolveLinkTarget, stripPathLineColumnSuffix } from "./linkTargets";

describe("resolveLinkTarget", () => {
  it("resolves internal app routes separately from filesystem paths", () => {
    expect(resolveLinkTarget("/chat/settings", undefined, "https://app.local/threads/1")).toEqual({
      kind: "internal",
      href: "/chat/settings",
    });
    expect(
      resolveLinkTarget("/Users/julius/project/src/main.ts", undefined, "https://app.local/threads/1"),
    ).toEqual({
      kind: "path",
      path: "/Users/julius/project/src/main.ts",
    });
  });

  it("keeps external urls external", () => {
    expect(resolveLinkTarget("https://example.com/docs", undefined, "https://app.local/")).toEqual({
      kind: "external",
      href: "https://example.com/docs",
    });
  });

  it("resolves relative markdown file links against the supplied cwd", () => {
    expect(resolveLinkTarget("src/app.tsx:42", "/Users/julius/project", "https://app.local/")).toEqual(
      {
        kind: "path",
        path: "/Users/julius/project/src/app.tsx:42",
      },
    );
  });
});

describe("openResolvedLinkTarget", () => {
  it("opens plain filesystem paths through the default app opener", async () => {
    const api = {
      shell: {
        openExternal: vi.fn(),
        openInEditor: vi.fn(),
        openPath: vi.fn().mockResolvedValue(undefined),
        showItemInFolder: vi.fn(),
      },
    } as Pick<NativeApi, "shell"> as NativeApi;

    await openResolvedLinkTarget(api, { kind: "path", path: "/tmp/file.txt" });

    expect(api.shell.openPath).toHaveBeenCalledWith("/tmp/file.txt");
    expect(api.shell.openInEditor).not.toHaveBeenCalled();
  });

  it("opens positioned filesystem paths in the preferred editor", async () => {
    const api = {
      shell: {
        openExternal: vi.fn(),
        openInEditor: vi.fn().mockResolvedValue(undefined),
        openPath: vi.fn(),
        showItemInFolder: vi.fn(),
      },
    } as Pick<NativeApi, "shell"> as NativeApi;

    await openResolvedLinkTarget(api, { kind: "path", path: "/tmp/file.tsx:12:4" });

    expect(api.shell.openInEditor).toHaveBeenCalledWith("/tmp/file.tsx:12:4", expect.any(String));
    expect(api.shell.openPath).not.toHaveBeenCalled();
  });
});

describe("stripPathLineColumnSuffix", () => {
  it("removes trailing line and column markers", () => {
    expect(stripPathLineColumnSuffix("/tmp/file.tsx:12:4")).toBe("/tmp/file.tsx");
    expect(stripPathLineColumnSuffix("/tmp/file.tsx")).toBe("/tmp/file.tsx");
  });
});
