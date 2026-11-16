// =============================================================
//  보글보글 퀴즈쇼 - 실시간 멀티플레이 서버 (외부 패키지 없음)
//  실행: node server.js   (Render 에서는 자동으로 PORT 를 넣어줍니다)
// =============================================================
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------
//  ⚙️ 게임 설정 (여기 숫자만 바꾸면 됩니다)
// ---------------------------------------------------------------
const CONFIG = {
  ANSWER_TIME_SEC: Number(process.env.ANSWER_TIME_SEC) || 10, // ⏱ 문제당 답을 고르는 시간(초). 예) 15초로 바꾸려면 10 → 15
  REVEAL_TIME_SEC: Number(process.env.REVEAL_TIME_SEC) || 4,  // 정답 공개 화면을 보여주는 시간(초)
  READY_TIME_SEC:  Number(process.env.READY_TIME_SEC)  || 3,  // 게임 시작 전 카운트다운(초)
  END_AUTO_RESET_SEC: 30,  // 게임이 끝난 뒤 자동으로 대기실로 돌아가는 시간(초)
  MAX_PLAYERS: 15,         // 한 방 최대 인원
};

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------
//  문제 불러오기 (questions.txt 한 줄에 한 문제, 끝에 (O) 또는 (X))
// ---------------------------------------------------------------
function loadQuestions() {
  const raw = fs.readFileSync(path.join(__dirname, 'questions.txt'), 'utf8');
  const list = [];
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    line = line.replace(/^\[?\s*문제\s*\]\s*/, '');
    const m = line.match(/\(\s*([OX])\s*\)/);
    if (!m) continue;                                   // 정답 표시가 없는 줄은 건너뜀
    const text = line.slice(0, m.index).replace(/\[문제\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) list.push({ text, answer: m[1] });
  }
  return list;
}
const QUESTIONS = loadQuestions();
console.log(`문제 ${QUESTIONS.length}개를 불러왔어요.`);

// ---------------------------------------------------------------
//  정적 파일 서버
// ---------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' });
    res.end(data);
  });
});

// ---------------------------------------------------------------
//  아주 작은 WebSocket 구현 (RFC 6455)
// ---------------------------------------------------------------
function wsSend(sock, obj) {
  if (sock.destroyed || !sock.writable) return;
  const payload = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  sock.write(Buffer.concat([header, payload]));
}
function wsControl(sock, opcode, payload = Buffer.alloc(0)) {
  if (sock.destroyed || !sock.writable) return;
  sock.write(Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]));
}

