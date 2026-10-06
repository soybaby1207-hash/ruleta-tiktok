import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'Server';
import { TikTokLiveClient } from 'piratetok-live-js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const TIKTOK_USERNAME = 'soybaby1209'; // Tu usuario de TikTok
const tiktokClient = new TikTokLiveClient(TIKTOK_USERNAME);

let currentState = {
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
    sc: true,
    vouches: 0,
    sec: 60,
    au: 15,
    ini: 120,
    tl: true,
    batch: 1,
    vs1sec: 25,
    im: '',
    bgt: 'none',
    bgc: '#101018',
    bgu: '',
    bgk: 'img',
    bgl: true,
    bgfit: 'cover',
    bgpos: 'center',
    cv: 1,
    gu: {}
};

// Broadcast a todos los clientes conectados
function broadcast(event, data) {
    const message = JSON.stringify({ event, data });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Configurar eventos de PirateTok
tiktokClient.on('gift', (data) => {
    console. regalo recibido:, data);
    // Aquí puedes procesar la entrada de jugadores según el regalo recibido
    broadcast('toast', { p: { name: data.uniqueId, avatar: data.profilePictureUrl }, n: data.repeatCount || 1, k: 'add' });
});

tiktokClient.connect().then(() => {
    console.log(`✅ Conectado al directo de TikTok de @${TIKTOK_USERNAME}`);
}).catch(err => {
    console.error('❌ Error al conectar con PirateTok (asegúrate de estar en directo):', err.message);
});

wss.on('connection', (ws) => {
    console.log('🔗 Cliente conectado a la ruleta');
    ws.send(JSON.stringify({ event: 'state', data: currentState }));

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            if (msg.cmd === 'cfg') {
                Object.assign(currentState, msg);
                currentState.cv++;
                broadcast('state', currentState);
            }
            // Puedes añadir más comandos aquí según necesites
        } catch (e) {
            console.error('Error procesando mensaje:', e);
        }
    });
});

const PORT = process.env.PORT || 21213;
server.listen(PORT, () => {
    console.log(`🚀 Servidor funcionando en http://localhost:${PORT}`);
});
