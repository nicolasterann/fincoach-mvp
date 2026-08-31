"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ChatDeliveryResult } from "../../transaction-actions";
import {
  advanceVoiceFloor,
  spectrumAverage,
  voiceAboveFloor,
  VOICE_ANALYSER_FFT_SIZE,
  VOICE_ANALYSER_SMOOTHING,
  selectVoiceRecordingFormat,
  stopMediaStreamTracks,
  voiceDeliverySucceeded,
  voiceFilename,
  VOICE_MAX_BYTES,
  VOICE_MAX_DURATION_MS,
  type OrbVoiceState,
  type VoiceCaptureState,
  type VoiceRecordingFormat,
} from "./voice-capture-contract";

interface UseVoiceCaptureInput {
  sendEvidence(file: File): Promise<ChatDeliveryResult | null>;
  revealConversation(): void;
  setAura(state: OrbVoiceState, level?: number): void;
}

interface VoiceCaptureController {
  state: VoiceCaptureState;
  elapsedSeconds: number;
  message: string | null;
  start(): Promise<void>;
  send(): Promise<void>;
  cancel(): void;
}

type AudioContextConstructor = typeof AudioContext;

function messageForVoiceState(
  state: VoiceCaptureState,
  elapsedSeconds: number,
  failure: string | null,
): string | null {
  if (state === "requesting") return "Pidiendo permiso para usar el micrófono…";
  if (state === "denied") return "Sin micrófono no puedo oírte. Escríbeme y listo.";
  if (state === "unsupported") {
    return "Tu navegador no me deja grabar aquí. Escríbeme y seguimos.";
  }
  if (state === "recording") {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = String(elapsedSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds} · Toca para enviar · cancela si cambiaste de idea`;
  }
  if (state === "sending") return "Enviando tu nota…";
  if (state === "transcribing") return "Escuchando lo que dijiste…";
  if (state === "responding") return "Listo, ya te respondí.";
  if (state === "failed") {
    return failure ?? "No pude entender el audio. ¿Me lo escribes?";
  }
  return null;
}

export function useVoiceCapture({
  sendEvidence,
  revealConversation,
  setAura,
}: UseVoiceCaptureInput): VoiceCaptureController {
  const [state, setState] = useState<VoiceCaptureState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const stateRef = useRef<VoiceCaptureState>("idle");
  const requestRef = useRef(0);
  const permissionPendingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const formatRef = useRef<VoiceRecordingFormat | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserFrameRef = useRef(0);
  const durationTimerRef = useRef(0);
  const responseTimerRef = useRef(0);
  const sendRef = useRef<() => Promise<void>>(async () => undefined);
  const sendEvidenceRef = useRef(sendEvidence);
  const revealConversationRef = useRef(revealConversation);
  const setAuraRef = useRef(setAura);

  useEffect(() => {
    sendEvidenceRef.current = sendEvidence;
    revealConversationRef.current = revealConversation;
    setAuraRef.current = setAura;
    stateRef.current = state;
  }, [revealConversation, sendEvidence, setAura, state]);

  const releaseHardware = useCallback(() => {
    if (analyserFrameRef.current) {
      window.cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = 0;
    }
    if (durationTimerRef.current) {
      window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = 0;
    }
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
    stopMediaStreamTracks(streamRef.current);
    streamRef.current = null;
  }, []);

  const stopRecorder = useCallback(
    (keep: boolean): Promise<File | null> => {
      const recorder = recorderRef.current;
      const format = formatRef.current;
      recorderRef.current = null;
      formatRef.current = null;
      if (!recorder || !format) {
        releaseHardware();
        chunksRef.current = [];
        return Promise.resolve(null);
      }

      return new Promise((resolve) => {
        const finish = () => {
          const chunks = chunksRef.current;
          chunksRef.current = [];
          if (!keep || chunks.length === 0) {
            resolve(null);
            return;
          }
          const blob = new Blob(chunks, { type: format.baseMime });
          resolve(
            new File([blob], voiceFilename(format), {
              type: format.baseMime,
            }),
          );
        };
        recorder.addEventListener("stop", finish, { once: true });
        try {
          if (recorder.state !== "inactive") {
            recorder.requestData();
            recorder.stop();
          } else {
            finish();
          }
        } catch {
          chunksRef.current = [];
          resolve(null);
        } finally {
          releaseHardware();
        }
      });
    },
    [releaseHardware],
  );

  const cancel = useCallback(() => {
    const hasOpenMicrophone =
      permissionPendingRef.current ||
      recorderRef.current != null ||
      streamRef.current != null;
    if (!hasOpenMicrophone) {
      releaseHardware();
      if (
        stateRef.current === "denied" ||
        stateRef.current === "unsupported" ||
        stateRef.current === "failed"
      ) {
        setFailure(null);
        setElapsedSeconds(0);
        setState("idle");
      }
      return;
    }
    requestRef.current += 1;
    permissionPendingRef.current = false;
    if (responseTimerRef.current) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = 0;
    }
    setAuraRef.current("calm");
    setFailure(null);
    setElapsedSeconds(0);
    setState("idle");
    void stopRecorder(false);
    releaseHardware();
  }, [releaseHardware, stopRecorder]);

  const send = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    setState("sending");
    setAuraRef.current("calm");
    const file = await stopRecorder(true);
    if (!mountedRef.current) return;
    if (!file || file.size === 0 || file.size > VOICE_MAX_BYTES) {
      setFailure(
        file && file.size > VOICE_MAX_BYTES
          ? "La nota supera 12 MB. ¿Me lo escribes?"
          : "No pude entender el audio. ¿Me lo escribes?",
      );
      setState("failed");
      return;
    }

    revealConversationRef.current();
    setState("transcribing");
    setAuraRef.current("thinking");
    let result: ChatDeliveryResult | null = null;
    try {
      result = await sendEvidenceRef.current(file);
    } catch {
      result = null;
    }
    if (!mountedRef.current) return;
    if (!voiceDeliverySucceeded(result)) {
      setAuraRef.current("calm");
      setFailure(
        result?.deliveryError?.message ??
          "No pude entender el audio. ¿Me lo escribes?",
      );
      setState("failed");
      return;
    }

    setFailure(null);
    setState("responding");
    setAuraRef.current("responding");
    responseTimerRef.current = window.setTimeout(() => {
      responseTimerRef.current = 0;
      if (!mountedRef.current) return;
      setAuraRef.current("calm");
      setElapsedSeconds(0);
      setState("idle");
    }, 1_100);
  }, [stopRecorder]);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const start = useCallback(async () => {
    if (recorderRef.current || state === "requesting") return;
    setFailure(null);
    setElapsedSeconds(0);
    setAuraRef.current("calm");
    const AudioContextClass = (
      window.AudioContext ??
      (window as typeof window & {
        webkitAudioContext?: AudioContextConstructor;
      }).webkitAudioContext
    );

    if (
      document.hidden ||
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      !AudioContextClass
    ) {
      setState("unsupported");
      return;
    }
    const format = selectVoiceRecordingFormat((mime) =>
      MediaRecorder.isTypeSupported(mime),
    );
    if (!format) {
      setState("unsupported");
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    permissionPendingRef.current = true;
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      permissionPendingRef.current = false;
      if (mountedRef.current && requestRef.current === requestId) {
        setAuraRef.current("calm");
        setState("denied");
      }
      return;
    }
    permissionPendingRef.current = false;
    if (
      !mountedRef.current ||
      requestRef.current !== requestId ||
      document.hidden
    ) {
      stopMediaStreamTracks(stream);
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: format.recorderMime });
    } catch {
      stopMediaStreamTracks(stream);
      setState("unsupported");
      return;
    }
    streamRef.current = stream;
    recorderRef.current = recorder;
    formatRef.current = format;
    chunksRef.current = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    });
    recorder.addEventListener("error", () => {
      if (recorderRef.current !== recorder) return;
      setAuraRef.current("calm");
      setFailure("No pude seguir grabando. Escríbeme y seguimos.");
      setState("failed");
      void stopRecorder(false);
    });

    try {
      const context = new AudioContextClass();
      audioContextRef.current = context;
      if (context.state === "suspended") await context.resume();
      if (
        !mountedRef.current ||
        requestRef.current !== requestId ||
        document.hidden ||
        recorderRef.current !== recorder
      ) {
        void stopRecorder(false);
        return;
      }
      if (context.state !== "running") {
        throw new Error("audio context unavailable");
      }
      const analyser = context.createAnalyser();
      // N3C r27 · LOS AJUSTES SON LOS SUYOS, leídos del analizador vivo de su
      // página. La r26 los puso en 1024/0 razonando que el suavizado debe vivir
      // donde se pueda leer — y así quitó los ~75 ms que ellos SÍ tienen, con lo
      // que nuestra señal quedó cuatro veces más nerviosa. Ése era el temblor.
      analyser.fftSize = VOICE_ANALYSER_FFT_SIZE;
      analyser.smoothingTimeConstant = VOICE_ANALYSER_SMOOTHING;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      analyserRef.current = analyser;
      sourceRef.current = source;
      // N3C r26 · el promedio del ESPECTRO, que es la medida que consume el
      // orbe de la referencia (`uAudioAverage` ← `getByteFrequencyData`). El RMS
      // de la onda que había acá pesa los graves y la sonoridad general; el
      // promedio de bandas hace que una voz —banda ancha— suba mucho más que un
      // zumbido del mismo volumen, que es lo que uno quiere de un orbe que
      // reacciona a que le HABLEN.
      const bins = new Uint8Array(analyser.frequencyBinCount);
      // N3C r27 · el piso de ESTA sala. Arranca en el primer nivel medido, no en
      // cero: partir de cero haría que los primeros segundos leyeran «gritando»
      // hasta que el seguidor bajara.
      let piso = -1;
      let ultimoMs = -1;
      const sampleLevel = () => {
        if (recorderRef.current?.state !== "recording") return;
        analyser.getByteFrequencyData(bins);
        const crudo = spectrumAverage(bins);
        const ahora = performance.now();
        const dt = ultimoMs < 0
          ? 1 / 60
          : Math.min(1 / 20, Math.max(1 / 240, (ahora - ultimoMs) / 1_000));
        ultimoMs = ahora;
        piso = piso < 0 ? crudo : advanceVoiceFloor(piso, crudo, dt);
        setAuraRef.current("listening", voiceAboveFloor(crudo, piso));
        analyserFrameRef.current = window.requestAnimationFrame(sampleLevel);
      };
      analyserFrameRef.current = window.requestAnimationFrame(sampleLevel);
      recorder.start(250);
    } catch {
      void stopRecorder(false);
      setAuraRef.current("calm");
      setState("failed");
      setFailure("No pude empezar a grabar. Escríbeme y seguimos.");
      return;
    }

    const startedAt = performance.now();
    setState("recording");
    setAuraRef.current("listening", 0);
    durationTimerRef.current = window.setInterval(() => {
      const elapsed = Math.min(
        Math.ceil((performance.now() - startedAt) / 1_000),
        VOICE_MAX_DURATION_MS / 1_000,
      );
      setElapsedSeconds(elapsed);
      if (elapsed * 1_000 >= VOICE_MAX_DURATION_MS) {
        window.clearInterval(durationTimerRef.current);
        durationTimerRef.current = 0;
        void sendRef.current();
      }
    }, 250);
  }, [state, stopRecorder]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [cancel]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      if (responseTimerRef.current) {
        window.clearTimeout(responseTimerRef.current);
      }
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // The tracks are still released below.
        }
      }
      chunksRef.current = [];
      releaseHardware();
    };
  }, [releaseHardware]);

  return {
    state,
    elapsedSeconds,
    message: messageForVoiceState(state, elapsedSeconds, failure),
    start,
    send,
    cancel,
  };
}
