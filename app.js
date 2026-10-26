/* FrontDesk: local-first helper for a hotel receptionist */
"use strict";
const APP_VERSION = "1.3";
const STORAGE_KEY = "frontdesk_data", IDB_NAME = "FrontDeskDB";
const BACKUP_REMIND_DAYS = 7, ARCHIVE_LIMIT = 90;

/* ---------- hotel layout ---------- */
// Floors 3–9: rooms x01–x07, rooms 2, 5, 7 are doubles, the rest twins. Floor 10: 1001 twin, 1002–1003 family, 1004 suite
const ROOM_TYPES = { twin: "TWN", double: "DBL", family: "FAM", suite: "LUX" };
const ROOM_TYPE_NAMES = { twin: "Твин", double: "Дабл", family: "Семейный", suite: "Люкс" };
const ROOMS = [];
for (let f = 3; f <= 9; f++) for (let n = 1; n <= 7; n++) ROOMS.push({ num: String(f * 100 + n), floor: f, type: [2, 5, 7].includes(n) ? "double" : "twin" });
[["1001", "twin"], ["1002", "family"], ["1003", "family"], ["1004", "suite"]].forEach(([num, type]) => ROOMS.push({ num, floor: 10, type }));
const ROOM_BY_NUM = Object.fromEntries(ROOMS.map(r => [r.num, r]));
const FLOORS = [...new Set(ROOMS.map(r => r.floor))];

const STATUS = {
  free: { label: "Свободен", cls: "s-free" },
  occupied: { label: "Занят", cls: "s-occupied" },
  dirty: { label: "Грязный", cls: "s-dirty" },
  repair: { label: "Ремонт", cls: "s-repair" },
  block: { label: "Блок", cls: "s-block" },
};

/* ---------- state ---------- */
const state = { view: "rooms", roomFilter: "all", statsMode: "month", statsOffset: 0, data: null };
const emptyData = () => ({
  version: 1, savedAt: 0,
  rooms: {}, // num -> {status, note, checkout, since, updatedAt}
  shift: null, // {id, startedAt, kind: "day" | "night", items, log} while a shift is running
  pending: [], // notes left for the next shift (unfinished items, or written while no shift is running)
  pendingLog: [], // room status changes made while no shift is running
  archive: [],
  stays: [], // {id, room, in, out, approx?}: one record per guest stay, built from room status changes
  statsSince: Date.now(),
  contacts: [],
  tips: [],
  settings: { lastBackupAt: 0 },
});
const KIND = { day: "Дневная", night: "Ночная" };
const guessKind = d => (d.getHours() >= 6 && d.getHours() < 17 ? "day" : "night");

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dateISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const hmOf = d => pad(d.getHours()) + ":" + pad(d.getMinutes());
const fmt = (opts, d) => new Intl.DateTimeFormat("ru-RU", opts).format(d);
const shortDate = d => fmt({ day: "numeric", month: "short" }, d).replace(".", "");
const ddmm = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
const today = () => dateISO(new Date());
const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
const roomData = num => state.data.rooms[num] || { status: "free", note: "", checkout: "", since: "" };
const roomLabel = num => `${num} · ${ROOM_TYPE_NAMES[ROOM_BY_NUM[num]?.type] || ""}`;

// Extra marks on top of the manual status: checkout due today / overdue
// Expected check-in is a separate mark, not a status: a room can be "occupied, checkout today" and "arrival today" at once
function arrivalFlag(rd) { return rd.arrival && rd.arrival <= today() ? "arrival" : ""; }
const statusLabel = k => STATUS[k]?.label || (k === "booked" ? "Бронь" : k);
function roomFlag(rd) {
  if (rd.status !== "occupied" || !rd.checkout) return "";
  return rd.checkout < today() ? "overdue" : rd.checkout === today() ? "checkout" : "";
}

/* ---------- storage: localStorage + IndexedDB copy ---------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet() { const db = await idb(); return new Promise(res => { const q = db.transaction("kv").objectStore("kv").get("data"); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
async function idbSet(v) { const db = await idb(); return new Promise(res => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, "data"); t.oncomplete = t.onerror = () => res(); }); }

let saveTimer;
function save() {
  state.data.savedAt = Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); } catch (e) { console.error(e); toast("Не удалось сохранить: память браузера заполнена"); }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => idbSet(JSON.parse(JSON.stringify(state.data))).catch(() => {}), 300);
}
async function load() {
  let ls = null, db = null;
  try { ls = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch {}
  try { db = await idbGet(); } catch {}
  const pick = [ls, db].filter(Boolean).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
  state.data = normalize(pick);
  if (pick && !ls) setTimeout(() => toast("Данные восстановлены из резервной копии браузера"), 600);
  save();
}
function normalize(d) {
  const base = emptyData();
  if (!d || typeof d !== "object") return base;
  const out = { ...base, ...d, settings: { ...base.settings, ...(d.settings || {}) } };
  ["archive", "contacts", "tips", "pending", "pendingLog"].forEach(k => { if (!Array.isArray(out[k])) out[k] = []; });
  delete out.reminders;
  if (out.shift && Array.isArray(out.shift.items)) {
    if (!Array.isArray(out.shift.log)) out.shift.log = [];
    if (!KIND[out.shift.kind]) out.shift.kind = guessKind(new Date(out.shift.startedAt));
  } else out.shift = null;
  if (!out.rooms || typeof out.rooms !== "object") out.rooms = {};
  // v1.0 had "booked" as a status; it is now an arrival mark on a free room
  Object.values(out.rooms).forEach(rd => { if (rd.status === "booked") { rd.status = "free"; rd.arrival = rd.arrival || today(); } if (!STATUS[rd.status]) rd.status = "free"; });
  // Before v1.3 there were no stay records: rebuild them from the status changes saved in past shifts
  if (!Array.isArray(d.stays)) { const r = rebuildStays(out); out.stays = r.stays; out.statsSince = r.since; }
  return out;
}
async function requestPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}

/* ---------- navigation ---------- */
const navItems = [["rooms", "▦", "Номера"], ["shift", "✎", "Смена"], ["stats", "◔", "Статистика"], ["more", "☰", "Ещё"]];
const titles = { rooms: "Номера", shift: "Смена", stats: "Статистика", more: "Ещё" };
function go(view) {
  if (view !== state.view) history.pushState({ view }, "");
  state.view = view;
  render();
  window.scrollTo(0, 0);
}
window.addEventListener("popstate", e => { closeModal(); state.view = (e.state && e.state.view) || "rooms"; render(); });

