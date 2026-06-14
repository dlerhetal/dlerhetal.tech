/* Proctor — AWS AI Practitioner (AIF-C01) prep app. Vanilla JS, no build step. */
(() => {
  'use strict';

  // ---- Static reference data ------------------------------------------------
  const EXAM_DATE = '2026-07-11';
  const REGISTER_BY = '2026-06-17';
  const PASS_SCALED = 700;

  const DOMAINS = {
    1: { name: 'Fundamentals of AI & ML', weight: 20 },
    2: { name: 'Fundamentals of GenAI', weight: 24 },
    3: { name: 'Applications of Foundation Models', weight: 28 },
    4: { name: 'Guidelines for Responsible AI', weight: 14 },
    5: { name: 'Security, Compliance & Governance', weight: 14 }
  };
  const TASKS = {
    '1.1': 'Basic AI concepts & terminology', '1.2': 'Practical use cases for AI', '1.3': 'AI/ML development lifecycle',
    '2.1': 'Basic concepts of GenAI', '2.2': 'Capabilities & limitations of GenAI', '2.3': 'AWS infrastructure for GenAI',
    '3.1': 'FM application design', '3.2': 'Prompt engineering', '3.3': 'Training & fine-tuning FMs', '3.4': 'Evaluating FM performance',
    '4.1': 'Developing responsible AI', '4.2': 'Transparent & explainable models',
    '5.1': 'Securing AI systems', '5.2': 'Governance & compliance'
  };
  const EXAM_SIZE = 65;

  // ---- App state ------------------------------------------------------------
  let QUESTIONS = [];
  let AUDIO = [];
  let state = null;

  const todayKey = () => new Date().toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.ceil((new Date(b) - new Date(a)) / 86400000);

  function freshState() {
    return { version: 1, xp: 0, streak: 0, lastActive: null, perQ: {}, examHistory: [] };
  }

  async function boot() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    try {
      const [q, a] = await Promise.all([
        fetch('./data/questions.json').then((r) => r.json()),
        fetch('./data/audio.json').then((r) => r.json()).catch(() => ({ tracks: [] }))
      ]);
      QUESTIONS = (q.questions || []).filter((x) => x && x.options && x.correct);
      AUDIO = a.tracks || [];
    } catch (e) {
      document.getElementById('view').innerHTML =
        '<div class="card center">Could not load the question bank. If you are offline, open the app once with a connection first.</div>';
      return;
    }
    state = (await Storage.load()) || freshState();
    updateStreak();
    await save();
    setupNav();
    setupInstall();
    show('dashboard');
  }

  // ---- Persistence & gamification ------------------------------------------
  async function save() { await Storage.save(state); paintHeader(); }
  function paintHeader() {
    document.getElementById('hx-xp').textContent = state.xp;
    document.getElementById('hx-streak').textContent = state.streak;
  }
  function updateStreak() {
    const t = todayKey();
    if (state.lastActive === t) return;
    if (!state.lastActive) { state.streak = 1; }
    else {
      const gap = daysBetween(state.lastActive, t);
      state.streak = gap === 1 ? state.streak + 1 : 1;
    }
    state.lastActive = t;
  }
  function addXP(n) { state.xp += n; }

  // ---- Spaced repetition (Leitner) -----------------------------------------
  function rec(id) {
    if (!state.perQ[id]) state.perQ[id] = { box: 1, seen: 0, correct: 0, last: null, ts: 0 };
    return state.perQ[id];
  }
  function recordResult(id, ok) {
    const r = rec(id);
    r.seen++; if (ok) r.correct++;
    r.box = ok ? Math.min(5, r.box + 1) : 1;
    r.last = ok; r.ts = Date.now();
  }
  // weak = low box first, unseen treated as mid priority, recent-wrong boosted
  function weakness(q) {
    const r = state.perQ[q.id];
    if (!r) return 3.0;                 // unseen
    let w = 6 - r.box;                  // box1->5 ... box5->1
    if (r.last === false) w += 2;
    return w;
  }

  // ---- Stats ---------------------------------------------------------------
  function domainQs(d) { return QUESTIONS.filter((q) => q.domain === d); }
  function taskQs(t) { return QUESTIONS.filter((q) => q.task === t); }
  function masteryOf(list) {
    if (!list.length) return 0;
    let m = 0;
    list.forEach((q) => { const r = state.perQ[q.id]; if (r && r.box >= 4) m++; });
    return Math.round((m / list.length) * 100);
  }
  function attemptedOf(list) {
    return list.filter((q) => state.perQ[q.id] && state.perQ[q.id].seen > 0).length;
  }
  function bossState(d) {
    const list = domainQs(d);
    const m = masteryOf(list);
    if (m >= 80) return 'beaten';
    if (attemptedOf(list) > 0) return 'open';
    return 'open';
  }
  function gauntletUnlocked() {
    return [1, 2, 3, 4, 5].every((d) => masteryOf(domainQs(d)) >= 60);
  }

  // ---- Sampling ------------------------------------------------------------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function pickWeak(n, pool) {
    const src = (pool || QUESTIONS).slice();
    return shuffle(src).sort((a, b) => weakness(b) - weakness(a)).slice(0, n);
  }
  function pickExam(n) {
    const out = [];
    for (const d of [1, 2, 3, 4, 5]) {
      const want = Math.max(1, Math.round((DOMAINS[d].weight / 100) * n));
      out.push(...shuffle(domainQs(d)).slice(0, want));
    }
    return shuffle(out).slice(0, Math.min(n, out.length));
  }

  // ---- View routing --------------------------------------------------------
  const view = () => document.getElementById('view');
  function setupNav() {
    document.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => show(t.dataset.view)));
  }
  function show(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
    window.scrollTo(0, 0);
    ({ dashboard: renderDashboard, drill: renderDrillMenu, exam: renderExamMenu, tracker: renderTracker, audio: renderAudio }[name] || renderDashboard)();
  }

  // ---- Dashboard -----------------------------------------------------------
  function renderDashboard() {
    const dToExam = daysBetween(todayKey(), EXAM_DATE);
    const dToReg = daysBetween(todayKey(), REGISTER_BY);
    const overall = masteryOf(QUESTIONS);
    const regDone = false; // wires to a future "registered" flag / backend

    let domains = '';
    for (const d of [1, 2, 3, 4, 5]) {
      const list = domainQs(d), pct = masteryOf(list), bs = bossState(d);
      const bossLbl = bs === 'beaten' ? '★ Boss down' : '◦ Boss';
      domains += `
        <div class="card domain" data-drill-domain="${d}" role="button" tabindex="0">
          <div class="ring" style="--p:${pct}"><b>${pct}%</b></div>
          <div class="meta">
            <div class="name">Domain ${d} · ${DOMAINS[d].name}</div>
            <div class="sub">${DOMAINS[d].weight}% of exam · ${attemptedOf(list)}/${list.length} seen</div>
            <div class="bar"><i style="width:${pct}%"></i></div>
          </div>
          <span class="boss ${bs}">${bossLbl}</span>
        </div>`;
    }

    view().innerHTML = `
      <div class="hero">
        <div class="card">
          <div class="big ${dToReg <= 3 ? 'warn' : ''}">${dToReg <= 0 ? '⚠' : dToReg}</div>
          <div class="lbl">${dToReg <= 0 ? 'Register NOW' : 'days to register'}</div>
        </div>
        <div class="card">
          <div class="big">${dToExam}</div>
          <div class="lbl">days to exam</div>
        </div>
      </div>

      ${dToReg > 0 ? `<div class="card mt" style="border-color:var(--accent)">
        <strong>Hard gate:</strong> register &amp; pay at Pearson VUE by <strong>${REGISTER_BY}</strong>.
        Money down is the whole point — until the slot is booked, this sprint is fiction.
      </div>` : ''}

      <div class="card mt ring-wrap">
        <div class="ring" style="--p:${overall};--size:72px"><b>${overall}%</b></div>
        <div>
          <div style="font-weight:800;font-size:16px">Overall mastery</div>
          <div class="muted" style="font-size:13px">${state.xp} XP · ${state.streak}-day streak · pass bar is 700/1000</div>
          <div class="muted" style="font-size:12px;margin-top:4px">${gauntletUnlocked() ? '🏆 Boss Gauntlet unlocked (Exam tab)' : 'Hit 60% in every domain to unlock the Boss Gauntlet'}</div>
        </div>
      </div>

      <button class="btn btn-primary mt" id="quick">⚔ Quick Drill — 10 questions</button>

      <div class="section-title">Domains</div>
      ${domains}
    `;

    document.getElementById('quick').onclick = () => startQuiz(pickWeak(10), { title: 'Quick Drill' });
    view().querySelectorAll('[data-drill-domain]').forEach((el) => {
      const go = () => { const d = +el.dataset.drillDomain; startQuiz(shuffle(domainQs(d)).slice(0, 12), { title: `Domain ${d}` }); };
      el.onclick = go;
      el.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    });
  }

  // ---- Drill menu ----------------------------------------------------------
  function renderDrillMenu() {
    let domainBtns = '';
    for (const d of [1, 2, 3, 4, 5]) {
      domainBtns += `<button class="btn" data-d="${d}">D${d} · ${DOMAINS[d].name} <small>(${masteryOf(domainQs(d))}%)</small></button>`;
    }
    view().innerHTML = `
      <h2>Drill</h2>
      <p class="muted">Spaced repetition: questions you miss come back sooner. Answers reveal instantly with explanations.</p>
      <button class="btn btn-primary" id="m-quick">⚔ Quick Drill (10, mixed)</button>
      <div class="btn-grid mt">
        <button class="btn" id="m-weak">🎯 Weak Areas (15)</button>
        <button class="btn" id="m-all">🔀 Random (20)</button>
      </div>
      <div class="section-title">By domain</div>
      ${domainBtns}
    `;
    document.getElementById('m-quick').onclick = () => startQuiz(pickWeak(10), { title: 'Quick Drill' });
    document.getElementById('m-weak').onclick = () => startQuiz(pickWeak(15), { title: 'Weak Areas' });
    document.getElementById('m-all').onclick = () => startQuiz(shuffle(QUESTIONS).slice(0, 20), { title: 'Random Mix' });
    view().querySelectorAll('[data-d]').forEach((b) =>
      b.onclick = () => { const d = +b.dataset.d; startQuiz(shuffle(domainQs(d)).slice(0, 12), { title: `Domain ${d}` }); });
  }

  // ---- Quiz engine ---------------------------------------------------------
  function startQuiz(questions, opts) {
    opts = opts || {};
    if (!questions.length) { toast('No questions available yet.'); return; }
    const session = { qs: questions, i: 0, correct: 0, sel: [], graded: false, isExam: !!opts.isExam, title: opts.title || 'Drill', byDomain: {}, deadline: null };
    if (opts.isExam) { session.deadline = Date.now() + 90 * 60000; tickTimer(session); }
    renderQuestion(session);
  }

  function renderQuestion(s) {
    const q = s.qs[s.i];
    const isMulti = q.type === 'multi' || (q.correct && q.correct.length > 1);
    s.sel = []; s.graded = false;
    const keys = ['A', 'B', 'C', 'D', 'E', 'F'];
    const opts = q.options.map((o, idx) =>
      `<button class="opt" data-i="${idx}"><span class="key">${keys[idx]}</span><span>${escapeHtml(o)}</span></button>`).join('');

    view().innerHTML = `
      ${s.isExam ? `<div class="exam-bar"><span>Q ${s.i + 1}/${s.qs.length}</span><span class="timer" id="timer">90:00</span></div>`
                 : `<div class="q-meta"><span class="pill">${s.title}</span><span>${s.i + 1} / ${s.qs.length}</span></div>`}
      <div class="q-meta"><span>Domain ${q.domain} · Task ${q.task}</span><span>${isMulti ? 'Select ' + q.correct.length : 'Single answer'}</span></div>
      <div class="q-stem">${escapeHtml(q.stem)}</div>
      <div id="opts">${opts}</div>
      <div id="post"></div>
      <button class="btn btn-primary mt" id="action">${s.isExam ? 'Next' : 'Check answer'}</button>
    `;
    if (s.isExam) paintTimer(s);

    const optEls = view().querySelectorAll('.opt');
    optEls.forEach((el) => el.onclick = () => {
      if (s.graded) return;
      const idx = +el.dataset.i;
      if (isMulti) {
        const at = s.sel.indexOf(idx);
        if (at >= 0) s.sel.splice(at, 1); else s.sel.push(idx);
        el.classList.toggle('sel');
      } else {
        s.sel = [idx];
        optEls.forEach((o) => o.classList.remove('sel'));
        el.classList.add('sel');
      }
    });

    document.getElementById('action').onclick = () => {
      if (s.isExam) { commitExamAnswer(s); return; }
      if (!s.graded) gradeAndReveal(s, isMulti, optEls);
      else nextQuestion(s);
    };
  }

  function arraysEqualSet(a, b) {
    if (a.length !== b.length) return false;
    const sa = a.slice().sort(), sb = b.slice().sort();
    return sa.every((v, i) => v === sb[i]);
  }

  function gradeAndReveal(s, isMulti, optEls) {
    if (!s.sel.length) { toast('Pick an answer first.'); return; }
    const q = s.qs[s.i];
    const ok = arraysEqualSet(s.sel, q.correct);
    s.graded = true; if (ok) s.correct++;
    recordResult(q.id, ok);
    addXP(ok ? (isMulti ? 15 : 10) : 2);

    optEls.forEach((el) => {
      const idx = +el.dataset.i;
      el.setAttribute('disabled', '');
      if (q.correct.includes(idx)) el.classList.add('correct');
      else if (s.sel.includes(idx)) el.classList.add('wrong');
    });
    document.getElementById('post').innerHTML = `
      <div class="explain">
        <div class="verdict ${ok ? 'ok' : 'bad'}">${ok ? '✓ Correct (+' + (isMulti ? 15 : 10) + ' XP)' : '✗ Not quite (+2 XP for the rep)'}</div>
        <div>${escapeHtml(q.explanation || '')}</div>
        ${q.anchor ? `<div class="anchor">↳ ${escapeHtml(q.anchor)}</div>` : ''}
      </div>`;
    document.getElementById('action').textContent = (s.i + 1 < s.qs.length) ? 'Next question' : 'See results';
    save();
  }

  function nextQuestion(s) {
    s.i++;
    if (s.i < s.qs.length) renderQuestion(s);
    else finishDrill(s);
  }

  function finishDrill(s) {
    const pct = Math.round((s.correct / s.qs.length) * 100);
    view().innerHTML = `
      <div class="card center">
        <div class="big-score ${pct >= 80 ? 'pass' : ''}">${pct}%</div>
        <p>${s.correct} / ${s.qs.length} correct · ${s.title}</p>
        <p class="muted">${pct >= 80 ? 'Sharp. That domain is bending.' : 'Keep grinding — misses are queued to come back.'}</p>
        <button class="btn btn-primary mt" id="again">Another set</button>
        <button class="btn btn-ghost mt" id="home">Back to Home</button>
      </div>`;
    document.getElementById('again').onclick = () => startQuiz(pickWeak(10), { title: 'Quick Drill' });
    document.getElementById('home').onclick = () => show('dashboard');
  }

  // ---- Exam simulator ------------------------------------------------------
  function renderExamMenu() {
    const hist = state.examHistory.slice(-5).reverse();
    const histHtml = hist.length ? hist.map((h) =>
      `<div class="q-meta"><span>${h.date}</span><span class="${h.passed ? 'pass' : 'fail'}">${h.score}/1000 ${h.passed ? '· PASS' : '· fail'}</span></div>`).join('') : '<p class="muted">No attempts yet.</p>';
    const unlocked = gauntletUnlocked();
    view().innerHTML = `
      <h2>Exam Simulator</h2>
      <p class="muted">${EXAM_SIZE} questions · 90-minute timer · scaled 100–1000 · pass = ${PASS_SCALED}. Mirrors the real AIF-C01 weighting.</p>
      <button class="btn btn-primary" id="start-exam">⏱ Start full mock exam</button>
      <div class="card mt">
        <div style="font-weight:700">🏆 Boss Gauntlet ${unlocked ? '' : '<span class="badge-soon">locked</span>'}</div>
        <p class="muted" style="font-size:13px;margin:6px 0 0">${unlocked ? 'All domains ≥60%. Same as the mock, but a passing run banks the trophy.' : 'Unlocks when every domain hits 60% mastery.'}</p>
      </div>
      <div class="section-title">Recent attempts</div>
      <div class="card">${histHtml}</div>
    `;
    document.getElementById('start-exam').onclick = () => {
      if (confirm('Start a timed 90-minute mock exam? No answer reveals until you finish.')) {
        startQuiz(pickExam(EXAM_SIZE), { title: 'Mock Exam', isExam: true });
      }
    };
  }

  function commitExamAnswer(s) {
    const q = s.qs[s.i];
    const ok = arraysEqualSet(s.sel, q.correct);
    if (ok) s.correct++;
    s.byDomain[q.domain] = s.byDomain[q.domain] || { c: 0, n: 0 };
    s.byDomain[q.domain].n++; if (ok) s.byDomain[q.domain].c++;
    recordResult(q.id, ok);
    s.i++;
    if (s.i < s.qs.length && Date.now() < s.deadline) renderQuestion(s);
    else finishExam(s);
  }

  function tickTimer(s) {
    s._timer = setInterval(() => {
      if (!document.getElementById('timer')) return;
      if (Date.now() >= s.deadline) { clearInterval(s._timer); finishExam(s); return; }
      paintTimer(s);
    }, 1000);
  }
  function paintTimer(s) {
    const el = document.getElementById('timer'); if (!el) return;
    const left = Math.max(0, s.deadline - Date.now());
    const m = Math.floor(left / 60000), sec = Math.floor((left % 60000) / 1000);
    el.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    el.classList.toggle('danger', left < 5 * 60000);
  }

  function finishExam(s) {
    if (s._timer) clearInterval(s._timer);
    const ratio = s.correct / s.qs.length;
    const scaled = Math.round(100 + ratio * 900);
    const passed = scaled >= PASS_SCALED;
    state.examHistory.push({ date: todayKey(), score: scaled, passed, correct: s.correct, total: s.qs.length });
    addXP(passed ? 100 : 40);
    save();

    let breakdown = '';
    for (const d of [1, 2, 3, 4, 5]) {
      const b = s.byDomain[d]; if (!b) continue;
      const p = Math.round((b.c / b.n) * 100);
      breakdown += `<div class="q-meta"><span>D${d} · ${DOMAINS[d].name}</span><span class="${p >= 70 ? 'pass' : 'fail'}">${b.c}/${b.n} (${p}%)</span></div>`;
    }
    view().innerHTML = `
      <div class="card center">
        <div class="big-score ${passed ? 'pass' : 'fail'}">${scaled}</div>
        <p class="${passed ? 'pass' : 'fail'}" style="font-weight:800">${passed ? 'PASS' : 'BELOW 700'}</p>
        <p class="muted">${s.correct} / ${s.qs.length} correct (${Math.round(ratio * 100)}%)</p>
      </div>
      <div class="card mt"><div class="section-title" style="margin-top:0">By domain</div>${breakdown}</div>
      <button class="btn btn-primary mt" id="again">Back to Exam menu</button>
    `;
    document.getElementById('again').onclick = () => show('exam');
  }

  // ---- Tracker -------------------------------------------------------------
  function renderTracker() {
    let body = '';
    for (const d of [1, 2, 3, 4, 5]) {
      body += `<div class="section-title">Domain ${d} · ${DOMAINS[d].name} <span class="muted">(${DOMAINS[d].weight}%)</span></div>`;
      Object.keys(TASKS).filter((t) => t.startsWith(d + '.')).forEach((t) => {
        const list = taskQs(t), m = masteryOf(list), done = m >= 80;
        body += `
          <div class="task ${done ? 'done' : ''}">
            <div class="t-name">${done ? '✓ ' : ''}Task ${t} — ${TASKS[t]}</div>
            <div class="t-stat">${list.length ? `${attemptedOf(list)}/${list.length} seen · ${m}% mastered` : 'no questions yet'}</div>
          </div>`;
      });
    }
    view().innerHTML = `<h2>Blueprint Tracker</h2>
      <p class="muted">Every official AIF-C01 task statement. A task flips to ✓ at 80% mastery (answered correctly enough times to stick).</p>${body}`;
  }

  // ---- Audio ---------------------------------------------------------------
  function renderAudio() {
    const items = AUDIO.map((t) => {
      const ready = t.released && t.src;
      return `<div class="card">
        <div class="track">
          <div class="pi">${t.kind === 'song' ? '♫' : '🎙'}</div>
          <div class="ti"><div class="tt">${escapeHtml(t.title)}</div><div class="td">${escapeHtml(t.desc)}</div></div>
          ${ready ? '' : '<span class="badge-soon">drops soon</span>'}
        </div>
        ${ready ? `<audio controls preload="none" src="${t.src}"></audio>` : ''}
      </div>`;
    }).join('');
    view().innerHTML = `<h2>Audio</h2>
      <p class="muted">Podcast per domain + the anthem. Play once online and it caches for offline (plane-proof).</p>
      ${items || '<div class="card muted">No tracks yet.</div>'}`;
  }

  // ---- Install prompt ------------------------------------------------------
  let deferredPrompt = null;
  function setupInstall() {
    const banner = document.getElementById('install-banner');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferredPrompt = e;
      if (localStorage.getItem('proctor.install.dismissed') !== '1') banner.hidden = false;
    });
    document.getElementById('install-btn').onclick = async () => {
      banner.hidden = true;
      if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
    };
    document.getElementById('install-dismiss').onclick = () => {
      banner.hidden = true; localStorage.setItem('proctor.install.dismissed', '1');
    };
  }

  // ---- Utils ---------------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
