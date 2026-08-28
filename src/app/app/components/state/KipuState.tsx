"use client";

// Bloque N0 — los CINCO estados. No hay un sexto, y ninguna pantalla improvisa
// el suyo. Cada uno rinde el contrato puro de `state-contract.ts`, de modo que
// lo que el gate ejecuta y lo que el ojo ve son la misma cosa.

import type { ReactNode } from "react";
import {
  formatMetric,
  kipuStateContract,
  KIPU_UNMEASURED,
  type KipuStateKind,
  type KipuStateShape,
} from "./state-contract";

export interface KipuStateProps {
  /** la forma de lo que ocupa este hueco: orbe, tarjeta, línea u hoja */
  shape: KipuStateShape;
  /** qué dato es. Va al nombre accesible: "Saldo", "Tu mes"… */
  label?: string;
  title?: string;
  body?: string;
  /** sólo `vacío`: qué hacer para que deje de estar vacío */
  invitation?: string;
  /** sólo los que ofrecen reintentar. Por defecto, recargar */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

function reload() {
  if (typeof window !== "undefined") window.location.reload();
}

// ── marcas ────────────────────────────────────────────────────────────────
// Un glifo por estado interrumpido, para que "no pude leer", "no hay señal" y
// "se rompió" no se confundan entre sí ni con un vacío.

function NoDataMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3.6 3.2" />
      <path d="M8.4 15.6 15.6 8.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function NoSignalMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3.2 9.4a13 13 0 0 1 17.6 0M6.5 12.8a8.4 8.4 0 0 1 11 0M9.8 16.1a3.8 3.8 0 0 1 4.4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="19.2" r="1.1" fill="currentColor" />
      <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ErrorMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4.6 21 19.4H3L12 4.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 10.4v3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="1" fill="currentColor" />
    </svg>
  );
}

/** El vacío no es un hueco: es la forma entera con una gota en el fondo. */
function EmptyDropMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.6 17.2a9 9 0 0 0 16.8 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 12.4c1.5 1.6 2.2 2.6 2.2 3.5a2.2 2.2 0 0 1-4.4 0c0-.9.7-1.9 2.2-3.5Z" fill="currentColor" />
    </svg>
  );
}

const MARKS: Partial<Record<KipuStateKind, () => ReactNode>> = {
  vacio: EmptyDropMark,
  "sin-dato": NoDataMark,
  "sin-senal": NoSignalMark,
  error: ErrorMark,
};

// ── el marco común ────────────────────────────────────────────────────────

function StateFrame({
  kind,
  shape,
  label,
  title,
  body,
  figure,
  action,
  className = "",
}: {
  kind: KipuStateKind;
  shape: KipuStateShape;
  label?: string;
  title: string;
  body: string;
  figure: string | null;
  action: ReactNode;
  className?: string;
}) {
  const contract = kipuStateContract(kind);
  const Mark = MARKS[kind];
  return (
    <div
      className={`kipu-state ${className}`.trim()}
      data-state-kind={kind}
      data-state-shape={shape}
      data-state-silhouette={contract.silhouette}
      role={contract.role === "note" ? undefined : contract.role}
      aria-live={contract.live === "off" ? undefined : contract.live}
      aria-label={label ? `${label}: ${title}` : undefined}
    >
      {Mark && (
        <span className="kipu-state__mark" aria-hidden="true">
          <Mark />
        </span>
      )}
      {figure !== null && (
        <p className="kipu-state__figure" data-measured={kind === "vacio" ? "true" : "false"}>
          {figure}
        </p>
      )}
      <p className="kipu-state__title">{title}</p>
      <p className="kipu-state__body">{body}</p>
      {action}
    </div>
  );
}

function RetryButton({ onRetry, children }: { onRetry?: () => void; children: string }) {
  return (
    <button type="button" className="kipu-state__action" onClick={onRetry ?? reload}>
      {children}
    </button>
  );
}

// ── 1 · cargando ──────────────────────────────────────────────────────────
// Un esqueleto con la FORMA de lo que viene. Un orbe cargando es un círculo del
// tamaño del orbe, no una barra redondeada.

