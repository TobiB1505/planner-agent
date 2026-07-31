"""Planner-Agent - Web-App zum Einlesen, Auswerten und Erstellen von Dienstplänen."""
from __future__ import annotations

import io
import os
import re
import tempfile
from datetime import date, timedelta

import pandas as pd
import streamlit as st
from dotenv import load_dotenv
from streamlit_option_menu import option_menu

import assignment
import db
import grid
import stats
import theme
import util
import xlsx_template
from extraction import extract_dienstplan

load_dotenv()

st.set_page_config(page_title="Planner-Agent", layout="wide", initial_sidebar_state="expanded")
st.markdown(theme.GLOBAL_CSS, unsafe_allow_html=True)
st.markdown(theme.DASHBOARD_CSS, unsafe_allow_html=True)

conn = db.get_conn()

if "extractions" not in st.session_state:
    st.session_state.extractions = {}  # filename -> extracted dict
if "person_choices" not in st.session_state:
    st.session_state.person_choices = {}  # filename -> {raw_name: chosen_person_name_or_NEW}

NEW_PERSON_LABEL = "➕ Neue Person anlegen"
DEPARTMENT_LABEL = "🏷️ Abteilung / kein Individuum"
KNOWN_DEPARTMENT_TOKENS = {
    "S&L", "SPT", "NM", "KÜCHE", "COCINA",
    "TC", "DEKO", "LIVE-ENT", "SPORTSTAINER", "MANAGER", "REQUI",
}


def normalize_name(raw: str) -> str:
    return re.sub(r"\s*\([^)]*\)\s*", "", raw).strip()


def get_api_key() -> str | None:
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    return st.session_state.get("api_key_input") or None


def collect_raw_names(extracted: dict) -> list[str]:
    names = set()
    for a in extracted.get("assignments", []):
        if a.get("person"):
            names.add(a["person"].strip())
    for a in extracted.get("absences", []):
        if a.get("person"):
            names.add(a["person"].strip())
    return sorted(names)


def resolve_person_id(conn, chosen_label: str, raw_name: str) -> int | None:
    """chosen_label is DEPARTMENT_LABEL, NEW_PERSON_LABEL, or an existing person's name."""
    if chosen_label == DEPARTMENT_LABEL:
        return None
    if chosen_label == NEW_PERSON_LABEL:
        canonical = normalize_name(raw_name)
        person_id = db.find_person_by_alias(conn, canonical)
        if person_id is None:
            person_id = db.create_person(conn, canonical)
    else:
        row = conn.execute("SELECT id FROM people WHERE name = ?", (chosen_label,)).fetchone()
        person_id = row["id"]
    if raw_name:
        db.add_alias(conn, person_id, raw_name)
    return person_id


def page_upload():
    st.title("PDFs & Excel hochladen & prüfen")

    if not os.environ.get("GEMINI_API_KEY"):
        st.text_input(
            "Gemini API Key (kostenlos über Google AI Studio, nur für diese Sitzung, wird nicht gespeichert)",
            type="password",
            key="api_key_input",
        )
        if not get_api_key():
            st.warning("Ohne API Key kann keine PDF-Extraktion durchgeführt werden (für .xlsx nicht nötig). "
                       "Alternativ GEMINI_API_KEY in der .env-Datei setzen.")

    files = st.file_uploader(
        "Ein oder mehrere Dienstplan-Dateien auswählen (PDF oder Excel)",
        type=["pdf", "xlsx"], accept_multiple_files=True,
    )
    if not files:
        return

    for f in files:
        st.divider()
        st.subheader(f.name)
        is_xlsx = f.name.lower().endswith(".xlsx")

        if f.name not in st.session_state.extractions:
            if is_xlsx:
                sheet_choice = None
                try:
                    sheets = xlsx_template.list_week_sheets(io.BytesIO(f.getvalue()))
                    if sheets:
                        sheet_choice = st.selectbox(
                            "Blatt", sheets, index=len(sheets) - 1, key=f"sheet_{f.name}"
                        )
                except Exception as e:
                    st.error(f"Konnte Excel-Datei nicht lesen: {e}")
                if st.button(f"Einlesen: {f.name}", key=f"extract_{f.name}"):
                    try:
                        result = xlsx_template.extract_from_xlsx(io.BytesIO(f.getvalue()), sheet_choice)
                        st.session_state.extractions[f.name] = result
                        st.rerun()
                    except Exception as e:
                        st.error(f"Einlesen fehlgeschlagen: {e}")
            elif st.button(f"Extrahieren: {f.name}", key=f"extract_{f.name}"):
                api_key = get_api_key()
                if not api_key:
                    st.error("Kein API Key vorhanden.")
                else:
                    with st.spinner("Gemini liest das PDF..."):
                        try:
                            result = extract_dienstplan(f.getvalue(), api_key=api_key)
                            st.session_state.extractions[f.name] = result
                            st.rerun()
                        except Exception as e:
                            st.error(f"Extraktion fehlgeschlagen: {e}")
            continue

        extracted = st.session_state.extractions[f.name]
        render_review(f.name, extracted)