function render() {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + state.view));
  if (!titles[state.view]) state.view = "rooms";
  $("#bottomNav").innerHTML = navItems.map(([id, icon, label]) => `<button class="nav-item ${state.view === id ? "active" : ""}" data-nav="${id}"><span class="nav-icon">${icon}${id === "shift" && !state.data.shift ? `<i class="badge">!</i>` : ""}</span><span>${label}</span></button>`).join("");
  ({ rooms: renderRooms, shift: renderShift, stats: renderStats, more: renderMore })[state.view]();
  $("#pageTitle").textContent = titles[state.view];
  $("#todayLabel").textContent = fmt({ weekday: "long", day: "numeric", month: "long" }, new Date());
}

/* ---------- rooms board ---------- */
function roomCounts() {
  const c = { all: ROOMS.length, checkout: 0, overdue: 0, arrival: 0 };
  Object.keys(STATUS).forEach(k => { c[k] = 0; });
  ROOMS.forEach(r => { const rd = roomData(r.num); c[rd.status]++; const f = roomFlag(rd); if (f) c[f]++; if (arrivalFlag(rd)) c.arrival++; });
  return c;
}
function matchesFilter(num) {
  const rd = roomData(num), f = state.roomFilter;
  if (f === "all") return true;
  if (f === "checkout") return roomFlag(rd) === "checkout" || roomFlag(rd) === "overdue";
  if (f === "notes") return !!rd.note;
  if (f === "arrival") return !!arrivalFlag(rd);
  return rd.status === f;
}
function renderRooms() {
  const c = roomCounts(), notes = ROOMS.filter(r => roomData(r.num).note).length;
  const chips = [["all", "Все", c.all], ["free", "Свободны", c.free], ["occupied", "Заняты", c.occupied], ["checkout", "Выезд сегодня", c.checkout + c.overdue], ["arrival", "Заезд сегодня", c.arrival], ["dirty", "Грязные", c.dirty], ["repair", "Ремонт", c.repair], ["block", "Блок", c.block], ["notes", "С заметкой", notes]];
  let floors = "";
  for (const f of FLOORS) {
    const rooms = ROOMS.filter(r => r.floor === f);
    const visible = rooms.filter(r => matchesFilter(r.num));
    if (!visible.length) continue;
    floors += `<div class="floor"><div class="floor-head"><b>${f} этаж</b><span>${rooms.filter(r => roomData(r.num).status === "occupied").length}/${rooms.length} занято</span></div><div class="room-grid">${rooms.map(r => roomTile(r, matchesFilter(r.num))).join("")}</div></div>`;
  }
  $("#view-rooms").innerHTML = `
    <div class="summary">
      <div class="s-free"><span>Свободно</span><b>${c.free}</b></div>
      <div class="s-occupied"><span>Занято</span><b>${c.occupied}</b></div>
      <div class="s-dirty"><span>Грязных</span><b>${c.dirty}</b></div>
      <div class="s-repair"><span>Ремонт</span><b>${c.repair}</b></div>
    </div>
    ${c.overdue ? `<button class="alert" data-filter="checkout">⚠ Просрочен выезд: ${ROOMS.filter(r => roomFlag(roomData(r.num)) === "overdue").map(r => r.num).join(", ")}</button>` : ""}
    ${prepList().length ? `<button class="alert prep" data-filter="arrival">🧹 Подготовить к заезду: ${prepList().map(r => `${r.num} (${roomData(r.num).status === "occupied" ? "ещё занят" : "грязный"})`).join(", ")}</button>` : ""}
    <div class="chip-row">${chips.map(([id, l, n]) => `<button class="chip ${state.roomFilter === id ? "active" : ""}" data-filter="${id}">${l} <small>${n}</small></button>`).join("")}</div>
    ${floors || `<div class="empty">Нет номеров с таким статусом</div>`}
    <div class="legend">${Object.entries(STATUS).map(([k, s]) => `<span><i class="${s.cls}"></i>${s.label}</span>`).join("")}<span><i class="flag-dot"></i>Выезд сегодня</span><span><i class="arr-dot">↓</i>Заезд сегодня</span><span><i class="note-dot"></i>Есть заметка</span></div>`;
}
// Rooms with an arrival today that are not ready yet: guest still inside or room not cleaned
function prepList() { return ROOMS.filter(r => { const rd = roomData(r.num); return arrivalFlag(rd) && (rd.status === "dirty" || rd.status === "occupied"); }); }
function roomTile(r, visible) {
  const rd = roomData(r.num), flag = roomFlag(rd), arr = arrivalFlag(rd);
  return `<button class="room ${STATUS[rd.status].cls} ${visible ? "" : "faded"} ${flag} ${arr}" data-room="${r.num}" aria-label="${roomLabel(r.num)}, ${STATUS[rd.status].label}">
    <b>${r.num}</b><small>${ROOM_TYPES[r.type]}</small>${rd.note ? `<i class="note-dot"></i>` : ""}${flag ? `<i class="flag-dot"></i>` : ""}${arr ? `<i class="arr-dot">↓</i>` : ""}</button>`;
}
function setRoomStatus(num, status) {
  const rd = { ...roomData(num) }, from = rd.status;
  if (from === status) return;
  rd.status = status;
  rd.since = status === "repair" || status === "block" ? today() : rd.since && (from === "repair" || from === "block") ? "" : rd.since;
  if (status !== "occupied") rd.checkout = "";
  if (status === "occupied" && arrivalFlag(rd)) { rd.arrival = ""; rd.arrivalTime = ""; }
  rd.updatedAt = Date.now();
  state.data.rooms[num] = rd;
  (state.data.shift ? state.data.shift.log : state.data.pendingLog).push({ t: Date.now(), room: num, from, to: status });
  recordTransition(state.data.stays, num, from, status, Date.now());
  save();
  vibrate(15);
}
function openRoom(num) {
  const r = ROOM_BY_NUM[num], rd = roomData(num), flag = roomFlag(rd), arr = arrivalFlag(rd);
  const quick = rd.status === "occupied" ? `<button class="btn" data-quick="dirty">Выехал → грязный</button>`
    : rd.status === "dirty" ? `<button class="btn" data-quick="free">Убран → свободен</button>`
    : rd.status === "free" ? `<button class="btn" data-quick="occupied">${arr ? "Гость заехал → занят" : "Заселить"}</button>` : "";
  const box = openModal(`
    <div class="sheet-head"><div><h3>${r.num}</h3><span>${ROOM_TYPE_NAMES[r.type]} · ${r.floor} этаж</span></div><span class="status-tag ${STATUS[rd.status].cls}">${STATUS[rd.status].label}</span></div>
    ${flag === "overdue" ? `<div class="warn">Выезд был ${shortDate(parseDate(rd.checkout))} — просрочен</div>` : flag === "checkout" ? `<div class="warn">Выезд сегодня</div>` : ""}
    ${rd.arrival ? `<div class="ok">${arr ? (rd.arrival < today() ? `Заезд ожидался ${shortDate(parseDate(rd.arrival))}` : "Заезд сегодня") : `Заезд ${shortDate(parseDate(rd.arrival))}`}${rd.arrivalTime ? " в " + rd.arrivalTime : ""}${arr && rd.status === "occupied" ? " — после выезда текущего гостя" : arr && rd.status === "dirty" ? " — нужна уборка" : ""}</div>` : ""}
    ${rd.since ? `<div class="muted small">${STATUS[rd.status].label} с ${shortDate(parseDate(rd.since))} (${Math.max(0, Math.round((parseDate(today()) - parseDate(rd.since)) / 86400000))} дн.)</div>` : ""}
    ${quick ? `<div class="quick">${quick}</div>` : ""}
    <div class="label">Статус</div>
    <div class="status-grid">${Object.entries(STATUS).map(([k, s]) => `<button class="status-btn ${s.cls} ${rd.status === k ? "active" : ""}" data-set-status="${k}">${s.label}</button>`).join("")}</div>
    <div class="field ${rd.status === "occupied" ? "" : "hidden"}" id="checkoutField"><label>Дата выезда</label>
      <div class="date-row"><input type="date" id="checkoutInput" value="${rd.checkout || ""}"><button class="chip" data-checkout="0">Сегодня</button><button class="chip" data-checkout="1">Завтра</button></div></div>
    <div class="field"><label>Заезд по брони <span class="muted">· можно вместе с выездом в тот же день</span></label>
      <div class="date-row"><input type="date" id="arrivalInput" value="${rd.arrival || ""}"><button class="chip" data-arrival="0">Сегодня</button><button class="chip" data-arrival="1">Завтра</button></div>
      <div class="date-row two"><input type="time" id="arrivalTime" value="${rd.arrivalTime || ""}" aria-label="Время заезда"><button class="chip" data-arrival="clear">Убрать заезд</button></div></div>
    <div class="field"><label>Заметка по номеру <span class="muted">· без личных данных гостей</span></label><textarea id="roomNote" rows="3" maxlength="400" placeholder="Например: течёт кран, вызвали техника; поздний выезд до 14:00">${esc(rd.note)}</textarea></div>
    <div class="modal-actions"><button class="btn secondary" data-to-shift>＋ В передачу смены</button><button class="btn" data-close>Готово</button></div>`);
  box.dataset.sheet = num;
  const noteEl = box.querySelector("#roomNote");
  noteEl.addEventListener("input", () => { const x = { ...roomData(num), note: noteEl.value.trim(), updatedAt: Date.now() }; state.data.rooms[num] = x; save(); });
  const setField = (k, v) => { state.data.rooms[num] = { ...roomData(num), [k]: v, updatedAt: Date.now() }; save(); };
  box.querySelector("#checkoutInput").addEventListener("change", e => setField("checkout", e.target.value));
  box.querySelector("#arrivalInput").addEventListener("change", e => { setField("arrival", e.target.value); openRoom(num); });
  box.querySelector("#arrivalTime").addEventListener("change", e => setField("arrivalTime", e.target.value));
}
function closeRoomSheet() { closeModal(); render(); }

