import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro:schema';

import { prisma } from '../lib/prisma';
import { getCurrentUser } from '../lib/session';
import { epley1RM, num } from '../lib/format';
import { parseScheme, SchemeError, type PlannedSet } from '../lib/scheme';

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

/**
 * Campos que se tienen que poder VACIAR desde el formulario.
 *
 * Astro no manda `""` para un campo de texto vacío: manda `null` (o nada si
 * el campo no viaja). Los dos casos tienen que acabar en un `null` explícito
 * —no en `undefined`— porque Prisma ignora `undefined` y dejaría la columna
 * como estaba: el usuario borra la nota, guarda, y la nota sigue ahí.
 */
const clearableText = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    const text = (v ?? '').trim();
    return text === '' ? null : text;
  });

// `z.null()` va antes que el número: `z.coerce.number()` convertiría el
// null en 0 y guardaría un peso de cero donde el usuario quería borrarlo.
const clearableNumber = z
  .union([z.literal(''), z.null(), z.coerce.number()])
  .optional()
  .transform((v) => (v === '' || v === null || v === undefined ? null : v));

/** Referencia opcional a una fila: el `<option value="">` llega como null. */
const clearableUuid = z
  .union([z.literal(''), z.null(), z.uuid()])
  .optional()
  .transform((v) => v || null);

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function conflict(message: string): ActionError {
  return new ActionError({ code: 'CONFLICT', message });
}

function notFound(message: string): ActionError {
  return new ActionError({ code: 'NOT_FOUND', message });
}

function badRequest(message: string): ActionError {
  return new ActionError({ code: 'BAD_REQUEST', message });
}

/**
 * Texto del campo "esquema" → series planificadas.
 *
 * El `SchemeError` ya trae un mensaje escrito para el usuario ("No entiendo
 * 12//8"), así que se reenvía tal cual al formulario.
 */
function readScheme(text: string | null | undefined): PlannedSet[] | null {
  if (!text) return null;
  try {
    const sets = parseScheme(text);
    return sets.length > 0 ? sets : null;
  } catch (error) {
    if (error instanceof SchemeError) throw badRequest(error.message);
    throw error;
  }
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

/**
 * El primer ejercicio de una rutina no puede ir encadenado al anterior:
 * no hay anterior. Tras mover o quitar filas se limpia la bandera huérfana.
 */
async function clearOrphanSuperset(routineId: string): Promise<void> {
  const first = await prisma.routineExercise.findFirst({
    where: { routineId },
    orderBy: { position: 'asc' },
    select: { id: true, supersetWithPrev: true },
  });
  if (first?.supersetWithPrev) {
    await prisma.routineExercise.update({
      where: { id: first.id },
      data: { supersetWithPrev: false },
    });
  }
}

/**
 * El nombre no puede pisar al de un ejercicio del catálogo global.
 *
 * El índice uq_exercises_user_name usa COALESCE(user_id, uuid-cero), así que
 * para la base el catálogo global y el personal son espacios separados y
 * dejaría crear un "Sentadilla" propio junto al de la app. Se bloquea aquí:
 * dos entradas idénticas en el selector no ayudan.
 */
async function assertNameFreeInCatalog(name: string): Promise<void> {
  const clash = await prisma.exercise.findFirst({
    where: { userId: null, isArchived: false, name: { equals: name, mode: 'insensitive' } },
    select: { name: true },
  });
  if (clash) throw conflict(`"${clash.name}" ya está en el catálogo de la app.`);
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
    description: clearableText,
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
    await prisma.$transaction([
      // Archivar, nunca borrar: las sesiones pasadas apuntan a esta rutina.
      prisma.routine.update({ where: { id }, data: { isArchived: true } }),
      // El ON DELETE CASCADE de weekly_schedule solo salta al borrar, y aquí
      // nunca se borra: sin esto, Hoy seguiría sugiriendo una rutina
      // archivada los días que tenía asignados.
      prisma.weeklySchedule.deleteMany({ where: { routineId: id } }),
    ]);
    return { id };
  },
});

