
-- Vendor responses table
CREATE TABLE IF NOT EXISTS public.vendor_rfq_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_rfq_id uuid NOT NULL REFERENCES public.vendor_rfqs(id) ON DELETE CASCADE,
  vendor_rfq_line_item_id uuid REFERENCES public.vendor_rfq_line_items(id) ON DELETE CASCADE,
  quoted_unit_price numeric,
  quoted_lead_time_days integer,
  vendor_notes text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vrr_rfq ON public.vendor_rfq_responses(vendor_rfq_id);
CREATE INDEX IF NOT EXISTS idx_vrr_line ON public.vendor_rfq_responses(vendor_rfq_line_item_id);

ALTER TABLE public.vendor_rfq_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can view vendor responses"
  ON public.vendor_rfq_responses FOR SELECT TO authenticated
  USING (public.is_admin_or_team(auth.uid()));

CREATE POLICY "Admin/team can manage vendor responses"
  ON public.vendor_rfq_responses FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));

-- RFQ-level overall response fields
ALTER TABLE public.vendor_rfqs
  ADD COLUMN IF NOT EXISTS vendor_response_notes text,
  ADD COLUMN IF NOT EXISTS vendor_response_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS vendor_response_lead_time_days integer;

-- RPC: submit vendor response by share token (callable by anon)
CREATE OR REPLACE FUNCTION public.submit_vendor_rfq_response(
  _token text,
  _line_responses jsonb,
  _overall_notes text DEFAULT NULL,
  _overall_lead_time_days integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rfq_id uuid;
  v_current_status text;
  v_item jsonb;
  v_response_count integer := 0;
BEGIN
  SELECT id, status INTO v_rfq_id, v_current_status
  FROM public.vendor_rfqs WHERE share_token = _token;
  IF v_rfq_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  DELETE FROM public.vendor_rfq_responses WHERE vendor_rfq_id = v_rfq_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_line_responses)
  LOOP
    INSERT INTO public.vendor_rfq_responses (
      vendor_rfq_id, vendor_rfq_line_item_id,
      quoted_unit_price, quoted_lead_time_days, vendor_notes
    ) VALUES (
      v_rfq_id,
      NULLIF(v_item->>'line_item_id','')::uuid,
      NULLIF(v_item->>'quoted_unit_price','')::numeric,
      NULLIF(v_item->>'quoted_lead_time_days','')::integer,
      NULLIF(v_item->>'vendor_notes','')
    );
    v_response_count := v_response_count + 1;
  END LOOP;

  UPDATE public.vendor_rfqs
  SET
    vendor_response_notes = COALESCE(_overall_notes, vendor_response_notes),
    vendor_response_lead_time_days = COALESCE(_overall_lead_time_days, vendor_response_lead_time_days),
    vendor_response_submitted_at = now(),
    status = CASE WHEN status IN ('draft', 'sent') THEN 'responded' ELSE status END,
    updated_at = now()
  WHERE id = v_rfq_id;

  RETURN jsonb_build_object('ok', true, 'response_count', v_response_count);
END $$;

GRANT EXECUTE ON FUNCTION public.submit_vendor_rfq_response(text, jsonb, text, integer) TO anon;

-- Sibling fetch function returning full line items plus any existing responses
CREATE OR REPLACE FUNCTION public.get_rfq_line_items_with_responses_by_share_token(_token text)
RETURNS TABLE (
  id uuid,
  vendor_rfq_id uuid,
  product_id uuid,
  product_name text,
  product_photo_url text,
  item_name text,
  description text,
  dimensions text,
  quantity numeric,
  units text,
  estimated_cost numeric,
  target_price numeric,
  vendor_price numeric,
  notes text,
  sort_order integer,
  existing_quoted_unit_price numeric,
  existing_quoted_lead_time_days integer,
  existing_vendor_notes text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    li.id, li.vendor_rfq_id, li.product_id, li.product_name, li.product_photo_url,
    li.item_name, li.description, li.dimensions, li.quantity, li.units,
    li.estimated_cost, li.target_price, li.vendor_price, li.notes, li.sort_order,
    vr.quoted_unit_price, vr.quoted_lead_time_days, vr.vendor_notes
  FROM public.vendor_rfq_line_items li
  JOIN public.vendor_rfqs r ON r.id = li.vendor_rfq_id
  LEFT JOIN public.vendor_rfq_responses vr ON vr.vendor_rfq_line_item_id = li.id
  WHERE r.share_token = _token
  ORDER BY li.sort_order, li.item_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_rfq_line_items_with_responses_by_share_token(text) TO anon, authenticated;