/* ---------- shift handover ---------- */
function renderShift() {
  const sh = state.data.shift, items = sh ? sh.items : state.data.pending, open = items.filter(i => !i.done).length;
  const c = roomCounts();
  const repair = ROOMS.filter(r => ["repair", "block"].includes(roomData(r.num).status));
  const checkouts = ROOMS.filter(r => roomFlag(roomData(r.num)));
  const head = sh ? `
    <div class="card shift-card live">
      <div class="row"><div><span class="pill">● ${KIND[sh.kind]} смена</span><b class="big">с ${hmOf(new Date(sh.startedAt))}</b><span class="muted small">${fmt({ weekday: "short", day: "numeric", month: "long" }, new Date(sh.startedAt))} · идёт ${duration(Date.now() - sh.startedAt)}</span></div>
      <div class="right"><span class="muted small">Записей</span><b class="big">${items.length - open}/${items.length}</b><span class="muted small">выполнено</span></div></div>
      <button class="link edit-start" data-action="edit-shift">Изменить время / тип смены</button>
    </div>` : `
    <div class="card shift-card idle">
      <span class="muted small">Смена не начата</span>
      <b class="big">Начать смену</b>
      ${state.data.archive[0] ? `<span class="muted small">Прошлая закрыта ${fmt({ day: "numeric", month: "short" }, new Date(state.data.archive[0].closedAt))} в ${hmOf(new Date(state.data.archive[0].closedAt))}</span>` : ""}
      <div class="kind-row">${Object.entries(KIND).map(([k, l]) => `<button class="btn ${k === guessKind(new Date()) ? "" : "secondary"}" data-start="${k}">${k === "day" ? "☀" : "☾"} ${l}</button>`).join("")}</div>
      <span class="muted small">Время начала — сейчас, ${hmOf(new Date())}. Его можно поправить после старта.</span>
    </div>`;
  $("#view-shift").innerHTML = `
    ${head}
    <div class="section-head"><h3>${sh ? "Передать сменщику" : "Для следующей смены"}</h3><span>${items.length || ""}</span></div>
    <form class="add-row" id="itemForm" autocomplete="off">
      <input name="room" list="roomList" inputmode="numeric" placeholder="№" maxlength="4" class="room-input">
      <input name="text" placeholder="${sh ? "Что передать сменщику…" : "Заметка на следующую смену…"}" maxlength="300" required>
      <button class="btn add-btn" aria-label="Добавить">＋</button>
    </form>
    <datalist id="roomList">${ROOMS.map(r => `<option value="${r.num}">`).join("")}</datalist>
    <div class="list">${items.length ? items.map(itemRow).join("") : `<div class="empty">${sh ? "Записей пока нет. Добавляй сюда всё, что нужно передать: поздние выезды, просьбы гостей, проблемы, оплаты." : "Невыполненное с прошлой смены и заметки, записанные сейчас, появятся в новой смене."}</div>`}</div>

    ${sh ? `<div class="section-head"><h3>Автоматически в отчёт</h3></div>
    <div class="card info">
      <div><span>Занято / свободно / грязных</span><b>${c.occupied} / ${c.free} / ${c.dirty}</b></div>
      <div><span>Выезды сегодня</span><b>${checkouts.length ? checkouts.map(r => r.num + (roomFlag(roomData(r.num)) === "overdue" ? "⚠" : "")).join(", ") : "—"}</b></div>
      <div><span>Заезды сегодня</span><b>${ROOMS.filter(r => arrivalFlag(roomData(r.num))).map(r => r.num + (prepList().includes(r) ? "🧹" : "")).join(", ") || "—"}</b></div>
      <div><span>Ремонт / блок</span><b>${repair.length ? repair.map(r => r.num).join(", ") : "—"}</b></div>
      <div><span>Изменений статусов за смену</span><b>${netChanges(sh.log).length || "—"}</b></div>
    </div>
    <div class="btn-col">
      <button class="btn" data-action="report">📋 Посмотреть отчёт</button>
      <button class="btn secondary" data-action="close-shift">Закрыть смену</button>
    </div>` : ""}

    ${state.data.archive.length ? `<div class="section-head"><h3>Прошлые смены</h3><span>${state.data.archive.length}</span></div>
    <div class="list">${state.data.archive.slice(0, 30).map(a => `<button class="arch-row" data-archive="${a.id}"><b>${a.kind ? (a.kind === "day" ? "☀ " : "☾ ") : ""}${fmt({ day: "numeric", month: "short" }, new Date(a.startedAt))} ${hmOf(new Date(a.startedAt))} – ${hmOf(new Date(a.closedAt))}</b><span>${a.items.length} ${plural(a.items.length, "запись", "записи", "записей")}</span></button>`).join("")}</div>` : ""}`;
  $("#itemForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.currentTarget, text = f.elements.text.value.trim(), room = f.elements.room.value.trim();
    if (!text) return;
    if (room && !ROOM_BY_NUM[room]) return toast("Нет такого номера: " + room);
    addShiftItem(text, room);
    render();
    setTimeout(() => $("#itemForm [name=text]")?.focus(), 50);
  });
}
const duration = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; };
function addShiftItem(text, room) {
  (state.data.shift ? state.data.shift.items : state.data.pending).push({ id: uid(), text, room: room || "", done: false, createdAt: Date.now() });
  save();
}
function shiftItems() { return state.data.shift ? state.data.shift.items : state.data.pending; }
function startShift(kind) {
  state.data.shift = { id: uid(), startedAt: Date.now(), kind, items: state.data.pending, log: state.data.pendingLog };
  state.data.pending = []; state.data.pendingLog = [];
  save(); vibrate(20); render();
  toast(`${KIND[kind]} смена началась в ${hmOf(new Date())}`);
}
function editShiftDialog() {
  const sh = state.data.shift, d = new Date(sh.startedAt);
  const box = openModal(`<h3>Смена</h3><p class="muted">Если начал работу раньше, чем нажал «Начать смену».</p>
    <form class="form" id="shiftEdit">
      <div class="kind-row">${Object.entries(KIND).map(([k, l]) => `<label class="radio"><input type="radio" name="kind" value="${k}" ${sh.kind === k ? "checked" : ""}><span>${k === "day" ? "☀" : "☾"} ${l}</span></label>`).join("")}</div>
      <div class="date-row two"><input type="date" name="date" value="${dateISO(d)}" required><input type="time" name="time" value="${hmOf(d)}" required></div>
      <div class="modal-actions"><button type="button" class="btn danger" data-cancel-shift>Отменить смену</button><button class="btn">Сохранить</button></div>
    </form>`);
  box.querySelector("#shiftEdit").onsubmit = e => {
    e.preventDefault();
    const el = e.currentTarget.elements, t = parseDate(el.date.value), [h, m] = el.time.value.split(":").map(Number);
    t.setHours(h, m, 0, 0);
    if (t > new Date()) return toast("Начало не может быть в будущем");
    Object.assign(sh, { startedAt: t.getTime(), kind: el.kind.value });
    save(); closeModal(); render(); toast("Сохранено");
  };
  box.querySelector("[data-cancel-shift]").onclick = () => confirmModal("Отменить смену?", "Смена не попадёт в архив. Записи и изменения номеров перейдут в следующую смену.", "Отменить смену", () => {
    state.data.pending = [...sh.items, ...state.data.pending];
    state.data.pendingLog = [...sh.log, ...state.data.pendingLog];
    state.data.shift = null; save(); render(); toast("Смена отменена");
  });
}
function itemRow(i) {
  return `<div class="item ${i.done ? "done" : ""}">
    <button class="check" data-toggle-item="${i.id}" aria-label="Отметить">${i.done ? "✓" : ""}</button>
    <div class="item-body">${i.room ? `<span class="room-tag">${esc(i.room)}</span>` : ""}${esc(i.text)}<small>${i.carried ? "перенесено · " : ""}${hmOf(new Date(i.createdAt))}${i.carried ? " " + ddmm(new Date(i.createdAt)) : ""}</small></div>
    <button class="x" data-del-item="${i.id}" aria-label="Удалить">✕</button></div>`;
}
function reportText(sh = state.data.shift, closedAt = Date.now()) {
  const s = new Date(sh.startedAt), e = new Date(closedAt), L = [];
  L.push(`ПЕРЕДАЧА СМЕНЫ${sh.kind ? " · " + KIND[sh.kind].toLowerCase() : ""}`, `${ddmm(s)} ${hmOf(s)} – ${ddmm(e)} ${hmOf(e)}`, "");
  const open = sh.items.filter(i => !i.done), done = sh.items.filter(i => i.done);
  const line = (i, mark) => `${mark} ${i.room ? i.room + " — " : ""}${i.text}`;
  if (open.length) { L.push("НЕ ВЫПОЛНЕНО / ПЕРЕДАЮ:"); open.forEach(i => L.push(line(i, "▢"))); L.push(""); }
  if (done.length) { L.push("СДЕЛАНО:"); done.forEach(i => L.push(line(i, "✓"))); L.push(""); }
  const list = pred => ROOMS.filter(r => pred(roomData(r.num), r)).map(r => r.num);
  const repair = ROOMS.filter(r => ["repair", "block"].includes(roomData(r.num).status)).map(r => { const rd = roomData(r.num); return `${r.num}${rd.status === "block" ? " (блок)" : ""}${rd.since ? " с " + ddmm(parseDate(rd.since)) : ""}${rd.note ? " — " + rd.note : ""}`; });
  const c = roomCounts();
  L.push("НОМЕРА:", `Занято ${c.occupied}, свободно ${c.free}, заездов сегодня ${c.arrival}, грязных ${c.dirty}, ремонт ${c.repair}, блок ${c.block}`);
  const sIn = state.data.stays.filter(x => !x.approx && x.in >= sh.startedAt && x.in <= closedAt).length, sOut = state.data.stays.filter(x => x.out && x.out >= sh.startedAt && x.out <= closedAt).length;
  if (sIn || sOut) L.push(`За смену: заселений ${sIn}, выездов ${sOut}`);
  const out = list(rd => roomFlag(rd) === "checkout"), late = list(rd => roomFlag(rd) === "overdue"), booked = ROOMS.filter(r => arrivalFlag(roomData(r.num))).map(r => { const rd = roomData(r.num); return r.num + (rd.arrivalTime ? " " + rd.arrivalTime : "") + (rd.status === "occupied" ? " (после выезда)" : rd.status === "dirty" ? " (не убран)" : ""); }), dirty = list(rd => rd.status === "dirty");
  if (out.length) L.push(`Выезд сегодня: ${out.join(", ")}`);
  if (late.length) L.push(`Просрочен выезд: ${late.join(", ")}`);
  if (booked.length) L.push(`Заезды сегодня: ${booked.join(", ")}`);
  if (dirty.length) L.push(`Грязные: ${dirty.join(", ")}`);
  if (repair.length) { L.push("Ремонт / блок:"); repair.forEach(x => L.push("• " + x)); }
  const notes = ROOMS.filter(r => roomData(r.num).note && !["repair", "block"].includes(roomData(r.num).status));
  if (notes.length) { L.push("", "ЗАМЕТКИ ПО НОМЕРАМ:"); notes.forEach(r => L.push(`• ${r.num} — ${roomData(r.num).note}`)); }
  const changes = netChanges(sh.log);
  if (changes.length) { L.push("", "ИЗМЕНЕНИЯ ЗА СМЕНУ:"); changes.forEach(l => L.push(`${hmOf(new Date(l.t))} ${l.room}: ${l.path.map(statusLabel).join(" → ")}`)); }
  return L.join("\n").trim();
}
// One line per room with the whole chain of the shift (e.g. Занят → Грязный → Свободен → Занят for a same-day turnover);
// a status set and then undone (A → B → A with nothing else) is dropped
function netChanges(log) {
  const by = new Map();
  log.forEach(l => {
    const p = by.get(l.room);
    if (!p) return by.set(l.room, { room: l.room, t: l.t, path: [l.from, l.to] });
    if (p.path[p.path.length - 1] !== l.to) p.path.push(l.to);
    p.t = l.t;
  });
  return [...by.values()].filter(l => l.path.length > 3 || l.path[0] !== l.path[l.path.length - 1]).sort((a, b) => a.t - b.t);
}
function showReport(text, title = "Отчёт за смену") {
  const box = openModal(`<h3>${title}</h3><p class="muted small">Можно переписать в журнал, скопировать или отправить.</p><pre class="report">${esc(text)}</pre>
    <div class="modal-actions"><button class="btn secondary" data-copy>Копировать</button>${navigator.share ? `<button class="btn secondary" data-share>Отправить</button>` : ""}<button class="btn" data-close>Закрыть</button></div>`);
  box.querySelector("[data-copy]").onclick = () => copy(text);
  const sh = box.querySelector("[data-share]");
  if (sh) sh.onclick = () => navigator.share({ text }).catch(() => {});
}
function closeShift() {
  const sh = state.data.shift, closedAt = Date.now();
  const text = reportText(sh, closedAt);
  state.data.archive.unshift({ id: sh.id, startedAt: sh.startedAt, closedAt, kind: sh.kind, items: sh.items, log: sh.log, text });
  state.data.archive = state.data.archive.slice(0, ARCHIVE_LIMIT);
  const carried = sh.items.filter(i => !i.done).map(i => ({ ...i, carried: true }));
  state.data.pending = [...carried, ...state.data.pending];
  state.data.shift = null;
  save();
  render();
  showReport(text, "Смена закрыта");
  toast(carried.length ? `Смена закрыта. В следующую смену перейдёт: ${carried.length}` : "Смена закрыта");
}

