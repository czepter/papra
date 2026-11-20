import type { DeepPartial } from '@corentinth/chisels';

export type ExtractorConfig = {
  tesseract: {
    languages: string[];
    forceJs?: boolean;
    binary?: string;
    // Detect and fix the page orientation (upside down, sideways) before OCR, enabled by default
    autoRotate?: boolean;
  };
};

export type PartialExtractorConfig = undefined | DeepPartial<ExtractorConfig>;

export type Logger = {
  debug: (...args: [data: Record<string, unknown>, message: string] | [message: string]) => void;
  info: (...args: [data: Record<string, unknown>, message: string] | [message: string]) => void;
  warn: (...args: [data: Record<string, unknown>, message: string] | [message: string]) => void;
  error: (...args: [data: Record<string, unknown>, message: string] | [message: string]) => void;
};
