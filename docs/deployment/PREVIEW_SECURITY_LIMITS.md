# Preview-Sicherheitsgrenzen

Diese Preview-Umgebung ist eine **zeitlich begrenzte technische
Testumgebung**, kein produktionsreifes System. Dieses Dokument fasst
zusammen, warum, und was vor einer echten Production-Freigabe fehlt. Siehe
auch `docs/deployment/DEPLOYMENT_CHECKLIST.md` (Sprint 1) - dieses Dokument
ergänzt sie um die preview-spezifischen Aspekte von Render + Vercel
Deployment Protection.

## Kernaussagen

1. **Keine Anwendungs-Authentifizierung.** Jeder mit Zugriff auf die
   Vercel-Preview-Domain (nach erfolgreicher Vercel-Authentication, siehe
   unten) sieht dieselbe, ungeschützte API - keine Benutzerkonten, keine
   Sitzungen, keine Rollen innerhalb der Anwendung selbst.
2. **Das Backend ist grundsätzlich erreichbar.** Vercel Deployment
   Protection schützt **ausschließlich das Frontend**. Die Render-Backend-URL
   ist eine normale, öffentlich erreichbare HTTPS-Adresse - Vercels
   serverseitiger Rewrite muss sie erreichen können, ein rein privates
   Render-Networking (das Vercel ausschließen würde) ist damit nicht
   vereinbar. Jeder, der die Render-URL errät oder anderweitig erfährt
   (Logs, Browser-Netzwerk-Tab eines berechtigten Nutzers, Referer-Header
   o.ä.), kann die API direkt ansprechen - **ohne** die
   Vercel-Authentication zu durchlaufen.
3. **Eine schwer erratbare URL ist kein Sicherheitsmechanismus** - Render
   vergibt vorhersehbare Subdomains-Muster, und die URL kann auf vielen
   Wegen durchsickern (Build-Logs, Browser-DevTools, Screenshots,
   Weitergabe im Team). Sie wird hier nicht als Schutz behandelt, nur als
   Adressierung.
4. **CORS ist kein Zugriffsschutz.** `CORS_ORIGINS` verhindert lediglich,
   dass *browserbasierter* Code von anderen Origins aus Anfragen stellen
   kann - ein direkter Aufruf per `curl`/Skript/anderem Server ist davon
   komplett unberührt. Es wird trotzdem konkret gesetzt (siehe
   `PREVIEW_DEPLOYMENT.md`), aber nicht als Sicherheitsgrenze missverstanden.
5. **Keine belastbare Backend-Sperre ohne App-Authentifizierung möglich**
   mit den in diesem Sprint erlaubten Mitteln (keine Ad-hoc-Authentifizierung
   erlaubt, siehe Sicherheitsregeln des Arbeitspakets). Konsequenz: **nur
   synthetische Daten verwenden**, Preview zeitlich begrenzt betreiben
   (siehe Abschaltstrategie unten), destruktive Tests ausschließlich mit
   synthetischen Daten.
6. **Ausführliche Systemdiagnose bleibt unauthentifiziert erreichbar**
   (`GET /api/system/diagnostics`) - liefert Host/Port, CORS-Konfiguration,
   Template-Status und Plattenplatz. Wird hier nicht öffentlich mit echten
   Werten dokumentiert (siehe unten, Platzhalter-Pflicht) und sollte nicht
   unnötig verlinkt/geteilt werden.

## Keine Live-Daten - verbindlich

- Keine Kopie von `local_data/database/dienstplaene.db`,
  `local_data/archives/`, `local_data/uploads/`, `local_data/exports/`,
  `local_data/backups/` in die Preview hochladen.
- Die Preview-Datenbank entsteht ausschließlich durch den normalen
  Backend-Startprozess (Schema-Migration beim ersten Start, siehe
  `backend/db.py: initialize_database()`), leer.
- Erlaubt: leere Datenbank, synthetische Testpersonen, anonymisierte
  Testpläne, ausdrücklich für Tests erzeugte Beispieldaten (siehe
  `docs/deployment/PREVIEW_SMOKE_TEST.md`).
- Falls ein `GEMINI_API_KEY` für den PDF-Import-Test gesetzt wird: **nur**
  mit synthetischen PDF-Inhalten testen, nie mit echten Mitarbeiterdaten -
  hochgeladene Inhalte werden bei gesetztem Key an die Google-Gemini-API
  übertragen (siehe `docs/deployment/DEPLOYMENT_CHECKLIST.md`, Sprint 1).

## Notwendige Maßnahmen vor einer echten Production-Freigabe

(unverändert gegenüber Sprint 1, hier zur Vollständigkeit wiederholt, siehe
`docs/deployment/DEPLOYMENT_CHECKLIST.md` für die ausführliche Tabelle)

