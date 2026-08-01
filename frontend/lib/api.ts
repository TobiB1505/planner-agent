// Typisierter Fetch-Wrapper für das FastAPI-Backend. Nutzt relative /api/-Pfade,
// die im Dev-Modus per next.config.ts-Rewrite auf localhost:8000 zeigen und in
// Produktion vom selben Next.js/FastAPI-Prozess bedient werden.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const BACKEND_UNREACHABLE_MESSAGE =
  "Das lokale Backend ist nicht erreichbar. Bitte starte den Planner-Agent über das Startskript.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...init?.headers,
      },
    });
  } catch {
    // fetch() wirft nur, wenn die Anfrage den Server gar nicht erst erreicht
    // (z.B. Next.js-Dev-Server selbst nicht erreichbar) - kein Stacktrace im UI.
    throw new ApiError(0, BACKEND_UNREACHABLE_MESSAGE);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text;
    let hasDetail = false;
    try {
      const parsed = JSON.parse(text);
      message = parsed.detail ?? text;
      hasDetail = typeof parsed.detail === "string";
    } catch {
      // keep raw text
    }
    // Ein FastAPI-Fehler liefert immer JSON mit "detail". Ohne das ist ein
    // 5xx kein fachlicher Fehler, sondern der next.config.ts-Rewrite konnte
    // das Backend selbst nicht erreichen (z.B. noch nicht gestartet).
    if (!hasDetail && res.status >= 500) {
      throw new ApiError(res.status, BACKEND_UNREACHABLE_MESSAGE);
    }
    throw new ApiError(res.status, message || `Anfrage fehlgeschlagen (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function get<T>(path: string): Promise<T> {
  return request<T>(path);
}
function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
}
function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined });
}
function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

// ---------- Types ----------
export interface Person {
  id: number;
  name: string;
  department: string | null;
  active: boolean;
  total_assignments: number;
}

export interface WeekSummary {
  id: number;
  kw: number | null;
  start_date: string;
  end_date: string;
  source: string | null;
  label: string;
  assignment_count: number;
  absence_count: number;
}

export interface WeekDetail {
  assignments: Record<string, unknown>[];
  absences: Record<string, unknown>[];
}

export interface OverviewStats {
  [key: string]: unknown;
}

export interface PersonTotal {
  person: string;
  total: number;
  [key: string]: unknown;
}

export interface CategoryMatrix {
  columns: string[];
  rows: Array<{ person: string; total: number; [key: string]: unknown }>;
}

export interface DepartmentActivity {
  [key: string]: unknown;
}

export interface FairnessAlert {
  [key: string]: unknown;
}

export interface PlanningRule {
  id: string;
  title: string;
  description: string;
  tone: "info" | "positive" | "warning";
}

export interface DashboardInsights {
  week: {
    id: number;
    label: string;
    start_date: string;
    end_date: string;
  };
  planning_week: {
    start_date: string;
    end_date: string;
    label: string;
  };
  readiness: {
    artist_plan: boolean;
    rehearsal_plan: boolean;
    duty_plan: boolean;
    rehearsal_count: number;
    assignment_count: number;
  };
  show_days: {
    date: string;
    shows: string[];
    rehearsal_count: number;
  }[];
  workload: {
    person: string;
    department: string | null;
    services: number;
    cooking: number;
    sport: number;
    late_duties: number;
    relief: number;
    free_days: number;
    absence_days: number;
    status: "balanced" | "high" | "low";
  }[];
  departments: {
    department: string;
    active_people: number;
    scheduled_people: number;
    services: number;
  }[];
  rules: PlanningRule[];
}

export interface ExtractedAssignment {
  date: string;
  category: string;
  subcategory?: string | null;
  person?: string | null;
  raw_text?: string | null;
}

export interface ExtractedAbsence {
  date: string;
  person: string;
  type: string;
}

export interface ExtractionResult {
  kw?: number | null;
  start_date: string;
  end_date: string;
  assignments: ExtractedAssignment[];
  absences: ExtractedAbsence[];
}

export interface ImportSavePayload {
  filename: string;
  kw?: number | null;
  start_date: string;
  end_date: string;
  assignments: ExtractedAssignment[];
  absences: ExtractedAbsence[];
  resolutions: Record<string, string>;
}

export interface PlanGenerateResult {
  rows: Record<string, string | null>[];
  day_labels: string[];
  week_dates_iso: string[];
  person_categories: string[];
  assignment_rules: Record<string, AssignmentRule>;
  template_week_id: number;
  template_code: string | null;
  xlsx_sheet: string | null;
  artist_plan: {
    id: number;
    sheet_name: string | null;
    source_filename: string | null;
  } | null;
  rehearsal_plan: {
    id: number;
    source_filename: string | null;
  } | null;
  rehearsal_intervals: RehearsalInterval[];
  show_dates: string[];
  /** Datum -> MA, die laut Gedächtnis an dem Abend auf der Bühne stehen. */
  on_stage_by_date: Record<string, string[]>;
  deko_people: string[];
  previous_week: {
    id: number;
    kw: number;
    start_date: string;
    end_date: string;
    label: string;
  } | null;
  previous_week_workload: Record<string, PreviousWeekWorkload>;
}

export interface PreviousWeekWorkload {
  services: number;
  weighted_load: number;
  overload: number;
  cooking: number;
  late_duties: number;
  high: boolean;
}

export interface ArchivedPlanResult extends PlanGenerateResult {
  existing_week: WeekSummary;
}

export interface AssignmentRule {
  id: string;
  message: string;
  recommended_people: string[];
  allowed_people: string[];
  blocked_people: string[];
  hard_rule: boolean;
}

export interface PlanTemplate {
  code: "A" | "B";
  name: string;
  program: string;
  description: string;
  parity: number;
  sheet: string;
}

export interface PlanSavePayload {
  start_date: string;
  end_date: string;
  template_week_id: number;
  existing_week_id?: number;
  day_labels: string[];
  rows: Record<string, string | null>[];
}

export interface ArtistPlanRow {
  field_key: string;
  label: string;
  group: string;
  [key: string]: string;
}

export interface ArtistPlanData {
  id?: number;
  start_date: string;
  end_date: string;
  week_dates_iso: string[];
  day_labels: string[];
  rows: ArtistPlanRow[];
  source_filename?: string | null;
  sheet_name?: string | null;
}

export interface ArtistPlanSummary {
  id: number;
  start_date: string;
  end_date: string;
  source_filename: string | null;
  sheet_name: string | null;
  filled_entries: number;
  label: string;
}

export interface RehearsalPerson {
  raw_name: string;
  person_name: string | null;
  role: "participant" | "choreographer";
  start_time: string;
  end_time: string;
}

export interface RehearsalEntry {
  id?: number;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  activity: string;
  show_code: string;
  participants_raw: string;
  choreographer_raw: string;
  end_inferred: boolean;
  people?: RehearsalPerson[];
}

export interface RehearsalPlanData {
  id?: number;
  start_date: string;
  end_date: string;
  source_filename?: string | null;
  sheet_name?: string | null;
  rehearsals: RehearsalEntry[];
  warnings: string[];
  extraction_method?: "gemini" | "local" | "excel";
}

export interface RehearsalPlanSummary {
  id: number;
  start_date: string;
  end_date: string;
  source_filename: string | null;
  rehearsal_count: number;
  label: string;
}

export interface RehearsalInterval {
  person_name: string;
  date: string;
  start_time: string;
  end_time: string;
  role: string;
  activity: string;
  show_code: string | null;
  is_show: boolean;
}

// ---------- Team ----------
export const getTeam = () => get<Person[]>("/team");
export const createPerson = (name: string, department?: string) =>
  post<{ id: number }>("/team", { name, department });
export const updatePerson = (
  id: number,
  payload: { name: string; department?: string; active: boolean },
) => put<{ ok: boolean }>(`/team/${id}`, payload);
export const deletePerson = (id: number) => del<{ ok: boolean }>(`/team/${id}`);
export const getActivePeople = () => get<string[]>("/people/active");

// ---------- Wochen / Archiv ----------
export const getWeeks = () => get<WeekSummary[]>("/weeks");
export const getWeekDetail = (weekId: number) => get<WeekDetail>(`/weeks/${weekId}`);
export const deleteWeek = (weekId: number) => del<{ ok: boolean }>(`/weeks/${weekId}`);

// ---------- Dashboard ----------
export const getOverview = () => get<OverviewStats>("/dashboard/overview");
export const getPersonTotals = () => get<PersonTotal[]>("/dashboard/person-totals");
export const getCategoryMatrix = () => get<CategoryMatrix>("/dashboard/category-matrix");
export const getDepartmentActivity = () => get<DepartmentActivity[]>("/dashboard/department-activity");
export const getFairnessAlerts = (weekId: number) =>
  get<FairnessAlert[]>(`/dashboard/fairness-alerts?week_id=${weekId}`);
export const getDashboardInsights = (weekId: number) =>
  get<DashboardInsights>(`/dashboard/insights?week_id=${weekId}`);
export const getPlanningRules = () => get<PlanningRule[]>("/planning-rules");

// ---------- MA-Gedächtnis ----------
export interface MemoryShow {
  show_key: string;
  label: string;
  kind: "show" | "party" | "other";
  appearances: number;
  weeks: number;
  last_date: string | null;
  roles: string[];
  confidence: "niedrig" | "mittel" | "hoch" | "bestätigt";
  source: "abgeleitet" | "bestätigt" | "ergänzt" | "entfernt";
  overridden: boolean;
  counts_for_planning: boolean;
}

export interface MemoryFreeBucket {
  weekday: number;
  label: string;
  count: number;
  share: number;
}

export interface MemoryFree {
  weekdays: number[];
  derived_weekdays: number[];
  source: "abgeleitet" | "manuell";
  pattern: "clear" | "weak" | "flat" | "insufficient";
  total_free_days: number;
  weeks_observed: number;
  distribution: MemoryFreeBucket[];
}

export interface MemoryTask {
  category: string;
  count: number;
  share: number;
  team_share: number;
  last_date: string | null;
  affinity: number;
  state: "derived" | "added" | "removed" | "confirmed";
  level: string | null;
}

export interface PersonMemory {
  person_id: number;
  person: string;
  department: string | null;
  active: boolean;
  shows: MemoryShow[];
  removed_shows: MemoryShow[];
  free: MemoryFree;
  tasks: MemoryTask[];
  never_done: string[];
  data_quality: {
    assignments: number;
    duty_weeks: number;
    rehearsal_weeks: number;
    cold_start: boolean;
  };
}

export interface MemoryOverview {
  people: PersonMemory[];
  unmatched_rehearsal_names: { raw_name: string; count: number }[];
  meta: { rehearsal_weeks: number; duty_weeks: number };
}

export const getMemory = () => get<MemoryOverview>("/memory");
export const getPersonMemory = (personId: number) =>
  get<PersonMemory>(`/memory/${personId}`);
/** state === null setzt auf Automatik zurück. */
export const setMemoryShow = (personId: number, showKey: string, state: string | null) =>
  put<PersonMemory>(`/memory/${personId}/show/${encodeURIComponent(showKey)}`, { state });
/** weekdays === null setzt auf Automatik zurück; [] ist ein gültiger Pin. */
export const setMemoryFree = (personId: number, weekdays: number[] | null) =>
  put<PersonMemory>(`/memory/${personId}/free`, { weekdays });
export const setMemoryTask = (
  personId: number,
  category: string,
  state: string | null,
  level?: string | null,
) => put<PersonMemory>(`/memory/${personId}/task`, { category, state, level });

export interface FreeSuggestion {
  person: string;
  person_id: number;
  dates: string[];
  weekdays: number[];
  pattern: MemoryFree["pattern"];
  source: MemoryFree["source"];
}

export interface FreeSuggestionResult {
  quota: number;
  suggestions: FreeSuggestion[];
  needs_manual: string[];
}

export const getFreeSuggestion = (newStart: string, absences: ExtractedAbsence[]) =>
  post<FreeSuggestionResult>("/plan/free-suggestion", { new_start: newStart, absences });

// ---------- Upload ----------
export async function uploadPdf(file: File, apiKey?: string): Promise<ExtractionResult> {
  const form = new FormData();
  form.append("file", file);
  const query = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : "";
  return request<ExtractionResult>(`/upload/pdf${query}`, { method: "POST", body: form });
}
export async function uploadXlsxSheets(file: File): Promise<{ sheets: string[] }> {
  const form = new FormData();
  form.append("file", file);
  return request(`/upload/xlsx/sheets`, { method: "POST", body: form });
}
export async function uploadXlsx(file: File, sheetName?: string): Promise<ExtractionResult> {
  const form = new FormData();
  form.append("file", file);
  const query = sheetName ? `?sheet_name=${encodeURIComponent(sheetName)}` : "";
  return request<ExtractionResult>(`/upload/xlsx${query}`, { method: "POST", body: form });
}
export const getKnownDepartmentTokens = () => get<string[]>("/known-department-tokens");

// ---------- Künstlerplan ----------
export async function uploadArtistPlanSheets(file: File): Promise<{ sheets: string[] }> {
  const form = new FormData();
  form.append("file", file);
  return request("/artist-plans/upload/sheets", { method: "POST", body: form });
}

export async function importArtistPlan(file: File, sheetName?: string): Promise<ArtistPlanData> {
  const form = new FormData();
  form.append("file", file);
  const query = sheetName ? `?sheet_name=${encodeURIComponent(sheetName)}` : "";
  return request<ArtistPlanData>(`/artist-plans/import${query}`, {
    method: "POST",
    body: form,
  });
}

export const createEmptyArtistPlan = (startDate: string) =>
  get<ArtistPlanData>(`/artist-plans/empty?start_date=${encodeURIComponent(startDate)}`);

export const getArtistPlans = () => get<ArtistPlanSummary[]>("/artist-plans");
export const getArtistPlan = (id: number) => get<ArtistPlanData>(`/artist-plans/${id}`);
export const deleteArtistPlan = (id: number) => del<{ ok: boolean }>(`/artist-plans/${id}`);
export const saveArtistPlan = (payload: ArtistPlanData) =>
  post<{ artist_plan_id: number }>("/artist-plans", payload);

export async function exportArtistPlan(id: number): Promise<Blob> {
  const res = await fetch(`/api/artist-plans/${id}/export`);
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.blob();
}

// ---------- Probenplan ----------
export async function uploadRehearsalPlanSheets(file: File): Promise<{ sheets: string[] }> {
  const form = new FormData();
  form.append("file", file);
  return request("/rehearsal-plans/upload/sheets", { method: "POST", body: form });
}

export async function importRehearsalPlan(
  file: File,
  sheetName?: string,
): Promise<RehearsalPlanData> {
  const form = new FormData();
  form.append("file", file);
  const query = sheetName ? `?sheet_name=${encodeURIComponent(sheetName)}` : "";
  return request<RehearsalPlanData>(`/rehearsal-plans/import${query}`, {
    method: "POST",
    body: form,
  });
}

export const getRehearsalPlans = () =>
  get<RehearsalPlanSummary[]>("/rehearsal-plans");
export const getRehearsalPlan = (id: number) =>
  get<RehearsalPlanData>(`/rehearsal-plans/${id}`);
export const deleteRehearsalPlan = (id: number) =>
  del<{ ok: boolean }>(`/rehearsal-plans/${id}`);
export const saveRehearsalPlan = (payload: RehearsalPlanData) =>
  post<{ rehearsal_plan_id: number }>("/rehearsal-plans", payload);

// ---------- Import speichern ----------
export const saveImport = (payload: ImportSavePayload) =>
  post<{ week_plan_id: number }>("/import/save", payload);

// ---------- Plan-Editor ----------
export const getPlanTemplates = () => get<PlanTemplate[]>("/plan/templates");

export const generatePlan = (payload: {
  template_week_id?: number;
  template_code?: string;
  new_start: string;
  absences?: ExtractedAbsence[];
}) => post<PlanGenerateResult>("/plan/generate", payload);

export const getArchivedPlan = (startDate: string) =>
  get<ArchivedPlanResult>(`/plan/existing?start_date=${encodeURIComponent(startDate)}`);

export const savePlan = (payload: PlanSavePayload) =>
  post<{ week_plan_id: number; warnings: string[] }>("/plan/save", payload);

// ---------- Excel-Vorlage ----------
export function xlsxGenerateUrl(): string {
  return "/api/xlsx/generate";
}

export async function xlsxGenerate(payload: {
  template_code: string;
  start_date: string;
  day_labels: string[];
  rows: Record<string, string | null>[];
}): Promise<Blob> {
  const res = await fetch(xlsxGenerateUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.blob();
}

// ---------- Settings ----------
export const getSetting = (key: string) => get<{ value: string | null }>(`/settings/${key}`);
export const setSetting = (key: string, value: string) =>
  put<{ ok: boolean }>(`/settings/${key}`, { value });

export const healthCheck = () =>
  get<{ status: string; database?: string; database_path?: string }>("/health");
