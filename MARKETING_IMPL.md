# Implémentation Marketing - Détails techniques

## 1. Schéma Prisma (marketing/acquisition)

Modèles ajoutés :
- `Visitor` (anonymousId unique, emailHash/phoneHash SHA256, fbc/fbp/gaClientId/ttclid)
- `VisitorSession` (sessionKey, UTM + clickIds, platform résolu, landingPage, ip/userAgent/device, consent)
- `VisitorSessionEvent` (journal des événements UI/session)
- `MarketingEvent` (eventId UNIQUE, name, source BROWSER/SERVER, visitor/session/user/product/variant/order, value/currency/quantity, pagePath/pageUrl/referrer, eventTime)
- `AttributionTouchpoint` (platform, campaignKey, clickId, kind FIRST/LAST/ASSISTED)
- `ConversionLog` (provider META_CAPI/GOOGLE_OFFLINE, status PENDING/SENT/FAILED/SKIPPED, payload, attempts, lastError, responseCode, responseBody, sentAt, nextRetryAt) + `@@unique([eventId, provider])`
- `AdCampaign` (platform, externalId, name, utmCampaign, dailyBudget)
- `AdDailyStat` (date + métriques, spend, impressions, clicks, reach, videoViews, linkClicks) + `@@unique([campaignId, date])`
- `SearchQuery` (query/normalizedQuery, resultCount)
- `OrderStatusHistory` (fromStatus/toStatus, reason, createdById)

Champs ajoutés à `Order` :
- attribution : `visitorId`, `sessionId`, `firstTouchPlatform`, `firstTouchCampaign`, `firstTouchAt`, `lastTouchPlatform`, `lastTouchCampaign`
- lifecycle : `confirmedAt`, `paidAt`, `deliveredAt`, `cancelledAt`, `cancelReason`, `isCashOnDelivery`
- relations : `statusHistory`, `marketingEvents`, `touchpoints`

`MarketingEvent.eventId` est `@unique` → déduplication stricte.

---

## 2. Identity hashing

`src/tracking/utils/identity.util.ts`
- `normalizeEmail` → lowercase + trim
- `normalizePhone` → digits + garde `+`
- `sha256` (node:crypto)
- `hashEmail/hashPhone` → hashes pour Meta Advanced Matching
- `buildIdentity` → construit user_data (em/ph/fn/ln/city/country)
- `resolvePlatform` → résout TrafficPlatform depuis clickIds (fbclid/gclid/ttclid/gbraid/wbraid/msclkid), UTM, referrer
- `parseDevice`, `normalizeUtmValue`, `normalizeSearchTerm`

---

## 3. Meta Conversions API

`src/tracking/services/meta-capi.service.ts`
- Mapping `TrackingEventName` → Meta event (`PageView, ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo, Purchase, Search, Lead, Subscribe`)
- Construit `user_data` : em/ph, external_id (visitorId/userId), fbc/fbp, country
- `custom_data` : currency/value, content_ids, content_type, num_items, order_id, search_string
- `action_source = 'website'`, `event_time` (epoch seconds)
- Dispatch POST `https://graph.facebook.com/{version}/{pixelId}/events` avec `access_token` + `test_event_code` optionnel
- Retourne `MetaDispatchResult` (sent/skipped/failed + response)
- Écrit `ConversionLog` (META_CAPI) avec upsert `[eventId, provider]`

