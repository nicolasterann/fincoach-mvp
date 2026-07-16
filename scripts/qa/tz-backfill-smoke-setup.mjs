// Paso 1: usuarios disposables + sesión REAL (magiclink → verifyOtp), cookies
// serializadas por el MISMO cliente SSR que usa la app.
//
// La limpieza cubre a ESTE script también. Crear usuarios antes de cualquier finally
// dejaba residuos si fallaba el segundo createUser, el minteo de la sesión o el write
// del JSON: un harness de QA que ensucia la base al fallar a medias es peor que no
// tenerlo, porque el residuo reaparece en una auditoría posterior sin dueño.
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { writeFileSync } from "node:fs";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const OUT = process.argv[2];
if (!OUT) throw new Error("uso: node --env-file=.env.local tz-backfill-smoke-setup.mjs <salida.json>");
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function mint(email) {
  const { data: link, error: e1 } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (e1) throw new Error("generateLink: " + e1.message);
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error: e2 } = await ssr.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "email" });
  if (e2) throw new Error("verifyOtp: " + e2.message);
  return [...jar.entries()].map(([name, value]) => ({ name, value }));
}

// Cada usuario se registra APENAS existe en la base, antes de mintear su sesión, para
// que el finally pueda barrer incluso lo que quedó a medio construir.
const created = [];
let ok = false;
try {
  for (const tag of ["a", "b"]) {
    const email = `kipu-tzsmoke-${tag}-${Date.now()}@example.invalid`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { kipu_smoke: true },
    });
    if (error) throw new Error(`createUser ${tag}: ${error.message}`);
    const entry = { tag, email, userId: data.user.id, cookies: null };
    created.push(entry);
    console.log(`  usuario ${tag}: ${data.user.id}  ${email}`);
    entry.cookies = await mint(email);
  }
  writeFileSync(OUT, JSON.stringify(created, null, 2));
  ok = true;
  console.log(`  ✓ sesiones montadas → ${OUT}`);
} finally {
  if (!ok) {
    for (const u of created) {
      try {
        await admin.from("user_engagement").delete().eq("user_id", u.userId);
        await admin.auth.admin.deleteUser(u.userId);
      } catch {
        console.error(`  ⚠️  no pude borrar ${u.userId} — bórralo a mano`);
      }
    }
    console.error(`  ✗ setup abortado — ${created.length} usuario(s) a medio crear, barridos`);
  }
}
