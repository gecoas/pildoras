import './style.css';
import staticEntries from '../public/data/Entradas.json';
import staticAuthors from '../public/data/Autores.json';
import staticCategories from '../public/data/Categorías.json';
import staticSiteRows from '../public/data/Anyone.json';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
async function responseError(response, fallback) { const raw = await response.text(); try { return JSON.parse(raw).error || fallback; } catch { if (response.status === 413) return 'El archivo o la petición supera el límite permitido'; return `${fallback} (HTTP ${response.status})`; } }
const fallback = { entries: staticEntries, authors: staticAuthors, categories: staticCategories, site: staticSiteRows[0] || {} };
const categoryIcons = { App: '▣', IA: '✦', Web: '⌁', Documento: '▤' };
const categoryClasses = { App: 'app', IA: 'ia', Web: 'web', Documento: 'documento' };
const typeLabels = { entries: 'Entradas', authors: 'Autores', categories: 'Categorías' };
let data = fallback;
let state = { view: 'home', query: '', category: 'Todas', author: '', page: 1, admin: false, user: null };

async function loadData() {
  try {
    const response = await fetch('/api/data');
    if (!response.ok) throw new Error();
    data = await response.json();
    if (state.admin) {
      const entries = await fetch('/api/admin/entries');
      if (entries.ok) data.entries = await entries.json();
    }
  } catch { data = fallback; }
}

function dateOf(value) {
  const text = String(value || '');
  const iso = Date.parse(text);
  if (!Number.isNaN(iso) && /\d{4}-\d{2}-\d{2}/.test(text)) return new Date(iso);
  const match = text.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  return match ? new Date(+match[3], +match[2] - 1, +match[1]) : new Date(0);
}

function dateInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function dateText(value, compact = false) {
  const date = dateOf(value);
  if (!date.getTime()) return '';
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: compact ? 'short' : 'long', year: 'numeric' }).format(date).replace('.', '').toUpperCase();
}

function categoryNames(entry) {
  return String(entry?.Categorías || '').split(',').map(id => data.categories.find(category => category['🔒 Row ID'] === id)?.Categoría).filter(Boolean);
}

