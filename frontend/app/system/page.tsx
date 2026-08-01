"use client";

import PageHeader from "@/components/PageHeader";
import {
  ApiError,
  ensureBackendRestarted,
  getSystemDiagnostics,
  healthCheck,
  type SystemDiagnostics,
} from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

type HealthState = "checking" | "up" | "down";

const HEALTH_POLL_INTERVAL_MS = 5000;

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} Sek.`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours} Std. ${restMinutes} Min.`;
}

export default function SystemPage() {
  const [health, setHealth] = useState<HealthState>("checking");
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const [restarting, setRestarting] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const pollTimer = useRef<number | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      await healthCheck();
      setHealth("up");
      return true;
    } catch {
      setHealth("down");
      return false;
    }
  }, []);

  const loadDiagnostics = useCallback(async () => {
    try {
      const result = await getSystemDiagnostics();
      setDiagnostics(result);
      setDiagnosticsError("");
    } catch (error) {
      setDiagnosticsError(
        error instanceof ApiError ? error.message : "Diagnose konnte nicht geladen werden.",
      );
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const up = await checkHealth();
    if (up) await loadDiagnostics();
  }, [checkHealth, loadDiagnostics]);

  useEffect(() => {
    let active = true;

    healthCheck()
      .then(() => {
        if (!active) return;
        setHealth("up");
        return loadDiagnostics();
      })
      .catch(() => {
        if (active) setHealth("down");
      });

    pollTimer.current = window.setInterval(() => {
      checkHealth();
    }, HEALTH_POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRestart() {
    if (!window.confirm("Backend jetzt (neu) starten? Die Verbindung ist dabei kurz unterbrochen.")) {
      return;
    }
    setRestarting(true);
    setMessage({ kind: "info", text: "Neustart wird ausgelöst …" });
    try {
      // Läuft über Next.js selbst (nicht über das Backend) - funktioniert
      // deshalb auch, wenn das Backend gerade abgestürzt oder gar nicht
      // gestartet ist: in dem Fall startet Next.js direkt einen neuen
      // Backend-Prozess, statt (zwecklos) eine Anfrage an den toten Server
      // zu schicken.
      await ensureBackendRestarted();
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof ApiError ? error.message : "Neustart konnte nicht ausgelöst werden.",
      });
      setRestarting(false);
      return;
    }
    setHealth("down");

    // Kurz warten, bis der alte Prozess herunterfährt bzw. der neue
    // hochfährt, dann in kurzen Abständen prüfen - keine feste lange
    // Wartezeit.
    await new Promise((resolve) => setTimeout(resolve, 800));
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const up = await checkHealth();
      if (up) {
        await loadDiagnostics();
        setMessage({ kind: "success", text: "Backend wurde neu gestartet und ist wieder erreichbar." });
        setRestarting(false);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    setMessage({
      kind: "error",
      text: "Backend hat nach dem Neustart nicht rechtzeitig wieder geantwortet. Bitte Startskript prüfen.",
    });
    setRestarting(false);
  }

  function handleFrontendReload() {
    window.location.reload();
  }

  const dirLabels: Record<string, string> = {
    database: "Datenbank-Ordner",
    archive: "Dienstplanarchiv",
    uploads: "Uploads",
    exports: "Exporte",
  };

  return (
    <div className="system-page">
      <PageHeader
        title="System"
        subtitle="Health-Status, Diagnose und Neustart für das lokale Backend"
      />

      <section className="system-overview" aria-label="Status-Übersicht">
        <article className={health === "up" ? "tone-positive" : health === "down" ? "tone-warning" : ""}>
          <span>Backend</span>
          <strong>
            {health === "checking" && "…"}
            {health === "up" && "Erreichbar"}
            {health === "down" && "Nicht erreichbar"}
          </strong>
          <small>{health === "up" ? "Health-Check alle 5s" : "Bitte Startskript prüfen"}</small>
        </article>
        <article>
          <span>Laufzeit</span>
          <strong>{diagnostics ? formatUptime(diagnostics.uptime_seconds) : "–"}</strong>
          <small>seit letztem Start</small>
        </article>
        <article className={diagnostics?.database.status === "connected" ? "tone-positive" : "tone-warning"}>
          <span>Datenbank</span>
          <strong>
            {diagnostics?.database.status === "connected" && "Verbunden"}
            {diagnostics?.database.status === "missing" && "Fehlt"}
            {diagnostics?.database.status === "error" && "Fehler"}
            {!diagnostics && "–"}
          </strong>
          <small>{diagnostics?.database.integrity_check ?? "–"}</small>
        </article>
      </section>

      <section className="panel system-actions">
        <div className="panel-body">
          <h2>Aktionen</h2>
          <p className="system-actions-hint">
            Ein Neustart betrifft nur den Backend-Prozess - deine Daten bleiben unverändert.
          </p>
          <div className="system-actions-buttons">
            <button type="button" className="btn btn-primary" onClick={handleRestart} disabled={restarting}>
              {restarting ? "Backend startet neu …" : "Backend neu starten"}
            </button>
            <button type="button" className="btn" onClick={handleFrontendReload}>
              Frontend neu laden
            </button>
            <button type="button" className="btn" onClick={() => refreshAll()} disabled={restarting}>
              Diagnose aktualisieren
            </button>
          </div>
          {message && <div className={`status status-${message.kind}`}>{message.text}</div>}
        </div>
      </section>

      {diagnosticsError && (
        <section className="panel">
          <div className="panel-body">
            <div className="status status-error">{diagnosticsError}</div>
          </div>
        </section>
      )}

      {diagnostics && (
        <>
          <section className="panel system-diagnostics-panel">
            <div className="panel-body">
              <h2>Excel-Vorlagen</h2>
              <ul className="system-check-list">
                {diagnostics.templates.map((template) => (
                  <li key={template.filename}>
                    <span className={`system-dot ${template.exists ? "is-ok" : "is-warning"}`} aria-hidden="true" />
                    <span className="system-check-label">{template.name}</span>
                    <span className="system-check-detail">{template.filename}</span>
                    <span className="system-check-status">{template.exists ? "gefunden" : "fehlt"}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel system-diagnostics-panel">
            <div className="panel-body">
              <h2>Laufzeitordner</h2>
              <ul className="system-check-list">
                {Object.entries(diagnostics.directories).map(([key, dir]) => (
                  <li key={key}>
                    <span
                      className={`system-dot ${dir.exists && dir.writable ? "is-ok" : "is-warning"}`}
                      aria-hidden="true"
                    />
                    <span className="system-check-label">{dirLabels[key] ?? key}</span>
                    <span className="system-check-detail">{dir.path}</span>
                    <span className="system-check-status">
                      {!dir.exists ? "fehlt" : dir.writable ? "beschreibbar" : "nicht beschreibbar"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel system-diagnostics-panel">
            <div className="panel-body">
              <h2>Verbindung</h2>
              <dl className="system-detail-grid">
                <div>
                  <dt>Adresse</dt>
                  <dd>{diagnostics.host}:{diagnostics.port}</dd>
                </div>
                <div>
                  <dt>Erlaubte Origins (CORS)</dt>
                  <dd>{diagnostics.cors_origins.join(", ")}</dd>
                </div>
                <div>
                  <dt>Freier Speicherplatz</dt>
                  <dd>
                    {formatBytes(diagnostics.disk.free_bytes)} von {formatBytes(diagnostics.disk.total_bytes)}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
