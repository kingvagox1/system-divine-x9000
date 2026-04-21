// ═══════════════════════════════════════════════════════════
//   SYSTEM DIVINE X-9000  —  script.js
// ═══════════════════════════════════════════════════════════

// ─── ESTADO GLOBAL ────────────────────────────────────────────────────────────
let mutado        = false;
let metaDiamantes = 1000;
let totalDiamantes= 0;
let totalLikes    = 0;
let puntos        = {};          // { usuario: puntos }
let filtros       = [];          // palabras bloqueadas
let participantesSorteo = [];
let triviaActiva  = null;
let contadorTimer = null;
let historialChat = [];
let viewersData   = [];          // para la gráfica
let graficaCtx    = null;

// ─── ESTRELLAS DE FONDO ────────────────────────────────────────────────────────
(function initEstrellas() {
  const canvas = document.getElementById('particulas');
  const ctx    = canvas.getContext('2d');
  let estrellas = [];

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function crearEstrellas() {
    estrellas = [];
    for (let i = 0; i < 160; i++) {
      estrellas.push({
        x:    Math.random() * canvas.width,
        y:    Math.random() * canvas.height,
        r:    Math.random() * 1.5 + 0.3,
        op:   Math.random(),
        vel:  Math.random() * 0.008 + 0.002,
        dx:   (Math.random() - 0.5) * 0.15,
        dy:   (Math.random() - 0.5) * 0.15,
      });
    }
  }

  function dibujar() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    estrellas.forEach(s => {
      s.op += s.vel;
      if (s.op > 1 || s.op < 0) s.vel *= -1;
      s.x += s.dx;
      s.y += s.dy;
      if (s.x < 0) s.x = canvas.width;
      if (s.x > canvas.width) s.x = 0;
      if (s.y < 0) s.y = canvas.height;
      if (s.y > canvas.height) s.y = 0;

      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${s.op * 0.8})`;
      ctx.fill();
    });
    requestAnimationFrame(dibujar);
  }

  resize();
  crearEstrellas();
  dibujar();
  window.addEventListener('resize', () => { resize(); crearEstrellas(); });
})();

// ─── GRÁFICA VIEWERS ──────────────────────────────────────────────────────────
(function initGrafica() {
  const canvas = document.getElementById('grafica-viewers');
  if (!canvas) return;
  graficaCtx = canvas.getContext('2d');
})();

function actualizarGrafica() {
  const canvas = document.getElementById('grafica-viewers');
  if (!graficaCtx || !canvas) return;
  const w = canvas.offsetWidth;
  canvas.width = w;
  const h = canvas.height;
  graficaCtx.clearRect(0, 0, w, h);
  if (viewersData.length < 2) return;

  const max = Math.max(...viewersData, 1);
  const paso = w / (viewersData.length - 1);

  graficaCtx.beginPath();
  graficaCtx.strokeStyle = 'rgba(0,240,255,0.7)';
  graficaCtx.lineWidth   = 2;
  viewersData.forEach((v, i) => {
    const x = i * paso;
    const y = h - (v / max) * (h - 4) - 2;
    i === 0 ? graficaCtx.moveTo(x, y) : graficaCtx.lineTo(x, y);
  });
  graficaCtx.stroke();

  // Relleno
  graficaCtx.lineTo(w, h);
  graficaCtx.lineTo(0, h);
  graficaCtx.closePath();
  graficaCtx.fillStyle = 'rgba(0,240,255,0.08)';
  graficaCtx.fill();
}

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
const socket = io();

socket.on('estado', data => {
  const dot = document.getElementById('estado-dot');
  const txt = document.getElementById('estado-txt');
  if (data.conectado) {
    dot.textContent = '🟢';
    txt.textContent = `LIVE @${data.usuario}`;
    txt.classList.add('online');
    document.getElementById('cab-titulo').textContent = `⚡ @${data.usuario.toUpperCase()} ⚡`;
    document.title = `@${data.usuario} — LIVE`;
    document.getElementById('btn-desconectar').style.display = 'inline-block';
    hablar(`¡Conectado al live de ${data.usuario}! Sistema divine activado.`);
    sonar('conectar');
  } else {
    dot.textContent = '🔴';
    txt.textContent = 'OFFLINE';
    txt.classList.remove('online');
    document.getElementById('cab-titulo').textContent = '⚡ SYSTEM DIVINE X-9000 ⚡';
    document.title = 'SYSTEM DIVINE X-9000';
    document.getElementById('btn-desconectar').style.display = 'none';
    if (data.error) hablar(`Error de conexión: ${data.error}`);
  }
});

socket.on('stats', data => {
  if (data.viewers  !== undefined) document.getElementById('viewers').textContent        = Number(data.viewers).toLocaleString();
  if (data.likes    !== undefined) document.getElementById('total-likes').textContent    = Number(data.likes).toLocaleString();
  if (data.diamantes!== undefined) {
    totalDiamantes = data.diamantes;
    document.getElementById('total-diamantes').textContent = Number(data.diamantes).toLocaleString();
    actualizarBarraDiamantes();
  }
  if (data.viewers !== undefined) {
    viewersData.push(data.viewers);
    if (viewersData.length > 60) viewersData.shift();
    actualizarGrafica();
  }
});

socket.on('evento', data => {
  switch (data.tipo) {
    case 'chat':      manejarChat(data);      break;
    case 'join':      manejarJoin(data);      break;
    case 'follow':    manejarFollow(data);    break;
    case 'gift':      manejarGift(data);      break;
    case 'like':      manejarLike(data);      break;
    case 'share':     manejarShare(data);     break;
    case 'subscribe': manejarSubscribe(data); break;
  }
});

socket.on('reconectando', data => {
  document.getElementById('estado-dot').textContent = '🟡';
  document.getElementById('estado-txt').textContent = `RECONECTANDO ${data.intento}/${data.max}`;
  document.getElementById('reconectando').style.display = 'flex';
});

socket.on('streamEnd', data => {
  mostrarAlerta(`📴 LIVE TERMINADO\n@${data.usuario}`);
  hablar(`El live de ${data.usuario} ha terminado.`);
});

socket.on('error_tiktok', data => {
  console.warn('Error TikTok:', data.mensaje);
});

// ─── SONIDOS ──────────────────────────────────────────────────────────────────
function sonar(tipo) {
  if (mutado) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain= ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  const configs = {
    conectar: { freq: 880, tipo: 'sine',    dur: 0.3, vol: 0.3 },
    follow:   { freq: 660, tipo: 'sine',    dur: 0.4, vol: 0.4 },
    gift:     { freq: 440, tipo: 'triangle',dur: 0.6, vol: 0.5 },
    mensaje:  { freq: 330, tipo: 'sine',    dur: 0.1, vol: 0.15 },
    juego:    { freq: 550, tipo: 'square',  dur: 0.2, vol: 0.2 },
  };

  const c = configs[tipo] || configs.mensaje;
  osc.type      = c.tipo;
  osc.frequency.setValueAtTime(c.freq, ctx.currentTime);
  gain.gain.setValueAtTime(c.vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + c.dur);
  osc.start();
  osc.stop(ctx.currentTime + c.dur);
}

// ─── CONECTAR / DESCONECTAR ───────────────────────────────────────────────────
function conectarTikTok() {
  const input = document.getElementById('input-usuario');
  const user  = input.value.trim().replace('@', '');
  if (!user) return;
  socket.emit('cambiarUsuario', user);
  hablar(`Conectando al live de ${user}...`);
}

function desconectar() {
  socket.emit('desconectar');
  document.getElementById('estado-dot').textContent = '🔴';
  document.getElementById('estado-txt').textContent = 'OFFLINE';
  document.getElementById('estado-txt').classList.remove('online');
  document.getElementById('cab-titulo').textContent = '⚡ SYSTEM DIVINE X-9000 ⚡';
  document.getElementById('btn-desconectar').style.display = 'none';
}

// ─── MANEJADORES TIKTOK ───────────────────────────────────────────────────────
function manejarChat(data) {
  // Filtro spam
  const txtLow = data.texto.toLowerCase();
  if (filtros.some(f => txtLow.includes(f))) return;

  const chat = document.getElementById('chat-mensajes');
  const div  = document.createElement('div');
  div.className = 'msg';
  const claseRol   = data.rol === 'mod' ? 'admin' : (data.rol === 'vip' ? 'vip' : 'normal');
  const icono      = data.rol === 'mod' ? '🛡️' : (data.rol === 'vip' ? '⭐' : '');
  const avatarHtml = data.avatar
    ? `<img src="${data.avatar}" style="width:18px;height:18px;border-radius:50%;vertical-align:middle;margin-right:4px;border:1px solid rgba(255,255,255,0.2)">`
    : '';
  div.innerHTML = `${avatarHtml}<span class="user ${claseRol}">${icono} @${data.usuario}:</span> ${data.texto}`;
  chat.insertBefore(div, chat.firstChild);
  while (chat.children.length > 55) chat.removeChild(chat.lastChild);

  // Guardar historial
  historialChat.push({ t: new Date().toLocaleTimeString(), u: data.usuario, m: data.texto });
  if (historialChat.length > 500) historialChat.shift();

  // Badge en tab móvil si no está visible
  if (!document.getElementById('col-chat').classList.contains('tab-visible')) {
    document.getElementById('badge-chat').style.display = 'inline';
  }

  // Comandos
  if (txtLow.includes('!dado'))   { juegoDado(data.usuario);   sonar('juego'); return; }
  if (txtLow.includes('!magia'))  { juegoMagia(data.usuario);  sonar('juego'); return; }
  if (txtLow.includes('!pelea'))  { juegoPelea(data.usuario);  sonar('juego'); return; }
  if (txtLow.includes('!ruleta')) { juegoRuleta(data.usuario); sonar('juego'); return; }
  if (txtLow.includes('!8ball'))  { juego8ball(data.usuario);  sonar('juego'); return; }
  if (txtLow.includes('!trivia')) { responderTrivia(data.usuario, data.texto); return; }
  if (txtLow.includes('!piedra') || txtLow.includes('!papel') || txtLow.includes('!tijera')) {
    juegoPPT(data.usuario, data.texto); sonar('juego'); return;
  }
  if (txtLow.includes('!sorteo')) {
    if (!participantesSorteo.includes(data.usuario)) {
      participantesSorteo.push(data.usuario);
    }
    return;
  }

  sonar('mensaje');
  hablar(`${data.nombre}: ${data.texto}`);
}

function manejarJoin(data) {
  const col  = document.getElementById('col-izq');
  const h2   = col.querySelector('h2');
  const aviso = document.createElement('div');
  aviso.className = 'bienvenida';
  const avatarHtml = data.avatar
    ? `<img src="${data.avatar}" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:6px;border:1px solid rgba(255,255,255,0.4)">`
    : '';
  aviso.innerHTML = `${avatarHtml}🎉 ${data.nombre.toUpperCase()} 🎉`;
  // Insertar DESPUÉS del h2, no antes
  if (h2 && h2.nextSibling) {
    col.insertBefore(aviso, h2.nextSibling);
  } else {
    col.appendChild(aviso);
  }
  // Limitar a 30 tarjetas (sin contar el h2)
  const tarjetas = col.querySelectorAll('.bienvenida, .follow, .regalo');
  if (tarjetas.length > 30) tarjetas[tarjetas.length - 1].remove();
  hablar(`¡Bienvenido ${data.nombre}! Que disfrutes el live.`);
}

function manejarFollow(data) {
  const col = document.getElementById('col-izq');
  const h2  = col.querySelector('h2');
  const div = document.createElement('div');
  div.className = 'follow';
  const avatarHtml = data.avatar
    ? `<img src="${data.avatar}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:5px;border:1px solid rgba(255,255,255,0.3)">`
    : '';
  div.innerHTML = `${avatarHtml}❤️ @${data.nombre} TE SIGUIÓ ❤️`;
  if (h2 && h2.nextSibling) col.insertBefore(div, h2.nextSibling);
  else col.appendChild(div);
  const tarjetas = col.querySelectorAll('.bienvenida, .follow, .regalo');
  if (tarjetas.length > 30) tarjetas[tarjetas.length - 1].remove();

  mostrarPantalla(`❤️ FOLLOW\n@${data.nombre}`);
  mostrarAlerta(`❤️ @${data.nombre}\nTE SIGUIÓ`);
  sonar('follow');
  hablar(`¡Gracias por el follow ${data.nombre}! Eres increíble.`);
}

function manejarShare(data) {
  const col = document.getElementById('col-izq');
  const h2  = col.querySelector('h2');
  const div = document.createElement('div');
  div.className = 'follow';
  div.style.background  = 'linear-gradient(135deg, rgba(0,170,255,0.18), rgba(0,240,255,0.15))';
  div.style.borderColor = 'rgba(0,240,255,0.45)';
  div.style.boxShadow   = '0 0 20px rgba(0,240,255,0.3)';
  div.innerHTML = `🔗 @${data.nombre} COMPARTIÓ EL LIVE 🔗`;
  if (h2 && h2.nextSibling) col.insertBefore(div, h2.nextSibling);
  else col.appendChild(div);
  const tarjetas = col.querySelectorAll('.bienvenida, .follow, .regalo');
  if (tarjetas.length > 30) tarjetas[tarjetas.length - 1].remove();
  hablar(`¡${data.nombre} compartió el live! ¡Gracias!`);
}

function manejarSubscribe(data) {
  const col = document.getElementById('col-izq');
  const h2  = col.querySelector('h2');
  const div = document.createElement('div');
  div.className = 'follow';
  div.style.background  = 'linear-gradient(135deg, rgba(255,215,0,0.18), rgba(255,136,0,0.15))';
  div.style.borderColor = 'rgba(255,215,0,0.5)';
  div.style.boxShadow   = '0 0 22px rgba(255,215,0,0.35)';
  div.innerHTML = `⭐ @${data.nombre} SE SUSCRIBIÓ ⭐`;
  if (h2 && h2.nextSibling) col.insertBefore(div, h2.nextSibling);
  else col.appendChild(div);
  const tarjetas = col.querySelectorAll('.bienvenida, .follow, .regalo');
  if (tarjetas.length > 30) tarjetas[tarjetas.length - 1].remove();

  mostrarPantalla(`⭐ SUSCRIPTOR\n@${data.nombre}`);
  mostrarAlerta(`⭐ @${data.nombre}\n¡SUSCRIPTOR!`);
  sonar('gift');
  hablar(`¡${data.nombre} se suscribió! ¡Muchísimas gracias!`);
}

function manejarGift(data) {
  if (data.totalDiamantes !== undefined) {
    totalDiamantes = data.totalDiamantes;
    document.getElementById('total-diamantes').textContent = totalDiamantes.toLocaleString();
    actualizarBarraDiamantes();
  }

  const col = document.getElementById('col-izq');
  const h2  = col.querySelector('h2');
  const div = document.createElement('div');
  const rareza = data.diamantes >= 1000 ? 'legendario'
               : data.diamantes >= 100  ? 'epico'
               : data.diamantes >= 10   ? 'raro'
               : 'comun';
  div.className = `regalo ${rareza}`;
  const avatarHtml = data.avatar
    ? `<img src="${data.avatar}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:5px;border:1px solid rgba(255,255,255,0.3)">`
    : '';
  div.innerHTML = `${avatarHtml}🎁 @${data.nombre}<br>${data.cantidad}x ${data.regalo} · 💎${data.diamantes}`;
  if (h2 && h2.nextSibling) col.insertBefore(div, h2.nextSibling);
  else col.appendChild(div);
  const tarjetas = col.querySelectorAll('.bienvenida, .follow, .regalo');
  if (tarjetas.length > 30) tarjetas[tarjetas.length - 1].remove();

  mostrarPantalla(`🎁 ${data.regalo}\nx${data.cantidad}`);
  if (rareza === 'legendario' || rareza === 'epico') {
    mostrarAlerta(`🎁 @${data.nombre}\n${data.cantidad}x ${data.regalo}`);
  }
  sonar('gift');
  hablar(`¡Gracias ${data.nombre} por ${data.cantidad} ${data.regalo}! ¡Eres un crack!`);
}

function manejarLike(data) {
  // Usar el total real que viene del servidor
  if (data.total !== undefined) {
    totalLikes = data.total;
    document.getElementById('total-likes').textContent = totalLikes.toLocaleString();
  }
}

// ─── PANTALLA Y ALERTA ────────────────────────────────────────────────────────
function mostrarPantalla(texto) {
  const pant = document.getElementById('pantalla-juegos');
  pant.innerHTML       = texto.replace(/\n/g, '<br>');
  pant.style.animation = 'none';
  setTimeout(() => pant.style.animation = 'aparecer 0.6s ease-out', 10);
}

function mostrarAlerta(texto) {
  const el = document.getElementById('overlay-alerta');
  el.innerHTML = texto.replace(/\n/g, '<br>');
  el.classList.remove('visible');
  void el.offsetWidth;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3200);
}

// ─── BARRA DIAMANTES ──────────────────────────────────────────────────────────
function actualizarBarraDiamantes() {
  const pct = Math.min((totalDiamantes / metaDiamantes) * 100, 100);
  document.getElementById('barra-fill').style.width = pct + '%';
  document.getElementById('barra-txt').textContent  = `${totalDiamantes.toLocaleString()} / ${metaDiamantes.toLocaleString()}`;
}

function actualizarMeta() {
  const val = parseInt(document.getElementById('input-meta').value);
  if (val > 0) { metaDiamantes = val; actualizarBarraDiamantes(); }
}

// ─── PUNTOS ───────────────────────────────────────────────────────────────────
function darPuntos(usuario, cantidad) {
  puntos[usuario] = (puntos[usuario] || 0) + cantidad;
  renderPuntos();
}

function renderPuntos() {
  const sorted = Object.entries(puntos).sort((a,b) => b[1]-a[1]).slice(0, 15);
  const tabla  = document.getElementById('tabla-puntos');
  tabla.innerHTML = sorted.map(([ u, p ], i) =>
    `<div class="punto-fila">
      <span class="punto-nombre">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'  '} @${u}</span>
      <span class="punto-score">${p}pts</span>
    </div>`
  ).join('');
}

function resetearPuntos() {
  puntos = {};
  document.getElementById('tabla-puntos').innerHTML = '';
}

// ─── FILTRO SPAM ──────────────────────────────────────────────────────────────
function agregarFiltro() {
  const input = document.getElementById('input-filtro');
  const pal   = input.value.trim().toLowerCase();
  if (!pal || filtros.includes(pal)) { input.value = ''; return; }
  filtros.push(pal);
  input.value = '';
  renderFiltros();
}

function renderFiltros() {
  const lista = document.getElementById('filtros-lista');
  lista.innerHTML = filtros.map(f =>
    `<span class="filtro-tag" onclick="quitarFiltro('${f}')" title="Click para quitar">🚫 ${f}</span>`
  ).join('');
}

function quitarFiltro(pal) {
  filtros = filtros.filter(f => f !== pal);
  renderFiltros();
}

// ─── TABS MÓVIL ───────────────────────────────────────────────────────────────
function cambiarTab(tab, btn) {
  ['col-izq','col-chat','col-juegos','col-puntos'].forEach(id => {
    document.getElementById(id).classList.remove('tab-visible');
  });
  const ids = { izq:'col-izq', chat:'col-chat', juegos:'col-juegos', puntos:'col-puntos' };
  document.getElementById(ids[tab]).classList.add('tab-visible');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('activo'));
  btn.classList.add('activo');
  if (tab === 'chat') document.getElementById('badge-chat').style.display = 'none';
}

