"use client";

import { useEffect } from "react";

const KIPU_SW_URL = "/sw.js";
const KIPU_CACHE_PREFIX = "kipu-static-";

export async function uninstallKipuServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) =>
        [registration.active, registration.installing, registration.waiting].some((worker) =>
          worker?.scriptURL.endsWith(KIPU_SW_URL),
        ),
      )
      .map((registration) => registration.unregister()),
  );
  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith(KIPU_CACHE_PREFIX)).map((name) => caches.delete(name)),
    );
  }
}

export function PwaServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    let mounted = true;
    void navigator.serviceWorker
      .register(KIPU_SW_URL, { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (mounted) return registration.update();
      })
      .catch((error: unknown) => {
        console.warn("[Kipu] No pude activar el modo sin conexión.", error);
      });

    const uninstall = () => void uninstallKipuServiceWorker();
    window.addEventListener("kipu:uninstall-service-worker", uninstall);
    return () => {
      mounted = false;
      window.removeEventListener("kipu:uninstall-service-worker", uninstall);
    };
  }, []);

  return null;
}
