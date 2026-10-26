/* FrontDesk mini game "Ресепшн: час пик": seat guests, check them out, send maids to clean, answer questions */
"use strict";
const G_BEST_KEY = "frontdesk_game_best";
const G_SHIFT = 150, G_MAIDS = 2, G_CLEAN = 7, G_DESK = 4;
const G_ROOMS = [
  { num: "101", type: "twin" }, { num: "102", type: "double" }, { num: "103", type: "twin" }, { num: "104", type: "double" },
  { num: "201", type: "twin" }, { num: "202", type: "double" }, { num: "203", type: "family" }, { num: "204", type: "suite" },
];
const G_PRICE = { twin: 40, double: 50, family: 70, suite: 120 };
const G_WEIGHT = { twin: 3, double: 3, family: 1.2, suite: 0.6 };
const G_FACES = { twin: ["🧑‍💼", "👩‍💻", "🧔", "👩‍🦰"], double: ["👫", "💑", "👭"], family: ["👨‍👩‍👧", "👨‍👩‍👦‍👦", "👩‍👧‍👦"], suite: ["🤵", "👸", "🕴️"] };
// First answer is the right one; options are shuffled when shown
const G_QUESTIONS = [
  ["У меня не открывает ключ-карта!", ["Перекодировать карту", "Посоветовать постучать посильнее", "Дать ключ от соседнего номера"]],
  ["Можно мне поздний выезд?", ["Проверить загрузку и предложить за доплату", "Сказать «никогда»", "Да, живите хоть до ночи бесплатно"]],
  ["Соседи за стеной очень шумят!", ["Извиниться и позвонить соседям", "Сказать: «это же отель»", "Выдать беруши и уйти на перерыв"]],
  ["Закажите такси в аэропорт", ["Уточнить время и вызвать такси", "Объяснить, где остановка автобуса", "Сказать, что это не ваша работа"]],
  ["Я забыл зарядку в номере после выезда", ["Проверить потерянные вещи", "Сказать, что всё уже выброшено", "Отправить гостя искать самому"]],
  ["Хочу другой номер, тут вид на стену", ["Предложить переселение, если есть свободные", "Сказать, что стена — это тоже вид", "Посоветовать закрыть шторы"]],
  ["Принесите ещё полотенец", ["Передать горничной", "Отдать своё полотенце", "Сказать, что полотенца закончились навсегда"]],
  ["У вас нет моей брони?!", ["Спокойно проверить бронь по фамилии и датам", "Сказать: «вас нет, до свидания»", "Повысить голос в ответ"]],
  ["Я потерял ключ-карту", ["Сделать новую, старую заблокировать", "Выдать мастер-ключ", "Отказать и предложить ночевать в лобби"]],
  ["Где тут можно вкусно поесть?", ["Порекомендовать пару мест рядом", "Сказать, что вы не местный", "Отправить в ближайший ларёк"]],
  ["В номере не работает кондиционер", ["Вызвать техника, при необходимости переселить", "Посоветовать открыть окно зимой", "Сказать, что так и задумано"]],
  ["Можно оставить багаж после выезда?", ["Да, в камере хранения", "Только в коридоре", "Нет, забирайте всё сразу"]],
];
const G_KIND_HINT = { in: "Нажми на свободный номер нужного типа", out: "", ask: "" };

let game = null, gSel = null, gLoopId = null, gLast = 0;
const gid = () => Math.random().toString(36).slice(2, 9);
const gPick = xs => xs[Math.floor(Math.random() * xs.length)];
const gBest = () => { try { return Number(localStorage.getItem(G_BEST_KEY)) || 0; } catch { return 0; } };
const gMMSS = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const gStars = n => "★".repeat(n) + "☆".repeat(5 - n);

function gNew() {
  return {
    t: 0, money: 0, stars: 5, served: 0, checkouts: 0, answers: 0, upgrades: 0, lost: 0, nextSpawn: 1.5,
    paused: false, over: false, question: null, msg: "Нажми на гостя, потом на номер",
    rooms: G_ROOMS.map(r => ({ ...r, state: "free", from: 0, until: 0, face: "" })),
    desk: [], waiting: [],
  };
}
const gProgress = g => Math.min(1, g.t / G_SHIFT);
const gPatience = g => 24 - 9 * gProgress(g);

function gSpawn(g) {
  const max = gPatience(g);
  if (Math.random() < 0.18) {
    const [q, answers] = gPick(G_QUESTIONS);
    g.desk.push({ id: gid(), kind: "ask", face: "🙋", q, answers, patience: max, max });
    return;
  }
  let r = Math.random() * Object.values(G_WEIGHT).reduce((a, b) => a + b, 0), type = "twin";
  for (const [k, w] of Object.entries(G_WEIGHT)) { if ((r -= w) <= 0) { type = k; break; } }
  g.desk.push({ id: gid(), kind: "in", type, face: gPick(G_FACES[type]), patience: max, max });
}

