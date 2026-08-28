import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Bloque N1 · Causa B — el archivo de sesión que nunca se escribió.
//
// `src/lib/supabase-server.ts` intenta guardar la sesión renovada y no puede:
// desde un Server Component de Next escribir cookies está prohibido. Hasta hoy
// se tragaba el fallo con un comentario que prometía «el middleware la
// renovará» — y ese archivo no existía. Consecuencia real, la que reportó el
// founder: al vencer el token cada visita intenta renovar, ninguna consigue
// guardar el resultado, y entrar cuesta, tira errores y a veces devuelve al
// login.
//
// Aquí SÍ se puede escribir la cookie, así que aquí se renueva. Nada más.
//
// NOMBRE DEL ARCHIVO: en Next 16 la convención `middleware` está DEPRECADA y se
// llama `proxy` (`node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/proxy.md`). Como el proyecto usa `src/app`, el archivo va
// en `src/proxy.ts`, al mismo nivel que `app`. Escribirlo como `middleware.ts`
// produciría un archivo que NO corre: exactamente el defecto que esto arregla.
//
// FRONTERA DE SEGURIDAD (D-N1, autorizado por el founder):
//  · Sólo renueva la sesión y reescribe sus cookies.
//  · NO decide autorización: cada página conserva su propio guard de login.
//  · NO toca RLS, ni `supabase-admin`, ni la clave de servicio.
//  · Falla ABIERTO: si algo sale mal, la petición sigue su curso sin sesión
//    renovada. Un renovador de sesión jamás puede tumbar el sitio.

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Sin configuración no hay nada que renovar. Pasar de largo es correcto:
  // la página siguiente ya sabe fallar por su cuenta.
  if (!supabaseUrl || !supabaseAnonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Dos escrituras y las dos hacen falta. En la PETICIÓN, para que el
          // render de esta misma carga vea ya el token nuevo y no vuelva a
          // intentar renovarlo (ese era el viaje de auth extra por carga). Y en
          // la RESPUESTA, para que el navegador lo guarde y la próxima carga
          // empiece con una sesión válida — que es lo que nunca ocurría.
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });

    // `getSession()` y no `getUser()`: lee y decodifica la cookie local, y sólo
    // sale a la red cuando el token está vencido o por vencer. `getUser()`
    // validaría contra el servidor de auth en CADA navegación — un viaje de red
    // por carga, justo lo que N1 viene a quitar. Aquí la pregunta es «¿hay que
    // renovar?», no «¿quién sos?»: quién sos lo sigue decidiendo cada página.
    await supabase.auth.getSession();
  } catch {
    // Falla abierto a propósito. Un fallo renovando no puede convertirse en un
    // error de entrada para el usuario — que es el defecto original.
    return response;
  }

  return response;
}

export const config = {
  // Acotado: nada de estáticos, íconos ni imágenes, y NADA bajo `/api` — ahí
  // viven los crons y el webhook de Telegram, que no traen sesión de navegador
  // y no deben pagar este trabajo.
  matcher: [
    "/((?!api|_next/static|_next/image|sw\\.js|offline\\.html|manifest\\.webmanifest|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
