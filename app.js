(function () {
  'use strict';

  var STORAGE_KEY = 'productteambingo.v1.state';
  var PALETTE = ['#FF006E', '#00F5FF', '#BFFF00', '#B5179E', '#FFD60A', '#FF6B35'];
  var CONFETTI_COUNT = 80;
  var CELEBRATION_DURATION = 3500;
  var SHAPES = ['circle', 'square', 'triangle', 'star'];
  var DEFAULT_SIZE = 5;

  var state = null;

  function getPhrases() {
    return Array.isArray(window.PHRASES) ? window.PHRASES : [];
  }

  // ---------- Persistence ----------

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      var size = parsed.size;
      var indices = parsed.indices;
      var marks = parsed.marks;
      var won = parsed.won === true;
      if ([3, 4, 5].indexOf(size) === -1) return null;
      var total = size * size;
      if (!Array.isArray(indices) || indices.length !== total) return null;
      if (!Array.isArray(marks) || marks.length !== total) return null;
      var phraseCount = getPhrases().length;
      for (var i = 0; i < indices.length; i++) {
        var v = indices[i];
        if (v !== -1 && (typeof v !== 'number' || v < 0 || v >= phraseCount)) return null;
      }
      for (var j = 0; j < marks.length; j++) {
        if (typeof marks[j] !== 'boolean') return null;
      }
      return { size: size, indices: indices, marks: marks, won: won };
    } catch (e) {
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* ignore quota errors */ }
  }

  // ---------- Card generation ----------

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function generateCard(size) {
    var total = size * size;
    var hasFree = (size === 3 || size === 5);
    var phraseCount = hasFree ? total - 1 : total;
    var phrases = getPhrases();

    if (phrases.length < phraseCount) {
      console.warn('Not enough phrases (' + phrases.length + ') for size ' + size + ' (need ' + phraseCount + ')');
    }

    var pool = [];
    for (var i = 0; i < phrases.length; i++) pool.push(i);
    var shuffled = shuffle(pool).slice(0, phraseCount);

    var indices = [];
    var marks = [];
    var centerIdx = Math.floor(total / 2);
    var p = 0;
    for (var k = 0; k < total; k++) {
      if (hasFree && k === centerIdx) {
        indices.push(-1);
        marks.push(true);
      } else {
        indices.push(shuffled[p++]);
        marks.push(false);
      }
    }
    return { size: size, indices: indices, marks: marks, won: false };
  }

  // ---------- Render ----------

  function render() {
    var grid = document.getElementById('grid');
    grid.className = 'grid grid-' + state.size + (state.won ? ' locked' : '');
    grid.innerHTML = '';

    var btns = document.querySelectorAll('.size-btn');
    for (var i = 0; i < btns.length; i++) {
      var sz = parseInt(btns[i].getAttribute('data-size'), 10);
      var isActive = (sz === state.size);
      btns[i].classList.toggle('active', isActive);
      btns[i].setAttribute('aria-checked', isActive ? 'true' : 'false');
    }

    var phrases = getPhrases();
    var total = state.size * state.size;
    for (var idx = 0; idx < total; idx++) {
      var phraseIdx = state.indices[idx];
      var isFree = (phraseIdx === -1);
      var text = isFree ? '★ FREE' : (phrases[phraseIdx] || '');
      var isMarked = state.marks[idx];

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cell' + (isMarked ? ' marked' : '') + (isFree ? ' free' : '');
      btn.style.setProperty('--cell-tint', PALETTE[idx % PALETTE.length]);
      btn.style.setProperty('--cell-rotate', ((Math.random() * 8) - 4).toFixed(2) + 'deg');
      btn.setAttribute('data-index', String(idx));
      btn.setAttribute('role', 'gridcell');
      btn.setAttribute('aria-pressed', isMarked ? 'true' : 'false');
      btn.setAttribute('aria-label', text + (isMarked ? ' — označeno' : ''));
      if (isFree) btn.setAttribute('aria-disabled', 'true');

      var span = document.createElement('span');
      span.className = 'cell-text';
      span.textContent = text;
      btn.appendChild(span);

      grid.appendChild(btn);
    }

    // Auto-fit text after layout settles
    requestAnimationFrame(function () {
      var spans = grid.querySelectorAll('.cell-text');
      for (var s = 0; s < spans.length; s++) fitText(spans[s]);
    });
  }

  function fitText(el) {
    var parent = el.parentElement;
    if (!parent) return;
    if (parent.classList.contains('free')) return; // FREE has fixed size
    var max = 18;
    var min = 10;
    var size = max;
    el.style.fontSize = size + 'px';
    var safety = 0;
    while (
      (el.scrollHeight > parent.clientHeight - 8 || el.scrollWidth > parent.clientWidth - 8) &&
      size > min && safety < 30
    ) {
      size--;
      el.style.fontSize = size + 'px';
      safety++;
    }
  }

  // ---------- Bingo detection ----------

  function getLines(size) {
    var lines = [];
    var r, c, cells;
    for (r = 0; r < size; r++) {
      cells = [];
      for (c = 0; c < size; c++) cells.push(r * size + c);
      lines.push({ id: 'r' + r, cells: cells });
    }
    for (c = 0; c < size; c++) {
      cells = [];
      for (r = 0; r < size; r++) cells.push(r * size + c);
      lines.push({ id: 'c' + c, cells: cells });
    }
    var d1 = [], d2 = [];
    for (var i = 0; i < size; i++) {
      d1.push(i * size + i);
      d2.push(i * size + (size - 1 - i));
    }
    lines.push({ id: 'd1', cells: d1 });
    lines.push({ id: 'd2', cells: d2 });
    return lines;
  }

  function findCompleteLineIds() {
    var lines = getLines(state.size);
    var ids = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var all = true;
      for (var j = 0; j < line.cells.length; j++) {
        if (!state.marks[line.cells[j]]) { all = false; break; }
      }
      if (all) ids.push(line.id);
    }
    return ids;
  }

  // ---------- Confetti / celebration ----------

  function celebrate() {
    var overlay = document.getElementById('celebration');
    var confetti = document.getElementById('confetti');
    confetti.innerHTML = '';

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!reduced) {
      var frag = document.createDocumentFragment();
      for (var i = 0; i < CONFETTI_COUNT; i++) {
        var piece = document.createElement('div');
        piece.className = 'confetti-piece ' + SHAPES[i % SHAPES.length];
        piece.style.left = (Math.random() * 100) + '%';
        piece.style.background = PALETTE[i % PALETTE.length];
        piece.style.animationDelay = (Math.random() * 0.6).toFixed(2) + 's';
        piece.style.animationDuration = (1.8 + Math.random() * 1.6).toFixed(2) + 's';
        piece.style.setProperty('--rotate', Math.floor(Math.random() * 1080 - 540) + 'deg');
        var scale = 0.6 + Math.random() * 1.1;
        piece.style.transform = 'scale(' + scale.toFixed(2) + ')';
        frag.appendChild(piece);
      }
      confetti.appendChild(frag);
    }

    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');

    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.removeEventListener('click', dismiss);
      clearTimeout(timer);
    }
    overlay.addEventListener('click', dismiss);
    var timer = setTimeout(dismiss, CELEBRATION_DURATION);
  }

  // ---------- Events ----------

  function onCellClick(e) {
    if (state.won) return;
    var btn = e.target.closest ? e.target.closest('.cell') : null;
    if (!btn || btn.classList.contains('free')) return;
    var idx = parseInt(btn.getAttribute('data-index'), 10);
    if (isNaN(idx)) return;

    var before = findCompleteLineIds();
    state.marks[idx] = !state.marks[idx];
    var after = findCompleteLineIds();

    var beforeSet = {};
    for (var i = 0; i < before.length; i++) beforeSet[before[i]] = true;
    var newBingo = false;
    for (var j = 0; j < after.length; j++) {
      if (!beforeSet[after[j]]) { newBingo = true; break; }
    }
    if (newBingo) state.won = true;

    saveState();
    render();
    if (newBingo) celebrate();
  }

  function onSizeChange(e) {
    var btn = e.target.closest ? e.target.closest('.size-btn') : null;
    if (!btn) return;
    var size = parseInt(btn.getAttribute('data-size'), 10);
    if (isNaN(size) || size === state.size) return;
    state = generateCard(size);
    saveState();
    render();
  }

  function onNewCard() {
    state = generateCard(state.size);
    saveState();
    render();
  }

  function onKeyDown(e) {
    var grid = document.getElementById('grid');
    var active = document.activeElement;
    if (!grid.contains(active)) return;
    var cells = grid.querySelectorAll('.cell');
    var idx = -1;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i] === active) { idx = i; break; }
    }
    if (idx < 0) return;
    var size = state.size;
    var next = idx;
    if (e.key === 'ArrowRight') next = idx + 1;
    else if (e.key === 'ArrowLeft') next = idx - 1;
    else if (e.key === 'ArrowDown') next = idx + size;
    else if (e.key === 'ArrowUp') next = idx - size;
    else return;
    e.preventDefault();
    if (next >= 0 && next < cells.length) cells[next].focus();
  }

  // ---------- Init ----------

  function init() {
    state = loadState() || generateCard(DEFAULT_SIZE);
    render();

    document.getElementById('grid').addEventListener('click', onCellClick);
    document.querySelector('.size-selector').addEventListener('click', onSizeChange);
    document.getElementById('new-card').addEventListener('click', onNewCard);
    document.addEventListener('keydown', onKeyDown);

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var spans = document.querySelectorAll('.cell-text');
        for (var s = 0; s < spans.length; s++) fitText(spans[s]);
      }, 120);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
