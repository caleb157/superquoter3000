
# RFQ Generation System — Implementation Plan

## Phase 1: Database Schema
- Create `rfqs` table with project reference, vendor info, status tracking, share token
- Create `rfq_line_items` table with product references, pricing columns, sort order
- RLS policies: admin/team can CRUD, public can view by share_token
- Auto-update trigger for `updated_at`

## Phase 2: Navigation & Routing
- Add "RFQs" to top-level nav bar (between Products and Settings)
- Add "RFQs" tab within ProjectDetail page
- Add routes: `/rfqs` (top-level list), `/rfq/:id` (editor), `/rfq/view/:token` (vendor view)

## Phase 3: RFQ Generation Logic
- **Box RFQ**: Scan products → pull IC/MC from cbm_estimates → group by box type/dimensions → create line items with quantities and cost estimates
- **Chemical RFQ**: Pull finishing COGS rows → aggregate litres per chemical type → create line items with breakdowns
- **Hardware RFQ**: Pull hardware COGS rows → group by component_name → aggregate quantities with per-product breakdowns
- **Raw Piece RFQ**: Pull raw piece COGS rows → one line per product (no aggregation) → include dimensions and photos
- **Custom RFQ**: Blank RFQ with empty line items for manual entry

## Phase 4: Project-Level RFQ Tab
- "Generate RFQ" dropdown with 5 options
- List existing RFQs for this project with status badges, actions (edit/delete)

## Phase 5: Top-Level RFQs Page
- All RFQs across projects, searchable/filterable
- Sortable columns: RFQ #, Type, Project, Customer, Vendor, # Items, Est. Total, Status, Date

## Phase 6: RFQ Editor Page (`/rfq/:id`)
- Header: title, RFQ number, vendor info fields, dates, payment terms, notes
- Line items: inline-editable spreadsheet table with photos, quantities, pricing
- Discount control with auto-recalculation
- Summary bar: totals for items, estimated cost, target value, vendor price, savings
- Actions: Save Draft, Download PDF, Copy Share Link, Mark as Sent/Responded

## Phase 7: Vendor-Facing PDF
- Edge function to generate PDF (similar to quote PDF)
- Company header, RFQ details, item table with photos
- Hides estimated cost — only shows target prices
- Footer with notes, deadlines, payment terms

## Phase 8: Vendor Web View (`/rfq/view/:token`)
- Public page (no auth) showing RFQ details
- Same content as PDF in web format
- Download PDF button

## Phase 9: Status Tracking & Price Comparison
- Color-coded status badges (draft/sent/responded/accepted/rejected)
- Vendor price comparison: green (≤ target), yellow (≤ estimate), red (> estimate)

---

**Implementation order**: Phase 1 → 2 → 3+4 → 5 → 6 → 7+8 → 9

This is a large feature — I'll implement it incrementally across multiple messages, starting with the database schema (Phase 1) which needs your approval before code changes.
