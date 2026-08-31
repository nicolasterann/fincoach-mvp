"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ORB_VOICE_CORE_GAIN,
  ORB_VOICE_RING_GAIN,
} from "./orb-shader";
import { OrbSpecimen } from "./OrbSpecimen";
import { ORB_KINDS } from "./shell-orb-contract";
import {
  advanceVoiceTau,
  spectrumAverage,
  voiceTarget,
  VOICE_MOTION_TAU_MS,
  VOICE_SHAPE_TAU_MS,
} from "./voice-capture-contract";

/**
 * N3C r26 · EL BANCO DE VOZ EN VIVO.
 *
 * El founder pidió exactamente esto: «ponlo en la propuesta de voz para poder
 * interactuar y ver exactamente cómo los orbes reaccionan al sonido, así lo
 * audito». Una foto con `voice = 0.75` no se puede auditar: muestra el RÉGIMEN
 * —dónde termina el orbe si le sostenés un grito—, no la RESPUESTA, que es lo
 * único que estaba en discusión.
 *
 * Lo que se ve acá sale del mismo camino que el santuario: el mismo analizador,
 * la misma medida (`spectrumAverage`, el promedio del espectro que consume el
 * orbe de la referencia), las mismas dos constantes de tiempo y el mismo
 * shader. No hay una animación de demostración en ningún lado.
 *
 * Y cuando no hay micrófono lo DICE y ofrece el deslizador, en vez de mover los
 * orbes solo: un banco que se mueve sin entrada es una animación disfrazada de
 * medición.
 */

type EstadoMic = "apagado" | "pidiendo" | "oyendo" | "negado" | "sin-soporte";

const NIVEL_MANUAL_INICIAL = 0.28;

/**
 * Cuánto del cambio sobrevive al tonemap ACES en el punto de trabajo del orbe.
 * Medido, no supuesto: un +10% de entrada sale como +5,5% en pantalla.
 */
const TONEMAP_GAIN = 0.55;