function authorName(email) {
  const names = { 'gbailly@alcaste-lasfuentes.com': 'Gabriel Bailly-Bailliere', 'agaillard@alcaste-lasfuentes.com': 'Aude Gaillard', 'pepe@alcaste-lasfuentes.com': 'Pepe', 'sgascon@alcaste-lasfuentes.com': 'Sonia Gascón', 'dgutierrez@gecoas.com': 'David Gutiérrez' };
  return names[email] || String(email || 'Autor').split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function publishedEntries() { return data.entries.filter(entry => /publicad/i.test(entry.Estado || '')); }

function entryStatus(entry) { return /publicad/i.test(entry.Estado || '') ? 'published' : /programad/i.test(entry.Estado || '') ? 'scheduled' : 'draft'; }
function statusMark(entry) { return entryStatus(entry) === 'scheduled' ? '<span class="status-clock" title="Programada">◷</span>' : `<span class="status-dot ${entryStatus(entry)}" title="${esc(entry.Estado || 'borrador')}"></span>`; }

function filteredEntries() {
  const query = state.query.toLocaleLowerCase('es');
  return publishedEntries().filter(entry => {
    const categories = categoryNames(entry);
    const haystack = [entry.Título, entry.Texto, entry['Autor Email'], ...categories].join(' ').toLocaleLowerCase('es');
    return (state.category === 'Todas' || categories.includes(state.category)) && (!state.author || entry['Autor Email'] === state.author) && (!query || haystack.includes(query));
  }).sort((a, b) => dateOf(b['Fecha creación']) - dateOf(a['Fecha creación']));
}

function categoryPills(entry) { return categoryNames(entry).map(name => { const category = data.categories.find(item => item.Categoría === name); const logo = category?.Imagen || category?.Logo || category?.['Logo categoría']; return `<span class="modal-category"><span class="modal-category-logo">${logo ? `<img src="${esc(logo)}" alt="" onerror="this.style.display='none'">` : esc(categoryIcons[name] || '✦')}</span><strong>${esc(name)}</strong></span>`; }).join(''); }

function categoryArtwork(category) {
  const name = category.Categoría || 'Recurso';
  const kind = categoryClasses[name] || 'app';
  return `<div class="category-art ${kind}">${category.Imagen || category.Logo || category['Logo categoría'] ? `<img src="${esc(category.Imagen || category.Logo || category['Logo categoría'])}" alt="" onerror="this.style.display='none'">` : `<span>${categoryIcons[name] || '✦'}</span>`}</div>`;
}

function thumbnail(entry, large = false) {
  const names = categoryNames(entry);
  const kind = categoryClasses[names[0]] || 'app';
  return `<div class="thumb ${large ? 'thumb-large' : ''} ${kind}">${entry.Imagen ? `<img loading="lazy" src="${esc(entry.Imagen)}" alt="" onerror="this.style.display='none'">` : `<span>${categoryIcons[names[0]] || '✦'}</span>`}</div>`;
}

function card(entry) {
  return `<article class="resource-card" data-entry="${esc(entry['🔒 Row ID'])}">${thumbnail(entry, true)}<div class="card-content"><div class="date">${esc(dateText(entry['Fecha creación'], true))}</div><h3>${esc(entry.Título)}</h3><div class="card-categories">${categoryPills(entry)}</div><p>${esc(String(entry.Texto || '').replace(/\s+/g, ' ').slice(0, 135))}${String(entry.Texto || '').length > 135 ? '…' : ''}</p><div class="read-more">Leer entrada <span>›</span></div></div></article>`;
}

function listRow(entry) {
  return `<div class="entry-row" data-entry="${esc(entry['🔒 Row ID'])}">${thumbnail(entry)}<span class="row-copy"><span class="date">${esc(dateText(entry['Fecha creación'], true))}</span><strong>${esc(entry.Título)} ${statusMark(entry)}</strong><span class="row-meta">${esc(authorName(entry['Autor Email']))} · ${categoryNames(entry).map(esc).join(', ')}</span></span>${state.admin ? `<button class="row-action" data-entry-menu="${esc(entry['🔒 Row ID'])}" aria-label="Menú de entrada">···</button><div class="entry-menu" data-menu-for="${esc(entry['🔒 Row ID'])}"><button data-entry-action="edit" data-entry-id="${esc(entry['🔒 Row ID'])}">Editar entrada</button><button data-entry-action="schedule" data-entry-id="${esc(entry['🔒 Row ID'])}">Programar entrada</button><button data-entry-action="publish" data-entry-id="${esc(entry['🔒 Row ID'])}">Publicar entrada</button><button data-entry-action="preview-email" data-entry-id="${esc(entry['🔒 Row ID'])}">Enviar a Admin</button><button data-entry-action="delete" data-entry-id="${esc(entry['🔒 Row ID'])}">Borrar entrada</button></div>` : '<span class="chevron">›</span>'}</div>`;
}

function pagination(total, perPage = 12) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  state.page = Math.min(state.page, pages);
  if (pages === 1) return '';
  return `<div class="pagination"><button data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>Anterior</button>${Array.from({ length: pages }, (_, index) => `<button class="${state.page === index + 1 ? 'current' : ''}" data-page="${index + 1}">${index + 1}</button>`).join('')}<button data-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''}>Siguiente</button></div>`;
}

function categoryCollection() {
  return `<div class="category-grid">${data.categories.map(category => `<div class="category-tile" data-category-view="${esc(category.Categoría)}" role="button" tabindex="0">${categoryArtwork(category)}<strong>${esc(category.Categoría)}</strong><span>${publishedEntries().filter(entry => categoryNames(entry).includes(category.Categoría)).length} entradas</span>${state.admin ? `<div class="category-actions"><button data-edit-category="${esc(category['🔒 Row ID'])}">Editar</button><button data-delete-category="${esc(category['🔒 Row ID'])}">Eliminar</button></div>` : ''}</div>`).join('')}</div>`;
}

function headerCategories() {
  return `<div class="header-categories">${data.categories.map(category => `<button class="header-category" data-category-view="${esc(category.Categoría)}">${categoryArtwork(category)}<strong>${esc(category.Categoría)}</strong></button>`).join('')}</div>`;
}

function renderHome() {
  const rows = filteredEntries();
  const start = (state.page - 1) * 12;
  return `<section class="hero"><div class="hero-copy"><span class="overline">RECURSOS PARA PROFESORES</span><h1>Ideas que <em>inspiran</em><br>tu aula.</h1><p>${esc(data.site['Mensaje inicial'] || 'Descubre herramientas, ideas y recursos para transformar tus clases.')}</p><div class="hero-actions"><button class="subscribe" id="subscribe">${state.user?.subscribed ? '✓ Suscrito' : '♡ Suscribirme'}</button><div class="search-field"><span>⌕</span><input id="search" value="${esc(state.query)}" placeholder="${esc(data.site['Texto a buscar'] || 'Buscar')}"><kbd>⌘ K</kbd></div></div></div>${headerCategories()}</section><section class="section-block home-entries"><div class="section-heading"><div><span class="overline">LA BIBLIOTECA</span><h2>Entradas</h2><p class="muted">${rows.length} recursos para inspirarte</p></div><button class="text-link" data-view="entries">Ver lista <span>→</span></button></div><div class="card-grid">${rows.slice(start, start + 12).map(card).join('') || '<div class="empty">No encontramos recursos con esos filtros.</div>'}</div>${pagination(rows.length)}</section>`;
}

