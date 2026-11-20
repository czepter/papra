import { describe, expect, test } from 'vitest';
import { getRedirectHosts, parseJsonStringArray } from './mcp.connected-apps.models';

describe('mcp connected apps models', () => {
  describe('parseJsonStringArray', () => {
    test('a JSON array of strings is returned as is', () => {
      expect(parseJsonStringArray({ value: '["a","b"]' })).to.eql(['a', 'b']);
    });

    test('malformed JSON, non-array JSON and missing values give an empty array', () => {
      expect(parseJsonStringArray({ value: '[not json' })).to.eql([]);
      expect(parseJsonStringArray({ value: '{"a":1}' })).to.eql([]);
      expect(parseJsonStringArray({ value: '"a"' })).to.eql([]);
      expect(parseJsonStringArray({ value: null })).to.eql([]);
      expect(parseJsonStringArray({ value: undefined })).to.eql([]);
    });

    test('non-string items are dropped', () => {
      expect(parseJsonStringArray({ value: '["a",1,null,{"x":1},"b"]' })).to.eql(['a', 'b']);
    });
  });

  describe('getRedirectHosts', () => {
    test('hosts keep their port and duplicates are removed', () => {
      expect(
        getRedirectHosts({
          redirectUris: JSON.stringify([
            'http://127.0.0.1:33418/callback',
            'http://127.0.0.1:33418/other',
            'https://example.com/cb',
            'http://127.0.0.1:4000/cb',
          ]),
        }),
      ).to.eql(['127.0.0.1:33418', 'example.com', '127.0.0.1:4000']);
    });

    test('invalid URIs, URIs without a host and malformed JSON are skipped', () => {
      expect(
        getRedirectHosts({
          redirectUris: JSON.stringify([
            'not a uri',
            'urn:ietf:wg:oauth:2.0:oob',
            'https://ok.example/cb',
          ]),
        }),
      ).to.eql(['ok.example']);
      expect(getRedirectHosts({ redirectUris: '{broken' })).to.eql([]);
      expect(getRedirectHosts({ redirectUris: null })).to.eql([]);
    });
  });
});
