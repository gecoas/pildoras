import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { isAdmin } from './app.js';
import { getId, normalizeRows, initialData } from './data.js';

test('only verified allowlisted workspace admins are accepted', () => {
  assert.equal(isAdmin({ email: 'gbailly@alcaste-lasfuentes.com', email_verified: true }), true);
  assert.equal(isAdmin({ email: 'gbailly@alcaste-lasfuentes.com', email_verified: false }), false);
  assert.equal(isAdmin({ email: 'someone@example.com', email_verified: true }), false);
});

test('legacy rows keep their row id and receive one when absent', () => {
  assert.equal(getId({ '🔒 Row ID': 'legacy-id' }), 'legacy-id');
  const rows = normalizeRows([{ id: 'database-id', data: { Título: 'Test' } }]);
  assert.equal(rows[0]['🔒 Row ID'], 'database-id');
});

test('the current JSON export is accepted as the import shape', async () => {
  const imported = await initialData(fileURLToPath(new URL('../public/data', import.meta.url)));
  assert.ok(Array.isArray(imported.entries) && imported.entries.length > 0);
  assert.ok(Array.isArray(imported.authors) && imported.authors.length > 0);
  assert.ok(Array.isArray(imported.categories) && imported.categories.length > 0);
  assert.equal(typeof imported.site[0]['Título del sitio'], 'string');
});