function renderEntries() {
  const rows = filteredEntries();
  const start = (state.page - 1) * 24;
  const pending = state.admin ? data.entries.filter(entry => entryStatus(entry) !== 'published').sort((a, b) => dateOf(b['Fecha creación']) - dateOf(a['Fecha creación'])) : [];
  const pendingSection = state.admin ? `<section class="pending-section"><div class="section-heading"><div><span class="overline">REVISIÓN</span><h2>Entradas pendientes</h2></div><span class="pending-count">${pending.length}</span></div><div class="entry-list">${pending.map(listRow).join('') || '<div class="empty">No hay borradores pendientes.</div>'}</div></section>` : '';
  return `${pendingSection}<section class="page-heading"><div><span class="overline">BIBLIOTECA DE RECURSOS</span><h1>Entradas publicadas</h1><p class="muted">Consulta y descubre todas las píldoras de innovación.</p></div><div class="page-actions"><button class="primary" id="admin-login">+ Añade Entrada</button>${state.admin ? '<button class="secondary" id="import-json">Importar JSON</button><input id="json-file" type="file" accept="application/json,.json" hidden>' : ''}</div></section><div class="toolbar"><div class="search-field compact"><span>⌕</span><input id="search" value="${esc(state.query)}" placeholder="Buscar"></div><div class="filter-pills"><button class="pill-button ${state.category === 'Todas' ? 'selected' : ''}" data-category="Todas">Todas</button>${data.categories.map(category => `<button class="pill-button ${state.category === category.Categoría ? 'selected' : ''}" data-category="${esc(category.Categoría)}">${esc(category.Categoría)}</button>`).join('')}</div></div><div class="entry-list">${rows.slice(start, start + 24).map(listRow).join('') || '<div class="empty">No encontramos entradas.</div>'}</div>${pagination(rows.length, 24)}`;
}

function renderCategories() {
  return `<section class="page-heading"><div><span class="overline">DESCUBRE NUEVOS TEMAS</span><h1>Categorías</h1><p class="muted">Encuentra recursos agrupados por temática.</p></div><button class="primary" id="add-category">+ Añadir</button></section><section class="category-page-grid">${categoryCollection()}</section>`;
}

function renderAuthors() {
  const authorEntries = state.author ? filteredEntries() : [];
  return `<section class="page-heading centered"><div><p class="help">Pulsa ⚙️ para filtrar las publicaciones del Autor</p><h1>Autores</h1></div><button class="primary" id="add-author">+ Añade Autor</button></section><div class="authors-grid">${data.authors.map(author => { const email = author['email Autor']; const name = author.Nombre || authorName(email); return `<article class="author-card"><div class="avatar">${esc(name.slice(0, 1))}</div><strong>${esc(name)}</strong><span>${esc(email)}</span><button class="author-filter ${state.author === email ? 'selected' : ''}" data-author="${esc(email)}">${state.author === email ? 'Publicaciones' : '⚙️'}</button>${state.admin ? `<button class="author-edit" data-edit-author="${esc(author['🔒 Row ID'] || '')}" aria-label="Editar autor">Editar</button><button class="author-delete" data-delete-author="${esc(author['🔒 Row ID'] || '')}" aria-label="Eliminar autor">Eliminar</button>` : ''}</article>`; }).join('')}</div>${state.author ? `<section class="author-results"><div class="section-heading"><div><span class="overline">PUBLICACIONES DE AUTOR</span><h2>${esc(authorName(state.author))}</h2></div><button class="text-link" data-clear-author>Limpiar filtro</button></div><div class="entry-list">${authorEntries.map(listRow).join('') || '<div class="empty">Este autor todavía no tiene publicaciones.</div>'}</div></section>` : ''}`;
}

function renderShell() {
  const siteTitle = data.site['Título del sitio'] || 'Píldoras de Innovación';
  const views = { home: renderHome, entries: renderEntries, categories: renderCategories, authors: renderAuthors };
  const adminNav = state.admin ? [['home', '⌂', 'Inicio'], ['entries', '♙', 'Entradas'], ['categories', '▣', 'Categorías'], ['authors', '✎', 'Autores']] : [['home', '⌂', 'Inicio'], ['authors', '✎', 'Autores']];
  const account = state.admin ? `<button class="user-chip" id="logout" title="Cerrar sesión"><span class="avatar mini">${esc(authorName(state.user?.email).slice(0, 1))}</span></button>` : '<div class="account-links"><button class="plain-link">Iniciar sesión</button></div>';
  $('#app').innerHTML = `<header class="topbar"><a href="#" class="brand" data-view="home"><span class="logo"><i></i><i></i><i></i></span><span>${esc(siteTitle)}</span></a><nav>${adminNav.map(([view, icon, label]) => `<button class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}"><span>${icon}</span>${label}</button>`).join('')}</nav>${account}</header><main>${views[state.view]()}</main><footer><span class="logo small"><i></i><i></i><i></i></span><span>${esc(siteTitle)}</span><span class="footer-note">Recursos que dejan huella.</span></footer>`;
  bindInteractions();
}

