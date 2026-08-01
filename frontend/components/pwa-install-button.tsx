"use client";

import { useSyncExternalStore } from "react";

// Minimales Event-Interface für beforeinstallprompt - im Standard-DOM-Typing
// (noch) nicht enthalten, daher hier lokal beschrieben statt "any".
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Status = "installable" | "installed" | "manual-hint" | "hidden";

// Modul-weiter Zustand statt useState+useEffect: beforeinstallprompt/
// appinstalled sind Browser-Ereignisse, die schon vor der ersten React-
// Reaktion feuern können, und useSyncExternalStore ist genau für das
// Zusammenführen von externem (Browser-)Zustand mit SSR-sicherem Rendern
// gemacht - ohne synchrones setState im Effekt und ohne Hydration-Mismatch
// (getServerSnapshot liefert bewusst immer "hidden").
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedFlag = false;
let listenersAttached = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mediaStandalone = window.matchMedia("(display-mode: standalone)").matches;
  // iOS/iPadOS Safari kennt kein display-mode: standalone, sondern dieses
  // proprietäre, nicht standardisierte Flag auf navigator.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return mediaStandalone || iosStandalone;
}

function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  return /^((?!chrome|android|crios|edgios|edg\/).)*safari/i.test(navigator.userAgent);
}

function ensureListenersAttached() {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installedFlag = true;
    notify();
  });
}

function subscribe(onStoreChange: () => void) {
  ensureListenersAttached();
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

let cachedStatus: Status = "hidden";

function computeStatus(): Status {
  if (installedFlag || isStandalone()) return "installed";
  if (deferredPrompt) return "installable";
  // Safari (macOS/iOS) unterstützt beforeinstallprompt nicht - dort bleibt
  // nur der Hinweis auf den Browser-eigenen Installationsweg. Andere
  // Browser ohne Unterstützung (z.B. Firefox Desktop) zeigen bewusst gar
  // nichts, um keine Installation zu versprechen, die es dort nicht gibt.
  if (isSafari()) return "manual-hint";
  return "hidden";
}

function getSnapshot(): Status {
  const next = computeStatus();
  if (next !== cachedStatus) cachedStatus = next;
  return cachedStatus;
}

function getServerSnapshot(): Status {
  return "hidden";
}

async function handleInstallClick() {
  if (!deferredPrompt) return;
  const prompt = deferredPrompt;
  await prompt.prompt();
  await prompt.userChoice;
  // appinstalled feuert bei Annahme zusätzlich und setzt "installed" - bei
  // Ablehnung verschwindet der Button hier trotzdem, damit kein bereits
  // verworfener Prompt kein zweites Mal ausgelöst werden kann.
  deferredPrompt = null;
  notify();
}

export default function PwaInstallButton() {
  const status = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (status === "hidden") return null;

  if (status === "installed") {
    return (
      <p className="pwa-install-note" role="status">
        <span aria-hidden="true">✓</span> Planner-Agent ist installiert
      </p>
    );
  }

  if (status === "manual-hint") {
    return (
      <p className="pwa-install-note">
        Über das Browsermenü installierbar: „Zum Dock hinzufügen“
        beziehungsweise „App installieren“.
      </p>
    );
  }

  return (
    <button type="button" className="pwa-install-button" onClick={handleInstallClick}>
      Planner-Agent installieren
    </button>
  );
}
