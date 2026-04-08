import type { DesktopMediaAccessStatus, NativeApi } from "@t3sparks/contracts";

import type { AppSettings } from "../appSettings";
import SpeechToTextWorker from "./speechToText.worker?worker";

export const SPEECH_TO_TEXT_SETTINGS_HASH = "speech-to-text";

export const SPEECH_TO_TEXT_MODE_OPTIONS = [
  {
    value: "disabled",
    label: "Disabled",
    description: "Hide dictation behind setup until you choose a local or cloud transcription path.",
  },
  {
    value: "local",
    label: "Local on-device",
    description: "Download a local Whisper model and run dictation on this device.",
  },
  {
    value: "together",
    label: "Together.ai cloud",
    description: "Send recorded audio to Together.ai with your own API key.",
  },
  {
    value: "elevenlabs",
    label: "ElevenLabs cloud",
    description: "Send recorded audio to ElevenLabs Scribe with your own API key.",
  },
] as const;

export const LOCAL_SPEECH_MODEL_OPTIONS = [
  {
    value: "onnx-community/whisper-tiny.en",
    label: "Whisper Tiny English",
    description: "Fastest local option for English dictation.",
  },
  {
    value: "onnx-community/whisper-base.en",
    label: "Whisper Base English",
    description: "Higher accuracy for English at the cost of more download size and latency.",
  },
  {
    value: "onnx-community/whisper-tiny",
    label: "Whisper Tiny Multilingual",
    description: "Small multilingual local model when you need more than English.",
  },
] as const;

export const TOGETHER_SPEECH_MODEL_OPTIONS = [
  {
    value: "openai/whisper-large-v3",
    label: "OpenAI Whisper Large v3",
    description: "Best default for high-accuracy general dictation.",
  },
  {
    value: "mistralai/Voxtral-Mini-3B-2507",
    label: "Mistral Voxtral Mini 3B",
    description: "Alternative cloud model with smaller latency and cost profile.",
  },
  {
    value: "nvidia/parakeet-tdt-0.6b-v3",
    label: "NVIDIA Parakeet TDT 0.6B v3",
    description: "Fast cloud transcription with good short-form dictation quality.",
  },
] as const;

export const ELEVENLABS_SPEECH_MODEL_OPTIONS = [
  {
    value: "scribe_v2",
    label: "Scribe v2",
    description: "Best default for ElevenLabs speech recognition with the newest model.",
  },
  {
    value: "scribe_v1",
    label: "Scribe v1",
    description: "Older ElevenLabs transcription model kept here as a fallback option.",
  },
] as const;

export const SPEECH_TO_TEXT_LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Chinese" },
] as const;

type SpeechSettings = Pick<
  AppSettings,
  | "speechToTextMode"
  | "speechToTextLocalModel"
  | "speechToTextTogetherApiKey"
  | "speechToTextTogetherModel"
  | "speechToTextElevenLabsApiKey"
  | "speechToTextElevenLabsModel"
  | "speechToTextLanguage"
>;

export interface SpeechCaptureSession {
  stop: () => Promise<SpeechCaptureResult>;
  cancel: () => void;
}

export type MicrophonePermissionState = PermissionState | "unknown";

export interface SpeechCaptureResult {
  blob: Blob;
  detectedSignal: boolean | null;
  maxSignal: number | null;
  permissionState: MicrophonePermissionState;
  inputLabel: string | null;
}

export interface SpeechToTextStatusUpdate {
  message: string;
  progress: number | null;
}

type SpeechWorkerRequest =
  | { id: string; type: "warm"; model: string }
  | { id: string; type: "transcribe"; model: string; language: string; audio: Float32Array };

type SpeechWorkerResponse =
  | { id: string; type: "status"; message: string; progress: number | null }
  | { id: string; type: "ready" }
  | { id: string; type: "result"; text: string }
  | { id: string; type: "error"; message: string };

interface WorkerPendingRequest {
  resolve: (value: string | void) => void;
  reject: (error: Error) => void;
  onStatus?: (status: SpeechToTextStatusUpdate) => void;
}

let speechWorker: Worker | null = null;
let speechWorkerRequestCount = 0;
const pendingWorkerRequests = new Map<string, WorkerPendingRequest>();

const AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;
const MICROPHONE_SIGNAL_THRESHOLD = 0.002;

