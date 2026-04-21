-- Restore public read access on storage buckets used by customer-facing quote pages.
-- product-photos, entity-logos, and customer-logos are referenced from /quote/:token
-- by unauthenticated viewers. sample-photos and qc-photos remain private.

CREATE POLICY "Public can read product photos"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'product-photos');

CREATE POLICY "Public can read entity logos"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'entity-logos');

CREATE POLICY "Public can read customer logos"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'customer-logos');