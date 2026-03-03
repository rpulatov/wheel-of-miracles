'use strict';

const roomCode = window.location.pathname.split('/')[2];
const socket = io();

// ─── Screen manager ────────────────────────────────────────────────────────────
const SCREENS = ['lobby', 'waiting', 'player-turn', 'letter', 'guess', 'bankrupt', 'round-end', 'game-end'];

function showScreen(name) {
  SCREENS.forEach(id => {
    const el = document.getElementById(`screen-${id}`);
    if (el) el.classList.toggle('hidden', id !== name);
  });
}

// ─── State ────────────────────────────────────────────────────────────────────
let currentState = null;

function applyState(state) {
  currentState = state;

  // Update player name in waiting screen
  if (state.players && state.players[state.currentPlayerIndex]) {
    const cp = state.players[state.currentPlayerIndex];
    const el = document.getElementById('waiting-player-name');
    if (el) el.textContent = cp.name;
    const tpn = document.getElementById('turn-player-name');
    if (tpn) tpn.textContent = cp.name;
  }

  // Update round badge
  const rb = document.getElementById('waiting-round-badge');
  if (rb) rb.textContent = `Раунд ${state.currentRound + 1} из ${state.totalRounds}`;

  // Update used letters
  updateUsedLetters(state);

  // Update keyboard disabled keys
  updateKeyboard(state);
}

function updateUsedLetters(state) {
  const round = state.rounds && state.rounds[state.currentRound];
  if (!round) return;
  const used = round.usedLetters || [];
  const display = document.getElementById('used-letters-display');
  if (display) {
    display.innerHTML = used.map(l => `<span class="used-chip">${escHtml(l)}</span>`).join('');
  }
}

function updateKeyboard(state) {
  const round = state.rounds && state.rounds[state.currentRound];
  if (!round) return;
  const used = new Set(round.usedLetters || []);
  document.querySelectorAll('.kb-key').forEach(btn => {
    const letter = btn.dataset.letter;
    if (used.has(letter)) {
      btn.classList.add('used-key');
      btn.disabled = true;
    } else {
      btn.classList.remove('used-key');
      btn.disabled = false;
    }
  });
}

// ─── Admin prompt handler ──────────────────────────────────────────────────────
socket.on('admin:prompt', ({ type, word, task, playerName }) => {
  switch (type) {
    case 'start_game':
      showScreen('lobby');
      break;

    case 'waiting_spin':
    case 'spin_in_progress':
      showScreen('waiting');
      if (currentState) {
        const cp = currentState.players[currentState.currentPlayerIndex];
        if (cp) document.getElementById('waiting-player-name').textContent = cp.name;
      }
      break;

    case 'player_turn':
      showScreen('player-turn');
      if (playerName) {
        const el = document.getElementById('turn-player-name');
        if (el) el.textContent = playerName;
      } else if (currentState) {
        const cp = currentState.players[currentState.currentPlayerIndex];
        if (cp) {
          const el = document.getElementById('turn-player-name');
          if (el) el.textContent = cp.name;
        }
      }
      break;

    case 'enter_letter':
      showScreen('letter');
      updateSectorBadge();
      if (currentState) updateKeyboard(currentState);
      break;

    case 'word_guess':
      showScreen('guess');
      if (word) {
        document.getElementById('guess-word-display').textContent = word;
      } else if (currentState && currentState.pendingWord) {
        document.getElementById('guess-word-display').textContent = currentState.pendingWord;
      }
      break;

    case 'bankrupt':
      showScreen('bankrupt');
      if (task) document.getElementById('bankrupt-task').textContent = task;
      if (currentState) {
        const cp = currentState.players[currentState.currentPlayerIndex];
        if (cp) document.getElementById('bankrupt-player-name').textContent = cp.name;
      }
      break;

    case 'round_end':
      showScreen('round-end');
      renderRoundEnd();
      break;

    case 'game_end':
      showScreen('game-end');
      renderGameEnd();
      break;
  }
});

function updateSectorBadge() {
  if (!currentState || !currentState.spinResult) return;
  const s = currentState.spinResult;
  const badge = document.getElementById('sector-result');
  if (!badge) return;

  const typeClass = {
    points: 'sector-points',
    plus:   'sector-plus',
    x2:     'sector-x2',
    chance: 'sector-chance',
    prize:  'sector-prize',
    key:    'sector-key',
  };

  badge.className = `sector-badge ${typeClass[s.type] || 'sector-points'}`;
  badge.classList.remove('hidden');

  const labels = {
    points: `Сектор: ${s.label} очков`,
    plus:   'Плюс — любая буква (+100 за каждую)',
    x2:     'x2 — двойные очки за букву!',
    chance: 'Шанс — попросите помощи',
    prize:  `Приз! +${s.value} очков уже начислено`,
    key:    'Ключ — игрок получил ключ!',
  };
  badge.textContent = labels[s.type] || `Сектор: ${s.label}`;

  // Update hint
  const hint = document.getElementById('letter-hint');
  if (hint) {
    if (s.type === 'chance') hint.textContent = 'Игрок просит помощи — введите букву от "друга"';
    else if (s.type === 'plus') hint.textContent = 'Назовите любую ещё не открытую букву';
    else hint.textContent = 'Игрок называет букву';
  }
}

