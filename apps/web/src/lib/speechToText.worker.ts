/// <reference lib="webworker" />

type SpeechWorkerRequest =
  | { id: string; type: "warm"; model: string }
  | { id: string; type: "transcribe"; model: string; language: string; audio: Float32Array };

type SpeechWorkerResponse =
  | { id: string; type: "status"; message: string; progress: number | null }
  | { id: string; type: "ready" }
  | { id: string; type: "result"; text: string }
  | { id: string; type: "error"; message: string };

type AsrPipeline = (
  audio: Float32Array,
  options: {
    chunk_length_s: number;
    stride_length_s: number;
    language?: string;
    task?: "transcribe";
    return_timestamps: boolean;
  },
) => Promise<{ text?: string } | string>;

let activeModel: string | null = null;
let pipelinePromise: Promise<AsrPipeline> | null = null;
const LOCAL_PIPELINE_CACHE_RETRY_FRAGMENT = "object prototype may only be an object or null";

function emit(message: SpeechWorkerResponse): void {
  self.postMessage(message);
}

function isEnglishOnlyWhisperModel(model: string): boolean {
  return model.endsWith(".en");
}

function shouldRetryWithoutBrowserCache(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes(LOCAL_PIPELINE_CACHE_RETRY_FRAGMENT)
  );
}

async function createPipeline(
  model: string,
  requestId: string,
  options: {
    useBrowserCache: boolean;
    emitProgress: boolean;
  },
): Promise<AsrPipeline> {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.useBrowserCache = options.useBrowserCache;

  const pipelineOptions: {
    progress_callback?: (progress: { status?: string; progress?: number }) => void;
  } = {};

  if (options.emitProgress) {
    pipelineOptions.progress_callback = (progress: { status?: string; progress?: number }) => {
      emit({
        id: requestId,
        type: "status",
        message: progress.status?.trim() || "Loading local speech model...",
        progress: typeof progress.progress === "number" ? progress.progress : null,
      });
    };
  }

  return (await pipeline(
    "automatic-speech-recognition",
    model,
    pipelineOptions,
  )) as AsrPipeline;
}

async function getPipeline(model: string, requestId: string): Promise<AsrPipeline> {
  if (pipelinePromise && activeModel === model) {
    return pipelinePromise;
  }

  activeModel = model;
  pipelinePromise = (async () => {
    try {
      return await createPipeline(model, requestId, {
        useBrowserCache: true,
        emitProgress: true,
      });
    } catch (error) {
      if (!shouldRetryWithoutBrowserCache(error)) {
        throw error;
      }

      emit({
        id: requestId,
        type: "status",
        message: "Retrying local model setup without persistent browser cache...",
        progress: null,
      });

      return createPipeline(model, requestId, {
        useBrowserCache: false,
        emitProgress: false,
      });
    }
  })().catch((error) => {
    pipelinePromise = null;
    activeModel = null;
    throw error;
  });

  return pipelinePromise;
}

self.addEventListener("message", async (event: MessageEvent<SpeechWorkerRequest>) => {
  const request = event.data;
  try {
    const transcriber = await getPipeline(request.model, request.id);
    if (request.type === "warm") {
      emit({ id: request.id, type: "ready" });
      return;
    }

    emit({
      id: request.id,
      type: "status",
      message: "Running local transcription...",
      progress: null,
    });
    const transcriptionOptions: Parameters<AsrPipeline>[1] = {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    };
    if (!isEnglishOnlyWhisperModel(request.model)) {
      transcriptionOptions.task = "transcribe";
      if (request.language !== "auto") {
        transcriptionOptions.language = request.language;
      }
    }
    const result = await transcriber(request.audio, transcriptionOptions);
    emit({
      id: request.id,
      type: "result",
      text: typeof result === "string" ? result : result.text?.trim() || "",
    });
  } catch (error) {
    emit({
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : "Speech transcription failed.",
    });
  }
});
