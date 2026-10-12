// Phone photos are often 3 to 8 MB; lists show them at 32 px and quotes at a few hundred.
// Product photos are scaled down before upload so every later view loads a small file.

const MAX_SIDE = 1600;
const QUALITY = 0.85;
const SMALL_ENOUGH_BYTES = 400 * 1024;

export type PreparedImage = { blob: Blob; ext: string; contentType: string };

/**
 * Returns the photo as a JPEG at most MAX_SIDE px on its long side. Small files,
 * GIFs/SVGs and anything the browser cannot decode are returned unchanged.
 */
export async function shrinkImageForUpload(file: File): Promise<PreparedImage> {
  const original: PreparedImage = {
    blob: file,
    ext: (file.name.split('.').pop() || 'jpg').toLowerCase(),
    contentType: file.type || 'image/jpeg',
  };
  if (!file.type.startsWith('image/') || /gif|svg/.test(file.type) || file.size <= SMALL_ENOUGH_BYTES) return original;
  try {
    // 'from-image' applies the phone's EXIF rotation, so portrait shots stay upright.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.fillStyle = '#fff'; // transparent PNG areas become white, not black, as JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return original;
    return { blob, ext: 'jpg', contentType: 'image/jpeg' };
  } catch {
    return original;
  }
}
