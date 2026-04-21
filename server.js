const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const { TikTokLiveConnection } = require('tiktok-live-connector');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['polling', 'websocket']
});

app.use(express.static(__dirname));
app.use(express.json());

const PORT = process.env.PORT || 8080;

// ─── Estado ───────────────────────────────────────────────────────────────────
let tiktokConnection   = null;
let usuarioActual      = null;
let reconectando       = false;
let intentosReconexion = 0;
const MAX_INTENTOS     = 5;

let totalLikes = 0, totalViewers = 0, totalDiamantes = 0;
let totalGifts = 0, totalFollows = 0, totalMensajes  = 0;

const historialEventos = [];
function guardarEvento(e) {
  historialEventos.push({ ...e, ts: Date.now() });
  if (historialEventos.length > 100) historialEventos.shift();
}
function resetStats() {
  totalLikes = 0; totalViewers = 0; totalDiamantes = 0;
  totalGifts = 0; totalFollows = 0; totalMensajes  = 0;
  historialEventos.length = 0;
}

// ─── Helper: extraer datos de usuario ────────────────────────────────────────
// En v2 los datos vienen en data.user.uniqueId / data.user.nickname
function getUser(data) {
  const u = data.user || data;
  return {
    usuario: u.uniqueId  || u.uniqueId  || 'usuario',
    nombre:  u.nickname  || u.uniqueId  || 'usuario',
    avatar:  u.profilePictureUrl || u.avatarThumb?.urlList?.[0] || ''
  };
}

