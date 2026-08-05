"use client";

/**
 * Studio Dashboard · Command Center (Dark)
 * -----------------------------------------------------------------------
 * Einbaufertige React-Komponente. Konsumiert exakt die Datenstrukturen,
 * die dein Backend über getDashboardInsights() / getFairnessAlerts()
 * liefert (siehe lib/api.ts).
 *
 * Verwendung (im Dashboard, nachdem insights + alerts geladen sind):
 *
 *   import DashboardCommand from "@/components/DashboardCommand";
 *   import "@/app/styles/dashboard-command.css";
 *
 *   <DashboardCommand
 *     insights={insights}
 *     alerts={alerts}
 *     weekLabel={selectedWeek?.label}
 *     weekSubLabel={`${formatDate(selectedWeek?.start_date)} – ${formatDate(selectedWeek?.end_date)}`}
 *     onPrevWeek={() => selectRelativeWeek(1)}
 *     onNextWeek={() => selectRelativeWeek(-1)}
 *     canPrev={selectedIndex < weeks.length - 1}
 *     canNext={selectedIndex > 0}
 *   />
 *
 * Alle Styles sind unter .cmd gescoped und kollidieren nicht mit
 * dashboard.css. Der Look ist bewusst immer dunkel (Command Center).
 * -----------------------------------------------------------------------
 */

import Link from "next/link";
import { useMemo } from "react";
import type {
  DashboardInsights,
  FairnessAlert,
  PlanAuditEvent,
} from "@/lib/api";

type WorkloadEntry = DashboardInsights["workload"][number];

type Props = {
  insights: DashboardInsights;
  alerts?: FairnessAlert[];
  weekLabel?: string;
  weekSubLabel?: string;
  planHref?: string;
  teamHref?: string;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
};

const AUDIT_LABELS: Record<PlanAuditEvent["event_type"], string> = {
  cell_changed: "Zuweisung geändert",
  recommendation_applied: "Empfehlung übernommen",
  automation_applied: "Automatik übernommen",
  undo: "Änderung rückgängig",
  redo: "Änderung wiederholt",
  plan_saved: "Plan gespeichert",
};

const AUDIT_TONE: Record<PlanAuditEvent["event_type"], "a" | "b" | "c" | "d"> = {
  recommendation_applied: "a",
  cell_changed: "b",
  plan_saved: "c",
  automation_applied: "d",
  undo: "a",
  redo: "b",
};

