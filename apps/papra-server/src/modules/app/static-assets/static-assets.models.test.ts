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
  });
});
