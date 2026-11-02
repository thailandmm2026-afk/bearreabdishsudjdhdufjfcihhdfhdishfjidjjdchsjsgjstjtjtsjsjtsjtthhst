
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function adminApprovalMarkup(userId) {
  const id = userId || "—";
  return `<div class="admin-approval">
<strong>❌ သင်၏ ID အား အတည်ပြုမထားရသေးပါ။</strong>
<div style="margin-top:8px">ℹ️ Admin အား ခွင့်ပြုချက်တောင်းပါ။</div>
<div style="margin-top:6px">ℹ️ ခွင့်ပြုချက်တောင်းရန် <b>@kiki20251</b> သို့ ID ပို့ပေးပါ:</div>
<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,.25);border:1px solid rgba(244,207,120,.35)">
├─ သင်၏ ID: <b style="color:#ffe09a">${escapeHtml(String(id))}</b>
</div>
</div>`;
}
function adminRejectedMarkup() {
  return `<div class="admin-approval">
<strong>❌ Admin မှ ဒီ ID Acc အား ငြင်းပယ်ထားပါတယ်</strong>
<div style="margin-top:8px">ℹ️ <b>@kiki20251</b> အား ဆက်သွယ်ပါ။</div>
</div>`;
}
async function checkAdminAccess(userId, phone, name) {
  try {
    const r = await fetch("api.php?action=check_access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: String(userId), phone: phone || "", name: name || "" })
    });
    return await r.json();
  } catch (e) {
    return { ok: false, status: "pending", userId: String(userId) };
  }
}

// ==========================================================
// Shwe Lottery — Aa.html ပုံစံ manual bet tool
// ခေါ်သမျှ shwe.php (proxy + admin access control) ကနေ သွားတယ်
// ==========================================================
const API_CONFIG = {
  url: "api.php?path=",
  origin: "https://shwelottery.net"
};
const MM_OFFSET_MS = (6 * 60 + 30) * 60 * 1000;
const SHWE_DEVICE_ID = "5dcab3e06db88a206975e91ea6ac7c87";

const GAMES = {
  W30: { typeId: 30, issueEndpoint: "GetGameIssue", betEndpoint: "GameBetting", cycle: 30, label: "⏱ WINGO 30s" },
  W1:  { typeId: 1,  issueEndpoint: "GetGameIssue", betEndpoint: "GameBetting", cycle: 60, label: "🎯 WINGO 1m" },
  W3:  { typeId: 2,  issueEndpoint: "GetGameIssue", betEndpoint: "GameBetting", cycle: 180, label: "🎯 WINGO 3m" },
  W5:  { typeId: 3,  issueEndpoint: "GetGameIssue", betEndpoint: "GameBetting", cycle: 300, label: "🎯 WINGO 5m" },
  T1:  { typeId: 13, issueEndpoint: "GetTRXGameIssue", betEndpoint: "GameTRXBetting", cycle: 60, label: "💎 TRX 1m" },
  T3:  { typeId: 14, issueEndpoint: "GetTRXGameIssue", betEndpoint: "GameTRXBetting", cycle: 180, label: "💎 TRX 3m" },
  T5:  { typeId: 15, issueEndpoint: "GetTRXGameIssue", betEndpoint: "GameTRXBetting", cycle: 300, label: "💎 TRX 5m" },
  T10: { typeId: 16, issueEndpoint: "GetTRXGameIssue", betEndpoint: "GameTRXBetting", cycle: 600, label: "💎 TRX 10m" }
};
let gameMode = "W30";
function gc() { return GAMES[gameMode]; }
function isTrxMode() { return /^T(?:1|3|5|10)$/.test(gameMode); }

const session = { token: "", headers: {} };
let currentUserProfile = {};
let appConfig = { disabled_formulas: [] };
let live_logs = [];
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- signing (2.js ရဲ့ generateSignature နဲ့ တူတူ) ----------
function stableStringify(obj) {
  const f = {};
  Object.keys(obj).sort().forEach(k => {
    const v = obj[k];
    if (v !== null && v !== "" && v !== undefined && !["signature","track","xosoBettingData","timestamp"].includes(k)) f[k] = v;
  });
  return "{" + Object.keys(f).sort().map(k => JSON.stringify(k)+":"+JSON.stringify(f[k])).join(",") + "}";
}
function sign_md5(data) { return CryptoJS.MD5(stableStringify(data)).toString().toUpperCase(); }
function get_random_key() { return CryptoJS.MD5(String(Date.now() / 1000) + Math.random()).toString(); }
function signBody(b) { b.signature = sign_md5(b); b.timestamp = Math.floor(Date.now() / 1000); return b; }

let lastNetworkErrorReason = null;
let lastNetworkErrorPath = null;
async function fetchWithTimeout(url, options, timeoutMs = 30000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: c.signal }); }
  catch (e) { lastNetworkErrorReason = e.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR"; throw e; }
  finally { clearTimeout(t); }
}
async function postJson(path, body, extraQuery) {
  lastNetworkErrorPath = path;
  lastNetworkErrorReason = null;
  const payload = { ...(body || {}) };
  if (!payload.timestamp) payload.timestamp = Math.floor(Date.now() / 1000);
  if (!payload.random) payload.random = get_random_key();
  if (!payload.signature) payload.signature = sign_md5(payload);
  const url = API_CONFIG.url.includes("api.php")
    ? API_CONFIG.url + encodeURIComponent(path)
    : API_CONFIG.url + path;
  const headers = { "Content-Type": "application/json", "Accept": "application/json" };
  if (session.token) headers["Authorization"] = "Bearer " + session.token;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
      lastNetworkErrorReason = "HTTP_" + res.status;
      if (data) return data;
      throw new Error("HTTP " + res.status);
    }
    return data;
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/abort/i.test(msg)) lastNetworkErrorReason = "TIMEOUT";
    else if (!lastNetworkErrorReason) lastNetworkErrorReason = "NETWORK_ERROR";
    throw e;
  }
}

// ---------- history ----------
let periodHistory = new Map(); // issue -> digit
function bigCmp(a, b) { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; }
function ingest(items) {
  for (const it of items || []) {
    if (!it || it.issueNumber === undefined || it.number === null || it.number === undefined || it.number === "") continue;
    const n = parseInt(it.number, 10);
    if (!isNaN(n)) periodHistory.set(String(it.issueNumber), n % 10);
  }
  if (periodHistory.size > 300) {
    const s = [...periodHistory.keys()].sort(bigCmp);
    s.slice(0, s.length - 300).forEach(k => periodHistory.delete(k));
  }
}
function latestPeriod() { let m = null; for (const p of periodHistory.keys()) if (m === null || bigCmp(p, m) > 0) m = p; return m; }

async function loadServerHistory() {
  try {
    const r = await postJson("GetHistory", { game: gameMode });
    if (r && r.status === "ok") ingest(r.list);
  } catch (e) {}
}
function firstRoundField(objects, names) {
  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;
    for (const name of names) {
      const value = obj[name];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
  }
  return null;
}
function parseRoundApiTime(value) {
  if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const n = Number(value);
    if (n > 1e12) return n;
    if (n > 1e9) return n * 1000;
    return null;
  }
  let text = String(value || "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(text)) text = text.replace(/\s+/, "T");
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) text += "+06:30";
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}
function captureRoundClock(response, data, requestStartedAt, responseReceivedAt, issue) {
  const issueKey = issue == null ? null : String(issue);
  if (!issueKey) return;
  const layers = [data && data.predraw, data && data.currentIssue, data && data.current, data, response];
  const endRaw = firstRoundField(layers, ["endTime", "endTimeStamp", "endTimestamp", "closeTime", "closeTimeStamp", "closingTime", "endAt"]);
  const serverRaw = firstRoundField(layers, ["serviceTime", "serviceNowTime", "serverTime", "nowTime", "currentTime"]);
  const startRaw = firstRoundField(layers, ["startTime", "startTimeStamp", "startTimestamp", "openTime", "startAt"]);
  let deadlineLocalMs = null, durationMs = gc().cycle * 1000, source = "server";
  const endMs = parseRoundApiTime(endRaw);
  const serverMs = parseRoundApiTime(serverRaw);
  if (endMs !== null && serverMs !== null) {
    const localMidpoint = requestStartedAt + (responseReceivedAt - requestStartedAt) / 2;
    const serverOffsetMs = serverMs - localMidpoint;
    deadlineLocalMs = endMs - serverOffsetMs;
    const startMs = parseRoundApiTime(startRaw);
    if (startMs !== null && endMs > startMs && endMs - startMs <= 5 * 60 * 1000) durationMs = endMs - startMs;
  } else {
    const remainingRaw = firstRoundField(layers, ["remainingSeconds", "remainSeconds", "countdownSeconds", "remainingTime", "remainTime"]);
    const remaining = Number(remainingRaw);
    if (Number.isFinite(remaining) && remaining >= 0 && remaining <= 3600) {
      const localMidpoint = requestStartedAt + (responseReceivedAt - requestStartedAt) / 2;
      deadlineLocalMs = localMidpoint + remaining * 1000;
    }
  }
  if (deadlineLocalMs !== null && Number.isFinite(deadlineLocalMs)) {
    roundClockAnchor = { mode: gameMode, issue: issueKey, deadlineLocalMs, durationMs, receivedAt: responseReceivedAt, source };
  } else if (!roundClockAnchor || roundClockAnchor.mode !== gameMode || roundClockAnchor.issue !== issueKey || responseReceivedAt - roundClockAnchor.receivedAt > 90000 || roundClockAnchor.deadlineLocalMs < responseReceivedAt) {
    roundClockAnchor = null;
  }
}
async function get_issue() {
  const cfg = gc();
  const body = signBody({ typeId: cfg.typeId, language: 7, random: get_random_key() });
  const requestStartedAt = Date.now();
  try {
    const r = await postJson(cfg.issueEndpoint, body);
    const responseReceivedAt = Date.now();
    const d = r.data || {};
    if (d.settled) ingest([d.settled]);
    const issue = isTrxMode() ? (d.predraw && d.predraw.issueNumber) : d.issueNumber;
    captureRoundClock(r, d, requestStartedAt, responseReceivedAt, issue);
    return issue == null ? null : String(issue);
  } catch (e) { return null; }
}
async function refresh_history() {
  try {
    const body = signBody({ pageSize: 10, pageNo: 1, typeId: gc().typeId, language: 7, random: get_random_key() });
    const endpoint = isTrxMode() ? "GetTRXNoaverageEmerdList" : "GetNoaverageEmerdList";
    const r = await postJson(endpoint, body);
    if (r.data && Array.isArray(r.data.list)) ingest(r.data.list);
  } catch (e) {}
  renderRoundHistory();
}
function renderRoundHistory() {
  const box = document.getElementById("roundHistoryBox");
  const ps = [...periodHistory.keys()].sort((a, b) => -bigCmp(a, b)).slice(0, 10);
  if (!ps.length) { box.innerHTML = '<div class="rh-empty">No history yet</div>'; return; }
  box.innerHTML = ps.map(p => { const d = periodHistory.get(p), big = d >= 5;
    return `<div class="rh-chip ${big ? "big" : "small"}"><div class="rh-num">${d}</div><div class="rh-tag">${big ? "BIG" : "SMALL"}</div></div>`; }).join("");
}

