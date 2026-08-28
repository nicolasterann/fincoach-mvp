# N_DESIGN_001 — El acabado: de prototipo a producto

- **Fecha:** 2026-08-28
- **Entrada:** la pasada del founder en hardware real (iPhone, producción
  `5068176`), con doce hallazgos y un veredicto: *"como base o prototipo está
  bien; como producto final le falta pulir el 90% de los detalles"*.
- **Método:** antes de opinar, medí. Leí el código de cada superficie que él
  tocó y consulté la base de producción (read-only) para tener cifras, no
  impresiones.
- **Salida:** las causas reales, la teoría de qué hace que un producto se
  sienta terminado, la caminata con ojos humanos, y el **Bloque N** — ocho
  etapas con promesas verificables.

---

## 0. El encuadre

El founder pide que no me sesgue por lo que ya existe. Lo cumplo, y empiezo
por lo más incómodo: **tres de los doce hallazgos los causé yo con órdenes de
auditoría del Bloque M.** Están señalados abajo. No los defiendo.

También conviene nombrar qué NO está roto, porque acota el trabajo: el motor
financiero no falla en ninguno de los doce puntos. Las cifras que él vio son
correctas. **Todo el Bloque N es acabado — presentación, tiempo y gesto — y
por eso es reversible y barato en riesgo.** Ninguna etapa toca cómo se calcula
un número ni cómo se escribe en la base.

---

## 1. Lo que medí

| Medición | Resultado | De dónde sale |
|---|---|---|
| Mensajes de chat de tu cuenta | **576** | consulta a producción |
| Peso de esos mensajes | **348 kB** (87 kB de texto + 260 kB de metadatos) | consulta a producción |
| Cuántos de esos 576 lee la pantalla de inicio | **los 576, en cada carga** | `shell-payload.ts:143-149` |
| Viajes a la base sólo para leer el hilo | **4 seguidos** (páginas de 200 + conteo) | `thread-view-contract.ts:73-125` |
| Esperas encadenadas antes del primer píxel | **~10 tandas**, algunas con varios viajes dentro | `shell-payload.ts:127-297` |
| Región de la base | `us-east-2` (Ohio) | Supabase |
| Región de las funciones | sin fijar ⇒ por defecto `iad1` (Virginia) | `vercel.json` |
| Archivo de sesión (`middleware`) | **no existe** | búsqueda en todo el repo |
| Comentario en `supabase-server.ts:26` | *"Middleware will refresh sessions when needed"* | promete algo que no existe |
| `getSession()` por carga de `/app` | **2** (layout + página), sin poder guardar la cookie renovada | `layout.tsx:16`, `page.tsx:12` |
| Orbes con nivel de líquido | **1 de 5** (Saldo). Los otros cuatro son `null` | `shell-payload.ts:317,329,345,359` |
| Qué dibuja el orbe cuando el nivel es `null` | vidrio y halo, **sin agua** | `StaticOrb.tsx:24` |
| Avisos de rendimiento en la base | 126 políticas RLS re-evaluadas por fila; 88 llaves foráneas sin índice | advisors de Supabase |

Dos aclaraciones honestas sobre esa tabla:

1. **Las consultas SQL en sí son rápidas.** Medí los tiempos reales del motor
   de base de datos: las lecturas de pantalla salen en milisegundos. La
   lentitud **no** está en la base. Está en cuántas veces vamos y volvemos, y
   en cuánto traemos.
2. **Los 126 avisos de RLS probablemente no son la causa de la lentitud del
   inicio**, porque las lecturas pesadas del inicio corren con permisos de
   servidor, saltando esas políticas. Lo dejo anotado como deuda real, pero
   **no lo pondría primero**: es tocar seguridad para ganar poco. Volvemos a
   ello sólo si la medición de N1 lo señala.

---

## 2. Los doce puntos son seis causas

Los hallazgos del founder no son doce problemas. Son seis, y por eso se pueden
matar de raíz en vez de parchear uno por uno.

### Causa A — La pantalla de inicio hace el trabajo de toda la app antes de mostrar nada

