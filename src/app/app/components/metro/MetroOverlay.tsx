"use client";

// Bloque N0 — el metro. Dos mitades y ninguna inventa un número:
//  · el teléfono, vía `useReportWebVitals` de Next;
//  · el servidor, vía la cabecera `Server-Timing` que arma `buildShellPayload`.
// Cada casilla sin medir muestra `—`. Un cero aquí SIEMPRE significa "medí y
// dio cero", nunca "no medí" (regla N0 §5.2).
//
// Se enciende sólo con `?metro=1`: sin el parámetro este componente no llega a
// montar su panel, así que no existe en el DOM. No envía nada a ningún lado, no
// guarda nada: el founder lee la pantalla y la fotografía.

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import {
  METRO_METRICS,
  SHELL_TIMING_SEGMENTS,
  formatMetroValue,
  formatSegmentValue,
  metroRequested,
  metroVerdict,
  parseServerTiming,
  segmentMs,
  type MetroMetricName,
} from "@/lib/metro/metro-contract";

type Readings = Partial<Record<MetroMetricName, number>>;

const HEAD_SEGMENTS = ["contexto", "hilo", "briefing"] as const;

function MetroPanel({ serverTiming }: { serverTiming: string | null }) {
  const [readings, setReadings] = useState<Readings>({});

  // La referencia no puede cambiar entre renders o Next reenvía métricas ya
  // reportadas; por eso el callback es estable y el estado se actualiza en
  // función del anterior.
  const record = useCallback((metric: { name: string; value: number }) => {
    if (!(METRO_METRICS as readonly string[]).includes(metric.name)) return;
    setReadings((previous) => ({
      ...previous,
      [metric.name as MetroMetricName]: metric.value,
    }));
  }, []);
  useReportWebVitals(record);

  const marks = parseServerTiming(serverTiming);
  const total = segmentMs(marks, "total");
  const head = HEAD_SEGMENTS.map((name) => ({
    name,
    ms: segmentMs(marks, name),
  }));
  // "resto" sólo es un número cuando TODO lo que resta está medido. Si falta
  // una pieza, restar produciría una cifra falsa: entonces vale `—`.
  const rest =
    total != null && head.every((segment) => segment.ms != null)
      ? total - head.reduce((sum, segment) => sum + (segment.ms ?? 0), 0)
      : null;
  const tail = SHELL_TIMING_SEGMENTS.filter(
    (name) => name !== "total" && !(HEAD_SEGMENTS as readonly string[]).includes(name),
  );

  return (
    <aside className="kipu-metro" aria-label="Metro de rendimiento" data-metro="1">
      <div className="kipu-metro__vitals">
        {METRO_METRICS.map((name) => (
          <span key={name} className="kipu-metro__cell" data-verdict={metroVerdict(name, readings[name])}>
            <b>{name}</b> {formatMetroValue(name, readings[name])}
          </span>
        ))}
      </div>
      <p className="kipu-metro__server">
        <b>servidor</b>
        {head.map((segment) => (
          <span key={segment.name}>
            {segment.name} {formatSegmentValue(segment.ms)}
          </span>
        ))}
        <span>resto {formatSegmentValue(rest)}</span>
        <span>total {formatSegmentValue(total)}</span>
      </p>
      <p className="kipu-metro__tail">
        {tail.map((name) => (
          <span key={name}>
            {name} {formatSegmentValue(segmentMs(marks, name))}
          </span>
        ))}
      </p>
    </aside>
  );
}

export function MetroOverlay({ serverTiming }: { serverTiming: string | null }) {
  // Sin `?metro=1` el panel NO se monta, así que no existe en el DOM — ni en el
  // HTML del servidor ni tras hidratar. Los ganchos de web vitals viven dentro
  // del panel, de modo que un usuario normal ni siquiera los registra.
  const requested = metroRequested(useSearchParams().get("metro") ?? undefined);
  if (!requested) return null;
  return <MetroPanel serverTiming={serverTiming} />;
}
