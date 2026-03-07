import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export interface GeminiCliResolution {
  readonly available: boolean;
  readonly installed: boolean;
  readonly command: string;
  readonly args: readonly string[];
  readonly executableCommand: string;
  readonly setupCommand: string;
  readonly headlessCommand: string;
  readonly message?: string;
}

export interface GeminiConfiguredAuth {
  readonly authType: string | null;
  readonly authStatus: "authenticated" | "unauthenticated" | "unknown";
}

export function getGeminiSettingsPath(): string {
  return path.join(os.homedir(), ".gemini", "settings.json");
}

async function runShellProbe(command: string, args: readonly string[]): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      env: process.env,
      shell: false,
    });

    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

async function commandExists(command: string): Promise<boolean> {
  if (command.includes(path.sep)) {
    try {
      await fs.access(command);
      return true;
    } catch {
      return false;
    }
  }

  if (process.platform === "win32") {
    return runShellProbe("where", [command]);
  }

  const escaped = command.replaceAll("'", "'\\''");
  return runShellProbe("sh", ["-lc", `command -v '${escaped}' >/dev/null 2>&1`]);
}

export async function resolveGeminiCli(): Promise<GeminiCliResolution> {
  if (await commandExists("gemini")) {
    return {
      available: true,
      installed: true,
      command: "gemini",
      args: [],
      executableCommand: "gemini",
      setupCommand: "gemini",
      headlessCommand: 'gemini -p "<prompt>" -o stream-json --approval-mode yolo',
    };
  }

  if (await commandExists("npx")) {
    return {
      available: true,
      installed: false,
      command: "npx",
      args: ["-y", "@google/gemini-cli"],
      executableCommand: "npx -y @google/gemini-cli",
      setupCommand: "npx -y @google/gemini-cli",
      headlessCommand:
        'npx -y @google/gemini-cli -p "<prompt>" -o stream-json --approval-mode yolo',
      message: "Gemini CLI will be fetched via npx on first use.",
    };
  }

  return {
    available: false,
    installed: false,
    command: "gemini",
    args: [],
    executableCommand: "gemini",
    setupCommand: "gemini",
    headlessCommand: 'gemini -p "<prompt>" -o stream-json --approval-mode yolo',
    message: "Gemini CLI requires `gemini` or `npx` to be available on PATH.",
  };
}

function readAuthTypeFromEnv(): string | null {
  if (process.env.GOOGLE_GENAI_USE_GCA) {
    return "oauth-personal";
  }
  if (process.env.GEMINI_API_KEY) {
    return "gemini-api-key";
  }
  if (process.env.GOOGLE_GENAI_USE_VERTEXAI) {
    return "vertex-ai";
  }
  return null;
}

async function readAuthTypeFromSettings(): Promise<string | null> {
  try {
    const raw = await fs.readFile(getGeminiSettingsPath(), "utf8");
    const parsed = JSON.parse(raw) as {
      security?: { auth?: { selectedType?: unknown } };
    };
    const authType = parsed.security?.auth?.selectedType;
    return typeof authType === "string" && authType.trim().length > 0 ? authType : null;
  } catch {
    return null;
  }
}

export async function readConfiguredGeminiAuth(): Promise<GeminiConfiguredAuth> {
  const authType = readAuthTypeFromEnv() ?? (await readAuthTypeFromSettings());
  if (!authType) {
    return {
      authType: null,
      authStatus: "unauthenticated",
    };
  }

  return {
    authType,
    authStatus: authType === "oauth-personal" ? "unknown" : "authenticated",
  };
}

export interface GeminiHeadlessCommandInput {
  readonly prompt: string;
  readonly model?: string;
  readonly sessionId?: string;
}

export function buildGeminiHeadlessArgs(
  resolution: GeminiCliResolution,
  input: GeminiHeadlessCommandInput,
): string[] {
  const args = [
    ...resolution.args,
    "-p",
    input.prompt,
    "-o",
    "stream-json",
    "--approval-mode",
    "yolo",
  ];

  if (input.model && input.model.trim().length > 0) {
    args.push("-m", input.model);
  }

  if (input.sessionId && input.sessionId.trim().length > 0) {
    args.push("--resume", input.sessionId);
  }

  return args;
}