// ==========================================================
// FORMULAS — null signals stay null; the caller shows SKIP instead of substituting the previous outcome
// ==========================================================
const flip = c => (c === 'B' ? 'S' : 'B');
const majority = a => { let b = 0, s = 0; for (const v of a) { if (v === 'B') b++; else if (v === 'S') s++; } return b === s ? null : (b > s ? 'B' : 'S'); };
function runsOf(h) { const r = []; for (const v of h) { if (r.length && r[r.length - 1].v === v) r[r.length - 1].len++; else r.push({ v, len: 1 }); } return r; }
const eqAt = (h, i, a) => { for (let k = 0; k < a.length; k++) if (h[i + k] !== a[k]) return false; return true; };

const FORMULAS = {
  TREND:    { name: "Wave Rider", fn: c => c.h[c.h.length - 1] },
  MARKOV:   { name: "Markov", fn: c => { const h = c.h, n = h.length;
      for (const o of [3, 2, 1]) { if (n <= o + 3) continue; const key = h.slice(-o); let b = 0, s = 0;
        for (let i = 0; i + o < n; i++) if (eqAt(h, i, key)) { if (h[i + o] === 'B') b++; else s++; }
        if (b + s >= 3 && b !== s) return b > s ? 'B' : 'S'; } return null; } },
  MOMENTUM: { name: "Momentum", fn: c => { let sc = 0, w = 1; const h = c.h;
      for (let i = h.length - 1; i >= Math.max(0, h.length - 12); i--) { sc += (h[i] === 'B' ? 1 : -1) * w; w *= 0.8; }
      return sc === 0 ? null : (sc > 0 ? 'B' : 'S'); } },
  BALANCE:  { name: "Balance", fn: c => { const w = c.h.slice(-20); if (w.length < 20) return null;
      const b = w.filter(x => x === 'B').length; return b >= 13 ? 'S' : b <= 7 ? 'B' : null; } },
  RUNSTAT:  { name: "Run Stat", fn: c => { const r = runsOf(c.h); if (r.length < 4) return null;
      const cur = r[r.length - 1], past = r.slice(0, -1).filter(x => x.len >= cur.len); if (past.length < 3) return null;
      const cont = past.filter(x => x.len > cur.len).length; if (cont * 2 === past.length) return null;
      return cont * 2 > past.length ? cur.v : flip(cur.v); } },
  CYCLE:    { name: "Cycle", fn: c => { const h = c.h, n = h.length; let best = null, bs = 0.6;
      for (let p = 2; p <= 12; p++) { if (n < p + 12) continue; let m = 0, t = 0;
        for (let i = Math.max(p, n - 48); i < n; i++) { t++; if (h[i] === h[i - p]) m++; }
        if (t >= 10 && m / t > bs) { bs = m / t; best = p; } }
      return best ? h[n - best] : null; } },
  SUFFIX:   { name: "Suffix Match", fn: c => { const h = c.h, n = h.length;
      for (let len = 8; len >= 2; len--) { if (n < len + 2) continue; const key = h.slice(-len);
        for (let i = n - len - 1; i >= 0; i--) if (eqAt(h, i, key)) return h[i + len]; } return null; } },
  ZIGZAG:   { name: "Zigzag", fn: c => { const w = c.h.slice(-11); if (w.length < 11) return null; let f = 0;
      for (let i = 1; i < w.length; i++) if (w[i] !== w[i - 1]) f++;
      return f >= 7 ? flip(w[w.length - 1]) : f <= 3 ? w[w.length - 1] : null; } },
  PERIODDIGIT: { name: "Period Digit", fn: c => { if (!c.issue) return null; const d = String(c.issue).slice(-1);
      const same = c.keys.filter(k => k.slice(-1) === d).slice(-9).map(k => c.table[k]); return same.length >= 3 ? majority(same) : null; } },
  PARITY:   { name: "Parity", fn: c => { const w = c.h.slice(-5); if (w.length < 5) return null; return w.filter(x => x === 'B').length % 2 === 1 ? 'B' : 'S'; } },
  INTERVAL: { name: "Interval", fn: c => { const w = c.h.slice(-40), pos = []; w.forEach((v, i) => { if (v === 'B') pos.push(i); });
      if (pos.length < 4) return null; let sum = 0; for (let i = 1; i < pos.length; i++) sum += pos[i] - pos[i - 1];
      const avg = sum / (pos.length - 1), since = w.length - pos[pos.length - 1]; return since >= avg ? 'B' : 'S'; } },
  BLOCKECHO:{ name: "Block Echo", fn: c => { const h = c.h, n = h.length; return n < 14 ? null : majority(h.slice(n - 12, n - 7)); } },
  HOTCOLD:  { name: "Hot/Cold", fn: c => { const h = c.h; if (h.length < 30) return null; const r = a => a.filter(x => x === 'B').length / a.length;
      const sh = r(h.slice(-5)), lg = r(h.slice(-30)); return sh > lg + 0.15 ? 'S' : sh < lg - 0.15 ? 'B' : null; } },
  FIBLAG:   { name: "Fibonacci Lag", fn: c => { const h = c.h, n = h.length; return n < 14 ? null : majority([2, 3, 5, 8, 13].map(l => h[n - l])); } },
  RUNECHO:  { name: "Run Echo", fn: c => { const r = runsOf(c.h); if (r.length < 3) return null; const cur = r[r.length - 1], prev = r[r.length - 2];
      return cur.len < prev.len ? cur.v : flip(cur.v); } },
  MIRROR:   { name: "Mirror", fn: c => { const h = c.h, n = h.length;
      for (let len = 5; len >= 2; len--) { if (n < len + 3) continue; const rev = h.slice(-len).reverse();
        for (let i = n - len - 1; i >= 1; i--) if (eqAt(h, i, rev)) return h[i - 1]; } return null; } },
  WALK:     { name: "Walk Extreme", fn: c => { const w = c.h.slice(-40); if (w.length < 20) return null; const path = []; let a = 0;
      for (const v of w) { a += v === 'B' ? 1 : -1; path.push(a); } const cur = path[path.length - 1], mx = Math.max(...path), mn = Math.min(...path);
      if (cur === mx && mx !== mn) return 'S'; if (cur === mn && mx !== mn) return 'B';
      const d = cur - path[path.length - 11]; return d === 0 ? null : (d > 0 ? 'B' : 'S'); } },
  SLOPE:    { name: "Quarter Fade", fn: c => { const w = c.h.slice(-24); if (w.length < 24) return null;
      const q = [0, 1, 2, 3].map(i => w.slice(i * 6, i * 6 + 6).filter(x => x === 'B').length);
      const sl = -1.5 * q[0] - 0.5 * q[1] + 0.5 * q[2] + 1.5 * q[3]; return sl === 0 ? null : (sl > 0 ? 'S' : 'B'); } }
};
const CANDIDATE_FAMILIES = {
  BAYES_NGRAM: { label: "Bayes N-gram · 500 variants", count: 500 },
  RECENCY_MARKOV: { label: "Recency Markov · 300 variants", count: 300 },
  RECENCY_ENSEMBLE: { label: "Recency blend · 200 variants", count: 200 }
};
const CANDIDATE_FAMILY_KEYS = Object.keys(CANDIDATE_FAMILIES);
const candidateFeatureCache = new WeakMap();
const VARIANT_NGRAM_WINDOWS = [40, 80, 160, 320];
const VARIANT_NGRAM_ORDERS = [1, 2, 3, 4, 5];
const VARIANT_NGRAM_ALPHAS = [1, 2, 4, 8, 16];
const VARIANT_NGRAM_EDGES = [0.02, 0.05, 0.08, 0.11, 0.14];
const VARIANT_MARKOV_HALFLIVES = [10, 20, 40, 80];
const VARIANT_MARKOV_ALPHAS = [2, 4, 8, 16, 32];
const VARIANT_MARKOV_EDGES = [0.03, 0.06, 0.09];
const VARIANT_BLEND_WINDOWS = [40, 80, 120, 200];
const VARIANT_BLEND_HALFLIVES = [10, 20, 40, 80, 160];
const VARIANT_BLEND_ALPHAS = [2, 4, 8, 16, 32];
const VARIANT_BLEND_EDGES = [0.03, 0.08];

