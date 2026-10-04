process.on('uncaughtException', e => console.error('uncaught', e && e.message));
process.on('unhandledRejection', e => console.error('unhandled', e && (e.message || e)));

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

let Conn;
const ready = import('tiktok-live-connector/legacy').then(m => {
  Conn = m.WebcastPushConnection;
});

const KEY = process.env.EULER_API_KEY || undefined;

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
app.get('/', (req, res) => res.redirect('/ruleta.html'));
app.use(express.static('public'));

app.get('/debug', (req, res) => {
  const u = String(req.query.user || '').replace('@', '').trim().toLowerCase();
  const r = rooms[u];
  if (!r) {
    return res.json({
      error: 'No hay sala para ' + u + '. Abre la página, escribe el usuario y pulsa Conectar primero.',
      salas: Object.keys(rooms)
    });
  }
  res.json({
    usuario: u,
    conectadoATikTok: !!(r.conn && r.conn.isConnected),
    ultimoEstado: r.status,
    pantallasConectadas: r.clients.size,
    mensajesRecibidosDeTikTok: r.methods,
    registroDeRegalos: r.log
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
    dead: false,
    configured: false,
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

  let joinT, autoT, busy = false;

  const send = (event, data) => {
    if (event === 'status') r.status = data.msg;
    const m = JSON.stringify({ event, data });
    r.clients.forEach(c => {
      if (c.readyState === 1) c.send(m);
    });
  };

  const state = () => {
    const { players, ...s } = g;
    send('state', { ...s, now: Date.now() });
  };

  const broadcastPlayers = () => {
    send('players', g.players);
  };

  const clearTimers = () => {
    if (joinT) clearTimeout(joinT);
    if (autoT) clearTimeout(autoT);
    joinT = autoT = null;
  };

  const startJoin = () => {
    clearTimers();
    g.phase = 'open';
    g.joinEnd = Date.now() + g.sec * 1000;
    g.autoAt = 0;
    g.autoSec = 0;
    state();
    joinT = setTimeout(() => {
      if (g.phase === 'open') startAuto();
    }, g.sec * 1000);
  };

  const startAuto = () => {
    clearTimers();
    g.phase = 'auto';
    g.autoAt = Date.now();
    g.autoSec = g.au;
    state();
    autoT = setTimeout(() => {
      if (g.phase === 'auto') {
        g.phase = 'closed';
        state();
      }
    }, g.au * 1000);
  };

  const addPlayer = (name, avatar, entries = 1) => {
    const existing = g.players.find(p => p.name === name);
    if (existing) {
      existing.entries += entries;
    } else {
      g.players.push({
        id: 'p' + crypto.randomUUID(),
        name,
        avatar: avatar || `https://randomuser.me/api/portraits/${rnd(2) ? 'women' : 'men'}/${rnd(99)}.jpg`,
        entries
      });
    }
    g.entries = g.players.reduce((sum, p) => sum + p.entries, 0);
    broadcastPlayers();
    state();
  };

  const connectTikTok = async () => {
    if (r.conn) return;
    await ready;

    try {
      r.conn = new Conn(user, {
        processInitialData: false,
        enableExtendedGiftInfo: true,
        requestPollingIntervalMs: 2000
      });

      r.conn.on('connected', () => {
        send('status', { msg: 'Conectado a TikTok Live' });
        r.methods.connected = (r.methods.connected || 0) + 1;
      });

      r.conn.on('disconnected', () => {
        send('status', { msg: 'Desconectado de TikTok' });
        r.conn = null;
      });

      r.conn.on('error', err => {
        send('status', { msg: 'Error TikTok: ' + (err?.message || err) });
      });

      r.conn.on('gift', data => {
        r.methods.gift = (r.methods.gift || 0) + 1;

        const giftName = (data.giftName || data.extendedGiftInfo?.name || '').toLowerCase();
        const coins = COINS[giftName] || data.diamondCount || 1;
        const uniqueId = data.uniqueId || data.userId || 'anon';
        const nickname = data.nickname || data.uniqueId || 'Anónimo';
        const avatar = data.profilePictureUrl || data.user?.profilePictureUrl;

        r.log.unshift({
          t: Date.now(),
          user: nickname,
          gift: giftName,
          coins,
          count: data.repeatCount || 1
        });
        if (r.log.length > 50) r.log.pop();

        g.gifts += (data.repeatCount || 1);
        g.coins += coins * (data.repeatCount || 1);

        // Modo free → cualquiera puede entrar
        // Modo gift → solo el regalo configurado
        if (g.mode === 'free' || giftName === g.gift.toLowerCase()) {
          const entries = Math.max(1, Math.floor(coins / 1)); // 1 entry por coin (ajusta si quieres)
          addPlayer(nickname, avatar, entries * (data.repeatCount || 1));
        }

        state();
      });

      r.conn.on('chat', data => {
        r.methods.chat = (r.methods.chat || 0) + 1;
        // Puedes añadir lógica de comandos aquí si quieres
      });

      r.conn.on('member', data => {
        r.methods.member = (r.methods.member || 0) + 1;
      });

      await r.conn.connect();
    } catch (err) {
      send('status', { msg: 'No se pudo conectar: ' + (err?.message || err) });
      r.conn = null;
    }
  };

  // Configuración inicial de la sala
  const configure = (cfg = {}) => {
    if (cfg.mode) g.mode = cfg.mode;
    if (cfg.gift) g.gift = cfg.gift;
    if (cfg.sec) g.sec = Number(cfg.sec) || 60;
    if (cfg.au) g.au = Number(cfg.au) || 15;
    if (cfg.im) g.im = cfg.im;
    r.configured = true;
    state();
  };

  // API pública de la sala
  r.join = (ws) => {
    r.clients.add(ws);
    ws.send(JSON.stringify({ event: 'state', data: { ...g, players: undefined, now: Date.now() } }));
    ws.send(JSON.stringify({ event: 'players', data: g.players }));
    if (r.status) ws.send(JSON.stringify({ event: 'status', data: { msg: r.status } }));
  };

  r.leave = (ws) => {
    r.clients.delete(ws);
  };

  r.handle = async (msg) => {
    try {
      const { action, data } = JSON.parse(msg);

      switch (action) {
        case 'connect':
          await connectTikTok();
          break;
        case 'config':
          configure(data);
          break;
        case 'start':
          startJoin();
          break;
        case 'stop':
          clearTimers();
          g.phase = 'closed';
          state();
          break;
        case 'reset':
          clearTimers();
          g.players = [];
          g.gifts = 0;
          g.coins = 0;
          g.entries = 0;
          g.phase = 'open';
          g.joinEnd = 0;
          g.autoAt = 0;
          broadcastPlayers();
          state();
          break;
        case 'fake':
          // Añadir jugadores falsos (útil para pruebas)
          for (let i = 0; i < (data?.count || 5); i++) {
            const f = fake();
            addPlayer(f.name, f.avatar, rnd(5) + 1);
          }
          break;
        default:
          break;
      }
    } catch (e) {
      console.error('handle error', e.message);
    }
  };

  // Iniciar en fase abierta
  startJoin();

  return r;
}

// WebSocket connections
wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentUser = null;

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Primer mensaje debe ser { user: "usuario" }
      if (msg.user && !currentRoom) {
        currentUser = String(msg.user).replace('@', '').trim().toLowerCase();
        if (!currentUser) return;

        currentRoom = room(currentUser);
        currentRoom.join(ws);
        return;
      }

      if (currentRoom) {
        await currentRoom.handle(raw.toString());
      }
    } catch (e) {
      console.error('ws message error', e.message);
    }
  });

  ws.on('close', () => {
    if (currentRoom) currentRoom.leave(ws);
  });
});

const PORT = process.env.PORT || 3000;
srv.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