def render_review(filename: str, extracted: dict):
    col1, col2, col3 = st.columns(3)
    with col1:
        kw = st.number_input("Kalenderwoche", value=extracted.get("kw") or 0, key=f"kw_{filename}")
    with col2:
        start_date_de = st.text_input(
            "Start (TT.MM.JJJJ)", value=util.fmt_date(extracted.get("start_date", "")), key=f"start_{filename}"
        )
    with col3:
        end_date_de = st.text_input(
            "Ende (TT.MM.JJJJ)", value=util.fmt_date(extracted.get("end_date", "")), key=f"end_{filename}"
        )

    existing_people = [p["name"] for p in db.get_all_people(conn)]
    raw_names = collect_raw_names(extracted)

    if raw_names:
        st.markdown("**Personen-Zuordnung**")
        st.caption("Für jeden im PDF gefundenen Namen: bestehende Person wählen oder neu anlegen.")
        choices = st.session_state.person_choices.setdefault(filename, {})
        cols = st.columns(3)
        for i, raw in enumerate(raw_names):
            guess = normalize_name(raw)
            options = [NEW_PERSON_LABEL, DEPARTMENT_LABEL] + existing_people
            if raw.upper() in KNOWN_DEPARTMENT_TOKENS or guess.upper() in KNOWN_DEPARTMENT_TOKENS:
                default_idx = options.index(DEPARTMENT_LABEL)
            elif guess in existing_people:
                default_idx = options.index(guess)
            else:
                default_idx = 0
            with cols[i % 3]:
                choice = st.selectbox(
                    raw, options, index=default_idx,
                    key=f"person_{filename}_{raw}",
                )
                choices[raw] = choice

    st.markdown("**Zuteilungen (assignments)**")
    assign_df = pd.DataFrame(extracted.get("assignments", []))
    if not assign_df.empty:
        assign_df = assign_df[["date", "category", "subcategory", "person", "raw_text"]]
    edited_assign = st.data_editor(assign_df, num_rows="dynamic", key=f"assign_editor_{filename}", use_container_width=True)

    st.markdown("**Abwesenheiten (absences)**")
    absence_df = pd.DataFrame(extracted.get("absences", []))
    if not absence_df.empty:
        absence_df = absence_df[["date", "person", "type"]]
    edited_absence = st.data_editor(absence_df, num_rows="dynamic", key=f"absence_editor_{filename}", use_container_width=True)

    if st.button(f"Speichern: {filename}", key=f"save_{filename}"):
        try:
            start_iso = util.parse_de_date(start_date_de).isoformat()
            end_iso = util.parse_de_date(end_date_de).isoformat()
        except ValueError:
            st.error("Start/Ende bitte im Format TT.MM.JJJJ angeben.")
            st.stop()
        save_week_plan(filename, kw, start_iso, end_iso, edited_assign, edited_absence)
        st.success(f"Gespeichert: {filename}")
        del st.session_state.extractions[filename]
        st.session_state.person_choices.pop(filename, None)
        st.rerun()


