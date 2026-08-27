import Link from "next/link";
import { DetailSurface, type DetailLayer } from "./shell";

// Stage 27 — honest, premium empty/loading states. "Kipu está aprendiendo" is
// a FEATURE surface, never an apology: it says exactly what data unlocks the
// view and offers the next action. Skeletons shimmer while a route streams.

export function LearningState({
  title = "Kipu está aprendiendo esto",
  body,
  unlockHint,
  ctaLabel,
  ctaPrompt,
}: {
  title?: string;
  body: string;
  unlockHint?: string;
  ctaLabel?: string;
  ctaPrompt?: string;
}) {
  return (
    <div className="kipu-fade-up rounded-3xl border border-dashed border-line/10 bg-zinc-900/60 p-6 text-center">
      {/* Tiny woven-thread mark (deterministic, decorative) */}
      <svg aria-hidden className="mx-auto mb-3 opacity-70" width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="17" fill="none" stroke="rgba(52,211,153,0.5)" strokeWidth="2" strokeDasharray="18 9 5 12" strokeLinecap="round" className="kipu-weave-a" />
        <circle cx="22" cy="22" r="11" fill="none" stroke="color-mix(in srgb, var(--color-line) 25%, transparent)" strokeWidth="1.4" strokeDasharray="8 14" className="kipu-weave-b" />
        <circle cx="22" cy="22" r="2.4" fill="#34d399" />
      </svg>
      <p className="text-sm font-semibold text-zinc-200">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-zinc-500">{body}</p>
      {unlockHint && (
        <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-zinc-600">{unlockHint}</p>
      )}
      {ctaLabel && (
        <Link
          className="kipu-press mt-4 inline-block rounded-xl bg-emerald-400/90 px-4 py-2.5 text-sm font-bold text-zinc-950 hover:bg-emerald-300"
          href={ctaPrompt ? `/app/chat?share=${encodeURIComponent(ctaPrompt)}` : "/app/chat"}
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}

// ── Skeletons (for route loading.tsx files) ──────────────────────────────────

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`kipu-shimmer rounded-2xl ${className}`} />;
}

export function SkeletonCircle({ size = 168 }: { size?: number }) {
  return <div aria-hidden className="kipu-shimmer rounded-full" style={{ width: size, height: size }} />;
}

// Generic metric-detail-page skeleton: header + hero + two sections.
export function DetailPageSkeleton({ layer = "saldo" }: { layer?: DetailLayer }) {
  return (
    <DetailSurface layer={layer} className="max-w-2xl">
      <div role="status" aria-label="Cargando">
      <div className="flex items-center gap-2">
        <SkeletonBlock className="h-11 w-11" />
        <div className="space-y-2">
          <SkeletonBlock className="h-3 w-20" />
          <SkeletonBlock className="h-6 w-40" />
        </div>
      </div>
      <SkeletonBlock className="mt-5 h-48 w-full rounded-3xl" />
      <SkeletonBlock className="mt-5 h-32 w-full rounded-3xl" />
      <SkeletonBlock className="mt-5 h-32 w-full rounded-3xl" />
      <span className="sr-only">Cargando…</span>
      </div>
    </DetailSurface>
  );
}

// Dashboard skeleton: greeting, hero ring card, orb + metric grid.
export function DashboardSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl pb-28 lg:max-w-none lg:pb-12" role="status" aria-label="Cargando">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-6 w-48" />
        </div>
        <SkeletonBlock className="h-11 w-32 rounded-2xl" />
      </div>
      <div className="mt-5 flex items-center gap-6 rounded-3xl border border-line/5 bg-zinc-900 p-6">
        <SkeletonCircle size={168} />
        <div className="flex-1 space-y-3">
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonBlock className="h-3 w-full" />
          <SkeletonBlock className="h-3 w-2/3" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonBlock key={i} className="h-32 w-full rounded-3xl" />
        ))}
      </div>
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
