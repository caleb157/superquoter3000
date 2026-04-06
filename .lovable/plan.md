
# Pipeline Module — Product Development Tracker

## Phase 1: Database
- Create `pipeline_items` table with all fields (customer_id, project_id, name, who, design_done, photo_done, rfq_date, initial_quote_date, sample dates, status, is_foak, etc.)
- RLS: admin/team full access, guests can view items linked to their projects

## Phase 2: Pipeline List Page
- Add `/pipeline` route and "Pipeline" nav link between Projects and Customers
- **6 stat cards** at top: Active Items, Needs Design, Needs Quote, Awaiting Sample, Overdue Follow-up, Avg Days to Quote
- **Table view** (default): sortable columns — Customer, Item Name, Who, Design ✓, Photo ✓, RFQ Date, Quote Date, Days-to-Quote, Sample Request, Initial/Final Sample, Days-to-Sample, Status. Inline date editing. Filter by customer, who, status.
- **Kanban view** (tab toggle): 6 columns derived from field values — Design Needed, Awaiting Quote, Quoted/Awaiting Sample Request, Sample in Progress, Follow-up Needed, Done. Drag-and-drop cards between columns.

## Phase 3: Add/Edit Dialog
- Full form with all pipeline item fields
- Customer dropdown, "Link to Project" searchable dropdown
- Status, FOAK toggle, date pickers, notes

## Phase 4: Integration with Existing Pages
- **Project Detail**: Add Pipeline tab showing linked items, allow adding new ones
- **Product Costing**: Show pipeline status badge in header if linked

## Phase 5: Metrics Tab
- Avg days-to-quote by quarter (bar chart)
- Avg days-to-initial-sample, days-to-final-sample by quarter
- Breakdown by "who" (CQ vs PH)
- Filter by customer and year, exclude FOAK

## Phase 6: XLSX Import
- "Import from tracker" button accepting the Quote Response and Sample Tracker format
- Map columns to pipeline_items fields
- Auto-match customer from first word of Project Name
- Preview before import

## Implementation order
1 → 2 → 3 → 4 → 5 → 6 (each phase builds on the previous)
