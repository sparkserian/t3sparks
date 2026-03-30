import type { NativeApi } from "@t3sparks/contracts";

import { resolveMarkdownFileLinkTarget } from "./markdown-links";
import { preferredTerminalEditor } from "./terminal-links";

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const LINE_COLUMN_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;
const SAME_DOCUMENT_HASH_PATTERN = /^#/;

export type ResolvedLinkTarget =
  | { kind: "external"; href: string }
  | { kind: "internal"; href: string }
  | { kind: "path"; path: string };

function defaultBaseUrl(baseUrl?: string): string {
  if (baseUrl) return baseUrl;
  if (typeof window !== "undefined" && window.location.href.length > 0) {
    return window.location.href;
  }
  return "https://app.local/";
}

function tryParseUrl(value: string, baseUrl?: string): URL | null {
  try {
    return new URL(value, defaultBaseUrl(baseUrl));
  } catch {
    return null;
  }
}

function normalizeInternalHref(parsedUrl: URL): string {
  return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
}

export function stripPathLineColumnSuffix(path: string): string {
  return path.replace(LINE_COLUMN_SUFFIX_PATTERN, "");
}

export function resolveLinkTarget(
  href: string | undefined,
  cwd?: string,
  baseUrl?: string,
): ResolvedLinkTarget | null {
  if (!href) return null;
  const trimmedHref = href.trim();
  if (trimmedHref.length === 0 || SAME_DOCUMENT_HASH_PATTERN.test(trimmedHref)) {
    return null;
  }

  const fileTarget = resolveMarkdownFileLinkTarget(trimmedHref, cwd);
  if (fileTarget) {
    return { kind: "path", path: fileTarget };
  }

  const parsedUrl = tryParseUrl(trimmedHref, baseUrl);
  if (!parsedUrl) {
    return trimmedHref.startsWith("/") ? { kind: "internal", href: trimmedHref } : null;
  }

  if (HTTP_PROTOCOLS.has(parsedUrl.protocol)) {
    const base = new URL(defaultBaseUrl(baseUrl));
    if (parsedUrl.origin === base.origin) {
      return { kind: "internal", href: normalizeInternalHref(parsedUrl) };
    }
    return { kind: "external", href: parsedUrl.toString() };
  }

  if (parsedUrl.protocol === "t3:") {
    return { kind: "internal", href: normalizeInternalHref(parsedUrl) };
  }

  return null;
}

export async function openResolvedLinkTarget(
  api: NativeApi,
  target: Exclude<ResolvedLinkTarget, { kind: "internal" }>,
): Promise<void> {
  if (target.kind === "external") {
    await api.shell.openExternal(target.href);
    return;
  }

  if (LINE_COLUMN_SUFFIX_PATTERN.test(target.path)) {
    await api.shell.openInEditor(target.path, preferredTerminalEditor());
    return;
  }

  await api.shell.openPath(target.path);
}
