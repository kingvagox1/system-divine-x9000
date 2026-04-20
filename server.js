const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

// ─── Archivos estáticos ────────────────────────────────────────────────────────
app.use(express.static(__dirname));

// ─── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;

// ─── Estado global ─────────────────────────────────────────────────────────────
let tiktokConnection  = null;
let usuarioActual     = null;
let reconectando      = false;
let intentosReconexion = 0;
const MAX_INTENTOS    = 5;

// Acumuladores de sesión
let totalLikes     = 0;
let totalViewers   = 0;
let totalDiamantes = 0;
let totalGifts     = 0;
let totalFollows   = 0;
let totalMensajes  = 0;

function resetStats() {
  totalLikes = 0; totalViewers = 0; totalDiamantes = 0;
  totalGifts = 0; totalFollows = 0; totalMensajes  = 0;
}

// ─── CONEXIÓN TIKTOK ──────────────────────────────────────────────────────────
function conectarTikTok(username) {
  if (tiktokConnection) {
    try { tiktokConnection.disconnect(); } catch(e) {}
    tiktokConnection = null;
  }

  usuarioActual = username;
  reconectando  = false;
  resetStats();

  console.log(`\n🔗 Conectando a @${username}...`);

  tiktokConnection = new WebcastPushConnection(username, {
    processInitialData: true,   // recibe datos del estado actual del live
    enableExtendedGiftInfo: true,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 2000,
    clientParams: {
      app_language: 'es',
      device_platform: 'web'
    }
  });

  tiktokConnection.connect()
    .then(state => {
      intentosReconexion = 0;
      console.log(`✅ Conectado a @${username} | Room: ${state.roomId} | Viewers: ${state.viewerCount}`);
      io.emit('estado', {
        conectado: true,
        usuario:   username,
        roomId:    state.roomId,
        viewers:   state.viewerCount || 0
      });
      // Enviar stats iniciales
      io.emit('stats', {
        viewers:    state.viewerCount   || 0,
        likes:      state.likeCount     || 0,
        diamantes:  totalDiamantes,
        follows:    totalFollows,
        gifts:      totalGifts,
        mensajes:   totalMensajes
      });
    })
    .catch(err => {
      console.error(`❌ Error conectando @${username}: ${err.message}`);
      io.emit('estado', { conectado: false, error: err.message });
      intentarReconexion();
    });

  // ── CHAT ──────────────────────────────────────────────────────────────────
  tiktokConnection.on('chat', data => {
    totalMensajes++;
    io.emit('evento', {
      tipo:      'chat',
      usuario:   data.uniqueId    || 'usuario',
      nombre:    data.nickname    || data.uniqueId || 'usuario',
      texto:     data.comment     || '',
      avatar:    data.profilePictureUrl || '',
      rol:       data.isModerator ? 'mod' : (data.isSubscriber ? 'vip' : 'normal'),
      seguidores: data.followRole  || 0   // 0=no sigue, 1=sigue, 2=amigos
    });
  });

  // ── NUEVOS VIEWERS (member join) ──────────────────────────────────────────
  tiktokConnection.on('member', data => {
    io.emit('evento', {
      tipo:    'join',
      usuario: data.uniqueId   || 'usuario',
      nombre:  data.nickname   || data.uniqueId || 'usuario',
      avatar:  data.profilePictureUrl || ''
    });
    console.log(`👤 Entró: @${data.uniqueId}`);
  });

  // ── FOLLOWS ───────────────────────────────────────────────────────────────
  tiktokConnection.on('follow', data => {
    totalFollows++;
    io.emit('evento', {
      tipo:    'follow',
      usuario: data.uniqueId  || 'usuario',
      nombre:  data.nickname  || data.uniqueId || 'usuario',
      avatar:  data.profilePictureUrl || ''
    });
    io.emit('stats', { follows: totalFollows });
    console.log(`❤️  Follow: @${data.uniqueId}`);
  });

  // ── LIKES ─────────────────────────────────────────────────────────────────
  tiktokConnection.on('like', data => {
    totalLikes = data.totalLikeCount || (totalLikes + (data.likeCount || 1));
    io.emit('evento', {
      tipo:    'like',
      usuario: data.uniqueId  || 'usuario',
      nombre:  data.nickname  || data.uniqueId || 'usuario',
      likes:   data.likeCount || 1,
      total:   totalLikes
    });
    io.emit('stats', { likes: totalLikes });
  });

  // ── GIFTS ─────────────────────────────────────────────────────────────────
  tiktokConnection.on('gift', data => {
    // Ignorar gifts en combo que aún no terminan (tipo 1 = repetible)
    if (data.giftType === 1 && !data.repeatEnd) return;

    const cantidad   = data.repeatCount  || 1;
    const diamantes  = (data.diamondCount || 0) * cantidad;
    totalDiamantes  += diamantes;
    totalGifts++;

    io.emit('evento', {
      tipo:       'gift',
      usuario:    data.uniqueId   || 'usuario',
      nombre:     data.nickname   || data.uniqueId || 'usuario',
      avatar:     data.profilePictureUrl || '',
      regalo:     data.giftName   || 'Regalo',
      giftId:     data.giftId     || 0,
      cantidad,
      diamantes,
      totalDiamantes
    });
    io.emit('stats', { diamantes: totalDiamantes, gifts: totalGifts });
    console.log(`🎁 Gift: @${data.uniqueId} → ${cantidad}x ${data.giftName} (💎${diamantes})`);
  });

  // ── SHARE (compartir el live) ─────────────────────────────────────────────
  tiktokConnection.on('share', data => {
    io.emit('evento', {
      tipo:    'share',
      usuario: data.uniqueId  || 'usuario',
      nombre:  data.nickname  || data.uniqueId || 'usuario',
      avatar:  data.profilePictureUrl || ''
    });
    console.log(`🔗 Share: @${data.uniqueId}`);
  });

  // ── SUBSCRIBE (suscripción) ───────────────────────────────────────────────
  tiktokConnection.on('subscribe', data => {
    io.emit('evento', {
      tipo:    'subscribe',
      usuario: data.uniqueId  || 'usuario',
      nombre:  data.nickname  || data.uniqueId || 'usuario',
      avatar:  data.profilePictureUrl || ''
    });
    console.log(`⭐ Subscribe: @${data.uniqueId}`);
  });

  // ── VIEWERS EN TIEMPO REAL ────────────────────────────────────────────────
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

  // ── STREAM TERMINADO ──────────────────────────────────────────────────────
  tiktokConnection.on('streamEnd', data => {
    console.log(`📴 Stream terminado: @${usuarioActual}`);
    io.emit('estado', { conectado: false, error: 'El live terminó' });
    io.emit('streamEnd', { usuario: usuarioActual });
  });

  // ── DESCONEXIÓN ───────────────────────────────────────────────────────────
  tiktokConnection.on('disconnected', () => {
    console.log(`🔌 Desconectado de @${usuarioActual}`);
    if (!reconectando) {
      io.emit('estado', { conectado: false, error: 'Desconectado' });
      intentarReconexion();
    }
  });

  // ── ERRORES ───────────────────────────────────────────────────────────────
  tiktokConnection.on('error', err => {
    console.error(`⚠️  Error TikTok: ${err.message || err}`);
    io.emit('error_tiktok', { mensaje: err.message || 'Error desconocido' });
  });
}

