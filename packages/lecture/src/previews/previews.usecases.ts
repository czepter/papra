import { Buffer } from 'node:buffer';
import type { PreviewVariant } from './previews.types';
import canvas from '@napi-rs/canvas';
import sharp from 'sharp';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';
import {
  PREVIEW_MIME_TYPE,
  PREVIEW_VARIANT_DIMENSIONS,
  PREVIEW_VARIANTS,
  PREVIEW_WEBP_QUALITY,
} from './previews.constants';
import { isPdfMimeType, isPreviewSupportedMimeType } from './previews.models';

// The first page is rendered once at the widest variant width, the smaller variants are derived from it
const PDF_RENDER_WIDTH = PREVIEW_VARIANT_DIMENSIONS.preview.width;

async function renderPdfFirstPage({ arrayBuffer }: { arrayBuffer: ArrayBuffer }) {
  const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));

  try {
    const pageImage = await renderPageAsImage(pdf, 1, {
      canvasImport: async () => canvas,
      width: PDF_RENDER_WIDTH,
    });

    // PDF pages are rendered on a transparent canvas, previews should look like paper
    return await sharp(Buffer.from(pageImage)).flatten({ background: '#ffffff' }).png().toBuffer();
  } finally {
    await pdf.destroy();
  }
}

async function renderVariant({
  source,
  variant,
}: {
  source: Buffer | ArrayBuffer;
  variant: PreviewVariant;
}) {
  const { data, info } = await sharp(source)
    .rotate() // Applies the EXIF orientation
    .resize({ ...PREVIEW_VARIANT_DIMENSIONS[variant], withoutEnlargement: true })
    .webp({ quality: PREVIEW_WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return {
    variant,
    buffer: data,
    mimeType: PREVIEW_MIME_TYPE,
    width: info.width,
    height: info.height,
  };
}

export async function generatePreviewImages({
  arrayBuffer,
  mimeType,
}: {
  arrayBuffer: ArrayBuffer;
  mimeType: string;
}) {
  if (!isPreviewSupportedMimeType({ mimeType })) {
    throw new Error(`Preview generation is not supported for mime type "${mimeType}"`);
  }

  const source = isPdfMimeType({ mimeType })
    ? await renderPdfFirstPage({ arrayBuffer })
    : Buffer.from(arrayBuffer);

  const previews = await Promise.all(
    PREVIEW_VARIANTS.map(async (variant) => renderVariant({ source, variant })),
  );

  return { previews };
}
