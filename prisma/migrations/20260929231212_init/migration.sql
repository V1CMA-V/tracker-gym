-- CreateEnum
CREATE TYPE "role_user" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "exercise_kind" AS ENUM ('weight_reps', 'bodyweight', 'duration', 'distance');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "weight_unit" AS ENUM ('kg', 'lb');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "role" "role_user" NOT NULL DEFAULT 'USER',
    "preferred_unit" "weight_unit" NOT NULL DEFAULT 'kg',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Mexico_City',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muscle_groups" (
    "id" SMALLSERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,

    CONSTRAINT "muscle_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercises" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "kind" "exercise_kind" NOT NULL DEFAULT 'weight_reps',
    "equipment" VARCHAR(50),
    "description" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_muscles" (
    "exercise_id" UUID NOT NULL,
    "muscle_group_id" SMALLINT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "exercise_muscles_pkey" PRIMARY KEY ("exercise_id","muscle_group_id")
);

-- CreateTable
CREATE TABLE "routines" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "color" VARCHAR(7),
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routine_exercises" (
    "id" UUID NOT NULL,
    "routine_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "target_sets" SMALLINT NOT NULL DEFAULT 3,
    "target_reps_min" SMALLINT,
    "target_reps_max" SMALLINT,
    "target_weight" DECIMAL(6,2),
    "rest_seconds" SMALLINT DEFAULT 90,
    "notes" TEXT,

    CONSTRAINT "routine_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_schedule" (
    "user_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "routine_id" UUID NOT NULL,

    CONSTRAINT "weekly_schedule_pkey" PRIMARY KEY ("user_id","day_of_week")
);

-- CreateTable
CREATE TABLE "scheduled_workouts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "routine_id" UUID,
    "scheduled_date" DATE NOT NULL,
    "notes" TEXT,

    CONSTRAINT "scheduled_workouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "routine_id" UUID,
    "routine_name" VARCHAR(100),
    "status" "session_status" NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "bodyweight" DECIMAL(5,2),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_exercises" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "session_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_sets" (
    "id" UUID NOT NULL,
    "session_exercise_id" UUID NOT NULL,
    "set_number" SMALLINT NOT NULL,
    "weight" DECIMAL(6,2),
    "reps" SMALLINT,
    "duration_seconds" INTEGER,
    "distance_meters" DECIMAL(8,2),
    "rpe" DECIMAL(3,1),
    "is_warmup" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_sets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "muscle_groups_name_key" ON "muscle_groups"("name");

