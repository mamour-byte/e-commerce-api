# Intégration Bictorys (Checkout hébergé) — Hayat Store

## 1. Principe : la redirection navigateur ne prouve rien

Le flux de paiement repose sur une règle simple :

> Une commande n'est marquée **payée** (`PaymentStatus.PAID` / `OrderStatus.CONFIRMED`)
> que si le serveur a interrogé Bictorys et constaté une transaction **réussie,
> dans la bonne devise, pour un montant couvrant le total de la commande**.

Concrètement :

| Source | Rôle | Peut-elle confirmer le paiement ? |
| --- | --- | --- |
| Redirection navigateur (`/checkout/success`) | Retour visuel du client | **Non** |
| Notification webhook Bictorys | Signal de changement d'état | **Non** seule (elle déclenche une vérification) |
| `GET /pay/v1/transactions/{id}` | État réel de la transaction | **Oui** (source de vérité) |
| Bouton « Vérifier le paiement » | Déclenche la vérification serveur | **Oui** |

Toute la logique est dans `src/payments/payments.service.ts` :

- `handleBictorysWebhook()` : reçoit la notification, refuse si le secret est invalide,
  puis lance la vérification serveur.
- `verifyBictorysTransaction()` : contrôle statut + devise + montant.
- `confirmPayment()` : marque le paiement `PAID` **de façon idempotente**
  (`updateMany` sur `status != PAID`), met la commande à `CONFIRMED`, puis envoie
  la notification in-app, l'événement de tracking `PURCHASE` et l'email de reçu.
- `verifyBictorysPayment()` : vérification manuelle (bouton côté client).
- `getCheckoutStatus()` : état réel renvoyé au front pour afficher la page de retour.

---

## 2. Configuration

Variables d'environnement (`.env` à la racine de `ecommerce-api`) :

```bash
# Clé API (dashboard Bictorys > Développeur > Clés API)
BICTORYS_API_KEY=public-xxxx-xxxx-xxxx.xxxxx
# URL de l'API (sandbox par défaut)
BICTORYS_API_URL=https://api.test.bictorys.com/pay/v1
# Clé secrète du webhook (dashboard Bictorys > Développeur > Webhooks)
BICTORYS_WEBHOOK_SECRET=whsec_xxxxx
# Paramètres de la page de paiement
BICTORYS_COUNTRY=SN
BICTORYS_LOCALE=fr-FR
# Facultatif : restreint l'onglet affiché (card | mobile_money)
BICTORYS_PAYMENT_CATEGORY=
# URL publique de l'API (URL de retour communiquée à Bictorys)
API_PUBLIC_URL=https://xxxx.ngrok-free.dev
# URL finale du front atteinte par le navigateur après paiement
FRONTEND_BROWSER_URL=http://localhost:5173
# URL publique du front (fallback si FRONTEND_BROWSER_URL est absent)
FRONTEND_URL=http://localhost:5173
# Cycle de vie des paiements (règle métier Hayat Store, pas une expiration Bictorys)
PAYMENT_EXPIRATION_MINUTES=15
PAYMENT_EXPIRY_GRACE_MINUTES=10
PAYMENT_RECONCILIATION_RETRY_MINUTES=15
```

> En production, `API_PUBLIC_URL` et `FRONTEND_BROWSER_URL` doivent être en
> **HTTPS** : Bictorys refuse les URLs de redirection non sécurisées.

Sans `BICTORYS_API_KEY` ou sans `BICTORYS_WEBHOOK_SECRET`, le service est
**fail-closed** : la création de session et le webhook sont refusés. Aucune
simulation de paiement n'est possible.

### 2.1 Le pare-feu du sandbox refuse les URLs locales

