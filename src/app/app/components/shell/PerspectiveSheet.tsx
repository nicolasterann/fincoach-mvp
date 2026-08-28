"use client";

import Link from "next/link";
import type {
  PerspectiveProgressItem,
  PerspectiveRing,
  ShellPerspective,
} from "./shell-perspective";

function Arrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
      <path
        d="m7 4 5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ModuleHead({
  title,
  question,
  href,
}: {
  title: string;
  question: string;
  href?: string;
}) {
  const content = (
    <>
      <span>
        <span className="kipu-perspective-module__title">{title}</span>
        <span className="kipu-perspective-module__question">{question}</span>
      </span>
      {href ? <Arrow /> : null}
    </>
  );
  return href ? (
    <Link href={href} className="kipu-perspective-module__head">
      {content}
    </Link>
  ) : (
    <div className="kipu-perspective-module__head">{content}</div>
  );
}

function Ring({ ring }: { ring: PerspectiveRing }) {
  return (
    <div className="kipu-perspective-ring-wrap">
      <div
        className="kipu-perspective-ring"
        data-tone={ring.tone}
        aria-label={`${ring.label}: ${ring.amountLabel}${ring.percentLabel ? `, ${ring.percentLabel}` : ""}${ring.denominatorLabel ? `; ${ring.denominatorLabel}` : ""}`}
      >
        <svg aria-hidden="true" viewBox="0 0 100 100">
          <circle className="kipu-perspective-ring__track" cx="50" cy="50" r="43" />
          <circle
            className="kipu-perspective-ring__fill"
            cx="50"
            cy="50"
            r="43"
            pathLength="100"
            strokeDasharray={ring.dashArray}
          />
        </svg>
        <span className="kipu-perspective-ring__value">
          {ring.percentLabel ?? ring.amountLabel}
        </span>
      </div>
      <p className="kipu-perspective-ring__label">{ring.label}</p>
      {ring.percentLabel ? (
        <p className="kipu-perspective-ring__amount">{ring.amountLabel}</p>
      ) : null}
      {ring.denominatorLabel ? (
        <p className="kipu-perspective-denominator">Sobre {ring.denominatorLabel}</p>
      ) : null}
      {ring.note ? <p className="kipu-perspective-ring__note">{ring.note}</p> : null}
    </div>
  );
}

function ProgressRow({ item }: { item: PerspectiveProgressItem }) {
  return (
    <Link
      href={item.href}
      className="kipu-perspective-progress"
      data-tone={item.tone}
      data-progress-key={item.key}
    >
      <span className="kipu-perspective-progress__top">
        <span className="kipu-perspective-progress__title">{item.title}</span>
        <span className="kipu-perspective-progress__amount">
          {item.percentLabel ?? item.amountLabel ?? "Abrir"}
        </span>
      </span>
      <span className="kipu-perspective-progress__detail">{item.detailLabel}</span>
      {item.widthCss ? (
        <span className="kipu-perspective-progress__track" aria-hidden="true">
          <span
            className="kipu-perspective-progress__fill"
            style={{ width: item.widthCss }}
          />
        </span>
      ) : null}
      {item.denominatorLabel ? (
        <span className="kipu-perspective-denominator">
          Denominador · {item.denominatorLabel}
        </span>
      ) : null}
    </Link>
  );
}