def save_week_plan(filename, kw, start_date, end_date, assign_df, absence_df):
    week_plan_id = db.insert_week_plan(conn, int(kw) if kw else None, start_date, end_date, filename)
    choices = st.session_state.person_choices.get(filename, {})

    for _, row in assign_df.iterrows():
        raw_person = str(row.get("person") or "").strip()
        if not raw_person:
            continue
        chosen = choices.get(raw_person, NEW_PERSON_LABEL)
        person_id = resolve_person_id(conn, chosen, raw_person)
        db.insert_assignment(
            conn, week_plan_id, row.get("date"), row.get("category"),
            row.get("subcategory") or None, person_id, row.get("raw_text") or None,
        )

    for _, row in absence_df.iterrows():
        raw_person = str(row.get("person") or "").strip()
        if not raw_person:
            continue
        chosen = choices.get(raw_person, NEW_PERSON_LABEL)
        person_id = resolve_person_id(conn, chosen, raw_person)
        db.insert_absence(conn, week_plan_id, row.get("date"), person_id, row.get("type"))

    conn.commit()


def page_team():
    st.title("Team")
    st.caption("Aktiver Mitarbeiterpool mit Abteilungen. Nur aktive Personen werden im Plan-Editor als Kandidaten vorgeschlagen.")

    people = db.get_all_people(conn)
    totals = stats.person_totals(conn)
    total_lookup = dict(zip(totals["person"], totals["total"])) if not totals.empty else {}

    st.markdown('<div class="studio-card"><div class="studio-title">Neue Person</div>', unsafe_allow_html=True)
    with st.form("new_person_form", clear_on_submit=True):
        c1, c2, c3 = st.columns([2, 2, 1])
        with c1:
            new_name = st.text_input("Name")
        with c2:
            new_department = st.text_input("Abteilung (optional)")
        with c3:
            st.write("")
            st.write("")
            submitted = st.form_submit_button("Hinzufügen", type="primary")
        if submitted and new_name.strip():
            db.create_person(conn, new_name.strip(), new_department.strip() or None)
            st.rerun()
    st.markdown("</div>", unsafe_allow_html=True)

    if not people:
        st.info("Noch keine Personen im Pool.")
        return

    rows = [
        {
            "id": p["id"],
            "Name": p["name"],
            "Abteilung": p["department"] or "",
            "Aktiv": bool(p["active"]),
            "Zuteilungen gesamt": int(total_lookup.get(p["name"], 0)),
        }
        for p in people
    ]
    df = pd.DataFrame(rows).sort_values(["Aktiv", "Name"], ascending=[False, True])

    edited = st.data_editor(
        df, key="team_editor", use_container_width=True, hide_index=True, num_rows="fixed",
        column_config={
            "id": None,
            "Zuteilungen gesamt": st.column_config.NumberColumn(disabled=True),
        },
    )

    if st.button("Änderungen speichern", type="primary"):
        for _, row in edited.iterrows():
            db.update_person(conn, int(row["id"]), row["Name"], row["Abteilung"] or None, bool(row["Aktiv"]))
        st.success("Team aktualisiert.")
        st.rerun()