function bindInteractions() {
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = event => { event.preventDefault(); state.view = button.dataset.view; state.page = 1; renderShell(); });
  document.querySelectorAll('[data-category]').forEach(button => button.onclick = () => { state.category = button.dataset.category; state.view = state.view === 'categories' ? 'entries' : state.view; state.page = 1; renderShell(); });
  document.querySelectorAll('[data-category-view]').forEach(button => button.onclick = () => openCategory(button.dataset.categoryView));
  document.querySelectorAll('[data-edit-category]').forEach(button => button.onclick = event => { event.stopPropagation(); openCategoryForm(data.categories.find(category => category['🔒 Row ID'] === button.dataset.editCategory)); });
  document.querySelectorAll('[data-delete-category]').forEach(button => button.onclick = async event => { event.stopPropagation(); if (!confirm('¿Eliminar esta categoría?')) return; const response = await fetch(`/api/admin/categories/${encodeURIComponent(button.dataset.deleteCategory)}`, { method: 'DELETE' }); if (!response.ok) return; await loadData(); renderShell(); });
  document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => { if (!button.disabled) { state.page = Number(button.dataset.page); renderShell(); } });
  document.querySelectorAll('[data-entry]').forEach(button => button.onclick = () => openEntry(filteredEntries().find(entry => entry['🔒 Row ID'] === button.dataset.entry) || data.entries.find(entry => entry['🔒 Row ID'] === button.dataset.entry)));
  document.querySelectorAll('[data-entry-menu]').forEach(button => button.onclick = event => { event.stopPropagation(); button.closest('.entry-row').classList.toggle('menu-open'); });
  document.querySelectorAll('[data-entry-action]').forEach(button => button.onclick = async event => {
    event.stopPropagation();
    const entry = data.entries.find(item => item['🔒 Row ID'] === button.dataset.entryId);
    if (!entry) return;
    const action = button.dataset.entryAction;
    if (action === 'edit') openEntryForm(entry);
    if (action === 'schedule') openEntryForm({ ...entry, Estado: 'programada' });
    if (action === 'publish') { await updateEntryStatus(entry, 'publicada'); }
    if (action === 'preview-email') { button.disabled = true; const originalText = button.textContent; button.textContent = 'Enviando…'; try { const response = await fetch(`/api/admin/entries/${encodeURIComponent(entry['🔒 Row ID'])}/preview-email`, { method: 'POST' }); const raw = await response.text(); let result = {}; try { result = JSON.parse(raw); } catch { /* La respuesta puede venir del proxy. */ } if (!response.ok) window.alert(result.error || raw || `No se pudo enviar la vista previa (${response.status})`); else { let delivery = { status: 'queued' }; for (let attempt = 0; attempt < 20 && delivery.status === 'queued'; attempt += 1) { await new Promise(resolve => setTimeout(resolve, 1000)); const status = await fetch(`/api/admin/email-deliveries/${result.jobId}`); if (status.ok) delivery = await status.json(); } window.alert(delivery.status === 'sent' ? 'Vista previa enviada al administrador' : delivery.error ? `No se pudo enviar: ${delivery.error}` : 'El correo sigue pendiente de confirmación'); } } catch { window.alert('No se pudo conectar con el servidor de correo'); } finally { button.disabled = false; button.textContent = originalText; } }
    if (action === 'delete' && confirm('¿Borrar esta entrada?')) { await fetch(`/api/admin/entries/${encodeURIComponent(entry['🔒 Row ID'])}`, { method: 'DELETE' }); await loadData(); renderShell(); }
  });
  document.querySelectorAll('[data-author]').forEach(button => button.onclick = () => { state.author = button.dataset.author; state.view = 'authors'; state.page = 1; renderShell(); });
  document.querySelectorAll('[data-edit-author]').forEach(button => button.onclick = event => { event.stopPropagation(); openAuthorForm(data.authors.find(author => author['🔒 Row ID'] === button.dataset.editAuthor)); });
  document.querySelectorAll('[data-delete-author]').forEach(button => button.onclick = async event => { event.stopPropagation(); if (!confirm('¿Eliminar este autor?')) return; const response = await fetch(`/api/admin/authors/${encodeURIComponent(button.dataset.deleteAuthor)}`, { method: 'DELETE' }); if (!response.ok) return; await loadData(); renderShell(); });
  document.querySelector('[data-clear-author]')?.addEventListener('click', () => { state.author = ''; renderShell(); });
  const search = $('#search');
  if (search) { search.oninput = event => { state.query = event.target.value; state.page = 1; renderShell(); $('#search')?.focus(); $('#search')?.setSelectionRange(state.query.length, state.query.length); }; search.onkeydown = event => { if (event.key === 'Enter') { state.view = 'entries'; renderShell(); } }; }
  document.querySelectorAll('#admin-login').forEach(button => button.onclick = () => state.admin ? openEntryForm() : (window.location.href = '/api/auth/login?mode=login'));
  document.querySelector('.plain-link')?.addEventListener('click', () => { window.location.href = '/api/auth/login?mode=login'; });
  document.querySelector('#subscribe')?.addEventListener('click', async () => {
    if (!state.user) { window.location.href = '/api/auth/login?mode=register'; return; }
    const response = await fetch('/api/account/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscribed: !state.user.subscribed }) });
    if (!response.ok) return;
    state.user = (await response.json()).user;
    renderShell();
  });
  document.querySelector('#logout')?.addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); state.admin = false; state.user = null; renderShell(); });
  document.querySelector('#add-category')?.addEventListener('click', () => state.admin ? openCategoryForm() : (window.location.href = '/api/auth/login'));
  document.querySelector('#add-author')?.addEventListener('click', () => state.admin ? openAuthorForm() : (window.location.href = '/api/auth/login'));
  document.querySelector('#import-json')?.addEventListener('click', () => $('#json-file').click());
  document.querySelector('#json-file')?.addEventListener('change', async event => { const file = event.target.files?.[0]; if (!file) return; try { const response = await fetch('/api/admin/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await file.text() }); if (!response.ok) throw new Error(await responseError(response, 'No se pudo importar el JSON')); await loadData(); renderShell(); } catch (error) { window.alert(error.message); } finally { event.target.value = ''; } });
}

function openCategory(name) {
  const entries = publishedEntries().filter(entry => categoryNames(entry).includes(name)).sort((a, b) => dateOf(b['Fecha creación']) - dateOf(a['Fecha creación']));
  const category = data.categories.find(item => item.Categoría === name) || { Categoría: name };
  const modal = document.createElement('div');
  modal.className = 'modal category-modal';
  modal.innerHTML = `<div class="modal-box category-box"><button class="close">×</button><div class="category-detail"><button class="back-link">‹ Inicio / ${esc(name)}</button>${categoryArtwork(category)}<h2>${esc(name)}</h2><p>nº de entradas: ${entries.length}</p></div><div class="category-entry-list">${entries.map(listRow).join('') || '<div class="empty">No hay entradas en esta categoría.</div>'}</div></div>`;
  document.body.append(modal);
  modal.onclick = event => { if (event.target === modal || event.target.closest('.close,.back-link')) modal.remove(); };
  modal.querySelectorAll('[data-entry]').forEach(button => button.onclick = () => { modal.remove(); openEntry(entries.find(entry => entry['🔒 Row ID'] === button.dataset.entry)); });
}

function openEntry(entry) {
  if (!entry) return;
  const related = publishedEntries().filter(item => item['🔒 Row ID'] !== entry['🔒 Row ID'] && categoryNames(item).some(name => categoryNames(entry).includes(name))).slice(0, 4);
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<div class="modal-box"><button class="close">×</button><div class="modal-inner"><div class="date">${esc(dateText(entry['Fecha creación']))}</div><h2>${esc(entry.Título)}</h2><p class="modal-author">${esc(authorName(entry['Autor Email']))} · <span>⏱ Tiempo estimado de lectura: ${esc(entry['Tiempo de lectura'] || '3')} minutos</span></p><div class="modal-actions"><button data-entry-author>♙ Autores</button><button data-entry-share>↗ Comparte</button><span data-entry-visits>Última visita · ${esc(entry['Última visita new'] || 'Aún no')} · ${esc(entry['nº visitas'] || '0')} visitas</span></div><div class="modal-pills">${categoryPills(entry)}</div>${entry.Imagen ? `<img class="modal-image" src="${esc(entry.Imagen)}" alt="Imagen de ${esc(entry.Título)}" loading="lazy">` : ''}<div class="modal-text">${esc(entry.Texto || '').replace(/\n/g, '<br>')}</div>${entry.Enlace ? `<a class="modal-link" href="${esc(entry.Enlace)}" target="_blank" rel="noopener">Enlace ↗</a>` : ''}${entry.Archivo ? `<a class="modal-link" href="${esc(entry.Archivo)}" target="_blank" rel="noopener">Archivo ↗</a>` : ''}</div>${related.length ? `<div class="related"><div class="overline">ARTÍCULOS RELACIONADOS</div><div class="related-grid">${related.map(card).join('')}</div></div>` : ''}</div>`;
  document.body.append(modal);
  modal.onclick = event => { if (event.target === modal || event.target.closest('.close')) modal.remove(); };
  modal.querySelector('[data-entry-author]').onclick = () => { modal.remove(); state.view = 'authors'; state.author = entry['Autor Email']; state.page = 1; renderShell(); };
  modal.querySelector('[data-entry-share]').onclick = async event => { const url = `${window.location.origin}/?entry=${encodeURIComponent(entry['🔒 Row ID'])}`; if (navigator.share) await navigator.share({ title: entry.Título, url }); else { await navigator.clipboard.writeText(url); event.currentTarget.textContent = '✓ Enlace copiado'; } };
  fetch(`/api/entries/${encodeURIComponent(entry['🔒 Row ID'])}/visit`, { method: 'POST' }).then(response => response.ok ? response.json() : null).then(visited => { if (!visited) return; entry['nº visitas'] = visited['nº visitas']; entry['Última visita new'] = visited['Última visita new']; const target = modal.querySelector('[data-entry-visits]'); if (target) target.textContent = `Última visita · ${visited['Última visita new']} · ${visited['nº visitas']} visitas`; }).catch(() => {});
  modal.querySelectorAll('[data-entry]').forEach(button => button.onclick = () => { modal.remove(); openEntry(related.find(item => item['🔒 Row ID'] === button.dataset.entry)); });
}

async function updateEntryStatus(entry, status) {
  const response = await fetch(`/api/admin/entries/${encodeURIComponent(entry['🔒 Row ID'])}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...entry, Estado: status }) });
  if (response.ok) { await loadData(); renderShell(); }
}