/**
 * El plan semanal completo, de una sentada.
 *
 * Los siete días viajan en un solo POST porque la tira es un único
 * formulario: así funciona sin JavaScript, igual que el resto de la app.
 */
const setWeeklySchedule = defineAction({
  accept: 'form',
  input: z.object({
    d0: clearableUuid,
    d1: clearableUuid,
    d2: clearableUuid,
    d3: clearableUuid,
    d4: clearableUuid,
    d5: clearableUuid,
    d6: clearableUuid,
  }),
  handler: async (days, ctx) => {
    const user = await getCurrentUser(ctx.locals);

    const week = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      routineId: days[`d${dayOfWeek}` as keyof typeof days],
    }));

    // Una sola consulta para los siete días en vez de siete ownedRoutine().
    const ids = [...new Set(week.map((d) => d.routineId).filter((id) => id !== null))];
    if (ids.length > 0) {
      const owned = await prisma.routine.count({
        where: { id: { in: ids }, userId: user.id, isArchived: false },
      });
      if (owned !== ids.length) throw notFound('Alguna de esas rutinas no existe.');
    }

    await prisma.$transaction(
      week.map(({ dayOfWeek, routineId }) =>
        routineId
          ? prisma.weeklySchedule.upsert({
              where: { userId_dayOfWeek: { userId: user.id, dayOfWeek } },
              update: { routineId },
              create: { userId: user.id, dayOfWeek, routineId },
            })
          : // deleteMany y no delete: un día que ya estaba en descanso no
            // tiene fila y `delete` reventaría.
            prisma.weeklySchedule.deleteMany({ where: { userId: user.id, dayOfWeek } }),
      ),
    );

    return { days: week.filter((d) => d.routineId !== null).length };
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
    await assertNameFreeInCatalog(name);

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

const updateExercise = defineAction({
  accept: 'form',
  input: z.object({
    id: z.uuid(),
    name: z.string().trim().min(1, 'Ponle un nombre.').max(100),
    kind: z.enum(['weight_reps', 'bodyweight', 'duration', 'distance']),
    equipment: clearableText,
    description: clearableText,
    muscleGroupId: clearableNumber,
  }),
  handler: async ({ id, name, kind, equipment, description, muscleGroupId }, ctx) => {
    const user = await getCurrentUser(ctx.locals);

    // Solo los propios: el catálogo global no se edita desde la UI.
    const exercise = await prisma.exercise.findFirst({
      where: { id, userId: user.id },
      select: { id: true, kind: true },
    });
    if (!exercise) throw notFound('Ese ejercicio no es tuyo.');

    await assertNameFreeInCatalog(name);

    // El tipo decide cómo se leen las series ya registradas: un ejercicio
    // que pasa de "peso + reps" a "peso corporal" esconde los kg de todo su
    // historial. Con sesiones de por medio, no se cambia.
    if (kind !== exercise.kind) {
      const logged = await prisma.sessionExercise.count({ where: { exerciseId: id } });
      if (logged > 0) {
        throw badRequest(
          `No se puede cambiar el tipo: ya hay ${logged} sesiones con este ejercicio.`,
        );
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.exercise.update({
          where: { id },
          data: { name, kind, equipment, description },
        });

        // El músculo primario es uno solo: se limpia el anterior y se pone
        // el nuevo. El upsert cubre que ya estuviera asociado como secundario.
        await tx.exerciseMuscle.deleteMany({ where: { exerciseId: id, isPrimary: true } });
        if (muscleGroupId) {
          await tx.exerciseMuscle.upsert({
            where: { exerciseId_muscleGroupId: { exerciseId: id, muscleGroupId } },
            update: { isPrimary: true },
            create: { exerciseId: id, muscleGroupId, isPrimary: true },
          });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict(`Ya tienes un ejercicio llamado "${name}".`);
      }
      throw error;
    }

    return { id };
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
    targetRepsMin: clearableNumber,
    targetRepsMax: clearableNumber,
    targetWeight: clearableNumber,
    restSeconds: clearableNumber,
    notes: clearableText,
    /** Esquema serie a serie ("12/10/8", "3x(6/d15)"). Vacío = plan plano. */
    scheme: clearableText,
  }),
  handler: async ({ id, scheme, ...data }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    const row = await prisma.routineExercise.findFirst({
      where: { id, routine: { userId: user.id } },
      select: { id: true },
    });
    if (!row) throw notFound('Ese ejercicio no está en ninguna rutina tuya.');

    if (data.targetRepsMin && data.targetRepsMax && data.targetRepsMax < data.targetRepsMin) {
      throw badRequest('El máximo de reps no puede ser menor que el mínimo.');
    }

    const planned = readScheme(scheme);

    await prisma.$transaction(async (tx) => {
      await tx.routineExercise.update({
        where: { id },
        // Con esquema, las series las cuenta el esquema: el campo "Series"
        // pasa a ser un reflejo suyo y no una fuente de verdad aparte.
        data: { ...data, targetSets: planned ? planned.length : data.targetSets },
      });

      // Reescribir entero es más simple que diferenciar fila por fila, y el
      // UNIQUE diferido aguanta el borrado y alta dentro de la transacción.
      await tx.routineSet.deleteMany({ where: { routineExerciseId: id } });
      if (planned) {
        await tx.routineSet.createMany({
          data: planned.map((set, i) => ({
            routineExerciseId: id,
            setNumber: i + 1,
            repsMin: set.repsMin,
            repsMax: set.repsMax,
            toFailure: set.toFailure,
            weight: set.weight,
            isDropSet: set.isDropSet,
            dropPct: set.dropPct,
          })),
        });
      }
    });

    return { id };
  },
});

