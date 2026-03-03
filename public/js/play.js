'use strict';

const roomCode = window.location.pathname.split('/')[2];
const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let spinEnabled = false;
let canGuess = false;
let currentState = null;
let tapAnimTimer = null;

// ─── UI helpers ───────────────────────────────────────────────────────────────
function showEl(id)  { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function hideEl(id)  { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }

function setSpinEnabled(enabled) {
  spinEnabled = enabled;
  const btn = document.getElementById('spin-btn');
  if (!btn) return;
  btn.disabled = !enabled;

  const hint = document.getElementById('spin-hint');
  if (hint) {
    hint.textContent = enabled
      ? 'Нажимай быстро! Чем больше нажатий — тем быстрее!'
      : 'Ожидайте своей очереди';
  }

  if (!enabled) {
    hideEl('tap-count');
  }
}

function updateTurnBar(state) {
  const cp = state.players[state.currentPlayerIndex];
  if (!cp) return;
  document.getElementById('current-player-display').textContent = cp.name;
  document.getElementById('current-score-display').textContent = cp.roundScore;

  const roundEl = document.getElementById('round-display');
  if (roundEl) roundEl.textContent = `Раунд ${state.currentRound + 1} из ${state.totalRounds}`;
}

function showSector(label, type) {
  const el = document.getElementById('sector-display');
  const text = document.getElementById('sector-text');
  if (!el || !text) return;

  const msgs = {
    bankrupt: `💸 Банкрот! Очки сгорают`,
    zero:     `😶 Ноль — ход переходит`,
    prize:    `🎁 Приз! +50 очков`,
    key:      `🔑 Ключ!`,
    x2:       `⚡ x2 — двойные очки!`,
    chance:   `🤝 Шанс! Попросите помощи`,
    plus:     `✨ Плюс — называйте букву!`,
    points:   `🎯 ${label} очков за букву!`,
  };

  text.textContent = msgs[type] || `Сектор: ${label}`;
  el.classList.remove('hidden');
}

// ─── SPIN button ──────────────────────────────────────────────────────────────
const spinBtn = document.getElementById('spin-btn');

spinBtn.addEventListener('click', () => {
  if (!spinEnabled) return;
  socket.emit('spin:tap', { roomCode });
  spinBtn.classList.add('spin-tap');
  setTimeout(() => spinBtn.classList.remove('spin-tap'), 100);
});

// Prevent double-tap zoom on mobile
spinBtn.addEventListener('touchstart', e => { e.preventDefault(); }, { passive: false });
spinBtn.addEventListener('touchend', e => {
  e.preventDefault();
  if (!spinEnabled) return;
  socket.emit('spin:tap', { roomCode });
});

socket.on('spin:tap:ack', ({ count }) => {
  const el = document.getElementById('tap-count');
  if (!el) return;
  el.classList.remove('hidden');
  el.textContent = count;
  // Restart pop animation
  el.style.animation = 'none';
  requestAnimationFrame(() => { el.style.animation = ''; });

  clearTimeout(tapAnimTimer);
  tapAnimTimer = setTimeout(() => hideEl('tap-count'), 2500);
});

// ─── Guess word ───────────────────────────────────────────────────────────────
document.getElementById('guess-btn').addEventListener('click', () => {
  showEl('guess-form');
  hideEl('guess-btn');
  document.getElementById('guess-input').focus();
});

document.getElementById('guess-cancel').addEventListener('click', () => {
  hideEl('guess-form');
  if (canGuess) showEl('guess-btn');
  document.getElementById('guess-input').value = '';
});

document.getElementById('guess-submit').addEventListener('click', submitGuess);

document.getElementById('guess-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitGuess();
});

function submitGuess() {
  const input = document.getElementById('guess-input');
  const word = input.value.trim();
  if (!word) return;
  socket.emit('guess:word', { roomCode, word });
  hideEl('guess-form');
  hideEl('guess-btn');
  setSpinEnabled(false);
  input.value = '';
  showWaitMessage('Ожидаем решения ведущего...');
}

