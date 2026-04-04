

# Add Product Variant Management UI

## Current State
- `product_variants` table exists with columns: `variant_name`, `photo_url`, `wood_price_factor`, `notes`, `product_id`
- Customer quote page already renders variants if they exist
- Calculation engine has `calcVariantCost()` for variant pricing
- **No UI exists** to create, edit, or delete variants

## Plan

### 1. Add Variants Section to Product Costing Page
Add a collapsible "Variants" section on the `ProductCosting.tsx` page (below the existing cost sections) with:
- Table listing existing variants: name, photo thumbnail, wood price factor, calculated variant price, actions (edit/delete)
- "Add Variant" button that opens an inline row or dialog
- Each variant shows its computed price using `calcVariantCost()` from the calculation engine

### 2. Variant Add/Edit Form
Fields:
- **Variant Name** (required) — e.g. "Sheesham", "Mango Wood"
- **Wood Price Factor** — multiplier on the master raw piece cost (default 1.0)
- **Photo** — optional upload to `product-photos` storage bucket
- **Notes** — optional text

### 3. CRUD Operations
- **Create**: Insert into `product_variants` with the current product's ID
- **Update**: Edit name, factor, photo, notes inline or via dialog
- **Delete**: Remove with confirmation

### 4. Variant Pricing Display
For each variant, compute and display:
- Variant raw piece cost = master raw piece cost × wood_price_factor
- Variant product cost = variant raw piece cost + other costs
- Variant unit price (INR and USD)

Using the existing `calcVariantCost()` function from `calculations.ts`.

## Technical Details
- File modified: `src/pages/ProductCosting.tsx`
- No database changes needed — table and RLS policies already exist
- Uses existing `product-photos` storage bucket for variant photos
- Existing RLS: admin/team can CRUD, guests can view