export function PerspectiveSheet({
  perspective,
  onRetry,
}: {
  perspective: ShellPerspective;
  onRetry: () => void;
}) {
  const cord = perspective.saldoHistory;
  return (
    <div className="kipu-perspective-stack">
      <section className="kipu-perspective-module" data-perspective-module="today">
        <ModuleHead
          title={perspective.today.title}
          question={perspective.today.question}
          href={perspective.today.href}
        />
        <div className="kipu-perspective-rings">
          {perspective.today.rings.map((ring) => (
            <Ring key={ring.key} ring={ring} />
          ))}
        </div>
      </section>

      <section className="kipu-perspective-module" data-perspective-module="month">
        <ModuleHead
          title={perspective.month.title}
          question={perspective.month.question}
          href={perspective.month.href}
        />
        <div className="kipu-perspective-month-total">
          <span>Entra al mes</span>
          <strong>{perspective.month.incomeLabel}</strong>
        </div>
        {perspective.month.barVisible ? (
          <div
            className="kipu-perspective-month-bar"
            aria-label={`Reparto del mes. ${perspective.month.denominatorLabel}`}
          >
            {perspective.month.segments.map((segment) => (
              <span
                key={segment.key}
                className="kipu-perspective-month-bar__segment"
                data-tone={segment.tone}
                style={{ width: segment.widthCss }}
              />
            ))}
          </div>
        ) : null}
        <div className="kipu-perspective-month-legend">
          {perspective.month.segments.map((segment) => (
            <div key={segment.key} data-tone={segment.tone}>
              <span className="kipu-perspective-month-legend__dot" />
              <span>{segment.label}</span>
              <strong>{segment.amountLabel}</strong>
              {segment.shareLabel ? <small>{segment.shareLabel}</small> : null}
            </div>
          ))}
        </div>
        {perspective.month.denominatorLabel ? (
          <p className="kipu-perspective-denominator">
            Denominador · {perspective.month.denominatorLabel}
          </p>
        ) : null}
        <p className="kipu-perspective-module__note">{perspective.month.note}</p>
      </section>

      {cord.status === "failed" ? (
        <section className="kipu-perspective-module" data-perspective-module="saldo-history">
          <ModuleHead title="Tu Saldo, últimos días" question="¿Cómo se movió?" />
          <div className="kipu-perspective-read-failed">
            <p>{cord.message}</p>
            <button type="button" onClick={onRetry}>Reintentar</button>
          </div>
        </section>
      ) : cord.status === "ready" ? (
        <section className="kipu-perspective-module" data-perspective-module="saldo-history">
          <ModuleHead title="Tu Saldo, últimos días" question="¿Cómo se movió?" href="/app/saldo" />
          <svg
            className="kipu-perspective-cord"
            viewBox="0 0 322 82"
            role="img"
            aria-label="Cordón de tu Saldo en 18 días; los días sin registro quedan como huecos"
          >
            {cord.paths.map((path, index) => (
              <path key={index} className="kipu-perspective-cord__line" d={path} />
            ))}
            {cord.knots.map((knot) =>
              knot.y == null ? null : (
                <circle
                  key={knot.dateISO}
                  className="kipu-perspective-cord__knot"
                  data-tone={knot.tone}
                  cx={knot.x}
                  cy={knot.y}
                  r="4"
                >
                  <title>{`${knot.dateLabel}: ${knot.amountLabel}`}</title>
                </circle>
              ),
            )}
          </svg>
          <p className="kipu-perspective-module__note">{cord.gapCopy}</p>
          <Link href="/app/activity" className="kipu-perspective-inline-door">
            Ver actividad <Arrow />
          </Link>
        </section>
      ) : null}

      <section className="kipu-perspective-module" data-perspective-module="progress">
        <ModuleHead
          title={perspective.progress.title}
          question={perspective.progress.question}
          href="/app/goals"
        />
        <div className="kipu-perspective-progress-list">
          {perspective.progress.items.map((item) => (
            <ProgressRow key={item.key} item={item} />
          ))}
        </div>
        <Link
          href={perspective.progress.wealth.href}
          className="kipu-perspective-wealth"
          data-read-status={perspective.progress.wealth.status}
        >
          <span>
            <strong>{perspective.progress.wealth.title}</strong>
            <small>{perspective.progress.wealth.detailLabel}</small>
          </span>
          <span className="kipu-perspective-wealth__amount">
            {perspective.progress.wealth.amountLabel ?? "Abrir"}
            <Arrow />
          </span>
        </Link>
      </section>

      <section className="kipu-perspective-module" data-perspective-module="upcoming">
        <ModuleHead
          title={perspective.upcoming.title}
          question={perspective.upcoming.question}
          href={perspective.upcoming.href}
        />
        {perspective.upcoming.rows.length ? (
          <div className="kipu-perspective-upcoming">
            {perspective.upcoming.rows.map((row) => (
              <div key={row.key} data-tone={row.tone}>
                <span className="kipu-perspective-upcoming__dot" />
                <span className="kipu-perspective-upcoming__label">{row.label}</span>
                <span className="kipu-perspective-upcoming__when">{row.whenLabel}</span>
                <strong>{row.amountLabel ?? "Monto pendiente"}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="kipu-perspective-upcoming-empty">{perspective.upcoming.emptyCopy}</p>
        )}
        <nav className="kipu-perspective-secondary-doors" aria-label="Más caminos desde el santuario">
          <Link href="/app/cuentas">Ver cuentas</Link>
          <Link href="/app/activity">Ver actividad</Link>
          <Link href="/app/chat">Abrir chat</Link>
        </nav>
      </section>
    </div>
  );
}