export function KipuLoading({ shape, label, className = "" }: KipuStateProps) {
  const contract = kipuStateContract("cargando");
  return (
    <div
      className={`kipu-state ${className}`.trim()}
      data-state-kind="cargando"
      data-state-shape={shape}
      data-state-silhouette={contract.silhouette}
      role="status"
      aria-live="polite"
    >
      {shape === "orbe" && (
        <>
          <span aria-hidden="true" className="kipu-state__bone kipu-state__bone--orb" />
          <span aria-hidden="true" className="kipu-state__bone kipu-state__bone--cifra" />
          <span aria-hidden="true" className="kipu-state__bone kipu-state__bone--label" />
        </>
      )}
      {shape === "tarjeta" && (
        <>
          <span aria-hidden="true" className="kipu-state__bone kipu-state__bone--label" />
          <span aria-hidden="true" className="kipu-state__bone kipu-state__bone--cifra" />
          <span aria-hidden="true" className="kipu-state__bone kipu-state__bone--row" />
          <span aria-hidden="true" className="kipu-state__bone kipu-state__bone--row" />
        </>
      )}
      {shape === "linea" && (
        <span aria-hidden="true" className="kipu-state__bone-line">
          <span className="kipu-state__bone kipu-state__bone--time" />
          <span className="kipu-state__bone kipu-state__bone--row" />
          <span className="kipu-state__bone kipu-state__bone--amount" />
        </span>
      )}
      {shape === "hoja" && (
        <>
          <span aria-hidden="true" className="kipu-state__bone kipu-state__bone--grip" />
          <span aria-hidden="true" className="kipu-state__bone kipu-state__bone--title" />
          <span aria-hidden="true" className="kipu-state__bone kipu-state__bone--block" />
          <span aria-hidden="true" className="kipu-state__bone kipu-state__bone--block" />
        </>
      )}
      <span className="sr-only">{label ? `Cargando ${label}…` : "Cargando…"}</span>
    </div>
  );
}

// ── 2 · vacío ─────────────────────────────────────────────────────────────
// Leí bien y hay cero. El cero es un HECHO: se muestra medido, y con él una
// invitación a que deje de estar vacío.

export function KipuEmpty({
  shape,
  label,
  title,
  body,
  invitation,
  className = "",
}: KipuStateProps) {
  const contract = kipuStateContract("vacio");
  return (
    <StateFrame
      kind="vacio"
      shape={shape}
      label={label}
      title={title ?? contract.title}
      body={body ?? contract.body}
      figure={formatMetric(0)}
      className={className}
      action={
        <p className="kipu-state__invite">{invitation ?? contract.body}</p>
      }
    />
  );
}

// ── 3 · sin dato ──────────────────────────────────────────────────────────
// NO pude leer. Nunca un cero, nunca una barra vacía.

export function KipuNoData({
  shape,
  label,
  title,
  body,
  onRetry,
  retryLabel,
  className = "",
}: KipuStateProps) {
  const contract = kipuStateContract("sin-dato");
  return (
    <StateFrame
      kind="sin-dato"
      shape={shape}
      label={label}
      title={title ?? contract.title}
      body={body ?? contract.body}
      figure={KIPU_UNMEASURED}
      className={className}
      action={
        <RetryButton onRetry={onRetry}>
          {retryLabel ?? contract.actionLabel ?? "Reintentar"}
        </RetryButton>
      }
    />
  );
}

// ── 4 · sin señal ─────────────────────────────────────────────────────────

export function KipuOffline({
  shape,
  label,
  title,
  body,
  onRetry,
  retryLabel,
  className = "",
}: KipuStateProps) {
  const contract = kipuStateContract("sin-senal");
  return (
    <StateFrame
      kind="sin-senal"
      shape={shape}
      label={label}
      title={title ?? contract.title}
      body={body ?? contract.body}
      figure={KIPU_UNMEASURED}
      className={className}
      action={
        <RetryButton onRetry={onRetry}>
          {retryLabel ?? contract.actionLabel ?? "Reintentar"}
        </RetryButton>
      }
    />
  );
}

// ── 5 · error ─────────────────────────────────────────────────────────────

export function KipuError({
  shape,
  label,
  title,
  body,
  onRetry,
  retryLabel,
  className = "",
}: KipuStateProps) {
  const contract = kipuStateContract("error");
  return (
    <StateFrame
      kind="error"
      shape={shape}
      label={label}
      title={title ?? contract.title}
      body={body ?? contract.body}
      figure={KIPU_UNMEASURED}
      className={className}
      action={
        <RetryButton onRetry={onRetry}>
          {retryLabel ?? contract.actionLabel ?? "Reintentar"}
        </RetryButton>
      }
    />
  );
}

/** El despachador, para superficies que eligen el estado en tiempo de ejecución. */
export function KipuState({ kind, ...props }: KipuStateProps & { kind: KipuStateKind }) {
  switch (kind) {
    case "cargando":
      return <KipuLoading {...props} />;
    case "vacio":
      return <KipuEmpty {...props} />;
    case "sin-dato":
      return <KipuNoData {...props} />;
    case "sin-senal":
      return <KipuOffline {...props} />;
    case "error":
      return <KipuError {...props} />;
  }
}
