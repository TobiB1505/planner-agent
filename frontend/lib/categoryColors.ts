// Exakte Farbcodes aus der echten Excel-Vorlage (siehe theme.py CATEGORY_COLORS).
// Einzige Quelle für Kategorie-Farben im Frontend, damit Grid/Dashboard konsistent bleiben.

export const CATEGORY_COLORS: Record<string, string> = {
  "Urlaub/Krank": "#fef4c8",
  Frei: "#fef4c8",
  Kochdienste: "#ffff00",
  Sportprogramm: "#00b0f0",
  "TT & Kicker wischen": "#ffc000",
  "Süße Momente": "#ffc000",
  "15:50 Süße Momente": "#ffc000",
  "18 Uhr LEDs": "#ff33cc",
  Saunaaufguss: "#a3dbbc",
  Aperitif: "#ebde8d",
  Aufbau: "#c9973a",
  Abbau: "#a17a3a",
  Extradienste: "#3a8ee8",
  "OPS + WP": "#7a5ce8",
  "OPS / WP": "#7a5ce8",
  "Moderation + Getränkedienst": "#d13a6e",
  Ausschlafen: "#6b6b6b",
  Tagesverantwortung: "#3ac9b0",
  "An/Abreise-Dienst": "#5c7ae8",
  "Nachmittag/Abend Extras": "#8e5ce8",
  Barfrei: "#e8b23a",
};

const FALLBACK_PALETTE = [
  "#5c8ae8", "#e85c8a", "#5ce8a1", "#e8a15c", "#8a5ce8",
  "#5ce8d8", "#e85c5c", "#a1e85c", "#5c5ce8", "#e8d85c",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function categoryColor(category: string): string {
  if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category];
  const idx = hashString(category) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[idx];
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