function variantEqSuffix(h, i, key) {
  for (let j = 0; j < key.length; j++) if (h[i + j] !== key[j]) return false;
  return true;
}
function variantWeightedBase(h, window, halfLife) {
  const n = h.length, start = Math.max(0, n - window); let b = 0, total = 0;
  for (let i = start; i < n; i++) {
    const age = n - 1 - i, weight = halfLife ? Math.pow(0.5, age / halfLife) : 1;
    total += weight; if (h[i] === 'B') b += weight;
  }
  return { b, total };
}
function variantTransitionCounts(h, order, window, halfLife) {
  const n = h.length; if (n <= order) return { b: 0, s: 0, total: 0 };
  const key = h.slice(n - order), start = Math.max(0, n - window - order); let b = 0, s = 0;
  for (let i = start; i + order < n; i++) {
    if (!variantEqSuffix(h, i, key)) continue;
    const age = n - 1 - (i + order), weight = halfLife ? Math.pow(0.5, age / halfLife) : 1;
    if (h[i + order] === 'B') b += weight; else s += weight;
  }
  return { b, s, total: b + s };
}
function getCandidateFeatures(ctx) {
  let f = candidateFeatureCache.get(ctx); if (f) return f;
  const h = ctx.h; f = { ng: {}, mk: {}, blend: {} };
  for (const window of VARIANT_NGRAM_WINDOWS) {
    const base = variantWeightedBase(h, window, 0);
    f.ng[window] = { base: (base.b + 1) / (base.total + 2), orders: {} };
    for (const order of VARIANT_NGRAM_ORDERS) f.ng[window].orders[order] = variantTransitionCounts(h, order, window, 0);
  }
  for (const halfLife of VARIANT_MARKOV_HALFLIVES) {
    const base = variantWeightedBase(h, 400, halfLife);
    f.mk[halfLife] = { base: (base.b + 1) / (base.total + 2), orders: {} };
    for (const order of VARIANT_NGRAM_ORDERS) f.mk[halfLife].orders[order] = variantTransitionCounts(h, order, 400, halfLife);
  }
  for (const window of VARIANT_BLEND_WINDOWS) {
    f.blend[window] = {};
    for (const halfLife of VARIANT_BLEND_HALFLIVES) {
      const base = variantWeightedBase(h, window, halfLife), orders = {};
      for (const order of [1, 2, 3]) orders[order] = variantTransitionCounts(h, order, window, halfLife);
      f.blend[window][halfLife] = { trendB: base.b, trendN: base.total, orders };
    }
  }
  candidateFeatureCache.set(ctx, f); return f;
}
function candidateDirection(p, edge) { return Math.abs(p - 0.5) < edge ? null : (p > 0.5 ? 'B' : 'S'); }
function predictBayesNgram(ctx, p) {
  const slot = getCandidateFeatures(ctx).ng[p.window];
  for (let order = p.order; order >= 1; order--) {
    const c = slot.orders[order]; if (c.total < Math.max(3, order + 1)) continue;
    const q = (c.b + p.alpha * slot.base) / (c.total + p.alpha), d = candidateDirection(q, p.edge);
    if (d) return d;
  }
  return null;
}
function predictRecencyMarkov(ctx, p) {
  const slot = getCandidateFeatures(ctx).mk[p.half];
  for (let order = p.order; order >= 1; order--) {
    const c = slot.orders[order]; if (c.total < Math.max(3, order + 1)) continue;
    const q = (c.b + p.alpha * slot.base) / (c.total + p.alpha), d = candidateDirection(q, p.edge);
    if (d) return d;
  }
  return null;
}
function candidateConditional(orders, maxOrder, prior, alpha, minN) {
  for (let order = maxOrder; order >= 1; order--) {
    const c = orders[order]; if (!c || c.total < Math.max(minN, order + 1)) continue;
    return { p: (c.b + alpha * prior) / (c.total + alpha), n: c.total };
  }
  return null;
}
function predictRecencyBlend(ctx, p) {
  const slot = getCandidateFeatures(ctx).blend[p.window][p.half]; if (!slot.trendN) return null;
  const trend = (slot.trendB + p.alpha * 0.5) / (slot.trendN + p.alpha);
  const mk = candidateConditional(slot.orders, 1, trend, p.alpha, 3);
  const ng = candidateConditional(slot.orders, 3, trend, p.alpha, 3);
  const comps = [{ p: trend, n: slot.trendN, w: 0.25 }, { p: mk && mk.p, n: mk && mk.n, w: 0.35 }, { p: ng && ng.p, n: ng && ng.n, w: 0.40 }];
  let num = 0, den = 0;
  for (const c of comps) { if (c.p == null || !c.n) continue; const rel = c.w * c.n / (c.n + p.alpha); num += rel * c.p; den += rel; }
  return den ? candidateDirection(num / den, p.edge) : null;
}
function buildCandidateFormulas() {
  const out = Object.create(null); let i = 0;
  for (const order of VARIANT_NGRAM_ORDERS) for (const alpha of VARIANT_NGRAM_ALPHAS) for (const window of VARIANT_NGRAM_WINDOWS) for (const edge of VARIANT_NGRAM_EDGES) {
    i++; const p = { order, alpha, window, edge }, key = `BNG_${String(i).padStart(3, '0')}`;
    out[key] = { family: 'BAYES_NGRAM', name: `Bayes N${order} a${alpha} w${window} e${Math.round(edge * 100)}`, fn: ctx => predictBayesNgram(ctx, p) };
  }
  i = 0;
  for (const order of VARIANT_NGRAM_ORDERS) for (const half of VARIANT_MARKOV_HALFLIVES) for (const alpha of VARIANT_MARKOV_ALPHAS) for (const edge of VARIANT_MARKOV_EDGES) {
    i++; const p = { order, half, alpha, edge }, key = `RMK_${String(i).padStart(3, '0')}`;
    out[key] = { family: 'RECENCY_MARKOV', name: `Recent M${order} h${half} a${alpha} e${Math.round(edge * 100)}`, fn: ctx => predictRecencyMarkov(ctx, p) };
  }
  i = 0;
  for (const window of VARIANT_BLEND_WINDOWS) for (const half of VARIANT_BLEND_HALFLIVES) for (const alpha of VARIANT_BLEND_ALPHAS) for (const edge of VARIANT_BLEND_EDGES) {
    i++; const p = { window, half, alpha, edge }, key = `RWE_${String(i).padStart(3, '0')}`;
    out[key] = { family: 'RECENCY_ENSEMBLE', name: `Recent blend w${window} h${half} a${alpha} e${Math.round(edge * 100)}`, fn: ctx => predictRecencyBlend(ctx, p) };
  }
  if (Object.keys(out).length !== 1000) throw new Error(`candidate count ${Object.keys(out).length}`);
  return out;
}
Object.assign(FORMULAS, buildCandidateFormulas());
const FORMULA_KEYS = Object.keys(FORMULAS);

// history table (အဟောင်း→အသစ်) ကနေ B/S array ဆောက်
function buildCtx(upto, issue) {
  const keys = [...periodHistory.keys()].sort(bigCmp);
  const sub = upto === undefined ? keys : keys.slice(0, upto);
  const table = {}; sub.forEach(k => { table[k] = periodHistory.get(k) >= 5 ? 'B' : 'S'; });
  return { h: sub.map(k => table[k]), keys: sub, table, issue };
}
function runFormula(key, ctx) {
  try {
    const c = FORMULAS[key].fn(ctx);
    return c === 'B' || c === 'S' ? c : null;
  } catch (e) { return null; }
}
function backtestAll(formulaKeys, window = 50) {
  const keys = [...periodHistory.keys()].sort(bigCmp), n = keys.length;
  const empty = formulaKeys.map(() => ({ rate: 0, total: 0, wins: 0 }));
  if (n < 25) return empty;
  const table = {}; keys.forEach(k => { table[k] = periodHistory.get(k) >= 5 ? 'B' : 'S'; });
  const start = Math.max(15, n - window), evalRounds = n - start;
  const minSupport = Math.max(10, Math.ceil(evalRounds * 0.30));
  const stats = formulaKeys.map(k => ({ key: k, wins: 0, total: 0 }));
  for (let i = start; i < n; i++) {
    const priorKeys = keys.slice(0, i);
    const ctx = { h: priorKeys.map(k => table[k]), keys: priorKeys, table, issue: keys[i] };
    for (let j = 0; j < formulaKeys.length; j++) {
      const prediction = runFormula(formulaKeys[j], ctx);
      if (prediction === null) continue;
      stats[j].total++;
      if (prediction === table[keys[i]]) stats[j].wins++;
    }
  }
  return stats.map(s => ({
    rate: s.total >= minSupport ? (s.wins + 5) / (s.total + 10) * 100 : 0,
    total: s.total,
    wins: s.wins
  }));
}