def page_dashboard():
    st.title("Dashboard")

    overview = stats.overview_stats(conn)
    if overview["n_weeks"] == 0:
        st.info("Noch keine Wochenpläne importiert. Lade PDFs unter 'Upload & Prüfen' hoch.")
        return

    start, end = overview["date_range"]
    zeitraum = util.fmt_date_range(start, end) if start else "–"
    st.markdown(
        f"""<div class="metric-row">
            <div class="metric-card"><div class="value">{overview['n_weeks']}</div><div class="label">Wochen im Archiv</div></div>
            <div class="metric-card"><div class="value">{overview['n_people']}</div><div class="label">Teammitglieder</div></div>
            <div class="metric-card"><div class="value">{overview['n_assignments']}</div><div class="label">Zuteilungen gesamt</div></div>
            <div class="metric-card"><div class="value" style="font-size:1.1rem">{zeitraum}</div><div class="label">Zeitraum</div></div>
        </div>""",
        unsafe_allow_html=True,
    )

    st.subheader("Fairness-Regeln")
    st.caption(
        "Jeder aktive MA braucht mind. 1x Barfrei oder Ausschlafen pro Woche, und soll 2x Frei "
        "pro Woche haben. Verstöße für die gewählte Woche:"
    )
    weeks = db.get_week_plans(conn)
    week_labels = {f"KW{w['kw']} · {util.fmt_date_range(w['start_date'], w['end_date'])}": w["id"] for w in weeks}
    chosen_week_label = st.selectbox("Woche", list(week_labels.keys()), key="fairness_week")
    alerts = stats.fairness_alerts(conn, week_labels[chosen_week_label])
    if alerts:
        for a in alerts:
            st.markdown(f"- ⚠️ {a['message']}")
    else:
        st.success("Keine Verstöße gegen die Fairness-Regeln in dieser Woche.")

    totals = stats.person_totals(conn)
    matrix = stats.person_category_matrix(conn)

    st.subheader("Fairness-Übersicht")
    st.caption("Gesamtzahl Zuteilungen pro Person über alle importierten Wochen (MOD-Feld ausgeschlossen, siehe Hinweis unten).")
    if totals.empty:
        st.info("Keine Zuteilungsdaten vorhanden.")
    else:
        max_total = totals["total"].max()
        bars_html = ""
        for _, row in totals.iterrows():
            pct = row["total"] / max_total * 100
            bars_html += f"""<div class="fair-bar-row">
                <div class="fair-bar-name">{row['person']}</div>
                <div class="fair-bar-track">
                    <div class="fair-bar-fill" style="width:{pct:.1f}%; background:{theme.hex_to_rgba('#5c8ae8', 0.85)}">
                        <span class="fair-bar-value">{int(row['total'])}</span>
                    </div>
                </div>
            </div>"""
        st.markdown(bars_html, unsafe_allow_html=True)

    st.subheader("Wer war zuletzt dran?")
    st.caption("Sortiert nach längster Pause zuerst – gut für die nächste faire Zuteilung.")
    if not totals.empty:
        overdue = totals.sort_values("last_active")[["person", "last_active", "total"]].copy()
        overdue["last_active"] = overdue["last_active"].apply(util.fmt_date)
        overdue.columns = ["Person", "Zuletzt aktiv", "Gesamt-Zuteilungen"]
        st.dataframe(overdue, use_container_width=True, hide_index=True)

    st.subheader("Kategorie-Verteilung pro Person")
    if not matrix.empty:
        cat_cols = [c for c in matrix.columns if c != "Gesamt"]
        max_per_col = {c: max(matrix[c].max(), 1) for c in cat_cols}

        legend_html = "".join(
            f'<span class="cat-tag" style="background:{theme.category_color(c)}">{c}</span>' for c in cat_cols
        )
        st.markdown(legend_html, unsafe_allow_html=True)

        header = "".join(f"<th>{c}</th>" for c in cat_cols)
        rows_html = ""
        for person, row in matrix.iterrows():
            cells = ""
            for c in cat_cols:
                val = int(row[c])
                alpha = 0.08 + 0.75 * (val / max_per_col[c]) if val > 0 else 0.0
                bg = theme.hex_to_rgba(theme.category_color(c), alpha) if val > 0 else "transparent"
                text = str(val) if val > 0 else "·"
                cells += f'<td style="background:{bg}">{text}</td>'
            rows_html += f'<tr><td class="name-col">{person}</td>{cells}<td><b>{int(row["Gesamt"])}</b></td></tr>'

        table_html = f"""<table class="heat-table">
            <thead><tr><th></th>{header}<th>Gesamt</th></tr></thead>
            <tbody>{rows_html}</tbody>
        </table>"""
        st.markdown(f'<div style="overflow-x:auto">{table_html}</div>', unsafe_allow_html=True)
    else:
        st.info("Keine Kategorie-Daten vorhanden.")

    dept = stats.department_activity(conn)
    if not dept.empty:
        with st.expander(f"Abteilungs-Zuteilungen (S&L / SPT / NM / etc. – {int(dept['count'].sum())} Einträge, kein Individuum)"):
            dept.columns = ["Eintrag", "Anzahl"]
            st.dataframe(dept, use_container_width=True, hide_index=True)

    st.caption("Hinweis: Das MOD-Feld (Manager on Duty) fließt bewusst nicht in diese Auswertung ein – es wird künftig manuell im Plan-Editor gepflegt.")


