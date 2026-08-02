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

type ProfileTab = "overview" | "skills" | "availability" | "history" | "memory" | "recommendations";

const TABS: Array<{ id: ProfileTab; label: string }> = [
  { id: "overview", label: "Übersicht" },
  { id: "skills", label: "Fähigkeiten" },
  { id: "availability", label: "Verfügbarkeit" },
  { id: "history", label: "Historie" },
  { id: "memory", label: "Memory" },
  { id: "recommendations", label: "Planungsempfehlungen" },
];

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

  return (
    <div className="intelligence-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="employee-intelligence" role="dialog" aria-modal="true" aria-label="Intelligentes Mitarbeiterprofil">
        <header className="employee-intelligence-head">
          <div>
            <span className="intelligence-eyebrow">Mitarbeiter Intelligence</span>
            <h2>{profile?.person.name ?? "Profil wird geladen …"}</h2>
            <p>{profile?.person.department || "Keine Abteilung hinterlegt"}</p>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Profil schließen">×</button>
        </header>

        <nav className="employee-intelligence-tabs" aria-label="Profilbereiche">
          {TABS.map((item) => (
            <button key={item.id} type="button" className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="employee-intelligence-body">
          {loading && <div className="intelligence-empty"><span className="spinner" /> Daten werden ausgewertet …</div>}
          {error && <div className="status status-error">{error}</div>}
          {!loading && profile && tab === "overview" && (
            <>
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
              <div className="intelligence-section-head"><div><h3>Fähigkeiten</h3><p>Automatische Vorschläge zeigen immer ihre Evidenz.</p></div></div>
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
            <section className="intelligence-section"><h3>Verfügbarkeit</h3>
              {availabilityEntries.map((entry) => <MemoryCard entry={entry} key={entry.id} />)}
              {!availabilityEntries.length && <p className="intelligence-empty">Noch kein belastbares Verfügbarkeitsmuster erkannt.</p>}
            </section>
          )}

          {!loading && profile && tab === "history" && (
            <section className="intelligence-section">
              <h3>Letzte {profile.period.weeks_available} Wochen</h3>
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
              <h3>Strukturiertes Memory</h3>
              <div className="memory-entry-grid">{profile.memory.map((entry) => <MemoryCard entry={entry} key={entry.id} onDelete={entry.editable ? () => void removeMemory(entry) : undefined} />)}</div>
              <div className="intelligence-form-row memory-form">
                <label><span>Typ</span><select value={memoryType} onChange={(event) => setMemoryType(event.target.value)}><option value="constraint">Einschränkung</option><option value="preference">Präferenz</option><option value="note">Planungshinweis</option></select></label>
                <label><span>Betreff</span><input value={memorySubject} onChange={(event) => setMemorySubject(event.target.value)} placeholder="z. B. night_duties" /></label>
                <label className="memory-note-field"><span>Hinweis</span><input value={memoryNote} onChange={(event) => setMemoryNote(event.target.value)} placeholder="Nicht mehrere Nachtdienste hintereinander" /></label>
                <button type="button" className="btn btn-primary" disabled={busy || !memorySubject.trim() || !memoryNote.trim()} onClick={() => void saveMemory()}>Hinweis speichern</button>
              </div>
            </section>
          )}

          {!loading && profile && tab === "recommendations" && (
            <section className="intelligence-section"><h3>Planungsempfehlungen</h3>
              {profile.planning_recommendations.map((item) => <article className="intelligence-note" key={item.code}><strong>{item.label}</strong><p>{item.text}</p>{item.evidence.map((entry, index) => <small key={`${item.code}:evidence:${index}`}>{entry}</small>)}</article>)}
              {!profile.planning_recommendations.length && <p className="intelligence-empty">Aus den vorhandenen Daten entsteht noch keine sichere Empfehlung.</p>}
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function SkillCard({ skill, onDelete }: { skill: EmployeeSkill; onDelete?: () => void }) {
  return <article className="skill-card"><div><strong>{skill.name}</strong><span className="skill-stars" aria-label={`${skill.level} von 5`}>{"★".repeat(skill.level)}{"☆".repeat(5 - skill.level)}</span></div><small>{sourceLabel(skill.source)}</small>{skill.evidence.map((entry, index) => <p key={`${skill.id}:evidence:${index}`}>{entry}</p>)}{onDelete && <button type="button" onClick={onDelete}>Manuellen Skill entfernen</button>}</article>;
}

function MemoryCard({ entry, onDelete }: { entry: EmployeeMemoryEntry; onDelete?: () => void }) {
  return <article className="memory-intelligence-card"><div><span>{memoryTypeLabel(entry.type)}</span><strong>{memorySubject(entry)}</strong></div><p>{memoryValue(entry)}</p>{entry.note && entry.note !== memoryValue(entry) && <small>{entry.note}</small>}<footer><span>{sourceLabel(entry.source)}</span><span>{Math.round(entry.confidence * 100)}% Konfidenz</span>{entry.source_date && <span>{formatDate(entry.source_date)}</span>}</footer>{onDelete && <button type="button" onClick={onDelete}>Löschen</button>}</article>;
}
