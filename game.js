/* FrontDesk mini game "Ресепшн: час пик": a career of day and night shifts with upgrades between them */
"use strict";
const G_SAVE_KEY = "frontdesk_game_v2", G_OLD_BEST_KEY = "frontdesk_game_best";
const G_SHIFT = 150, G_DESK = 4, G_FIX = 5;
const G_FLOORS = [
  [["101", "twin"], ["102", "double"], ["103", "twin"], ["104", "double"]],
  [["201", "twin"], ["202", "double"], ["203", "family"], ["204", "suite"]],
  [["301", "double"], ["302", "twin"], ["303", "family"], ["304", "twin"]],
  [["401", "double"], ["402", "twin"], ["403", "double"], ["404", "suite"]],
];
const G_PRICE = { twin: 40, double: 50, family: 70, suite: 120 };
const G_WEIGHT = { twin: 3, double: 3, family: 1.2, suite: 0.6 };
const G_FACES = { twin: ["🧑‍💼", "👩‍💻", "🧔", "👩‍🦰"], double: ["👫", "💑", "👭"], family: ["👨‍👩‍👧", "👨‍👩‍👦‍👦", "👩‍👧‍👦"], suite: ["🤵", "👸", "🕴️"] };
const G_ISSUES = ["нет горячей воды", "не работает телевизор", "течёт кран", "не греет батарея", "сломался фен", "не работает кондиционер", "перегорела лампочка", "не закрывается окно"];
const cleanTime = l => [7, 5.5, 4][l];
const coffeeMul = l => [1, 1.2, 1.4][l];
const G_UPGRADES = {
  maid: { icon: "🧹", name: "Ещё горничная", now: l => `Горничных: ${2 + l}`, next: l => `станет ${3 + l}`, prices: [900, 2000] },
  speed: { icon: "⚡", name: "Быстрая уборка", now: l => `Уборка ${String(cleanTime(l)).replace(".", ",")} с`, next: l => `станет ${String(cleanTime(l + 1)).replace(".", ",")} с`, prices: [700, 1600] },
  coffee: { icon: "☕", name: "Кофемашина в лобби", now: l => (l ? `Терпение +${l * 20}%` : "Нет"), next: l => `терпение гостей +${(l + 1) * 20}%`, prices: [800, 1800] },
  floor: { icon: "🏨", name: "Новый этаж", now: l => `Номеров: ${8 + 4 * l}`, next: l => `станет ${12 + 4 * l}`, prices: [1200, 2600] },
};

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
  ["Я потерял ключ-карту", ["Сделать новую, старую заблокировать", "Выдать мастер-ключ", "Предложить ночевать в лобби"]],
  ["Где тут можно вкусно поесть?", ["Порекомендовать пару мест рядом", "Сказать, что вы не местный", "Отправить в ближайший ларёк"]],
  ["В номере не работает кондиционер", ["Вызвать техника, при необходимости переселить", "Посоветовать открыть окно зимой", "Сказать, что так и задумано"]],
  ["Можно оставить багаж после выезда?", ["Да, в камере хранения", "Только в коридоре", "Нет, забирайте всё сразу"]],
  ["Можно заселиться пораньше? Сейчас 9 утра", ["Проверить готовые номера, иначе оставить багаж", "Заселить в чужой номер, пока хозяин гуляет", "Сказать прийти завтра"]],
  ["Во сколько завтрак?", ["Назвать время и где находится ресторан", "Сказать: «когда проснётесь»", "Сделать вид, что завтрака не существует"]],
  ["Можно с собакой?", ["Рассказать правила отеля о животных", "Только если собака оплатит номер", "Спрятать собаку в чемодане"]],
  ["Мне нужен счёт для командировки", ["Распечатать счёт с реквизитами", "Написать сумму на салфетке", "Сказать, что бухгалтерия спит"]],
  ["Сейф в номере не открывается", ["Открыть сейф мастер-кодом при госте", "Посоветовать потрясти сейф", "Предложить забыть о вещах"]],
  ["Хочу номер получше, можно доплатить?", ["Предложить доступные варианты апгрейда", "Нарисовать вид на море на окне", "Отказать, не проверив свободные номера"]],
  ["Я хочу продлить проживание", ["Проверить свободные даты и продлить", "Сказать «всё занято», не проверяя", "Предложить переехать в лобби"]],
  ["У меня аллергия на перья", ["Заменить подушки на гипоаллергенные", "Посоветовать спать без подушки", "Сказать: «это не перья, это пух»"]],
  ["Где ближайшая аптека?", ["Подсказать адрес и показать на карте", "Предложить таблетку из своего кармана", "Сказать, что вы не врач"]],
  ["Можно курить в номере?", ["Объяснить правила и показать место для курения", "Конечно, только откройте окно", "Можно, если никто не видит"]],
  ["Мне нужен утюг", ["Выдать утюг или передать горничной", "Посоветовать посидеть на рубашке", "Утюги выдаём только по пятницам"]],
  ["С карты списали деньги два раза!", ["Проверить операции и оформить возврат", "Сказать, что так задумано", "Предложить списать и третий раз"]],
  ["Как добраться до вокзала?", ["Объяснить маршрут или вызвать такси", "Сказать «прямо и не сворачивайте»", "Нарисовать карту на руке гостя"]],
  ["Нужна детская кроватка", ["Проверить наличие и поставить в номер", "Предложить уложить ребёнка в чемодан", "Сказать, что дети спят стоя"]],
  ["Я захлопнул ключ-карту в номере", ["Проверить личность и сделать новую карту", "Предложить залезть через балкон", "Сказать ждать до выезда"]],
  ["В номере пахнет краской", ["Извиниться и предложить другой номер", "Сказать, что это аромат свежести", "Выдать освежитель и уйти"]],
  ["Можно оплатить картой иностранного банка?", ["Проверить терминал и предложить варианты оплаты", "Попросить расплатиться сувенирами", "Отказать, ничего не проверив"]],
  ["Далеко до центра?", ["Рассказать, как дойти и сколько идти", "Сказать «рядом» про 20 км", "Ответить «не знаю, я тут работаю»"]],
  ["Ко мне придёт друг, можно в номер?", ["Объяснить правила визитов гостей", "Пусть ночует, мы не скажем", "Только если принесёт торт персоналу"]],
  ["Вы не видели мой паспорт?", ["Проверить ресепшен: он мог остаться после регистрации", "Сказать, что паспорт улетел", "Посоветовать сделать новый"]],
  ["Я хочу поговорить с менеджером!", ["Выслушать и при необходимости позвать менеджера", "Сказать, что менеджер в отпуске до лета", "Притвориться менеджером"]],
  ["Дайте второй ключ для жены", ["Сделать второй ключ для гостей этого номера", "Дать ключ от другого номера", "Сказать, что один ключ на семью"]],
  ["Где лифт?", ["Показать дорогу к лифту", "Посоветовать подняться пешком на 10 этаж", "Сказать, что лифт — это миф"]],
  ["У меня день рождения сегодня!", ["Поздравить и, если можно, сделать приятный сюрприз", "Сказать «и что?»", "Взять доплату за поздравление"]],
  ["Можно пиццу заказать в номер?", ["Подсказать доставку и встретить курьера", "Съесть пиццу за гостя", "Запретить пиццу навсегда"]],
  ["Пульт от телевизора не работает", ["Отправить новые батарейки или пульт", "Посоветовать переключать каналы руками", "Сказать смотреть в окно"]],
  ["Где можно постирать вещи?", ["Рассказать про прачечную или услугу стирки", "Посоветовать постирать в раковине", "Сказать, что стирают только по праздникам"]],
  ["Можно поменять двуспальную кровать на две?", ["Проверить наличие твина и переселить", "Распилить кровать", "Сказать «спите по очереди»"]],
];
const G_NIGHT_Q = [
  ["В коридоре кто-то поёт в три ночи", ["Вежливо попросить гостя вести себя тише", "Подпеть", "Включить музыку погромче"]],
  ["Мне не спится. Есть что почитать?", ["Предложить чай и журналы в лобби", "Почитать вслух правила проживания", "Посоветовать считать овец до утра"]],
  ["Я заблудился. Какой у меня номер?", ["Проверить личность и подсказать номер", "Назвать первый попавшийся", "Сказать: «угадайте»"]],
  ["Где поесть в два часа ночи?", ["Подсказать круглосуточное кафе или доставку", "Предложить свой бутерброд", "Сказать, что ночью не едят"]],
  ["Можно поплавать в бассейне сейчас?", ["Объяснить часы работы бассейна", "Да, в фонтане перед входом", "Только в ванне"]],
  ["Мне кажется, в шкафу кто-то есть", ["Вместе с охраной проверить номер", "Сказать, что это моль", "Посоветовать подружиться"]],
  ["Такси не едет уже час!", ["Перезвонить в службу или заказать другое", "Предложить идти пешком в аэропорт", "Пожать плечами"]],
  ["Можно заселиться прямо сейчас, в 4 утра?", ["Проверить свободный номер и оформить", "Предложить поспать на диване ресепшена", "Сказать вернуться днём"]],
  ["Сосед храпит так, что дрожат стены", ["Предложить беруши или другой номер", "Постучать соседу шваброй", "Записать храп и выложить в сеть"]],
  ["Я потерял вставную челюсть", ["Проверить потерянные вещи и помочь искать", "Посоветовать улыбаться реже", "Предложить на завтрак кашу"]],
  ["Разбудите меня в 5 утра", ["Записать номер и время побудки", "Пообещать покричать в коридоре", "Сказать, что петухи разбудят"]],
  ["Кто-то съел мой йогурт из мини-бара!", ["Спокойно разобраться и предложить новый", "Признаться, что это были вы", "Сказать, что йогурт ушёл сам"]],
  ["Почему в лобби так темно? Мне страшно", ["Включить свет и проводить гостя к лифту", "Рассказать страшилку про отель", "Выключить свет и в стойке"]],
  ["Мой кот сбежал по коридору!", ["Помочь найти кота и вернуть в номер", "Сказать, что у нас теперь свой кот", "Позвать собаку на помощь"]],
];
const G_SHIFT_HINT = night => (night ? "Ночь: гостей мало, почти все спят, но вопросы странные" : "Утром выезды, днём заезды");

