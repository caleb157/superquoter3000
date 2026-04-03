

# DKT Costing App — Phase 1 Plan

## 1. Auth & Role-Based Routing
- Supabase Auth with email magic links
- `profiles` table (display name, avatar) + `user_roles` table with `app_role` enum (`admin`, `team`, `guest`)
- `has_role()` security definer function for RLS policies
- `project_invitations` table for guest access
- Role-based routing: admin/team → dashboard, guest → their quote
- Login page with magic link flow

## 2. Database & Seed Data
- Create all reference/settings tables: `global_settings`, `shipping_types`, `product_types`, `box_data`, `labor_employees`, `chemical_prices`, `hardware_prices`, `wood_prices`
- Create project/product tables: `projects`, `products`, `product_variants`, `cbm_estimates`, `cogs_items`, `non_unit_cogs`, `overhead_items`, `shipping_items`
- RLS policies on every table (admin/team full access, guests read-only on invited projects)
- Seed product types (12 types with rates), global settings, shipping types (4), and default employees (5)

## 3. Global Settings Pages (Admin Only)
- Settings page with tabs for each reference table
- Inline-editable data tables (shadcn Table) with add/delete row for:
  - General settings (exchange rate, laborers, hours, overhead, etc.)
  - Shipping Types, Product Types, Box Data, Employees, Chemical Prices, Hardware Prices, Wood Prices
- Employee designation tags as multi-select

## 4. Project List & Detail
- **Dashboard**: Project list with status badges, quick stats, create project button
- **Project Detail**: Header with customer info, logo upload (Supabase Storage), status management
- Product table showing: thumbnail, name, SKU, dims, qty, unit CBM, unit cost USD, unit price USD, completion dots
- Add product, bulk actions (markup%, shipping type, status flags)

## 5. Calculation Engine (`/src/lib/calculations.ts`)
- Pure TypeScript functions for all business logic:
  - Volume & packing (IC/MC dimensions, costs, CBM)
  - COGS per item, finishing materials auto-calc, packaging auto-calc
  - Labor/overhead with auto-estimates (finishing, packaging)
  - Indirect overhead
  - Shipping (per CBM or KG)
  - Cost summary, pricing, margins (GPM/NPM)
  - Variant pricing (wood price factor adjustment)
- All functions are pure, testable, and dependency-chained

## 6. Product Costing Page — The Core Workspace
- Single scrollable page with 8 collapsible sections (A–H)
- **Section A** (Product Info): Name, SKU, photo upload, dims, weight, product type, difficulty, percent wood, auto-displayed pre-packaged CBM & running inches
- **Section B** (CBM Calculator): IC config with auto-calc dims/cost, MC toggle with packing layout, final unit CBM, total CBM
- **Section C** (COGS/BOM): Spreadsheet-style table with auto-generated default rows (raw pieces, subcontracting, finishing chemicals, packaging, hardware, accessories). Inline editing, add/delete rows. Auto-calculated finishing materials from chemical rates × running inches × percent wood
- **Section D** (Non-Unit COGS): Simple add/remove table
- **Section E** (Direct Overhead): Labor table with auto-estimated finishing and packaging rows, employee rate lookups
- **Section F** (Indirect Overhead): Auto-calculated display
- **Section G** (Shipping): Dropdown + auto-calc, override toggle
- **Section H** (Cost & Revenue Summary): Full breakdown in INR/USD with markup input, totals, margins, completion checklist toggles
- **Real-time recalculation**: All fields chain-update instantly as inputs change (spreadsheet feel)
- **Auto-save**: Debounced save on field blur with toast feedback
- Dense, tab-navigable layout using shadcn Table components — not card forms

## 7. Project Summary
- Aggregated stats across all products in a project: total CBM, total cost, total revenue, margins
- Per-product row summary for quick overview

## UI Patterns Throughout
- Units on every number (₹, $, CBM, inch, kg, hrs, L, pc)
- Formatted numbers (2 decimal currency, integer quantities, 1 decimal percentages)
- Status colors: green=complete, yellow=review, red=issue, gray=not started
- Toast notifications for save/error
- Desktop-first responsive layout

