# Routes statistiques pour l'admin panel

## Base URL

Toutes les routes utilisent le prefixe global `api` :

```text
http://localhost:3000/api/stats
```

## Authentification et autorisations

Chaque requete doit inclure un JWT valide :

```http
Authorization: Bearer <access_token>
```

Les roles autorises sont `ADMIN` et `STAFF`. Un utilisateur non authentifie recoit `401`; un utilisateur avec un autre role recoit `403`.

## Parametres communs

| Parametre | Type | Requis | Description |
| --- | --- | --- | --- |
| `startDate` | `YYYY-MM-DD` | Non | Premier jour inclus. Par defaut, 29 jours avant `endDate`. |
| `endDate` | `YYYY-MM-DD` | Non | Dernier jour inclus. Par defaut, aujourd'hui. |
| `limit` | entier `1..100` | Non | Nombre maximal de produits dans les listes limitees. Defaut: `10`. |

Exemple de requete avec une periode :

```http
GET /api/stats/dashboard?startDate=2026-08-01&endDate=2026-08-24&limit=5
```

Les bornes sont interpretees en UTC : `startDate` commence a `00:00:00.000Z` et `endDate` se termine a `23:59:59.999Z`. Une plage inverse ou une date invalide renvoie `400`.

## GET /api/stats/dashboard

Route recommandee pour charger la vue principale du tableau de bord. Elle regroupe les ventes, alertes de stock, statuts de commandes, statuts de paiement et les cinq commandes recentes de la periode demandee.

Les metriques `revenue`, `orders`, `averageOrderValue` et `unitsSold` concernent les commandes payees avec un statut `CONFIRMED`, `IN_DELIVERY` ou `DELIVERED`. `customers`, `pendingOrders`, `ordersByStatus`, `paymentsByStatus` et `recentOrders` respectent egalement la periode demandee. Les metriques de stock representent l'etat courant du catalogue.

Reponse :

```json
{
  "range": {
    "startDate": "2026-08-01T00:00:00.000Z",
    "endDate": "2026-08-24T23:59:59.999Z"
  },
  "overview": {
    "revenue": 150,
    "orders": 2,
    "averageOrderValue": 75,
    "unitsSold": 5,
    "customers": 3,
    "products": 42,
    "activeProducts": 38,
    "lowStockProducts": 4,
    "outOfStockProducts": 1,
    "pendingOrders": 2
  },
  "sales": {
    "timeline": [
      { "date": "2026-08-01", "revenue": 150, "orders": 2, "unitsSold": 5 }
    ],
    "topProducts": []
  },
  "products": {
    "stockAlerts": [],
    "topProducts": []
  },
  "ordersByStatus": [
    { "status": "DELIVERED", "count": 2 }
  ],
  "paymentsByStatus": [
    { "status": "PAID", "count": 2 }
  ],
  "recentOrders": []
}
```

## GET /api/stats/sales

Retourne les indicateurs de vente pour la periode selectionnee.

- `summary.revenue`: total `Order.total`.
- `summary.orders`: nombre de commandes eligibles.
- `summary.unitsSold`: quantite totale vendue.
- `summary.itemsRevenue`: total des lignes de commande.
- `summary.averageOrderValue`: revenu divise par le nombre de commandes.
- `timeline`: ventes groupees par jour au format `YYYY-MM-DD`.
- `topProducts`: produits classes par quantite vendue, limite par `limit`.

Reponse simplifiee :

```json
{
  "range": { "startDate": "2026-08-01T00:00:00.000Z", "endDate": "2026-08-24T23:59:59.999Z" },
  "summary": {
    "revenue": 150,
    "subtotal": 160,
    "discountAmount": 10,
    "shippingAmount": 0,
    "taxAmount": 0,
    "orders": 2,
    "unitsSold": 5,
    "itemsRevenue": 150,
    "averageOrderValue": 75
  },
  "timeline": [],
  "topProducts": []
}
```

## GET /api/stats/products

Retourne l'etat courant du catalogue et les produits les plus vendus sur la periode.

- `summary.total`, `active`, `draft`, `archived`: compteurs par statut.
- `summary.lowStock`: nombre de produits sous leur seuil de stock.
- `summary.outOfStock`: produits dont le stock disponible est nul ou negatif.
- `summary.stockValue`: valeur estimee du stock.
- `stockAlerts`: alertes triees du stock disponible le plus faible au plus eleve, limitees par `limit`.
- `topProducts`: ventes de la periode, limitees par `limit`.

## Gestion des erreurs

```json
{
  "statusCode": 400,
  "message": "La date de debut doit etre inferieure ou egale a la date de fin.",
  "error": "Bad Request"
}
```

Le frontend doit traiter au minimum les statuts `400`, `401` et `403`, et afficher `range` retourne par l'API pour confirmer la periode effectivement appliquee.
