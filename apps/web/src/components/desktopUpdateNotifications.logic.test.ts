import { describe, expect, it } from "vitest";
import type { DesktopUpdateState } from "@t3sparks/contracts";

import { resolveDesktopUpdateNotification } from "./desktopUpdateNotifications.logic";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  currentVersion: "1.0.0",
  availableVersion: null,
  downloadedVersion: null,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

describe("resolveDesktopUpdateNotification", () => {
  it("announces an available update before download starts", () => {
    expect(
      resolveDesktopUpdateNotification(
        {
          ...baseState,
          status: "available",
          availableVersion: "1.1.0",
        },
        new Set(),
        new Set(),
      ),
    ).toEqual({
      kind: "available",
      version: "1.1.0",
      title: "Update available",
      description:
        "Version 1.1.0 is available and will download in the background.",
    });
  });

  it("announces an available update when the first observed state is downloading", () => {
    expect(
      resolveDesktopUpdateNotification(
        {
          ...baseState,
          status: "downloading",
          availableVersion: "1.1.0",
          downloadPercent: 3,
        },
        new Set(),
        new Set(),
      ),
    ).toEqual({
      kind: "available",
      version: "1.1.0",
      title: "Update available",
      description: "Version 1.1.0 is downloading in the background.",
    });
  });

  it("does not re-announce an already announced available version", () => {
    expect(
      resolveDesktopUpdateNotification(
        {
          ...baseState,
          status: "downloading",
          availableVersion: "1.1.0",
          downloadPercent: 40,
        },
        new Set(["1.1.0"]),
        new Set(),
      ),
    ).toBeNull();
  });

  it("announces a downloaded update once", () => {
    expect(
      resolveDesktopUpdateNotification(
        {
          ...baseState,
          status: "downloaded",
          availableVersion: "1.1.0",
          downloadedVersion: "1.1.0",
          downloadPercent: 100,
        },
        new Set(["1.1.0"]),
        new Set(),
      ),
    ).toEqual({
      kind: "downloaded",
      version: "1.1.0",
      title: "Update ready to install",
      description: "Version 1.1.0 has been downloaded.",
    });
  });

  it("does not announce a downloaded version twice", () => {
    expect(
      resolveDesktopUpdateNotification(
        {
          ...baseState,
          status: "downloaded",
          availableVersion: "1.1.0",
          downloadedVersion: "1.1.0",
          downloadPercent: 100,
        },
        new Set(["1.1.0"]),
        new Set(["1.1.0"]),
      ),
    ).toBeNull();
  });
});
