# Design System — „Quiet Command“ (Sprint 1)

Grundlage für alle weiteren Frontend-Sprints. Dokumentiert das in Sprint 1
geschaffene Token-System und die zentralen `components/ui/`-Primitives.
Ersetzt **nicht** jede Seite — siehe `UI_MIGRATION_PLAN.md` für den Stand
der Migration.

## 1. Designprinzipien — „Quiet Command“

Der Planner-Agent ist ein professionelles Arbeitswerkzeug für Dienstplanung.
Die Oberfläche ist bewusst:

- **dunkel und ruhig** — ein aktives Theme (`data-theme="command"`), keine
  grellen Flächen, reduzierte Sättigung außerhalb des Akzents.
- **hochwertig statt verspielt** — klare Kanten, ein Blur-Effekt statt
  vieler, keine Bounce-Animationen.
- **klare visuelle Hierarchie** — Typografie- und Spacing-Skala statt
  beliebiger Werte je Komponente.
- **reduzierte Effekte** — ein Schatten-Level pro Ebene, keine mehrfach
  kombinierten Glows.
- **helle violette Akzentfarbe** — ein Akzent (`--color-accent`) für
  primäre Aktionen und Fokus, nicht mehrere konkurrierende Akzente.
- **funktionale Motion** — Animationen zeigen Zustandswechsel (Dialog öffnet,
  Toast erscheint), sind nie rein dekorativ, und respektieren
  `prefers-reduced-motion`.
- **Glass gezielt, nicht flächendeckend** — siehe Abschnitt 7.

## 2. Farb-Tokens

Zentral definiert in `frontend/app/styles/tokens.css`, additiv zu den
bestehenden Roh-Tokens (`--background`, `--surface`, `--accent`, `--status-*`
usw. aus `foundation.css`/`command-theme.css`). Die `--color-*`-Tokens
referenzieren die Roh-Tokens per `var()`, damit das aktive Theme
(`command-theme.css`) automatisch weitergilt, ohne Werte zu duplizieren.

| Token | Zweck |
|---|---|
| `--color-background` / `-subtle` | Seitenhintergrund |
| `--color-surface` / `-raised` / `-overlay` | Inhaltsfläche / angehobene Karte / Dialog-Fläche |
| `--color-surface-hover` / `-active` | Interaktive Hover-/Active-Fläche |
| `--color-text` / `-muted` / `-subtle` / `-inverse` | Textfarben nach Wichtigkeit |
| `--color-border` / `-strong` / `-subtle` | Rahmenfarben |
| `--color-accent` / `-hover` / `-active` / `-subtle` / `-contrast` | Primärakzent + Zustände + Kontrastfarbe für Text auf Akzent |
| `--color-success` / `-warning` / `-danger` / `-info` (+ `-subtle`) | Semantischer UI-Status |
| `--color-backdrop` | Dialog-Hintergrundabdunkelung |

**Fachliche Farben bleiben getrennt:** Kategorie-Farben aus der
Excel-Vorlage (`--cat-*` in `app/styles/category-colors.css`,
`lib/categoryColors.ts`) und die allgemeinen `--status-*`-Tokens
(`foundation.css`) sind eigene, unveränderte Quellen. Sie werden **nicht**
in `--color-*` umbenannt, um das Exportdesign und die Grid-Kategoriefarben
nicht anzufassen (explizit außerhalb des Sprint-1-Scopes).

**Do:** `background: var(--color-surface-raised);`
**Don't:** `background: #171a28;` (Hex-Werte in neuen Komponenten)

## 3. Oberflächenebenen

Sechs Ebenen, unterschieden durch Kombination aus Hintergrundfarbe, Border
und (bei Dialog/Glass) Blur — nicht nur durch Schatten:

1. Seitenhintergrund — `--color-background`
2. Inhaltsfläche — `--color-surface`, `--color-border`
3. Angehobene Karte — `--color-surface-raised`, `--shadow-sm`
4. Interaktive Hover-Fläche — `--color-surface-hover`
5. Dialog/Overlay — `--color-surface-overlay`, `--shadow-overlay`, Blur
6. Glass-Fläche — teiltransparente Surface + Blur (siehe Abschnitt 7)

## 4. Spacing

4px-Basis, `--space-0` bis `--space-16` (0/4/8/12/16/20/24/32/40/48/64px).
Neue zentrale Komponenten nutzen ausschließlich diese Skala für Padding und
Gaps. Bestehende Seiten wurden **nicht** rückwirkend migriert (siehe
`UI_MIGRATION_PLAN.md`).

