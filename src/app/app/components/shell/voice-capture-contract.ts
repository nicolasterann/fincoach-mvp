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

/**
 * N3C r27 · LOS AJUSTES DEL ANALIZADOR SON LOS SUYOS, LEÍDOS DE SU PÁGINA.
 *
 * La r26 puso el suavizado del analizador en CERO razonando que «el suavizado
 * debe vivir donde se pueda leer». Sonaba bien y estaba mal: los 25 ms que medí
 * son los que ellos agregan ENCIMA de su analizador, y su analizador ya viene
 * con `smoothingTimeConstant = 0.8` — unos 75 ms más. Quitarlo dejó nuestra
 * señal cuatro veces más nerviosa que la suya, y eso es literalmente el temblor
 * que el founder vio: «apenas prendo el micrófono todos los orbes vibran».
 *
 * Medido en su página enganchando el analizador vivo: smoothing 0,8, fftSize
 * 256. El fftSize también importa — 256 son bins más anchos, o sea un promedio
 * más estable que con los 1024 que teníamos.
 */
export const VOICE_ANALYSER_FFT_SIZE = 256;
export const VOICE_ANALYSER_SMOOTHING = 0.8;

/**
 * N3C r27 · EL PISO DE RUIDO, QUE UN ARCHIVO NO TIENE Y UN MICRÓFONO SIEMPRE SÍ.
 *
 * `getByteFrequencyData` no reparte amplitud: reparte DECIBELIOS entre
 * `minDecibels` (−100) y `maxDecibels` (−30). El silencio de un archivo es cero
 * digital y da 0,000. El silencio de una habitación no: medido acá, ruido de
 * banda ancha a −40 dB —un micrófono de laptop en una sala normal— da **0,249**,
 * que es exactamente el nivel de su VOZ hablando (0,217).
 *
 * O sea que toda la ley de la r26 quedó calibrada contra una señal cuyo silencio
 * vale cero y cableada a un micrófono cuyo silencio vale «gritando». El orbe se
 * quedaba arriba de su rango todo el tiempo y hablar apenas lo movía — «como ya
 * están vibrando todo el tiempo, casi no se alcanza a distinguir».
 *
 * El piso se sigue solo: baja rápido para encontrar el silencio y sube muy
 * despacio, así una frase larga no se lo lleva puesto.
 */
export const VOICE_FLOOR_FALL_TAU_MS = 400;
export const VOICE_FLOOR_RISE_TAU_MS = 25_000;
/** Margen sobre el piso. El ruido no es constante: fluctúa alrededor del piso. */
export const VOICE_FLOOR_MARGIN = 1.25;

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

/**
 * N3C r27 · SIGUE EL PISO DE RUIDO DE ESTA SALA. Baja rápido hacia un nivel más
 * bajo (encontrar el silencio) y sube muy despacio (no confundir una frase con
 * un cuarto más ruidoso).
 */
export function advanceVoiceFloor(
  floor: number,
  level: number,
  dtSeconds: number,
): number {
  const l = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const f = Number.isFinite(floor) ? Math.min(1, Math.max(0, floor)) : 0;
  const tau = l < f ? VOICE_FLOOR_FALL_TAU_MS : VOICE_FLOOR_RISE_TAU_MS;
  return advanceVoiceTau(f, l, dtSeconds, tau);
}

/**
 * N3C r27 · EL NIVEL POR ENCIMA DEL PISO, re-escalado al rango que queda.
 *
 * Con esto el silencio de CUALQUIER sala vale cero exacto y la voz recupera todo
 * el recorrido — que es lo que el orbe de la referencia recibe gratis por venir
 * de un archivo.
 */
export function voiceAboveFloor(level: number, floor: number): number {
  const l = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const piso = Math.min(0.9, Math.max(0, Number.isFinite(floor) ? floor : 0))
    * VOICE_FLOOR_MARGIN;
  if (l <= piso) return 0;
  return Math.min(1, (l - piso) / Math.max(0.08, 1 - piso));
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
