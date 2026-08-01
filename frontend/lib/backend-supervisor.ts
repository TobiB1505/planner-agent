// Serverseitiges Modul (nur in Route Handlers verwendet, nie im Browser-Bundle):
// startet/überwacht den lokalen Python-Backend-Prozess von Next.js aus.
//
// Warum das nötig ist: der bisherige Neustart-Weg (POST /api/system/restart,
// von FastAPI selbst beantwortet) kann grundsätzlich nicht helfen, wenn das
// Backend bereits abgestürzt oder gar nicht gestartet ist - eine Anfrage an
// einen toten Server kommt nie an. Next.js läuft in diesem Fall aber
// weiterhin (der Nutzer sieht ja die Seite) und kann als einziger noch
// laufender Prozess einen neuen Backend-Prozess starten.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// frontend/ liegt eine Ebene unter dem Projektstamm.
const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000";
const LOG_PATH = path.join(PROJECT_ROOT, "local_data", ".backend-supervisor.log");

let trackedChild: ChildProcess | null = null;

function resolvePython(): string | null {
  const isWindows = process.platform === "win32";
  const candidates = isWindows
    ? [
        path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe"),
        path.join(PROJECT_ROOT, "venv", "Scripts", "python.exe"),
      ]
    : [
        path.join(PROJECT_ROOT, ".venv", "bin", "python"),
        path.join(PROJECT_ROOT, "venv", "bin", "python"),
      ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function isBackendHealthy(timeoutMs = 1500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${BACKEND_URL}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function isTrackedChildAlive(): boolean {
  return trackedChild !== null && trackedChild.exitCode === null && !trackedChild.killed;
}

function spawnBackend(): { ok: boolean; message: string } {
  const python = resolvePython();
  if (!python) {
    return {
      ok: false,
      message:
        "Keine virtuelle Python-Umgebung gefunden (.venv oder venv). Bitte einmalig einrichten (siehe README).",
    };
  }

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  const logFd = fs.openSync(LOG_PATH, "a");

  const child = spawn(python, ["-m", "backend.run_local"], {
    cwd: PROJECT_ROOT,
    // detached, damit der Backend-Prozess unabhängig vom Next.js-Prozess
    // weiterläuft, falls das Frontend selbst neu geladen/beendet wird.
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  trackedChild = child;
  child.on("exit", () => {
    if (trackedChild === child) trackedChild = null;
  });

  return { ok: true, message: "Backend wird gestartet." };
}

/**
 * Stellt sicher, dass ein erreichbares Backend läuft - egal in welchem
 * Zustand es gerade ist:
 * - läuft es bereits: die vorhandene Instanz per eigenem Restart-Endpunkt
 *   (execv, siehe backend/api.py) neu starten lassen.
 * - läuft es nicht (abgestürzt, nie gestartet, Prozess extern beendet):
 *   einen frischen Prozess direkt aus Next.js heraus starten.
 */
export async function ensureBackendRestarted(): Promise<{ ok: boolean; message: string }> {
  const healthyBefore = await isBackendHealthy();

  if (healthyBefore) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      await fetch(`${BACKEND_URL}/api/system/restart`, { method: "POST", signal: controller.signal });
      clearTimeout(timer);
    } catch {
      // Die Verbindung kann durch den Neustart selbst abbrechen - erwartet.
    }
    return { ok: true, message: "Neustart des laufenden Backends ausgelöst." };
  }

  if (isTrackedChildAlive()) {
    // Hängender, aber nicht mehr gesund antwortender Prozess - sauber beenden.
    trackedChild?.kill();
    trackedChild = null;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return spawnBackend();
}

export async function backendSupervisorStatus() {
  return {
    backend_reachable: await isBackendHealthy(),
    tracked_process_alive: isTrackedChildAlive(),
  };
}
