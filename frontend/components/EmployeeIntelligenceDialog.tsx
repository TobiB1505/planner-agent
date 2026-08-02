"use client";

import {
  deleteEmployeeIntelligenceMemory,
  deleteEmployeeSkill,
  getEmployeeIntelligence,
  setEmployeeIntelligenceMemory,
  setEmployeeSkill,
  type EmployeeIntelligenceProfile,
  type EmployeeMemoryEntry,
  type EmployeeSkill,
} from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type ProfileTab = "overview" | "skills" | "availability" | "history" | "memory" | "recommendations";

const TABS: Array<{ id: ProfileTab; label: string; hint: string; icon: string }> = [
  { id: "overview", label: "Übersicht", hint: "Woche & Stärken", icon: "◈" },
  { id: "skills", label: "Fähigkeiten", hint: "Belegte Skills", icon: "★" },
  { id: "availability", label: "Verfügbarkeit", hint: "Frei-Muster", icon: "◷" },
  { id: "history", label: "Historie", hint: "Letzte Wochen", icon: "↗" },
  { id: "memory", label: "Memory", hint: "Hinweise & Regeln", icon: "◎" },
  { id: "recommendations", label: "Empfehlungen", hint: "Für die Planung", icon: "✦" },
];

function initials(name: string): string {
  return name.trim().slice(0, 2).toLocaleUpperCase("de");
}

function trendLabel(direction: EmployeeIntelligenceProfile["trend"]["direction"]): string {
  if (direction === "up") return "Belastung steigt";
  if (direction === "down") return "Belastung sinkt";
  return "Belastung stabil";
}

function sourceLabel(source: EmployeeSkill["source"] | EmployeeMemoryEntry["source"]): string {
  if (source === "manual") return "Manuell";
  if (source === "department") return "Abteilung";
  if (source === "manual_override") return "Manuell bestätigt";
  return "Aus Historie";
}

function memoryValue(entry: EmployeeMemoryEntry): string {
  if (typeof entry.value === "string") return entry.value;
  if (entry.subject === "free_weekdays" && entry.value && typeof entry.value === "object") {
    const weekdays = (entry.value as { weekdays?: number[] }).weekdays ?? [];
    const labels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    return weekdays.map((day) => labels[day]).filter(Boolean).join(", ");
  }
  if (entry.subject.startsWith("show:") && entry.value && typeof entry.value === "object") {
    const show = entry.value as { label?: string; kind?: string; appearances?: number };
    const kind = show.kind === "party" ? "Party" : "Show";
    return [show.label, kind, show.appearances ? `${show.appearances} belegte Probentage` : null]
      .filter(Boolean)
      .join(" · ");
  }
  return entry.value == null ? "Keine Angabe" : JSON.stringify(entry.value);
}

function memorySubject(entry: EmployeeMemoryEntry): string {
  if (entry.subject.startsWith("show:")) return "Show-Erfahrung";
  if (entry.subject.startsWith("task:")) return `Einsatzpräferenz · ${entry.subject.slice(5)}`;
  if (entry.subject === "free_weekdays") return "Typische freie Tage";
  return entry.subject.replaceAll("_", " ");
}

function memoryTypeLabel(type: string): string {
  return ({
    experience: "Erfahrung",
    preference: "Präferenz",
    availability: "Verfügbarkeit",
    constraint: "Einschränkung",
    note: "Planungshinweis",
  } as Record<string, string>)[type] ?? type;
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("de-DE");
}

function currentMonday(): string {
  const now = new Date();
  const weekday = now.getDay() || 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + 1, 12);
  return monday.toLocaleDateString("sv-SE");
}

