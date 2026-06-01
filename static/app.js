//由claude生成

//全局状态
let ledger = { meta: {}, months: {} };  // 内存账本（唯一真相，写入前）
let statsCache = { months: {}, quarters: {}, types: [] };
let TYPES = [];                          // 消费类型清单（来自后端）
let today = "";                          // 北京当天 YYYY/MM/DD
let viewMode = "month";                  // "month" | "quarter"
let currentMonth = "";                   // 选中月份键 YYYY/MM
let editingId = null;                    // 正在编辑的条目 id（null=新增模式）
let dirty = false;
let pieChart = null;

// 饼图低饱和暖色板（与 TYPES 顺序对应）
const PIE_COLORS = [
  "#c9a05f", "#c08a6b", "#b8826f", "#a7905f", "#cdb07a",
  "#93a283", "#b89a86", "#c4a77c", "#9a8f6e", "#bdb09a",
];

// ---------- 工具 ----------
const $ = (id) => document.getElementById(id);
const fmt = (n) => (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString("zh-CN");
const uid = () => "e_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function setDirty(v) {
  dirty = v;
  $("dirty-flag").classList.toggle("hidden", !v);
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 2200);
}

// 通用确认弹窗 -> Promise<boolean>
function confirmModal(text) {
  return new Promise((resolve) => {
    $("modal-text").textContent = text;
    $("modal").classList.remove("hidden");
    const ok = $("modal-ok"), cancel = $("modal-cancel");
    const close = (val) => {
      $("modal").classList.add("hidden");
      ok.onclick = cancel.onclick = null;
      resolve(val);
    };
    ok.onclick = () => close(true);
    cancel.onclick = () => close(false);
  });
}

async function api(path, opts, label) {
  const tag = label || path;            // 接口名，用于日志定位
  let res;
  try {
    res = await fetch(path, opts);
  } catch (netErr) {
    // 网络层失败：后端没起、端口不通、断线等
    console.error(`[API 失败] ${tag} (${path}) 网络错误：`, netErr);
    throw new Error(`无法连接后端（${tag}）：${netErr.message}`);
  }

  // 尝试解析返回体（无论成功失败都先拿到内容，便于记录与提取 error）
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { /* 非 JSON，保留 raw */ }

  if (!res.ok) {
    const reason = (data && data.error) || raw || res.statusText;
    console.error(
      `[API 失败] ${tag} (${path}) HTTP ${res.status}\n返回内容：`,
      data ?? raw
    );
    throw new Error(reason);
  }
  return data;
}

// ---------- 季度推导 ----------
function quarterKeyOf(monthKey) {
  const [y, m] = monthKey.split("/");
  return `${y}/Q${Math.floor((parseInt(m, 10) - 1) / 3) + 1}`;
}

// ---------- 初始化 ----------
async function init() {
  // 下拉类型选项
  // （先拉 today + ledger，types 随首个 stats 返回；这里先用本地常量兜底其实没有，
  //   所以改为：types 由 /api/stats 返回后填充。先空跑一次拿到 types。）
  const t = await api("/api/today", undefined, "获取北京时间");
  today = t.date;
  $("today").textContent = today;
  $("entry-date").textContent = today;
  // 新增月份输入框默认本月
  $("new-month-input").value = today.slice(0, 7).replace("/", "-");

  ledger = await api("/api/ledger", undefined, "读取账本");
  if (!ledger.months) ledger = { meta: {}, months: {} };

  await recompute();                 // 顺便拿到 TYPES
  fillTypeSelects();

  const keys = monthKeys();
  currentMonth = keys.length ? keys[keys.length - 1] : "";
  renderMonthSelect();
  renderAll();
  refreshBackups();
  bindEvents();
}

function monthKeys() {
  return Object.keys(ledger.months).sort();
}

function fillTypeSelects() {
  for (const sel of [$("entry-type"), $("fx-type")]) {
    sel.innerHTML = "";
    for (const t of TYPES) {
      const o = document.createElement("option");
      o.value = o.textContent = t;
      sel.appendChild(o);
    }
  }
}

// ---------- 统计（交给后端 stats.py 实时计算）----------
async function recompute() {
  statsCache = await api("/api/stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ledger),
  }, "统计计算");
  TYPES = statsCache.types || TYPES;
}

