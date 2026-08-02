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
  quality: PlanQualityResult;
  intelligence: {
    active_people: number;
    evidence_profiles: number;
    memory_profiles: number;
    manual_skills: number;
    manual_memory_entries: number;
    historical_weeks: number;
    rehearsal_weeks: number;
    cold_start_people: string[];
    recent_audit: PlanAuditEvent[];
  };
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
  /** Datum -> Show-/Party-Namen, die an dem Abend laufen (für Konflikttexte). */
  on_stage_shows_by_date: Record<string, string[]>;
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
  audit_events?: PlanAuditEventInput[];
}

export interface PlanSaveResult {
  week_plan_id: number;
  warnings?: string[];
  week?: WeekSummary;
}

export type IntelligenceReasonCode =
  | "skill_match"
  | "experience"
  | "low_workload"
  | "fairness"
  | "availability"
  | "previous_success"
  | "preference"
  | "conflict_free";

export interface EmployeeSkill {
  id: string;
  name: string;
  level: number;
  source: "manual" | "historical_data" | "department";
  evidence: string[];
  updated_at: string | null;
  editable: boolean;
}

export interface EmployeeMemoryEntry {
  id: string;
  type: string;
  subject: string;
  value: unknown;
  confidence: number;
  source: "manual" | "historical_data" | "manual_override";
  source_date: string | null;
  editable: boolean;
  note: string | null;
  updated_at?: string;
}

export interface EmployeeIntelligenceProfile {
  person: { id: number; name: string; department: string | null; active: boolean };
  period: {
    weeks_requested: number;
    weeks_available: number;
    start_date: string | null;
    end_date: string | null;
  };
  summary: {
    assignments: number;
    cooking: number;
    sport: number;
    moderation: number;
    early_duties: number;
    late_duties: number;
    weighted_load: number;
  };
  current_week: { assignments: number; shows: number; moderation: number; conflicts: number };
  categories: Array<{ category: string; count: number }>;
  weekly_load: Array<{ start_date: string; assignments: number }>;
  trend: {
    recent_average: number;
    previous_average: number;
    delta: number;
    direction: "up" | "down" | "stable";
  };
  skills: EmployeeSkill[];
  memory: EmployeeMemoryEntry[];
  planning_recommendations: Array<{
    code: string;
    label: string;
    text: string;
    evidence: string[];
  }>;
  cache: { data_version: string; hit: boolean };
}

export interface TeamIntelligencePerson {
  person_id: number;
  active: boolean;
  history_assignments: number;
  weeks_available: number;
  current_week: EmployeeIntelligenceProfile["current_week"];
  trend: EmployeeIntelligenceProfile["trend"];
  top_skills: Array<Pick<EmployeeSkill, "id" | "name" | "level" | "source">>;
  skill_count: number;
  memory_count: number;
  manual_memory_count: number;
  data_status: "ready" | "learning" | "new";
  planning_hint: {
    tone: "positive" | "warning" | "info" | "neutral";
    label: string;
    text: string;
  };
}

export interface TeamIntelligenceOverview {
  summary: {
    active_people: number;
    with_history: number;
    with_memory: number;
    with_skills: number;
    current_week_assignments: number;
    current_week_conflicts: number;
    attention_people: number;
  };
  people: TeamIntelligencePerson[];
}

export interface IntelligenceReason {
  code: IntelligenceReasonCode;
  label: string;
  weight: number;
  evidence: string;
}

export interface IntelligentCandidate {
  employee_id: number;
  employee: string;
  department: string | null;
  score: number;
  rank: number;
  status: "recommended" | "available" | "warning" | "unavailable";
  reasons: IntelligenceReason[];
  warnings: Array<{ code: string; label: string }>;
}

export interface IntelligentRecommendationResult {
  target: { date: string; category: string; subcategory: string | null };
  candidates: IntelligentCandidate[];
  reason_weights: Record<IntelligenceReasonCode, number>;
  data_basis: {
    historical_assignments: number;
    active_people: number;
    uses_rehearsals: boolean;
  };
}

export interface PlanQualityDimension {
  key: "conflicts" | "fairness" | "skill_matching" | "preferences" | "historical_quality";
  label: string;
  score: number;
  max_score: number;
  status: "good" | "warning" | "critical" | "neutral";
  neutral: boolean;
  explanations: string[];
}

export interface PlanQualityResult {
  score: number;
  max_score: number;
  status: "good" | "warning" | "critical";
  dimensions: PlanQualityDimension[];
  issues: Array<{ severity: string; code: string; message: string }>;
  weights: Record<PlanQualityDimension["key"], number>;
  analysis: {
    title: string;
    optimization_goals: Array<{ key: string; label: string; weight: number }>;
    decisions: Array<{
      employee: string;
      date: string;
      category: string;
      subcategory: string | null;
      reasons: string[];
    }>;
    data_basis: { assignments: number; active_people: number; historical_weeks: number };
  };
}