function getSpeechWorker(): Worker {
  if (speechWorker) {
    return speechWorker;
  }

  const worker = new SpeechToTextWorker();
  worker.addEventListener("message", (event: MessageEvent<SpeechWorkerResponse>) => {
    const payload = event.data;
    const pending = pendingWorkerRequests.get(payload.id);
    if (!pending) {
      return;
    }

    if (payload.type === "status") {
      pending.onStatus?.({
        message: payload.message,
        progress: payload.progress,
      });
      return;
    }

    pendingWorkerRequests.delete(payload.id);
    if (payload.type === "ready") {
      pending.resolve();
      return;
    }
    if (payload.type === "result") {
      pending.resolve(payload.text);
      return;
    }
    pending.reject(new Error(payload.message));
  });
  worker.addEventListener("error", (event) => {
    for (const [requestId, pending] of pendingWorkerRequests.entries()) {
      pendingWorkerRequests.delete(requestId);
      pending.reject(event.error instanceof Error ? event.error : new Error("Speech worker failed."));
    }
  });
  speechWorker = worker;
  return worker;
}

function dispatchSpeechWorkerRequest(
  request: SpeechWorkerRequest,
  transfer: Transferable[] = [],
  onStatus?: (status: SpeechToTextStatusUpdate) => void,
): Promise<string | void> {
  const worker = getSpeechWorker();
  return new Promise((resolve, reject) => {
    pendingWorkerRequests.set(request.id, onStatus ? { resolve, reject, onStatus } : { resolve, reject });
    worker.postMessage(request, transfer);
  });
}

function nextSpeechWorkerRequestId(): string {
  speechWorkerRequestCount += 1;
  return `speech-${speechWorkerRequestCount}`;
}

function preferredAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }
  return AUDIO_MIME_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

async function readMicrophonePermissionState(): Promise<MicrophonePermissionState> {
  if (
    typeof navigator === "undefined" ||
    !("permissions" in navigator) ||
    typeof navigator.permissions.query !== "function"
  ) {
    return "unknown";
  }

  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status.state;
  } catch {
    return "unknown";
  }
}

function normalizeDesktopMediaAccessStatus(
  status: DesktopMediaAccessStatus,
): MicrophonePermissionState {
  switch (status) {
    case "granted":
      return "granted";
    case "not-determined":
      return "prompt";
    case "restricted":
    case "denied":
      return "denied";
    case "unknown":
      return "unknown";
  }
}

async function requestDesktopMicrophoneAccess(): Promise<MicrophonePermissionState> {
  if (typeof window === "undefined" || !window.desktopBridge) {
    return "unknown";
  }

  try {
    const currentStatus = normalizeDesktopMediaAccessStatus(
      await window.desktopBridge.getMediaAccessStatus("microphone"),
    );
    if (currentStatus === "granted") {
      return currentStatus;
    }

    const granted = await window.desktopBridge.askForMediaAccess("microphone");
    if (granted) {
      return "granted";
    }

    return normalizeDesktopMediaAccessStatus(
      await window.desktopBridge.getMediaAccessStatus("microphone"),
    );
  } catch {
    return "unknown";
  }
}

function getAudioContextConstructor(): typeof AudioContext {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;

  if (!AudioContextConstructor) {
    throw new Error("This build does not support local audio decoding.");
  }

  return AudioContextConstructor;
}

function startMicrophoneSignalMonitor(stream: MediaStream): {
  stop: () => Promise<{ detectedSignal: boolean | null; maxSignal: number | null }>;
} {
  try {
    const AudioContextConstructor = getAudioContextConstructor();
    const audioContext = new AudioContextConstructor();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    const sampleBuffer = new Float32Array(analyser.fftSize);
    let peakSignal = 0;
    source.connect(analyser);
    void audioContext.resume().catch(() => undefined);

    const intervalId = window.setInterval(() => {
      analyser.getFloatTimeDomainData(sampleBuffer);
      let framePeak = 0;
      for (const sample of sampleBuffer) {
        const absoluteValue = Math.abs(sample);
        if (absoluteValue > framePeak) {
          framePeak = absoluteValue;
        }
      }
      if (framePeak > peakSignal) {
        peakSignal = framePeak;
      }
    }, 75);

    return {
      stop: async () => {
        window.clearInterval(intervalId);
        source.disconnect();
        analyser.disconnect();
        await audioContext.close().catch(() => undefined);
        return {
          detectedSignal: peakSignal >= MICROPHONE_SIGNAL_THRESHOLD,
          maxSignal: peakSignal,
        };
      },
    };
  } catch {
    return {
      stop: async () => ({
        detectedSignal: null,
        maxSignal: null,
      }),
    };
  }
}

