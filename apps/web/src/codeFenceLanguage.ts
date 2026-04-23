const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;

const CODE_FENCE_LANGUAGE_ALIASES: Record<string, string> = {
  ".env": "bash",
  console: "bash",
  dotenv: "bash",
  env: "bash",
  envrc: "bash",
  plaintext: "text",
  shell: "bash",
  terminal: "bash",
  text: "text",
  txt: "text",
};

export function resolveCodeFenceLanguage(className: string | undefined): string {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  const rawLanguage = match?.[1]?.trim().toLowerCase() ?? "";

  if (!rawLanguage) {
    return "text";
  }

  return CODE_FENCE_LANGUAGE_ALIASES[rawLanguage] ?? rawLanguage;
}