// ---------- 渲染：月份下拉 ----------
function renderMonthSelect() {
  const sel = $("month-select");
  sel.innerHTML = "";
  const keys = monthKeys();
  if (!keys.length) {
    const o = document.createElement("option");
    o.textContent = "（暂无月份，请先新增）";
    sel.appendChild(o);
    return;
  }
  for (const k of keys) {
    const o = document.createElement("option");
    o.value = k; o.textContent = k;
    sel.appendChild(o);
  }
  sel.value = currentMonth;
}

// ---------- 渲染：全部右侧 ----------
function renderAll() {
  renderScope();
  renderSummary();
  renderPie();
  renderFixed();
  renderAllowance();
  renderEntries();
}

function currentSummary() {
  if (!currentMonth) return null;
  if (viewMode === "month") return statsCache.months[currentMonth] || null;
  return statsCache.quarters[quarterKeyOf(currentMonth)] || null;
}

function renderScope() {
  if (!currentMonth) { $("scope-label").textContent = "暂无数据"; return; }
  if (viewMode === "month") {
    $("scope-label").textContent = `月度 · ${currentMonth}`;
    $("entries-title").textContent = "本月账目";
  } else {
    $("scope-label").textContent = `季度 · ${quarterKeyOf(currentMonth)}`;
    $("entries-title").textContent = "本季度账目（按月汇总，仅查看）";
  }
}

function renderSummary() {
  const s = currentSummary() || { income: 0, expense: 0, balance: 0, fixed_total: 0, entries_total: 0 };
  $("sum-income").textContent = fmt(s.income);
  $("sum-expense").textContent = fmt(s.expense);
  $("sum-balance").textContent = fmt(s.balance);
  $("bd-fixed").textContent = fmt(s.fixed_total);
  $("bd-entries").textContent = fmt(s.entries_total);
}

function renderPie() {
  const s = currentSummary();
  const empty = $("chart-empty");
  const canvas = $("pie");
  const data = s ? s.by_type : {};
  const labels = [], values = [], colors = [];
  TYPES.forEach((t, i) => {
    const v = data[t] || 0;
    if (v > 0) { labels.push(t); values.push(v); colors.push(PIE_COLORS[i % PIE_COLORS.length]); }
  });

  if (!labels.length) {
    empty.classList.remove("hidden");
    canvas.style.display = "none";
    if (pieChart) { pieChart.destroy(); pieChart = null; }
    return;
  }
  empty.classList.add("hidden");
  canvas.style.display = "block";

  if (pieChart) pieChart.destroy();
  pieChart = new Chart(canvas, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: "#f8efe0", borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "58%",
      plugins: {
        legend: { position: "right", labels: { color: "#5b4f40", font: { size: 12 }, boxWidth: 12, padding: 10 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = values.reduce((a, b) => a + b, 0);
              const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return ` ${ctx.label}：¥${fmt(ctx.parsed)}（${pct}%）`;
            },
          },
        },
      },
    },
  });
}

// ---------- 渲染：生活费 / 固定支出 ----------
function renderAllowance() {
  const m = ledger.months[currentMonth];
  $("allowance").value = m ? (m.allowance ?? "") : "";
  $("allowance").disabled = !m;
}

function renderFixed() {
  const wrap = $("fixed-list");
  wrap.innerHTML = "";
  const m = ledger.months[currentMonth];
  const list = m ? (m.fixed || []) : [];
  if (!list.length) {
    wrap.innerHTML = `<p class="field-note">尚无固定支出</p>`;
    return;
  }
  list.forEach((fx, idx) => {
    const row = document.createElement("div");
    row.className = "fixed-item";
    row.innerHTML = `
      <span class="fx-name"></span>
      <span class="fx-tag"></span>
      <span class="fx-amt"></span>
      <button class="fx-del" title="删除">×</button>`;
    row.querySelector(".fx-name").textContent = fx.name || "（未命名）";
    row.querySelector(".fx-tag").textContent = fx.type || "其他";
    row.querySelector(".fx-amt").textContent = "¥" + fmt(fx.amount || 0);
    row.querySelector(".fx-del").onclick = () => {
      list.splice(idx, 1);
      afterChange();
    };
    wrap.appendChild(row);
  });
}