// ─── TEMAS DE COLOR ───────────────────────────────────────────────────────────
const TEMAS = {
  azul:  { t1: '#00F0FF', t2: '#BF00FF' },
  verde: { t1: '#00FF88', t2: '#00AAFF' },
  rojo:  { t1: '#FF3366', t2: '#FF8800' },
  oro:   { t1: '#FFD700', t2: '#FF8800' },
  rosa:  { t1: '#FF00CC', t2: '#8800FF' },
};

function cambiarTema(nombre, btn) {
  const t = TEMAS[nombre];
  if (!t) return;
  document.documentElement.style.setProperty('--t1', t.t1);
  document.documentElement.style.setProperty('--t2', t.t2);
  document.querySelectorAll('.btn-tema').forEach(b => b.classList.remove('activo'));
  btn.classList.add('activo');
}

// ─── TAMAÑO LETRA ─────────────────────────────────────────────────────────────
function ajustarTamano(cant) {
  let tam = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tam'));
  tam = Math.min(45, Math.max(12, tam + cant));
  document.documentElement.style.setProperty('--tam', tam + 'px');
}

// ─── VOZ CON COLA ─────────────────────────────────────────────────────────────
let colaVoz = [];
let hablandoAhora = false;

function hablar(texto) {
  if (mutado) return;
  const corto = texto.length > 100 ? texto.substring(0, 100) + '...' : texto;
  document.getElementById('texto-voz').innerText = corto;

  // Agregar a la cola (máximo 3 mensajes pendientes para no acumular)
  if (colaVoz.length < 3) colaVoz.push(corto);
  procesarColaVoz();
}

