process.on('uncaughtException', e => console.error('uncaught', e && e.message));
process.on('unhandledRejection', e => console.error('unhandled', e && e.message || e));

const express = require('express'), http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path'), os = require('os'), { WebSocketServer } = require('ws');

const bestPic = u => { const l = [u.avatarLarge, u.avatarMedium, u.avatarThumb].flatMap(a => (a && a.urlList) || []);
  return l.find(x => /100x100/.test(x) && /\.(webp|jpe?g|png)/.test(x)) || l.find(x => /\.(webp|jpe?g|png)/.test(x) && !/heic/.test(x)) || l.find(x => !/heic/.test(x)) || l[0] || '' };
const KEY = process.env.EULER_API_KEY || undefined, rnd = n => crypto.randomInt(n);
const COINS = { rose: 1, tiktok: 1, 'ice cream cone': 1, 'heart me': 1, 'finger heart': 5, perfume: 20, doughnut: 30, cap: 99, 'paper crane': 99, 'little crown': 99, 'hat and mustache': 99, confetti: 100, 'hand hearts': 100, sunglasses: 199, 'gold boxing gloves': 299, corgi: 299, 'money gun': 500, swan: 699, train: 899, galaxy: 1000, fireworks: 1088, 'whale diving': 2150, 'leon the kitten': 4888, 'drama queen': 5000, 'sports car': 7000, lion: 29999, 'tiktok universe': 44999 };
const NM = ['maria', 'carlos', 'lucia', 'juan', 'sofia', 'diego', 'ana', 'pablo', 'laura', 'javi', 'carmen', 'alex', 'paula', 'david', 'marta', 'sergio', 'elena', 'raul', 'nuria', 'ivan'], SF = ['_xx', '.oficial', '88', '_17', '_tv', '.mx', '_rd', '23', '_vip', '_09'];
const fake = () => ({ id: 't' + crypto.randomUUID(), name: NM[rnd(NM.length)] + SF[rnd(SF.length)], avatar: `https://randomuser.me/api/portraits/${rnd(2) ? 'women' : 'men'}/${rnd(99)}.jpg` });

const app = express();
app.get('/', (q, r) => r.redirect('/ruleta.html'));
app.use(express.static('public'));

