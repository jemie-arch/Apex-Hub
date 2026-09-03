/**
 * The types the app imports.
 *
 * The generated half lives in database.generated.ts and is overwritten wholesale
 * after every migration. The aliases below are hand-written, which is exactly
 * why they are NOT in that file: they were once appended to it and a later
 * regeneration silently deleted them, breaking twenty imports at once. Keeping
 * them here means a regeneration cannot touch them.
 *
 * Do NOT declare local types named Tables or Enums here — the generator already
 * exports those as generics, and shadowing them breaks every alias below with
 * "Generic type requires between 1 and 2 type arguments".
 *
 * The distinction that matters most: ClientGroupRow is the BUSINESS (a practice,
 * the unit the 100-client goal counts); ClientRow is one GoHighLevel sub-account
 * belonging to it.
 */
import type { Enums, Tables } from './database.generated';

export * from './database.generated';

export type ClientGroupRow = Tables<'client_groups'>;
export type ClientRow = Tables<'clients'>;
export type UserProfileRow = Tables<'user_profiles'>;
export type OauthTokenRow = Tables<'oauth_tokens'>;
export type DealRow = Tables<'deals'>;
export type SalesCallRow = Tables<'sales_calls'>;
export type AppointmentRow = Tables<'appointments'>;
export type CampaignRow = Tables<'campaigns'>;
export type AdRow = Tables<'ads'>;
export type AdSnapshotRow = Tables<'ad_snapshots'>;
export type AdLevelInsightRow = Tables<'ad_level_insights'>;
export type CallRow = Tables<'calls'>;
export type CallRecordingRow = Tables<'call_recordings'>;
export type FormSubmissionRow = Tables<'form_submissions'>;
export type ClientNoteRow = Tables<'client_notes'>;
export type ClientTaskRow = Tables<'client_tasks'>;
export type NotificationRow = Tables<'notifications'>;
export type FinanceEntryRow = Tables<'finance_entries'>;
export type AppSettingRow = Tables<'app_settings'>;
export type SyncRunRow = Tables<'sync_runs'>;

// The company pages: leads, the agency's own ad economics, projects, team and
// tech calls.
export type B2bLeadRow = Tables<'b2b_leads'>;
export type B2bAdDayRow = Tables<'b2b_ad_days'>;
export type ProjectRow = Tables<'projects'>;
export type ProjectNoteRow = Tables<'project_notes'>;
export type TimeOffRequestRow = Tables<'time_off_requests'>;
export type TechCallRow = Tables<'tech_calls'>;
export type TechTicketRow = Tables<'tech_tickets'>;
export type TechTicketCommentRow = Tables<'tech_ticket_comments'>;
export type TechTicketCandidateRow = Tables<'tech_ticket_candidates'>;

export type UserRole = Enums<'user_role'>;
export type Funnel = Enums<'funnel'>;
export type ClientStatus = Enums<'client_status'>;
export type AppointmentStatus = Enums<'appointment_status'>;
export type AppointmentOutcome = Enums<'appointment_outcome'>;
export type DealStage = Enums<'deal_stage'>;
export type CallDirection = Enums<'call_direction'>;
export type CallOutcome = Enums<'call_outcome'>;
export type TaskStatus = Enums<'task_status'>;
export type NotificationKind = Enums<'notification_kind'>;
export type FinanceKind = Enums<'finance_kind'>;
export type SyncStatus = Enums<'sync_status'>;
export type SyncTrigger = Enums<'sync_trigger'>;

export type LeadClassification = Enums<'lead_classification'>;
export type ProjectStatus = Enums<'project_status'>;
export type TimeOffKind = Enums<'time_off_kind'>;
export type RequestStatus = Enums<'request_status'>;
export type TechCallStatus = Enums<'tech_call_status'>;
export type TechTicketStatus = Enums<'tech_ticket_status'>;
export type TechTicketPriority = Enums<'tech_ticket_priority'>;
