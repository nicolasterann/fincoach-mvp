import { DashboardSkeleton, LegacyDashboardSkeleton } from "@/app/app/components/living/states";
import { getShellMode } from "@/lib/shell-mode";

export default function Loading() {
  return getShellMode() === "orbe" ? <DashboardSkeleton /> : <LegacyDashboardSkeleton />;
}
