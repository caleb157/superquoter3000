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
      box_data: {
        Row: {
          box_type: string
          cost_inr: number | null
          cost_per_sq_in: number | null
          created_at: string | null
          date_quoted: string | null
          depth_inch: number | null
          height_inch: number | null
          id: string
          surface_area_sq_in: number | null
          width_inch: number | null
        }
        Insert: {
          box_type: string
          cost_inr?: number | null
          cost_per_sq_in?: number | null
          created_at?: string | null
          date_quoted?: string | null
          depth_inch?: number | null
          height_inch?: number | null
          id?: string
          surface_area_sq_in?: number | null
          width_inch?: number | null
        }
        Update: {
          box_type?: string
          cost_inr?: number | null
          cost_per_sq_in?: number | null
          created_at?: string | null
          date_quoted?: string | null
          depth_inch?: number | null
          height_inch?: number | null
          id?: string
          surface_area_sq_in?: number | null
          width_inch?: number | null
        }
        Relationships: []
      }
      cbm_estimates: {
        Row: {
          created_at: string | null
          final_unit_cbm: number | null
          ic_cost_estimate: number | null
          ic_depth: number | null
          ic_height: number | null
          ic_type: string | null
          ic_volume_cbm: number | null
          ic_width: number | null
          id: string
          include_mc: boolean | null
          mc_buffer_inch: number | null
          mc_cost_estimate: number | null
          mc_depth: number | null
          mc_empty_weight_kg: number | null
          mc_height: number | null
          mc_ics_along_d: number | null
          mc_ics_along_h: number | null
          mc_ics_along_w: number | null
          mc_max_depth: number | null
          mc_max_height: number | null
          mc_max_width: number | null
          mc_type: string | null
          mc_volume_cbm: number | null
          mc_weight_limit_kg: number | null
          mc_width: number | null
          product_id: string | null
          products_per_ic: number | null
          products_per_mc: number | null
          total_cbm: number | null
          total_weight_kg: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          final_unit_cbm?: number | null
          ic_cost_estimate?: number | null
          ic_depth?: number | null
          ic_height?: number | null
          ic_type?: string | null
          ic_volume_cbm?: number | null
          ic_width?: number | null
          id?: string
          include_mc?: boolean | null
          mc_buffer_inch?: number | null
          mc_cost_estimate?: number | null
          mc_depth?: number | null
          mc_empty_weight_kg?: number | null
          mc_height?: number | null
          mc_ics_along_d?: number | null
          mc_ics_along_h?: number | null
          mc_ics_along_w?: number | null
          mc_max_depth?: number | null
          mc_max_height?: number | null
          mc_max_width?: number | null
          mc_type?: string | null
          mc_volume_cbm?: number | null
          mc_weight_limit_kg?: number | null
          mc_width?: number | null
          product_id?: string | null
          products_per_ic?: number | null
          products_per_mc?: number | null
          total_cbm?: number | null
          total_weight_kg?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          final_unit_cbm?: number | null
          ic_cost_estimate?: number | null
          ic_depth?: number | null
          ic_height?: number | null
          ic_type?: string | null
          ic_volume_cbm?: number | null
          ic_width?: number | null
          id?: string
          include_mc?: boolean | null
          mc_buffer_inch?: number | null
          mc_cost_estimate?: number | null
          mc_depth?: number | null
          mc_empty_weight_kg?: number | null
          mc_height?: number | null
          mc_ics_along_d?: number | null
          mc_ics_along_h?: number | null
          mc_ics_along_w?: number | null
          mc_max_depth?: number | null
          mc_max_height?: number | null
          mc_max_width?: number | null
          mc_type?: string | null
          mc_volume_cbm?: number | null
          mc_weight_limit_kg?: number | null
          mc_width?: number | null
          product_id?: string | null
          products_per_ic?: number | null
          products_per_mc?: number | null
          total_cbm?: number | null
          total_weight_kg?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cbm_estimates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_prices: {
        Row: {
          category: string
          created_at: string | null
          id: string
          name: string
          price_per_litre_inr: number
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          name: string
          price_per_litre_inr: number
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          name?: string
          price_per_litre_inr?: number
        }
        Relationships: []
      }
      cogs_items: {
        Row: {
          cogs_type: string
          component_name: string | null
          components_per_product: number | null
          created_at: string | null
          id: string
          include: string | null
          is_auto_calculated: boolean | null
          product_id: string | null
          sort_order: number | null
          unit_cost_inr: number | null
          units: string | null
          vendor_name: string | null
          waste_factor: number | null
        }
        Insert: {
          cogs_type: string
          component_name?: string | null
          components_per_product?: number | null
          created_at?: string | null
          id?: string
          include?: string | null
          is_auto_calculated?: boolean | null
          product_id?: string | null
          sort_order?: number | null
          unit_cost_inr?: number | null
          units?: string | null
          vendor_name?: string | null
          waste_factor?: number | null
        }
        Update: {
          cogs_type?: string
          component_name?: string | null
          components_per_product?: number | null
          created_at?: string | null
          id?: string
          include?: string | null
          is_auto_calculated?: boolean | null
          product_id?: string | null
          sort_order?: number | null
          unit_cost_inr?: number | null
          units?: string | null
          vendor_name?: string | null
          waste_factor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cogs_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          company: string | null
          created_at: string | null
          email: string | null
          id: string
          logo_url: string | null
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      global_settings: {
        Row: {
          available_hours_per_month: number
          contractor_to_inhouse_decrease: number
          created_at: string | null
          default_shipping_type: string | null
          exchange_rate: number
          id: string
          indirect_overhead_monthly: number
          local_transport_cost_per_cbm: number | null
          num_laborers: number
          packaging_cost_per_cbm: number
        }
        Insert: {
          available_hours_per_month?: number
          contractor_to_inhouse_decrease?: number
          created_at?: string | null
          default_shipping_type?: string | null
          exchange_rate?: number
          id?: string
          indirect_overhead_monthly?: number
          local_transport_cost_per_cbm?: number | null
          num_laborers?: number
          packaging_cost_per_cbm?: number
        }
        Update: {
          available_hours_per_month?: number
          contractor_to_inhouse_decrease?: number
          created_at?: string | null
          default_shipping_type?: string | null
          exchange_rate?: number
          id?: string
          indirect_overhead_monthly?: number
          local_transport_cost_per_cbm?: number | null
          num_laborers?: number
          packaging_cost_per_cbm?: number
        }
        Relationships: []
      }
      hardware_prices: {
        Row: {
          created_at: string | null
          id: string
          name: string
          unit_cost_inr: number
          units: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          unit_cost_inr: number
          units?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          unit_cost_inr?: number
          units?: string | null
        }
        Relationships: []
      }
      labor_employees: {
        Row: {
          created_at: string | null
          designations: string[]
          hourly_rate_inr: number
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          designations?: string[]
          hourly_rate_inr: number
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          designations?: string[]
          hourly_rate_inr?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      non_unit_cogs: {
        Row: {
          cost_each_inr: number | null
          created_at: string | null
          id: string
          include: string | null
          name: string | null
          product_id: string | null
          sort_order: number | null
          total_quantity: number | null
        }
        Insert: {
          cost_each_inr?: number | null
          created_at?: string | null
          id?: string
          include?: string | null
          name?: string | null
          product_id?: string | null
          sort_order?: number | null
          total_quantity?: number | null
        }
        Update: {
          cost_each_inr?: number | null
          created_at?: string | null
          id?: string
          include?: string | null
          name?: string | null
          product_id?: string | null
          sort_order?: number | null
          total_quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "non_unit_cogs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      overhead_items: {
        Row: {
          created_at: string | null
          id: string
          include: string | null
          is_auto_estimated: boolean | null
          labor_type: string
          man_hours_per_unit: number | null
          product_id: string | null
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          include?: string | null
          is_auto_estimated?: boolean | null
          labor_type: string
          man_hours_per_unit?: number | null
          product_id?: string | null
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          include?: string | null
          is_auto_estimated?: boolean | null
          labor_type?: string
          man_hours_per_unit?: number | null
          product_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "overhead_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_types: {
        Row: {
          contractor_base_rate_per_ri: number | null
          created_at: string | null
          finishing_color_per_100ri: number | null
          finishing_lacquer_per_100ri: number | null
          finishing_sealer_per_100ri: number | null
          ic_addition_per_side_inch: number | null
          id: string
          name: string
          packaging_mh_per_cbm: number | null
        }
        Insert: {
          contractor_base_rate_per_ri?: number | null
          created_at?: string | null
          finishing_color_per_100ri?: number | null
          finishing_lacquer_per_100ri?: number | null
          finishing_sealer_per_100ri?: number | null
          ic_addition_per_side_inch?: number | null
          id?: string
          name: string
          packaging_mh_per_cbm?: number | null
        }
        Update: {
          contractor_base_rate_per_ri?: number | null
          created_at?: string | null
          finishing_color_per_100ri?: number | null
          finishing_lacquer_per_100ri?: number | null
          finishing_sealer_per_100ri?: number | null
          ic_addition_per_side_inch?: number | null
          id?: string
          name?: string
          packaging_mh_per_cbm?: number | null
        }
        Relationships: []
      }
      product_variants: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          photo_url: string | null
          product_id: string | null
          variant_name: string
          wood_price_factor: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          photo_url?: string | null
          product_id?: string | null
          variant_name: string
          wood_price_factor?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          photo_url?: string | null
          product_id?: string | null
          variant_name?: string
          wood_price_factor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          cbm_done: boolean | null
          cogs_done: boolean | null
          created_at: string | null
          depth_inch: number | null
          finishing_difficulty: string | null
          height_inch: number | null
          id: string
          is_component: boolean | null
          markup_percent: number | null
          moq: number | null
          name: string
          notes: string | null
          overhead_done: boolean | null
          percent_wood: number | null
          photo_url: string | null
          product_type_id: string | null
          project_id: string | null
          quantity: number
          revenue_done: boolean | null
          shipping_done: boolean | null
          sku: string | null
          sort_order: number | null
          sourced_externally: boolean | null
          target_price_usd: number | null
          updated_at: string | null
          weight_kg: number | null
          width_inch: number | null
        }
        Insert: {
          cbm_done?: boolean | null
          cogs_done?: boolean | null
          created_at?: string | null
          depth_inch?: number | null
          finishing_difficulty?: string | null
          height_inch?: number | null
          id?: string
          is_component?: boolean | null
          markup_percent?: number | null
          moq?: number | null
          name: string
          notes?: string | null
          overhead_done?: boolean | null
          percent_wood?: number | null
          photo_url?: string | null
          product_type_id?: string | null
          project_id?: string | null
          quantity?: number
          revenue_done?: boolean | null
          shipping_done?: boolean | null
          sku?: string | null
          sort_order?: number | null
          sourced_externally?: boolean | null
          target_price_usd?: number | null
          updated_at?: string | null
          weight_kg?: number | null
          width_inch?: number | null
        }
        Update: {
          cbm_done?: boolean | null
          cogs_done?: boolean | null
          created_at?: string | null
          depth_inch?: number | null
          finishing_difficulty?: string | null
          height_inch?: number | null
          id?: string
          is_component?: boolean | null
          markup_percent?: number | null
          moq?: number | null
          name?: string
          notes?: string | null
          overhead_done?: boolean | null
          percent_wood?: number | null
          photo_url?: string | null
          product_type_id?: string | null
          project_id?: string | null
          quantity?: number
          revenue_done?: boolean | null
          shipping_done?: boolean | null
          sku?: string | null
          sort_order?: number | null
          sourced_externally?: boolean | null
          target_price_usd?: number | null
          updated_at?: string | null
          weight_kg?: number | null
          width_inch?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_product_type_id_fkey"
            columns: ["product_type_id"]
            isOneToOne: false
            referencedRelation: "product_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_invitations: {
        Row: {
          accepted: boolean | null
          created_at: string | null
          email: string
          id: string
          project_id: string | null
          role: string | null
          token: string | null
        }
        Insert: {
          accepted?: boolean | null
          created_at?: string | null
          email: string
          id?: string
          project_id?: string | null
          role?: string | null
          token?: string | null
        }
        Update: {
          accepted?: boolean | null
          created_at?: string | null
          email?: string
          id?: string
          project_id?: string | null
          role?: string | null
          token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_invitations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string | null
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
          customer_logo_url: string | null
          customer_name: string | null
          id: string
          name: string
          rfq_discount_percent: number | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_logo_url?: string | null
          customer_name?: string | null
          id?: string
          name: string
          rfq_discount_percent?: number | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_logo_url?: string | null
          customer_name?: string | null
          id?: string
          name?: string
          rfq_discount_percent?: number | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_items: {
        Row: {
          created_at: string | null
          id: string
          include: boolean | null
          product_id: string | null
          shipping_type_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          include?: boolean | null
          product_id?: string | null
          shipping_type_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          include?: boolean | null
          product_id?: string | null
          shipping_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_items_shipping_type_id_fkey"
            columns: ["shipping_type_id"]
            isOneToOne: false
            referencedRelation: "shipping_types"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_types: {
        Row: {
          cost_inr: number
          created_at: string | null
          id: string
          name: string
          per_unit: string
        }
        Insert: {
          cost_inr: number
          created_at?: string | null
          id?: string
          name: string
          per_unit?: string
        }
        Update: {
          cost_inr?: number
          created_at?: string | null
          id?: string
          name?: string
          per_unit?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wood_prices: {
        Row: {
          created_at: string | null
          id: string
          price_per_cft_inr: number
          wood_type: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          price_per_cft_inr: number
          wood_type: string
        }
        Update: {
          created_at?: string | null
          id?: string
          price_per_cft_inr?: number
          wood_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_team: { Args: { _user_id: string }; Returns: boolean }
      is_guest_for_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "team" | "guest"
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
      app_role: ["admin", "team", "guest"],
    },
  },
} as const
