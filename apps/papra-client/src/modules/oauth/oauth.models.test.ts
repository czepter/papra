import { describe, expect, test } from 'vitest';
import { API_KEY_PERMISSIONS_VALUES } from '../api-keys/api-keys.constants';
import { translations as de } from '../../locales/de.dictionary';
import { translations as en } from '../../locales/en.dictionary';
import {
  getClientDisplayName,
  getRedirectHost,
  getScopeGroups,
  isSafeRedirectUrl,
} from './oauth.models';

describe('oauth models', () => {
  describe('scope labels', () => {
    test('every api key permission has a plain language label in en and de', () => {
      for (const permission of API_KEY_PERMISSIONS_VALUES) {
        const key = `oauth-consent.scopes.${permission}`;

        expect(en[key as keyof typeof en], `en ${key}`).toEqual(expect.any(String));
        expect(de[key as keyof typeof de], `de ${key}`).toEqual(expect.any(String));
      }
      expect(API_KEY_PERMISSIONS_VALUES).toHaveLength(16);
    });

    test('offline access has a label too', () => {
      expect(en['oauth-consent.scopes.offline_access']).toEqual(expect.any(String));
      expect(de['oauth-consent.scopes.offline_access']).toEqual(expect.any(String));
    });

    test('the german copy is formal, it never uses the informal "du" forms', () => {
      const consentTexts = Object.entries(de)
        .filter(([key]) => key.startsWith('oauth-consent.') || key.startsWith('mcp-settings.'))
        .map(([, value]) => value);

      for (const text of consentTexts) {
        expect(text).not.toMatch(/\b(du|dein|deine|deinen|deiner|dir|dich)\b/i);
      }
    });
  });

  describe('getScopeGroups', () => {
    test('groups the requested scopes by resource, in the order of the api key permissions', () => {
      expect(
        getScopeGroups({ scope: 'tags:read documents:read documents:create organizations:read' }),
      ).to.eql([
        { section: 'organizations', scopes: [{ scope: 'organizations:read', isKnown: true }] },
        {
          section: 'documents',
          scopes: [
            { scope: 'documents:create', isKnown: true },
            { scope: 'documents:read', isKnown: true },
          ],
        },
        { section: 'tags', scopes: [{ scope: 'tags:read', isKnown: true }] },
      ]);
    });

    test('offline access and unknown scopes end up in a connection group, offline access first', () => {
      expect(getScopeGroups({ scope: 'weird:scope organizations:read offline_access' })).to.eql([
        { section: 'organizations', scopes: [{ scope: 'organizations:read', isKnown: true }] },
        {
          section: 'connection',
          scopes: [
            { scope: 'offline_access', isKnown: true },
            { scope: 'weird:scope', isKnown: false },
          ],
        },
      ]);
    });

    test('an absent or empty scope gives no group, and extra spaces are ignored', () => {
      expect(getScopeGroups({ scope: undefined })).to.eql([]);
      expect(getScopeGroups({ scope: '' })).to.eql([]);
      expect(getScopeGroups({ scope: '  tags:read   ' })).to.eql([
        { section: 'tags', scopes: [{ scope: 'tags:read', isKnown: true }] },
      ]);
    });

    test('the sixteen permissions and offline access all end up in a group', () => {
      const groups = getScopeGroups({
        scope: [...API_KEY_PERMISSIONS_VALUES, 'offline_access'].join(' '),
      });

      expect(groups.flatMap(({ scopes }) => scopes)).toHaveLength(17);
    });
  });

  describe('getRedirectHost', () => {
    test('returns the host with its port', () => {
      expect(getRedirectHost({ redirectUri: 'http://127.0.0.1:33418/callback' })).to.eql(
        '127.0.0.1:33418',
      );
      expect(getRedirectHost({ redirectUri: 'https://client.example/cb?x=1' })).to.eql(
        'client.example',
      );
    });

    test('returns undefined for a missing or invalid uri', () => {
      expect(getRedirectHost({ redirectUri: undefined })).to.eql(undefined);
      expect(getRedirectHost({ redirectUri: 'not a url' })).to.eql(undefined);
    });
  });

  describe('isSafeRedirectUrl', () => {
    test('only http and https destinations are followed', () => {
      expect(isSafeRedirectUrl({ url: 'http://127.0.0.1:33418/callback?code=x' })).to.eql(true);
      expect(isSafeRedirectUrl({ url: 'https://client.example/cb' })).to.eql(true);
      expect(isSafeRedirectUrl({ url: 'javascript:alert(1)' })).to.eql(false);
      expect(isSafeRedirectUrl({ url: 'data:text/html,x' })).to.eql(false);
      expect(isSafeRedirectUrl({ url: 'nonsense' })).to.eql(false);
    });
  });

  describe('getClientDisplayName', () => {
    test('trims the name and falls back to undefined when it is blank', () => {
      expect(getClientDisplayName({ name: '  My client ' })).to.eql('My client');
      expect(getClientDisplayName({ name: '   ' })).to.eql(undefined);
      expect(getClientDisplayName({ name: undefined })).to.eql(undefined);
      expect(getClientDisplayName({ name: null })).to.eql(undefined);
    });

    test('markup is kept as literal text, never interpreted', () => {
      expect(getClientDisplayName({ name: '<b>x</b>' })).to.eql('<b>x</b>');
    });
  });
});
