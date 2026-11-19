import fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, test } from 'vitest';
import { isPreviewSupportedMimeType } from './previews.models';
import { generatePreviewImages } from './previews.usecases';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures');

async function readFixture({ path }: { path: string }) {
  const buffer = await fs.readFile(join(fixturesDir, path));
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

async function describePreviews({ previews }: Awaited<ReturnType<typeof generatePreviewImages>>) {
  return Promise.all(
    previews.map(async ({ variant, buffer, mimeType, width, height }) => ({
      variant,
      mimeType,
      width,
      height,
      format: (await sharp(buffer).metadata()).format,
    })),
  );
}

describe('previews usecases', () => {
  describe('isPreviewSupportedMimeType', () => {
    test('pdf and raster images are supported, other types are not', () => {
      expect(isPreviewSupportedMimeType({ mimeType: 'application/pdf' })).to.eql(true);
      expect(isPreviewSupportedMimeType({ mimeType: 'image/jpeg' })).to.eql(true);
      expect(isPreviewSupportedMimeType({ mimeType: 'image/png' })).to.eql(true);
      expect(isPreviewSupportedMimeType({ mimeType: 'IMAGE/WEBP; charset=binary' })).to.eql(true);
      expect(isPreviewSupportedMimeType({ mimeType: 'image/svg+xml' })).to.eql(false);
      expect(isPreviewSupportedMimeType({ mimeType: 'text/plain' })).to.eql(false);
      expect(isPreviewSupportedMimeType({ mimeType: 'application/zip' })).to.eql(false);
    });
  });

  describe('generatePreviewImages', () => {
    test('the first page of a pdf is rendered as three webp variants sized by their own rule', async () => {
      const arrayBuffer = await readFixture({ path: '001-textual-pdf/001.input.pdf' });

      const result = await generatePreviewImages({ arrayBuffer, mimeType: 'application/pdf' });
      const [thumb, card, preview] = await describePreviews(result);

      expect(result.previews.map(({ variant }) => variant)).to.eql(['thumb', 'card', 'preview']);
      expect(thumb).to.include({
        variant: 'thumb',
        height: 96,
        format: 'webp',
        mimeType: 'image/webp',
      });
      expect(card).to.include({ variant: 'card', width: 400, format: 'webp' });
      expect(preview).to.include({ variant: 'preview', width: 1200, format: 'webp' });

      // Aspect ratio is kept across variants (A4-ish page, taller than wide)
      expect(preview?.height).to.be.greaterThan(preview?.width ?? 0);
      expect(
        Math.abs(
          (card?.height ?? 0) / (card?.width ?? 1) - (preview?.height ?? 0) / (preview?.width ?? 1),
        ),
      ).to.be.lessThan(0.01);
    });

    test('images are resized and the exif orientation is applied', async () => {
      const arrayBuffer = await readFixture({ path: '022-jpg-exif-rotation/022.input.jpg' });
      const { orientation, width, height } = await sharp(arrayBuffer).metadata();

      const result = await generatePreviewImages({ arrayBuffer, mimeType: 'image/jpeg' });
      const [thumb, card, preview] = await describePreviews(result);

      expect(orientation).to.be.greaterThan(1);
      // Orientations 5-8 swap the width and height once the rotation is applied
      const [rotatedWidth, rotatedHeight] =
        (orientation ?? 1) >= 5 ? [height, width] : [width, height];

      expect(thumb?.height).to.eql(Math.min(96, rotatedHeight ?? 96));
      expect(card?.width).to.eql(Math.min(400, rotatedWidth ?? 400));
      expect(preview?.width).to.eql(Math.min(1200, rotatedWidth ?? 1200));
      expect([thumb?.format, card?.format, preview?.format]).to.eql(['webp', 'webp', 'webp']);
    });

    test('images smaller than a variant are not enlarged', async () => {
      const arrayBuffer = (
        await sharp({ create: { width: 50, height: 30, channels: 3, background: '#f00' } })
          .png()
          .toBuffer()
      ).buffer as ArrayBuffer;

      const result = await generatePreviewImages({ arrayBuffer, mimeType: 'image/png' });

      expect(
        (await describePreviews(result)).map(({ width, height }) => ({ width, height })),
      ).to.eql([
        { width: 50, height: 30 },
        { width: 50, height: 30 },
        { width: 50, height: 30 },
      ]);
    });

    test('a png fixture is converted to webp', async () => {
      const arrayBuffer = await readFixture({ path: '006-png/006.input.png' });

      const result = await generatePreviewImages({ arrayBuffer, mimeType: 'image/png' });

      expect((await describePreviews(result)).map(({ format }) => format)).to.eql([
        'webp',
        'webp',
        'webp',
      ]);
    });

    test('an error is thrown for unsupported mime types', async () => {
      await expect(
        generatePreviewImages({ arrayBuffer: new ArrayBuffer(0), mimeType: 'text/plain' }),
      ).rejects.toThrow('Preview generation is not supported for mime type "text/plain"');
    });

    test('an error is thrown when the file content is not valid for its mime type', async () => {
      await expect(
        generatePreviewImages({ arrayBuffer: new ArrayBuffer(8), mimeType: 'application/pdf' }),
      ).rejects.toThrow();
      await expect(
        generatePreviewImages({ arrayBuffer: new ArrayBuffer(8), mimeType: 'image/png' }),
      ).rejects.toThrow();
    });
  });
});