- App-seitige Authentifizierung und Autorisierung/Rollen.
- Absicherung destruktiver Routen (`DELETE /api/team/{id}`,
  `DELETE /api/weeks/{id}`, `DELETE /api/artist-plans/{id}`,
  `DELETE /api/rehearsal-plans/{id}`, `POST /api/system/restart`) gegen
  unautorisierten Zugriff - aktuell nur durch `SYSTEM_RESTART_ENABLED=0`
  für den Restart-Fall entschärft, nicht durch echte Autorisierung.
- Netzwerkseitiger oder anwendungsseitiger Schutz des Backends selbst
  (nicht nur des Frontends) - z.B. ein Auth-Layer, den auch direkte
  Backend-Aufrufe durchlaufen müssen.
- Upload-Limits (Dateigröße/-typ) für `/api/upload/*`, `/api/artist-plans/upload/*`,
  `/api/rehearsal-plans/upload/*` - in diesem Sprint nicht geprüft/verändert.
- Sichere Secret-Übergabe über den gesamten Pfad (nicht nur Render-Dashboard,
  auch der optionale `api_key`-Query-Parameter bei `uploadPdf`, siehe
  `docs/deployment/DEPLOYMENT_CHECKLIST.md`).
- Datenschutzrechtliche Klärung der Gemini-Verarbeitung, bevor echte
  Personendaten je ein produktives System mit KI-Import erreichen.
- PostgreSQL-Migration und horizontale Skalierung, falls Mehrinstanz-Betrieb
  nötig wird (SQLite bleibt bewusst auf eine Instanz beschränkt).

## Preview-Abschaltstrategie

Da keine App-Authentifizierung existiert, ist die Preview **kontrolliert zu
betreiben** - nicht unbegrenzt laufen lassen.

### Vercel-Preview pausieren/trennen

- Deployment Protection bleibt dauerhaft aktiv, solange das Projekt
  existiert (siehe `PREVIEW_DEPLOYMENT.md`) - das allein reduziert das
  Frontend-Risiko bereits während des Betriebs.
- Zum vollständigen Stilllegen: Vercel-Dashboard → Projekt → Settings →
  Git → Branch-Verknüpfung zu `feature/deployment-readiness` entfernen
  (verhindert neue Preview-Deployments), bestehende Preview-Deployments
  über Vercel-Dashboard → Deployments → einzeln löschen, oder das gesamte
  Projekt löschen, falls es nicht weiterverwendet wird.

### Render-Service pausieren/löschen

- Render-Dashboard → Service → Settings → Suspend Web Service (pausiert,
  ohne den Service inkl. Konfiguration zu löschen) für eine temporäre Pause.
- Für die endgültige Stilllegung: Render-Dashboard → Service → Settings →
  Delete Web Service. Das persistente Disk-Volume separat prüfen (siehe
  unten) - ein gelöschter Service lässt ein verwaistes Volume ggf. bestehen,
  abhängig vom Render-Löschverhalten zum Zeitpunkt der Durchführung; im
  Render-Dashboard unter Disks verifizieren.

### Synthetische Preview-Datenbank löschen

- Mit dem Löschen/Kündigen des persistenten Disk-Volumes (siehe Render:
  Disks → Delete Disk) ist die SQLite-Datei mit gelöscht - da ausschließlich
  synthetische Daten verwendet wurden (siehe oben), ist kein gesondertes
  Datenschutz-Löschverfahren nötig.
- Falls das Volume für eine spätere Preview weiterverwendet werden soll:
  vor der nächsten Nutzung explizit prüfen/entscheiden, ob die
  Restdaten aus dem vorherigen Testlauf weiterhin akzeptabel sind
  (sie sollten es sein, da synthetisch - trotzdem als Checkpunkt notieren).

### Secrets, die danach rotiert werden müssen

- `GEMINI_API_KEY`, falls für den Preview-Import gesetzt - nach Abschalten
  der Preview im Google-Cloud/AI-Studio-Dashboard rotieren bzw. den
  Preview-spezifischen Key widerrufen, nicht denselben Key unverändert für
  eine nächste Umgebung weiterverwenden.
- Keine weiteren Secrets sind für dieses Arbeitspaket vorgesehen (kein
  `CORS_ORIGINS`-Wert ist ein Secret, `BACKEND_INTERNAL_URL` ist eine URL,
  kein Zugangs-Token).

### Persistente Disks: bewusst behalten oder löschen

- **Löschen**, wenn die Preview endgültig beendet wird (Standardfall,
  siehe oben - nur synthetische Daten, kein Aufbewahrungsgrund).
- **Behalten**, nur falls eine unmittelbar folgende weitere Preview-Runde
  mit denselben synthetischen Testdaten geplant ist - dann explizit im
  Team kommunizieren, dass das Volume weiterhin Kosten verursacht (siehe
  Abschlussbericht, Kosten-/Betriebsannahmen) und wieder mit einem
  konkreten Enddatum versehen.

## Hinweis zu diesem Dokument

Keine echten Domains, Tokens, IDs oder personenbezogenen Daten in diesem
Dokument (Repository ist ggf. öffentlich einsehbar) - ausschließlich
Platzhalter wie `<render-backend-domain>`/`<vercel-preview-domain>`.
