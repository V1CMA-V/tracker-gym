import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// Astro loads .env into import.meta.env, not process.env. In a deployed Node
// runtime the variable usually comes from the real environment instead, and in
// a plain node script import.meta.env does not exist at all, so check both.
const connectionString =
  process.env.DATABASE_URL ??
  ((import.meta as { env?: Record<string, string | undefined> }).env?.DATABASE_URL);

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Add it to .env (pooled Supabase connection string).');
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  // Supabase's transaction pooler (port 6543) does not support prepared
  // statements, so Prisma talks to it through the node-postgres adapter.
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Se cachea SIEMPRE, también en producción. En serverless cada invocación
// tibia reutiliza el módulo: sin esto, cada request abriría un pool nuevo
// contra Supabase hasta agotar las conexiones disponibles.
globalForPrisma.prisma = prisma;
