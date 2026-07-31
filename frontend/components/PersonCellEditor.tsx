"use client";

import type { CustomCellEditorProps } from "ag-grid-react";
import { useEffect, useMemo, useRef, useState } from "react";

type EditorProps = CustomCellEditorProps<Record<string, string | null>, string> & {
  people?: string[];
  recommendedPeople?: string[];
  blockedPeople?: string[];
  nearbyPeople?: string[];
  showPeople?: string[];
  ruleHint?: string;
  minimumPeople?: number;
};

function parseCell(value: string): { prefix: string; names: string[] } {
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

function composeCell(prefix: string, names: string[]): string {
  const joined = names.join(", ");
  // Ein vorhandener Präfix (z.B. Ort/Uhrzeit/Künstler beim Aperitif) bleibt auch
  // erhalten, wenn kein MA (mehr) zugewiesen ist - sonst geht die Info beim
  // Entfernen des letzten Namens verloren.
  return prefix ? `${prefix} | ${joined}` : joined;
}

function recommendationLabel(rank?: number): string {
  if (rank === 1) return "Beste Wahl";
  if (rank === 2) return "Sehr gut";
  if (rank === 3) return "Gut";
  if (rank === 4) return "Passend";
  if (rank === 5) return "Alternative";
  return "Hinzufügen";
}

export default function PersonCellEditor({
  value,
  onValueChange,
  stopEditing,
  people = [],
  recommendedPeople = [],
  blockedPeople = [],
  nearbyPeople = [],
  showPeople = [],
  ruleHint,
  minimumPeople = 1,
}: EditorProps) {
  const initial = useMemo(() => parseCell(value ?? ""), [value]);
  const [names, setNames] = useState(initial.names);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const closeWhenValueIs = useRef<string | null>(null);
  const cellPrefix =
    initial.prefix || (minimumPeople > 1 ? "(Gäste vs Robins BVB)" : "");
  const normalizedQuery = query.trim().toLocaleLowerCase("de");
  const selectedLower = useMemo(
    () => new Set(names.map((name) => name.toLocaleLowerCase("de"))),
    [names],
  );
  const recommendedRank = useMemo(
    () => new Map(
      recommendedPeople.map((name, index) => [
        name.toLocaleLowerCase("de"),
        index + 1,
      ]),
    ),
    [recommendedPeople],
  );
  const blockedLower = useMemo(
    () => new Set(blockedPeople.map((name) => name.toLocaleLowerCase("de"))),
    [blockedPeople],
  );
  const nearbyLower = useMemo(
    () => new Set(nearbyPeople.map((name) => name.toLocaleLowerCase("de"))),
    [nearbyPeople],
  );
  const showLower = useMemo(
    () => new Set(showPeople.map((name) => name.toLocaleLowerCase("de"))),
    [showPeople],
  );
  const suggestions = useMemo(
    () =>
      people
        .filter((name) => !blockedLower.has(name.toLocaleLowerCase("de")))
        .filter((name) => !selectedLower.has(name.toLocaleLowerCase("de")))
        .filter((name) => !normalizedQuery || name.toLocaleLowerCase("de").includes(normalizedQuery))
        .sort((a, b) => {
          const rankA = recommendedRank.get(a.toLocaleLowerCase("de")) ?? 999;
          const rankB = recommendedRank.get(b.toLocaleLowerCase("de")) ?? 999;
          return rankA - rankB || a.localeCompare(b, "de");
        })
        .slice(0, 7),
    [blockedLower, people, normalizedQuery, recommendedRank, selectedLower],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (closeWhenValueIs.current === null || (value ?? "") !== closeWhenValueIs.current) {
      return;
    }
    closeWhenValueIs.current = null;
    // Erst im nächsten Browser-Schritt schließen: AG Grid hat den kontrollierten
    // Wert dann bereits intern übernommen und fällt nicht auf den alten Zellwert zurück.
    window.setTimeout(() => stopEditing(), 20);
  }, [value, stopEditing]);

  function commit(nextNames: string[]) {
    setNames(nextNames);
    onValueChange(composeCell(cellPrefix, nextNames));
  }

  function addName(name: string, closeAfter = false) {
    const clean = name.trim();
    if (!clean) return;
    const canonical =
      people.find((person) => person.toLocaleLowerCase("de") === clean.toLocaleLowerCase("de"))
      ?? clean;
    if (blockedLower.has(canonical.toLocaleLowerCase("de"))) {
      setError(ruleHint || `${canonical} ist für diesen Dienst nicht zulässig.`);
      return;
    }
    setError("");
    const exists = names.some(
      (selected) => selected.toLocaleLowerCase("de") === canonical.toLocaleLowerCase("de"),
    );
    const nextNames = exists ? names : [...names, canonical];
    const mayClose = closeAfter && nextNames.length >= minimumPeople;
    if (mayClose) closeWhenValueIs.current = composeCell(cellPrefix, nextNames);
    commit(nextNames);
    setQuery("");
    setActive(0);
    if (!mayClose) queueMicrotask(() => inputRef.current?.focus());
  }

  function removeName(name: string) {
    commit(names.filter((selected) => selected !== name));
    queueMicrotask(() => inputRef.current?.focus());
  }

  return (
    <div className="person-editor">
      <div className="person-editor-title">
        {minimumPeople > 1 ? "Gäste vs. Robins BVB" : "MA zuweisen"}
        <span>
          {minimumPeople > 1
            ? `${names.length}/${minimumPeople} MA ausgewählt`
            : initial.prefix}
        </span>
      </div>
      {names.length > 0 && (
        <div className="person-chips">
          {names.map((name) => (
            <button
              type="button"
              className="person-chip"
              key={name}
              title={`${name} entfernen`}
              onClick={() => removeName(name)}
            >
              {name}<span aria-hidden="true">×</span>
            </button>
          ))}
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
            setActive((index) => Math.min(index + 1, suggestions.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (!query.trim()) {
              if (names.length < minimumPeople) {
                setError(`Bitte mindestens ${minimumPeople} Mitarbeiter auswählen.`);
                return;
              }
              stopEditing();
              return;
            }
            const exact = people.find(
              (name) => name.toLocaleLowerCase("de") === normalizedQuery,
            );
            const selected = exact ?? suggestions[active] ?? query.trim();
            if (selected) addName(selected, true);
            else stopEditing();
          } else if (event.key === "Backspace" && !query && names.length) {
            removeName(names[names.length - 1]);
          }
        }}
        placeholder="Namen tippen und Enter …"
      />
      {suggestions.length > 0 && (
        <div className="person-suggestions">
          {suggestions.map((name, index) => {
            const rank = recommendedRank.get(name.toLocaleLowerCase("de"));
            const hasShowConflict = showLower.has(name.toLocaleLowerCase("de"));
            const hasNearbyRehearsal =
              !hasShowConflict && nearbyLower.has(name.toLocaleLowerCase("de"));
            return (
              <button
                type="button"
                key={name}
                className={`person-suggestion ${rank ? `rank-${rank}` : ""} ${hasShowConflict ? "has-show-conflict" : hasNearbyRehearsal ? "has-rehearsal-nearby" : ""} ${index === active ? "is-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addName(name)}
              >
                <span className="person-suggestion-name">
                  {rank && <span className="recommendation-dot" aria-hidden="true" />}
                  {name}
                </span>
                <span className="person-suggestion-add">
                  {hasShowConflict ? (
                    <span className="show-conflict-badge">
                      <span aria-hidden="true">●</span>
                      Show
                    </span>
                  ) : hasNearbyRehearsal ? (
                    <span className="rehearsal-nearby-badge">
                      <span aria-hidden="true">◷</span>
                      Probe nah
                    </span>
                  ) : recommendationLabel(rank)}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {error && <div className="person-rule-error">{error}</div>}
      <div className="person-editor-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            closeWhenValueIs.current = composeCell(cellPrefix, []);
            commit([]);
          }}
        >
          Leeren
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            if (names.length < minimumPeople) {
              setError(`Bitte mindestens ${minimumPeople} Mitarbeiter auswählen.`);
              return;
            }
            stopEditing();
          }}
        >
          Übernehmen
        </button>
      </div>
    </div>
  );
}
