import { describe, expect, test } from 'vitest';
import { overrideConfig } from '../config/config.test-utils';
import {
  buildWwwAuthenticateHeader,
  getMcpOauthUrls,
  getPermissionsFromOauthScopes,
  isAllowedRedirectUri,
  MCP_OAUTH_SCOPES,
  validateClientRegistrationBody,
} from './mcp.oauth.models';
import { API_KEY_PERMISSIONS_VALUES } from '../api-keys/api-keys.constants';

describe('mcp oauth models', () => {
  describe('getMcpOauthUrls', () => {
    test('every url comes from the configured base urls, without double slashes', () => {
      const config = overrideConfig({
        appBaseUrl: 'https://papra.example.com/',
      });

      expect(getMcpOauthUrls({ config })).to.eql({
        issuer: 'https://papra.example.com/api/auth',
        resource: 'https://papra.example.com/mcp',
        protectedResourceMetadataUrl:
          'https://papra.example.com/.well-known/oauth-protected-resource/mcp',
        consentPageUrl: 'https://papra.example.com/oauth/consent',
      });
    });

    test('the server and the client urls are used when no app base url is set', () => {
      const config = overrideConfig({
        appBaseUrl: undefined,
        server: { baseUrl: 'https://api.example.com' },
        client: { baseUrl: 'https://app.example.com' },
      });

      expect(getMcpOauthUrls({ config })).toMatchObject({
        issuer: 'https://api.example.com/api/auth',
        resource: 'https://api.example.com/mcp',
        consentPageUrl: 'https://app.example.com/oauth/consent',
      });
    });
  });

  describe('scopes', () => {
    test('the scopes offered are the api key permissions one to one, plus offline_access', () => {
      expect(MCP_OAUTH_SCOPES).to.eql([...API_KEY_PERMISSIONS_VALUES, 'offline_access']);
    });

    test('only api key permissions become permissions, everything else grants nothing', () => {
      expect(
        getPermissionsFromOauthScopes({
          scope: 'organizations:read offline_access openid tags:read unknown:scope',
        }),
      ).to.eql({ permissions: ['organizations:read', 'tags:read'] });
      expect(getPermissionsFromOauthScopes({ scope: '' })).to.eql({ permissions: [] });
    });
  });

  describe('buildWwwAuthenticateHeader', () => {
    test('the challenge carries the resource metadata url, and the invalid_token error when a token was rejected', () => {
      const protectedResourceMetadataUrl = 'https://papra.example.com/.well-known/x';

      expect(buildWwwAuthenticateHeader({ protectedResourceMetadataUrl })).to.eql(
        'Bearer realm="papra", resource_metadata="https://papra.example.com/.well-known/x"',
      );
      expect(
        buildWwwAuthenticateHeader({ protectedResourceMetadataUrl, isInvalidToken: true }),
      ).to.eql(
        'Bearer realm="papra", error="invalid_token", resource_metadata="https://papra.example.com/.well-known/x"',
      );
    });
  });

  describe('isAllowedRedirectUri', () => {
    test('https and loopback http are allowed', () => {
      for (const uri of [
        'https://client.example/callback',
        'https://client.example:8443/cb?x=1',
        'http://127.0.0.1:33418/callback',
        'http://localhost:8080/callback',
        'http://[::1]:9000/callback',
      ]) {
        expect(isAllowedRedirectUri({ uri }), uri).to.eql(true);
      }
    });

    test('other schemes, non-loopback http, fragments, wildcards, credentials and oversized values are refused', () => {
      for (const uri of [
        'javascript:alert(1)',
        'data:text/html,x',
        'vscode://client/callback',
        'http://client.example/callback',
        'http://localhost.evil.example/callback',
        'https://client.example/callback#frag',
        'https://*.client.example/callback',
        'https://user:pass@client.example/callback',
        'not a url',
        `https://client.example/${'a'.repeat(2100)}`,
      ]) {
        expect(isAllowedRedirectUri({ uri }), uri).to.eql(false);
      }
    });
  });

  describe('validateClientRegistrationBody', () => {
    const valid = {
      client_name: 'Client',
      redirect_uris: ['http://127.0.0.1:33418/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    };

    test('a well formed body is accepted', () => {
      expect(validateClientRegistrationBody({ body: valid })).to.eql(undefined);
    });

    test('the client name is limited to 100 characters after trimming', () => {
      expect(
        validateClientRegistrationBody({ body: { ...valid, client_name: `  ${'a'.repeat(100)}  ` } }),
      ).to.eql(undefined);
      expect(
        validateClientRegistrationBody({ body: { ...valid, client_name: 'a'.repeat(101) } }),
      ).toMatchObject({ error: 'invalid_client_metadata' });
    });

    test.each([
      ['no redirect uri', { redirect_uris: [] }],
      ['too many redirect uris', { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://c.example/${i}`) }],
      ['a bad redirect uri', { redirect_uris: ['http://evil.example/cb'] }],
      ['the client credentials grant', { grant_types: ['client_credentials'] }],
      ['a confidential client', { token_endpoint_auth_method: 'client_secret_basic' }],
      ['an oversized client uri', { client_uri: `https://c.example/${'a'.repeat(2100)}` }],
      ['too many contacts', { contacts: Array.from({ length: 11 }, () => 'a@b.example') }],
      ['bad post logout redirect uris', { post_logout_redirect_uris: ['javascript:alert(1)'] }],
    ])('%s is refused', (_name, override) => {
      expect(validateClientRegistrationBody({ body: { ...valid, ...override } })).not.to.eql(
        undefined,
      );
    });

    test('a body that is not an object is refused', () => {
      expect(validateClientRegistrationBody({ body: undefined })).not.to.eql(undefined);
      expect(validateClientRegistrationBody({ body: 'x' })).not.to.eql(undefined);
    });
  });
});
