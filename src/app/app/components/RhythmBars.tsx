import type { DayRhythm } from "@/lib/financial/activity-insights";

// 7-day spending rhythm (Athlytic-style mini chart): one bar per day, colored
// against the user's comfortable daily pace. Real derived data; when there is
// no history yet the empty bars read as a calm learning state.
export function RhythmBars({
  days,
  dailyReference,
}: {
  days: DayRhythm[];
  dailyReference: number;
}) {
  const max = Math.max(dailyReference * 1.6, ...days.map((d) => d.amount), 1);

  return (
    <div className="flex h-24 items-end gap-2">
      {days.map((d, i) => {
        const h = Math.max(d.amount > 0 ? 8 : 3, Math.round((d.amount / max) * 88));
        const over = dailyReference > 0 && d.amount > dailyReference * 1.15;
        const color =
          d.amount === 0
            ? "bg-line/10"
            : over
              ? "bg-amber-400/90"
              : "bg-emerald-400/90";
        return (
          <div className="flex flex-1 flex-col items-center gap-1.5" key={`${d.label}-${i}`}>
            <div className="flex h-[88px] w-full items-end">
              <div
                className={`w-full rounded-full ${color} ${d.isToday ? "ring-2 ring-line/25" : ""}`}
                style={{ height: `${h}px` }}
              />
            </div>
            <span className={`text-[10px] font-semibold ${d.isToday ? "text-zinc-300" : "text-zinc-600"}`}>
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
