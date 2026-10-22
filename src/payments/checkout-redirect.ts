/**
 * Redirection du navigateur après paiement.
 *
 * Les prestataires de paiement (Bictorys, Wave, Orange Money) redirigent le
 * navigateur vers une URL qui doit être **publique** (le sandbox Bictorys
 * refuse les adresses locales en 403). Cette URL pointe donc sur l'API, qui
 * relaie ensuite le navigateur vers le front via une redirection 302.
 *
 * Deux bases d'URL sont donc utilisées :
 * - `API_PUBLIC_URL`  : URL publique de l'API, communiquée au prestataire.
 * - `FRONTEND_BROWSER_URL` : URL finale atteinte par le navigateur (peut être
 *   une adresse locale en développement).
 */

/** Étapes possibles du parcours de paiement. */
export type CheckoutRedirectKind = 'success' | 'failed' | 'error' | 'cancel';

/** Route de l'API qui relaie la redirection vers le front. */
export const CHECKOUT_REDIRECT_PATH = '/api/payments/redirect';

/** Page du front correspondant à chaque étape. */
const CHECKOUT_PAGES: Record<CheckoutRedirectKind, string> = {
  success: '/checkout/success',
  failed: '/checkout/failed',
  error: '/checkout/failed',
  cancel: '/checkout/failed',
};

export type CheckoutRedirectParams = {
  orderId?: string | null;
  orderNumber?: string | null;
};

/** Retire le slash final pour pouvoir concaténer des chemins. */
export function normalizeBaseUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '');
}

/** Sérialise les paramètres de retour (uniquement ceux attendus). */
export function buildRedirectQuery(params: CheckoutRedirectParams): string {
  const query = new URLSearchParams();
  if (params.orderId) {
    query.set('orderId', params.orderId);
  }
  if (params.orderNumber) {
    query.set('orderNumber', params.orderNumber);
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export function isCheckoutRedirectKind(
  value: string,
): value is CheckoutRedirectKind {
  return Object.prototype.hasOwnProperty.call(CHECKOUT_PAGES, value) as boolean;
}

/**
 * URL communiquée au prestataire : elle est publique et transite par l'API.
 */
export function buildProviderRedirectUrl(
  apiPublicUrl: string,
  kind: CheckoutRedirectKind,
  params: CheckoutRedirectParams,
): string {
  return `${normalizeBaseUrl(apiPublicUrl)}${CHECKOUT_REDIRECT_PATH}/${kind}${buildRedirectQuery(params)}`;
}

/** URL finale atteinte par le navigateur. */
export function buildBrowserRedirectUrl(
  frontendUrl: string,
  kind: CheckoutRedirectKind,
  params: CheckoutRedirectParams,
): string {
  return `${normalizeBaseUrl(frontendUrl)}${CHECKOUT_PAGES[kind]}${buildRedirectQuery(params)}`;
}
