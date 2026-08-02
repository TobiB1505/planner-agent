"use client";

import type { CandidateAvailability, CandidateInfo } from "@/lib/recommendations";
import type { CustomCellEditorProps } from "ag-grid-react";
import { useEffect, useMemo, useRef, useState } from "react";

type EditorProps = CustomCellEditorProps<Record<string, string | null>, string> & {
  people?: string[];
  candidates?: CandidateInfo[];
  /** Kompatibler Fallback für noch nicht migrierte Aufrufer. */
  recommendedPeople?: string[];
  blockedPeople?: string[];
  nearbyPeople?: string[];
  ruleHint?: string;
};

const SOFTSPORT_OPTIONS = [
  "Boccia",
  "Darts",
  "Freegolf",
  "Mölkky",
  "Wikinger-Schach",
  "TT/Kicker",
  "JeKaMi",
];

const GROUP_ORDER: CandidateAvailability[] = [
  "recommended",
  "available",
  "warning",
  "unavailable",
];

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

function parseValue(value: string): { activity: string; names: string[] } {
  if (!value.includes("|")) {
    const clean = value.trim();
    return SOFTSPORT_OPTIONS.includes(clean)
      ? { activity: clean, names: [] }
      : { activity: "", names: clean ? [clean] : [] };
  }
  const separator = value.indexOf("|");
  const activity = value.slice(0, separator).trim();
  const names = value
    .slice(separator + 1)
    .split(/[,;\n]+/)
    .map((name) => name.trim())
    .filter(
      (name, index, all) =>
        Boolean(name) &&
        all.findIndex(
          (candidate) =>
            candidate.toLocaleLowerCase("de") === name.toLocaleLowerCase("de"),
        ) === index,
    );
  return { activity, names };
}

function composeValue(activity: string, names: string[]): string {
  if (!activity && names.length === 0) return "";
  return `${activity} | ${names.join(", ")}`;
}