// ─── CONECTAR ─────────────────────────────────────────────────────────────────
function conectarTikTok(username) {
  if (tiktokConnection) {
    try { tiktokConnection.disconnect(); } catch(e) {}
    tiktokConnection = null;
  }

  usuarioActual = username;
  reconectando  = false;
  resetStats();

  console.log(`\n🔗 Conectando a @${username}...`);

  tiktokConnection = new TikTokLiveConnection(username, {
    enableExtendedGiftInfo: true,
    requestPollingIntervalMs: 2000
  });

  tiktokConnection.connect()
    .then(state => {
      intentosReconexion = 0;
      console.log(`✅ Conectado a @${username} | Room: ${state.roomId}`);
      io.emit('estado', { conectado: true, usuario: username, roomId: state.roomId || '' });
      io.emit('stats', {
        viewers:   state.viewerCount || 0,
        likes:     state.likeCount   || 0,
        diamantes: 0, follows: 0, gifts: 0, mensajes: 0
      });
    })
    .catch(err => {
      const msg = err.message || String(err);
      console.error(`❌ Error @${username}: ${msg}`);
      let errorClaro = `No se pudo conectar a @${username}`;
      if (msg.toLowerCase().includes('live') || msg.toLowerCase().includes('offline') || msg.toLowerCase().includes('not live')) {
        errorClaro = `@${username} no está en vivo ahora mismo`;
      } else if (msg.includes('not found') || msg.includes('404') || msg.includes('User not found')) {
        errorClaro = `Usuario @${username} no encontrado`;
      } else if (msg.includes('rate') || msg.includes('429')) {
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
    const comment = data.comment || '';
    if (!comment.trim()) return;
    totalMensajes++;
    const u = getUser(data);
    const evento = {
      tipo:    'chat',
      ...u,
      texto:   comment.trim(),
      rol:     data.user?.isModerator ? 'mod' : (data.user?.isSubscriber ? 'vip' : 'normal')
    };
    guardarEvento(evento);
    io.emit('evento', evento);
  });

  // ── MEMBER JOIN ───────────────────────────────────────────────────────────
  tiktokConnection.on('member', data => {
    const u = getUser(data);
    const evento = { tipo: 'join', ...u };
    guardarEvento(evento);
    io.emit('evento', evento);
    console.log(`👤 Entró: @${u.usuario}`);
  });

  // ── FOLLOW ────────────────────────────────────────────────────────────────
  tiktokConnection.on('follow', data => {
    totalFollows++;
    const u = getUser(data);
    const evento = { tipo: 'follow', ...u };
    guardarEvento(evento);
    io.emit('evento', evento);
    io.emit('stats', { follows: totalFollows });
    console.log(`❤️  Follow: @${u.usuario}`);
  });

  // ── LIKE ──────────────────────────────────────────────────────────────────
  tiktokConnection.on('like', data => {
    totalLikes = data.totalLikeCount || (totalLikes + (data.likeCount || 1));
    const u = getUser(data);
    io.emit('evento', { tipo: 'like', ...u, likes: data.likeCount || 1, total: totalLikes });
    io.emit('stats', { likes: totalLikes });
  });

  // ── GIFT ──────────────────────────────────────────────────────────────────
  tiktokConnection.on('gift', data => {
    const giftType = data.giftDetails?.giftType ?? data.giftType;
    if (giftType === 1 && !data.repeatEnd) return;

    const cantidad  = data.repeatCount  || 1;
    const giftName  = data.giftDetails?.giftName || data.giftName || 'Regalo';
    const diamonds  = data.giftDetails?.diamondCount ?? data.diamondCount ?? 0;
    const diamantes = diamonds * cantidad;
    totalDiamantes += diamantes;
    totalGifts++;

    const u = getUser(data);
    const evento = { tipo: 'gift', ...u, regalo: giftName, cantidad, diamantes, totalDiamantes };
    guardarEvento(evento);
    io.emit('evento', evento);
    io.emit('stats', { diamantes: totalDiamantes, gifts: totalGifts });
    console.log(`🎁 @${u.usuario} → ${cantidad}x ${giftName} (💎${diamantes})`);
  });

  // ── SHARE ─────────────────────────────────────────────────────────────────
  tiktokConnection.on('share', data => {
    const u = getUser(data);
    const evento = { tipo: 'share', ...u };
    guardarEvento(evento);
    io.emit('evento', evento);
    console.log(`🔗 Share: @${u.usuario}`);
  });

  // ── SUBSCRIBE ─────────────────────────────────────────────────────────────
  tiktokConnection.on('subscribe', data => {
    const u = getUser(data);
    const evento = { tipo: 'subscribe', ...u };
    guardarEvento(evento);
    io.emit('evento', evento);
    console.log(`⭐ Subscribe: @${u.usuario}`);
  });

  // ── VIEWERS ───────────────────────────────────────────────────────────────
  tiktokConnection.on('roomUser', data => {
    totalViewers = data.viewerCount || 0;
    io.emit('stats', { viewers: totalViewers, likes: totalLikes, diamantes: totalDiamantes, follows: totalFollows, gifts: totalGifts, mensajes: totalMensajes });
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
  tiktokConnection.on('error', ({ info, exception }) => {
    console.error(`⚠️  Error: ${info}`, exception?.message || '');
    io.emit('error_tiktok', { mensaje: info || 'Error desconocido' });
  });
}

// ─── RECONEXIÓN ───────────────────────────────────────────────────────────────
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
  if (usuarioActual) {
    socket.emit('estado', { conectado: !!tiktokConnection, usuario: usuarioActual });
    socket.emit('stats', { viewers: totalViewers, likes: totalLikes, diamantes: totalDiamantes, follows: totalFollows, gifts: totalGifts, mensajes: totalMensajes });
    if (historialEventos.length > 0) socket.emit('historial', historialEventos.slice(-30));
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
    if (tiktokConnection) { try { tiktokConnection.disconnect(); } catch(e) {} tiktokConnection = null; }
    console.log('🔌 Desconectado manualmente');
    io.emit('estado', { conectado: false, error: null });
  });
});

// ─── RUTAS ────────────────────────────────────────────────────────────────────
app.get('/estado', (req, res) => res.json({ conectado: !!tiktokConnection, usuario: usuarioActual, stats: { viewers: totalViewers, likes: totalLikes, diamantes: totalDiamantes } }));
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ─── ARRANCAR ─────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║   SYSTEM DIVINE X-9000  🔥       ║`);
  console.log(`║   Puerto: ${PORT}                   ║`);
  console.log(`╚══════════════════════════════════╝\n`);
  if (process.env.TIKTOK_USER) conectarTikTok(process.env.TIKTOK_USER);
});

process.on('uncaughtException',  err => console.error('💥 Error:', err.message));
process.on('unhandledRejection', err => console.error('💥 Promesa:', err));
