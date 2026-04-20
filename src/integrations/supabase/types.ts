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
      assembly_components: {
        Row: {
          assembly_id: string
          created_at: string | null
          id: string
          product_id: string
          quantity_per_assembly: number | null
          sort_order: number | null
        }
        Insert: {
          assembly_id: string
          created_at?: string | null
          id?: string
          product_id: string
          quantity_per_assembly?: number | null
          sort_order?: number | null
        }
        Update: {
          assembly_id?: string
          created_at?: string | null
          id?: string
          product_id?: string
          quantity_per_assembly?: number | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assembly_components_assembly_id_fkey"
            columns: ["assembly_id"]
            isOneToOne: false
            referencedRelation: "product_assemblies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_components_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
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
          mc_manual_layout: boolean
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
          mc_manual_layout?: boolean
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
          mc_manual_layout?: boolean
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
      company_entities: {
        Row: {
          account_name: string | null
          account_number: string | null
          address_line1: string | null
          address_line2: string | null
          bank_branch: string | null
          bank_name: string | null
          city: string | null
          country: string | null
          created_at: string | null
          ein_number: string | null
          email: string | null
          entity_type: string | null
          gst_number: string | null
          id: string
          ifsc_code: string | null
          legal_name: string | null
          logo_url: string | null
          name: string
          phone: string | null
          postal_code: string | null
          routing_number: string | null
          state: string | null
          swift_code: string | null
          website: string | null
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          address_line1?: string | null
          address_line2?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          ein_number?: string | null
          email?: string | null
          entity_type?: string | null
          gst_number?: string | null
          id?: string
          ifsc_code?: string | null
          legal_name?: string | null
          logo_url?: string | null
          name: string
          phone?: string | null
          postal_code?: string | null
          routing_number?: string | null
          state?: string | null
          swift_code?: string | null
          website?: string | null
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          address_line1?: string | null
          address_line2?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          ein_number?: string | null
          email?: string | null
          entity_type?: string | null
          gst_number?: string | null
          id?: string
          ifsc_code?: string | null
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          postal_code?: string | null
          routing_number?: string | null
          state?: string | null
          swift_code?: string | null
          website?: string | null
        }
        Relationships: []
      }
      customer_rfqs: {
        Row: {
          assigned_to: string | null
          created_at: string
          customer_id: string | null
          id: string
          notes: string | null
          priority: string
          received_date: string
          requirements: string | null
          rfq_number: string
          status: string
          target_completion_date: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          notes?: string | null
          priority?: string
          received_date?: string
          requirements?: string | null
          rfq_number?: string
          status?: string
          target_completion_date?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          notes?: string | null
          priority?: string
          received_date?: string
          requirements?: string | null
          rfq_number?: string
          status?: string
          target_completion_date?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_rfqs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
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
          last_contacted_at: string | null
          lead_score: number
          lead_status: string
          linkedin_url: string | null
          logo_url: string | null
          name: string
          notes: string | null
          phone: string | null
          source: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          last_contacted_at?: string | null
          lead_score?: number
          lead_status?: string
          linkedin_url?: string | null
          logo_url?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          last_contacted_at?: string | null
          lead_score?: number
          lead_status?: string
          linkedin_url?: string | null
          logo_url?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
        }
        Relationships: []
      }
      global_settings: {
        Row: {
          auto_transport_cost_per_cbm: number
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
          auto_transport_cost_per_cbm?: number
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
          auto_transport_cost_per_cbm?: number
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
      pipeline_activity: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          description: string
          id: string
          pipeline_item_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          description: string
          id?: string
          pipeline_item_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          description?: string
          id?: string
          pipeline_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_activity_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "pipeline_items"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_items: {
        Row: {
          created_at: string
          customer_id: string | null
          description: string | null
          design_done: boolean
          dimensions_inch: string | null
          final_sample_date: string | null
          finish: string | null
          id: string
          initial_quote_date: string | null
          initial_sample_date: string | null
          is_foak: boolean
          name: string
          notes: string | null
          photo_done: boolean
          project_id: string | null
          rfq_date: string | null
          sample_request_date: string | null
          sort_order: number | null
          status: string
          updated_at: string
          weight_kg: number | null
          who: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          description?: string | null
          design_done?: boolean
          dimensions_inch?: string | null
          final_sample_date?: string | null
          finish?: string | null
          id?: string
          initial_quote_date?: string | null
          initial_sample_date?: string | null
          is_foak?: boolean
          name: string
          notes?: string | null
          photo_done?: boolean
          project_id?: string | null
          rfq_date?: string | null
          sample_request_date?: string | null
          sort_order?: number | null
          status?: string
          updated_at?: string
          weight_kg?: number | null
          who?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          description?: string | null
          design_done?: boolean
          dimensions_inch?: string | null
          final_sample_date?: string | null
          finish?: string | null
          id?: string
          initial_quote_date?: string | null
          initial_sample_date?: string | null
          is_foak?: boolean
          name?: string
          notes?: string | null
          photo_done?: boolean
          project_id?: string | null
          rfq_date?: string | null
          sample_request_date?: string | null
          sort_order?: number | null
          status?: string
          updated_at?: string
          weight_kg?: number | null
          who?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_tasks: {
        Row: {
          assigned_to: string | null
          completed: boolean
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          pipeline_item_id: string
          priority: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          pipeline_item_id: string
          priority?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          pipeline_item_id?: string
          priority?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_tasks_pipeline_item_id_fkey"
            columns: ["pipeline_item_id"]
            isOneToOne: false
            referencedRelation: "pipeline_items"
            referencedColumns: ["id"]
          },
        ]
      }
      product_assemblies: {
        Row: {
          created_at: string | null
          id: string
          markup_percent: number | null
          moq: number | null
          name: string
          notes: string | null
          photo_url: string | null
          project_id: string
          quantity: number
          sku: string | null
          target_price_usd: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          markup_percent?: number | null
          moq?: number | null
          name: string
          notes?: string | null
          photo_url?: string | null
          project_id: string
          quantity?: number
          sku?: string | null
          target_price_usd?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          markup_percent?: number | null
          moq?: number | null
          name?: string
          notes?: string | null
          photo_url?: string | null
          project_id?: string
          quantity?: number
          sku?: string | null
          target_price_usd?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_assemblies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      project_settings: {
        Row: {
          apply_uniform_markup: boolean | null
          created_at: string | null
          customer_logo_url: string | null
          default_markup_override: number | null
          exchange_rate_override: number | null
          id: string
          project_id: string
          quote_currency: string | null
          quote_notes: string | null
          quote_title: string | null
          quote_validity_days: number | null
          quoting_entity_id: string | null
          rfq_discount_percent: number | null
          shipping_type_override: string | null
          show_cbm_on_quote: boolean | null
          show_dimensions_on_quote: boolean | null
          show_photos_on_quote: boolean | null
          show_sku_on_quote: boolean | null
          show_weight_on_quote: boolean | null
          updated_at: string | null
          use_global_exchange_rate: boolean | null
          use_global_shipping: boolean | null
        }
        Insert: {
          apply_uniform_markup?: boolean | null
          created_at?: string | null
          customer_logo_url?: string | null
          default_markup_override?: number | null
          exchange_rate_override?: number | null
          id?: string
          project_id: string
          quote_currency?: string | null
          quote_notes?: string | null
          quote_title?: string | null
          quote_validity_days?: number | null
          quoting_entity_id?: string | null
          rfq_discount_percent?: number | null
          shipping_type_override?: string | null
          show_cbm_on_quote?: boolean | null
          show_dimensions_on_quote?: boolean | null
          show_photos_on_quote?: boolean | null
          show_sku_on_quote?: boolean | null
          show_weight_on_quote?: boolean | null
          updated_at?: string | null
          use_global_exchange_rate?: boolean | null
          use_global_shipping?: boolean | null
        }
        Update: {
          apply_uniform_markup?: boolean | null
          created_at?: string | null
          customer_logo_url?: string | null
          default_markup_override?: number | null
          exchange_rate_override?: number | null
          id?: string
          project_id?: string
          quote_currency?: string | null
          quote_notes?: string | null
          quote_title?: string | null
          quote_validity_days?: number | null
          quoting_entity_id?: string | null
          rfq_discount_percent?: number | null
          shipping_type_override?: string | null
          show_cbm_on_quote?: boolean | null
          show_dimensions_on_quote?: boolean | null
          show_photos_on_quote?: boolean | null
          show_sku_on_quote?: boolean | null
          show_weight_on_quote?: boolean | null
          updated_at?: string | null
          use_global_exchange_rate?: boolean | null
          use_global_shipping?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "project_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_settings_quoting_entity_id_fkey"
            columns: ["quoting_entity_id"]
            isOneToOne: false
            referencedRelation: "company_entities"
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
          customer_rfq_id: string | null
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
          customer_rfq_id?: string | null
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
          customer_rfq_id?: string | null
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
          {
            foreignKeyName: "projects_customer_rfq_id_fkey"
            columns: ["customer_rfq_id"]
            isOneToOne: false
            referencedRelation: "customer_rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_snapshots: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          currency: string | null
          customer_selections: Json | null
          entity_id: string | null
          id: string
          notes: string | null
          products: Json | null
          project_id: string | null
          quote_number: string | null
          sent_at: string | null
          share_token: string | null
          status: string | null
          totals: Json | null
          valid_until: string | null
          viewed_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          currency?: string | null
          customer_selections?: Json | null
          entity_id?: string | null
          id?: string
          notes?: string | null
          products?: Json | null
          project_id?: string | null
          quote_number?: string | null
          sent_at?: string | null
          share_token?: string | null
          status?: string | null
          totals?: Json | null
          valid_until?: string | null
          viewed_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          currency?: string | null
          customer_selections?: Json | null
          entity_id?: string | null
          id?: string
          notes?: string | null
          products?: Json | null
          project_id?: string | null
          quote_number?: string | null
          sent_at?: string | null
          share_token?: string | null
          status?: string | null
          totals?: Json | null
          valid_until?: string | null
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_snapshots_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "company_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      rfs: {
        Row: {
          created_at: string
          customer_rfq_id: string | null
          id: string
          notes: string | null
          requested_date: string
          required_by_date: string | null
          requirements: string | null
          rfs_number: string
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_rfq_id?: string | null
          id?: string
          notes?: string | null
          requested_date?: string
          required_by_date?: string | null
          requirements?: string | null
          rfs_number?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_rfq_id?: string | null
          id?: string
          notes?: string | null
          requested_date?: string
          required_by_date?: string | null
          requirements?: string | null
          rfs_number?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfs_customer_rfq_id_fkey"
            columns: ["customer_rfq_id"]
            isOneToOne: false
            referencedRelation: "customer_rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      samples: {
        Row: {
          created_at: string
          dimensions_inch: string | null
          feedback: string | null
          final_ready_date: string | null
          finish: string | null
          id: string
          initial_ready_date: string | null
          notes: string | null
          photo_urls: Json
          requested_date: string | null
          rfs_id: string | null
          status: string
          updated_at: string
          vendor_id: string | null
          vendor_name: string | null
          weight_kg: number | null
        }
        Insert: {
          created_at?: string
          dimensions_inch?: string | null
          feedback?: string | null
          final_ready_date?: string | null
          finish?: string | null
          id?: string
          initial_ready_date?: string | null
          notes?: string | null
          photo_urls?: Json
          requested_date?: string | null
          rfs_id?: string | null
          status?: string
          updated_at?: string
          vendor_id?: string | null
          vendor_name?: string | null
          weight_kg?: number | null
        }
        Update: {
          created_at?: string
          dimensions_inch?: string | null
          feedback?: string | null
          final_ready_date?: string | null
          finish?: string | null
          id?: string
          initial_ready_date?: string | null
          notes?: string | null
          photo_urls?: Json
          requested_date?: string | null
          rfs_id?: string | null
          status?: string
          updated_at?: string
          vendor_id?: string | null
          vendor_name?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "samples_rfs_id_fkey"
            columns: ["rfs_id"]
            isOneToOne: false
            referencedRelation: "rfs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "samples_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
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
      vendor_rfq_line_items: {
        Row: {
          created_at: string | null
          description: string | null
          dimensions: string | null
          estimated_cost: number | null
          id: string
          item_name: string
          notes: string | null
          product_id: string | null
          product_name: string | null
          product_photo_url: string | null
          quantity: number
          sort_order: number | null
          target_price: number | null
          units: string | null
          vendor_price: number | null
          vendor_rfq_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          dimensions?: string | null
          estimated_cost?: number | null
          id?: string
          item_name: string
          notes?: string | null
          product_id?: string | null
          product_name?: string | null
          product_photo_url?: string | null
          quantity?: number
          sort_order?: number | null
          target_price?: number | null
          units?: string | null
          vendor_price?: number | null
          vendor_rfq_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          dimensions?: string | null
          estimated_cost?: number | null
          id?: string
          item_name?: string
          notes?: string | null
          product_id?: string | null
          product_name?: string | null
          product_photo_url?: string | null
          quantity?: number
          sort_order?: number | null
          target_price?: number | null
          units?: string | null
          vendor_price?: number | null
          vendor_rfq_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfq_line_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_line_items_rfq_id_fkey"
            columns: ["vendor_rfq_id"]
            isOneToOne: false
            referencedRelation: "vendor_rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_rfqs: {
        Row: {
          created_at: string | null
          created_by: string | null
          delivery_deadline: string | null
          discount_percent: number | null
          id: string
          notes: string | null
          payment_terms: string | null
          project_id: string | null
          response_due: string | null
          rfq_number: string | null
          rfq_type: string
          sent_at: string | null
          share_token: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          vendor_address: string | null
          vendor_email: string | null
          vendor_name: string | null
          vendor_phone: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          delivery_deadline?: string | null
          discount_percent?: number | null
          id?: string
          notes?: string | null
          payment_terms?: string | null
          project_id?: string | null
          response_due?: string | null
          rfq_number?: string | null
          rfq_type: string
          sent_at?: string | null
          share_token?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          vendor_address?: string | null
          vendor_email?: string | null
          vendor_name?: string | null
          vendor_phone?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          delivery_deadline?: string | null
          discount_percent?: number | null
          id?: string
          notes?: string | null
          payment_terms?: string | null
          project_id?: string | null
          response_due?: string | null
          rfq_number?: string | null
          rfq_type?: string
          sent_at?: string | null
          share_token?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          vendor_address?: string | null
          vendor_email?: string | null
          vendor_name?: string | null
          vendor_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rfqs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string | null
          category: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          address?: string | null
          category?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          address?: string | null
          category?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
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
      generate_crfq_number: { Args: never; Returns: string }
      generate_rfs_number: { Args: never; Returns: string }
      get_entity_for_guest: {
        Args: { _entity_id: string }
        Returns: {
          address_line1: string
          address_line2: string
          city: string
          country: string
          email: string
          entity_type: string
          id: string
          legal_name: string
          logo_url: string
          name: string
          phone: string
          postal_code: string
          state: string
          website: string
        }[]
      }
      get_rfq_by_share_token: {
        Args: { _token: string }
        Returns: {
          created_at: string | null
          created_by: string | null
          delivery_deadline: string | null
          discount_percent: number | null
          id: string
          notes: string | null
          payment_terms: string | null
          project_id: string | null
          response_due: string | null
          rfq_number: string | null
          rfq_type: string
          sent_at: string | null
          share_token: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          vendor_address: string | null
          vendor_email: string | null
          vendor_name: string | null
          vendor_phone: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "vendor_rfqs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_rfq_line_items_by_share_token: {
        Args: { _token: string }
        Returns: {
          created_at: string | null
          description: string | null
          dimensions: string | null
          estimated_cost: number | null
          id: string
          item_name: string
          notes: string | null
          product_id: string | null
          product_name: string | null
          product_photo_url: string | null
          quantity: number
          sort_order: number | null
          target_price: number | null
          units: string | null
          vendor_price: number | null
          vendor_rfq_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "vendor_rfq_line_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
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