def _resolve_or_create_person(conn, name: str) -> int:
    person_id = db.find_person_by_alias(conn, name)
    if person_id is None:
        person_id = db.create_person(conn, name)
    return person_id


def page_plan_editor():
    st.title("Plan-Editor")
    st.caption(
        "Ebenbild deines Dienstplans – trag Namen direkt in die Tabelle ein, genau wie gewohnt. "
        "Vorgeschlagene Namen (Fairness-Rotation) sind bereits eingetragen, einfach überschreiben wo nötig."
    )

    weeks = db.get_week_plans(conn)
    if not weeks:
        st.info("Noch keine Wochenpläne vorhanden – importiere zuerst mindestens eine Woche.")
        return

    col1, col2 = st.columns(2)
    with col1:
        week_labels = {
            f"KW{w['kw']} · {util.fmt_date_range(w['start_date'], w['end_date'])}": w["id"] for w in weeks
        }
        chosen_label = st.selectbox("Vorlage (Struktur wird übernommen)", list(week_labels.keys()))
        template_week_id = week_labels[chosen_label]
    with col2:
        default_start = date.today() + timedelta(days=(7 - date.today().weekday()) % 7 or 7)
        new_start = st.date_input(
            "Start (Montag) der neuen Woche", value=default_start, format="DD.MM.YYYY"
        )
    new_end = new_start + timedelta(days=6)
    st.caption(f"Neue Woche: {util.fmt_date_range(new_start.isoformat(), new_end.isoformat())}")

    with st.expander("Excel-Vorlage (für den Download als echte .xlsx-Datei)"):
        saved_path = db.get_setting(conn, "xlsx_template_path", "")
        template_path = st.text_input(
            "Pfad zur Excel-Vorlagen-Datei", value=saved_path,
            placeholder="/Users/.../Dienstplan-Archiv/DienstplanNEU_....xlsx",
        )
        if template_path != saved_path:
            db.set_setting(conn, "xlsx_template_path", template_path)
        xlsx_sheet_name = None
        if template_path and os.path.exists(template_path):
            try:
                sheets = xlsx_template.list_week_sheets(template_path)
                default_idx = len(sheets) - 1 if sheets else 0
                xlsx_sheet_name = st.selectbox(
                    "Vorlagen-Blatt (liefert Formatierung: Farben, Zellverbindungen, Spaltenbreiten)",
                    sheets, index=default_idx,
                )
            except Exception as e:
                st.error(f"Konnte Vorlage nicht lesen: {e}")
        elif template_path:
            st.warning("Datei nicht gefunden.")

    week_dates_iso = [(new_start + timedelta(days=i)).isoformat() for i in range(7)]
    day_labels = [util.fmt_date_short(d) for d in week_dates_iso]
    day_iso_by_label = dict(zip(day_labels, week_dates_iso))

    if st.button("Entwurf erzeugen", type="primary"):
        draft, _ = assignment.generate_week_draft(conn, template_week_id, new_start, absent_by_date={})
        st.session_state.plan_grid = grid.build_grid(draft, week_dates_iso)
        st.session_state.plan_grid_meta = {
            "template_week_id": template_week_id, "start": new_start.isoformat(), "end": new_end.isoformat(),
        }
        st.session_state.plan_grid_version = st.session_state.get("plan_grid_version", 0) + 1
        st.rerun()

    if "plan_grid" not in st.session_state:
        return

    active_people = [p["name"] for p in db.get_all_people(conn, active_only=True)]

    st.subheader("Schnell zuweisen")
    st.caption(
        "Für MA-Zuteilungen: Zeile + Tag wählen, Person aus dem aktiven Pool suchen (tippen zum Filtern) "
        "und einfügen. Info-Zeilen (Show/Party, Specials, ...) einfach direkt unten in der Tabelle als "
        "Freitext eintippen."
    )
    person_rows = st.session_state.plan_grid[
        st.session_state.plan_grid["Abschnitt"].isin(grid.PERSON_CATEGORIES)
    ]
    if person_rows.empty or not active_people:
        st.caption("Keine MA-Zeilen oder keine aktiven Personen im Team-Pool vorhanden.")
    else:
        row_choices = {
            f"{r['Abschnitt']}" + (f" · {r['Zeile']}" if r["Zeile"] else ""): idx
            for idx, r in person_rows.iterrows()
        }
        qa1, qa2, qa3, qa4 = st.columns([2, 1, 2, 1])
        with qa1:
            chosen_row_label = st.selectbox("Zeile", list(row_choices.keys()), key="qa_row")
        with qa2:
            chosen_day = st.selectbox("Tag", day_labels, key="qa_day")
        with qa3:
            chosen_person = st.selectbox("Person", active_people, key="qa_person")
        with qa4:
            st.write("")
            st.write("")
            if st.button("Einfügen"):
                row_idx = row_choices[chosen_row_label]
                current = st.session_state.plan_grid.at[row_idx, chosen_day]
                current = "" if pd.isna(current) else str(current)
                if not current.strip():
                    new_val = chosen_person
                elif current.rstrip().endswith("|"):
                    new_val = current.rstrip() + " " + chosen_person
                else:
                    new_val = current + ", " + chosen_person
                st.session_state.plan_grid.at[row_idx, chosen_day] = new_val
                st.session_state.plan_grid_version = st.session_state.get("plan_grid_version", 0) + 1
                st.rerun()

    st.subheader("Dienstplan-Entwurf")
    st.caption(
        "Urlaub/Krank & Frei: Namen kommagetrennt eintragen. Zellen mit mehreren Diensten: eine Zeile pro Dienst "
        "(z.B. \"KP1 7:50-10:00: Fanny\"). Mehrere Namen in einer Zeile mit Komma trennen."
    )
    grid_version = st.session_state.get("plan_grid_version", 0)
    edited_grid = st.data_editor(
        st.session_state.plan_grid, use_container_width=True, num_rows="dynamic",
        key=f"plan_grid_editor_{grid_version}",
        hide_index=True,
        height=min(740, 40 + 36 * (len(st.session_state.plan_grid) + 1)),
        column_config={
            "Abschnitt": st.column_config.TextColumn("Abschnitt", disabled=True),
            "Zeile": st.column_config.TextColumn("Zeile", disabled=True),
        },
    )

    st.subheader("Vorschau (Original-Layout)")
    st.markdown(
        grid.render_pdf_preview_html(edited_grid, week_dates_iso), unsafe_allow_html=True
    )

    colA, colB, colC = st.columns(3)
    with colA:
        if st.button("Vorschläge neu berechnen (nutzt eingetragene Abwesenheiten)"):
            _, absences_now = grid.parse_grid(edited_grid, day_iso_by_label)
            absent_by_date: dict[str, set[str]] = {}
            for a in absences_now:
                absent_by_date.setdefault(a["date"], set()).add(a["person"])
            meta = st.session_state.plan_grid_meta
            draft, _ = assignment.generate_week_draft(conn, meta["template_week_id"], new_start, absent_by_date)
            new_grid = grid.build_grid(draft, week_dates_iso)
            for label in grid.ABSENCE_ROWS:
                old_rows = edited_grid[edited_grid["Abschnitt"] == label]
                if not old_rows.empty:
                    new_grid.loc[new_grid["Abschnitt"] == label, day_labels] = old_rows[day_labels].values
            st.session_state.plan_grid = new_grid
            st.session_state.plan_grid_version = st.session_state.get("plan_grid_version", 0) + 1
            st.rerun()
    with colB:
        if st.button("Plan speichern", type="primary"):
            meta = st.session_state.plan_grid_meta
            assignments_list, absences_list = grid.parse_grid(edited_grid, day_iso_by_label)
            week_plan_id = db.insert_week_plan(
                conn, None, meta["start"], meta["end"], f"Generiert (Vorlage KW-ID {meta['template_week_id']})"
            )
            for a in assignments_list:
                person_id = _resolve_or_create_person(conn, a["person"])
                db.insert_assignment(
                    conn, week_plan_id, a["date"], a["category"], a.get("subcategory"), person_id, a.get("raw_text")
                )
            for a in absences_list:
                person_id = _resolve_or_create_person(conn, a["person"])
                db.insert_absence(conn, week_plan_id, a["date"], person_id, a["type"])
            conn.commit()
            st.success("Plan gespeichert – im Archiv sichtbar und fließt künftig in die Fairness-Statistik ein.")
            del st.session_state.plan_grid
            del st.session_state.plan_grid_meta
            st.rerun()
    with colC:
        if not template_path or not xlsx_sheet_name:
            st.caption("Excel-Vorlage oben eintragen, um als echte .xlsx herunterzuladen.")
        elif st.button("Excel generieren"):
            assignments_list, absences_list = grid.parse_grid(edited_grid, day_iso_by_label)
            out_path = os.path.join(tempfile.gettempdir(), f"dienstplan_{new_start.isoformat()}.xlsx")
            try:
                xlsx_template.generate_week_xlsx(
                    template_path, xlsx_sheet_name, new_start, assignments_list, absences_list, out_path
                )
                with open(out_path, "rb") as f:
                    st.session_state.plan_xlsx_bytes = f.read()
                st.session_state.plan_xlsx_name = f"Dienstplan_{util.fmt_date(new_start.isoformat())}.xlsx"
            except Exception as e:
                st.error(f"Excel-Generierung fehlgeschlagen: {e}")
        if st.session_state.get("plan_xlsx_bytes"):
            st.download_button(
                "Excel herunterladen", data=st.session_state.plan_xlsx_bytes,
                file_name=st.session_state.get("plan_xlsx_name", "dienstplan.xlsx"),
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )


