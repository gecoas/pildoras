import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import helmet from 'helmet';
import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'node:crypto';
import { TYPES, getId, normalizeRows } from './data.js';

const PgStore = pgSession(session);
const jsonLimit = '2mb';
const asList = value => String(value || '').split(',').map(x => x.trim()).filter(Boolean);
const allowedDomains = () => asList(process.env.GOOGLE_ALLOWED_DOMAINS || 'alcaste-lasfuentes.com,gecoas.com');
const adminEmails = () => asList(process.env.ADMIN_EMAILS || 'gbailly@alcaste-lasfuentes.com').map(x => x.toLowerCase());
const publicTableQuery = (table, type) => type === 'entries'
  ? `SELECT id, data FROM ${table} WHERE LOWER(COALESCE(data->>'Estado', '')) LIKE '%publicad%' ORDER BY updated_at DESC`
  : `SELECT id, data FROM ${table} ORDER BY updated_at DESC`;

export function isAdmin(profile) {
  const email = String(profile?.email || '').toLowerCase();
  return Boolean(profile?.email_verified && adminEmails().includes(email) && allowedDomains().some(domain => email.endsWith(`@${domain}`)));
}

export function createApp({ pool, oauthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_CALLBACK_URL || '/api/auth/callback') } = {}) {
  if (!pool) throw new Error('A PostgreSQL pool is required');
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be set in production');
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: jsonLimit }));
  app.use(session({
    store: new PgStore({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'development-only-change-me',
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 12 }
  }));

  const publicData = async (req, res) => {
    const out = {};
    for (const [type, table] of Object.entries(TYPES)) out[type] = normalizeRows((await pool.query(publicTableQuery(table, type))).rows);
    out.site = (await pool.query('SELECT data FROM site_config WHERE id = 1')).rows[0]?.data || {};
    res.json(out);
  };
  app.get('/api/data', publicData);
  for (const type of Object.keys(TYPES)) app.get(`/api/${type}`, async (req, res, next) => { try { res.json(normalizeRows((await pool.query(publicTableQuery(TYPES[type], type))).rows)); } catch (e) { next(e); } });
  app.get('/api/auth/login', (req, res, next) => { const state = randomUUID(); req.session.oauthState = state; req.session.save(error => { if (error) return next(error); res.redirect(oauthClient.generateAuthUrl({ access_type: 'offline', scope: ['openid', 'email', 'profile'], prompt: 'select_account', state })); }); });
  app.get('/api/auth/callback', async (req, res, next) => { try {
    if (!req.query.state || req.query.state !== req.session.oauthState) return res.status(400).send('Estado OAuth inválido');
    delete req.session.oauthState;
    const { tokens } = await oauthClient.getToken(String(req.query.code || ''));
    const ticket = await oauthClient.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const profile = ticket.getPayload();
    if (!isAdmin(profile)) return res.status(403).send('Cuenta no autorizada');
    req.session.user = { email: profile.email, name: profile.name, picture: profile.picture };
    res.redirect('/?admin=1');
  } catch (e) { next(e); } });
  app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.status(204).end()));
  app.get('/api/auth/me', (req, res) => res.json({ user: req.session.user || null }));
  const requireAdmin = (req, res, next) => req.session.user && isAdmin({ ...req.session.user, email_verified: true }) ? next() : res.status(401).json({ error: 'Autenticación de administrador requerida' });
  const validType = (req, res, next) => TYPES[req.params.type] ? next() : res.status(404).json({ error: 'Entidad desconocida' });

  app.use('/api/admin', requireAdmin);
  app.get('/api/admin/:type', validType, async (req, res, next) => { try { res.json(normalizeRows((await pool.query(`SELECT id, data FROM ${TYPES[req.params.type]} ORDER BY updated_at DESC`)).rows)); } catch (e) { next(e); } });
  app.post('/api/admin/:type', validType, async (req, res, next) => { try { const id = getId(req.body); const row = { ...req.body, '🔒 Row ID': req.body['🔒 Row ID'] || id }; await pool.query(`INSERT INTO ${TYPES[req.params.type]} (id, data) VALUES ($1, $2)`, [id, row]); res.status(201).json(row); } catch (e) { next(e); } });
  app.put('/api/admin/:type/:id', validType, async (req, res, next) => { try { const row = { ...req.body, '🔒 Row ID': req.body['🔒 Row ID'] || req.params.id }; const result = await pool.query(`UPDATE ${TYPES[req.params.type]} SET data = $1, updated_at = now() WHERE id = $2 RETURNING id, data`, [row, req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'No encontrado' }); res.json(normalizeRows(result.rows)[0]); } catch (e) { next(e); } });
  app.delete('/api/admin/:type/:id', validType, async (req, res, next) => { try { const result = await pool.query(`DELETE FROM ${TYPES[req.params.type]} WHERE id = $1`, [req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'No encontrado' }); res.status(204).end(); } catch (e) { next(e); } });
  app.post('/api/admin/:type/:id/duplicate', validType, async (req, res, next) => { try { const old = await pool.query(`SELECT data FROM ${TYPES[req.params.type]} WHERE id = $1`, [req.params.id]); if (!old.rowCount) return res.status(404).json({ error: 'No encontrado' }); const id = randomUUID(); const row = { ...old.rows[0].data, '🔒 Row ID': id, Título: old.rows[0].data.Título ? `${old.rows[0].data.Título} (copia)` : undefined }; await pool.query(`INSERT INTO ${TYPES[req.params.type]} (id, data) VALUES ($1, $2)`, [id, row]); res.status(201).json(row); } catch (e) { next(e); } });
  app.post('/api/admin/import', async (req, res, next) => { const client = await pool.connect(); try { const input = req.body; if (!input || typeof input !== 'object') return res.status(400).json({ error: 'JSON inválido' }); await client.query('BEGIN'); for (const [type, table] of Object.entries(TYPES)) if (input[type]) { if (!Array.isArray(input[type])) throw new Error(`${type} debe ser un array`); await client.query(`DELETE FROM ${table}`); for (const item of input[type]) { const id = getId(item); await client.query(`INSERT INTO ${table} (id, data) VALUES ($1, $2)`, [id, { ...item, '🔒 Row ID': item['🔒 Row ID'] || id }]); } } if (input.site) await client.query('INSERT INTO site_config (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [Array.isArray(input.site) ? input.site[0] || {} : input.site]); await client.query('COMMIT'); res.json({ imported: true }); } catch (e) { await client.query('ROLLBACK'); res.status(400).json({ error: e.message }); } finally { client.release(); } });
  app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Error interno' }); });
  return app;
}