Variables env : `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `META_TEST_EVENT_CODE`, `META_GRAPH_API_VERSION` (défaut v22.0)

---

## 4. Tracking Service

`src/tracking/tracking.service.ts`

Méthodes publiques :
- `startSession(dto, req)` : crée Visitor + VisitorSession, résout platform/clickIds/referrerDomain/device/ip, enregistre PAGE_VIEW
- `identify(dto)` : attache userId + hashes identité + fbc/fbp, recopie userId sur events/sessions existants
- `recordPageView(dto, req)` : touche session + crée event + sessionEvent
- `recordSearch(dto)` : crée SearchQuery + event SEARCH + dispatch Meta
- `trackEvents(dto, req)` : batch d'événements (dédup via eventId), enregistre sessionEvents + dispatch Meta
- `trackPurchase(orderId, req)` : server-side, attache visitor/session depuis Order, crée event `purchase-{orderNumber}` si absent, relie à Order, dispatch Meta
- `trackRefund(orderId)` : crée event LEAD (placeholder extensible)
- `getEventsPendingDispatch(provider, limit)` : utilitaire

Déduplication : `MarketingEvent.findUnique({ where: { eventId } })` → si existe, retourne l'existant (ignore réémission)
Session timeout : 30 min (lastSeenAt) → si expirée, `endedAt = now` et refuse résolution

Attribution : `resolvePlatform` priorise clickId (paid) puis UTM+referrer (SEO/social/direct)

---

## 5. Orders Service (branchement)

`src/orders/orders.service.ts`
- Après création (transaction) : enregistre `OrderStatusHistory` (PENDING→PENDING logique facultative) + tente `trackingService.trackPurchase(order.id)` (non bloquant, try/catch log)
- `updateStatus` : écrit `OrderStatusHistory` (from→to, reason, createdById). Sur `DELIVERED` → `deliveredAt = now`. Sur `CANCELLED`/`REFUNDED` → `cancelledAt = now`, peut renseigner `cancelReason`. Sur `PAID` (si utilisé) → `paidAt = now`
- `updatePaymentStatus(PAID)` → set `paidAt = now`, envoie email confirmation (inchangé)

But : avoir des timestamps fiables pour taux d'annulation/refus + déclencher Purchase CAPI côté serveur (anti-tampering).

---

## 6. Marketing KPIs Service

`src/marketing/marketing.service.ts`

Endpoints :
- `overview` : revenue (orders payées + status CONFIRMED/IN_DELIVERY/DELIVERED), AOV, spend (somme AdDailyStat), ROAS = revenue/spend, cancelRate = (CANCELLED+REFUNDED+cancelReason in refused)/total created? (implémenté sur périmètre revenu+refus), sessions, metaCapiSent
- `platforms` : groupBy `lastTouchPlatform` sur orders payées, agrège spend par platform via `AdCampaign.platform`, calcule ROAS
- `funnel` : sessions, PAGE_VIEW/ADD_TO_CART/INITIATE_CHECKOUT counts, purchases (payées), taux de conversion
- `timeline` : revenu/commandes par jour/semaine/mois

Filtres : `startDate,endDate,platform,groupBy,limit`

---

## 7. Jobs retry Meta CAPI

`src/tracking/tracking.jobs.ts` + `ScheduleModule` déjà actif
- `@Cron(CronExpression.EVERY_5_MINUTES)` `retryFailedMetaEvents`
- Cible `ConversionLog` META_CAPI status FAILED, nextRetryAt <= now, attempts < 10
- Relance dispatch, met à jour status/attempts/lastError/responseBody/sentAt/nextRetryAt
- Backoff exponentiel : `nextRetryAt = now + min(2h, 2^(attempts)*60s)`

---

## 8. Sécurité / CORS / Auth

Tracking endpoints `@Public()` (session bootstrap + events côté navigateur). KPIs sous `JwtAuthGuard + RolesGuard` (ADMIN/STAFF). `CORS` autorise origines FRONTEND_URLS + `x-session-id` header. `trust proxy 1` pour IP derrière reverse proxy.

---

## 9. Migration

Fichier : `prisma/migrations/20261003120000_marketing_tracking/migration.sql`
- Nouveaux enums + tables (Visitor, VisitorSession, VisitorSessionEvent, MarketingEvent restructuré, AttributionTouchpoint, ConversionLog, AdCampaign, AdDailyStat, SearchQuery, OrderStatusHistory)
- Ajouts colonnes Order (attribution + lifecycle + isCashOnDelivery + cancelReason)
- `DELETE FROM "MarketingEvent";` avant ALTER NOT NULL (table vide à l'époque)
- Index optimisés pour eventTime/platform/campaign/session/visitor

Appliquer : `npx prisma migrate deploy` (prod) ou `npx prisma migrate dev` selon environnement.

---

## 10. Points d'attention

- `eventId` côté front doit être stable (uuid v4 ok) mais éviter collision
- Purchase ne doit JAMAIS être envoyé front (uniquement serveur)
- Meta exige user_data minimal cohérent (email/phone hashés E.164)
- ROAS utilise `AdDailyStat.spend` (import manuel/automatique requis)
- `cancelRate` défini sur fenêtre temporelle (commandes créées dans range + motifs refus COD)
- iOS 14.5+ → fbc/fbp + CAPI + EMQ cruciaux

---

## 11. Tests rapides (curl type)

```bash
# Start session
curl -X POST http://localhost:3000/api/tracking/session/start -H 'Content-Type: application/json' \
  -d '{"anonymousId":"a1","sessionKey":"s1","landingPage":"http://localhost:5173/","consentGranted":true}'

# Pageview
curl -X POST http://localhost:3000/api/tracking/pageview -H 'Content-Type: application/json' \
  -d '{"sessionKey":"s1","pagePath":"/produits","pageUrl":"http://localhost:5173/produits"}'

# Events (ATC)
curl -X POST http://localhost:3000/api/tracking/events -H 'Content-Type: application/json' \
  -d '{"sessionKey":"s1","events":[{"eventId":"e1","name":"ADD_TO_CART","productId":"p1","quantity":1,"value":5000}]}'

# KPIs (auth required)
curl http://localhost:3000/api/marketing/overview -H "Authorization: Bearer TOKEN"
```

---

## 12. Frontend checklist intégration

- [ ] Générer anonymousId/sessionKey au boot
- [ ] Lire UTM + clickIds + fbp/fbc depuis URL/cookies
- [ ] `session/start` au premier rendu (landing)
- [ ] `pageview` sur navigation SPA
- [ ] `identify` après login
- [ ] `events` pour VIEW_CONTENT/ATC/INITIATE_CHECKOUT/ADD_PAYMENT_INFO
- [ ] Conserver `x-session-id` header sur cart/order
- [ ] Appeler `search` sur recherche
- [ ] Afficher KPIs marketing (overview/platforms/funnel/timeline)

---

**Statut** : Implémentation complète, type-safe, schéma validé, migration fournie.
