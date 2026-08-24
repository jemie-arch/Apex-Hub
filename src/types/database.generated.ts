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
      appointment_ledger: {
        Row: {
          amount_cents: number | null
          appointment_at: string | null
          attempt_number: number
          billed_at: string | null
          billing_hold_reason: string | null
          billing_state: Database["public"]["Enums"]["ledger_billing_state"]
          booked_at: string | null
          booked_by_name: string | null
          calendar_seen_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_calendar_checked_at: string | null
          client_calendar_state: string | null
          client_id: string
          confirmation_channel: string | null
          confirmed_at: string | null
          created_at: string
          crm_appointment_id: string | null
          dispositioned_at: string | null
          hp_appointment_id: string | null
          id: string
          last_seen_in_crm_at: string | null
          missing_since: string | null
          outcome: Database["public"]["Enums"]["ledger_outcome"]
          outcome_at: string | null
          outcome_defaulted: boolean
          outcome_due_at: string | null
          outcome_source:
            | Database["public"]["Enums"]["ledger_outcome_source"]
            | null
          patient_email: string | null
          patient_name: string | null
          patient_phone: string | null
          raw_disposition: string | null
          reschedule_of: string | null
          seen_in: Json
          source: Database["public"]["Enums"]["ledger_source"]
          stripe_payment_intent_id: string | null
          tracker_source_row: number | null
          tracker_source_tab: string | null
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          appointment_at?: string | null
          attempt_number?: number
          billed_at?: string | null
          billing_hold_reason?: string | null
          billing_state?: Database["public"]["Enums"]["ledger_billing_state"]
          booked_at?: string | null
          booked_by_name?: string | null
          calendar_seen_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_calendar_checked_at?: string | null
          client_calendar_state?: string | null
          client_id: string
          confirmation_channel?: string | null
          confirmed_at?: string | null
          created_at?: string
          crm_appointment_id?: string | null
          dispositioned_at?: string | null
          hp_appointment_id?: string | null
          id?: string
          last_seen_in_crm_at?: string | null
          missing_since?: string | null
          outcome?: Database["public"]["Enums"]["ledger_outcome"]
          outcome_at?: string | null
          outcome_defaulted?: boolean
          outcome_due_at?: string | null
          outcome_source?:
            | Database["public"]["Enums"]["ledger_outcome_source"]
            | null
          patient_email?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          raw_disposition?: string | null
          reschedule_of?: string | null
          seen_in?: Json
          source?: Database["public"]["Enums"]["ledger_source"]
          stripe_payment_intent_id?: string | null
          tracker_source_row?: number | null
          tracker_source_tab?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          appointment_at?: string | null
          attempt_number?: number
          billed_at?: string | null
          billing_hold_reason?: string | null
          billing_state?: Database["public"]["Enums"]["ledger_billing_state"]
          booked_at?: string | null
          booked_by_name?: string | null
          calendar_seen_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_calendar_checked_at?: string | null
          client_calendar_state?: string | null
          client_id?: string
          confirmation_channel?: string | null
          confirmed_at?: string | null
          created_at?: string
          crm_appointment_id?: string | null
          dispositioned_at?: string | null
          hp_appointment_id?: string | null
          id?: string
          last_seen_in_crm_at?: string | null
          missing_since?: string | null
          outcome?: Database["public"]["Enums"]["ledger_outcome"]
          outcome_at?: string | null
          outcome_defaulted?: boolean
          outcome_due_at?: string | null
          outcome_source?:
            | Database["public"]["Enums"]["ledger_outcome_source"]
            | null
          patient_email?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          raw_disposition?: string | null
          reschedule_of?: string | null
          seen_in?: Json
          source?: Database["public"]["Enums"]["ledger_source"]
          stripe_payment_intent_id?: string | null
          tracker_source_row?: number | null
          tracker_source_tab?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_ledger_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_ledger_reschedule_of_fkey"
            columns: ["reschedule_of"]
            isOneToOne: false
            referencedRelation: "appointment_exceptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_ledger_reschedule_of_fkey"
            columns: ["reschedule_of"]
            isOneToOne: false
            referencedRelation: "appointment_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_ledger_reschedule_of_fkey"
            columns: ["reschedule_of"]
            isOneToOne: false
            referencedRelation: "unbilled_backlog"
            referencedColumns: ["ledger_id"]
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
          cc_on_file: boolean | null
          client_id: string
          created_at: string
          crm_appointment_id: string | null
          crm_calendar_id: string | null
          crm_contact_id: string | null
          financing_approved: boolean | null
          funnel: Database["public"]["Enums"]["funnel"]
          id: string
          lead_quality: Database["public"]["Enums"]["lead_quality"] | null
          notes: string | null
          outcome: Database["public"]["Enums"]["appointment_outcome"]
          outcome_updated_at: string | null
          patient_email: string | null
          patient_name: string | null
          patient_phone: string | null
          reschedule_count: number
          rescheduled_from: string | null
          scheduled_at: string
          scheduled_end_at: string | null
          second_consult_showed: boolean | null
          showed: boolean | null
          showed_source: string | null
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
          cc_on_file?: boolean | null
          client_id: string
          created_at?: string
          crm_appointment_id?: string | null
          crm_calendar_id?: string | null
          crm_contact_id?: string | null
          financing_approved?: boolean | null
          funnel?: Database["public"]["Enums"]["funnel"]
          id?: string
          lead_quality?: Database["public"]["Enums"]["lead_quality"] | null
          notes?: string | null
          outcome?: Database["public"]["Enums"]["appointment_outcome"]
          outcome_updated_at?: string | null
          patient_email?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          reschedule_count?: number
          rescheduled_from?: string | null
          scheduled_at: string
          scheduled_end_at?: string | null
          second_consult_showed?: boolean | null
          showed?: boolean | null
          showed_source?: string | null
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
          cc_on_file?: boolean | null
          client_id?: string
          created_at?: string
          crm_appointment_id?: string | null
          crm_calendar_id?: string | null
          crm_contact_id?: string | null
          financing_approved?: boolean | null
          funnel?: Database["public"]["Enums"]["funnel"]
          id?: string
          lead_quality?: Database["public"]["Enums"]["lead_quality"] | null
          notes?: string | null
          outcome?: Database["public"]["Enums"]["appointment_outcome"]
          outcome_updated_at?: string | null
          patient_email?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          reschedule_count?: number
          rescheduled_from?: string | null
          scheduled_at?: string
          scheduled_end_at?: string | null
          second_consult_showed?: boolean | null
          showed?: boolean | null
          showed_source?: string | null
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
      appointments_excluded: {
        Row: {
          ad_external_id: string | null
          address: string | null
          attribution_source: string | null
          booked_at: string | null
          booked_by_name: string | null
          booked_by_user_id: string | null
          calendar_name: string | null
          campaign_external_id: string | null
          cancelled_at: string | null
          client_id: string
          created_at: string
          crm_appointment_id: string | null
          crm_calendar_id: string | null
          crm_contact_id: string | null
          excluded_at: string
          financing_approved: boolean | null
          funnel: Database["public"]["Enums"]["funnel"]
          id: string
          lead_quality: Database["public"]["Enums"]["lead_quality"] | null
          notes: string | null
          outcome: Database["public"]["Enums"]["appointment_outcome"]
          outcome_updated_at: string | null
          patient_email: string | null
          patient_name: string | null
          patient_phone: string | null
          reason: string
          reschedule_count: number
          rescheduled_from: string | null
          scheduled_at: string
          scheduled_end_at: string | null
          showed: boolean | null
          showed_source: string | null
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
          calendar_name?: string | null
          campaign_external_id?: string | null
          cancelled_at?: string | null
          client_id: string
          created_at?: string
          crm_appointment_id?: string | null
          crm_calendar_id?: string | null
          crm_contact_id?: string | null
          excluded_at?: string
          financing_approved?: boolean | null
          funnel?: Database["public"]["Enums"]["funnel"]
          id?: string
          lead_quality?: Database["public"]["Enums"]["lead_quality"] | null
          notes?: string | null
          outcome?: Database["public"]["Enums"]["appointment_outcome"]
          outcome_updated_at?: string | null
          patient_email?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          reason: string
          reschedule_count?: number
          rescheduled_from?: string | null
          scheduled_at: string
          scheduled_end_at?: string | null
          showed?: boolean | null
          showed_source?: string | null
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
          calendar_name?: string | null
          campaign_external_id?: string | null
          cancelled_at?: string | null
          client_id?: string
          created_at?: string
          crm_appointment_id?: string | null
          crm_calendar_id?: string | null
          crm_contact_id?: string | null
          excluded_at?: string
          financing_approved?: boolean | null
          funnel?: Database["public"]["Enums"]["funnel"]
          id?: string
          lead_quality?: Database["public"]["Enums"]["lead_quality"] | null
          notes?: string | null
          outcome?: Database["public"]["Enums"]["appointment_outcome"]
          outcome_updated_at?: string | null
          patient_email?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          reason?: string
          reschedule_count?: number
          rescheduled_from?: string | null
          scheduled_at?: string
          scheduled_end_at?: string | null
          showed?: boolean | null
          showed_source?: string | null
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
        Relationships: []
      }
      b2b_ad_days: {
        Row: {
          ad_name: string
          bookings: number
          campaign_name: string
          cash_collected_cents: number
          clicks: number
          closed: number
          created_at: string
          currency: string
          day: string
          external_id: string | null
          id: string
          impressions: number
          leads: number
          platform: string
          qualified_calls: number
          showed: number
          source: string
          spend_cents: number
          updated_at: string
        }
        Insert: {
          ad_name?: string
          bookings?: number
          campaign_name: string
          cash_collected_cents?: number
          clicks?: number
          closed?: number
          created_at?: string
          currency?: string
          day: string
          external_id?: string | null
          id?: string
          impressions?: number
          leads?: number
          platform?: string
          qualified_calls?: number
          showed?: number
          source?: string
          spend_cents?: number
          updated_at?: string
        }
        Update: {
          ad_name?: string
          bookings?: number
          campaign_name?: string
          cash_collected_cents?: number
          clicks?: number
          closed?: number
          created_at?: string
          currency?: string
          day?: string
          external_id?: string | null
          id?: string
          impressions?: number
          leads?: number
          platform?: string
          qualified_calls?: number
          showed?: number
          source?: string
          spend_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      b2b_leads: {
        Row: {
          ad_name: string | null
          campaign_name: string | null
          channel: string
          classification: Database["public"]["Enums"]["lead_classification"]
          created_at: string
          crm_contact_id: string | null
          deal_id: string | null
          email: string | null
          external_id: string | null
          id: string
          name: string | null
          notes: string | null
          origin: Database["public"]["Enums"]["lead_origin"]
          owner_user_id: string | null
          phone: string | null
          practice_name: string | null
          received_at: string
          source: string
          updated_at: string
        }
        Insert: {
          ad_name?: string | null
          campaign_name?: string | null
          channel?: string
          classification?: Database["public"]["Enums"]["lead_classification"]
          created_at?: string
          crm_contact_id?: string | null
          deal_id?: string | null
          email?: string | null
          external_id?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          origin?: Database["public"]["Enums"]["lead_origin"]
          owner_user_id?: string | null
          phone?: string | null
          practice_name?: string | null
          received_at?: string
          source?: string
          updated_at?: string
        }
        Update: {
          ad_name?: string | null
          campaign_name?: string | null
          channel?: string
          classification?: Database["public"]["Enums"]["lead_classification"]
          created_at?: string
          crm_contact_id?: string | null
          deal_id?: string | null
          email?: string | null
          external_id?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          origin?: Database["public"]["Enums"]["lead_origin"]
          owner_user_id?: string | null
          phone?: string | null
          practice_name?: string | null
          received_at?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "b2b_leads_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_leads_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_charges: {
        Row: {
          amount_cents: number
          client_id: string | null
          consult_count: number
          consult_names: string[]
          created_at: string
          currency: string
          decline_code: string | null
          description: string | null
          error_code: string | null
          error_message: string | null
          occurred_at: string
          outcome: Database["public"]["Enums"]["billing_outcome"]
          stripe_customer_id: string | null
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string
          stripe_status: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          client_id?: string | null
          consult_count?: number
          consult_names?: string[]
          created_at?: string
          currency?: string
          decline_code?: string | null
          description?: string | null
          error_code?: string | null
          error_message?: string | null
          occurred_at: string
          outcome: Database["public"]["Enums"]["billing_outcome"]
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id: string
          stripe_status: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          client_id?: string | null
          consult_count?: number
          consult_names?: string[]
          created_at?: string
          currency?: string
          decline_code?: string | null
          description?: string | null
          error_code?: string | null
          error_message?: string | null
          occurred_at?: string
          outcome?: Database["public"]["Enums"]["billing_outcome"]
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string
          stripe_status?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_charges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_charges_stripe_customer_id_fkey"
            columns: ["stripe_customer_id"]
            isOneToOne: false
            referencedRelation: "billing_customers"
            referencedColumns: ["stripe_customer_id"]
          },
        ]
      }
      billing_customers: {
        Row: {
          client_id: string | null
          email: string | null
          first_seen_at: string
          group_id: string | null
          mapped_by_hand: boolean
          name: string | null
          stripe_customer_id: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          email?: string | null
          first_seen_at?: string
          group_id?: string | null
          mapped_by_hand?: boolean
          name?: string | null
          stripe_customer_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          email?: string | null
          first_seen_at?: string
          group_id?: string | null
          mapped_by_hand?: boolean
          name?: string | null
          stripe_customer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_customers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_customers_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
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
          lead_created_at: string | null
          outcome: Database["public"]["Enums"]["call_outcome"] | null
          quality_score: number | null
          recording_url: string | null
          speed_to_lead_minutes: number | null
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
          lead_created_at?: string | null
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          quality_score?: number | null
          recording_url?: string | null
          speed_to_lead_minutes?: number | null
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
          lead_created_at?: string | null
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          quality_score?: number | null
          recording_url?: string | null
          speed_to_lead_minutes?: number | null
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
          address_line1: string | null
          address_line2: string | null
          churned_on: string | null
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          country: string | null
          created_at: string
          csm_user_id: string | null
          currency: string
          details_updated_at: string | null
          id: string
          is_internal: boolean
          launch_call_at: string | null
          name: string
          onboarding_added_at: string
          onboarding_call_at: string | null
          onboarding_stage: string
          onboarding_status: Database["public"]["Enums"]["onboarding_status"]
          opening_hours: Json
          portal_enabled: boolean
          portal_token: string
          postal_code: string | null
          region: string | null
          retainer_cents: number
          signed_on: string | null
          slug: string
          started_on: string | null
          status: Database["public"]["Enums"]["client_status"]
          status_set_by: string | null
          status_set_manually_at: string | null
          treatments: string[]
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          churned_on?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          csm_user_id?: string | null
          currency?: string
          details_updated_at?: string | null
          id?: string
          is_internal?: boolean
          launch_call_at?: string | null
          name: string
          onboarding_added_at?: string
          onboarding_call_at?: string | null
          onboarding_stage?: string
          onboarding_status?: Database["public"]["Enums"]["onboarding_status"]
          opening_hours?: Json
          portal_enabled?: boolean
          portal_token?: string
          postal_code?: string | null
          region?: string | null
          retainer_cents?: number
          signed_on?: string | null
          slug: string
          started_on?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          status_set_by?: string | null
          status_set_manually_at?: string | null
          treatments?: string[]
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          churned_on?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          csm_user_id?: string | null
          currency?: string
          details_updated_at?: string | null
          id?: string
          is_internal?: boolean
          launch_call_at?: string | null
          name?: string
          onboarding_added_at?: string
          onboarding_call_at?: string | null
          onboarding_stage?: string
          onboarding_status?: Database["public"]["Enums"]["onboarding_status"]
          opening_hours?: Json
          portal_enabled?: boolean
          portal_token?: string
          postal_code?: string | null
          region?: string | null
          retainer_cents?: number
          signed_on?: string | null
          slug?: string
          started_on?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          status_set_by?: string | null
          status_set_manually_at?: string | null
          treatments?: string[]
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_groups_csm_user_id_fkey"
            columns: ["csm_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_groups_status_set_by_fkey"
            columns: ["status_set_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
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
          origin: Database["public"]["Enums"]["lead_origin"]
          owner_user_id: string | null
          pipeline_name: string | null
          practice_name: string
          source: string | null
          stage: Database["public"]["Enums"]["deal_stage"]
          stage_name: string | null
          synced_at: string | null
          tags: string[]
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
          origin?: Database["public"]["Enums"]["lead_origin"]
          owner_user_id?: string | null
          pipeline_name?: string | null
          practice_name: string
          source?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          stage_name?: string | null
          synced_at?: string | null
          tags?: string[]
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
          origin?: Database["public"]["Enums"]["lead_origin"]
          owner_user_id?: string | null
          pipeline_name?: string | null
          practice_name?: string
          source?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          stage_name?: string | null
          synced_at?: string | null
          tags?: string[]
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
      excluded_calendars: {
        Row: {
          calendar_name: string | null
          client_id: string | null
          crm_calendar_id: string
          excluded_at: string
          reason: string
        }
        Insert: {
          calendar_name?: string | null
          client_id?: string | null
          crm_calendar_id: string
          excluded_at?: string
          reason: string
        }
        Update: {
          calendar_name?: string | null
          client_id?: string | null
          crm_calendar_id?: string
          excluded_at?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "excluded_calendars_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
          clinic_name: string | null
          contact_crm_id: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          crm_submission_id: string | null
          deal_id: string | null
          form_key: string
          id: string
          is_test: boolean
          match_method: string | null
          name_source: string | null
          payload: Json
          person_name: string | null
          source_location_id: string | null
          stripe_customer_id: string | null
          submitted_at: string
          suggested_group_id: string | null
        }
        Insert: {
          client_group_id?: string | null
          client_id?: string | null
          clinic_name?: string | null
          contact_crm_id?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          crm_submission_id?: string | null
          deal_id?: string | null
          form_key: string
          id?: string
          is_test?: boolean
          match_method?: string | null
          name_source?: string | null
          payload?: Json
          person_name?: string | null
          source_location_id?: string | null
          stripe_customer_id?: string | null
          submitted_at?: string
          suggested_group_id?: string | null
        }
        Update: {
          client_group_id?: string | null
          client_id?: string | null
          clinic_name?: string | null
          contact_crm_id?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          crm_submission_id?: string | null
          deal_id?: string | null
          form_key?: string
          id?: string
          is_test?: boolean
          match_method?: string | null
          name_source?: string | null
          payload?: Json
          person_name?: string | null
          source_location_id?: string | null
          stripe_customer_id?: string | null
          submitted_at?: string
          suggested_group_id?: string | null
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
          {
            foreignKeyName: "form_submissions_suggested_group_id_fkey"
            columns: ["suggested_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      included_calendars: {
        Row: {
          calendar_name: string
          client_id: string
          confirmed_by: string
          crm_calendar_id: string | null
          included_at: string
          reason: string
        }
        Insert: {
          calendar_name: string
          client_id: string
          confirmed_by: string
          crm_calendar_id?: string | null
          included_at?: string
          reason: string
        }
        Update: {
          calendar_name?: string
          client_id?: string
          confirmed_by?: string
          crm_calendar_id?: string | null
          included_at?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "included_calendars_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      onboarding_activity: {
        Row: {
          actor_name: string | null
          actor_user_id: string | null
          client_group_id: string
          created_at: string
          detail: string
          id: string
          kind: string
        }
        Insert: {
          actor_name?: string | null
          actor_user_id?: string | null
          client_group_id: string
          created_at?: string
          detail: string
          id?: string
          kind: string
        }
        Update: {
          actor_name?: string | null
          actor_user_id?: string | null
          client_group_id?: string
          created_at?: string
          detail?: string
          id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_activity_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_activity_client_group_id_fkey"
            columns: ["client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_step_state: {
        Row: {
          asset_url: string | null
          client_group_id: string
          done_at: string | null
          done_by: string | null
          note: string | null
          step_key: string
          updated_at: string
        }
        Insert: {
          asset_url?: string | null
          client_group_id: string
          done_at?: string | null
          done_by?: string | null
          note?: string | null
          step_key: string
          updated_at?: string
        }
        Update: {
          asset_url?: string | null
          client_group_id?: string
          done_at?: string | null
          done_by?: string | null
          note?: string | null
          step_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_step_state_client_group_id_fkey"
            columns: ["client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_step_state_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_step_template: {
        Row: {
          automated: boolean
          group_key: string
          group_label: string
          is_active: boolean
          label: string
          sort_order: number
          step_key: string
        }
        Insert: {
          automated?: boolean
          group_key: string
          group_label: string
          is_active?: boolean
          label: string
          sort_order: number
          step_key: string
        }
        Update: {
          automated?: boolean
          group_key?: string
          group_label?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          step_key?: string
        }
        Relationships: []
      }
      project_notes: {
        Row: {
          author_user_id: string | null
          body: string
          created_at: string
          id: string
          project_id: string
        }
        Insert: {
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          project_id: string
        }
        Update: {
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_notes_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client_group_id: string | null
          created_at: string
          due_on: string | null
          id: string
          owner_user_id: string | null
          position: number
          status: Database["public"]["Enums"]["project_status"]
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          client_group_id?: string | null
          created_at?: string
          due_on?: string | null
          id?: string
          owner_user_id?: string | null
          position?: number
          status?: Database["public"]["Enums"]["project_status"]
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          client_group_id?: string | null
          created_at?: string
          due_on?: string | null
          id?: string
          owner_user_id?: string | null
          position?: number
          status?: Database["public"]["Enums"]["project_status"]
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_group_id_fkey"
            columns: ["client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provisioning_runs: {
        Row: {
          auth_kind: string | null
          client_group_id: string | null
          clinic_name: string
          created_at: string
          crm_location_id: string | null
          error: string | null
          id: string
          scope_problem: boolean
          snapshot_id: string
          started_by: string | null
          status: string
          submission_id: string | null
          values_failed: Json
          values_missing: string[]
          values_written: string[]
        }
        Insert: {
          auth_kind?: string | null
          client_group_id?: string | null
          clinic_name: string
          created_at?: string
          crm_location_id?: string | null
          error?: string | null
          id?: string
          scope_problem?: boolean
          snapshot_id: string
          started_by?: string | null
          status: string
          submission_id?: string | null
          values_failed?: Json
          values_missing?: string[]
          values_written?: string[]
        }
        Update: {
          auth_kind?: string | null
          client_group_id?: string | null
          clinic_name?: string
          created_at?: string
          crm_location_id?: string | null
          error?: string | null
          id?: string
          scope_problem?: boolean
          snapshot_id?: string
          started_by?: string | null
          status?: string
          submission_id?: string | null
          values_failed?: Json
          values_missing?: string[]
          values_written?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "provisioning_runs_client_group_id_fkey"
            columns: ["client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provisioning_runs_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provisioning_runs_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
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
      tech_calls: {
        Row: {
          client_group_id: string | null
          client_id: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          crm_appointment_id: string | null
          detail: string | null
          id: string
          requested_at: string
          requested_by: string | null
          resolution: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["tech_call_status"]
          topic: string
          updated_at: string
        }
        Insert: {
          client_group_id?: string | null
          client_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          crm_appointment_id?: string | null
          detail?: string | null
          id?: string
          requested_at?: string
          requested_by?: string | null
          resolution?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["tech_call_status"]
          topic: string
          updated_at?: string
        }
        Update: {
          client_group_id?: string | null
          client_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          crm_appointment_id?: string | null
          detail?: string | null
          id?: string
          requested_at?: string
          requested_by?: string | null
          resolution?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["tech_call_status"]
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tech_calls_client_group_id_fkey"
            columns: ["client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tech_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tech_calls_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      time_off_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          ends_on: string
          id: string
          kind: Database["public"]["Enums"]["time_off_kind"]
          note: string | null
          starts_on: string
          status: Database["public"]["Enums"]["request_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          ends_on: string
          id?: string
          kind?: Database["public"]["Enums"]["time_off_kind"]
          note?: string | null
          starts_on: string
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          ends_on?: string
          id?: string
          kind?: Database["public"]["Enums"]["time_off_kind"]
          note?: string | null
          starts_on?: string
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_off_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_off_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tracker_appointments: {
        Row: {
          ad_external_id: string | null
          adset_external_id: string | null
          amount_spent_cents: number | null
          appointment_status: string | null
          booked_for: string | null
          campaign_external_id: string | null
          client_id: string | null
          created_on: string | null
          id: string
          imported_at: string
          location_name: string
          offer_name: string | null
          patient_email: string | null
          patient_name: string | null
          source_row: number
          status_if_showed: string | null
        }
        Insert: {
          ad_external_id?: string | null
          adset_external_id?: string | null
          amount_spent_cents?: number | null
          appointment_status?: string | null
          booked_for?: string | null
          campaign_external_id?: string | null
          client_id?: string | null
          created_on?: string | null
          id?: string
          imported_at?: string
          location_name: string
          offer_name?: string | null
          patient_email?: string | null
          patient_name?: string | null
          source_row: number
          status_if_showed?: string | null
        }
        Update: {
          ad_external_id?: string | null
          adset_external_id?: string | null
          amount_spent_cents?: number | null
          appointment_status?: string | null
          booked_for?: string | null
          campaign_external_id?: string | null
          client_id?: string | null
          created_on?: string | null
          id?: string
          imported_at?: string
          location_name?: string
          offer_name?: string | null
          patient_email?: string | null
          patient_name?: string | null
          source_row?: number
          status_if_showed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tracker_appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      tracker_leads: {
        Row: {
          ad_external_id: string | null
          ad_name: string | null
          adset_external_id: string | null
          adset_name: string | null
          campaign_external_id: string | null
          campaign_name: string | null
          client_id: string | null
          company_name: string
          id: string
          imported_at: string
          lead_count: number | null
          lead_name: string | null
          received_on: string | null
          source_row: number
          source_tab: string
        }
        Insert: {
          ad_external_id?: string | null
          ad_name?: string | null
          adset_external_id?: string | null
          adset_name?: string | null
          campaign_external_id?: string | null
          campaign_name?: string | null
          client_id?: string | null
          company_name: string
          id?: string
          imported_at?: string
          lead_count?: number | null
          lead_name?: string | null
          received_on?: string | null
          source_row: number
          source_tab?: string
        }
        Update: {
          ad_external_id?: string | null
          ad_name?: string | null
          adset_external_id?: string | null
          adset_name?: string | null
          campaign_external_id?: string | null
          campaign_name?: string | null
          client_id?: string | null
          company_name?: string
          id?: string
          imported_at?: string
          lead_count?: number | null
          lead_name?: string | null
          received_on?: string | null
          source_row?: number
          source_tab?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracker_leads_client_id_fkey"
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
          job_title: string | null
          permissions: string[]
          role: Database["public"]["Enums"]["user_role"]
          started_on: string | null
          theme: string
          timezone: string | null
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
          job_title?: string | null
          permissions?: string[]
          role?: Database["public"]["Enums"]["user_role"]
          started_on?: string | null
          theme?: string
          timezone?: string | null
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
          job_title?: string | null
          permissions?: string[]
          role?: Database["public"]["Enums"]["user_role"]
          started_on?: string | null
          theme?: string
          timezone?: string | null
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
      appointment_exceptions: {
        Row: {
          amount_cents: number | null
          appointment_at: string | null
          billing_state:
            | Database["public"]["Enums"]["ledger_billing_state"]
            | null
          client_id: string | null
          exception: string | null
          id: string | null
          outcome: Database["public"]["Enums"]["ledger_outcome"] | null
          outcome_due_at: string | null
          outcome_source:
            | Database["public"]["Enums"]["ledger_outcome_source"]
            | null
          patient_name: string | null
          practice: string | null
          severity: number | null
          source: Database["public"]["Enums"]["ledger_source"] | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_ledger_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      charge_exceptions: {
        Row: {
          candidate_name: string | null
          client_id: string | null
          exception: string | null
          line_amount_cents: number | null
          occurred_at: string | null
          patient_name: string | null
          practice: string | null
          severity: number | null
          stripe_payment_intent_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_charges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_rate_card: {
        Row: {
          client_id: string | null
          confidence: string | null
          implied_base_cents: number | null
          lines_at_this_rate: number | null
          lines_total: number | null
          practice: string | null
          unit_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_charges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      unbilled_backlog: {
        Row: {
          age_band: string | null
          appointment_at: string | null
          client_id: string | null
          client_status: Database["public"]["Enums"]["client_status"] | null
          days_old: number | null
          est_value_cents: number | null
          is_aged: boolean | null
          ledger_id: string | null
          patient_name: string | null
          practice: string | null
          rate_basis: string | null
          rate_confidence: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_ledger_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      unbilled_backlog_by_practice: {
        Row: {
          aged_shows: number | null
          client_id: string | null
          client_status: Database["public"]["Enums"]["client_status"] | null
          est_value_cents: number | null
          oldest_days: number | null
          partly_assumed: boolean | null
          practice: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_ledger_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      attribute_billing_charges: { Args: never; Returns: Json }
      attribute_ledger_charges: { Args: never; Returns: number }
      auth_group_id: { Args: never; Returns: string }
      auth_is_admin: { Args: never; Returns: boolean }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      generate_portal_token: { Args: never; Returns: string }
      onboarding_status_for: {
        Args: { p_group: string }
        Returns: Database["public"]["Enums"]["onboarding_status"]
      }
      rebuild_appointment_ledger: { Args: never; Returns: Json }
      refresh_client_statuses: { Args: never; Returns: number }
      refresh_onboarding_status: {
        Args: { p_group: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      squash_practice_name: { Args: { t: string }; Returns: string }
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
      billing_outcome: "succeeded" | "failed" | "pending" | "canceled"
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
        | "nurture"
      finance_kind: "revenue" | "cost"
      funnel: "b2b" | "b2c"
      lead_classification:
        | "unclassified"
        | "qualified"
        | "unqualified"
        | "nurture"
        | "duplicate"
        | "spam"
      lead_origin: "referral" | "organic" | "paid" | "outbound" | "unknown"
      lead_quality: "high" | "medium" | "low" | "unusable"
      ledger_billing_state:
        | "pending"
        | "billable"
        | "billed"
        | "waived"
        | "disputed"
        | "on_hold"
      ledger_outcome:
        | "pending"
        | "showed"
        | "no_show"
        | "cancelled"
        | "rescheduled"
      ledger_outcome_source:
        | "survey"
        | "crm"
        | "portal"
        | "staff"
        | "tracker"
        | "defaulted"
      ledger_source: "isr" | "direct" | "client" | "unknown"
      notification_kind: "info" | "success" | "warning" | "error"
      onboarding_status:
        | "new_signup"
        | "onboarding_form"
        | "kickoff_form"
        | "waiting_on_team"
        | "waiting_on_client"
        | "launch_ready"
      project_status:
        | "idea"
        | "planned"
        | "in_progress"
        | "blocked"
        | "done"
        | "cancelled"
      request_status: "pending" | "approved" | "declined" | "cancelled"
      sync_status: "running" | "success" | "partial" | "error"
      sync_trigger: "cron" | "cli" | "api" | "manual"
      task_status: "open" | "in_progress" | "done" | "cancelled"
      tech_call_status:
        | "requested"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
      time_off_kind: "vacation" | "sick" | "unpaid" | "parental" | "other"
      user_role:
        | "admin"
        | "isr"
        | "csr"
        | "client"
        | "super_admin"
        | "ceo"
        | "tech"
        | "media_buyer"
        | "isa"
        | "csm"
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
      billing_outcome: ["succeeded", "failed", "pending", "canceled"],
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
        "nurture",
      ],
      finance_kind: ["revenue", "cost"],
      funnel: ["b2b", "b2c"],
      lead_classification: [
        "unclassified",
        "qualified",
        "unqualified",
        "nurture",
        "duplicate",
        "spam",
      ],
      lead_origin: ["referral", "organic", "paid", "outbound", "unknown"],
      lead_quality: ["high", "medium", "low", "unusable"],
      ledger_billing_state: [
        "pending",
        "billable",
        "billed",
        "waived",
        "disputed",
        "on_hold",
      ],
      ledger_outcome: [
        "pending",
        "showed",
        "no_show",
        "cancelled",
        "rescheduled",
      ],
      ledger_outcome_source: [
        "survey",
        "crm",
        "portal",
        "staff",
        "tracker",
        "defaulted",
      ],
      ledger_source: ["isr", "direct", "client", "unknown"],
      notification_kind: ["info", "success", "warning", "error"],
      onboarding_status: [
        "new_signup",
        "onboarding_form",
        "kickoff_form",
        "waiting_on_team",
        "waiting_on_client",
        "launch_ready",
      ],
      project_status: [
        "idea",
        "planned",
        "in_progress",
        "blocked",
        "done",
        "cancelled",
      ],
      request_status: ["pending", "approved", "declined", "cancelled"],
      sync_status: ["running", "success", "partial", "error"],
      sync_trigger: ["cron", "cli", "api", "manual"],
      task_status: ["open", "in_progress", "done", "cancelled"],
      tech_call_status: [
        "requested",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
      time_off_kind: ["vacation", "sick", "unpaid", "parental", "other"],
      user_role: [
        "admin",
        "isr",
        "csr",
        "client",
        "super_admin",
        "ceo",
        "tech",
        "media_buyer",
        "isa",
        "csm",
      ],
    },
  },
} as const
