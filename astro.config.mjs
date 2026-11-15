// @ts-check
import { defineConfig, envField } from 'astro/config';
import netlify from '@astrojs/netlify';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: netlify({
    devFeatures: {
      images: true,
      environmentVariables: false,
      edgeFunctions: false
    }
  }),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: 'server', access: 'secret' }),
      SUPABASE_KEY: envField.string({ context: 'server', access: 'secret' }),
      // Clave secreta admin server-only (generateLink). Nunca llega al cliente.
      SUPABASE_SECRET_API_KEY: envField.string({ context: 'server', access: 'secret' }),
      SMTP_HOST: envField.string({ context: 'server', access: 'secret' }),
      SMTP_PORT: envField.string({ context: 'server', access: 'secret' }),
      SMTP_USER: envField.string({ context: 'server', access: 'secret' }),
      SMTP_PASS: envField.string({ context: 'server', access: 'secret' })
    }
  },
  redirects: {
    '/': '/auth/login'
  },
  vite: {
    plugins: [tailwindcss()]
  }
});