/* ---------- career save ---------- */
function gLoad() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(G_SAVE_KEY) || "null"); } catch {}
  s = { day: 1, wallet: 0, best: 0, guests: 0, passed: 0, ...(s || {}) };
  s.up = { maid: 0, speed: 0, coffee: 0, floor: 0, ...(s.up || {}) };
  if (!s.best) { try { s.best = Number(localStorage.getItem(G_OLD_BEST_KEY)) || 0; } catch {} }
  return s;
}
function gSave() { try { localStorage.setItem(G_SAVE_KEY, JSON.stringify(gs)); } catch {} }
let gs = gLoad();
const gIsNight = day => day % 3 === 0;
const gGoal = day => Math.round((gIsNight(day) ? 280 + 65 * (day - 1) : 450 + 170 * (day - 1)) / 10) * 10;

let game = null, gSel = null, gLoopId = null, gLast = 0;
const gid = () => Math.random().toString(36).slice(2, 9);
const gPick = xs => xs[Math.floor(Math.random() * xs.length)];
const gMMSS = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const gStars = n => "★".repeat(Math.max(0, n)) + "☆".repeat(5 - Math.max(0, n));

function gNew() {
  const day = gs.day, night = gIsNight(day);
  const rooms = G_FLOORS.slice(0, 2 + gs.up.floor).flat().map(([num, type]) => ({ num, type, state: "free", from: 0, until: 0, face: "", due: false, issue: "", fixUntil: 0 }));
  // The hotel is never empty at the start: morning check-outs by day, sleeping guests at night
  rooms.forEach(r => { if (Math.random() < (night ? 0.45 : 0.4)) Object.assign(r, { state: "occupied", face: gPick(G_FACES[r.type]), from: -30, until: night ? 999 : 4 + Math.random() * 40 }); });
  return {
    day, night, goal: gGoal(day), t: 0, money: 0, stars: 5, served: 0, checkouts: 0, answers: 0, upgrades: 0, vips: 0, fixes: 0, lost: 0, streak: 0,
    nextSpawn: 1.5, nextIssue: 20, tech: 0, asked: new Set(), paused: false, over: false, question: null,
    msg: G_SHIFT_HINT(night), rooms, desk: [], waiting: [],
    maids: 2 + gs.up.maid, clean: cleanTime(gs.up.speed), coffee: coffeeMul(gs.up.coffee),
  };
}
const gProgress = g => Math.min(1, g.t / G_SHIFT);
const gPatience = g => (24 - 9 * gProgress(g)) * Math.max(0.8, 1 - 0.02 * (g.day - 1)) * g.coffee * (g.night ? 1.3 : 1);

