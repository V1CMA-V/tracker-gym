// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  // Todas las páginas leen de Postgres en cada request, así que no hay nada
  // que prerenderizar: la app corre entera en el servidor.
  output: 'server',
  adapter: vercel(),

  vite: {
    plugins: [tailwindcss()],
  },
});
