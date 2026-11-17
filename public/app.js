'use strict';
/* =========================================================
   보글보글 퀴즈쇼 - 클라이언트
   ※ 시간(초) 설정은 server.js 맨 위 CONFIG 에서 바꿔요.
   ========================================================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const CHAR_COUNT = 16;
const charSrc = i => `img/char${String(i + 1).padStart(2, '0')}.png`;
const FIELD = {                                         // server.js 와 같은 값
  ox:   { x0: 0.09, x1: 0.91, y0: 0.50, y1: 0.80 },
  draw: { x0: 0.07, x1: 0.93, y0: 0.47, y1: 0.89 },
};
const SPEED = { ox: 0.42, draw: 0.17, ride: 0.34 };   // 이동 속도 (화면 너비 비율/초) – draw 는 그림 그리기용으로 천천히
const sideOf = x => (x < 0.47 ? 'O' : x > 0.53 ? 'X' : null);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
for (let i = 0; i < CHAR_COUNT; i++) { const im = new Image(); im.src = charSrc(i); }

/* ---------------- 토스트 / 오버레이 ---------------- */
let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}
const openOv = id => $(id).classList.add('on');
const closeOv = id => $(id).classList.remove('on');
$$('[data-close]').forEach(b => b.addEventListener('click', () => { Sound.sfx('pop'); b.closest('.ov').classList.remove('on'); }));

/* =========================================================
   🎵 사운드 (Web Audio 로 직접 연주하는 칩튠 BGM + 효과음)
   ========================================================= */
const Sound = (() => {
  let ctx = null, master, bgmGain, sfxGain, noiseBuf, timer = null, nextT = 0, step = 0;
  let bgmOn = store.get('bgmOn', '1') === '1';
  let sfxOn = store.get('sfxOn', '1') === '1';
  const BPM = 150, STEP = 60 / BPM / 4;
  const f = m => 440 * Math.pow(2, (m - 69) / 12);
  const ROOTS = [48, 43, 45, 41, 48, 43, 41, 43];
  const CHORDS = [[60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65], [60, 64, 67], [59, 62, 67], [57, 60, 65], [59, 62, 67]];
  const MEL = [
    [[0, 72, 2], [2, 76, 2], [4, 79, 2], [6, 76, 1], [7, 79, 1], [8, 84, 3], [12, 81, 2], [14, 79, 2]],
    [[0, 79, 2], [2, 74, 2], [4, 71, 2], [6, 74, 2], [8, 79, 4], [12, 77, 2], [14, 76, 2]],
    [[0, 76, 2], [2, 72, 2], [4, 69, 2], [6, 72, 1], [7, 76, 1], [8, 81, 3], [12, 79, 2], [14, 76, 2]],
    [[0, 77, 2], [2, 76, 2], [4, 74, 2], [6, 72, 2], [8, 74, 6], [14, 67, 2]],
    [[0, 72, 1], [1, 72, 1], [2, 76, 2], [4, 79, 2], [6, 84, 2], [8, 83, 2], [10, 84, 2], [12, 86, 4]],
    [[0, 83, 2], [2, 79, 2], [4, 74, 2], [6, 79, 2], [8, 83, 3], [11, 81, 1], [12, 79, 4]],
    [[0, 81, 2], [2, 77, 2], [4, 72, 2], [6, 77, 2], [8, 81, 2], [10, 79, 2], [12, 77, 2], [14, 74, 2]],
    [[0, 79, 3], [3, 74, 1], [4, 79, 2], [6, 83, 2], [8, 86, 6], [14, 71, 1], [15, 74, 1]],
  ];
  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    bgmGain = ctx.createGain(); bgmGain.gain.value = 0.16; bgmGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.5; sfxGain.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function tone(out, type, freq, t, dur, vol, freqEnd) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(out, t, dur, vol, hp) {
    const s = ctx.createBufferSource(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
    s.buffer = noiseBuf; fl.type = 'highpass'; fl.frequency.value = hp;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.02);
  }
  function playStep(s, t) {
    const bar = Math.floor(s / 16) % 8, st = s % 16;
    for (const [at, m, len] of MEL[bar]) if (at === st) { tone(bgmGain, 'square', f(m), t, len * STEP * 0.95, 0.32); tone(bgmGain, 'triangle', f(m + 12), t, len * STEP * 0.6, 0.08); }
    if (st % 2 === 0) { const r = ROOTS[bar] + (st % 4 === 2 ? 12 : 0); tone(bgmGain, 'triangle', f(r), t, STEP * 1.8, 0.55); }
    if (st % 4 === 2) for (const n of CHORDS[bar]) tone(bgmGain, 'square', f(n), t, STEP * 0.9, 0.05);
    if (st === 0 || st === 8 || st === 10) tone(bgmGain, 'sine', 150, t, 0.16, 0.9, 40);
    if (st === 4 || st === 12) noise(bgmGain, t, 0.14, 0.35, 1500);
    if (st % 2 === 1) noise(bgmGain, t, 0.04, 0.12, 7000);
  }
  function startBgm() {
    if (!ctx || timer || !bgmOn) return;
    nextT = ctx.currentTime + 0.08; step = 0;
    timer = setInterval(() => {
      while (nextT < ctx.currentTime + 0.15) { playStep(step, nextT); nextT += STEP; step = (step + 1) % 128; }
    }, 25);
  }
  function stopBgm() { clearInterval(timer); timer = null; }
  function unlock() { init(); if (!ctx) return; if (ctx.state === 'suspended') ctx.resume(); if (bgmOn) startBgm(); }
  function sfx(name) {
    if (!sfxOn) return; init(); if (!ctx) return;
    const t = ctx.currentTime + 0.01, o = sfxGain;
    switch (name) {
      case 'wrong':
        tone(o, 'sawtooth', 300, t, 0.18, 0.5, 280); tone(o, 'square', 150, t, 0.18, 0.25);
        tone(o, 'sawtooth', 200, t + 0.22, 0.55, 0.5, 90); tone(o, 'square', 100, t + 0.22, 0.55, 0.25, 60); break;
      case 'correct': [72, 76, 79, 84].forEach((m, i) => tone(o, 'square', f(m), t + i * 0.08, 0.16, 0.3)); tone(o, 'triangle', f(88), t + 0.32, 0.4, 0.3); break;
      case 'tick':    tone(o, 'square', 1250, t, 0.06, 0.25); break;
      case 'ding':    tone(o, 'sine', f(88), t, 0.5, 0.4); tone(o, 'sine', f(81), t + 0.12, 0.6, 0.35); break;
      case 'start':   [67, 72, 76].forEach((m, i) => tone(o, 'square', f(m), t + i * 0.12, 0.12, 0.3)); tone(o, 'square', f(79), t + 0.36, 0.5, 0.35); break;
      case 'win':     [72, 76, 79, 84, 79, 84, 88].forEach((m, i) => tone(o, 'square', f(m), t + i * 0.11, 0.2, 0.3)); break;
      case 'thunder': {
        const crack = ctx.createBufferSource(), cg = ctx.createGain(), hp = ctx.createBiquadFilter();
        crack.buffer = noiseBuf; hp.type = 'highpass'; hp.frequency.value = 1800;
        cg.gain.setValueAtTime(0.9, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        crack.connect(hp); hp.connect(cg); cg.connect(o); crack.start(t); crack.stop(t + 0.3);
        for (let i = 0; i < 3; i++) {
          const r = ctx.createBufferSource(), rg = ctx.createGain(), lp = ctx.createBiquadFilter();
          r.buffer = noiseBuf; r.loop = true; lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t + i * 0.12);
          lp.frequency.exponentialRampToValueAtTime(70, t + 1.6);
          rg.gain.setValueAtTime(0.0001, t + i * 0.12); rg.gain.exponentialRampToValueAtTime(0.9 - i * 0.2, t + i * 0.12 + 0.05);
          rg.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
          r.connect(lp); lp.connect(rg); rg.connect(o); r.start(t + i * 0.12); r.stop(t + 1.8);
        }
        tone(o, 'sine', 70, t, 1.2, 0.6, 30); break;
      }
      case 'pop':     tone(o, 'sine', 420, t, 0.09, 0.4, 950); break;
      case 'chat':    tone(o, 'sine', 900, t, 0.06, 0.15, 1300); break;
      case 'step':    tone(o, 'sine', 600, t, 0.05, 0.08, 900); break;
      case 'bubble':  tone(o, 'sine', 300, t, 0.25, 0.35, 1100); tone(o, 'sine', 600, t + 0.08, 0.2, 0.2, 1600); break;
      case 'land':    tone(o, 'sine', 900, t, 0.15, 0.3, 250); noise(o, t + 0.05, 0.12, 0.2, 2500); break;
    }
  }
  function setBgm(on) { bgmOn = on; store.set('bgmOn', on ? '1' : '0'); if (on) unlock(); else stopBgm(); }
  function setSfx(on) { sfxOn = on; store.set('sfxOn', on ? '1' : '0'); }
  return { unlock, sfx, setBgm, setSfx, get bgmOn() { return bgmOn; }, get sfxOn() { return sfxOn; } };
})();

