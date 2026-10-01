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

ALTER TABLE routine_sets
  ADD CONSTRAINT ck_routine_sets_number   CHECK (set_number > 0),
  ADD CONSTRAINT ck_routine_sets_reps_min CHECK (reps_min IS NULL OR reps_min > 0),
  ADD CONSTRAINT ck_routine_sets_reps_max CHECK (reps_max IS NULL OR reps_max >= reps_min),
  ADD CONSTRAINT ck_routine_sets_weight   CHECK (weight IS NULL OR weight >= 0),
  ADD CONSTRAINT ck_routine_sets_drop_pct CHECK (drop_pct IS NULL OR drop_pct BETWEEN 1 AND 99),
  -- Al fallo y un número de reps son excluyentes.
  ADD CONSTRAINT ck_routine_sets_reps     CHECK (NOT (to_failure AND reps_min IS NOT NULL));

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

-- Reescribir el esquema de series borra y recrea las filas en una sola
-- transacción, así que el UNIQUE tiene que tolerar colisiones intermedias.
DROP INDEX IF EXISTS "routine_sets_routine_exercise_id_set_number_key";
ALTER TABLE routine_sets
  ADD CONSTRAINT uq_routine_sets_number UNIQUE (routine_exercise_id, set_number)
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
