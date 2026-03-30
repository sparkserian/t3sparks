import { describe, expect, it } from "vitest";
import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3sparks/contracts";

import {
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdatePrimaryActionLabel,
  getDesktopUpdateSummary,
  isDesktopUpdateCheckActionDisabled,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldHighlightDesktopUpdateError,
  shouldShowDesktopUpdateCheckAction,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";

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

describe("desktop update button state", () => {
  it("shows a download action when an update is available", () => {
    const state: DesktopUpdateState = { ...baseState, status: "available", availableVersion: "1.1.0" };
    expect(shouldShowDesktopUpdateButton(state)).toBe(true);
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
    expect(getDesktopUpdateButtonTooltip(state)).toContain("background");
  });

  it("keeps retry action available after a download error", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "error",
      availableVersion: "1.1.0",
      message: "network timeout",
      errorContext: "download",
      canRetry: true,
    };
    expect(shouldShowDesktopUpdateButton(state)).toBe(true);
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
    expect(getDesktopUpdateButtonTooltip(state)).toContain("Click to retry");
  });

  it("keeps install action available after an install error", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "error",
      downloadedVersion: "1.1.0",
      availableVersion: "1.1.0",
      message: "shutdown timeout",
      errorContext: "install",
      canRetry: true,
    };
    expect(shouldShowDesktopUpdateButton(state)).toBe(true);
    expect(resolveDesktopUpdateButtonAction(state)).toBe("install");
    expect(getDesktopUpdateButtonTooltip(state)).toContain("Click to retry");
  });

  it("hides the button for non-actionable check errors", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "error",
      message: "network unavailable",
      errorContext: "check",
      canRetry: true,
    };
    expect(shouldShowDesktopUpdateButton(state)).toBe(false);
    expect(resolveDesktopUpdateButtonAction(state)).toBe("none");
  });

  it("disables the button while downloading", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "downloading",
      availableVersion: "1.1.0",
      downloadPercent: 42.5,
    };
    expect(shouldShowDesktopUpdateButton(state)).toBe(true);
    expect(isDesktopUpdateButtonDisabled(state)).toBe(true);
    expect(getDesktopUpdateButtonTooltip(state)).toContain("42%");
  });
});

describe("getDesktopUpdateActionError", () => {
  it("returns user-visible message for accepted failed attempts", () => {
    const result: DesktopUpdateActionResult = {
      accepted: true,
      completed: false,
      state: {
        ...baseState,
        status: "available",
        availableVersion: "1.1.0",
        message: "checksum mismatch",
        errorContext: "download",
        canRetry: true,
      },
    };
    expect(getDesktopUpdateActionError(result)).toBe("checksum mismatch");
  });

  it("ignores messages for non-accepted attempts", () => {
    const result: DesktopUpdateActionResult = {
      accepted: false,
      completed: false,
      state: {
        ...baseState,
        status: "error",
        message: "background failure",
        errorContext: "check",
        canRetry: false,
      },
    };
    expect(getDesktopUpdateActionError(result)).toBeNull();
  });

  it("ignores messages for successful attempts", () => {
    const result: DesktopUpdateActionResult = {
      accepted: true,
      completed: true,
      state: {
        ...baseState,
        status: "downloaded",
        downloadedVersion: "1.1.0",
        availableVersion: "1.1.0",
        message: null,
        errorContext: null,
        canRetry: true,
      },
    };
    expect(getDesktopUpdateActionError(result)).toBeNull();
  });
});

describe("desktop update UI helpers", () => {
  it("toasts only for accepted incomplete actions", () => {
    expect(
      shouldToastDesktopUpdateActionResult({
        accepted: true,
        completed: false,
        state: baseState,
      }),
    ).toBe(true);
    expect(
      shouldToastDesktopUpdateActionResult({
        accepted: true,
        completed: true,
        state: baseState,
      }),
    ).toBe(false);
  });

  it("highlights only actionable updater errors", () => {
    expect(
      shouldHighlightDesktopUpdateError({
        ...baseState,
        status: "error",
        errorContext: "download",
        canRetry: true,
      }),
    ).toBe(true);
    expect(
      shouldHighlightDesktopUpdateError({
        ...baseState,
        status: "error",
        errorContext: "check",
        canRetry: true,
      }),
    ).toBe(false);
  });

  it("builds a downloading summary with progress details", () => {
    const summary = getDesktopUpdateSummary({
      ...baseState,
      status: "downloading",
      availableVersion: "1.1.0",
      downloadPercent: 48.9,
    });
    expect(summary.title).toContain("48%");
    expect(summary.description).toContain("background");
  });

  it("shows check action only when not already downloading or ready to install", () => {
    expect(
      shouldShowDesktopUpdateCheckAction({
        ...baseState,
        status: "up-to-date",
      }),
    ).toBe(true);
    expect(
      shouldShowDesktopUpdateCheckAction({
        ...baseState,
        status: "downloading",
        availableVersion: "1.1.0",
      }),
    ).toBe(false);
    expect(
      shouldShowDesktopUpdateCheckAction({
        ...baseState,
        status: "downloaded",
        downloadedVersion: "1.1.0",
        availableVersion: "1.1.0",
      }),
    ).toBe(false);
  });

  it("disables manual checks while a check is already running", () => {
    expect(
      isDesktopUpdateCheckActionDisabled({
        ...baseState,
        status: "checking",
      }),
    ).toBe(true);
    expect(
      isDesktopUpdateCheckActionDisabled({
        ...baseState,
        status: "up-to-date",
      }),
    ).toBe(false);
  });

  it("returns action labels for download and install flows", () => {
    expect(
      getDesktopUpdatePrimaryActionLabel({
        ...baseState,
        status: "available",
        availableVersion: "1.1.0",
      }),
    ).toBe("Download 1.1.0");
    expect(
      getDesktopUpdatePrimaryActionLabel({
        ...baseState,
        status: "error",
        availableVersion: "1.1.0",
        errorContext: "download",
        canRetry: true,
      }),
    ).toBe("Retry download");
    expect(
      getDesktopUpdatePrimaryActionLabel({
        ...baseState,
        status: "downloaded",
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.0",
        canRetry: true,
      }),
    ).toBe("Install and restart");
  });
});
