import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const BCRYPT_SALT_ROUNDS = 12;

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env['DIRECT_URL']! });
  const prisma = new PrismaClient({ adapter });

  const email = 'mamourf958@gmail.com';
  const password = 'Papou@2212';
  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      firstName: 'Mamour',
      lastName: 'Fall',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  console.log(`Admin seed terminé : ${admin.email} (${admin.role}) [${admin.id}]`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
