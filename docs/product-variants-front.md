# Documentation front-end : création et gestion des variantes de produit

## Vérification backend

Le flux de création de variante est bien implémenté côté API NestJS :

- Contrôleur : `src/products/variants/variants.controller.ts`
- Service : `src/products/variants/variants.service.ts`
- DTO : `src/products/dto/create-product-variant.dto.ts`
- Modèle Prisma : `ProductVariant` dans `prisma/schema.prisma`

Le build de validation a réussi avec la commande suivante :

```bash
npm run build
```

Résultat obtenu : génération Prisma OK puis build Nest OK, sans erreur sur le flux de variantes.

---

## 1. Endpoint principal

### Créer une variante

```http
POST /api/products/:productId/variants
```

### Authentification

Cette route est protégée et autorise uniquement les rôles `ADMIN` et `STAFF`.

```http
Authorization: Bearer <access_token>
```

### Body attendu

```json
{
  "sku": "TSHIRT-BLACK-S",
  "name": "T-shirt noir - S",
  "price": 14900,
  "stock": 12,
  "attributes": {
    "color": "Noir",
    "size": "S"
  }
}
```

### Champs du DTO

| Champ | Type | Requis | Description |
| --- | --- | --- | --- |
| `sku` | string | Oui | Identifiant unique de la variante. Doit être unique sur tout le catalogue. |
| `name` | string | Non | Libellé visible de la variante. |
| `price` | number | Non | Prix spécifique à la variante. |
| `stock` | number | Non | Quantité disponible pour cette variante. Par défaut : `0`. |
| `attributes` | object | Non | Attributs dynamiques du produit, ex. `size`, `color`, `material`. |

### Réponse réussie

```json
{
  "id": "cmf7n8eb70000b7x8v5m6r5q1",
  "productId": "cmf7n8eb70000b7x8v5m6r5q1",
  "sku": "TSHIRT-BLACK-S",
  "name": "T-shirt noir - S",
  "price": 14900,
  "stock": 12,
  "reservedStock": 0,
  "attributes": {
    "color": "Noir",
    "size": "S"
  },
  "imageId": null,
  "isActive": true,
  "createdAt": "2026-08-30T12:00:00.000Z",
  "updatedAt": "2026-08-30T12:00:00.000Z"
}
```

---

## 2. Règles métier importantes

### Unique SKU

Le backend refuse toute variante avec un SKU déjà existant :

- `409 Conflict`
- message : `Ce SKU est déjà utilisé.`

### Produit parent

Le `productId` passé dans l’URL doit correspondre à un produit existant.

- Si le produit n’existe pas : `404 Not Found`
- message : `Produit introuvable.`

### Mise à jour du produit

Quand une variante est créée, le backend met aussi à jour :

```ts
product.hasVariants = true
```

Ce flag est utilisé par le front pour savoir si le produit possède des variantes.

### Suppression

Quand la dernière variante d’un produit est supprimée, le backend repasse le produit en :

```ts
hasVariants = false
```

---

## 3. Autres endpoints utiles

### Lister les variantes d’un produit

```http
GET /api/products/:productId/variants
```

### Détail d’une variante

```http
GET /api/products/:productId/variants/:id
```

### Mettre à jour une variante

```http
PATCH /api/products/:productId/variants/:id
```

### Supprimer une variante

```http
DELETE /api/products/:productId/variants/:id
```

---

## 4. Format attendu côté front

### Type TypeScript recommandé

```ts
export type ProductVariantPayload = {
  sku: string;
  name?: string;
  price?: number;
  stock?: number;
  attributes?: Record<string, string>;
};
```

### Exemple de création depuis le front

```ts
const createVariant = async ({
  productId,
  payload,
  token,
}: {
  productId: string;
  payload: ProductVariantPayload;
  token: string;
}) => {
  const response = await fetch(`/api/products/${productId}/variants`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Erreur lors de la création de la variante');
  }

  return response.json();
};
```

---

## 5. Implémentation recommandée dans l’UI admin

### Cas d’usage typiques

1. L’admin ouvre un produit existant.
2. Le front charge les variantes avec `GET /api/products/:productId/variants`.
3. Il affiche une liste de variantes et permet d’en créer, modifier ou supprimer.
4. Le produit affiche un bouton “Ajouter une variante”.
5. Le front soumet le payload API.

### Exemple de formulaire

```ts
const [form, setForm] = useState({
  sku: '',
  name: '',
  price: 0,
  stock: 0,
  attributes: {
    color: '',
    size: '',
  },
});
```

### Workflow recommandé

```ts
async function handleCreateVariant() {
  try {
    const created = await createVariant({
      productId,
      token,
      payload: {
        sku: form.sku,
        name: form.name,
        price: Number(form.price),
        stock: Number(form.stock),
        attributes: {
          color: form.attributes.color,
          size: form.attributes.size,
        },
      },
    });

    setVariants((prev) => [...prev, created]);
    setForm({
      sku: '',
      name: '',
      price: 0,
      stock: 0,
      attributes: { color: '', size: '' },
    });
  } catch (error) {
    console.error(error);
  }
}
```

---

## 6. Points de vigilance côté front

### 1. Validation de SKU

Le front doit empêcher les doublons avant envoi si possible, mais il faut aussi gérer la réponse `409` du backend.

### 2. Prix

Le backend attend un `number` pour `price`. Il faut convertir proprement les valeurs de formulaire avant l’envoi.

### 3. Attributs dynamiques

Le champ `attributes` est un objet libre :

```json
{ "couleur": "Noir", "taille": "M" }
```

Il doit donc être construit dynamiquement selon les options du produit.

### 4. Gestion des erreurs

Le front doit afficher des messages adaptés pour :

- SKU déjà utilisé
- produit introuvable
- données invalides
- autorisation insuffisante

### 5. Récupération d’état

Après création, il faut rafraîchir la liste des variantes et le produit concerné pour refléter :

- le nouveau `hasVariants`
- le stock de la variante
- le prix spécifique
- l’UI de sélection de variante

---

## 7. Exemple de réponse produit avec variantes

```json
{
  "id": "prod_123",
  "name": "T-shirt",
  "slug": "t-shirt",
  "hasVariants": true,
  "variants": [
    {
      "id": "var_1",
      "sku": "TSHIRT-BLACK-S",
      "name": "T-shirt noir - S",
      "price": 14900,
      "stock": 12,
      "attributes": { "color": "Noir", "size": "S" }
    },
    {
      "id": "var_2",
      "sku": "TSHIRT-BLACK-M",
      "name": "T-shirt noir - M",
      "price": 14900,
      "stock": 9,
      "attributes": { "color": "Noir", "size": "M" }
    }
  ]
}
```

---

## 8. Recommandation finale

Le front doit considérer qu’une variante est un objet métier distinct de l’item produit principal, avec :

- un SKU unique,
- un prix optionnel spécifique,
- un stock propre,
- un objet `attributes` pour la variation.

Le bon modèle UX est :

- gérer les variantes dans le formulaire d’édition produit,
- afficher une ligne par variante,
- garder la logique de validation côté API,
- ne pas faire confiance au front pour garantir l’unicité du SKU.

---

## 9. Résumé court

La création de variante n’est pas seulement un formulaire visuel : c’est un flux backend validé, avec sécurité par JWT et contrainte d’unicité sur le SKU. Le front doit donc l’intégrer comme une action admin, avec validation, affichage de messages d’erreur, et rechargement des données produit/variantes après création.