*(explica: "se demora horas en cargar", "a veces tira error", "se queda varios
minutos cargando después de entrar")*

Para dibujar **un orbe y una cifra**, hoy el servidor:

- construye el contexto financiero completo,
- construye el *briefing* de coaching (que además **escribe** la foto diaria),
- lee las cotizaciones,
- lee dieciocho días de historia,
- lee el último movimiento,
- y **lee la conversación entera: 576 mensajes, 348 kB, en cuatro viajes**.

Todo eso ocurre **en serie** y **antes del primer píxel**. Nada se muestra
hasta que la última pieza termina. El esqueleto gris que él fotografió es la
app esperando esa cadena entera.

Y el hilo de chat, además de costar cuatro viajes al servidor, **viaja
completo al teléfono** dentro de la respuesta inicial (`SantuarioShell.tsx:738`),
aunque el chat esté cerrado. Es decir: la pantalla que muestra un número te
descarga toda tu conversación por si acaso.

El error intermitente tiene su propia línea: `shell-payload.ts:281` dice
`if (movementError) throw movementError`. Si falla la lectura **del último
movimiento** —un dato decorativo— la pantalla entera revienta a la tarjeta
"Algo se trabó por un momento". Un detalle secundario tumba la casa.

### Causa B — La sesión no se puede renovar

*(explica: "todo el proceso de inicio de sesión es muy malo y confuso, arroja
muchos errores")*

`supabase-server.ts` intenta guardar la sesión renovada, no puede (desde una
página de servidor Next lo prohíbe), y se calla con un comentario que dice
*"el middleware la renovará"*. **Ese middleware no existe.** Nunca se escribió.

Consecuencia: cuando tu token vence (por defecto, una hora), cada visita
intenta renovar de nuevo, sin poder guardar el resultado. Eso produce
exactamente lo que él describe: entrar cuesta, tira errores, a veces te
devuelve al login, y cada carga paga un viaje extra de autenticación.

**Esto es un defecto estructural, no de estilo, y toca la frontera de
seguridad del proyecto. Necesito tu permiso explícito para arreglarlo.**

### Causa C — El orbe se dibuja dos veces, y se cambia de una a otra a la vista

*(explica: "el render es terrible, cambia una y otra vez entre orbe sólido sin
luz, orbe con bordes difuminados y orbe mejor renderizado")*

Hay **dos orbes**: uno de CSS (barato, siempre presente) y uno de WebGL (el
bueno). La regla actual (`SantuarioShell.tsx:337`) enseña el bueno sólo si:
el carrusel está quieto **y** el chat está cerrado **y** la calidad medida es
mayor que cero **y** no hay niebla.

Traducido: **cada vez que deslizas, el orbe bueno se apaga y aparece el barato;
al soltar, vuelve.** Con una transición de opacidad de por medio, que es el
tercer aspecto que él vio. Sus propias capturas 11, 12 y 13 son el mismo orbe
de Reserva en tres formas distintas con segundos de diferencia.

Además el orbe arranca siempre en calidad 0 (el barato) y sube después, y la
escalera de calidad puede bajar sola a mitad de sesión. Cada cambio es otra
sustitución visible.

**Esto lo diseñé yo en el spec de M2.** La intención era honesta (degradar en
teléfonos lentos) pero el efecto es el peor posible: el usuario ve al producto
cambiando de opinión sobre cómo se ve.

### Causa D — Cuatro de los cinco orbes están vacíos por decisión mía

*(explica: "los orbes se ven vacíos a pesar de que tengo saldo")*

Sólo Saldo tiene nivel de líquido. Reserva, Metas, Patrimonio y Deuda tienen
`level: null`, y el orbe sin nivel **no dibuja agua**: es una bola de vidrio.

El origen es una orden mía en la auditoría de M1: *"un orbe no puede afirmar
un hecho que el motor no afirma"*. La lógica era buena — sin un denominador
real, un nivel es una mentira. Pero la conclusión que saqué fue mala: **preferí
el vacío a la mentira, y el vacío también comunica algo falso.** Un usuario
nuevo con 4.311$ de respaldo ve una bola hueca y concluye que no tiene nada, o
que la app está rota.

La salida correcta no es dibujar un nivel inventado: es **darle a cada capa un
denominador de verdad** (§5, N2) y decidir qué materia le corresponde a la que
no lo tenga. Y su propia intuición es exacta: **incluso el vacío necesita una
gota**, algo que diga "esto está vacío a propósito" en vez de "esto no cargó".

### Causa E — La conversación no obedece las leyes de un chat de teléfono

*(explica cinco hallazgos: la hoja que no se expande, el teclado que tapa, el
swipe que cierra, la barra de estado encima, y no encontrar cómo ir a pantalla
completa)*

Cuatro defectos independientes, todos del mismo tipo — la hoja de chat no fue
construida con la física de una hoja:

1. **Los gestos de arrastre están puestos sobre la hoja entera**
   (`SantuarioShell.tsx:693` y siguientes), con captura del puntero. Cualquier
   arrastre hacia abajo de más de 46 px **cierra el chat** — incluido el
   arrastre con el que uno sube por los mensajes viejos. El gesto de leer y el
   gesto de cerrar son el mismo gesto.
2. **La hoja mide `min(86svh, 780px)` fijo** y no reacciona al teclado. En
   iOS, el teclado no empuja los elementos fijos: los tapa. Por eso escribe a
   ciegas.
3. **No existe ningún control para expandir la hoja.** No es que no lo
   encuentre: no está.
4. **La página completa de chat no respeta el área segura del teléfono.** La
   app está configurada para dibujar de borde a borde y bajo la barra de
   estado (correcto para sentirse nativa), pero esa pantalla no compensa
   arriba — por eso el reloj y el WiFi se comen la flecha de volver.

### Causa F — Los mensajes no están terminados de escribir

*(explica: los `**`, el nombre de archivo, "Nota de voz", el texto cortado)*

- `ChatView.tsx:579` escribe el texto **crudo**. El agente responde en
  markdown porque Telegram lo entiende; la web lo enseña con asteriscos.
- `ChatView.tsx:273` pone `📷 ${file.name}` como contenido del mensaje, y
  debajo repite el mismo nombre en una tarjeta. **La foto nunca se ve.**
- La nota de voz muestra `🎙 Nota de voz` y ya. El audio **no se guarda** en
  ningún lado (se transcribe y se descarta), así que reproducirlo es una
  capacidad nueva, no un arreglo de estilo. Ver decisión D-N3.
- El campo para escribir es de una sola línea (`ChatView.tsx:690` y el del
  santuario). Cuando una sugerencia larga lo llena, se ve cortada.

### Y la sexta, que él nombró sin nombrarla

*(explica: "la página de métricas se ve como una página reducida dentro de la
página anterior, con un doble filo de tarjetas a los lados")*

**"Cómo vas" no es una pantalla: es una hoja flotante que contiene tarjetas.**
Dos bordes redondeados concéntricos, dos superficies, dos sombras. El ojo lee
"ventana dentro de ventana" y el cerebro lo registra como error de armado.
Es el mismo pecado que el orbe doble: **una cosa presentada como dos.**

---

## 3. Qué significa "premium", mecánicamente

Él nombró Tesla, Stripe y Whoop. Vale la pena desarmar qué comparten, porque
"pulir" no es una instrucción ejecutable y esto sí:

1. **Una cosa se dibuja de una sola manera.** Nunca ves el producto cambiando
   de opinión sobre cómo se ve algo. (Mata C y el doble filo.)
2. **Todos los estados están diseñados.** Cargando, vacío, sin dato, sin
   señal, error: cada uno tiene su forma pensada. Un producto barato sólo
   diseña el estado feliz y deja los otros al azar. (Mata D y el reventón de
   A.)
3. **El toque responde antes que el dato.** Lo que se siente rápido no es lo
   que es rápido: es lo que contesta al dedo de inmediato y llena después.
4. **Los valores salen de una escala, no del criterio del momento.** Tres
   tamaños de texto, no once. Cuatro espaciados, no veinte. Esa disciplina es
   la diferencia entre "ordenado" y "hecho a mano".
5. **El movimiento tiene una sola física.** Todo frena igual. Cuando cada
   animación tiene su propia curva, el conjunto se siente barato aunque cada
   pieza esté bien.
6. **El texto está terminado.** Nada de asteriscos, nombres de archivo,
   truncados o palabras de sistema.
7. **Los gestos no compiten.** Un gesto, un significado.

**El NJRE que él describe es la suma de las violaciones de estas siete.** No
hay un defecto grande; hay cuarenta chicos que apuntan todos a lo mismo: esto
no fue terminado por nadie que lo usara.

Y una octava, propia de Kipu: **calma es una promesa financiera, no un color.**
Una app que promete tranquilidad y hace esperar, parpadear y equivocarse
contradice su propia tesis. En una app de fotos el lag molesta; aquí el lag
dice *"tus datos no están firmes"*. Por eso la velocidad es la primera etapa y
no un lujo del final.

---

## 4. La caminata con ojos humanos

### A. Una persona nueva, primeros noventa segundos

| Momento | Lo que ve hoy | Lo que debería pasar |
|---|---|---|
| 0 s · toca el ícono | pantalla negra | el orbe ya está ahí, dibujado, esperando su cifra |
| 1–15 s | esqueleto gris de barras redondeadas | el orbe respira; la cifra llega cuando llega |
| a veces | "Algo se trabó por un momento" | eso no debería poder pasar por un dato decorativo |
| llega | cinco pestañas: Saldo, Reserva, Metas, Patrimonio, Deuda | igual, están bien |
| primera mirada | **una bola de vidrio hueca con una cifra debajo** | el nivel dice de un vistazo cómo va esa capa |
| desliza | el orbe cambia de aspecto al deslizar y al soltar | el orbe es el mismo objeto siempre |
| lee la píldora | "Tu ritmo va 70.10$ a la semana por encima de lo seguro" | ¿por encima de lo seguro *para qué*? falta el sustantivo |
| toca el campo de abajo | se abre una hoja de chat | bien — es el gesto correcto |
| escribe | **el teclado tapa lo que escribe** | el chat sube con el teclado |
| sube a leer | **el chat se cierra** | subir es leer, no cerrar |
| pide "Cómo vas" | una ventana dentro de la ventana | una pantalla |

**El momento que decide todo es el sexto.** Un usuario nuevo llega al orbe sin
manual. Si el orbe está vacío, la metáfora entera —el nivel de agua es tu
plata— **no se enseña nunca**, y el producto queda como una cifra dentro de un
adorno. Todo el concepto de Kipu se juega en ese segundo, y hoy lo perdemos.

### B. El founder, mañana a las 8:00

| Momento | Fricción real |
|---|---|
| abre desde el ícono | espera larga; a veces error; a veces vuelta al login |
| mira el Saldo | correcto — esta parte funciona |
| "gasté 20 en el almuerzo" | toca, se abre la hoja, el teclado tapa, escribe a ciegas |
| envía | el recibo aparece; el orbe baja — **esto está bien hecho** |
| quiere ver qué dijo ayer | sube, **el chat se cierra**, vuelve a abrir, sube despacio |
| manda una foto del recibo | `📷 d0396cec-9f79-436b…jpeg` y la foto no se ve |
| lee la respuesta | asteriscos por todos lados |
| abre "Cómo vas" | ventana dentro de ventana, seis líneas de "Denominador · …" |

Su queja de densidad tiene razón y tiene una regla detrás: **el denominador se
enseña cuando se duda, no siempre.** Hoy lo mostramos siempre porque nos costó
mucho ganarlo. Eso es orgullo de ingeniería en la cara del usuario. La cifra va
sola; el denominador vive detrás de un toque.

---

## 5. El plan — Bloque N, "el acabado"

Ocho etapas. Cada una con **una promesa que se puede verificar**, en el mismo
formato que funcionó en el Bloque M: spec → implementación → auditoría por
ejecución, con mutaciones que maten un test con nombre.

El orden no es por gravedad: es por **dependencia**. La regla antes de las
pantallas, la velocidad antes del detalle (porque medir sobre algo lento
miente), y el orbe antes que el resto porque es lo primero que ve un humano.

---

### N0 · La regla y el metro

**Promesa:** después de N0 ninguna pantalla inventa un valor propio, y podemos
medir lo que arreglamos.

- Una escala de tipografía, una de espaciado, una de esquinas, una de
  elevación. Una sola física de movimiento (duraciones y curvas con nombre).
- **Un vocabulario de estados** común: *cargando · vacío · sin dato · sin
  señal · error*. Cinco formas, no cuarenta improvisaciones.
- Una página interna `/dev/sistema` que muestra los tokens y **los cinco
  estados de cada componente** — el lugar donde se aprueba el acabado sin
  tener que reproducir un error real.
- El metro: medición real de tiempo de apertura desde su teléfono, no desde
  esta máquina. Sin esto, "más rápido" es una opinión.

*Chico en código, decisivo para todo lo demás.*

---

### N1 · Que abra

**Promesa:** el orbe y su cifra aparecen en menos de ~1,5 s en su teléfono; una
lectura secundaria lenta o caída nunca deja la pantalla en blanco; una sesión
vencida nunca produce un error.

- **El hilo de chat sale de la pantalla de inicio.** Se carga cuando abres la
  conversación. (−4 viajes, −348 kB por carga.)
- Lo que no es el orbe se **transmite en cuanto está listo** en vez de
  retener la página: primero el orbe, después la píldora, después la
  perspectiva.
- **Ningún dato decorativo puede tumbar la pantalla**: el último movimiento
  que no se puede leer simplemente no se muestra. (Doctrina existente del
  proyecto: "no pude leer" ≠ "no hay nada"; hoy la pantalla de inicio la
  incumple.)
- **El archivo de sesión que nunca se escribió** — renovación de la sesión en
  el borde, una vez, guardada bien. Cierra los errores de login y quita un
  viaje de autenticación por carga. **Requiere tu permiso (D-N1).**
- Fijar la región de las funciones junto a la base (`us-east-2`).

*Es la etapa con más impacto por línea de código de todo el bloque.*

---

### N2 · Un solo orbe

**Promesa:** desde el primer píxel hasta el último cuadro, el orbe es **un solo
objeto**. Nunca se sustituye a la vista. Cada capa tiene un nivel que significa
algo que se puede decir en una frase. El vacío se ve deliberado.

- Se elimina la sustitución: o el orbe bueno está desde el principio, o el
  provisional es **visualmente idéntico** en el instante del relevo. Nunca
  se apaga al deslizar.
- La calidad se decide **una vez** por dispositivo y no vuelve a cambiar
  delante del usuario.
- **Un denominador honesto por capa** (decisión D-N2): Reserva contra su meta
  de respaldo; Metas contra el aporte del mes; Deuda contra el ciclo cubierto;
  Patrimonio conserva su materia propia (núcleo de cristal, no líquido) porque
  el patrimonio total no tiene techo — y entonces **necesita otra señal de
  vida**, no un nivel.
- **El vacío con gota**: su idea, adoptada. Un orbe en cero muestra una gota y
  su menisco en el fondo. "Vacío" y "no cargó" dejan de parecerse.
- La regla que sale de aquí y queda como doctrina: *si el motor no puede
  afirmar un nivel, se cambia la materia — no se apaga el orbe.*

---

### N3 · La conversación, la superficie

**Promesa:** la hoja se abre hasta arriba, sigue al teclado, y sólo se cierra
cuando lo pides. En la pantalla completa nada queda debajo del reloj.

- El arrastre vive **sólo en el asa**. El contenido se desplaza sin cerrar
  nada.
- La hoja **sigue al teclado** de verdad (el teclado no la tapa: la levanta).
- Se puede **expandir a pantalla completa** con un gesto y con un botón
  visible, y volver.
- Área segura arriba, abajo y a los lados en todas las superficies de
  conversación.
- Una sola conversación, con dos tamaños. Hoja y pantalla dejan de ser dos
  comportamientos distintos (D-N4).

---

### N4 · La conversación, el contenido

**Promesa:** cada mensaje se lee como si lo hubiera escrito una persona.

- **Negritas de verdad** en vez de `**asteriscos**`. Un intérprete de texto
  pequeño y seguro (negrita, itálica, listas, saltos), nada de HTML del
  modelo.
- **Las fotos se ven.** Miniatura en la burbuja, toque para ampliar. Nunca un
  nombre de archivo como contenido.
- **Las notas de voz** dejan de ser una etiqueta: como mínimo se muestra lo
  que dijiste; con reproducción si decides guardar el audio (D-N3).
- **Campo de escritura de varias líneas** que crece: nada se corta jamás.
- Los detalles pequeños que hacen a un chat sentirse serio: hora agrupada,
  copiar con pulsación larga, reintento visible, el "escribiendo…" con la
  misma física que todo lo demás.

---

### N5 · Las pantallas

**Promesa:** "Cómo vas" es una pantalla. Las nueve superficies de detalle
comparten una sola gramática. Ninguna dice más de lo que hace falta.

- Perspectiva pasa a ser una pantalla propia — se acaba la ventana dentro de
  la ventana y el doble filo.
- Una gramática única de página: cómo se vuelve, dónde va el título, cómo se
  ve una tarjeta, cómo se ve una cifra, cómo se ve un vacío.
- **Pasada de densidad**: el denominador y la explicación se ganan un toque,
  no un renglón permanente. Su crítica al mock, ahora aplicada al producto.

---

### N6 · La entrada y el primer minuto

**Promesa:** desde tocar el ícono hasta ver tu plata, cada paso es una acción
clara con palabras humanas — incluidos los pasos que salen mal.

- Entrar, contraseña equivocada, sesión vencida, cuenta nueva, y la primera
  vez que se abre el santuario **sin datos todavía**.
- El esqueleto de carga debe tener **la forma de lo que viene**, no barras
  genéricas (hoy no se parece a la pantalla real; por eso la espera se siente
  más larga de lo que es).
- El primer encuentro con el orbe: una frase que enseñe la metáfora, una sola
  vez.

---

### N7 · La pasada humana

**Promesa:** nada se da por terminado sin una caminata lenta en un teléfono de
verdad y cinco desconocidos.

- Recorrido guionado en su dispositivo, pantalla por pantalla, con la lista de
  las siete leyes de §3 como criterio.
- **La prueba de pasillo con 5 personas nuevas** que recomendé antes del
  Bloque M y nunca corrimos: sesenta segundos con la app, sin explicación, y
  una sola pregunta — *"¿qué te está diciendo esto?"*. Si el orbe no se
  explica solo, lo sabremos ahí y no en producción.
- Un teléfono Android de gama media, que ningún circuito automático de este
  proyecto puede sustituir.

---

## 6. Lo que necesito que decidas

| # | Decisión | Mi recomendación |
|---|---|---|
| **D-N1** | ¿Autorizas tocar la sesión (el archivo de renovación que falta)? Es frontera de seguridad del proyecto. | **Sí.** Es la causa de los errores al entrar y de un viaje extra por carga. Es un archivo nuevo y acotado; te muestro el diff antes de desplegar. |
| **D-N2** | ¿Qué nivel muestra cada capa? Un nivel implica un techo, y un techo es una promesa. | Reserva ⇒ contra tu meta de respaldo. Metas ⇒ aporte del mes. Deuda ⇒ ciclo cubierto. **Patrimonio ⇒ sin nivel, con materia propia** (no tiene techo honesto). |
|  |  |  |
| | **RESUELTAS por el founder el 2026-08-28** | |
| **D-N1 ✅** | Autorizado. | Se escribe la renovación de sesión en N1, con el diff a la vista antes de desplegar. |
| **D-N2 ✅** | Denominador por capa; Patrimonio sin nivel. | Los tres denominadores **ya existen en el motor** y no hay que inventarlos: `emergency_reserve_target` (respaldo), `capacity.monthlyProtected.goals` (aporte del mes) y `statement_covered`/`statement_total_due` de la migración 065 (ciclo de tarjeta cubierto). Patrimonio conserva su núcleo de cristal. Cero en cualquier capa ⇒ gota + menisco, nunca vidrio hueco. |
| **Método ✅** | Dos chats por etapa: uno implementa, otro audita en frío. | Ver §7. |
| **D-N3** | ¿Guardamos el audio de las notas de voz para poder reproducirlas? Hoy se transcribe y se descarta. | **No en N4.** Guardar voz es dato sensible y costo permanente para un beneficio de comodidad. Primero mostramos la transcripción como el mensaje; si la extrañas, lo revisamos con calma. |
| **D-N4** | ¿La conversación vive en la hoja, en la pantalla completa, o en las dos? | **Una sola, con dos tamaños.** La hoja se expande a pantalla completa; deja de haber dos comportamientos. |
| **D-N5** | Las 126 políticas de base con re-evaluación por fila. | **No ahora.** No están en el camino lento del inicio y tocar seguridad tiene su propio riesgo. Volvemos si la medición de N1 las señala. |
| **D-N6** | ¿Corremos la prueba de pasillo con 5 personas? | **Sí, en N7.** Es lo único que puede decirnos si la metáfora del orbe se entiende sin manual, y es barato. |

---

## 7. Cómo organizamos los chats

Él preguntó si seguimos aquí, empezamos de cero, o usamos dos chats. Mi
recomendación, con el motivo:

- **Este chat cierra con el plan y nada más.** Ya carga todo el Bloque M; usarlo
  para implementar lo llena y empieza a olvidar.
- **Un chat por etapa.** Cada uno entra leyendo su spec, que es un contrato
  autocontenido. Es exactamente lo que hizo funcionar el Bloque M.
- **Dos chats sí, pero no en paralelo sobre el mismo código.** Las etapas de N
  tocan los mismos archivos (el santuario, el chat, los estilos): trabajar en
  paralelo produce choques y valores inconsistentes. El uso correcto del
  segundo chat es otro: **auditor.**

Y aquí va lo incómodo, que él debe saber: **desde que dejamos de usar Codex, yo
escribo el spec, implemento y me audito solo.** Eso es marcar mi propio examen.
Los defectos más caros del Bloque M los encontró alguien que no sabía qué
intención tenía el autor — a veces Codex, a veces yo auditando a Codex. Ese
papel hoy está vacante.

**Propuesta concreta:** chat A implementa la etapa; **chat B la audita en frío**,
sin haber visto la conversación de A, con el spec y el código como única
entrada. Sale casi gratis y devuelve la única red que de verdad atrapó cosas.

---

## 8. En una página, sin jerga

Probaste la app y sentiste que era artesanal. Tenías razón, y encontré por qué.
No son doce errores sueltos: son seis.

**Uno.** Para mostrarte un orbe y un número, la app hace primero todo el trabajo
de toda la app — incluida la lectura de tus 576 mensajes de chat, 348 kB, en
cada apertura, aunque el chat esté cerrado. Nada aparece hasta que todo
termina. Además, si falla un dato decorativo, revienta la pantalla entera.

**Dos.** El archivo que renueva tu sesión nunca se escribió. Hay un comentario en
el código que dice "el middleware la renovará" y ese middleware no existe. Por
eso entrar cuesta y a veces te expulsa.

**Tres.** Hay dos orbes dibujados de dos maneras, y la app cambia de uno a otro
cada vez que deslizas. Lo que viste como "cambia una y otra vez" es literal: el
producto cambiando de opinión sobre cómo se ve. Eso lo diseñé yo, y estaba mal.

**Cuatro.** Cuatro de los cinco orbes están vacíos porque yo ordené que un orbe
no mostrara un nivel que el motor no pudiera respaldar. La lógica era buena, la
conclusión no: el vacío también miente, y encima esconde la idea central de
Kipu. Tu instinto de la gota es la salida correcta.

**Cinco.** La hoja de chat no fue construida con la física de una hoja: el gesto
de leer y el de cerrar son el mismo, el teclado la tapa en vez de levantarla, y
no hay ningún control para agrandarla.

**Seis.** Los mensajes no están terminados de escribir: asteriscos crudos,
nombres de archivo en lugar de la foto, "Nota de voz" en lugar de lo que
dijiste, y un campo de una sola línea que corta el texto.

**El plan son ocho etapas.** Primero la regla (una sola escala de tamaños, de
espacios y de movimiento, para que el acabado deje de depender del pulso).
Después la velocidad y la sesión, porque una app que promete calma y te hace
esperar se contradice sola. Después el orbe, porque es lo primero que ve un
humano y hoy no enseña la idea. Después la conversación, en dos partes: cómo se
comporta y cómo se lee. Después las pantallas. Después la entrada. Y al final
una caminata lenta en tu teléfono más cinco desconocidos de sesenta segundos
cada uno, que es la única prueba que nos falta desde hace meses.

**Nada de esto toca cómo se calcula tu plata.** Todos los números que viste eran
correctos. Es acabado, y por eso se puede hacer entero sin arriesgar el motor.

Necesito seis decisiones tuyas (§6). La única urgente es la primera: permiso
para tocar el archivo de sesión, que es la frontera de seguridad del proyecto y
la causa de que entrar sea un suplicio.