/* ---------- statistics ---------- */
const DAY = 86400000;
const nightsOf = (st, until = Date.now()) => Math.round((parseDate(dateISO(new Date(st.out || until))) - parseDate(dateISO(new Date(st.in)))) / DAY);
const nightsWord = n => `${n} ${plural(n, "ночь", "ночи", "ночей")}`;
const dec = n => (Math.round(n * 10) / 10).toString().replace(".", ",");
function lastStay(stays, num) { for (let i = stays.length - 1; i >= 0; i--) if (stays[i].room === num) return stays[i]; return null; }
// Becoming "Занят" opens a stay, leaving "Занят" closes it. A wrong tap undone within minutes leaves no fake stay
function recordTransition(stays, num, from, to, t) {
  if (to === "occupied" && from !== "occupied") {
    const last = lastStay(stays, num);
    if (last && last.out && last.closedTo === from && t - last.out < 30 * 60000) { last.out = null; delete last.closedTo; return; }
    stays.push({ id: uid(), room: num, in: t, out: null });
  } else if (from === "occupied" && to !== "occupied") {
    const last = lastStay(stays, num);
    if (!last || last.out) return;
    if (!last.approx && t - last.in < 10 * 60000) { stays.splice(stays.indexOf(last), 1); return; }
    last.out = t; last.closedTo = to;
  }
}
function rebuildStays(d) {
  const stays = [], logs = [...d.archive.flatMap(a => a.log || []), ...(d.shift ? d.shift.log : []), ...d.pendingLog].sort((a, b) => a.t - b.t);
  logs.forEach(l => recordTransition(stays, l.room, l.from, l.to, l.t));
  // Rooms already occupied before tracking started get a stay with an approximate check-in date
  Object.entries(d.rooms).forEach(([num, rd]) => {
    const last = lastStay(stays, num);
    if (rd.status === "occupied" && (!last || last.out)) stays.push({ id: uid(), room: num, in: rd.updatedAt || Date.now(), out: null, approx: true });
    if (rd.status !== "occupied" && last && !last.out) last.out = rd.updatedAt || Date.now();
  });
  return { stays, since: logs.length ? logs[0].t : Date.now() };
}
function statsRange() {
  const now = new Date(), o = state.statsOffset;
  if (state.statsMode === "week") { const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7 + o * 7); return [s, addDays(s, 7)]; }
  if (state.statsMode === "year") return [new Date(now.getFullYear() + o, 0, 1), new Date(now.getFullYear() + o + 1, 0, 1)];
  const s = new Date(now.getFullYear(), now.getMonth() + o, 1);
  return [s, new Date(s.getFullYear(), s.getMonth() + 1, 1)];
}
function statsLabel([a, b]) {
  if (state.statsMode === "year") return String(a.getFullYear());
  if (state.statsMode === "week") return `${shortDate(a)} – ${shortDate(addDays(b, -1))}`;
  return fmt({ month: "long", year: "numeric" }, a).replace(/\s?г\.?$/, "");
}
const stayDates = st => `${shortDate(new Date(st.in))} ${hmOf(new Date(st.in))}${st.approx ? "≈" : ""} → ${st.out ? shortDate(new Date(st.out)) + " " + hmOf(new Date(st.out)) : "живёт"}`;
// Rooms occupied on the night of the given date
function occupiedOn(iso, end) { return state.data.stays.filter(st => dateISO(new Date(st.in)) <= iso && (st.out ? dateISO(new Date(st.out)) > iso : iso <= end)).length; }
function renderStats() {
  const [a, b] = statsRange(), A = a.getTime(), B = b.getTime(), st = state.data.stays, t = today(), mode = state.statsMode;
  const ins = st.filter(x => !x.approx && x.in >= A && x.in < B), outs = st.filter(x => x.out && x.out >= A && x.out < B);
  const nights = outs.map(x => nightsOf(x)), avgN = nights.length ? nights.reduce((x, y) => x + y, 0) / nights.length : 0;
  const days = [];
  for (let d = new Date(a); d < b && dateISO(d) <= t; d = addDays(d, 1)) days.push(dateISO(d));
  const occ = days.map(iso => occupiedOn(iso, t)), avgOcc = occ.length ? occ.reduce((x, y) => x + y, 0) / occ.length : 0;
  const pct = n => Math.round(n / ROOMS.length * 100);
  const sameDay = (ms, iso) => dateISO(new Date(ms)) === iso;
  let bars;
  if (mode === "year") {
    bars = Array.from({ length: 12 }, (_, m) => {
      const v = occ.filter((_, i) => Number(days[i].slice(5, 7)) === m + 1), n = ins.filter(x => new Date(x.in).getMonth() === m).length;
      const avg = v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
      return { label: fmt({ month: "narrow" }, new Date(a.getFullYear(), m, 1)), v: avg, show: true, tip: `${fmt({ month: "long" }, new Date(a.getFullYear(), m, 1))}: загрузка ${avg === null ? "—" : pct(avg) + "%"}, заселений ${n}` };
    });
  } else {
    bars = [];
    for (let d = new Date(a), i = 0; d < b; d = addDays(d, 1), i++) {
      const iso = dateISO(d), k = days.indexOf(iso), n = ins.filter(x => sameDay(x.in, iso)).length, o = outs.filter(x => sameDay(x.out, iso)).length;
      bars.push({ label: mode === "week" ? fmt({ weekday: "short" }, d) : String(d.getDate()), v: k >= 0 ? occ[k] : null, show: mode === "week" || i % 5 === 0, tip: `${fmt({ weekday: "short", day: "numeric", month: "short" }, d)}: занято ${k >= 0 ? occ[k] + " (" + pct(occ[k]) + "%)" : "—"}, заселений ${n}, выездов ${o}` });
    }
  }
  const byType = Object.keys(ROOM_TYPES).map(type => {
    const i = ins.filter(x => ROOM_BY_NUM[x.room]?.type === type).length, o = outs.filter(x => ROOM_BY_NUM[x.room]?.type === type).map(x => nightsOf(x));
    return { type, i, avg: o.length ? o.reduce((x, y) => x + y, 0) / o.length : 0, rooms: ROOMS.filter(r => r.type === type).length };
  });
  const buckets = [["Дневное (0)", n => n === 0], ["1 ночь", n => n === 1], ["2 ночи", n => n === 2], ["3 ночи", n => n === 3], ["4–6 ночей", n => n >= 4 && n <= 6], ["7+ ночей", n => n >= 7]].map(([l, f]) => [l, nights.filter(f).length]);
  const maxB = Math.max(1, ...buckets.map(x => x[1]));
  const wd = [0, 0, 0, 0, 0, 0, 0]; ins.forEach(x => { wd[(new Date(x.in).getDay() + 6) % 7]++; });
  const maxW = Math.max(1, ...wd);
  const living = st.filter(x => !x.out).sort((x, y) => x.in - y.in);
  const journal = st.slice().sort((x, y) => y.in - x.in).slice(0, 25);
  $("#view-stats").innerHTML = `
    <div class="segmented">${[["week", "Неделя"], ["month", "Месяц"], ["year", "Год"]].map(([id, l]) => `<button class="${mode === id ? "active" : ""}" data-stats="${id}">${l}</button>`).join("")}</div>
    <div class="period-nav"><button class="icon-mini" data-period="-1" aria-label="Назад">‹</button><strong>${statsLabel([a, b])}</strong><button class="icon-mini" data-period="1" ${state.statsOffset >= 0 ? "disabled" : ""} aria-label="Вперёд">›</button></div>
    <div class="stat-grid">
      <div><span>Заселений</span><b>${ins.length}</b></div>
      <div><span>Выездов</span><b>${outs.length}</b></div>
      <div><span>Средний срок</span><b>${outs.length ? dec(avgN) : "—"}</b><small>${outs.length ? plural(Math.round(avgN), "ночь", "ночи", "ночей") : ""}</small></div>
      <div><span>Загрузка</span><b>${occ.length ? pct(avgOcc) + "%" : "—"}</b><small>${occ.length ? "≈" + Math.round(avgOcc) + " из " + ROOMS.length : ""}</small></div>
    </div>
    <div class="card"><div class="section-head top"><h3>Загрузка по ${mode === "year" ? "месяцам" : "дням"}</h3><span>высота — % занятых</span></div>
      <div class="bars">${bars.map(x => `<button class="bar-col" data-bar="${esc(x.tip)}"><i style="height:${x.v === null ? 0 : Math.max(2, x.v / ROOMS.length * 100)}%" class="${x.v === null ? "" : pct(x.v) >= 85 ? "hi" : ""}"></i><small>${x.show ? x.label : ""}</small></button>`).join("")}</div>
    </div>
    <div class="section-head"><h3>По типам номеров</h3></div>
    <div class="card table">
      <div class="tr th"><span>Тип</span><span>Заселений</span><span>Ср. срок</span></div>
      ${byType.map(x => `<div class="tr"><span><b>${ROOM_TYPES[x.type]}</b> ${ROOM_TYPE_NAMES[x.type]} <small>(${x.rooms})</small></span><span>${x.i}</span><span>${x.avg ? dec(x.avg) + " н." : "—"}</span></div>`).join("")}
    </div>
    <div class="section-head"><h3>Сколько живут</h3><span>по выездам</span></div>
    <div class="card hbars">${buckets.map(([l, n]) => `<div class="hb"><span>${l}</span><div><i style="width:${n / maxB * 100}%"></i></div><b>${n}</b></div>`).join("")}</div>
    <div class="section-head"><h3>Заселения по дням недели</h3></div>
    <div class="card hbars">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((l, i) => `<div class="hb"><span>${l}</span><div><i style="width:${wd[i] / maxW * 100}%"></i></div><b>${wd[i]}</b></div>`).join("")}</div>
    <div class="section-head"><h3>Сейчас живут</h3><span>${living.length}</span></div>
    <div class="list">${living.length ? living.slice(0, 10).map(x => { const rd = roomData(x.room); return `<div class="item"><span class="room-tag">${x.room}</span><div class="item-body">${nightsWord(nightsOf(x))}${x.approx ? " (≈)" : ""}<small>с ${shortDate(new Date(x.in))}${rd.checkout ? " · выезд " + shortDate(parseDate(rd.checkout)) : ""}</small></div></div>`; }).join("") : `<div class="empty">Сейчас нет занятых номеров</div>`}</div>
    <div class="section-head"><h3>Журнал заселений</h3><span>последние ${journal.length}</span></div>
    <div class="list">${journal.length ? journal.map(x => `<div class="item"><span class="room-tag">${x.room}</span><div class="item-body">${stayDates(x)}<small>${x.out ? nightsWord(nightsOf(x)) : "живёт " + nightsWord(nightsOf(x))}</small></div><button class="x" data-del-stay="${x.id}" aria-label="Удалить">✕</button></div>`).join("") : `<div class="empty">Записей пока нет. Отмечай номера «Занят» при заселении и «Выехал» при выезде — статистика соберётся сама.</div>`}</div>
    <p class="notice">Статистика ведётся с ${fmt({ day: "numeric", month: "long", year: "numeric" }, new Date(state.data.statsSince))}. Заселение — номер стал «Занят», выезд — номер перестал быть «Занят». Ошибочное нажатие, исправленное в течение нескольких минут, не считается. ≈ — номер был занят до начала учёта, дата заезда примерная.</p>`;
}

