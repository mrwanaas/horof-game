// ============================================================
// SHARED GAME LOGIC
// ============================================================

const ARABIC_LETTERS = ['أ','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','هـ','و','ي'];

const LETTER_TO_KEY = {
  'أ':'alef','ب':'ba','ت':'ta','ث':'tha','ج':'jeem','ح':'ha','خ':'kha','د':'dal',
  'ذ':'dhal','ر':'ra','ز':'zay','س':'seen','ش':'sheen','ص':'sad','ض':'dad',
  'ط':'taa','ظ':'dha','ع':'ayn','غ':'ghayn','ف':'fa','ق':'qaf','ك':'kaf',
  'ل':'lam','م':'meem','ن':'noon','هـ':'haa','و':'waw','ي':'ya'
};

function letterKey(l) { return LETTER_TO_KEY[l] || l; }

// ============================================================
// FIREBASE INIT
// ============================================================
let _db = null;
let _fb = null;

function initFirebase() {
  try {
    const app = window._firebaseApp.initializeApp(FIREBASE_CONFIG);
    _db = window._firebaseDB.getDatabase(app);
    _fb = window._firebaseDB;
    // Ensure runTransaction is available
    if (!_fb.runTransaction) {
      console.warn('runTransaction not available, using fallback');
    }
    console.log('✅ Firebase initialized');
    return true;
  } catch(e) {
    console.error('Firebase init error:', e);
    return false;
  }
}

function dbRef(path) { return _fb.ref(_db, path); }
function roomPath(code) { return `rooms/${code}`; }

// ============================================================
// ROOM OPERATIONS
// ============================================================
async function createRoom(code, judgeName) {
  const letters = {};
  ARABIC_LETTERS.forEach(l => { letters[letterKey(l)] = { letter: l, owner: null }; });

  const state = {
    code,
    status: 'lobby',
    judge: judgeName,
    teams: { red: { score: 0, players: {} }, blue: { score: 0, players: {} } },
    letters,
    question: null,
    round: {
      // phase: idle | active | buzzed | answered | passed
      // active   = timer running, both teams can buzz
      // buzzed   = someone buzzed, waiting for their answer
      // answered = answer submitted, judge decides
      // passed   = first team failed, second team now active
      phase: 'idle',
      timerEnd: null,
      buzzedBy: null,
      buzzedTeam: null,
      playerAnswer: null,
      passedFrom: null   // which team already had their chance
    },
    createdAt: Date.now()
  };

  await _fb.set(dbRef(roomPath(code)), state);
  return state;
}

async function roomExists(code) {
  const snap = await _fb.get(dbRef(roomPath(code)));
  return snap.exists();
}

async function getRoom(code) {
  const snap = await _fb.get(dbRef(roomPath(code)));
  return snap.exists() ? snap.val() : null;
}

function watchRoom(code, cb) {
  return _fb.onValue(dbRef(roomPath(code)), snap => {
    if (snap.exists()) cb(snap.val());
  });
}

async function dbUpdate(path, data) { await _fb.update(dbRef(path), data); }
async function dbSet(path, data) { await _fb.set(dbRef(path), data); }

// Player joins a team
async function joinTeam(code, team, name, pid) {
  await dbSet(`${roomPath(code)}/teams/${team}/players/${pid}`, { name, online: true, joinedAt: Date.now() });
}

// Judge sets a question — stored as pending, NOT shown to players yet
async function setQuestion(code, q) {
  await dbSet(`${roomPath(code)}/pendingQuestion`, q);
  await dbSet(`${roomPath(code)}/question`, null);  // clear visible question
  await dbSet(`${roomPath(code)}/round`, {
    phase: 'idle',
    timerEnd: null,
    buzzedBy: null,
    buzzedTeam: null,
    playerAnswer: null,
    passedFrom: null
  });
}

// Judge starts the round — reveals question to players NOW, both teams can buzz
async function startRound(code) {
  // Move pendingQuestion -> question (now visible to players)
  const snap = await _fb.get(dbRef(`${roomPath(code)}/pendingQuestion`));
  const pending = snap.val();
  if (pending) {
    await dbSet(`${roomPath(code)}/question`, pending);
    await dbSet(`${roomPath(code)}/pendingQuestion`, null);
  }
  const timerEnd = Date.now() + 15000;
  await dbSet(`${roomPath(code)}/round`, {
    phase: 'active',
    timerEnd,
    buzzedBy: null,
    buzzedTeam: null,
    playerAnswer: null,
    passedFrom: null
  });
}

// After first team fails — pass to the other team automatically
async function passToOtherTeam(code, failedTeam) {
  const timerEnd = Date.now() + 10000; // 10 seconds for second team
  await dbSet(`${roomPath(code)}/round`, {
    phase: 'passed',
    timerEnd,
    buzzedBy: null,
    buzzedTeam: null,
    playerAnswer: null,
    passedFrom: failedTeam
  });
}

// Player buzzes in — atomic check: only first buzz wins
async function buzzIn(code, playerName, team) {
  // Use Firebase transaction for atomic buzz — only first player wins, no race condition
  const roundRef = dbRef(`${roomPath(code)}/round`);
  let didWin = false;

  await _fb.runTransaction(roundRef, (round) => {
    if (!round) return round; // abort
    // Must be active or passed phase
    if (round.phase !== 'active' && round.phase !== 'passed') return; // abort
    // Someone already buzzed
    if (round.buzzedBy) return; // abort
    // In passed phase, the team that already failed cannot buzz again
    if (round.phase === 'passed' && round.passedFrom === team) return; // abort

    // We win — mark as buzzed atomically
    didWin = true;
    return {
      ...round,
      phase: 'buzzed',
      buzzedBy: playerName,
      buzzedTeam: team,
      timerEnd: null
    };
  });

  return didWin;
}