function procesarColaVoz() {
  if (hablandoAhora || colaVoz.length === 0) return;
  hablandoAhora = true;
  const texto = colaVoz.shift();
  const voz   = new SpeechSynthesisUtterance(texto);
  voz.lang    = 'es-MX';
  voz.volume  = 1;
  voz.rate    = 1.0;
  voz.onend   = () => { hablandoAhora = false; procesarColaVoz(); };
  voz.onerror = () => { hablandoAhora = false; procesarColaVoz(); };
  window.speechSynthesis.speak(voz);
}

function toggleMute() {
  mutado = !mutado;
  const btn = document.getElementById('btn-mute');
  btn.textContent = mutado ? '🔇' : '🔊';
  btn.classList.toggle('muted', mutado);
  if (mutado) {
    window.speechSynthesis.cancel();
    colaVoz = [];
    hablandoAhora = false;
  }
}

// ─── CONTADOR REGRESIVO ───────────────────────────────────────────────────────
function iniciarContador(seg = 10) {
  if (contadorTimer) clearInterval(contadorTimer);
  let restante = seg;
  document.getElementById('contador-wrap').style.display = 'flex';
  document.getElementById('contador').textContent = restante;
  contadorTimer = setInterval(() => {
    restante--;
    document.getElementById('contador').textContent = restante;
    sonar('juego');
    if (restante <= 0) {
      clearInterval(contadorTimer);
      contadorTimer = null;
      document.getElementById('contador-wrap').style.display = 'none';
      mostrarPantalla('⏱️ TIEMPO!');
      hablar('¡Se acabó el tiempo!');
    }
  }, 1000);
}