// ---------- 渲染：条目 ----------
function renderEntries() {
  const wrap = $("entries");
  wrap.innerHTML = "";

  let rows = [];
  if (viewMode === "month") {
    const m = ledger.months[currentMonth];
    rows = (m ? m.entries : []).map((e) => ({ e, month: currentMonth, editable: true }));
  } else {
    // 季度：汇总该季度所有月份的条目，仅查看
    const qk = quarterKeyOf(currentMonth);
    for (const mk of monthKeys()) {
      if (quarterKeyOf(mk) === qk) {
        for (const e of ledger.months[mk].entries || []) rows.push({ e, month: mk, editable: false });
      }
    }
  }
  // 按日期倒序
  rows.sort((a, b) => (b.e.date || "").localeCompare(a.e.date || ""));

  $("entries-count").textContent = rows.length ? `${rows.length} 条` : "";
  if (!rows.length) {
    wrap.innerHTML = `<p class="empty-hint">${currentMonth ? "本期暂无记账，去左侧添加一笔吧" : "请先在左侧“新增月份”"}</p>`;
    return;
  }

  for (const { e, month, editable } of rows) {
    const card = document.createElement("div");
    card.className = "entry";
    card.innerHTML = `
      <div class="entry-main">
        <div class="entry-amount"></div>
        <div class="entry-meta">
          <span class="entry-type"></span>
          <span class="entry-date"></span>
          ${viewMode === "quarter" ? '<span class="entry-month"></span>' : ""}
        </div>
        <div class="entry-content"></div>
      </div>
      <div class="entry-actions"></div>`;
    card.querySelector(".entry-amount").textContent = fmt(e.amount || 0);
    card.querySelector(".entry-type").textContent = e.type || "其他";
    card.querySelector(".entry-date").textContent = e.date || "";
    if (viewMode === "quarter") card.querySelector(".entry-month").textContent = month;
    const c = card.querySelector(".entry-content");
    if (e.content) c.textContent = e.content; else c.remove();

    if (editable) {
      const acts = card.querySelector(".entry-actions");
      const edit = document.createElement("button");
      edit.className = "mini"; edit.textContent = "编辑";
      edit.onclick = () => startEdit(e.id);
      const del = document.createElement("button");
      del.className = "mini del"; del.textContent = "删除";
      del.onclick = () => deleteEntry(e.id);
      acts.append(edit, del);
    }
    wrap.appendChild(card);
  }
}

// ---------- 改动后统一收尾：重算统计 + 重渲染 + 标脏 ----------
async function afterChange() {
  setDirty(true);
  try {
    await recompute();
    renderAll();
  } catch (err) {
    // 统计接口失败：本地改动已在内存里（不丢），但右侧数字/饼图可能未刷新
    renderAll();   // 用上一份 statsCache 尽量重绘，避免界面卡死
    toast("统计刷新失败：" + err.message);
  }
}

// ---------- 操作：记账 增 / 改 ----------
async function submitEntry() {
  if (!currentMonth) { toast("请先新增月份"); return; }
  const amount = parseFloat($("entry-amount").value);
  const type = $("entry-type").value;
  const content = $("entry-content").value.trim();
  if (isNaN(amount) || amount <= 0) { toast("金额必填且需大于 0"); return; }
  if (!type) { toast("请选择消费类型"); return; }

  const m = ledger.months[currentMonth];
  if (editingId) {
    const e = m.entries.find((x) => x.id === editingId);
    if (e) { e.amount = amount; e.type = type; e.content = content; }
    cancelEdit();
    toast("已修改（记得写入）");
  } else {
    m.entries.push({ id: uid(), date: today, amount, type, content });
    toast("已添加（记得写入）");
  }
  $("entry-amount").value = "";
  $("entry-content").value = "";
  await afterChange();
}

function startEdit(id) {
  const m = ledger.months[currentMonth];
  const e = m.entries.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  $("entry-amount").value = e.amount;
  $("entry-type").value = e.type;
  $("entry-content").value = e.content || "";
  $("entry-form-title").textContent = "编辑记账";
  $("btn-add-entry").textContent = "保存修改";
  $("btn-cancel-edit").classList.remove("hidden");
  $("entry-amount").focus();
}

function cancelEdit() {
  editingId = null;
  $("entry-form-title").textContent = "新增记账";
  $("btn-add-entry").textContent = "添加到本月";
  $("btn-cancel-edit").classList.add("hidden");
  $("entry-amount").value = "";
  $("entry-content").value = "";
}

async function deleteEntry(id) {
  const ok = await confirmModal("确定删除这条记账？删除后写入才会生效。");
  if (!ok) return;
  const m = ledger.months[currentMonth];
  m.entries = m.entries.filter((x) => x.id !== id);
  if (editingId === id) cancelEdit();
  await afterChange();
}

