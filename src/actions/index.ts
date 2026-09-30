import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro:schema';

import { prisma } from '../lib/prisma';
import { getCurrentUser } from '../lib/session';
import { epley1RM, num } from '../lib/format';

/**
 * Todas las mutaciones de la app.
 *
 * Se invocan desde `<form method="POST" action={actions.x}>`, así que
 * funcionan sin JavaScript; la island de la sesión activa las llama por
 * fetch para evitar la recarga.
 *
 * Regla transversal: cada handler comprueba que la fila pertenece al
 * usuario actual antes de tocarla. Hoy solo hay un usuario, pero la
 * consulta ya queda escrita como la necesita la app con auth.
 */

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** Campo de texto opcional: el form manda "" cuando está vacío. */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/** Número opcional: "" → null, en vez del NaN que daría z.coerce.number(). */
const optionalNumber = z
  .union([z.literal(''), z.coerce.number()])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function conflict(message: string): ActionError {
  return new ActionError({ code: 'CONFLICT', message });
}

function notFound(message: string): ActionError {
  return new ActionError({ code: 'NOT_FOUND', message });
}

/** Comprueba que la rutina es del usuario y devuelve su id. */
async function ownedRoutine(routineId: string, userId: string): Promise<string> {
  const routine = await prisma.routine.findFirst({
    where: { id: routineId, userId },
    select: { id: true },
  });
  if (!routine) throw notFound('Esa rutina no existe.');
  return routine.id;
}

/** Comprueba que la sesión es del usuario y que sigue abierta. */
async function ownedOpenSession(sessionId: string, userId: string): Promise<string> {
  const session = await prisma.workoutSession.findFirst({
    where: { id: sessionId, userId, status: 'in_progress' },
    select: { id: true },
  });
  if (!session) throw notFound('Esa sesión no existe o ya está cerrada.');
  return session.id;
}

// ---------------------------------------------------------------------
// Rutinas
// ---------------------------------------------------------------------