function refreshSoundBtns() {
  $$('.bgmBtn').forEach(b => { b.classList.toggle('off', !Sound.bgmOn); b.title = '배경음악 ' + (Sound.bgmOn ? '끄기' : '켜기'); });
  $$('.sfxBtn').forEach(b => { b.classList.toggle('off', !Sound.sfxOn); b.textContent = Sound.sfxOn ? '🔊' : '🔈'; });
}
$$('.bgmBtn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); Sound.setBgm(!Sound.bgmOn); refreshSoundBtns(); toast(Sound.bgmOn ? '🎵 배경음악 ON' : '🎵 배경음악 OFF', 1000); }));
$$('.sfxBtn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); Sound.setSfx(!Sound.sfxOn); refreshSoundBtns(); Sound.sfx('pop'); toast(Sound.sfxOn ? '🔊 효과음 ON' : '🔈 효과음 OFF', 1000); }));
refreshSoundBtns();
['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => Sound.unlock(), { passive: true }));

/* ---------------- 메뉴 ---------------- */
(() => {
  const box = $('#menuBubbles');
  for (let i = 0; i < 14; i++) {
    const b = document.createElement('div'); b.className = 'bub';
    const s = 2 + Math.random() * 5;
    Object.assign(b.style, { left: Math.random() * 100 + '%', width: s + 'cqw', height: s + 'cqw',
      animationDuration: 7 + Math.random() * 9 + 's', animationDelay: -Math.random() * 14 + 's' });
    box.appendChild(b);
  }
})();
let view = 'menu';
function showScreen(id) { $$('.screen').forEach(s => s.classList.toggle('on', s.id === id)); }
$('#btnOX').addEventListener('click', () => { Sound.sfx('start'); openRooms('ox'); });
$('#btnDraw').addEventListener('click', () => { Sound.sfx('start'); openRooms('draw'); });
$('#btnHow').addEventListener('click', () => { Sound.sfx('pop'); openOv('#howOv'); });
$('#btnExit').addEventListener('click', () => { Sound.sfx('pop'); openOv('#exitOv'); });
$('#exitYes').addEventListener('click', () => { closeOv('#exitOv'); Sound.setBgm(false); refreshSoundBtns(); try { window.close(); } catch {} openOv('#byeOv'); });

/* =========================================================
   🌐 서버 연결
   ========================================================= */
let token = store.get('ox_token', '');
if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('ox_token', token); }
let ws = null, connected = false, retry = 0;
let S = null, myId = null, roomCode = null, roomMode = null, listMode = 'ox';
let pendingCode = (new URLSearchParams(location.search).get('room') || '').replace(/\D/g, '').slice(0, 6) || null;

function connect() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  try { ws = new WebSocket(url); } catch { setTimeout(connect, 2000); return; }
  ws.onopen = () => {
    connected = true; retry = 0;
    send({ t: 'hello', token });
    if (view === 'room' && roomCode) send({ t: 'enter', code: roomCode });
    else if (pendingCode) send({ t: 'enter', code: pendingCode });
    else if (view === 'rooms') send({ t: 'list', mode: listMode });
  };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onServer(m); };
  ws.onclose = () => { connected = false; if (myId) { myId = null; if (view === 'room') toast('연결이 끊겨 다시 들어가는 중이에요…'); } setTimeout(connect, Math.min(5000, 600 * ++retry)); };
  ws.onerror = () => {};
}
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
setInterval(() => send({ t: 'ping' }), 20000);
connect();

