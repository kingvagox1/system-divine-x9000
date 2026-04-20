const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ─── Sirve los archivos estáticos (index.html, style.css, script.js) ──────────
app.use(express.static(__dirname));

// ─── Configuración ─────────────────────────────────────────────────────────────
const TIKTOK_USER = process.env.TIKTOK_USER || 'PON_TU_USUARIO_AQUI';
const PORT        = process.env.PORT        || 3000;

// ─── Conexión a TikTok Live ────────────────────────────────────────────────────
let tiktokConnection = null;

function conectarTikTok(username) {
  if (tiktokConnection) {
    tiktokConnection.disconnect();
  }

  tiktokConnection = new WebcastPushConnection(username);

  tiktokConnection.connect()
    .then(state => {
      console.log(`✅ Conectado a TikTok Live de @${username}`);
      console.log(`   Room ID: ${state.roomId}`);
      io.emit('estado', { conectado: true, usuario: username });
    })
    .catch(err => {
      console.error(`❌ Error al conectar con @${username}:`, err.message);
      io.emit('estado', { conectado: false, error: err.message });
    });

  // ── Mensajes del chat ────────────────────────────────────────────────────────
  tiktokConnection.on('chat', data => {
    const evento = {
      tipo:    'chat',
      usuario: data.uniqueId,
      nombre:  data.nickname,
      texto:   data.comment,
      rol:     data.isModerator ? 'mod' : (data.isSubscriber ? 'vip' : 'normal')
    };
    console.log(`💬 @${evento.usuario}: ${evento.texto}`);
    io.emit('evento', evento);
  });

  // ── Nuevos seguidores ────────────────────────────────────────────────────────
  tiktokConnection.on('follow', data => {
    const evento = {
      tipo:    'follow',
      usuario: data.uniqueId,
      nombre:  data.nickname
    };
    console.log(`❤️  Nuevo follow: @${evento.usuario}`);
    io.emit('evento', evento);
  });

  // ── Regalos (gifts) ──────────────────────────────────────────────────────────
  tiktokConnection.on('gift', data => {
    if (data.giftType === 1 && !data.repeatEnd) return; // espera el final del combo
    const evento = {
      tipo:     'gift',
      usuario:  data.uniqueId,
      nombre:   data.nickname,
      regalo:   data.giftName,
      cantidad: data.repeatCount || 1,
      diamantes: data.diamondCount * (data.repeatCount || 1)
    };
    console.log(`🎁 Regalo: @${evento.usuario} envió ${evento.cantidad}x ${evento.regalo}`);
    io.emit('evento', evento);
  });

  // ── Likes ────────────────────────────────────────────────────────────────────
  tiktokConnection.on('like', data => {
    const evento = {
      tipo:    'like',
      usuario: data.uniqueId,
      nombre:  data.nickname,
      likes:   data.likeCount
    };
    io.emit('evento', evento);
  });

  // ── Nuevos viewers ───────────────────────────────────────────────────────────
  tiktokConnection.on('member', data => {
    const evento = {
      tipo:    'join',
      usuario: data.uniqueId,
      nombre:  data.nickname
    };
    console.log(`👤 Entró: @${evento.usuario}`);
    io.emit('evento', evento);
  });

  // ── Estadísticas del stream ──────────────────────────────────────────────────
  tiktokConnection.on('roomUser', data => {
    io.emit('stats', { viewers: data.viewerCount });
  });

  // ── Desconexión ──────────────────────────────────────────────────────────────
  tiktokConnection.on('disconnected', () => {
    console.log('🔌 Desconectado de TikTok Live');
    io.emit('estado', { conectado: false, error: 'Stream terminado o desconectado' });
  });

  tiktokConnection.on('error', err => {
    console.error('⚠️  Error TikTok:', err);
  });
}

// ─── Ruta para cambiar de usuario desde el panel ──────────────────────────────
app.get('/conectar/:usuario', (req, res) => {
  const user = req.params.usuario.replace('@', '');
  conectarTikTok(user);
  res.json({ ok: true, usuario: user });
});

// ─── Socket.IO: cuando el panel se conecta ────────────────────────────────────
io.on('connection', socket => {
  console.log('🖥️  Panel conectado');
  socket.on('cambiarUsuario', username => {
    conectarTikTok(username.replace('@', ''));
  });
});

// ─── Arrancar servidor ────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   SYSTEM DIVINE X-9000  🔥           ║');
  console.log(`║   Servidor en: http://localhost:${PORT}  ║`);
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  if (TIKTOK_USER !== 'PON_TU_USUARIO_AQUI') {
    conectarTikTok(TIKTOK_USER);
  } else {
    console.log('⚠️  Pon tu usuario de TikTok en el panel o en TIKTOK_USER');
  }
});
