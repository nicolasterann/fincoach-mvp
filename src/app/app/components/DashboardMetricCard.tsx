import Link from "next/link";
import type { MetricAccent, MetricIcon, MetricView } from "./app-dashboard-helpers";

// One metric of the wellness system. Each metric has its own accent color,
// icon, and score bar (Athlytic-style) so the grid reads as distinct living
// signals, not six copies of the same text card.

const ACCENT: Record<
  MetricAccent,
  { text: string; bar: string; iconBg: string; iconText: string }
> = {
  emerald: {
    text: "text-emerald-300",
    bar: "bg-emerald-400",
    iconBg: "bg-emerald-400/15",
    iconText: "text-emerald-300",
  },
  violet: {
    text: "text-violet-300",
    bar: "bg-violet-400",
    iconBg: "bg-violet-400/15",
    iconText: "text-violet-300",
  },
  orange: {
    text: "text-orange-300",
    bar: "bg-orange-400",
    iconBg: "bg-orange-400/15",
    iconText: "text-orange-300",
  },
  sky: {
    text: "text-sky-300",
    bar: "bg-sky-400",
    iconBg: "bg-sky-400/15",
    iconText: "text-sky-300",
  },
  teal: {
    text: "text-teal-300",
    bar: "bg-teal-400",
    iconBg: "bg-teal-400/15",
    iconText: "text-teal-300",
  },
  amber: {
    text: "text-amber-300",
    bar: "bg-amber-400",
    iconBg: "bg-amber-400/15",
    iconText: "text-amber-300",
  },
};

const ICON_PATHS: Record<MetricIcon, string> = {
  pulse: "M3 12h4l2-6 4 12 2-6h6",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  card: "M3 7h18v10H3V7Zm0 3h18",
  wind: "M3 8h10a3 3 0 1 0-3-3M3 12h14a3 3 0 1 1-3 3M3 16h7",
  check: "M4 12.5 9.5 18 20 6.5",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8",
};

export function DashboardMetricCard({ metric }: { metric: MetricView }) {
  const a = ACCENT[metric.accent];

  const inner = (
    <>
      <div className="flex items-center gap-2">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${a.iconBg} ${a.iconText}`}
        >
          <svg
            aria-hidden
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.9}
            viewBox="0 0 24 24"
          >
            <path d={ICON_PATHS[metric.icon]} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {metric.label}
        </p>
        {metric.href && (
          <svg
            aria-hidden
            className="ml-auto h-3.5 w-3.5 text-zinc-700"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <p className={`mt-3 text-2xl font-black leading-none tracking-tight ${a.text}`}>
        {metric.value}
      </p>
      <p className="mt-2 min-h-8 text-xs leading-snug text-zinc-500">{metric.message}</p>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${a.bar}`}
          style={{ width: `${Math.max(4, Math.min(100, metric.score))}%` }}
        />
      </div>
    </>
  );

  const base = "block rounded-3xl border border-white/5 bg-zinc-900 p-4";

  if (metric.href) {
    return (
      <Link
        className={`${base} transition hover:border-white/15 hover:bg-zinc-900/70`}
        href={metric.href}
      >
        {inner}
      </Link>
    );
  }
  return <article className={base}>{inner}</article>;
}