async function decodeAudioBlobToMono16k(blob: Blob): Promise<Float32Array> {
  const AudioContextConstructor = getAudioContextConstructor();
  const decodeContext = new AudioContextConstructor();
  try {
    const audioBuffer = await decodeContext.decodeAudioData(await blob.arrayBuffer());
    const frameCount = Math.max(1, Math.ceil(audioBuffer.duration * 16_000));
    const renderContext = new OfflineAudioContext(1, frameCount, 16_000);
    const source = renderContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(renderContext.destination);
    source.start(0);
    const rendered = await renderContext.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    await decodeContext.close().catch(() => undefined);
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

function float32ArrayToBase64(audio: Float32Array): string {
  const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

async function transcribeWithTogether(
  blob: Blob,
  settings: SpeechSettings,
  api: NativeApi,
  onStatus?: (status: SpeechToTextStatusUpdate) => void,
): Promise<string> {
  onStatus?.({ message: "Uploading audio to Together.ai...", progress: null });
  const result = await api.server.transcribeAudio({
    provider: "together",
    apiKey: settings.speechToTextTogetherApiKey.trim(),
    model: settings.speechToTextTogetherModel,
    language: settings.speechToTextLanguage,
    mimeType: blob.type || "audio/webm",
    audioBase64: await blobToBase64(blob),
  });
  return result.text.trim();
}

async function transcribeWithElevenLabs(
  blob: Blob,
  settings: SpeechSettings,
  api: NativeApi,
  onStatus?: (status: SpeechToTextStatusUpdate) => void,
): Promise<string> {
  onStatus?.({ message: "Uploading audio to ElevenLabs...", progress: null });
  const result = await api.server.transcribeAudio({
    provider: "elevenlabs",
    apiKey: settings.speechToTextElevenLabsApiKey.trim(),
    model: settings.speechToTextElevenLabsModel,
    language: settings.speechToTextLanguage,
    mimeType: blob.type || "audio/webm",
    audioBase64: await blobToBase64(blob),
  });
  return result.text.trim();
}

async function transcribeLocally(
  blob: Blob,
  settings: SpeechSettings,
  api: NativeApi,
  onStatus?: (status: SpeechToTextStatusUpdate) => void,
): Promise<string> {
  if (!window.desktopBridge) {
    onStatus?.({ message: "Preparing local audio...", progress: null });
    const audio = await decodeAudioBlobToMono16k(blob);
    const requestId = nextSpeechWorkerRequestId();
    const response = await dispatchSpeechWorkerRequest(
      {
        id: requestId,
        type: "transcribe",
        model: settings.speechToTextLocalModel,
        language: settings.speechToTextLanguage,
        audio,
      },
      [audio.buffer],
      onStatus,
    );
    return typeof response === "string" ? response.trim() : "";
  }

  onStatus?.({ message: "Preparing local audio...", progress: null });
  const audio = await decodeAudioBlobToMono16k(blob);
  onStatus?.({ message: "Running local transcription on this device...", progress: null });
  const result = await api.server.transcribeAudio({
    provider: "local",
    apiKey: "",
    model: settings.speechToTextLocalModel,
    language: settings.speechToTextLanguage,
    mimeType: "audio/pcm-f32le",
    audioBase64: float32ArrayToBase64(audio),
  });
  return result.text.trim();
}

export function isSpeechToTextConfigured(settings: SpeechSettings): boolean {
  switch (settings.speechToTextMode) {
    case "disabled":
      return false;
    case "local":
      return settings.speechToTextLocalModel.trim().length > 0;
    case "together":
      return (
        settings.speechToTextTogetherModel.trim().length > 0 &&
        settings.speechToTextTogetherApiKey.trim().length > 0
      );
    case "elevenlabs":
      return (
        settings.speechToTextElevenLabsModel.trim().length > 0 &&
        settings.speechToTextElevenLabsApiKey.trim().length > 0
      );
  }
}

export function getSpeechToTextSetupMessage(settings: SpeechSettings): string {
  switch (settings.speechToTextMode) {
    case "disabled":
      return "Speech to text is not set up yet. Choose a local model or Together.ai in Settings first.";
    case "local":
      return "Pick a local speech model in Settings before starting dictation.";
    case "together":
      return "Add your Together.ai API key in Settings before starting dictation.";
    case "elevenlabs":
      return "Add your ElevenLabs API key in Settings before starting dictation.";
  }
}

export function appendTranscriptionToPrompt(currentPrompt: string, transcript: string): string {
  const normalizedTranscript = transcript.trim();
  if (!normalizedTranscript) {
    return currentPrompt;
  }
  if (!currentPrompt.trim()) {
    return normalizedTranscript;
  }
  if (/\s$/.test(currentPrompt)) {
    return `${currentPrompt}${normalizedTranscript}`;
  }
  return `${currentPrompt} ${normalizedTranscript}`;
}

export async function startSpeechCapture(): Promise<SpeechCaptureSession> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== "function"
  ) {
    throw new Error("Microphone capture is not available in this environment.");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("This build does not support microphone recording.");
  }

  const desktopPermissionState = await requestDesktopMicrophoneAccess();
  const initialPermissionState =
    desktopPermissionState !== "unknown"
      ? desktopPermissionState
      : await readMicrophonePermissionState();
  if (initialPermissionState === "denied") {
    throw new Error(
      "Microphone access is blocked. Allow T3 Sparks to use the microphone in macOS System Settings, then try again.",
    );
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      throw new Error(
        "Microphone access is blocked. Allow T3 Sparks to use the microphone, then try again.",
        { cause: error },
      );
    }
    throw error;
  }

  const audioTrack = stream.getAudioTracks()[0] ?? null;
  if (!audioTrack || audioTrack.readyState !== "live") {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(
      "No live microphone input was available. Check the selected input device and try again.",
    );
  }
  const inputLabel = audioTrack.label.trim().length > 0 ? audioTrack.label.trim() : null;

  const permissionState =
    desktopPermissionState !== "unknown"
      ? desktopPermissionState
      : await readMicrophonePermissionState();
  const signalMonitor = startMicrophoneSignalMonitor(stream);
  const mimeType = preferredAudioMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  let completed = false;

  const cleanup = () => {
    if (completed) {
      return;
    }
    completed = true;
    for (const track of stream.getTracks()) {
      track.stop();
    }
  };

  const stopPromise = new Promise<SpeechCaptureResult>((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });
    recorder.addEventListener("stop", () => {
      cleanup();
      void signalMonitor.stop().then((signalState) => {
        resolve({
          blob: new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }),
          permissionState,
          detectedSignal: signalState.detectedSignal,
          maxSignal: signalState.maxSignal,
          inputLabel,
        });
      });
    });
    recorder.addEventListener("error", (event) => {
      cleanup();
      void signalMonitor.stop().finally(() => {
        reject(event.error ?? new Error("Failed to record audio."));
      });
    });
  });

  recorder.start();

  return {
    stop: async () => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      return stopPromise;
    },
    cancel: () => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      } else {
        cleanup();
      }
    },
  };
}

