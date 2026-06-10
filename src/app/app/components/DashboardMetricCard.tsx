import Link from "next/link";
import type { MetricStatus } from "./app-dashboard-helpers";

export function DashboardMetricCard({
  label,
  value,
  status,
  message,
  href,
}: {
  label: string;
  value: string;
  status: MetricStatus;
  message: string;
  href?: string;
}) {
  const dotColor: Record<MetricStatus, string> = {
    good: "bg-emerald-400",
    ok: "bg-sky-400",
    warn: "bg-amber-400",
    bad: "bg-rose-400",
    neutral: "bg-zinc-600",
  };
  const valueColor: Record<MetricStatus, string> = {
    good: "text-emerald-300",
    ok: "text-sky-300",
    warn: "text-amber-300",
    bad: "text-rose-400",
    neutral: "text-zinc-300",
  };

  const inner = (
    <>
      <div className="flex items-center gap-1.5">
        <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor[status]}`} />
        <p className="text-xs font-medium text-zinc-500">{label}</p>
        {href && (
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
      <p className={`mt-3 text-xl font-black leading-tight ${valueColor[status]}`}>{value}</p>
      <p className="mt-1.5 text-xs leading-snug text-zinc-600">{message}</p>
    </>
  );

  const base = "block rounded-3xl border border-white/5 bg-zinc-900 p-4";

  if (href) {
    return (
      <Link className={`${base} transition hover:border-white/15 hover:bg-zinc-900/60`} href={href}>
        {inner}
      </Link>
    );
  }
  return <article className={base}>{inner}</article>;
}