function detenerContador() {
  if (contadorTimer) { clearInterval(contadorTimer); contadorTimer = null; }
  document.getElementById('contador-wrap').style.display = 'none';
}

// ─── JUEGOS ───────────────────────────────────────────────────────────────────
function juegoDado(user) {
  const num = Math.floor(Math.random() * 6) + 1;
  mostrarPantalla(`🎲 ${num} 🎲`);
  if (num === 6) darPuntos(user, 10);
  hablar(`¡Tiró el dado ${user} y salió el número ${num}!${num===6?' ¡Máximo! +10 puntos':''}`);
}

function juegoMagia(user) {
  const frases = [
    '✨ FUTURO BRILLANTE ✨',
    '🔮 SUERTE MAESTRA 🔮',
    '🤡 CUIDADO 🤡',
    '👑 REY 👑',
    '💀 PELIGRO 💀',
    '🌟 ESTRELLA 🌟',
    '🍀 MUCHA SUERTE 🍀',
    '🔥 ERES FUEGO 🔥',
    '💎 DIAMANTE PURO 💎',
    '🐍 TRAICIÓN CERCA 🐍',
    '🦁 ERES UN LEÓN 🦁',
    '🌈 DÍAS ÉPICOS VIENEN 🌈',
    '💸 EL DINERO LLEGA 💸',
    '😈 CUIDADO CON LOS ENVIDIOSOS 😈',
    '🏆 CAMPEÓN TOTAL 🏆',
    '🌙 NOCHE MÁGICA 🌙',
    '⚡ PODER ABSOLUTO ⚡',
    '🎭 TODO ES UN JUEGO 🎭',
    '🕊️ PAZ Y AMOR 🕊️',
    '🤑 RIQUEZA EXTREMA 🤑',
    '🧿 PROTEGIDO 🧿',
    '🫀 AMOR VERDADERO CERCA 🫀',
    '🚀 AL INFINITO 🚀',
    '🪄 MAGIA PURA 🪄',
    '👻 ALGO RARO SE ACERCA 👻',
  ];
  const res = frases[Math.floor(Math.random() * frases.length)];
  mostrarPantalla(`🔮 ${res}`);
  hablar(`Consultando oráculo para ${user}... ${res}`);
}