def page_archive():
    st.title("Archiv")
    weeks = db.get_week_plans(conn)
    if not weeks:
        st.info("Noch keine Wochenpläne gespeichert.")
        return

    for w in weeks:
        kw_label = f"KW{w['kw']} · " if w["kw"] else ""
        with st.expander(f"{kw_label}{util.fmt_date_range(w['start_date'], w['end_date'])} · {w['source_pdf']}"):
            assignments = pd.DataFrame([dict(a) for a in db.get_assignments_for_week(conn, w["id"])])
            absences = pd.DataFrame([dict(a) for a in db.get_absences_for_week(conn, w["id"])])
            st.markdown(f"**{len(assignments)} Zuteilungen, {len(absences)} Abwesenheiten**")
            if not assignments.empty:
                assignments["date"] = assignments["date"].apply(util.fmt_date)
            if not absences.empty:
                absences["date"] = absences["date"].apply(util.fmt_date)
            st.dataframe(assignments, use_container_width=True)
            st.dataframe(absences, use_container_width=True)
            if st.button("Löschen", key=f"delete_{w['id']}"):
                db.delete_week_plan(conn, w["id"])
                st.rerun()


PAGES = ["Dashboard", "Team", "Plan-Editor", "Upload & Prüfen", "Archiv"]
ICONS = ["bar-chart-line", "people", "calendar-week", "cloud-upload", "archive"]

with st.sidebar:
    st.markdown("### 📋 Planner-Agent")
    page = option_menu(
        menu_title=None, options=PAGES, icons=ICONS, default_index=0,
        styles=theme.OPTION_MENU_STYLES, key="main_nav",
    )

if page == "Dashboard":
    page_dashboard()
elif page == "Team":
    page_team()
elif page == "Plan-Editor":
    page_plan_editor()
elif page == "Upload & Prüfen":
    page_upload()
else:
    page_archive()
