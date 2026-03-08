'use strict';

const roomCode = window.location.pathname.split('/')[2];
const socket = io();

// ─── Wheel setup ───────────────────────────────────────────────────────────────
const SECTORS = [
  { label: '50',   type: 'points',  color: '#f59e0b' },
  { label: '100',  type: 'points',  color: '#0ea5e9' },
  { label: '200',  type: 'points',  color: '#10b981' },
  { label: 'Б',    type: 'bankrupt',color: '#dc2626' },
  { label: '100',  type: 'points',  color: '#0ea5e9' },
  { label: 'П',    type: 'prize',   color: '#7c3aed' },
  { label: '50',   type: 'points',  color: '#f59e0b' },
  { label: 'x2',   type: 'x2',     color: '#2563eb' },
  { label: '200',  type: 'points',  color: '#14b8a6' },
  { label: 'Б',    type: 'bankrupt',color: '#dc2626' },
  { label: '300',  type: 'points',  color: '#d97706' },
  { label: 'Ш',    type: 'chance',  color: '#0891b2' },
  { label: '100',  type: 'points',  color: '#0ea5e9' },
  { label: '0',    type: 'zero',    color: '#475569' },
  { label: '+',    type: 'plus',    color: '#16a34a' },
  { label: 'Ключ', type: 'key',     color: '#b45309' },
];

const NUM_SECTORS = SECTORS.length;
const SECTOR_ANGLE = (2 * Math.PI) / NUM_SECTORS; // radians

const canvas = document.getElementById('wheel-canvas');
const ctx = canvas.getContext('2d');

let spinAngle = 0; // accumulated clockwise rotation in radians
let spinStartAngle = 0;
let spinTargetAngle = 0;
let spinStartTime = null;
let spinDuration = 0;
let isSpinning = false;

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

function computeTargetAngle(currentAngle, targetSector, velocity) {
  const TWO_PI = 2 * Math.PI;
  // We want: sectorUnderPointer = floor(((-newAngle % 2π) + 2π) % 2π / SECTOR_ANGLE) == targetSector
  // i.e., newAngle mod 2π == 2π - (targetSector + 0.5) * SECTOR_ANGLE
  const targetMod = (TWO_PI - (targetSector + 0.5) * SECTOR_ANGLE % TWO_PI + TWO_PI) % TWO_PI;
  const currentMod = ((currentAngle % TWO_PI) + TWO_PI) % TWO_PI;
  let diff = targetMod - currentMod;
  if (diff <= 0) diff += TWO_PI;
  return currentAngle + diff + velocity * TWO_PI;
}