## 5. Radien

| Token | Wert | Verwendung |
|---|---|---|
| `--radius-sm` | 8px | kleine Controls, Checkbox |
| `--radius-md` | 10px | Buttons, Inputs |
| `--radius-lg` | 16px | Cards |
| `--radius-xl` | 20px | Dialoge, größere Glass-Flächen |
| `--radius-full` | 999px | Chips, Avatare, Statuspunkte |

## 6. Schatten

| Token | Verwendung |
|---|---|
| `--shadow-sm` | bereits seit Sprint 0 vorhanden — leichte Karten |
| `--shadow-md` | angehobene Karten, Hover-Zustand |
| `--shadow-lg` | Toasts, hervorgehobene Flächen |
| `--shadow-overlay` | Dialoge |
| `--shadow-focus` | Fokus-Ring (ersetzt `box-shadow`, wird nicht mit anderen Schatten kombiniert) |

Regeln: normale Inhaltskarten (`Card` default) haben **keinen** Schatten,
nur Border — `raised`/`interactive` bekommt `--shadow-sm`/`-md`. Dialoge
dürfen stärker hervortreten (`--shadow-overlay`). Kein Element kombiniert
mehr als einen Schatten-Token gleichzeitig.

## 7. Z-Index

`--z-base` (0) · `--z-sticky` (20) · `--z-dropdown` (30) · `--z-popover` (40)
· `--z-overlay` (90) · `--z-dialog` (200) · `--z-toast` (220) ·
`--z-tooltip` (230). Keine neuen `z-index: 9999`-artigen Werte.

## 8. Motion

`--duration-fast` (130ms, Hover/Buttons) · `--duration-normal` (170ms,
Navigation/Tabs) · `--duration-slow` (200ms, Dialoge/Toasts) ·
`--ease-standard` / `--ease-enter` / `--ease-exit`.

`@media (prefers-reduced-motion: reduce)` setzt die Dauer-Tokens global auf
`0ms` (`tokens.css`) und deaktiviert zusätzlich die Keyframe-Animationen in
Dialog/Toast/Button-Spinner einzeln (verkürzte Spinner-Dauer statt Stillstand,
damit Ladezustände weiter erkennbar bleiben). Keine dauerhaft pulsierenden
Elemente, keine großen Verschiebungen, keine skalierenden Dialoganimationen.

## 9. Typografie

**Inter** wird über `next/font/google` geladen (`app/layout.tsx`, Variable
`--font-inter`) — kein externer Runtime-Font-Request, kein sichtbarer
Font-Swap (`display: "swap"` plus lokal gehostet). JetBrains Mono für die
wenigen Monospace-Stellen (`--font-mono-loaded`). `foundation.css` verweist
über `var(--font-inter, Inter)` mit System-Fallback.

Skala: `--font-size-xs` (11px) bis `--font-size-4xl` (34px). Gewichte:
`--font-weight-regular` (400) / `-medium` (550) / `-semibold` (650) /
`-bold` (760) — an die im Bestand bereits verwendeten Zwischenwerte
angelehnt, nicht die üblichen 400/500/600/700, um bestehende Feinabstimmung
nicht zu brechen. Zeilenhöhen: `--line-height-tight` (1.15) / `-normal`
(1.4) / `-relaxed` (1.6).

Semantische Rollen (über Komponenten, nicht globale Klassen):
`PageHeader`-Titel = `--font-size-3xl`/`-bold`, `Card`-Titel =
`--font-size-lg`/`-semibold`, `MetricCard`-Wert = `--font-size-3xl` mit
`font-variant-numeric: tabular-nums` (Utility-Klasse `.tabular-nums`).

Globale `h1`–`h3` (`foundation.css`) erhalten eine zurückhaltende Baseline
(Größe/Gewicht/Line-Height), damit rohe Überschriften ohne eigene
Komponente nicht ungestylt bleiben — bestehende Spezialkomponenten mit
eigener Größe überschreiben das lokal weiter unverändert.

## 10. Accessibility-Regeln

- Sichtbarer Fokus-Ring (`--shadow-focus`) auf allen neuen interaktiven
  Elementen; globale `:focus-visible`-Baseline in `foundation.css` für
  Elemente ohne eigene Definition.
- `Button`: `type="button"` als Default, Loading-State setzt `aria-busy`
  und `disabled` (verhindert Doppelklick), Label bleibt für Screenreader im
  DOM (nur visuell ausgeblendet). `size="icon"` verlangt `aria-label` —
  fehlt es, meldet die Komponente das in der Entwicklungskonsole.
