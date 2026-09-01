import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Récalcule product.quantity des produits à variantes (hasVariants = true) en
// sommant leurs variantes.
// À lancer une seule fois pour corriger les données historiques devenues
// obsolètes avant l'ajout de la synchronisation automatique.
async function main() {
  const adapter = new PrismaPg({ connectionString: process.env['DIRECT_URL']! });
  const prisma = new PrismaClient({ adapter });

  const products = await prisma.product.findMany({
    where: { hasVariants: true },
    select: { id: true, name: true },
  });

  console.log(`Produits à variantes trouvés : ${products.length}`);

  let updated = 0;
  for (const product of products) {
    const aggregate = await prisma.productVariant.aggregate({
      where: { productId: product.id },
      _sum: { quantity: true },
    });

    const quantity = aggregate._sum.quantity ?? 0;

    await prisma.product.update({
      where: { id: product.id },
      data: { quantity },
    });

    updated++;
    console.log(
      `  - ${product.name} => quantity=${quantity}`,
    );
  }

  console.log(`Terminé : ${updated} produits synchronisés.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
