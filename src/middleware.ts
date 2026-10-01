import { clerkMiddleware } from '@clerk/astro/server';
import { defineMiddleware, sequence } from 'astro:middleware';

import { syncCurrentUser } from './lib/session';

/**
 * Toda la app filtra por `user.id`, así que no hay nada útil que mostrar sin
 * sesión: el guard manda a /login todo lo que no esté aquí.
 */
const PUBLIC = ['/login', '/sso-callback'];

const isPublic = (path: string) =>
  PUBLIC.some((base) => path === base || path.startsWith(`${base}/`));

/**
 * Lo que no es una navegación a una página: assets, el proxy de Vite en dev,
 * islas. En Vercel el adapter los sirve antes de llamar a la función, pero en
 * `astro dev` sí entran aquí — y un 302 a /favicon.svg rompe el favicon del
 * propio login.
 */
const isAsset = (path: string) =>
  path.startsWith('/_astro') ||
  path.startsWith('/_image') ||
  path.startsWith('/_server-islands') ||
  path.startsWith('/@') || // /@vite/client, /@fs/...
  path.startsWith('/node_modules/') ||
  /\.[a-z0-9]+$/i.test(path); // favicon.svg, .css, .js, .map

/** `logSet` se llama por fetch desde la isla de la sesión (scripts/session.ts:166). */
const isActionFetch = (path: string) => path.startsWith('/_actions/');

const guard = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (isAsset(pathname)) return next();

  const { isAuthenticated, userId } = context.locals.auth();

  if (isPublic(pathname)) {
    // Ya dentro: /login no tiene nada que ofrecer.
    if (isAuthenticated && pathname === '/login') return context.redirect('/', 302);
    return next();
  }

  if (!isAuthenticated || !userId) {
    // Un 302 a HTML rompería el `await actions.logSet()` del cliente.
    if (isActionFetch(pathname)) return new Response(null, { status: 401 });

    const back = pathname + context.url.search;
    return context.redirect(
      back === '/' ? '/login' : `/login?redirect_url=${encodeURIComponent(back)}`,
      302,
    );
  }

  // Un solo sync por request; las llamadas a getCurrentUser() leen de locals.
  await syncCurrentUser(context.locals);
  return next();
});

export const onRequest = sequence(clerkMiddleware(), guard);
