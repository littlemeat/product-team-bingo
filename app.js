import { supabase } from "./supabase-client.js";

const PALETTE = ['#FF006E', '#00F5FF', '#BFFF00', '#B5179E', '#FFD60A', '#FF6B35'];
const SHAPES = ['circle', 'square', 'triangle', 'star'];
const CONFETTI_COUNT = 80;
const POLL_FALLBACK_MS = 5000;
const TOAST_MS = 3200;

const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let session = null;

function el(id) { return document.getElementById(id); }
function showView(name) {
  for (const v of document.querySelectorAll('.view')) v.hidden = (v.id !== `view-${name}`);
}

// ---------- Routing ----------

function parseRoute() {
  const hash = window.location.hash || '#/';
  const m = hash.match(/^#\/g\/([a-z0-9]+)\/?$/i);
  if (m) return { name: 'game', shortCode: m[1].toLowerCase() };
  return { name: 'landing' };
}

async function handleRoute() {
  teardownSession();
  hideCelebration();
  const route = parseRoute();
  if (route.name === 'landing') return renderLanding();
  if (route.name === 'game') return enterGame(route.shortCode);
}

function hideCelebration() {
  const overlay = document.getElementById('celebration');
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
}

window.addEventListener('hashchange', handleRoute);

// ---------- Landing ----------

function renderLanding() {
  showView('landing');

  const selector = document.querySelector('#view-landing .size-selector');
  selector.onclick = (e) => {
    const btn = e.target.closest('.size-btn');
    if (!btn) return;
    for (const b of selector.querySelectorAll('.size-btn')) {
      const isActive = (b === btn);
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-checked', isActive ? 'true' : 'false');
    }
  };

  el('create-game-btn').onclick = async () => {
    const activeBtn = selector.querySelector('.size-btn.active');
    const size = parseInt(activeBtn.getAttribute('data-size'), 10);
    await createGame(size);
  };

  el('join-form').onsubmit = (e) => {
    e.preventDefault();
    const code = el('join-code').value.trim().toLowerCase();
    if (!/^[a-z0-9]{4,12}$/.test(code)) {
      toast('Kód má 4–12 znaků (písmena a číslice).');
      return;
    }
    window.location.hash = `#/g/${code}`;
  };
}

async function createGame(size) {
  const btn = el('create-game-btn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Vytvářím…';
  try {
    const { data, error } = await supabase.rpc('create_game', { game_size: size });
    if (error) throw error;
    window.location.hash = `#/g/${data}`;
  } catch (e) {
    console.error(e);
    toast('Nepodařilo se vytvořit hru. Zkus to znovu.');
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ---------- Game entry ----------

async function enterGame(shortCode) {
  showLoading('Připojuji do hry…');

  const storedKey = `bingo.player.${shortCode}`;
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(storedKey) || 'null'); } catch (e) {}

  if (stored && stored.player_id && stored.game_id) {
    try {
      const restored = await restoreSession(shortCode, stored);
      startSession(restored);
      return;
    } catch (e) {
      console.warn('Restore failed, falling back to fresh join', e);
      localStorage.removeItem(storedKey);
    }
  }

  const nickname = await promptNickname();
  if (!nickname) {
    window.location.hash = '#/';
    return;
  }
  showLoading('Připravuju kartu…');
  try {
    const { data, error } = await supabase.rpc('join_game', {
      p_short_code: shortCode,
      p_nickname: nickname
    });
    if (error) throw error;
    const card = data.card.slice().sort((a, b) => a.position - b.position);
    const persisted = {
      game_id: data.game_id,
      player_id: data.player_id,
      nickname,
      size: data.size,
      card
    };
    localStorage.setItem(storedKey, JSON.stringify(persisted));
    startSession({
      shortCode,
      gameId: data.game_id,
      playerId: data.player_id,
      nickname,
      size: data.size,
      card,
      marks: new Set(),
      ended: false,
      winnerName: null
    });
  } catch (e) {
    handleJoinError(e, shortCode);
  }
}

async function restoreSession(shortCode, stored) {
  const [gameRes, marksRes] = await Promise.all([
    supabase.from('games').select('id, size, ended_at, winner_player_id').eq('short_code', shortCode).maybeSingle(),
    supabase.from('marks').select('position').eq('player_id', stored.player_id)
  ]);
  if (gameRes.error) throw gameRes.error;
  if (!gameRes.data) throw new Error('game_not_found');
  if (marksRes.error) throw marksRes.error;

  const game = gameRes.data;
  if (game.id !== stored.game_id) throw new Error('game_mismatch');

  const marks = new Set((marksRes.data || []).map(m => m.position));
  let winnerName = null;
  if (game.winner_player_id) {
    winnerName = await fetchPlayerName(game.winner_player_id);
  }

  return {
    shortCode,
    gameId: game.id,
    playerId: stored.player_id,
    nickname: stored.nickname,
    size: game.size,
    card: stored.card,
    marks,
    ended: !!game.ended_at,
    winnerName
  };
}

function handleJoinError(e, shortCode) {
  const msg = (e && e.message) || '';
  let text = 'Něco se pokazilo. Zkus to za chvíli.';
  if (msg.includes('game_not_found')) text = `Hra s kódem ${shortCode} neexistuje.`;
  else if (msg.includes('game_ended')) text = 'Tahle hra už skončila.';
  else if (msg.includes('not_enough_phrases')) text = 'V databázi je málo frází pro tuhle velikost karty.';
  showError(text);
}

// ---------- Session ----------

function teardownSession() {
  if (!session) return;
  if (session.channel) supabase.removeChannel(session.channel).catch(() => {});
  if (session.pollTimer) clearInterval(session.pollTimer);
  if (session.visibilityHandler) {
    document.removeEventListener('visibilitychange', session.visibilityHandler);
  }
  session = null;
}

function startSession(s) {
  session = s;
  session.channel = null;
  session.pollTimer = null;
  session.usingFallback = false;

  showView('game');
  renderGameMeta();
  renderCard();
  renderStatus();

  // If already won when we joined, fast-path the end state.
  if (session.ended && session.winnerName) {
    announceWinner(session.winnerName, session.winnerName === session.nickname);
  }

  subscribeRealtime();

  session.visibilityHandler = () => {
    if (document.visibilityState === 'visible' && !session.ended) {
      resubscribeRealtime();
    }
  };
  document.addEventListener('visibilitychange', session.visibilityHandler);
}

function subscribeRealtime() {
  if (session.channel) {
    supabase.removeChannel(session.channel).catch(() => {});
    session.channel = null;
  }

  const channel = supabase
    .channel(`game-${session.gameId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${session.gameId}` },
      (payload) => {
        const row = payload.new || {};
        if (row.winner_player_id && !session.ended) {
          handleWinnerEvent(row.winner_player_id);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (session.pollTimer) {
          clearInterval(session.pollTimer);
          session.pollTimer = null;
        }
        session.usingFallback = false;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        startPollingFallback();
      }
    });

  session.channel = channel;
}

function resubscribeRealtime() {
  subscribeRealtime();
}

function startPollingFallback() {
  if (session.pollTimer || session.ended) return;
  session.usingFallback = true;
  session.pollTimer = setInterval(async () => {
    if (!session || session.ended) return;
    const { data, error } = await supabase
      .from('games')
      .select('winner_player_id, ended_at')
      .eq('id', session.gameId)
      .maybeSingle();
    if (error || !data) return;
    if (data.winner_player_id && !session.ended) {
      handleWinnerEvent(data.winner_player_id);
    }
  }, POLL_FALLBACK_MS);
}

async function handleWinnerEvent(winnerPlayerId) {
  if (session.ended) return;
  const name = await fetchPlayerName(winnerPlayerId);
  session.winnerName = name;
  session.ended = true;
  renderCard();
  renderStatus();
  const isSelf = (winnerPlayerId === session.playerId);
  announceWinner(name, isSelf);
}

async function fetchPlayerName(playerId) {
  const { data, error } = await supabase
    .from('players')
    .select('nickname')
    .eq('id', playerId)
    .maybeSingle();
  if (error || !data) return 'někdo';
  return data.nickname;
}

// ---------- Render ----------

function renderGameMeta() {
  el('game-code-label').textContent = `Kód: ${session.shortCode}`;
  el('copy-link-btn').onclick = async () => {
    const url = `${location.origin}${location.pathname}#/g/${session.shortCode}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Odkaz zkopírován.');
    } catch (e) {
      prompt('Zkopíruj odkaz:', url);
    }
  };
}

function renderCard() {
  const grid = el('grid');
  grid.className = 'grid grid-' + session.size + (session.ended ? ' locked' : '');
  grid.innerHTML = '';
  const total = session.size * session.size;
  const isFreeCenter = (session.size === 3 || session.size === 5);
  const centerIdx = isFreeCenter ? Math.floor(total / 2) : -1;

  for (let i = 0; i < total; i++) {
    const cell = session.card[i] || null;
    const isFree = (i === centerIdx);
    const text = isFree ? '★ FREE' : (cell ? cell.text : '');
    const isMarked = isFree || session.marks.has(i);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cell' + (isMarked ? ' marked' : '') + (isFree ? ' free' : '');
    btn.style.setProperty('--cell-tint', PALETTE[i % PALETTE.length]);
    btn.style.setProperty('--cell-rotate', ((Math.random() * 8) - 4).toFixed(2) + 'deg');
    btn.setAttribute('data-index', String(i));
    btn.setAttribute('role', 'gridcell');
    btn.setAttribute('aria-pressed', isMarked ? 'true' : 'false');
    btn.setAttribute('aria-label', text + (isMarked ? ' — označeno' : ''));
    if (isFree || session.ended) btn.disabled = true;

    const span = document.createElement('span');
    span.className = 'cell-text';
    span.textContent = text;
    btn.appendChild(span);

    grid.appendChild(btn);
  }

  grid.onclick = onCellClick;

  requestAnimationFrame(() => {
    for (const span of grid.querySelectorAll('.cell-text')) fitText(span);
  });
}

function renderStatus() {
  const statusEl = el('game-status');
  if (session.ended && session.winnerName) {
    const who = (session.winnerName === session.nickname) ? 'Ty' : session.winnerName;
    statusEl.textContent = `Konec hry — vyhrál ${who}.`;
  } else if (session.marks.size === 0) {
    statusEl.textContent = `${session.nickname} • čekám na první trefu…`;
  } else {
    statusEl.textContent = `${session.nickname} • ${session.marks.size} označeno`;
  }
}

function fitText(elNode) {
  const parent = elNode.parentElement;
  if (!parent) return;
  if (parent.classList.contains('free')) return;
  const max = 18, min = 10;
  let size = max;
  elNode.style.fontSize = size + 'px';
  let safety = 0;
  while (
    (elNode.scrollHeight > parent.clientHeight - 8 || elNode.scrollWidth > parent.clientWidth - 8) &&
    size > min && safety < 30
  ) {
    size--;
    elNode.style.fontSize = size + 'px';
    safety++;
  }
}

// ---------- Cell interaction ----------

async function onCellClick(e) {
  if (session.ended) return;
  const btn = e.target.closest ? e.target.closest('.cell') : null;
  if (!btn || btn.classList.contains('free') || btn.disabled) return;
  const idx = parseInt(btn.getAttribute('data-index'), 10);
  if (isNaN(idx) || session.marks.has(idx)) return;

  btn.disabled = true;
  // optimistic UI update
  session.marks.add(idx);
  btn.classList.add('marked');
  btn.setAttribute('aria-pressed', 'true');
  renderStatus();

  try {
    const { error } = await supabase
      .from('marks')
      .insert({ player_id: session.playerId, position: idx });
    if (error && !isDuplicateMarkError(error)) throw error;
  } catch (err) {
    console.error(err);
    session.marks.delete(idx);
    btn.classList.remove('marked');
    btn.setAttribute('aria-pressed', 'false');
    btn.disabled = false;
    renderStatus();
    toast('Označení se nepodařilo. Zkus to znovu.');
    return;
  }

  if (checkBingo(idx)) {
    await tryClaimWin();
  }
}

function isDuplicateMarkError(err) {
  return err && (err.code === '23505' || /duplicate key/i.test(err.message || ''));
}

function checkBingo(lastIdx) {
  const n = session.size;
  const total = session.size * session.size;
  const isFreeCenter = (n === 3 || n === 5);
  const centerIdx = isFreeCenter ? Math.floor(total / 2) : -1;

  const isMarked = (i) => (i === centerIdx) || session.marks.has(i);

  const row = Math.floor(lastIdx / n);
  const col = lastIdx % n;

  let rowOk = true;
  for (let c = 0; c < n; c++) { if (!isMarked(row * n + c)) { rowOk = false; break; } }
  if (rowOk) return true;

  let colOk = true;
  for (let r = 0; r < n; r++) { if (!isMarked(r * n + col)) { colOk = false; break; } }
  if (colOk) return true;

  if (row === col) {
    let d1Ok = true;
    for (let i = 0; i < n; i++) { if (!isMarked(i * n + i)) { d1Ok = false; break; } }
    if (d1Ok) return true;
  }
  if (row + col === n - 1) {
    let d2Ok = true;
    for (let i = 0; i < n; i++) { if (!isMarked(i * n + (n - 1 - i))) { d2Ok = false; break; } }
    if (d2Ok) return true;
  }
  return false;
}

async function tryClaimWin() {
  try {
    const { data, error } = await supabase.rpc('claim_win', {
      p_game_id: session.gameId,
      p_player_id: session.playerId
    });
    if (error) throw error;
    if (data === true) {
      session.ended = true;
      session.winnerName = session.nickname;
      renderCard();
      renderStatus();
      announceWinner(session.nickname, true);
    } else {
      // someone else claimed first — realtime event will deliver their name
      session.ended = true;
      renderCard();
      renderStatus();
    }
  } catch (e) {
    console.error(e);
    toast('Bingo detekováno, ale nahlášení selhalo. Zkus to ještě.');
  }
}

// ---------- Celebration ----------

function announceWinner(name, isSelf) {
  const overlay = el('celebration');
  const textEl = el('celebration-text');
  const confetti = el('confetti');
  confetti.innerHTML = '';

  textEl.textContent = isSelf ? 'BINGO!' : `🎉 ${name} WON 🎉`;

  if (!reducedMotion && isSelf) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece ' + SHAPES[i % SHAPES.length];
      piece.style.left = (Math.random() * 100) + '%';
      piece.style.background = PALETTE[i % PALETTE.length];
      piece.style.animationDelay = (Math.random() * 0.6).toFixed(2) + 's';
      piece.style.animationDuration = (1.8 + Math.random() * 1.6).toFixed(2) + 's';
      piece.style.setProperty('--rotate', Math.floor(Math.random() * 1080 - 540) + 'deg');
      const scale = 0.6 + Math.random() * 1.1;
      piece.style.transform = 'scale(' + scale.toFixed(2) + ')';
      frag.appendChild(piece);
    }
    confetti.appendChild(frag);
  }

  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
}

// ---------- Nickname prompt ----------

function promptNickname() {
  return new Promise((resolve) => {
    const dlg = el('nickname-dialog');
    const form = el('nickname-form');
    const input = el('nickname-input');
    input.value = '';
    dlg.classList.remove('hidden');
    setTimeout(() => input.focus(), 30);
    const onSubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      cleanup();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { cleanup(); resolve(null); }
    };
    const cleanup = () => {
      form.removeEventListener('submit', onSubmit);
      document.removeEventListener('keydown', onKey);
      dlg.classList.add('hidden');
    };
    form.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', onKey);
  });
}

// ---------- Helpers ----------

function showLoading(text) {
  el('loading-text').textContent = text || 'Načítám…';
  showView('loading');
}

function showError(text) {
  el('error-text').textContent = text;
  showView('error');
}

let toastTimer = null;
function toast(text) {
  const t = el('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), TOAST_MS);
}

// ---------- Keyboard navigation ----------

document.addEventListener('keydown', (e) => {
  if (!session) return;
  const grid = el('grid');
  const active = document.activeElement;
  if (!grid.contains(active)) return;
  const cells = grid.querySelectorAll('.cell');
  let idx = -1;
  for (let i = 0; i < cells.length; i++) if (cells[i] === active) { idx = i; break; }
  if (idx < 0) return;
  const n = session.size;
  let next = idx;
  if (e.key === 'ArrowRight') next = idx + 1;
  else if (e.key === 'ArrowLeft') next = idx - 1;
  else if (e.key === 'ArrowDown') next = idx + n;
  else if (e.key === 'ArrowUp') next = idx - n;
  else return;
  e.preventDefault();
  if (next >= 0 && next < cells.length) cells[next].focus();
});

// ---------- Resize ----------

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!session) return;
    for (const span of document.querySelectorAll('.cell-text')) fitText(span);
  }, 120);
});

// ---------- Boot ----------

handleRoute();