function formModal(title, body, onSubmit) {
  const modal = document.createElement('div');
  modal.className = 'modal form-modal';
  modal.innerHTML = `<div class="modal-box form-box"><button class="close" type="button">×</button><form class="modal-form"><h2>${esc(title)}</h2>${body}<div class="form-footer"><button class="primary" type="submit">Enviar</button><button class="secondary" type="button" data-cancel>Cancelar</button></div></form></div>`;
  document.body.append(modal);
  modal.onclick = event => { if (event.target === modal || event.target.closest('.close,[data-cancel]')) modal.remove(); };
  modal.querySelector('form').onsubmit = async event => { event.preventDefault(); const submit = modal.querySelector('[type="submit"]'); submit.disabled = true; try { await onSubmit(new FormData(event.currentTarget)); modal.remove(); await loadData(); renderShell(); } catch (error) { submit.disabled = false; const message = document.createElement('p'); message.className = 'form-error'; message.textContent = error.message; modal.querySelector('.form-footer').before(message); } };
  return modal;
}

function openEntryForm(entry = {}) {
  const editing = Boolean(entry['🔒 Row ID']);
  const selected = String(entry.Categorías || '').split(',').filter(Boolean);
  const body = `<p class="required">Categorías <span>Requerido</span></p><div class="category-choices">${data.categories.map(category => `<label class="choice"><input type="checkbox" name="category" value="${esc(category['🔒 Row ID'])}" ${selected.includes(category['🔒 Row ID']) ? 'checked' : ''}><span class="category-dot ${categoryClasses[category.Categoría] || 'app'}"></span>${esc(category.Categoría)}</label>`).join('')}</div><label>Título<input name="Título" required value="${esc(entry.Título)}"></label><label>Texto<textarea name="Texto" required>${esc(entry.Texto)}</textarea></label><label>Enlace<input name="Enlace" type="url" value="${esc(entry.Enlace)}"></label><label>Archivo<input name="ArchivoFile" type="file" accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,text/plain"><small class="file-name">${esc(entry.Archivo || 'Elige un archivo...')}</small></label><label>Imagen<input name="ImagenFile" type="file" accept="image/*"><small class="file-name">${esc(entry.Imagen || 'Elige una imagen...')}</small></label><label>Tiempo de lectura<input name="Tiempo de lectura" inputmode="numeric" value="${esc(entry['Tiempo de lectura'])}" placeholder="en minutos"></label><label>Fecha creación<input name="Fecha creación" value="${esc(entry['Fecha creación'] || new Date().toLocaleString('es-ES'))}"></label><label>Publicar en fecha<input name="Publicar en fecha" type="datetime-local" value="${esc(dateInputValue(entry['Publicar en fecha']))}"></label><label>Estado<select name="Estado"><option value="borrador" ${entry.Estado === 'borrador' || !entry.Estado ? 'selected' : ''}>Borrador</option><option value="programada" ${entry.Estado === 'programada' ? 'selected' : ''}>Programada</option><option value="publicada" ${/publicad/i.test(entry.Estado || '') ? 'selected' : ''}>Publicada</option></select></label>${editing ? '<button class="delete-link" type="button" data-delete-entry>Borrar entrada</button>' : ''}`;
  const modal = formModal(editing ? 'Editar Entrada' : 'Añade Entrada', body, async form => {
    const status = form.get('Estado') || 'borrador';
    const publishDate = form.get('Publicar en fecha');
    if (status === 'programada' && !publishDate) throw new Error('Indica la fecha y hora de publicación');
    const upload = async field => { const file = form.get(field); if (!(file instanceof File) || !file.size) return entry[field === 'ImagenFile' ? 'Imagen' : 'Archivo'] || ''; const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); const response = await fetch('/api/admin/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: encoded }) }); if (!response.ok) throw new Error(await responseError(response, 'No se pudo subir el archivo')); return (await response.json()).url; };
    const row = { ...entry, '🔒 Row ID': entry['🔒 Row ID'], 'Fecha creación': form.get('Fecha creación'), 'Publicar en fecha': publishDate ? new Date(publishDate).toISOString() : '', Título: form.get('Título'), 'Autor Email': editing ? entry['Autor Email'] : state.user.email, Texto: form.get('Texto'), Enlace: form.get('Enlace'), Imagen: await upload('ImagenFile'), Archivo: await upload('ArchivoFile'), 'Tiempo de lectura': form.get('Tiempo de lectura'), Categorías: form.getAll('category').join(','), Estado: status };
    const response = await fetch(`/api/admin/entries${editing ? `/${encodeURIComponent(entry['🔒 Row ID'])}` : ''}`, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
    if (!response.ok) throw new Error(await responseError(response, 'No se pudo guardar la entrada'));
  });
  modal.querySelector('[data-delete-entry]')?.addEventListener('click', async () => { if (!confirm('¿Borrar esta entrada?')) return; const response = await fetch(`/api/admin/entries/${encodeURIComponent(entry['🔒 Row ID'])}`, { method: 'DELETE' }); if (!response.ok) return; modal.remove(); await loadData(); renderShell(); });
  return modal;
}

function openCategoryForm(category = {}) {
  const editing = Boolean(category['🔒 Row ID']);
  const body = `<label>Categoría<input name="Categoría" required value="${esc(category.Categoría)}"></label><label>Logo categoría<input name="Logo categoría" type="url" value="${esc(category['Logo categoría'] || category.Imagen || category.Logo)}" placeholder="https://..."></label>${editing ? '<button class="delete-link" type="button" data-delete-category-form>Eliminar categoría</button>' : ''}`;
  const modal = formModal(editing ? 'Editar elemento' : 'Añadir elemento', body, async form => {
    const row = { ...category, Categoría: form.get('Categoría'), 'Logo categoría': form.get('Logo categoría') };
    const response = await fetch(`/api/admin/categories${editing ? `/${encodeURIComponent(category['🔒 Row ID'])}` : ''}`, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
    if (!response.ok) throw new Error(await responseError(response, 'No se pudo guardar la categoría'));
  });
  modal.querySelector('[data-delete-category-form]')?.addEventListener('click', async () => { if (!confirm('¿Eliminar esta categoría?')) return; const response = await fetch(`/api/admin/categories/${encodeURIComponent(category['🔒 Row ID'])}`, { method: 'DELETE' }); if (!response.ok) return; modal.remove(); await loadData(); renderShell(); });
  return modal;
}

function openAuthorForm(author = {}) {
  const editing = Boolean(author['🔒 Row ID']);
  const body = `<label>Nombre del autor<input name="Nombre" required value="${esc(author.Nombre)}" placeholder="Nombre y apellidos"></label><label>Email del autor<input name="email Autor" type="email" required value="${esc(author['email Autor'])}" placeholder="correo@dominio.com"></label><label class="choice"><input name="Filtra autor" type="checkbox" ${String(author['Filtra autor']).toLowerCase() === 'true' ? 'checked' : ''}>Mostrar como filtro</label>${editing ? '<button class="delete-link" type="button" data-delete-author-form>Eliminar autor</button>' : ''}`;
  const modal = formModal(editing ? 'Editar Autor' : 'Añadir Autor', body, async form => {
    const row = { ...author, Nombre: form.get('Nombre'), 'email Autor': form.get('email Autor'), 'Filtra autor': form.get('Filtra autor') ? 'true' : 'false' };
    const response = await fetch(`/api/admin/authors${editing ? `/${encodeURIComponent(author['🔒 Row ID'])}` : ''}`, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
    if (!response.ok) throw new Error(await responseError(response, 'No se pudo guardar el autor'));
  });
  modal.querySelector('[data-delete-author-form]')?.addEventListener('click', async () => { if (!confirm('¿Eliminar este autor?')) return; const response = await fetch(`/api/admin/authors/${encodeURIComponent(author['🔒 Row ID'])}`, { method: 'DELETE' }); if (!response.ok) return; modal.remove(); await loadData(); renderShell(); });
  return modal;
}

async function renderAdmin() {
  const me = await fetch('/api/auth/me').then(response => response.json()).catch(() => ({}));
  if (!me.user) return;
  const panel = document.createElement('section');
  panel.className = 'admin-panel';
  panel.innerHTML = `<div class="admin-head"><div><span class="overline">ADMINISTRACIÓN</span><h2>Contenido</h2><p>Sesión: ${esc(me.user.email)}</p></div><button id="logout">Cerrar sesión</button></div><div class="admin-toolbar"><select id="entity">${Object.entries(typeLabels).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select><button id="new-record">Nueva</button><button id="duplicate-record">Duplicar</button><button id="import-json">Importar JSON</button><input id="json-file" type="file" accept="application/json,.json" hidden></div><div id="admin-list"></div><textarea id="record-editor" class="record-editor" spellcheck="false" placeholder="Selecciona un registro o crea uno nuevo"></textarea><div class="admin-actions"><button id="save-record">Guardar</button><button id="delete-record" class="danger">Borrar</button><span id="admin-status"></span></div>`;
  $('main').append(panel);
  let selected = null;
  const entity = $('#entity'), list = $('#admin-list'), editor = $('#record-editor');
  const refresh = () => { const rows = data[entity.value] || []; list.innerHTML = rows.map((row, index) => `<button class="admin-row" data-index="${index}">${esc(row.Título || row.Categoría || row['email Autor'] || row['🔒 Row ID'] || 'Sin título')}</button>`).join('') || '<p>No hay registros.</p>'; document.querySelectorAll('.admin-row').forEach(row => row.onclick = () => { selected = Number(row.dataset.index); editor.value = JSON.stringify(data[entity.value][selected], null, 2); }); };
  entity.onchange = () => { selected = null; editor.value = ''; refresh(); }; refresh();
  $('#new-record').onclick = () => { selected = null; editor.value = JSON.stringify({}, null, 2); };
  $('#duplicate-record').onclick = async () => { if (selected === null) return; const row = data[entity.value][selected]; const response = await fetch(`/api/admin/${entity.value}/${encodeURIComponent(row['🔒 Row ID'])}/duplicate`, { method: 'POST' }); if (!response.ok) { $('#admin-status').textContent = 'No se pudo duplicar'; return; } await loadData(); renderShell(); state.admin = true; };
  $('#save-record').onclick = async () => { try { const row = JSON.parse(editor.value); const type = entity.value; const id = row['🔒 Row ID']; const response = await fetch(`/api/admin/${type}${selected === null ? '' : `/${encodeURIComponent(id)}`}`, { method: selected === null ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) }); if (!response.ok) throw new Error((await response.json()).error); await loadData(); renderShell(); state.admin = true; } catch (error) { $('#admin-status').textContent = error.message; } };
  $('#delete-record').onclick = async () => { if (selected === null || !confirm('¿Borrar este registro?')) return; const row = data[entity.value][selected]; await fetch(`/api/admin/${entity.value}/${encodeURIComponent(row['🔒 Row ID'])}`, { method: 'DELETE' }); await loadData(); renderShell(); state.admin = true; };
  $('#import-json').onclick = () => $('#json-file').click();
  $('#json-file').onchange = async event => { const file = event.target.files?.[0]; if (!file) return; try { const payload = JSON.parse(await file.text()); const response = await fetch('/api/admin/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error((await response.json()).error || 'No se pudo importar el JSON'); await loadData(); renderShell(); state.admin = true; } catch (error) { $('#admin-status').textContent = error.message; } finally { event.target.value = ''; } };
  $('#logout').onclick = async () => { await fetch('/api/auth/logout', { method: 'POST' }); state.admin = false; renderShell(); };
}

async function loadAuth() { const response = await fetch('/api/auth/me').catch(() => null); if (!response?.ok) return; const result = await response.json(); state.user = result.user || null; state.admin = result.user?.role === 'admin'; }
loadAuth().then(async () => { await loadData(); renderShell(); const sharedEntry = new URLSearchParams(window.location.search).get('entry'); if (sharedEntry) openEntry(data.entries.find(entry => entry['🔒 Row ID'] === sharedEntry)); if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); });
