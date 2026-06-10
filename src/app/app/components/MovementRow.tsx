import type { MovementView } from "./app-dashboard-helpers";

// One row of the financial activity feed — reads like a wellness timeline, not
// a ledger. Sign + color come from the movement tone; money is already Kipu-
// styled by describeMovement.
export function MovementRow({
  view,
  timeLabel,
}: {
  view: MovementView;
  timeLabel?: string;
}) {
  const amountColor =
    view.tone === "in"
      ? "text-emerald-300"
      : view.tone === "out"
        ? "text-zinc-200"
        : "text-zinc-500";
  const prefix = view.tone === "in" ? "+" : view.tone === "out" ? "−" : "";
  const dot =
    view.tone === "in"
      ? "bg-emerald-400/80"
      : view.tone === "out"
        ? "bg-zinc-500"
        : "bg-zinc-700";

  return (
    <div className="flex items-center gap-3 py-3">
      <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-100">{view.title}</p>
        <p className="truncate text-xs text-zinc-600">
          {view.sublabel}
          {timeLabel ? `${view.sublabel ? " · " : ""}${timeLabel}` : ""}
        </p>
      </div>
      <p className={`shrink-0 text-sm font-semibold tabular-nums ${amountColor}`}>
        {prefix}
        {view.amount}
      </p>
    </div>
  );
}
