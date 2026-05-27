import type { MetricStatus } from "./app-dashboard-helpers";

export function DashboardMetricCard({
  label,
  value,
  status,
  message,
}: {
  label: string;
  value: string;
  status: MetricStatus;
  message: string;
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
  return (
    <article className="rounded-3xl border border-white/5 bg-zinc-900 p-4">
      <div className="flex items-center gap-1.5">
        <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor[status]}`} />
        <p className="text-xs font-medium text-zinc-500">{label}</p>
      </div>
      <p className={`mt-3 text-xl font-black leading-tight ${valueColor[status]}`}>{value}</p>
      <p className="mt-1.5 text-xs leading-snug text-zinc-600">{message}</p>
    </article>
  );
}
