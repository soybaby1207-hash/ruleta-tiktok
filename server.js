process.on('uncaughtException', e => console.error('uncaught', e && e.message));
process.on('unhandledRejection', e => console.error('unhandled', e && e.message || e));

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
app.get('/', (q, r) => r.redirect('/ruleta.html'));
app.use(express.static('public'));

app.get('/debug', (q, res) => {
  const u = String(q.query.user || '').replace('@', '').trim().toLowerCase();
  const r = rooms[u];
  if (!r) return res.json({
    error: 'No hay sala para ' + u + '. Abre la pagina, escribe el usuario y pulsa Conectar primero.',
    salas: Object.keys(rooms)
  });
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
    r.clients.forEach(c => c.readyState === 1 && c.send(m));
  };

  const state = () => {
    const { players, ...s } = g;
    send('state', { ...s, now: Date.now() });
  };
