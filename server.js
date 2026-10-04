const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir la carpeta 'public' donde está tu diseño web
app.use(express.static('public'));

let tiktokLiveConnection = null;

io.on('connection', (socket) => {
    console.log('Cliente conectado a la interfaz de la ruleta.');

    // Recibe el nombre de usuario de TikTok desde la web y se conecta
    socket.on('set-unique-id', (uniqueId) => {
        console.log(`Conectando al directo de TikTok: @${uniqueId}`);

        if (tiktokLiveConnection) {
            tiktokLiveConnection.disconnect();
        }

        // Configuración de conexión optimizada
        tiktokLiveConnection = new WebcastPushConnection(uniqueId, {
            processInitialData: true,
            enableWebsocketUpgrade: true,
            requestPollingIntervalMs: 2000
        });

        tiktokLiveConnection.connect().then(state => {
            console.log(`¡Conectado con éxito a @${uniqueId} (Room ID: ${state.roomId})!`);
            socket.emit('connected', `Conectado correctamente a @${uniqueId}`);
        }).catch(err => {
            console.error('Error al conectar con TikTok:', err);
            socket.emit('error-msg', 'No se pudo conectar. Asegúrate de que la cuenta esté en directo ahora mismo.');
        });

        // Evento clave: cuando envían un regalo
        tiktokLiveConnection.on('gift', data => {
            console.log(`¡Regalo recibido! ${data.nickname} envió ${data.giftName} (x${data.repeatCount})`);
            
            // Envía los datos del regalo a todas las pantallas web conectadas
            io.emit('gift-update', {
                username: data.uniqueId,
                nickname: data.nickname,
                giftName: data.giftName,
                repeatCount: data.repeatCount,
                diamondCount: data.diamondCount || 1,
                profilePictureUrl: data.profilePictureUrl
            });
        });
    });

    socket.on('disconnect', () => {
        console.log('Cliente desconectado.');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de la ruleta activo en el puerto ${PORT}`);
});