function onServer(m) {
  switch (m.t) {
    case 'rooms': if (view === 'rooms' && m.mode === listMode) renderRooms(m.list); break;
    case 'entered': onEntered(m); break;
    case 'noroom': pendingCode = null; history.replaceState(null, '', location.pathname); toast('그 방은 이미 없어졌어요. 다른 방을 골라 주세요!'); if (view !== 'rooms') openRooms(listMode); break;
    case 'state': onState(m); break;
    case 'joined': myId = m.id; myT = null; closeOv('#selectOv'); Sound.sfx('pop');
      toast(roomMode === 'draw' ? '입장 완료! 출제자가 되면 경기장에 나가요 🎨' : '입장 완료! 바닥을 눌러 움직여 보세요 🫧', 1800); break;
    case 'err': Sound.sfx('wrong'); toast(m.msg, 2600); break;
    case 'word': myWord = m.word; break;
    case 'pts': onPoints(m); break;
    case 'chat': onChat(m); break;
  }
}

/* =========================================================
   🏠 방 목록 / 방 만들기
   ========================================================= */
function openRooms(mode) {
  listMode = mode; view = 'rooms';
  $('#roomsTitle').textContent = mode === 'ox' ? '⭕ OX 게임 방 목록' : '🎨 그림 맞추기 방 목록';
  $('#roomList').innerHTML = '<div class="empty">방 목록을 불러오는 중…</div>';
  showScreen('rooms');
  connect(); send({ t: 'list', mode });
}
function renderRooms(list) {
  const box = $('#roomList');
  if (!list.length) { box.innerHTML = '<div class="empty">아직 열린 방이 없어요 🫧<br>＋ 방 만들기로 첫 방을 열어 보세요!</div>'; return; }
  box.innerHTML = '';
  for (const r of list) {
    const d = document.createElement('div'); d.className = 'roomItem';
    const playing = !['lobby', 'end'].includes(r.ph);
    const modeBadge = r.mode === 'ox' ? `<span class="badge ${r.diff}">${r.diff === 'hard' ? '🔥 하드' : '🐣 이지'}</span>` : '<span class="badge draw">🎨 그림</span>';
    d.innerHTML = `<div class="rt"><b>${esc(r.title)}</b><small>방 번호 ${r.code}${r.host ? ' · 👑 ' + esc(r.host) : ''}</small></div>
      ${modeBadge}<span class="badge ${playing ? 'play' : 'wait'}">${playing ? '게임 중' : '대기 중'}</span><span class="cnt">${r.n}/${r.max}</span>`;
    d.addEventListener('click', () => { Sound.sfx('pop'); send({ t: 'enter', code: r.code }); });
    box.appendChild(d);
  }
}
$('#roomsBack').addEventListener('click', () => { Sound.sfx('pop'); view = 'menu'; showScreen('menu'); });
let createDiff = 'easy';
$('#createOpen').addEventListener('click', () => {
  Sound.sfx('pop');
  $('#createTitle').textContent = listMode === 'ox' ? '⭕ OX 게임 방 만들기' : '🎨 그림 맞추기 방 만들기';
  $('#diffBox').style.display = listMode === 'ox' ? '' : 'none';
  const nick = store.get('ox_nick', '');
  $('#roomName').value = nick ? `${nick}의 방` : '';
  openOv('#createOv');
});
$$('#createDiff button').forEach(b => b.addEventListener('click', () => {
  createDiff = b.dataset.diff; Sound.sfx('pop');
  $$('#createDiff button').forEach(x => x.classList.toggle('on', x === b));
}));
$('#createBtn').addEventListener('click', () => {
  if (!connected) { toast('서버에 연결 중이에요… 잠시 후 다시 눌러 주세요.'); return; }
  send({ t: 'create', mode: listMode, title: $('#roomName').value.trim(), diff: createDiff });
  closeOv('#createOv');
});
$('#roomName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#createBtn').click(); });

/* =========================================================
   🚪 방 입장 / 퇴장
   ========================================================= */
