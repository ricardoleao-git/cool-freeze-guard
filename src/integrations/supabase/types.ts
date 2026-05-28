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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_events: {
        Row: {
          accumulated_at_event: number | null
          cold_area_id: string
          confidence_score: number
          created_at: string
          device_id: string | null
          employee_id: string
          event_type: string
          id: string
          ip_origin: unknown
          occurred_at: string
          previous_hash: string | null
          record_hash: string | null
          source: string
          status_after: string | null
          status_before: string | null
          tenant_id: string
          unit_id: string
          user_agent: string | null
          validation_status: string
        }
        Insert: {
          accumulated_at_event?: number | null
          cold_area_id: string
          confidence_score?: number
          created_at?: string
          device_id?: string | null
          employee_id: string
          event_type: string
          id?: string
          ip_origin?: unknown
          occurred_at?: string
          previous_hash?: string | null
          record_hash?: string | null
          source?: string
          status_after?: string | null
          status_before?: string | null
          tenant_id: string
          unit_id: string
          user_agent?: string | null
          validation_status?: string
        }
        Update: {
          accumulated_at_event?: number | null
          cold_area_id?: string
          confidence_score?: number
          created_at?: string
          device_id?: string | null
          employee_id?: string
          event_type?: string
          id?: string
          ip_origin?: unknown
          occurred_at?: string
          previous_hash?: string | null
          record_hash?: string | null
          source?: string
          status_after?: string | null
          status_before?: string | null
          tenant_id?: string
          unit_id?: string
          user_agent?: string | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_events_cold_area_id_fkey"
            columns: ["cold_area_id"]
            isOneToOne: false
            referencedRelation: "cold_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_events_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          alert_type: string
          created_at: string
          employee_id: string
          id: string
          message: string
          severity: string
          status: string
          tenant_id: string
          triggered_at: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          employee_id: string
          id?: string
          message: string
          severity: string
          status?: string
          tenant_id: string
          triggered_at?: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          employee_id?: string
          id?: string
          message?: string
          severity?: string
          status?: string
          tenant_id?: string
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cold_areas: {
        Row: {
          average_temperature: number
          break_minutes: number
          counting_mode: string
          created_at: string
          department_id: string
          exposure_limit_minutes: number
          id: string
          name: string
          status: string
          tenant_id: string
          type: string
          unit_id: string
          warning_orange_minutes: number
          warning_yellow_minutes: number
        }
        Insert: {
          average_temperature?: number
          break_minutes?: number
          counting_mode?: string
          created_at?: string
          department_id: string
          exposure_limit_minutes?: number
          id: string
          name: string
          status?: string
          tenant_id: string
          type?: string
          unit_id: string
          warning_orange_minutes?: number
          warning_yellow_minutes?: number
        }
        Update: {
          average_temperature?: number
          break_minutes?: number
          counting_mode?: string
          created_at?: string
          department_id?: string
          exposure_limit_minutes?: number
          id?: string
          name?: string
          status?: string
          tenant_id?: string
          type?: string
          unit_id?: string
          warning_orange_minutes?: number
          warning_yellow_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "cold_areas_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cold_areas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cold_areas_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          id: string
          name: string
          tenant_id: string
          unit_id: string
        }
        Insert: {
          created_at?: string
          id: string
          name: string
          tenant_id: string
          unit_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          cold_area_id: string
          created_at: string
          device_type: string
          external_device_id: string
          id: string
          last_seen_at: string
          name: string
          status: string
          tenant_id: string
          unit_id: string
        }
        Insert: {
          cold_area_id: string
          created_at?: string
          device_type: string
          external_device_id: string
          id: string
          last_seen_at?: string
          name: string
          status?: string
          tenant_id: string
          unit_id: string
        }
        Update: {
          cold_area_id?: string
          created_at?: string
          device_type?: string
          external_device_id?: string
          id?: string
          last_seen_at?: string
          name?: string
          status?: string
          tenant_id?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_cold_area_id_fkey"
            columns: ["cold_area_id"]
            isOneToOne: false
            referencedRelation: "cold_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_cold_areas: {
        Row: {
          authorized_at: string
          authorized_by: string
          cold_area_id: string
          created_at: string
          employee_id: string
          id: string
          tenant_id: string
        }
        Insert: {
          authorized_at?: string
          authorized_by?: string
          cold_area_id: string
          created_at?: string
          employee_id: string
          id?: string
          tenant_id: string
        }
        Update: {
          authorized_at?: string
          authorized_by?: string
          cold_area_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      employees: {
        Row: {
          accumulated_minutes: number
          avatar: string
          break_started_at: string | null
          created_at: string
          current_area_id: string | null
          current_status: string
          department_id: string
          id: string
          inside_since: string | null
          name: string
          position: string
          registration_number: string
          status: string
          tenant_id: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          accumulated_minutes?: number
          avatar?: string
          break_started_at?: string | null
          created_at?: string
          current_area_id?: string | null
          current_status?: string
          department_id: string
          id: string
          inside_since?: string | null
          name: string
          position?: string
          registration_number: string
          status?: string
          tenant_id: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          accumulated_minutes?: number
          avatar?: string
          break_started_at?: string | null
          created_at?: string
          current_area_id?: string | null
          current_status?: string
          department_id?: string
          id?: string
          inside_since?: string | null
          name?: string
          position?: string
          registration_number?: string
          status?: string
          tenant_id?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_current_area_id_fkey"
            columns: ["current_area_id"]
            isOneToOne: false
            referencedRelation: "cold_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      history_filter_presets: {
        Row: {
          created_at: string
          filters: Json
          id: string
          is_default: boolean
          name: string
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          name: string
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          name?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          status?: string
          tenant_id: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_attachments: {
        Row: {
          created_at: string
          id: string
          mime: string
          name: string
          occurrence_id: string
          size: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          mime?: string
          name: string
          occurrence_id: string
          size?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          mime?: string
          name?: string
          occurrence_id?: string
          size?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_attachments_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_notes: {
        Row: {
          author: string
          created_at: string
          id: string
          occurrence_id: string
          text: string
        }
        Insert: {
          author?: string
          created_at?: string
          id?: string
          occurrence_id: string
          text: string
        }
        Update: {
          author?: string
          created_at?: string
          id?: string
          occurrence_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_notes_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrences: {
        Row: {
          category: string
          created_at: string
          created_by: string
          description: string
          employee_id: string
          id: string
          priority: string
          related_event_id: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          tenant_id: string
          title: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string
          description?: string
          employee_id: string
          id?: string
          priority?: string
          related_event_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tenant_id: string
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string
          description?: string
          employee_id?: string
          id?: string
          priority?: string
          related_event_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "occurrences_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string
          created_at: string
          email: string
          full_name: string
          id: string
          status: string
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string
          created_at?: string
          email: string
          full_name?: string
          id?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          document_number: string
          id: string
          legal_name: string
          name: string
          plan: string
          status: string
        }
        Insert: {
          created_at?: string
          document_number: string
          id: string
          legal_name: string
          name: string
          plan?: string
          status?: string
        }
        Update: {
          created_at?: string
          document_number?: string
          id?: string
          legal_name?: string
          name?: string
          plan?: string
          status?: string
        }
        Relationships: []
      }
      thermal_breaks: {
        Row: {
          completed: boolean
          created_at: string
          employee_id: string
          ended_at: string | null
          id: string
          interrupted: boolean
          interrupted_at: string | null
          interruption_reason: string | null
          source: string
          started_at: string
          tenant_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          employee_id: string
          ended_at?: string | null
          id?: string
          interrupted?: boolean
          interrupted_at?: string | null
          interruption_reason?: string | null
          source?: string
          started_at?: string
          tenant_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          employee_id?: string
          ended_at?: string | null
          id?: string
          interrupted?: boolean
          interrupted_at?: string | null
          interruption_reason?: string | null
          source?: string
          started_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thermal_breaks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thermal_breaks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          city: string
          created_at: string
          id: string
          manager_name: string
          name: string
          state: string
          status: string
          tenant_id: string
        }
        Insert: {
          city?: string
          created_at?: string
          id: string
          manager_name?: string
          name: string
          state?: string
          status?: string
          tenant_id: string
        }
        Update: {
          city?: string
          created_at?: string
          id?: string
          manager_name?: string
          name?: string
          state?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_manage_tenant: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      can_read_tenant: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      can_write_tenant: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      get_user_tenant: { Args: { _user_id: string }; Returns: string }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "administrador"
        | "gestor"
        | "rh_sst"
        | "visualizador"
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
      app_role: [
        "super_admin",
        "administrador",
        "gestor",
        "rh_sst",
        "visualizador",
      ],
    },
  },
} as const
