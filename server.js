'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
// Clave de DIOS-M. Cámbiala en producción con la variable de entorno GOD_KEY.
const GOD_KEY = process.env.GOD_KEY || 'E010901';
const MAX_PLAYERS = 4;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Mensajes que cualquier jugador puede enviar; el resto solo DIOS-M autenticado.
const PUBLIC_KINDS = new Set(['bye', 'rev', 'esp', 'bstart', 'batk', 'bhit', 'bdie']);

const INDEX = path.join(__dirname, 'public', 'index.html');
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); return res.end('Error'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('No encontrado');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const rooms = new Map(); // code -> {host, started, players: Map(name -> ws)}

const isDios = n => String(n).trim().toUpperCase() === 'DIOS-M';
const cleanName = v => String(v || '').trim().replace(/[^\wñÑáéíóúÁÉÍÓÚ-]/g, '').slice(0, 14);
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const roster = r => [...r.players.keys()];
const humans = r => [...r.players.values()].filter(w => !w.god).length;

function broadcastRoster(code) {
  const r = rooms.get(code); if (!r) return;
  const msg = { t: 'roster', code, roster: roster(r), host: r.host, started: r.started };
  r.players.forEach(w => send(w, msg));
}
function newCode() {
  let c;
  do { c = Array.from({ length: 5 }, () => ALPHA[Math.random() * ALPHA.length | 0]).join(''); } while (rooms.has(c));
  return c;
}
function leave(ws) {
  const code = ws.room; if (!code) return;
  const r = rooms.get(code); ws.room = null; ws.god = false;
  if (!r) return;
  r.players.delete(ws.name);
  const left = { t: 'msg', m: { k: 'bye', c: code, n: ws.name } };
  r.players.forEach(w => send(w, left));
  if (!r.players.size) { rooms.delete(code); return; }
  if (!r.players.has(r.host)) {
    const next = [...r.players.entries()].find(([, w]) => !w.god) || [...r.players.entries()][0];
    r.host = next[0];
  }
  broadcastRoster(code);
}

wss.on('connection', ws => {
  ws.alive = true; ws.auth = false; ws.room = null; ws.name = ''; ws.god = false; ws.bucket = 0; ws.stamp = Date.now();
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    // límite sencillo anti-flood: ~60 mensajes/seg
    const now = Date.now();
    ws.bucket = Math.max(0, ws.bucket - (now - ws.stamp) * 0.06) + 1; ws.stamp = now;
    if (ws.bucket > 60) return;
    let d; try { d = JSON.parse(raw); } catch (e) { return; }
    if (!d || typeof d !== 'object') return;

    switch (d.t) {
      case 'auth': {
        ws.auth = String(d.key || '').trim().replace(/\.$/, '') === GOD_KEY;
        send(ws, { t: 'auth', ok: ws.auth });
        break;
      }
      case 'create': {
        if (ws.room) leave(ws);
        const n = cleanName(d.n);
        if (!n) return send(ws, { t: 'err', msg: 'Nombre no válido.' });
        if (isDios(n) && !ws.auth) return send(ws, { t: 'err', msg: 'Ese nombre está reservado.' });
        const code = newCode();
        ws.name = n; ws.room = code; ws.god = isDios(n);
        rooms.set(code, { host: n, started: false, players: new Map([[n, ws]]) });
        send(ws, { t: 'created', code });
        break;
      }
      case 'join': {
        if (ws.room) leave(ws);
        const n = cleanName(d.n), code = String(d.code || '').trim().toUpperCase();
        const god = !!d.god;
        const fail = msg => send(ws, { t: 'err', where: god ? 'god' : 'join', msg });
        if (!n) return fail('Nombre no válido.');
        if ((god || isDios(n)) && !ws.auth) return send(ws, { t: 'err', where: 'god', need: 'auth', msg: 'Necesitas la clave.' });
        const r = rooms.get(code);
        if (!r) return fail('Esa sala no existe o ya se cerró.');
        if (r.players.has(n)) return fail('Ya hay un jugador con ese nombre en la sala.');
        const isGod = god || isDios(n);
        if (!isGod && r.started) return fail('Esa sala ya empezó. Solo DIOS-M puede entrar a salas iniciadas.');
        if (!isGod && humans(r) >= MAX_PLAYERS) return fail('La sala está llena (máximo 4).');
        ws.name = n; ws.room = code; ws.god = isGod;
        r.players.set(n, ws);
        send(ws, { t: 'joined', code, roster: roster(r), host: r.host, started: r.started });
        broadcastRoster(code);
        break;
      }
      case 'start': {
        const r = rooms.get(ws.room);
        if (!r || r.host !== ws.name || r.started) return;
        r.started = true;
        broadcastRoster(ws.room);
        break;
      }
      case 'leave': leave(ws); break;
      case 'list': {
        if (!ws.auth) return send(ws, { t: 'err', where: 'god', need: 'auth', msg: 'Necesitas la clave.' });
        const out = {};
        rooms.forEach((r, c) => { out[c] = { host: r.host, players: Object.fromEntries(roster(r).map(p => [p, 1])) }; });
        send(ws, { t: 'rooms', rooms: out });
        break;
      }
      case 'msg': {
        const r = rooms.get(ws.room); const m = d.m;
        if (!r || !m || typeof m !== 'object') return;
        if (m.k && !PUBLIC_KINDS.has(m.k) && !(ws.auth && isDios(ws.name))) return;
        m.n = ws.name; m.c = ws.room; // evita suplantar nombre/sala
        const out = JSON.stringify({ t: 'msg', m });
        r.players.forEach(w => { if (w !== ws && w.readyState === 1) w.send(out); });
        break;
      }
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

// Latidos: mantiene viva la conexión tras proxies (Render, Railway...) y limpia muertos.
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.alive) return ws.terminate();
    ws.alive = false; ws.ping();
  });
}, 25000);

server.listen(PORT, () => console.log('Truco o Trato online en http://localhost:' + PORT));
