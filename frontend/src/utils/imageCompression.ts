/**
 * imageCompression — turn a user-selected image File into a size-capped
 * base64 data URI for the Support form's "Attach Photos".
 *
 * The backend stores photos inline as base64 (no object storage), so we
 * downscale + re-encode on the client to keep each attachment comfortably
 * under the size cap. Screenshots are the common case, so re-encoding to
 * JPEG is an acceptable trade (transparency/animation are not needed for a
 * bug screenshot and JPEG is far smaller than PNG for this content).
 *
 * Pure DOM (canvas) — no dependencies. Rejects non-images and anything that
 * can't be squeezed under the cap.
 */

import type { SupportPhotoIn } from "../services/support.service";
import {
  MAX_PHOTO_BYTES,
  PHOTO_JPEG_QUALITY,
  PHOTO_MAX_DIMENSION,
} from "./supportOptions";

/** Decoded byte length of a base64 data URI (payload only). */
export function dataUriByteLength(dataUri: string): number {
  const comma = dataUri.indexOf(",");
  const b64 = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file isn't a valid image."));
    img.src = src;
  });
}

export interface CompressOptions {
  maxDimension?: number;
  quality?: number;
  maxBytes?: number;
}

/**
 * Downscale + re-encode `file` to a JPEG data URI within `maxBytes`.
 * Throws a user-facing Error if the file isn't an image or can't be
 * compressed under the cap.
 */
export async function fileToCompressedDataUri(
  file: File,
  opts: CompressOptions = {},
): Promise<SupportPhotoIn> {
  const maxDimension = opts.maxDimension ?? PHOTO_MAX_DIMENSION;
  const quality = opts.quality ?? PHOTO_JPEG_QUALITY;
  const maxBytes = opts.maxBytes ?? MAX_PHOTO_BYTES;

  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files can be attached.");
  }

  const original = await readAsDataURL(file);
  const img = await loadImage(original);

  const largestSide = Math.max(img.width, img.height) || 1;
  const scale = Math.min(1, maxDimension / largestSide);
  const targetW = Math.max(1, Math.round(img.width * scale));
  const targetH = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Your browser couldn't process the image.");
  }
  // White backdrop so transparent PNGs don't turn black under JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // Step the quality down until it fits (or we hit a sane floor).
  let q = quality;
  let out = canvas.toDataURL("image/jpeg", q);
  while (dataUriByteLength(out) > maxBytes && q > 0.4) {
    q -= 0.15;
    out = canvas.toDataURL("image/jpeg", q);
  }

  if (dataUriByteLength(out) > maxBytes) {
    throw new Error(
      "This image is too large even after compression — try a smaller crop or screenshot.",
    );
  }

  return { data_uri: out, filename: file.name };
}
