import fs from 'node:fs/promises';
import pg from 'pg';

const { Pool } = pg;

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

const headers = ['Name', 'Email', 'Photo', 'Role', 'Suscribirme'];
const csv = await fs.readFile('/app/Users.csv', 'utf8');
const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
if (rows.length < 2 || rows[0].join(',') !== headers.join(',')) throw new Error('Cabecera CSV de usuarios no válida');
const users = rows.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] || '']))).filter(user => user.Email);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const marker = await client.query("INSERT INTO data_migrations (name) VALUES ('users-csv-2026-11') ON CONFLICT (name) DO NOTHING RETURNING name");
  if (marker.rowCount) {
    for (const user of users) await client.query(`INSERT INTO users (email, name, photo, role, subscribed) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, photo = EXCLUDED.photo, role = EXCLUDED.role, updated_at = now()`, [user.Email.toLowerCase(), user.Name, user.Photo, user.Role || 'user', user.Suscribirme.toLowerCase() === 'true']);
  }
  await client.query('COMMIT');
  console.log(marker.rowCount ? `Importados ${users.length} usuarios desde Users.csv` : 'CSV de usuarios ya importado');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
