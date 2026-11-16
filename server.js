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
  // ---- OX 게임 ----
  ANSWER_TIME_SEC: Number(process.env.ANSWER_TIME_SEC) || 10, // ⏱ OX 문제당 답을 고르는 시간(초). 예) 15초로 바꾸려면 10 → 15
  REVEAL_TIME_SEC: Number(process.env.REVEAL_TIME_SEC) || 4,  // OX 정답 공개 화면 시간(초)
  READY_TIME_SEC:  Number(process.env.READY_TIME_SEC)  || 3,  // 게임 시작 전 카운트다운(초)
  // ---- 그림 맞추기 ----
  DRAW_TIME_SEC:   Number(process.env.DRAW_TIME_SEC)   || 90, // ⏱ 그림 한 문제 제한 시간(초)
  DRAW_REVEAL_SEC: 4,      // 정답 공개 화면 시간(초)
  DRAW_WIN_SCORE:  3,      // 몇 번 먼저 맞히면 우승인지
  DRAW_MIN_PLAYERS: 2,     // 그림 맞추기 최소 인원
  // ---- 공통 ----
  END_AUTO_RESET_SEC: 30,  // 게임이 끝난 뒤 자동으로 대기실로 돌아가는 시간(초)
  MAX_PLAYERS: 15,         // 한 방 최대 인원
  MAX_ROOMS: 50,           // 서버 전체 최대 방 개수
};

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------
//  문제 / 제시어 불러오기
// ---------------------------------------------------------------
function loadQuestions(file) {
  const raw = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const list = [];
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    line = line.replace(/^\[?\s*문제\s*\]\s*/, '');
    const m = line.match(/\(\s*([OX])\s*\)/);
    if (!m) continue;                                   // 정답 표시가 없는 줄은 건너뜀
    const text = line.slice(0, m.index).replace(/\[문제\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) list.push({ text, answer: m[1] });
  }
  return list;
}
const norm = s => String(s || '').toLowerCase().replace(/[\s.,!?~'"`·\-_]/g, '');
function loadWords(file) {
  const raw = fs.readFileSync(path.join(__dirname, file), 'utf8');
  return raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
    const parts = l.split('|').map(s => s.trim()).filter(Boolean);
    return { word: parts[0], answers: parts.map(norm) };
  });
}
const QUESTIONS = { easy: loadQuestions('questions_easy.txt'), hard: loadQuestions('questions_hard.txt') };
const WORDS = loadWords('words.txt');
console.log(`OX 이지 ${QUESTIONS.easy.length}문제 / 하드 ${QUESTIONS.hard.length}문제 / 제시어 ${WORDS.length}개`);

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
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
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
//  공통 도우미
// ---------------------------------------------------------------
const rooms = new Map();
const allClients = new Set();
const rid = (n = 5) => crypto.randomBytes(n).toString('hex');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const pick = a => a[Math.floor(Math.random() * a.length)];
function newCode() { let c; do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c)); return c; }

// 화면 비율(0~1) 기준 경기장 범위 – 클라이언트와 같은 값
const FIELD = {
  ox:   { x0: 0.09, x1: 0.91, y0: 0.50, y1: 0.80 },
  draw: { x0: 0.07, x1: 0.93, y0: 0.47, y1: 0.89 },
};
const sideOf = x => (x < 0.47 ? 'O' : x > 0.53 ? 'X' : null); // 가운데 선 위는 '선택 안 함'

