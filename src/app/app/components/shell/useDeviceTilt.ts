"use client";

import { useEffect, useRef, useState } from "react";

// Bloque N3 §5.5 — el giroscopio, con su trampa.
//
// LA TRAMPA, verificada y no supuesta: en iOS 13+ el acelerómetro y el
// giroscopio están detrás de un permiso explícito, y
// `DeviceOrientationEvent.requestPermission()` **sólo puede pedirse desde un
// gesto del usuario**. No puede colgarse de un `useEffect` de arranque: llamarlo
// fuera de un gesto devuelve `NotAllowedError` y quema el pedido. Por eso este
// módulo no pide nada solo: expone `armFromUserGesture()`, y la superficie lo
// engancha al PRIMER toque real del santuario.
//
// LA DECISIÓN DEL FOUNDER (D-N3.3): se pide al iniciar la app por primera vez,
// una sola vez, y después queda resuelto. `denied` no vuelve a preguntar.
//
// Y LA REGLA QUE MANDA SOBRE TODO LO DEMÁS, en sus palabras: «el realismo del
// agua no debe depender de él». Este módulo SUMA una inclinación al mundo real;
// no la produce. Con el permiso denegado devuelve ceros para siempre, y el agua
// se ve exactamente igual de viva — su oleaje, su menisco, sus corrientes y su
// respuesta al gesto no pasan por acá.

export type DeviceTiltPermission =
  | "unsupported"
  | "unasked"
  | "granted"
  | "denied";

const STORAGE_KEY = "kipu:shell:tilt";

/** Cuánto inclina el agua un grado de teléfono. Deliberadamente pequeño. */
const DEGREES_TO_TILT = 0.0042;
/** Tope duro: el giroscopio nunca puede volcar el agua fuera del vaso. */
const MAX_TILT = 0.22;
/** Seguimiento suave — el agua tiene peso, no salta con cada muestra. */
const FOLLOW = 0.09;

interface OrientationPermissionApi {
  requestPermission?: () => Promise<"granted" | "denied">;
}

function permissionApi(): OrientationPermissionApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { DeviceOrientationEvent?: OrientationPermissionApi })
    .DeviceOrientationEvent;
  return api ?? null;
}

function readStored(): DeviceTiltPermission | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "granted" || raw === "denied" ? raw : null;
  } catch {
    // Storage puede estar deshabilitado. Entonces se vuelve a preguntar en el
    // próximo inicio, que es molesto pero honesto: fingir que ya se resolvió
    // dejaría el permiso apagado sin que nadie lo haya decidido.
    return null;
  }
}

function store(value: DeviceTiltPermission) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // idem
  }
}

function clampTilt(value: number): number {
  return Math.max(-MAX_TILT, Math.min(MAX_TILT, value));
}

export interface DeviceTiltHandle {
  /** Lo que hay que leer cada cuadro. SIEMPRE existe; sin permiso vale cero. */
  tilt: { current: { x: number; z: number } };
  permission: DeviceTiltPermission;
  /**
   * Se llama DESDE un gesto real del usuario. Sin gesto iOS no concede, así que
   * llamarlo desde un efecto de arranque sería perder el permiso.
   */
  armFromUserGesture: () => void;
}

export function useDeviceTilt(): DeviceTiltHandle {
  const tilt = useRef({ x: 0, z: 0 });
  const target = useRef({ x: 0, z: 0 });
  const armed = useRef(false);
  // El estado inicial se DERIVA, no se sincroniza con un efecto: lo que ya
  // decidió el usuario en un inicio anterior es un hecho conocido antes del
  // primer cuadro, y nada del DOM depende de él.
  const [permission, setPermission] = useState<DeviceTiltPermission>(() => {
    if (typeof window === "undefined") return "unasked";
    if (permissionApi() == null) return "unsupported";
    return readStored() ?? "unasked";
  });
  const listening = useRef(false);

  useEffect(() => {
    if (permission !== "granted" || listening.current) return;
    listening.current = true;
    const onOrientation = (event: DeviceOrientationEvent) => {
      // `gamma` es el balanceo izquierda/derecha y `beta` el cabeceo. El agua
      // se inclina EN CONTRA del teléfono, que es lo que hace un líquido.
      const gamma = event.gamma ?? 0;
      const beta = event.beta ?? 0;
      target.current = {
        x: clampTilt(-gamma * DEGREES_TO_TILT),
        z: clampTilt(-(beta - 40) * DEGREES_TO_TILT),
      };
    };
    window.addEventListener("deviceorientation", onOrientation);
    return () => {
      listening.current = false;
      window.removeEventListener("deviceorientation", onOrientation);
    };
  }, [permission]);

  // El seguimiento con peso vive fuera del bucle de dibujo para que el orbe
  // pueda leer `tilt.current` sin hacer cuentas, y para que un giroscopio
  // ausente cueste exactamente cero.
  useEffect(() => {
    if (permission !== "granted") {
      tilt.current = { x: 0, z: 0 };
      target.current = { x: 0, z: 0 };
      return;
    }
    let frame = 0;
    const step = () => {
      tilt.current = {
        x: tilt.current.x + (target.current.x - tilt.current.x) * FOLLOW,
        z: tilt.current.z + (target.current.z - tilt.current.z) * FOLLOW,
      };
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [permission]);

  const armFromUserGesture = () => {
    if (armed.current) return;
    armed.current = true;
    const api = permissionApi();
    if (api == null) return;
    if (typeof api.requestPermission !== "function") {
      // Android y escritorio: no hay permiso que pedir, se escucha y ya.
      setPermission("granted");
      return;
    }
    if (readStored() != null) return;
    api
      .requestPermission()
      .then((result) => {
        const next: DeviceTiltPermission = result === "granted" ? "granted" : "denied";
        store(next);
        setPermission(next);
      })
      .catch(() => {
        // Un rechazo del navegador NO se guarda como «denied»: eso cerraría la
        // puerta para siempre por un error de transporte. Queda sin preguntar.
        armed.current = false;
      });
  };

  return { tilt, permission, armFromUserGesture };
}
