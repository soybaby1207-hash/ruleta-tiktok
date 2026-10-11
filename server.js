process.on('uncaughtException', e => console.error('uncaught', e && e.message));
process.on('unhandledRejection', e => console.error('unhandled', e && e.message || e));

const express = require('express'), http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path'), os = require('os'), { WebSocketServer } = require('ws');

// ---- Datos de la persona: piratetok-live-js los entrega dentro de data.user ----
const urls = a => !a ? [] : [].concat(a.urlList || a.url_list || a.urls || (typeof a === 'string' ? [a] : []));
const bestPic = u => {
  if (!u) return '';
  const l = [u.avatarLarge, u.avatarMedium, u.avatarThumb, u.avatar_large, u.avatar_medium, u.avatar_thumb, u.profilePicture, u.profilePictureUrl].flatMap(urls).filter(Boolean);
  return l.find(x => /100x100/.test(x) && /\.(webp|jpe?g|png)/.test(x)) || l.find(x => /\.(webp|jpe?g|png)/.test(x) && !/heic/.test(x)) || l.find(x => !/heic/.test(x)) || l[0] || '';
};
const idOf = (U, d) => {
  for (const c of [U && U.idStr, U && U.id, U && U.userId, d && d.userId, U && U.uniqueId, d && d.uniqueId]) {
    const s = c == null ? '' : String(c);
    if (s && !/object/i.test(s)) return s;
  }
  return 't' + crypto.randomUUID();
};
const nameOf = (U, d) => (U && (U.nickname || U.uniqueId)) || (d && (d.nickname || d.uniqueId)) || 'Anónimo';
const dump = o => { try { return JSON.stringify(o, (k, v) => typeof v === 'bigint' ? v.toString() : v).slice(0, 2500); } catch (e) { return 'no se pudo serializar'; } };

const KEY = process.env.EULER_API_KEY || undefined, rnd = n => crypto.randomInt(n);
const COINS = { rose: 1, tiktok: 1, 'ice cream cone': 1, 'heart me': 1, 'finger heart': 5, perfume: 20, doughnut: 30, cap: 99, 'paper crane': 99, 'little crown': 99, 'hat and mustache': 99, confetti: 100, 'hand hearts': 100, sunglasses: 199, 'gold boxing gloves': 299, corgi: 299, 'money gun': 500, swan: 699, train: 899, galaxy: 1000, fireworks: 1088, 'whale diving': 2150, 'leon the kitten': 4888, 'drama queen': 5000, 'sports car': 7000, lion: 29999, 'tiktok universe': 44999 };
const NM = ['maria', 'carlos', 'lucia', 'juan', 'sofia', 'diego', 'ana', 'pablo', 'laura', 'javi', 'carmen', 'alex', 'paula', 'david', 'marta', 'sergio', 'elena', 'raul', 'nuria', 'ivan'], SF = ['_xx', '.oficial', '88', '_17', '_tv', '.mx', '_rd', '23', '_vip', '_09'];
const fake = () => ({ id: 't' + crypto.randomUUID(), name: NM[rnd(NM.length)] + SF[rnd(SF.length)], avatar: `https://randomuser.me/api/portraits/${rnd(2) ? 'women' : 'men'}/${rnd(99)}.jpg` });


