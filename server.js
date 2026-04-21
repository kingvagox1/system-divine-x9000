const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['polling', 'websocket']
});

// ─── Archivos estáticos ────────────────────────────────────────────────────────
app.use(express.static(__dirname));
app.use(express.json());

const PORT = process.env.PORT || 8080;

// ─── Estado global ─────────────────────────────────────────────────────────────
let tiktokConnection   = null;
let usuarioActual      = null;
let reconectando       = false;
let intentosReconexion = 0;
const MAX_INTENTOS     = 5;

let totalLikes     = 0;
let totalViewers   = 0;
let totalDiamantes = 0;
let totalGifts     = 0;
let totalFollows   = 0;
let totalMensajes  = 0;

// Historial de los últimos 100 eventos para nuevos clientes
const historialEventos = [];
function guardarEvento(evento) {
  historialEventos.push({ ...evento, ts: Date.now() });
  if (historialEventos.length > 100) historialEventos.shift();
}

function resetStats() {
  totalLikes = 0; totalViewers = 0; totalDiamantes = 0;
  totalGifts = 0; totalFollows = 0; totalMensajes  = 0;
  historialEventos.length = 0;
}

// ─── CONECTAR TIKTOK ──────────────────────────────────────────────────────────
function conectarTikTok(username) {
  if (tiktokConnection) {
    try { tiktokConnection.disconnect(); } catch(e) {}
    tiktokConnection = null;
  }

  usuarioActual = username;
  reconectando  = false;
  resetStats();

  console.log(`\n🔗 Conectando a @${username}...`);

  tiktokConnection = new WebcastPushConnection(username);

  tiktokConnection.connect()
    .then(state => {
      intentosReconexion = 0;
      console.log(`✅ Conectado a @${username} | Room: ${state.roomId}`);

      io.emit('estado', {
        conectado: true,
        usuario:   username,
        roomId:    state.roomId || ''
      });

      // Stats iniciales del live
      const statsIniciales = {
        viewers:   state.viewerCount || 0,
        likes:     state.likeCount   || 0,
        diamantes: 0,
        follows:   0,
        gifts:     0,
        mensajes:  0
      };
      io.emit('stats', statsIniciales);
    })
    .catch(err => {
      const msg = err.message || String(err);
      console.error(`❌ Error conectando @${username}: ${msg}`);

      let errorClaro = msg;
      if (msg.toLowerCase().includes('live') || msg.toLowerCase().includes('offline')) {
        errorClaro = `@${username} no está en vivo ahora mismo`;
      } else if (msg.includes('not found') || msg.includes('404') || msg.includes('User not found')) {
        errorClaro = `Usuario @${username} no encontrado en TikTok`;
      } else if (msg.includes('rate limit') || msg.includes('429')) {
        errorClaro = 'Demasiadas peticiones, espera un momento';
      } else if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
        errorClaro = 'Sin conexión a internet';
      }

      io.emit('estado', { conectado: false, error: errorClaro });

      const noReconectar = msg.includes('not found') || msg.includes('404') || msg.includes('User not found');
      if (!noReconectar) intentarReconexion();
    });

  // ── CHAT ──────────────────────────────────────────────────────────────────
  tiktokConnection.on('chat', data => {
    if (!data.comment || data.comment.trim() === '') return; // ignorar mensajes vacíos
    totalMensajes++;
    const evento = {
      tipo:    'chat',
      usuario: data.uniqueId || 'usuario',
      nombre:  data.nickname || data.uniqueId || 'usuario',
      texto:   data.comment.trim(),
      avatar:  data.profilePictureUrl || '',
      rol:     data.isModerator ? 'mod' : (data.isSubscriber ? 'vip' : 'normal')
    };
    guardarEvento(evento);
    io.emit('evento', evento);
  });

  // ── MEMBER JOIN ───────────────────────────────────────────────────────────
  tiktokConnection.on('member', data => {
    const evento = {
      tipo:    'join',
      usuario: data.uniqueId || 'usuario',
      nombre:  data.nickname || data.uniqueId || 'usuario',
      avatar:  data.profilePictureUrl || ''
    };
    guardarEvento(evento);
    io.emit('evento', evento);
    console.log(`👤 Entró: @${data.uniqueId}`);
  });

  // ── FOLLOW ────────────────────────────────────────────────────────────────
  tiktokConnection.on('follow', data => {
    totalFollows++;
    const evento = {
      tipo:    'follow',
      usuario: data.uniqueId || 'usuario',
      nombre:  data.nickname || data.uniqueId || 'usuario',
      avatar:  data.profilePictureUrl || ''
    };
    guardarEvento(evento);
    io.emit('evento', evento);
    io.emit('stats', { follows: totalFollows });
    console.log(`❤️  Follow: @${data.uniqueId}`);
  });

  // ── LIKE ──────────────────────────────────────────────────────────────────
  tiktokConnection.on('like', data => {
    totalLikes = data.totalLikeCount || (totalLikes + (data.likeCount || 1));
    const evento = {
      tipo:    'like',
      usuario: data.uniqueId || 'usuario',
      nombre:  data.nickname || data.uniqueId || 'usuario',
      likes:   data.likeCount || 1,
      total:   totalLikes
    };
    io.emit('evento', evento);
    io.emit('stats', { likes: totalLikes });
  });

  // ── GIFT ──────────────────────────────────────────────────────────────────
  tiktokConnection.on('gift', data => {
    if (data.giftType === 1 && !data.repeatEnd) return;

    const cantidad  = data.repeatCount  || 1;
    const diamantes = (data.diamondCount || 0) * cantidad;
    totalDiamantes += diamantes;
    totalGifts++;

    const evento = {
      tipo:          'gift',
      usuario:       data.uniqueId || 'usuario',
      nombre:        data.nickname || data.uniqueId || 'usuario',
      avatar:        data.profilePictureUrl || '',
      regalo:        data.giftName || 'Regalo',
      cantidad,
      diamantes,
      totalDiamantes
    };
    guardarEvento(evento);
    io.emit('evento', evento);
    io.emit('stats', { diamantes: totalDiamantes, gifts: totalGifts });
    console.log(`🎁 @${data.uniqueId} → ${cantidad}x ${data.giftName} (💎${diamantes})`);
  });

  // ── SHARE ─────────────────────────────────────────────────────────────────
  tiktokConnection.on('share', data => {
    const evento = {
      tipo:    'share',
      usuario: data.uniqueId || 'usuario',
      nombre:  data.nickname || data.uniqueId || 'usuario',
      avatar:  data.profilePictureUrl || ''
    };
    guardarEvento(evento);
    io.emit('evento', evento);
    console.log(`🔗 Share: @${data.uniqueId}`);
  });

  // ── SUBSCRIBE ─────────────────────────────────────────────────────────────
  tiktokConnection.on('subscribe', data => {
    const evento = {
      tipo:    'subscribe',
      usuario: data.uniqueId || 'usuario',
      nombre:  data.nickname || data.uniqueId || 'usuario',
      avatar:  data.profilePictureUrl || ''
    };
    guardarEvento(evento);
    io.emit('evento', evento);
    console.log(`⭐ Subscribe: @${data.uniqueId}`);
  });

  // ── VIEWERS ───────────────────────────────────────────────────────────────
  tiktokConnection.on('roomUser', data => {
    totalViewers = data.viewerCount || 0;
    io.emit('stats', {
      viewers:   totalViewers,
      likes:     totalLikes,
      diamantes: totalDiamantes,
      follows:   totalFollows,
      gifts:     totalGifts,
      mensajes:  totalMensajes
    });
  });

  // ── STREAM END ────────────────────────────────────────────────────────────
  tiktokConnection.on('streamEnd', () => {
    console.log(`📴 Stream terminado: @${usuarioActual}`);
    io.emit('estado', { conectado: false, error: 'El live terminó' });
    io.emit('streamEnd', { usuario: usuarioActual });
    tiktokConnection = null;
  });

  // ── DESCONEXIÓN ───────────────────────────────────────────────────────────
  tiktokConnection.on('disconnected', () => {
    console.log(`🔌 Desconectado de @${usuarioActual}`);
    if (!reconectando) {
      io.emit('estado', { conectado: false, error: 'Desconectado del live' });
      intentarReconexion();
    }
  });

  // ── ERROR ─────────────────────────────────────────────────────────────────
  tiktokConnection.on('error', err => {
    console.error(`⚠️  Error TikTok: ${err.message || err}`);
    io.emit('error_tiktok', { mensaje: err.message || 'Error desconocido' });
  });
}

