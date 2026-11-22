import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import fs from 'node:fs/promises';
import { createApp } from './app.js';
import { seedIfEmpty } from './data.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://pildoras:pildoras@localhost:5432/pildoras' });
const root = path.dirname(fileURLToPath(import.meta.url));
const schema = await fs.readFile(path.join(root, 'schema.sql'), 'utf8');
await pool.query(schema);
await seedIfEmpty(pool, path.resolve(root, '../public/data'));
const port = Number(process.env.PORT || 3000);
createApp({ pool }).listen(port, () => console.log(`Pildoras API listening on ${port}`));