Le sandbox Bictorys filtre les URLs de redirection pointant vers une adresse
locale (`localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, `*.local`) : la création de
la session Checkout est alors refusée en **403** (le corps de la réponse est du
HTML, pas du JSON).

Conséquence pratique : l'URL de retour communiquée à Bictorys doit pointer vers
une **URL publique** — c'est le rôle de `API_PUBLIC_URL` (le tunnel ngrok
pointant sur l'API, port 3000). Une URL publique en `http://` est acceptée par
le sandbox, mais `https://` est requis en production.

```bash
# npm run ngrok (tunnel vers l'API : 127.0.0.1:3000) -> https://xxxx.ngrok-free.dev
API_PUBLIC_URL=https://xxxx.ngrok-free.dev
```

### 2.1.1 Redirection en deux temps (API → front)

Bictorys redirige le navigateur vers l'API, qui répond par une **302** vers le
front : c'est ce qui permet de tester en local tout en gardant une URL
publique pour le prestataire.

```
Bictorys  ──►  https://xxxx.ngrok-free.dev/api/payments/redirect/success?orderId=…&orderNumber=…
                      │
                      └─ 302 ──►  http://localhost:5173/checkout/success?orderId=…&orderNumber=…
```

| Variable | Rôle | Valeur en local |
| --- | --- | --- |
| `API_PUBLIC_URL` | URL de retour donnée à Bictorys (doit être publique) | `https://xxxx.ngrok-free.dev` |
| `FRONTEND_BROWSER_URL` | URL finale atteinte par le navigateur | `http://localhost:5173` |

> Le tunnel ngrok doit pointer sur **l'API** (`npm run ngrok` → `127.0.0.1:3000`),
> pas sur le serveur Vite : la route `/api/payments/redirect/:kind` est servie
> par l'API. Le webhook suit la même logique (`/api/payments/webhooks/bictorys`).

### 2.2 Clé publique vs clé privée

| Clé | Création de session | Lecture des transactions |
| --- | --- | --- |
| `test_public-…` | ✅ | ❌ `403 E403-1: Access right not sufficient` |
| clé privée (`test_private-…`) | ✅ | ✅ |

Avec une **clé publique**, `GET /pay/v1/transactions/{id}` renvoie systématiquement
`403`. Le service le détecte (`BictorysService.isTransactionReadForbidden()`) et
se rabat alors sur la **notification authentifiée** par la clé secrète du
webhook : statut, montant et devise de la notification sont comparés au total
de la commande, et la confirmation est tracée dans les métadonnées du paiement :

```
Payment.metadata.bictorysVerification = 'server'  // transaction relue chez Bictorys
Payment.metadata.bictorysVerification = 'webhook'  // notification authentifiée (clé publique)
```

Les montants annoncés par la notification sont persistés
(`bictorysWebhookAmount`, `bictorysWebhookCurrency`, `bictorysWebhookStatus`) et
servent à la vérification manuelle (« Vérifier le paiement »). Sans aucun
montant connu, la confirmation reste refusée (fail-closed).

> Recommandation : utiliser une **clé privée** en production pour s'appuyer sur
> la source de vérité serveur.

---

## 3. Mise en place du webhook

Dans le dashboard Bictorys, créer un webhook (mode test) :

| Champ | Valeur |
| --- | --- |
| URL | `https://<api-domaine>/api/payments/webhooks/bictorys` |
| Secret | la même valeur que `BICTORYS_WEBHOOK_SECRET` |
| Événements | transaction (succeeded / failed) |

> ⚠️ Le préfixe `/api/payments` est **obligatoire** : le controller est déclaré
> `@Controller('payments')` et l'application utilise le préfixe global `api`.
> L'URL `https://<domaine>/webhooks/bictorys` renvoie un **404**.
> (Si le tunnel ngrok pointe sur le serveur Vite, le proxy `/api` relaie
> l'appel vers l'API : l'URL reste bien `/api/payments/webhooks/bictorys`.)

Bictorys envoie alors le header `X-Secret-Key` et un payload de la forme :

```json
{
  "id": "tx_123",
  "status": "succeeded",
  "amount": 15000,
  "currency": "XOF",
  "paymentReference": "ORD-20260101-ABCDE",
  "merchantReference": "clxxxxxxxxxxxxxxxxxxxxxxxxx",
  "pspName": "wave"
}
```

Le webhook est authentifié par comparaison **à temps constant** du header
`X-Secret-Key` (SHA-256 + `timingSafeEqual`).

---

## 4. Rapprochement des références

| Champ Bictorys | Valeur envoyée | Usage |
| --- | --- | --- |
| `paymentReference` | `order.orderNumber` assaini (`A-Za-z0-9_-`, 64 car. max) | référence affichée sur la page de paiement + rapprochement webhook |
| `merchantReference` | `order.id` (cuid) | clé de rapprochement interne, la plus fiable |
| `Payment.providerReference` | `order.orderNumber` | référence persistée en base |

À la réception d'un webhook, le paiement est retrouvé dans cet ordre :
`transactionId` → `providerReference` (= `paymentReference`) → numéro de commande
(= `merchantReference`).

---

## 5. Règles de validation d'une transaction

`verifyBictorysTransaction()` refuse la confirmation si l'un des points suivants
n'est pas satisfait :

1. **Clé secrète webhook valide** (fail-closed).
2. **Statut de transaction réussi** : `succeeded` ou `authorized`.
3. **Devise identique** à celle de la commande (`XOF` par défaut).
4. **Montant** : tous les montants connus (transaction serveur **et** notification)
   doivent couvrir le total de la commande, avec une tolérance de `0.01`.
   Si aucun montant n'est connu → refus.
5. **Identifiant de transaction connu** (la vérification serveur est obligatoire,
   sauf si la clé API n'a pas le droit de lecture : voir § 2.2).

Un paiement refusé est laissé en `PROCESSING` avec le motif dans
`Payment.metadata.holdReason` (revue manuelle possible depuis l'admin).

---

## 6. Endpoints

| Méthode | Route | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/payments/initiate` | optionnelle | Crée la session Checkout (`provider = BICTORYS`) |
| `POST` | `/api/payments/webhooks/bictorys` | header `X-Secret-Key` | Notification serveur à serveur |
| `GET` | `/api/payments/checkout-status?orderId=…&orderNumber=…` | publique | État **réel** du paiement (page de retour) |
| `GET` | `/api/payments/redirect/:kind?orderId=…&orderNumber=…` | publique | Relais de redirection (302) du navigateur vers le front |
| `POST` | `/api/payments/bictorys/verify/:orderId` | optionnelle | Vérification manuelle du paiement |
| `GET` | `/api/payments/order/:orderId` | optionnelle | Historique des paiements d'une commande |

---

## 7. Front-end

- `PaymentMethodSelector` : nouvelle option **Bictorys** (Wave et Orange Money
  restent désactivés en direct, ils sont proposés via la page Bictorys).
- `CheckoutSuccess` / `CheckoutFailed` : interrogent
  `GET /payments/checkout-status` (polling toutes les 4 s tant que le paiement
  n'est pas définitif) et n'affichent « confirmée » que si le serveur répond
  `paid: true`. Un bouton « Vérifier le paiement » déclenche la vérification.
- `OrderDetailModal` : bouton « Payer maintenant » pour relancer le paiement
  d'une commande non payée.

---

## 8. Base de données

```bash
# enum PaymentProvider : ajout de la valeur BICTORYS
npx prisma migrate deploy
```

Migration : `prisma/migrations/20261021170000_add_bictorys_payment_provider`.

> PostgreSQL : `ALTER TYPE … ADD VALUE` ne peut pas être exécuté dans une
> transaction sur les versions < 12. La commande `prisma migrate deploy`
> s'en charge ; pour une correction manuelle, exécuter le SQL du fichier de
> migration directement sur la base.

### 8.1 Cycle de vie d'un paiement abandonné

Migration : `prisma/migrations/20261026120000_payment_lifecycle`.

- À la création d'un paiement, `Payment.expiresAt` vaut `createdAt + 15 min`
  et `Payment.nextReconciliationAt` est planifié immédiatement.
- Un cron (`PaymentsJobsService`, toutes les minutes) appelle
  `PaymentsService.expireAbandonedPayments()` et traite les paiements
  `PENDING`/`PROCESSING` arrivés à échéance.
- Délai total avant expiration : **25 min** (15 min de paiement + 10 min de
  grâce), avec au plus ~1 min de décalage lié au cron.
- Pour Bictorys, l'API est **toujours interrogée avant de conclure** :
  - transaction réussie → `confirmPayment()` (statut `PAID`, commande `CONFIRMED`) ;
  - transaction échouée → `FAILED` ;
  - transaction `expired` → `EXPIRED` ;
  - transaction encore en attente **avant** le délai de grâce (10 min par
    défaut) → replanification de `nextReconciliationAt` (15 min, sans dépasser
    la grâce) ;
  - transaction encore en attente **après** la grâce → `EXPIRED`.
- Les autres fournisseurs passent à `EXPIRED` après la grâce sans appel externe.
- L'absence de webhook ne vaut pas échec. La commande n'est **pas annulée**
  automatiquement : seul `paymentStatus` change, afin de ne pas libérer le stock
  alors qu'un paiement tardif peut encore aboutir.
- Un webhook tardif reste traité : `confirmPayment()` accepte la transition
  `EXPIRED` → `PAID` de façon idempotente. `markBictorysPaymentFailed()` accepte
  aussi les commandes dont le paiement est `EXPIRED`.
- `Payment.nextReconciliationAt` est remis à `null` dès qu'un statut final
  (`PAID`, `FAILED`, `EXPIRED`) est enregistré.

---

## 9. Tester de bout en bout (sandbox)

1. Renseigner `BICTORYS_API_KEY` (clé **de test** du dashboard) et
   `BICTORYS_WEBHOOK_SECRET` dans `ecommerce-api/.env`.
2. Démarrer l'API (`npm run start:dev`) et le front (`npm run dev`).
3. Exposer l'**API** sur une **URL publique** (tunnel ngrok) et reporter cette
   URL dans `API_PUBLIC_URL` (le sandbox refuse les URLs locales) :

   ```bash
   npm run ngrok   # tunnel vers l'API : 127.0.0.1:3000
   # API_PUBLIC_URL=https://xxxx.ngrok-free.dev
   # FRONTEND_BROWSER_URL=http://localhost:5173
   ```

4. Enregistrer le webhook dans le dashboard Bictorys :

   ```
   URL    : https://xxxx.ngrok-free.dev/api/payments/webhooks/bictorys
   Secret : <valeur de BICTORYS_WEBHOOK_SECRET>
   ```

5. Passer une commande en choisissant **Bictorys** : le navigateur redirige vers
   la page de paiement Bictorys.
6. Simuler un paiement depuis la page Bictorys (numéro de test fourni par le
   dashboard).
7. Vérifier :
   - la notification arrive sur `/api/payments/webhooks/bictorys` (log
     « Webhook Bictorys reçu ») ;
   - la commande passe `PAID` / `CONFIRMED` en base ;
   - le client reçoit la notification et l'email de reçu.
8. En sandbox, Bictorys **n'appelle pas** les URLs de redirection (comportement
   documenté) : utiliser le bouton « Vérifier le paiement » ou le webhook pour
   déclencher la confirmation.

### Vérification rapide de l'URL de webhook

```bash
# 404 => mauvais chemin (il manque /api/payments)
curl -o /dev/null -s -w "%{http_code}\n" -X POST \
  https://xxxx.ngrok-free.dev/webhooks/bictorys

# 401 => bon chemin, clé secrète absente ou incorrecte
curl -o /dev/null -s -w "%{http_code}\n" -X POST \
  https://xxxx.ngrok-free.dev/api/payments/webhooks/bictorys
```

### Vérification rapide de la redirection

```bash
# 302 + Location: http://localhost:5173/checkout/success?… => OK
curl -o /dev/null -s -w "%{http_code} %{redirect_url}\n" \
  "https://xxxx.ngrok-free.dev/api/payments/redirect/success?orderId=cmv1&orderNumber=ORD-20261022-ABCDE"
```

---

## 10. Tests

```bash
cd ecommerce-api
npx jest src/payments
```

Couverture : secret webhook absent/invalide, statuts de succès/échec, montant
insuffisant, devise incohérente, montant inconnu, idempotence de la
confirmation, vérification manuelle, contrôle de propriété de la commande et
mode « clé publique » (lecture serveur refusée → repli sur la notification
authentifiée).