export async function warmLocalSpeechModel(
  settings: SpeechSettings,
  api: NativeApi,
  onStatus?: (status: SpeechToTextStatusUpdate) => void,
): Promise<void> {
  if (settings.speechToTextMode !== "local") {
    throw new Error("Select Local on-device mode before downloading a local model.");
  }

  if (window.desktopBridge) {
    onStatus?.({ message: "Preparing local model on this device...", progress: null });
    await api.server.warmLocalSpeechModel({
      model: settings.speechToTextLocalModel,
    });
    return;
  }

  const requestId = nextSpeechWorkerRequestId();
  await dispatchSpeechWorkerRequest(
    {
      id: requestId,
      type: "warm",
      model: settings.speechToTextLocalModel,
    },
    [],
    onStatus,
  );
}

export async function transcribeSpeechBlob(
  blob: Blob,
  settings: SpeechSettings,
  api: NativeApi,
  onStatus?: (status: SpeechToTextStatusUpdate) => void,
): Promise<string> {
  if (!isSpeechToTextConfigured(settings)) {
    throw new Error(getSpeechToTextSetupMessage(settings));
  }

  if (settings.speechToTextMode === "local") {
    return transcribeLocally(blob, settings, api, onStatus);
  }

  if (settings.speechToTextMode === "elevenlabs") {
    return transcribeWithElevenLabs(blob, settings, api, onStatus);
  }

  return transcribeWithTogether(blob, settings, api, onStatus);
}
