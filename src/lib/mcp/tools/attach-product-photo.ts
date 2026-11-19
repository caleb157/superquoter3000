import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { check, ok, ToolError, withUserDb, type Db } from "../shared";

export const PHOTO_BUCKET = "product-photos";
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type AttachPhotoInput = {
  product_id: string;
  image_base64: string;
  media_type: "image/jpeg" | "image/png" | "image/webp";
  replace?: boolean;
  dry_run?: boolean;
};

export function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new ToolError("image_base64 is not valid base64.");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Store the product's photo the way the app does: one file per product in product-photos, linked from products.photo_url. */
export async function attachProductPhoto(db: Db, input: AttachPhotoInput, now = Date.now()) {
  const ext = EXT[input.media_type];
  if (!ext) throw new ToolError("media_type must be image/jpeg, image/png or image/webp.");
  const bytes = decodeBase64(input.image_base64);
  if (!bytes.length) throw new ToolError("The image is empty.");
  if (bytes.length > MAX_PHOTO_BYTES) throw new ToolError(`The image is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is 5 MB.`);

  const product = check(
    await db.from("products").select("id, name, sku, photo_url").eq("id", input.product_id).maybeSingle(),
    "Could not read the product",
  );
  if (!product) throw new ToolError(`Product ${input.product_id} not found or not visible to you.`);
  if (product.photo_url && !input.replace) {
    return { product, attached: false, reason: "Product already has a photo; pass replace to overwrite it.", dry_run: !!input.dry_run };
  }
  const path = `${product.id}.${ext}`;
  if (input.dry_run) return { product, attached: false, would_upload: `${PHOTO_BUCKET}/${path}`, bytes: bytes.length, dry_run: true };

  const up = await db.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: input.media_type, upsert: true });
  if (up.error) throw new ToolError(`Upload failed: ${up.error.message}`);
  const { data: pub } = db.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  const photo_url = `${pub.publicUrl}?t=${now}`;
  check(await db.from("products").update({ photo_url }).eq("id", product.id), "Uploaded, but could not link the photo to the product");
  return { product: { ...product, photo_url }, attached: true, path: `${PHOTO_BUCKET}/${path}`, dry_run: false };
}

export default defineTool({
  name: "attach_product_photo",
  title: "Attach a product photo",
  description:
    "Set a product's main photo from a customer's image (JPEG, PNG or WebP, up to 5 MB, base64). Stored like a photo uploaded in the app. Refuses to overwrite an existing photo unless replace is true.",
  inputSchema: {
    product_id: z.string().uuid().describe("Product UUID (from import_costing_intake or list_products)."),
    image_base64: z.string().min(1).describe("Image bytes as base64; a data: URL prefix is accepted."),
    media_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
    replace: z.boolean().optional().describe("Overwrite the current photo."),
    dry_run: z.boolean().optional().describe("Check the image and product without uploading."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (db, input: AttachPhotoInput) => {
    const r = await attachProductPhoto(db, input);
    const label = r.product.sku || r.product.name;
    const text = r.attached ? `Photo attached to ${label}.` : r.dry_run && "would_upload" in r ? `Dry run: would upload to ${r.would_upload}.` : `Not attached to ${label}: ${"reason" in r ? r.reason : ""}`;
    return ok(text, r as Record<string, unknown>);
  }),
});
