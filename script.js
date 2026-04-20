// ─── SOCKET.IO — conexión con el servidor ──────────────────────────────────────
const socket = io();

socket.on('estado', data => {
  const dot = document.getElementById('estado-dot');
  const txt = document.getElementById('estado-txt');
  if (data.conectado) {
    dot.textContent = '🟢';
    txt.textContent = `LIVE @${data.usuario}`;
    txt.classList.add('online');
    document.querySelector('.cab-titulo').textContent = `⚡ @${data.usuario.toUpperCase()} ⚡`;
    document.title = `@${data.usuario} — LIVE`;
    hablar(`¡Conectado al live de ${data.usuario}! Sistema divine activado.`);
  } else {
    dot.textContent = '🔴';
    txt.textContent = 'OFFLINE';
    txt.classList.remove('online');
    document.querySelector('.cab-titulo').textContent = '⚡ SYSTEM DIVINE X-9000 ⚡';
    document.title = 'SYSTEM DIVINE X-9000';
    if (data.error) hablar(`Error de conexión: ${data.error}`);
  }
});

socket.on('stats', data => {
  document.getElementById('viewers').textContent = data.viewers.toLocaleString();
});

socket.on('evento', data => {
  switch (data.tipo) {
    case 'chat':   manejarChat(data);   break;
    case 'join':   manejarJoin(data);   break;
    case 'follow': manejarFollow(data); break;
    case 'gift':   manejarGift(data);   break;
    case 'like':   /* silencioso */     break;
  }
});

// ─── CONECTAR A TIKTOK DESDE EL PANEL ─────────────────────────────────────────
function conectarTikTok() {
  const input = document.getElementById('input-usuario');
  const user  = input.value.trim().replace('@', '');
  if (!user) return;
  socket.emit('cambiarUsuario', user);
  hablar(`Conectando al live de ${user}...`);
}

// ─── MANEJADORES DE EVENTOS TIKTOK ────────────────────────────────────────────
function manejarChat(data) {
  let chat = document.getElementById('col-chat');
  let div  = document.createElement('div');
  div.className = 'msg';

  let claseRol = data.rol === 'mod' ? 'admin' : (data.rol === 'vip' ? 'vip' : 'normal');
  let icono    = data.rol === 'mod' ? '🛡️' : (data.rol === 'vip' ? '⭐' : '');

  div.innerHTML = `<span class="user ${claseRol}">${icono} @${data.usuario}:</span> ${data.texto}`;
  chat.insertBefore(div, chat.firstChild);

  // Limitar a 50 mensajes en pantalla
  while (chat.children.length > 51) chat.removeChild(chat.lastChild);

  // Detectar comandos de juego
  const txt = data.texto.toLowerCase();
  if (txt.includes('!dado'))   juegoDado(data.usuario);
  if (txt.includes('!magia'))  juegoMagia(data.usuario);
  if (txt.includes('!pelea'))  juegoPelea(data.usuario);
  if (txt.includes('!ruleta')) juegoRuleta(data.usuario);

  hablar(`${data.nombre}: ${data.texto}`);
}
function manejarJoin(data) {
  let col   = document.getElementById('col-izq');
  let aviso = document.createElement('div');
  aviso.className = 'bienvenida';
  aviso.innerHTML = `🎉 BIENVENIDO ${data.nombre.toUpperCase()} 🎉`;
  col.insertBefore(aviso, col.firstChild);

  // Limitar a 30 llegadas
  while (col.children.length > 31) col.removeChild(col.lastChild);

  hablar(`¡Bienvenido ${data.nombre}! Que disfrutes el live.`);
}

function manejarFollow(data) {
  let col  = document.getElementById('col-izq');
  let div  = document.createElement('div');
  div.className = 'follow';
  div.innerHTML = `❤️ @${data.nombre} TE SIGUIÓ ❤️`;
  col.insertBefore(div, col.firstChild);

  let pant = document.getElementById('pantalla-juegos');
  pant.innerHTML = `❤️ FOLLOW<br>@${data.nombre} ❤️`;
  pant.style.fontSize  = '';
  pant.style.animation = 'none';
  setTimeout(() => pant.style.animation = 'aparecer 0.6s ease-out', 10);

  hablar(`¡Gracias por el follow ${data.nombre}! Eres increíble.`);
}

function manejarGift(data) {
  let col = document.getElementById('col-izq');
  let div = document.createElement('div');
  div.className = 'regalo';
  div.innerHTML = `🎁 @${data.nombre}<br>${data.cantidad}x ${data.regalo}<br>💎 ${data.diamantes} diamantes`;
  col.insertBefore(div, col.firstChild);

  let pant = document.getElementById('pantalla-juegos');
  pant.innerHTML = `🎁 ${data.regalo}<br>x${data.cantidad}`;
  pant.style.fontSize  = '';
  pant.style.animation = 'none';
  setTimeout(() => pant.style.animation = 'aparecer 0.6s ease-out', 10);

  hablar(`¡Gracias ${data.nombre} por ${data.cantidad} ${data.regalo}! ¡Eres un crack!`);
}

