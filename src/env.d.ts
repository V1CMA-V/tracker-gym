/// <reference types="astro/client" />
/// <reference types="@clerk/astro/env" />

import type { CurrentUser } from './lib/session';

declare global {
  namespace App {
    interface Locals {
      /** Poblado por el guard de `src/middleware.ts`; cache por request. */
      user?: CurrentUser;
    }
  }
}

interface ImportMetaEnv {
  readonly DATABASE_URL: string;
  readonly DIRECT_URL: string;
  readonly DEMO_USER_EMAIL: string;
  readonly PUBLIC_CLERK_PUBLISHABLE_KEY: string;
  readonly CLERK_SECRET_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};
