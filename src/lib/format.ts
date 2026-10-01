/**
 * Helpers de presentación.
 *
 * Nota importante: los campos `Decimal` de Prisma NO son serializables a JSON.
 * Hay que pasarlos por `num()` antes de cruzarlos a una island o devolverlos
 * desde una Action, o revientan en runtime.
 */

/** Lo que puede llegar de Prisma en una columna numérica. */
export type Decimalish = { toNumber(): number } | number | string | null | undefined;

const KG_PER_LB = 0.45359237;

/** Decimal de Prisma → number plano. */
export function num(value: Decimalish): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return value.toNumber();
}

/** Quita los ceros finales: 80.00 → "80", 82.50 → "82.5" */
export function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Los pesos se guardan siempre en kg; la conversión vive aquí.
 * Devuelve solo el número — la unidad se rotula aparte para poder
 * componerla tipográficamente.
 */
export function weight(value: Decimalish, unit: 'kg' | 'lb' = 'kg'): string | null {
  const kg = num(value);
  if (kg === null) return null;
  return trim(unit === 'lb' ? kg / KG_PER_LB : kg);
}

/** 1RM estimado, fórmula de Epley. Igual que la vista `v_sets_detail`. */
export function epley1RM(kg: Decimalish, reps: number | null): number | null {
  const w = num(kg);
  if (w === null || !reps || reps <= 0 || w <= 0) return null;
  return Math.round(w * (1 + reps / 30) * 100) / 100;
}

/** Segundos → "1:30". Para descansos y duración de sesión. */
export function clock(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return '—';
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Duración larga para el historial: "1h 12m" */
export function duration(from: Date, to: Date | null): string {
  if (!to) return 'en curso';
  const mins = Math.round((to.getTime() - from.getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/** Fechas en la zona horaria del usuario, no la del servidor. */
export function date(value: Date, timezone: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    ...opts,
  }).format(value);
}

export function monthLabel(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    month: 'long',
    year: 'numeric',
  }).format(value);
}

/** Volumen: 12500 → "12.5k" */
export function compact(n: number): string {
  if (n < 1000) return trim(n);
  if (n < 1_000_000) return `${trim(Math.round(n / 100) / 10)}k`;
  return `${trim(Math.round(n / 100_000) / 10)}M`;
}

// ---------------------------------------------------------------------
// Ejercicios
// ---------------------------------------------------------------------

/**
 * Cómo se registra cada tipo de ejercicio. El valor es el enum de la base
 * (`exercise_kind`); la etiqueta es lo que se lee en la UI.
 */
export const EXERCISE_KINDS = {
  weight_reps: 'Peso + reps',
  bodyweight: 'Peso corporal',
  duration: 'Tiempo',
  distance: 'Distancia',
} as const;

export type ExerciseKindValue = keyof typeof EXERCISE_KINDS;

// ---------------------------------------------------------------------
// Días de la semana
// ---------------------------------------------------------------------

/**
 * Los días en el orden en que se lee una semana aquí: lunes primero.
 *
 * `dow` es el número que guarda la base (0 = domingo), igual que
 * EXTRACT(DOW) y que la función `routine_for_date`. No coincide con la
 * posición en este arreglo, y esa es justo la razón de que exista.
 */
export const WEEK_DAYS = [
  { dow: 1, short: 'Lun', long: 'lunes' },
  { dow: 2, short: 'Mar', long: 'martes' },
  { dow: 3, short: 'Mié', long: 'miércoles' },
  { dow: 4, short: 'Jue', long: 'jueves' },
  { dow: 5, short: 'Vie', long: 'viernes' },
  { dow: 6, short: 'Sáb', long: 'sábado' },
  { dow: 0, short: 'Dom', long: 'domingo' },
] as const;

const DOW_BY_EN_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Día de la semana (0-6) en la zona horaria del usuario.
 *
 * No sale de `Date.getDay()`: el servidor corre en otra zona y a ciertas
 * horas contestaría el día equivocado, que es justo cuando el usuario abre
 * la app para ver qué le toca.
 */
export function dayOfWeekIn(timezone: string, when: Date = new Date()): number {
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(when);
  return DOW_BY_EN_SHORT[short] ?? when.getDay();
}

/** Los días de una rutina, abreviados y en orden: "Lun · Jue". */
export function weekDayLabels(dows: Iterable<number>): string[] {
  const set = new Set(dows);
  return WEEK_DAYS.filter((day) => set.has(day.dow)).map((day) => day.short);
}

// ---------------------------------------------------------------------
// Plate math
// ---------------------------------------------------------------------

/** Discos olímpicos con su color estándar IWF. */
export const PLATES = [
  { kg: 25, color: '#C8372D' },
  { kg: 20, color: '#2B5FAE' },
  { kg: 15, color: '#C8A02D' },
  { kg: 10, color: '#2F8F4E' },
  { kg: 5, color: '#D8D8D8' },
  { kg: 2.5, color: '#C8372D' },
  { kg: 1.25, color: '#9AA0A6' },
] as const;

export const BAR_KG = 20;

export type PlateLoad = {
  /** Discos de UN lado de la barra, del más pesado al más ligero. */
  perSide: { kg: number; color: string }[];
  /** Peso que no se pudo formar con los discos disponibles. */
  remainder: number;
  achievable: boolean;
};

/**
 * Qué discos poner en la barra para llegar al peso objetivo.
 * Solo aplica a ejercicios con barra; el resto no lo muestra.
 */
export function plateMath(targetKg: Decimalish, barKg = BAR_KG): PlateLoad | null {
  const target = num(targetKg);
  if (target === null || target <= barKg) return null;

  let perSideKg = (target - barKg) / 2;
  const perSide: { kg: number; color: string }[] = [];

  for (const plate of PLATES) {
    while (perSideKg >= plate.kg - 1e-9) {
      perSide.push(plate);
      perSideKg -= plate.kg;
    }
  }

  const remainder = Math.round(perSideKg * 2 * 100) / 100;
  return { perSide, remainder, achievable: remainder < 0.01 };
}

// ---------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------

/**
 * URL a la que volver tras una Action enviada por formulario.
 *
 * Astro añade `?_action=<nombre>` al enviar el form. Hay que quitarlo del
 * destino del redirect —si no, se queda pegado en la barra de direcciones—
 * conservando el resto de parámetros de la app (el filtro activo, el
 * ejercicio abierto).
 */
export function backTo(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete('_action');
  const qs = params.toString();
  return qs ? `${url.pathname}?${qs}` : url.pathname;
}
