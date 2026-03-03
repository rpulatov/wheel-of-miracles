'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');

const PORT = parseInt(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SESSION_TTL = parseInt(process.env.SESSION_TTL_MS) || 7_200_000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Sessions ─────────────────────────────────────────────────────────────────
/** @type {Map<string, { state: object, lastActivity: number, cleanupTimer: any }>} */
const sessions = new Map();

function touchSession(roomCode) {
  const s = sessions.get(roomCode);
  if (!s) return;
  s.lastActivity = Date.now();
  clearTimeout(s.cleanupTimer);
  s.cleanupTimer = setTimeout(() => {
    sessions.delete(roomCode);
    tapTimers.delete(roomCode);
    io.to(roomCode).emit('session:expired');
  }, SESSION_TTL);
}

// ─── Sectors ──────────────────────────────────────────────────────────────────
const SECTORS = [
  { label: '50',   type: 'points',  value: 50  },
  { label: '100',  type: 'points',  value: 100 },
  { label: '200',  type: 'points',  value: 200 },
  { label: 'Б',    type: 'bankrupt',value: 0   },
  { label: '100',  type: 'points',  value: 100 },
  { label: 'П',    type: 'prize',   value: 50  },
  { label: '50',   type: 'points',  value: 50  },
  { label: 'x2',   type: 'x2',     value: 0   },
  { label: '200',  type: 'points',  value: 200 },
  { label: 'Б',    type: 'bankrupt',value: 0   },
  { label: '300',  type: 'points',  value: 300 },
  { label: 'Ш',    type: 'chance',  value: 50  },
  { label: '100',  type: 'points',  value: 100 },
  { label: '0',    type: 'zero',    value: 0   },
  { label: '+',    type: 'plus',    value: 100 },
  { label: 'Ключ', type: 'key',     value: 0   },
];

const SECTOR_WEIGHTS = SECTORS.map(s => {
  if (s.type === 'bankrupt' || s.type === 'key') return 1;
  if (s.type === 'zero' || s.type === 'x2') return 2;
  return 5;
});

function weightedRandom() {
  const total = SECTOR_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < SECTORS.length; i++) {
    r -= SECTOR_WEIGHTS[i];
    if (r < 0) return i;
  }
  return SECTORS.length - 1;
}

const BANKRUPT_TASKS = [
  'Спойте куплет любой песни! 🎵',
  'Расскажите смешной анекдот! 😄',
  'Изобразите животное без слов — пусть угадают! 🦁',
  'Сделайте 10 приседаний! 💪',
  'Назовите 5 стран за 10 секунд! 🌍',
  'Станцуйте 15 секунд! 💃',
  'Изобразите известного человека! ⭐',
  'Скажите три комплимента любому игроку! 💝',
  'Покажите пантомиму — изобразите профессию! 🎭',
  'Прочитайте скороговорку вслух! 👅',
];

// ─── Room code ────────────────────────────────────────────────────────────────
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRoomCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (sessions.has(code));
  return code;
}

// ─── Game state factory ───────────────────────────────────────────────────────
function createGameState(roomCode, config) {
  const { totalRounds, players, rounds } = config;
  return {
    roomCode,
    phase: 'lobby',
    totalRounds: Number(totalRounds),
    currentRound: 0,
    rounds: rounds.map(r => {
      const secretText = String(r.secretText).toUpperCase().trim();
      return {
        secretText,
        revealedMask: secretText.split('').map(c => c === ' '),
        usedLetters: [],
        keyHolder: null,
      };
    }),
    players: players.map(name => ({
      name: String(name).trim(),
      totalScore: 0,
      roundScore: 0,
      skipTurns: 0,
      stats: {
        correctLetters: 0,
        wrongLetters: 0,
        bankruptCount: 0,
        prizeCount: 0,
        wordGuessCorrect: 0,
        wordGuessWrong: 0,
        x2Count: 0,
        totalTurns: 0,
        zeroCount: 0,
      },
    })),
    currentPlayerIndex: 0,
    spinResult: null,
    spinResultIndex: null,
    spinInProgress: false,
    pendingWord: null,
    nominations: null,
  };
}

