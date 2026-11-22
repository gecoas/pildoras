import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const TYPES = { entries: 'content_entries', authors: 'content_authors', categories: 'content_categories' };
const idKeys = ['🔒 Row ID', 'id'];
const getId = row => idKeys.map(key => row?.[key]).find(Boolean) || randomUUID();
const fileNames = { entries: 'Entradas.json', authors: 'Autores.json', categories: 'Categorías.json', site: 'Anyone.json' };

export async function initialData(root = path.resolve('public/data')) {
  const result = {};
  for (const [key, file] of Object.entries(fileNames)) result[key] = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
  return result;
}

export async function seedIfEmpty(client, root) {
  const data = await initialData(root);
  await client.query('BEGIN');
  try {
    for (const [type, table] of Object.entries(TYPES)) {
      const count = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
      if (!count.rows[0].count) {
        for (const row of data[type]) await client.query(`INSERT INTO ${table} (id, data) VALUES ($1, $2)`, [getId(row), row]);
      }
    }
    const site = await client.query('SELECT 1 FROM site_config WHERE id = 1');
    if (!site.rowCount) await client.query('INSERT INTO site_config (id, data) VALUES (1, $1)', [data.site[0] || {}]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export function normalizeRows(rows) { return rows.map(({ id, data }) => ({ ...data, '🔒 Row ID': data['🔒 Row ID'] || id })); }
export { getId };
