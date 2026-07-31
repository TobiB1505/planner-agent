"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function weekNumber(iso: string): number {
  const date = new Date(`${iso}T12:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
}

function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mondayTime(date: Date): number {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = monday.getDay() || 7;
  monday.setDate(monday.getDate() - weekday + 1);
  return monday.getTime();
}

export default function WeekPicker({
  value,
  onChange,
  label = "Wochenbeginn",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}) {
  const selectedDate = value ? new Date(`${value}T12:00:00`) : null;
  const initialMonth = selectedDate ?? new Date();
  const [open, setOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState(
    () => new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1),
  );
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const calendarDays = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const first = new Date(year, month, 1);
    const leading = (first.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - leading);
    const cells: Date[] = [];
    for (let offset = 0; offset < 42; offset += 1) {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + offset);
      cells.push(day);
    }
    return cells;
  }, [monthCursor]);

  const day = selectedDate
    ? new Intl.DateTimeFormat("de-DE", { day: "2-digit" }).format(selectedDate)
    : "--";
  const month = selectedDate
    ? new Intl.DateTimeFormat("de-DE", { month: "short" }).format(selectedDate)
    : "---";
  const weekday = selectedDate
    ? new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(selectedDate)
    : "Tag auswählen";
  const fullDate = selectedDate
    ? new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(selectedDate)
    : "Noch kein Datum";
  const selectedMonday = selectedDate ? mondayTime(selectedDate) : null;
  const todayIso = toIso(new Date());
  const selectedWeekEnd = selectedDate
    ? new Date(mondayTime(selectedDate) + 6 * 86400000)
    : null;
  const weekRange = selectedDate && selectedWeekEnd
    ? `${new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
      }).format(new Date(mondayTime(selectedDate)))} – ${new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(selectedWeekEnd)}`
    : "Noch keine Woche gewählt";

  function toggleCalendar() {
    if (!open) {
      const target = selectedDate ?? new Date();
      setMonthCursor(new Date(target.getFullYear(), target.getMonth(), 1));
    }
    setOpen((current) => !current);
  }

  return (
    <div ref={rootRef} className={`week-picker ${className}`}>
      <span className="field-label">{label}</span>
      <button
        type="button"
        className="week-picker-control"
        onClick={toggleCalendar}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="week-picker-tile" aria-hidden="true">
          <strong>{day}</strong>
          <small>{month.replace(".", "")}</small>
        </span>
        <span className="week-picker-copy">
          <strong>{value ? `KW ${weekNumber(value)} · ${weekday}` : weekday}</strong>
          <small>{value ? weekRange : fullDate}</small>
        </span>
        <span className={`week-picker-caret ${open ? "is-open" : ""}`} aria-hidden="true">⌄</span>
      </button>

      {open && (
        <div className="week-calendar-popover" role="dialog" aria-label={label}>
          <div className="week-calendar-head">
            <button
              type="button"
              aria-label="Vorheriger Monat"
              onClick={() =>
                setMonthCursor((current) =>
                  new Date(current.getFullYear(), current.getMonth() - 1, 1)
                )
              }
            >
              ‹
            </button>
            <strong>
              {new Intl.DateTimeFormat("de-DE", {
                month: "long",
                year: "numeric",
              }).format(monthCursor)}
            </strong>
            <button
              type="button"
              aria-label="Nächster Monat"
              onClick={() =>
                setMonthCursor((current) =>
                  new Date(current.getFullYear(), current.getMonth() + 1, 1)
                )
              }
            >
              ›
            </button>
          </div>
          <div className="week-calendar-weekdays" aria-hidden="true">
            {WEEKDAYS.map((name) => <span key={name}>{name}</span>)}
          </div>
          <div className="week-calendar-grid">
            {calendarDays.map((date) => (
              <button
                type="button"
                key={toIso(date)}
                className={[
                  selectedMonday !== null && mondayTime(date) === selectedMonday
                    ? "is-selected-week"
                    : "",
                  value === toIso(date) ? "is-selected" : "",
                  todayIso === toIso(date) ? "is-today" : "",
                  date.getMonth() !== monthCursor.getMonth() ? "is-outside-month" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => {
                  onChange(toIso(date));
                  setOpen(false);
                }}
                aria-current={todayIso === toIso(date) ? "date" : undefined}
                aria-label={new Intl.DateTimeFormat("de-DE", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                }).format(date)}
              >
                {date.getDate()}
              </button>
            ))}
          </div>
          <div className="week-calendar-foot">
            <span>Tag auswählen</span>
            <button
              type="button"
              onClick={() => {
                const today = new Date();
                onChange(toIso(today));
                setOpen(false);
              }}
            >
              Heute
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