const createRoutine = defineAction({
  accept: 'form',
  input: z.object({
    name: z.string().trim().min(1, 'Ponle un nombre.').max(100),
    description: optionalText,
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional()
      .default('#FFB000'),
  }),
  handler: async ({ name, description, color }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    try {
      return await prisma.routine.create({
        data: { userId: user.id, name, description, color },
        select: { id: true, name: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict(`Ya tienes una rutina llamada "${name}".`);
      throw error;
    }
  },
});

const updateRoutine = defineAction({
  accept: 'form',
  input: z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(100),
    description: optionalText,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  handler: async ({ id, ...data }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    await ownedRoutine(id, user.id);
    try {
      return await prisma.routine.update({ where: { id }, data, select: { id: true } });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict(`Ya tienes una rutina llamada "${data.name}".`);
      throw error;
    }
  },
});

const archiveRoutine = defineAction({
  accept: 'form',
  input: z.object({ id: z.uuid() }),
  handler: async ({ id }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    await ownedRoutine(id, user.id);
    // Archivar, nunca borrar: las sesiones pasadas apuntan a esta rutina.
    await prisma.routine.update({ where: { id }, data: { isArchived: true } });
    return { id };
  },
});

// ---------------------------------------------------------------------
// Ejercicios
// ---------------------------------------------------------------------

const createExercise = defineAction({
  accept: 'form',
  input: z.object({
    name: z.string().trim().min(1, 'Ponle un nombre.').max(100),
    kind: z.enum(['weight_reps', 'bodyweight', 'duration', 'distance']),
    equipment: optionalText,
    description: optionalText,
    muscleGroupId: optionalNumber,
  }),
  handler: async ({ name, kind, equipment, description, muscleGroupId }, ctx) => {
    const user = await getCurrentUser(ctx.locals);

    // El índice uq_exercises_user_name trata el catálogo global y el
    // personal como espacios separados (COALESCE(user_id, uuid-cero)), así
    // que la base dejaría crear un "Sentadilla" propio junto al de la app.
    // Se bloquea aquí: dos entradas idénticas en el selector no ayudan.
    const clash = await prisma.exercise.findFirst({
      where: { userId: null, isArchived: false, name: { equals: name, mode: 'insensitive' } },
      select: { name: true },
    });
    if (clash) {
      throw conflict(`"${clash.name}" ya está en el catálogo de la app.`);
    }

    try {
      return await prisma.exercise.create({
        data: {
          userId: user.id,
          name,
          kind,
          equipment,
          description,
          ...(muscleGroupId
            ? { muscles: { create: { muscleGroupId, isPrimary: true } } }
            : {}),
        },
        select: { id: true, name: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict(`Ya tienes un ejercicio llamado "${name}".`);
      }
      throw error;
    }
  },
});

const archiveExercise = defineAction({
  accept: 'form',
  input: z.object({ id: z.uuid() }),
  handler: async ({ id }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    // Solo los propios: el catálogo global no se archiva desde la UI.
    const exercise = await prisma.exercise.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!exercise) throw notFound('Ese ejercicio no es tuyo.');
    await prisma.exercise.update({ where: { id }, data: { isArchived: true } });
    return { id };
  },
});

// ---------------------------------------------------------------------
// Ejercicios dentro de una rutina
// ---------------------------------------------------------------------

const addExerciseToRoutine = defineAction({
  accept: 'form',
  input: z.object({
    routineId: z.uuid(),
    exerciseId: z.uuid(),
  }),
  handler: async ({ routineId, exerciseId }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    await ownedRoutine(routineId, user.id);

    // El ejercicio debe ser global o del usuario.
    const exercise = await prisma.exercise.findFirst({
      where: { id: exerciseId, OR: [{ userId: null }, { userId: user.id }] },
      select: { id: true, kind: true },
    });
    if (!exercise) throw notFound('Ese ejercicio no existe.');

    return prisma.$transaction(async (tx) => {
      const last = await tx.routineExercise.findFirst({
        where: { routineId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });

      return tx.routineExercise.create({
        data: {
          routineId,
          exerciseId,
          position: (last?.position ?? 0) + 1,
          // Los de tiempo o distancia no llevan peso objetivo por defecto.
          targetRepsMin: exercise.kind === 'weight_reps' || exercise.kind === 'bodyweight' ? 8 : null,
          targetRepsMax: exercise.kind === 'weight_reps' || exercise.kind === 'bodyweight' ? 12 : null,
        },
        select: { id: true },
      });
    });
  },
});

const updateRoutineExercise = defineAction({
  accept: 'form',
  input: z.object({
    id: z.uuid(),
    targetSets: z.coerce.number().int().min(1).max(20),
    targetRepsMin: optionalNumber,
    targetRepsMax: optionalNumber,
    targetWeight: optionalNumber,
    restSeconds: optionalNumber,
    notes: optionalText,
  }),
  handler: async ({ id, ...data }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    const row = await prisma.routineExercise.findFirst({
      where: { id, routine: { userId: user.id } },
      select: { id: true },
    });
    if (!row) throw notFound('Ese ejercicio no está en ninguna rutina tuya.');

    if (data.targetRepsMin && data.targetRepsMax && data.targetRepsMax < data.targetRepsMin) {
      throw new ActionError({
        code: 'BAD_REQUEST',
        message: 'El máximo de reps no puede ser menor que el mínimo.',
      });
    }

    await prisma.routineExercise.update({ where: { id }, data });
    return { id };
  },
});

const removeFromRoutine = defineAction({
  accept: 'form',
  input: z.object({ id: z.uuid() }),
  handler: async ({ id }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    const row = await prisma.routineExercise.findFirst({
      where: { id, routine: { userId: user.id } },
      select: { id: true },
    });
    if (!row) throw notFound('Ese ejercicio no está en ninguna rutina tuya.');
    await prisma.routineExercise.delete({ where: { id } });
    return { id };
  },
});

const moveRoutineExercise = defineAction({
  accept: 'form',
  input: z.object({
    id: z.uuid(),
    direction: z.enum(['up', 'down']),
  }),
  handler: async ({ id, direction }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    const current = await prisma.routineExercise.findFirst({
      where: { id, routine: { userId: user.id } },
      select: { id: true, position: true, routineId: true },
    });
    if (!current) throw notFound('Ese ejercicio no está en ninguna rutina tuya.');

    const neighbour = await prisma.routineExercise.findFirst({
      where: {
        routineId: current.routineId,
        position: direction === 'up' ? { lt: current.position } : { gt: current.position },
      },
      orderBy: { position: direction === 'up' ? 'desc' : 'asc' },
      select: { id: true, position: true },
    });
    if (!neighbour) return { id, moved: false };

    // El intercambio directo solo es posible porque
    // uq_routine_exercises_position es DEFERRABLE INITIALLY DEFERRED:
    // la colisión intermedia no se comprueba hasta el commit.
    await prisma.$transaction([
      prisma.routineExercise.update({
        where: { id: current.id },
        data: { position: neighbour.position },
      }),
      prisma.routineExercise.update({
        where: { id: neighbour.id },
        data: { position: current.position },
      }),
    ]);

    return { id, moved: true };
  },
});

// ---------------------------------------------------------------------
// Sesiones de entrenamiento
// ---------------------------------------------------------------------

const startSession = defineAction({
  accept: 'form',
  input: z.object({
    routineId: z.uuid().optional(),
  }),
  handler: async ({ routineId }, ctx) => {
    const user = await getCurrentUser(ctx.locals);

    // Una sesión abierta a la vez: si ya hay una, se retoma.
    const open = await prisma.workoutSession.findFirst({
      where: { userId: user.id, status: 'in_progress' },
      select: { id: true },
    });
    if (open) return { id: open.id, resumed: true };

    const routine = routineId
      ? await prisma.routine.findFirst({
          where: { id: routineId, userId: user.id },
          select: {
            id: true,
            name: true,
            exercises: {
              orderBy: { position: 'asc' },
              select: { exerciseId: true, position: true },
            },
          },
        })
      : null;

    if (routineId && !routine) throw notFound('Esa rutina no existe.');

    const session = await prisma.workoutSession.create({
      data: {
        userId: user.id,
        routineId: routine?.id,
        // Copia del nombre: el historial sobrevive si se borra la rutina.
        routineName: routine?.name,
        exercises: routine
          ? {
              create: routine.exercises.map((e) => ({
                exerciseId: e.exerciseId,
                position: e.position,
              })),
            }
          : undefined,
      },
      select: { id: true },
    });

    return { id: session.id, resumed: false };
  },
});

const addExerciseToSession = defineAction({
  accept: 'form',
  input: z.object({
    sessionId: z.uuid(),
    exerciseId: z.uuid(),
  }),
  handler: async ({ sessionId, exerciseId }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    await ownedOpenSession(sessionId, user.id);

    const exercise = await prisma.exercise.findFirst({
      where: { id: exerciseId, OR: [{ userId: null }, { userId: user.id }] },
      select: { id: true },
    });
    if (!exercise) throw notFound('Ese ejercicio no existe.');

    return prisma.$transaction(async (tx) => {
      const last = await tx.sessionExercise.findFirst({
        where: { sessionId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      return tx.sessionExercise.create({
        data: { sessionId, exerciseId, position: (last?.position ?? 0) + 1 },
        select: { id: true },
      });
    });
  },
});

const logSet = defineAction({
  accept: 'form',
  input: z.object({
    sessionExerciseId: z.uuid(),
    weight: optionalNumber,
    reps: optionalNumber,
    durationSeconds: optionalNumber,
    distanceMeters: optionalNumber,
    rpe: optionalNumber,
    isWarmup: z.coerce.boolean().optional().default(false),
  }),
  handler: async ({ sessionExerciseId, ...values }, ctx) => {
    const user = await getCurrentUser(ctx.locals);

    const target = await prisma.sessionExercise.findFirst({
      where: { id: sessionExerciseId, session: { userId: user.id, status: 'in_progress' } },
      select: { id: true, exerciseId: true },
    });
    if (!target) throw notFound('No hay una sesión abierta con ese ejercicio.');

    const created = await prisma.$transaction(async (tx) => {
      const last = await tx.exerciseSet.findFirst({
        where: { sessionExerciseId },
        orderBy: { setNumber: 'desc' },
        select: { setNumber: true },
      });

      return tx.exerciseSet.create({
        data: { sessionExerciseId, setNumber: (last?.setNumber ?? 0) + 1, ...values },
        select: {
          id: true,
          setNumber: true,
          weight: true,
          reps: true,
          durationSeconds: true,
          distanceMeters: true,
          rpe: true,
          isWarmup: true,
        },
      });
    });

    // ¿Récord? Se compara contra el mejor 1RM estimado histórico del
    // ejercicio, que es justo lo que expone la vista v_personal_records.
    let isPR = false;
    const estimated = epley1RM(created.weight, created.reps);
    if (estimated && !created.isWarmup) {
      const [record] = await prisma.$queryRaw<{ est_1rm: number | null }[]>`
        SELECT est_1rm FROM v_personal_records
        WHERE user_id = ${user.id}::uuid AND exercise_id = ${target.exerciseId}::uuid
      `;
      isPR = !record?.est_1rm || estimated > Number(record.est_1rm);
    }

    // Decimal no serializa a JSON: se aplana antes de devolverlo.
    return {
      set: {
        ...created,
        weight: num(created.weight),
        distanceMeters: num(created.distanceMeters),
        rpe: num(created.rpe),
      },
      estimated1RM: estimated,
      isPR,
    };
  },
});

const deleteSet = defineAction({
  accept: 'form',
  input: z.object({ id: z.uuid() }),
  handler: async ({ id }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    const set = await prisma.exerciseSet.findFirst({
      where: { id, sessionExercise: { session: { userId: user.id, status: 'in_progress' } } },
      select: { id: true },
    });
    if (!set) throw notFound('Esa serie no existe o la sesión ya está cerrada.');
    await prisma.exerciseSet.delete({ where: { id } });
    return { id };
  },
});

const finishSession = defineAction({
  accept: 'form',
  input: z.object({
    id: z.uuid(),
    bodyweight: optionalNumber,
    notes: optionalText,
  }),
  handler: async ({ id, bodyweight, notes }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    await ownedOpenSession(id, user.id);

    // Una sesión sin series registradas se descarta en vez de guardarse
    // vacía y ensuciar las estadísticas.
    const sets = await prisma.exerciseSet.count({
      where: { sessionExercise: { sessionId: id } },
    });

    await prisma.workoutSession.update({
      where: { id },
      data: {
        status: sets > 0 ? 'completed' : 'cancelled',
        endedAt: new Date(),
        bodyweight,
        notes,
      },
    });

    return { id, completed: sets > 0 };
  },
});

const cancelSession = defineAction({
  accept: 'form',
  input: z.object({ id: z.uuid() }),
  handler: async ({ id }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    await ownedOpenSession(id, user.id);
    await prisma.workoutSession.update({
      where: { id },
      data: { status: 'cancelled', endedAt: new Date() },
    });
    return { id };
  },
});

export const server = {
  createRoutine,
  updateRoutine,
  archiveRoutine,
  createExercise,
  archiveExercise,
  addExerciseToRoutine,
  updateRoutineExercise,
  removeFromRoutine,
  moveRoutineExercise,
  startSession,
  addExerciseToSession,
  logSet,
  deleteSet,
  finishSession,
  cancelSession,
};