function gSpawn(g) {
  const max = gPatience(g);
  if (Math.random() < (g.night ? 0.4 : 0.18)) {
    const pool = g.night ? G_NIGHT_Q : G_QUESTIONS;
    let i = Math.floor(Math.random() * pool.length);
    for (let k = 0; k < pool.length && g.asked.has(i); k++) i = (i + 1) % pool.length;
    g.asked.add(i);
    g.desk.push({ id: gid(), kind: "ask", face: g.night ? "🥱" : "🙋", q: pool[i][0], answers: pool[i][1], patience: max, max });
    return;
  }
  let r = Math.random() * Object.values(G_WEIGHT).reduce((a, b) => a + b, 0), type = "twin";
  for (const [k, w] of Object.entries(G_WEIGHT)) { if ((r -= w) <= 0) { type = k; break; } }
  const vip = g.day >= 2 && Math.random() < 0.12, p = vip ? max * 0.55 : max;
  g.desk.push({ id: gid(), kind: "in", type, vip, face: vip ? "👑" : gPick(G_FACES[type]), patience: p, max: p });
}
function gLose(g, guest, stars, msg) {
  g.desk = g.desk.filter(x => x !== guest);
  if (gSel === guest.id) gSel = null;
  g.stars -= stars; g.lost++; g.streak = 0; g.msg = msg;
  try { navigator.vibrate && navigator.vibrate(120); } catch {}
}