let root = $('#game');                          // 지금 보고 있는 게임 화면
const Q = sel => root.querySelector(sel);
function onEntered(m) {
  const wasSame = roomCode === m.code && view === 'room';
  roomCode = m.code; roomMode = m.mode; listMode = m.mode; pendingCode = null; view = 'room';
  history.replaceState(null, '', `${location.pathname}?room=${m.code}`);
  root = $(m.mode === 'draw' ? '#draw' : '#game');
  if (!wasSame) {
    S = null; myId = null; myT = null; prevS = null;
    for (const e of ents.values()) e.el.remove();
    ents.clear();
    resetTrail(); $('#chatlog').innerHTML = ''; myWord = null;
  }
  showScreen(root.id);
  closeOv('#resultOv');
  if (!myId) openSelect();
}
function leaveRoom() {
  send({ t: 'exitroom' }); myId = null; roomCode = null; S = null;
  history.replaceState(null, '', location.pathname);
  closeOv('#selectOv'); closeOv('#resultOv');
  openRooms(roomMode || 'ox');
}
$$('.backBtn').forEach(b => b.addEventListener('click', () => { Sound.sfx('pop'); leaveRoom(); }));
$$('.inviteBtn').forEach(b => b.addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${roomCode}`;
  try { await navigator.clipboard.writeText(url); toast('🔗 초대 링크를 복사했어요! 친구에게 붙여 넣어 보내 주세요.'); }
  catch { toast(`초대 링크: ${url}`, 5000); }
}));

/* ---------- 캐릭터 선택 (4x4) ---------- */
let pickCh = -1;
(() => {
  const g = $('#charGrid');
  for (let i = 0; i < CHAR_COUNT; i++) {
    const c = document.createElement('div'); c.className = 'card'; c.dataset.i = i;
    c.innerHTML = `<span class="num">${i + 1}</span><img src="${charSrc(i)}" alt="캐릭터 ${i + 1}" draggable="false">`;
    c.addEventListener('click', () => {
      if (c.classList.contains('taken')) { toast('다른 친구가 고른 캐릭터예요!', 1300); return; }
      pickCh = i; Sound.sfx('pop'); refreshSelect();
    });
    g.appendChild(c);
  }
  $('#nick').value = store.get('ox_nick', '');
})();
function refreshSelect() {
  const taken = new Set((S ? S.players : []).filter(p => p.id !== myId).map(p => p.c));
  if (taken.has(pickCh)) pickCh = -1;
  $$('#charGrid .card').forEach(c => { const i = +c.dataset.i; c.classList.toggle('taken', taken.has(i)); c.classList.toggle('sel', i === pickCh); });
}
function openSelect() {
  if (S && S.players.length >= S.max) { toast(`정원(${S.max}명)이 꽉 찼어요. 관전하며 기다려 주세요!`); return; }
  refreshSelect(); openOv('#selectOv');
}
$('#enterBtn').addEventListener('click', () => {
  if (pickCh < 0) { toast('캐릭터를 먼저 골라 주세요!', 1400); return; }
  if (!connected) { toast('서버에 연결 중이에요… 잠시 후 다시 눌러 주세요.'); return; }
  const name = $('#nick').value.trim(); store.set('ox_nick', name);
  send({ t: 'join', ch: pickCh, name });
});
$('#nick').addEventListener('keydown', e => { if (e.key === 'Enter') $('#enterBtn').click(); });
$('#watchBtn').addEventListener('click', () => { Sound.sfx('pop'); closeOv('#selectOv'); });
$$('.joinBtn').forEach(b => b.addEventListener('click', () => { Sound.sfx('pop'); openSelect(); }));
$$('.startBtn').forEach(b => b.addEventListener('click', () => { Sound.sfx('pop'); send({ t: 'start' }); }));
$('#againBtn').addEventListener('click', () => { Sound.sfx('pop'); send({ t: 'start' }); closeOv('#resultOv'); });
$$('.lobbyDiff button').forEach(b => b.addEventListener('click', () => { Sound.sfx('pop'); send({ t: 'diff', diff: b.dataset.diff }); }));

/* =========================================================
   📡 상태 수신
   ========================================================= */
let prevS = null, endsAt = 0, lastTickSec = -1;
const meP = () => (S && myId ? S.players.find(p => p.id === myId) : null);
function onState(m) {
  if (view !== 'room' || m.code !== roomCode) return;
  const old = S; S = m; endsAt = performance.now() + m.left;
  const me = meP();
  if (myId && !me) myId = null;
  if (m.mode === 'ox') {
    if (me && !myT) myT = { x: me.x, y: me.y };
  }
  if (!old || m.ph !== old.ph || m.r !== old.r) (m.mode === 'ox' ? oxPhase : drawPhase)(old, m, me);
  if ($('#selectOv').classList.contains('on')) refreshSelect();
  syncEntities(m.players);
  renderHud();
  prevS = m;
}

function banner(text, bad) {
  const b = Q('.banner'); b.textContent = text; b.classList.toggle('bad', !!bad);
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}
function showResult(m) {
  Sound.sfx('win');
  $('#resultTitle').textContent = '🏆 ' + (m.title2 || '게임 종료!');
  const w = $('#winners'); w.innerHTML = '';
  for (const p of m.win) {
    const d = document.createElement('div');
    const img = document.createElement('img'); img.src = charSrc(p.c); img.alt = '';
    const n = document.createElement('span'); n.textContent = p.n;
    d.append(img, n); w.appendChild(d);
  }
  if (!m.win.length) w.innerHTML = '<div style="font-size:5cqw">🫧 아무도 남지 않았어요</div>';
  $('#resultSub').textContent = `총 ${m.r}${m.mode === 'ox' ? '문제' : '라운드'} 진행 · 잠시 후 대기실로 돌아가요`;
  $('#againBtn').style.display = myId && m.host === myId ? '' : 'none';
  openOv('#resultOv');
  confetti();
}
function confetti() {
  const st = $('#stage'), colors = ['#ffe14d', '#ff7a6b', '#5fe0e6', '#7cffc5', '#c8a2ff', '#fff'];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('div'); c.className = 'confetti';
    Object.assign(c.style, { left: Math.random() * 100 + '%', background: colors[i % colors.length],
      animationDuration: 2 + Math.random() * 2.5 + 's', animationDelay: Math.random() * .8 + 's', borderRadius: i % 3 ? '2px' : '50%' });
    st.appendChild(c); setTimeout(() => c.remove(), 6000);
  }
}

/* ---------- 공통 HUD ---------- */
function renderHud() {
  if (!S) return;
  const n = S.players.length, me = meP();
  const amHost = !!(myId && S.host === myId);
  const hostP = S.players.find(p => p.id === S.host);
  Q('.dot').classList.toggle('ok', connected);
  const alive = S.players.filter(p => !p.o).length;
  let info = `<span class="codeTag">${esc(S.title)} #${S.code}</span> · 참가 ${n}/${S.max}`;
  if (S.mode === 'ox') info += ` · ${S.diff === 'hard' ? '🔥하드' : '🐣이지'}` + (S.ph !== 'lobby' && me && !me.o ? ` · 생존 ${alive}` : '');
  if (hostP) info += ` · 👑${esc(hostP.n)}`;
  Q('.infoText').innerHTML = connected ? info : '서버 연결이 끊겼어요. 다시 연결 중…';
  Q('.round').style.display = S.r && !['lobby'].includes(S.ph) ? 'block' : 'none';
  Q('.round').textContent = S.mode === 'ox' ? `Q${S.r}` : `R${S.r}`;
  const lobbyish = S.ph === 'lobby';
  Q('.startBtn').style.display = amHost && lobbyish ? 'block' : 'none';
  let note = '';
  if (lobbyish && !amHost) note = n ? '👑 방장이 시작하면 게임이 시작돼요!' : '첫 번째로 입장하면 방장이 돼요!';
  if (lobbyish && amHost && S.mode === 'draw' && n < 2) note = '2명 이상 모이면 시작할 수 있어요!';
  Q('.note').textContent = note; Q('.note').style.display = note ? 'block' : 'none';
  if (lobbyish && amHost && S.mode === 'draw' && n < 2) Q('.startBtn').style.display = 'none';
  Q('.joinBtn').style.display = !me && !$('#selectOv').classList.contains('on') ? 'block' : 'none';
  (S.mode === 'ox' ? oxHud : drawHud)(me, amHost);
}

