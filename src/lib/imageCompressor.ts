import type { SopAttachment, SopSection } from '../types/sop';

export const MAX_SECTION_IMAGE_BYTES = 55 * 1024;
export const MAX_TOTAL_SOP_MEDIA_BYTES = 740 * 1024; // Safe headroom under Firestore 1 MiB limit

export function estimateDataUrlBytes(dataUrl: string): number {
  if (!dataUrl) return 0;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return dataUrl.length;
  return Math.ceil(((dataUrl.length - commaIdx - 1) * 3) / 4);
}

export function estimateSopMediaBytes(params: {
  sections: SopSection[];
  attachments: SopAttachment[];
}): number {
  let total = 0;
  for (const sec of params.sections) {
    for (const img of sec.images || []) {
      total += estimateDataUrlBytes(img.dataUrl);
    }
  }
  for (const att of params.attachments) {
    for (const vp of att.visualPages || []) {
      total += estimateDataUrlBytes(vp.dataUrl);
    }
  }
  return total;
}

function loadImageElement(file: File): Promise<{
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  cleanup: () => void;
}> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width || 1,
        height: img.naturalHeight || img.height || 1,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        cleanup: () => URL.revokeObjectURL(objectUrl),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Gagal membaca file gambar "${file.name}".`));
    };
    img.src = objectUrl;
  });
}

export async function compressImageFileToDataUrl(
  file: File,
  options?: { maxDimension?: number; targetBytes?: number }
): Promise<{ dataUrl: string; bytes: number }> {
  const maxDimension = options?.maxDimension ?? 960;
  const targetBytes = options?.targetBytes ?? MAX_SECTION_IMAGE_BYTES;

  const loaded = await loadImageElement(file);
  try {
    const scale = Math.min(1, maxDimension / Math.max(1, loaded.width, loaded.height));
    let width = Math.max(1, Math.round(loaded.width * scale));
    let height = Math.max(1, Math.round(loaded.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser tidak mendukung pemrosesan gambar kanvas.');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    loaded.draw(ctx, width, height);

    const qualities = [0.84, 0.72, 0.6, 0.48, 0.36];
    let bestUrl = canvas.toDataURL('image/jpeg', qualities[0]);
    let bestBytes = estimateDataUrlBytes(bestUrl);

    for (let i = 1; i < qualities.length && bestBytes > targetBytes; i++) {
      const candidate = canvas.toDataURL('image/jpeg', qualities[i]);
      bestUrl = candidate;
      bestBytes = estimateDataUrlBytes(candidate);
    }

    if (bestBytes > targetBytes && Math.max(width, height) > 640) {
      const ratio = 640 / Math.max(width, height);
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = width;
      smallCanvas.height = height;
      const sCtx = smallCanvas.getContext('2d');
      if (sCtx) {
        sCtx.fillStyle = '#ffffff';
        sCtx.fillRect(0, 0, width, height);
        sCtx.drawImage(canvas, 0, 0, width, height);
        bestUrl = smallCanvas.toDataURL('image/jpeg', 0.56);
        bestBytes = estimateDataUrlBytes(bestUrl);
      }
    }

    return { dataUrl: bestUrl, bytes: bestBytes };
  } finally {
    loaded.cleanup();
  }
}
