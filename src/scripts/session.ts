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

/** Reproduce el marcado de SetRow.astro para la fila recién creada. */
function renderRow(set: LoggedSet, isPR: boolean): HTMLLIElement {
  const row = document.createElement('li');
  row.className =
    'flex items-center gap-3 border-b border-steel py-2.5 last:border-b-0 rise';
  if (set.isWarmup) row.classList.add('opacity-55');
  if (isPR) row.classList.add('flare');
  row.dataset.setRow = '';

  const number = document.createElement('span');
  number.className = `readout w-7 shrink-0 text-center text-sm ${
    set.isWarmup ? 'text-ash-dim' : 'text-sodium'
  }`;
  number.textContent = set.isWarmup ? 'W' : String(set.setNumber);

  const body = document.createElement('div');
  body.className = 'flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5';

  const parts: [string, string?][] = [];
  if (set.weight !== null) parts.push([trim(set.weight), 'kg']);
  if (set.reps !== null) parts.push([String(set.reps), 'reps']);
  if (set.durationSeconds !== null) parts.push([clock(set.durationSeconds)]);
  if (set.distanceMeters !== null) parts.push([trim(set.distanceMeters / 1000), 'km']);

  for (const [value, unit] of parts) {
    const span = document.createElement('span');
    span.className = 'readout text-lg whitespace-nowrap';
    span.textContent = value;
    if (unit) {
      const u = document.createElement('span');
      u.className = 'stencil ml-0.5 text-ash';
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
    badge.className = 'stencil border border-sodium px-1 text-sodium';
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
    `<button type="submit" class="stencil px-1 hover:text-signal" ` +
    `aria-label="Borrar serie ${set.setNumber}">✕</button>`;

  row.append(number, body, remove);
  return row;
}

const form = document.querySelector<HTMLFormElement>('[data-log-form]');

form?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;

  const { data, error } = await actions.logSet(new FormData(form));

  if (submit) submit.disabled = false;

  if (error) {
    // Si algo falla, se deja que el navegador haga el POST normal: el
    // servidor vuelve a validar y muestra el mensaje en la página.
    form.submit();
    return;
  }

  const list =
    document.querySelector<HTMLUListElement>('[data-sets]') ??
    (() => {
      // Primera serie del ejercicio: sustituye el "sin series todavía".
      const placeholder = document.querySelector('[data-sets-empty]');
      const created = document.createElement('ul');
      created.dataset.sets = '';
      placeholder?.replaceWith(created);
      return created;
    })();

  list.append(renderRow(data.set as LoggedSet, data.isPR));

  // La pestaña del ejercicio lleva la cuenta de series completadas.
  if (!data.set.isWarmup) {
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

  // El RPE es de cada serie, no se arrastra a la siguiente.
  const rpe = form.querySelector<HTMLInputElement>('#f-rpe');
  if (rpe) rpe.value = '';
});