function gTick(dt) {
  const g = game;
  let changed = false;
  g.t += dt;
  for (const room of g.rooms) {
    if (room.state === "occupied" && !room.due && g.t >= room.until) {
      room.due = true;
      g.waiting.push({ id: gid(), kind: "out", room: room.num, face: "🧳", patience: gPatience(g) + 4, max: gPatience(g) + 4 });
      changed = true;
    }
    if (room.state === "cleaning" && g.t >= room.until) { room.state = "free"; changed = true; }
  }
  while (g.waiting.length && g.desk.length < G_DESK) { g.desk.push(g.waiting.shift()); changed = true; }
  for (const guest of [...g.desk]) {
    guest.patience -= dt;
    if (guest.patience > 0) continue;
    g.desk = g.desk.filter(x => x !== guest);
    if (gSel === guest.id) gSel = null;
    g.stars--; g.lost++;
    if (guest.kind === "out") { const room = g.rooms.find(r => r.num === guest.room); room.state = "dirty"; room.due = false; }
    g.msg = guest.kind === "out" ? `😠 Гость из ${guest.room} ушёл, не дождавшись выезда` : "😠 Гость ушёл недовольным — минус звезда";
    try { navigator.vibrate && navigator.vibrate(120); } catch {}
    changed = true;
  }
  if (g.t >= g.nextSpawn) {
    if (g.desk.length < G_DESK) { gSpawn(g); changed = true; }
    const p = gProgress(g);
    g.nextSpawn = g.t + (6 - 3.5 * p) + Math.random() * 1.5;
  }
  if (g.stars <= 0 || g.t >= G_SHIFT) gFinish(g);
  changed || g.over ? renderGame() : gUpdate();
}
function gFinish(g) {
  g.over = true; g.stars = Math.max(0, g.stars);
  g.best = gBest();
  g.record = g.stars > 0 && g.money > g.best;
  if (g.record) try { localStorage.setItem(G_BEST_KEY, String(g.money)); } catch {}
}

function gLoop() {
  const now = performance.now(), dt = Math.min(0.5, (now - gLast) / 1000);
  gLast = now;
  if (!game || game.over) return;
  const active = state.view === "game" && document.visibilityState === "visible" && !game.paused && !game.question;
  if (!active) {
    // Leaving the tab or locking the phone pauses the shift
    if (!game.paused && !game.question && (state.view !== "game" || document.visibilityState !== "visible")) game.paused = true;
    return;
  }
  gTick(dt);
}
function gEnsureLoop() { if (!gLoopId) { gLast = performance.now(); gLoopId = setInterval(gLoop, 200); } }

