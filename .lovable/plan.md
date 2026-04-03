
# Customer Portal — Shareable Quote Builder

## Architecture
- **Public route**: `/quote/:token` — no login required
- **Token**: Use the existing `quote_snapshots` table, adding a `share_token` column (UUID)
- **Data access**: Edge function `get-quote` returns quote data by token (bypasses RLS)
- **Customer actions**: Adjust quantities, select variants, confirm order → saved back to `customer_selections` on the snapshot

## Database Changes
1. Add `share_token` (unique UUID, auto-generated) to `quote_snapshots`
2. Add `share_url` computed from token for display

## Edge Function: `get-quote`
- GET with `?token=xxx` → returns quote snapshot + entity + product details
- POST with `?token=xxx` → saves customer selections (quantities, variants, confirmation)
- No JWT required (public access)

## Frontend Pages

### `/quote/:token` — Customer Quote Portal
1. **Header**: Entity logo, entity name, quote number, validity date
2. **Product Cards Grid**: Each card shows:
   - Product photo (if available)
   - Name, SKU, dimensions, unit price
   - Quantity adjuster (±, with MOQ minimum)
   - Variant selector (if variants exist)
   - Line total auto-calculated
3. **Sidebar / Bottom Bar**:
   - Order summary: total items, total CBM, total value
   - **Container Fill Visualization**: Animated bar showing % of 20ft/40ft/40HC filled
   - Confirm Order button
4. **Order Confirmation Modal**:
   - Summary of selected products + quantities
   - Customer name/email input
   - "Confirm Order" → saves to `customer_selections` on snapshot, updates status to `approved`
   - Thank you screen

### Project Settings Updates
- "Copy Share Link" button next to each quote in history
- Generate share token when creating a quote

## UI Design
- Clean, professional, customer-facing aesthetic
- No cost/margin data exposed — only prices
- Responsive (works on mobile for customer viewing)
- Brand colors from entity
