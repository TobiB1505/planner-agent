"use client";

import ConfirmDialog from "@/components/ConfirmDialog";
import { getIntelligentRecommendations, type IntelligentCandidate } from "@/lib/api";
import type { CandidateAvailability, CandidateInfo } from "@/lib/recommendations";
import type { CustomCellEditorProps } from "ag-grid-react";
import { useEffect, useMemo, useRef, useState } from "react";

type EditorProps = CustomCellEditorProps<Record<string, string | null>, string> & {
  people?: string[];
  /** Vollständig klassifizierte Kandidatenliste aus recommendForCell (Sprint 2). */
  candidates?: CandidateInfo[];
  ruleHint?: string;
  minimumPeople?: number;
  /** Kontext für den Kopfbereich (Aufgabe 1) - nur anzeigen, was tatsächlich bekannt ist. */
  serviceName?: string;
  sectionName?: string;
  weekdayLabel?: string;
  dateLabel?: string;
  timeLabel?: string;
  intelligenceRequest?: {
    start_date: string;
    day_labels: string[];
    rows: Record<string, string | null>[];
    day_label: string;
    category: string;
    subcategory?: string | null;
  };
  onRecommendationSelected?: (name: string) => void;
};

const GROUP_ORDER: CandidateAvailability[] = ["recommended", "available", "warning", "unavailable"];

const GROUP_LABEL: Record<CandidateAvailability, string> = {
  recommended: "Empfohlen",
  available: "Weitere verfügbare Mitarbeiter",
  warning: "Mit Hinweis",
  unavailable: "Nicht verfügbar",
};

const GROUP_ICON: Record<CandidateAvailability, string> = {
  recommended: "★",
  available: "",
  warning: "⚠",
  unavailable: "🔒",
};

// Diese Warngründe sind fachlich gewichtig genug für eine Rückfrage vor dem
// Übernehmen (Aufgabe 6) - reine Auslastungshinweise (Tagesbelastung etc.)
// werden dagegen ohne Umweg direkt übernommen, sonst nervt der Dialog bei
// jeder kleinen Abweichung.
const CRITICAL_WARNING_CODES = new Set(["show_conflict", "rehearsal_nearby"]);

const UNAVAILABLE_COLLAPSE_THRESHOLD = 8;

function backendCandidate(candidate: IntelligentCandidate): CandidateInfo {
  const warningReasons = candidate.warnings.map((warning) => ({
    code: (["absence", "time_conflict", "rehearsal_overlap", "rule_blocked", "department_preference"] as const)
      .find((code) => code === warning.code) ?? "rule_blocked",
    text: warning.label,
  }));
  const positiveReasons = candidate.reasons.map((reason) => ({
    code: reason.code,
    text: `${reason.label}: ${reason.evidence}`,
  }));
  return {
    name: candidate.employee,
    status: candidate.status,
    reasons: [...warningReasons, ...positiveReasons],
    score: candidate.rank,
  };
}

export function parseCell(value: string): { prefix: string; names: string[] } {
  const lines = value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const firstPipeLine = lines.findIndex((line) => line.includes("|"));
  const prefixLines =
    firstPipeLine >= 0
      ? [
          ...lines.slice(0, firstPipeLine),
          lines[firstPipeLine].slice(0, lines[firstPipeLine].lastIndexOf("|")).trim(),
        ].filter(Boolean)
      : [];
  const names = (firstPipeLine >= 0 ? lines.slice(firstPipeLine) : lines)
    .flatMap((line, index) => {
      if (line.includes("|")) return line.slice(line.lastIndexOf("|") + 1).split(/[,;]+/);
      // Ohne jeden Trenner in der Zelle (z.B. bei Tagesverantwortung, OPS/WP, ...)
      // ist der gesamte Inhalt eine reine Namensliste. Gibt es einen Trenner,
      // zählen nur die Folgezeilen danach als weitere MA; davor gehören sie zum
      // mehrzeiligen Künstler-/Ort-/Zeit-Präfix (z.B. beim Aperitif).
      return firstPipeLine < 0 || index > 0 ? line.split(/[,;]+/) : [];
    })
    .map((name) => name.trim())
    .filter((name, index, all) =>
      Boolean(name) &&
      all.findIndex((candidate) => candidate.toLocaleLowerCase("de") === name.toLocaleLowerCase("de")) === index
    );
  return { prefix: prefixLines.join("\n"), names };
}

