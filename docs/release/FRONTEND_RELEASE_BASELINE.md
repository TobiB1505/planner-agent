# Frontend Release-Baseline (Sprint 5, Phase 1)

Erhoben am tatsächlichen Repository-Stand nach Abschluss von Sprint 4
(Status: READY FOR SPRINT 5, keine offenen bekannten Risiken aus dem
Gate; die fünf „Offene Probleme" aus `SPRINT_4_RESULT.md` §12 werden in
diesem Sprint erneut bewertet).

## 1. Technischer Zustand

| Bereich | Stand |
|---|---|
| Next.js | 16.2.12 (App Router, Turbopack-Build) |
| React / React-DOM | 19.2.4 |
| TypeScript | 5.9.3 (strict) |
| AG Grid | ag-grid-community + ag-grid-react 36.0.2 |
| Styling | Tailwind CSS 4 (nur Utilities in Alt-Wrappern) + eigenes Token-/`ui-`-System |
| Build-System | `next build` (Turbopack); kein eigener Bundler |
| Tests | Vitest 4 + Testing Library, **9 Testdateien / 62 Tests** (ui-Primitives, Plan-Editor-Hooks/-Helpers, Datum/Fokus-Reload) |
| Lint | ESLint 9 flat config (`eslint.config.mjs`) mit eslint-config-next 16 + React-Hooks-Regeln (inkl. `set-state-in-effect`) |
| Error Boundaries | **keine** – weder `error.tsx` noch `global-error.tsx` vorhanden |
| `loading.tsx` | keine (Ladezustände sind clientseitig pro Seite gelöst) |
| `error.tsx` | keine |
| `not-found.tsx` | keine (unbekannte URLs → unformatierte Next-Standardseite) |
| Dynamische Imports | keine (`next/dynamic` ungenutzt; Routen-Splitting übernimmt der App Router) |
| Globale Provider | `ToastProvider`, `InternalNavigationGuard`, `Sidebar` (in `app/layout.tsx`); `template.tsx` für Routen-Übergang |
| Globale CSS | 17 Dateien unter `app/styles/` + `globals.css` (Token-/Foundation-/Seiten-Dateien), alle im Root-Layout importiert |
| Sonstiges | `/` → Redirect auf `/dashboard`; PWA-Manifest + Icons; API-Zugriff zentral über `lib/api.ts` (fetch + AbortController-Unterstützung) |

### Bundle-Kennzahlen (Production-Build, unkomprimiert)

- `.next/static` gesamt: **3,7 MB** (Chunks 3,4 MB)
- Zwei Chunks à **1,1 MB**: AG Grid, **doppelt gebündelt** – je einmal
  für `/plan-editor` und `/artist-plan` (Turbopack teilt den
  Paket-Chunk nicht zwischen den beiden Routen). Zur Laufzeit lädt jede
  Route nur ihre Kopie; wer beide Seiten besucht, lädt AG Grid zweimal.
- Größte weitere Chunks: 224 KB, 148 KB, 124 KB, 112 KB (Framework/
  gemeinsame Module); CSS gebündelt ~112 KB.

## 2. UI-Zustand der Kernseiten

Bewertung zum Baseline-Zeitpunkt (vor den Sprint-5-Prüfphasen; Spalten
A11y/Responsive spiegeln den Prüfstand aus Sprint 4, nicht das Ergebnis
des kommenden Audits):

| Seite | Status | Anmerkung |
|---|---|---|
| Dashboard | READY | Sprint-4-Konsolidierung + Stil-Restaurierung; alle Checks grün |
| Dienstplan (Editor) | READY, HAS_PERFORMANCE_RISK | AG-Grid-Chunk 1,1 MB (dokumentiert); Funktionalität Sprint 2/3 gehärtet |
| Team | READY | Auto-Save-Modell verifiziert |
| MA-Gedächtnis | READY | Mobile Liste/Detail in Phase 3 gezielt nachprüfen |
| Künstlerplan | READY, HAS_PERFORMANCE_RISK | zweite AG-Grid-Kopie |
| Probenplan | NEEDS_POLISH | keine Testdaten in der lokalen DB → Regressionspfad bisher nur teilweise live geprüft |
| Archiv | READY | – |
| Planungslogik | READY | – |
| System | READY | – |

Alle Seiten teilen zum Baseline-Zeitpunkt zwei strukturelle Lücken
(nicht seitenspezifisch): fehlende Error-Boundaries/404 (siehe Blocker
B1) und der noch ausstehende systematische A11y-/Zoom-Durchlauf.

## 3. Bestandsaufnahme vor Änderungen

**1. Echte Blocker (Release-Blocker-Kandidaten):**

- **B1 – Keine Error Boundary im gesamten App Router.** Ein
  Renderfehler auf einer Seite führt zum weißen Screen der ganzen App;
  unbekannte URLs zeigen die englische Next-Standard-404. Verstößt
  direkt gegen Phase-18-Kriterium „Seiten crashen". → wird in diesem
  Sprint behoben (error.tsx, global-error.tsx, not-found.tsx).

**2. Nur Feinschliff nötig:**

- Skeleton-Shimmer (Dashboard) läuft bei `prefers-reduced-motion`
  weiter (S4 §12.2) – kleiner CSS-Fix.
- Probenplan: Testdatensatz ergänzen, damit die Regressionsstrecke
  (Laden/Bearbeiten/Dirty/Speichern) real durchlaufen werden kann.
- Restliche `.btn`-Ad-hoc-Buttons/Statusfarb-Literale: kosmetisch,
  kein Nutzerschaden; nur dort anfassen, wo ohnehin gearbeitet wird.

**3. Technische Risiken:**

- AG Grid doppelt in zwei Routen-Bundles (siehe oben) – kein
  Funktionsrisiko, aber unnötiger Download beim Besuch beider Seiten.
- Kein `not-found`/`error`-Handling (siehe B1).
- Kein automatisierter E2E-/Visual-Regressionsschutz – die
  Playwright-Szenarien aus Sprint 3/4 sind reproduzierbar, aber nicht
  als Suite versioniert.

**4. Offene Performance-Hotspots:**

- AG-Grid-Bundle (größter Posten, dokumentiert; Chunk-Sharing zwischen
  zwei Routen wäre ein Build-Konfigurationsexperiment, kein sicherer
  kleiner Fix).
- Sonst keine bekannten: Polling ist sichtbarkeitsgebunden, Requests
  laufen über AbortController-fähige Helfer, Listen sind begrenzt.

**5. Nach Sprint 4 weiterhin offene Auditpunkte:**

- Vollständiger Screenreader-/Axe-Durchlauf (nie durchgeführt –
  Sprint-5-Phase 2).
- Kontrastnachweis der Status-/Kategoriefarben (Phase 2.6).
- Visuelle Regression als wiederholbares Set (Phase 12/19 dokumentiert
  die Szenarien; echte Snapshot-Suite bleibt Folgearbeit).
- Fehlergrenzen (B1) und Produktion-Runtime-Smoke (Phase 14).