export default function SoftsportCellEditor({
  value,
  onValueChange,
  stopEditing,
  people = [],
  candidates = [],
  recommendedPeople = [],
  blockedPeople = [],
  nearbyPeople = [],
  ruleHint,
}: EditorProps) {
  const initial = useMemo(() => parseValue(value ?? ""), [value]);
  // Alle Änderungen bleiben lokal. Erst "Auswahl übernehmen" schreibt den
  // Entwurf in AG Grid; Escape und Abbrechen lassen den Zellwert unangetastet.
  const [draftActivity, setDraftActivity] = useState(initial.activity);
  const [draftNames, setDraftNames] = useState(initial.names);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("de");

  const activities = useMemo(
    () =>
      initial.activity && !SOFTSPORT_OPTIONS.includes(initial.activity)
        ? [initial.activity, ...SOFTSPORT_OPTIONS]
        : SOFTSPORT_OPTIONS,
    [initial.activity],
  );

  const selectedLower = useMemo(
    () => new Set(draftNames.map((name) => name.toLocaleLowerCase("de"))),
    [draftNames],
  );

  const effectiveCandidates = useMemo<CandidateInfo[]>(() => {
    if (candidates.length > 0) return candidates;

    const recommendedRank = new Map(
      recommendedPeople.map((name, index) => [name.toLocaleLowerCase("de"), index]),
    );
    const blocked = new Set(
      blockedPeople.map((name) => name.toLocaleLowerCase("de")),
    );
    const nearby = new Set(
      nearbyPeople.map((name) => name.toLocaleLowerCase("de")),
    );

    return people.map((name) => {
      const key = name.toLocaleLowerCase("de");
      if (blocked.has(key)) {
        return {
          name,
          status: "unavailable",
          reasons: [
            {
              code: "rule_blocked",
              text: ruleHint || "Für diese Zuweisung nicht verfügbar.",
            },
          ],
          score: 999,
        };
      }
      if (nearby.has(key)) {
        return {
          name,
          status: "warning",
          reasons: [
            { code: "rehearsal_nearby", text: "Probe in zeitlicher Nähe." },
          ],
          score: recommendedRank.get(key) ?? 999,
        };
      }
      if (recommendedRank.has(key)) {
        return {
          name,
          status: "recommended",
          reasons: [],
          score: recommendedRank.get(key) ?? 999,
        };
      }
      return { name, status: "available", reasons: [], score: 999 };
    });
  }, [blockedPeople, candidates, nearbyPeople, people, recommendedPeople, ruleHint]);

  const candidateByName = useMemo(
    () =>
      new Map(
        effectiveCandidates.map((candidate) => [
          candidate.name.toLocaleLowerCase("de"),
          candidate,
        ]),
      ),
    [effectiveCandidates],
  );

  const groups = useMemo(() => {
    const grouped = new Map<CandidateAvailability, CandidateInfo[]>();
    for (const status of GROUP_ORDER) grouped.set(status, []);

    for (const candidate of effectiveCandidates) {
      const key = candidate.name.toLocaleLowerCase("de");
      if (selectedLower.has(key)) continue;
      if (normalizedQuery && !key.includes(normalizedQuery)) continue;
      grouped.get(candidate.status)?.push(candidate);
    }

    grouped
      .get("recommended")
      ?.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "de"));
    grouped.get("available")?.sort((a, b) => a.name.localeCompare(b.name, "de"));
    grouped
      .get("warning")
      ?.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "de"));
    grouped
      .get("unavailable")
      ?.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return grouped;
  }, [effectiveCandidates, normalizedQuery, selectedLower]);

  const selectableCandidates = useMemo(
    () => [
      ...(groups.get("recommended") ?? []),
      ...(groups.get("available") ?? []),
      ...(groups.get("warning") ?? []),
    ],
    [groups],
  );
  const activeIndex = Math.min(
    active,
    Math.max(selectableCandidates.length - 1, 0),
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      stopEditing();
    }
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [stopEditing]);

  function addName(name: string) {
    const clean = name.trim();
    if (!clean) return;
    const candidate = candidateByName.get(clean.toLocaleLowerCase("de"));
    if (candidate?.status === "unavailable") {
      setError(
        candidate.reasons[0]?.text ||
          ruleHint ||
          `${candidate.name} ist für diesen Dienst nicht verfügbar.`,
      );
      return;
    }
    const canonical =
      people.find(
        (person) =>
          person.toLocaleLowerCase("de") === clean.toLocaleLowerCase("de"),
      ) ?? candidate?.name ?? clean;
    setDraftNames((current) =>
      current.some(
        (selected) =>
          selected.toLocaleLowerCase("de") === canonical.toLocaleLowerCase("de"),
      )
        ? current
        : [...current, canonical],
    );
    setError("");
    setQuery("");
    setActive(0);
    queueMicrotask(() => inputRef.current?.focus());
  }

  function removeName(name: string) {
    setDraftNames((current) => current.filter((selected) => selected !== name));
    queueMicrotask(() => inputRef.current?.focus());
  }

  function submitDraft() {
    if (submitting) return;
    const isEmptyDraft = !draftActivity && draftNames.length === 0;
    if (!isEmptyDraft && (!draftActivity || draftNames.length === 0)) {
      setError("Bitte Softsport-Art und mindestens einen Mitarbeiter auswählen.");
      return;
    }
    setSubmitting(true);
    onValueChange(composeValue(draftActivity, draftNames));
    stopEditing();
  }

  return (
    <div
      className="person-editor softsport-person-editor"
      role="dialog"
      aria-label="Softsport zuweisen"
    >
      <div className="person-editor-header">
        <div className="person-editor-title">Softsport zuweisen</div>
        <button
          type="button"
          className="person-editor-close"
          aria-label="Softsport-Zuweisung schließen"
          title="Schließen"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => stopEditing()}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5" />
          </svg>
        </button>
      </div>
      <label className="softsport-activity-field">
        <span>Softsport-Art</span>
        <select
          value={draftActivity}
          onChange={(event) => {
            setDraftActivity(event.target.value);
            setError("");
          }}
        >
          <option value="">Art auswählen …</option>
          {activities.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>

      {draftNames.length > 0 && (
        <div className="person-chips">
          {draftNames.map((name) => {
            const candidate = candidateByName.get(name.toLocaleLowerCase("de"));
            const flagged = candidate?.status === "unavailable";
            return (
              <div
                className={`person-chip-wrap ${flagged ? "is-flagged" : ""}`}
                key={name}
              >
                <button
                  type="button"
                  className="person-chip"
                  title={`${name} entfernen`}
                  onClick={() => removeName(name)}
                >
                  {flagged && <span aria-hidden="true">⚠</span>}
                  {name}
                  <span aria-hidden="true">×</span>
                </button>
                {flagged && candidate?.reasons[0] && (
                  <span className="person-chip-warning">
                    {candidate.reasons[0].text}
                  </span>
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
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) =>
              Math.min(index + 1, selectableCandidates.length - 1),
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (!query.trim()) {
              if (!draftActivity || draftNames.length === 0) {
                setError(
                  "Zum Übernehmen Softsport-Art und mindestens einen Mitarbeiter auswählen.",
                );
                return;
              }
              submitDraft();
              return;
            }
            const exact = effectiveCandidates.find(
              (candidate) =>
                candidate.name.toLocaleLowerCase("de") === normalizedQuery,
            );
            const selected = exact ?? selectableCandidates[activeIndex];
            if (selected) addName(selected.name);
          } else if (
            event.key === "Backspace" &&
            !query &&
            draftNames.length > 0
          ) {
            removeName(draftNames[draftNames.length - 1]);
          }
        }}
        placeholder="Mitarbeiter suchen und Enter …"
      />

      <div className="person-candidate-list">
        {GROUP_ORDER.map((status) => {
          const members = groups.get(status) ?? [];
          if (members.length === 0) return null;
          return (
            <div className="person-candidate-group" key={status}>
              <div className="person-candidate-group-title">
                {GROUP_LABEL[status]}
                <span>{members.length}</span>
              </div>
              {members.map((candidate) => {
                const isUnavailable = status === "unavailable";
                const globalIndex = selectableCandidates.indexOf(candidate);
                const primaryReason = candidate.reasons[0];
                if (isUnavailable) {
                  return (
                    <div
                      className="person-candidate is-unavailable"
                      key={candidate.name}
                    >
                      <span className="person-candidate-status-dot" aria-hidden="true">
                        {GROUP_ICON.unavailable}
                      </span>
                      <span className="person-candidate-body">
                        <span className="person-candidate-name">{candidate.name}</span>
                        {primaryReason && (
                          <span className="person-candidate-reason">
                            {primaryReason.text}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                }
                return (
                  <button
                    type="button"
                    className={`person-candidate status-${status} ${globalIndex === activeIndex ? "is-active" : ""}`}
                    key={candidate.name}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setActive(Math.max(globalIndex, 0));
                      addName(candidate.name);
                    }}
                  >
                    {status !== "available" && (
                      <span className="person-candidate-status-dot" aria-hidden="true">
                        {GROUP_ICON[status]}
                      </span>
                    )}
                    <span className="person-candidate-body">
                      <span className="person-candidate-name">{candidate.name}</span>
                      {primaryReason && (
                        <span className="person-candidate-reason">
                          {primaryReason.text}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {effectiveCandidates.length > 0 &&
          selectableCandidates.length === 0 &&
          (groups.get("unavailable")?.length ?? 0) === 0 &&
          normalizedQuery && (
            <div className="person-candidate-empty">
              Keine Treffer für „{query}“.
            </div>
          )}
      </div>

      {error && <div className="person-rule-error">{error}</div>}

      <div className="person-editor-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setDraftActivity("");
            setDraftNames([]);
            setQuery("");
            setError("");
          }}
        >
          Leeren
        </button>
        <button type="button" className="btn" onClick={() => stopEditing()}>
          Abbrechen
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={
            submitting ||
            Boolean(draftActivity) !== Boolean(draftNames.length > 0)
          }
          onClick={submitDraft}
        >
          Übernehmen
        </button>
      </div>
    </div>
  );
}
