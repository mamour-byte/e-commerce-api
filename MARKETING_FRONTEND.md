# Hayat Store - Marketing Tracking & KPIs

## Vue d'ensemble
Ce document décrit l'intégration frontend du tracking marketing (sessions, événements, attribution) et l'utilisation des routes KPI pour le tableau de bord conversions.

Base URL API : `https://api.hayat-sn.store/api` (dev : `http://localhost:3000/api`)

---

## 1. Variables d'environnement (Frontend)

```env
VITE_API_URL=http://localhost:3000/api
VITE_SITE_URL=http://localhost:5173
```

---

## 2. Identifiants de session (obligatoires)

Le tracking repose sur :
- `anonymousId` : ID anonyme persistant (localStorage)
- `sessionKey` : ID de session (sessionStorage, renouvelé à expiration 30min)

Générer :

```ts
import { v4 as uuidv4 } from 'uuid';

function getAnonymousId(): string {
  let id = localStorage.getItem('hs_anonymous_id');
  if (!id) {
    id = uuidv4();
    localStorage.setItem('hs_anonymous_id', id);
  }
  return id;
}

function getSessionKey(): string {
  let key = sessionStorage.getItem('hs_session_key');
  const ts = Number(sessionStorage.getItem('hs_session_ts') || 0);
  const now = Date.now();
  // 30 min timeout
  if (!key || now - ts > 30 * 60 * 1000) {
    key = uuidv4();
    sessionStorage.setItem('hs_session_key', key);
    sessionStorage.setItem('hs_session_ts', String(now));
  } else {
    sessionStorage.setItem('hs_session_ts', String(now));
  }
  return key;
}
```

Toujours envoyer `x-session-id` (header) sur panier/commande (déjà utilisé).

---

## 3. Démarrer une session

`POST /api/tracking/session/start`

Body :
```ts
{
  anonymousId: string;
  sessionKey: string;
  landingPage: string;      // URL complète
  pagePath?: string;        // ex. /produit/123
  referrer?: string;
  userAgent?: string;       // optionnel (navigateur)
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  utmId?: string;
  fbclid?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  ttclid?: string;
  msclkid?: string;
  fbc?: string;             // _fbc cookie Meta
  fbp?: string;             // _fbp cookie Meta
  consentGranted: boolean;
}
```

À appeler au premier chargement (landing) ou quand session expire. Retourne la session + visitor.

### Extraire fbc/fbp (Meta)

```ts
function getCookie(name: string) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : undefined;
}
const fbp = getCookie('_fbp');
const fbc = getCookie('_fbc');
```

### UTM/ClickIds depuis URL
Extraire depuis `location.search` (fbclid, gclid, ttclid, utm_*).

---

## 4. Page View

`POST /api/tracking/pageview`

```ts
{
  sessionKey: string;
  pagePath?: string;
  pageUrl?: string;
  referrer?: string;
}
```

Appeler sur route change (SPA). 

---

## 5. Identify (connexion client)

`POST /api/tracking/identify`

```ts
{
  anonymousId: string;
  sessionKey?: string;
  userId?: string;      // ID utilisateur
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  country?: string;     // 'SN'
  fbc?: string;
  fbp?: string;
}
```

À appeler après login/inscription. Hash SHA256 (email/phone) côté serveur (advanced matching Meta).

---

## 6. Recherche interne

`POST /api/tracking/search`

```ts
{
  sessionKey: string;
  query: string;
  resultCount: number;
}
```

Sur soumission barre de recherche.

---

## 7. Événements (batch)

`POST /api/tracking/events`

```ts
{
  sessionKey: string;
  anonymousId?: string;
  userId?: string;
  events: Array<{
    eventId: string;                // unique (dédup)
    name: 'PAGE_VIEW'|'VIEW_CONTENT'|'ADD_TO_CART'|'ADD_TO_WISHLIST'|'INITIATE_CHECKOUT'|'ADD_PAYMENT_INFO'|'PURCHASE'|'SEARCH'|'LEAD'|'SUBSCRIBE';
    eventTime?: string;             // ISO
    pagePath?: string;
    pageUrl?: string;
    referrer?: string;
    productId?: string;
    variantId?: string;
    orderId?: string;
    searchQuery?: string;
    quantity?: number;
    value?: number;                 // XOF
  }>
}
```

Règles :
- `eventId` obligatoire + unique (rejouer même ID → ignoré côté serveur)
- Envoyer batch (max 50). Regrouper événements critiques (ATC, Checkout)
- `value` pour valeur monétaire (XOF)

Exemples :

```ts
// ViewContent
events: [{
  eventId: `vc-${productId}-${Date.now()}`,
  name: 'VIEW_CONTENT',
  productId,
  value: price,
  pageUrl: location.href,
}]

// AddToCart
events: [{
  eventId: `atc-${cartItemId}-${Date.now()}`,
  name: 'ADD_TO_CART',
  productId, variantId, quantity, value: price*quantity
}]

// InitiateCheckout
events: [{
  eventId: `ic-${cartId}-${Date.now()}`,
  name: 'INITIATE_CHECKOUT',
  value: subtotal,
}]

// AddPaymentInfo
events: [{
  eventId: `api-${orderDraftId}-${Date.now()}`,
  name: 'ADD_PAYMENT_INFO',
  value: total,
}]
```

