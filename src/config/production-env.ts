type Env = Record<string, unknown>;

const LOCAL_HOSTNAMES = new Set(['localhost', '::1', '0.0.0.0']);
const TUNNEL_HOST_SUFFIXES = [
  '.ngrok.io',
  '.ngrok-free.app',
  '.ngrok-free.dev',
];

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalOrTunnel(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) {
    return false;
  }
  return (
    LOCAL_HOSTNAMES.has(host) ||
    host.endsWith('.local') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    TUNNEL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

export function validateEnvironment(config: Env): Env {
  if (asString(config.NODE_ENV) !== 'production') {
    return config;
  }

  const errors: string[] = [];

  const bictorysUrl = asString(config.BICTORYS_API_URL);
  if (!bictorysUrl) {
    errors.push('BICTORYS_API_URL est obligatoire en production.');
  } else {
    if (!/^https:\/\//i.test(bictorysUrl)) {
      errors.push('BICTORYS_API_URL doit utiliser HTTPS en production.');
    }
    if (/\.test\./i.test(bictorysUrl) || /test\.bictorys/i.test(bictorysUrl)) {
      errors.push(
        `BICTORYS_API_URL pointe encore sur le sandbox (${bictorysUrl}). Utilisez https://api.bictorys.com/pay/v1.`,
      );
    }
  }

  const bictorysKey = asString(config.BICTORYS_API_KEY);
  if (!bictorysKey) {
    errors.push('BICTORYS_API_KEY est obligatoire en production.');
  } else if (/^test_/i.test(bictorysKey)) {
    errors.push(
      'BICTORYS_API_KEY est une clé de test (préfixe "test_"). Utilisez une clé de production.',
    );
  }

  if (!asString(config.BICTORYS_WEBHOOK_SECRET)) {
    errors.push(
      'BICTORYS_WEBHOOK_SECRET est obligatoire en production (webhook Live).',
    );
  }

  const apiPublicUrl = asString(config.API_PUBLIC_URL);
  if (!apiPublicUrl) {
    errors.push('API_PUBLIC_URL est obligatoire en production.');
  } else {
    if (!/^https:\/\//i.test(apiPublicUrl)) {
      errors.push('API_PUBLIC_URL doit utiliser HTTPS en production.');
    }
    if (isLocalOrTunnel(apiPublicUrl)) {
      errors.push(
        `API_PUBLIC_URL ne doit pas pointer vers localhost ou un tunnel (${apiPublicUrl}).`,
      );
    }
  }

  const frontendBrowserUrl = asString(
    config.FRONTEND_BROWSER_URL || config.FRONTEND_URL,
  );
  if (!frontendBrowserUrl) {
    errors.push(
      'FRONTEND_BROWSER_URL (ou FRONTEND_URL) est obligatoire en production.',
    );
  } else {
    if (!/^https:\/\//i.test(frontendBrowserUrl)) {
      errors.push('FRONTEND_BROWSER_URL doit utiliser HTTPS en production.');
    }
    if (isLocalOrTunnel(frontendBrowserUrl)) {
      errors.push(
        `FRONTEND_BROWSER_URL ne doit pas pointer vers localhost ou un tunnel (${frontendBrowserUrl}).`,
      );
    }
  }

  const allowedOrigins = asString(config.FRONTEND_URLS);
  if (allowedOrigins) {
    const localOrigins = allowedOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin && isLocalOrTunnel(origin));
    if (localOrigins.length) {
      errors.push(
        `FRONTEND_URLS contient des origines locales ou de tunnel : ${localOrigins.join(', ')}.`,
      );
    }
  }

  if (asString(config.META_TEST_EVENT_CODE)) {
    errors.push(
      'META_TEST_EVENT_CODE ne doit pas être défini en production (événements Meta en mode test).',
    );
  }

  if (errors.length) {
    throw new Error(
      `Configuration de production invalide :\n- ${errors.join('\n- ')}`,
    );
  }

  return config;
}
