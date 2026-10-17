import { actions } from 'astro:actions';

/**
 * Mejora progresiva del plan semanal.
 *
 * Todo lo de aquí es opcional: `data-enhanced` ya está puesto por el script
 * inline de WeekStrip.astro, y si este módulo no llega a ejecutarse —o algo
 * falla— se le quita y vuelven los siete `<select>` con su botón Guardar,
 * que es un POST normal y guarda igual.
 *
 * El `<form>` nunca deja de ser la fuente de verdad: elegir en la hoja
 * escribe en el `<select>` del día y lo que se envía es `new FormData(form)`,
 * los siete días de golpe, como espera `setWeeklySchedule`.
 */

const week = document.querySelector<HTMLElement>('[data-week]');
const form = week?.querySelector<HTMLFormElement>('[data-week-form]');
const sheet = week?.querySelector<HTMLDialogElement>('[data-week-sheet]');

if (week && form && sheet) {
  const title = sheet.querySelector<HTMLElement>('[data-sheet-title]');
  const options = Array.from(sheet.querySelectorAll<HTMLButtonElement>('[data-pick]'));
  const status = week.querySelector<HTMLElement>('[data-week-status]');
  const hint = week.querySelector<HTMLElement>('[data-week-hint]');

  /** El día cuya hoja está abierta. */
  let openDow: string | null = null;

  const cardOf = (dow: string) => week.querySelector<HTMLElement>(`[data-day="${dow}"]`);

  const selectOf = (dow: string) =>
    cardOf(dow)?.querySelector<HTMLSelectElement>('[data-day-select]') ?? null;

  function announce(text: string): void {
    if (hint) hint.hidden = true;
    if (status) status.textContent = text;
  }

  // -------------------------------------------------------------------
  // Guardar
  // -------------------------------------------------------------------
  /**
   * Cada elección dispara una petición. Si se tocan dos días seguidos, la
   * respuesta de la primera puede llegar después de la segunda: el contador
   * hace que solo la última escriba el estado.
   */
  let sequence = 0;

  async function save(): Promise<void> {
    const token = ++sequence;
    announce('Guardando…');

    const { error } = await actions.setWeeklySchedule(new FormData(form!));
    if (token !== sequence) return;

    if (error) {
      // Igual que en session.ts: se devuelve la cara sin JavaScript y se deja
      // que el navegador haga el POST normal. El servidor revalida y pinta el
      // mensaje en la página.
      week!.removeAttribute('data-enhanced');
      form!.submit();
      return;
    }

    announce('Guardado');
    // Reinicia la animación para que el segundo guardado también destelle.
    status?.classList.remove('flare');
    void status?.offsetWidth;
    status?.classList.add('flare');
  }

  // -------------------------------------------------------------------
  // Abrir la hoja del día
  // -------------------------------------------------------------------
  for (const trigger of week.querySelectorAll<HTMLButtonElement>('[data-day-trigger]')) {
    trigger.addEventListener('click', () => {
      const dow = trigger.dataset.dow ?? '';
      const select = selectOf(dow);
      if (!select) return;

      openDow = dow;
      if (title) title.textContent = trigger.dataset.long ?? '';

      for (const option of options) {
        const active = (option.dataset.id ?? '') === select.value;
        option.setAttribute('aria-pressed', String(active));
        const check = option.querySelector<HTMLElement>('[data-check]');
        if (check) check.hidden = !active;
      }

      sheet.showModal();
    });
  }

  // -------------------------------------------------------------------
  // Elegir rutina (o descanso)
  // -------------------------------------------------------------------
  for (const option of options) {
    option.addEventListener('click', () => {
      const dow = openDow;
      const card = dow ? cardOf(dow) : null;
      const select = dow ? selectOf(dow) : null;
      sheet.close();
      if (!card || !select || dow === null) return;

      const routineId = option.dataset.id ?? '';
      select.value = routineId;
      const isRest = routineId === '';

      const name = card.querySelector<HTMLElement>('[data-day-name]');
      if (name) {
        name.textContent = option.dataset.name ?? '';
        // Las clases van literales: Tailwind escanea este archivo y purgaría
        // cualquier cosa interpolada. Son las mismas que pone WeekStrip.astro.
        name.classList.toggle('text-chalk', !isRest);
        name.classList.toggle('text-ash-dim', isRest);
      }

      const meta = card.querySelector<HTMLElement>('[data-day-meta]');
      if (meta) meta.textContent = option.dataset.meta ?? '';

      const edge = card.querySelector<HTMLElement>('[data-day-edge]');
      if (edge) edge.style.background = option.dataset.color || 'transparent';

      // El pie "Hoy toca …" apunta al día de hoy: si es el que se acaba de
      // cambiar, hay que moverlo con él o mandaría a entrenar la rutina vieja.
      const todayBox = week!.querySelector<HTMLElement>('[data-today]');
      if (todayBox && dow === todayBox.dataset.today) {
        const input = todayBox.querySelector<HTMLInputElement>('[data-today-id]');
        const label = todayBox.querySelector<HTMLElement>('[data-today-name]');
        if (input) input.value = routineId;
        if (label) label.textContent = option.dataset.name ?? '';
        todayBox.hidden = isRest;
      }

      void save();
    });
  }

  // -------------------------------------------------------------------
  // Cerrar
  // -------------------------------------------------------------------
  sheet.querySelector<HTMLButtonElement>('[data-sheet-close]')?.addEventListener('click', () => {
    sheet.close();
  });

  // Clic en el fondo: el target es el propio <dialog>, no su contenido.
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) sheet.close();
  });
}
