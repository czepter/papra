import type { Buffer } from 'node:buffer';
import { createWorker } from 'tesseract.js';
import { x as exec } from 'tinyexec';
import { castToBuffer } from '../utils/buffer';
import { memoize } from '../utils/memoize';
import {
  correctOrientation,
  detectOrientationWithTesseractCli,
  detectOrientationWithTesseractJs,
} from './orientation.usecases';

export async function isTesseractCliAvailable({
  binary = 'tesseract',
}: { binary?: string } = {}): Promise<boolean> {
  // eslint-disable-next-line node/prefer-global/process
  const isNode = typeof process !== 'undefined' && Boolean(process?.versions?.node);
  if (!isNode) {
    return false;
  }

  try {
    const result = await exec(binary, ['--version'], { throwOnError: true });

    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export const isTesseractCliAvailableMemoized = memoize(
  isTesseractCliAvailable,
  ({ binary } = {}) => binary ?? 'tesseract',
);

export function createTesseractCliExtractor({
  binary = 'tesseract',
  languages: factoryLanguages = ['eng'],
  autoRotate: factoryAutoRotate = true,
}: { binary?: string; languages?: string[]; autoRotate?: boolean } = {}) {
  return async (
    maybeArrayBuffer: ArrayBuffer | Buffer,
    {
      languages = factoryLanguages,
      autoRotate = factoryAutoRotate,
    }: { languages?: string[]; autoRotate?: boolean } = {},
  ): Promise<string> => {
    try {
      const image = autoRotate
        ? await correctOrientation({
            image: castToBuffer(maybeArrayBuffer),
            detectOrientation: async ({ image }) =>
              await detectOrientationWithTesseractCli({ image, binary }),
          })
        : castToBuffer(maybeArrayBuffer);

      const proc = exec(binary, ['stdin', 'stdout', '-l', languages.join('+')], {
        throwOnError: true,
      });
      proc.process?.stdin?.end(image);

      const { stdout } = await proc;

      return stdout?.trim();
    } catch {
      return '';
    }
  };
}

export function createTesseractJsExtractor({
  languages: factoryLanguages = ['eng'],
  autoRotate: factoryAutoRotate = true,
}: { languages?: string[]; autoRotate?: boolean } = {}) {
  return async (
    maybeArrayBuffer: ArrayBuffer | Buffer,
    {
      languages = factoryLanguages,
      autoRotate = factoryAutoRotate,
    }: { languages?: string[]; autoRotate?: boolean } = {},
  ): Promise<string> => {
    try {
      const image = autoRotate
        ? await correctOrientation({
            image: castToBuffer(maybeArrayBuffer),
            detectOrientation: detectOrientationWithTesseractJs,
          })
        : castToBuffer(maybeArrayBuffer);

      const worker = await createWorker(languages);

      const {
        data: { text },
      } = await worker.recognize(image);
      await worker.terminate();

      return text?.trim();
    } catch {
      return '';
    }
  };
}

export async function createTesseractExtractor({
  forceJs = false,
  binary,
  languages,
  autoRotate,
}: { binary?: string; forceJs?: boolean; languages?: string[]; autoRotate?: boolean } = {}) {
  const isCliAvailable = await isTesseractCliAvailableMemoized({ binary });

  if (isCliAvailable && !forceJs) {
    return {
      extract: createTesseractCliExtractor({ binary, languages, autoRotate }),
      extractorType: 'tesseract-cli' as const,
    };
  } else {
    return {
      extract: createTesseractJsExtractor({ languages, autoRotate }),
      extractorType: 'tesseract-js' as const,
    };
  }
}