- `Card` mit `variant="interactive"` + `onClick`: automatisch `role="button"`,
  `tabIndex={0}`, Enter/Leertaste lösen den Klick aus (kein doppeltes
  Klickziel durch verschachtelte interaktive Elemente).
- `GlassDialog`: Portal, `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby`/`aria-describedby`, Focus-Trap (Tab zyklisch im
  Dialog), initialer Fokus auf `[data-autofocus]` oder erstes fokussierbares
  Element, Fokus-Rückgabe an den Auslöser beim Schließen, Scroll-Lock,
  Escape schließt (abschaltbar), Backdrop-Klick schließt (abschaltbar),
  Reduced-Motion-safe.
- `ConfirmDialog`: destruktive Aktion wird **nie** automatisch fokussiert —
  `autoFocus` gehört auf die sichere Standardaktion (siehe Beispiele in
  Abschnitt 13).
- `StatusBadge`/`InlineStatus`: Status wird nie nur über Farbe vermittelt,
  Text/Icon ist Pflicht. `InlineStatus` nutzt `role="alert"` für
  warning/danger, sonst `role="status"` (höflich, unterbricht nicht).
- `Toast`-Viewport: `aria-live="polite"`, Fehler-Toasts zusätzlich
  `role="alert"`.
- Formfelder (`Field`): `label` über `htmlFor`/`id` verbunden,
  Fehler/Beschreibung über `aria-describedby`, `aria-invalid` bei Fehler.
- Touch-Ziele: `Button`/`Input`/`Select`/`Checkbox` mindestens 40×40px
  Mindesthöhe (`--space-10`).

Diese Liste beschreibt geprüftes Verhalten der **neuen** Komponenten — sie
ist keine Aussage über die Restanwendung. Bestehende, nicht migrierte
Seiten behalten ihren bisherigen (bekannten, in `FRONTEND_AUDIT_STATUS.md`
dokumentierten) Accessibility-Stand.

## 11. Glass-Regeln

Glass-Effekte (`backdrop-filter: blur(...)`) sind **gezielt** einzusetzen:

**Erlaubt:** Sidebar (bereits vor Sprint 1 vorhanden), `GlassDialog`,
`Card--glass` (punktuell, z.B. schwebende Zusatzinfo), `Toast`
(kompaktes Overlay-Element).

**Nicht verwenden für:** Tabellenzellen, große Inhaltsflächen, lange
Listen, komplette Seitenhintergründe, dicht befüllte Grid-Bereiche (z.B.
AG-Grid-Zellen im Dienstplan-Editor — unverändert).

Ausführung bewusst zurückhaltend: ein `blur()`-Wert, ein Border
(`--color-border-subtle`), ein Schatten — keine mehrfachen Glow-Ringe, kein
transparenter Textbereich (Text liegt auf einer ausreichend deckenden
Fläche, `color-mix(... 78–92% ...)`, nicht auf reinem Glas).

## 12. Komponentenübersicht

Alle in `frontend/components/ui/` (Barrel-Export: `components/ui/index.ts`).

| Komponente | Zweck | Varianten/Props (Auszug) |
|---|---|---|
| `Button` | Aktionen, auch als Link (`href`) | `variant`: primary/secondary/ghost/danger/outline · `size`: sm/md/lg/icon · `loading` |
| `Card` (+Header/Title/Description/Content/Footer) | Inhaltscontainer | `variant`: default/raised/interactive/glass |
| `MetricCard` | Kennzahl-Kachel | Titel, Wert, Einheit, Veränderung, Status, Aktion |
| `StatusBadge` | Kompaktes Statuslabel | `variant`: neutral/info/success/warning/danger/accent, `dot`, `icon` |
| `PageHeader` | Seitenkopf | Eyebrow, Titel, Subtitle, Context, primäre/sekundäre Aktionen, Status |
| `EmptyState` | Leerer/gefilterter/Fehler-/Berechtigungszustand | `variant`: empty/filtered/error/permission |
| `InlineStatus` | Kleine Rückmeldung im Formular/Abschnitt | `variant`: info/success/warning/danger/loading |
| `SegmentedControl` | Wenige exklusive Ansichten | `aria-pressed`, Pfeiltasten-Navigation |
| `GlassDialog` (+Header/Title/Description/Body/Footer) | Dialog-Basis | `size`: sm/md/lg/xl/fullscreen-mobile |
| `ConfirmDialog` | Bestätigungsdialog auf GlassDialog-Basis | `variant`: default/warning/danger, `actions[]` |
| `ToastProvider`/`useToast` | Globales Toast-System | `variant`: success/info/warning/error/loading |
| `Field`/`FieldLabel`/`FieldDescription`/`FieldError` | Formular-Feldwrapper | Label-/Fehler-Verknüpfung |
| `Input`/`Select`/`Checkbox` | Grundlegende Formularelemente | Konsistente Höhe/Fokus/Fehlerdarstellung |

