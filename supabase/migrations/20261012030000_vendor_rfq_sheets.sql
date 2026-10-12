-- Vendor RFQ sheets (plan item 8): one send-out to several vendors shares a batch_id,
-- each vendor RFQ links to its vendor, and Pick winner stamps the winning line.
-- Only adds what is missing, so it is safe to run more than once.
ALTER TABLE public.vendor_rfqs
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_rfqs_batch_id ON public.vendor_rfqs(batch_id);

ALTER TABLE public.vendor_rfq_line_items
  ADD COLUMN IF NOT EXISTS picked_at timestamptz;
