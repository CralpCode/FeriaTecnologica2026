import { defineConfig } from '@playwright/test';

/**
 * Prueba automática de la consulta (npm run e2e). Usa el Chrome instalado; no descarga navegadores.
 * e2e/run.sh levanta un servidor aislado (base, audios e informes temporales) y define E2E_BASE_URL.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,               // el servidor es uno solo (el ESP32 se vincula a una sesión a la vez)
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:8011', channel: 'chrome', headless: true },
  projects: [
    { name: 'celular', use: { viewport: { width: 390, height: 844 } } },
    { name: 'computadora', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
