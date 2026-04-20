# ⚡ SYSTEM DIVINE X-9000

Panel en tiempo real para TikTok Live con juegos interactivos, voz y efectos visuales.

## 🚀 Instalación

```bash
npm install
node server.js
```

Abre el navegador en `http://localhost:3000`, escribe tu usuario de TikTok y presiona **CONECTAR**.

## 🎮 Comandos del chat

| Comando   | Descripción                          |
|-----------|--------------------------------------|
| `!dado`   | Tira un dado del 1 al 6              |
| `!magia`  | El oráculo revela tu destino         |
| `!pelea`  | Tú vs El Sistema (0-99 de poder)     |
| `!ruleta` | Gira la ruleta de premios            |
| `!8ball`  | Pregúntale a la bola mágica          |
| `!sorteo` | Entra al sorteo del streamer         |

## 📁 Estructura

```
SYSTEM DIVINE X-9000/
├── index.html    — Interfaz principal
├── style.css     — Estilos y efectos
├── script.js     — Lógica del cliente
├── server.js     — Servidor Node + TikTok Live
└── assets/3d/    — Modelos 3D (.gltf)
```

## ⚙️ Requisitos

- Node.js v18+
- El streamer debe estar **en vivo** en TikTok