// ---------- prediction (round တစ်ခုမှာ lock — ဘက်မပြောင်းမလှန်) ----------
const SWITCH_MARGIN = 3; // လက်ရှိ formula ထက် ၃% မပိုရင် မပြောင်းဘူး
let currentFormula = null;
let lockedIssue = null, lockedResult = null;

function enabledFormulaKeys(disabled) {
  const configured = disabled.includes('CANDIDATE_CONFIGURED');
  return FORMULA_KEYS.filter(k => {
    if (disabled.includes(k)) return false;
    const family = FORMULAS[k].family;
    if (!family) return true;
    return configured && !disabled.includes(`FAMILY_${family}`);
  });
}
function computePrediction(issue) {
  const disabled = Array.isArray(appConfig.disabled_formulas) ? appConfig.disabled_formulas : [];
  const usable = enabledFormulaKeys(disabled);
  if (!usable.length) return [null, "SKIP · No active formula", null];
  if (periodHistory.size < 5) return [null, "⏳ Data စုနေဆဲ...", null];
  const scores = backtestAll(usable);
  const scored = usable.map((k, i) => ({ k, ...scores[i] })).sort((a, b) => b.rate - a.rate);
  let best = scored[0];
  const cur = scored.find(s => s.k === currentFormula);
  if (cur && best.rate - cur.rate < SWITCH_MARGIN) best = cur;
  currentFormula = best.k;
  const ctx = buildCtx(undefined, issue);
  const pred = runFormula(best.k, ctx);
  const label = `${GAMES[gameMode].label} · ${FORMULAS[best.k].name}`;
  if (pred === null) return [null, `${label} · NO SIGNAL · SKIP`, best.k];
  return [pred === 'B' ? 13 : 14, `${label} · LOW CONFIDENCE`, best.k];
}
function get_prediction(issue) {
  if (!issue) return [null, "⏸️ Round issue မရှိသေးပါ..."];
  const s = String(issue);
  if (lockedIssue === s && lockedResult) return lockedResult;
  const r = computePrediction(s);
  if (r[0] !== null || (typeof r[1] === 'string' && r[1].includes("SKIP"))) { lockedIssue = s; lockedResult = r; }
  return r;
}

// ---------- prospective formula log (side + all 1,018 forecasts, never user/bet data) ----------
const predictionLogStates = new Map();
const PREDICTION_LOG_ATTEMPTS = 3;
function predictionSideCode(value) { return value === 'B' ? 1 : value === 'S' ? 2 : 0; }
function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function buildPredictionSnapshot(ctx, selectedKey, selectedSide) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(FORMULA_KEYS) || FORMULA_KEYS.length !== 1018) { reject(new Error('formula schema mismatch')); return; }
    const bytes = new Uint8Array(Math.ceil(FORMULA_KEYS.length / 4));
    const selectedIndex = FORMULA_KEYS.indexOf(selectedKey);
    if (selectedIndex < 0) { reject(new Error('selected formula missing')); return; }
    let index = 0;
    const step = () => {
      try {
        const end = Math.min(index + 128, FORMULA_KEYS.length);
        for (; index < end; index++) {
          const result = runFormula(FORMULA_KEYS[index], ctx);
          const code = predictionSideCode(result);
          bytes[index >> 2] |= code << (6 - ((index & 3) * 2));
        }
        if (index < FORMULA_KEYS.length) { setTimeout(step, 0); return; }
        const chosenCode = (bytes[selectedIndex >> 2] >> (6 - ((selectedIndex & 3) * 2))) & 3;
        if (chosenCode !== predictionSideCode(selectedSide)) { reject(new Error('selected forecast mismatch')); return; }
        resolve(bytesToBase64(bytes));
      } catch (e) { reject(e); }
    };
    step();
  });
}
async function sendProspectivePrediction(state) {
  if (state.done || state.building || state.inFlight || Date.now() < state.retryAt) return;
  if (state.attempts >= PREDICTION_LOG_ATTEMPTS) { state.done = true; state.reason = 'attempt-limit'; return; }
  if (gameMode !== state.mode || String(currentIssue) !== state.issue || periodHistory.has(state.issue)) { state.done = true; state.reason = 'round-ended'; return; }
  state.attempts++;
  state.inFlight = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_PROXY}?path=LogPrediction`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify(state.payload), signal: controller.signal
    });
    let data = {}; try { data = await response.json(); } catch (e) {}
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (data.status === 'ok' || data.status === 'ignored') { state.done = true; state.reason = data.state || data.reason || 'stored'; }
    else throw new Error('log response not accepted');
  } catch (e) {
    state.retryAt = Date.now() + 10000;
    if (state.attempts >= PREDICTION_LOG_ATTEMPTS) { state.done = true; state.reason = 'network-or-server'; }
  } finally {
    clearTimeout(timeout); state.inFlight = false;
  }
}
function queueProspectivePrediction(issue, prediction, formulaKey) {
  const issueText = String(issue || '');
  if (!issueText || !formulaKey || !/^[0-9]{6,32}$/.test(issueText) || issueText !== String(currentIssue) || periodHistory.has(issueText)) return;
  const mode = gameMode, key = `${mode}:${issueText}`;
  let state = predictionLogStates.get(key);
  if (state) { sendProspectivePrediction(state); return; }
  const selectedSide = prediction === 13 ? 'B' : (prediction === 14 ? 'S' : 'SKIP');
  state = { mode, issue: issueText, done: false, building: true, inFlight: false, attempts: 0, retryAt: 0, payload: null };
  predictionLogStates.set(key, state);
  while (predictionLogStates.size > 360) predictionLogStates.delete(predictionLogStates.keys().next().value);
  const ctx = buildCtx(undefined, issueText);
  buildPredictionSnapshot(ctx, formulaKey, selectedSide).then(snapshot => {
    state.building = false;
    if (gameMode !== mode || String(currentIssue) !== issueText || periodHistory.has(issueText)) { state.done = true; state.reason = 'round-ended'; return; }
    state.payload = { mode, issue: issueText, formula: formulaKey, side: selectedSide, snapshot };
    sendProspectivePrediction(state);
  }).catch(() => { state.building = false; state.done = true; state.reason = 'snapshot-error'; });
}


// ==========================================================
// API
// ==========================================================
async function get_user_info(isLoginCheck) {
  try {
    const body = signBody({ language: 7, random: get_random_key() });
    const r = await postJson("GetUserInfo", body, isLoginCheck ? "logincheck=1" : null);
    if (r.code === 0) {
      currentUserProfile = { ...(r.data || {}) };
      renderDrawerProfile();
      return [r.data.userId, parseFloat(r.data.amount), r];
    }
    if (r.code === -999) return ["BLOCKED", null, r];
    if (r.code === -998) return ["LOW_BALANCE", null, r];
    if (r.code === -997) return ["MAINTENANCE", null, r];
  } catch (e) {}
  return [null, null, null];
}
async function login(phone, password) {
  const raw = String(phone || "").trim();
  const users = [...new Set([raw, raw && !raw.startsWith("95") ? "95" + raw : null].filter(Boolean))];
  const deviceId = "5dcab3e06db88a206975e91ea6ac7c87";
  for (const user of users) {
    const body = {
      username: user, pwd: password, phonetype: 1, logintype: "mobile",
      packId: "", deviceId, pixelId: "", fbcId: "", fbc: "", fbp: "", adId: "",
      language: 7, random: get_random_key()
    };
    signBody(body);
    try {
      lastNetworkErrorPath = "Login";
      lastNetworkErrorReason = null;
      const r = await postJson("Login", body);
      if (r && r.code === 0 && r.data && r.data.token) {
        session.token = r.data.token;
        currentUserProfile = { ...currentUserProfile, phone: user, username: user };
        session.headers.Authorization = "Bearer " + session.token;
        try { localStorage.setItem("kii_api_session", JSON.stringify({ token: session.token, phone: user })); } catch (e) {}
        lastNetworkErrorReason = null;
        return true;
      }
      if (r && r.code !== 0) lastNetworkErrorReason = null;
    } catch (e) {}
  }
  return false;
}
function betResponseText(result) {
  const values = [];
  const walk = (value, depth = 0) => {
    if (value == null || depth > 4) return;
    if (typeof value === "string" || typeof value === "number") { values.push(String(value)); return; }
    if (Array.isArray(value)) { value.forEach(v => walk(v, depth + 1)); return; }
    if (typeof value === "object") {
      ["code", "msg", "message", "error", "errMsg", "reason", "detail", "status"].forEach(k => {
        if (Object.prototype.hasOwnProperty.call(value, k)) walk(value[k], depth + 1);
      });
      ["data", "result", "errors"].forEach(k => {
        if (Object.prototype.hasOwnProperty.call(value, k)) walk(value[k], depth + 1);
      });
    }
  };
  walk(result && result.response);
  if (result && result.error) values.push(result.error.message || String(result.error));
  return values.join(" ").toLowerCase().normalize("NFKC");
}
function classifyBetFailure(result) {
  const response = result && result.response || {};
  const code = String(response.code ?? (response.data && response.data.code) ?? "").toLowerCase();
  const text = betResponseText(result);
  if (code === "-999" || /blocked_by_admin|admin.{0,15}(?:blocked|permission)|not authorized by admin/.test(text)) return "admin_blocked";
  if (/(?:insufficient|not enough|low).{0,20}(?:balance|funds?|money)|(?:balance|funds?|money).{0,25}(?:insufficient|not enough|too low|low)|low balance|余额不足|余额不够|资金不足|金币不足|လက်ကျန်.{0,18}မလုံလောက်|ငွေ.{0,18}မလုံလောက်/.test(text)) return "insufficient";
  if (/bet(?:ting)?\s*(?:is\s*)?(?:closed|ended|expired|over)|(?:closed|expired|ended|over).{0,24}(?:betting|wager|round|issue|period)|(?:round|issue|period).{0,40}(?:closed|ended|expired|finished|over|timeout)|(?:betting|bet|wager).{0,30}(?:time|period).{0,20}(?:over|closed|ended|expired|up)|封盘|停止下注|不在投注时间|投注时间已过|下注时间已过|期号已过|期号过期|အချိန်ကုန်|ထိုးချိန်ကုန်|လောင်းချိန်ကုန်|ပွဲစဉ်ပိတ်/.test(text)) return "round_closed";
  if (result && result.error) return "network";
  return "unknown";
}
async function roundAdvancedSince(issue) {
  const freshIssue = await get_issue();
  if (freshIssue && String(freshIssue) !== String(issue)) {
    currentIssue = freshIssue;
    updatePredictionDisplay();
    return true;
  }
  return false;
}
async function place_bet(unit, count, selectType, issue) {
  const cfg = gc();
  const body = signBody({ typeId: cfg.typeId, issuenumber: issue, language: 7, gameType: 2, amount: unit, betCount: count, selectType, random: get_random_key() });
  try {
    const r = await postJson(cfg.betEndpoint, body);
    return { ok: !!r && r.code === 0, response: r };
  } catch (e) { return { ok: false, error: e, response: null }; }
}
function computeUnitAmount(amt) {
  if (amt <= 0) return 1;
  const s = String(amt), tz = s.length - s.replace(/0+$/, '').length;
  if (tz >= 4) return 10000; if (tz === 3) return 1000; if (tz === 2) return 100; if (tz === 1) return 10;
  return Math.pow(10, s.length - 1);
}

// ==========================================================
// UI state
// ==========================================================
const SESSION_KEY = "shwe_bot_session";
let currentIssue = null, pendingBet = null, resolvingBet = false;
let latestBet = null;
let roundClockAnchor = null;
let currentStreakType = null, currentStreakCount = 0, maxWinStreak = 0, maxLossStreak = 0, totalWins = 0, totalLosses = 0;
let sessionStartBalance = null, lastKnownBalance = null;
let baseUnit = 10, stepCount = 1, multiplier = 1;
let pollTimer = null, clockTimer = null, balTimer = null;
let autoBot = { running: false, busy: false, lastIssue: null };
let autoBotStake = null;
const HINT_DEFAULT = "ရိုက်ထည့်တဲ့ ဂဏန်း × 10 = ထိုးမည့်ပမာဏ (ဥပမာ 150 ရေးရင် K1500 ထိုးမည်)";

function $(id) { return document.getElementById(id); }
function renderDrawerProfile() {
  const p = currentUserProfile || {};
  const pick = (...keys) => { for (const k of keys) if (p[k] !== undefined && p[k] !== null && String(p[k]).trim() !== "") return p[k]; return "—"; };
  const uid = pick("userId", "id", "uid");
  const phone = pick("phone", "mobile", "username", "account");
  const amount = Number(pick("amount", "balance", "walletBalance"));
  $("drawerProfileId").textContent = String(uid);
  $("drawerProfilePhone").textContent = String(phone);
  $("drawerWalletBalance").textContent = Number.isFinite(amount) ? `K${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "K0.00";
  $("drawerProfileStatus").textContent = "Connected";
}
function saveSession() { try { localStorage.setItem(SESSION_KEY, JSON.stringify({ loggedIn: true })); } catch (e) {} }
function loadSession() { try { const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); return s && s.loggedIn === true ? s : null; } catch (e) { return null; } }
function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem("kii_api_session");
    localStorage.removeItem("ultra_session");
  } catch (e) {}
}

