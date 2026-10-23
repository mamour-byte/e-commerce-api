import { validateEnvironment } from './production-env';

const validProductionEnv = {
  NODE_ENV: 'production',
  BICTORYS_API_URL: 'https://api.bictorys.com/pay/v1',
  BICTORYS_API_KEY: 'public-abc.def',
  BICTORYS_WEBHOOK_SECRET: 'whsec_live',
  API_PUBLIC_URL: 'https://api.hayat-sn.store',
  FRONTEND_BROWSER_URL: 'https://www.hayat-sn.store',
  FRONTEND_URLS: 'https://hayat-sn.store,https://www.hayat-sn.store',
};

describe('validateEnvironment', () => {
  it('accepte une configuration de production valide', () => {
    expect(() => validateEnvironment({ ...validProductionEnv })).not.toThrow();
  });

  it('ignore les contrôles hors production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'development',
        BICTORYS_API_URL: 'https://api.test.bictorys.com/pay/v1',
        BICTORYS_API_KEY: 'test_public-abc.def',
        API_PUBLIC_URL: 'http://localhost:3000',
        META_TEST_EVENT_CODE: 'TEST30041',
      }),
    ).not.toThrow();
  });

  it('refuse une URL Bictorys de sandbox', () => {
    expect(() =>
      validateEnvironment({
        ...validProductionEnv,
        BICTORYS_API_URL: 'https://api.test.bictorys.com/pay/v1',
      }),
    ).toThrow(/sandbox/i);
  });

  it('refuse une clé Bictorys de test', () => {
    expect(() =>
      validateEnvironment({
        ...validProductionEnv,
        BICTORYS_API_KEY: 'test_public-abc.def',
      }),
    ).toThrow(/clé de test/i);
  });

  it('refuse une URL publique locale ou un tunnel', () => {
    expect(() =>
      validateEnvironment({
        ...validProductionEnv,
        API_PUBLIC_URL: 'https://utmost-arbitrary-grill.ngrok-free.dev',
      }),
    ).toThrow(/tunnel/i);
  });

  it('refuse une URL front en HTTP', () => {
    expect(() =>
      validateEnvironment({
        ...validProductionEnv,
        FRONTEND_BROWSER_URL: 'http://www.hayat-sn.store',
      }),
    ).toThrow(/HTTPS/i);
  });

  it('refuse META_TEST_EVENT_CODE en production', () => {
    expect(() =>
      validateEnvironment({
        ...validProductionEnv,
        META_TEST_EVENT_CODE: 'TEST30041',
      }),
    ).toThrow(/META_TEST_EVENT_CODE/i);
  });

  it('refuse un webhook secret manquant', () => {
    expect(() =>
      validateEnvironment({
        ...validProductionEnv,
        BICTORYS_WEBHOOK_SECRET: '',
      }),
    ).toThrow(/BICTORYS_WEBHOOK_SECRET/i);
  });
});
