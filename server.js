process.on('uncaughtException', e => console.error('uncaught', e?.message || e));
process.on('unhandledRejection', e => console.error('unhandled', e?.message || e));

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const url = require('url');

let Conn;
const ready = import('tiktok-live-connector/legacy').then(m => {
  Conn = m.WebcastPushConnection;
});

const rnd = n => crypto.randomInt(n);

const COINS = {
  rose: 1, tiktok: 1, 'ice cream cone': 1, 'heart me': 1, 'finger heart': 5,
  perfume: 20, doughnut: 30, cap: 99, 'paper crane': 99, 'little crown': 99,
  'hat and mustache': 99, confetti: 100, 'hand hearts': 100, sunglasses: 199,
  'gold boxing gloves': 299, corgi: 299, 'money gun': 500, swan: 699, train: 899,
  galaxy: 1000, fireworks: 1088, 'whale diving': 2150, 'leon the kitten': 4888,
  'drama queen': 5000, 'sports car': 7000, lion: 29999, 'tiktok universe': 44999
};

const app = express();
app.get('/', (req, res) => res.redirect('/ruleta.html'));
app.use(express.static('public'));

app.get('/debug', (req, res) => {
  const u = String(req.query.user || '').replace('@', '').trim().toLowerCase();
  const r = rooms[u];
  if (!r) return res.json({ error: 'No hay sala', salas: Object.keys(rooms) });
  res.json({
    usuario: u,
    conectadoATikTok: !!(r.conn && r.conn.state === 'CONNECTED'),
    ultimoEstado: r.status,
    pantallas: r.clients.size,
    metodos: r.methods,
    log: r.log.slice(0, 20)
  });
});

const srv = http.createServer(app);
const wss = new WebSocketServer({ server: srv });
const rooms = {};

