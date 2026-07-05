import Link from "next/link";
import type { MovementView } from "./app-dashboard-helpers";
import { Chevron } from "./living/shell";

// One row of the financial activity feed — reads like a wellness timeline, not
// a ledger. Sign + color come from the movement tone; money is already Kipu-
// styled by describeMovement. With `href` the row becomes a pressable link
// (dashboard preview → /app/activity); without it, a plain row (activity page).
export function MovementRow({
  view,
  timeLabel,
  href,
}: {
  view: MovementView;
  timeLabel?: string;
  href?: string;
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

  const muted = view.tone === "neutral";

  const inner = (
    <>
      <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium leading-snug text-zinc-100">
          {view.title}
        </p>
        <p className="truncate text-xs text-zinc-600">
          {view.sublabel}
          {timeLabel ? `${view.sublabel ? " · " : ""}${timeLabel}` : ""}
        </p>
      </div>
      <p className={`shrink-0 text-sm font-semibold tabular-nums ${amountColor}`}>
        {prefix}
        {view.amount}
      </p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`kipu-press group -mx-2 flex items-center gap-3 rounded-xl px-2 py-3 hover:bg-line/5 ${muted ? "opacity-75" : ""}`}
      >
        {inner}
        <Chevron className="shrink-0" />
      </Link>
    );
  }

  return (
    <div className={`flex items-center gap-3 py-3 ${muted ? "opacity-75" : ""}`}>
      {inner}
    </div>
  );
}