function juegoPelea(user) {
  const p1  = Math.floor(Math.random() * 100);
  const p2  = Math.floor(Math.random() * 100);
  const gan = p1 > p2 ? user : 'EL SISTEMA';
  mostrarPantalla(`⚔️ ${p1} VS ${p2}\n🏆 ${gan}`);
  if (p1 > p2) darPuntos(user, 5);
  hablar(`Batalla épica! ${user} tiene ${p1} de poder. Ganó... ${gan}!`);
}

function juegoRuleta(user) {
  const premios = ['🥇 PRIMERO','🥈 SEGUNDO','🤡 PAYASO','👑 REY','🎉 FIESTA','💎 DIAMANTE'];
  const sale    = premios[Math.floor(Math.random() * premios.length)];
  mostrarPantalla(`🔄 ${sale}`);
  hablar(`Girando ruleta para ${user}... salió: ${sale}!`);
}

function juego8ball(user) {
  const resp = [
    '✅ SÍ, DEFINITIVAMENTE','✅ TODO INDICA QUE SÍ','✅ SIN DUDA',
    '❓ PREGUNTA DESPUÉS','❓ NO ES CLARO','❓ MEJOR NO DECIRTE',
    '❌ NO CUENTES CON ESO','❌ MIS FUENTES DICEN NO','❌ DEFINITIVAMENTE NO'
  ];
  const r = resp[Math.floor(Math.random() * resp.length)];
  mostrarPantalla(`🎱 ${r}`);
  hablar(`La bola mágica dice para ${user}: ${r}`);
}

