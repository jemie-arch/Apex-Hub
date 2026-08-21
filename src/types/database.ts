/**
 * Database types — GENERATED from the live schema, do not hand-edit.
 *
 * Regenerate after any change to supabase/migrations/0001_init.sql:
 *   npx supabase gen types typescript --project-id vgqvpikmudydgucrgulr
 *
 * Convenience aliases are at the foot of the file.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ad_level_insights: {
        Row: {
          ad_id: string
          campaign_id: string | null
          clicks: number
          client_id: string
          created_at: string
          frequency: number | null
          id: string
          impressions: number
          insight_on: string
          leads: number
          reach: number
          spend_cents: number
          updated_at: string
        }
        Insert: {
          ad_id: string
          campaign_id?: string | null
          clicks?: number
          client_id: string
          created_at?: string
          frequency?: number | null
          id?: string
          impressions?: number
          insight_on: string
          leads?: number
          reach?: number
          spend_cents?: number
          updated_at?: string
        }
        Update: {
          ad_id?: string
          campaign_id?: string | null
          clicks?: number
          client_id?: string
          created_at?: string
          frequency?: number | null
          id?: string
          impressions?: number
          insight_on?: string
          leads?: number
          reach?: number
          spend_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_level_insights_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_level_insights_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_level_insights_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_snapshots: {
        Row: {
          clicks: number
          client_id: string
          created_at: string
          id: string
          impressions: number
          leads: number
          platform: string
          reach: number
          snapshot_on: string
          spend_cents: number
          updated_at: string
        }
        Insert: {
          clicks?: number
          client_id: string
          created_at?: string
          id?: string
          impressions?: number
          leads?: number
          platform?: string
          reach?: number
          snapshot_on: string
          spend_cents?: number
          updated_at?: string
        }
        Update: {
          clicks?: number
          client_id?: string
          created_at?: string
          id?: string
          impressions?: number
          leads?: number
          platform?: string
          reach?: number
          snapshot_on?: string
          spend_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ads: {
        Row: {
          adset_external_id: string | null
          campaign_id: string | null
          client_id: string
          created_at: string
          creative_thumb_url: string | null
          external_id: string
          id: string
          name: string
          platform: string
          preview_url: string | null
          status: string | null
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          adset_external_id?: string | null
          campaign_id?: string | null
          client_id: string
          created_at?: string
          creative_thumb_url?: string | null
          external_id: string
          id?: string
          name: string
          platform?: string
          preview_url?: string | null
          status?: string | null
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          adset_external_id?: string | null
          campaign_id?: string | null
          client_id?: string
          created_at?: string
          creative_thumb_url?: string | null
          external_id?: string
          id?: string
          name?: string
          platform?: string
          preview_url?: string | null
          status?: string | null
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          ad_external_id: string | null
          address: string | null
          attribution_source: string | null
          booked_at: string | null
          booked_by_name: string | null
          booked_by_user_id: string | null
          campaign_external_id: string | null
          cancelled_at: string | null
          client_id: string
          created_at: string
          crm_appointment_id: string | null
          crm_calendar_id: string | null
          crm_contact_id: string | null
          funnel: Database["public"]["Enums"]["funnel"]
          id: string
          notes: string | null
          outcome: Database["public"]["Enums"]["appointment_outcome"]
          patient_email: string | null
          patient_name: string | null
          patient_phone: string | null
          reschedule_count: number
          rescheduled_from: string | null
          scheduled_at: string
          scheduled_end_at: string | null
          showed: boolean | null
          source: string
          status: Database["public"]["Enums"]["appointment_status"]
          synced_at: string | null
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          value_cents: number | null
        }
        Insert: {
          ad_external_id?: string | null
          address?: string | null
          attribution_source?: string | null
          booked_at?: string | null
          booked_by_name?: string | null
          booked_by_user_id?: string | null
          campaign_external_id?: string | null
          cancelled_at?: string | null
          client_id: string
          created_at?: string
          crm_appointment_id?: string | null
          crm_calendar_id?: string | null
          crm_contact_id?: string | null
          funnel?: Database["public"]["Enums"]["funnel"]
          id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["appointment_outcome"]
          patient_email?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          reschedule_count?: number
          rescheduled_from?: string | null
          scheduled_at: string
          scheduled_end_at?: string | null
          showed?: boolean | null
          source?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          synced_at?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          value_cents?: number | null
        }
        Update: {
          ad_external_id?: string | null
          address?: string | null
          attribution_source?: string | null
          booked_at?: string | null
          booked_by_name?: string | null
          booked_by_user_id?: string | null
          campaign_external_id?: string | null
          cancelled_at?: string | null
          client_id?: string
          created_at?: string
          crm_appointment_id?: string | null
          crm_calendar_id?: string | null
          crm_contact_id?: string | null
          funnel?: Database["public"]["Enums"]["funnel"]
          id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["appointment_outcome"]
          patient_email?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          reschedule_count?: number
          rescheduled_from?: string | null
          scheduled_at?: string
          scheduled_end_at?: string | null
          showed?: boolean | null
          source?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          synced_at?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          value_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_booked_by_user_id_fkey"
            columns: ["booked_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      call_recordings: {
        Row: {
          ai_action_items: Json
          ai_summary: string | null
          client_group_id: string | null
          created_at: string
          deal_id: string | null
          duration_seconds: number | null
          external_id: string
          id: string
          participants: Json
          provider: string
          recorded_at: string
          recording_url: string | null
          synced_at: string | null
          title: string | null
          transcript: string | null
          updated_at: string
        }
        Insert: {
          ai_action_items?: Json
          ai_summary?: string | null
          client_group_id?: string | null
          created_at?: string
          deal_id?: string | null
          duration_seconds?: number | null
          external_id: string
          id?: string
          participants?: Json
          provider: string
          recorded_at: string
          recording_url?: string | null
          synced_at?: string | null
          title?: string | null
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          ai_action_items?: Json
          ai_summary?: string | null
          client_group_id?: string | null
          created_at?: string
          deal_id?: string | null
          duration_seconds?: number | null
          external_id?: string
          id?: string
          participants?: Json
          provider?: string
          recorded_at?: string
          recording_url?: string | null
          synced_at?: string | null
          title?: string | null
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_recordings_client_group_id_fkey"
            columns: ["client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_recordings_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          client_id: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          crm_call_id: string | null
          crm_user_id: string | null
          deal_id: string | null
          direction: Database["public"]["Enums"]["call_direction"]
          duration_seconds: number
          id: string
          outcome: Database["public"]["Enums"]["call_outcome"] | null
          quality_score: number | null
          recording_url: string | null
          started_at: string
          synced_at: string | null
          user_id: string | null
        }
        Insert: {
          client_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          crm_call_id?: string | null
          crm_user_id?: string | null
          deal_id?: string | null
          direction?: Database["public"]["Enums"]["call_direction"]
          duration_seconds?: number
          id?: string
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          quality_score?: number | null
          recording_url?: string | null
          started_at: string
          synced_at?: string | null
          user_id?: string | null
        }
        Update: {
          client_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          crm_call_id?: string | null
          crm_user_id?: string | null
          deal_id?: string | null
          direction?: Database["public"]["Enums"]["call_direction"]
          duration_seconds?: number
          id?: string
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          quality_score?: number | null
          recording_url?: string | null
          started_at?: string
          synced_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          client_id: string
          created_at: string
          daily_budget_cents: number | null
          external_id: string
          id: string
          lifetime_budget_cents: number | null
          name: string
          objective: string | null
          platform: string
          started_at: string | null
          status: string | null
          stopped_at: string | null
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          daily_budget_cents?: number | null
          external_id: string
          id?: string
          lifetime_budget_cents?: number | null
          name: string
          objective?: string | null
          platform?: string
          started_at?: string | null
          status?: string | null
          stopped_at?: string | null
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          daily_budget_cents?: number | null
          external_id?: string
          id?: string
          lifetime_budget_cents?: number | null
          name?: string
          objective?: string | null
          platform?: string
          started_at?: string | null
          status?: string | null
          stopped_at?: string | null
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_groups: {
        Row: {
          churned_on: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          currency: string
          id: string
          name: string
          onboarding_stage: string
          portal_enabled: boolean
          portal_token: string
          retainer_cents: number
          signed_on: string | null
          slug: string
          started_on: string | null
          status: Database["public"]["Enums"]["client_status"]
          treatments: string[]
          updated_at: string
          website: string | null
        }
        Insert: {
          churned_on?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          id?: string
          name: string
          onboarding_stage?: string
          portal_enabled?: boolean
          portal_token?: string
          retainer_cents?: number
          signed_on?: string | null
          slug: string
          started_on?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          treatments?: string[]
          updated_at?: string
          website?: string | null
        }
        Update: {
          churned_on?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          id?: string
          name?: string
          onboarding_stage?: string
          portal_enabled?: boolean
          portal_token?: string
          retainer_cents?: number
          signed_on?: string | null
          slug?: string
          started_on?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          treatments?: string[]
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      client_notes: {
        Row: {
          author_name: string | null
          author_user_id: string | null
          body: string
          client_group_id: string
          created_at: string
          id: string
          pinned: boolean
          updated_at: string
        }
        Insert: {
          author_name?: string | null
          author_user_id?: string | null
          body: string
          client_group_id: string
          created_at?: string
          id?: string
          pinned?: boolean
          updated_at?: string
        }
        Update: {
          author_name?: string | null
          author_user_id?: string | null
          body?: string
          client_group_id?: string
          created_at?: string
          id?: string
          pinned?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_notes_client_group_id_fkey"
            columns: ["client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tasks: {
        Row: {
          assignee_user_id: string | null
          call_recording_id: string | null
          client_group_id: string
          completed_at: string | null
          created_at: string
          detail: string | null
          due_on: string | null
          id: string
          sla_due_at: string | null
          source: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_user_id?: string | null
          call_recording_id?: string | null
          client_group_id: string
          completed_at?: string | null
          created_at?: string
          detail?: string | null
          due_on?: string | null
          id?: string
          sla_due_at?: string | null
          source?: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_user_id?: string | null
          call_recording_id?: string | null
          client_group_id?: string
          completed_at?: string | null
          created_at?: string
          detail?: string | null
          due_on?: string | null
          id?: string
          sla_due_at?: string | null
          source?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tasks_assignee_user_id_fkey"
            columns: ["assignee_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tasks_call_recording_id_fkey"
            columns: ["call_recording_id"]
            isOneToOne: false
            referencedRelation: "call_recordings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tasks_client_group_id_fkey"
            columns: ["client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          ad_account_id: string | null
          area_code: string | null
          created_at: string
          crm_location_id: string | null
          group_id: string
          id: string
          is_active: boolean
          name: string
          scheduling_type: string | null
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          ad_account_id?: string | null
          area_code?: string | null
          created_at?: string
          crm_location_id?: string | null
          group_id: string
          id?: string
          is_active?: boolean
          name: string
          scheduling_type?: string | null
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          ad_account_id?: string | null
          area_code?: string | null
          created_at?: string
          crm_location_id?: string | null
          group_id?: string
          id?: string
          is_active?: boolean
          name?: string
          scheduling_type?: string | null
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          client_group_id: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          crm_contact_id: string | null
          crm_opportunity_id: string | null
          currency: string
          first_contact_at: string | null
          funnel: Database["public"]["Enums"]["funnel"]
          id: string
          lost_at: string | null
          lost_reason: string | null
          next_follow_up_at: string | null
          owner_user_id: string | null
          practice_name: string
          source: string | null
          stage: Database["public"]["Enums"]["deal_stage"]
          synced_at: string | null
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          value_cents: number | null
          won_at: string | null
        }
        Insert: {
          client_group_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          crm_contact_id?: string | null
          crm_opportunity_id?: string | null
          currency?: string
          first_contact_at?: string | null
          funnel?: Database["public"]["Enums"]["funnel"]
          id?: string
          lost_at?: string | null
          lost_reason?: string | null
          next_follow_up_at?: string | null
          owner_user_id?: string | null
          practice_name: string
          source?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          synced_at?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          value_cents?: number | null
          won_at?: string | null
        }
        Update: {
          client_group_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          crm_contact_id?: string | null
          crm_opportunity_id?: string | null
          currency?: string
          first_contact_at?: string | null
          funnel?: Database["public"]["Enums"]["funnel"]
          id?: string
          lost_at?: string | null
          lost_reason?: string | null
          next_follow_up_at?: string | null
          owner_user_id?: string | null
          practice_name?: string
          source?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          synced_at?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          value_cents?: number | null
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_client_group_id_fkey"
            columns: ["client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_entries: {
        Row: {
          amount_cents: number
          category: string
          client_group_id: string | null
          created_at: string
          currency: string
          external_id: string | null
          id: string
          kind: Database["public"]["Enums"]["finance_kind"]
          memo: string | null
          occurred_on: string
          source: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          category: string
          client_group_id?: string | null
          created_at?: string
          currency?: string
          external_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["finance_kind"]
          memo?: string | null
          occurred_on: string
          source?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          category?: string
          client_group_id?: string | null
          created_at?: string
          currency?: string
          external_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["finance_kind"]
          memo?: string | null
          occurred_on?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_entries_client_group_id_fkey"
            columns: ["client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          client_group_id: string | null
          client_id: string | null
          created_at: string
          crm_submission_id: string | null
          deal_id: string | null
          form_key: string
          id: string
          payload: Json
          submitted_at: string
        }
        Insert: {
          client_group_id?: string | null
          client_id?: string | null
          created_at?: string
          crm_submission_id?: string | null
          deal_id?: string | null
          form_key: string
          id?: string
          payload?: Json
          submitted_at?: string
        }
        Update: {
          client_group_id?: string | null
          client_id?: string | null
          created_at?: string
          crm_submission_id?: string | null
          deal_id?: string | null
          form_key?: string
          id?: string
          payload?: Json
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_client_group_id_fkey"
            columns: ["client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          href: string | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          href?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          href?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_tokens: {
        Row: {
          access_token: string
          client_id: string | null
          created_at: string
          crm_location_id: string | null
          expires_at: string | null
          id: string
          last_error: string | null
          meta: Json
          provider: string
          refresh_token: string | null
          refreshed_at: string | null
          scope: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          client_id?: string | null
          created_at?: string
          crm_location_id?: string | null
          expires_at?: string | null
          id?: string
          last_error?: string | null
          meta?: Json
          provider: string
          refresh_token?: string | null
          refreshed_at?: string | null
          scope?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          client_id?: string | null
          created_at?: string
          crm_location_id?: string | null
          expires_at?: string | null
          id?: string
          last_error?: string | null
          meta?: Json
          provider?: string
          refresh_token?: string | null
          refreshed_at?: string | null
          scope?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_calls: {
        Row: {
          closed_by_user_id: string | null
          created_at: string
          crm_appointment_id: string | null
          deal_id: string
          funnel: Database["public"]["Enums"]["funnel"]
          id: string
          notes: string | null
          outcome: Database["public"]["Enums"]["appointment_outcome"]
          reschedule_count: number
          rescheduled_from: string | null
          scheduled_at: string
          scheduled_end_at: string | null
          set_by_name: string | null
          set_by_user_id: string | null
          showed: boolean | null
          status: Database["public"]["Enums"]["appointment_status"]
          synced_at: string | null
          updated_at: string
          value_cents: number | null
        }
        Insert: {
          closed_by_user_id?: string | null
          created_at?: string
          crm_appointment_id?: string | null
          deal_id: string
          funnel?: Database["public"]["Enums"]["funnel"]
          id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["appointment_outcome"]
          reschedule_count?: number
          rescheduled_from?: string | null
          scheduled_at: string
          scheduled_end_at?: string | null
          set_by_name?: string | null
          set_by_user_id?: string | null
          showed?: boolean | null
          status?: Database["public"]["Enums"]["appointment_status"]
          synced_at?: string | null
          updated_at?: string
          value_cents?: number | null
        }
        Update: {
          closed_by_user_id?: string | null
          created_at?: string
          crm_appointment_id?: string | null
          deal_id?: string
          funnel?: Database["public"]["Enums"]["funnel"]
          id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["appointment_outcome"]
          reschedule_count?: number
          rescheduled_from?: string | null
          scheduled_at?: string
          scheduled_end_at?: string | null
          set_by_name?: string | null
          set_by_user_id?: string | null
          showed?: boolean | null
          status?: Database["public"]["Enums"]["appointment_status"]
          synced_at?: string | null
          updated_at?: string
          value_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_calls_closed_by_user_id_fkey"
            columns: ["closed_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_calls_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_calls_set_by_user_id_fkey"
            columns: ["set_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          client_id: string | null
          duration_ms: number | null
          ended_at: string | null
          error_count: number
          errors: Json
          id: string
          meta: Json
          name: string
          records_created: number
          records_read: number
          records_skipped: number
          records_updated: number
          started_at: string
          status: Database["public"]["Enums"]["sync_status"]
          triggered_by: Database["public"]["Enums"]["sync_trigger"]
        }
        Insert: {
          client_id?: string | null
          duration_ms?: number | null
          ended_at?: string | null
          error_count?: number
          errors?: Json
          id?: string
          meta?: Json
          name: string
          records_created?: number
          records_read?: number
          records_skipped?: number
          records_updated?: number
          started_at?: string
          status?: Database["public"]["Enums"]["sync_status"]
          triggered_by?: Database["public"]["Enums"]["sync_trigger"]
        }
        Update: {
          client_id?: string | null
          duration_ms?: number | null
          ended_at?: string | null
          error_count?: number
          errors?: Json
          id?: string
          meta?: Json
          name?: string
          records_created?: number
          records_read?: number
          records_skipped?: number
          records_updated?: number
          started_at?: string
          status?: Database["public"]["Enums"]["sync_status"]
          triggered_by?: Database["public"]["Enums"]["sync_trigger"]
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          client_group_id: string | null
          created_at: string
          crm_user_id: string | null
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          permissions: string[]
          role: Database["public"]["Enums"]["user_role"]
          theme: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          client_group_id?: string | null
          created_at?: string
          crm_user_id?: string | null
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          permissions?: string[]
          role?: Database["public"]["Enums"]["user_role"]
          theme?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          client_group_id?: string | null
          created_at?: string
          crm_user_id?: string | null
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          permissions?: string[]
          role?: Database["public"]["Enums"]["user_role"]
          theme?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_client_group_id_fkey"
            columns: ["client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_group_id: { Args: never; Returns: string }
      auth_is_admin: { Args: never; Returns: boolean }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      generate_portal_token: { Args: never; Returns: string }
    }
    Enums: {
      appointment_outcome:
        | "pending"
        | "quoted"
        | "won"
        | "lost"
        | "follow_up"
        | "unqualified"
      appointment_status:
        | "scheduled"
        | "confirmed"
        | "showed"
        | "no_show"
        | "cancelled"
        | "rescheduled"
      call_direction: "outbound" | "inbound"
      call_outcome:
        | "connected"
        | "no_answer"
        | "voicemail"
        | "busy"
        | "wrong_number"
        | "booked"
        | "not_interested"
      client_status: "onboarding" | "active" | "paused" | "churned"
      deal_stage:
        | "new"
        | "contacted"
        | "call_booked"
        | "call_showed"
        | "proposal"
        | "won"
        | "lost"
      finance_kind: "revenue" | "cost"
      funnel: "b2b" | "b2c"
      notification_kind: "info" | "success" | "warning" | "error"
      sync_status: "running" | "success" | "partial" | "error"
      sync_trigger: "cron" | "cli" | "api" | "manual"
      task_status: "open" | "in_progress" | "done" | "cancelled"
      user_role: "admin" | "isr" | "csr" | "client"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      appointment_outcome: [
        "pending",
        "quoted",
        "won",
        "lost",
        "follow_up",
        "unqualified",
      ],
      appointment_status: [
        "scheduled",
        "confirmed",
        "showed",
        "no_show",
        "cancelled",
        "rescheduled",
      ],
      call_direction: ["outbound", "inbound"],
      call_outcome: [
        "connected",
        "no_answer",
        "voicemail",
        "busy",
        "wrong_number",
        "booked",
        "not_interested",
      ],
      client_status: ["onboarding", "active", "paused", "churned"],
      deal_stage: [
        "new",
        "contacted",
        "call_booked",
        "call_showed",
        "proposal",
        "won",
        "lost",
      ],
      finance_kind: ["revenue", "cost"],
      funnel: ["b2b", "b2c"],
      notification_kind: ["info", "success", "warning", "error"],
      sync_status: ["running", "success", "partial", "error"],
      sync_trigger: ["cron", "cli", "api", "manual"],
      task_status: ["open", "in_progress", "done", "cancelled"],
      user_role: ["admin", "isr", "csr", "client"],
    },
  },
} as const

// ---------------------------------------------------------------------------
// Aliases built on the generated Tables<> and Enums<> helpers above.
//
// Do NOT declare local types named Tables or Enums here — the generator
// already exports those as generics, and shadowing them breaks every alias
// below with "Generic type requires between 1 and 2 type arguments".
//
// The distinction that matters: ClientGroupRow is the BUSINESS (a practice,
// the unit the 100-client goal counts); ClientRow is one GoHighLevel
// sub-account belonging to it.
// ---------------------------------------------------------------------------

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