function addBetLog(msg, replaceIssue) {
  if (replaceIssue) { const i = live_logs.findIndex(l => l.issue === replaceIssue); if (i >= 0) { live_logs[i].html = msg; renderLogs(); return; } }
  live_logs.unshift({ issue: replaceIssue || null, html: msg });
  if (live_logs.length > 20) live_logs.pop();
  renderLogs();
}
function renderLogs() {
  const show = live_logs.slice(0, 8);
  $("logsBox").innerHTML = show.length ? show.map(l => `<div class="logline">${l.html}</div>`).join("") : '<div class="logline empty">...</div>';
}
function betLine(issue, side, cls, amount, resHtml) {
  return `<span class="lg-period">#${String(issue).slice(-6)}</span><span class="lg-side ${cls}">${side}</span><span class="lg-amt">K${amount.toFixed(2)}</span>${resHtml}`;
}
function renderLatestBet() {
  const card = $("latestBetCard");
  if (!card) return;
  if (!latestBet) {
    card.className = "latest-bet-card state-idle";
    $("latestBetMode").textContent = "—";
    $("latestBetStatus").textContent = "မထိုးရသေးပါ";
    $("latestBetSide").textContent = "—";
    $("latestBetMeta").textContent = "ထိုးထားသော bet မရှိသေးပါ";
    $("latestBetNote").textContent = "Bet လက်ခံပြီး ရလဒ်အတည်ပြုလျှင် ဒီနေရာမှာ ပြပါမည်။";
    return;
  }
  card.className = `latest-bet-card state-${latestBet.status}`;
  $("latestBetMode").textContent = GAMES[latestBet.game] ? GAMES[latestBet.game].label : latestBet.game;
  $("latestBetSide").textContent = `${latestBet.side} · K${Number(latestBet.amount).toFixed(2)}`;
  $("latestBetMeta").textContent = `Round #${String(latestBet.issue).slice(-12)} · ${latestBet.game}`;
  if (latestBet.status === "pending") {
    $("latestBetStatus").textContent = "PENDING ⏳";
    $("latestBetNote").textContent = "Bet ကို server က လက်ခံထားသည်။ အမှန်တကယ် round result ကို စောင့်နေသည်။";
  } else if (latestBet.status === "win") {
    $("latestBetStatus").textContent = "WIN ✅";
    $("latestBetNote").textContent = `အတည်ပြုရလဒ် ${latestBet.digit} (${latestBet.digit >= 5 ? "BIG" : "SMALL"}) · ရွေးချယ်မှုနှင့် ကိုက်ညီပါသည်။`;
  } else if (latestBet.status === "loss") {
    $("latestBetStatus").textContent = "LOSE ❌";
    $("latestBetNote").textContent = `အတည်ပြုရလဒ် ${latestBet.digit} (${latestBet.digit >= 5 ? "BIG" : "SMALL"}) · ရွေးချယ်မှုနှင့် မကိုက်ညီပါ။`;
  } else {
    $("latestBetStatus").textContent = "ရလဒ် မအတည်ပြုနိုင်ပါ";
    $("latestBetNote").textContent = "ရလဒ်အချိန်မီ မရောက်သေးပါ။ WIN/LOSE ကို မခန့်မှန်းဘဲ bet history မှ နောက်မှစစ်ပါ။";
  }
}

function showToast(isWin, amount) {
  const el = document.createElement("div");
  el.className = `toast ${isWin ? "win" : "lose"}`;
  el.innerHTML = `<div class="ic">${isWin ? "🎉" : "💔"}</div><div><div class="tt">${isWin ? "🏆 WIN!" : "LOSS"}</div>${amount != null ? `<div class="am">${isWin ? "+" : "-"}K${Math.abs(amount).toFixed(2)}</div>` : ""}</div>`;
  $("toastBox").appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 4000);
}
function showInfoToast(m) {
  const el = $("modeSwitchNotice"); el.textContent = m; el.classList.add("show");
  clearTimeout(showInfoToast._t); showInfoToast._t = setTimeout(() => el.classList.remove("show"), 2000);
}