/* ---------- rendering ---------- */
function renderGame() {
  const root = $("#view-game");
  if (!root) return;
  if (!game) { root.innerHTML = gStartScreen(); return; }
  const g = game, free = G_MAIDS - g.rooms.filter(r => r.state === "cleaning").length, sel = g.desk.find(x => x.id === gSel);
  root.innerHTML = `<div class="g-wrap">
    <div class="g-top"><span id="gTime">⏱ ${gMMSS(G_SHIFT - g.t)}</span><span>💰 ${g.money}</span><span class="g-stars">${gStars(g.stars)}</span><button class="g-icon" data-g="pause" aria-label="Пауза">⏸</button></div>
    <div class="g-msg">${esc(sel && sel.kind === "in" ? `Гость хочет ${ROOM_TYPES[sel.type]} — выбери номер (Люкс подойдёт всем)` : g.msg)}</div>
    <div class="g-desk-label">Стойка ресепшена</div>
    <div class="g-desk">${Array.from({ length: G_DESK }, (_, i) => gGuest(g.desk[i])).join("")}</div>
    ${g.waiting.length ? `<div class="g-queue">В очереди на выезд: ${g.waiting.length}</div>` : ""}
    <div class="g-maids">🧹 Свободных горничных: ${"●".repeat(free)}${"○".repeat(G_MAIDS - free)}</div>
    <div class="g-rooms">${g.rooms.map(gRoom).join("")}</div>
    <div class="g-legend"><span>✓ свободен</span><span>🧺 грязный — нажми, чтобы убрать</span></div>
    ${g.question ? gQuestion(g.question) : ""}
    ${g.paused && !g.over ? `<div class="g-over"><div class="g-card"><h3>Пауза</h3><p class="muted">Время смены остановлено.</p><button class="btn" data-g="resume">Продолжить</button><button class="btn secondary" data-g="quit">Закончить смену</button></div></div>` : ""}
    ${g.over ? gOverScreen(g) : ""}
  </div>`;
}
function gGuest(x) {
  if (!x) return `<div class="g-guest empty"><span>—</span></div>`;
  const label = x.kind === "in" ? ROOM_TYPES[x.type] : x.kind === "out" ? `Выезд ${x.room}` : "Вопрос";
  const pct = Math.max(0, x.patience / x.max * 100);
  return `<button class="g-guest k-${x.kind} ${gSel === x.id ? "sel" : ""}" data-gg="${x.id}"><span class="g-face">${x.face}</span><b>${label}</b><i class="g-pat"><i id="gp-${x.id}" class="${pct < 30 ? "low" : ""}" style="width:${pct}%"></i></i></button>`;
}
function gRoom(r) {
  const g = game;
  let icon = "✓", bar = "";
  if (r.state === "occupied") { icon = r.due ? "🧳" : r.face; bar = `<i class="g-bar"><i id="gr-${r.num}" style="width:${Math.max(0, (r.until - g.t) / (r.until - r.from) * 100)}%"></i></i>`; }
  if (r.state === "dirty") icon = "🧺";
  if (r.state === "cleaning") { icon = "🧹"; bar = `<i class="g-bar clean"><i id="gr-${r.num}" style="width:${Math.min(100, (g.t - r.from) / G_CLEAN * 100)}%"></i></i>`; }
  const sel = game.desk.find(x => x.id === gSel), fits = sel && sel.kind === "in" && r.state === "free" && (r.type === sel.type || r.type === "suite");
  return `<button class="g-room st-${r.state} ${fits ? "fits" : ""}" data-gr="${r.num}"><b>${r.num}</b><small>${ROOM_TYPES[r.type]}</small><span class="g-ico">${icon}</span>${bar}</button>`;
}
function gQuestion(q) {
  return `<div class="g-over"><div class="g-card"><div class="g-face big">🙋</div><h3>«${esc(q.q)}»</h3>
    <div class="g-answers">${q.order.map(i => `<button class="btn secondary" data-ga="${i}">${esc(q.answers[i])}</button>`).join("")}</div></div></div>`;
}
function gStartScreen() {
  const best = gBest();
  return `<div class="g-start card">
    <div class="g-logo">🛎️</div><h2>Ресепшн: час пик</h2>
    <p class="muted">Смена — 2,5 минуты. В отеле 8 номеров и 2 горничные.</p>
    <ul class="g-rules">
      <li><b>Заселение.</b> Нажми на гостя, потом на свободный номер его типа: TWN, DBL, FAM или LUX. Люкс подходит всем: это апгрейд, гость доволен (+⭐).</li>
      <li><b>🧳 Выезд.</b> Нажми на гостя — получишь чаевые, номер станет грязным.</li>
      <li><b>🧺 Уборка.</b> Нажми на грязный номер — горничная уберёт его за 7 секунд.</li>
      <li><b>🙋 Вопрос.</b> Выбери правильный ответ гостю.</li>
      <li>Если гость ждёт слишком долго, он уходит и снимает звезду. 0 звёзд — смена провалена.</li>
    </ul>
    ${best ? `<p class="g-best">🏆 Рекорд: ${best} 💰</p>` : ""}
    <button class="btn wide" data-g="start">Начать смену</button>
  </div>`;
}
function gOverScreen(g) {
  const fail = g.stars <= 0;
  return `<div class="g-over"><div class="g-card">
    <div class="g-face big">${fail ? "😵" : g.record ? "🏆" : "🎉"}</div>
    <h3>${fail ? "Гости разбежались…" : g.record ? "Новый рекорд!" : "Смена окончена!"}</h3>
    <div class="g-results">
      <div><span>Заработано</span><b>${g.money} 💰</b></div>
      <div><span>Рейтинг</span><b class="g-stars">${gStars(g.stars)}</b></div>
      <div><span>Заселено</span><b>${g.served}</b></div>
      <div><span>Выездов</span><b>${g.checkouts}</b></div>
      <div><span>Апгрейдов</span><b>${g.upgrades}</b></div>
      <div><span>Ответов</span><b>${g.answers}</b></div>
    </div>
    ${fail ? `<p class="muted">При нуле звёзд рекорд не засчитывается.</p>` : !g.record && g.best ? `<p class="muted">Рекорд: ${g.best} 💰</p>` : ""}
    <button class="btn" data-g="start">Ещё смену</button>
  </div></div>`;
}
// Light per-tick update: bars and timer only, so taps are not lost to a full re-render
function gUpdate() {
  const g = game, time = $("#gTime");
  if (!time) return;
  time.textContent = `⏱ ${gMMSS(G_SHIFT - g.t)}`;
  for (const x of g.desk) { const el = document.getElementById("gp-" + x.id); if (el) { const p = Math.max(0, x.patience / x.max * 100); el.style.width = p + "%"; el.classList.toggle("low", p < 30); } }
  for (const r of g.rooms) {
    const el = document.getElementById("gr-" + r.num);
    if (!el) continue;
    el.style.width = (r.state === "cleaning" ? Math.min(100, (g.t - r.from) / G_CLEAN * 100) : Math.max(0, (r.until - g.t) / (r.until - r.from) * 100)) + "%";
  }
}

