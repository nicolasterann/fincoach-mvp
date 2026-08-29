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

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import {
  METRO_METRICS,
  SHELL_TIMING_GROUPS,
  SHELL_TIMING_MILESTONES,
  describeLcpElement,
  formatMetroValue,
  formatSegmentValue,
  metroRequested,
  metroVerdict,
  parseServerTiming,
  segmentMs,
  type LcpElementFacts,
  type MetroMetricName,
  type ShellTimingMilestone,
} from "@/lib/metro/metro-contract";

type Readings = Partial<Record<MetroMetricName, number>>;

/**
 * N2 §4 · La única parte IMPURA de esto: sacar del DOM los hechos del elemento
 * que ganó el LCP. La entrada `largest-contentful-paint` trae `element`, que es
 * `null` cuando el nodo ya no está en el documento — ahí se devuelve `null` y el
 * panel escribe `—`. `getAttribute("class")` y no `.className` a propósito: en
 * un SVG `className` es un `SVGAnimatedString`, no una cadena.
 */
function lcpFactsFrom(entries: unknown): LcpElementFacts | null {
  const list = Array.isArray(entries) ? entries : [];
  const last = list[list.length - 1] as { element?: unknown } | undefined;
  const element = last?.element as Element | null | undefined;
  if (!element || typeof (element as Element).tagName !== "string") return null;
  return {
    tagName: element.tagName,
    id: element.id ?? null,
    classNames: (element.getAttribute("class") ?? "").split(/\s+/),
  };
}

// N1 · el servidor ya no entrega en una sola tanda: entrega el orbe, después la
// píldora con la cinta, y al final la perspectiva. Cada tanda trae su propia
// cabecera con sus tramos y su HITO (ms desde que arrancó el builder). Una
// tanda que todavía no llegó se lee `—` entera: nunca un cero.
const MILESTONE_LABEL: Record<ShellTimingMilestone, string> = {
  orbe: "orbe",
  pill: "píldora",
  perspectiva: "perspectiva",
};

function MetroBatch({
  milestone,
  serverTiming,
}: {
  milestone: ShellTimingMilestone;
  serverTiming: string | null;
}) {
  const marks = parseServerTiming(serverTiming);
  const until = segmentMs(marks, milestone);
  const tramos = SHELL_TIMING_GROUPS[milestone].map((name) => ({
    name,
    ms: segmentMs(marks, name),
  }));
  return (
    <p className="kipu-metro__server" data-metro-batch={milestone}>
      <b>
        {MILESTONE_LABEL[milestone]} {formatSegmentValue(until)}
      </b>
      {tramos.map((tramo) => (
        <span key={tramo.name}>
          {tramo.name} {formatSegmentValue(tramo.ms)}
        </span>
      ))}
    </p>
  );
}

/** Cualquier tanda del santuario sirve mientras traiga su propia cabecera. */
export type MetroTimingSource = Promise<{ serverTiming: string | null }> | null;

function MetroPanel({
  serverTiming,
  later,
  perspective,
}: {
  serverTiming: string | null;
  later: MetroTimingSource;
  perspective: MetroTimingSource;
}) {
  const [readings, setReadings] = useState<Readings>({});
  const [lcpElement, setLcpElement] = useState<LcpElementFacts | null>(null);
  const [laterTiming, setLaterTiming] = useState<string | null>(null);
  const [perspectiveTiming, setPerspectiveTiming] = useState<string | null>(null);

  // Las tandas que llegan después se leen AQUÍ, dentro del panel, que sólo
  // monta con `?metro=1`: un usuario normal no paga ni esta suscripción. Y
  // mientras no llegan, sus casillas dicen `—`, jamás `0`.
  useEffect(() => {
    let alive = true;
    // `Promise.resolve(...)` no es decorativo: lo que llega del servidor es un
    // THENABLE del stream de React, no una promesa nativa — su `.then()`
    // devuelve `undefined` y encadenarle `.catch` revienta el panel. Medido:
    // «Cannot read properties of undefined (reading 'catch')».
    const read = (
      source: MetroTimingSource,
      set: (value: string | null) => void,
    ) => {
      if (!source) return;
      void Promise.resolve(source)
        .then((batch) => {
          if (alive) set(batch.serverTiming);
        })
        .catch(() => {});
    };
    read(later, setLaterTiming);
    read(perspective, setPerspectiveTiming);
    return () => {
      alive = false;
    };
  }, [later, perspective]);

  // La referencia no puede cambiar entre renders o Next reenvía métricas ya
  // reportadas; por eso el callback es estable y el estado se actualiza en
  // función del anterior.
  const record = useCallback(
    (metric: { name: string; value: number; entries?: unknown }) => {
      if (!(METRO_METRICS as readonly string[]).includes(metric.name)) return;
      setReadings((previous) => ({
        ...previous,
        [metric.name as MetroMetricName]: metric.value,
      }));
      // N2 §4 · el LCP dice CUÁNTO y ahora también QUÉ. Sin esto, optimizar el
      // orbe es adivinar cuál de las dos hipótesis del §4 es la verdadera.
      if (metric.name === "LCP") setLcpElement(lcpFactsFrom(metric.entries));
    },
    [],
  );
  useReportWebVitals(record);

  const byMilestone: Record<ShellTimingMilestone, string | null> = {
    orbe: serverTiming,
    pill: laterTiming,
    perspectiva: perspectiveTiming,
  };

  return (
    <aside className="kipu-metro" aria-label="Metro de rendimiento" data-metro="1">
      <div className="kipu-metro__vitals">
        {METRO_METRICS.map((name) => (
          <span key={name} className="kipu-metro__cell" data-verdict={metroVerdict(name, readings[name])}>
            <b>{name}</b> {formatMetroValue(name, readings[name])}
          </span>
        ))}
      </div>
      <p className="kipu-metro__lcp">
        <b>elemento LCP</b>
        <span>{describeLcpElement(lcpElement)}</span>
      </p>
      {SHELL_TIMING_MILESTONES.map((milestone) => (
        <MetroBatch
          key={milestone}
          milestone={milestone}
          serverTiming={byMilestone[milestone]}
        />
      ))}
    </aside>
  );
}

export function MetroOverlay({
  serverTiming,
  later = null,
  perspective = null,
}: {
  serverTiming: string | null;
  later?: MetroTimingSource;
  perspective?: MetroTimingSource;
}) {
  // Sin `?metro=1` el panel NO se monta, así que no existe en el DOM — ni en el
  // HTML del servidor ni tras hidratar. Los ganchos de web vitals viven dentro
  // del panel, de modo que un usuario normal ni siquiera los registra.
  const requested = metroRequested(useSearchParams().get("metro") ?? undefined);
  if (!requested) return null;
  return (
    <MetroPanel
      serverTiming={serverTiming}
      later={later}
      perspective={perspective}
    />
  );
}
