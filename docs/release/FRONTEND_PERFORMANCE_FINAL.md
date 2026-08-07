# Frontend-Performance – Abschlussanalyse (Sprint 5)

Gemessen am Production-Build (`next build` + `next start`, Chromium via
Playwright, lokales Backend). Vergleichsbasis: Audit-/Sprint-2-Stand
(`EDITOR_PERFORMANCE_REPORT.md`) und die Sprint-4-Request-Arbeit.

## 1. Bundle

**Gesamt:** `.next/static` 3,7 MB unkomprimiert (Chunks 3,4 MB), CSS
gebündelt ~221 KB (Transfer).

**Initiale Last pro Seite** (bis zum `load`-Event, unkomprimiert):

- Dashboard (repräsentativ für alle Nicht-Grid-Seiten): **~560 KB JS**
  über 11 Dateien - Framework-Chunks 227 + 148 KB, Rest Seiten-/
  Shared-Code. Keine AG-Grid-Bytes im initialen Pfad.
- Editor/Künstlerplan zusätzlich: ihr AG-Grid-Chunk (~1,07 MB).

**Nach dem `load`-Event** prefetcht der App Router die per Sidebar
verlinkten Routen (Next-Standardverhalten): dadurch werden im Leerlauf
insgesamt ~3,2 MB geladen - darunter **beide** AG-Grid-Kopien.

**Befund AG-Grid-Duplikat (aus der Baseline bestätigt):** Turbopack
bündelt ag-grid-community je einmal für `/plan-editor` und
`/artist-plan` (2 × 1,07 MB). Zur Laufzeit lädt jede Route nur ihre
Kopie; der Doppel-Download entsteht durch das Idle-Prefetch bzw. beim
Besuch beider Seiten. Bewertung: kein Nutzerspürbarer Schaden (Prefetch
läuft nach Interaktivität, lokaler Server, HTTP-Cache), aber unnötiges
Volumen. Ein Chunk-Sharing-Experiment (Build-Konfiguration) ist bewusst
nicht Teil dieses Sprints (Regel: keine ungemessenen/riskanten
Optimierungen im Release-Sprint) - als Folgearbeit dokumentiert.

**Dependencies:** package.json ist minimal (AG Grid, Next, React; dev:
Tailwind 4, Vitest, ESLint). Keine ungenutzten, doppelten oder toten
Pakete; keine Icon-/Date-Libraries (Intl nativ).

## 2. Dynamische Imports

Keine vorhanden und keine ergänzt: Das Routen-Splitting des App Routers
trennt die AG-Grid-Seiten bereits von allen anderen; die großen Dialoge
(EmployeeIntelligenceDialog, ArchiveImportFlow, PersonCellEditor)
liegen in den jeweiligen Routen-Chunks (gemessen: Dashboard lädt initial
kein Grid). Ein zusätzliches `next/dynamic` würde Kerninteraktionen
(Zelleditor!) verzögern, ohne die initiale Last messbar zu senken.

## 3. Rendering

Unverändert gegenüber Sprint 2/3 (referentiell stabile Grid-Props,
gezielte Refreshes, `useSyncExternalStore`-Stores, begrenzte Listen:
Workload 7+, Archiv-Detail 120+, Audit 4). Keine neuen Hotspots
gemessen; React-Profiler-Tiefenanalyse war bei sauberem Laufzeitbild
nicht angezeigt.

## 4. Requests

Production-Messung pro Seite (Erstladen):

| Seite | API-Requests | Duplikate |
|---|---|---|
| Dashboard | 3 (weeks, insights, fairness) | keine |
| Editor | 7 (Referenzdaten + Wochenladung) | keine |
| Team/Gedächtnis | 2 | keine |
| übrige | 1–3 | keine |

- AbortController-Pfade (Sprint 2) unverändert aktiv; Wochenwechsel
  bricht Vorgänger-Ladungen ab.
- Polling existiert nur auf /system (5 s), ist seit Sprint 4
  sichtbarkeitsgebunden (gemessen: 0 Requests bei verstecktem Tab,
  sofortige Prüfung bei Rückkehr).
- Keine Request-Storms, keine Requests nach Unmount beobachtet
  (`active`-Flags/Abbrüche in allen Lade-Effekten).

## 5. CSS

- 18 Dateien, ~276 KB Quelltext, gebündelt ~221 KB Transfer.
- `!important`: 5 Vorkommen (nur planning-workflow.css, AG-Grid-
  Überschreibungen) - unauffällig.
- **Entfernt in diesem Sprint (nachweislich tot):** der komplette
  `.confirm-dialog*`-Block (seit Sprint 1 ungenutzt, damals bewusst
  stehen gelassen) und `.btn-danger-solid` (0 Verwendungen) aus
  plan-editor.css.
- Blur-/Shadow-Flächen: gezielt (GlassDialog, Karten) - keine
  großflächigen Daueranimationen mehr; Skeleton-Shimmer/Slides ruhen
  seit diesem Sprint unter `prefers-reduced-motion`.

## 6. Console/Runtime (Production)

Alle 9 Kernseiten im Production-Modus: **0 Console-Errors, 0 Warnings,
0 Pageerrors** beim Erstladen (Playwright-Protokoll). Hydration
sauber.

## 7. Vergleich zu früheren Ständen

- Sprint-0-Audit: Dashboard trug 613 Zeilen doppelte Komponenten +
  275 Zeilen Zusatz-CSS - seit Sprint 4 entfernt (netto −943 Zeilen).
- Sprint 2: Editor-Requests dedupliziert/abbrechbar - Bestand bestätigt.
- Sprint 4: Polling sichtbarkeitsgebunden - Bestand bestätigt.
- Neu (Sprint 5): totes CSS entfernt, keine neuen Abhängigkeiten,
  initiale Seitengröße erstmals konkret beziffert (~560 KB JS ohne
  Grid, ~1,6 MB mit Grid, unkomprimiert).

## 8. Verbleibende dokumentierte Hotspots

1. **AG-Grid-Chunk-Duplikat** (siehe §1) - Folgearbeit:
   Chunk-Sharing/`optimizePackageImports`-Experiment außerhalb des
   Release-Sprints.
2. **Idle-Prefetch-Volumen** (~3,2 MB bei unbeschränktem Leerlauf) -
   Standardverhalten, lokal unkritisch; für ein späteres
   Cloud-Deployment ggf. `prefetch={false}` auf den Grid-Routen abwägen.