// ---------------------------------------------------------------
//  방
// ---------------------------------------------------------------
class Room {
  constructor({ mode, title, diff }) {
    this.code = newCode();
    this.mode = mode;                         // 'ox' | 'draw'
    this.title = title;
    this.diff = diff === 'hard' ? 'hard' : 'easy';
    this.clients = new Set();
    this.players = new Map();                 // client -> player
    this.outTokens = new Set();
    this.decks = { easy: [], hard: [], words: [] };
    this.phase = 'lobby';
    this.round = 0; this.endsAt = 0;
    this.q = null; this.wrong = [];
    this.winners = []; this.endTitle = '';
    this.hostId = null; this.dirty = true; this.lastSend = 0;
    this.createdAt = Date.now();
    // 그림 맞추기
    this.drawerId = null; this.word = null; this.points = []; this.sv = 0; this.ptsSent = 0;
    this.solver = null; this.msg = '';
  }
  get playerList() { return [...this.players.values()]; }
  byId(id) { return this.playerList.find(p => p.id === id); }
  clientOf(p) { for (const [c, q] of this.players) if (q === p) return c; return null; }
  alive() { return this.playerList.filter(p => !p.out); }
  summary() {
    return { code: this.code, title: this.title, mode: this.mode, diff: this.diff, n: this.players.size,
      max: CONFIG.MAX_PLAYERS, ph: this.phase, host: (this.byId(this.hostId) || {}).name || '' };
  }
  pickHost() {
    if (this.hostId && this.byId(this.hostId)) return;
    const first = this.playerList[0];
    this.hostId = first ? first.id : null;
  }
  toLobby() {
    this.phase = 'lobby'; this.q = null; this.round = 0; this.wrong = []; this.winners = [];
    this.drawerId = null; this.word = null; this.points = []; this.sv++; this.ptsSent = 0; this.solver = null; this.msg = '';
    this.outTokens.clear();
    for (const p of this.players.values()) { p.out = false; p.score = 0; p.b = 0; }
    this.touch(true);
  }
  end(winners, title) {
    this.phase = 'end'; this.winners = winners.map(p => ({ n: p.name, c: p.ch }));
    this.endTitle = title; this.endsAt = Date.now() + CONFIG.END_AUTO_RESET_SEC * 1000;
    this.touch(true);
  }
  touch(now) { this.dirty = true; if (now) this.broadcast(); }
  start(by) {
    if (!this.players.size) return;
    if (this.mode === 'draw' && this.players.size < CONFIG.DRAW_MIN_PLAYERS)
      return by && by.err(`그림 맞추기는 ${CONFIG.DRAW_MIN_PLAYERS}명 이상 있어야 시작할 수 있어요!`);
    this.outTokens.clear();
    for (const p of this.players.values()) { p.out = false; p.score = 0; p.b = 0; }
    this.round = 0; this.winners = []; this.wrong = []; this.q = null; this.solver = null; this.msg = '';
    this.phase = 'ready'; this.endsAt = Date.now() + CONFIG.READY_TIME_SEC * 1000;
    this.touch(true);
  }

  // ===================== OX =====================
  nextQuestion() {
    const pool = QUESTIONS[this.diff], deck = this.decks[this.diff];
    if (!deck.length) deck.push(...shuffle(pool.map((_, i) => i)));
    this.round++;
    this.q = pool[deck.pop()];
    this.phase = 'question';
    this.endsAt = Date.now() + CONFIG.ANSWER_TIME_SEC * 1000;
    this.wrong = [];
    this.touch(true);
  }
  judge() {
    const ans = this.q.answer, alive = this.alive();
    this.wrong = [];
    for (const p of alive) if (sideOf(p.x) !== ans) { p.out = true; this.outTokens.add(p.token); this.wrong.push(p.id); }
    this.lastAlive = alive;
    this.phase = 'reveal'; this.endsAt = Date.now() + CONFIG.REVEAL_TIME_SEC * 1000;
    this.touch(true);
  }
  afterReveal() {
    const total = this.players.size, alive = this.alive();
    if (!total) return this.toLobby();
    if (alive.length === 0) {
      const last = (this.lastAlive || []).filter(p => this.playerList.includes(p));
      return this.end(last, last.length ? '전원 탈락! 마지막까지 버틴 친구들' : '전원 탈락!');
    }
    if (total >= 2 && alive.length === 1) return this.end(alive, '최후의 1인 우승!');
    this.nextQuestion();
  }

