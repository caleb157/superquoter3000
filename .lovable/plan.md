## Implementation Plan

### Phase 1: AI Parsing — Multi-File & Large PDF Handling
1. **Update `UploadParseDialog.tsx`**: Process files one-at-a-time with per-file progress ("Parsing file 1 of 10: filename.pdf...")
2. **Add `pdfjs-dist`** for client-side PDF→image conversion for large PDFs (>5MB)
3. **Update `parse-product-upload` edge function**: Handle page-by-page image parsing, increase timeout, return partial results on failure
4. **Progress bar** with percentage during multi-file parsing

### Phase 2: Enhanced AI Prompt — Hardware Detection
1. **Update edge function system prompt** with detailed hardware detection instructions (drawers→slides, doors→hinges, pulls/knobs, shelf pins, leg caps, grommets, wall kits)
2. **Update review table in `UploadParseDialog`** to show expandable hardware section per product with detected items, quantities, and auto-looked-up costs from `hardware_prices`
3. **Update import logic** to create hardware COGS rows automatically from AI detection (replacing default empty hardware slots)

### Phase 3: Quote Page — Sticky Company Header
1. **Update `CustomerQuote.tsx`** to make the company header sticky/fixed
2. **Mobile collapse**: On small screens, reduce sticky header to logo + quote number + date

### Phase 4: Carton Size Display
1. **Product Costing page**: Add carton dimension display in CBM Calculator section — simple info block for regular products, table for component products
2. **Quote web view & PDF**: Add carton size column/info to product tables

### File Changes
- `src/components/UploadParseDialog.tsx` — multi-file progress, hardware review table
- `supabase/functions/parse-product-upload/index.ts` — new prompt, page-by-page parsing
- `src/pages/CustomerQuote.tsx` — sticky header
- `src/pages/ProductCosting.tsx` — carton display
- `supabase/functions/get-quote/index.ts` — carton info in quote data
- New dependency: `pdfjs-dist` for client-side PDF rendering
