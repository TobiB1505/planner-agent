"""Gemeinsame Styling-Konstanten für Dashboard & (später) Plan-Editor."""
from __future__ import annotations

import hashlib

# Exakte Farbcodes aus der echten Excel-Vorlage (DienstplanNEU_KW01_NewYork_2026.xlsx),
# statt aus der PDF-Optik geschätzt. Kategorien ohne Treffer nutzen FALLBACK_PALETTE.
CATEGORY_COLORS = {
    "Urlaub/Krank": "#FEF4C8",
    "Frei": "#FEF4C8",
    "Kochdienste": "#FFFF00",
    "Sportprogramm": "#00B0F0",
    "TT & Kicker wischen": "#FFC000",
    "Süße Momente": "#FFC000",
    "15:50 Süße Momente": "#FFC000",
    "18 Uhr LEDs": "#FF33CC",
    "Saunaaufguss": "#A3DBBC",
    "Aperitif": "#EBDE8D",
    "Aufbau": "#c9973a",
    "Abbau": "#a17a3a",
    "Extradienste": "#3a8ee8",
    "OPS + WP": "#7a5ce8",
    "OPS / WP": "#7a5ce8",
    "Moderation + Getränkedienst": "#d13a6e",
    "Ausschlafen": "#6b6b6b",
    "Tagesverantwortung": "#3ac9b0",
    "An/Abreise-Dienst": "#5c7ae8",
    "Nachmittag/Abend Extras": "#8e5ce8",
    "Barfrei": "#e8b23a",
}
FALLBACK_PALETTE = [
    "#5c8ae8", "#e85c8a", "#5ce8a1", "#e8a15c", "#8a5ce8",
    "#5ce8d8", "#e85c5c", "#a1e85c", "#5c5ce8", "#e8d85c",
]


def category_color(category: str) -> str:
    if category in CATEGORY_COLORS:
        return CATEGORY_COLORS[category]
    idx = int(hashlib.md5(category.encode()).hexdigest(), 16) % len(FALLBACK_PALETTE)
    return FALLBACK_PALETTE[idx]


def hex_to_rgba(hex_color: str, alpha: float) -> str:
    hex_color = hex_color.lstrip("#")
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    return f"rgba({r},{g},{b},{alpha:.2f})"


ACCENT = "#6c7bff"

# Wird einmal global geladen (in app.py), blendet Streamlit-Chrome aus und
# vereinheitlicht Typografie/Abstände im Studio-Stil (Google AI Studio / YouTube Studio).
GLOBAL_CSS = """
<style>
[data-testid="stAppDeployButton"] { display: none; }
[data-testid="stMainMenu"] { display: none; }
footer { visibility: hidden; height: 0; }
[data-testid="stDecoration"] { display: none; }

.block-container { padding-top: 2rem; padding-bottom: 3rem; max-width: 1200px; }

h1 { font-size: 1.9rem !important; font-weight: 700 !important; margin-bottom: 0.3rem !important; }
h2 { font-size: 1.25rem !important; font-weight: 700 !important; margin-top: 1.8rem !important; }
h3 { font-size: 1.05rem !important; font-weight: 600 !important; }

[data-testid="stSidebar"] { border-right: 1px solid rgba(128,128,128,0.15); }
[data-testid="stSidebar"] .block-container { padding-top: 1.5rem; }

/* Ein-/Ausklapp-Button der Sidebar: dezentes, rundes Studio-Icon statt Standard-Look */
[data-testid="stSidebarCollapseButton"] button,
[data-testid="stExpandSidebarButton"] {
    background: rgba(128,128,128,0.12) !important;
    border: 1px solid rgba(128,128,128,0.2) !important;
    border-radius: 999px !important;
    width: 34px !important;
    height: 34px !important;
    transition: background 0.15s ease;
}
[data-testid="stSidebarCollapseButton"] button:hover,
[data-testid="stExpandSidebarButton"]:hover {
    background: %(accent)s !important;
    border-color: %(accent)s !important;
}

.studio-card {
    border: 1px solid rgba(128,128,128,0.18);
    border-radius: 14px;
    padding: 1.1rem 1.3rem;
    margin-bottom: 1rem;
    background: rgba(128,128,128,0.03);
}
.studio-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; font-weight: 600; margin-bottom: 0.6rem; }

div[data-testid="stButton"] button {
    border-radius: 8px; font-weight: 600;
}
div[data-testid="stButton"] button[kind="primary"] {
    background: %(accent)s; border-color: %(accent)s;
}
</style>
""" % {"accent": ACCENT}

OPTION_MENU_STYLES = {
    "container": {"padding": "0!important", "background-color": "transparent"},
    "icon": {"font-size": "16px"},
    "nav-link": {
        "font-size": "14.5px", "font-weight": "500", "text-align": "left",
        "margin": "3px 0", "padding": "10px 14px", "border-radius": "8px",
    },
    "nav-link-selected": {"background-color": ACCENT, "font-weight": "600"},
}

DASHBOARD_CSS = """
<style>
.metric-row { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
.metric-card {
    flex: 1; min-width: 160px;
    background: linear-gradient(135deg, rgba(120,120,255,0.12), rgba(120,120,255,0.04));
    border: 1px solid rgba(120,120,255,0.25);
    border-radius: 12px;
    padding: 1rem 1.2rem;
}
.metric-card .value { font-size: 1.8rem; font-weight: 700; line-height: 1.2; }
.metric-card .label { font-size: 0.85rem; opacity: 0.7; margin-top: 0.2rem; }

.cat-tag {
    display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px;
    color: white; font-size: 0.78rem; font-weight: 600; margin: 0.1rem;
}

.fair-bar-row { display: flex; align-items: center; gap: 0.6rem; margin: 0.35rem 0; }
.fair-bar-name { width: 110px; font-size: 0.85rem; text-align: right; flex-shrink: 0; }
.fair-bar-track { flex: 1; background: rgba(128,128,128,0.15); border-radius: 6px; overflow: hidden; height: 20px; }
.fair-bar-fill { height: 100%; border-radius: 6px; display: flex; align-items: center; justify-content: flex-end; }
.fair-bar-value { font-size: 0.75rem; color: white; padding-right: 6px; font-weight: 600; }

.heat-table { border-collapse: collapse; width: 100%; font-size: 0.82rem; }
.heat-table th { text-align: center; padding: 6px 8px; font-weight: 600; white-space: nowrap; }
.heat-table td { text-align: center; padding: 6px 8px; border-radius: 6px; }
.heat-table td.name-col { text-align: left; font-weight: 600; white-space: nowrap; }
</style>
"""
