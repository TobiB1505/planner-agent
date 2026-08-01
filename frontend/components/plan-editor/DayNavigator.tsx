"use client";

export default function DayNavigator({
  dayLabels,
  weekDates,
  activeDay,
  onSelect,
}: {
  dayLabels: string[];
  weekDates: string[];
  activeDay: string;
  onSelect: (dayLabel: string) => void;
}) {
  const todayIso = new Date().toLocaleDateString("sv-SE");

  return (
    <nav className="plan-day-navigator" aria-label="Zu einem Wochentag springen">
      {dayLabels.map((label, index) => {
        const isToday = weekDates[index] === todayIso;
        const selected = activeDay === label;
        return (
          <button
            key={label}
            type="button"
            className={`${selected ? "is-active" : ""} ${isToday ? "is-today" : ""}`}
            aria-pressed={selected}
            onClick={() => onSelect(label)}
          >
            <span>{label.split(",")[0]}</span>
            {isToday && <small>Heute</small>}
          </button>
        );
      })}
    </nav>
  );
}

