# M5_AUDIT — Ronda 1 · VEREDICTO: **VERDE**

- **Fecha:** 2026-08-25 · **Árbol auditado:** `stage-m-front` @ `fc75334`
- **Entrada:** `M5_REPORT.md` Ronda 1 (V1–V16).
- **Método:** los dos runners headless + lint + build + **la corrida real del
  E2E de persona desechable** + una mutación propia + DOM en Chromium.

**M5 se acepta en una sola ronda.** La puerta de voz está construida sobre el
pipeline que ya existía, la trampa del formato quedó resuelta, y la regla
madre del stage —**el aura no finge**— se sostiene en el código.

---

## Verificado por ejecución

| | Cómo lo probé |
|---|---|
| **Gates** | `lint` **0 errores** · `build` **exit 0** · captura **838/838** por **los dos runners headless** (834 + 4 nuevas) |
| **E2E persona desechable** | Corrido por mí: **8/8 verdes, residuo cero** en DB y auth, incluido el caso nuevo **M5-E7 · «audio válido falla como `failed` honesto sin turno de asistente inventado»**. Usa el seam de dependencia nuevo, así que **no llama a OpenAI**: prueba el contrato sin gastar ni depender de la red |
| **Mutación con dientes** | Rompí `baseAudioMime` (dejar de separar el sufijo de codec) ⇒ **837/838** nombrando **M5-1**; revertido ⇒ **838/838** y árbol limpio |
| **La trampa del formato** | Resuelta como pedía D‑M5.4: `baseAudioMime()` corta el `;codecs=` y valida contra **la misma** lista del servidor; los formatos negociados cubren Chrome/Android (`audio/webm;codecs=opus`) y Safari/iOS (`audio/mp4`) |
| **El validador no se debilitó** | El cambio en `capture-matching.ts` es una **extracción pura** a `evidence-file-contract.ts`: mismo tope de 12 MB, mismos mimes de imagen y audio, re-exportados. Cero permisividad nueva |
| **Los otros canales siguen intactos** | `handleEvidenceCapture` sobrevive como envoltorio vivo y sus tres llamadores —web, correo entrante y **webhook de Telegram**— no cambiaron |
| **Ciclo de vida del micrófono** | `stopMediaStreamTracks()` vive en el contrato puro (por eso el gate puede ejercitarlo) y se llama desde la liberación central, las dos salidas tempranas, el desmontaje, y `visibilitychange` ⇒ `cancel()` con la pestaña oculta |
| **El aura no simula** | **Cero envolventes sintéticas** en el hook: el nivel de escucha sale de `rmsFromTimeDomain` sobre un `AnalyserNode` real. Sin micrófono no hay registro «escuchando» que inventar |
| **Valores del alma** | Tope de 120 s y ataque/caída **0,085 / 0,040** — los valores medidos de la v5, no reinventados |
| **Harness** | `?voice=calm\|listening\|thinking\|responding` funciona: verifiqué `data-voice-state` cambiando a `listening` y a `thinking` |
| **El «pronto» se retiró** | El botón dice **«Grabar nota de voz»**; el dock queda con grabar · foto · enviar, todo «sin salir» |
| **Alcance** | Cero dependencias, cero migraciones |

## Un falso positivo más, evitado por volver a mirar

`getTracks()` no aparecía en `useVoiceCapture.ts` y estuve a punto de reportar
**«el micrófono nunca se libera»**. La liberación vive en el módulo de
contrato puro como `stopMediaStreamTracks` — puesta ahí justamente para que el
gate pueda probarla. Es la sexta vez en el bloque que re-verificar evita una
acusación falsa; lo dejo escrito porque el patrón ya es la lección.

## Lo que NO puede verificar nadie de este circuito

Un micrófono real no se simula. Quedan para hardware:

- **V1** grabar y enviar de verdad una nota de voz;
- **V5** el comportamiento con el permiso denegado, en carne;
- **V6** que los cuatro registros se sientan como el hecho que representan
  mientras hablas;
- y los fps, como desde M2.

Lo que sí está probado: el contrato de formato, el fallo de transcripción como
estado terminal honesto **contra la base real**, la liberación del micrófono,
la ausencia de simulación, y que ningún otro canal se rompió.

## Estado

**M5 ACEPTADO.** `stage-m-front` acumula M1+M2+M3+M4+M5.

**Y aquí el circuito automático llegó a su techo.** M5 es el primer stage cuya
parte más importante —cómo se siente hablarle a Kipu y verla reaccionar— sólo
existe en un teléfono con micrófono. La pasada del founder deja de ser una
recomendación acumulada y pasa a ser **el siguiente paso del bloque**: voz,
amanecer, niveles de calidad y fps, en su máquina y en su teléfono, antes de
seguir a M6.
