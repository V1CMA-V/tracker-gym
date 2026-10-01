import { prisma } from './prisma';

/**
 * Usuario activo.
 *
 * La sesión la lleva Clerk, pero la llave de la app sigue siendo el uuid de
 * `users`: hay SQL crudo que lo castea (`routine_for_date($1::uuid)`,
 * `v_monthly_summary`). El id de Clerk es sólo una columna de enlace.
 *
 * `syncCurrentUser()` lo resuelve una vez por request desde el middleware y lo
 * deja en `locals.user`; el resto de la app sigue llamando `getCurrentUser()`.
 */

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

/** El guard de `src/middleware.ts` debería volver esto inalcanzable. */
export class NoSessionError extends Error {
  constructor() {
    super('No hay sesión de Clerk en esta request.');
    this.name = 'NoSessionError';
  }
}

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

/** `display_name` es VARCHAR(100), y Google no siempre manda nombre. */
function pickName(
  profile: { firstName: string | null; lastName: string | null; username: string | null } | null,
  email: string,
): string {
  const full = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
  const name = full || profile?.username?.trim() || email.split('@')[0] || 'Atleta';
  return name.slice(0, 100);
}

/**
 * Adopta una fila que ya existía con ese email.
 *
 * El `clerkId: null` del where es deliberado: nunca le quitamos la fila a una
 * cuenta de Clerk que ya la tenía enlazada.
 */
async function linkByEmail(clerkId: string, email: string): Promise<CurrentUser | null> {
  const { count } = await prisma.user.updateMany({
    where: { email, clerkId: null },
    data: { clerkId },
  });

  if (count === 0) return null;
  return prisma.user.findUnique({ where: { clerkId }, select: SELECT });
}

/**
 * Resuelve la fila local del usuario de Clerk y la cachea en `locals`.
 *
 *   1. `clerk_id` ya enlazado → una query; es el caso de casi toda request.
 *   2. coincide el email      → adopta la fila existente, conservando su uuid.
 *   3. no coincide nada       → alta nueva con el perfil de Google.
 */
export async function syncCurrentUser(locals: App.Locals): Promise<CurrentUser> {
  if (locals.user) return locals.user;

  const { isAuthenticated, userId } = locals.auth();
  if (!isAuthenticated || !userId) throw new NoSessionError();

  const linked = await prisma.user.findUnique({ where: { clerkId: userId }, select: SELECT });
  if (linked) return (locals.user = linked);

  // Sólo en el primer login de cada cuenta: una llamada al Backend API.
  const profile = await locals.currentUser();
  const email =
    profile?.emailAddresses.find((e) => e.id === profile.primaryEmailAddressId)?.emailAddress ??
    profile?.emailAddresses[0]?.emailAddress;

  if (!email) throw new Error(`Clerk no devolvió ningún email para ${userId}.`);

  const adopted = await linkByEmail(userId, email);
  if (adopted) return (locals.user = adopted);

  try {
    const created = await prisma.user.create({
      data: { clerkId: userId, email, displayName: pickName(profile, email) },
      select: SELECT,
    });
    return (locals.user = created);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Carrera: otra request concurrente insertó primero, o el email se enlazó
    // entre nuestro updateMany y el create.
    const raced =
      (await prisma.user.findUnique({ where: { clerkId: userId }, select: SELECT })) ??
      (await linkByEmail(userId, email));

    if (raced) return (locals.user = raced);

    // Queda un solo caso: el email pertenece a una fila con otro clerk_id.
    throw new Error(`El email ${email} ya está enlazado a otra cuenta de Clerk.`);
  }
}

/** Cachea por request en `locals` para no repetir la query en cada componente. */
export async function getCurrentUser(locals: App.Locals): Promise<CurrentUser> {
  return locals.user ?? syncCurrentUser(locals);
}