## 13. Verwendungsbeispiele

```tsx
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

function DeleteEmployeeButton({ employee, onDeleted }: Props) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    setDeleting(true);
    try {
      await deletePerson(employee.id);
      toast({ variant: "success", title: `${employee.name} wurde gelöscht` });
      setConfirmOpen(false);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setConfirmOpen(true)}>
        Löschen
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        variant="danger"
        title={`${employee.name} löschen?`}
        description={<p>Die Person wird aus der Teamverwaltung entfernt. Historische Dienstpläne bleiben erhalten.</p>}
        onDismiss={() => !deleting && setConfirmOpen(false)}
        actions={[
          { label: "Abbrechen", variant: "default", autoFocus: true, disabled: deleting, onClick: () => setConfirmOpen(false) },
          { label: deleting ? "Löscht …" : "Endgültig löschen", variant: "danger", disabled: deleting, onClick: confirmDelete },
        ]}
      />
    </>
  );
}
```

Fachliches Status-Mapping bleibt außerhalb der UI-Komponente:

```tsx
const employeeStatusToBadgeVariant = {
  active: "success",
  inactive: "neutral",
} as const;

<StatusBadge variant={employeeStatusToBadgeVariant[employee.status]}>
  {employee.status === "active" ? "Aktiv" : "Inaktiv"}
</StatusBadge>
```

## 14. Do/Don't

| Do | Don't |
|---|---|
| `variant="danger"` nur für zerstörerische Aktionen | `variant="danger"` für neutrale Sekundäraktionen |
| Konkrete Konsequenz im `ConfirmDialog` beschreiben ("Die Person wird aus der Teamverwaltung entfernt…") | Generisches "Möchtest du fortfahren?" |
| `autoFocus` auf die sichere Standardaktion (meist Abbrechen) | `autoFocus` auf die destruktive Aktion |
| Toast für "erfolgreich gespeichert/gelöscht", Hintergrundaktionen | Toast für Validierungsfehler, die am Formular sichtbar sein müssen |
| `InlineStatus` für formularbezogenes/Abschnitts-Feedback | Ein weiteres eigenes `{kind, text}`-State-Objekt pro Seite |
| Ein `Card`-Klick = ein Klickziel (`variant="interactive"` + `onClick`) | Button *innerhalb* einer klickbaren Card mit eigenem, kollidierendem Klickziel |
| `--color-*`/`--space-*`/... Tokens verwenden | Neue Hex-Werte oder Pixelwerte frei erfinden |
| Glass gezielt (Dialog/Sidebar/Toast/Popover) | Glass über Tabellenzellen, lange Listen, ganze Seiten |

## 15. Feedbackstrategie (siehe auch `UI_MIGRATION_PLAN.md`)

| Situation | Komponente |
|---|---|
| Erfolgreich gespeichert/gelöscht, Export gestartet, nicht-blockierende globale Meldung | `Toast` |
| Validierungsfehler, Ladefehler in einem Abschnitt, Verbindungsstatus, Auto-Save-Status | `InlineStatus` |
| Irreversible Aktion, Verwerfen ungespeicherter Änderungen, riskante Überschreibung, Löschen | `ConfirmDialog` |
| Konkreter Eingabefehler an einem Feld | `Field`/`FieldError` |

## 16. Bekannte Einschränkungen (Sprint 1)

- `--color-text-subtle`/`color-mix`-basierte Tokens wurden nicht gegen alle
  Kombinationen automatisiert auf WCAG-Kontrast geprüft (manuell in den
  migrierten Bereichen visuell verifiziert, siehe `SPRINT_1_RESULT.md`).
  Keine pauschale WCAG-Konformitätsaussage.
- Breakpoints sind (noch) nicht als eigene Tokens formalisiert (CSS Custom
  Properties funktionieren nicht in `@media`-Queries) — neue Komponenten
  nutzen einheitlich 640px/768px/1024px/1280px als Konvention.
- Reduced-Motion wurde manuell in Chromium getestet (`prefers-reduced-motion:
  reduce` per DevTools-Emulation), nicht automatisiert.
