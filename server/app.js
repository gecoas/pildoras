import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import helmet from 'helmet';
import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { TYPES, getId, normalizeRows } from './data.js';

const PgStore = pgSession(session);
const jsonLimit = '12mb';
const uploadRoot = '/app/uploads';
const asList = value => String(value || '').split(',').map(x => x.trim()).filter(Boolean);
const allowedDomains = () => asList(process.env.GOOGLE_ALLOWED_DOMAINS || 'alcaste-lasfuentes.com,gecoas.com');
const adminEmails = () => asList(process.env.ADMIN_EMAILS || 'gbailly@alcaste-lasfuentes.com').map(x => x.toLowerCase());
const publicTableQuery = (table, type) => type === 'entries'
  ? `SELECT id, data FROM ${table} WHERE LOWER(COALESCE(data->>'Estado', '')) LIKE '%publicad%' ORDER BY updated_at DESC`
  : `SELECT id, data FROM ${table} ORDER BY updated_at DESC`;
const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const textHtml = value => htmlEscape(value).replace(/\r?\n/g, '<br>');

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
  app.use('/uploads', express.static(uploadRoot));
  app.use(session({
    store: new PgStore({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'development-only-change-me',
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 12 }
  }));
  const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined }) : null;
  const notifyPublication = async (entry, entryId, options = {}) => {
    if (!mailer) { console.warn('SMTP no configurado; no se enviará la publicación', entry.Título); return; }
    const preview = options.preview === true;
    const marker = preview ? null : await pool.query('INSERT INTO publication_notifications (entry_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING entry_id', [entryId]);
    if (marker && !marker.rowCount) return;
    try {
      const recipients = options.recipients || (await pool.query('SELECT email FROM users WHERE subscribed = true ORDER BY email')).rows.map(row => row.email);
      if (!recipients.length) return;
      const appUrl = process.env.PUBLIC_APP_URL || 'https://pildoras.gecoas.es';
      const link = `${appUrl}/?entry=${encodeURIComponent(entryId)}`;
      const imageUrl = entry.Imagen ? (String(entry.Imagen).startsWith('http') ? entry.Imagen : `${appUrl}${entry.Imagen.startsWith('/') ? '' : '/'}${entry.Imagen}`) : '';
      const image = imageUrl ? `<img src="${htmlEscape(imageUrl)}" alt="" style="display:block;width:100%;max-height:520px;object-fit:contain;border-radius:12px;margin:24px 0;background:#f3f6f7;">` : '';
      const html = `<!doctype html><html><body style="margin:0;background:#eef2f4;font-family:Arial,Helvetica,sans-serif;color:#253746;"><div style="max-width:680px;margin:24px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 35px #183d4a18;"><div style="padding:28px 32px;background:#326f88;color:#fff;font-size:28px;font-weight:700;">💊 Píldoras de Innovación</div><main style="padding:34px 42px;"><p style="margin:0 0 12px;color:#326f88;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Nueva publicación</p><h1 style="margin:0 0 20px;font-size:34px;line-height:1.15;color:#263746;">${htmlEscape(entry.Título)}</h1>${image}<div style="font-size:17px;line-height:1.65;color:#43515a;">${textHtml(String(entry.Texto || '').slice(0, 900))}${String(entry.Texto || '').length > 900 ? '…' : ''}</div><p style="text-align:center;margin:32px 0;"><a href="${htmlEscape(link)}" style="display:inline-block;padding:15px 28px;border-radius:9px;background:#326f88;color:#fff;text-decoration:none;font-weight:700;font-size:17px;">Ver entrada</a></p><hr style="border:0;border-top:1px solid #dce4e7;"><p style="margin:20px 0 0;text-align:right;color:#6e7c82;font-size:14px;">por <strong>${htmlEscape(entry['Autor Email'] || 'Píldoras de Innovación')}</strong><br>⏱ Tiempo estimado de lectura/visionado ${htmlEscape(entry['Tiempo de lectura'] || '3')} minutos</p></main></div></body></html>`;
      await mailer.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, bcc: recipients, subject: `${preview ? '[Vista previa] ' : 'Nueva publicación: '}${entry.Título}`, html, text: `Nueva publicación: ${entry.Título}\n\n${entry.Texto || ''}\n\nVer entrada: ${link}` });
    } catch (error) {
      if (!preview) await pool.query('DELETE FROM publication_notifications WHERE entry_id = $1', [entryId]);
      throw error;
    }
  };
  let publishingScheduled = false;
  const publishScheduled = async () => {
    if (publishingScheduled) return;
    publishingScheduled = true;
    try {
      const due = await pool.query("SELECT id, data FROM content_entries WHERE data->>'Estado' = 'programada'");
      for (const row of due.rows) {
        const timestamp = Date.parse(row.data['Publicar en fecha'] || '');
        if (Number.isNaN(timestamp) || timestamp > Date.now()) continue;
        const result = await pool.query(`UPDATE content_entries SET data = jsonb_set(data, '{Estado}', '"publicada"'::jsonb), updated_at = now()
          WHERE id = $1 AND data->>'Estado' = 'programada' RETURNING id, data`, [row.id]);
        if (result.rowCount) await notifyPublication(result.rows[0].data, result.rows[0].id);
      }
    } finally { publishingScheduled = false; }
  };
  publishScheduled().catch(error => console.error('No se pudieron publicar las entradas programadas', error));
  setInterval(() => publishScheduled().catch(error => console.error('No se pudieron publicar las entradas programadas', error)), 10000);

  const publicData = async (req, res) => {
    const out = {};
    for (const [type, table] of Object.entries(TYPES)) out[type] = normalizeRows((await pool.query(publicTableQuery(table, type))).rows);
    out.site = (await pool.query('SELECT data FROM site_config WHERE id = 1')).rows[0]?.data || {};
    res.json(out);
  };
  app.get('/api/data', publicData);
  for (const type of Object.keys(TYPES)) app.get(`/api/${type}`, async (req, res, next) => { try { res.json(normalizeRows((await pool.query(publicTableQuery(TYPES[type], type))).rows)); } catch (e) { next(e); } });
  app.post('/api/entries/:id/visit', async (req, res, next) => { try { const result = await pool.query(`UPDATE content_entries SET data = jsonb_set(jsonb_set(data, '{nº visitas}', to_jsonb(COALESCE(NULLIF(data->>'nº visitas', '')::int, 0) + 1)), '{Última visita new}', to_jsonb(to_char(now() AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY, HH24:MI:SS'))), updated_at = now() WHERE id = $1 AND LOWER(COALESCE(data->>'Estado', '')) LIKE '%publicad%' RETURNING id, data`, [req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'Entrada no encontrada' }); res.json(normalizeRows(result.rows)[0]); } catch (e) { next(e); } });
  app.get('/api/auth/login', (req, res, next) => { const state = randomUUID(); req.session.oauthState = state; req.session.authMode = req.query.mode === 'register' ? 'register' : 'login'; req.session.save(error => { if (error) return next(error); res.redirect(oauthClient.generateAuthUrl({ access_type: 'offline', scope: ['openid', 'email', 'profile'], prompt: 'select_account', state })); }); });
  app.get('/api/auth/callback', async (req, res, next) => { try {
    if (!req.query.state || req.query.state !== req.session.oauthState) return res.status(400).send('Estado OAuth inválido');
    delete req.session.oauthState;
    const { tokens } = await oauthClient.getToken(String(req.query.code || ''));
    const ticket = await oauthClient.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const profile = ticket.getPayload();
    const email = String(profile.email || '').toLowerCase();
    const existing = await pool.query('SELECT email, name, photo, role, subscribed FROM users WHERE email = $1', [email]);
    const admin = isAdmin(profile);
    if (!existing.rowCount && req.session.authMode !== 'register' && !admin) return res.status(403).send('Usuario no registrado');
    const user = existing.rows[0] || (await pool.query('INSERT INTO users (email, name, photo, role) VALUES ($1, $2, $3, $4) RETURNING email, name, photo, role, subscribed', [email, profile.name || '', profile.picture || '', admin ? 'admin' : 'user'])).rows[0];
    if (admin && user.role !== 'admin') {
      user.role = 'admin';
      await pool.query('UPDATE users SET role = $1, updated_at = now() WHERE email = $2', ['admin', email]);
    }
    req.session.user = { email: user.email, name: user.name, picture: user.photo, role: user.role, subscribed: user.subscribed };
    delete req.session.authMode;
    res.redirect('/?admin=1');
  } catch (e) { next(e); } });
  app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.status(204).end()));
  app.get('/api/auth/me', (req, res) => res.json({ user: req.session.user || null }));
  app.post('/api/account/subscription', async (req, res, next) => {
    if (!req.session.user?.email) return res.status(401).json({ error: 'Inicia sesión para suscribirte' });
    try {
      const subscribed = Boolean(req.body?.subscribed);
      const result = await pool.query('UPDATE users SET subscribed = $1, updated_at = now() WHERE email = $2 RETURNING email, name, photo, role, subscribed', [subscribed, req.session.user.email]);
      if (!result.rowCount) return res.status(404).json({ error: 'Usuario no encontrado' });
      const user = result.rows[0];
      req.session.user = { email: user.email, name: user.name, picture: user.photo, role: user.role, subscribed: user.subscribed };
      res.json({ user: req.session.user });
    } catch (error) { next(error); }
  });
  const requireAdmin = (req, res, next) => req.session.user && isAdmin({ ...req.session.user, email_verified: true }) ? next() : res.status(401).json({ error: 'Autenticación de administrador requerida' });
  const validType = (req, res, next) => TYPES[req.params.type] ? next() : res.status(404).json({ error: 'Entidad desconocida' });

  app.use('/api/admin', requireAdmin);
  app.post('/api/admin/uploads', async (req, res, next) => {
    try {
      const match = String(req.body?.data || '').match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return res.status(400).json({ error: 'Archivo inválido' });
      const [, type, encoded] = match;
      if (!/^(image\/|application\/pdf$|application\/msword$|application\/vnd\.|text\/)/.test(type)) return res.status(415).json({ error: 'Tipo de archivo no permitido' });
      const content = Buffer.from(encoded, 'base64');
      if (content.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'El archivo supera los 10 MB' });
      const extensions = { 'application/pdf': 'pdf', 'application/msword': 'doc', 'text/plain': 'txt' };
      const extension = extensions[type] || type.split('/')[1].split('+')[0].replace(/[^a-z0-9]/gi, '') || 'bin';
      await fs.mkdir(uploadRoot, { recursive: true });
      const filename = `${randomUUID()}.${extension}`;
      await fs.writeFile(path.join(uploadRoot, filename), content);
      res.status(201).json({ url: `/uploads/${filename}` });
    } catch (error) { next(error); }
  });
  app.post('/api/admin/entries/:id/preview-email', async (req, res, next) => { try { if (!mailer) return res.status(503).json({ error: 'SMTP no está configurado' }); const result = await pool.query('SELECT id, data FROM content_entries WHERE id = $1', [req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'Entrada no encontrada' }); await notifyPublication(result.rows[0].data, result.rows[0].id, { preview: true, recipients: adminEmails() }); res.json({ sent: true }); } catch (e) { next(e); } });
  app.get('/api/admin/:type', validType, async (req, res, next) => { try { res.json(normalizeRows((await pool.query(`SELECT id, data FROM ${TYPES[req.params.type]} ORDER BY updated_at DESC`)).rows)); } catch (e) { next(e); } });
  app.post('/api/admin/:type', validType, async (req, res, next) => { try { const id = getId(req.body); const row = { ...req.body, '🔒 Row ID': req.body['🔒 Row ID'] || id }; await pool.query(`INSERT INTO ${TYPES[req.params.type]} (id, data) VALUES ($1, $2)`, [id, row]); if (req.params.type === 'entries' && /publicad/i.test(row.Estado || '')) await notifyPublication(row, id); res.status(201).json(row); } catch (e) { next(e); } });
  app.put('/api/admin/:type/:id', validType, async (req, res, next) => { try { const row = { ...req.body, '🔒 Row ID': req.body['🔒 Row ID'] || req.params.id }; const result = await pool.query(`UPDATE ${TYPES[req.params.type]} SET data = $1, updated_at = now() WHERE id = $2 RETURNING id, data`, [row, req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'No encontrado' }); if (req.params.type === 'entries' && /publicad/i.test(row.Estado || '')) await notifyPublication(row, req.params.id); res.json(normalizeRows(result.rows)[0]); } catch (e) { next(e); } });
  app.delete('/api/admin/:type/:id', validType, async (req, res, next) => { try { const result = await pool.query(`DELETE FROM ${TYPES[req.params.type]} WHERE id = $1`, [req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'No encontrado' }); res.status(204).end(); } catch (e) { next(e); } });
  app.post('/api/admin/:type/:id/duplicate', validType, async (req, res, next) => { try { const old = await pool.query(`SELECT data FROM ${TYPES[req.params.type]} WHERE id = $1`, [req.params.id]); if (!old.rowCount) return res.status(404).json({ error: 'No encontrado' }); const id = randomUUID(); const row = { ...old.rows[0].data, '🔒 Row ID': id, Título: old.rows[0].data.Título ? `${old.rows[0].data.Título} (copia)` : undefined }; await pool.query(`INSERT INTO ${TYPES[req.params.type]} (id, data) VALUES ($1, $2)`, [id, row]); res.status(201).json(row); } catch (e) { next(e); } });
  app.post('/api/admin/import', async (req, res, next) => { const client = await pool.connect(); try { const input = Array.isArray(req.body) ? { entries: req.body } : req.body; if (!input || typeof input !== 'object') return res.status(400).json({ error: 'JSON inválido' }); await client.query('BEGIN'); for (const [type, table] of Object.entries(TYPES)) if (input[type]) { if (!Array.isArray(input[type])) throw new Error(`${type} debe ser un array`); await client.query(`DELETE FROM ${table}`); for (const item of input[type]) { const id = getId(item); await client.query(`INSERT INTO ${table} (id, data) VALUES ($1, $2)`, [id, { ...item, '🔒 Row ID': item['🔒 Row ID'] || id }]); } } if (input.site) await client.query('INSERT INTO site_config (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [Array.isArray(input.site) ? input.site[0] || {} : input.site]); await client.query('COMMIT'); res.json({ imported: true, entries: input.entries?.length || 0, authors: input.authors?.length || 0, categories: input.categories?.length || 0 }); } catch (e) { await client.query('ROLLBACK'); res.status(400).json({ error: e.message }); } finally { client.release(); } });
  app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Error interno' }); });
  return app;
}
