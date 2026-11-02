<?php
header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="my">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin — ID Access</title>
<style>
:root{--bg:#26030d;--card:#3c0918;--gold:#f4cf78;--w:#fff5e7;--dim:#c1a8a0;--red:#ff817b;--green:#75d69a}
*{box-sizing:border-box}
body{margin:0;padding:16px;min-height:100vh;font-family:system-ui,sans-serif;background:linear-gradient(165deg,#300510,#1e020a);color:var(--w)}
.wrap{max-width:520px;margin:0 auto}
h1{font-size:18px;color:var(--gold);margin:0 0 14px}
.card{background:linear-gradient(145deg,#5b1024,#2a0612);border:1px solid rgba(244,207,120,.4);border-radius:14px;padding:16px;margin-bottom:12px}
label{display:block;font-size:12px;color:var(--dim);margin:0 0 6px}
input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #80404a;background:#300711;color:#fff;margin-bottom:10px;font-size:14px}
button{width:100%;padding:11px;border-radius:10px;border:1px solid #ffe18b;background:linear-gradient(145deg,#ffdc7c,#c57c22);color:#3b170b;font-weight:800;cursor:pointer;margin-top:6px}
button.sec{background:linear-gradient(145deg,#5a2030,#3a1020);border-color:#80404a;color:var(--gold)}
button.ok{background:linear-gradient(145deg,#81c784,#2e7d32);border-color:#a5d6a7;color:#fff;width:auto;padding:6px 10px;font-size:12px;margin:0}
button.bad{background:linear-gradient(145deg,#ff8a80,#c62828);border-color:#ffcdd2;color:#fff;width:auto;padding:6px 10px;font-size:12px;margin:0}
.tabs{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
.tab{flex:1;padding:8px;font-size:12px;margin:0}
.tab.on{filter:brightness(1.15);box-shadow:0 0 0 2px var(--gold)}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px;margin-bottom:8px;border-radius:10px;border:1px solid rgba(176,86,79,.4);background:rgba(0,0,0,.25)}
.id{font-weight:800;color:#ffe09a}
.meta{font-size:11px;color:var(--dim)}
.msg{font-size:13px;margin-top:8px;color:var(--gold);min-height:18px}
.err{color:var(--red)}
.hidden{display:none!important}
.btns{display:flex;gap:6px}
</style>
</head>
<body>
<div class="wrap">
  <h1>👑 Admin — ID Access</h1>

  <div class="card" id="loginCard">
    <label>Admin Key</label>
    <input type="password" id="keyInput" placeholder="Admin key">
    <button type="button" id="enterBtn">Admin ဝင်မယ်</button>
    <div class="msg" id="loginMsg"></div>
  </div>

  <div class="card hidden" id="panel">
    <div class="tabs">
      <button type="button" class="tab sec on" data-t="pending">⏳ စောင့်ဆိုင်း</button>
      <button type="button" class="tab sec" data-t="approved">✅ အတည်ပြု</button>
      <button type="button" class="tab sec" data-t="rejected">❌ ငြင်းပယ်</button>
    </div>
    <div id="list"></div>
    <button type="button" class="sec" id="refreshBtn">🔄 Refresh</button>
    <button type="button" class="sec" id="logoutBtn">Logout</button>
    <div class="msg" id="msg"></div>
  </div>
</div>
<script>
const API = "api.php";
let adminKey = localStorage.getItem("shwe_admin_key") || "";
let tab = "pending";
let data = { approved: [], rejected: [], pending: [] };

function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}

async function api(action, body) {
  const r = await fetch(API + "?action=" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
    body: body ? JSON.stringify(body) : "{}"
  });
  return r.json();
}

async function load() {
  const j = await api("admin_list");
  if (!j.ok) throw new Error(j.error || "fail");
  data = j;
  render();
}

function render() {
  const box = document.getElementById("list");
  box.innerHTML = "";
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.t === tab));

  if (tab === "pending") {
    const list = data.pending || [];
    if (!list.length) { box.innerHTML = '<div style="text-align:center;padding:16px;color:#c1a8a0">စောင့်ဆိုင်း ID မရှိ</div>'; return; }
    list.forEach(p => {
      const el = document.createElement("div");
      el.className = "row";
      el.innerHTML = `<div><div class="id">${esc(p.id)}</div><div class="meta">${esc(p.phone||"")} ${esc(p.time||"")}</div></div>
        <div class="btns"><button type="button" class="ok" data-a="${esc(p.id)}">အတည်ပြု</button>
        <button type="button" class="bad" data-r="${esc(p.id)}">ငြင်း</button></div>`;
      box.appendChild(el);
    });
    box.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
      await api("admin_approve", { id: b.dataset.a });
      document.getElementById("msg").textContent = "✅ " + b.dataset.a + " အတည်ပြုပြီး";
      await load();
    });
    box.querySelectorAll("[data-r]").forEach(b => b.onclick = async () => {
      await api("admin_reject", { id: b.dataset.r });
      document.getElementById("msg").textContent = "❌ " + b.dataset.r + " ငြင်းပြီး";
      await load();
    });
  } else if (tab === "approved") {
    const list = data.approved || [];
    if (!list.length) { box.innerHTML = '<div style="text-align:center;padding:16px;color:#c1a8a0">အတည်ပြု ID မရှိ</div>'; return; }
    list.forEach(id => {
      const el = document.createElement("div");
      el.className = "row";
      el.innerHTML = `<div class="id">${esc(id)}</div>
        <button type="button" class="bad" data-ra="${esc(id)}">ဖြုတ်</button>`;
      box.appendChild(el);
    });
    box.querySelectorAll("[data-ra]").forEach(b => b.onclick = async () => {
      if (!confirm(b.dataset.ra + " ဖြုတ်မလား?")) return;
      await api("admin_remove_approved", { id: b.dataset.ra });
      document.getElementById("msg").textContent = "ဖြုတ်ပြီး: " + b.dataset.ra;
      await load();
    });
  } else {
    const list = data.rejected || [];
    if (!list.length) { box.innerHTML = '<div style="text-align:center;padding:16px;color:#c1a8a0">ငြင်းပယ် ID မရှိ</div>'; return; }
    list.forEach(id => {
      const el = document.createElement("div");
      el.className = "row";
      el.innerHTML = `<div class="id">${esc(id)}</div>
        <button type="button" class="bad" data-rr="${esc(id)}">ဖျက်</button>`;
      box.appendChild(el);
    });
    box.querySelectorAll("[data-rr]").forEach(b => b.onclick = async () => {
      await api("admin_remove_rejected", { id: b.dataset.rr });
      document.getElementById("msg").textContent = "ဖျက်ပြီး: " + b.dataset.rr;
      await load();
    });
  }
}

document.querySelectorAll(".tab").forEach(t => t.onclick = () => { tab = t.dataset.t; render(); });
document.getElementById("enterBtn").onclick = async () => {
  adminKey = document.getElementById("keyInput").value.trim();
  try {
    await load();
    localStorage.setItem("shwe_admin_key", adminKey);
    document.getElementById("loginCard").classList.add("hidden");
    document.getElementById("panel").classList.remove("hidden");
    document.getElementById("loginMsg").textContent = "";
  } catch (e) {
    document.getElementById("loginMsg").innerHTML = '<span class="err">❌ Key မှား / Server မရ</span>';
    adminKey = "";
  }
};
document.getElementById("refreshBtn").onclick = () => load();
document.getElementById("logoutBtn").onclick = () => {
  adminKey = "";
  localStorage.removeItem("shwe_admin_key");
  document.getElementById("panel").classList.add("hidden");
  document.getElementById("loginCard").classList.remove("hidden");
  document.getElementById("keyInput").value = "";
};
if (adminKey) {
  document.getElementById("keyInput").value = adminKey;
  document.getElementById("enterBtn").click();
}
</script>
</body>
</html>