export function OrbVozViva({ size = 168 }: { size?: number }) {
  const [estado, setEstado] = useState<EstadoMic>("apagado");
  const [manual, setManual] = useState(NIVEL_MANUAL_INICIAL);
  const [medidas, setMedidas] = useState({ nivel: 0, rapida: 0, lenta: 0 });

  const nivelRef = useRef(0);
  const manualRef = useRef(manual);
  const estadoRef = useRef<EstadoMic>("apagado");
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    manualRef.current = manual;
  }, [manual]);
  useEffect(() => {
    estadoRef.current = estado;
  }, [estado]);

  // El nivel que leen las probetas. Con micrófono es lo medido; sin micrófono
  // es lo que el deslizador dice — y eso queda escrito en la pantalla.
  const nivelVivo = useCallback(
    () => (estadoRef.current === "oyendo" ? nivelRef.current : manualRef.current),
    [],
  );

  const apagar = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;
    nivelRef.current = 0;
    setEstado("apagado");
  }, []);

  const encender = useCallback(async () => {
    if (estadoRef.current === "oyendo") {
      apagar();
      return;
    }
    const Contexto =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || !Contexto) {
      setEstado("sin-soporte");
      return;
    }
    setEstado("pidiendo");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setEstado("negado");
      return;
    }
    streamRef.current = stream;
    const context = new Contexto();
    contextRef.current = context;
    if (context.state === "suspended") await context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    // El mismo cero que el santuario: el suavizado vive en `advanceVoiceTau`,
    // donde se puede leer, y no escondido dentro del instrumento.
    analyser.smoothingTimeConstant = 0;
    context.createMediaStreamSource(stream).connect(analyser);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    setEstado("oyendo");

    let rapida = 0;
    let lenta = 0;
    let ultimoMs = -1;
    let ultimoAviso = 0;
    const leer = () => {
      analyser.getByteFrequencyData(bins);
      const nivel = spectrumAverage(bins);
      nivelRef.current = nivel;
      const ahora = performance.now();
      const dt =
        ultimoMs < 0
          ? 1 / 60
          : Math.min(1 / 20, Math.max(1 / 240, (ahora - ultimoMs) / 1_000));
      ultimoMs = ahora;
      const objetivo = voiceTarget("listening", nivel);
      rapida = advanceVoiceTau(rapida, objetivo, dt, VOICE_MOTION_TAU_MS);
      lenta = advanceVoiceTau(lenta, objetivo, dt, VOICE_SHAPE_TAU_MS);
      // El número se refresca diez veces por segundo: sesenta re-renders por
      // segundo del árbol de React harían tironear los mismos orbes que hay
      // que juzgar. Los orbes NO pasan por acá — leen `nivelVivo` en su rAF.
      if (ahora - ultimoAviso > 100) {
        ultimoAviso = ahora;
        setMedidas({ nivel, rapida, lenta });
      }
      rafRef.current = requestAnimationFrame(leer);
    };
    rafRef.current = requestAnimationFrame(leer);
  }, [apagar]);

  useEffect(() => () => apagar(), [apagar]);

  const oyendo = estado === "oyendo";
  const dipolo = Math.min(
    0.28,
    Math.max(0, (oyendo ? medidas.lenta : voiceTarget("listening", manual)) - 0.05) /
      0.75,
  );

  return (
    <div className="kipu-voz-viva" data-voz-estado={estado}>
      <div className="kipu-voz-viva__mando">
        <button type="button" onClick={() => void encender()} data-voz-boton={estado}>
          {oyendo
            ? "Dejar de escuchar"
            : estado === "pidiendo"
              ? "Pidiendo permiso…"
              : "Hablarle a los orbes"}
        </button>
        {estado === "negado" && (
          <span>Sin micrófono. Movelos con el deslizador.</span>
        )}
        {estado === "sin-soporte" && (
          <span>Este navegador no da micrófono acá. Queda el deslizador.</span>
        )}
        {!oyendo && estado !== "pidiendo" && (
          <label>
            nivel a mano
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.005}
              value={manual}
              onChange={(event) => setManual(Number(event.target.value))}
            />
            <b>{manual.toFixed(3)}</b>
          </label>
        )}
      </div>

      <dl className="kipu-voz-viva__medidas">
        <div>
          <dt>nivel</dt>
          <dd data-voz-medida="nivel">
            {(oyendo ? medidas.nivel : manual).toFixed(3)}
          </dd>
        </div>
        <div>
          <dt>rápida · {VOICE_MOTION_TAU_MS} ms</dt>
          <dd data-voz-medida="rapida">
            {(oyendo ? medidas.rapida : voiceTarget("listening", manual)).toFixed(3)}
          </dd>
        </div>
        <div>
          <dt>lenta · {VOICE_SHAPE_TAU_MS} ms</dt>
          <dd data-voz-medida="lenta">
            {(oyendo ? medidas.lenta : voiceTarget("listening", manual)).toFixed(3)}
          </dd>
        </div>
        <div>
          {/*
            Lo que se muestra es lo que se VE, no lo que entra al shader. El
            factor multiplica antes del tonemap, que comprime ~0,55 en el punto
            de trabajo del orbe: enseñar el factor crudo diría «+39% anillo»
            donde la pantalla cambia 13%, y un instrumento que declara el doble
            de lo que muestra no se puede auditar mirando.
          */}
          <dt>hueco en pantalla</dt>
          <dd data-voz-medida="dipolo">
            −{(dipolo * ORB_VOICE_CORE_GAIN * TONEMAP_GAIN * 100).toFixed(1)}%
            {" "}centro · +
            {(dipolo * ORB_VOICE_RING_GAIN * TONEMAP_GAIN * 100).toFixed(1)}%
            {" "}anillo
          </dd>
        </div>
      </dl>

      <div className="kipu-voz-viva__orbes">
        {ORB_KINDS.map((kind) => (
          <OrbSpecimen
            key={kind}
            kind={kind}
            level={0.6}
            size={size}
            animado
            nivelVivo={nivelVivo}
            label={kind}
          />
        ))}
      </div>
    </div>
  );
}
