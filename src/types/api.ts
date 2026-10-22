// NEXORA CRM — Shared API contract types.
// Backend route handlers and frontend features both consume these shapes.

export type Locale = "fa" | "en";
export type Role = "OWNER" | "ADMIN" | "MEMBER";

export interface Me {
  id: string;
  email: string;
  name: string;
  locale: Locale;
  createdAt: string;
}

export interface MembershipInfo {
  workspaceId: string;
  role: Role;
  workspace: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    ownerId: string;
  };
}

export interface MemberInfo {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface AuthResponse {
  /** Raw session token for Bearer-header auth (cookie-blocked contexts, e.g. iframe preview). */
  token?: string;
  user: Me;
  memberships: MembershipInfo[];
}

// ---- List envelope ----
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TagInfo {
  id: string;
  name: string;
  color: string;
}

export interface OwnerInfo {
  id: string;
  name: string;
  email: string;
}

// ---- Leads ----
export type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "DISQUALIFIED" | "CONVERTED";
export type Priority = "LOW" | "MEDIUM" | "HIGH";
export type LeadSource = "WEBSITE" | "REFERRAL" | "SOCIAL" | "CAMPAIGN" | "DIRECT" | "OTHER";

export interface Lead {
  id: string;
  workspaceId: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  source: LeadSource | null;
  status: LeadStatus;
  priority: Priority;
  ownerId: string | null;
  owner?: OwnerInfo | null;
  estimatedValue: number | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  notes: string | null;
  disqualificationReason: string | null;
  archived: boolean;
  convertedContactId: string | null;
  convertedDealId: string | null;
  convertedAt: string | null;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  tags?: TagInfo[];
}

export interface LeadFilters {
  q?: string;
  status?: LeadStatus[];
  source?: LeadSource[];
  priority?: Priority[];
  ownerId?: string[];
  tags?: string[];
  archived?: boolean;
  dueFollowUps?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string; // name | createdAt | nextFollowUpAt | estimatedValue | lastActivityAt
  dir?: "asc" | "desc";
}

// ---- Contacts ----
export interface Contact {
  id: string;
  workspaceId: string;
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  companyId: string | null;
  company?: { id: string; name: string } | null;
  ownerId: string | null;
  owner?: OwnerInfo | null;
  notes: string | null;
  archived: boolean;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags?: TagInfo[];
  customFields?: CustomFieldValueInfo[];
}

export interface ContactFilters {
  q?: string;
  companyId?: string[];
  ownerId?: string[];
  tags?: string[];
  archived?: boolean;
  followUpDue?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: "asc" | "desc";
}

// ---- Companies ----
export interface Company {
  id: string;
  workspaceId: string;
  name: string;
  website: string | null;
  industry: string | null;
  size: string | null;
  phone: string | null;
  address: string | null;
  country: string | null;
  ownerId: string | null;
  owner?: OwnerInfo | null;
  source: string | null;
  notes: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  tags?: TagInfo[];
  customFields?: CustomFieldValueInfo[];
  _count?: { contacts: number; deals: number; tasks: number };
}

export interface CompanyFilters {
  q?: string;
  ownerId?: string[];
  industry?: string[];
  tags?: string[];
  archived?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: "asc" | "desc";
}

// ---- Pipelines & Deals ----
export interface Stage {
  id: string;
  pipelineId: string;
  key: string;
  name: string;
  order: number;
  probability: number;
  type: "OPEN" | "WON" | "LOST";
}

export interface Pipeline {
  id: string;
  workspaceId: string;
  name: string;
  isDefault: boolean;
  stages: Stage[];
}

export interface Deal {
  id: string;
  workspaceId: string;
  pipelineId: string;
  stageId: string;
  stage?: Stage;
  pipelineName?: string;
  title: string;
  contactId: string | null;
  contact?: { id: string; name: string } | null;
  companyId: string | null;
  company?: { id: string; name: string } | null;
  value: number;
  currency: string;
  probability: number;
  ownerId: string | null;
  owner?: OwnerInfo | null;
  expectedCloseDate: string | null;
  actualCloseDate: string | null;
  source: string | null;
  priority: Priority;
  description: string | null;
  lostReason: string | null;
  archived: boolean;
  lastActivityAt: string;
  stageEnteredAt: string;
  createdAt: string;
  updatedAt: string;
  tags?: TagInfo[];
  customFields?: CustomFieldValueInfo[];
}

export interface DealFilters {
  q?: string;
  pipelineId?: string;
  stageId?: string[];
  ownerId?: string[];
  priority?: Priority[];
  contactId?: string;
  companyId?: string;
  archived?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: "asc" | "desc";
}

// ---- Tasks ----
export interface Task {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: "OPEN" | "DONE";
  priority: Priority;
  dueAt: string | null;
  assigneeId: string | null;
  assignee?: OwnerInfo | null;
  contactId: string | null;
  contact?: { id: string; name: string } | null;
  companyId: string | null;
  company?: { id: string; name: string } | null;
  dealId: string | null;
  deal?: { id: string; title: string } | null;
  leadId: string | null;
  lead?: { id: string; name: string } | null;
  recurrence: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFilters {
  q?: string;
  status?: ("OPEN" | "DONE")[];
  priority?: Priority[];
  assigneeId?: string[];
  dueFrom?: string;
  dueTo?: string;
  overdue?: boolean;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: "asc" | "desc";
}

// ---- Activities ----
export type ActivityType =
  | "CALL"
  | "MEETING"
  | "EMAIL"
  | "NOTE"
  | "TASK_EVENT"
  | "STAGE_CHANGE"
  | "CONVERSION"
  | "SYSTEM";

export interface Activity {
  id: string;
  workspaceId: string;
  type: ActivityType;
  title: string;
  content: string | null;
  userId: string;
  user?: OwnerInfo;
  contactId: string | null;
  contact?: { id: string; name: string } | null;
  companyId: string | null;
  company?: { id: string; name: string } | null;
  dealId: string | null;
  deal?: { id: string; title: string } | null;
  leadId: string | null;
  lead?: { id: string; name: string } | null;
  metadata: string | null;
  createdAt: string;
}

export interface ActivityFilters {
  type?: ActivityType[];
  contactId?: string;
  companyId?: string;
  dealId?: string;
  leadId?: string;
  userId?: string[];
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

// ---- Radar ----
export type RadarSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type RadarRuleKey =
  | "OVERDUE_TASK"
  | "TASK_DUE_TODAY"
  | "LEAD_INACTIVE"
  | "DEAL_INACTIVE"
  | "DEAL_STAGE_STAGNANT"
  | "CONTACT_FOLLOWUP_DUE"
  | "HIGH_VALUE_CLOSING"
  | "MISSING_INFO";

export interface RadarItem {
  id: string; // ruleKey:entityId — stable id
  ruleKey: RadarRuleKey;
  severity: RadarSeverity;
  entityType: "lead" | "contact" | "company" | "deal" | "task";
  entityId: string;
  entity: {
    id: string;
    title: string;
    subtitle?: string | null;
    ownerId?: string | null;
    ownerName?: string | null;
  };
  // structured params for bilingual explanation rendering:
  params: Record<string, string | number>;
  suggestedAction: string; // i18n key suffix for suggested action
  actionLink: string; // client view link target
  date: string | null; // relevant date
  daysElapsed: number | null;
}

export interface RadarResponse {
  items: RadarItem[];
  counts: Record<RadarSeverity, number>;
  thresholds: {
    leadInactivityDays: number;
    dealInactivityDays: number;
    stageInactivityDays: number;
    highValueThreshold: number;
  };
  generatedAt: string;
}

// ---- Dashboard ----
export interface DashboardKpis {
  totalContacts: number;
  newLeads: number; // NEW status, not archived
  activeDeals: number;
  openPipelineValue: number;
  wonRevenue: number;
  conversionRate: number; // qualified+converted / total leads %
  overdueTasks: number;
  followUpsToday: number;
}

export interface SeriesPoint {
  date: string; // ISO date
  value: number;
}

export interface NamedValue {
  name: string; // literal name for user-created values
  key?: string; // stable key for localized labels (e.g. stage key, source key)
  value: number;
  extra?: number;
}

export interface DashboardResponse {
  kpis: DashboardKpis;
  leadsOverTime: SeriesPoint[];
  dealsByStage: NamedValue[];
  wonVsLost: NamedValue[];
  revenueOverTime: SeriesPoint[];
  leadSources: NamedValue[];
  taskCompletion: NamedValue[];
  priorities: {
    overdueTasks: Task[];
    dueToday: Task[];
    stagnantDeals: Deal[];
    recentActivity: Activity[];
    radarCritical: RadarItem[];
  };
  generatedAt: string;
}

// ---- Reports ----
export interface ReportFilters {
  from?: string;
  to?: string;
  ownerId?: string[];
  pipelineId?: string;
  source?: string[];
  stageId?: string[];
}

export interface LeadsReport {
  leadsOverTime: SeriesPoint[];
  bySource: NamedValue[];
  byStatus: NamedValue[];
  conversionRate: number;
  avgTimeToConvertDays: number | null;
  total: number;
}

export interface SalesReport {
  dealsByStage: NamedValue[];
  winRate: number | null;
  wonCount: number;
  lostCount: number;
  wonValue: number;
  lostValue: number;
  valueOverTime: SeriesPoint[];
  weightedPipelineValue: number;
  avgDealSize: number | null;
  avgCycleDays: number | null;
  lossReasons: NamedValue[];
  total: number;
}

export interface ProductivityReport {
  completedVsOverdue: NamedValue[];
  activitiesOverTime: SeriesPoint[];
  followUpsCompleted: number;
  workloadByOwner: NamedValue[];
  attentionDeals: number;
}

// ---- Automation ----
export type AutomationTrigger =
  | "LEAD_CREATED"
  | "DEAL_CREATED"
  | "DEAL_STAGE_CHANGED"
  | "TASK_OVERDUE"
  | "DEAL_INACTIVE"
  | "RECORD_ASSIGNED"
  | "STATUS_ENTERED";

export type AutomationActionType =
  | "CREATE_TASK"
  | "ADD_TAG"
  | "ASSIGN"
  | "NOTIFY"
  | "UPDATE_FIELD"
  | "LOG_EVENT";

export interface AutomationCondition {
  field: string; // value | stage | source | owner | priority
  operator: "equals" | "notEquals" | "greaterThan" | "lessThan" | "contains";
  value: string;
}

export interface AutomationAction {
  type: AutomationActionType;
  params: Record<string, string>;
}

export interface AutomationRule {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  triggerType: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  enabled: boolean;
  createdBy: string;
  lastRunAt: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationExecution {
  id: string;
  ruleId: string;
  ruleName: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  detail: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

// ---- Notifications ----
export interface NotificationItem {
  id: string;
  type: "ASSIGNMENT" | "TASK_DUE" | "AUTOMATION" | "RADAR" | "SYSTEM";
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

// ---- Search ----
export interface SearchResults {
  leads: { id: string; title: string; subtitle?: string | null }[];
  contacts: { id: string; title: string; subtitle?: string | null }[];
  companies: { id: string; title: string; subtitle?: string | null }[];
  deals: { id: string; title: string; subtitle?: string | null }[];
  tasks: { id: string; title: string; subtitle?: string | null }[];
  total: number;
}

// ---- Custom fields ----
export type CustomFieldType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT" | "MULTI_SELECT" | "URL";
export type CustomFieldEntity = "contact" | "company" | "deal" | "lead";

export interface CustomFieldDef {
  id: string;
  workspaceId: string;
  entityType: CustomFieldEntity;
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  options: string[];
  defaultValue: string | null;
  order: number;
  active: boolean;
}

export interface CustomFieldValueInfo {
  fieldId: string;
  key: string;
  label: string;
  type: CustomFieldType;
  value: string | null;
}

// ---- Saved views ----
export interface SavedView {
  id: string;
  name: string;
  entityType: string;
  filters: Record<string, unknown>;
  createdAt: string;
}

// ---- Settings ----
export interface WorkspaceSettings {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  radarLeadInactivityDays: number;
  radarDealInactivityDays: number;
  radarStageInactivityDays: number;
  radarHighValueThreshold: number;
}

// ---- API error format ----
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