// ─── State serialiser ─────────────────────────────────────────────────────────
function serializeState(state) {
  return {
    roomCode: state.roomCode,
    phase: state.phase,
    totalRounds: state.totalRounds,
    currentRound: state.currentRound,
    currentPlayerIndex: state.currentPlayerIndex,
    spinResult: state.spinResult,
    spinInProgress: state.spinInProgress,
    pendingWord: state.pendingWord,
    nominations: state.nominations,
    players: state.players.map(p => ({
      name: p.name,
      totalScore: p.totalScore,
      roundScore: p.roundScore,
      skipTurns: p.skipTurns,
    })),
    rounds: state.rounds.map(r => ({
      secretText: r.secretText,
      revealedMask: r.revealedMask,
      usedLetters: r.usedLetters,
      keyHolder: r.keyHolder,
    })),
  };
}

// ─── Nominations ──────────────────────────────────────────────────────────────
function computeNominations(players) {
  const templates = [
    { key: 'prizeCount',       title: 'Самый везучий',     fn: p => `${p.name} — настоящий везунчик: ${p.stats.prizeCount} раз попал на Приз! 🍀` },
    { key: 'bankruptCount',    title: 'Самый отчаянный',   fn: p => `${p.name} пережил банкротство ${p.stats.bankruptCount} раз — и всё равно улыбается! 💸` },
    { key: 'wordGuessCorrect', title: 'Самый догадливый',  fn: p => `${p.name} угадал слово ${p.stats.wordGuessCorrect} раз — настоящий телепат! 🔮` },
    { key: 'totalTurns',       title: 'Душа компании',     fn: p => `${p.name} сделал ${p.stats.totalTurns} спинов — неутомимый игрок! 🌀` },
    { key: 'x2Count',          title: 'Король удвоения',   fn: p => `${p.name} попал на x2 целых ${p.stats.x2Count} раз! ⚡` },
    { key: 'zeroCount',        title: 'Мастер нуля',       fn: p => `${p.name} умудрился попасть на Ноль ${p.stats.zeroCount} раз — есть талант! 😅` },
    { key: 'wordGuessWrong',   title: 'Самый настойчивый', fn: p => `${p.name} рискнул назвать слово ${p.stats.wordGuessWrong} раз — смелость украшает! 🎯` },
    { key: 'correctLetters',   title: 'Буквоед',           fn: p => `${p.name} открыл ${p.stats.correctLetters} букв — настоящий эрудит! 📚` },
  ];

  const assigned = new Set();
  const nominations = players.map(() => null);

  for (const tpl of templates) {
    let best = -1, bestVal = 0;
    players.forEach((p, i) => {
      if (!assigned.has(i) && p.stats[tpl.key] > bestVal) {
        bestVal = p.stats[tpl.key];
        best = i;
      }
    });
    if (best >= 0) {
      nominations[best] = { title: tpl.title, text: tpl.fn(players[best]) };
      assigned.add(best);
    }
  }

  players.forEach((p, i) => {
    if (!nominations[i]) {
      nominations[i] = { title: 'Самый загадочный', text: `${p.name} — самый загадочный игрок вечера! 🎭` };
    }
  });

  return nominations;
}

// ─── Spin tap accumulator ─────────────────────────────────────────────────────
const tapTimers = new Map(); // roomCode → { count, silenceTimer }

