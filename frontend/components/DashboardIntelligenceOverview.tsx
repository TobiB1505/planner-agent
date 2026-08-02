"use client";

import type { DashboardInsights, PlanAuditEvent } from "@/lib/api";
import Link from "next/link";

function qualityLabel(status: DashboardInsights["quality"]["status"]): string {
  if (status === "good") return "Stabil";
  if (status === "warning") return "Prüfen";
  return "Handlungsbedarf";
}

function auditLabel(event: PlanAuditEvent): string {
  const labels: Record<PlanAuditEvent["event_type"], string> = {
    cell_changed: "Zuweisung geändert",
    recommendation_applied: "Empfehlung übernommen",
    automation_applied: "Automatik übernommen",
    undo: "Änderung rückgängig",
    redo: "Änderung wiederholt",
    plan_saved: "Plan gespeichert",
  };
  return labels[event.event_type];
}

function auditTime(value: string): string {
  const parsed = new Date(value.replace(" ", "T") + "Z");
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export default function DashboardIntelligenceOverview({
  insights,
  fairnessAlerts,
}: {
  insights: DashboardInsights;
  fairnessAlerts: number;
}) {
  const quality = insights.quality;
  const intelligence = insights.intelligence;
  const conflictCount = quality.issues.filter((issue) => issue.severity === "conflict").length;
  const highLoadCount = insights.workload.filter((entry) => entry.status === "high").length;
  const openSignals = conflictCount + fairnessAlerts + highLoadCount;
  const profileCoverage = intelligence.active_people
    ? Math.round((intelligence.evidence_profiles / intelligence.active_people) * 100)
    : 0;
  const memoryCoverage = intelligence.active_people
    ? Math.round((intelligence.memory_profiles / intelligence.active_people) * 100)
    : 0;

  return (
    <section className="dashboard-intelligence-overview" aria-label="Planner Intelligence">
      <article className={`dashboard-command-card dashboard-quality-card is-${quality.status}`}>
        <header>
          <div>
            <span className="dashboard-eyebrow">Plan Intelligence · {insights.week.label}</span>
            <h2>Planqualität</h2>
          </div>
          <span className={`dashboard-quality-status is-${quality.status}`}>
            {qualityLabel(quality.status)}
          </span>
        </header>
        <div className="dashboard-quality-main">
          <div
            className="dashboard-quality-ring"
            style={{ "--quality-score": `${quality.score * 3.6}deg` } as React.CSSProperties}
            aria-label={`Planqualität ${quality.score} von 100`}
          >
            <strong>{quality.score}</strong>
            <span>/100</span>
          </div>
          <div className="dashboard-quality-dimensions">
            {quality.dimensions.map((dimension) => (
              <div key={dimension.key}>
                <span><strong>{dimension.label}</strong><small>{dimension.score}/{dimension.max_score}</small></span>
                <i aria-hidden="true"><b style={{ width: `${(dimension.score / dimension.max_score) * 100}%` }} /></i>
              </div>
            ))}
          </div>
        </div>
        <Link href="/plan-editor">Plananalyse öffnen <span>→</span></Link>
      </article>

      <article className="dashboard-command-card dashboard-risk-card">
        <header>
          <div>
            <span className="dashboard-eyebrow">Entscheidungsbedarf</span>
            <h2>{openSignals ? `${openSignals} Signale prüfen` : "Keine kritischen Signale"}</h2>
          </div>
          <span className={`dashboard-signal-orb ${openSignals ? "is-warning" : "is-clear"}`}>
            {openSignals || "✓"}
          </span>
        </header>
        <div className="dashboard-signal-metrics">
          <span><strong>{conflictCount}</strong><small>Konflikte</small></span>
          <span><strong>{fairnessAlerts}</strong><small>Fairness</small></span>
          <span><strong>{highLoadCount}</strong><small>Belastung</small></span>
        </div>
        <div className="dashboard-priority-list">
          {quality.issues.slice(0, 3).map((issue, index) => (
            <p key={`${issue.code}:${index}`}><span>!</span>{issue.message}</p>
          ))}
          {!quality.issues.length && (
            <p className="is-clear"><span>✓</span>Keine harten Konflikte in der gewählten Woche.</p>
          )}
        </div>
      </article>

      <article className="dashboard-command-card dashboard-data-card">
        <header>
          <div>
            <span className="dashboard-eyebrow">Mitarbeiter Intelligence</span>
            <h2>Datenbasis</h2>
          </div>
          <Link href="/team">Profile <span>→</span></Link>
        </header>
        <div className="dashboard-coverage-list">
          <CoverageRow label="Profile mit Historie" value={intelligence.evidence_profiles} total={intelligence.active_people} percent={profileCoverage} />
          <CoverageRow label="Strukturiertes Memory" value={intelligence.memory_profiles} total={intelligence.active_people} percent={memoryCoverage} />
        </div>
        <div className="dashboard-data-facts">
          <span><strong>{intelligence.historical_weeks}</strong><small>Dienstplanwochen</small></span>
          <span><strong>{intelligence.rehearsal_weeks}</strong><small>Probenwochen</small></span>
          <span><strong>{intelligence.manual_skills}</strong><small>manuelle Skills</small></span>
        </div>
        {intelligence.cold_start_people.length > 0 && (
          <p className="dashboard-data-note">
            Noch ohne Historie: {intelligence.cold_start_people.slice(0, 4).join(", ")}
            {intelligence.cold_start_people.length > 4 ? ` +${intelligence.cold_start_people.length - 4}` : ""}
          </p>
        )}
      </article>

      <article className="dashboard-command-card dashboard-audit-card">
        <header>
          <div>
            <span className="dashboard-eyebrow">Nachvollziehbarkeit</span>
            <h2>Letzte Änderungen</h2>
          </div>
          <span className="dashboard-audit-count">{intelligence.recent_audit.length}</span>
        </header>
        <div className="dashboard-audit-list">
          {intelligence.recent_audit.slice(0, 4).map((event) => (
            <div key={event.id}>
              <span className={`dashboard-audit-icon type-${event.event_type}`} aria-hidden="true" />
              <span><strong>{auditLabel(event)}</strong><small>{auditTime(event.created_at)} · {event.user}</small></span>
            </div>
          ))}
          {!intelligence.recent_audit.length && (
            <p className="dashboard-audit-empty">Der Änderungsverlauf beginnt mit dem nächsten Speichern.</p>
          )}
        </div>
        <Link href="/plan-editor">Änderungsverlauf im Plan <span>→</span></Link>
      </article>
    </section>
  );
}

function CoverageRow({
  label,
  value,
  total,
  percent,
}: {
  label: string;
  value: number;
  total: number;
  percent: number;
}) {
  return (
    <div className="dashboard-coverage-row">
      <span><strong>{label}</strong><small>{value} von {total}</small></span>
      <i aria-hidden="true"><b style={{ width: `${percent}%` }} /></i>
      <em>{percent}%</em>
    </div>
  );
}
