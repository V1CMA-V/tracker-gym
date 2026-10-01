import { actions } from 'astro:actions';

/**
 * Mejora progresiva de la sesión activa.
 *
 * Todo lo de aquí es opcional: sin JavaScript el formulario hace POST
 * normal, la página se recarga y la serie queda registrada igual. Esto
 * solo evita la recarga y añade el cronómetro de descanso.
 */

const clock = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const trim = (n: number): string => String(Math.round(n * 100) / 100);

// ---------------------------------------------------------------------
// Tiempo transcurrido en la barra superior
// ---------------------------------------------------------------------
const elapsed = document.querySelector<HTMLElement>('[data-elapsed]');
if (elapsed?.dataset.started) {
  const startedAt = new Date(elapsed.dataset.started).getTime();
  const tick = () => {
    elapsed.textContent = clock((Date.now() - startedAt) / 1000);
  };
  tick();
  setInterval(tick, 1000);
}

// ---------------------------------------------------------------------
// Botones ± : ajustar peso y reps sin abrir el teclado
// ---------------------------------------------------------------------
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-step]')) {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.for ?? '');
    if (!(input instanceof HTMLInputElement)) return;

    const step = Number(button.dataset.step);
    const next = (Number(input.value) || 0) + step;
    input.value = trim(Math.max(0, next));
  });
}

// ---------------------------------------------------------------------
// Cronómetro de descanso
// ---------------------------------------------------------------------
function startRest(form: HTMLFormElement, seconds: number): void {
  const display = form.querySelector<HTMLElement>('[data-rest-timer]');
  const announce = form.querySelector<HTMLElement>('[data-rest-announce]');
  if (!display || seconds <= 0) return;

  const existing = Number(display.dataset.intervalId);
  if (existing) clearInterval(existing);

  const endsAt = Date.now() + seconds * 1000;
  display.hidden = false;
  display.classList.remove('hidden');
  if (announce) announce.textContent = `Descanso de ${seconds} segundos.`;

  const tick = () => {
    const left = (endsAt - Date.now()) / 1000;
    if (left <= 0) {
      clearInterval(id);
      display.textContent = 'Descanso terminado';
      display.classList.add('flare');
      if (announce) announce.textContent = 'Descanso terminado.';
      return;
    }
    display.textContent = `Descanso ${clock(left)}`;
  };

  const id = window.setInterval(tick, 250);
  display.dataset.intervalId = String(id);
  tick();
}

// ---------------------------------------------------------------------
// Registrar serie sin recargar
// ---------------------------------------------------------------------
type LoggedSet = {
  id: string;
  setNumber: number;
  weight: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  rpe: number | null;
  isWarmup: boolean;
};

/**
 * Reproduce el marcado de SetRow.astro para la fila recién creada.
 *
 * Las clases de aquí y las de src/components/SetRow.astro tienen que ser
 * IDÉNTICAS: si no, la fila que aparece al registrar se ve distinta de la
 * misma fila después de recargar. Se cambian las dos en el mismo commit.
 *
 * Y van escritas literales a propósito: Tailwind v4 escanea este archivo,
 * así que una clase interpolada se purga del CSS y se queda sin estilo.
 */