function triggerSpin(roomCode) {
  const session = sessions.get(roomCode);
  if (!session) return;
  const { state } = session;
  if (state.phase !== 'spinning' || state.spinInProgress) return;

  const tapInfo = tapTimers.get(roomCode) || { count: 1 };
  tapTimers.delete(roomCode);

  const velocity = Math.max(3, Math.min(15, 3 + Math.floor(tapInfo.count / 2)));
  const targetSectorIndex = weightedRandom();

  state.spinInProgress = true;
  state.spinResult = SECTORS[targetSectorIndex];
  state.spinResultIndex = targetSectorIndex;
  state.players[state.currentPlayerIndex].stats.totalTurns++;

  touchSession(roomCode);

  io.to(`${roomCode}:tv`).emit('wheel:spin:start', { targetSectorIndex, velocity });
  io.to(`${roomCode}:player`).emit('player:disable');
}

// ─── Game helpers ─────────────────────────────────────────────────────────────
function getCurrentRound(state) { return state.rounds[state.currentRound]; }
function getCurrentPlayer(state) { return state.players[state.currentPlayerIndex]; }

function isRoundComplete(round) { return round.revealedMask.every(Boolean); }

function nextPlayerIndex(state) {
  const n = state.players.length;
  let idx = (state.currentPlayerIndex + 1) % n;
  let tries = 0;
  while (state.players[idx].skipTurns > 0 && tries < n) {
    state.players[idx].skipTurns = Math.max(0, state.players[idx].skipTurns - 1);
    idx = (idx + 1) % n;
    tries++;
  }
  return idx;
}

function applyLetterGuess(state, letter) {
  const round = getCurrentRound(state);
  const player = getCurrentPlayer(state);

  round.usedLetters.push(letter);

  const positions = [];
  for (let i = 0; i < round.secretText.length; i++) {
    if (round.secretText[i] === letter && !round.revealedMask[i]) {
      round.revealedMask[i] = true;
      positions.push(i);
    }
  }

  const isX2 = state.spinResult && state.spinResult.type === 'x2';
  let pointsPerLetter = (state.spinResult && state.spinResult.value) || 0;
  if (isX2) pointsPerLetter *= 2;

  if (positions.length > 0) {
    const earned = pointsPerLetter * positions.length;
    player.roundScore += earned;
    player.stats.correctLetters += positions.length;
    return { found: true, positions, earned };
  } else {
    player.stats.wrongLetters++;
    return { found: false, positions: [], earned: 0 };
  }
}

function broadcastState(roomCode, state) {
  const s = serializeState(state);
  io.to(roomCode).emit('state:full', s);
}

function advancePhaseToNextTurn(roomCode, state) {
  state.spinResult = null;
  state.spinResultIndex = null;
  state.spinInProgress = false;
  state.pendingWord = null;
  state.currentPlayerIndex = nextPlayerIndex(state);
  state.phase = 'spinning';

  const cp = getCurrentPlayer(state);
  io.to(roomCode).emit('turn:change', { playerIndex: state.currentPlayerIndex, playerName: cp.name });
  io.to(`${roomCode}:player`).emit('player:enable');
  io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'waiting_spin' });
  broadcastState(roomCode, state);
}

function getAdminPrompt(state) {
  switch (state.phase) {
    case 'lobby':       return 'start_game';
    case 'spinning':    return state.spinInProgress ? 'spin_in_progress' : 'waiting_spin';
    case 'letter_input':return 'enter_letter';
    case 'word_guess':  return 'word_guess';
    case 'round_end':   return 'round_end';
    case 'game_end':    return 'game_end';
    default:            return 'waiting_spin';
  }
}

function finishRound(roomCode, state) {
  state.phase = 'round_end';
  state.spinInProgress = false;
  state.pendingWord = null;

  const round = getCurrentRound(state);
  state.players.forEach(p => {
    p.totalScore += p.roundScore;
  });

  io.to(roomCode).emit('word:reveal:full', { secretText: round.secretText });
  io.to(`${roomCode}:player`).emit('player:disable');
  io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'round_end' });

  if (state.currentRound + 1 >= state.totalRounds) {
    // Pre-compute nominations so admin panel can show "Finish Game" button
    state.nominations = computeNominations(state.players);
  }

  broadcastState(roomCode, state);
}