function renderRoundEnd() {
  if (!currentState) return;
  const titleEl = document.getElementById('round-end-title');
  const isLast = currentState.currentRound + 1 >= currentState.totalRounds;
  if (titleEl) titleEl.textContent = `Раунд ${currentState.currentRound + 1} завершён!`;

  const nextBtn = document.getElementById('next-round-btn');
  if (nextBtn) nextBtn.textContent = isLast ? 'Финальные итоги 🏆' : `Раунд ${currentState.currentRound + 2} →`;

  const scores = document.getElementById('round-end-scores');
  if (scores && currentState.players) {
    scores.innerHTML = currentState.players.map(p => `
      <div class="score-card">
        <span class="score-card-name">${escHtml(p.name)}</span>
        <span class="score-card-round">+${p.roundScore} этот раунд</span>
        <span class="score-card-total">${p.totalScore}</span>
      </div>
    `).join('');
  }
}

function renderGameEnd() {
  if (!currentState) return;
  const scores = document.getElementById('game-end-scores');
  if (!scores || !currentState.players) return;
  const sorted = [...currentState.players].sort((a, b) => b.totalScore - a.totalScore);
  const medals = ['🥇', '🥈', '🥉'];
  scores.innerHTML = sorted.map((p, i) => `
    <div class="score-card">
      <span class="score-card-name">${medals[i] || `${i+1}.`} ${escHtml(p.name)}</span>
      <span class="score-card-total">${p.totalScore}</span>
    </div>
  `).join('');
}

// ─── Button handlers ───────────────────────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', () => {
  socket.emit('admin:start', { roomCode });
});

// Keyboard
document.querySelectorAll('.kb-key').forEach(btn => {
  btn.addEventListener('click', () => {
    const letter = btn.dataset.letter;
    if (!letter || btn.disabled) return;
    socket.emit('admin:letter', { roomCode, letter });
  });
});

// Word guess
document.getElementById('accept-btn').addEventListener('click', () => {
  socket.emit('admin:guess:accept', { roomCode });
});
document.getElementById('reject-btn').addEventListener('click', () => {
  socket.emit('admin:guess:reject', { roomCode });
});

// Pass turn
document.getElementById('pass-turn-btn').addEventListener('click', () => {
  socket.emit('admin:pass:turn', { roomCode });
});

// Bankrupt done
document.getElementById('bankrupt-done-btn').addEventListener('click', () => {
  socket.emit('admin:bankrupt:done', { roomCode });
});

// Next round
document.getElementById('next-round-btn').addEventListener('click', () => {
  socket.emit('admin:next:round', { roomCode });
});

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;

socket.on('toast', ({ message, type }) => {
  const el = document.getElementById('admin-toast');
  el.textContent = message;
  el.className = `admin-toast toast-${type || 'info'}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
});

// ─── Socket events ─────────────────────────────────────────────────────────────
socket.on('connect', () => {
  socket.emit('join:room', { roomCode, role: 'admin' });
});

socket.on('state:full', applyState);

socket.on('letter:reveal', ({ letter, found }) => {
  if (!found) return;
  // Mark key as used
  const btn = document.querySelector(`.kb-key[data-letter="${letter}"]`);
  if (btn) { btn.classList.add('used-key'); btn.disabled = true; }
});

socket.on('turn:change', ({ playerName }) => {
  const el = document.getElementById('waiting-player-name');
  if (el) el.textContent = playerName;
});

socket.on('error:room', ({ message }) => {
  document.getElementById('error-msg').textContent = message;
  document.getElementById('error-screen').classList.remove('hidden');
  showScreen(null);
});

socket.on('session:expired', () => {
  document.getElementById('error-msg').textContent = 'Сессия истекла. Создайте новую игру.';
  document.getElementById('error-screen').classList.remove('hidden');
});

// ─── Init ──────────────────────────────────────────────────────────────────────
document.getElementById('room-code-label').textContent = roomCode;
showScreen('lobby');

// ─── Utils ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