server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/ws' || !key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
             `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);
  const client = new Client(sock);
  let buf = Buffer.alloc(0);
  let frags = [];
  sock.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 1 << 20) { sock.destroy(); return; }
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0, opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 64 * 1024) { sock.destroy(); return; }
      const total = off + (masked ? 4 : 0) + len;
      if (buf.length < total) return;
      let data = buf.slice(off + (masked ? 4 : 0), total);
      if (masked) {
        const mask = buf.slice(off, off + 4);
        data = Buffer.from(data);
        for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      }
      buf = buf.slice(total);
      if (opcode === 0x8) { wsControl(sock, 0x8); sock.end(); return; }
      if (opcode === 0x9) { wsControl(sock, 0xA, data); continue; }
      if (opcode === 0xA) { client.alive = true; continue; }
      if (opcode === 0x1 || opcode === 0x0) {
        frags.push(data);
        if (fin) { const text = Buffer.concat(frags).toString('utf8'); frags = []; client.onMessage(text); }
      }
    }
  });
  sock.on('close', () => client.onClose());
  sock.on('error', () => client.onClose());
});

// ---------------------------------------------------------------
//  방 / 게임 로직
// ---------------------------------------------------------------
const rooms = new Map();
const rid = () => crypto.randomBytes(5).toString('hex');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// 경기장 좌표(화면 비율 0~1) 범위 – 클라이언트와 같은 값
const FIELD = { x0: 0.09, x1: 0.91, y0: 0.50, y1: 0.80 };
const sideOf = x => (x < 0.47 ? 'O' : x > 0.53 ? 'X' : null); // 가운데 선 위는 '선택 안 함'

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

class Room {
  constructor(name) {
    this.name = name;
    this.clients = new Set();
    this.players = new Map();       // client -> player
    this.outTokens = new Set();     // 이번 게임에서 탈락한 사람(재접속해도 관전)
    this.deck = [];
    this.phase = 'lobby';           // lobby | ready | question | reveal | end
    this.round = 0; this.q = null; this.endsAt = 0;
    this.wrong = []; this.winners = []; this.endTitle = '';
    this.hostId = null; this.dirty = true; this.lastSend = 0;
  }
  get playerList() { return [...this.players.values()]; }
  alive() { return this.playerList.filter(p => !p.out); }
  nextQuestion() {
    if (!this.deck.length) this.deck = shuffle(QUESTIONS.map((_, i) => i));
    const idx = this.deck.pop();
    this.round++;
    this.q = QUESTIONS[idx];
    this.phase = 'question';
    this.endsAt = Date.now() + CONFIG.ANSWER_TIME_SEC * 1000;
    this.wrong = [];
    this.dirty = true; this.broadcast(true);
  }
  start() {
    if (!this.players.size) return;
    this.outTokens.clear();
    for (const p of this.players.values()) p.out = false;
    this.round = 0; this.winners = []; this.wrong = []; this.q = null;
    this.phase = 'ready'; this.endsAt = Date.now() + CONFIG.READY_TIME_SEC * 1000;
    this.dirty = true; this.broadcast(true);
  }
  toLobby() {
    this.phase = 'lobby'; this.q = null; this.round = 0; this.wrong = []; this.winners = [];
    this.outTokens.clear();
    for (const p of this.players.values()) p.out = false;
    this.dirty = true; this.broadcast(true);
  }
  end(winners, title) {
    this.phase = 'end'; this.winners = winners.map(p => ({ n: p.name, c: p.ch }));
    this.endTitle = title; this.endsAt = Date.now() + CONFIG.END_AUTO_RESET_SEC * 1000;
    this.dirty = true; this.broadcast(true);
  }
  judge() {
    const ans = this.q.answer;
    const alive = this.alive();
    this.wrong = [];
    for (const p of alive) {
      if (sideOf(p.x) !== ans) { p.out = true; this.outTokens.add(p.token); this.wrong.push(p.id); }
    }
    this.lastAlive = alive;           // 이번 문제 직전 생존자 (전원 탈락 시 공동 생존자로 표시)
    this.phase = 'reveal'; this.endsAt = Date.now() + CONFIG.REVEAL_TIME_SEC * 1000;
    this.dirty = true; this.broadcast(true);
  }
  afterReveal() {
    const total = this.players.size, alive = this.alive();
    if (!total) return this.toLobby();
    if (alive.length === 0) {
      const last = (this.lastAlive || []).filter(p => [...this.players.values()].includes(p));
      return this.end(last, last.length ? '전원 탈락! 마지막까지 버틴 친구들' : '전원 탈락!');
    }
    if (total >= 2 && alive.length === 1) return this.end(alive, '최후의 1인 우승!');
    this.nextQuestion();
  }
  tick(now) {
    if (this.phase === 'ready' && now >= this.endsAt) this.nextQuestion();
    else if (this.phase === 'question') {
      if (!this.players.size) this.toLobby();
      else if (now >= this.endsAt) this.judge();
    } else if (this.phase === 'reveal' && now >= this.endsAt) this.afterReveal();
    else if (this.phase === 'end' && now >= this.endsAt) this.toLobby();
    if (this.dirty && now - this.lastSend > 66) this.broadcast(true);
    else if (now - this.lastSend > 1000) this.broadcast(true);
  }
  state() {
    const now = Date.now();
    return {
      t: 'state', ph: this.phase, r: this.round,
      q: this.q && this.phase !== 'ready' ? this.q.text : null,
      a: this.phase === 'reveal' ? this.q.answer : null,
      left: ['ready', 'question', 'reveal', 'end'].includes(this.phase) ? Math.max(0, this.endsAt - now) : 0,
      total: CONFIG.ANSWER_TIME_SEC * 1000,
      max: CONFIG.MAX_PLAYERS, host: this.hostId, watchers: this.clients.size,
      wrong: this.wrong, win: this.winners, title: this.endTitle,
      players: this.playerList.map(p => ({ id: p.id, n: p.name, c: p.ch, x: +p.x.toFixed(4), y: +p.y.toFixed(4), o: p.out ? 1 : 0 })),
    };
  }
  broadcast(force) {
    if (!force && !this.dirty) return;
    const s = JSON.stringify(this.state());
    for (const c of this.clients) wsSend(c.sock, s);
    this.dirty = false; this.lastSend = Date.now();
  }
  pickHost() {
    if (this.hostId && this.playerList.some(p => p.id === this.hostId)) return;
    const first = this.playerList[0];
    this.hostId = first ? first.id : null;
  }
}
function getRoom(name) {
  if (!rooms.has(name)) rooms.set(name, new Room(name));
  return rooms.get(name);
}

class Client {
  constructor(sock) { this.sock = sock; this.room = null; this.token = null; this.alive = true; this.lastMove = 0; }
  err(msg) { wsSend(this.sock, { t: 'err', msg }); }
  onMessage(text) {
    this.alive = true;
    let m; try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const room = this.room;
    switch (m.t) {
      case 'hello': {
        if (this.room) return;
        this.token = String(m.token || rid()).slice(0, 40);
        const name = String(m.room || 'main').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'main';
        this.room = getRoom(name);
        this.room.clients.add(this);
        wsSend(this.sock, { t: 'welcome', room: name });
        this.room.dirty = true;
        break;
      }
      case 'join': {
        if (!room) return;
        if (room.players.has(this)) return this.err('이미 참가 중이에요.');
        const running = !['lobby', 'end'].includes(room.phase);
        if (running && room.outTokens.has(this.token)) return this.err('이번 게임에서 탈락했어요. 게임이 끝나면 다시 참가할 수 있어요!');
        if (room.players.size >= CONFIG.MAX_PLAYERS) return this.err(`정원(${CONFIG.MAX_PLAYERS}명)이 꽉 찼어요. 관전하며 기다려 주세요!`);
        const ch = Number(m.ch);
        if (!Number.isInteger(ch) || ch < 0 || ch > 15) return this.err('캐릭터를 골라 주세요.');
        if (room.playerList.some(p => p.ch === ch)) return this.err('다른 친구가 먼저 고른 캐릭터예요!');
        const name = String(m.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8) || `플레이어${room.players.size + 1}`;
        const p = { id: rid(), token: this.token, name, ch, x: 0.5, y: FIELD.y0 + 0.05 + Math.random() * (FIELD.y1 - FIELD.y0 - 0.08), out: false };
        room.players.set(this, p);
        room.pickHost();
        wsSend(this.sock, { t: 'joined', id: p.id });
        room.dirty = true;
        break;
      }
      case 'move': {
        const p = room && room.players.get(this);
        if (!p || p.out || room.phase === 'reveal') return;
        const x = Number(m.x), y = Number(m.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        p.x = clamp(x, FIELD.x0, FIELD.x1); p.y = clamp(y, FIELD.y0, FIELD.y1);
        room.dirty = true;
        break;
      }
      case 'leave': this.leaveGame(); break;
      case 'start': {
        const p = room && room.players.get(this);
        if (!p || p.id !== room.hostId) return this.err('방장만 시작할 수 있어요.');
        if (!['lobby', 'end'].includes(room.phase)) return;
        room.start();
        break;
      }
      case 'lobby': {
        const p = room && room.players.get(this);
        if (!p || p.id !== room.hostId || room.phase !== 'end') return;
        room.toLobby();
        break;
      }
      case 'ping': wsSend(this.sock, { t: 'pong' }); break;
    }
  }
  leaveGame() {
    const room = this.room;
    if (!room || !room.players.has(this)) return;
    room.players.delete(this);
    room.pickHost();
    room.dirty = true;
  }
  onClose() {
    if (!this.room) return;
    this.leaveGame();
    this.room.clients.delete(this);
    const room = this.room;
    this.room = null;
    if (!room.clients.size) setTimeout(() => { if (!room.clients.size) rooms.delete(room.name); }, 60000);
  }
}

setInterval(() => { const now = Date.now(); for (const r of rooms.values()) r.tick(now); }, 50);
// 끊긴 연결 정리 (30초마다 ping)
setInterval(() => {
  for (const r of rooms.values()) for (const c of r.clients) {
    if (!c.alive) { c.sock.destroy(); continue; }
    c.alive = false; wsControl(c.sock, 0x9);
  }
}, 30000);

server.listen(PORT, () => console.log(`🫧 보글보글 퀴즈쇼 서버 실행 중: http://localhost:${PORT}`));
