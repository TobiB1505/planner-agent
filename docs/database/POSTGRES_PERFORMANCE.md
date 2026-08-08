# Performance vorher/nachher (SQLite → PostgreSQL)

Sprint-Punkt 27. Ziel ist ausdrücklich **keine Mikrooptimierung**, sondern der
Nachweis, dass keine offensichtliche Regression entsteht - und, wo eine
Verschiebung messbar ist, deren ehrliche Einordnung.

## Messaufbau

Dasselbe Benchmark-Skript lief unverändert gegen beide Codestände. Möglich ist
das, weil sich die `db.*`-API in der Migration nicht geändert hat.

| | |
| --- | --- |
| Vorher | Git-Stand `b97f544` (SQLite, WAL) in einem separaten Worktree |
| Nachher | Migrationsstand, PostgreSQL 16 auf `127.0.0.1` (localhost, kein Netzwerk) |
| Datenmenge | 25 Personen, 20 Wochen, 840 Zuweisungen, 140 Abwesenheiten, 60 Proben mit je 9 Teilnehmern |
| Wiederholungen | 7 pro Operation, ausgewiesen ist der **Median** |
| Python | 3.11 |

Gemessen wurde direkt auf der Datenbankschicht (ohne HTTP), damit die Zahlen
die Persistenz zeigen und nicht den Webserver.

## Ergebnisse (Median, Millisekunden)

| Operation | SQLite | PostgreSQL | Faktor |
| --- | ---: | ---: | ---: |
| Team Overview (`build_team_overview`) | 35,15 | 77,52 | 2,2× |
| `build_memory` | 31,37 | 34,01 | 1,1× |
| Plan Quality (`calculate_plan_quality`) | 32,69 | 43,81 | 1,3× |
| Plan Load (Woche + Archivliste) | 0,12 | 1,34 | 11× |
| Plan Save (42 Zuweisungen + Commit) | 0,62 | 5,42 | 8,7× |
| `previous_week_workload` | 0,42 | 1,39 | 3,3× |
| Alias Lookup, 200 Einzelabfragen | 1,26 | 38,75 | 31× |

## Einordnung

**Die Faktoren sind erwartbar und haben genau eine Ursache: Roundtrips.**
SQLite läuft im selben Prozess - eine Anweisung kostet einen Funktionsaufruf.
PostgreSQL ist ein Serverdienst - jede Anweisung kostet einen Roundtrip über
einen Socket. Lokal sind das ~0,1 ms pro Anweisung.

Damit erklären sich alle Zeilen:

* **Alias Lookup (31×)** ist der Extremfall: 200 Aufrufe × bis zu 2 Abfragen =
  bis zu 400 Roundtrips, die vorher praktisch nichts kosteten. Absolut sind es
  weiterhin 0,19 ms pro Auflösung.
* **Plan Save (8,7×)** sind 43 Anweisungen plus ein Commit. PostgreSQL macht
  beim Commit einen echten fsync.
* **Operationen, die ohnehin rechenlastig sind** (`build_memory` mit 1,1×,
  Plan Quality mit 1,3×) verschieben sich kaum - dort dominiert Python-Rechenzeit,
  nicht die Datenbank.
* **Team Overview (2,2×)** liegt dazwischen: `build_memory` einmal plus
  Statistik je Person, jeweils mit eigenem Cache-Zugriff und Commit.

**Absolut bleibt alles im unkritischen Bereich.** Die langsamste gemessene
Operation ist Team Overview mit 78 ms. Für eine Web-Anwendung mit einem
einzelnen Planer als Nutzer ist das nicht spürbar.

### Warum die N+1-Vermeidung aus AP5a jetzt noch wichtiger ist

Der Alias-Lookup-Wert ist ein Warnschild, keine akute Regression: die
fachlichen Hot Paths verwenden bereits `db.load_person_lookup()` (AP5a) und
lösen Personen im Speicher auf, statt pro Zeile zu fragen. Das betrifft
`plan_save`, `derive_show_cast` und `_assignment_warnings` - also genau die
Stellen, an denen über viele Zeilen iteriert wird.

Übrig bleibt ein Pfad mit Einzelabfragen: `_resolve_with_choices()` in
`routers/imports.py` fragt beim Import pro Zeile. Bei einem Wochenimport mit
~50 Zeilen sind das ~150 Roundtrips - lokal ~15 ms, über eine WAN-Verbindung
entsprechend mehr. Das ist tolerierbar und wurde bewusst **nicht** umgebaut:
der Sprint verlangt keine Mikrooptimierung, und eine Änderung an der
Import-Auflösung wäre eine fachliche Änderung.

### Wichtige Einschränkung: das sind Localhost-Zahlen

Gemessen wurde gegen PostgreSQL auf `127.0.0.1`. Zwischen Render und Supabase
liegt ein echtes Netzwerk. Liegen beide in derselben Region, kommen typisch
1-3 ms pro Roundtrip dazu; über Kontinente hinweg 80-150 ms.

Bei ~43 Anweisungen für einen Plan Save bedeutet das:

| Szenario | Zusatzlatenz Plan Save (grob) |
| --- | --- |
| gleiche Region | +50 – 130 ms |
| anderer Kontinent | +3,4 – 6,5 s |

**Daraus folgt die einzige harte Empfehlung dieses Dokuments: Render-Region und
Supabase-Region müssen zusammenpassen** (siehe `SUPABASE_SETUP.md`, Schritt 2).
Das ist keine Optimierung, sondern eine Betriebsvoraussetzung.

## Fazit

* Keine Operation ist absolut langsam geworden (Maximum 78 ms).
* Die relativen Faktoren stammen durchgehend aus Client/Server-Roundtrips und
  nicht aus schlechteren Abfragen oder fehlenden Indizes - alle Indizes des
  SQLite-Schemas wurden übernommen, die beiden `COLLATE NOCASE`-Indizes als
  funktionale `planner_nocase()`-Indizes, plus zwei zusätzliche für die
  case-insensitive Probenteilnehmer-Suche, die unter SQLite ohne Index lief.
* Es besteht kein Handlungsbedarf in diesem Sprint.
* Offener Betriebspunkt: Regionswahl (siehe oben) - im Abschlussbericht unter
  „Risiken" geführt.

## Reproduktion

Das Benchmark-Skript liegt bewusst nicht im Repository (es ist ein einmaliges
Messwerkzeug, kein Test). Der Aufbau ist oben vollständig beschrieben; die
gemessenen Operationen entsprechen genau den in Sprint-Punkt 27 geforderten:
Team Overview, Plan Load, Plan Save, `build_memory`, Alias Lookup, Plan Quality.