function juegoTrivia(user) {
  const preguntas = [
    { p:'¿Cuántos lados tiene un hexágono?', r:'6', ops:['4','6','8','5'] },
    { p:'¿Capital de Francia?',              r:'paris', ops:['madrid','paris','roma','berlin'] },
    { p:'¿Cuánto es 7 x 8?',                r:'56', ops:['48','54','56','63'] },
    { p:'¿Planeta más grande del sistema solar?', r:'jupiter', ops:['saturno','jupiter','neptuno','urano'] },
    { p:'¿En qué año llegó el hombre a la luna?', r:'1969', ops:['1965','1969','1972','1971'] },
  ];
  const q = preguntas[Math.floor(Math.random() * preguntas.length)];
  triviaActiva = { pregunta: q, inicio: Date.now() };
  mostrarPantalla(`🧠 ${q.p}\n${q.ops.join(' · ')}`);
  hablar(`Trivia para todos: ${q.p}. Opciones: ${q.ops.join(', ')}`);
  setTimeout(() => {
    if (triviaActiva) {
      triviaActiva = null;
      mostrarPantalla(`🧠 Tiempo!\nEra: ${q.r.toUpperCase()}`);
      hablar(`Se acabó el tiempo. La respuesta era ${q.r}`);
    }
  }, 20000);
}