/* ---------- more: contacts, cheat sheet, backup ---------- */
function renderMore() {
  const d = state.data, last = d.settings.lastBackupAt;
  $("#view-more").innerHTML = `
    <div class="section-head top"><h3>Контакты</h3><button class="link" data-action="add-contact">＋ Добавить</button></div>
    <div class="list">${d.contacts.length ? d.contacts.map(c => `<div class="item contact"><a class="call" href="tel:${esc(c.phone.replace(/[^\d+]/g, ""))}">📞</a><div class="item-body"><b>${esc(c.name)}</b><small>${esc(c.phone)}${c.note ? " · " + esc(c.note) : ""}</small></div><button class="x" data-edit-contact="${c.id}" aria-label="Изменить">✎</button></div>`).join("") : `<div class="empty">Добавь нужные номера: техник, горничные, менеджер, такси, охрана</div>`}</div>

    <div class="section-head"><h3>Шпаргалка</h3><button class="link" data-action="add-tip">＋ Добавить</button></div>
    <div class="list">${d.tips.length ? d.tips.map(t => `<div class="tip"><button class="tip-body" data-copy-tip="${t.id}"><b>${esc(t.title)}</b><span>${esc(t.text)}</span></button><button class="x" data-edit-tip="${t.id}" aria-label="Изменить">✎</button></div>`).join("") : `<div class="empty">Время завтрака, правила, готовые ответы гостям. Нажатие копирует текст</div>`}</div>

    <div class="section-head"><h3>Данные</h3></div>
    ${backupBanner()}
    <div class="setting"><div><b>Резервная копия</b><span>${last ? "Последняя: " + fmt({ day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }, new Date(last)) : "Ещё не делалась"}</span></div><button class="btn small" data-action="backup">Сохранить</button></div>
    <div class="setting"><div><b>Восстановить из копии</b><span>Заменит текущие данные</span></div><button class="mini" data-action="import">Файл</button></div>
    <div class="setting danger"><div><b>Сбросить статусы номеров</b><span>Все номера станут «Свободен», заметки удалятся</span></div><button class="mini" data-action="reset-rooms">Сброс</button></div>
    <p class="notice">FrontDesk ${APP_VERSION}. Данные хранятся только на этом телефоне. Не записывай сюда фамилии, паспорта и телефоны гостей — только номера комнат и рабочие заметки.</p>`;
}
function backupBanner() {
  const last = state.data.settings.lastBackupAt || 0, days = Math.floor((Date.now() - last) / 86400000);
  if (last && days < BACKUP_REMIND_DAYS) return "";
  return `<div class="banner">${last ? `Копия не сохранялась ${days} ${plural(days, "день", "дня", "дней")}` : "Резервной копии ещё нет"}. Сохрани файл в Telegram «Избранное» или Google Диск.</div>`;
}
function editContact(id) {
  const c = state.data.contacts.find(x => x.id === id) || { name: "", phone: "", note: "" };
  const box = openModal(`<h3>${id ? "Контакт" : "Новый контакт"}</h3><form class="form" id="cForm" autocomplete="off">
    <input name="name" placeholder="Кто: техник, горничная…" value="${esc(c.name)}" required maxlength="60">
    <input name="phone" type="tel" placeholder="Телефон" value="${esc(c.phone)}" required maxlength="30">
    <input name="note" placeholder="Примечание (необязательно)" value="${esc(c.note)}" maxlength="80">
    <div class="modal-actions">${id ? `<button type="button" class="btn danger" data-del>Удалить</button>` : `<button type="button" class="btn secondary" data-close>Отмена</button>`}<button class="btn">Сохранить</button></div></form>`);
  box.querySelector("#cForm").onsubmit = e => {
    e.preventDefault(); const el = e.currentTarget.elements;
    const x = { id: id || uid(), name: el.name.value.trim(), phone: el.phone.value.trim(), note: el.note.value.trim() };
    const i = state.data.contacts.findIndex(y => y.id === x.id);
    i >= 0 ? (state.data.contacts[i] = x) : state.data.contacts.push(x);
    save(); closeModal(); render();
  };
  const del = box.querySelector("[data-del]");
  if (del) del.onclick = () => { state.data.contacts = state.data.contacts.filter(y => y.id !== id); save(); closeModal(); render(); };
}
function editTip(id) {
  const t = state.data.tips.find(x => x.id === id) || { title: "", text: "" };
  const box = openModal(`<h3>${id ? "Шпаргалка" : "Новая запись"}</h3><form class="form" id="tForm" autocomplete="off">
    <input name="title" placeholder="Заголовок: Завтрак, Check-out…" value="${esc(t.title)}" required maxlength="60">
    <textarea name="text" rows="5" placeholder="Текст" required maxlength="1000">${esc(t.text)}</textarea>
    <div class="modal-actions">${id ? `<button type="button" class="btn danger" data-del>Удалить</button>` : `<button type="button" class="btn secondary" data-close>Отмена</button>`}<button class="btn">Сохранить</button></div></form>`);
  box.querySelector("#tForm").onsubmit = e => {
    e.preventDefault(); const el = e.currentTarget.elements;
    const x = { id: id || uid(), title: el.title.value.trim(), text: el.text.value.trim() };
    const i = state.data.tips.findIndex(y => y.id === x.id);
    i >= 0 ? (state.data.tips[i] = x) : state.data.tips.push(x);
    save(); closeModal(); render();
  };
  const del = box.querySelector("[data-del]");
  if (del) del.onclick = () => { state.data.tips = state.data.tips.filter(y => y.id !== id); save(); closeModal(); render(); };
}
async function exportBackup() {
  const name = `frontdesk_${today()}.json`;
  const blob = new Blob([JSON.stringify({ app: "FrontDesk", exportedAt: new Date().toISOString(), data: state.data }, null, 2)], { type: "application/json" });
  try {
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "FrontDesk — резервная копия" }); return markBackup(); }
  } catch (e) { if (e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  markBackup();
}
function markBackup() { state.data.settings.lastBackupAt = Date.now(); save(); toast("Копия сохранена"); render(); }
function importBackup() {
  const input = document.createElement("input");
  input.type = "file"; input.accept = ".json,application/json,text/plain";
  input.onchange = async () => {
    try {
      const raw = JSON.parse(await input.files[0].text()), d = raw.data || raw;
      if (!d.rooms && !d.shift) throw Error("bad");
      confirmModal("Восстановить из копии?", `Копия от ${raw.exportedAt ? fmt({ day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }, new Date(raw.exportedAt)) : "неизвестной даты"}. Текущие данные будут заменены.`, "Восстановить", () => { state.data = normalize(d); save(); render(); toast("Данные восстановлены"); });
    } catch { toast("Не удалось прочитать файл"); }
  };
  input.click();
}

/* ---------- ui primitives ---------- */
function toast(text) {
  const el = $("#toast"); el.textContent = text; el.classList.add("show");
  clearTimeout(window.__toast); window.__toast = setTimeout(() => el.classList.remove("show"), 2400);
}
function openModal(html) {
  $("#modalRoot").innerHTML = `<div class="modal-backdrop" id="modal"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const m = $("#modal");
  m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close]")) { closeModal(); render(); } });
  return m.querySelector(".modal");
}
function closeModal() { $("#modalRoot").innerHTML = ""; }
function confirmModal(title, text, ok, onOk) {
  const box = openModal(`<h3>${title}</h3><p class="muted">${text}</p><div class="modal-actions"><button class="btn secondary" data-close>Отмена</button><button class="btn" data-ok>${ok}</button></div>`);
  box.querySelector("[data-ok]").onclick = () => { closeModal(); onOk(); };
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Скопировано"); }
  catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); toast("Скопировано"); }
}

/* ---------- events ---------- */
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#modal")) { closeModal(); render(); } });
document.addEventListener("click", e => {
  const q = s => e.target.closest(s);
  let el;
  if ((el = q("[data-nav]"))) return go(el.dataset.nav);
  if ((el = q("[data-filter]"))) { state.roomFilter = state.roomFilter === el.dataset.filter && el.dataset.filter !== "all" ? "all" : el.dataset.filter; return render(); }
  if ((el = q("[data-room]"))) return openRoom(el.dataset.room);
  if ((el = q("[data-set-status]")) || (el = q("[data-quick]"))) {
    const box = el.closest(".modal"), num = box.dataset.sheet;
    setRoomStatus(num, el.dataset.setStatus || el.dataset.quick);
    if (el.dataset.quick && el.dataset.quick !== "occupied") { closeRoomSheet(); return toast(`${num}: ${STATUS[el.dataset.quick].label}`); }
    return openRoom(num);
  }
  if ((el = q("[data-checkout]"))) {
    const box = el.closest(".modal"), num = box.dataset.sheet, v = dateISO(addDays(new Date(), Number(el.dataset.checkout)));
    state.data.rooms[num] = { ...roomData(num), checkout: v, updatedAt: Date.now() }; save();
    box.querySelector("#checkoutInput").value = v; return;
  }
  if ((el = q("[data-arrival]"))) {
    const num = el.closest(".modal").dataset.sheet, v = el.dataset.arrival;
    state.data.rooms[num] = { ...roomData(num), arrival: v === "clear" ? "" : dateISO(addDays(new Date(), Number(v))), ...(v === "clear" ? { arrivalTime: "" } : {}), updatedAt: Date.now() };
    save(); return openRoom(num);
  }
  if ((el = q("[data-to-shift]"))) {
    const box = el.closest(".modal"), num = box.dataset.sheet, note = box.querySelector("#roomNote").value.trim();
    closeModal();
    go("shift");
    const f = $("#itemForm"); f.elements.room.value = num; f.elements.text.value = note; f.elements.text.focus();
    return;
  }
  if ((el = q("[data-toggle-item]"))) { const i = shiftItems().find(x => x.id === el.dataset.toggleItem); i.done = !i.done; save(); vibrate(10); return render(); }
  if ((el = q("[data-del-item]"))) { const xs = shiftItems(), i = xs.findIndex(x => x.id === el.dataset.delItem); if (i >= 0) xs.splice(i, 1); save(); return render(); }
  if ((el = q("[data-start]"))) return startShift(el.dataset.start);
  if ((el = q("[data-stats]"))) { state.statsMode = el.dataset.stats; state.statsOffset = 0; return render(); }
  if ((el = q("[data-period]"))) { state.statsOffset = Math.min(0, state.statsOffset + Number(el.dataset.period)); return render(); }
  if ((el = q("[data-bar]"))) return toast(el.dataset.bar);
  if ((el = q("[data-del-stay]"))) {
    const st = state.data.stays.find(x => x.id === el.dataset.delStay);
    return confirmModal("Удалить запись?", `${st.room}: ${stayDates(st)}. Удаляй, только если это ошибка — например, номер отметили занятым по ошибке.`, "Удалить", () => { state.data.stays = state.data.stays.filter(x => x !== st); save(); render(); });
  }
  if ((el = q("[data-archive]"))) { const a = state.data.archive.find(x => x.id === el.dataset.archive); return showReport(a.text, "Смена " + fmt({ day: "numeric", month: "long" }, new Date(a.startedAt))); }
  if ((el = q("[data-edit-contact]"))) return editContact(el.dataset.editContact);
  if ((el = q("[data-edit-tip]"))) return editTip(el.dataset.editTip);
  if ((el = q("[data-copy-tip]"))) return copy(state.data.tips.find(t => t.id === el.dataset.copyTip).text);
  if ((el = q("[data-action]"))) {
    const a = el.dataset.action;
    if (a === "report") return showReport(reportText());
    if (a === "close-shift") return confirmModal("Закрыть смену?", "Отчёт сохранится в «Прошлые смены», невыполненное перейдёт в следующую смену. Статусы номеров не меняются.", "Закрыть смену", closeShift);
    if (a === "edit-shift") return editShiftDialog();
    if (a === "add-contact") return editContact(null);
    if (a === "add-tip") return editTip(null);
    if (a === "backup") return exportBackup();
    if (a === "import") return importBackup();
    if (a === "reset-rooms") return confirmModal("Сбросить все номера?", "Все 53 номера станут «Свободен», даты выезда и заметки по номерам удалятся.", "Сбросить", () => { state.data.stays.forEach(x => { if (!x.out) x.out = Date.now(); }); state.data.rooms = {}; save(); render(); toast("Статусы сброшены"); });
  }
});

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !$("#modal")) render(); });

async function boot() {
  await load();
  history.replaceState({ view: "rooms" }, "");
  render();
  requestPersist();
  // Re-render after midnight so "выезд сегодня" marks stay correct
  let day = today();
  setInterval(() => { if (today() !== day && !$("#modal")) { day = today(); render(); } }, 60000);
  if ("serviceWorker" in navigator) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (had && !$("#modal")) location.reload(); });
  }
}
boot();