// ===================== Cuentas de creador ("Nuestros mejores creadores") =====================
// Guardado en un archivo JSON junto al servidor. OJO: en Render (plan gratis), el disco se borra
// en cada nuevo despliegue (deploy), así que las cuentas sobreviven a reinicios normales pero no
// a cuando subes código nuevo. Para que sobrevivan a los deploys hace falta una base de datos externa.
// Sin contraseñas: entrar con el usuario basta (crea el perfil la primera vez, o entra en él si ya existe).
const CDATA_DIR = path.join(__dirname, 'data');
const CDATA_FILE = path.join(CDATA_DIR, 'creators.json');
fs.mkdirSync(CDATA_DIR, { recursive: true });
function loadCreators() {
  try { return JSON.parse(fs.readFileSync(CDATA_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveCreators(db) {
  try { fs.writeFileSync(CDATA_FILE, JSON.stringify(db, null, 2)); } catch (e) { console.error('No se pudo guardar creators.json', e.message); }
}
let creatorsDB = loadCreators();
const normUser = u => String(u || '').trim().replace(/^@/, '').toLowerCase().slice(0, 40);
const publicCreator = c => ({ username: c.username, displayName: c.displayName, bio: c.bio, tiktok: c.tiktok, avatar: c.avatar, featured: !!c.featured });

// sesiones en memoria: token -> username (se pierden si el servidor se reinicia; solo hay que volver a entrar)
const sessions = {};
function parseCookies(req) {
  const h = req.headers.cookie; const out = {};
  if (h) h.split(';').forEach(p => { const i = p.indexOf('='); if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function currentUser(req) {
  const tok = parseCookies(req).bt_session;
  return tok && sessions[tok] ? sessions[tok] : null;
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `bt_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
}

const app = express();
app.get('/', (q, r) => r.redirect('/ruleta.html'));
app.use(express.static('public'));
app.use(express.json({ limit: '100kb' }));



// Sin contraseña: si el usuario no existe se crea, si ya existe entras directamente en ese perfil.
app.post('/api/creators/enter', (q, res) => {
  const username = normUser(q.body && q.body.username);
  const displayName = String((q.body && q.body.displayName) || username).slice(0, 60);
  if (!/^[a-z0-9._]{2,24}$/.test(username)) return res.status(400).json({ error: 'Usuario de TikTok no válido' });
  if (!creatorsDB[username]) {
    creatorsDB[username] = { username, displayName, bio: '', tiktok: 'https://www.tiktok.com/@' + username, avatar: '', featured: false, createdAt: Date.now() };
    saveCreators(creatorsDB);
  }
  const token = crypto.randomBytes(24).toString('hex'); sessions[token] = username; setSessionCookie(res, token);
  res.json({ ok: true, creator: publicCreator(creatorsDB[username]) });
});

app.post('/api/creators/logout', (q, res) => {
  const tok = parseCookies(q).bt_session; if (tok) delete sessions[tok];
  res.setHeader('Set-Cookie', 'bt_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/creators/me', (q, res) => {
  const username = currentUser(q), c = username && creatorsDB[username];
  if (!c) return res.status(401).json({ error: 'No has iniciado sesión' });
  res.json({ ok: true, creator: publicCreator(c) });
});

app.post('/api/creators/me', (q, res) => {
  const username = currentUser(q), c = username && creatorsDB[username];
  if (!c) return res.status(401).json({ error: 'No has iniciado sesión' });
  const b = q.body || {};
  if (b.displayName !== undefined) c.displayName = String(b.displayName).slice(0, 60);
  if (b.bio !== undefined) c.bio = String(b.bio).slice(0, 240);
  if (b.tiktok !== undefined && /^https:\/\/(www\.)?tiktok\.com\/@[a-zA-Z0-9._]{2,24}$/.test(b.tiktok)) c.tiktok = b.tiktok;
  if (b.avatar !== undefined && (/^https?:\/\//.test(b.avatar) || b.avatar === '')) c.avatar = String(b.avatar).slice(0, 500);
  saveCreators(creatorsDB);
  res.json({ ok: true, creator: publicCreator(c) });
});

// pública: lista de creadores destacados ("Nuestros mejores creadores")
app.get('/api/creators/top', (q, res) => {
  const list = Object.values(creatorsDB).filter(c => c.featured).sort((a, b) => (a.featuredOrder || 0) - (b.featuredOrder || 0) || a.createdAt - b.createdAt);
  res.json({ ok: true, creators: list.map(publicCreator) });
});

// destacar o quitar a un creador de "Nuestros mejores creadores" (sin contraseña)
app.post('/api/creators/feature', (q, res) => {
  const b = q.body || {};
  const username = normUser(b.username), c = creatorsDB[username];
  if (!c) return res.status(404).json({ error: 'Ese usuario no está registrado' });
  c.featured = !!b.featured; if (b.featured) c.featuredOrder = Date.now();
  saveCreators(creatorsDB);
  res.json({ ok: true, creator: publicCreator(c) });
});

// ===================== Ganador preseleccionado (panel de administrador) =====================
// Afecta solo a la ronda en curso de un LIVE concreto; se identifica como tal al mostrarse el ganador.
app.post('/api/admin/set-winner', (q, res) => {
  const b = q.body || {};
  const creator = String(b.creator || '').replace(/^@/, '').trim().toLowerCase();
  const winner = String(b.winner || '').trim();
  if (!creator) return res.status(400).json({ error: 'Falta el usuario del LIVE (creador).' });
  const r = rooms[creator];
  if (!r) return res.status(404).json({ error: 'No hay ningún panel abierto para ese usuario. Abre su página primero.' });
  if (!r.conn || !r.conn.isConnected) return res.status(409).json({ error: 'Ese LIVE no está conectado ahora mismo.' });
  const result = r.cmd.setForceWinner(winner);
  if (!result.ok) return res.status(422).json({ error: result.error });
  res.json({ ok: true, winner: result.name });
});

app.post('/api/admin/clear-winner', (q, res) => {
  const creator = String((q.body && q.body.creator) || '').replace(/^@/, '').trim().toLowerCase();
  const r = rooms[creator];
  if (!r) return res.status(404).json({ error: 'No hay ningún panel abierto para ese usuario.' });
  r.cmd.clearForceWinner();
  res.json({ ok: true });
});

app.get('/api/admin/status', (q, res) => {
  const creator = String((q.query && q.query.creator) || '').replace(/^@/, '').trim().toLowerCase();
  const r = rooms[creator];
  if (!r) return res.json({ ok: true, live: false, forceWinner: null });
  res.json({ ok: true, live: !!(r.conn && r.conn.isConnected), forceWinner: r.cmd.getForceWinner() });
});

app.get('/debug', (q, res) => {
    const u = String(q.query.user || '').replace('@', '').trim().toLowerCase(), r = rooms[u];
    if (!r) return res.json({ error: 'No hay sala para ' + u + '. Abre la pagina, escribe el usuario y pulsa Conectar primero.', salas: Object.keys(rooms) });
    res.json({ usuario: u, conectadoATikTok: !!(r.conn && r.conn.isConnected), ultimoEstado: r.status, pantallasConectadas: r.clients.size, registroDeRegalos: r.log, ultimoRegaloCrudo: r.rawGift || null, ultimoChatCrudo: r.rawChat || null });
});

const UP = path.join(os.tmpdir(), 'ruleta-media');
fs.mkdirSync(UP, { recursive: true });
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };

app.use('/media', express.static(UP, { maxAge: '1h' }));
app.post('/upload', express.raw({ type: () => true, limit: '40mb' }), (q, res) => {
  const u = String(q.query.user || '').replace('@', '').trim().toLowerCase(), ct = String(q.headers['content-type'] || '').split(';')[0], ext = EXT[ct], r = rooms[u];
  if (!r) return res.status(403).json({ error: 'Conecta primero con tu usuario' });
  if (!ext) return res.status(415).json({ error: 'Formato no permitido (usa JPG, PNG, WEBP, GIF, MP4 o WEBM)' });
  if (!Buffer.isBuffer(q.body) || !q.body.length) return res.status(400).json({ error: 'Archivo vacío' });
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UP, name), q.body);
  if (r.media) fs.unlink(path.join(UP, r.media), () => {});
  r.media = name;
  res.json({ url: '/media/' + name, kind: (ext === 'mp4' || ext === 'webm') ? 'video' : 'img' });
});

app.use((err, q, res, next) => res.status(err.status || 500).json({ error: err.type === 'entity.too.large' ? 'Archivo demasiado grande (máx. 40 MB)' : 'Error al subir el archivo' }));
setInterval(() => fs.readdir(UP, (e, l) => (l || []).forEach(f => fs.stat(path.join(UP, f), (e2, st) => st && Date.now() - st.mtimeMs > 12 * 36e5 && fs.unlink(path.join(UP, f), () => {})))), 36e5);

const srv = http.createServer(app), wss = new WebSocketServer({ server: srv }), rooms = {};

function room(user) {
  if (rooms[user]) return rooms[user];
  const r = rooms[user] = { clients: new Set(), conn: null, dead: false, configured: false, methods: {}, log: [], status: '', pics: {}, msgs: {}, vm: {}, forceWinner: null };
  const g = { players: [], phase: 'open', joinEnd: 0, autoAt: 0, autoSec: 0, gifts: 0, coins: 0, entries: 0, mode: 'free', gift: 'Rose', up: false, sc: true, vouches: 0, sec: 60, au: 15, ini: 120, iniOn: true, started: false, tl: true, batch: 1, vs1sec: 25, im: '', bgt: 'none', bgc: '#101018', bgu: '', bgk: 'img', bgl: true, bgfit: 'cover', bgpos: 'center', cv: 0, gu: {}, was1v1: false };
  let joinT, autoT, busy = false, ackFn = null, ackT = null, seq = 0;
  const MAXC = 30, solo = () => g.players.length > 0 && new Set(g.players.map(p => p.o || p.id)).size === 1;
  const send = (event, data) => { if (event === 'status') r.status = data.msg; const m = JSON.stringify({ event, data }); r.clients.forEach(c => c.readyState === 1 && c.send(m)); };
  const state = () => { const { players, ...s } = g; send('state', { ...s, now: Date.now() }); }, plist = () => send('players', { players: g.players });
  const is1v1 = () => g.mode === 'lock' && g.players.length === 2;
  const win = () => {
    const p = g.players[0], uid = p.o || p.id; r.winner = uid;
    const last = (r.msgs[uid] || []).slice(-5);
    const bonus = last.filter(m => /vouch/i.test(m)).length; // vouches ya escritos antes de ganar, se suman al ganar
    if (bonus) g.vouches += bonus;
    const forced = !!(r.forceWinner && r.forceWinner.id === uid);
    send('win', { p, msgs: last, forced });
    r.forceWinner = null; // el ganador preseleccionado solo vale para esta ronda
  };
  const done = f => { clearTimeout(ackT); ackFn = () => { clearTimeout(ackT); ackFn = null; f(); }; ackT = setTimeout(() => ackFn && ackFn(), 8000); };
  const auto = s => {
    clearTimeout(autoT); s = +s || 0; g.autoSec = s; if (!s) { g.autoAt = 0; return state(); }
    const wait = is1v1() ? (g.vs1sec || 25) : s;
    g.autoAt = Date.now() + wait * 1000; g.autoSec = wait; state();
    autoT = setTimeout(() => { if (g.players.length > 1 && !solo() && !busy) { g.autoAt = 0; state(); spin(); } else auto(g.au || s); }, wait * 1000);
  };
  const open = s => {
    clearTimeout(joinT); auto(0); s = +s || 60; g.phase = 'joining'; g.joinEnd = Date.now() + s * 1000; g.was1v1 = false; state();
    joinT = setTimeout(() => { g.phase = 'closed'; g.started = true; auto(g.au); }, s * 1000);
  };

  function spin() {
    if (busy || !g.players.length) return;
    if (solo()) return win();
    // si el ganador preseleccionado ya no está en juego (reinicio, etc.), se ignora
    if (r.forceWinner && !g.players.some(p => (p.o || p.id) === r.forceWinner.id)) r.forceWinner = null;
    busy = true; r.winner = null;
    let nKill = g.players.length === 2 ? 1 : Math.max(1, Math.min(g.batch || 1, g.players.length - 1));
    const candidates = r.forceWinner ? g.players.filter(p => (p.o || p.id) !== r.forceWinner.id) : g.players;
    if (nKill === 1) {
      const t = candidates[rnd(candidates.length)], life = t.lives > 1;
      send('spin', { id: t.id, life, ids: [t.id], totalBefore: g.players.length, nextMs: 2500 });
      const end = () => {
        busy = false;
        if (solo()) { win(); auto(0); }
        else if (is1v1() && !g.was1v1) { g.was1v1 = true; send('vs1', { a: g.players[0], b: g.players[1] }); auto(g.vs1sec || 25); }
        else if (g.started && (g.autoSec || g.au)) auto(is1v1() ? (g.vs1sec || 25) : (g.au || 15));
        else state();
      };
      if (life) setTimeout(() => { t.lives--; plist(); done(end); }, 1400);
      else setTimeout(() => { g.players = g.players.filter(x => x !== t); plist(); state(); done(end); }, 1750);
      return;
    }
    const pool = [...candidates], picked = [];
    while (picked.length < nKill && pool.length > 1) { const i = rnd(pool.length); picked.push(pool.splice(i, 1)[0]); }
    const ids = picked.map(p => p.id);
    send('spin', { ids, id: ids[0], life: false, totalBefore: g.players.length, nextMs: 2800 });
    setTimeout(() => {
      const idset = new Set(ids);
      g.players = g.players.filter(x => !idset.has(x.id));
      plist(); state();
      done(() => {
        busy = false;
        if (solo()) { win(); auto(0); }
        else if (is1v1() && !g.was1v1) { g.was1v1 = true; send('vs1', { a: g.players[0], b: g.players[1] }); auto(g.vs1sec || 25); }
        else if (g.started && (g.autoSec || g.au)) auto(is1v1() ? (g.vs1sec || 25) : (g.au || 15));
        else state();
      });
    }, 1750);
  }

  const add = (p, c, n) => {
    if (!['open', 'joining'].includes(g.phase)) return; n = n || 1;
    if (g.sc) { const base = COINS[String(g.gift || '').toLowerCase()] || 0; if (base > 0 && c > 0) n = Math.max(1, Math.round(c / base)); }
    n = Math.min(n, MAXC); g.gifts += n; g.coins += c; g.entries++;
    const had = g.players.filter(a => a.o === p.id);
    if (p.avatar) had.forEach(a => { if (!a.avatar) a.avatar = p.avatar; });
    let first = null;
    for (let i = 0; i < n; i++) { const card = { id: p.id + '#' + (++seq), o: p.id, name: p.name, avatar: p.avatar, lives: 1 }; if (!first) first = card; g.players.push(card); }
    send('toast', { p: first, n, k: had.length ? 'add' : 'new' }); plist(); state();
  };

  const cfg = (c, soft) => {
    if (soft && r.configured) return; r.configured = true;
    g.mode = c.mode === 'lock' ? 'lock' : 'free'; g.gift = c.gift === undefined ? g.gift : String(c.gift); g.up = !!c.up;
    if (c.sc !== undefined) g.sc = !!c.sc; g.im = c.im || ''; g.sec = +c.sec || 60;
    g.bgt = ['none', 'color', 'img'].includes(c.bgt) ? c.bgt : 'none';
    g.bgc = /^#[0-9a-f]{3,8}$/i.test(c.bgc || '') ? c.bgc : '#101018';
    g.bgu = /^(https?:\/\/|\/media\/)/.test(c.bgu || '') ? String(c.bgu).slice(0, 600) : '';
    g.bgk = c.bgk === 'video' ? 'video' : 'img';
    g.bgl = c.bgl !== false;
    g.bgfit = ['cover', 'contain', 'fill'].includes(c.bgfit) ? c.bgfit : 'cover';
    g.bgpos = String(c.bgpos || 'center').slice(0, 40);
    if (c.au !== undefined) g.au = +c.au || 0;
    if (c.ini !== undefined) g.ini = Math.max(0, +c.ini || 0);
    if (c.tl !== undefined) g.tl = !!c.tl;
    if (c.iniOn !== undefined) g.iniOn = !!c.iniOn;
    if (c.batch !== undefined) g.batch = Math.max(1, +c.batch || 1);
    if (c.vs1sec !== undefined) g.vs1sec = Math.max(5, +c.vs1sec || 25);
    g.cv++;
    if (c.restart) {
      // la ruleta vuelve a empezar PAUSADA: hay que pulsar Play
      clearTimeout(joinT); g.joinEnd = 0; g.was1v1 = false; r.winner = null; g.started = false; auto(0);
      g.phase = (g.mode === 'lock' && !g.tl) ? 'closed' : 'open';
    }
    state();
  };

  r.cmd = {
    cfg: m => cfg(m, m.soft), open: m => open(m.sec || g.sec), auto: m => { if (g.started) auto(m.sec); }, spin,
    // Play: arranca la ruleta (con el tiempo inicial si está activado). No se puede volver a pausar; solo reiniciar.
    play: () => { if (g.started) return; g.started = true; if (g.mode === 'lock' && g.tl) open(g.sec); else auto((g.iniOn && g.ini) ? g.ini : (g.au || 15)); },
    animdone: () => { ackFn && ackFn(); }, vouch: () => { g.vouches++; state(); },
    reset: () => { g.players = []; g.gifts = g.coins = g.entries = 0; g.was1v1 = false; r.forceWinner = null; cfg({ ...g, restart: true }); plist(); }, // los vouches NO se borran: son permanentes
    test: m => { for (let i = 0; i < Math.min(+m.n || 1, 100); i++) setTimeout(() => add(fake(), (+m.c || 1) * (+m.mult || 1), +m.mult || 1), i * 90); },
    // ganador preseleccionado (modo admin): solo afecta a la ronda actual y se identifica como tal al ganar
    setForceWinner: name => {
      const norm = s => String(s || '').trim().toLowerCase();
      const target = norm(name);
      if (!target) return { ok: false, error: 'Falta el usuario que debe ganar.' };
      const hit = g.players.find(p => norm(p.name) === target) || g.players.find(p => norm(p.name).includes(target));
      if (!hit) return { ok: false, error: 'Ese usuario no participa en la ronda actual (o ya ha sido eliminado).' };
      r.forceWinner = { id: hit.o || hit.id, name: hit.name };
      return { ok: true, name: hit.name };
    },
    clearForceWinner: () => { r.forceWinner = null; return { ok: true }; },
    getForceWinner: () => r.forceWinner
  };

  r.sync = () => { state(); plist(); };
  r.stop = () => { clearTimeout(joinT); clearTimeout(autoT); clearTimeout(ackT); if (r.media) fs.unlink(path.join(UP, r.media), () => {}); };
  const retry = () => { if (!r.dead) setTimeout(connect, 15000); };

  async function connect() {
    if (r.dead) return; if (!r.clients.size) return retry();

    let ET = {};
    try {
      const pkg = await import('piratetok-live-js');
      const TikTokLiveClient = pkg.TikTokLiveClient || pkg.default?.TikTokLiveClient || pkg.default;
      ET = pkg.EventType || (pkg.default && pkg.default.EventType) || {};
      r.conn = new TikTokLiveClient(user);
    } catch (err) {
      console.error('Error al importar:', err);
      send('status', { ok: false, msg: 'Error al cargar el módulo de TikTok' });
      return retry();
    }

    const streaks = {}, norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^rosa$/, 'rose');

    r.conn.on(ET.gift || 'gift', d => {
      r.rawGift = dump(d); // para /debug: así se ve exactamente qué manda TikTok
      const U = d.user || {}, G = d.gift || d.giftDetails || {};
      const gname = G.name || G.giftName || d.giftName || '', gcoins = G.diamondCount ?? G.diamond_count ?? d.diamondCount ?? 0;
      const nm = norm(gname), want = norm(g.gift), min = COINS[(g.gift || '').toLowerCase()] || 0;

      const who = nameOf(U, d), uid = idOf(U, d), av = bestPic(U) || d.profilePictureUrl || '';
      const gid = d.giftId ?? G.id, gtype = G.type ?? d.giftType;

      const info = m => {
        const line = new Date().toISOString().slice(11, 19) + ' ' + who + ' ' + (gname || '?') + ' id=' + gid + ' tipo=' + gtype + ' fin=' + d.repeatEnd + ' x' + d.repeatCount + ' foto=' + (av ? 'sí' : 'NO') + ' -> ' + m;
        r.log.push(line); if (r.log.length > 30) r.log.shift(); console.log('gift', line);
        send('status', { ok: true, msg: '🎁 ' + (gname || '?') + ' de ' + who + ' → ' + m });
      };

      const isRose = Number(gid) === 5655;
      if (want && nm !== want && !(want === 'rose' && isRose) && !(g.up && min && gcoins >= min)) return info('ignorado: tu regalo configurado es "' + g.gift + '"');

      const key = uid + ':' + (gid || nm), total = d.repeatCount || 1, now = Date.now(), st = streaks[key], stream = gtype === 1;
      const seen = stream && st && now - st.t < 20000 ? st.n : 0, delta = stream ? total - seen : total;
      if (stream) { if (d.repeatEnd) delete streaks[key]; else streaks[key] = { n: total, t: now }; }
      if (delta <= 0) return info('combo en curso');

      if (!['open', 'joining'].includes(g.phase)) { if (!seen) send('toast', { p: { id: uid, name: who, avatar: av, lives: 0 }, n: 0, k: 'locked' }); return info('ignorado: entradas cerradas'); }
      const gimg = urls(G.image || G.icon)[0]; if (gimg) g.gu[nm] = g.gu['*'] = gimg;

      add({ id: uid, name: who, avatar: av }, gcoins * delta, delta);
      info('entró ✅ x' + delta);
    });

    r.conn.on(ET.chat || 'chat', d => {
      r.rawChat = dump(d);
      const txt = String(d.content ?? d.comment ?? '').trim().slice(0, 200); if (!txt) return;
      const U = d.user || {}, uid = idOf(U, d), arr = r.msgs[uid] || (r.msgs[uid] = []); arr.push(txt); if (arr.length > 5) arr.shift();
      const ks = Object.keys(r.msgs); if (ks.length > 3000) delete r.msgs[ks[0]];
      // si quien escribe es la persona que acaba de ganar, su mensaje se manda en directo a la pantalla de ganador
      if (r.winner && uid === r.winner) send('winmsg', { text: txt });
      if (/vouch/i.test(txt)) {
        const va = r.vm[uid] || (r.vm[uid] = []); va.push(txt); if (va.length > 5) va.shift();
        const kv = Object.keys(r.vm); if (kv.length > 3000) delete r.vm[kv[0]];
        // solo cuenta el vouch si lo escribe la persona que ganó
        if (r.winner && uid === r.winner) {
          g.vouches++; state(); send('vouch', { name: nameOf(U, d) });
          // al detectar "vouch" del ganador, la ruleta se reinicia sola (igual que pulsar "Reiniciar todo")
          r.cmd.reset();
        }
      }
    });

    r.conn.on('error', e => console.error('conn error', e && e.message || e));
    r.conn.on('disconnected', () => send('status', { ok: false, msg: 'Desconectado, reintentando…' }));

    r.conn.connect().then(() => {
        send('status', { ok: true, msg: 'Conectado a @' + user });
    }).catch(e => {
        send('status', { ok: false, msg: 'No se pudo conectar a @' + user + ' (' + String(e.message || e).slice(0, 160) + ')' });
        retry();
    });
  }

  r.start = connect; auto(0); return r;
}

wss.on('connection', (ws, req) => {
  const user = (new URL(req.url, 'http://x').searchParams.get('user') || '').replace('@', '').trim().toLowerCase();
  if (!user) return ws.close();
  const fresh = !rooms[user], r = room(user);
  r.clients.add(ws);
  if (fresh) r.start();
  else if (r.conn) ws.send(JSON.stringify({ event: 'status', data: { ok: true, msg: 'Conectado a @' + user } }));
  if (r.owner) ws.send(JSON.stringify({ event: 'owner', data: r.owner }));
  r.sync();
  ws.on('message', raw => { try { const m = JSON.parse(raw), h = r.cmd[m.cmd]; h && h(m); } catch (e) { console.error('cmd', e.message); } });
  ws.on('close', () => {
    r.clients.delete(ws);
    if (!r.clients.size) setTimeout(() => { if (!r.clients.size) { r.dead = true; r.stop(); try { r.conn.disconnect(); } catch (e) {} delete rooms[user]; } }, 30000);
  });
});

srv.listen(process.env.PORT || 3000, () => console.log('Abre: http://localhost:' + (process.env.PORT || 3000) + '/ruleta.html'));
