import { describe, expect, it } from 'vitest';
import { readConfig } from './index.js';

const base = {
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost',
};
const bot = {
  ...base,
  TELEGRAM_BOT_TOKEN: '123:test',
  MINI_APP_URL: 'https://app.example.com',
};
describe('Telegram runtime configuration', () => {
  it('keeps National Catalog optional and validates bounded environment/timeouts', () => {
    expect(readConfig(base).CHZ_NATIONAL_CATALOG_API_KEY).toBeUndefined();
    expect(
      readConfig({
        ...base,
        CHZ_NATIONAL_CATALOG_API_KEY: '',
        CHZ_NATIONAL_CATALOG_ENVIRONMENT: 'sandbox',
        CHZ_NATIONAL_CATALOG_TIMEOUT_MS: '1500',
      }),
    ).toMatchObject({
      CHZ_NATIONAL_CATALOG_API_KEY: undefined,
      CHZ_NATIONAL_CATALOG_ENVIRONMENT: 'sandbox',
      CHZ_NATIONAL_CATALOG_TIMEOUT_MS: 1500,
    });
    expect(() =>
      readConfig({ ...base, CHZ_NATIONAL_CATALOG_TIMEOUT_MS: '60000' }),
    ).toThrow();
    expect(() =>
      readConfig({
        ...base,
        CHZ_NATIONAL_CATALOG_ENVIRONMENT: 'https://untrusted.example',
      }),
    ).toThrow();
  });
  it('supports health checks without Telegram credentials', () => {
    expect(readConfig(base).TELEGRAM_MODE).toBe('disabled');
  });
  it('requires credentials and HTTPS when enabled', () => {
    expect(() => readConfig({ ...base, TELEGRAM_MODE: 'polling' })).toThrow();
    expect(() =>
      readConfig({
        ...bot,
        TELEGRAM_MODE: 'polling',
        MINI_APP_URL: 'http://localhost',
      }),
    ).toThrow();
  });
  it('requires webhook delivery and a valid secret in production', () => {
    expect(() =>
      readConfig({ ...bot, NODE_ENV: 'production', TELEGRAM_MODE: 'polling' }),
    ).toThrow();
    expect(() => readConfig({ ...bot, TELEGRAM_MODE: 'webhook' })).toThrow();
    expect(
      readConfig({
        ...bot,
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'webhook',
        TELEGRAM_WEBHOOK_SECRET: 'test-secret',
      }).TELEGRAM_MODE,
    ).toBe('webhook');
  });
});

it('rejects direct CHZ sending without a selected submission channel and pinned signer', () => {
  expect(() =>
    readConfig({
      DATABASE_URL: 'postgresql://local/db',
      REDIS_URL: 'redis://localhost:6379',
      CHZ_DOCUMENT_SUBMISSION_ENABLED: 'true',
      CHZ_SUBMISSION_MODE: 'AVITO_OFD',
    }),
  ).toThrow('Direct CHZ sending requires');
});

it('requires a public HTTPS API and encryption for Telegram installation', () => {
  expect(() =>
    readConfig({
      ...bot,
      TELEGRAM_MODE: 'polling',
      SIGNER_TELEGRAM_ENROLLMENT_ENABLED: 'true',
    }),
  ).toThrow('Telegram signer setup');
  const valid = {
    ...bot,
    TELEGRAM_MODE: 'polling',
    SIGNER_TELEGRAM_ENROLLMENT_ENABLED: 'true',
    PUBLIC_API_URL: 'https://api.example.com',
    MARKING_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  };
  expect(readConfig(valid).PUBLIC_API_URL).toBe('https://api.example.com');
  expect(() =>
    readConfig({
      ...valid,
      PUBLIC_API_URL: 'https://api.example.com/?token=secret',
    }),
  ).toThrow();
});

describe('CHZ proxy configuration', () => {
  it('is disabled by default and permits a stored URL while disabled', () => {
    expect(readConfig(base).CHZ_PROXY_ENABLED).toBe(false);
    expect(
      readConfig({ ...base, CHZ_PROXY_URL: '' }).CHZ_PROXY_URL,
    ).toBeUndefined();
    expect(
      readConfig({ ...base, CHZ_PROXY_URL: 'http://proxy.example:3128' }),
    ).toMatchObject({
      CHZ_PROXY_ENABLED: false,
      CHZ_PROXY_URL: 'http://proxy.example:3128',
    });
  });
  it('requires an explicit URL when enabled', () => {
    expect(() => readConfig({ ...base, CHZ_PROXY_ENABLED: 'true' })).toThrow(
      'CHZ_PROXY_ENABLED requires CHZ_PROXY_URL',
    );
    expect(
      readConfig({
        ...base,
        CHZ_PROXY_ENABLED: 'true',
        CHZ_PROXY_URL: 'http://proxy.example:3128',
      }).CHZ_PROXY_ENABLED,
    ).toBe(true);
    expect(() => readConfig({ ...base, CHZ_PROXY_ENABLED: 'yes' })).toThrow();
  });
  it.each([
    'socks5://proxy.example:1080',
    'http://user:secret@proxy.example:3128',
    'http://proxy.example:3128/path',
    'http://proxy.example:3128?secret=value',
    'http://proxy.example:3128#fragment',
  ])('rejects unsupported proxy origins: %s', (url) => {
    expect(() =>
      readConfig({ ...base, CHZ_PROXY_ENABLED: 'true', CHZ_PROXY_URL: url }),
    ).toThrow();
  });
});