function gTick(dt) {
  const g = game;
  let changed = false;
  g.t += dt;
  for (const room of g.rooms) {
    if (room.state === "occupied" && !room.due && g.t >= room.until) {
      room.due = true;
      const p = gPatience(g) + 4;
      g.waiting.push({ id: gid(), kind: "out", room: room.num, face: "🧳", patience: p, max: p });
      changed = true;
    }
    if (room.state === "cleaning" && g.t >= room.until) { room.state = "free"; changed = true; }
    if (room.fixUntil && g.t >= room.fixUntil) { room.fixUntil = 0; room.issue = ""; g.fixes++; g.money += 10; g.msg = `🔧 В ${room.num} всё починили, гость благодарит (+10)`; changed = true; }
  }
  while (g.waiting.length && g.desk.length < G_DESK) { g.desk.push(g.waiting.shift()); changed = true; }
  for (const guest of [...g.desk]) {
    guest.patience -= dt;
    if (guest.patience > 0) continue;
    if (guest.kind === "out") {
      const room = g.rooms.find(r => r.num === guest.room);
      Object.assign(room, { state: "dirty", due: false, issue: "", fixUntil: 0 });
      gLose(g, guest, 1, `😠 Гость из ${guest.room} ушёл, не дождавшись выезда`);
    } else if (guest.kind === "fix") {
      g.rooms.find(r => r.num === guest.room).issue = "";
      gLose(g, guest, 1, `😠 В ${guest.room} так и не починили — минус звезда`);
    } else if (guest.vip) gLose(g, guest, 2, "😤 VIP-гость ушёл — минус две звезды!");
    else gLose(g, guest, 1, "😠 Гость ушёл недовольным — минус звезда");
    changed = true;
  }
  if (g.t >= g.nextSpawn) {
    if (g.desk.length < G_DESK) { gSpawn(g); changed = true; }
    const diff = Math.max(0.65, 1 - 0.04 * (g.day - 1));
    g.nextSpawn = g.t + ((6 - 3.5 * gProgress(g)) * diff + Math.random() * 1.5) * (g.night ? 1.7 : 1);
  }
  // From day 3 guests call the desk with problems in their rooms
  if (g.day >= 3 && g.t >= g.nextIssue) {
    const cand = g.rooms.filter(r => r.state === "occupied" && !r.due && !r.issue);
    if (cand.length && g.desk.length < G_DESK) {
      const r = gPick(cand), p = gPatience(g) * 1.1;
      r.issue = gPick(G_ISSUES);
      g.desk.push({ id: gid(), kind: "fix", room: r.num, face: "📞", text: r.issue, patience: p, max: p });
      changed = true;
    }
    g.nextIssue = g.t + (14 + Math.random() * 14) * (g.night ? 1.5 : 1);
  }
  if (g.stars <= 0 || g.t >= G_SHIFT) gFinish(g);
  changed || g.over ? renderGame() : gUpdate();
}
function gFinish(g) {
  if (g.over) return;
  g.over = true; g.stars = Math.max(0, g.stars);
  g.failed = g.stars <= 0;
  g.passed = !g.failed && g.money >= g.goal;
  g.earned = g.failed ? Math.floor(g.money / 2) : g.money;
  g.record = !g.failed && g.money > gs.best;
  gs.wallet += g.earned; gs.guests += g.served;
  if (g.record) gs.best = g.money;
  if (g.passed) { gs.day++; gs.passed++; }
  gSave();
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
  if (!game) { root.innerHTML = gHub(); return; }
  const g = game, busy = g.rooms.filter(r => r.state === "cleaning").length, sel = g.desk.find(x => x.id === gSel);
  const techBusy = g.rooms.some(r => r.fixUntil);
  root.innerHTML = `<div class="g-wrap ${g.night ? "night" : ""}">
    <div class="g-dayline">${g.night ? "☾ Ночная смена" : "☀ Дневная смена"} · День ${g.day}</div>
    <div class="g-top"><span id="gTime">⏱ ${gMMSS(G_SHIFT - g.t)}</span><span class="${g.money >= g.goal ? "g-goal-ok" : ""}">💰 ${g.money}<small>/${g.goal}</small></span><span class="g-stars">${gStars(g.stars)}</span><button class="g-icon" data-g="pause" aria-label="Пауза">⏸</button></div>
    <div class="g-msg">${esc(sel && sel.kind === "in" ? (gCanFit(g, sel) ? `${sel.vip ? "👑 VIP платит втрое! " : ""}Гость хочет ${ROOM_TYPES[sel.type]} — выбери номер (Люкс подойдёт всем)` : `Свободных ${ROOM_TYPES[sel.type]} и люкса нет. Подожди уборку или извинись`) : g.msg)}${sel && sel.kind === "in" ? ` <button class="g-decline" data-g="decline">Извиниться: мест нет</button>` : ""}</div>
    <div class="g-desk">${Array.from({ length: G_DESK }, (_, i) => gGuest(g.desk[i])).join("")}</div>
    ${g.waiting.length ? `<div class="g-queue">В очереди на выезд: ${g.waiting.length}</div>` : ""}
    <div class="g-staff"><span>🧹 ${"●".repeat(g.maids - busy)}${"○".repeat(busy)}</span>${g.day >= 3 ? `<span>🔧 Техник: ${techBusy ? "занят" : "свободен"}</span>` : ""}</div>
    <div class="g-rooms ${g.rooms.length > 8 ? "many" : ""}">${g.rooms.map(gRoom).join("")}</div>
    ${g.question ? gQuestion(g.question) : ""}
    ${g.paused && !g.over ? `<div class="g-over"><div class="g-card"><h3>Пауза</h3><p class="muted">Время смены остановлено.</p><button class="btn" data-g="resume">Продолжить</button><button class="btn secondary" data-g="quit">Закончить смену</button></div></div>` : ""}
    ${g.over ? gOverScreen(g) : ""}
  </div>`;
}
function gGuest(x) {
  if (!x) return `<div class="g-guest empty"><span>—</span></div>`;
  const label = x.kind === "in" ? ROOM_TYPES[x.type] : x.kind === "out" ? `Выезд ${x.room}` : x.kind === "fix" ? `Жалоба ${x.room}` : "Вопрос";
  const pct = Math.max(0, x.patience / x.max * 100);
  return `<button class="g-guest k-${x.kind} ${x.vip ? "vip" : ""} ${gSel === x.id ? "sel" : ""}" data-gg="${x.id}"><span class="g-face">${x.face}</span><b>${label}</b><i class="g-pat"><i id="gp-${x.id}" class="${pct < 30 ? "low" : ""}" style="width:${pct}%"></i></i></button>`;
}
function gRoom(r) {
  const g = game;
  let icon = "✓", bar = "";
  if (r.state === "occupied") { icon = r.due ? "🧳" : r.face; if (r.until < 900) bar = `<i class="g-bar"><i id="gr-${r.num}" style="width:${Math.max(0, (r.until - g.t) / (r.until - r.from) * 100)}%"></i></i>`; else icon = "😴"; }
  if (r.state === "dirty") icon = "🧺";
  if (r.state === "cleaning") { icon = "🧹"; bar = `<i class="g-bar clean"><i id="gr-${r.num}" style="width:${Math.min(100, (g.t - r.from) / g.clean * 100)}%"></i></i>`; }
  const sel = g.desk.find(x => x.id === gSel), fits = sel && sel.kind === "in" && r.state === "free" && (r.type === sel.type || r.type === "suite");
  const badge = r.fixUntil ? `<span class="g-badge fix">🔧</span>` : r.issue ? `<span class="g-badge">⚠</span>` : "";
  return `<button class="g-room st-${r.state} ${fits ? "fits" : ""}" data-gr="${r.num}"><b>${r.num}</b><small>${ROOM_TYPES[r.type]}</small><span class="g-ico">${icon}</span>${badge}${bar}</button>`;
}
function gQuestion(q) {
  return `<div class="g-over"><div class="g-card"><div class="g-face big">${q.face}</div><h3>«${esc(q.q)}»</h3>
    <div class="g-answers">${q.order.map(i => `<button class="btn secondary" data-ga="${i}">${esc(q.answers[i])}</button>`).join("")}</div></div></div>`;
}
function gHub() {
  const night = gIsNight(gs.day);
  const ups = Object.entries(G_UPGRADES).map(([k, u]) => {
    const l = gs.up[k], price = u.prices[l], max = price === undefined;
    return `<div class="g-up"><span class="g-up-ico">${u.icon}</span><div class="g-up-body"><b>${u.name}</b><small>${u.now(l)}${max ? " · максимум" : ` → ${u.next(l)}`}</small><span class="g-lvl">${u.prices.map((_, i) => `<i class="${i < l ? "on" : ""}"></i>`).join("")}</span></div>
      ${max ? `<span class="g-max">✓</span>` : `<button class="btn small ${gs.wallet < price ? "secondary" : ""}" data-gbuy="${k}" ${gs.wallet < price ? "disabled" : ""}>${price} 💰</button>`}</div>`;
  }).join("");
  return `<div class="g-hub card ${night ? "night" : ""}">
      <div class="g-dayline">${night ? "☾ Ночная смена" : "☀ Дневная смена"}</div>
      <h2>День ${gs.day}</h2>
      <p class="muted">${G_SHIFT_HINT(night)}.${gs.day === 2 ? " Сегодня впервые придут VIP-гости 👑" : gs.day === 3 ? " С сегодняшнего дня гости звонят с жалобами 📞" : ""}</p>
      <div class="g-goal">🎯 Цель смены: <b>${gGoal(gs.day)} 💰</b></div>
      <button class="btn" data-g="start">Начать смену</button>
      <div class="g-wallet"><span>Кошелёк: <b>${gs.wallet} 💰</b></span><span>Рекорд смены: <b>${gs.best}</b></span></div>
    </div>
    <div class="section-head"><h3>Улучшения отеля</h3><span>💰 ${gs.wallet}</span></div>
    <div class="g-ups">${ups}</div>
    <details class="card g-howto"><summary>Как играть</summary><ul class="g-rules">
      <li><b>Заселение.</b> Нажми на гостя, потом на подсвеченный номер его типа: TWN, DBL, FAM или LUX. Люкс подходит всем — это апгрейд, гость ставит +⭐.</li>
      <li><b>👑 VIP</b> (с 2-го дня) платит втрое, но ждёт недолго. Ушёл — минус две звезды.</li>
      <li>Если подходящих номеров нет — выбери гостя и нажми «Извиниться: мест нет». Звезда не снимается.</li>
      <li><b>🧳 Выезд.</b> Нажми на гостя — чаевые, номер станет грязным.</li>
      <li><b>🧺 Уборка.</b> Нажми на грязный номер — горничная уберёт его.</li>
      <li><b>📞 Жалоба</b> (с 3-го дня). Нажми на звонок — техник починит за 5 секунд. Техник один.</li>
      <li><b>🙋 Вопрос.</b> Выбери правильный ответ: +15. Ошибка — минус звезда.</li>
      <li>6 гостей подряд без потерь возвращают одну звезду.</li>
      <li>Заработай цель смены — откроется следующий день. Каждая третья смена ночная.</li>
      <li>Все деньги смены идут в кошелёк. Если звёзды кончились — только половина.</li>
    </ul></details>
    <p class="notice">Дней пройдено: ${gs.passed} · гостей заселено: ${gs.guests} · <button class="link" data-g="reset">Начать карьеру заново</button></p>`;
}
function gOverScreen(g) {
  const head = g.failed ? ["😵", "Гости разбежались…"] : g.passed ? [g.record ? "🏆" : "🎉", g.record ? "День пройден! Новый рекорд!" : `День ${g.day} пройден!`] : ["😐", "Цель не выполнена"];
  return `<div class="g-over"><div class="g-card">
    <div class="g-face big">${head[0]}</div><h3>${head[1]}</h3>
    <p class="muted">${g.failed ? `В кошелёк идёт только половина: ${g.earned} 💰. День придётся повторить.` : g.passed ? `В кошелёк: +${g.earned} 💰. Загляни в улучшения!` : `Заработано ${g.money} из ${g.goal}. Деньги в кошельке, день повторится.`}</p>
    <div class="g-results">
      <div><span>Заработано</span><b>${g.money} 💰</b></div>
      <div><span>Рейтинг</span><b class="g-stars">${gStars(g.stars)}</b></div>
      <div><span>Заселено</span><b>${g.served}${g.vips ? ` <small>(👑 ${g.vips})</small>` : ""}</b></div>
      <div><span>Выездов</span><b>${g.checkouts}</b></div>
      <div><span>Апгрейдов</span><b>${g.upgrades}</b></div>
      <div><span>Ответов / починок</span><b>${g.answers} / ${g.fixes}</b></div>
    </div>
    <button class="btn" data-g="hub">Дальше</button>
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
    el.style.width = (r.state === "cleaning" ? Math.min(100, (g.t - r.from) / g.clean * 100) : Math.max(0, (r.until - g.t) / (r.until - r.from) * 100)) + "%";
  }
}

/* ---------- actions ---------- */
const gCanFit = (g, x) => g.rooms.some(r => r.state === "free" && (r.type === x.type || r.type === "suite"));
// Six guests in a row served without losing anyone bring a lost star back
function gServed(g) {
  if (++g.streak < 6) return;
  g.streak = 0;
  if (g.stars < 5) { g.stars++; g.msg += " · Серия без потерь: +⭐"; }
}
function gRemoveGuest(g, x) { g.desk = g.desk.filter(y => y !== x); if (gSel === x.id) gSel = null; }
function gTapGuest(id) {
  const g = game, x = g.desk.find(y => y.id === id);
  if (!x || g.over) return;
  if (x.kind === "out") {
    const room = g.rooms.find(r => r.num === x.room), tip = 5 + Math.floor(Math.random() * 16);
    Object.assign(room, { state: "dirty", due: false, issue: "", fixUntil: 0 });
    g.desk = g.desk.filter(y => !(y.kind === "fix" && y.room === x.room));
    g.money += tip; g.checkouts++;
    g.msg = `🧳 ${x.room} выехал, чаевые +${tip}. Номер нужно убрать`;
    gServed(g);
    gRemoveGuest(g, x);
  } else if (x.kind === "fix") {
    if (g.rooms.some(r => r.fixUntil)) g.msg = "🔧 Техник занят — подожди немного";
    else {
      const room = g.rooms.find(r => r.num === x.room);
      room.fixUntil = g.t + G_FIX;
      g.msg = `🔧 Техник пошёл в ${x.room}: ${x.text}`;
      gRemoveGuest(g, x);
    }
  } else if (x.kind === "ask") {
    g.question = { ...x, order: [0, 1, 2].sort(() => Math.random() - 0.5) };
  } else gSel = gSel === id ? null : id;
  renderGame();
}
function gTapRoom(num) {
  const g = game, room = g.rooms.find(r => r.num === num), sel = g.desk.find(x => x.id === gSel);
  if (g.over) return;
  if (room.state === "dirty") {
    if (g.rooms.filter(r => r.state === "cleaning").length >= g.maids) g.msg = "Все горничные заняты — подожди";
    else { Object.assign(room, { state: "cleaning", from: g.t, until: g.t + g.clean }); g.msg = `🧹 Горничная пошла в ${num}`; }
    return renderGame();
  }
  if (!sel || sel.kind !== "in") { g.msg = room.state === "free" ? "Сначала выбери гостя на стойке" : room.state === "cleaning" ? "Номер убирают" : room.issue ? `В ${num}: ${room.issue}` : "Номер занят"; return renderGame(); }
  if (room.state !== "free") { g.msg = room.state === "cleaning" ? "Номер ещё убирают" : "Этот номер занят"; return renderGame(); }
  if (room.type !== sel.type && room.type !== "suite") { g.msg = `Гость хочет ${ROOM_TYPES[sel.type]}, а это ${ROOM_TYPES[room.type]}`; return renderGame(); }
  const upgrade = room.type === "suite" && sel.type !== "suite", pay = G_PRICE[sel.type] * (sel.vip ? 3 : 1);
  const stay = g.night ? 60 + Math.random() * 60 : 22 + Math.random() * 20;
  Object.assign(room, { state: "occupied", due: false, face: sel.face, from: g.t, until: g.t + stay, issue: "", fixUntil: 0 });
  g.money += pay; g.served++;
  if (sel.vip) g.vips++;
  if (upgrade) { g.upgrades++; g.stars = Math.min(5, g.stars + 1); g.msg = `✨ Апгрейд в люкс! Гость в восторге (+⭐), +${pay}`; }
  else g.msg = `${sel.vip ? "👑 VIP заселён" : "✅ Заселён"} в ${num}, +${pay}`;
  gServed(g);
  gRemoveGuest(g, sel);
  try { navigator.vibrate && navigator.vibrate(15); } catch {}
  renderGame();
}
function gAnswer(i) {
  const g = game, q = g.question;
  g.question = null;
  g.desk = g.desk.filter(y => y.id !== q.id);
  if (i === 0) { g.money += 15; g.answers++; g.msg = "👍 Отличный ответ! +15"; gServed(g); }
  else { g.stars--; g.msg = `🙁 Лучше было: «${q.answers[0]}». Минус звезда`; if (g.stars <= 0) gFinish(g); }
  gLast = performance.now();
  renderGame();
}
function gBuy(k) {
  const u = G_UPGRADES[k], price = u.prices[gs.up[k]];
  if (price === undefined || gs.wallet < price) return;
  gs.wallet -= price; gs.up[k]++; gSave();
  toast(`${u.icon} Куплено: ${u.name}`);
  renderGame();
}

document.addEventListener("click", e => {
  const q = s => e.target.closest(s);
  let el;
  if ((el = q("[data-g]"))) {
    const a = el.dataset.g;
    if (a === "start") { game = gNew(); gSel = null; gEnsureLoop(); window.scrollTo(0, 0); }
    if (a === "pause" && game) game.paused = true;
    if (a === "resume" && game) { game.paused = false; gLast = performance.now(); }
    if (a === "quit" && game) { game.paused = false; gFinish(game); }
    if (a === "hub") { game = null; window.scrollTo(0, 0); }
    if (a === "decline" && game) { const x = game.desk.find(y => y.id === gSel); if (x) { gRemoveGuest(game, x); game.msg = "🙏 Извинились и предложили другой отель — гость ушёл без обид"; } }
    if (a === "reset") return confirmModal("Начать карьеру заново?", "День, кошелёк и все улучшения обнулятся. Рекорд смены сохранится.", "Начать заново", () => { gs = { ...gLoad(), day: 1, wallet: 0, guests: 0, passed: 0, up: { maid: 0, speed: 0, coffee: 0, floor: 0 } }; gSave(); renderGame(); });
    return renderGame();
  }
  if ((el = q("[data-gbuy]"))) return gBuy(el.dataset.gbuy);
  if ((el = q("[data-gg]"))) return gTapGuest(el.dataset.gg);
  if ((el = q("[data-gr]"))) return gTapRoom(el.dataset.gr);
  if ((el = q("[data-ga]"))) return gAnswer(Number(el.dataset.ga));
});
