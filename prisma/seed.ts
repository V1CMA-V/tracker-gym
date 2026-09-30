import { prisma } from '../src/lib/prisma.ts';

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
] as const;

// Rutina de ejemplo: [nombre del ejercicio, series, reps min, reps max, peso, descanso]
const DEMO_ROUTINE = {
  name: 'Empuje',
  description: 'Pecho, hombro y tríceps. Día A del split empuje/jalón/pierna.',
  color: '#FFB000',
  exercises: [
    ['Press de banca', 4, 6, 8, 80, 150],
    ['Press militar', 3, 8, 10, 45, 120],
    ['Press inclinado', 3, 10, 12, 24, 90],
    ['Elevaciones laterales', 3, 12, 15, 10, 60],
    ['Extensión de tríceps', 3, 12, 15, 25, 60],
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

  // 3. Usuario demo. No hay login todavía, así que el hash es un placeholder
  //    explícito en vez de una contraseña real hasheada.
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      passwordHash: 'NO_AUTH_YET',
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
            ([name, sets, repsMin, repsMax, weight, rest], i) => ({
              exerciseId: catalog.get(name)!,
              position: i + 1,
              targetSets: sets,
              targetRepsMin: repsMin,
              targetRepsMax: repsMax,
              targetWeight: weight,
              restSeconds: rest,
            }),
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
