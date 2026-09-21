'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#b0bec5', // N - tuerca (gris metálico)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N (tuerca)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const leaderboardList = document.getElementById('leaderboard-list');
const bestComboEl = document.getElementById('best-combo');
const bestLinesEl = document.getElementById('best-lines');
const resetRecordsBtn = document.getElementById('reset-records-btn');
const gameoverExtra = document.getElementById('gameover-extra');
const nameInput = document.getElementById('name-input');
const submitScoreBtn = document.getElementById('submit-score-btn');

const THEME_KEY = 'tetris-theme';
const STATS_KEY = 'tetris-stats';
const HIGHSCORES_KEY = 'tetris-highscores';
let gridColor = '#22222e';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim() || gridColor;
  themeToggle.checked = theme === 'light';
  themeToggle.setAttribute('aria-checked', String(theme === 'light'));
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

themeToggle.addEventListener('change', () => {
  applyTheme(themeToggle.checked ? 'light' : 'dark');
  if (board) {
    draw();
    drawNext();
  }
});

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

let combo = 0;
let runBestCombo = 0;
let bestCombo = 0, bestLines = 0;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 8) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
    combo++;
    runBestCombo = Math.max(runBestCombo, combo);
  } else {
    combo = 0;
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function safeParseJSON(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function getHighscores() {
  const saved = safeParseJSON(localStorage.getItem(HIGHSCORES_KEY));
  if (!Array.isArray(saved)) return [];
  return saved.filter(entry => entry && typeof entry.name === 'string' && typeof entry.score === 'number' && !Number.isNaN(entry.score));
}

function saveHighscores(list) {
  localStorage.setItem(HIGHSCORES_KEY, JSON.stringify(list));
}

function qualifiesForLeaderboard(candidateScore) {
  const list = getHighscores();
  if (list.length < 5) return true;
  const lowest = list[list.length - 1];
  return candidateScore > lowest.score;
}

function renderStats() {
  bestComboEl.textContent = bestCombo;
  bestLinesEl.textContent = bestLines;
}

function renderLeaderboard(highlightEntry) {
  const list = getHighscores();
  leaderboardList.innerHTML = '';
  if (list.length === 0) {
    const li = document.createElement('li');
    li.className = 'leaderboard-empty';
    li.textContent = 'Sin puntuaciones';
    leaderboardList.appendChild(li);
    return;
  }
  list.forEach(entry => {
    const li = document.createElement('li');
    li.className = 'leaderboard-entry';
    if (highlightEntry && entry.name === highlightEntry.name && entry.score === highlightEntry.score) {
      li.classList.add('leaderboard-highlight');
    }
    const nameSpan = document.createElement('span');
    nameSpan.className = 'leaderboard-name';
    nameSpan.textContent = entry.name;
    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'leaderboard-score';
    scoreSpan.textContent = entry.score.toLocaleString();
    li.appendChild(nameSpan);
    li.appendChild(scoreSpan);
    leaderboardList.appendChild(li);
  });
}

function submitScore() {
  const name = nameInput.value.trim() || 'Jugador';
  const entry = { name, score };
  const list = getHighscores();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const capped = list.slice(0, 5);
  saveHighscores(capped);
  gameoverExtra.classList.add('hidden');
  restartBtn.disabled = false;
  renderLeaderboard(entry);
}

function resetRecords() {
  if (!window.confirm('¿Borrar récords y estadísticas guardadas?')) return;
  localStorage.removeItem(HIGHSCORES_KEY);
  localStorage.removeItem(STATS_KEY);
  bestCombo = 0;
  bestLines = 0;
  renderStats();
  renderLeaderboard();
}

function initStats() {
  const parsed = safeParseJSON(localStorage.getItem(STATS_KEY));
  if (parsed && typeof parsed === 'object') {
    bestCombo = typeof parsed.bestCombo === 'number' ? parsed.bestCombo : 0;
    bestLines = typeof parsed.bestLines === 'number' ? parsed.bestLines : 0;
  }
  renderStats();
  renderLeaderboard();
}

submitScoreBtn.addEventListener('click', submitScore);
nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') submitScore();
});
resetRecordsBtn.addEventListener('click', resetRecords);

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');

  let statsChanged = false;
  if (runBestCombo > bestCombo) {
    bestCombo = runBestCombo;
    statsChanged = true;
  }
  if (lines > bestLines) {
    bestLines = lines;
    statsChanged = true;
  }
  if (statsChanged) {
    localStorage.setItem(STATS_KEY, JSON.stringify({ bestCombo, bestLines }));
  }
  renderStats();

  if (qualifiesForLeaderboard(score)) {
    nameInput.value = '';
    gameoverExtra.classList.remove('hidden');
    restartBtn.disabled = true;
  } else {
    gameoverExtra.classList.add('hidden');
  }
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  combo = 0;
  runBestCombo = 0;
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  gameoverExtra.classList.add('hidden');
  restartBtn.disabled = false;
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

initTheme();
init();
initStats();
