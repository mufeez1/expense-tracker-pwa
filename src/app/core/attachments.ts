import { AppError, uid } from './models';
import { NewAttachment } from './repo';
import { ALLOWED_MIME, safeFilename } from './validate';

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_EDGE = 2400; // keeps receipt text readable
const COMPRESS_ABOVE = 800 * 1024;

/** Validates a picked file and, for large images, re-encodes it as a smaller JPEG. */
export async function prepareAttachment(file: File): Promise<NewAttachment> {
  if (!ALLOWED_MIME.includes(file.type)) throw new AppError(`"${safeFilename(file.name)}" is not a JPEG, PNG, WebP or PDF file.`);
  if (file.size > MAX_FILE_BYTES) throw new AppError(`"${safeFilename(file.name)}" is larger than 15 MB.`);

  let blob: Blob = file;
  let name = safeFilename(file.name);
  if (file.type !== 'application/pdf' && file.size > COMPRESS_ABOVE) {
    const smaller = await compressImage(file).catch(() => null);
    if (smaller && smaller.size < file.size) {
      blob = smaller;
      name = name.replace(/\.\w+$/, '') + '.jpg';
    }
  }
  return { meta: { id: uid(), name, type: blob.type || file.type, size: blob.size, createdAt: Date.now() }, blob };
}

async function compressImage(file: File): Promise<Blob | null> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff'; // transparent PNG areas would otherwise turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;