// ---------- 操作：固定支出 / 生活费 ----------
async function addFixed() {
  if (!currentMonth) { toast("请先新增月份"); return; }
  const name = $("fx-name").value.trim();
  const amount = parseFloat($("fx-amount").value);
  const type = $("fx-type").value;
  if (isNaN(amount) || amount <= 0) { toast("固定支出金额需大于 0"); return; }
  const m = ledger.months[currentMonth];
  m.fixed = m.fixed || [];
  m.fixed.push({ name: name || "未命名", amount, type });
  $("fx-name").value = ""; $("fx-amount").value = "";
  await afterChange();
}

async function changeAllowance() {
  if (!currentMonth) return;
  const v = parseFloat($("allowance").value);
  ledger.months[currentMonth].allowance = isNaN(v) ? 0 : v;
  await afterChange();
}

// ---------- 操作：新增月份 ----------
async function addMonth() {
  const raw = $("new-month-input").value;       // YYYY-MM
  if (!raw) { toast("请选择要新增的月份"); return; }
  const key = raw.replace("-", "/");
  if (ledger.months[key]) { toast("该月份已存在"); currentMonth = key; renderMonthSelect(); renderAll(); return; }

  // 继承上一个最近月份的生活费与固定支出（它们通常每月相同）
  const keys = monthKeys();
  const prev = keys.length ? ledger.months[keys[keys.length - 1]] : null;
  ledger.months[key] = {
    allowance: prev ? (prev.allowance || 0) : 0,
    fixed: prev ? JSON.parse(JSON.stringify(prev.fixed || [])) : [],
    entries: [],
  };
  currentMonth = key;
  cancelEdit();
  renderMonthSelect();
  await afterChange();
  toast(`已开启 ${key}（已继承上月生活费与固定支出）`);
}

// ---------- 操作：写入 ----------
async function writeLedger() {
  try {
    const r = await api("/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ledger),
    }, "写入账本");
    setDirty(false);
    refreshBackups();
    toast(r.backup ? `已写入，已备份上一版本` : `已写入（首次，暂无可备份的旧版本）`);
  } catch (err) {
    toast("写入失败：" + err.message);
  }
}

// ---------- 操作：备份 ----------
async function refreshBackups() {
  // 后台刷新：失败只记日志，不弹 toast（避免扰民）
  try {
    const r = await api("/api/backups", undefined, "列出备份");
    $("backup-count").textContent = r.backups.length;
  } catch (err) {
    console.error("[备份] 刷新备份数量失败：", err);
  }
}

async function pruneBackups() {
  try {
    const r = await api("/api/backups/prune", { method: "POST" }, "清除老备份");
    refreshBackups();
    toast(r.deleted ? `已清除 ${r.deleted} 份老备份，保留最新 ${r.kept} 份` : "无需清除（备份不足 3 份）");
  } catch (err) {
    toast("清除老备份失败：" + err.message);
  }
}

async function clearBackups() {
  const ok = await confirmModal("确定清空全部备份？此操作不可恢复。");
  if (!ok) return;
  try {
    const r = await api("/api/backups/clear", { method: "POST" }, "清空备份");
    refreshBackups();
    toast(`已清空 ${r.deleted} 份备份`);
  } catch (err) {
    toast("清空备份失败：" + err.message);
  }
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $("btn-write").onclick = writeLedger;
  $("btn-add-entry").onclick = submitEntry;
  $("btn-cancel-edit").onclick = cancelEdit;
  $("btn-add-fixed").onclick = addFixed;
  $("btn-new-month").onclick = addMonth;
  $("btn-prune").onclick = pruneBackups;
  $("btn-clear").onclick = clearBackups;

  $("allowance").onchange = changeAllowance;

  $("month-select").onchange = (e) => {
    currentMonth = e.target.value;
    cancelEdit();
    renderAll();
  };

  $("view-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg");
    if (!btn) return;
    viewMode = btn.dataset.view;
    document.querySelectorAll(".seg").forEach((s) => s.classList.toggle("active", s === btn));
    cancelEdit();
    renderAll();
  });

  // 回车快速添加记账
  $("entry-amount").addEventListener("keydown", (e) => { if (e.key === "Enter") submitEntry(); });
  $("entry-content").addEventListener("keydown", (e) => { if (e.key === "Enter") submitEntry(); });

  // 离开页面前若有未写入改动则提醒
  window.addEventListener("beforeunload", (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });
}

init().catch((err) => {
  document.body.innerHTML = `<p style="padding:40px;color:#a9745a">初始化失败：${err.message}<br>请确认后端已启动（python app.py）。</p>`;
});
