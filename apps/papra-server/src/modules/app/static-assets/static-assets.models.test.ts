import { describe, expect, test } from 'vitest';
import { isBackendRoute } from './static-assets.models';

describe('static-assets models', () => {
  describe('isBackendRoute', () => {
    test('an api route starts with /api/*', () => {
      expect(isBackendRoute({ path: '/api/test' })).to.equal(true);
      expect(isBackendRoute({ path: '/api/' })).to.equal(true);
      expect(isBackendRoute({ path: '/api' })).to.equal(true);

      expect(isBackendRoute({ path: '/apitest' })).to.equal(false);
      expect(isBackendRoute({ path: '/' })).to.equal(false);
      expect(isBackendRoute({ path: '' })).to.equal(false);
      expect(isBackendRoute({ path: '/index.html' })).to.equal(false);
    });

    test('the mcp endpoint is a backend route, but client routes that merely start with mcp are not', () => {
      expect(isBackendRoute({ path: '/mcp' })).to.equal(true);
      expect(isBackendRoute({ path: '/mcp/' })).to.equal(true);
      expect(isBackendRoute({ path: '/mcp/x' })).to.equal(true);

      expect(isBackendRoute({ path: '/mcp-settings' })).to.equal(false);
      expect(isBackendRoute({ path: '/mcpx' })).to.equal(false);
      expect(isBackendRoute({ path: '/settings' })).to.equal(false);
    });

    test('everything under /.well-known is a backend route, so discovery documents never fall back to the SPA', () => {
      expect(isBackendRoute({ path: '/.well-known' })).to.equal(true);
      expect(isBackendRoute({ path: '/.well-known/oauth-protected-resource/mcp' })).to.equal(true);
      expect(isBackendRoute({ path: '/.well-known/unknown' })).to.equal(true);

      expect(isBackendRoute({ path: '/.well-knownx' })).to.equal(false);
      expect(isBackendRoute({ path: '/well-known/x' })).to.equal(false);
    });
  });
});