function responderTrivia(usuario, texto) {
  if (!triviaActiva) return;
  const resp = texto.toLowerCase().replace('!trivia','').trim();
  if (resp === triviaActiva.pregunta.r) {
    const pts = 15;
    darPuntos(usuario, pts);
    mostrarPantalla(`✅ @${usuario}\n¡CORRECTO! +${pts}pts`);
    mostrarAlerta(`✅ @${usuario}\n¡CORRECTO!`);
    hablar(`¡Correcto! ${usuario} gana ${pts} puntos!`);
    triviaActiva = null;
  }
}

function juegoPPT(user, texto) {
  const opciones = ['piedra','papel','tijera'];
  const sistema  = opciones[Math.floor(Math.random() * 3)];
  let jugador    = '';
  if (texto.includes('piedra')) jugador = 'piedra';
  else if (texto.includes('papel')) jugador = 'papel';
  else if (texto.includes('tijera')) jugador = 'tijera';
  else return;

  const gana = { piedra:'tijera', papel:'piedra', tijera:'papel' };
  let resultado;
  if (jugador === sistema)          resultado = '🤝 EMPATE';
  else if (gana[jugador] === sistema) { resultado = `🏆 ${user} GANA`; darPuntos(user, 8); }
  else                               resultado = '💀 SISTEMA GANA';

  const emojis = { piedra:'🪨', papel:'📄', tijera:'✂️' };
  mostrarPantalla(`${emojis[jugador]} VS ${emojis[sistema]}\n${resultado}`);
  hablar(`${user} eligió ${jugador}, el sistema eligió ${sistema}. ${resultado}`);
}