// ─── TABS MÓVIL ────────────────────────────────────────────────────────────────
function cambiarTab(tab, btn) {
  // Ocultar todas las columnas
  document.getElementById('col-izq').classList.remove('tab-visible');
  document.getElementById('col-chat').classList.remove('tab-visible');
  document.getElementById('col-juegos').classList.remove('tab-visible');

  // Mostrar la seleccionada
  const ids = { izq: 'col-izq', chat: 'col-chat', juegos: 'col-juegos' };
  document.getElementById(ids[tab]).classList.add('tab-visible');

  // Marcar botón activo
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('activo'));
  btn.classList.add('activo');
}

// ─── AYUDA ─────────────────────────────────────────────────────────────────────
function toggleAyuda() {
  document.getElementById('ayuda-overlay').classList.toggle('visible');
}

function cerrarAyuda(e) {
  // cierra si se hace click en el fondo oscuro, no dentro del modal
  if (e.target.id === 'ayuda-overlay') toggleAyuda();
}

// ─── TAMAÑO DE LETRA ───────────────────────────────────────────────────────────
function ajustarTamano(cant) {
  let tam = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tam'));
  tam += cant;
  if (tam < 14) tam = 14;
  if (tam > 45) tam = 45;
  document.documentElement.style.setProperty('--tam', tam + 'px');
}

// ─── VOZ ───────────────────────────────────────────────────────────────────────
function hablar(texto) {
  // Limitar largo para que no sea eterno
  let corto = texto.length > 120 ? texto.substring(0, 120) + '...' : texto;
  let voz   = new SpeechSynthesisUtterance(corto);
  voz.lang   = 'es-MX';
  voz.volume = 1;
  voz.rate   = 0.95;
  window.speechSynthesis.cancel(); // cancela la anterior para no acumular
  window.speechSynthesis.speak(voz);
  document.getElementById('texto-voz').innerText = corto;
}

// ─── JUEGOS ────────────────────────────────────────────────────────────────────
function juegoDado(user) {
  let num  = Math.floor(Math.random() * 6) + 1;
  let pant = document.getElementById('pantalla-juegos');
  pant.innerHTML       = `🎲 ${num} 🎲`;
  pant.style.fontSize  = '';
  pant.style.animation = 'none';
  setTimeout(() => pant.style.animation = 'aparecer 0.6s ease-out', 10);
  hablar(`¡Tiró el dado ${user} y salió el número ${num}!`);
}

function juegoMagia(user) {
  let frases = ["✨ FUTURO BRILLANTE ✨", "🔮 SUERTE MAESTRA 🔮", "🤡 CUIDADO 🤡", "👑 REY 👑"];
  let res    = frases[Math.floor(Math.random() * frases.length)];
  let pant   = document.getElementById('pantalla-juegos');
  pant.innerHTML       = `🔮 ${res} 🔮`;
  pant.style.fontSize  = '';
  pant.style.animation = 'none';
  setTimeout(() => pant.style.animation = 'aparecer 0.6s ease-out', 10);
  hablar(`Consultando oráculo para ${user}... ${res}`);
}

function juegoPelea(user) {
  let p1  = Math.floor(Math.random() * 100);
  let p2  = Math.floor(Math.random() * 100);
  let gan = p1 > p2 ? user : "EL SISTEMA";
  let pant = document.getElementById('pantalla-juegos');
  pant.innerHTML       = `⚔️ ${p1} VS ${p2} ⚔️<br>🏆 ${gan} 🏆`;
  pant.style.fontSize  = '';
  pant.style.animation = 'none';
  setTimeout(() => pant.style.animation = 'aparecer 0.8s ease-out', 10);
  hablar(`Batalla épica! ${user} tiene ${p1} de poder. Ganó... ${gan}!`);
}

function juegoRuleta(user) {
  let premios = ["🥇 PRIMERO", "🥈 SEGUNDO", "🤡 PAYASO", "👑 REY", "🎉 FIESTA"];
  let sale    = premios[Math.floor(Math.random() * premios.length)];
  let pant    = document.getElementById('pantalla-juegos');
  pant.innerHTML       = `🔄 ${sale} 🔄`;
  pant.style.fontSize  = '';
  pant.style.animation = 'none';
  setTimeout(() => pant.style.animation = 'aparecer 0.6s ease-out', 10);
  hablar(`Girando ruleta para ${user}... salió: ${sale}!`);
}

// ─── INICIO ────────────────────────────────────────────────────────────────────
hablar('Sistema Divine X-9000 cargado. Pon tu usuario de TikTok y conecta.');
