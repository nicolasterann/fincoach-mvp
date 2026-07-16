// Smoke acotado del backfill de zona contra PRODUCCIÓN: usuarios disposables,
// sesión REAL, Server Action REAL (invocado como lo hace el navegador), RLS REAL,
// base REAL. Limpieza garantizada en finally.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const BASE = "https://www.soykipu.com";
const ACTION = process.argv[3];
const users = JSON.parse(readFileSync(process.argv[2], "utf8"));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`  ${pass ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`);
};
const cookieOf = (u) => u.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

/** Invoca el Server Action REAL desplegado, igual que el navegador. */
async function callAction(user, tz) {
  const res = await fetch(`${BASE}/app`, {
    method: "POST",
    headers: { cookie: cookieOf(user), "Next-Action": ACTION, "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify([tz]),
  });
  const body = await res.text();
  const m = body.match(/"(stored|already_set|retry)"/);
  return { status: res.status, result: m ? m[1] : `??(${body.slice(0, 120)})` };
}
/** Lo que Intl canonicaliza — que es exactamente lo que el action guarda.
 *  America/Argentina/Buenos_Aires → America/Buenos_Aires (enlace legacy). PG conoce
 *  ambas y resuelven igual, pero el valor GUARDADO es el canónico, no el de entrada. */
const canon = (tz) => new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
const tzOf = async (id) => {
  const { data } = await admin.from("user_engagement").select("timezone").eq("user_id", id).maybeSingle();
  return data ? data.timezone : "(sin fila)";
};

const [A, B] = users;
try {
  // ── 1. usuario SIN fila: /app crea la zona ───────────────────────────────────
  check("1a. arranca sin fila de user_engagement", (await tzOf(A.userId)) === "(sin fila)", await tzOf(A.userId));
  const r1 = await callAction(A, "America/Argentina/Buenos_Aires");
  check("1b. sin fila → el action REAL la crea y devuelve stored", r1.result === "stored", `HTTP ${r1.status} → ${r1.result}`);
  check("1c. la zona guardada es la CANÓNICA de Intl (Buenos_Aires ← Argentina/Buenos_Aires), no la de entrada", (await tzOf(A.userId)) === canon("America/Argentina/Buenos_Aires"), `guardada=${await tzOf(A.userId)} canónica=${canon("America/Argentina/Buenos_Aires")}`);

  // ── 2. recarga: idempotente, no re-escribe ───────────────────────────────────
  const r2 = await callAction(A, "America/Argentina/Buenos_Aires");
  check("2. recarga con la MISMA zona → already_set (idempotente, no reescribe)", r2.result === "already_set", r2.result);

  // ── 3. zona declarada: otro navegador NUNCA la pisa ──────────────────────────
  const r3 = await callAction(A, "Europe/Madrid");
  check("3a. otro navegador (Madrid) sobre zona declarada → already_set, no pisa", r3.result === "already_set", r3.result);
  check("3b. la zona sigue siendo Buenos Aires (Madrid no la tocó)", (await tzOf(A.userId)) === canon("America/Argentina/Buenos_Aires"), await tzOf(A.userId));

  // ── 4. fila EXISTENTE con zona vacía: la completa ────────────────────────────
  // OJO: esto NO reproduce la carrera del 23505. La fila ya existe al llamar, así que
  // la completa el PRIMER update condicional; la carrera real (update no toca nada →
  // insert concurrente → 23505 → segundo update) necesita inyectar una escritura en
  // mitad del action y no es reproducible desde fuera. Lo que sí prueba: una fila
  // parcial —la que dejan setCoachMode o saveAmbientPrefs— se completa en vez de
  // reportarse como "ya tiene zona".
  await admin.from("user_engagement").update({ timezone: null }).eq("user_id", A.userId);
  check("4a. fila existente con zona en NULL (la que deja un writer parcial)", (await tzOf(A.userId)) === null);
  const r4 = await callAction(A, "America/Bogota");
  check("4b. fila con zona vacía → la completa (stored), no la reporta como already_set", r4.result === "stored", r4.result);
  check("4c. quedó Bogotá", (await tzOf(A.userId)) === "America/Bogota", await tzOf(A.userId));
  // cadena vacía (alcanzable vía saveAmbientPrefs)
  await admin.from("user_engagement").update({ timezone: "" }).eq("user_id", A.userId);
  const r4b = await callAction(A, "America/Lima");
  check("4d. zona en cadena VACÍA también se completa", r4b.result === "stored" && (await tzOf(A.userId)) === "America/Lima", `${r4b.result} / ${await tzOf(A.userId)}`);

  // ── 5. dos sesiones distintas: independientes ────────────────────────────────
  // OJO: esto NO es "dos usuarios en la misma pestaña" — el script invoca dos
  // sesiones directamente, sin montar TimezoneCapture ni tocar sessionStorage. Que la
  // MARCA no se herede entre cuentas lo prueba H.52 (claves por user id) más el
  // cableado visible en el layout. Lo que sí prueba aquí: el action resuelve cada
  // sesión por separado, sin contaminación cruzada en la base.
  check("5a. el usuario B arranca sin fila (no heredó nada de A)", (await tzOf(B.userId)) === "(sin fila)", await tzOf(B.userId));
  const r5 = await callAction(B, "America/Santiago");
  check("5b. B se evalúa por su cuenta → stored", r5.result === "stored", r5.result);
  check("5c. B quedó en Santiago y A sigue en Lima (sin contaminación cruzada en la base)",
    (await tzOf(B.userId)) === "America/Santiago" && (await tzOf(A.userId)) === "America/Lima",
    `B=${await tzOf(B.userId)} A=${await tzOf(A.userId)}`);

  // ── 6. sin sesión: no escribe nada ───────────────────────────────────────────
  const anon = await fetch(`${BASE}/app`, {
    method: "POST", headers: { "Next-Action": ACTION, "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(["America/Bogota"]),
  });
  const anonBody = await anon.text();
  check("6. sin sesión → no escribe (retry o redirect), nunca stored", !/"stored"/.test(anonBody), `HTTP ${anon.status}`);
} catch (err) {
  check("EJECUCIÓN", false, String(err?.message ?? err));
} finally {
  let residue = "n/d";
  try {
    for (const u of users) {
      await admin.from("user_engagement").delete().eq("user_id", u.userId);
      await admin.auth.admin.deleteUser(u.userId);
    }
    const { data: rows } = await admin.from("user_engagement").select("user_id").in("user_id", users.map((u) => u.userId));
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const leftUsers = (list?.users ?? []).filter((u) => u.email?.startsWith("kipu-tzsmoke-"));
    residue = `engagement=${rows?.length ?? "?"} authUsers=${leftUsers.length}`;
    check("7. limpieza: cero residuos (filas y usuarios borrados)", (rows?.length ?? 1) === 0 && leftUsers.length === 0, residue);
  } catch (e) {
    check("7. limpieza", false, String(e?.message ?? e));
  }
  const bad = results.filter((r) => !r.pass);
  console.log(`\n  ${results.length - bad.length}/${results.length} verdes${bad.length ? "  ✗ FALLAN: " + bad.map((b) => b.name).join(" | ") : ""}\n`);
  process.exit(bad.length ? 1 : 0);
}
