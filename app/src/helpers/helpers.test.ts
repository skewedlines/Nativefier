import { linkIsInternal, getCounterValue } from './helpers';

const internalUrl = 'https://medium.com/';
const internalUrlWww = 'https://www.medium.com/';
const sameBaseDomainUrl = 'https://app.medium.com/';
const internalUrlCoUk = 'https://medium.co.uk/';
const sameBaseDomainUrlCoUk = 'https://app.medium.co.uk/';
const internalUrlSubPath = 'topic/technology';
const externalUrl = 'https://www.wikipedia.org/wiki/Electron';
const wildcardRegex = /.*/;

test('the original url should be internal', () => {
  expect(linkIsInternal(internalUrl, internalUrl, undefined)).toEqual(true);
});

test('sub-paths of the original url should be internal', () => {
  expect(
    linkIsInternal(internalUrl, internalUrl + internalUrlSubPath, undefined),
  ).toEqual(true);
});

test("'about:blank' should be internal", () => {
  expect(linkIsInternal(internalUrl, 'about:blank', undefined)).toEqual(true);
});

test('urls from different sites should not be internal', () => {
  expect(linkIsInternal(internalUrl, externalUrl, undefined)).toEqual(false);
});

test('all urls should be internal with wildcard regex', () => {
  expect(linkIsInternal(internalUrl, externalUrl, wildcardRegex)).toEqual(true);
});

test('a "www." of a domain should be considered internal', () => {
  expect(linkIsInternal(internalUrl, internalUrlWww, undefined)).toEqual(true);
});

test('urls on the same "base domain" should be considered internal', () => {
  expect(linkIsInternal(internalUrl, sameBaseDomainUrl, undefined)).toEqual(
    true,
  );
});

test('urls on the same "base domain" should be considered internal, even with a www', () => {
  expect(linkIsInternal(internalUrlWww, sameBaseDomainUrl, undefined)).toEqual(
    true,
  );
});

test('urls on the same "base domain" should be considered internal, long SLD', () => {
  expect(
    linkIsInternal(internalUrlCoUk, sameBaseDomainUrlCoUk, undefined),
  ).toEqual(true);
});

const testLoginPages = [
  'https://amazon.co.uk/signin',
  'https://amazon.com/signin',
  'https://amazon.de/signin',
  'https://amazon.com/ap/signin',
  'https://facebook.co.uk/login',
  'https://facebook.com/login',
  'https://facebook.de/login',
  'https://github.co.uk/login',
  'https://github.com/login',
  'https://github.de/login',
  // GitHub 2FA flow with FIDO token
  'https://github.com/session',
  'https://github.com/sessions/two-factor/webauth',
  'https://accounts.google.co.uk',
  'https://accounts.google.com',
  'https://accounts.google.de',
  'https://linkedin.co.uk/uas/login',
  'https://linkedin.com/uas/login',
  'https://linkedin.de/uas/login',
  'https://login.live.co.uk',
  'https://login.live.com',
  'https://login.live.de',
  'https://okta.co.uk',
  'https://okta.com',
  'https://subdomain.okta.com',
  'https://okta.de',
  'https://twitter.co.uk/oauth/authenticate',
  'https://twitter.com/oauth/authenticate',
  'https://twitter.de/oauth/authenticate',
];

test.each(testLoginPages)(
  '%s login page should be internal',
  (loginUrl: string) => {
    expect(linkIsInternal(internalUrl, loginUrl, undefined)).toEqual(true);
  },
);

const smallCounterTitle = 'Inbox (11) - nobody@example.com - Gmail';
const largeCounterTitle = 'Inbox (8,756) - nobody@example.com - Gmail';
const noCounterTitle = 'Inbox - nobody@example.com - Gmail';

test('getCounterValue should return undefined for titles without counter numbers', () => {
  expect(getCounterValue(noCounterTitle)).toEqual(undefined);
});

test('getCounterValue should return a string for small counter numbers in the title', () => {
  expect(getCounterValue(smallCounterTitle)).toEqual('11');
});

test('getCounterValue should return a string for large counter numbers in the title', () => {
  expect(getCounterValue(largeCounterTitle)).toEqual('8,756');
});
