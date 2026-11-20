import type { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { OEM, createWorker } from 'tesseract.js';
import { x as exec } from 'tinyexec';

// Below this confidence, the orientation guess is considered unreliable and the image is left as is
// Clean full pages score around 12-15, pages with too little text are not detected at all
export const MIN_ORIENTATION_CONFIDENCE = 2;

export type PageOrientation = {
  // Clockwise rotation in degrees to apply to the image to make it upright
  degrees: number | null | undefined;
  confidence: number | null | undefined;
};

export function shouldRotate(
  orientation: PageOrientation,
): orientation is { degrees: 90 | 180 | 270; confidence: number } {
  const { degrees, confidence } = orientation;

  return (
    (degrees === 90 || degrees === 180 || degrees === 270) &&
    typeof confidence === 'number' &&
    confidence >= MIN_ORIENTATION_CONFIDENCE
  );
}

// Parses the output of `tesseract stdin stdout --psm 0`, which looks like:
// Page number: 0
// Orientation in degrees: 180
// Rotate: 180
// Orientation confidence: 14.83
export function parseTesseractCliOsdOutput({ output }: { output: string }): PageOrientation {
  const degrees = output.match(/^Rotate:\s*(-?\d+)/m)?.[1];
  const confidence = output.match(/^Orientation confidence:\s*(-?\d+(?:\.\d+)?)/m)?.[1];

  return {
    degrees: degrees === undefined ? undefined : Number(degrees),
    confidence: confidence === undefined ? undefined : Number(confidence),
  };
}

export async function rotateImage({
  image,
  degrees,
}: {
  image: Buffer;
  degrees: 90 | 180 | 270;
}): Promise<Buffer> {
  const { density } = await sharp(image).metadata();

  // Keep the source density so Tesseract doesn't fall back to guessing the resolution
  const rotated = sharp(image).rotate(degrees);

  return await (density ? rotated.withMetadata({ density }) : rotated).png().toBuffer();
}

export async function detectOrientationWithTesseractCli({
  image,
  binary = 'tesseract',
}: {
  image: Buffer;
  binary?: string;
}): Promise<PageOrientation> {
  const proc = exec(binary, ['stdin', 'stdout', '--psm', '0'], { throwOnError: true });
  proc.process?.stdin?.end(image);

  const { stdout } = await proc;

  return parseTesseractCliOsdOutput({ output: stdout });
}

export async function detectOrientationWithTesseractJs({
  image,
}: {
  image: Buffer;
}): Promise<PageOrientation> {
  const worker = await createWorker('osd', OEM.TESSERACT_ONLY, {
    legacyCore: true,
    legacyLang: true,
  });

  try {
    const { data } = await worker.detect(image);

    return { degrees: data.orientation_degrees, confidence: data.orientation_confidence };
  } finally {
    await worker.terminate();
  }
}

// Returns the upright version of the image, or the original image when it is already upright,
// when the orientation can't be reliably detected, or when anything goes wrong.
export async function correctOrientation({
  image,
  detectOrientation,
}: {
  image: Buffer;
  detectOrientation: (args: { image: Buffer }) => Promise<PageOrientation>;
}): Promise<Buffer> {
  try {
    const orientation = await detectOrientation({ image });

    if (!shouldRotate(orientation)) {
      return image;
    }

    return await rotateImage({ image, degrees: orientation.degrees });
  } catch {
    return image;
  }
}
