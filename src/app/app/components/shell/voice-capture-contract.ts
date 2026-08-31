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

/**
 * N3C r26 · LAS DOS CONSTANTES DE TIEMPO DE LA VOZ, MEDIDAS EN LA REFERENCIA.
 *
 * Enganché `AnalyserNode.getByteFrequencyData` en la página de ElevenLabs para
 * leer la MISMA señal que su orbe consume, y capturé sus píxeles en el mismo
 * cuadro. Con 1.081 cuadros pareados, ajustando exponenciales de una constante:
 *
 *   · el MOVIMIENTO del orbe sigue al sonido con τ ≈ 15–30 ms (r = 0,63) y con
 *     retraso CERO — la turbulencia es prácticamente instantánea;
 *   · el BRILLO sigue una envolvente MUCHO más lenta, τ ≈ 900 ms (r = 0,75),
 *     con el ajuste cayendo a los dos lados (0,72 a 500 ms, 0,69 a 1.600).
 *
 * Un solo envolvente no puede ser las dos cosas, y por eso el orbe de N3C-3
 * —que movía todo con uno de ~196 ms— se sentía a la vez perezoso al empezar a
 * hablar y nervioso al callarse.
 *
 * También probé envolventes ASIMÉTRICOS (ataque rápido, caída lenta), que es lo
 * que uno esperaría de un medidor de audio: NO ganan. El mejor asimétrico da
 * 0,729 contra 0,745 del simétrico en brillo, y 0,627 contra 0,633 en
 * movimiento. Los suyos son exponenciales simétricos, y por eso acá también.
 */
export const VOICE_MOTION_TAU_MS = 25;
export const VOICE_SHAPE_TAU_MS = 900;

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

/**
 * N3C r26 · EL NIVEL QUE MIDEN ELLOS: el promedio del espectro.
 *
 * Su shader declara `uAudioAverage`, y el método que enganché confirma de dónde
 * sale: `getByteFrequencyData`, promediado y dividido por 255. No es el RMS de
 * la onda —que pesa sobre todo los graves y la sonoridad general—: es el
 * promedio de TODAS las bandas, así que una voz (que es de banda ancha) sube
 * mucho más que un zumbido grave del mismo volumen.
 *
 * La escala importa y por eso esta función NO la reescala: las ganancias del
 * dipolo radial están calibradas contra ESTOS números. En su muestra, hablando
 * normal, el promedio instantáneo llegó a 0,36 y su envolvente lenta a 0,217.
 */
export function spectrumAverage(bins: Uint8Array): number {
  if (bins.length === 0) return 0;
  let sum = 0;
  for (const bin of bins) sum += bin;
  return Math.min(1, Math.max(0, sum / (bins.length * 255)));
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

/**
 * N3C r26 · UN ENVOLVENTE EXPONENCIAL EN SEGUNDOS, NO EN CUADROS.
 *
 * El anterior avanzaba una fracción fija POR CUADRO y compensaba con un
 * `frameScale`, que es la misma trampa que N3C-8 mató en el fluido: un teléfono
 * de 120 Hz llegaba al mismo destino en la mitad del tiempo. Acá la constante
 * de tiempo es física —τ en milisegundos— y el paso sale del reloj, así que la
 * voz se siente igual en cualquier pantalla.
 */
export function advanceVoiceTau(
  current: number,
  target: number,
  dtSeconds: number,
  tauMs: number,
): number {
  const dt = Math.max(0, dtSeconds);
  const tau = Math.max(0.001, tauMs / 1_000);
  return current + (target - current) * (1 - Math.exp(-dt / tau));
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
