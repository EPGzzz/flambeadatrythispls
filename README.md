# Truco o Trato — versión online

El juego (`public/index.html`) es tu archivo original sin tocar. `server.js` sirve el juego
y gestiona las salas multijugador por WebSocket en `/ws`. El cliente se conecta solo cuando
se abre desde el propio servidor.

## Probar en local
    npm install
    npm start
Abre http://localhost:3000 (en dos pestañas o dos dispositivos de la red para probar salas).

## Publicarlo (gratis) en Render
1. Sube esta carpeta a un repositorio de GitHub.
2. En render.com: New > Web Service > elige el repo. Detecta `render.yaml` solo.
3. Cuando termine, tu enlace `https://tu-app.onrender.com` es el juego online.
   Pasa el enlace a tus amigos: uno crea sala, los demás entran con el código.
(Railway, Fly.io o cualquier hosting con Node funcionan igual.)

## Clave de DIOS-M
Por defecto es la que ya tenía tu juego. Cámbiala con la variable de entorno `GOD_KEY`
(render.yaml ya genera una aleatoria; mírala en el panel de Render > Environment).
Si alguien juega sin servidor, la clave original sigue en el HTML.

## Notas
- Máximo 4 jugadores por sala (DIOS-M no cuenta).
- El plan gratuito de Render duerme tras un rato sin visitas; la primera carga tarda ~30 s.
