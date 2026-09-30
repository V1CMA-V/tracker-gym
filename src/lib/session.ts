import { prisma } from './prisma';

/**
 * Usuario activo.
 *
 * v1 no tiene autenticación: siempre resuelve al usuario demo creado por
 * `prisma/seed.ts`. Cuando entre auth real, este es el único archivo que
 * cambia — el resto de la app ya filtra todas sus queries por `user.id`.
 */

const DEMO_EMAIL =
  process.env.DEMO_USER_EMAIL ??
  (import.meta as { env?: Record<string, string | undefined> }).env?.DEMO_USER_EMAIL ??
  'demo@tracker.gym';

export type CurrentUser = {
  id: string;
  displayName: string;
  preferredUnit: 'kg' | 'lb';
  timezone: string;
};

const SELECT = {
  id: true,
  displayName: true,
  preferredUnit: true,
  timezone: true,
} as const;

/** Cachea por request en `locals` para no repetir la query en cada componente. */
export async function getCurrentUser(locals: App.Locals): Promise<CurrentUser> {
  if (locals.user) return locals.user;

  const user = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: SELECT,
  });

  if (!user) {
    throw new Error(
      `No existe el usuario demo "${DEMO_EMAIL}". Corre \`bunx prisma db seed\`.`,
    );
  }

  locals.user = user;
  return user;
}