function updateStreakDisplay() {
  const el = $("dCurStreak");
  if (!currentStreakType) { el.textContent = "-"; el.className = "v white"; }
  else if (currentStreakType === "WIN") { el.textContent = `${currentStreakCount} Win${currentStreakCount > 1 ? "s" : ""}`; el.className = "v green"; }
  else { el.textContent = `${currentStreakCount} Loss${currentStreakCount > 1 ? "es" : ""}`; el.className = "v red"; }
  $("dMaxWin").textContent = maxWinStreak; $("dMaxLoss").textContent = maxLossStreak; $("dTotalWL").textContent = `${totalWins} / ${totalLosses}`;
}
function updateStreakStats(won) {
  if (won) { totalWins++; if (currentStreakType === "WIN") currentStreakCount++; else { currentStreakType = "WIN"; currentStreakCount = 1; } maxWinStreak = Math.max(maxWinStreak, currentStreakCount); }
  else { totalLosses++; if (currentStreakType === "LOSS") currentStreakCount++; else { currentStreakType = "LOSS"; currentStreakCount = 1; } maxLossStreak = Math.max(maxLossStreak, currentStreakCount); }
  updateStreakDisplay();
}
function updateLastResultDisplay() {
  const p = latestPeriod(); if (p === null) return;
  const d = periodHistory.get(p); $("dLastResult").textContent = `${d} (${d >= 5 ? "BIG" : "SMALL"})`;
}
function updatePredictionDisplay() {
  if (!currentIssue) return;
  const [pred, meta, formulaKey] = get_prediction(currentIssue);
  const el = $("predValue");
  if (pred === null) { el.textContent = (typeof meta === 'string' && meta.includes("SKIP")) ? "⏸️ SKIP" : "⏸️ Waiting for data..."; el.className = "pred-value none"; }
  else if (pred === 13) { el.textContent = "🔺 BIG"; el.className = "pred-value big"; }
  else { el.textContent = "🔻 SMALL"; el.className = "pred-value small"; }
  $("predMeta").textContent = meta;
  $("predPeriod").textContent = `Period: ${currentIssue}`;
  queueProspectivePrediction(currentIssue, pred, formulaKey);
}
function updateTotalDisplay() { $("totalAmount").textContent = `K${(baseUnit * stepCount * multiplier).toFixed(2)}`; }
function updateProfitDisplay(bal) {
  if (sessionStartBalance === null || bal == null) return;
  const p = bal - sessionStartBalance, el = $("dProfit");
  el.textContent = `${p > 0 ? "+" : ""}K${p.toFixed(2)}`;
  el.classList.remove("green", "red", "white"); el.classList.add(p > 0 ? "green" : p < 0 ? "red" : "white");
}
function setBetButtonsDisabled(d) { $("betBigBtn").disabled = d; $("betSmallBtn").disabled = d; }
function setAutoBotStatus(running) {
  const btn = $("autoBotBtn"), status = $("autoBotStatus");
  if (!btn || !status) return;
  btn.classList.toggle("stop", running);
  btn.textContent = running ? "⏹ ရပ်မည်" : "🚀 စတင်ကစားမည်";
  status.classList.toggle("running", running);
  status.textContent = running ? "ကစားနေသည်" : "ရပ်ထားသည်";
}
function stopAutoBot(message = "Auto Bot ရပ်ထားသည်") {
  autoBot.running = false; autoBot.busy = false; autoBot.lastIssue = null; autoBotStake = null;
  setAutoBotStatus(false);
  if ($("betMsg") && message) $("betMsg").innerHTML = `<span class="yellow">${message}</span>`;
}
async function autoBetForCurrentRound() {
  if (!autoBot.running || autoBot.busy || pendingBet || !currentIssue) return;
  const issue = String(currentIssue);
  if (autoBot.lastIssue === issue) return;
  const mode = $("autoBetMode") ? $("autoBetMode").value : "PREDICTION";
  let selectType = null, sideLabel = "", sideClass = "";
  if (mode === "BIG") { selectType = 13; sideLabel = "BIG"; sideClass = "yellow"; }
  else if (mode === "SMALL") { selectType = 14; sideLabel = "SMALL"; sideClass = "cyan"; }
  else {
    const [pred] = get_prediction(issue);
    if (pred === 13) { selectType = 13; sideLabel = "BIG"; sideClass = "yellow"; }
    else if (pred === 14) { selectType = 14; sideLabel = "SMALL"; sideClass = "cyan"; }
  }
  if (!selectType) return;
  autoBot.busy = true; autoBot.lastIssue = issue;
  try { await handleManualBet(selectType, sideLabel, sideClass); }
  finally {
    autoBot.busy = false;
    if (autoBot.running && !pendingBet && autoBot.lastIssue === issue) autoBot.lastIssue = null;
  }
}

async function refreshBalance() {
  const [uid, bal] = await get_user_info();
  if (uid === "BLOCKED") { $("dBal").textContent = "BLOCKED"; setBetButtonsDisabled(true); $("betMsg").innerHTML = adminApprovalMarkup(); return; }
  if (uid === "MAINTENANCE") { $("dBal").textContent = "MAINTENANCE"; setBetButtonsDisabled(true); return; }
  if (uid !== null && typeof uid !== "string") $("uidLabel").textContent = `Acc: ${uid}`;
  if (bal !== null && !isNaN(bal)) {
    $("dBal").textContent = bal.toFixed(2);
    if (sessionStartBalance === null) sessionStartBalance = bal;
    lastKnownBalance = bal; updateProfitDisplay(bal);
  }
}
async function loadConfig() {
  try {
    const prevR = lastNetworkErrorReason, prevP = lastNetworkErrorPath;
    const r = await postJson("GetConfig", {});
    if (lastNetworkErrorPath === "GetConfig") { lastNetworkErrorReason = prevR; lastNetworkErrorPath = prevP; }
    if (r && r.status === "ok") {
      appConfig = r;
      const nb = $("noticeBox");
      if (nb) {
        if (r.notice) { nb.textContent = "📢 " + r.notice; nb.classList.remove("hidden"); }
        else nb.classList.add("hidden");
      }
    }
  } catch (e) {
    if (lastNetworkErrorPath === "GetConfig") { lastNetworkErrorReason = null; lastNetworkErrorPath = null; }
  }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]));
}
function adminApprovalMarkup(userId) {
  const contact = String((appConfig && appConfig.admin_contact) || "@kiki20251").trim() || "@kiki20251";
  const id = userId || (currentUserProfile && (currentUserProfile.userId || currentUserProfile.user_id)) || "—";
  return `<div class="admin-approval">
<strong>❌ သင်၏ ID အား အတည်ပြုမထားရသေးပါ။</strong>
<div style="margin-top:8px">ℹ️ Admin အား ခွင့်ပြုချက်တောင်းပါ။</div>
<div style="margin-top:6px">ℹ️ ခွင့်ပြုချက်တောင်းရန် <b>${escapeHtml(contact)}</b> သို့ ID ပို့ပေးပါ:</div>
<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,.25);border:1px solid rgba(244,207,120,.35)">
├─ သင်၏ ID: <b style="color:#ffe09a">${escapeHtml(String(id))}</b>
</div>
</div>`;
}

function adminRejectedMarkup() {
  const contact = String((appConfig && appConfig.admin_contact) || "@kiki20251").trim() || "@kiki20251";
  return `<div class="admin-approval">
<strong>❌ Admin မှ ဒီ ID Acc အား ငြင်းပယ်ထားပါတယ်</strong>
<div style="margin-top:8px">ℹ️ <b>${escapeHtml(contact)}</b> အား ဆက်သွယ်ပါ။</div>
</div>`;
}

async function checkAdminAccess(userId, phone, name) {
  try {
    const r = await fetch("shwe.php?action=check_access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: String(userId), phone: phone || "", name: name || "" })
    });
    return await r.json();
  } catch (e) {
    console.error("checkAdminAccess", e);
    // fail-open or fail-closed? fail-closed safer for admin control
    return { ok: false, status: "pending", userId: String(userId), admin_contact: "@kiki20251" };
  }
}


// ---------- amount selector ----------
document.querySelectorAll("#presetRow .preset-btn").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll("#presetRow .preset-btn").forEach(b => b.classList.remove("active")); btn.classList.add("active");
  baseUnit = parseInt(btn.dataset.v); $("customAmountInput").value = ""; $("customAmountHint").textContent = HINT_DEFAULT; $("customAmountHint").style.color = "var(--dim)"; updateTotalDisplay();
}));
$("customAmountInput").addEventListener("input", e => {
  const val = parseInt(e.target.value), hint = $("customAmountHint");
  if (isNaN(val) || val < 1) { hint.textContent = HINT_DEFAULT; hint.style.color = "var(--dim)"; return; }
  document.querySelectorAll("#presetRow .preset-btn").forEach(b => b.classList.remove("active"));
  baseUnit = 10; stepCount = val; multiplier = 1; $("countVal").textContent = stepCount;
  document.querySelectorAll("#multRow .mult-btn").forEach(b => b.classList.remove("active")); document.querySelector('#multRow .mult-btn[data-v="1"]').classList.add("active");
  updateTotalDisplay(); hint.textContent = `= K${(val * 10).toFixed(2)} ထိုးမည်`; hint.style.color = "var(--green)";
});
document.querySelectorAll("#multRow .mult-btn").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll("#multRow .mult-btn").forEach(b => b.classList.remove("active")); btn.classList.add("active"); multiplier = parseInt(btn.dataset.v); updateTotalDisplay();
}));
$("countMinus").addEventListener("click", () => { if (stepCount > 1) { stepCount--; $("countVal").textContent = stepCount; updateTotalDisplay(); } });
$("countPlus").addEventListener("click", () => { stepCount++; $("countVal").textContent = stepCount; updateTotalDisplay(); });
$("customAmountHint").textContent = HINT_DEFAULT;