function drawWheel() {
  const size = Math.min(canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = size * 0.47;
  const innerRadius = radius * 0.18;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Outer glow ring
  const glow = ctx.createRadialGradient(cx, cy, radius * 0.85, cx, cy, radius * 1.05);
  glow.addColorStop(0, 'rgba(245,158,11,0.0)');
  glow.addColorStop(0.6, 'rgba(245,158,11,0.15)');
  glow.addColorStop(1, 'rgba(245,158,11,0.0)');
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.04, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // Sectors
  for (let i = 0; i < NUM_SECTORS; i++) {
    const startAngle = -Math.PI / 2 + spinAngle + i * SECTOR_ANGLE;
    const endAngle = startAngle + SECTOR_ANGLE;
    const sector = SECTORS[i];

    // Main sector
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = sector.color;
    ctx.fill();

    // Lighter wedge highlight on top half
    const grad = ctx.createLinearGradient(
      cx + Math.cos(startAngle) * radius * 0.4,
      cy + Math.sin(startAngle) * radius * 0.4,
      cx + Math.cos(endAngle) * radius * 0.4,
      cy + Math.sin(endAngle) * radius * 0.4
    );
    grad.addColorStop(0, 'rgba(255,255,255,0.12)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Sector border
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = size * 0.004;
    ctx.stroke();

    // Label
    const midAngle = startAngle + SECTOR_ANGLE / 2;
    const labelR = radius * 0.65;
    const tx = cx + Math.cos(midAngle) * labelR;
    const ty = cy + Math.sin(midAngle) * labelR;

    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(midAngle + Math.PI / 2);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const isLong = sector.label.length > 2;
    ctx.font = `900 ${isLong ? size * 0.044 : size * 0.058}px sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;
    ctx.fillText(sector.label, 0, 0);
    ctx.restore();
  }

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(245,158,11,0.6)';
  ctx.lineWidth = size * 0.012;
  ctx.stroke();

  // Center hub
  const hubGrad = ctx.createRadialGradient(cx - innerRadius * 0.2, cy - innerRadius * 0.2, 0, cx, cy, innerRadius);
  hubGrad.addColorStop(0, '#fde68a');
  hubGrad.addColorStop(0.5, '#f59e0b');
  hubGrad.addColorStop(1, '#92400e');
  ctx.beginPath();
  ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
  ctx.fillStyle = hubGrad;
  ctx.fill();
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = size * 0.005;
  ctx.stroke();

  // Pointer (triangle at top)
  const pSize = size * 0.06;
  const pTip = cy - radius - size * 0.015;
  ctx.beginPath();
  ctx.moveTo(cx, pTip);
  ctx.lineTo(cx - pSize * 0.5, pTip + pSize * 0.9);
  ctx.lineTo(cx + pSize * 0.5, pTip + pSize * 0.9);
  ctx.closePath();
  ctx.fillStyle = '#fbbf24';
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = size * 0.004;
  ctx.fill();
  ctx.stroke();
}

function resizeCanvas() {
  const col = canvas.parentElement;
  const w = col.clientWidth;
  const h = col.clientHeight;
  const size = Math.min(w, h) * 0.94;
  canvas.width = size;
  canvas.height = size;
  drawWheel();
}

window.addEventListener('resize', resizeCanvas);

function animLoop(timestamp) {
  if (isSpinning) {
    const elapsed = timestamp - spinStartTime;
    const t = Math.min(1, elapsed / spinDuration);
    spinAngle = spinStartAngle + (spinTargetAngle - spinStartAngle) * easeOut(t);

    if (t >= 1) {
      spinAngle = spinTargetAngle;
      isSpinning = false;
      socket.emit('wheel:anim:done', { roomCode });
    }
  }

  drawWheel();
  requestAnimationFrame(animLoop);
}

// ─── Letter grid ──────────────────────────────────────────────────────────────
let currentSecretText = '';

function buildLetterGrid(round) {
  const grid = document.getElementById('letter-grid');
  grid.innerHTML = '';
  currentSecretText = round.secretText;

  const words = round.secretText.split(' ');
  let pos = 0;

  words.forEach((word, wi) => {
    const wordGroup = document.createElement('span');
    wordGroup.className = 'word-group';

    for (let i = 0; i < word.length; i++) {
      const tile = document.createElement('div');
      tile.className = round.revealedMask[pos] ? 'letter-tile revealed-tile' : 'letter-tile hidden-tile';
      tile.dataset.pos = pos;
      if (round.revealedMask[pos]) tile.textContent = word[i];
      wordGroup.appendChild(tile);
      pos++;
    }

    grid.appendChild(wordGroup);
    pos++; // skip space
  });
}

function revealTiles(positions, letter) {
  positions.forEach(p => {
    // Find tile by position
    const tile = document.querySelector(`.letter-tile[data-pos="${p}"]`);
    if (!tile) return;
    tile.className = 'letter-tile revealed-tile';
    tile.textContent = letter;
  });
}

// ─── Scoreboard ───────────────────────────────────────────────────────────────
function renderScoreboard(players, currentPlayerIndex) {
  const board = document.getElementById('scoreboard');
  board.innerHTML = '';

  players.forEach((p, i) => {
    const row = document.createElement('div');
    const isActive = i === currentPlayerIndex;
    row.className = `score-row${isActive ? ' active-player' : ''}`;
    row.innerHTML = `
      <span class="score-name${isActive ? ' active-player-name' : ''}">${escHtml(p.name)}</span>
      <span class="score-round">+${p.roundScore}</span>
      <span class="score-total">${p.totalScore}</span>
    `;
    board.appendChild(row);
  });
}

// ─── State render ─────────────────────────────────────────────────────────────
let lastState = null;

function applyState(state) {
  lastState = state;

  if (state.phase === 'lobby') return;

  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('tv-container').classList.remove('hidden');

  const round = state.rounds[state.currentRound];
  if (round) {
    document.getElementById('round-info').textContent =
      `Раунд ${state.currentRound + 1} из ${state.totalRounds}`;
    buildLetterGrid(round);
    renderUsedLetters(round.usedLetters);
  }

  const cp = state.players[state.currentPlayerIndex];
  if (cp) {
    document.getElementById('current-player-name').textContent = `Ход: ${cp.name}`;
    document.getElementById('current-player-score').textContent = `+${cp.roundScore}`;
  }

  renderScoreboard(state.players, state.currentPlayerIndex);
}

function renderUsedLetters(usedLetters) {
  const bar = document.getElementById('used-letters-bar');
  bar.innerHTML = usedLetters.map(l =>
    `<span class="used-letter-chip">${escHtml(l)}</span>`
  ).join('');
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;

function showToast(message, type = 'info', duration = 3500) {
  const el = document.getElementById('toast');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
}

// ─── Game end ─────────────────────────────────────────────────────────────────
function showGameEnd(players) {
  document.getElementById('game-end-overlay').classList.remove('hidden');

  const sorted = [...players].sort((a, b) => b.totalScore - a.totalScore);
  const medals = ['🥇', '🥈', '🥉'];

  const scoresEl = document.getElementById('final-scores');
  scoresEl.innerHTML = sorted.map((p, i) => `
    <div class="final-score-row">
      <span class="final-rank">${medals[i] || `${i+1}.`}</span>
      <span class="final-name">${escHtml(p.name)}</span>
      <span class="final-score-val">${p.totalScore}</span>
    </div>
  `).join('');

  // Animate nominations one by one
  const nomEl = document.getElementById('nominations-list');
  nomEl.innerHTML = '';
  players.forEach((p, i) => {
    if (!p.nomination) return;
    setTimeout(() => {
      const item = document.createElement('div');
      item.className = 'nomination-item';
      item.innerHTML = `
        <div class="nomination-title">${escHtml(p.nomination.title)}</div>
        <div class="nomination-text">${escHtml(p.nomination.text)}</div>
      `;
      nomEl.appendChild(item);
    }, i * 1800);
  });
}

// ─── Socket events ────────────────────────────────────────────────────────────
socket.on('connect', () => {
  socket.emit('join:room', { roomCode, role: 'tv' });
});

socket.on('state:full', applyState);

socket.on('wheel:spin:start', ({ targetSectorIndex, velocity }) => {
  const duration = 2500 + velocity * 280;
  spinStartTime = performance.now();
  spinStartAngle = spinAngle;
  spinTargetAngle = computeTargetAngle(spinAngle, targetSectorIndex, velocity);
  spinDuration = duration;
  isSpinning = true;
});

socket.on('wheel:spin:end', () => {
  // Animation already handles this via wheel:anim:done
});

socket.on('letter:reveal', ({ positions, letter, found }) => {
  if (found) revealTiles(positions, letter);
  if (lastState) renderUsedLetters(lastState.rounds[lastState.currentRound].usedLetters);
});

socket.on('word:reveal:full', ({ secretText }) => {
  // Reveal all tiles
  const tiles = document.querySelectorAll('.letter-tile');
  const chars = secretText.split('').filter(c => c !== ' ');
  let charIdx = 0;
  tiles.forEach(tile => {
    if (!tile.classList.contains('space-tile')) {
      tile.className = 'letter-tile revealed-tile';
      tile.textContent = chars[charIdx++] || '';
    }
  });
});

socket.on('turn:change', ({ playerName }) => {
  document.getElementById('current-player-name').textContent = `Ход: ${playerName}`;
});

socket.on('toast', ({ message, type }) => showToast(message, type));

socket.on('game:end', ({ players }) => showGameEnd(players));

socket.on('error:room', ({ message }) => {
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('error-msg').textContent = message;
  document.getElementById('error-overlay').classList.remove('hidden');
});

socket.on('session:expired', () => {
  document.getElementById('tv-container').classList.add('hidden');
  document.getElementById('error-msg').textContent = 'Сессия истекла';
  document.getElementById('error-overlay').classList.remove('hidden');
});

// ─── Init ─────────────────────────────────────────────────────────────────────
document.getElementById('lobby-room-code').textContent = roomCode;

resizeCanvas();
requestAnimationFrame(animLoop);

// ─── Utils ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