function hudLoop() {
  if (S && view === 'room') {
    const left = Math.max(0, endsAt - performance.now());
    const t = Q('.timer'), bar = Q('.tbar');
    const timed = S.mode === 'ox' ? ['question', 'ready'] : ['draw', 'ready'];
    const playPh = S.mode === 'ox' ? 'question' : 'draw';
    if (timed.includes(S.ph)) {
      const sec = Math.ceil(left / 1000);
      t.style.display = 'flex'; t.textContent = sec;
      t.classList.toggle('hurry', S.ph === playPh && sec <= (S.mode === 'ox' ? 3 : 10));
      if (S.ph === playPh) {
        bar.style.display = 'block'; bar.firstElementChild.style.transform = `scaleX(${left / S.total})`;
        if (sec <= 3 && sec > 0 && sec !== lastTickSec) { lastTickSec = sec; Sound.sfx('tick'); }
      } else bar.style.display = 'none';
    } else { t.style.display = 'none'; bar.style.display = 'none'; }
    if (S.mode === 'ox') {
      const me = meP(), side = myT && me && !me.o ? sideOf(myT.x) : null;
      $('#pickO').classList.toggle('pick', S.ph === 'question' && side === 'O');
      $('#pickX').classList.toggle('pick', S.ph === 'question' && side === 'X');
    }
  }
  setTimeout(hudLoop, 100);
}
hudLoop();

/* =========================================================
   ⭕ OX 게임
   ========================================================= */
function oxPhase(old, m, me) {
  const ph = m.ph;
  if (ph === 'ready') { Sound.sfx('start'); closeOv('#resultOv'); banner('준비~!', false); }
  if (ph === 'question') {
    Sound.sfx('ding'); lastTickSec = -1;
    const b = Q('.board'); b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
  }
  if (ph === 'reveal' && old && old.ph === 'question') {
    const wrong = new Set(m.wrong);
    $(`#glow${m.a}`).classList.add('on');
    let delay = 0;
    for (const id of wrong) { const e = ents.get(id); if (e) { lightning(e, delay); delay += 140 + Math.random() * 120; } }
    if (wrong.size) Sound.sfx('thunder');
    for (const p of m.players) if (!p.o) { const e = ents.get(p.id); if (e) { e.el.classList.add('cheer'); setTimeout(() => e.el.classList.remove('cheer'), 1400); } }
    if (myId && wrong.has(myId)) { setTimeout(() => Sound.sfx('wrong'), 450); banner('⚡ 번개 맞았다! 유령 모드 👻', true); }
    else if (me && !me.o) { if (!wrong.size) Sound.sfx('correct'); else setTimeout(() => Sound.sfx('correct'), 600); banner(`정답 ${m.a}! 🎉`, false); }
    else { if (!wrong.size) Sound.sfx('correct'); banner(`정답은 ${m.a}!`, false); }
  }
  if (ph !== 'reveal') { $('#glowO').classList.remove('on'); $('#glowX').classList.remove('on'); }
  if (ph === 'end') showResult(m);
  if (ph === 'lobby') closeOv('#resultOv');
}
function oxHud(me, amHost) {
  const b = Q('.board');
  const n = S.players.length;
  let html = '';
  if (S.ph === 'lobby') html = `참가자를 기다리는 중이에요!<span class="sub">난이도 ${S.diff === 'hard' ? '🔥 하드' : '🐣 이지'} · 바닥을 눌러 움직여 보세요 (${n}/${S.max})</span>`;
  else if (S.ph === 'ready') html = `곧 문제가 나와요!<span class="sub">O·X 구역 위치를 확인하세요</span>`;
  else if (S.ph === 'question') html = esc(S.q || '');
  else if (S.ph === 'reveal') html = `${esc(S.q || '')}<span class="ans ${S.a}">${S.a}</span>`;
  else if (S.ph === 'end') html = `게임 종료!<span class="sub">${esc(S.title2 || '')}</span>`;
  const len = (S.q || '').length;
  b.style.fontSize = (S.ph === 'question' || S.ph === 'reveal') ? (len > 95 ? '3cqw' : len > 65 ? '3.5cqw' : len > 40 ? '4cqw' : '4.6cqw') : '4.3cqw';
  if (b.dataset.h !== html) { b.innerHTML = `<div>${html}</div>`; b.dataset.h = html; }
  const ld = Q('.lobbyDiff');
  ld.style.display = amHost && S.ph === 'lobby' ? 'flex' : 'none';
  ld.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.diff === S.diff));
  Q('.spectate').style.display = me && me.o && S.ph !== 'lobby' ? 'block' : 'none';
  const lock = !me || (!me.o && S.ph === 'reveal');
  $('#pickO').disabled = lock; $('#pickX').disabled = lock;
}

/* ⚡ 하늘에서 번개가 떨어져 캐릭터를 맞히는 연출 */
function lightning(e, delay) {
  const ZAP = 650, BURN = 1300;          // 번쩍이는 시간 / 까맣게 탄 채로 있는 시간(ms)
  e.fxUntil = performance.now() + delay + ZAP + BURN;
  setTimeout(() => {
    const game = $('#game'), H = 1659 / 948 * 100;
    const tx = e.x * 100, ty = e.y * H - 9;
    const sx = tx + (Math.random() * 30 - 15);
    const pts = [[sx, -2]], N = 10;
    for (let i = 1; i < N; i++) { const k = i / N; pts.push([sx + (tx - sx) * k + (Math.random() * 9 - 4.5), -2 + (ty + 2) * k]); }
    pts.push([tx, ty]);
    const bi = 3 + Math.floor(Math.random() * 4), [bx, by] = pts[bi];
    const branch = [[bx, by], [bx + (Math.random() < .5 ? -1 : 1) * (6 + Math.random() * 6), by + 8], [bx + (Math.random() * 10 - 5), by + 15]];
    const P = a => a.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'boltLayer'); svg.setAttribute('viewBox', `0 0 100 ${H}`); svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML = `<polyline class="glow" points="${P(pts)}"/><polyline class="br" points="${P(branch)}"/><polyline class="core" points="${P(pts)}"/>`;
    game.appendChild(svg); setTimeout(() => svg.remove(), 650);
    const fl = game.querySelector('.flashOv'); fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
    const st = $('#stage'); st.classList.remove('quake'); void st.offsetWidth; st.classList.add('quake');
    const sc = document.createElement('div'); sc.className = 'scorch';
    sc.style.left = e.x * 100 + '%'; sc.style.top = e.y * 100 + '%';
    game.appendChild(sc); setTimeout(() => sc.remove(), 4100);
    for (let i = 0; i < 10; i++) {
      const sp = document.createElement('div'); sp.className = 'spark';
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 10;
      sp.style.left = e.x * 100 + '%'; sp.style.top = (e.y * 100 - 4) + '%';
      sp.style.setProperty('--dx', Math.cos(a) * r + 'cqw'); sp.style.setProperty('--dy', Math.sin(a) * r - 3 + 'cqw');
      game.appendChild(sp); setTimeout(() => sp.remove(), 700);
    }
    e.el.classList.remove('out', 'burnt', 'hidden'); e.el.classList.add('zap');
    setTimeout(() => {
      e.el.classList.remove('zap'); e.el.classList.add('burnt');
      for (let i = 0; i < 5; i++) setTimeout(() => {
        const sm = document.createElement('div'); sm.className = 'smoke';
        sm.style.left = (e.x * 100 + (Math.random() * 4 - 2)) + '%'; sm.style.top = (e.y * 100 - 5) + '%';
        sm.style.setProperty('--dx', (Math.random() * 8 - 4) + 'cqw');
        game.appendChild(sm); setTimeout(() => sm.remove(), 1700);
      }, i * 160);
    }, ZAP);
    setTimeout(() => { e.el.classList.remove('burnt'); }, ZAP + BURN);
  }, delay);
}