/* ---------- actions ---------- */
function gRemoveGuest(g, x) { g.desk = g.desk.filter(y => y !== x); if (gSel === x.id) gSel = null; }
function gTapGuest(id) {
  const g = game, x = g.desk.find(y => y.id === id);
  if (!x || g.over) return;
  if (x.kind === "out") {
    const room = g.rooms.find(r => r.num === x.room), tip = 5 + Math.floor(Math.random() * 16);
    room.state = "dirty"; room.due = false;
    g.money += tip; g.checkouts++;
    g.msg = `🧳 ${x.room} выехал, чаевые +${tip}. Номер нужно убрать`;
    gRemoveGuest(g, x);
  } else if (x.kind === "ask") {
    const order = [0, 1, 2].sort(() => Math.random() - 0.5);
    g.question = { ...x, order };
  } else gSel = gSel === id ? null : id;
  renderGame();
}
function gTapRoom(num) {
  const g = game, room = g.rooms.find(r => r.num === num), sel = g.desk.find(x => x.id === gSel);
  if (g.over) return;
  if (room.state === "dirty") {
    if (g.rooms.filter(r => r.state === "cleaning").length >= G_MAIDS) g.msg = "Все горничные заняты — подожди";
    else { room.state = "cleaning"; room.from = g.t; room.until = g.t + G_CLEAN; g.msg = `🧹 Горничная пошла в ${num}`; }
    return renderGame();
  }
  if (!sel || sel.kind !== "in") { g.msg = room.state === "free" ? "Сначала выбери гостя на стойке" : room.state === "cleaning" ? "Номер убирают" : "Номер занят"; return renderGame(); }
  if (room.state !== "free") { g.msg = room.state === "cleaning" ? "Номер ещё убирают" : "Этот номер занят"; return renderGame(); }
  if (room.type !== sel.type && room.type !== "suite") { g.msg = `Гость хочет ${ROOM_TYPES[sel.type]}, а это ${ROOM_TYPES[room.type]}`; return renderGame(); }
  const upgrade = room.type === "suite" && sel.type !== "suite";
  room.state = "occupied"; room.due = false; room.face = sel.face; room.from = g.t; room.until = g.t + 22 + Math.random() * 20;
  g.money += G_PRICE[sel.type]; g.served++;
  if (upgrade) { g.upgrades++; g.stars = Math.min(5, g.stars + 1); g.msg = `✨ Апгрейд в люкс! Гость в восторге (+⭐), +${G_PRICE[sel.type]}`; }
  else g.msg = `✅ Заселён в ${num}, +${G_PRICE[sel.type]}`;
  gRemoveGuest(g, sel);
  try { navigator.vibrate && navigator.vibrate(15); } catch {}
  renderGame();
}
function gAnswer(i) {
  const g = game, q = g.question;
  g.question = null;
  g.desk = g.desk.filter(y => y.id !== q.id);
  if (i === 0) { g.money += 15; g.answers++; g.msg = "👍 Отличный ответ! +15"; }
  else { g.stars--; g.msg = "🙁 Гость недоволен ответом — минус звезда"; if (g.stars <= 0) gFinish(g); }
  renderGame();
}

document.addEventListener("click", e => {
  const q = s => e.target.closest(s);
  let el;
  if ((el = q("[data-g]"))) {
    const a = el.dataset.g;
    if (a === "start") { game = gNew(); gSel = null; gEnsureLoop(); }
    if (a === "pause" && game) game.paused = true;
    if (a === "resume" && game) { game.paused = false; gLast = performance.now(); }
    if (a === "quit" && game) { game.paused = false; gFinish(game); }
    return renderGame();
  }
  if ((el = q("[data-gg]"))) return gTapGuest(el.dataset.gg);
  if ((el = q("[data-gr]"))) return gTapRoom(el.dataset.gr);
  if ((el = q("[data-ga]"))) return gAnswer(Number(el.dataset.ga));
});