function juegoSorteo() {
  if (participantesSorteo.length === 0) {
    mostrarPantalla('🏆 SORTEO\nNadie anotado\nEscribe !sorteo');
    hablar('Nadie se ha anotado al sorteo. Escribe !sorteo en el chat.');
    return;
  }
  const ganador = participantesSorteo[Math.floor(Math.random() * participantesSorteo.length)];
  mostrarPantalla(`🏆 GANADOR\n@${ganador}`);
  mostrarAlerta(`🏆 @${ganador}\n¡GANADOR!`);
  darPuntos(ganador, 50);
  hablar(`¡El ganador del sorteo es ${ganador}! ¡Felicidades!`);
  participantesSorteo = [];
}

// ─── AYUDA ────────────────────────────────────────────────────────────────────
function toggleAyuda() {
  document.getElementById('ayuda-overlay').classList.toggle('visible');
}
function cerrarAyuda(e) {
  if (e.target.id === 'ayuda-overlay') toggleAyuda();
}

// ─── INICIO ───────────────────────────────────────────────────────────────────
hablar('Sistema Divine X-9000 cargado. Pon tu usuario de TikTok y conecta.');


// ─── RESIZE HANDLES ────────────────────────────────────────────────────────────
(function initResizeHandles() {
  function addHandle(col) {
    if (col.querySelector('.columna-resize-handle')) return;
    const handle = document.createElement('div');
    handle.className = 'columna-resize-handle';
    handle.title = 'Arrastrar para redimensionar';
    col.appendChild(handle);

    let startX, startW;

    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      startX = e.clientX;
      startW = col.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(ev) {
        const delta = ev.clientX - startX;
        const newW  = Math.max(140, startW + delta);
        col.style.flex = 'none';
        col.style.width = newW + 'px';
      }

      function onUp() {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Touch support
    handle.addEventListener('touchstart', function (e) {
      e.preventDefault();
      const touch = e.touches[0];
      startX = touch.clientX;
      startW = col.getBoundingClientRect().width;

      function onTouchMove(ev) {
        const t = ev.touches[0];
        const delta = t.clientX - startX;
        const newW  = Math.max(140, startW + delta);
        col.style.flex = 'none';
        col.style.width = newW + 'px';
      }

      function onTouchEnd() {
        handle.removeEventListener('touchmove', onTouchMove);
        handle.removeEventListener('touchend', onTouchEnd);
      }

      handle.addEventListener('touchmove', onTouchMove, { passive: false });
      handle.addEventListener('touchend', onTouchEnd);
    }, { passive: false });
  }

  function attachAll() {
    document.querySelectorAll('.zona-central .columna').forEach(addHandle);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachAll);
  } else {
    attachAll();
  }
})();
