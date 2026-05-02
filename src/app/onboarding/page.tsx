import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const { data: existingProfile, error: profileReadError } = await supabase
    .from("profiles")
    .select("full_name, country, base_currency, tone_preference, onboarding_completed")
    .eq("id", session.user.id)
    .maybeSingle();

  if (profileReadError) {
    return (
      <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
        <section className="mx-auto max-w-md rounded-3xl bg-white p-6 text-zinc-950">
          <h1 className="text-2xl font-bold">No pude leer tu perfil</h1>
          <p className="mt-3 text-sm text-zinc-600">{profileReadError.message}</p>
        </section>
      </main>
    );
  }

  const profile =
    existingProfile ??
    (
      await supabase
        .from("profiles")
        .insert({
          id: session.user.id,
          full_name: null,
          country: null,
          base_currency: "USD",
          tone_preference: "playful",
          onboarding_completed: false,
        })
        .select("full_name, country, base_currency, tone_preference, onboarding_completed")
        .single()
    ).data;

  if (!profile) {
    return (
      <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
        <section className="mx-auto max-w-md rounded-3xl bg-white p-6 text-zinc-950">
          <h1 className="text-2xl font-bold">No pude crear tu perfil</h1>
          <p className="mt-3 text-sm text-zinc-600">
            Intenta recargar la página. Si persiste, revisamos las políticas de Supabase.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
      <section className="mx-au flex w-full max-w-md flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl">
          <p className="text-sm font-medium text-emerald-300">Onboarding</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Primero conozcamos tu estilo
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Antes de cargar cuentas, deudas y metas, vamos a guardar tus preferencias
            básicas para personalizar el coach.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-6 text-zinc-950 shadow-2xl">
          <h2 className="text-xl font-bold">Perfil actual</h2>

          <dl className="mt-5 space-y-3 text-sm">
            <ProfileRow label="Email" value={session.user.email ?? "Sin email"} />
            <ProfileRow label="Nombre" value={profile.full_name ?? "Pendiente"} />
            <ProfileRow label="País" value={profile.country ?? "Pendiente"} />
            <ProfileRow label="Moneda base" value={profile.base_currency} />
            <ProfileRow label="Tono" value={profile.tone_preference} />
            <ProfileRow
              label="Onboarding completo"
              value={profile.onboarding_completed ? "Sí" : "No"}
            />
          </dl>
        </section>
      </section>
    </main>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-100 px-4 py-3">
      <dt className="font-medium text-zinc-500">{label}</dt>
      <dd className="text-right font-bold text-zinc-950">{value}</dd>
    </div>
  );
}
