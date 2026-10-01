/**
 * Esquema de series de un ejercicio dentro de una rutina.
 *
 * Una rutina real no dice "3×10" y ya: las reps bajan mientras el peso sube
 * (12/10/8), hay series al fallo, y hay drop-sets que continúan la serie
 * anterior sin descanso. Todo eso se escribe aquí como una sola línea de
 * texto y se guarda desglosado en `routine_sets`, una fila por serie, para
 * que la pantalla de sesión pueda guiar serie por serie.
 *
 * Gramática (lo que el usuario teclea):
 *
 *   12/10/8        tres series: 12, luego 10, luego 8 reps
 *   3x8-12         tres series de 8 a 12 reps
 *   3xF            tres series al fallo   (F, fallo o AMRAP)
 *   6-8@60         con peso objetivo de 60 kg
 *   6/d15          una serie de 6 y un drop-set de 15 sin descansar
 *   d15@-40%       drop-set bajando el 40 % del peso de la serie anterior
 *   3x(6/d15)      repite el bloque completo tres veces
 *
 * Los separadores válidos son `/` y `,`; los espacios se ignoran.
 */

import { num, type Decimalish } from './format';

export type PlannedSet = {
  /** Reps objetivo, o el extremo bajo del rango. `null` si es al fallo. */
  repsMin: number | null;
  /** Extremo alto del rango. `null` cuando la serie pide un número exacto. */
  repsMax: number | null;
  /** "Al fallo": no hay número de reps, se llega hasta donde se pueda. */
  toFailure: boolean;
  /** Peso objetivo en kg para esta serie concreta. */
  weight: number | null;
  /** Drop-set: continúa la serie anterior sin descanso, con menos peso. */
  isDropSet: boolean;
  /** Cuánto peso se baja respecto a la serie anterior, en porcentaje. */
  dropPct: number | null;
};

/** Tope: más allá de esto casi seguro es un error de tecleo. */
export const MAX_SETS = 20;

export class SchemeError extends Error {}

const FAILURE_WORDS = new Set(['f', 'fallo', 'alfallo', 'amrap']);

const emptySet = (): PlannedSet => ({
  repsMin: null,
  repsMax: null,
  toFailure: false,
  weight: null,
  isDropSet: false,
  dropPct: null,
});

/**
 * Corta por `/` y `,` sin romper lo que está dentro de paréntesis, para que
 * `3x(6/d15)` llegue entero al parser de bloques.
 */