// ─── RECONEXIÓN AUTOMÁTICA ────────────────────────────────────────────────────
function intentarReconexion() {
  if (!usuarioActual || reconectando) return;
  if (intentosReconexion >= MAX_INTENTOS) {
    console.log(`❌ Máximo de intentos alcanzado para @${usuarioActual}`);
    io.emit('estado', { conectado: false, error: `No se pudo reconectar después de ${MAX_INTENTOS} intentos` });
    return;
  }

  reconectando = true;
  intentosReconexion++;
  const espera = Math.min(5000 * intentosReconexion, 30000); // 5s, 10s, 15s... máx 30s

  console.log(`🔄 Reconectando en ${espera/1000}s... (intento ${intentosReconexion}/${MAX_INTENTOS})`);
  io.emit('reconectando', { intento: intentosReconexion, max: MAX_INTENTOS, espera: espera/1000 });

  setTimeout(() => {
    reconectando = false;
    conectarTikTok(usuarioActual);
  }, espera);
}

// ─── RUTAS ────────────────────────────────────────────────────────────────────
app.get('/estado', (req, res) => {
  res.json({
    conectado:     !!tiktokConnection,
    usuario:       usuarioActual,
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

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`🖥️  Panel conectado (${io.engine.clientsCount} total)`);

  // Enviar estado actual al nuevo cliente
  if (tiktokConnection && usuarioActual) {
    socket.emit('estado', { conectado: true, usuario: usuarioActual });
    socket.emit('stats', {
      viewers:   totalViewers,
      likes:     totalLikes,
      diamantes: totalDiamantes,
      follows:   totalFollows,
      gifts:     totalGifts,
      mensajes:  totalMensajes
    });
  }

  socket.on('cambiarUsuario', username => {
    const user = username.replace('@', '').trim();
    if (!user) return;
    console.log(`🔄 Cambio de usuario: @${user}`);
    intentosReconexion = 0;
    conectarTikTok(user);
  });

  socket.on('desconectar', () => {
    usuarioActual = null;
    intentosReconexion = MAX_INTENTOS; // evita reconexión
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch(e) {}
      tiktokConnection = null;
    }
    console.log('🔌 Desconectado manualmente');
    io.emit('estado', { conectado: false, error: null });
  });

  socket.on('disconnect', () => {
    console.log(`🖥️  Panel desconectado (${io.engine.clientsCount} restantes)`);
  });
});

// ─── ARRANCAR ─────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║      SYSTEM DIVINE X-9000  🔥            ║');
  console.log(`║   http://localhost:${PORT}                  ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  if (process.env.TIKTOK_USER && process.env.TIKTOK_USER !== 'PON_TU_USUARIO_AQUI') {
    conectarTikTok(process.env.TIKTOK_USER);
  }
});
