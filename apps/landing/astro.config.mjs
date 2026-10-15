// @ts-check
import { defineConfig } from 'astro/config';

// On GitHub Pages the workflow passes the site origin and the base path (/<repo>/ for project pages).
export default defineConfig({
  site: process.env.ASTRO_SITE,
  base: process.env.ASTRO_BASE ?? '/',
  output: 'static',
  trailingSlash: 'always',
  i18n: { defaultLocale: 'en', locales: ['en', 'es'], routing: { prefixDefaultLocale: false } },
});
