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

app.use(express.static(__dirname));

const PORT = process.env.PORT || 8080;

// ─── Estado ───────────────────────────────────────────────────────────────────
let tiktokConnection   = null;
let usuarioActual      = null;
let reconectando       = false;
let intentosReconexion = 0;
const MAX_INTENTOS     = 5;

let totalLikes = 0, totalViewers = 0, totalDiamantes = 0;
let totalGifts = 0, totalFollows = 0, totalMensajes  = 0;

function resetStats() {
  totalLikes = 0; totalViewers = 0; totalDiamantes = 0;
  totalGifts = 0; totalFollows = 0; totalMensajes  = 0;
}

// ─── CONECTAR ─────────────────────────────────────────────────────────────────
function conectarTikTok(username) {
  // Limpiar conexión anterior
  if (tiktokConnection) {
    try { tiktokConnection.disconnect(); } catch(e) {}
    tiktokConnection = null;
  }

  usuarioActual = username;
  reconectando  = false;
  resetStats();

  console.log(`\n🔗 Conectando a @${username}...`);

  // ── v2 API: sin opciones que ya no existen ────────────────────────────────
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

      io.emit('stats', {
        viewers:   state.viewerCount   || 0,
        likes:     state.likeCount     || 0,
        diamantes: 0,
        follows:   0,
        gifts:     0,
        mensajes:  0
      });
    })
    .catch(err => {
      const msg = err.message || String(err);
      console.error(`❌ Error conectando @${username}: ${msg}`);

      // Mensajes de error claros para el usuario
      let errorClaro = msg;
      if (msg.includes('LIVE') || msg.includes('live') || msg.includes('offline')) {
        errorClaro = `@${username} no está en vivo ahora mismo`;
      } else if (msg.includes('not found') || msg.includes('404')) {
        errorClaro = `Usuario @${username} no encontrado`;
      } else if (msg.includes('rate limit') || msg.includes('429')) {
        errorClaro = 'Demasiadas peticiones, espera un momento';
      }

      io.emit('estado', { conectado: false, error: errorClaro });
      // Solo reconectar si fue un error de red, no si el usuario no existe
      if (!msg.includes('not found') && !msg.includes('404')) {
        intentarReconexion();
      }
    });

  // ── CHAT ──────────────────────────────────────────────────────────────────
  tiktokConnection.on('chat', data => {
    totalMensajes++;
    io.emit('evento', {
      tipo:    'chat',
      usuario: data.uniqueId || 'usuario',
      nombre:  data.nickname || data.uniqueId || 'usuario',
      texto:   data.comment  || '',
      avatar:  data.profilePictureUrl || '',
      rol:     data.isModerator ? 'mod' : (data.isSubscriber ? 'vip' : 'normal')
    });
  });

  // ── MEMBER JOIN ───────────────────────────────────────────────────────────
  tiktokConnection.on('member', data => {
    io.emit('evento', {
      tipo:    'join',
      usuario: data.uniqueId || 'usuario',
      nombre:  data.nickname || data.uniqueId || 'usuario',
      avatar:  data.profilePictureUrl || ''
    });
    console.log(`👤 Entró: @${data.uniqueId}`);
  });

  // ── FOLLOW ────────────────────────────────────────────────────────────────
  tiktokConnection.on('follow', data => {
    totalFollows++;
    io.emit('evento', {
      tipo:    'follow',
      usuario: data.uniqueId || 'usuario',
      nombre:  data.nickname || data.uniqueId || 'usuario',
      avatar:  data.profilePictureUrl || ''
    });
    io.emit('stats', { follows: totalFollows });
    console.log(`❤️  Follow: @${data.uniqueId}`);
  });

  // ── LIKE ──────────────────────────────────────────────────────────────────
  tiktokConnection.on('like', data => {
    totalLikes = data.totalLikeCount || (totalLikes + (data.likeCount || 1));
    io.emit('evento', {
      tipo:    'like',
      usuario: data.uniqueId || 'usuario',
      nombre:  data.nickname || data.uniqueId || 'usuario',
      likes:   data.likeCount || 1,
      total:   totalLikes
    });
    io.emit('stats', { likes: totalLikes });
  });

  // ── GIFT ──────────────────────────────────────────────────────────────────
  tiktokConnection.on('gift', data => {
    // En v2 el campo puede ser repeatEnd o giftType
    if (data.giftType === 1 && !data.repeatEnd) return;

    const cantidad  = data.repeatCount  || 1;
    const diamantes = (data.diamondCount || 0) * cantidad;
    totalDiamantes += diamantes;
    totalGifts++;

    io.emit('evento', {
      tipo:          'gift',
      usuario:       data.uniqueId || 'usuario',
      nombre:        data.nickname || data.uniqueId || 'usuario',
      avatar:        data.profilePictureUrl || '',
      regalo:        data.giftName  || 'Regalo',
      cantidad,
      diamantes,
      totalDiamantes
    });
    io.emit('stats', { diamantes: totalDiamantes, gifts: totalGifts });
    console.log(`🎁 @${data.uniqueId} → ${cantidad}x ${data.giftName} (💎${diamantes})`);
  });

  // ── SHARE ─────────────────────────────────────────────────────────────────
  tiktokConnection.on('share', data => {
    io.emit('evento', {
      tipo:    'share',
      usuario: data.uniqueId || 'usuario',
      nombre:  data.nickname || data.uniqueId || 'usuario',
      avatar:  data.profilePictureUrl || ''
    });
  });

  // ── SUBSCRIBE ─────────────────────────────────────────────────────────────
  tiktokConnection.on('subscribe', data => {
    io.emit('evento', {
      tipo:    'subscribe',
      usuario: data.uniqueId || 'usuario',
      nombre:  data.nickname || data.uniqueId || 'usuario',
      avatar:  data.profilePictureUrl || ''
    });
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
  });

  // ── DESCONEXIÓN ───────────────────────────────────────────────────────────
  tiktokConnection.on('disconnected', () => {
    console.log(`🔌 Desconectado de @${usuarioActual}`);
    if (!reconectando) {
      io.emit('estado', { conectado: false, error: 'Desconectado' });
      intentarReconexion();
    }
  });

  // ── ERROR ─────────────────────────────────────────────────────────────────
  tiktokConnection.on('error', err => {
    console.error(`⚠️  Error: ${err.message || err}`);
    io.emit('error_tiktok', { mensaje: err.message || 'Error desconocido' });
  });
}

// ─── RECONEXIÓN AUTOMÁTICA ────────────────────────────────────────────────────
function intentarReconexion() {
  if (!usuarioActual || reconectando) return;
  if (intentosReconexion >= MAX_INTENTOS) {
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
  console.log(`🖥️  Panel conectado`);

  // Enviar estado actual al nuevo cliente
  if (usuarioActual) {
    const conectado = !!tiktokConnection;
    socket.emit('estado', { conectado, usuario: usuarioActual });
    if (conectado) {
      socket.emit('stats', {
        viewers: totalViewers, likes: totalLikes,
        diamantes: totalDiamantes, follows: totalFollows,
        gifts: totalGifts, mensajes: totalMensajes
      });
    }
  }

  socket.on('cambiarUsuario', username => {
    const user = username.replace('@', '').trim();
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
});

// ─── RUTA DE ESTADO ───────────────────────────────────────────────────────────
app.get('/estado', (req, res) => {
  res.json({
    conectado: !!tiktokConnection,
    usuario:   usuarioActual,
    stats: { viewers: totalViewers, likes: totalLikes, diamantes: totalDiamantes }
  });
});

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
