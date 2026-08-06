// Sprint 2 (Phase 13.1): zentrale, einmalige AG-Grid-Modulregistrierung.
// Vorher registrierten app/plan-editor/page.tsx und app/artist-plan/page.tsx
// unabhängig voneinander jeweils ModuleRegistry.registerModules([AllCommunityModule])
// (Sprint-0-Audit-Finding C13). Technisch unschädlich (registerModules ist
// idempotent), aber unnötig dupliziert. Beide Seiten nutzen weiterhin die
// volle Community-Edition (AllCommunityModule) - eine Reduktion auf einzelne
// Module wurde geprüft, aber verworfen: beide Grids nutzen eine Vielzahl an
// Features (Zell-Editoren, Undo/Redo, Vollbreiten-Zeilen, Tooltips,
// Zell-Flashing, programmatische Navigation), eine granulare Modulauswahl
// hätte ohne vollständige Testabdeckung jeder einzelnen Funktion ein reales
// Risiko für stillen Funktionsverlust dargestellt - siehe
// docs/editor/EDITOR_ARCHITECTURE.md.
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);