// ---------- game mode ----------
document.querySelectorAll("#gameModeRow .game-mode-btn").forEach(btn => btn.addEventListener("click", async () => {
  const nm = btn.dataset.mode; if (nm === gameMode) return;
  if (autoBot.running) stopAutoBot("Mode ပြောင်းသဖြင့် Auto Bot ရပ်ထားသည်");
  if (pendingBet) { alert("ရလဒ်စောင့်နေသေးတဲ့ ဘောင်ချာ ရှိနေပါသည် — ရလဒ်ထွက်တာနဲ့မှ ဂိမ်းပြောင်းပါ"); return; }
  document.querySelectorAll("#gameModeRow .game-mode-btn").forEach(b => b.classList.remove("active")); btn.classList.add("active");
  gameMode = nm; showInfoToast(`${GAMES[nm].label} ပြောင်းလိုက်ပါပြီ`);
  periodHistory.clear(); currentIssue = null; roundClockAnchor = null; tickClock(); lockedIssue = null; lockedResult = null; currentFormula = null;
  $("roundHistoryBox").innerHTML = '<div class="rh-empty">Loading...</div>'; $("predValue").textContent = "Loading..."; $("predValue").className = "pred-value none"; $("dLastResult").textContent = "-";
  await loadServerHistory(); currentIssue = await get_issue(); await refresh_history(); tickClock(); updateLastResultDisplay(); updatePredictionDisplay();
}));

// ---------- betting ----------
async function handleManualBet(selectType, sideLabel, sideClass) {
  if (!currentIssue) { $("betMsg").innerHTML = '<span class="red">Round issue မရှိသေးပါ၊ ခဏစောင့်ပါ။</span>'; return; }
  if (pendingBet) { $("betMsg").innerHTML = '<span class="yellow">ရှေ့ round ရလဒ် မရသေးပါ၊ ခဏစောင့်ပါ။</span>'; return; }
  const total = baseUnit * stepCount * multiplier;
  setBetButtonsDisabled(true); $("betMsg").innerHTML = '<span class="white">ထိုးနေသည်...</span>';
  const issue = currentIssue;
  lastNetworkErrorReason = null;
  const result = await place_bet(baseUnit, stepCount * multiplier, selectType, issue);
  if (result.ok) {
    pendingBet = { issue, amount: total, side: sideLabel, sideClass, selectType, placedAt: Date.now(), game: gameMode };
    latestBet = { issue, amount: total, side: sideLabel, game: gameMode, status: "pending", digit: null };
    renderLatestBet();
    addBetLog(betLine(issue, sideLabel, sideClass, total, '<span class="lg-result yellow">PENDING ⏳</span>'), issue);
    $("betMsg").innerHTML = '<span class="green">ထိုးပြီးပါပြီ — ရလဒ် စောင့်နေသည်</span>';
    if (autoBot.running && autoBotStake) {
      baseUnit = autoBotStake.baseUnit; stepCount = autoBotStake.stepCount; multiplier = autoBotStake.multiplier;
      $("countVal").textContent = stepCount; updateTotalDisplay();
    } else {
      stepCount = 1; multiplier = 1; baseUnit = 10; $("countVal").textContent = 1;
      document.querySelectorAll("#multRow .mult-btn").forEach(b => b.classList.remove("active")); document.querySelector('#multRow .mult-btn[data-v="1"]').classList.add("active");
      document.querySelectorAll("#presetRow .preset-btn").forEach(b => b.classList.remove("active")); document.querySelector('#presetRow .preset-btn[data-v="10"]').classList.add("active");
      $("customAmountInput").value = ""; $("customAmountHint").textContent = HINT_DEFAULT; $("customAmountHint").style.color = "var(--dim)"; updateTotalDisplay();
    }
  } else {
    const failure = classifyBetFailure(result);
    if (failure === "admin_blocked") {
      $("dBal").textContent = "BLOCKED";
      $("betMsg").innerHTML = adminApprovalMarkup();
      setBetButtonsDisabled(true);
      return;
    }
    if (failure === "insufficient") {
      $("betMsg").innerHTML = '<span class="red">❌ လက်ကျန်ငွေ မလုံလောက်ပါ — လက်ကျန်ငွေနှင့် ထိုးမည့်ပမာဏကို စစ်ဆေးပါ။</span>';
    } else if (failure === "round_closed" || (failure === "unknown" && await roundAdvancedSince(issue))) {
      $("betMsg").innerHTML = '<span class="yellow">⏱️ ဒီအချီ ထိုးချိန်ကုန်သွားပါပြီ။ လက်ကျန်ငွေကြောင့် မဟုတ်ပါ — နောက်အချီကို စောင့်ပြီး ပြန်ထိုးပါ။</span>';
    } else if (failure === "network") {
      $("betMsg").innerHTML = `<span class="red">${networkErrorMessage()}</span>`;
    } else {
      $("betMsg").innerHTML = '<span class="red">❌ ထိုးမအောင်မြင်ပါ — server အဖြေကို အတည်မပြုနိုင်ပါ။ အချီအချိန်နှင့် လက်ကျန်ငွေကို စစ်ပြီး ပြန်စမ်းပါ။</span>';
    }
    setBetButtonsDisabled(false);
  }
}
$("betBigBtn").addEventListener("click", () => handleManualBet(13, "BIG", "yellow"));
$("betSmallBtn").addEventListener("click", () => handleManualBet(14, "SMALL", "cyan"));
$("autoBotBtn").addEventListener("click", () => {
  if (autoBot.running) { stopAutoBot(); return; }
  if (!session.token) { $("betMsg").innerHTML = '<span class="red">အရင် Login ဝင်ပါ။</span>'; return; }
  autoBotStake = { baseUnit, stepCount, multiplier, total: baseUnit * stepCount * multiplier };
  autoBot.running = true; autoBot.busy = false; autoBot.lastIssue = null;
  setAutoBotStatus(true); $("betMsg").innerHTML = '<span class="green">Auto Bot စတင်ပါပြီ — round တိုင်း ဆက်လက်ထိုးနေပါမည်။</span>';
  autoBetForCurrentRound();
});

function openKiiDrawer() { $("kiiDrawer").classList.add("open"); $("drawerOverlay").classList.add("show"); renderDrawerProfile(); if (session.token) refreshBalance(); }
function closeKiiDrawer() { $("kiiDrawer").classList.remove("open"); $("drawerOverlay").classList.remove("show"); }
$("drawerOpenBtn").addEventListener("click", openKiiDrawer);
$("drawerCloseBtn").addEventListener("click", closeKiiDrawer);
$("drawerOverlay").addEventListener("click", closeKiiDrawer);
$("drawerHistoryBtn").addEventListener("click", () => { closeKiiDrawer(); $("roundHistoryBox").scrollIntoView({ behavior: "smooth", block: "center" }); });
$("drawerProtectionBtn").addEventListener("click", () => { closeKiiDrawer(); showInfoToast("🛡️ လက်ရှိ session တွင် stop-loss/profit protection ကို admin setting ဖြင့် ထိန်းချုပ်ထားပါသည်။"); });
$("drawerRefreshBtn").addEventListener("click", () => location.reload());
$("drawerLogoutBtn").addEventListener("click", () => $("logoutBtn").click());

const PENDING_TIMEOUT_MS = 120000;
async function resolvePendingBet() {
  if (!pendingBet || resolvingBet) return;
  resolvingBet = true;
  try {
    const pb = pendingBet;
    if (pb.game !== gameMode) return;
    await refresh_history();
    const digit = periodHistory.get(String(pb.issue));
    if (digit === undefined) {
      if (Date.now() - pb.placedAt > PENDING_TIMEOUT_MS) {
        addBetLog(betLine(pb.issue, pb.side, pb.sideClass, pb.amount, '<span class="lg-result yellow">TIMEOUT ⚠️</span>'), pb.issue);
        if (latestBet && latestBet.issue === pb.issue && latestBet.game === pb.game) { latestBet.status = "unverified"; renderLatestBet(); }
        pendingBet = null; setBetButtonsDisabled(false);
        $("betMsg").innerHTML = '<span class="yellow">ရလဒ် အတည်ပြုချက် နှေးနေသည် — ဆက်ထိုးလို့ရပါပြီ</span>';
        await refreshBalance();
      }
      return;
    }
    const won = (pb.selectType === 13 && digit >= 5) || (pb.selectType === 14 && digit < 5);
    const before = lastKnownBalance;
    if (latestBet && latestBet.issue === pb.issue && latestBet.game === pb.game) {
      latestBet.status = won ? "win" : "loss";
      latestBet.digit = digit;
      renderLatestBet();
    }
    pendingBet = null; // တစ်ကြိမ်သာ ရေတွက်ရန် ချက်ချင်း ရှင်း
    addBetLog(betLine(pb.issue, pb.side, pb.sideClass, pb.amount, won ? '<span class="lg-result green">WIN ✅</span>' : '<span class="lg-result red">LOSS ❌</span>'), pb.issue);
    updateStreakStats(won);
    const box = $("dLastResult").closest(".streak-item");
    if (box) { box.classList.remove("flash-win", "flash-loss"); void box.offsetWidth; box.classList.add(won ? "flash-win" : "flash-loss"); }
    updateLastResultDisplay();
    setBetButtonsDisabled(false); $("betMsg").innerHTML = "";
    await refreshBalance();
    if (won) { const d = (before !== null && lastKnownBalance !== null) ? lastKnownBalance - before : null; showToast(true, d !== null && d > 0 ? d : null); }
    else showToast(false, pb.amount);
  } catch (e) { console.error(e); }
  finally { resolvingBet = false; }
}

