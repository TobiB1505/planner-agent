"use client";

import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import InlineStatus from "@/components/ui/InlineStatus";
import {
  ApiError,
  ensureBackendRestarted,
  getSetting,
  getSystemDiagnostics,
  healthCheck,
  setSetting,
  type SystemDiagnostics,
} from "@/lib/api";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type HealthState = "checking" | "up" | "down";

const HEALTH_POLL_INTERVAL_MS = 5000;
const AUTO_REFRESH_SETTING_KEY = "system_auto_refresh_diagnostics";

type SystemGlyphKind = "server" | "clock" | "database" | "refresh" | "screen" | "check" | "file" | "folder" | "network";

function SystemGlyph({ kind }: { kind: SystemGlyphKind }) {
  const paths: Record<SystemGlyphKind, ReactNode> = {
    server: <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01M17 7h1M17 17h1" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></>,
    refresh: <><path d="M20 6v5h-5" /><path d="M18.2 16a8 8 0 1 1 .6-8.6L20 11" /></>,
    screen: <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 22h8M12 18v4" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.6 2.6L16.5 9" /></>,
    file: <><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></>,
    folder: <><path d="M3 7h7l2 2h9v10H3z" /><path d="M3 7V5h7l2 2" /></>,
    network: <><circle cx="12" cy="12" r="3" /><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><path d="m7 7 3 3m7-3-3 3M12 15v5" /></>,
  };
  return <svg className="system-glyph" viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>;
}

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
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
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

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gespeicherte Präferenz laden (echte Einstellung über /api/settings,
  // nicht nur lokaler UI-State - überlebt Reload und Backend-Neustart).
  useEffect(() => {
    let active = true;
    getSetting(AUTO_REFRESH_SETTING_KEY)
      .then((result) => {
        if (active && result.value === "false") setAutoRefresh(false);
      })
      .catch(() => {
        // Kein Eintrag oder Backend kurz nicht erreichbar - Default (an) bleibt.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    // Sprint 0 (S1-Fix, C16): pollte bislang nur checkHealth() und ließ die
    // Diagnose (Datenbankstatus, Speicher, Vorlagen) veralten, obwohl das
    // Label "Backend- und Datenbankstatus" verspricht. refreshAll() deckt
    // beides ab, exakt wie der "Jetzt prüfen"-Button.
    pollTimer.current = window.setInterval(() => {
      refreshAll();
    }, HEALTH_POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
  }, [autoRefresh, refreshAll]);

  async function toggleAutoRefresh() {
    const next = !autoRefresh;
    setAutoRefresh(next);
    try {
      await setSetting(AUTO_REFRESH_SETTING_KEY, String(next));
    } catch {
      // Anzeige bleibt korrekt; nur die Persistenz ist (z.B. bei kurzzeitig
      // nicht erreichbarem Backend) fehlgeschlagen.
    }
  }

  async function handleRestart() {
    setRestartConfirmOpen(false);
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

  const templatesReady = diagnostics?.templates.filter((template) => template.exists).length ?? 0;
  const directoryEntries = diagnostics ? Object.entries(diagnostics.directories) : [];
  const directoriesReady = directoryEntries.filter(([, dir]) => dir.exists && dir.writable).length;
  const diskUsedPercent = diagnostics && diagnostics.disk.total_bytes > 0
    ? Math.min(100, Math.max(0, ((diagnostics.disk.total_bytes - diagnostics.disk.free_bytes) / diagnostics.disk.total_bytes) * 100))
    : 0;
  const systemReady = health === "up" && diagnostics?.database.status === "connected";

  return (
    <div className="system-page">
      <PageHeader
        title="System"
        subtitle="Lokale Dienste, Datenbank und Arbeitsverzeichnisse auf einen Blick"
      />

      <section className={`system-health-banner is-${health}`} aria-live="polite">
        <span className="system-health-icon"><SystemGlyph kind="server" /></span>
        <div className="system-health-copy">
          <span className="system-eyebrow">Planner-Agent lokal</span>
          <h2>
            {health === "checking" && "System wird geprüft …"}
            {health === "up" && (systemReady ? "System ist betriebsbereit" : "System ist erreichbar")}
            {health === "down" && "Backend ist nicht erreichbar"}
          </h2>
          <p>
            {health === "checking" && "Verbindung und Datenbankstatus werden gerade geladen."}
            {health === "up" && "Die lokale Planung läuft. Der Status wird automatisch alle fünf Sekunden geprüft."}
            {health === "down" && "Starte das Backend neu oder öffne den Planner-Agent über das Startskript."}
          </p>
        </div>
        <span className="system-live-badge">
          <i aria-hidden="true" />
          {health === "checking" ? "Prüfung läuft" : health === "up" ? "Live verbunden" : "Offline"}
        </span>
      </section>

      <section className="system-overview" aria-label="Status-Übersicht">
        <article className={health === "up" ? "tone-positive" : health === "down" ? "tone-warning" : ""}>
          <span className="system-stat-icon"><SystemGlyph kind="server" /></span>
          <div>
            <span>Backend</span>
            <strong>{health === "checking" ? "…" : health === "up" ? "Erreichbar" : "Offline"}</strong>
            <small>{diagnostics ? `${diagnostics.host}:${diagnostics.port}` : "Lokaler Dienst"}</small>
          </div>
        </article>
        <article>
          <span className="system-stat-icon"><SystemGlyph kind="clock" /></span>
          <div>
            <span>Laufzeit</span>
            <strong>{diagnostics ? formatUptime(diagnostics.uptime_seconds) : "–"}</strong>
            <small>Seit dem letzten Backend-Start</small>
          </div>
        </article>
        <article className={diagnostics?.database.status === "connected" ? "tone-positive" : "tone-warning"}>
          <span className="system-stat-icon"><SystemGlyph kind="database" /></span>
          <div>
            <span>Datenbank</span>
            <strong>
              {diagnostics?.database.status === "connected" && "Verbunden"}
              {diagnostics?.database.status === "missing" && "Fehlt"}
              {diagnostics?.database.status === "error" && "Fehler"}
              {!diagnostics && "–"}
            </strong>
            <small>{diagnostics?.database.integrity_check ?? "Noch keine Diagnose"}</small>
          </div>
        </article>
      </section>

      <div className="system-main-grid">
        <section className="panel system-actions">
          <div className="panel-body">
            <div className="system-section-heading">
              <div>
                <span className="system-eyebrow">Steuerung</span>
                <h2>Systemaktionen</h2>
                <p>Gezielte Aktionen für den lokalen Planner-Agent.</p>
              </div>
            </div>
            <div className="system-action-list">
              <article>
                <span className="system-action-icon"><SystemGlyph kind="refresh" /></span>
                <div><strong>Backend neu starten</strong><small>Startet die Planungs- und Datenebene neu. Deine Daten bleiben erhalten.</small></div>
                <Button variant="primary" size="sm" loading={restarting} onClick={() => setRestartConfirmOpen(true)}>
                  Neu starten
                </Button>
              </article>
              <article>
                <span className="system-action-icon"><SystemGlyph kind="screen" /></span>
                <div><strong>Oberfläche neu laden</strong><small>Lädt die aktuelle Ansicht frisch, ohne das Backend zu verändern.</small></div>
                <Button variant="secondary" size="sm" onClick={handleFrontendReload}>Neu laden</Button>
              </article>
              <article>
                <span className="system-action-icon"><SystemGlyph kind="check" /></span>
                <div><strong>Diagnose aktualisieren</strong><small>Prüft Vorlagen, Ordner, Speicher und Datenbank erneut.</small></div>
                <Button variant="secondary" size="sm" disabled={restarting} onClick={() => refreshAll()}>Jetzt prüfen</Button>
              </article>
            </div>

            <div className="settings-row" style={{ marginTop: 12 }}>
              <div className="settings-row-copy">
                <h3>Diagnose automatisch aktualisieren</h3>
                <p>Backend- und Datenbankstatus alle {HEALTH_POLL_INTERVAL_MS / 1000} Sekunden neu prüfen.</p>
              </div>
              <button
                type="button"
                className={`settings-switch ${autoRefresh ? "is-on" : ""}`}
                role="switch"
                aria-checked={autoRefresh}
                aria-label="Diagnose automatisch aktualisieren"
                onClick={() => void toggleAutoRefresh()}
              />
            </div>

            {message && (
              <InlineStatus
                variant={message.kind === "success" ? "success" : message.kind === "error" ? "danger" : "info"}
                className="mt-3"
              >
                {message.text}
              </InlineStatus>
            )}
          </div>
        </section>

        <section className="panel system-connection-panel">
          <div className="panel-body">
            <div className="system-section-heading">
              <div>
                <span className="system-eyebrow">Ressourcen</span>
                <h2>Verbindung & Speicher</h2>
                <p>Technische Basis der lokalen Anwendung.</p>
              </div>
              <span className="system-section-icon"><SystemGlyph kind="network" /></span>
            </div>
            <dl className="system-detail-grid">
              <div><dt>Lokale Adresse</dt><dd>{diagnostics ? `${diagnostics.host}:${diagnostics.port}` : "–"}</dd></div>
              <div><dt>Erlaubte Verbindungen</dt><dd>{diagnostics?.cors_origins.join(", ") || "–"}</dd></div>
            </dl>
            <div className="system-storage">
              <div><span>Speicherbelegung</span><strong>{diagnostics ? `${formatBytes(diagnostics.disk.free_bytes)} frei` : "–"}</strong></div>
              <div className="system-storage-track" aria-hidden="true"><span style={{ width: `${diskUsedPercent}%` }} /></div>
              <small>{diagnostics ? `${formatBytes(diagnostics.disk.total_bytes)} Gesamtspeicher` : "Noch keine Diagnose geladen"}</small>
            </div>
          </div>
        </section>
      </div>

      {diagnosticsError && (
        <InlineStatus variant="danger" className="system-diagnostics-error">
          {diagnosticsError}
        </InlineStatus>
      )}

      {diagnostics && (
        <div className="system-diagnostics-grid">
          <section className="panel system-diagnostics-panel">
            <div className="panel-body">
              <div className="system-section-heading">
                <div><span className="system-eyebrow">Planerstellung</span><h2>Excel-Vorlagen</h2><p>Benötigte Grundlagen für Woche A und Woche B.</p></div>
                <span className="system-count-badge">{templatesReady}/{diagnostics.templates.length}</span>
              </div>
              <ul className="system-check-list">
                {diagnostics.templates.map((template) => (
                  <li key={template.filename}>
                    <span className="system-row-icon"><SystemGlyph kind="file" /></span>
                    <span className="system-check-copy"><strong>{template.name}</strong><small>{template.filename}</small></span>
                    <span className={`system-check-status ${template.exists ? "is-ok" : "is-warning"}`}>
                      <i aria-hidden="true" />{template.exists ? "Bereit" : "Fehlt"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel system-diagnostics-panel">
            <div className="panel-body">
              <div className="system-section-heading">
                <div><span className="system-eyebrow">Dateisystem</span><h2>Laufzeitordner</h2><p>Schreibzugriff für Planung, Uploads und Exporte.</p></div>
                <span className="system-count-badge">{directoriesReady}/{directoryEntries.length}</span>
              </div>
              <ul className="system-check-list">
                {directoryEntries.map(([key, dir]) => (
                  <li key={key}>
                    <span className="system-row-icon"><SystemGlyph kind="folder" /></span>
                    <span className="system-check-copy"><strong>{dirLabels[key] ?? key}</strong><small>{dir.path}</small></span>
                    <span className={`system-check-status ${dir.exists && dir.writable ? "is-ok" : "is-warning"}`}>
                      <i aria-hidden="true" />{!dir.exists ? "Fehlt" : dir.writable ? "Bereit" : "Gesperrt"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      )}
      <ConfirmDialog
        open={restartConfirmOpen}
        title="Backend jetzt neu starten?"
        description={<p>Die Verbindung zur Planungsebene ist dabei kurz unterbrochen. Deine Daten bleiben unverändert erhalten.</p>}
        onDismiss={() => setRestartConfirmOpen(false)}
        actions={[
          { label: "Abbrechen", variant: "default", autoFocus: true, onClick: () => setRestartConfirmOpen(false) },
          { label: "Neu starten", variant: "primary", onClick: () => void handleRestart() },
        ]}
      />
    </div>
  );
}
