/** Toda lectura de la que sale un número de DINERO responde esto sobre sí misma.
 *
 *  Existe porque el mismo bug apareció tres veces en dos semanas, siempre igual: un
 *  loader nace best-effort, alguien lo asciende a fuente de un número, y su forma de
 *  fallar —`catch { return [] }`, un `error` de PostgREST ignorado, un `.limit()` que
 *  trunca callado— llega río abajo disfrazada de un HECHO: "no hay nada". Y "no hay
 *  nada" casi siempre produce un número MEJOR que el real: más plata libre, menos
 *  deuda, más margen. El usuario no ve un error; ve un número coherente y falso.
 *
 *  La regla: una lectura que alimenta dinero tiene que poder decir que falló, y
 *  "no encontré nada" y "no pude leer" tienen que ser frases distintas.
 */
export type MoneyReadStatus = {
  /** La lectura no falló: ninguna consulta devolvió error, nada lanzó. */
  ok: boolean;
  /** Podemos PROBAR que vimos todo lo que hay y que pudimos valuarlo. `ok` sin
   *  `complete` = nada falló, pero no alcanza para publicar (se topó un límite de
   *  paginación, o un valor quedó sin convertir a la moneda base). */
  complete: boolean;
};

/** La única pregunta que un publicador de dinero le hace a su lectura. Una lectura
 *  que salió bien y no encontró nada ES publicable; una que falló, o que no puede
 *  demostrar que lo vio todo, no. */
export function moneyReadPublishable(read: MoneyReadStatus): boolean {
  return read.ok && read.complete;
}
