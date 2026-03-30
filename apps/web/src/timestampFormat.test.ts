import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatRelativeTimeLabel,
  formatShortTimestamp,
  formatTimestamp,
} from "./timestampFormat";

describe("timestampFormat helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes explicit hour preferences to Intl.DateTimeFormat", () => {
    class MockDateTimeFormat {
      constructor(
        _locales?: Intl.LocalesArgument,
        private readonly options?: Intl.DateTimeFormatOptions,
      ) {}

      format() {
        return JSON.stringify(this.options);
      }
    }

    const formatterSpy = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(
        (function (
          locales?: Intl.LocalesArgument,
          options?: Intl.DateTimeFormatOptions,
        ) {
          return new MockDateTimeFormat(locales, options) as Intl.DateTimeFormat;
        }) as typeof Intl.DateTimeFormat,
      );

    expect(formatTimestamp("2026-03-01T12:34:56.000Z", "locale")).toContain('"second":"2-digit"');
    expect(formatTimestamp("2026-03-01T12:34:56.000Z", "12-hour")).toContain('"hour12":true');
    expect(formatShortTimestamp("2026-03-01T12:34:56.000Z", "24-hour")).toContain(
      '"hour12":false',
    );

    expect(formatterSpy).toHaveBeenCalled();
  });

  it("keeps relative labels unchanged", () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();

    expect(formatRelativeTimeLabel(tenMinutesAgo)).toBe("10m ago");
  });
});