  // ===================== 그림 맞추기 =====================
  beginTurn(drawer) {
    const deck = this.decks.words;
    if (!deck.length) deck.push(...shuffle(WORDS.map((_, i) => i)));
    this.round++;
    this.drawerId = drawer.id;
    this.word = WORDS[deck.pop()];
    this.points = []; this.sv++; this.ptsSent = 0;
    this.solver = null; this.msg = '';
    for (const p of this.players.values()) p.b = 0;
    drawer.x = 0.5; drawer.y = 0.68; drawer.b = 1;              // 비눗방울을 탄 채로 시작
    this.phase = 'draw'; this.endsAt = Date.now() + CONFIG.DRAW_TIME_SEC * 1000;
    const c = this.clientOf(drawer);
    if (c) wsSend(c.sock, { t: 'word', word: this.word.word, r: this.round });
    this.touch(true);
    this.sendPoints(true);
  }
  revealDraw(solver, msg) {
    this.solver = solver ? { id: solver.id, n: solver.name, c: solver.ch } : null;
    this.msg = msg || '';
    this.phase = 'reveal'; this.endsAt = Date.now() + CONFIG.DRAW_REVEAL_SEC * 1000;
    this.touch(true);
  }
  afterDrawReveal() {
    const list = this.playerList;
    if (list.length < CONFIG.DRAW_MIN_PLAYERS) {
      if (list.length) this.sysChat(`인원이 ${CONFIG.DRAW_MIN_PLAYERS}명보다 적어서 대기실로 돌아가요.`);
      return this.toLobby();
    }
    const sol = this.solver && this.byId(this.solver.id);
    if (sol && sol.score >= CONFIG.DRAW_WIN_SCORE) return this.end([sol], `${CONFIG.DRAW_WIN_SCORE}번 먼저 맞혀서 우승!`);
    let next = sol;                                         // 맞힌 사람이 다음 출제자
    if (!next) next = pick(list.filter(p => p.id !== this.drawerId)) || list[0];
    this.beginTurn(next);
  }
  guess(p, text) {
    const t = clean(text, 20);
    if (!t) return;
    if (this.phase === 'draw' && p.id !== this.drawerId && this.word && this.word.answers.includes(norm(t))) {
      p.score++;
      this.chat({ n: p.name, c: p.ch, text: '정답을 맞혔어요! 🎉', ok: 1 });
      return this.revealDraw(p);
    }
    if (this.phase === 'draw' && p.id === this.drawerId) {
      if (this.word && norm(t).includes(this.word.answers[0])) return;   // 출제자가 정답을 채팅으로 흘리는 것 방지
    }
    this.chat({ n: p.name, c: p.ch, text: t });
  }
  chat(m) { const s = JSON.stringify({ t: 'chat', ...m }); for (const c of this.clients) wsSend(c.sock, s); }
  sysChat(text) { this.chat({ n: '', c: -1, text, sys: 1 }); }
  drawPos(p, x, y, b) {
    const F = FIELD.draw;
    x = clamp(x, F.x0, F.x1); y = clamp(y, F.y0, F.y1); b = b ? 1 : 0;
    const last = this.points[this.points.length - 1];
    if (!last || Math.hypot(last[0] - x, last[1] - y) > 0.002 || last[2] !== b) {
      if (this.points.length < 12000) this.points.push([+x.toFixed(4), +y.toFixed(4), b]);
    }
    p.x = x; p.y = y; p.b = b;
    this.dirty = true;
  }
  sendPoints(full, onlyClient) {
    const from = full ? 0 : this.ptsSent;
    if (!full && from >= this.points.length) return;
    const s = JSON.stringify({ t: 'pts', sv: this.sv, from, pts: this.points.slice(from) });
    if (onlyClient) wsSend(onlyClient.sock, s);
    else { for (const c of this.clients) wsSend(c.sock, s); this.ptsSent = this.points.length; }
  }

