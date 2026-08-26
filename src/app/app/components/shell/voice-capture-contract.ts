import {
  AUDIO_MIMES,
  MAX_EVIDENCE_BYTES,
} from "@/lib/capture/evidence-file-contract";

export type OrbVoiceState =
  | "calm"
  | "listening"
  | "thinking"
  | "responding";

export type VoiceCaptureState =
  | "idle"
  | "requesting"
  | "denied"
  | "unsupported"
  | "recording"
  | "sending"
  | "transcribing"
  | "responding"
  | "failed";

export interface VoiceRecordingFormat {
  recorderMime: string;
  baseMime: string;
  extension: "webm" | "m4a";
}

const VOICE_RECORDING_FORMATS: readonly VoiceRecordingFormat[] = [
  {
    recorderMime: "audio/webm;codecs=opus",
    baseMime: "audio/webm",
    extension: "webm",
  },
  {
    recorderMime: "audio/webm",
    baseMime: "audio/webm",
    extension: "webm",
  },
  {
    recorderMime: "audio/mp4;codecs=mp4a.40.2",
    baseMime: "audio/mp4",
    extension: "m4a",
  },
  {
    recorderMime: "audio/mp4",
    baseMime: "audio/mp4",
    extension: "m4a",
  },
];

export const VOICE_MAX_DURATION_MS = 120_000;
export const VOICE_MAX_BYTES = MAX_EVIDENCE_BYTES;
export const VOICE_ATTACK = 0.085;
export const VOICE_FALL = 0.04;

export function baseAudioMime(mime: string): string | null {
  const base = mime.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  return AUDIO_MIMES.has(base) ? base : null;
}

export function selectVoiceRecordingFormat(
  isTypeSupported: (mime: string) => boolean,
): VoiceRecordingFormat | null {
  return (
    VOICE_RECORDING_FORMATS.find(
      (format) =>
        AUDIO_MIMES.has(format.baseMime) &&
        isTypeSupported(format.recorderMime),
    ) ?? null
  );
}

export function voiceFilename(format: VoiceRecordingFormat): string {
  return `nota-kipu.${format.extension}`;
}

export function rmsFromTimeDomain(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.min(1, Math.max(0, Math.sqrt(sum / samples.length)));
}

export function voiceTarget(
  state: OrbVoiceState,
  listeningLevel?: number,
): number {
  if (state === "calm") return 0.05;
  if (state === "thinking") return 0.42;
  if (state === "responding") return 0.46;
  const level = Number.isFinite(listeningLevel)
    ? Math.min(1, Math.max(0, listeningLevel ?? 0))
    : 0;
  return level * 0.75;
}

export function advanceVoiceEnvelope(
  current: number,
  target: number,
  frameScale = 1,
): number {
  const baseRate = target > current ? VOICE_ATTACK : VOICE_FALL;
  const rate = 1 - Math.pow(1 - baseRate, Math.max(0, frameScale));
  return current + (target - current) * rate;
}

export function stopMediaStreamTracks(
  stream: Pick<MediaStream, "getTracks"> | null,
): number {
  if (!stream) return 0;
  const tracks = stream.getTracks();
  for (const track of tracks) track.stop();
  return tracks.length;
}

export function voiceDeliverySucceeded(input: {
  status: string;
  deliveryError?: unknown;
} | null): boolean {
  return Boolean(
    input && input.status !== "failed" && input.deliveryError == null,
  );
}