function finishGame(roomCode, state) {
  state.phase = 'game_end';
  if (!state.nominations) {
    state.nominations = computeNominations(state.players);
  }

  const payload = {
    players: state.players.map((p, i) => ({
      name: p.name,
      totalScore: p.totalScore,
      nomination: state.nominations[i],
    })),
  };

  io.to(roomCode).emit('game:end', payload);
  io.to(`${roomCode}:player`).emit('player:disable');
  io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'game_end' });
  broadcastState(roomCode, state);
}

// ─── HTTP routes ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', sessions: sessions.size }));

app.post('/api/create-room', async (req, res) => {
  try {
    const { totalRounds, players, rounds } = req.body;
    if (!totalRounds || !Array.isArray(players) || !Array.isArray(rounds)) {
      return res.status(400).json({ error: 'Неверный формат данных' });
    }
    if (players.length < 2 || players.length > 15) {
      return res.status(400).json({ error: 'Нужно от 2 до 15 игроков' });
    }
    if (rounds.length < 2 || rounds.length > 3) {
      return res.status(400).json({ error: 'Нужно 2–3 раунда' });
    }
    for (const r of rounds) {
      if (!r.secretText || !r.secretText.trim()) {
        return res.status(400).json({ error: 'Укажите слово/фразу для каждого раунда' });
      }
    }

    const roomCode = generateRoomCode();
    const state = createGameState(roomCode, { totalRounds, players, rounds });

    const cleanupTimer = setTimeout(() => {
      sessions.delete(roomCode);
      tapTimers.delete(roomCode);
      io.to(roomCode).emit('session:expired');
    }, SESSION_TTL);

    sessions.set(roomCode, { state, lastActivity: Date.now(), cleanupTimer });

    const tvUrl     = `${PUBLIC_URL}/game/${roomCode}/tv`;
    const adminUrl  = `${PUBLIC_URL}/game/${roomCode}/admin`;
    const playerUrl = `${PUBLIC_URL}/game/${roomCode}/play`;

    const [adminQr, playerQr] = await Promise.all([
      QRCode.toDataURL(adminUrl, { width: 256, margin: 1 }),
      QRCode.toDataURL(playerUrl, { width: 256, margin: 1 }),
    ]);

    res.json({ roomCode, tvUrl, adminUrl, playerUrl, adminQr, playerQr });
  } catch (err) {
    console.error('create-room error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// SPA routes
app.get('/game/:room/tv',    (_req, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));
app.get('/game/:room/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/game/:room/play',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  let currentRoom = null;
  let currentRole = null;

  // ── Join room ───────────────────────────────────────────────────────────────
  socket.on('join:room', ({ roomCode, role }) => {
    const session = sessions.get(roomCode);
    if (!session) {
      socket.emit('error:room', { message: 'Комната не найдена или сессия истекла' });
      return;
    }

    currentRoom = roomCode;
    currentRole = role;

    socket.join(roomCode);
    socket.join(`${roomCode}:${role}`);

    touchSession(roomCode);

    const { state } = session;
    socket.emit('state:full', serializeState(state));

    if (role === 'admin') {
      socket.emit('admin:prompt', { type: getAdminPrompt(state), word: state.pendingWord });
    }

    if (role === 'player') {
      const ready = state.phase === 'spinning' && !state.spinInProgress;
      socket.emit(ready ? 'player:enable' : 'player:disable');
      if (ready) {
        socket.emit('player:can_guess', { canGuess: true });
      }
    }
  });

  // ── Admin: start game ───────────────────────────────────────────────────────
  socket.on('admin:start', ({ roomCode }) => {
    if (currentRole !== 'admin' || currentRoom !== roomCode) return;
    const session = sessions.get(roomCode);
    if (!session || session.state.phase !== 'lobby') return;

    const { state } = session;
    state.phase = 'spinning';
    touchSession(roomCode);

    const cp = getCurrentPlayer(state);
    io.to(roomCode).emit('turn:change', { playerIndex: 0, playerName: cp.name });
    io.to(`${roomCode}:player`).emit('player:enable');
    io.to(`${roomCode}:player`).emit('player:can_guess', { canGuess: true });
    io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'waiting_spin' });
    broadcastState(roomCode, state);
  });

  // ── Player: spin tap ────────────────────────────────────────────────────────
  socket.on('spin:tap', ({ roomCode }) => {
    if (currentRole !== 'player' || currentRoom !== roomCode) return;
    const session = sessions.get(roomCode);
    if (!session) return;
    const { state } = session;
    if (state.phase !== 'spinning' || state.spinInProgress) return;

    touchSession(roomCode);

    let tapInfo = tapTimers.get(roomCode) || { count: 0, silenceTimer: null };
    tapInfo.count++;
    clearTimeout(tapInfo.silenceTimer);
    tapInfo.silenceTimer = setTimeout(() => triggerSpin(roomCode), 2000);
    tapTimers.set(roomCode, tapInfo);

    socket.emit('spin:tap:ack', { count: tapInfo.count });
  });

  // ── TV: wheel animation done ────────────────────────────────────────────────
  socket.on('wheel:anim:done', ({ roomCode }) => {
    if (currentRole !== 'tv' || currentRoom !== roomCode) return;
    const session = sessions.get(roomCode);
    if (!session || !session.state.spinInProgress) return;

    const { state } = session;
    touchSession(roomCode);

    const sector = state.spinResult;
    const player = getCurrentPlayer(state);

    io.to(`${roomCode}:tv`).emit('wheel:spin:end');

    switch (sector.type) {

      case 'bankrupt': {
        player.roundScore = 0;
        player.stats.bankruptCount++;
        state.phase = 'letter_input';
        const task = BANKRUPT_TASKS[Math.floor(Math.random() * BANKRUPT_TASKS.length)];
        io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'bankrupt', task });
        io.to(`${roomCode}:player`).emit('player:sector', { sectorLabel: sector.label, canGuessWord: false });
        io.to(`${roomCode}:tv`).emit('toast', { message: `${player.name} — Банкрот! Очки сгорают 💸`, type: 'bankrupt' });
        broadcastState(roomCode, state);
        break;
      }

      case 'zero': {
        player.stats.zeroCount++;
        state.spinInProgress = false;
        state.spinResult = null;
        io.to(`${roomCode}:player`).emit('player:sector', { sectorLabel: sector.label, canGuessWord: false });
        io.to(`${roomCode}:tv`).emit('toast', { message: `${player.name} — Ноль. Ход передаётся`, type: 'info' });
        advancePhaseToNextTurn(roomCode, state);
        break;
      }

      case 'prize': {
        player.roundScore += sector.value;
        player.stats.prizeCount++;
        state.phase = 'letter_input';
        io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'enter_letter' });
        io.to(`${roomCode}:player`).emit('player:sector', { sectorLabel: sector.label, canGuessWord: false });
        io.to(`${roomCode}:tv`).emit('toast', { message: `${player.name} — Приз! 🎁 +${sector.value} очков`, type: 'prize' });
        broadcastState(roomCode, state);
        break;
      }

      case 'key': {
        getCurrentRound(state).keyHolder = state.currentPlayerIndex;
        state.phase = 'letter_input';
        io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'enter_letter' });
        io.to(`${roomCode}:player`).emit('player:sector', { sectorLabel: sector.label, canGuessWord: false });
        io.to(`${roomCode}:tv`).emit('toast', { message: `${player.name} получает Ключ! 🔑`, type: 'key' });
        broadcastState(roomCode, state);
        break;
      }

      case 'x2': {
        player.stats.x2Count++;
        state.phase = 'letter_input';
        io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'enter_letter' });
        io.to(`${roomCode}:player`).emit('player:sector', { sectorLabel: sector.label, canGuessWord: false });
        io.to(`${roomCode}:tv`).emit('toast', { message: `${player.name} — x2! Называйте букву для двойных очков ⚡`, type: 'x2' });
        broadcastState(roomCode, state);
        break;
      }

      case 'chance': {
        state.phase = 'letter_input';
        io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'enter_letter' });
        io.to(`${roomCode}:player`).emit('player:sector', { sectorLabel: sector.label, canGuessWord: false });
        io.to(`${roomCode}:tv`).emit('toast', { message: `${player.name} — Шанс! Попросите помощи 🤝`, type: 'chance' });
        broadcastState(roomCode, state);
        break;
      }

      case 'plus': {
        state.phase = 'letter_input';
        io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'enter_letter' });
        io.to(`${roomCode}:player`).emit('player:sector', { sectorLabel: sector.label, canGuessWord: true });
        io.to(`${roomCode}:tv`).emit('toast', { message: `${player.name} — Плюс! Называйте любую букву ✨`, type: 'plus' });
        broadcastState(roomCode, state);
        break;
      }

      default: { // points
        state.phase = 'letter_input';
        io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'enter_letter' });
        io.to(`${roomCode}:player`).emit('player:sector', { sectorLabel: sector.label, canGuessWord: true });
        io.to(`${roomCode}:tv`).emit('toast', { message: `${player.name} — ${sector.label}! Называйте букву`, type: 'points' });
        broadcastState(roomCode, state);
        break;
      }
    }
  });

  // ── Admin: enter letter ─────────────────────────────────────────────────────
  socket.on('admin:letter', ({ roomCode, letter }) => {
    if (currentRole !== 'admin' || currentRoom !== roomCode) return;
    const session = sessions.get(roomCode);
    if (!session || session.state.phase !== 'letter_input') return;

    touchSession(roomCode);
    const { state } = session;
    const round = getCurrentRound(state);
    const player = getCurrentPlayer(state);
    const upper = letter.toUpperCase();

    if (round.usedLetters.includes(upper)) {
      socket.emit('toast', { message: 'Буква уже называлась!', type: 'warning' });
      return;
    }

    const result = applyLetterGuess(state, upper);

    io.to(roomCode).emit('letter:reveal', {
      positions: result.positions,
      letter: upper,
      earned: result.earned,
      found: result.found,
    });

    if (result.found) {
      io.to(`${roomCode}:tv`).emit('toast', {
        message: `Буква «${upper}» есть! +${result.earned} (×${result.positions.length})`,
        type: 'success',
      });

      if (isRoundComplete(round)) {
        finishRound(roomCode, state);
      } else {
        state.phase = 'spinning';
        state.spinInProgress = false;
        io.to(`${roomCode}:player`).emit('player:enable');
        io.to(`${roomCode}:player`).emit('player:can_guess', { canGuess: true });
        io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'player_turn', playerName: player.name });
        broadcastState(roomCode, state);
      }
    } else {
      io.to(`${roomCode}:tv`).emit('toast', {
        message: `Буквы «${upper}» нет. Следующий игрок`,
        type: 'error',
      });
      advancePhaseToNextTurn(roomCode, state);
    }
  });

  // ── Admin: pass turn ────────────────────────────────────────────────────────
  socket.on('admin:pass:turn', ({ roomCode }) => {
    if (currentRole !== 'admin' || currentRoom !== roomCode) return;
    const session = sessions.get(roomCode);
    if (!session || session.state.phase !== 'letter_input') return;

    touchSession(roomCode);
    const { state } = session;
    const player = getCurrentPlayer(state);

    io.to(`${roomCode}:tv`).emit('toast', {
      message: `${player.name} — ход передаётся`,
      type: 'info',
    });

    advancePhaseToNextTurn(roomCode, state);
  });

  // ── Admin: bankrupt done ────────────────────────────────────────────────────
  socket.on('admin:bankrupt:done', ({ roomCode }) => {
    if (currentRole !== 'admin' || currentRoom !== roomCode) return;
    const session = sessions.get(roomCode);
    if (!session) return;
    touchSession(roomCode);
    advancePhaseToNextTurn(roomCode, session.state);
  });

  // ── Player: guess word ──────────────────────────────────────────────────────
  socket.on('guess:word', ({ roomCode, word }) => {
    if (currentRole !== 'player' || currentRoom !== roomCode) return;
    const session = sessions.get(roomCode);
    if (!session) return;
    const { state } = session;
    if (state.phase !== 'spinning' || state.spinInProgress) return;

    touchSession(roomCode);
    state.phase = 'word_guess';
    state.pendingWord = word.toUpperCase().trim();

    io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'word_guess', word: state.pendingWord });
    io.to(`${roomCode}:player`).emit('player:disable');
    io.to(`${roomCode}:tv`).emit('toast', {
      message: `${getCurrentPlayer(state).name} пытается угадать слово...`,
      type: 'info',
    });
    broadcastState(roomCode, state);
  });

  // ── Admin: accept word guess ────────────────────────────────────────────────
  socket.on('admin:guess:accept', ({ roomCode }) => {
    if (currentRole !== 'admin' || currentRoom !== roomCode) return;
    const session = sessions.get(roomCode);
    if (!session || session.state.phase !== 'word_guess') return;

    touchSession(roomCode);
    const { state } = session;
    const player = getCurrentPlayer(state);
    player.stats.wordGuessCorrect++;

    const round = getCurrentRound(state);
    round.revealedMask = round.revealedMask.map(() => true);

    io.to(`${roomCode}:tv`).emit('toast', {
      message: `${player.name} угадал слово! 🎉`,
      type: 'success',
    });

    finishRound(roomCode, state);
  });

  // ── Admin: reject word guess ────────────────────────────────────────────────
  socket.on('admin:guess:reject', ({ roomCode }) => {
    if (currentRole !== 'admin' || currentRoom !== roomCode) return;
    const session = sessions.get(roomCode);
    if (!session || session.state.phase !== 'word_guess') return;

    touchSession(roomCode);
    const { state } = session;
    const player = getCurrentPlayer(state);
    player.roundScore = 0;
    player.skipTurns = 2;
    player.stats.wordGuessWrong++;

    io.to(`${roomCode}:tv`).emit('toast', {
      message: `${player.name} не угадал 😬 Очки сгорают, пропуск 2 хода`,
      type: 'error',
    });

    advancePhaseToNextTurn(roomCode, state);
  });

  // ── Admin: next round ───────────────────────────────────────────────────────
  socket.on('admin:next:round', ({ roomCode }) => {
    if (currentRole !== 'admin' || currentRoom !== roomCode) return;
    const session = sessions.get(roomCode);
    if (!session || session.state.phase !== 'round_end') return;

    touchSession(roomCode);
    const { state } = session;

    if (state.currentRound + 1 >= state.totalRounds) {
      finishGame(roomCode, state);
    } else {
      state.currentRound++;
      state.phase = 'spinning';
      state.spinResult = null;
      state.spinResultIndex = null;
      state.spinInProgress = false;
      state.pendingWord = null;
      state.players.forEach(p => { p.roundScore = 0; p.skipTurns = 0; });
      state.currentPlayerIndex = 0;

      const cp = getCurrentPlayer(state);
      io.to(roomCode).emit('turn:change', { playerIndex: 0, playerName: cp.name });
      io.to(`${roomCode}:player`).emit('player:enable');
      io.to(`${roomCode}:player`).emit('player:can_guess', { canGuess: true });
      io.to(`${roomCode}:admin`).emit('admin:prompt', { type: 'waiting_spin' });
      io.to(`${roomCode}:tv`).emit('toast', { message: `Раунд ${state.currentRound + 1} начинается!`, type: 'info' });
      broadcastState(roomCode, state);
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`🎡 Поле чудес запущено: ${PUBLIC_URL} (порт ${PORT})`);
});
