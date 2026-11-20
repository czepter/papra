export const PREVIEW_VARIANTS = ['thumb', 'card', 'preview'] as const;

// thumb is sized by height (list rows), card and preview are sized by width (grid cards, hover card and quick look)
export const PREVIEW_VARIANT_DIMENSIONS = {
  thumb: { height: 96 },
  card: { width: 400 },
  preview: { width: 1200 },
} as const;

export const PREVIEW_MIME_TYPE = 'image/webp';
export const PREVIEW_WEBP_QUALITY = 78;

export const PDF_MIME_TYPE = 'application/pdf';

// SVGs are excluded on purpose, they can reference external resources when rasterized
export const UNSUPPORTED_PREVIEW_IMAGE_MIME_TYPES = ['image/svg+xml'];