export default function EmployeeIntelligenceDialog({
  personId,
  onClose,
}: {
  personId: number;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<EmployeeIntelligenceProfile | null>(null);
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [skillName, setSkillName] = useState("");
  const [skillLevel, setSkillLevel] = useState(3);
  const [memoryType, setMemoryType] = useState("constraint");
  const [memorySubject, setMemorySubject] = useState("");
  const [memoryNote, setMemoryNote] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setProfile(await getEmployeeIntelligence(personId, { currentWeekStart: currentMonday() }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mitarbeiterprofil konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    getEmployeeIntelligence(personId, { currentWeekStart: currentMonday() })
      .then((result) => {
        if (active) setProfile(result);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Mitarbeiterprofil konnte nicht geladen werden.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [personId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const appMain = document.querySelector<HTMLElement>(".app-main");
    const previousOverflow = appMain?.style.overflow;
    if (appMain) appMain.style.overflow = "hidden";
    return () => {
      if (appMain) appMain.style.overflow = previousOverflow ?? "";
    };
  }, []);

  const availabilityEntries = useMemo(
    () => profile?.memory.filter((entry) => entry.type === "availability" || entry.subject === "free_weekdays") ?? [],
    [profile],
  );

  async function saveSkill() {
    const name = skillName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const id = name.toLocaleLowerCase("de").replace(/[^a-z0-9äöüß]+/g, "_").replace(/^_|_$/g, "");
      await setEmployeeSkill(personId, { id, name, level: skillLevel, evidence: ["Von dir im Profil bestätigt"] });
      setSkillName("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Skill konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSkill(skill: EmployeeSkill) {
    setBusy(true);
    try {
      await deleteEmployeeSkill(personId, skill.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Skill konnte nicht entfernt werden.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMemory() {
    if (!memorySubject.trim() || !memoryNote.trim()) return;
    setBusy(true);
    try {
      await setEmployeeIntelligenceMemory(personId, {
        type: memoryType,
        subject: memorySubject.trim(),
        value: memoryNote.trim(),
        confidence: 1,
        note: memoryNote.trim(),
      });
      setMemorySubject("");
      setMemoryNote("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Hinweis konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  async function removeMemory(entry: EmployeeMemoryEntry) {
    const id = Number(entry.id.replace("manual:", ""));
    if (!Number.isFinite(id)) return;
    setBusy(true);
    try {
      await deleteEmployeeIntelligenceMemory(personId, id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Hinweis konnte nicht gelöscht werden.");
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="intelligence-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="employee-intelligence" role="dialog" aria-modal="true" aria-labelledby="employee-intelligence-title">
        <header className="employee-intelligence-head">
          <div className="employee-intelligence-identity">
            <span className="employee-intelligence-avatar" aria-hidden="true">
              {profile ? initials(profile.person.name) : "…"}
            </span>
            <div>
              <span className="intelligence-eyebrow">Mitarbeiter Intelligence</span>
              <h2 id="employee-intelligence-title">{profile?.person.name ?? "Profil wird geladen …"}</h2>
              <p>{profile?.person.department || "Keine Abteilung hinterlegt"}</p>
            </div>
          </div>
          <div className="employee-intelligence-head-actions">
            {profile && (
              <div className="employee-intelligence-status" aria-label="Datenbasis des Profils">
                <span><strong>{profile.period.weeks_available}</strong> Wochen</span>
                <span><strong>{profile.summary.assignments}</strong> Einsätze</span>
                <span className={`is-${profile.trend.direction}`}>{trendLabel(profile.trend.direction)}</span>
              </div>
            )}
            <button type="button" className="btn-icon employee-intelligence-close" onClick={onClose} aria-label="Profil schließen">×</button>
          </div>
        </header>

        <div className="employee-intelligence-workspace">
          <nav className="employee-intelligence-tabs" aria-label="Profilbereiche" role="tablist">
            <span className="employee-intelligence-nav-label">Profilbereiche</span>
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? "is-active" : ""}
                onClick={() => setTab(item.id)}
              >
                <span className="employee-intelligence-tab-icon" aria-hidden="true">{item.icon}</span>
                <span><strong>{item.label}</strong><small>{item.hint}</small></span>
              </button>
            ))}
            <p>Alle Hinweise stammen aus gespeicherten Plänen oder deinen manuellen Angaben.</p>
          </nav>

          <div className="employee-intelligence-body" role="tabpanel">
          {loading && <div className="intelligence-empty"><span className="spinner" /> Daten werden ausgewertet …</div>}
          {error && <div className="status status-error">{error}</div>}
          {!loading && profile && tab === "overview" && (
            <>
              <div className="employee-intelligence-section-head">
                <div><span className="intelligence-eyebrow">Aktuelle Einordnung</span><h3>Planungsübersicht</h3></div>
                <span className={`employee-intelligence-trend is-${profile.trend.direction}`}>{trendLabel(profile.trend.direction)}</span>
              </div>
              <div className="intelligence-metrics">
                <article><span>Aktuelle Woche</span><strong>{profile.current_week.assignments}</strong><small>Einsätze</small></article>
                <article><span>Shows</span><strong>{profile.current_week.shows}</strong><small>belegte Besetzungen</small></article>
                <article><span>Moderation</span><strong>{profile.current_week.moderation}</strong><small>aktuelle Woche</small></article>
                <article><span>Konflikte</span><strong>{profile.current_week.conflicts}</strong><small>erkannte Konflikte</small></article>
              </div>
              <section className="intelligence-section">
                <h3>Stärkste belegte Fähigkeiten</h3>
                <div className="skill-grid">
                  {profile.skills.slice(0, 4).map((skill) => <SkillCard skill={skill} key={skill.id} />)}
                  {!profile.skills.length && <p className="intelligence-empty">Noch keine belastbare Skill-Evidenz.</p>}
                </div>
              </section>
              <section className="intelligence-section">
                <h3>Planungshinweise</h3>
                {profile.planning_recommendations.map((item) => (
                  <article className="intelligence-note" key={item.code}>
                    <strong>{item.label}</strong><p>{item.text}</p>
                    {item.evidence.map((evidence, index) => (
                      <small key={`${item.code}:evidence:${index}`}>{evidence}</small>
                    ))}
                  </article>
                ))}
                {!profile.planning_recommendations.length && <p className="intelligence-empty">Noch kein ausreichend belegter Planungshinweis.</p>}
              </section>
            </>
          )}

          {!loading && profile && tab === "skills" && (
            <section className="intelligence-section">
              <div className="intelligence-section-head"><div><h3>Fähigkeiten</h3><p>Automatisch aus Einsätzen abgeleitet oder von dir bestätigt. Jede Einstufung zeigt ihre Datenbasis.</p></div></div>
              <div className="skill-grid">{profile.skills.map((skill) => (
                <SkillCard skill={skill} key={skill.id} onDelete={skill.source === "manual" ? () => void removeSkill(skill) : undefined} />
              ))}</div>
              <div className="intelligence-form-row">
                <label><span>Skill</span><input value={skillName} onChange={(event) => setSkillName(event.target.value)} placeholder="z. B. Moderation" /></label>
                <label><span>Level</span><select value={skillLevel} onChange={(event) => setSkillLevel(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level} Sterne</option>)}</select></label>
                <button type="button" className="btn btn-primary" disabled={busy || !skillName.trim()} onClick={() => void saveSkill()}>Skill speichern</button>
              </div>
            </section>
          )}

          {!loading && profile && tab === "availability" && (
            <section className="intelligence-section"><div className="intelligence-section-head"><div><h3>Verfügbarkeit</h3><p>Erkannte Frei-Muster fließen nur als Vorschlag in die Planung ein.</p></div></div>
              {availabilityEntries.map((entry) => <MemoryCard entry={entry} key={entry.id} />)}
              {!availabilityEntries.length && <p className="intelligence-empty">Noch kein belastbares Verfügbarkeitsmuster erkannt.</p>}
            </section>
          )}

          {!loading && profile && tab === "history" && (
            <section className="intelligence-section">
              <div className="intelligence-section-head"><div><h3>Letzte {profile.period.weeks_available} Wochen</h3><p>Historische Einsätze werden nur ausgewertet und niemals verändert.</p></div></div>
              <div className="intelligence-metrics history-metrics">
                <article><span>Einsätze</span><strong>{profile.summary.assignments}</strong></article>
                <article><span>Kochdienste</span><strong>{profile.summary.cooking}</strong></article>
                <article><span>Sport</span><strong>{profile.summary.sport}</strong></article>
                <article><span>Moderationen</span><strong>{profile.summary.moderation}</strong></article>
                <article><span>Frühdienste</span><strong>{profile.summary.early_duties}</strong></article>
                <article><span>Späte Dienste</span><strong>{profile.summary.late_duties}</strong></article>
              </div>
              <div className="category-history">{profile.categories.slice(0, 12).map((item) => <div key={item.category}><span>{item.category}</span><strong>{item.count}</strong></div>)}</div>
            </section>
          )}

          {!loading && profile && tab === "memory" && (
            <section className="intelligence-section">
              <div className="intelligence-section-head"><div><h3>Strukturiertes Memory</h3><p>Nachvollziehbare Hinweise mit Quelle, Datum und Konfidenz statt freier KI-Texte.</p></div></div>
              <div className="memory-entry-grid">{profile.memory.map((entry) => <MemoryCard entry={entry} key={entry.id} onDelete={entry.editable ? () => void removeMemory(entry) : undefined} />)}</div>
              <div className="intelligence-form-row memory-form">
                <label><span>Typ</span><select value={memoryType} onChange={(event) => setMemoryType(event.target.value)}><option value="constraint">Einschränkung</option><option value="preference">Präferenz</option><option value="note">Planungshinweis</option></select></label>
                <label><span>Betreff</span><input value={memorySubject} onChange={(event) => setMemorySubject(event.target.value)} placeholder="z. B. Abenddienste" /></label>
                <label className="memory-note-field"><span>Hinweis</span><input value={memoryNote} onChange={(event) => setMemoryNote(event.target.value)} placeholder="Nicht mehrere Nachtdienste hintereinander" /></label>
                <button type="button" className="btn btn-primary" disabled={busy || !memorySubject.trim() || !memoryNote.trim()} onClick={() => void saveMemory()}>Hinweis speichern</button>
              </div>
            </section>
          )}

          {!loading && profile && tab === "recommendations" && (
            <section className="intelligence-section"><div className="intelligence-section-head"><div><h3>Planungsempfehlungen</h3><p>Nur datenbasierte Hinweise, die im Dienstplan erklärbar bleiben.</p></div></div>
              {profile.planning_recommendations.map((item) => <article className="intelligence-note" key={item.code}><strong>{item.label}</strong><p>{item.text}</p>{item.evidence.map((entry, index) => <small key={`${item.code}:evidence:${index}`}>{entry}</small>)}</article>)}
              {!profile.planning_recommendations.length && <p className="intelligence-empty">Aus den vorhandenen Daten entsteht noch keine sichere Empfehlung.</p>}
            </section>
          )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function SkillCard({ skill, onDelete }: { skill: EmployeeSkill; onDelete?: () => void }) {
  return <article className="skill-card"><div><strong>{skill.name}</strong><span className="skill-stars" aria-label={`${skill.level} von 5`}>{"★".repeat(skill.level)}{"☆".repeat(5 - skill.level)}</span></div><small>{sourceLabel(skill.source)}</small>{skill.evidence.map((entry, index) => <p key={`${skill.id}:evidence:${index}`}>{entry}</p>)}{onDelete && <button type="button" onClick={onDelete}>Manuellen Skill entfernen</button>}</article>;
}

function MemoryCard({ entry, onDelete }: { entry: EmployeeMemoryEntry; onDelete?: () => void }) {
  return <article className="memory-intelligence-card"><div><span>{memoryTypeLabel(entry.type)}</span><strong>{memorySubject(entry)}</strong></div><p>{memoryValue(entry)}</p>{entry.note && entry.note !== memoryValue(entry) && <small>{entry.note}</small>}<footer><span>{sourceLabel(entry.source)}</span><span>{Math.round(entry.confidence * 100)}% Konfidenz</span>{entry.source_date && <span>{formatDate(entry.source_date)}</span>}</footer>{onDelete && <button type="button" onClick={onDelete}>Löschen</button>}</article>;
}
