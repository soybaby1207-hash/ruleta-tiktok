process.on('uncaughtException', e => console.error('uncaught', e?.message || e));
process.on('unhandledRejection', e => console.error('unhandled', e?.message || e));

import express from 'express';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import {
  TikTokLiveClient,
  EventType,
  GiftStreakTracker
} from 'piratetok-live-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rnd = n => crypto.randomInt(n);

const COINS = {
  rose: 1, tiktok: 1, 'ice cream cone': 1, 'heart me': 1, 'finger heart': 5,
  perfume: 20, doughnut: 30, cap: 99, 'paper crane': 99, 'little crown': 99,
  'hat and mustache': 99, confetti: 100, 'hand hearts': 100, sunglasses: 199,
  'gold boxing gloves': 299, corgi: 299, 'money gun': 500, swan: 699, train: 899,
  galaxy: 1000, fireworks: 1088, 'whale diving': 2150, 'leon the kitten': 4888,
  'drama queen': 5000, 'sports car': 7000, lion: 29999, 'tiktok universe': 44999
};

const NM = ['maria','carlos','lucia','juan','sofia','diego','ana','pablo','laura','javi','carmen','alex','paula','david','marta','sergio','elena','raul','nuria','ivan'];
const SF = ['_xx','.oficial','88','_17','_tv','.mx','_rd','23','_vip','_09'];
const fake = () => ({
  id: 't' + crypto.randomUUID(),
  name: NM[rnd(NM.length)] + SF[rnd(SF.length)],
  avatar: `https://randomuser.me/api/portraits/${rnd(2) ? 'women' : 'men'}/${rnd(99)}.jpg`
});

const app = express();
app.get('/', (q, r) => r.redirect('/ruleta.html'));
app.use(express.static(path.join(__dirname, 'public')));

// Si pones el HTML en la raíz (junto a server.js)
app.get('/ruleta.html', (q, r) => {
  const p = path.join(__dirname, 'ruleta.html');
  if (fs.existsSync(p)) return r.sendFile(p);
  r.status(404).send('Pon ruleta.html en la misma carpeta que server.js o en /public');
});

app.get('/debug', (q, res) => {
  const u = String(q.query.user || '').replace('@', '').trim().toLowerCase();
  const r = rooms[u];
  if (!r) return res.json({ error: 'No hay sala para ' + u, salas: Object.keys(rooms) });
  res.json({
    usuario: u,
    conectadoATikTok: !!r.connected,
    ultimoEstado: r.status,
    pantallasConectadas: r.clients.size,
    registroDeRegalos: r.log
  });
});

const UP = path.join(os.tmpdir(), 'ruleta-media');
fs.mkdirSync(UP, { recursive: true });
const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm'
};
app.use('/media', express.static(UP, { maxAge: '1h' }));

app.post('/upload', express.raw({ type: () => true, limit: '40mb' }), (q, res) => {
  const u = String(q.query.user || '').replace('@', '').trim().toLowerCase();
  const ct = String(q.headers['content-type'] || '').split(';')[0];
  const ext = EXT[ct];
  const r = rooms[u];
  if (!r) return res.status(403).json({ error: 'Conecta primero con tu usuario' });
  if (!ext) return res.status(415).json({ error: 'Formato no permitido' });
  if (!Buffer.isBuffer(q.body) || !q.body.length) return res.status(400).json({ error: 'Archivo vacío' });
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UP, name), q.body);
  if (r.media) fs.unlink(path.join(UP, r.media), () => {});
  r.media = name;
  res.json({ url: '/media/' + name, kind: (ext === 'mp4' || ext === 'webm') ? 'video' : 'img' });
});

app.use((err, q, res, next) =>
  res.status(err.status || 500).json({
    error: err.type === 'entity.too.large' ? 'Archivo demasiado grande (máx. 40 MB)' : 'Error al subir'
  })
);

setInterval(() => {
  fs.readdir(UP, (e, l) => (l || []).forEach(f =>
    fs.stat(path.join(UP, f), (e2, st) =>
      st && Date.now() - st.mtimeMs > 12 * 36e5 && fs.unlink(path.join(UP, f), () => {})
    )
  ));
}, 36e5);

const srv = http.createServer(app);
const wss = new WebSocketServer({ server: srv });
const rooms = {};

