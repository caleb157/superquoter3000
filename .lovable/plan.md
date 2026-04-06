
## QC Guides Module — Implementation Plan

### Phase 1: Database Schema
Create three new tables:
- **`qc_guides`** — linked to product_id, stores title, status (draft/final), created/updated timestamps
- **`qc_sections`** — linked to guide_id, stores section name, sort_order
- **`qc_rows`** — linked to section_id, stores label, text_content, photo_urls (jsonb array with annotation data), sort_order

RLS: Admin/team can CRUD all. Guests cannot access QC data.

Storage bucket: `qc-photos` (public read for PDF rendering).

### Phase 2: Navigation & List Page
- Add "QC" nav item in AppLayout
- Create `/qc` route → QCList page showing all guides with SKU, dates, status
- Create `/qc/:id` route → QCEditor page

### Phase 3: QC Editor
- Section-based editor with drag-to-reorder sections and rows
- Default sections/rows auto-generated on new guide creation
- Pre-fill from product record (dimensions, wood type, IC box size, finishing)
- Photo upload per row (multiple photos, compact grid display)
- Add/remove/duplicate/rename sections and rows
- Status toggle (Draft ↔ Final)

### Phase 4: Photo Annotation
- Canvas-based annotation overlay on uploaded photos
- Tools: red circle, arrow, text label, undo/redo
- Save annotations as data overlay on the photo

### Phase 5: PDF Export
- Three-column layout (label | photos+content | checkbox)
- Section headers as full-width bold rows
- Signature lines at bottom
- Compact layout optimized for printing

### Phase 6: Product Page Integration
- Add "QC Guides" tab on ProductCosting page
- Show list of guides for that SKU
- Quick-create new guide from product context

### Files to create/modify:
- Migration SQL (tables + RLS + storage)
- `src/pages/QCList.tsx`
- `src/pages/QCEditor.tsx`
- `src/components/QCSection.tsx`
- `src/components/QCRow.tsx`
- `src/components/QCPhotoAnnotator.tsx`
- `src/lib/qc-pdf.ts`
- `src/components/AppLayout.tsx` (add nav item)
- `src/App.tsx` (add routes)
- `src/pages/ProductCosting.tsx` (add QC tab)