function qualityLabel(status: DashboardInsights["quality"]["status"]): string {
  if (status === "good") return "Stabil";
  if (status === "warning") return "Prüfen";
  return "Handlungsbedarf";
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

function showDateParts(iso: string) {
  const date = new Date(`${iso}T12:00:00`);
  return {
    weekday: new Intl.DateTimeFormat("de-DE", { weekday: "short" })
      .format(date)
      .replace(".", ""),
    day: new Intl.DateTimeFormat("de-DE", { day: "2-digit" }).format(date),
  };
}

function statusClass(status: WorkloadEntry["status"]): "is-high" | "is-bal" | "is-low" {
  if (status === "high") return "is-high";
  if (status === "low") return "is-low";
  return "is-bal";
}

export default function DashboardCommand({
  insights,
  alerts = [],
  weekLabel,
  weekSubLabel,
  planHref = "/plan-editor",
  teamHref = "/team",
  onPrevWeek,
  onNextWeek,
  canPrev = true,
  canNext = true,
}: Props) {
  const quality = insights.quality;
  const intelligence = insights.intelligence;
  const label = weekLabel ?? insights.week.label;

  const conflictCount = quality.issues.filter((i) => i.severity === "conflict").length;
  const fairnessCount = alerts.length;
  const highLoadCount = insights.workload.filter((e) => e.status === "high").length;
  const openSignals = conflictCount + fairnessCount + highLoadCount;

  const readinessCount =
    Number(insights.readiness.artist_plan) +
    Number(insights.readiness.rehearsal_plan) +
    Number(insights.readiness.duty_plan);

  const profileCoverage = intelligence.active_people
    ? Math.round((intelligence.evidence_profiles / intelligence.active_people) * 100)
    : 0;
  const memoryCoverage = intelligence.active_people
    ? Math.round((intelligence.memory_profiles / intelligence.active_people) * 100)
    : 0;

  const maxServices = useMemo(
    () => Math.max(...insights.workload.map((e) => e.services), 1),
    [insights.workload],
  );

  const workload = useMemo(() => {
    const order: Record<WorkloadEntry["status"], number> = { high: 0, low: 2, balanced: 1 };
    return [...insights.workload].sort(
      (a, b) =>
        order[a.status] - order[b.status] ||
        b.services - a.services ||
        a.person.localeCompare(b.person, "de"),
    );
  }, [insights.workload]);

  const workloadCounts = useMemo(
    () => ({
      high: insights.workload.filter((e) => e.status === "high").length,
      balanced: insights.workload.filter((e) => e.status === "balanced").length,
      low: insights.workload.filter((e) => e.status === "low").length,
    }),
    [insights.workload],
  );

  return (
    <section className="cmd" aria-label="Studio Dashboard Command Center">
      {/* topbar */}
      <div className="cmd-top">
        <div>
          <div className="cmd-title">
            <span className="cmd-live" aria-hidden="true" />
            Studio Dashboard
          </div>
          <div className="cmd-sub">
            Command Center · {label}
            {weekSubLabel ? ` · ${weekSubLabel}` : ""}
          </div>
        </div>
        {(onPrevWeek || onNextWeek) && (
          <div className="cmd-wk">
            <button type="button" onClick={onPrevWeek} disabled={!canPrev} aria-label="Vorherige Woche">
              ‹
            </button>
            <div className="cmd-wk-lab">
              <b>{label}</b>
              {weekSubLabel && <small>{weekSubLabel}</small>}
            </div>
            <button type="button" onClick={onNextWeek} disabled={!canNext} aria-label="Nächste Woche">
              ›
            </button>
          </div>
        )}
      </div>

      {/* KPI strip */}
      <div className="cmd-strip">
        <div className="cmd-kpi">
          <span className="cmd-kpi-trend">{qualityLabel(quality.status)}</span>
          <b>{quality.score}</b>
          <small>Planqualität /{quality.max_score}</small>
        </div>
        <div className="cmd-kpi cmd-kpi--r">
          <span className={`cmd-kpi-trend${openSignals ? " is-warn" : ""}`}>
            {openSignals ? `${openSignals} offen` : "frei"}
          </span>
          <b>{openSignals}</b>
          <small>Signale prüfen</small>
        </div>
        <div className="cmd-kpi cmd-kpi--v">
          <b>{readinessCount}/3</b>
          <small>Vorbereitung</small>
        </div>
        <div className="cmd-kpi cmd-kpi--p">
          <b>{intelligence.active_people}</b>
          <small>aktive MA</small>
        </div>
        <div className="cmd-kpi cmd-kpi--a">
          <b>{insights.show_days.length}</b>
          <small>Showtage</small>
        </div>
      </div>

      {/* main grid */}
      <div className="cmd-grid">
        {/* quality gauge */}
        <div className="cmd-panel">
          <div className="cmd-phead">
            <h3>Planqualität</h3>
            <span className={`cmd-badge ${quality.status === "good" ? "is-good" : "is-warn"}`}>
              {qualityLabel(quality.status)}
            </span>
          </div>
          <div
            className="cmd-gauge"
            style={{ ["--cmd-score-deg" as string]: `${quality.score * 3.6}deg` } as React.CSSProperties}
            aria-label={`Planqualität ${quality.score} von ${quality.max_score}`}
          >
            <div className="cmd-gauge-c">
              <b>{quality.score}</b>
              <small>von {quality.max_score}</small>
            </div>
          </div>
          <div className="cmd-dims">
            {quality.dimensions.map((d) => (
              <div className="cmd-drow" key={d.key}>
                <span>{d.label}</span>
                <em>
                  {d.score}/{d.max_score}
                </em>
                <div className="cmd-rail">
                  <i style={{ width: `${(d.score / d.max_score) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* workload heatmap */}
        <div className="cmd-panel">
          <div className="cmd-phead">
            <h3>Team-Balance · Belastung</h3>
            <span className="cmd-badge is-warn">{workloadCounts.high} hoch belastet</span>
          </div>
          <div className="cmd-wl-legend">
            <span><i className="is-high" />Hoch</span>
            <span><i className="is-bal" />Ausgeglichen</span>
            <span><i className="is-low" />Niedrig</span>
          </div>
          {workload.length ? (
            <div className="cmd-wgrid">
              {workload.map((e) => (
                <div className={`cmd-wcard ${statusClass(e.status)}`} key={e.person}>
                  <span className={`cmd-st ${statusClass(e.status)}`} aria-hidden="true" />
                  <div className="cmd-nm">{e.person}</div>
                  <div className="cmd-dp">{e.department || "—"}</div>
                  <div className="cmd-big">
                    {e.services}
                    <small>Dienste</small>
                  </div>
                  <div className="cmd-wbar">
                    <i style={{ width: `${Math.max((e.services / maxServices) * 100, 6)}%` }} />
                  </div>
                  <div className="cmd-wfacts">
                    <span>Koch <b>{e.cooking}</b></span>
                    <span>Spät <b>{e.late_duties}</b></span>
                    <span>Frei <b>{e.free_days}</b></span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="cmd-empty">Noch keine Mitarbeiter-Zuweisungen für diese Woche.</p>
          )}
        </div>

        {/* signals */}
        <div className="cmd-panel">
          <div className="cmd-phead">
            <h3>Entscheidungsbedarf</h3>
            <span className={`cmd-badge ${openSignals ? "is-warn" : "is-good"}`}>
              {openSignals ? "Prüfen" : "Klar"}
            </span>
          </div>
          <div className="cmd-sig-orb">
            <div className={`cmd-orb ${openSignals ? "" : "is-clear"}`}>{openSignals || "✓"}</div>
            <div>
              <b>{openSignals ? `${openSignals} Signale prüfen` : "Keine kritischen Signale"}</b>
              <small>Konflikte, Fairness &amp; Belastung</small>
            </div>
          </div>
          <div className="cmd-sigmini">
            <div className="cmd-s"><b>{conflictCount}</b><small>Konflikte</small></div>
            <div className="cmd-s"><b>{fairnessCount}</b><small>Fairness</small></div>
            <div className="cmd-s"><b>{highLoadCount}</b><small>Belastung</small></div>
          </div>
          {quality.issues.slice(0, 3).map((issue, i) => (
            <div className="cmd-issue" key={`${issue.code}:${i}`}>
              <b>!</b>
              <span>{issue.message}</span>
            </div>
          ))}
          {!quality.issues.length && (
            <div className="cmd-issue is-clear">
              <b>✓</b>
              <span>Keine harten Konflikte in der gewählten Woche.</span>
            </div>
          )}
        </div>
      </div>

      {/* lower grid */}
      <div className="cmd-grid2">
        {/* shows + data */}
        <div className="cmd-panel">
          <div className="cmd-phead">
            <h3>Show- &amp; Probentage</h3>
            <span className="cmd-badge is-good">{insights.show_days.length} Showtage</span>
          </div>
          {insights.show_days.length ? (
            <div className="cmd-shows">
              {insights.show_days.map((day) => {
                const d = showDateParts(day.date);
                return (
                  <div className="cmd-show" key={day.date}>
                    <div className="cmd-d">
                      <b>{d.day}</b>
                      <small>{d.weekday}</small>
                    </div>
                    <div>
                      <h4>{day.shows.join(" · ") || "Showabend"}</h4>
                      <p>{day.rehearsal_count} Proben</p>
                      <div className="cmd-tags">
                        {day.shows.slice(0, 2).map((s) => (
                          <b key={s}>{s}</b>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="cmd-empty">Für diese Planung wurden keine Showtage erkannt.</p>
          )}
          <div className="cmd-datakpis">
            <div className="cmd-kpi cmd-kpi--v">
              <b>{intelligence.historical_weeks}</b>
              <small>Dienstplanwochen</small>
            </div>
            <div className="cmd-kpi">
              <b>{intelligence.rehearsal_weeks}</b>
              <small>Probenwochen</small>
            </div>
            <div className="cmd-kpi cmd-kpi--p">
              <b>{intelligence.manual_skills}</b>
              <small>manuelle Skills</small>
            </div>
          </div>
          <div className="cmd-note" style={{ marginTop: 12 }}>
            Datenbasis: {intelligence.evidence_profiles}/{intelligence.active_people} Profile mit Historie ({profileCoverage}%)
            {" · "}
            {intelligence.memory_profiles}/{intelligence.active_people} mit Memory ({memoryCoverage}%)
          </div>
        </div>

        {/* audit */}
        <div className="cmd-panel cmd-audit">
          <div className="cmd-phead">
            <h3>Letzte Änderungen</h3>
            <span className="cmd-badge is-good">{intelligence.recent_audit.length}</span>
          </div>
          {intelligence.recent_audit.slice(0, 5).map((event) => (
            <div className="cmd-row" key={event.id}>
              <span className={`cmd-ic is-${AUDIT_TONE[event.event_type]}`} aria-hidden="true" />
              <div>
                <b>{AUDIT_LABELS[event.event_type]}</b>
                <small>
                  {auditTime(event.created_at)} · {event.user}
                </small>
              </div>
            </div>
          ))}
          {!intelligence.recent_audit.length && (
            <p className="cmd-empty">Der Änderungsverlauf beginnt mit dem nächsten Speichern.</p>
          )}
          {intelligence.cold_start_people.length > 0 && (
            <div className="cmd-note">
              Noch ohne Historie:{" "}
              <b>
                {intelligence.cold_start_people.slice(0, 4).join(", ")}
                {intelligence.cold_start_people.length > 4
                  ? ` +${intelligence.cold_start_people.length - 4}`
                  : ""}
              </b>
            </div>
          )}
          <p style={{ marginTop: 14 }}>
            <Link href={planHref} className="cmd-eyebrow" style={{ textDecoration: "none" }}>
              Änderungsverlauf im Plan →
            </Link>
          </p>
        </div>
      </div>

      {/* footer link */}
      <p style={{ marginTop: 16 }}>
        <Link href={teamHref} className="cmd-eyebrow" style={{ textDecoration: "none", marginRight: 18 }}>
          Team-Profile →
        </Link>
        <Link href={planHref} className="cmd-eyebrow" style={{ textDecoration: "none" }}>
          Plananalyse öffnen →
        </Link>
      </p>
    </section>
  );
}
