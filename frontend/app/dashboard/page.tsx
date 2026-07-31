"use client";

import PageHeader from "@/components/PageHeader";
import {
  getDashboardInsights,
  getFairnessAlerts,
  getWeeks,
  type DashboardInsights,
  type FairnessAlert,
  type WeekSummary,
} from "@/lib/api";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type InsightTone = "info" | "positive" | "warning";
type WorkloadEntry = DashboardInsights["workload"][number];

function formatDate(iso?: string): string {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${iso}T12:00:00`));
}

function showDateParts(iso: string) {
  const date = new Date(`${iso}T12:00:00`);
  return {
    weekday: new Intl.DateTimeFormat("de-DE", { weekday: "short" })
      .format(date)
      .replace(".", ""),
    day: new Intl.DateTimeFormat("de-DE", { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat("de-DE", { month: "short" })
      .format(date)
      .replace(".", ""),
  };
}

function alertMessage(alert: FairnessAlert): string {
  return String(alert.message ?? "Fairness-Verteilung prüfen");
}

function statusLabel(status: WorkloadEntry["status"]): string {
  if (status === "high") return "Hoch";
  if (status === "low") return "Niedrig";
  return "Ausgeglichen";
}

export default function DashboardPage() {
  const [weeks, setWeeks] = useState<WeekSummary[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);
  const [insights, setInsights] = useState<DashboardInsights | null>(null);
  const [alerts, setAlerts] = useState<FairnessAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readinessOpen, setReadinessOpen] = useState(true);

  useEffect(() => {
    let active = true;
    getWeeks()
      .then((result) => {
        if (!active) return;
        setWeeks(result);
        setSelectedWeekId(result[0]?.id ?? null);
        if (!result.length) setLoading(false);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Wochen konnten nicht geladen werden.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedWeekId === null) return;
    let active = true;
    Promise.all([
      getDashboardInsights(selectedWeekId),
      getFairnessAlerts(selectedWeekId),
    ])
      .then(([nextInsights, nextAlerts]) => {
        if (!active) return;
        setInsights(nextInsights);
        setAlerts(nextAlerts);
        if (
          nextInsights.readiness.artist_plan
          && nextInsights.readiness.rehearsal_plan
          && nextInsights.readiness.duty_plan
        ) {
          setReadinessOpen(false);
        }
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Dashboard konnte nicht geladen werden.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedWeekId]);

  const selectedIndex = weeks.findIndex((week) => week.id === selectedWeekId);
  const selectedWeek =
    weeks.find((week) => week.id === selectedWeekId) ?? insights?.week ?? null;
  const planningWeek = insights?.planning_week ?? null;
  const readinessCount = insights
    ? Number(insights.readiness.artist_plan)
      + Number(insights.readiness.rehearsal_plan)
      + Number(insights.readiness.duty_plan)
    : 0;
  const allPreparationReady = readinessCount === 3;

  const maxServices = useMemo(
    () => Math.max(...(insights?.workload.map((item) => item.services) ?? []), 1),
    [insights],
  );

  const workload = useMemo(() => {
    const order: Record<WorkloadEntry["status"], number> = {
      high: 0,
      low: 1,
      balanced: 2,
    };
    return [...(insights?.workload ?? [])].sort(
      (a, b) =>
        order[a.status] - order[b.status] ||
        b.services - a.services ||
        a.person.localeCompare(b.person, "de"),
    );
  }, [insights]);

  const actionItems = useMemo(() => {
    if (!insights) return [];
    const items: Array<{
      id: string;
      title: string;
      description: string;
      tone: InsightTone;
      context: "Aktuelle Planung" | "Gespeicherte Woche";
      href?: string;
      action?: string;
    }> = [];

    if (!insights.readiness.artist_plan) {
      items.push({
        id: "artist-plan",
        title: "Künstlerplan fehlt",
        description: "Shows, DJs und Tagesprogramm für diese Woche vorbereiten.",
        tone: "warning",
        context: "Aktuelle Planung",
        href: "/artist-plan",
        action: "Öffnen",
      });
    }
    if (!insights.readiness.rehearsal_plan) {
      items.push({
        id: "rehearsal-plan",
        title: "Probenplan fehlt",
        description: "Proben einlesen, damit Zeitüberschneidungen geschützt sind.",
        tone: "warning",
        context: "Aktuelle Planung",
        href: "/rehearsal-plan",
        action: "Öffnen",
      });
    }
    if (!insights.readiness.duty_plan) {
      items.push({
        id: "duty-plan",
        title: "Dienstplan noch nicht abgeschlossen",
        description: "Vorbereitete Daten zusammenführen und Zuweisungen prüfen.",
        tone: "info",
        context: "Aktuelle Planung",
        href: "/plan-editor",
        action: "Erstellen",
      });
    }
    alerts.forEach((alert, index) => {
      items.push({
        id: `fairness-${String(alert.person ?? index)}-${index}`,
        title: String(alert.person ?? "Fairness-Hinweis"),
        description: alertMessage(alert),
        tone: "warning",
        context: "Gespeicherte Woche",
      });
    });
    insights.workload
      .filter((entry) => entry.status === "high")
      .forEach((entry) => {
        items.push({
          id: `load-${entry.person}`,
          title: `${entry.person} ist hoch belastet`,
          description: `${entry.services} Dienste, davon ${entry.cooking} Kochen und ${entry.late_duties} späte Dienste.`,
          tone: "warning",
          context: "Gespeicherte Woche",
        });
      });

    if (!items.length) {
      items.push({
        id: "all-clear",
        title: "Woche ist gut vorbereitet",
        description: "Aktuell gibt es keine offenen Fairness- oder Planungshinweise.",
        tone: "positive",
        context: "Gespeicherte Woche",
      });
    }
    return items.slice(0, 8);
  }, [alerts, insights]);

  function chooseWeek(weekId: number) {
    setLoading(true);
    setError("");
    setSelectedWeekId(weekId);
  }

  function selectRelativeWeek(direction: -1 | 1) {
    if (selectedIndex < 0) return;
    const next = weeks[selectedIndex + direction];
    if (next) chooseWeek(next.id);
  }

  return (
    <div className="dashboard-shell mx-auto max-w-[1700px]">
      <PageHeader
        title="Dashboard"
        subtitle="Planungsstand, offene Aufgaben und Team-Balance für die ausgewählte Woche"
      />

      {error && <div className="status status-error">{error}</div>}

      <section className="dashboard-week-hero">
        <div className="dashboard-week-copy">
          <span className="dashboard-eyebrow">Aktuelle Planung</span>
          <h2>{planningWeek?.label ?? "Planungswoche wird vorbereitet"}</h2>
          <p>
            {planningWeek
              ? `${formatDate(planningWeek.start_date)} – ${formatDate(planningWeek.end_date)}`
              : "Bereitschaft von Künstlerplan, Probenplan und Dienstplan."}
          </p>
        </div>
        <div className="dashboard-planning-action">
          <Link className="btn btn-primary" href="/plan-editor">
            Planung öffnen
          </Link>
        </div>
      </section>

      {loading && !insights ? (
        <DashboardSkeleton />
      ) : insights ? (
        <>
          <section
            className={`dashboard-readiness-shell ${allPreparationReady ? "is-complete" : ""}`}
            aria-label="Vorbereitungsstatus"
          >
            <button
              type="button"
              className={`dashboard-readiness-toggle ${readinessOpen ? "is-open" : ""}`}
              onClick={() => setReadinessOpen((current) => !current)}
              aria-expanded={readinessOpen}
              aria-controls="dashboard-readiness-content"
            >
              <span className="dashboard-readiness-status" aria-hidden="true">
                {allPreparationReady ? "✓" : readinessCount}
              </span>
              <span className="dashboard-readiness-summary">
                <small>Planungsstatus</small>
                <strong>
                  {allPreparationReady ? "Vorbereitung abgeschlossen" : "Planung vorbereiten"}
                </strong>
                <span>{readinessCount} von 3 Schritten bereit</span>
              </span>
              <span className="dashboard-readiness-toggle-meta">
                {readinessOpen ? "Einklappen" : "Details"}
              </span>
              <span className="dashboard-readiness-chevron" aria-hidden="true" />
            </button>

            <div id="dashboard-readiness-content" hidden={!readinessOpen}>
              <div className="dashboard-readiness">
                <ReadinessCard
                  step="01"
                  title="Künstlerplan"
                  description={
                    insights.readiness.artist_plan
                      ? "Wochenprogramm ist eingebunden"
                      : "Shows und DJs fehlen noch"
                  }
                  ready={insights.readiness.artist_plan}
                  meta={insights.readiness.artist_plan ? "Bereit" : "Vorbereiten"}
                  href="/artist-plan"
                />
                <ReadinessCard
                  step="02"
                  title="Probenplan"
                  description={
                    insights.readiness.rehearsal_plan
                      ? `${insights.readiness.rehearsal_count} Proben schützen die Verfügbarkeit`
                      : "Zeitkonflikte sind noch nicht geschützt"
                  }
                  ready={insights.readiness.rehearsal_plan}
                  meta={
                    insights.readiness.rehearsal_plan
                      ? `${insights.readiness.rehearsal_count} Proben`
                      : "Einlesen"
                  }
                  href="/rehearsal-plan"
                />
                <ReadinessCard
                  step="03"
                  title="Dienstplan"
                  description={
                    insights.readiness.duty_plan
                      ? `${insights.readiness.assignment_count} Zuweisungen gespeichert`
                      : "Plan erstellen und Zuweisungen prüfen"
                  }
                  ready={insights.readiness.duty_plan}
                  meta={
                    insights.readiness.duty_plan
                      ? `${insights.readiness.assignment_count} Zuweisungen`
                      : "Erstellen"
                  }
                  href="/plan-editor"
                />
              </div>
            </div>
          </section>

          <section className="panel dashboard-show-panel dashboard-current-show-panel">
            <SectionHeader
              eyebrow="Aktuelle Planung"
              title="Show- und Probentage"
              description={`${planningWeek?.label ?? "Planungswoche"} · Shows und Probendichte der kommenden Planung.`}
              badge={`${insights.show_days.length} Showtage`}
            />
            {insights.show_days.length ? (
              <div className="dashboard-show-list">
                {insights.show_days.map((day) => {
                  const date = showDateParts(day.date);
                  return (
                    <article key={day.date} className="dashboard-show-day">
                      <span className="dashboard-show-date">
                        <small>{date.weekday}</small>
                        <strong>{date.day}</strong>
                        <small>{date.month}</small>
                      </span>
                      <div>
                        <strong>{day.shows.join(" · ") || "Showabend"}</strong>
                        <span>{day.rehearsal_count} Proben an diesem Tag</span>
                        <div className="dashboard-show-tags">
                          {day.shows.map((show) => <span key={show}>{show}</span>)}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <DashboardEmpty text="Für die aktuelle Planung wurden keine Showtage erkannt." />
            )}
          </section>

          <section className="dashboard-saved-week-bar">
            <div className="dashboard-saved-week-copy">
              <span className="dashboard-eyebrow">Auswertung gespeicherte Woche</span>
              <strong>{selectedWeek?.label ?? "Woche auswählen"}</strong>
              <span>
                {selectedWeek
                  ? `${formatDate(selectedWeek.start_date)} – ${formatDate(selectedWeek.end_date)}`
                  : "Fairness, Belastung und Abteilungsabdeckung"}
              </span>
            </div>
            <div className="dashboard-week-controls">
              <button
                type="button"
                className="dashboard-week-arrow"
                onClick={() => selectRelativeWeek(-1)}
                disabled={selectedIndex <= 0}
                aria-label="Neuere gespeicherte Woche"
                title="Neuere gespeicherte Woche"
              >
                ‹
              </button>
              <label className="dashboard-week-select">
                <span>Gespeicherte Woche</span>
                <select
                  value={selectedWeekId ?? ""}
                  onChange={(event) => chooseWeek(Number(event.target.value))}
                  disabled={!weeks.length}
                >
                  {!weeks.length && <option value="">Keine Woche vorhanden</option>}
                  {weeks.map((week) => (
                    <option key={week.id} value={week.id}>{week.label}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="dashboard-week-arrow"
                onClick={() => selectRelativeWeek(1)}
                disabled={selectedIndex < 0 || selectedIndex >= weeks.length - 1}
                aria-label="Ältere gespeicherte Woche"
                title="Ältere gespeicherte Woche"
              >
                ›
              </button>
            </div>
          </section>

          <section className="panel dashboard-actions-panel">
            <SectionHeader
              eyebrow="Handlungsbedarf"
              title="Was diese Woche Aufmerksamkeit braucht"
              description="Planungshinweise zur aktuellen Woche sowie Fairness der ausgewählten gespeicherten Woche."
              badge={`${actionItems.filter((item) => item.tone !== "positive").length} offen`}
            />
            <div className="dashboard-action-list">
              {actionItems.map((item) => (
                <article
                  key={item.id}
                  className={`dashboard-action-item tone-${item.tone}`}
                >
                  <span className="dashboard-action-marker" aria-hidden="true">
                    {item.tone === "positive" ? "✓" : item.tone === "warning" ? "!" : "i"}
                  </span>
                  <div>
                    <small className="dashboard-action-context">{item.context}</small>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </div>
                  {item.href && (
                    <Link href={item.href}>{item.action ?? "Prüfen"} <span>→</span></Link>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="panel dashboard-workload-panel">
            <SectionHeader
              eyebrow="Team-Balance"
              title={`Belastung und Entlastung · ${selectedWeek?.label ?? "gespeicherte Woche"}`}
              description="Dienste, Koch- und Sporteinsätze werden der tatsächlichen Entlastung gegenübergestellt."
              badge={`${workload.length} MA im Plan`}
            />
            {workload.length ? (
              <div className="dashboard-workload-wrap">
                <div className="dashboard-workload-head" aria-hidden="true">
                  <span>Mitarbeiter</span>
                  <span>Balance</span>
                  <span>Dienste</span>
                  <span>Kochen</span>
                  <span>Sport</span>
                  <span>Spät</span>
                  <span>Entlastung</span>
                  <span>Frei / Abw.</span>
                </div>
                <div className="dashboard-workload-list">
                  {workload.map((entry) => (
                    <article className="dashboard-workload-row" key={entry.person}>
                      <div className="dashboard-person">
                        <span className="dashboard-person-avatar" aria-hidden="true">
                          {entry.person.slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                          <strong>{entry.person}</strong>
                          <small>{entry.department || "Keine Abteilung"}</small>
                        </span>
                      </div>
                      <div className="dashboard-balance">
                        <span className={`dashboard-balance-label is-${entry.status}`}>
                          {statusLabel(entry.status)}
                        </span>
                        <span className="dashboard-balance-track" aria-hidden="true">
                          <span
                            className={`is-${entry.status}`}
                            style={{ width: `${Math.max((entry.services / maxServices) * 100, 5)}%` }}
                          />
                        </span>
                      </div>
                      <WorkloadMetric label="Dienste" value={entry.services} strong />
                      <WorkloadMetric label="Kochen" value={entry.cooking} />
                      <WorkloadMetric label="Sport" value={entry.sport} />
                      <WorkloadMetric label="Spät" value={entry.late_duties} />
                      <WorkloadMetric label="Entlastung" value={entry.relief} positive />
                      <WorkloadMetric
                        label="Frei / Abw."
                        value={`${entry.free_days} / ${entry.absence_days}`}
                      />
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <DashboardEmpty text="Für diese Woche liegen noch keine Mitarbeiter-Zuweisungen vor." />
            )}
          </section>

          <section className="panel dashboard-department-panel">
              <SectionHeader
                eyebrow="Auswertung gespeicherte Woche"
                title={`Abteilungsabdeckung · ${selectedWeek?.label ?? ""}`}
                description="Wie viele aktive Mitarbeiter je Bereich im Plan vorkommen."
                badge={`${insights.departments.length} Bereiche`}
              />
              {insights.departments.length ? (
                <div className="dashboard-department-list">
                  {insights.departments.map((department) => {
                    const coverage = department.active_people
                      ? Math.min((department.scheduled_people / department.active_people) * 100, 100)
                      : 0;
                    return (
                      <article key={department.department} className="dashboard-department-row">
                        <div>
                          <strong>{department.department}</strong>
                          <span>
                            {department.scheduled_people} von {department.active_people} eingeplant
                          </span>
                        </div>
                        <strong>{department.services}</strong>
                        <span className="dashboard-department-track" aria-hidden="true">
                          <span style={{ width: `${coverage}%` }} />
                        </span>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <DashboardEmpty text="Noch keine Abteilungsabdeckung verfügbar." />
              )}
          </section>

        </>
      ) : (
        <section className="panel dashboard-no-week">
          <DashboardEmpty text="Noch keine Planungswoche vorhanden. Erstelle zuerst einen Dienstplan." />
          <Link className="btn btn-primary" href="/plan-editor">Dienstplan erstellen</Link>
        </section>
      )}
    </div>
  );
}

function ReadinessCard({
  step,
  title,
  description,
  ready,
  meta,
  href,
}: {
  step: string;
  title: string;
  description: string;
  ready: boolean;
  meta: string;
  href: string;
}) {
  return (
    <Link className={`dashboard-readiness-card ${ready ? "is-ready" : ""}`} href={href}>
      <span className="dashboard-readiness-step">{ready ? "✓" : step}</span>
      <span className="dashboard-readiness-copy">
        <small>{ready ? "Vorbereitet" : "Offen"}</small>
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="dashboard-readiness-meta">{meta}</span>
    </Link>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  badge,
}: {
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <header className="dashboard-section-head">
      <div>
        <span className="dashboard-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {badge && <span className="dashboard-section-badge">{badge}</span>}
    </header>
  );
}

function WorkloadMetric({
  label,
  value,
  strong = false,
  positive = false,
}: {
  label: string;
  value: number | string;
  strong?: boolean;
  positive?: boolean;
}) {
  return (
    <span className={`dashboard-workload-metric ${strong ? "is-strong" : ""} ${positive ? "is-positive" : ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function DashboardEmpty({ text }: { text: string }) {
  return (
    <div className="dashboard-empty">
      <span aria-hidden="true">–</span>
      <p>{text}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" aria-label="Dashboard wird geladen" role="status">
      <div /><div /><div />
      <div className="is-wide" />
      <div className="is-wide" />
    </div>
  );
}