/* ---------- OX 이동 ---------- */
let myT = null;
function oxCanMove() {
  const me = meP();
  return !!(S && S.mode === 'ox' && me && myT && (me.o || S.ph !== 'reveal'));
}
function oxSetTarget(x, y) {
  if (!oxCanMove()) return;
  const F = FIELD.ox;
  myT = { x: clamp(x, F.x0, F.x1), y: clamp(y, F.y0, F.y1) };
  dirtyMove = true;
}
function moveToSide(side) {
  if (!oxCanMove()) return;
  Sound.sfx('step');
  const F = FIELD.ox;
  const x = side === 'O' ? 0.14 + Math.random() * 0.26 : 0.60 + Math.random() * 0.26;
  oxSetTarget(x, F.y0 + 0.03 + Math.random() * (F.y1 - F.y0 - 0.05));
}
$('#pickO').addEventListener('click', () => moveToSide('O'));
$('#pickX').addEventListener('click', () => moveToSide('X'));
function stagePoint(ev) {
  const r = $('#stage').getBoundingClientRect();
  return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
}
let dragging = false;
const arena = $('#arena');
arena.addEventListener('pointerdown', ev => {
  if (!myId) { if (S && S.players.length < S.max) openSelect(); return; }
  if (!oxCanMove()) return;
  dragging = true; arena.setPointerCapture(ev.pointerId);
  const p = stagePoint(ev); oxSetTarget(p.x, p.y + 0.02);
});
arena.addEventListener('pointermove', ev => { if (dragging) { const p = stagePoint(ev); oxSetTarget(p.x, p.y + 0.02); } });
['pointerup', 'pointercancel'].forEach(t => arena.addEventListener(t, () => { dragging = false; }));

/* =========================================================
   🎨 그림 맞추기
   ========================================================= */
let myWord = null;
let dPos = null, dTarget = null, riding = false, dLastSent = 0, dDirty = false;
const amDrawer = () => !!(S && S.mode === 'draw' && S.ph === 'draw' && myId && S.drawer === myId);

function drawPhase(old, m, me) {
  const ph = m.ph;
  if (ph === 'ready') { Sound.sfx('start'); closeOv('#resultOv'); banner('그림 맞추기 시작!', false); }
  if (ph === 'draw') {
    lastTickSec = -1; Sound.sfx('ding');
    const drawer = m.players.find(p => p.id === m.drawer);
    if (m.drawer === myId) {
      dPos = { x: drawer.x, y: drawer.y }; dTarget = null; riding = true;
      banner('✏️ 내가 출제자!', false);
      toast('제시어를 그려 주세요! 🫧 비눗방울에서 착지하면 그리기 시작', 2600);
    } else {
      dPos = null; myWord = null;
      banner(`${drawer ? drawer.n : '?'} 님이 그려요!`, false);
    }
  }
  if (ph === 'reveal' && old && old.ph === 'draw') {
    dTarget = null;
    if (m.solver) { Sound.sfx('correct'); banner(`정답: ${m.word}! 🎉`, false); }
    else { Sound.sfx('wrong'); banner(`정답은 「${m.word}」`, true); }
    const sol = m.solver && ents.get(m.solver.id);
    if (sol) { sol.el.classList.add('cheer'); setTimeout(() => sol.el.classList.remove('cheer'), 1400); }
  }
  if (ph === 'end') showResult(m);
  if (ph === 'lobby') { closeOv('#resultOv'); resetTrail(); }
}
function drawHud(me, amHost) {
  const w = $('#dword');
  let html = '', secret = false;
  const drawer = S.players.find(p => p.id === S.drawer);
  if (S.ph === 'lobby') html = `<span style="font-size:4.4cqw">참가자를 기다리는 중 (${S.players.length}/${S.max})</span>`;
  else if (S.ph === 'ready') html = '<span style="font-size:4.6cqw">곧 출제자를 뽑아요!</span>';
  else if (S.ph === 'draw') {
    if (amDrawer() && myWord) { html = esc(myWord); secret = true; }
    else html = `${S.hint || ''}<small>${(S.hint || '').replace(/\s/g, '').length}글자 · ✏️ ${esc(drawer ? drawer.n : '')}</small>`;
  } else if (S.ph === 'reveal') html = `${esc(S.word || '')}<small>${S.solver ? '🎉 ' + esc(S.solver.n) + ' 정답!' : esc(S.msg || '')}</small>`;
  else if (S.ph === 'end') html = '<span style="font-size:5cqw">게임 종료!</span>';
  if (w.dataset.h !== html) { w.innerHTML = html; w.dataset.h = html; }
  w.classList.toggle('secret', secret);

  // 점수판
  const sc = $('#scores');
  const sHtml = S.players.map(p => `<span class="${p.id === S.drawer && S.ph === 'draw' ? 'drawing' : ''} ${p.id === myId ? 'mine' : ''}"><img src="${charSrc(p.c)}" alt="">${esc(p.n)} ${'⭐'.repeat(p.s) || '·'}</span>`).join('');
  if (sc.dataset.h !== sHtml) { sc.innerHTML = sHtml; sc.dataset.h = sHtml; }

  const drawing = amDrawer();
  $('#rideBtn').disabled = !drawing;
  $('#rideBtn').classList.toggle('riding', drawing && riding);
  $('#clearBtn').style.display = drawing ? 'block' : 'none';
  $('#skipBtn').style.display = amHost && S.ph === 'draw' ? 'block' : 'none';   // 👑 방장만 보여요
  $('#darena').classList.toggle('can', drawing);
  $('#chatIn').placeholder = drawing ? '출제자는 채팅만 가능해요' : (me ? '정답을 입력하세요!' : '참가하면 정답을 입력할 수 있어요');
  $('#chatIn').disabled = !me;
}

