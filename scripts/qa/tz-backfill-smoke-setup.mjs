// Paso 1: usuario disposable + sesión REAL (magiclink → verifyOtp), cookies
// serializadas por el MISMO cliente SSR que usa la app.
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { writeFileSync } from "node:fs";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const OUT = process.argv[2];

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

const users = [];
for (const tag of ["a", "b"]) {
  const email = `kipu-tzsmoke-${tag}-${Date.now()}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { kipu_smoke: true } });
  if (error) throw new Error("createUser: " + error.message);
  users.push({ tag, email, userId: data.user.id, cookies: await mint(email) });
  console.log(`  usuario ${tag}: ${data.user.id}  ${email}`);
}
writeFileSync(OUT, JSON.stringify(users, null, 2));
console.log(`  ✓ sesiones montadas → ${OUT}`);