/**
 * Encadena o desencadena un ejercicio con el anterior (superserie).
 *
 * El bloque no se guarda como identificador de grupo sino como "va pegado
 * al de arriba": así reordenar la rutina no obliga a renumerar grupos.
 */
const toggleSuperset = defineAction({
  accept: 'form',
  input: z.object({
    id: z.uuid(),
    value: z.enum(['on', 'off']),
  }),
  handler: async ({ id, value }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    const row = await prisma.routineExercise.findFirst({
      where: { id, routine: { userId: user.id } },
      select: { id: true, position: true, routineId: true },
    });
    if (!row) throw notFound('Ese ejercicio no está en ninguna rutina tuya.');

    if (value === 'on') {
      const previous = await prisma.routineExercise.findFirst({
        where: { routineId: row.routineId, position: { lt: row.position } },
        select: { id: true },
      });
      if (!previous) throw badRequest('El primer ejercicio no tiene con quién encadenarse.');
    }

    await prisma.routineExercise.update({
      where: { id },
      data: { supersetWithPrev: value === 'on' },
    });
    return { id, supersetWithPrev: value === 'on' };
  },
});

const removeFromRoutine = defineAction({
  accept: 'form',
  input: z.object({ id: z.uuid() }),
  handler: async ({ id }, ctx) => {
    const user = await getCurrentUser(ctx.locals);
    const row = await prisma.routineExercise.findFirst({
      where: { id, routine: { userId: user.id } },
      select: { id: true, routineId: true },
    });
    if (!row) throw notFound('Ese ejercicio no está en ninguna rutina tuya.');
    await prisma.routineExercise.delete({ where: { id } });
    await clearOrphanSuperset(row.routineId);
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

    await clearOrphanSuperset(current.routineId);
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
  setWeeklySchedule,
  createExercise,
  updateExercise,
  archiveExercise,
  addExerciseToRoutine,
  updateRoutineExercise,
  removeFromRoutine,
  moveRoutineExercise,
  toggleSuperset,
  startSession,
  addExerciseToSession,
  logSet,
  deleteSet,
  finishSession,
  cancelSession,
};