function showWaitMessage(msg) {
  const el = document.getElementById('wait-message');
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

function clearWaitMessage() { hideEl('wait-message'); }

// ─── Socket events ────────────────────────────────────────────────────────────
socket.on('connect', () => {
  socket.emit('join:room', { roomCode, role: 'player' });
});

socket.on('state:full', state => {
  currentState = state;

  if (state.phase === 'lobby') return;

  // Switch to game screen
  hideEl('screen-lobby');
  showEl('screen-game');
  updateTurnBar(state);

  // Phase-specific updates
  if (state.phase === 'word_guess' && state.pendingWord) {
    showWaitMessage(`«${state.pendingWord}» — ведущий решает...`);
  }

  if (state.phase === 'game_end') {
    showGameEnd(state);
  }
});

socket.on('player:enable', () => {
  setSpinEnabled(true);
  clearWaitMessage();
  hideEl('sector-display');
});

socket.on('player:disable', () => {
  setSpinEnabled(false);
  canGuess = false;
  hideEl('guess-btn');
  hideEl('guess-form');
  hideEl('tap-count');
});

socket.on('player:can_guess', ({ canGuess: cg }) => {
  canGuess = cg;
  if (cg && spinEnabled) {
    showEl('guess-btn');
  } else {
    hideEl('guess-btn');
  }
});

socket.on('player:sector', ({ sectorLabel, canGuessWord }) => {
  if (currentState) {
    const spinResult = currentState.spinResult;
    if (spinResult) showSector(sectorLabel, spinResult.type);
    else showSector(sectorLabel, 'points');
  } else {
    showSector(sectorLabel, 'points');
  }

  if (canGuessWord) {
    canGuess = true;
    if (spinEnabled) showEl('guess-btn');
  }
});

socket.on('turn:change', ({ playerName }) => {
  document.getElementById('current-player-display').textContent = playerName;
  clearWaitMessage();
  hideEl('sector-display');
  hideEl('guess-btn');
  hideEl('guess-form');
  hideEl('tap-count');
  canGuess = false;
});

socket.on('letter:reveal', ({ earned }) => {
  if (currentState) {
    const cp = currentState.players[currentState.currentPlayerIndex];
    if (cp) {
      // Optimistic score update
      document.getElementById('current-score-display').textContent = cp.roundScore;
    }
  }
});

socket.on('game:end', ({ players }) => {
  showGameEnd({ players, nominations: players.map(p => p.nomination) });
});

socket.on('word:reveal:full', () => {
  hideEl('guess-btn');
  hideEl('guess-form');
});

socket.on('error:room', ({ message }) => {
  document.getElementById('error-msg').textContent = message;
  showEl('error-screen');
  hideEl('screen-lobby');
  hideEl('screen-game');
});

socket.on('session:expired', () => {
  document.getElementById('error-msg').textContent = 'Сессия истекла';
  showEl('error-screen');
  hideEl('screen-game');
});

// ─── Game end ─────────────────────────────────────────────────────────────────
function showGameEnd(data) {
  hideEl('screen-lobby');
  hideEl('screen-game');
  showEl('screen-game-end');

  const players = data.players || (currentState && currentState.players) || [];
  const nominations = data.nominations;

  const sorted = [...players].sort((a, b) => b.totalScore - a.totalScore);
  const medals = ['🥇', '🥈', '🥉'];

  const scoresEl = document.getElementById('end-scores');
  if (scoresEl) {
    scoresEl.innerHTML = sorted.map((p, i) => `
      <div class="end-score-row">
        <span class="end-score-name">${medals[i] || `${i+1}.`} ${escHtml(p.name)}</span>
        <span class="end-score-val">${p.totalScore}</span>
      </div>
    `).join('');
  }

  // Show nomination for this session's player (all nominations since it's a shared phone)
  if (nominations && Array.isArray(nominations)) {
    const nomEl = document.getElementById('my-nomination');
    if (nomEl) {
      const allNoms = nominations.filter(Boolean);
      if (allNoms.length > 0) {
        nomEl.classList.remove('hidden');
        let idx = 0;
        function showNext() {
          if (idx >= players.length) return;
          const p = players[idx];
          const nom = nominations[idx] || p.nomination;
          if (nom) {
            nomEl.innerHTML = `
              <div class="nom-title">${escHtml(p.name)} — ${escHtml(nom.title)}</div>
              <div class="nom-text">${escHtml(nom.text)}</div>
            `;
          }
          idx++;
          if (idx < players.length) setTimeout(showNext, 3000);
        }
        showNext();
      }
    }
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.getElementById('room-code-label').textContent = roomCode;

// ─── Utils ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
