import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { LocalMediaFile } from './publish-api';

export const MAX_UPLOAD_IMAGE_DIMENSION = 2048;
export const IMAGE_UPLOAD_COMPRESSION = 0.82;
export const IMAGE_UPLOAD_PREPARE_BYTES = 1_500_000;

type OutputFormat = 'jpeg' | 'png';

function getOutputFormat(file: LocalMediaFile): OutputFormat | null {
  const mimeType = file.mimeType.toLowerCase().split(';')[0].trim();
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];

  // Keep animated and less common formats byte-for-byte. Re-encoding GIF,
  // WebP, AVIF, SVG, or unknown formats can change appearance or animation.
  if (mimeType === 'image/png' || (!mimeType && extension === 'png')) return 'png';
  if (
    mimeType === 'image/jpeg' ||
    mimeType === 'image/jpg' ||
    mimeType === 'image/heic' ||
    mimeType === 'image/heif' ||
    (!mimeType && ['jpg', 'jpeg', 'heic', 'heif'].includes(extension || ''))
  ) {
    return 'jpeg';
  }
  return null;
}

function hasLargeDimensions(file: LocalMediaFile): boolean {
  return (file.width ?? 0) > MAX_UPLOAD_IMAGE_DIMENSION ||
    (file.height ?? 0) > MAX_UPLOAD_IMAGE_DIMENSION;
}

function needsPreparation(file: LocalMediaFile): boolean {
  return hasLargeDimensions(file) ||
    (typeof file.size === 'number' && file.size > IMAGE_UPLOAD_PREPARE_BYTES);
}

function outputFilename(name: string, format: OutputFormat): string {
  const baseName = name.replace(/\.[^/.]+$/, '') || 'luckread-image';
  return baseName + (format === 'png' ? '.png' : '.jpg');
}

/**
 * Prepare only supported static raster images before the existing W01 upload.
 * The original remains the fallback: optional local optimization must never
 * turn an otherwise uploadable file into a publishing failure.
 */
export async function prepareImageForUpload(file: LocalMediaFile): Promise<LocalMediaFile> {
  if (!file.uri || !file.mimeType || !file.mimeType.toLowerCase().startsWith('image/')) {
    return file;
  }

  const format = getOutputFormat(file);
  if (!format || !needsPreparation(file)) return file;

  const context = ImageManipulator.manipulate(file.uri, {
    maxWidth: MAX_UPLOAD_IMAGE_DIMENSION,
    maxHeight: MAX_UPLOAD_IMAGE_DIMENSION,
  });
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | null = null;

  try {
    rendered = await context.renderAsync();
    const result = await rendered.saveAsync(
      format === 'png'
        ? { format: SaveFormat.PNG }
        : {
            format: SaveFormat.JPEG,
            compress: IMAGE_UPLOAD_COMPRESSION,
          },
    );

    return {
      uri: result.uri,
      name: outputFilename(file.name, format),
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
      // The processed file has a different byte size. Do not reuse the
      // picker's original size in upload fingerprints or request metadata.
      size: null,
      width: result.width,
      height: result.height,
    };
  } catch {
    return file;
  } finally {
    rendered?.release();
    context.release();
  }
}
