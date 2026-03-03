'use strict';

// ─── Round phrase inputs ───────────────────────────────────────────────────────
let selectedRounds = 2;

function renderRoundFields() {
  const container = document.getElementById('rounds-section');
  container.innerHTML = '';
  for (let i = 1; i <= selectedRounds; i++) {
    const div = document.createElement('div');
    div.className = 'round-field';
    div.innerHTML = `
      <label>Раунд ${i} — загаданное слово или фраза</label>
      <input type="text" id="round-${i}" placeholder="например: ПОЛЕ ЧУДЕС" autocomplete="off" autocorrect="off" spellcheck="false">
    `;
    container.appendChild(div);
  }
}

document.querySelectorAll('.round-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.round-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedRounds = parseInt(btn.dataset.rounds);
    renderRoundFields();
  });
});

renderRoundFields();

// ─── Create room ───────────────────────────────────────────────────────────────
document.getElementById('create-btn').addEventListener('click', async () => {
  const errorEl = document.getElementById('form-error');
  errorEl.classList.add('hidden');

  // Collect rounds
  const rounds = [];
  for (let i = 1; i <= selectedRounds; i++) {
    const val = document.getElementById(`round-${i}`).value.trim();
    if (!val) {
      showError(`Введите фразу для раунда ${i}`);
      return;
    }
    rounds.push({ secretText: val });
  }

  // Collect players
  const playersRaw = document.getElementById('players-input').value;
  const players = playersRaw.split('\n').map(p => p.trim()).filter(Boolean);
  if (players.length < 2) {
    showError('Добавьте минимум 2 игрока (по одному имени в строку)');
    return;
  }

  const btn = document.getElementById('create-btn');
  btn.disabled = true;
  btn.textContent = 'Создаём комнату...';

  try {
    const res = await fetch('/api/create-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalRounds: selectedRounds, players, rounds }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Ошибка создания комнаты');
      return;
    }

    showResult(data);
  } catch {
    showError('Не удалось подключиться к серверу');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Создать комнату';
  }
});

function showError(msg) {
  const el = document.getElementById('form-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showResult({ roomCode, tvUrl, adminUrl, playerUrl, adminQr, playerQr }) {
  document.getElementById('setup-screen').classList.add('hidden');
  const result = document.getElementById('result-screen');
  result.classList.remove('hidden');

  document.getElementById('room-code-display').textContent = roomCode;

  const tvLink = document.getElementById('tv-link');
  tvLink.href = tvUrl;
  tvLink.textContent = tvUrl;

  document.getElementById('admin-qr').src = adminQr;
  document.getElementById('admin-url').textContent = adminUrl;
  document.getElementById('admin-link').href = adminUrl;

  document.getElementById('player-qr').src = playerQr;
  document.getElementById('player-url').textContent = playerUrl;
  document.getElementById('player-link').href = playerUrl;

  result.scrollIntoView({ behavior: 'smooth' });
}

// ─── Copy button ───────────────────────────────────────────────────────────────
document.querySelector('.btn-copy').addEventListener('click', function () {
  const targetId = this.dataset.target;
  const el = document.getElementById(targetId);
  const text = el.href || el.textContent;
  navigator.clipboard.writeText(text).then(() => {
    const orig = this.textContent;
    this.textContent = 'Скопировано!';
    setTimeout(() => { this.textContent = orig; }, 1500);
  });
});

// ─── New game ─────────────────────────────────────────────────────────────────
document.getElementById('new-game-btn').addEventListener('click', () => {
  document.getElementById('result-screen').classList.add('hidden');
  document.getElementById('setup-screen').classList.remove('hidden');
  document.getElementById('form-error').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