app.get('/debug', (q, res) => {
    const u = String(q.query.user || '').replace('@', '').trim().toLowerCase(), r = rooms[u];
    if (!r) return res.json({ error: 'No hay sala para ' + u + '. Abre la pagina, escribe el usuario y pulsa Conectar primero.', salas: Object.keys(rooms) });
    res.json({ usuario: u, conectadoATikTok: !!(r.conn && r.conn.isConnected), claveEulerConfigurada: !!KEY, ultimoEstado: r.status, pantallasConectadas: r.clients.size, mensajesRecibidosDeTikTok: r.methods, registroDeRegalos: r.log });
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
  const r = rooms[user] = { clients: new Set(), conn: null, dead: false, configured: false, methods: {}, log: [], status: '', pics: {}, msgs: {}, vm: {} };
  const g = { players: [], phase: 'open', joinEnd: 0, autoAt: 0, autoSec: 0, gifts: 0, coins: 0, entries: 0, mode: 'free', gift: 'Rose', up: false, sc: true, vouches: 0, sec: 60, au: 15, ini: 120, tl: true, batch: 1, vs1sec: 25, im: '', bgt: 'none', bgc: '#101018', bgu: '', bgk: 'img', bgl: true, bgfit: 'cover', bgpos: 'center', cv: 0, gu: {}, was1v1: false };
  let joinT, autoT, busy = false, ackFn = null, ackT = null, seq = 0;
  const MAXC = 30, solo = () => g.players.length > 0 && new Set(g.players.map(p => p.o || p.id)).size === 1;
  const send = (event, data) => { if (event === 'status') r.status = data.msg; const m = JSON.stringify({ event, data }); r.clients.forEach(c => c.readyState === 1 && c.send(m)); };
  const state = () => { const { players, ...s } = g; send('state', { ...s, now: Date.now() }); }, plist = () => send('players', { players: g.players });
  const is1v1 = () => g.mode === 'lock' && g.players.length === 2;
  const win = () => { const p = g.players[0]; send('win', { p, msgs: (r.vm[p.o || p.id] || []).slice(-5) }); };
  const done = f => { clearTimeout(ackT); ackFn = () => { clearTimeout(ackT); ackFn = null; f(); }; ackT = setTimeout(() => ackFn && ackFn(), 8000); };
  const auto = s => {
    clearTimeout(autoT); s = +s || 0; g.autoSec = s; if (!s) { g.autoAt = 0; return state(); }
    const wait = is1v1() ? (g.vs1sec || 25) : s;
    g.autoAt = Date.now() + wait * 1000; g.autoSec = wait; state();
    autoT = setTimeout(() => { if (g.players.length > 1 && !solo() && !busy) { g.autoAt = 0; state(); spin(); } else auto(g.au || s); }, wait * 1000);
  };
  const open = s => {
    clearTimeout(joinT); auto(0); s = +s || 60; g.phase = 'joining'; g.joinEnd = Date.now() + s * 1000; g.was1v1 = false; state();
    joinT = setTimeout(() => { g.phase = 'closed'; auto(g.au); }, s * 1000);
  };

  function spin() {
    if (busy || !g.players.length) return;
    if (solo()) return win();
    busy = true;
    let nKill = g.players.length === 2 ? 1 : Math.max(1, Math.min(g.batch || 1, g.players.length - 1));
    if (nKill === 1) {
      const t = g.players[rnd(g.players.length)], life = t.lives > 1;
      send('spin', { id: t.id, life, ids: [t.id], totalBefore: g.players.length, nextMs: 2500 });
      const end = () => {
        busy = false;
        if (solo()) { win(); auto(0); }
        else if (is1v1() && !g.was1v1) { g.was1v1 = true; send('vs1', { a: g.players[0], b: g.players[1] }); auto(g.vs1sec || 25); }
        else if (g.autoSec || g.au) auto(is1v1() ? (g.vs1sec || 25) : (g.au || 15));
        else state();
      };
      if (life) setTimeout(() => { t.lives--; plist(); done(end); }, 1400);
      else setTimeout(() => { g.players = g.players.filter(x => x !== t); plist(); state(); done(end); }, 1750);
      return;
    }
    const pool = [...g.players], picked = [];
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
        else if (g.autoSec || g.au) auto(is1v1() ? (g.vs1sec || 25) : (g.au || 15));
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
    if (c.batch !== undefined) g.batch = Math.max(1, +c.batch || 1);
    if (c.vs1sec !== undefined) g.vs1sec = Math.max(5, +c.vs1sec || 25);
    g.cv++;
    if (c.restart) {
      clearTimeout(joinT); g.joinEnd = 0; g.was1v1 = false;
      if (g.mode === 'lock') { if (g.tl) open(g.sec); else { g.phase = 'closed'; auto(g.ini || g.au); } }
      else { g.phase = 'open'; auto(g.ini || g.au); }
    }
    state();
  };

  r.cmd = {
    cfg: m => cfg(m, m.soft), open: m => open(m.sec || g.sec), auto: m => auto(m.sec), spin,
    animdone: () => { ackFn && ackFn(); }, vouch: () => { g.vouches++; state(); },
    reset: () => { g.players = []; g.gifts = g.coins = g.entries = 0; g.vouches = 0; g.was1v1 = false; cfg({ ...g, restart: true }); plist(); },
    test: m => { for (let i = 0; i < Math.min(+m.n || 1, 100); i++) setTimeout(() => add(fake(), (+m.c || 1) * (+m.mult || 1), +m.mult || 1), i * 90); }
  };

  r.sync = () => { state(); plist(); };
  r.stop = () => { clearTimeout(joinT); clearTimeout(autoT); clearTimeout(ackT); if (r.media) fs.unlink(path.join(UP, r.media), () => {}); };
  const retry = () => { if (!r.dead) setTimeout(connect, 15000); };

  async function connect() {
    if (r.dead) return; if (!r.clients.size) return retry();
    
    try {
      const pkg = await import('piratetok-live-js');
      const TikTokLiveClient = pkg.TikTokLiveClient || pkg.default?.TikTokLiveClient || pkg.default;
      r.conn = new TikTokLiveClient(user);
    } catch (err) {
      console.error('Error al importar:', err);
      send('status', { ok: false, msg: 'Error al cargar el módulo de TikTok' });
      return retry();
    }

    const streaks = {}, norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^rosa$/, 'rose');

    r.conn.on('gift', d => {
      const gname = d.giftName || '', gcoins = d.diamondCount || 0;
      const nm = norm(gname), want = norm(g.gift), min = COINS[(g.gift || '').toLowerCase()] || 0;
      
      // Extracción limpia del nombre y de la foto de perfil del donante
      const who = d.nickname || d.uniqueId || 'Anónimo';
      const uid = String(d.userId || d.uniqueId || 't' + crypto.randomUUID());
      const av = d.profilePictureUrl || d.avatarLarger || d.avatarMedium || d.avatarThumb || '';

      const info = m => {
        const line = new Date().toISOString().slice(11, 19) + ' ' + who + ' ' + (gname || '?') + ' id=' + d.giftId + ' tipo=' + d.giftType + ' fin=' + d.repeatEnd + ' x' + d.repeatCount + ' -> ' + m;
        r.log.push(line); if (r.log.length > 30) r.log.shift(); console.log('gift', line);
        send('status', { ok: true, msg: '🎁 ' + (gname || '?') + ' de ' + who + ' → ' + m });
      };

      const isRose = Number(d.giftId) === 5655;
      if (want && nm !== want && !(want === 'rose' && isRose) && !(g.up && min && gcoins >= min)) return info('ignorado: tu regalo configurado es "' + g.gift + '"');
      
      const key = uid + ':' + (d.giftId || nm), total = d.repeatCount || 1, now = Date.now(), st = streaks[key], stream = d.giftType === 1;
      const seen = stream && st && now - st.t < 20000 ? st.n : 0, delta = stream ? total - seen : total;
      if (stream) { if (d.repeatEnd) delete streaks[key]; else streaks[key] = { n: total, t: now }; }
      if (delta <= 0) return info('combo en curso');

      if (!['open', 'joining'].includes(g.phase)) { if (!seen) send('toast', { p: { id: uid, name: who, avatar: av, lives: 0 }, n: 0, k: 'locked' }); return info('ignorado: entradas cerradas'); }
      if (d.giftPictureUrl) g.gu[nm] = g.gu['*'] = d.giftPictureUrl;

      // Añadimos el usuario con su nombre y avatar reales a la ruleta
      add({ id: uid, name: who, avatar: av }, gcoins * delta, delta);
      info('entró ✅ x' + delta);
    });

    r.conn.on('chat', d => {
      const txt = String(d.comment || '').trim().slice(0, 200); if (!txt) return;
      const uid = String(d.userId || d.uniqueId), arr = r.msgs[uid] || (r.msgs[uid] = []); arr.push(txt); if (arr.length > 5) arr.shift();
      const ks = Object.keys(r.msgs); if (ks.length > 3000) delete r.msgs[ks[0]];
      if (/vouch/i.test(txt)) {
        const va = r.vm[uid] || (r.vm[uid] = []); va.push(txt); if (va.length > 5) va.shift();
        const kv = Object.keys(r.vm); if (kv.length > 3000) delete r.vm[kv[0]];
        g.vouches++; state(); send('vouch', { name: d.nickname || d.uniqueId || '?' });
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

  r.start = connect; auto(g.ini || g.au || 15); return r;
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

srv.listen(process.env.PORT || 3000,()=>console.log('Abre: http://localhost:'+(process.env.PORT||3000)+'/ruleta.html'));
