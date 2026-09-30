/// <reference types="astro/client" />

import type { CurrentUser } from './lib/session';

declare global {
  namespace App {
    interface Locals {
      /** Poblado por `getCurrentUser()`; cache por request. */
      user?: CurrentUser;
    }
  }
}

interface ImportMetaEnv {
  readonly DATABASE_URL: string;
  readonly DIRECT_URL: string;
  readonly DEMO_USER_EMAIL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};