function renderRow(set: LoggedSet, isPR: boolean): HTMLLIElement {
  const row = document.createElement('li');
  row.className =
    'flex items-center gap-3 border-b border-steel py-3 last:border-b-0 rise';
  if (set.isWarmup) row.classList.add('opacity-50');
  if (isPR) row.classList.add('flare');
  row.dataset.setRow = '';

  const number = document.createElement('span');
  number.className = `readout w-8 shrink-0 text-center text-xs ${
    set.isWarmup ? 'text-ash-dim' : 'text-sodium'
  }`;
  number.textContent = set.isWarmup ? 'W' : String(set.setNumber);

  const body = document.createElement('div');
  body.className = 'flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1';

  const parts: [string, string?][] = [];
  if (set.weight !== null) parts.push([trim(set.weight), 'kg']);
  if (set.reps !== null) parts.push([String(set.reps), 'reps']);
  if (set.durationSeconds !== null) parts.push([clock(set.durationSeconds)]);
  if (set.distanceMeters !== null) parts.push([trim(set.distanceMeters / 1000), 'km']);

  for (const [value, unit] of parts) {
    const span = document.createElement('span');
    span.className = 'readout text-xl whitespace-nowrap';
    span.textContent = value;
    if (unit) {
      const u = document.createElement('span');
      u.className = 'stencil ml-1 text-ash-dim';
      u.textContent = unit;
      span.append(u);
    }
    body.append(span);
  }

  if (set.rpe !== null) {
    const rpe = document.createElement('span');
    rpe.className = 'stencil text-ash-dim';
    rpe.textContent = `RPE ${trim(set.rpe)}`;
    body.append(rpe);
  }

  if (isPR) {
    const badge = document.createElement('span');
    badge.className =
      'stencil rounded-full border border-sodium px-1.5 py-0.5 text-sodium';
    badge.textContent = 'Récord';
    body.append(badge);
  }

  // El borrado recarga: es poco frecuente y no vale la pena optimizarlo.
  // La URL sale de la propia action, no escrita a mano.
  const remove = document.createElement('form');
  remove.method = 'POST';
  remove.action = actions.deleteSet.queryString;
  remove.className = 'shrink-0';
  remove.innerHTML =
    `<input type="hidden" name="id" value="${set.id}">` +
    `<button type="submit" class="stencil flex size-9 items-center justify-center text-ash-dim hover:text-signal" ` +
    `aria-label="Borrar serie ${set.setNumber}">✕</button>`;

  row.append(number, body, remove);
  return row;
}

/** La lista de series de un ejercicio, creándola si esta era la primera. */
function setsListOf(card: HTMLElement): HTMLUListElement {
  const existing = card.querySelector<HTMLUListElement>('[data-sets]');
  if (existing) return existing;

  // Primera serie del ejercicio: sustituye el "sin series todavía".
  const placeholder = card.querySelector('[data-sets-empty]');
  const created = document.createElement('ul');
  created.dataset.sets = '';
  placeholder?.replaceWith(created);
  return created;
}

const form = document.querySelector<HTMLFormElement>('[data-log-form]');

form?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;

  const { data, error } = await actions.logRound(new FormData(form));

  if (submit) submit.disabled = false;

  if (error) {
    // Si algo falla, se deja que el navegador haga el POST normal: el
    // servidor vuelve a validar y muestra el mensaje en la página.
    form.submit();
    return;
  }

  // Cada serie de la ronda cae en la tarjeta de su propio ejercicio.
  let working = false;
  for (const entry of data.entries) {
    const card = document.querySelector<HTMLElement>(
      `[data-member="${entry.sessionExerciseId}"]`,
    );
    if (!card) continue;

    setsListOf(card).append(renderRow(entry.set as LoggedSet, entry.isPR));
    if (!entry.set.isWarmup) working = true;
  }

  // La pestaña del bloque lleva la cuenta de rondas cerradas.
  if (working) {
    const tab = document.querySelector<HTMLElement>('nav a[aria-current="true"]');
    const counter = tab?.querySelector<HTMLElement>('.text-go');
    if (counter) {
      counter.textContent = String(Number(counter.textContent) + 1);
    } else if (tab) {
      const created = document.createElement('span');
      created.className = 'readout text-xs text-go';
      created.textContent = '1';
      tab.append(created);
    }
  }

  const rest = Number(form.dataset.rest);
  if (rest > 0) startRest(form, rest);

  // El RPE es de cada serie, no se arrastra a la siguiente. Los campos no
  // cuelgan del <form> —van asociados con el atributo `form`—, así que se
  // recorre form.elements y no el subárbol del formulario.
  for (const element of Array.from(form.elements)) {
    if (element instanceof HTMLInputElement && element.name === 'rpe') {
      element.value = '';
    }
  }
});