  // ===================== 공통 진행 =====================
  tick(now) {
    if (this.mode === 'ox') {
      if (this.phase === 'ready' && now >= this.endsAt) this.nextQuestion();
      else if (this.phase === 'question') { if (!this.players.size) this.toLobby(); else if (now >= this.endsAt) this.judge(); }
      else if (this.phase === 'reveal' && now >= this.endsAt) this.afterReveal();
    } else {
      if (this.phase === 'ready' && now >= this.endsAt) {
        if (this.players.size < CONFIG.DRAW_MIN_PLAYERS) this.toLobby();
        else this.beginTurn(pick(this.playerList));
      } else if (this.phase === 'draw') {
        if (!this.byId(this.drawerId)) this.revealDraw(null, '출제자가 나갔어요');
        else if (now >= this.endsAt) this.revealDraw(null, '아무도 맞히지 못했어요');
        else this.sendPoints(false);
      } else if (this.phase === 'reveal' && now >= this.endsAt) this.afterDrawReveal();
    }
    if (this.phase === 'end' && now >= this.endsAt) this.toLobby();
    if (this.dirty && now - this.lastSend > 66) this.broadcast();
    else if (now - this.lastSend > 1000) this.broadcast();
  }
  state() {
    const now = Date.now();
    const s = {
      t: 'state', mode: this.mode, code: this.code, title: this.title, diff: this.diff,
      ph: this.phase, r: this.round,
      left: this.phase !== 'lobby' ? Math.max(0, this.endsAt - now) : 0,
      max: CONFIG.MAX_PLAYERS, host: this.hostId, watchers: this.clients.size,
      win: this.winners, title2: this.endTitle,
      players: this.playerList.map(p => ({ id: p.id, n: p.name, c: p.ch, x: +p.x.toFixed(4), y: +p.y.toFixed(4), o: p.out ? 1 : 0, s: p.score, b: p.b })),
    };
    if (this.mode === 'ox') {
      Object.assign(s, { q: this.q && this.phase !== 'ready' ? this.q.text : null,
        a: this.phase === 'reveal' ? this.q.answer : null, wrong: this.wrong, total: CONFIG.ANSWER_TIME_SEC * 1000 });
    } else {
      Object.assign(s, { drawer: this.drawerId, sv: this.sv, pn: this.points.length,
        hint: this.word && this.phase === 'draw' ? this.word.word.replace(/\S/g, '○') : null,
        word: this.word && this.phase === 'reveal' ? this.word.word : null,
        solver: this.solver, msg: this.msg, total: CONFIG.DRAW_TIME_SEC * 1000, goal: CONFIG.DRAW_WIN_SCORE });
    }
    return s;
  }
  broadcast() {
    const s = JSON.stringify(this.state());
    for (const c of this.clients) wsSend(c.sock, s);
    this.dirty = false; this.lastSend = Date.now();
  }
}

let listDirty = true;
function roomList(mode) {
  return [...rooms.values()].filter(r => r.mode === mode).sort((a, b) => b.createdAt - a.createdAt).map(r => r.summary());
}
function pushLists() {
  for (const c of allClients) if (c.listing && !c.room) wsSend(c.sock, { t: 'rooms', mode: c.listing, list: roomList(c.listing) });
  listDirty = false;
}

