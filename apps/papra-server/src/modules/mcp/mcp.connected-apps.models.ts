import { isNil } from '../shared/utils';

// The better-auth adapter stores list-valued fields as JSON text. The rows come from open dynamic client
// registration, so every read is defensive: malformed values are dropped, never thrown on.
export function parseJsonStringArray({ value }: { value: string | null | undefined }): string[] {
  if (isNil(value)) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function getRedirectHosts({ redirectUris }: { redirectUris: string | null | undefined }): string[] {
  const hosts = parseJsonStringArray({ value: redirectUris }).flatMap((uri) => {
    try {
      const { host } = new URL(uri);

      return host === '' ? [] : [host];
    } catch {
      return [];
    }
  });

  return [...new Set(hosts)];
}