-- CreateIndex
CREATE INDEX "exercises_user_id_idx" ON "exercises"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "routines_user_id_name_key" ON "routines"("user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "routine_exercises_routine_id_position_key" ON "routine_exercises"("routine_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_workouts_user_id_scheduled_date_key" ON "scheduled_workouts"("user_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "workout_sessions_user_id_started_at_idx" ON "workout_sessions"("user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "session_exercises_exercise_id_idx" ON "session_exercises"("exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_exercises_session_id_position_key" ON "session_exercises"("session_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_sets_session_exercise_id_set_number_key" ON "exercise_sets"("session_exercise_id", "set_number");

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_muscle_group_id_fkey" FOREIGN KEY ("muscle_group_id") REFERENCES "muscle_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_exercises" ADD CONSTRAINT "routine_exercises_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_exercises" ADD CONSTRAINT "routine_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_schedule" ADD CONSTRAINT "weekly_schedule_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_schedule" ADD CONSTRAINT "weekly_schedule_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_workouts" ADD CONSTRAINT "scheduled_workouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_workouts" ADD CONSTRAINT "scheduled_workouts_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_session_exercise_id_fkey" FOREIGN KEY ("session_exercise_id") REFERENCES "session_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- GYM TRACKER · Complemento SQL del schema.prisma
-- Todo lo que Prisma no puede declarar: CHECKs, índices con expresión,
-- UNIQUE DEFERRABLE, triggers, vistas y funciones.
--
-- Uso: pegar este contenido al final del archivo migration.sql generado
--      por `prisma migrate dev --create-only`, o ejecutarlo a mano una vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CHECK constraints
-- ---------------------------------------------------------------------
ALTER TABLE weekly_schedule
  ADD CONSTRAINT ck_weekly_day_of_week CHECK (day_of_week BETWEEN 0 AND 6);

ALTER TABLE routine_exercises
  ADD CONSTRAINT ck_routine_ex_sets     CHECK (target_sets > 0),
  ADD CONSTRAINT ck_routine_ex_reps_min CHECK (target_reps_min IS NULL OR target_reps_min > 0),
  ADD CONSTRAINT ck_routine_ex_reps_max CHECK (target_reps_max IS NULL OR target_reps_max >= target_reps_min);

ALTER TABLE workout_sessions
  ADD CONSTRAINT ck_sessions_ended_at CHECK (ended_at IS NULL OR ended_at >= started_at);

ALTER TABLE exercise_sets
  ADD CONSTRAINT ck_sets_number   CHECK (set_number > 0),
  ADD CONSTRAINT ck_sets_weight   CHECK (weight IS NULL OR weight >= 0),
  ADD CONSTRAINT ck_sets_reps     CHECK (reps IS NULL OR reps >= 0),
  ADD CONSTRAINT ck_sets_duration CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  ADD CONSTRAINT ck_sets_distance CHECK (distance_meters IS NULL OR distance_meters >= 0),
  ADD CONSTRAINT ck_sets_rpe      CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10);

-- ---------------------------------------------------------------------
-- 2. Índices con expresión / parciales
-- ---------------------------------------------------------------------
-- Nombres de ejercicio únicos por usuario (y dentro del catálogo global).
CREATE UNIQUE INDEX uq_exercises_user_name
  ON exercises (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- Prisma crea exercises(user_id); lo reemplazamos por la versión parcial.
DROP INDEX IF EXISTS "exercises_user_id_idx";
CREATE INDEX idx_exercises_user ON exercises (user_id) WHERE NOT is_archived;

-- ---------------------------------------------------------------------
-- 3. UNIQUE diferibles (permiten reordenar en una sola transacción)
--    Prisma materializa @@unique como CREATE UNIQUE INDEX, no como
--    constraint, así que se elimina con DROP INDEX. El ADD CONSTRAINT
--    vuelve a crear su propio índice de respaldo.
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS "routine_exercises_routine_id_position_key";
ALTER TABLE routine_exercises
  ADD CONSTRAINT uq_routine_exercises_position UNIQUE (routine_id, position)
  DEFERRABLE INITIALLY DEFERRED;

DROP INDEX IF EXISTS "session_exercises_session_id_position_key";
ALTER TABLE session_exercises
  ADD CONSTRAINT uq_session_exercises_position UNIQUE (session_id, position)
  DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------
-- 4. updated_at automático
--    Prisma ya pone @updatedAt, pero el trigger cubre los UPDATE que
--    entran por SQL crudo o desde otro cliente.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_routines_updated ON routines;
CREATE TRIGGER trg_routines_updated
  BEFORE UPDATE ON routines FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 5. VISTAS para progreso y resúmenes
-- =====================================================================

-- 5.1 Series "planas" con todo el contexto (base para las demás vistas)
CREATE OR REPLACE VIEW v_sets_detail AS
SELECT
  ws.user_id,
  ws.id           AS session_id,
  ws.started_at,
  (ws.started_at AT TIME ZONE u.timezone)::date AS workout_date,
  se.exercise_id,
  e.name          AS exercise_name,
  es.set_number,
  es.weight,
  es.reps,
  es.is_warmup,
  -- 1RM estimado (fórmula de Epley)
  CASE WHEN es.reps > 0 AND es.weight > 0
       THEN ROUND(es.weight * (1 + es.reps / 30.0), 2) END AS est_1rm,
  COALESCE(es.weight, 0) * COALESCE(es.reps, 0)          AS volume
FROM exercise_sets es
JOIN session_exercises se ON se.id = es.session_exercise_id
JOIN workout_sessions  ws ON ws.id = se.session_id
JOIN exercises          e ON e.id  = se.exercise_id
JOIN users              u ON u.id  = ws.user_id
WHERE ws.status = 'completed';

-- 5.2 Progreso por ejercicio y día (gráfica de progreso)
CREATE OR REPLACE VIEW v_exercise_progress AS
SELECT
  user_id,
  exercise_id,
  exercise_name,
  workout_date,
  MAX(weight)   AS max_weight,
  MAX(est_1rm)  AS best_est_1rm,
  SUM(volume)   AS total_volume,
  COUNT(*)      AS working_sets
FROM v_sets_detail
WHERE NOT is_warmup
GROUP BY user_id, exercise_id, exercise_name, workout_date;

-- 5.3 Récords personales por ejercicio
CREATE OR REPLACE VIEW v_personal_records AS
SELECT DISTINCT ON (user_id, exercise_id)
  user_id, exercise_id, exercise_name,
  weight AS pr_weight, reps AS pr_reps, est_1rm, workout_date AS achieved_on
FROM v_sets_detail
WHERE NOT is_warmup AND weight IS NOT NULL
ORDER BY user_id, exercise_id, est_1rm DESC NULLS LAST, workout_date;

-- 5.4 Resumen mensual
CREATE OR REPLACE VIEW v_monthly_summary AS
SELECT
  ws.user_id,
  date_trunc('month', ws.started_at AT TIME ZONE u.timezone)::date AS month,
  COUNT(DISTINCT ws.id)                                            AS sessions,
  ROUND(SUM(EXTRACT(EPOCH FROM (ws.ended_at - ws.started_at))) / 3600, 1) AS total_hours,
  COALESCE(SUM(s.volume), 0)                                       AS total_volume_kg,
  COALESCE(SUM(s.set_count), 0)                                    AS total_sets
FROM workout_sessions ws
JOIN users u ON u.id = ws.user_id
LEFT JOIN LATERAL (
  SELECT SUM(COALESCE(es.weight,0) * COALESCE(es.reps,0)) AS volume,
         COUNT(*) FILTER (WHERE NOT es.is_warmup)         AS set_count
  FROM session_exercises se
  JOIN exercise_sets es ON es.session_exercise_id = se.id
  WHERE se.session_id = ws.id
) s ON true
WHERE ws.status = 'completed'
GROUP BY ws.user_id, month;

-- =====================================================================
-- 6. FUNCIÓN: ¿qué rutina toca en una fecha?
--    Prioridad: fecha concreta del calendario > plan semanal
-- =====================================================================
CREATE OR REPLACE FUNCTION routine_for_date(p_user UUID, p_date DATE)
RETURNS UUID AS $$
  SELECT COALESCE(
    (SELECT routine_id FROM scheduled_workouts
      WHERE user_id = p_user AND scheduled_date = p_date),
    (SELECT routine_id FROM weekly_schedule
      WHERE user_id = p_user AND day_of_week = EXTRACT(DOW FROM p_date)
        AND NOT EXISTS (SELECT 1 FROM scheduled_workouts
                         WHERE user_id = p_user AND scheduled_date = p_date))
  );
$$ LANGUAGE sql STABLE;