function pickAvatar(user) {
  if (!user) return '';
  const candidates = [
    user.profilePictureUrl,
    user.avatarThumb?.urlList?.[0],
    user.avatarMedium?.urlList?.[0],
    user.avatarLarge?.urlList?.[0],
    user.avatar_thumb?.url_list?.[0],
    user.avatar_medium?.url_list?.[0],
    user.avatar_large?.url_list?.[0]
  ].filter(Boolean);
  return candidates.find(x => /\.(webp|jpe?g|png)/i.test(x) && !/heic/i.test(x)) || candidates[0] || '';
}

function room(user) {
  if (rooms[user]) return rooms[user];

  const r = rooms[user] = {
    clients: new Set(),
    conn: null,
    connected: false,
    dead: false,
    configured: false,
    log: [],
    status: '',
    pics: {},
    msgs: {},
    vm: {},
    media: null
  };

  const g = {
    players: [], phase: 'open', joinEnd: 0, autoAt: 0, autoSec: 0,
    gifts: 0, coins: 0, entries: 0, mode: 'free', gift: 'Rose',
    up: false, sc: true, vouches: 0, sec: 60, au: 15, ini: 120,
    tl: true, batch: 1, vs1sec: 25, im: '', bgt: 'none', bgc: '#101018',
    bgu: '', bgk: 'img', bgl: true, bgfit: 'cover', bgpos: 'center',
    cv: 0, gu: {}, was1v1: false
  };

  let joinT, autoT, busy = false, ackFn = null, ackT = null, seq = 0;
  const MAXC = 30;
  const solo = () => g.players.length > 0 && new Set(g.players.map(p => p.o || p.id)).size === 1;
  const send = (event, data) => {
    if (event === 'status') r.status = data.msg;
    const m = JSON.stringify({ event, data });
    r.clients.forEach(c => c.readyState === 1 && c.send(m));
  };
  const state = () => { const { players, ...s } = g; send('state', { ...s, now: Date.now() }); };
  const plist = () => send('players', { players: g.players });
  const is1v1 = () => g.mode === 'lock' && g.players.length === 2;
  const win = () => {
    const p = g.players[0];
    send('win', { p, msgs: (r.vm[p.o || p.id] || []).slice(-5) });
  };
  const done = f => {
    clearTimeout(ackT);
    ackFn = () => { clearTimeout(ackT); ackFn = null; f(); };
    ackT = setTimeout(() => ackFn && ackFn(), 8000);
  };

  const auto = s => {
    clearTimeout(autoT);
    s = +s || 0;
    g.autoSec = s;
    if (!s) { g.autoAt = 0; return state(); }
    const wait = is1v1() ? (g.vs1sec || 25) : s;
    g.autoAt = Date.now() + wait * 1000;
    g.autoSec = wait;
    state();
    autoT = setTimeout(() => {
      if (g.players.length > 1 && !solo() && !busy) {
        g.autoAt = 0; state(); spin();
      } else auto(g.au || s);
    }, wait * 1000);
  };

  const open = s => {
    clearTimeout(joinT);
    auto(0);
    s = +s || 60;
    g.phase = 'joining';
    g.joinEnd = Date.now() + s * 1000;
    g.was1v1 = false;
    state();
    joinT = setTimeout(() => { g.phase = 'closed'; auto(g.au); }, s * 1000);
  };

  function spin() {
    if (busy || !g.players.length) return;
    if (solo()) return win();
    busy = true;
    let nKill = g.players.length === 2 ? 1 : Math.max(1, Math.min(g.batch || 1, g.players.length - 1));

    if (nKill === 1) {
      const t = g.players[rnd(g.players.length)];
      const life = t.lives > 1;
      send('spin', { id: t.id, life, ids: [t.id], totalBefore: g.players.length, nextMs: 2500 });
      const end = () => {
        busy = false;
        if (solo()) { win(); auto(0); }
        else if (is1v1() && !g.was1v1) {
          g.was1v1 = true;
          send('vs1', { a: g.players[0], b: g.players[1] });
          auto(g.vs1sec || 25);
        } else if (g.autoSec || g.au) auto(is1v1() ? (g.vs1sec || 25) : (g.au || 15));
        else state();
      };
      if (life) setTimeout(() => { t.lives--; plist(); done(end); }, 1400);
      else setTimeout(() => {
        g.players = g.players.filter(x => x !== t);
        plist(); state(); done(end);
      }, 1750);
      return;
    }

    const pool = [...g.players], picked = [];
    while (picked.length < nKill && pool.length > 1) {
      const i = rnd(pool.length);
      picked.push(pool.splice(i, 1)[0]);
    }
    const ids = picked.map(p => p.id);
    send('spin', { ids, id: ids[0], life: false, totalBefore: g.players.length, nextMs: 2800 });
    setTimeout(() => {
      const idset = new Set(ids);
      g.players = g.players.filter(x => !idset.has(x.id));
      plist(); state();
      done(() => {
        busy = false;
        if (solo()) { win(); auto(0); }
        else if (is1v1() && !g.was1v1) {
          g.was1v1 = true;
          send('vs1', { a: g.players[0], b: g.players[1] });
          auto(g.vs1sec || 25);
        } else if (g.autoSec || g.au) auto(is1v1() ? (g.vs1sec || 25) : (g.au || 15));
        else state();
      });
    }, 1750);
  }

  const add = (p, c, n) => {
    if (!['open', 'joining'].includes(g.phase)) return;
    n = n || 1;
    if (g.sc) {
      const base = COINS[String(g.gift || '').toLowerCase()] || 0;
      if (base > 0 && c > 0) n = Math.max(1, Math.round(c / base));
    }
    n = Math.min(n, MAXC);
    g.gifts += n; g.coins += c; g.entries++;
    const had = g.players.filter(a => a.o === p.id);
    if (p.avatar) had.forEach(a => { if (!a.avatar) a.avatar = p.avatar; });
    let first = null;
    for (let i = 0; i < n; i++) {
      const card = { id: p.id + '#' + (++seq), o: p.id, name: p.name, avatar: p.avatar, lives: 1 };
      if (!first) first = card;
      g.players.push(card);
    }
    send('toast', { p: first, n, k: had.length ? 'add' : 'new' });
    plist(); state();
  };

  const cfg = (c, soft) => {
    if (soft && r.configured) return;
    r.configured = true;
    g.mode = c.mode === 'lock' ? 'lock' : 'free';
    g.gift = c.gift === undefined ? g.gift : String(c.gift);
    g.up = !!c.up;
    if (c.sc !== undefined) g.sc = !!c.sc;
    g.im = c.im || '';
    g.sec = +c.sec || 60;
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
      clearTimeout(joinT);
      g.joinEnd = 0;
      g.was1v1 = false;
      if (g.mode === 'lock') {
        if (g.tl) open(g.sec);
        else { g.phase = 'closed'; auto(g.ini || g.au); }
      } else {
        g.phase = 'open';
        auto(g.ini || g.au);
      }
    }
    state();
  };

  r.cmd = {
    cfg: m => cfg(m, m.soft),
    open: m => open(m.sec || g.sec),
    auto: m => auto(m.sec),
    spin,
    animdone: () => { ackFn && ackFn(); },
    vouch: () => { g.vouches++; state(); },
    reset: () => {
      g.players = [];
      g.gifts = g.coins = g.entries = 0;
      g.vouches = 0;
      g.was1v1 = false;
      cfg({ ...g, restart: true });
      plist();
    },
    test: m => {
      for (let i = 0; i < Math.min(+m.n || 1, 100); i++)
        setTimeout(() => add(fake(), (+m.c || 1) * (+m.mult || 1), +m.mult || 1), i * 90);
    }
  };

  r.sync = () => { state(); plist(); };
  r.stop = () => {
    clearTimeout(joinT);
    clearTimeout(autoT);
    clearTimeout(ackT);
    if (r.media) fs.unlink(path.join(UP, r.media), () => {});
    try { r.conn?.disconnect?.(); } catch {}
  };

  const tracker = new GiftStreakTracker();

  async function connect() {
    if (r.dead || !r.clients.size) return;

    try {
      const client = new TikTokLiveClient(user)
        .timeout(15000)
        .maxRetries(8)
        .staleTimeout(90000);

      r.conn = client;

      client.on(EventType.connected, () => {
        r.connected = true;
        send('status', { ok: true, msg: 'Conectado a @' + user });
      });

      client.on(EventType.reconnecting, () => {
        r.connected = false;
        send('status', { ok: false, msg: 'Reconectando…' });
      });

      client.on(EventType.disconnected, () => {
        r.connected = false;
        send('status', { ok: false, msg: 'Desconectado' });
        if (!r.dead && r.clients.size) setTimeout(connect, 12000);
      });

      client.on(EventType.liveEnded, () => {
        send('status', { ok: false, msg: 'El live terminó' });
      });

      client.on(EventType.gift, (data) => {
        try {
          const streak = tracker.process(data);
          const delta = streak?.eventGiftCount ?? 0;
          if (delta <= 0 && !streak?.isFinal) return;

          const userObj = data.user || {};
          const giftObj = data.gift || data.giftDetails || {};
          const gname = giftObj.name || giftObj.giftName || '';
          const gcoins = giftObj.diamondCount ?? giftObj.diamond_count ?? 0;
          const who = userObj.nickname || userObj.uniqueId || '?';
          const uid = String(userObj.userId || userObj.id || userObj.uniqueId || '');
          const av = pickAvatar(userObj) || r.pics[uid] || '';

          const nm = String(gname || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^rosa$/, 'rose');
          const want = String(g.gift || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const min = COINS[(g.gift || '').toLowerCase()] || 0;
          const isRose = Number(giftObj.id || giftObj.giftId) === 5655;

          const info = m => {
            const line = new Date().toISOString().slice(11, 19) + ' ' + who + ' ' + (gname || '?') + ' → ' + m;
            r.log.push(line);
            if (r.log.length > 30) r.log.shift();
            console.log('gift', line);
            send('status', { ok: true, msg: '🎁 ' + (gname || '?') + ' de ' + who + ' → ' + m });
          };

          if (want && nm !== want && !(want === 'rose' && isRose) && !(g.up && min && gcoins >= min)) {
            return info('ignorado: tu regalo configurado es "' + g.gift + '"');
          }

          if (!['open', 'joining'].includes(g.phase)) {
            send('toast', { p: { id: uid, name: who, avatar: av, lives: 0 }, n: 0, k: 'locked' });
            return info('ignorado: entradas cerradas');
          }

          if (giftObj.imageUrl || giftObj.pictureUrl) {
            g.gu[nm] = g.gu['*'] = giftObj.imageUrl || giftObj.pictureUrl;
          }

          const count = delta > 0 ? delta : 1;
          add({ id: uid, name: who, avatar: av }, gcoins * count, count);
          info('entró ✅ x' + count);
        } catch (e) {
          console.error('gift handler', e?.message || e);
        }
      });

      client.on(EventType.chat, (data) => {
        try {
          const txt = String(data.content || data.comment || '').trim().slice(0, 200);
          if (!txt) return;
          const userObj = data.user || {};
          const uid = String(userObj.userId || userObj.id || userObj.uniqueId || '');
          const arr = r.msgs[uid] || (r.msgs[uid] = []);
          arr.push(txt);
          if (arr.length > 5) arr.shift();
          const ks = Object.keys(r.msgs);
          if (ks.length > 3000) delete r.msgs[ks[0]];

          if (/vouch/i.test(txt)) {
            const va = r.vm[uid] || (r.vm[uid] = []);
            va.push(txt);
            if (va.length > 5) va.shift();
            const kv = Object.keys(r.vm);
            if (kv.length > 3000) delete r.vm[kv[0]];
            g.vouches++;
            state();
            send('vouch', { name: userObj.nickname || userObj.uniqueId || '?' });
          }
        } catch (e) {
          console.error('chat handler', e?.message || e);
        }
      });

      await client.connect();
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 180);
      send('status', {
        ok: false,
        msg: msg.includes('not currently live') || msg.includes('HostNotOnline')
          ? 'El usuario no está en directo ahora'
          : 'No se pudo conectar a @' + user + ' (' + msg + ')'
      });
      if (!r.dead && r.clients.size) setTimeout(connect, 15000);
    }
  }

  r.start = connect;
  auto(g.ini || g.au || 15);
  return r;
}

wss.on('connection', (ws, req) => {
  const user = (new URL(req.url, 'http://x').searchParams.get('user') || '').replace('@', '').trim().toLowerCase();
  if (!user) return ws.close();

  const fresh = !rooms[user];
  const r = room(user);
  r.clients.add(ws);

  if (fresh) r.start();
  else if (r.connected) ws.send(JSON.stringify({ event: 'status', data: { ok: true, msg: 'Conectado a @' + user } }));

  r.sync();

  ws.on('message', raw => {
    try {
      const m = JSON.parse(raw);
      const h = r.cmd[m.cmd];
      if (h) h(m);
    } catch (e) {
      console.error('cmd', e.message);
    }
  });

  ws.on('close', () => {
    r.clients.delete(ws);
    if (!r.clients.size) {
      setTimeout(() => {
        if (!r.clients.size) {
          r.dead = true;
          r.stop();
          delete rooms[user];
        }
      }, 30000);
    }
  });
});

const PORT = process.env.PORT || 3000;
srv.listen(PORT, () => {
  console.log('Abre: http://localhost:' + PORT + '/ruleta.html');
  console.log('PirateTok activo · sin API key');
});
