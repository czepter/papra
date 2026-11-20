import { Buffer } from 'node:buffer';
import { describe, expect, test } from 'vitest';
import {
  correctOrientation,
  MIN_ORIENTATION_CONFIDENCE,
  parseTesseractCliOsdOutput,
  shouldRotate,
} from './orientation.usecases';

describe('orientation usecases', () => {
  describe('parseTesseractCliOsdOutput', () => {
    test('extracts the clockwise correction angle and the confidence', () => {
      const output = [
        'Page number: 0',
        'Orientation in degrees: 180',
        'Rotate: 180',
        'Orientation confidence: 14.83',
        'Script: Latin',
        'Script confidence: 2.10',
      ].join('\n');

      expect(parseTesseractCliOsdOutput({ output })).to.eql({ degrees: 180, confidence: 14.83 });
    });

    test('missing or unrelated output yields undefined values', () => {
      expect(parseTesseractCliOsdOutput({ output: '' })).to.eql({
        degrees: undefined,
        confidence: undefined,
      });
      expect(parseTesseractCliOsdOutput({ output: 'Error during processing.' })).to.eql({
        degrees: undefined,
        confidence: undefined,
      });
    });
  });

  describe('shouldRotate', () => {
    test('only rotates by a quarter turn multiple with a sufficient confidence', () => {
      expect(shouldRotate({ degrees: 180, confidence: 10 })).to.eql(true);
      expect(shouldRotate({ degrees: 90, confidence: MIN_ORIENTATION_CONFIDENCE })).to.eql(true);
      expect(shouldRotate({ degrees: 270, confidence: 5 })).to.eql(true);

      expect(shouldRotate({ degrees: 0, confidence: 10 })).to.eql(false);
      expect(shouldRotate({ degrees: 45, confidence: 10 })).to.eql(false);
      expect(shouldRotate({ degrees: 180, confidence: MIN_ORIENTATION_CONFIDENCE - 0.1 })).to.eql(
        false,
      );
      expect(shouldRotate({ degrees: null, confidence: null })).to.eql(false);
      expect(shouldRotate({ degrees: 180, confidence: undefined })).to.eql(false);
    });
  });

  describe('correctOrientation', () => {
    const image = Buffer.from('not-an-image');

    test('the original image is returned when the detection fails', async () => {
      const result = await correctOrientation({
        image,
        detectOrientation: async () => {
          throw new Error('osd failed');
        },
      });

      expect(result).to.equal(image);
    });

    test('the original image is returned when the page is upright or the detection is not confident', async () => {
      expect(
        await correctOrientation({
          image,
          detectOrientation: async () => ({ degrees: 0, confidence: 15 }),
        }),
      ).to.equal(image);
      expect(
        await correctOrientation({
          image,
          detectOrientation: async () => ({ degrees: 180, confidence: 0.5 }),
        }),
      ).to.equal(image);
    });

    test('the original image is returned when the rotation itself fails', async () => {
      const result = await correctOrientation({
        image,
        detectOrientation: async () => ({ degrees: 180, confidence: 15 }),
      });

      expect(result).to.equal(image);
    });
  });
});