// Player submits their answer
async function submitAnswer(code, answer) {
  await dbUpdate(`${roomPath(code)}/round`, { phase: 'answered', playerAnswer: answer });
}

// Judge marks answer correct
async function markCorrect(code, letter, team) {
  const key = letterKey(letter);
  await dbSet(`${roomPath(code)}/letters/${key}`, { letter, owner: team });
  // Recount score
  const snap = await _fb.get(dbRef(`${roomPath(code)}/letters`));
  const letters = snap.val() || {};
  const score = Object.values(letters).filter(l => l.owner === team).length;
  await dbSet(`${roomPath(code)}/teams/${team}/score`, score);
  await clearRound(code);
}

// Judge marks wrong: if first team failed → pass to other; if second team also failed → skip
async function markWrong(code) {
  const snap = await _fb.get(dbRef(`${roomPath(code)}/round`));
  const round = snap.val();
  if (!round) return;

  const failedTeam = round.buzzedTeam;
  const alreadyPassed = round.passedFrom; // was this already a passed round?

  if (alreadyPassed) {
    // Both teams failed — skip question
    await clearRound(code);
  } else {
    // First team failed — pass to the other team
    await passToOtherTeam(code, failedTeam);
  }
}

// Time ran out during active/passed phase — same logic as wrong answer
async function timeExpired(code) {
  const snap = await _fb.get(dbRef(`${roomPath(code)}/round`));
  const round = snap.val();
  if (!round) return;
  if (round.phase !== 'active' && round.phase !== 'passed') return;

  const alreadyPassed = round.passedFrom;
  if (alreadyPassed) {
    await clearRound(code);
  } else {
    // No one buzzed in time — pass to other team (passedFrom = nobody, so use a placeholder)
    await passToOtherTeam(code, round.phase === 'passed' ? round.passedFrom : '_timeout_');
  }
}

// Clear round - reset everything
async function clearRound(code) {
  await dbSet(`${roomPath(code)}/question`, null);
  await dbSet(`${roomPath(code)}/pendingQuestion`, null);
  await dbSet(`${roomPath(code)}/round`, {
    phase: 'idle', timerEnd: null,
    buzzedBy: null, buzzedTeam: null, playerAnswer: null, passedFrom: null
  });
}

async function endGame(code) {
  await _fb.update(dbRef(roomPath(code)), { status: 'ended' });
  await clearRound(code);
}

// ============================================================
// SOUND
// ============================================================
let _actx = null;
function actx() {
  if (!_actx) try { _actx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  return _actx;
}
function beep(freq, dur, type='sine', vol=0.3) {
  try {
    const c = actx(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.frequency.value = freq; o.type = type;
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.start(); o.stop(c.currentTime + dur);
  } catch(e){}
}
function soundBuzz()    { beep(180,0.25,'sawtooth',0.4); setTimeout(()=>beep(140,0.3,'sawtooth',0.3),100); }
function soundTick()    { beep(900,0.04,'square',0.15); }
function soundCorrect() { [523,659,784,1047].forEach((f,i)=>setTimeout(()=>beep(f,0.18),i*130)); }
function soundWrong()   { beep(150,0.5,'sawtooth',0.3); }
function soundStart()   { beep(440,0.1); setTimeout(()=>beep(660,0.15),120); }
function soundPass()    { beep(330,0.2,'triangle'); }

// ============================================================
// TOAST
// ============================================================
function toast(msg, type='info', dur=3000) {
  let c = document.getElementById('toasts');
  if (!c) { c = document.createElement('div'); c.id='toasts'; document.body.appendChild(c); }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),300); }, dur);
}

// ============================================================
// LETTERS GRID
// ============================================================
function renderLetters(containerId, lettersData, highlightLetter) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  ARABIC_LETTERS.forEach(letter => {
    const key = letterKey(letter);
    const data = lettersData?.[key];
    const owner = data?.owner || null;
    const div = document.createElement('div');
    div.className = 'lcell';
    if (owner === 'red')  div.classList.add('owned-red');
    if (owner === 'blue') div.classList.add('owned-blue');
    if (highlightLetter === letter) div.classList.add('highlighted');
    div.textContent = letter;
    el.appendChild(div);
  });
}

// ============================================================
// STORAGE / UTILS
// ============================================================
function lsGet(k)   { try { return JSON.parse(localStorage.getItem('hlw_'+k)); } catch(e){ return null; } }
function lsSet(k,v) { try { localStorage.setItem('hlw_'+k, JSON.stringify(v)); } catch(e){} }
function urlParam(n){ return new URLSearchParams(location.search).get(n); }
function makeUrl(page, params={}) {
  const u = new URL(page, location.href);
  Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  return u.toString();
}
function genId()   { return 'p_'+Date.now()+'_'+Math.random().toString(36).substr(2,6); }
function genCode() { return Math.floor(100000+Math.random()*900000).toString(); }
function isValidCode(c) { return /^\d{6}$/.test(c?.trim()); }
function timeLeft(end)  { return Math.max(0, Math.ceil((end - Date.now())/1000)); }