// ---------------------------------------------------------------
//  접속자
// ---------------------------------------------------------------
class Client {
  constructor(sock) { this.sock = sock; this.room = null; this.token = null; this.alive = true; this.listing = null; this.lastChat = 0; allClients.add(this); }
  err(msg) { wsSend(this.sock, { t: 'err', msg }); }
  enter(room) {
    if (this.room) this.exitRoom();
    this.room = room; this.listing = null;
    room.clients.add(this);
    wsSend(this.sock, { t: 'entered', code: room.code, mode: room.mode, title: room.title });
    room.touch(true);
    if (room.mode === 'draw') room.sendPoints(true, this);
    listDirty = true;
  }
  exitRoom() {
    const room = this.room;
    if (!room) return;
    this.leaveGame();
    room.clients.delete(this);
    this.room = null;
    if (!room.clients.size) setTimeout(() => { if (!room.clients.size) { rooms.delete(room.code); listDirty = true; } }, 20000);
    listDirty = true;
  }
  onMessage(text) {
    this.alive = true;
    let m; try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const room = this.room;
    const me = room && room.players.get(this);
    switch (m.t) {
      case 'hello': this.token = clean(m.token, 40) || rid(); break;
      case 'list': {
        this.listing = m.mode === 'draw' ? 'draw' : 'ox';
        if (this.room) this.exitRoom();
        wsSend(this.sock, { t: 'rooms', mode: this.listing, list: roomList(this.listing) });
        break;
      }
      case 'create': {
        if (rooms.size >= CONFIG.MAX_ROOMS) return this.err('방이 너무 많아요. 다른 방에 들어가 주세요!');
        const mode = m.mode === 'draw' ? 'draw' : 'ox';
        const r = new Room({ mode, title: clean(m.title, 16) || '보글보글 방', diff: m.diff });
        rooms.set(r.code, r);
        this.enter(r);
        break;
      }
      case 'enter': {
        const r = rooms.get(String(m.code || ''));
        if (!r) return wsSend(this.sock, { t: 'noroom' });
        this.enter(r);
        break;
      }
      case 'exitroom': this.exitRoom(); break;
      case 'join': {
        if (!room) return;
        if (me) return this.err('이미 참가 중이에요.');
        const running = !['lobby', 'end'].includes(room.phase);
        if (running && room.outTokens.has(this.token)) return this.err('이번 게임에서 탈락했어요. 게임이 끝나면 다시 참가할 수 있어요!');
        if (room.players.size >= CONFIG.MAX_PLAYERS) return this.err(`정원(${CONFIG.MAX_PLAYERS}명)이 꽉 찼어요. 관전하며 기다려 주세요!`);
        const ch = Number(m.ch);
        if (!Number.isInteger(ch) || ch < 0 || ch > 15) return this.err('캐릭터를 골라 주세요.');
        if (room.playerList.some(p => p.ch === ch)) return this.err('다른 친구가 먼저 고른 캐릭터예요!');
        const name = clean(m.name, 8) || `플레이어${room.players.size + 1}`;
        const F = FIELD[room.mode];
        const p = { id: rid(), token: this.token, name, ch, x: 0.5, y: F.y0 + 0.05 + Math.random() * (F.y1 - F.y0 - 0.08), out: false, score: 0, b: 0 };
        room.players.set(this, p);
        room.pickHost();
        wsSend(this.sock, { t: 'joined', id: p.id });
        if (room.mode === 'draw') room.sysChat(`${name} 님이 들어왔어요.`);
        room.touch(true); listDirty = true;
        break;
      }
      case 'move': {                     // OX: 목표 위치
        if (!me || room.mode !== 'ox') return;
        if (!me.out && room.phase === 'reveal') return;   // 유령은 언제든 움직일 수 있어요
        const x = Number(m.x), y = Number(m.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const F = FIELD.ox;
        me.x = clamp(x, F.x0, F.x1); me.y = clamp(y, F.y0, F.y1);
        room.dirty = true;
        break;
      }
      case 'pos': {                      // 그림 맞추기: 출제자의 실제 위치 + 비눗방울 여부
        if (!me || room.mode !== 'draw' || room.phase !== 'draw' || me.id !== room.drawerId) return;
        const x = Number(m.x), y = Number(m.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        room.drawPos(me, x, y, m.b);
        break;
      }
      case 'clear': {
        if (!me || !room || room.mode !== 'draw' || room.phase !== 'draw' || me.id !== room.drawerId) return;
        room.points = []; room.sv++; room.ptsSent = 0; room.sendPoints(true); room.touch(true);
        break;
      }
      case 'getpts': if (room && room.mode === 'draw') room.sendPoints(true, this); break;
      case 'chat': {
        if (!me || room.mode !== 'draw') return;
        const now = Date.now();
        if (now - this.lastChat < 400) return;
        this.lastChat = now;
        room.guess(me, m.text);
        break;
      }
      case 'diff': {
        if (!me || me.id !== room.hostId || room.mode !== 'ox' || !['lobby', 'end'].includes(room.phase)) return;
        room.diff = m.diff === 'hard' ? 'hard' : 'easy';
        room.touch(true); listDirty = true;
        break;
      }
      case 'leave': this.leaveGame(); break;
      case 'start': {
        if (!me || me.id !== room.hostId) return this.err('방장만 시작할 수 있어요.');
        if (!['lobby', 'end'].includes(room.phase)) return;
        room.start(this); listDirty = true;
        break;
      }
      case 'ping': wsSend(this.sock, { t: 'pong' }); break;
    }
  }
  leaveGame() {
    const room = this.room;
    if (!room || !room.players.has(this)) return;
    const p = room.players.get(this);
    if (room.mode === 'ox' && p.out) room.outTokens.add(p.token);
    room.players.delete(this);
    room.pickHost();
    if (room.mode === 'draw') room.sysChat(`${p.name} 님이 나갔어요.`);
    room.touch(); listDirty = true;
  }
  onClose() {
    if (!allClients.has(this)) return;
    allClients.delete(this);
    this.exitRoom();
  }
}

setInterval(() => { const now = Date.now(); for (const r of rooms.values()) r.tick(now); }, 50);
setInterval(() => { if (listDirty) pushLists(); }, 1000);
setInterval(() => pushLists(), 5000);
// 끊긴 연결 정리 (30초마다 ping)
setInterval(() => {
  for (const c of allClients) {
    if (!c.alive) { c.sock.destroy(); continue; }
    c.alive = false; wsControl(c.sock, 0x9);
  }
}, 30000);

server.listen(PORT, () => console.log(`🫧 보글보글 퀴즈쇼 서버 실행 중: http://localhost:${PORT}`));