// ---------- polling ----------
async function pollRound() {
  const issue = await get_issue();
  if (issue && issue !== currentIssue) {
    currentIssue = issue;
    tickClock();
    await refresh_history();
    updateLastResultDisplay(); updatePredictionDisplay();
    if (pendingBet && pendingBet.issue !== issue) await resolvePendingBet();
  } else if (pendingBet) resolvePendingBet();
  if (currentIssue) {
    const [pred, , formulaKey] = get_prediction(currentIssue);
    queueProspectivePrediction(currentIssue, pred, formulaKey);
  }
  if (autoBot.running && !pendingBet) autoBetForCurrentRound();
  updateLastResultDisplay(); renderRoundHistory();
}
function formatCountdown(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsPart = String(seconds % 60).padStart(2, "0");
  return `${minutesPart}:${secondsPart}`;
}
function tickClock() {
  const mode = gc(), now = Date.now(), cycleMs = mode.cycle * 1000;
  let remainingMs, durationMs = cycleMs;
  const synced = roundClockAnchor && currentIssue && roundClockAnchor.mode === gameMode && roundClockAnchor.issue === String(currentIssue) && now - roundClockAnchor.receivedAt < 90000;
  if (synced) {
    remainingMs = Math.max(0, roundClockAnchor.deadlineLocalMs - now);
    durationMs = roundClockAnchor.durationMs || cycleMs;
  } else if (currentIssue) {
    const phaseMs = (now + MM_OFFSET_MS) % cycleMs;
    remainingMs = cycleMs - phaseMs;
  } else {
    remainingMs = null;
  }
  $("timerModeLabel").textContent = mode.cycle === 30 ? "30 SEC" : "1 MIN";
  if (remainingMs === null) {
    $("dCountdown").textContent = "--:--";
    $("countdownArc").style.strokeDashoffset = "263.894";
    return;
  }
  remainingMs = Math.max(0, Math.min(cycleMs, Number.isFinite(remainingMs) ? remainingMs : 0));
  durationMs = Number.isFinite(durationMs) && durationMs > 0 ? Math.max(1, Math.min(cycleMs, durationMs)) : cycleMs;
  $("dCountdown").textContent = formatCountdown(remainingMs);
  const fraction = Math.max(0, Math.min(1, remainingMs / Math.max(1, durationMs)));
  $("countdownArc").style.strokeDashoffset = String(263.894 * (1 - fraction));
}
function startPolling() {
  stopPolling();
  renderLatestBet(); tickClock(); clockTimer = setInterval(tickClock, 1000);
  pollRound(); pollTimer = setInterval(pollRound, 3000);
  balTimer = setInterval(() => { refreshBalance(); loadConfig(); }, 8000);
  updateTotalDisplay(); renderLogs();
}
function stopPolling() { [clockTimer, pollTimer, balTimer].forEach(t => t && clearInterval(t)); clockTimer = pollTimer = balTimer = null; }

// ---------- login / session ----------
function networkErrorMessage() {
  switch (lastNetworkErrorReason) {
    case "TIMEOUT": return "❌ ချိတ်ဆက်မှု အချိန်ကျော်လွန်သွားပါသည် (30s) — Network အလွန်နှေးနေပါသည်၊ ပြန်စမ်းကြည့်ပါ။";
    case "NETWORK_ERROR": return "❌ Server ကို ချိတ်ဆက်လို့ မရပါ — Internet/VPN ကို စစ်ဆေးပြီး ပြန်စမ်းကြည့်ပါ။";
    case "BAD_RESPONSE": return "❌ Server ကနေ မမှန်ကန်တဲ့ အဖြေ ပြန်ရောက်ပါသည် — admin ကို ဆက်သွယ်ပါ။";
    case "HTTP_401":
      if (lastNetworkErrorPath === "Login") return "❌ Login request ကို (401) ဖြင့် ငြင်းပယ်ထားပါသည် — ဖုန်းနံပါတ်နှင့် Password ကို စစ်ပြီး ပြန်စမ်းပါ။ ဤအဖြေသည် Admin ခွင့်ပြုချက်ပိတ်ထားခြင်း မဟုတ်ပါ။";
      if (lastNetworkErrorPath === "GetUserInfo") return "❌ Login session ကို အတည်မပြုနိုင်ပါ (401) — ပြန်ဝင်ကြည့်ပါ။ ဤအဖြေသည် Admin ခွင့်ပြုချက်ပိတ်ထားခြင်း မဟုတ်ပါ။";
      return "❌ Session ကို အတည်မပြုနိုင်ပါ (401) — ပြန်ဝင်ကြည့်ပါ။";
    default:
      if (lastNetworkErrorReason && lastNetworkErrorReason.startsWith("HTTP_")) return `❌ Server error (${lastNetworkErrorReason.slice(5)}) — admin ကို ဆက်သွယ်ပါ။`;
      return "❌ ချိတ်ဆက်မှု မအောင်မြင်ပါ — ပြန်စမ်းကြည့်ပါ။";
  }
}
$("loginBtn").addEventListener("click", async () => {
  const phone = $("phoneInput").value.trim(), pw = $("passInput").value, btn = $("loginBtn");
  $("loginMsg").innerHTML = '<span class="white">Authenticating...</span>'; btn.disabled = true; lastNetworkErrorReason = null; lastNetworkErrorPath = null;
  try {
    await loadConfig();
    const ok = await login(phone, pw);
    if (!ok) { $("loginMsg").innerHTML = lastNetworkErrorReason ? `<span class="red">${networkErrorMessage()}</span>` : '<span class="red">❌ Authentication Failed! (ဖုန်းနံပါတ် / Password မှားနေပါသည်)</span>'; return; }
    const [uid, , raw] = await get_user_info(true);
    if (uid === "MAINTENANCE") { $("loginMsg").innerHTML = '<span class="yellow">🛠 ခဏ ပြုပြင်နေပါသည် — နောက်မှ ပြန်ဝင်ပါ။</span>'; return; }
    if (uid === "LOW_BALANCE") { $("loginMsg").innerHTML = `<span class="red">⛔ Account ထဲမှာ အနည်းဆုံး K${raw && raw.data ? raw.data.required : ""} ရှိမှသာ ဝင်ခွင့်ရှိပါသည်။</span>'; return; }
    if (uid === "BLOCKED") { $("loginMsg").innerHTML = adminApprovalMarkup(); return; }
    if (uid === null) { $("loginMsg").innerHTML = `<span class="red">${networkErrorMessage()}</span>`; return; }

    // Admin access gate
    const phone = $("phoneInput").value.trim();
    const access = await checkAdminAccess(uid, phone, (raw && raw.data && (raw.data.nickName || raw.data.nickname)) || "");
    if (appConfig) appConfig.admin_contact = access.admin_contact || appConfig.admin_contact || "@kiki20251";
    if (access.status === "rejected") {
      $("loginMsg").innerHTML = adminRejectedMarkup();
      session.token = ""; try { localStorage.removeItem("kii_api_session"); } catch(e) {}
      return;
    }
    if (access.status !== "approved") {
      $("loginMsg").innerHTML = adminApprovalMarkup(uid);
      session.token = ""; try { localStorage.removeItem("kii_api_session"); } catch(e) {}
      return;
    }

    saveSession(); await enterBetScreen(uid);
  } catch (e) { $("loginMsg").innerHTML = `<span class="red">${networkErrorMessage()}</span>`; }
  finally { btn.disabled = false; }
});
$("logoutBtn").addEventListener("click", async () => {
  try { await postJson("UserLogout", {}); } catch (e) {}
  stopAutoBot("");
  stopPolling(); clearSession(); session.token = ""; session.headers = {}; currentIssue = null; pendingBet = null; latestBet = null; roundClockAnchor = null; sessionStartBalance = null; renderLatestBet(); tickClock();
  $("betScreen").classList.add("hidden"); $("loginScreen").classList.remove("hidden");
  $("phoneInput").value = ""; $("passInput").value = ""; $("loginMsg").innerHTML = "";
});
async function enterBetScreen(uid) {
  $("loginScreen").classList.add("hidden"); $("betScreen").classList.remove("hidden");
  $("uidLabel").textContent = `Acc: ${uid}`;
  await loadServerHistory(); await refresh_history();
  updateLastResultDisplay(); await refreshBalance(); updateStreakDisplay(); startPolling();
}
(async function init() {
  await loadConfig();
  // Always start at the Login screen. The user must authenticate through the
  // direct ck.html-compatible API before the betting screen is opened.
  session.token = "";
  session.headers = {};
  $("loginScreen").classList.remove("hidden");
  $("betScreen").classList.add("hidden");
  $("loginMsg").innerHTML = "";
})();

//=====

// Presentation-only: mark the existing result digit so CSS can match the reference palette.
(() => {
  const box = document.getElementById("roundHistoryBox");
  if (!box) return;
  const decorate = () => box.querySelectorAll(".rh-chip").forEach(chip => {
    const digit = chip.querySelector(".rh-num")?.textContent.trim();
    if (/^[0-9]$/.test(digit || "")) chip.dataset.digit = digit;
  });
  new MutationObserver(decorate).observe(box, { childList: true, subtree: true, characterData: true });
  decorate();
})();