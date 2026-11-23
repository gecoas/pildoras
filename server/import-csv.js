import fs from 'node:fs/promises';
import pg from 'pg';

const { Pool } = pg;
const headers = ['🔒 Row ID', 'Fecha creación', 'Título', 'Autor Email', 'Texto', 'Enlace', 'Imagen', 'Categorías', 'Estado', 'nº visitas', 'Última visita new', 'Quién la visita', 'Tiempo de lectura', 'Archivo', 'Publicar en fecha'];

function parseCsv(input) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(value); value = '';
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
    } else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}

const csv = await fs.readFile('/app/Entradas.csv', 'utf8');
const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
if (rows.length < 2 || rows[0].join(',') !== headers.join(',')) throw new Error('Cabecera CSV de entradas no válida');
const entries = rows.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const marker = await client.query("INSERT INTO data_migrations (name) VALUES ('entries-csv-2026-06') ON CONFLICT (name) DO NOTHING RETURNING name");
  if (!marker.rowCount) { await client.query('COMMIT'); console.log('CSV de entradas ya importado'); }
  else {
    await client.query('DELETE FROM content_entries');
    for (const entry of entries) await client.query('INSERT INTO content_entries (id, data) VALUES ($1, $2)', [entry['🔒 Row ID'], entry]);
    await client.query('COMMIT');
    console.log(`Importadas ${entries.length} entradas desde Entradas.csv`);
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