// ─── RECONEXIÓN AUTOMÁTICA ────────────────────────────────────────────────────
function intentarReconexion() {
  if (!usuarioActual || reconectando) return;
  if (intentosReconexion >= MAX_INTENTOS) {
    console.log(`❌ Máximo de intentos para @${usuarioActual}`);
    io.emit('estado', { conectado: false, error: `No se pudo reconectar (${MAX_INTENTOS} intentos)` });
    return;
  }
  reconectando = true;
  intentosReconexion++;
  const espera = Math.min(5000 * intentosReconexion, 30000);
  console.log(`🔄 Reconectando en ${espera/1000}s... (${intentosReconexion}/${MAX_INTENTOS})`);
  io.emit('reconectando', { intento: intentosReconexion, max: MAX_INTENTOS, espera: espera/1000 });
  setTimeout(() => { reconectando = false; conectarTikTok(usuarioActual); }, espera);
}

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`🖥️  Panel conectado (total: ${io.engine.clientsCount})`);

  // Enviar estado actual al nuevo cliente que se conecta
  if (usuarioActual) {
    const conectado = !!tiktokConnection;
    socket.emit('estado', { conectado, usuario: usuarioActual });
    socket.emit('stats', {
      viewers:   totalViewers,
      likes:     totalLikes,
      diamantes: totalDiamantes,
      follows:   totalFollows,
      gifts:     totalGifts,
      mensajes:  totalMensajes
    });
    // Enviar historial reciente al nuevo cliente
    if (historialEventos.length > 0) {
      socket.emit('historial', historialEventos.slice(-30));
    }
  }

  socket.on('cambiarUsuario', username => {
    const user = (username || '').replace('@', '').trim();
    if (!user) return;
    console.log(`🔄 Conectar a: @${user}`);
    intentosReconexion = 0;
    conectarTikTok(user);
  });

  socket.on('desconectar', () => {
    intentosReconexion = MAX_INTENTOS;
    usuarioActual = null;
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch(e) {}
      tiktokConnection = null;
    }
    console.log('🔌 Desconectado manualmente');
    io.emit('estado', { conectado: false, error: null });
  });

  socket.on('disconnect', () => {
    console.log(`🖥️  Panel desconectado (restantes: ${io.engine.clientsCount})`);
  });
});

// ─── RUTAS API ────────────────────────────────────────────────────────────────
app.get('/estado', (req, res) => {
  res.json({
    conectado: !!tiktokConnection,
    usuario:   usuarioActual,
    stats: {
      viewers:   totalViewers,
      likes:     totalLikes,
      diamantes: totalDiamantes,
      follows:   totalFollows,
      gifts:     totalGifts,
      mensajes:  totalMensajes
    }
  });
});

app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ─── ARRANCAR ─────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║   SYSTEM DIVINE X-9000  🔥       ║`);
  console.log(`║   Puerto: ${PORT}                   ║`);
  console.log(`╚══════════════════════════════════╝\n`);

  if (process.env.TIKTOK_USER) {
    conectarTikTok(process.env.TIKTOK_USER);
  }
});

// ─── MANEJO DE ERRORES GLOBALES ───────────────────────────────────────────────
process.on('uncaughtException', err => {
  console.error('💥 Error no capturado:', err.message);
});
process.on('unhandledRejection', err => {
  console.error('💥 Promesa rechazada:', err);
});