export function composeCell(prefix: string, names: string[]): string {
  const joined = names.join(", ");
  // Ein vorhandener Präfix (z.B. Ort/Uhrzeit/Künstler beim Aperitif) bleibt auch
  // erhalten, wenn kein MA (mehr) zugewiesen ist - sonst geht die Info beim
  // Entfernen des letzten Namens verloren.
  return prefix ? `${prefix} | ${joined}` : joined;
}

export default function PersonCellEditor(props: EditorProps) {
  const editorKey = `${props.node?.id ?? "row"}:${props.column?.getColId() ?? "column"}:${props.value ?? ""}`;
  return <PersonCellEditorInstance key={editorKey} {...props} />;
}

function PersonCellEditorInstance({
  value,
  onValueChange,
  stopEditing,
  people = [],
  candidates = [],
  ruleHint,
  minimumPeople = 1,
  serviceName,
  sectionName,
  weekdayLabel,
  dateLabel,
  timeLabel,
  intelligenceRequest,
  onRecommendationSelected,
}: EditorProps) {
  const initial = useMemo(() => parseCell(value ?? ""), [value]);
  // Lokaler Entwurf: Änderungen landen erst mit "Auswahl übernehmen" in der
  // Zelle (onValueChange wird sonst nicht aufgerufen) - Abbrechen/Escape
  // verwerfen den Entwurf dadurch automatisch, ohne extra Restore-Logik.
  const [draftNames, setDraftNames] = useState(initial.names);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const [expandedWhy, setExpandedWhy] = useState<string | null>(null);
  const [unavailableExpanded, setUnavailableExpanded] = useState(false);
  const [pendingWarning, setPendingWarning] = useState<CandidateInfo | null>(null);
  const [pendingClearAll, setPendingClearAll] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [intelligenceCandidates, setIntelligenceCandidates] = useState<CandidateInfo[] | null>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(Boolean(intelligenceRequest));
  const [interactionReady, setInteractionReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const recommendedSelectionsRef = useRef<Set<string>>(new Set());
  const cellPrefix =
    initial.prefix || (minimumPeople > 1 ? "(Gäste vs Robins BVB)" : "");
  const normalizedQuery = query.trim().toLocaleLowerCase("de");
  const selectedLower = useMemo(
    () => new Set(draftNames.map((name) => name.toLocaleLowerCase("de"))),
    [draftNames],
  );
  const effectiveCandidates = intelligenceCandidates ?? candidates;

  useEffect(() => {
    if (!intelligenceRequest) return;
    let activeRequest = true;
    // Sprint 2 (Phase 9.1): bricht die Anfrage wirklich ab, wenn die Zelle
    // vor Antwort geschlossen wird (schnelle Folgeaktion/Escape) - erspart
    // dem Backend unnötige Arbeit, zusätzlich zum bestehenden activeRequest-
    // Schutz gegen das Anwenden veralteter Ergebnisse.
    const controller = new AbortController();
    getIntelligentRecommendations(intelligenceRequest, controller.signal)
      .then((result) => {
        if (activeRequest) setIntelligenceCandidates(result.candidates.map(backendCandidate));
      })
      .catch(() => {
        // Lokale Sprint-2-Empfehlungen bleiben als ausfallsicherer Fallback sichtbar.
      })
      .finally(() => {
        if (activeRequest) setIntelligenceLoading(false);
      });
    return () => {
      activeRequest = false;
      controller.abort();
    };
  }, [intelligenceRequest]);

  const candidateByName = useMemo(() => {
    const map = new Map<string, CandidateInfo>();
    for (const candidate of effectiveCandidates) {
      map.set(candidate.name.toLocaleLowerCase("de"), candidate);
    }
    return map;
  }, [effectiveCandidates]);

  function candidateFor(name: string): CandidateInfo | undefined {
    return candidateByName.get(name.toLocaleLowerCase("de"));
  }

  const groups = useMemo(() => {
    const byGroup = new Map<CandidateAvailability, CandidateInfo[]>();
    for (const status of GROUP_ORDER) byGroup.set(status, []);
    for (const candidate of effectiveCandidates) {
      if (selectedLower.has(candidate.name.toLocaleLowerCase("de"))) continue;
      if (
        normalizedQuery &&
        !candidate.name.toLocaleLowerCase("de").includes(normalizedQuery)
      ) {
        continue;
      }
      byGroup.get(candidate.status)?.push(candidate);
    }
    // Fallback für Personen ohne Klassifizierung (z.B. wenn candidates leer
    // bleibt, weil die Zelle keine dynamische Empfehlung hat): einfach als
    // "verfügbar" ohne Begründung einsortieren, damit die Auswahl nie leer ist.
    if (effectiveCandidates.length === 0) {
      for (const name of people) {
        if (selectedLower.has(name.toLocaleLowerCase("de"))) continue;
        if (normalizedQuery && !name.toLocaleLowerCase("de").includes(normalizedQuery)) continue;
        byGroup.get("available")?.push({ name, status: "available", reasons: [], score: 0 });
      }
    }
    byGroup.get("recommended")?.sort((a, b) => a.score - b.score);
    byGroup.get("available")?.sort((a, b) => a.name.localeCompare(b.name, "de"));
    byGroup
      .get("warning")
      ?.sort((a, b) => a.reasons.length - b.reasons.length || a.score - b.score);
    byGroup.get("unavailable")?.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return byGroup;
  }, [effectiveCandidates, people, selectedLower, normalizedQuery]);

  const interactiveCandidates = useMemo(
    () => [
      ...(groups.get("recommended") ?? []),
      ...(groups.get("available") ?? []),
      ...(groups.get("warning") ?? []),
    ],
    [groups],
  );

  // Geklammert statt über einen Effekt nachgezogen: die Liste ändert sich bei
  // jedem Tastendruck in der Suche, ein Effekt würde hier unnötige Extra-Renders
  // auslösen (siehe react-hooks/set-state-in-effect).
  const activeIndex = Math.min(active, Math.max(interactiveCandidates.length - 1, 0));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // AG Grid öffnet die Zelle bereits beim ersten Klick. Bei einem gewohnten
  // Doppelklick darf der zweite Klick deshalb nicht versehentlich den ersten
  // Kandidaten im gerade erschienenen Popup auswählen.
  useEffect(() => {
    const timer = window.setTimeout(() => setInteractionReady(true), 240);
    return () => window.clearTimeout(timer);
  }, []);

  const target = minimumPeople > 1 ? minimumPeople : undefined;
  const belowMinimum = Boolean(target) && draftNames.length < (target ?? 0);
  const aboveTarget = Boolean(target) && draftNames.length > (target ?? 0);
  const dialogOpen = Boolean(pendingWarning) || pendingClearAll;

  // Dokumentweit statt am Wurzel-Element: nach dem Schließen eines ConfirmDialog
  // (Aufgabe 6/8) liegt der Fokus nicht mehr zuverlässig innerhalb des Popups -
  // ein React-onKeyDown am Container würde Escape dann verpassen.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (dialogOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        cancelEditing();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        confirmSubmit();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  function commitCandidate(name: string) {
    const canonical =
      people.find((person) => person.toLocaleLowerCase("de") === name.toLocaleLowerCase("de")) ?? name;
    setDraftNames((current) =>
      current.some((selected) => selected.toLocaleLowerCase("de") === canonical.toLocaleLowerCase("de"))
        ? current
        : [...current, canonical],
    );
    setError("");
    setQuery("");
    setActive(0);
    if (candidateFor(canonical)?.status === "recommended") {
      recommendedSelectionsRef.current.add(canonical);
    }
    queueMicrotask(() => inputRef.current?.focus());
  }

  function addName(name: string) {
    const clean = name.trim();
    if (!clean) return;
    const candidate = candidateFor(clean);
    if (candidate?.status === "unavailable") {
      setError(candidate.reasons[0]?.text || ruleHint || `${clean} ist für diesen Dienst nicht verfügbar.`);
      return;
    }
    if (candidate?.status === "warning" && CRITICAL_WARNING_CODES.has(candidate.reasons[0]?.code ?? "")) {
      setPendingWarning(candidate);
      return;
    }
    commitCandidate(clean);
  }

  function removeName(name: string) {
    recommendedSelectionsRef.current.delete(name);
    setDraftNames((current) => current.filter((selected) => selected !== name));
    queueMicrotask(() => inputRef.current?.focus());
  }

  function confirmSubmit() {
    if (submitting) return;
    if (draftNames.length < minimumPeople) {
      setError(`Bitte mindestens ${minimumPeople} Mitarbeiter auswählen.`);
      return;
    }
    setSubmitting(true);
    for (const name of draftNames) {
      if (recommendedSelectionsRef.current.has(name)) {
        onRecommendationSelected?.(name);
      }
    }
    onValueChange(composeCell(cellPrefix, draftNames));
    stopEditing();
  }

  function cancelEditing() {
    // onValueChange wurde nie aufgerufen - AG Grid behält den ursprünglichen
    // Zellwert automatisch bei.
    stopEditing();
  }

  function requestClearAll() {
    if (draftNames.length === 0) return;
    setPendingClearAll(true);
  }

  return (
    <div
      ref={rootRef}
      className={`person-editor person-editor-wide ${interactionReady ? "" : "is-arming"}`}
      role="dialog"
      aria-label="Mitarbeiter zuweisen"
      onClickCapture={(event) => {
        if (!interactionReady) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div className="person-editor-header">
        <div className="person-editor-header-copy">
          <div className="person-editor-title">Mitarbeiter zuweisen</div>
          {serviceName && <div className="person-editor-service">{serviceName}</div>}
          {(weekdayLabel || dateLabel || timeLabel) && (
            <div className="person-editor-when">
              {[weekdayLabel, dateLabel].filter(Boolean).join(", ")}
              {timeLabel ? ` · ${timeLabel}` : ""}
            </div>
          )}
          {sectionName && <div className="person-editor-section">{sectionName}</div>}
        </div>
        <button
          type="button"
          className="person-editor-close"
          aria-label="Mitarbeiter-Zuweisung schließen"
          title="Schließen"
          onMouseDown={(event) => event.preventDefault()}
          onClick={cancelEditing}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5" />
          </svg>
        </button>
      </div>

      <div className="person-editor-occupancy">
        {target ? (
          <>
            <span className={belowMinimum ? "is-under" : aboveTarget ? "is-over" : "is-ok"}>
              {draftNames.length} von {target} Personen ausgewählt
            </span>
            {belowMinimum && <small>Noch {target - draftNames.length} Person(en) erforderlich</small>}
            {aboveTarget && <small>{draftNames.length - target} Person(en) zu viel</small>}
          </>
        ) : (
          <span>
            {draftNames.length} {draftNames.length === 1 ? "Person" : "Personen"} ausgewählt
          </span>
        )}
      </div>

      {intelligenceLoading && (
        <div className="person-intelligence-loading" role="status">
          <span className="spinner" /> Historie und Planlogik werden abgeglichen …
        </div>
      )}

      {draftNames.length > 0 && (
        <div className="person-chips">
          {draftNames.map((name) => {
            const candidate = candidateFor(name);
            const isUnavailableNow = candidate?.status === "unavailable";
            return (
              <div key={name} className={`person-chip-wrap ${isUnavailableNow ? "is-flagged" : ""}`}>
                <button
                  type="button"
                  className="person-chip"
                  title={`${name} entfernen`}
                  onClick={() => removeName(name)}
                >
                  {isUnavailableNow && <span aria-hidden="true">⚠</span>}
                  {name}
                  <span aria-hidden="true">×</span>
                </button>
                {isUnavailableNow && (
                  <div className="person-chip-warning">
                    {name}: {candidate?.reasons[0]?.text ?? "Inzwischen nicht mehr verfügbar"} – bitte prüfen.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setActive(0);
          setError("");
          setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (dialogOpen) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, interactiveCandidates.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) {
              confirmSubmit();
              return;
            }
            if (!query.trim()) {
              if (draftNames.length < minimumPeople) {
                setError(`Bitte mindestens ${minimumPeople} Mitarbeiter auswählen.`);
                return;
              }
              confirmSubmit();
              return;
            }
            const exact = people.find((name) => name.toLocaleLowerCase("de") === normalizedQuery);
            const selected = exact ?? interactiveCandidates[activeIndex]?.name ?? query.trim();
            if (selected) addName(selected);
          } else if (event.key === "Backspace" && !query && draftNames.length) {
            removeName(draftNames[draftNames.length - 1]);
          }
        }}
        placeholder="Mitarbeiter suchen …"
      />

      <div className="person-candidate-list">
        {GROUP_ORDER.map((status) => {
          const members = groups.get(status) ?? [];
          if (members.length === 0) return null;
          const collapsible =
            status === "unavailable" && members.length > UNAVAILABLE_COLLAPSE_THRESHOLD;
          const visibleMembers =
            collapsible && !unavailableExpanded ? members.slice(0, UNAVAILABLE_COLLAPSE_THRESHOLD) : members;
          const firstReason = members[0]?.reasons[0]?.text;
          const sharedPrimaryReason =
            members.length >= 3 &&
            firstReason &&
            members.every((candidate) => candidate.reasons[0]?.text === firstReason)
              ? firstReason
              : undefined;
          return (
            <div className="person-candidate-group" key={status}>
              <div className="person-candidate-group-title">
                {GROUP_LABEL[status]}
                <span>{members.length}</span>
              </div>
              {sharedPrimaryReason && (
                <div className={`person-candidate-group-note status-${status}`}>
                  {sharedPrimaryReason}
                </div>
              )}
              {visibleMembers.map((candidate) => {
                const globalIndex = interactiveCandidates.indexOf(candidate);
                const primaryReason = candidate.reasons[0];
                const isUnavailable = status === "unavailable";
                const isWhyOpen = expandedWhy === candidate.name;
                if (isUnavailable) {
                  return (
                    <div className="person-candidate is-unavailable" key={candidate.name}>
                      <span className="person-candidate-status-dot" aria-hidden="true">
                        {GROUP_ICON.unavailable}
                      </span>
                      <span className="person-candidate-body">
                        <span className="person-candidate-name">{candidate.name}</span>
                        {primaryReason && !sharedPrimaryReason && (
                          <span className="person-candidate-reason">{primaryReason.text}</span>
                        )}
                      </span>
                    </div>
                  );
                }
                return (
                  <div className="person-candidate-row" key={candidate.name}>
                    <button
                      type="button"
                      className={`person-candidate status-${status} ${globalIndex === activeIndex ? "is-active" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setActive(Math.max(globalIndex, 0));
                        addName(candidate.name);
                      }}
                      aria-label={`${candidate.name} hinzufügen${primaryReason ? `, ${primaryReason.text}` : ""}`}
                    >
                      {status !== "available" && (
                        <span className="person-candidate-status-dot" aria-hidden="true">
                          {GROUP_ICON[status]}
                        </span>
                      )}
                      <span className="person-candidate-body">
                        <span className="person-candidate-name">{candidate.name}</span>
                        {primaryReason && !sharedPrimaryReason ? (
                          <span className="person-candidate-reason">{primaryReason.text}</span>
                        ) : (
                          status === "available" && !sharedPrimaryReason && (
                            <span className="person-candidate-reason is-muted">Keine besonderen Hinweise</span>
                          )
                        )}
                      </span>
                    </button>
                    {status !== "available" && candidate.reasons.length > 1 && (
                      <button
                        type="button"
                        className="person-candidate-why"
                        onClick={() => setExpandedWhy(isWhyOpen ? null : candidate.name)}
                        aria-expanded={isWhyOpen}
                      >
                        {isWhyOpen ? "Details ausblenden" : "Warum?"}
                      </button>
                    )}
                    {isWhyOpen && (
                      <ul className="person-candidate-why-list">
                        {candidate.reasons.map((reason) => (
                          <li key={reason.code}>{reason.text}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {collapsible && (
                <button
                  type="button"
                  className="person-candidate-toggle-more"
                  onClick={() => setUnavailableExpanded((current) => !current)}
                >
                  {unavailableExpanded
                    ? "Weniger anzeigen"
                    : `${members.length - UNAVAILABLE_COLLAPSE_THRESHOLD} weitere anzeigen`}
                </button>
              )}
            </div>
          );
        })}
        {interactiveCandidates.length === 0 &&
          (groups.get("unavailable")?.length ?? 0) === 0 &&
          normalizedQuery && <div className="person-candidate-empty">Keine Treffer für „{query}“.</div>}
      </div>

      {error && <div className="person-rule-error">{error}</div>}

      <div className="person-editor-actions">
        <button
          type="button"
          className="person-editor-clear"
          disabled={draftNames.length === 0}
          onClick={requestClearAll}
        >
          Alle Zuweisungen entfernen
        </button>
        <div className="person-editor-actions-primary">
          <button type="button" className="btn" onClick={cancelEditing}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" disabled={submitting} onClick={confirmSubmit}>
            Übernehmen
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingWarning)}
        title="Zuweisung trotz Hinweis übernehmen?"
        description={pendingWarning ? `${pendingWarning.name}: ${pendingWarning.reasons[0]?.text ?? ""}` : ""}
        actions={[
          { label: "Abbrechen", onClick: () => setPendingWarning(null) },
          {
            label: "Trotzdem zuweisen",
            variant: "primary",
            autoFocus: true,
            onClick: () => {
              if (pendingWarning) commitCandidate(pendingWarning.name);
              setPendingWarning(null);
            },
          },
        ]}
        onDismiss={() => setPendingWarning(null)}
      />

      <ConfirmDialog
        open={pendingClearAll}
        title="Alle Zuweisungen entfernen?"
        description="Dieser Dienst ist anschließend unbesetzt."
        actions={[
          { label: "Abbrechen", onClick: () => setPendingClearAll(false) },
          {
            label: "Alle entfernen",
            variant: "danger",
            onClick: () => {
              setDraftNames([]);
              setPendingClearAll(false);
              queueMicrotask(() => inputRef.current?.focus());
            },
          },
        ]}
        onDismiss={() => setPendingClearAll(false)}
      />
    </div>
  );
}
