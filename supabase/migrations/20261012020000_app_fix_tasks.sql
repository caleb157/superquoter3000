-- App fixes: tasks tagged association_type = 'app_fix' (no linked record).
-- Moves tasks off the old placeholder inquiry "App code fixes" so it can be deleted.
-- Safe to run more than once: only touches tasks still linked to that inquiry.

UPDATE public.tasks t
SET association_type  = 'app_fix',
    association_id    = NULL,
    association_label = NULL,
    inquiry_id        = NULL,
    customer_id       = NULL,
    product_id        = NULL
FROM public.customer_rfqs r
WHERE r.title ILIKE '%app code fix%'
  AND (t.inquiry_id = r.id
       OR (t.association_type = 'inquiry' AND t.association_id = r.id::text));
