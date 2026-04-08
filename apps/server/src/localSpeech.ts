import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";

type LocalSpeechPipeline = (
  audio: Float32Array,
  options: {
    chunk_length_s: number;
    stride_length_s: number;
    language?: string;
    task?: "transcribe";
    return_timestamps: boolean;
  },
) => Promise<{ text?: string } | string>;

const localSpeechPipelines = new Map<string, Promise<LocalSpeechPipeline>>();

function isEnglishOnlyWhisperModel(model: string): boolean {
  return model.endsWith(".en");
}

function resolveSpeechCacheDir(): string {
  const stateDir =
    process.env.T3SPARKS_STATE_DIR?.trim() || Path.join(OS.homedir(), ".t3sparks", "userdata");
  return Path.join(stateDir, "speech-model-cache");
}

async function createLocalSpeechPipeline(model: string): Promise<LocalSpeechPipeline> {
  const cacheDir = resolveSpeechCacheDir();
  await FS.mkdir(cacheDir, { recursive: true });

  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowRemoteModels = true;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.useFS = true;
  env.useFSCache = true;
  env.cacheDir = cacheDir;

  return (await pipeline("automatic-speech-recognition", model)) as LocalSpeechPipeline;
}

async function getLocalSpeechPipeline(model: string): Promise<LocalSpeechPipeline> {
  const existing = localSpeechPipelines.get(model);
  if (existing) {
    return existing;
  }

  const created = createLocalSpeechPipeline(model).catch((error) => {
    localSpeechPipelines.delete(model);
    throw error;
  });
  localSpeechPipelines.set(model, created);
  return created;
}

export async function warmLocalSpeechModel(model: string): Promise<void> {
  await getLocalSpeechPipeline(model);
}

export async function transcribeLocalAudio(
  model: string,
  language: string,
  audio: Float32Array,
): Promise<string> {
  const transcriber = await getLocalSpeechPipeline(model);
  const options: {
    chunk_length_s: number;
    stride_length_s: number;
    return_timestamps: boolean;
    task?: "transcribe";
    language?: string;
  } = {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: false,
  };

  if (!isEnglishOnlyWhisperModel(model)) {
    options.task = "transcribe";
  }

  if (!isEnglishOnlyWhisperModel(model) && language !== "auto") {
    options.language = language;
  }

  const result = await transcriber(audio, options);
  return typeof result === "string" ? result.trim() : result.text?.trim() || "";
}
