import { SkeletonBlock } from "@/app/app/components/living/states";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pt-2" role="status" aria-label="Cargando">
      <SkeletonBlock className="h-5 w-32" />
      <SkeletonBlock className="h-16 w-3/4 self-start rounded-3xl" />
      <SkeletonBlock className="h-12 w-2/3 self-end rounded-3xl" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
