const OPEN_ONBOARDING_EVENT = "t3sparks:open-onboarding";

export const DEFAULT_PROJECT_HOME_DIRECTORY_LABEL = "My Projects";

export function inferPathSeparator(input: string): "/" | "\\" {
  if (/^[A-Za-z]:\\/.test(input) || (input.includes("\\") && !input.includes("/"))) {
    return "\\";
  }
  return "/";
}

export function joinPathSegments(parentPath: string, childName: string): string {
  const trimmedParent = parentPath.trim().replace(/[\\/]+$/, "");
  const trimmedChild = childName.trim().replace(/^[\\/]+/, "");
  if (trimmedParent.length === 0) {
    return trimmedChild;
  }
  if (trimmedChild.length === 0) {
    return trimmedParent;
  }
  const separator = inferPathSeparator(trimmedParent);
  return `${trimmedParent}${separator}${trimmedChild}`;
}

export function sanitizeProjectDirectoryName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/['".,()[\]{}!@#$%^&*+=:?<>|`~]/g, " ")
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function suggestProjectDirectoryName(input: string): string {
  return sanitizeProjectDirectoryName(input) || "new-project";
}

export function splitParentPath(targetPath: string): { parentPath: string; directoryName: string } {
  const separator = inferPathSeparator(targetPath);
  const normalized = targetPath.trim().replace(/[\\/]+$/, "");
  const lastSeparatorIndex = normalized.lastIndexOf(separator);
  if (lastSeparatorIndex <= 0) {
    return {
      parentPath: "",
      directoryName: normalized,
    };
  }
  return {
    parentPath: normalized.slice(0, lastSeparatorIndex),
    directoryName: normalized.slice(lastSeparatorIndex + 1),
  };
}

export function requestOpenOnboarding(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(OPEN_ONBOARDING_EVENT));
}

export function subscribeToOnboardingRequests(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const handler = () => {
    listener();
  };
  window.addEventListener(OPEN_ONBOARDING_EVENT, handler);
  return () => {
    window.removeEventListener(OPEN_ONBOARDING_EVENT, handler);
  };
}
