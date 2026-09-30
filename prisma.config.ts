import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'bun prisma/seed.ts',
  },
  // The Prisma CLI (migrate, db pull, db push) needs a direct, non-pooled
  // connection. Prisma Client uses the pooled DATABASE_URL at runtime instead.
  datasource: {
    url: env('DIRECT_URL'),
  },
})
