const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir los archivos estáticos de tu carpeta 'public' (donde está ruleta.html)
app.use(express.static('public'));

// Almacenar la conexión actual de TikTok Live
let tiktokLiveConnection = null;

io.on('connection', (socket) => {
    console.log('Un cliente se ha conectado a la interfaz web.');

    // El usuario escribe su usuario de TikTok desde la web y se conecta
    socket.on('set-unique-id', (uniqueId) => {
        console.log(`Intentando conectar con el directo de: @${uniqueId}`);

        if (tiktokLiveConnection) {
            tiktokLiveConnection.disconnect();
        }

        // Creamos la conexión sin requerir servicios de firma externos de pago
        tiktokLiveConnection = new WebcastPushConnection(uniqueId, {
            processInitialData: true,
            enableWebsocketUpgrade: true,
            requestPollingIntervalMs: 2000
        });

        tiktokLiveConnection.connect().then(state => {
            console.log(`Conectado exitosamente al directo de @${uniqueId} (Room ID: ${state.roomId})`);
            socket.emit('connected', `Conectado correctamente a @${uniqueId}`);
        }).catch(err => {
            console.error('Error al conectar con TikTok Live:', err);
            socket.emit('error-msg', 'No se pudo conectar al directo. Comprueba que el usuario esté en directo ahora mismo.');
        });

        // Escuchar cuando alguien envía un regalo
        tiktokLiveConnection.on('gift', data => {
            console.log(`¡Regalo recibido! ${data.nickname} envió ${data.giftName} (x${data.repeatCount})`);
            
            // Reenviamos los datos del regalo a todas las pantallas web conectadas
            io.emit('gift-update', {
                username: data.uniqueId,
                nickname: data.nickname,
                giftName: data.giftName,
                repeatCount: data.repeatCount,
                diamondCount: data.diamondCount || 1,
                profilePictureUrl: data.profilePictureUrl
            });
        });

        // Escuchar cuando alguien comenta (por si quieres usarlo también)
        tiktokLiveConnection.on('chat', data => {
            io.emit('chat-update', {
                username: data.uniqueId,
                comment: data.comment
            });
        });
    });

    socket.on('disconnect', () => {
        console.log('Un cliente se desconectó de la interfaz.');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
