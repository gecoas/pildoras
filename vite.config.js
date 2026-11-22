import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: ['pildoras.gecoas.es'],
  },
  preview: {
    allowedHosts: ['pildoras.gecoas.es'],
  },
});