/* ---------- 채팅 / 정답 ---------- */
function onChat(m) {
  if (view !== 'room' || roomMode !== 'draw') return;
  const log = $('#chatlog');
  const d = document.createElement('div');
  if (m.sys) { d.className = 'sys'; d.textContent = '🫧 ' + m.text; }
  else { d.className = m.ok ? 'ok' : ''; d.innerHTML = `<b>${esc(m.n)}</b> : ${esc(m.text)}`; }
  log.appendChild(d);
  while (log.children.length > 5) log.firstChild.remove();
  if (!m.sys && !m.ok) Sound.sfx('chat');
}
$('#chatBar').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#chatIn').value.trim();
  if (!v) return;
  send({ t: 'chat', text: v });
  $('#chatIn').value = '';
});

/* ---------- 흙바닥 그림 (캔버스) ---------- */
const trail = $('#trail'), tctx = trail.getContext('2d');
let points = [], sv = -1;
function sizeTrail() {
  const r = trail.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (trail.width !== w || trail.height !== h) { trail.width = w; trail.height = h; redrawTrail(); }
}
function seg(a, b) {
  const W = trail.width, H = trail.height, lw = W * 0.026;
  tctx.lineCap = 'round'; tctx.lineJoin = 'round';
  tctx.strokeStyle = '#c99a63'; tctx.lineWidth = lw * 1.45;
  tctx.beginPath(); tctx.moveTo(a[0] * W, a[1] * H); tctx.lineTo(b[0] * W, b[1] * H); tctx.stroke();
  tctx.strokeStyle = '#9c6c37'; tctx.lineWidth = lw;
  tctx.beginPath(); tctx.moveTo(a[0] * W, a[1] * H); tctx.lineTo(b[0] * W, b[1] * H); tctx.stroke();
}
function dot(a) { seg(a, [a[0] + 0.0005, a[1]]); }
function drawFrom(i) {
  for (; i < points.length; i++) {
    const p = points[i], q = points[i - 1];
    if (p[2]) continue;
    if (q && !q[2]) seg(q, p); else dot(p);
  }
}
function redrawTrail() { tctx.clearRect(0, 0, trail.width, trail.height); drawFrom(0); }
function resetTrail() { points = []; sv = -1; tctx.clearRect(0, 0, trail.width, trail.height); }
function onPoints(m) {
  if (roomMode !== 'draw') return;
  if (m.sv !== sv) {
    if (m.from !== 0) { send({ t: 'getpts' }); return; }
    sv = m.sv; points = []; tctx.clearRect(0, 0, trail.width, trail.height);
  }
  if (m.from !== points.length) { if (m.from < points.length) { points.length = m.from; redrawTrail(); } else { send({ t: 'getpts' }); return; } }
  const start = points.length;
  points.push(...m.pts);
  drawFrom(Math.max(0, start));
}
window.addEventListener('resize', sizeTrail);
new ResizeObserver(sizeTrail).observe(trail);

/* ---------- 출제자 이동 / 비눗방울 ---------- */
function toggleRide() {
  if (!amDrawer()) return;
  riding = !riding; dDirty = true;
  Sound.sfx(riding ? 'bubble' : 'land');
  if (!riding && dPos) dot([dPos.x, dPos.y]);
}
$('#rideBtn').addEventListener('click', toggleRide);
let skipArm = 0;
$('#skipBtn').addEventListener('click', () => {
  const now = Date.now();
  if (now - skipArm > 2500) { skipArm = now; Sound.sfx('pop'); toast('한 번 더 누르면 이번 차례를 넘겨요 ⏭', 2400); return; }
  skipArm = 0; send({ t: 'skip' });
});
$('#clearBtn').addEventListener('click', () => { if (amDrawer()) { Sound.sfx('pop'); send({ t: 'clear' }); } });
const darena = $('#darena');
let dDragging = false;
function dSetTarget(ev) {
  const p = stagePoint(ev), F = FIELD.draw;
  dTarget = { x: clamp(p.x, F.x0, F.x1), y: clamp(p.y + 0.02, F.y0, F.y1) };
}
darena.addEventListener('pointerdown', ev => {
  if (!myId) { if (S && S.players.length < S.max) openSelect(); return; }
  if (!amDrawer()) return;
  dDragging = true; darena.setPointerCapture(ev.pointerId); dSetTarget(ev);
});
darena.addEventListener('pointermove', ev => { if (dDragging) dSetTarget(ev); });
['pointerup', 'pointercancel'].forEach(t => darena.addEventListener(t, () => { dDragging = false; }));

/* =========================================================
   🐠 캐릭터 그리기 & 움직임 (공통)
   ========================================================= */
const ents = new Map();
function syncEntities(list) {
  const seen = new Set();
  const field = Q('.field');
  for (const p of list) {
    seen.add(p.id);
    let e = ents.get(p.id);
    if (!e) {
      const el = document.createElement('div'); el.className = 'chr';
      el.innerHTML = '<div class="wrap"><div class="shadow"></div><div class="bubbleRing"></div><div class="sprite"><img alt="" draggable="false"></div><span class="arrow">▼</span><span class="crown"></span><span class="tag"></span></div>';
      field.appendChild(el);
      e = { el, img: el.querySelector('img'), tag: el.querySelector('.tag'), crown: el.querySelector('.crown'), x: p.x, y: p.y, tx: p.x, ty: p.y, c: -1 };
      ents.set(p.id, e);
      el.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 400 });
    }
    if (e.c !== p.c) { e.c = p.c; e.img.src = charSrc(p.c); }
    if (e.tag.textContent !== p.n) e.tag.textContent = p.n;
    e.tx = p.x; e.ty = p.y; e.p = p;
    e.isMe = p.id === myId;
    e.el.classList.toggle('me', e.isMe);
    e.el.classList.toggle('hosting', S.host === p.id);
    e.crown.textContent = S.host === p.id ? '👑' : '';
  }
  for (const [id, e] of ents) if (!seen.has(id)) { e.el.remove(); ents.delete(id); }
}