function room(user) {
  if (rooms[user]) return rooms[user];

  const r = rooms[user] = {
    clients: new Set(),
    conn: null,
    methods: {},
    log: [],
    status: ''
  };

  const g = {
    players: [],
    phase: 'open',
    joinEnd: 0,
    autoAt: 0,
    autoSec: 0,
    gifts: 0,
    coins: 0,
    entries: 0,
    mode: 'free',
    gift: 'Rose',
    up: false,
    sec: 60,
    au: 15,
    im: '',
    cv: 0,
    gu: {}
  };

  let joinT = null, autoT = null, busy = false;

  const send = (event, data) => {
    if (event === 'status') r.status = data.msg || '';
    const msg = JSON.stringify({ event, data });
    r.clients.forEach(c => {
      if (c.readyState === 1) c.send(msg);
    });
  };

  const state = () => {
    const { players, ...s } = g;
    send('state', { ...s, now: Date.now() });
  };

  const plist = () => send('players', { players: g.players });

  const clearTimers = () => {
    if (joinT) clearTimeout(joinT);
    if (autoT) clearTimeout(autoT);
    joinT = autoT = null;
  };

  const auto = (s) => {
    clearTimeout(autoT);
    s = +s || 0;
    g.autoSec = s;
    if (!s) {
      g.autoAt = 0;
      return state();
    }
    g.autoAt = Date.now() + s * 1000;
    state();
    autoT = setTimeout(() => {
      if (g.players.length > 1 && !busy) {
        g.autoAt = 0;
        spin();
      } else {
        auto(s);
      }
    }, s * 1000);
  };

  const open = (s) => {
    clearTimeout(joinT);
    auto(0);
    s = +s || 60;
    g.phase = 'joining';
    g.joinEnd = Date.now() + s * 1000;
    state();
    joinT = setTimeout(() => {
      g.phase = 'closed';
      auto(g.au);
    }, s * 1000);
  };

  const spin = () => {
    if (busy || !g.players.length) return;
    if (g.players.length === 1) {
      send('win', { p: g.players[0] });
      return;
    }
    busy = true;
    const t = g.players[rnd(g.players.length)];
    const life = t.lives > 1;
    send('spin', { id: t.id, life });

    const end = () => {
      busy = false;
      if (g.players.length === 1) {
        send('win', { p: g.players[0] });
        auto(0);
      } else if (g.autoSec) {
        auto(g.autoSec);
      } else {
        state();
      }
    };

    if (life) {
      setTimeout(() => {
        t.lives--;
        plist();
        setTimeout(end, 1100);
      }, 1400);
    } else {
      setTimeout(() => {
        g.players = g.players.filter(x => x !== t);
        plist();
        state();
        setTimeout(end, 1500);
      }, 1750);
    }
  };

  const add = (p, c, n = 1) => {
    if (!['open', 'joining'].includes(g.phase)) return;

    g.gifts += n;
    g.coins += c * n;
    g.entries += n;

    const ex = g.players.find(a => a.id === p.id || a.name === p.name);
    if (ex) {
      ex.lives += n;
      send('toast', { p: ex, n, k: 'add' });
    } else {
      p.lives = n;
      g.players.push(p);
      send('toast', { p, n, k: 'new' });
    }
    plist();
    state();
  };

  const cfg = (c, soft = false) => {
    if (soft && g.cv > 0) return;
    g.mode = c.mode === 'lock' ? 'lock' : 'free';
    if (c.gift !== undefined) g.gift = String(c.gift || '');
    g.up = !!c.up;
    g.im = c.im || '';
    g.sec = +c.sec || 60;
    if (c.au !== undefined) g.au = +c.au || 0;
    g.cv++;

    if (c.restart) {
      clearTimeout(joinT);
      g.joinEnd = 0;
      if (g.mode === 'lock') {
        open(g.sec);
      } else {
        g.phase = 'open';
        auto(g.au);
      }
    }
    state();
  };

  // Conexión a TikTok Live optimizada
  const connectTikTok = async () => {
    if (r.conn) return;
    await ready;

    try {
      r.conn = new Conn(user, {
        processInitialData: false,
        enableExtendedGiftInfo: true,
        requestPollingIntervalMs: 2000,
        signApiKey: process.env.EULER_API_KEY || process.env.SIGN_API_KEY || ''
      });

      r.conn.on('connected', () => {
        send('status', { ok: true, msg: 'Conectado a TikTok Live de @' + user });
        r.methods.connected = (r.methods.connected || 0) + 1;
      });

      r.conn.on('disconnected', () => {
        send('status', { ok: false, msg: 'Desconectado de TikTok' });
        r.conn = null;
      });

      r.conn.on('error', err => {
        send('status', { ok: false, msg: 'Error TikTok: ' + (err?.message || err) });
      });

      r.conn.on('gift', data => {
        r.methods.gift = (r.methods.gift || 0) + 1;

        const giftName = (data.giftName || data.extendedGiftInfo?.name || '').toLowerCase().trim();
        const coins = COINS[giftName] || data.diamondCount || 1;
        const nickname = data.nickname || data.uniqueId || 'Anónimo';
        const uniqueId = data.uniqueId || data.userId || nickname;
        const avatar = data.profilePictureUrl || data.user?.profilePictureUrl || '';
        const count = data.repeatCount || 1;

        r.log.unshift({ t: Date.now(), user: nickname, gift: giftName, coins, count });
        if (r.log.length > 40) r.log.pop();

        const configured = (g.gift || '').toLowerCase().trim();
        let canEnter = false;

        if (g.mode === 'free') {
          canEnter = true;
        } else {
          if (!configured) {
            canEnter = true;
          } else if (giftName === configured) {
            canEnter = true;
          } else if (g.up) {
            const configuredCoins = COINS[configured] || 0;
            if (coins >= configuredCoins && configuredCoins > 0) canEnter = true;
          }
        }

        if (canEnter) {
          const player = {
            id: uniqueId,
            name: nickname,
            avatar
          };
          add(player, coins, count);
        }

        state();
      });

      r.conn.on('chat', () => { r.methods.chat = (r.methods.chat || 0) + 1; });
      r.conn.on('member', () => { r.methods.member = (r.methods.member || 0) + 1; });

      await r.conn.connect();
    } catch (err) {
      send('status', { ok: false, msg: 'No se pudo conectar a TikTok: ' + (err?.message || err) });
      r.conn = null;
    }
  };

  r.join = (ws) => {
    r.clients.add(ws);
    state();
    plist();
    if (r.status) send('status', { ok: true, msg: r.status });
  };

  r.leave = (ws) => {
    r.clients.delete(ws);
  };

  r.handle = async (raw) => {
    try {
      const msg = JSON.parse(raw);
      const cmd = msg.cmd;

      switch (cmd) {
        case 'cfg':
          cfg(msg, msg.soft);
          if (!r.conn) await connectTikTok();
          break;
        case 'open':
          open(msg.sec || g.sec);
          break;
        case 'auto':
          auto(msg.sec);
          break;
        case 'spin':
          spin();
          break;
        case 'reset':
          g.players = [];
          g.gifts = g.coins = g.entries = 0;
          cfg({ ...g, restart: true });
          plist();
          break;
        case 'test':
          break;
        default:
          break;
      }
    } catch (e) {
      console.error('handle error:', e.message);
    }
  };

  g.phase = 'open';
  state();

  return r;
}

wss.on('connection', (ws, req) => {
  const params = url.parse(req.url, true).query;
  const user = String(params.user || '').replace('@', '').trim().toLowerCase();

  if (!user) {
    ws.close();
    return;
  }

  const currentRoom = room(user);
  currentRoom.join(ws);

  if (!currentRoom.conn) {
    currentRoom.handle(JSON.stringify({ cmd: 'cfg', soft: true }));
  }

  ws.on('message', (raw) => {
    currentRoom.handle(raw.toString());
  });

  ws.on('close', () => {
    currentRoom.leave(ws);
  });
});

const PORT = process.env.PORT || 3000;
srv.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
