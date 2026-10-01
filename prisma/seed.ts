import { prisma } from '../src/lib/prisma.ts';
import { parseScheme } from '../src/lib/scheme.ts';

const DEMO_EMAIL = process.env.DEMO_USER_EMAIL ?? 'demo@tracker.gym';

const MUSCLE_GROUPS = [
  'Pecho', 'Espalda', 'Hombro', 'Bíceps', 'Tríceps',
  'Cuádriceps', 'Isquiotibiales', 'Glúteo', 'Pantorrilla', 'Core',
];

// [nombre, kind, equipment, músculo primario]
const EXERCISES = [
  ['Press de banca', 'weight_reps', 'Barra', 'Pecho'],
  ['Press inclinado', 'weight_reps', 'Mancuerna', 'Pecho'],
  ['Press militar', 'weight_reps', 'Barra', 'Hombro'],
  ['Elevaciones laterales', 'weight_reps', 'Mancuerna', 'Hombro'],
  ['Fondos en paralelas', 'bodyweight', 'Paralelas', 'Tríceps'],
  ['Extensión de tríceps', 'weight_reps', 'Polea', 'Tríceps'],
  ['Dominadas', 'bodyweight', 'Barra fija', 'Espalda'],
  ['Remo con barra', 'weight_reps', 'Barra', 'Espalda'],
  ['Jalón al pecho', 'weight_reps', 'Polea', 'Espalda'],
  ['Curl de bíceps', 'weight_reps', 'Mancuerna', 'Bíceps'],
  ['Sentadilla', 'weight_reps', 'Barra', 'Cuádriceps'],
  ['Peso muerto', 'weight_reps', 'Barra', 'Isquiotibiales'],
  ['Prensa de piernas', 'weight_reps', 'Máquina', 'Cuádriceps'],
  ['Curl femoral', 'weight_reps', 'Máquina', 'Isquiotibiales'],
  ['Hip thrust', 'weight_reps', 'Barra', 'Glúteo'],
  ['Elevación de talones', 'weight_reps', 'Máquina', 'Pantorrilla'],
  ['Plancha', 'duration', null, 'Core'],
  ['Caminadora', 'distance', 'Caminadora', 'Cuádriceps'],
  ['Press inclinado en Smith', 'weight_reps', 'Smith', 'Pecho'],
  ['Flys en pec-deck', 'weight_reps', 'Máquina', 'Pecho'],
  ['Lagartijas', 'bodyweight', null, 'Pecho'],
  ['Press de hombro en máquina', 'weight_reps', 'Máquina', 'Hombro'],
  ['Laterales con cable a una mano', 'weight_reps', 'Polea', 'Hombro'],
  ['Frontal con barra', 'weight_reps', 'Barra', 'Hombro'],
  ['Copa con soga en cable', 'weight_reps', 'Polea', 'Tríceps'],
] as const;

/**
 * Rutina de ejemplo. Enseña las tres cosas que una rutina de papel tiene y
 * un "3×10" no: reps que cambian entre series, drop-sets encadenados y
 * ejercicios en superserie.
 *
 * [ejercicio, esquema, descanso, superserie con el anterior, notas]
 */
const DEMO_ROUTINE = {
  name: 'Empuje',
  description: 'Pecho, hombro y tríceps. Día A del split empuje/jalón/pierna.',
  color: '#FFB000',
  exercises: [
    [
      'Press inclinado en Smith',
      '12/10/8',
      150,
      false,
      'En cada serie subes el peso y bajas las reps.',
    ],
    [
      'Press de banca',
      '3x(6-8/d15@-40%)',
      150,
      false,
      'Subiendo y bajando lento, 2 segundos de contracción. El drop-set va sin descansar, bajando el 40 % del peso.',
    ],
    [
      'Flys en pec-deck',
      '3x10-12',
      0,
      false,
      'Apretando 2 segundos en contracción por rep.',
    ],
    ['Lagartijas', '3xF', 120, true, 'Al fallo, justo después del pec-deck.'],
    [
      'Press de hombro en máquina',
      '10/8/6',
      120,
      false,
      'En cada serie subes el peso y bajas las reps.',
    ],
    [
      'Laterales con cable a una mano',
      '3x8-10',
      60,
      false,
      '8-10 por brazo, apretando 2 segundos en contracción.',
    ],
    [
      'Frontal con barra',
      '3x10',
      60,
      false,
      'Sostienes 10 segundos en contracción en la última rep.',
    ],
    [
      'Extensión de tríceps',
      '3x(6/d15@-40%)',
      90,
      false,
      'Las 6 pesadas; bajas el 40 % del peso y sacas 15 sin descansar.',
    ],
    [
      'Copa con soga en cable',
      '3x8-10',
      60,
      false,
      'Apretando 2 segundos en contracción por rep.',
    ],
    [
      'Fondos en paralelas',
      '3xF',
      90,
      false,
      'Al fallo. Descansa 15 seg. e intenta sacar de nuevo al fallo (rest-pause).',
    ],
  ] as const,
};

async function main() {
  // 1. Grupos musculares
  for (const name of MUSCLE_GROUPS) {
    await prisma.muscleGroup.upsert({ where: { name }, update: {}, create: { name } });
  }
  const groups = new Map(
    (await prisma.muscleGroup.findMany()).map((g) => [g.name, g.id]),
  );

  // 2. Catálogo global de ejercicios (userId null)
  for (const [name, kind, equipment, primaryMuscle] of EXERCISES) {
    const existing = await prisma.exercise.findFirst({ where: { userId: null, name } });
    if (existing) continue;

    await prisma.exercise.create({
      data: {
        name,
        kind,
        equipment,
        muscles: {
          create: { muscleGroupId: groups.get(primaryMuscle)!, isPrimary: true },
        },
      },
    });
  }

  // 3. Usuario demo. Las credenciales las lleva Clerk, así que la fila nace sin
  //    `passwordHash`. Si pones tu email de Google en DEMO_USER_EMAIL, tu primer
  //    login adopta esta fila (y con ella estos datos) en vez de crear otra.
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      displayName: 'Atleta demo',
    },
  });

  // 4. Rutina de ejemplo para que la UI no arranque vacía
  const already = await prisma.routine.findUnique({
    where: { userId_name: { userId: user.id, name: DEMO_ROUTINE.name } },
  });

  if (!already) {
    const catalog = new Map(
      (await prisma.exercise.findMany({ where: { userId: null } })).map((e) => [e.name, e.id]),
    );

    await prisma.routine.create({
      data: {
        userId: user.id,
        name: DEMO_ROUTINE.name,
        description: DEMO_ROUTINE.description,
        color: DEMO_ROUTINE.color,
        exercises: {
          create: DEMO_ROUTINE.exercises.map(
            ([name, scheme, rest, superset, notes], i) => {
              const plan = parseScheme(scheme);
              return {
                exerciseId: catalog.get(name)!,
                position: i + 1,
                targetSets: plan.length,
                restSeconds: rest,
                supersetWithPrev: superset,
                notes,
                sets: {
                  create: plan.map((set, n) => ({
                    setNumber: n + 1,
                    repsMin: set.repsMin,
                    repsMax: set.repsMax,
                    toFailure: set.toFailure,
                    weight: set.weight,
                    isDropSet: set.isDropSet,
                    dropPct: set.dropPct,
                  })),
                },
              };
            },
          ),
        },
      },
    });
  }

  console.log(
    `Seed listo: ${MUSCLE_GROUPS.length} grupos, ${EXERCISES.length} ejercicios, usuario ${DEMO_EMAIL}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