function splitTop(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of input) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth < 0) throw new SchemeError('Sobra un paréntesis de cierre.');

    if ((char === '/' || char === ',') && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (depth !== 0) throw new SchemeError('Falta cerrar un paréntesis.');

  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

/** `6-8@60`, `d15@-40%`, `F` → una serie. */
function parseSet(token: string): PlannedSet {
  const match = /^(d)?\s*([^@]+?)\s*(?:@\s*(-?\d+(?:[.,]\d+)?)\s*(%|kg)?)?$/i.exec(token);
  if (!match) throw new SchemeError(`No entiendo "${token}".`);

  const [, drop, repsPart, amount, unit] = match;
  const set = emptySet();
  set.isDropSet = drop !== undefined;

  const reps = repsPart.replace(/\s+/g, '').toLowerCase();

  if (FAILURE_WORDS.has(reps)) {
    set.toFailure = true;
  } else {
    const range = /^(\d+)(?:-(\d+))?$/.exec(reps);
    if (!range) throw new SchemeError(`No entiendo las reps de "${token}".`);

    set.repsMin = Number(range[1]);
    set.repsMax = range[2] === undefined ? null : Number(range[2]);

    if (set.repsMin < 1 || set.repsMin > 999) {
      throw new SchemeError(`Reps fuera de rango en "${token}".`);
    }
    if (set.repsMax !== null && set.repsMax < set.repsMin) {
      throw new SchemeError(`En "${token}" el máximo de reps es menor que el mínimo.`);
    }
  }

  if (amount !== undefined) {
    const value = Number(amount.replace(',', '.'));
    if (unit === '%') {
      // El signo es cosmético: "@-40%" y "@40%" bajan lo mismo.
      const pct = Math.abs(value);
      if (pct < 1 || pct > 99) throw new SchemeError(`El porcentaje de "${token}" debe ir de 1 a 99.`);
      set.dropPct = pct;
    } else {
      if (value < 0 || value > 9999) throw new SchemeError(`Peso fuera de rango en "${token}".`);
      set.weight = value;
    }
  }

  return set;
}

/** `3x8-12`, `3x(6/d15)` o una serie suelta. */
function parseChunk(chunk: string): PlannedSet[] {
  const repeat = /^(\d+)\s*[x*×]\s*(.+)$/i.exec(chunk);
  if (!repeat) return [parseSet(chunk)];

  const times = Number(repeat[1]);
  if (times < 1 || times > MAX_SETS) {
    throw new SchemeError(`"${chunk}": repite entre 1 y ${MAX_SETS} veces.`);
  }

  const body = repeat[2].trim();
  const grouped = /^\((.*)\)$/s.exec(body);
  const block = grouped ? parseScheme(grouped[1]) : [parseSet(body)];
  if (block.length === 0) throw new SchemeError(`"${chunk}" no repite nada.`);

  return Array.from({ length: times }, () => block.map((s) => ({ ...s }))).flat();
}

/**
 * Texto → series. Lanza `SchemeError` con un mensaje en español si el texto
 * no se entiende; la action lo convierte en el error del formulario.
 */
export function parseScheme(input: string): PlannedSet[] {
  const sets = splitTop(input).flatMap(parseChunk);

  if (sets.length > MAX_SETS) {
    throw new SchemeError(`Son ${sets.length} series; el máximo es ${MAX_SETS}.`);
  }
  // Un drop-set continúa algo: no puede abrir el ejercicio.
  if (sets[0]?.isDropSet) {
    throw new SchemeError('El esquema no puede empezar con un drop-set.');
  }

  return sets;
}

// ---------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------

/** Reps de una serie tal como se leen: "8-12", "12", "al fallo". */
export function repsLabel(set: PlannedSet): string {
  if (set.toFailure) return 'al fallo';
  if (set.repsMin === null) return '—';
  return set.repsMax !== null && set.repsMax !== set.repsMin
    ? `${set.repsMin}-${set.repsMax}`
    : String(set.repsMin);
}

/** Una serie en la sintaxis del esquema, para reconstruir el campo de texto. */
function setToken(set: PlannedSet): string {
  const reps = set.toFailure ? 'F' : repsLabel(set);
  const suffix =
    set.dropPct !== null ? `@-${set.dropPct}%` : set.weight !== null ? `@${set.weight}` : '';
  return `${set.isDropSet ? 'd' : ''}${reps}${suffix}`;
}

/**
 * ¿La lista es un mismo bloque repetido N veces? Devuelve el bloque más
 * corto que la genera. Es lo que convierte seis series en "3x(6/d15)".
 */
function repeatingBlock(sets: PlannedSet[]): { block: PlannedSet[]; rounds: number } | null {
  for (let size = 1; size <= sets.length / 2; size++) {
    if (sets.length % size !== 0) continue;

    const block = sets.slice(0, size);
    const repeats = sets.every((set, i) => setToken(set) === setToken(block[i % size]));
    if (repeats) return { block, rounds: sets.length / size };
  }
  return null;
}

/**
 * Series → texto canónico. Colapsa lo repetido (`3x8-12` en vez de
 * `8-12/8-12/8-12`, `3x(6/d15)` en vez de las seis series sueltas) para que
 * el campo se pueda reeditar sin pelearse con él.
 */
export function formatScheme(sets: PlannedSet[]): string {
  const repeated = repeatingBlock(sets);
  if (repeated) {
    const inner = repeated.block.map(setToken).join('/');
    return repeated.block.length === 1
      ? `${repeated.rounds}x${inner}`
      : `${repeated.rounds}x(${inner})`;
  }

  // Sin bloque global, queda colapsar rachas sueltas: "12/10/2x8".
  const parts: string[] = [];
  for (let i = 0; i < sets.length; ) {
    const token = setToken(sets[i]);
    let run = 1;
    while (i + run < sets.length && setToken(sets[i + run]) === token) run++;
    parts.push(run > 1 ? `${run}x${token}` : token);
    i += run;
  }

  return parts.join('/');
}

/**
 * Resumen corto para las tarjetas: "3 × 12/10/8", "3 × 6-8 + drop 15".
 * Agrupa por rondas cuando el patrón se repite, que es como se lee la
 * rutina en papel.
 */
export function summarizeScheme(sets: PlannedSet[]): string {
  if (sets.length === 0) return '—';

  // "3 rondas de 6 + drop 15" se lee mejor que las seis series sueltas.
  const repeated = repeatingBlock(sets);
  return repeated
    ? `${repeated.rounds} × ${blockLabel(repeated.block)}`
    : blockLabel(sets);
}

function blockLabel(block: PlannedSet[]): string {
  return block
    .map((set, i) => {
      const reps = repsLabel(set);
      if (!set.isDropSet) return i === 0 ? reps : ` / ${reps}`;
      return ` + drop ${reps}${set.dropPct !== null ? ` (-${set.dropPct}%)` : ''}`;
    })
    .join('')
    .trim();
}

// ---------------------------------------------------------------------
// Plan efectivo de un ejercicio de rutina
// ---------------------------------------------------------------------

/** Una fila de `routine_sets` tal como sale de Prisma. */
export type RoutineSetRow = {
  repsMin: number | null;
  repsMax: number | null;
  toFailure: boolean;
  weight: Decimalish;
  isDropSet: boolean;
  dropPct: number | null;
};

/** Filas de la base → series, con los `Decimal` ya aplanados a number. */
export function fromRows(rows: RoutineSetRow[]): PlannedSet[] {
  return rows.map((row) => ({
    repsMin: row.repsMin,
    repsMax: row.repsMax,
    toFailure: row.toFailure,
    weight: num(row.weight),
    isDropSet: row.isDropSet,
    dropPct: row.dropPct,
  }));
}

/** Lo mínimo que hace falta del `RoutineExercise` para armar el plan. */
export type SchemeSource = {
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetWeight: Decimalish;
  sets?: RoutineSetRow[];
};

/**
 * Series planificadas de un ejercicio.
 *
 * Si tiene esquema guardado manda el esquema; si no, se reconstruye el plan
 * plano de siempre (`targetSets` × `targetReps`) para que las rutinas
 * creadas antes de esta función sigan funcionando igual.
 */
export function plannedSets(source: SchemeSource): PlannedSet[] {
  if (source.sets && source.sets.length > 0) return fromRows(source.sets);

  return Array.from({ length: source.targetSets }, () => ({
    ...emptySet(),
    repsMin: source.targetRepsMin,
    repsMax: source.targetRepsMax,
    weight: num(source.targetWeight),
  }));
}