const keys = new Set();
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].includes(k)) { keys.add(k); e.preventDefault(); }
  if (view === 'room' && roomMode === 'ox') {
    if (k === 'o' || k === '1') moveToSide('O');
    if (k === 'x' || k === '2') moveToSide('X');
  }
  if (view === 'room' && roomMode === 'draw' && k === ' ') { e.preventDefault(); toggleRide(); }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
function keyDir() {
  let dx = 0, dy = 0;
  if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
  if (keys.has('arrowright') || keys.has('d')) dx += 1;
  if (keys.has('arrowup') || keys.has('w')) dy -= 1;
  if (keys.has('arrowdown') || keys.has('s')) dy += 1;
  return [dx, dy];
}

let dirtyMove = false, lastSent = 0, lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  if (S && view === 'room') (S.mode === 'ox' ? oxFrame : drawFrame)(now, dt);
  requestAnimationFrame(frame);
}
function stepEntity(e, tgt, speed, dt) {
  const dx = tgt.x - e.x, dy = (tgt.y - e.y) * 0.6, d = Math.hypot(dx, dy);
  const stepLen = speed * dt * (d > 0.25 ? 2 : 1);
  if (d > 0.0015) {
    const k = Math.min(1, stepLen / d);
    e.x += (tgt.x - e.x) * k; e.y += (tgt.y - e.y) * k;
    if (Math.abs(dx) > 0.002) e.el.classList.toggle('flip', dx < 0);
    e.el.classList.add('walk');
  } else { e.x = tgt.x; e.y = tgt.y; e.el.classList.remove('walk'); }
}
function place(e) {
  e.el.style.left = (e.x * 100) + '%';
  e.el.style.top = (e.y * 100) + '%';
}

function oxFrame(now, dt) {
  if (keys.size && oxCanMove()) {
    const [dx, dy] = keyDir();
    if (dx || dy) { const me = ents.get(myId); const bx = me ? me.x : myT.x, by = me ? me.y : myT.y; oxSetTarget(bx + dx * SPEED.ox * dt * 2.2, by + dy * SPEED.ox * dt * 1.6); }
  }
  if (dirtyMove && now - lastSent > 60) { dirtyMove = false; lastSent = now; send({ t: 'move', x: +myT.x.toFixed(4), y: +myT.y.toFixed(4) }); }
  const me = meP();
  const iAmGhost = !!(me && me.o && S.ph !== 'lobby');
  const phQ = S.ph === 'question';
  for (const [, e] of ents) {
    const p = e.p, fx = e.fxUntil > now;
    const tgt = e.isMe && myT && oxCanMove() ? myT : { x: e.tx, y: e.ty };
    stepEntity(e, tgt, SPEED.ox, dt);
    place(e);
    const out = !!p.o && !fx;
    e.el.classList.toggle('out', out);
    // 👻 유령은 유령끼리만 보여요 (살아 있는 사람·관전자 화면에는 숨김)
    e.el.classList.toggle('hidden', out && !iAmGhost);
    e.el.style.zIndex = out ? 1 : 10 + Math.round(e.y * 1000);
    e.el.classList.toggle('undecided', phQ && !p.o && sideOf(e.x) === null);
  }
}

function drawFrame(now, dt) {
  const drawing = amDrawer();
  if (drawing && dPos) {
    const sp = riding ? SPEED.ride : SPEED.draw, F = FIELD.draw;
    const [kx, ky] = keyDir();
    let nx = dPos.x, ny = dPos.y;
    if (kx || ky) {
      dTarget = null;
      const L = Math.hypot(kx, ky);
      nx += kx / L * sp * dt; ny += ky / L * sp * dt * 1.2;
    } else if (dTarget) {
      const dx = dTarget.x - dPos.x, dy = dTarget.y - dPos.y, d = Math.hypot(dx, dy);
      if (d < 0.002) dTarget = null;
      else { const k = Math.min(1, sp * dt / d); nx += dx * k; ny += dy * k; }
    }
    nx = clamp(nx, F.x0, F.x1); ny = clamp(ny, F.y0, F.y1);
    if (nx !== dPos.x || ny !== dPos.y) {
      if (!riding) seg([dPos.x, dPos.y], [nx, ny]);       // 내 화면에는 바로 그려요
      dPos = { x: nx, y: ny }; dDirty = true;
    }
    if (dDirty && now - dLastSent > 50) { dDirty = false; dLastSent = now; send({ t: 'pos', x: +dPos.x.toFixed(4), y: +dPos.y.toFixed(4), b: riding ? 1 : 0 }); }
  }
  const playing = ['draw', 'reveal'].includes(S.ph) && S.drawer;
  const lobbyList = S.players;
  for (const [id, e] of ents) {
    const p = e.p;
    let visible, tgt, isRiding = false;
    if (playing) {
      visible = id === S.drawer;                  // 🎨 출제자만 경기장에 보여요
      if (visible && drawing && e.isMe && dPos) { tgt = dPos; isRiding = riding; e.x = dPos.x; e.y = dPos.y; }
      else { tgt = { x: e.tx, y: e.ty }; isRiding = !!p.b; }
    } else {
      // 대기실에서는 모두 줄지어 서서 기다려요
      const i = lobbyList.indexOf(p);
      visible = true;
      tgt = { x: 0.16 + (i % 5) * 0.17, y: 0.6 + Math.floor(i / 5) * 0.11 };
    }
    const moving = Math.hypot(tgt.x - e.x, tgt.y - e.y) > 0.0015;
    if (!(drawing && e.isMe)) stepEntity(e, tgt, playing ? 0.5 : 0.4, dt);
    else { e.el.classList.toggle('walk', moving || (keys.size > 0) || !!dTarget); if (dTarget) e.el.classList.toggle('flip', dTarget.x < e.x); }
    place(e);
    e.el.classList.toggle('hidden', !visible);
    e.el.classList.toggle('riding', visible && isRiding);
    e.el.classList.toggle('drawer', playing && id === S.drawer);
    e.el.style.zIndex = 10 + Math.round(e.y * 1000);
  }
}
requestAnimationFrame(frame);

/* ---------- 주소에 ?room=번호 가 있으면 바로 그 방으로 ---------- */
if (pendingCode) toast('초대받은 방으로 들어가는 중… 🫧', 1500);
