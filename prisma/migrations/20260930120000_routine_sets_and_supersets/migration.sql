-- AlterTable
ALTER TABLE "routine_exercises" ADD COLUMN     "superset_with_prev" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "routine_sets" (
    "id" UUID NOT NULL,
    "routine_exercise_id" UUID NOT NULL,
    "set_number" SMALLINT NOT NULL,
    "reps_min" SMALLINT,
    "reps_max" SMALLINT,
    "to_failure" BOOLEAN NOT NULL DEFAULT false,
    "weight" DECIMAL(6,2),
    "is_drop_set" BOOLEAN NOT NULL DEFAULT false,
    "drop_pct" SMALLINT,

    CONSTRAINT "routine_sets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routine_sets_routine_exercise_id_set_number_key" ON "routine_sets"("routine_exercise_id", "set_number");

-- AddForeignKey
ALTER TABLE "routine_sets" ADD CONSTRAINT "routine_sets_routine_exercise_id_fkey" FOREIGN KEY ("routine_exercise_id") REFERENCES "routine_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Complemento SQL (ver prisma/constraints.sql, sección 1 y 3)
-- ---------------------------------------------------------------------
ALTER TABLE "routine_sets"
  ADD CONSTRAINT ck_routine_sets_number   CHECK (set_number > 0),
  ADD CONSTRAINT ck_routine_sets_reps_min CHECK (reps_min IS NULL OR reps_min > 0),
  ADD CONSTRAINT ck_routine_sets_reps_max CHECK (reps_max IS NULL OR reps_max >= reps_min),
  ADD CONSTRAINT ck_routine_sets_weight   CHECK (weight IS NULL OR weight >= 0),
  ADD CONSTRAINT ck_routine_sets_drop_pct CHECK (drop_pct IS NULL OR drop_pct BETWEEN 1 AND 99),
  -- Al fallo y un número de reps son excluyentes.
  ADD CONSTRAINT ck_routine_sets_reps     CHECK (NOT (to_failure AND reps_min IS NOT NULL));

-- Reescribir el esquema borra y recrea las filas en una transacción: el
-- UNIQUE tiene que aguantar las colisiones intermedias.
DROP INDEX IF EXISTS "routine_sets_routine_exercise_id_set_number_key";
ALTER TABLE "routine_sets"
  ADD CONSTRAINT uq_routine_sets_number UNIQUE (routine_exercise_id, set_number)
  DEFERRABLE INITIALLY DEFERRED;