---

## 8. Achat (server-side)

L'achat est **automatiquement tracké côté API** à la création/confirmation de paiement (`trackPurchase` sur Order). Pas besoin d'envoyer `PURCHASE` depuis le front (source de vérité). Refund éventuel via `trackRefund`.

---

## 9. KPIs Marketing (routes protégées)

Toutes sous `/api/marketing`, auth JWT + rôle `ADMIN`/`STAFF`.

### 9.1 Vue d'ensemble
`GET /api/marketing/overview`

Query :
```ts
{
  startDate?: string;  // ISO
  endDate?: string;
  platform?: 'META'|'GOOGLE'|'TIKTOK'|'ORGANIC'|'DIRECT'|'REFERRAL'|'EMAIL'|'WHATSAPP'|'UNKNOWN';
}
```

Retour :
```json
{
  "range": {"startDate":"...","endDate":"..."},
  "revenue": 1250000,
  "orders": 42,
  "aov": 29761.9,
  "spend": 400000,
  "roas": 3.125,
  "cancelRate": 14.3,
  "sessions": 580,
  "metaCapiSent": 120
}
```

### 9.2 Comparaison par plateforme
`GET /api/marketing/platforms`

Query : `startDate,endDate`
```json
{
  "range": {...},
  "data": [
    {"platform":"META","revenue":800000,"orders":26,"spend":250000,"roas":3.2},
    {"platform":"GOOGLE","revenue":450000,"orders":16,"spend":150000,"roas":3.0},
    {"platform":"DIRECT","revenue":0,"orders":0,"spend":0,"roas":0}
  ]
}
```

### 9.3 Entonnoir
`GET /api/marketing/funnel`

```json
{
  "range": {...},
  "sessions": 580,
  "pageViews": 2100,
  "addToCart": 240,
  "initiateCheckout": 95,
  "purchases": 42,
  "crPageViewToPurchase": 2.0,
  "crAtcToPurchase": 17.5
}
```

### 9.4 Timeline
`GET /api/marketing/timeline?groupBy=day|week|month`

```json
{
  "range": {...},
  "data": [
    {"date":"2026-10-01","revenue":180000,"orders":6},
    {"date":"2026-10-02","revenue":220000,"orders":8}
  ]
}
```

---

## 10. Recommandations KPIs (à suivre)

| KPI | Formule | Objectif |
|---|---|---|
| **ROAS** | Chiffre d'affaires / Dépenses Ads | > 2.5–4 (dépend marge) |
| **MER (Marketing Efficiency Ratio)** | (Revenue - Refunds) / Spend total | Stable |
| **AOV** | CA / Commandes (payées) | +upsell/cross-sell |
| **CVR (Purchase/Session)** | Commandes payées / Sessions | 1.5% – 3% |
| **CTR/Link Clicks** | Depuis Meta/Google (import CSV AdDailyStat) | Suivre tendance |
| **Taux annulation/refus** | (Annulées + Refus COD) / (Commandes créées) | < 10–15% |
| **Taux livraison réussie** | DELIVERED / (CONFIRMED+IN_DELIVERY+DELIVERED) | > 90% |
| **CLTV (Customer Lifetime Value)** | CA moyen/client sur 90–180j | Croissance |
| **CPO (Coût/Commande)** | Spend / Commandes | < AOV/marge |
| **Event Match Quality (EMQ)** | Meta Events Manager (emailHash+phoneHash + fbc/fbp) | Maximaliser |

---

## 11. Bonnes pratiques tracking

- Toujours démarrer session avant événements SPA
- Utiliser `eventId` déterministe (évite doublons CAPI)
- Ne pas envoyer `PURCHASE` front (serveur uniquement)
- Identifier utilisateur à la connexion (advanced matching)
- Conserver `x-session-id` sur tous les appels cart/order
- Respect consent (Consent Mode v2 à prévoir si besoin RGPD)
- Tester en Meta Events Manager (Test Events) avec `META_TEST_EVENT_CODE`

---

## 12. Dépenses publicitaires

Importer `AdDailyStat` (CSV quotidien Meta/Google) : `date`, `campaignId/externalId`, `spend`, `impressions`, `clicks`, `reach`, `videoViews`, `linkClicks`. À créer via endpoint admin (à ajouter si besoin) ou script d'import.

---

## Notes
- Schéma : `MarketingEvent.eventId` unique (dédup CAPI critique)
- Attribution : `lastTouchPlatform/campaign` sur Order (server-side)
- Purchase CAPI : envoyé sur paiement/livraison selon logique (ici à l'appel tracking purchase côté service Order)
- Retry Meta CAPI : cron 5min (max 10 tentatives exponentielles)