export interface PlanAuditEventInput {
  event_type: "cell_changed" | "recommendation_applied" | "automation_applied" | "undo" | "redo";
  cause: string;
  cell_key?: string;
  previous_value?: string | null;
  new_value?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PlanAuditEvent extends Omit<PlanAuditEventInput, "event_type"> {
  event_type: PlanAuditEventInput["event_type"] | "plan_saved";
  id: number;
  week_plan_id: number | null;
  start_date: string;
  user: string;
  created_at: string;
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
  post<PlanSaveResult>("/plan/save", payload);

// ---------- Planner Intelligence Layer ----------
export const getEmployeeIntelligence = (
  personId: number,
  options?: { weeks?: number; currentWeekStart?: string },
) => {
  const params = new URLSearchParams();
  if (options?.weeks) params.set("weeks", String(options.weeks));
  if (options?.currentWeekStart) params.set("current_week_start", options.currentWeekStart);
  const suffix = params.size ? `?${params.toString()}` : "";
  return get<EmployeeIntelligenceProfile>(`/intelligence/employees/${personId}${suffix}`);
};

export const getTeamIntelligenceOverview = (options?: {
  weeks?: number;
  currentWeekStart?: string;
}) => {
  const params = new URLSearchParams();
  if (options?.weeks) params.set("weeks", String(options.weeks));
  if (options?.currentWeekStart) params.set("current_week_start", options.currentWeekStart);
  const suffix = params.size ? `?${params.toString()}` : "";
  return get<TeamIntelligenceOverview>(`/intelligence/employees${suffix}`);
};

export const setEmployeeSkill = (
  personId: number,
  skill: { id: string; name: string; level: number; evidence?: string[] },
) => put<unknown>(
  `/intelligence/employees/${personId}/skills`,
  { ...skill, evidence: skill.evidence ?? [] },
);

export const deleteEmployeeSkill = (personId: number, skillId: string) =>
  del<{ ok: boolean }>(`/intelligence/employees/${personId}/skills/${encodeURIComponent(skillId)}`);

export const setEmployeeIntelligenceMemory = (
  personId: number,
  entry: {
    type: string;
    subject: string;
    value: unknown;
    confidence?: number;
    note?: string;
    source_date?: string;
  },
) => post<EmployeeMemoryEntry[]>(`/intelligence/employees/${personId}/memory`, entry);

export const deleteEmployeeIntelligenceMemory = (personId: number, entryId: number) =>
  del<EmployeeMemoryEntry[]>(`/intelligence/employees/${personId}/memory/${entryId}`);

export const getIntelligentRecommendations = (payload: {
  start_date: string;
  day_labels: string[];
  rows: Record<string, string | null>[];
  day_label: string;
  category: string;
  subcategory?: string | null;
}) => post<IntelligentRecommendationResult>("/intelligence/recommendations", payload);

export const getPlanQuality = (payload: {
  start_date: string;
  day_labels: string[];
  rows: Record<string, string | null>[];
}) => post<PlanQualityResult>("/intelligence/plan-quality", payload);

export const getPlanAudit = (options: { weekPlanId?: number; startDate?: string; limit?: number }) => {
  const params = new URLSearchParams();
  if (options.weekPlanId) params.set("week_plan_id", String(options.weekPlanId));
  if (options.startDate) params.set("start_date", options.startDate);
  if (options.limit) params.set("limit", String(options.limit));
  return get<PlanAuditEvent[]>(`/intelligence/audit?${params.toString()}`);
};

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

// ---------- Service Manager ----------
export interface SystemTemplateStatus {
  name: string;
  filename: string;
  exists: boolean;
}

export interface SystemDirectoryStatus {
  path: string;
  exists: boolean;
  writable: boolean;
}

export interface SystemDiagnostics {
  database: {
    status: "connected" | "missing" | "error";
    integrity_check: string | null;
    path: string;
  };
  templates: SystemTemplateStatus[];
  directories: {
    database: SystemDirectoryStatus;
    archive: SystemDirectoryStatus;
    uploads: SystemDirectoryStatus;
    exports: SystemDirectoryStatus;
  };
  host: string;
  port: string;
  cors_origins: string[];
  uptime_seconds: number;
  disk: {
    free_bytes: number;
    total_bytes: number;
  };
}

export const getSystemDiagnostics = () => get<SystemDiagnostics>("/system/diagnostics");

/** Alter Weg: das Backend startet sich über /api/system/restart selbst neu
 * (execv). Funktioniert nur, solange das Backend noch antwortet. */
export const restartBackend = () => post<{ status: string }>("/system/restart");

/**
 * Robuster Weg: von Next.js selbst beantwortet (nicht vom Backend), daher
 * funktioniert er auch, wenn das Backend abgestürzt oder nie gestartet ist -
 * Next.js startet in dem Fall direkt einen neuen Backend-Prozess. Das ist
 * der Weg, den die /system-Seite tatsächlich verwendet.
 */
export async function ensureBackendRestarted(): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/control/backend/restart", { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (!res.ok) {
    throw new ApiError(res.status, body.message || `Neustart fehlgeschlagen (${res.status})`);
  }
  return { ok: body.ok ?? true, message: body.message ?? "" };
}
