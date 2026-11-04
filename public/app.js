/* Together — a calm family calendar. No accounts: a family is a 6-letter code. */
(() => {
  "use strict";

  // ---------- Config ----------
  const API = window.TOGETHER_API || "";      // same origin by default
  const DEMO = !!window.TOGETHER_DEMO;        // preview mode: everything stays on this device
  const KEY = "together.v1";
  const COLORS = [
    { name: "Coral", hex: "#F2735F" }, { name: "Marigold", hex: "#E9A23B" },
    { name: "Fern", hex: "#3FAF74" }, { name: "Lagoon", hex: "#1FA6A0" },
    { name: "Sky", hex: "#4A90E8" }, { name: "Iris", hex: "#7A6AE6" },
    { name: "Orchid", hex: "#C163CC" }, { name: "Rose", hex: "#E9638E" },
  ];
  const REPEATS = { none: "Never", daily: "Every day", weekly: "Every week", monthly: "Every month", yearly: "Every year" };

  // ---------- Small helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 36);
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const todayStr = () => ymd(new Date());
  const initial = (name) => (name || "?").trim().charAt(0).toUpperCase() || "?";
  const fmt = (s, opts) => parse(s).toLocaleDateString(undefined, opts);
  const fmtTime = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); const d = new Date(2000, 0, 1, h, m); return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); };
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const cleanCode = (s) => (s || "").toUpperCase().replace(/[^A-HJKMNP-Z2-9]/g, "").slice(0, 6);

  function toast(msg, action) {
    const t = $("#toast");
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
    t.classList.toggle("has-action", !!action);
    t.classList.add("show");
    const hide = () => t.classList.remove("show", "has-action");
    if (action) $("button", t).onclick = () => { hide(); action.run(); };
    clearTimeout(toast.t); toast.t = setTimeout(hide, action ? 6000 : 2200);
  }

  // ---------- Local state ----------
  const TABLES = ["members", "events", "lists", "items", "chores", "checks"];
  const emptyTables = () => Object.fromEntries(TABLES.map((k) => [k, {}]));
  const blank = () => ({ code: null, meId: null, name: "", nameUpdatedAt: 0, pinHash: "", pinUpdatedAt: 0, parent: false, justMe: false, push: false, ...emptyTables(), pending: { ...emptyTables(), name: null, pin: null }, ready: false });
  // Preview only: start everyone on a clean slate once (clears the test families from this device).
  if (DEMO) try {
    if (localStorage.getItem("together.demo.reset") !== "1") {
      Object.keys(localStorage).filter((k) => k.startsWith("together.")).forEach((k) => localStorage.removeItem(k));
      localStorage.setItem("together.demo.reset", "1");
    }
  } catch {}
  let S = load();
  function load() {
    try {
      const st = { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || "{}") };
      for (const k of TABLES) { st[k] = st[k] || {}; st.pending[k] = st.pending[k] || {}; }
      return st;
    } catch { return blank(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }

  // ---------- API (real or demo) ----------
  const api = DEMO ? demoApi() : {
    async create(name) { return req("POST", "/api/families", { name }); },
    async get(code) { return req("GET", `/api/families/${code}`); },
    async sync(code, body) { return req("POST", `/api/families/${code}/sync`, body); },
    async upload(code, blob, name) {
      const res = await fetch(`${API}/api/families/${code}/files?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": blob.type || "application/octet-stream" }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed");
      return data;
    },
    async removeFile(code, id) { await fetch(`${API}/api/families/${code}/files/${id}`, { method: "DELETE" }).catch(() => {}); },
    fileUrl: (f) => `${API}/api/families/${S.code}/files/${f.id}`,
  };
  async function req(method, path, body) {
    const res = await fetch(API + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || "Network error"); e.status = res.status; throw e; }
    return data;
  }
  function demoApi() {
    const DK = "together.demo.server";
    const db = () => { try { return JSON.parse(localStorage.getItem(DK) || "{}"); } catch { return {}; } };
    const put = (d) => { try { localStorage.setItem(DK, JSON.stringify(d)); } catch {} };
    const view = (f) => ({ code: f.code, name: f.name, nameUpdatedAt: f.nameUpdatedAt, pinHash: f.pinHash || "", pinUpdatedAt: f.pinUpdatedAt || 0, ...Object.fromEntries(TABLES.map((k) => [k, Object.values(f[k] || {})])) });
    const FK = (id) => `together.demo.file.${id}`;
    const nf = (msg) => { const e = new Error(msg); e.status = 404; return e; };
    return {
      async create(name) {
        const d = db(); const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        const code = Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join("");
        d[code] = { code, name: name || "Our family", nameUpdatedAt: Date.now(), ...emptyTables() }; put(d); return view(d[code]);
      },
      async get(code) { const f = db()[code]; if (!f) throw nf("No family uses that code."); return view(f); },
      async sync(code, body) {
        const d = db(); const f = d[code]; if (!f) throw nf("No family uses that code.");
        if (body.name && body.nameUpdatedAt > f.nameUpdatedAt) { f.name = body.name; f.nameUpdatedAt = body.nameUpdatedAt; }
        if (typeof body.pinHash === "string" && body.pinUpdatedAt > (f.pinUpdatedAt || 0)) { f.pinHash = body.pinHash; f.pinUpdatedAt = body.pinUpdatedAt; }
        for (const k of TABLES) { f[k] = f[k] || {}; for (const it of body[k] || []) if (!f[k][it.id] || it.updatedAt > f[k][it.id].updatedAt) f[k][it.id] = it; }
        put(d); return view(f);
      },
      async upload(code, blob, name) {
        if (blob.size > 3 * 1024 * 1024) throw new Error("In this preview, files must be under 3 MB.");
        const url = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
        const id = uid();
        try { localStorage.setItem(FK(id), url); } catch { throw new Error("This preview is out of room for files."); }
        return { id, name, type: blob.type, size: blob.size };
      },
      async removeFile(code, id) { try { localStorage.removeItem(FK(id)); } catch {} },
      fileUrl: (f) => { try { return localStorage.getItem(FK(f.id)) || ""; } catch { return ""; } },
    };
  }

  // ---------- Sync ----------
  let online = true, syncing = false, again = false, syncTimer = null;
  function applyServer(st) {
    const byId = (arr) => Object.fromEntries((arr || []).map((x) => [x.id, x]));
    for (const k of TABLES) S[k] = byId(st[k]);
    S.name = st.name; S.nameUpdatedAt = st.nameUpdatedAt;
    S.pinHash = st.pinHash || ""; S.pinUpdatedAt = st.pinUpdatedAt || 0;
    if (S.pending.pin) S.pinHash = S.pending.pin.hash;
    // Re-apply anything still waiting to be sent.
    for (const k of TABLES) for (const it of Object.values(S.pending[k])) S[k][it.id] = it;
    if (S.pending.name) { S.name = S.pending.name.name; }
  }
  function queue(kind, item) {
    item.updatedAt = Math.max(Date.now(), (S[kind][item.id]?.updatedAt || 0) + 1);
    S[kind][item.id] = item; S.pending[kind][item.id] = item;
    save(); scheduleSync();
  }
  function scheduleSync(ms = 300) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms); }
  async function syncNow() {
    if (!S.code) return;
    if (syncing) { again = true; return; }
    syncing = true;
    const sent = { ...Object.fromEntries(TABLES.map((k) => [k, { ...S.pending[k] }])), name: S.pending.name, pin: S.pending.pin };
    const body = Object.fromEntries(TABLES.map((k) => [k, Object.values(sent[k])]));
    if (sent.name) { body.name = sent.name.name; body.nameUpdatedAt = sent.name.updatedAt; }
    if (sent.pin) { body.pinHash = sent.pin.hash; body.pinUpdatedAt = sent.pin.updatedAt; }
    try {
      const st = await api.sync(S.code, body);
      for (const k of TABLES) for (const [id, it] of Object.entries(sent[k])) if (S.pending[k][id] === it) delete S.pending[k][id];
      if (S.pending.name === sent.name) S.pending.name = null;
      if (S.pending.pin === sent.pin) S.pending.pin = null;
      applyServer(st); save(); online = true;
    } catch (e) {
      online = false;
      if (e.status === 404) { online = true; toast("This calendar no longer exists"); }
    }
    syncing = false;
    if (S.ready) renderMain(true);
    if (again) { again = false; scheduleSync(50); }
  }
  setInterval(() => { if (S.ready && document.visibilityState === "visible") syncNow(); }, 15000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.ready) syncNow(); });
  addEventListener("online", () => S.ready && syncNow());

  // ---------- Calendar logic ----------
  const members = () => Object.values(S.members).filter((m) => !m.deleted).sort((a, b) => (a.id === S.meId ? -1 : b.id === S.meId ? 1 : a.name.localeCompare(b.name)));
  const me = () => S.members[S.meId];
  const colorOf = (id) => S.members[id]?.color || "#9A9AA2";
  function occursOn(e, day) {
    if (e.deleted || day < e.date) return false;
    if (day === e.date) return true;
    const a = parse(e.date), b = parse(day);
    switch (e.repeat) {
      case "daily": return true;
      case "weekly": return a.getDay() === b.getDay();
      case "monthly": return a.getDate() === b.getDate();
      case "yearly": return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
      default: return false;
    }
  }
  // Parent code: once set, kids can change only their own plans; parents can change anything.
  const isParent = () => !S.pinHash || S.parent;
  const canChange = (e) => isParent() || !e.by || e.by === S.meId;
  async function hashPin(pin) {
    const bytes = new TextEncoder().encode(`together:${S.code}:${pin}`);
    const h = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function setPin(pin) {
    const hash = pin ? await hashPin(pin) : "";
    S.pinHash = hash; S.parent = true; S.pending.pin = { hash, updatedAt: Date.now() };
    save(); scheduleSync();
  }
  const shows = (e) => !S.justMe || !(e.who || []).length || e.who.includes(S.meId);
  const isImage = (f) => /^image\//.test(f.type || "");
  const fmtSize = (n) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  const CLIP = `<svg class="clip" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7l-7.8 7.7a1.7 1.7 0 0 1-2.3-2.3l7.1-7.1"/></svg>`;
  const eventsOn = (day) => Object.values(S.events).filter((e) => occursOn(e, day) && shows(e))
    .sort((a, b) => (a.allDay === b.allDay ? (a.start || "").localeCompare(b.start || "") || a.title.localeCompare(b.title) : a.allDay ? -1 : 1));
  const whoColors = (e) => {
    const ids = (e.who || []).filter((id) => S.members[id] && !S.members[id].deleted);
    return ids.length ? ids.map(colorOf) : members().map((m) => m.color);
  };
  const barStyle = (e) => {
    const c = whoColors(e);
    if (c.length <= 1) return `background:${c[0] || "#9A9AA2"}`;
    return `background:linear-gradient(${c.map((x, i) => `${x} ${(i / c.length) * 100}% ${((i + 1) / c.length) * 100}%`).join(",")})`;
  };
  const dotsFor = (day, max = 3) => {
    const set = []; for (const e of eventsOn(day)) for (const c of whoColors(e)) { if (!set.includes(c)) set.push(c); }
    return set.slice(0, max).map((c) => `<i style="background:${c}"></i>`).join("");
  };
  const avatar = (m, cls = "") => `<span class="av ${cls}" style="background:${m.color}" title="${esc(m.name)}">${esc(initial(m.name))}</span>`;

  // ============================================================
  // Onboarding — one calm question per screen
  // ============================================================
  const ob = { step: "welcome", history: [], mode: null, familyName: "", code: "", myName: "", color: null, error: "" };
  const app = $("#app");

  function go(step, { back = false } = {}) {
    if (!back) ob.history.push(ob.step);
    ob.step = step; ob.error = "";
    renderOnboarding();
  }
  function goBack() { const prev = ob.history.pop(); if (prev) { ob.step = prev; ob.error = ""; renderOnboarding(); } }

  function frame({ back = true, body, foot = "", top = false, bind }) {
    return { bind, html: `<div class="ob">
      <div class="ob-top">${back && ob.history.length ? `<button class="back" data-back><span aria-hidden="true">‹</span> Back</button>` : ""}</div>
      <div class="ob-body ${top ? "top" : ""}">${body}</div>
      <div class="ob-foot">${foot}</div>
    </div>` };
  }

  const screens = {
    welcome: () => frame({
      back: false,
      body: `<div class="rise"><div class="orb"></div></div>
        <h1 class="write">Welcome home.</h1>
        <p class="lede rise d4">Your family's days, together in one calm place.</p>`,
      foot: `<button class="btn rise d5" data-next>Get started</button>`,
      bind: () => $("[data-next]").onclick = () => go("choice"),
    }),

    choice: () => frame({
      top: true,
      body: `<h1 class="rise">Let's set up your calendar.</h1>
        <div class="choice">
          <button class="rise d2" data-new><span class="ico" style="background:#FFE9E2">🌱</span><span><strong>Start a family calendar</strong><span class="s">You'll get a code to share with everyone.</span></span></button>
          <button class="rise d3" data-join><span class="ico" style="background:#E6EEFF">🔑</span><span><strong>Join with a code</strong><span class="s">Someone in your family already started one.</span></span></button>
        </div>`,
      bind: () => {
        $("[data-new]").onclick = () => { ob.mode = "new"; go("familyName"); };
        $("[data-join]").onclick = () => { ob.mode = "join"; go("joinCode"); };
      },
    }),

    familyName: () => frame({
      body: `<h1 class="rise">What do you call your family?</h1>
        <p class="hint rise d1">Everyone will see this name. You can change it later.</p>
        <input class="field rise d2" id="f" maxlength="40" placeholder="The Brandos" autocomplete="off" value="${esc(ob.familyName)}" enterkeyhint="next">`,
      foot: `<button class="btn" data-next ${ob.familyName.trim() ? "" : "disabled"}>Continue</button>`,
      bind: () => {
        const f = $("#f"), b = $("[data-next]");
        f.oninput = () => { ob.familyName = f.value; b.disabled = !f.value.trim(); };
        const next = () => ob.familyName.trim() && go("myName");
        f.onkeydown = (e) => { if (e.key === "Enter") next(); }; b.onclick = next; focusSoon(f);
      },
    }),

    joinCode: () => frame({
      body: `<h1 class="rise">Enter your family code.</h1>
        <p class="hint rise d1">It's the six letters and numbers someone shared with you.</p>
        <input class="field code-input rise d2" id="f" maxlength="6" placeholder="••••••" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(ob.code)}" enterkeyhint="go" aria-label="Family code">
        <div class="error" id="err">${esc(ob.error)}</div>`,
      foot: `<button class="btn" data-next ${ob.code.length === 6 ? "" : "disabled"}>Join</button>`,
      bind: () => {
        const f = $("#f"), b = $("[data-next]");
        f.oninput = () => { ob.code = cleanCode(f.value); f.value = ob.code; b.disabled = ob.code.length !== 6; $("#err").textContent = ""; };
        const next = async () => {
          if (ob.code.length !== 6) return;
          b.disabled = true; b.textContent = "Looking…";
          try {
            const st = await api.get(ob.code);
            ob.joined = st; go("found");
          } catch (e) {
            b.disabled = false; b.textContent = "Join";
            $("#err").textContent = e.status === 404 ? "We couldn't find that code. Check it and try again." : "Can't reach the calendar right now. Check your connection.";
          }
        };
        f.onkeydown = (e) => { if (e.key === "Enter") next(); }; b.onclick = next; focusSoon(f);
      },
    }),

    found: () => {
      const ms = (ob.joined.members || []).filter((m) => !m.deleted);
      return frame({
        body: `<div class="rise"><div class="orb small"></div></div>
          <h1 class="rise d1">${esc(ob.joined.name)}</h1>
          <p class="lede rise d2">${ms.length ? `${ms.map((m) => esc(m.name)).join(", ").replace(/, ([^,]*)$/, " and $1")} ${ms.length === 1 ? "is" : "are"} already here.` : "You're the first one here."}</p>
          ${ms.length ? `<div class="stack rise d3" style="justify-content:center;margin-top:8px">${ms.map((m) => avatar(m, "lg")).join("")}</div>` : ""}`,
        foot: `<button class="btn rise d4" data-next>That's us</button>`,
        bind: () => $("[data-next]").onclick = () => go("myName"),
      });
    },

    myName: () => frame({
      body: `<h1 class="rise">And who are you?</h1>
        <p class="hint rise d1">Just your first name is perfect.</p>
        <input class="field rise d2" id="f" maxlength="24" placeholder="Your name" autocomplete="given-name" value="${esc(ob.myName)}" enterkeyhint="next">`,
      foot: `<button class="btn" data-next ${ob.myName.trim() ? "" : "disabled"}>Continue</button>`,
      bind: () => {
        const f = $("#f"), b = $("[data-next]");
        f.oninput = () => { ob.myName = f.value; b.disabled = !f.value.trim(); };
        const next = () => ob.myName.trim() && go("color");
        f.onkeydown = (e) => { if (e.key === "Enter") next(); }; b.onclick = next; focusSoon(f);
      },
    }),

    color: () => {
      const taken = {}; for (const m of (ob.joined?.members || [])) if (!m.deleted) taken[m.color] = m.name;
      if (!ob.color) ob.color = (COLORS.find((c) => !taken[c.hex]) || COLORS[0]).hex;
      return frame({
        body: `<div class="avatar-preview rise" id="pv" style="background:${ob.color}">${esc(initial(ob.myName))}</div>
          <h1 class="rise d1">Pick your color.</h1>
          <p class="hint rise d2">It marks your plans so everyone can tell at a glance.</p>
          <div class="swatches rise d3">${COLORS.map((c) => `<button class="swatch" style="background:${c.hex}" aria-label="${c.name}${taken[c.hex] ? `, also used by ${esc(taken[c.hex])}` : ""}" aria-pressed="${c.hex === ob.color}" data-c="${c.hex}">${taken[c.hex] ? `<span class="taken">${esc(initial(taken[c.hex]))}</span>` : ""}</button>`).join("")}</div>`,
        foot: `<button class="btn rise d4" data-next>Continue</button>`,
        bind: () => {
          $$("[data-c]").forEach((s) => s.onclick = () => {
            ob.color = s.dataset.c; $("#pv").style.background = ob.color;
            $$("[data-c]").forEach((x) => x.setAttribute("aria-pressed", x === s));
          });
          $("[data-next]").onclick = finishSetup;
        },
      });
    },

    shareCode: () => frame({
      back: false,
      body: `<h1 class="rise">Here's your family code.</h1>
        <p class="hint rise d1">Your family can scan this or type the code to join. No sign-up needed.</p>
        <div class="code-big rise d2" aria-label="Family code ${S.code.split("").join(" ")}">${esc(S.code)}</div>
        <div class="rise d3">${qrHTML()}</div>`,
      foot: `<button class="btn rise d4" data-share>Share invite</button><button class="btn ghost rise d4" data-next>Continue</button>`,
      bind: () => { $("[data-share]").onclick = shareInvite; $("[data-next]").onclick = () => go("parentCode"); },
    }),

    parentCode: () => frame({
      back: false,
      body: `<h1 class="rise">Set a parent code.</h1>
        <p class="hint rise d1">With a parent code, kids can only change their own plans. Parents can change anything.</p>
        <input class="field code-input pin-input rise d2" id="f" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="••••" autocomplete="off" aria-label="Four-digit parent code">`,
      foot: `<button class="btn" data-next disabled>Set code</button><button class="btn ghost" data-skip>Skip for now</button>`,
      bind: () => {
        const f = $("#f"), b = $("[data-next]");
        f.oninput = () => { f.value = f.value.replace(/\D/g, "").slice(0, 4); b.disabled = f.value.length !== 4; };
        const after = () => go(isStandalone() ? "done" : "install");
        const next = async () => { if (f.value.length !== 4) return; await setPin(f.value); toast("Parent code set"); after(); };
        f.onkeydown = (e) => { if (e.key === "Enter") next(); };
        b.onclick = next; $("[data-skip]").onclick = after; focusSoon(f);
      },
    }),

    install: () => {
      const steps = isIOS
        ? [["Tap the Share button", "<svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6'/></svg>"], ["Choose “Add to Home Screen”", ""], ["Tap “Add”", ""]]
        : [["Open your browser menu", "⋮"], ["Choose “Install app” or “Add to Home screen”", ""], ["Confirm", ""]];
      return frame({
        top: true,
        body: `<h1 class="rise">Keep it on your home screen.</h1>
          <p class="hint rise d1">Together opens like any other app, right from your phone.</p>
          <ol class="steps-list rise d2">${steps.map(([t, i], n) => `<li><span class="n">${n + 1}</span><span>${t}</span><span style="margin-left:auto;color:var(--muted)">${i}</span></li>`).join("")}</ol>`,
        foot: `${deferredInstall ? `<button class="btn" data-install>Install Together</button>` : ""}<button class="btn ${deferredInstall ? "ghost" : ""}" data-next>${deferredInstall ? "Not now" : "Done"}</button>`,
        bind: () => {
          $("[data-next]").onclick = () => go("done");
          const ib = $("[data-install]"); if (ib) ib.onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; go("done"); };
        },
      });
    },

    done: () => frame({
      back: false,
      body: `<div class="check rise"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
        <h1 class="rise d1">You're all set${ob.myName ? `, ${esc(ob.myName.trim())}` : ""}.</h1>
        <p class="lede rise d2">Add your first plan and everyone in ${esc(S.name)} will see it.</p>`,
      foot: `<button class="btn rise d3" data-next>Open calendar</button>`,
      bind: () => $("[data-next]").onclick = () => { S.ready = true; save(); renderMain(); },
    }),
  };

  async function finishSetup() {
    const b = $("[data-next]"); b.disabled = true; b.textContent = "Setting up…";
    try {
      let st;
      if (ob.mode === "new") st = await api.create(ob.familyName.trim());
      else st = await api.get(ob.code);
      S = { ...blank(), code: st.code || ob.code, meId: uid() };
      applyServer(st);
      queue("members", { id: S.meId, name: ob.myName.trim(), color: ob.color, deleted: false });
      await syncNow();
      ob.history = [];
      go(ob.mode === "new" ? "shareCode" : isStandalone() ? "done" : "install");
    } catch (e) {
      b.disabled = false; b.textContent = "Try again";
      toast("Can't reach the calendar. Check your connection.");
    }
  }

  function renderOnboarding() {
    const { html, bind } = screens[ob.step]();
    app.innerHTML = html;
    if (bind) bind();
    const back = $("[data-back]"); if (back) back.onclick = goBack;
    scrollTo(0, 0);
  }

  function focusSoon(el) { setTimeout(() => { try { el.focus({ preventScroll: true }); } catch {} }, 450); }

  // ---------- Install prompt ----------
  let deferredInstall = null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; });

  // ---------- Sharing ----------
  const inviteUrl = () => `${location.origin}${location.pathname}?join=${S.code}`;
  // A QR code of the invite link, drawn as crisp SVG. Always dark on white so every camera can read it.
  function qrHTML() {
    if (typeof qrcode !== "function" || !S.code) return "";
    try {
      const q = qrcode(0, "M"); q.addData(inviteUrl()); q.make();
      const n = q.getModuleCount(); let d = "";
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      return `<figure class="qr"><svg viewBox="-2 -2 ${n + 4} ${n + 4}" role="img" aria-label="QR code to join ${esc(S.name)}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#1C1C1E"/></svg><figcaption>Scan with a phone camera to join</figcaption></figure>`;
    } catch { return ""; }
  }
  async function shareInvite() {
    const url = inviteUrl();
    const text = `Join ${S.name} on Together, our family calendar. Our code is ${S.code}.`;
    if (navigator.share) { try { await navigator.share({ title: "Join our family calendar", text, url }); return; } catch (e) { if (e.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); toast("Invite copied"); } catch { toast(`Your code is ${S.code}`); }
  }

  // ============================================================
  // Main calendar
  // ============================================================
  const view = { sel: todayStr(), weekStart: null, monthCursor: null, draft: null, open: null, tab: "cal", newList: false, choreDraft: null, editChores: false };
  const startOfWeek = (s) => addDays(s, -parse(s).getDay());

  function renderMain(soft = false) {
    if (!S.ready) return;
    if (soft && !$(".main", app)) return; // don't yank someone off another screen
    if (soft && view.draft) return;       // don't interrupt someone writing a plan
    if (soft && document.activeElement?.matches?.(".main input, .main textarea")) return; // or typing anywhere
    if (view.tab === "lists") return renderLists(soft);
    if (view.tab === "chores") return renderChores(soft);
    const ms = members(); const t = todayStr(); const sel = view.sel;
    if (!view.month) view.month = sel.slice(0, 8) + "01";
    const first = parse(view.month), mIdx = first.getMonth();
    const gridStart = addDays(view.month, -first.getDay());
    const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    const rows = parse(cells[35]).getMonth() !== mIdx ? 5 : 6;
    const dayTitle = sel === t ? "Today" : sel === addDays(t, 1) ? "Tomorrow" : sel === addDays(t, -1) ? "Yesterday" : fmt(sel, { weekday: "long" });
    const list = eventsOn(sel);
    const upcoming = Array.from({ length: 7 }, (_, i) => addDays(sel, i + 1)).map((d) => [d, eventsOn(d)]).filter(([, e]) => e.length).slice(0, 3);
    const scrollY = window.scrollY;
    const cell = (d) => {
      const evs = eventsOn(d), inMonth = parse(d).getMonth() === mIdx;
      const chips = evs.slice(0, 2).map((e) => `<i style="--c:${whoColors(e)[0] || "#9A9AA2"}">${esc(e.title)}</i>`).join("");
      return `<button class="mc ${inMonth ? "" : "other"} ${d === t ? "today" : ""} ${d === sel ? "sel" : ""}" data-day="${d}" aria-label="${esc(fmt(d, { weekday: "long", month: "long", day: "numeric" }))}${evs.length ? `, ${evs.length} plan${evs.length > 1 ? "s" : ""}` : ""}" ${d === sel ? 'aria-current="date"' : ""}>
        <span class="mn">${parse(d).getDate()}</span><span class="mchips">${chips}${evs.length > 2 ? `<b>+${evs.length - 2}</b>` : ""}</span></button>`;
    };

    eventCard.placed = false; eventCard.detailPlaced = false;
    app.innerHTML = `<main class="main">
      ${topbarHTML(`<button class="today-btn" data-today>Today</button>`)}
      <section class="month" aria-label="Month">
        <div class="month-bar">
          <h1 class="mtitle">${esc(first.toLocaleDateString(undefined, { month: "long" }))}<span>${first.getFullYear()}</span></h1>
          <div class="month-nav"><button data-mshift="-1" aria-label="Previous month">‹</button><button data-mshift="1" aria-label="Next month">›</button></div>
        </div>
        <div class="mgrid2" id="mgrid">
          ${["S", "M", "T", "W", "T", "F", "S"].map((d) => `<span class="wd">${d}</span>`).join("")}
          ${cells.slice(0, rows * 7).map(cell).join("")}
        </div>
      </section>
      <div class="day-head">
        <h2>${esc(dayTitle)}<span>${esc(fmt(sel, { month: "long", day: "numeric" }))}</span></h2>
        ${ms.length > 1 ? `<div class="seg" role="group" aria-label="Whose plans to show"><button data-jm="0" aria-pressed="${!S.justMe}">Everyone</button><button data-jm="1" aria-pressed="${!!S.justMe}">Just me</button></div>` : ""}
      </div>
      <div class="composer-slot">${view.draft && !view.draft.editing ? composerHTML() : `<button class="add-row" data-add><span class="plus" aria-hidden="true">+</span><span>Add something ${sel === t ? "today" : sel === addDays(t, 1) ? "tomorrow" : `on ${esc(fmt(sel, { weekday: "long" }))}`}</span></button>`}</div>
      ${sel === t && myChoresLeft() ? `<button class="chores-nudge" data-tab="chores">${STAR}<span>${myChoresLeft()} chore${myChoresLeft() > 1 ? "s" : ""} left today</span><span aria-hidden="true">›</span></button>` : ""}
      <div class="events" id="list">${list.length ? list.map(eventCard).join("") : view.draft ? "" : `<div class="empty"><div class="big">Nothing planned</div>Enjoy the quiet.</div>`}</div>
      ${upcoming.length ? `<div class="section-title">Coming up</div>${upcoming.map(([d, evs]) => `<div class="upcoming-day"><h4>${esc(d === addDays(t, 1) ? "Tomorrow" : fmt(d, { weekday: "long", month: "short", day: "numeric" }))}</h4><div class="events">${evs.map((e) => eventCard(e)).join("")}</div></div>`).join("")}` : ""}
    </main>${tabBarHTML()}`;
    bindTabBar();

    if (soft) { $$(".ev, .detail", app).forEach((x) => (x.style.animation = "none")); $(".month", app).style.animation = "none"; window.scrollTo(0, scrollY); }

    $("[data-today]").onclick = () => { view.sel = todayStr(); view.month = view.sel.slice(0, 8) + "01"; view.draft = null; renderMain(); };
    $$("[data-jm]").forEach((b) => b.onclick = () => { S.justMe = b.dataset.jm === "1"; save(); renderMain(true); });
    $$("[data-close-detail]").forEach((b) => b.onclick = () => { view.open = null; renderMain(true); });
    bindAttachments(app);
    const addBtn = $("[data-add]"); if (addBtn) addBtn.onclick = () => startDraft(null);
    if (view.draft) bindComposer();
    $$("[data-day]").forEach((b) => b.onclick = () => {
      view.sel = b.dataset.day; view.open = null;
      if (view.sel.slice(0, 7) !== view.month.slice(0, 7)) view.month = view.sel.slice(0, 8) + "01";
      if (view.draft && !view.draft.editing) view.draft.e.date = view.sel; else view.draft = null;
      renderMain(!view.draft);
    });
    $$("[data-mshift]").forEach((b) => b.onclick = () => shiftMonth(+b.dataset.mshift));
    $$("[data-ev]").forEach((b) => b.onclick = () => {
      const ev = S.events[b.dataset.ev];
      if (canChange(ev)) { view.open = null; startDraft(ev); } else { view.draft = null; view.open = ev.id; renderMain(true); }
    });
    const g = $("#mgrid"); let x0 = null, y0 = null;
    g.ontouchstart = (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; };
    g.ontouchend = (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) shiftMonth(dx < 0 ? 1 : -1);
    };
  }
  function shiftMonth(n) {
    const d = parse(view.month); d.setMonth(d.getMonth() + n); view.month = ymd(d);
    // Keep the selected day inside the month you're looking at.
    const t = todayStr();
    view.sel = t.slice(0, 7) === view.month.slice(0, 7) ? t : view.month;
    if (view.draft && !view.draft.editing) view.draft.e.date = view.sel; else view.draft = null;
    renderMain();
    const m = $(".month"); if (m) m.classList.add(n > 0 ? "from-right" : "from-left");
  }
  function shiftWeek(n) {
    view.weekStart = addDays(view.weekStart, 7 * n);
    view.sel = addDays(view.sel, 7 * n);
    if (view.draft && !view.draft.editing) view.draft.e.date = view.sel;
    renderMain();
  }
  function eventCard(e) {
    if (view.draft?.editing && view.draft.e.id === e.id && !$(".composer", app) && !eventCard.placed) { eventCard.placed = true; return composerHTML(); }
    if (view.open === e.id && !eventCard.detailPlaced) { eventCard.detailPlaced = true; return detailHTML(e); }
    const who = (e.who || []).map((id) => S.members[id]).filter((m) => m && !m.deleted);
    const time = e.allDay ? `All day` : `${fmtTime(e.start)}${e.end ? `<small>${fmtTime(e.end)}</small>` : ""}`;
    const meta = [who.length ? who.map((m) => m.name).join(", ") : "Everyone", e.repeat !== "none" ? REPEATS[e.repeat] : ""].filter(Boolean).join(" · ");
    const files = e.files || [], imgs = files.filter(isImage), docs = files.length - imgs.length;
    const extras = files.length ? `<span class="ev-files">${imgs.slice(0, 3).map((f) => `<img src="${esc(api.fileUrl(f))}" alt="" loading="lazy">`).join("")}${imgs.length > 3 ? `<span class="more">+${imgs.length - 3}</span>` : ""}${docs ? `<span class="docs">${CLIP}${docs}</span>` : ""}</span>` : "";
    return `<button class="ev" data-ev="${esc(e.id)}"><span class="bar" style="${barStyle(e)}"></span>
      <span class="time">${time}</span>
      <span class="body"><span class="ttl">${esc(e.title)}</span><span class="meta" style="display:block">${esc(meta)}${e.remind != null ? BELL : ""}</span>${e.notes ? `<span class="note-line">${esc(e.notes)}</span>` : ""}${extras}</span></button>`;
  }

  // A plan someone else made, shown read-only right where it sits.
  function detailHTML(e) {
    const who = (e.who || []).map((id) => S.members[id]).filter((m) => m && !m.deleted);
    const maker = S.members[e.by];
    return `<div class="detail">
      <div class="detail-title">${esc(e.title)}</div>
      <div class="detail-meta">${esc(e.allDay ? "All day" : `${fmtTime(e.start)}${e.end ? ` to ${fmtTime(e.end)}` : ""}`)} · ${esc(who.length ? who.map((m) => m.name).join(", ") : "Everyone")}${e.repeat !== "none" ? ` · ${esc(REPEATS[e.repeat])}` : ""}</div>
      ${e.notes ? `<p class="detail-note">${esc(e.notes)}</p>` : ""}
      ${attachmentsHTML(e.files || [], false)}
      <div class="detail-foot"><span>${esc(maker ? `Only ${maker.name} or a parent can change this.` : "Only a parent can change this.")}</span><button class="btn small soft" data-close-detail>Close</button></div>
    </div>`;
  }

  // Photos show as a soft gallery; other files as tidy rows. editable adds a remove button.
  function attachmentsHTML(files, editable) {
    if (!files.length) return "";
    const imgs = files.filter(isImage), docs = files.filter((f) => !isImage(f));
    return `<div class="attach">
      ${imgs.length ? `<div class="gallery">${imgs.map((f) => `<span class="ph"><button type="button" class="ph-open" data-view="${esc(f.id)}" aria-label="View ${esc(f.name)}"><img src="${esc(api.fileUrl(f))}" alt="${esc(f.name)}" loading="lazy"></button>${editable ? `<button type="button" class="x" data-unattach="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">×</button>` : ""}</span>`).join("")}</div>` : ""}
      ${docs.map((f) => `<div class="doc">${CLIP}<a href="${esc(api.fileUrl(f))}" target="_blank" rel="noopener" download="${esc(f.name)}">${esc(f.name)}</a><span class="sz">${esc(fmtSize(f.size))}</span>${editable ? `<button type="button" class="x" data-unattach="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">×</button>` : ""}</div>`).join("")}
    </div>`;
  }
  function bindAttachments(root) {
    $$("[data-view]", root).forEach((b) => b.onclick = (ev) => {
      ev.stopPropagation();
      const all = [...Object.values(S.events), view.draft?.e].filter(Boolean).flatMap((x) => x.files || []);
      const f = all.find((x) => x.id === b.dataset.view); if (f) showPhoto(f);
    });
  }
  function showPhoto(f) {
    const lb = document.createElement("div");
    lb.className = "lightbox";
    lb.innerHTML = `<img src="${esc(api.fileUrl(f))}" alt="${esc(f.name)}"><button type="button" aria-label="Close photo">×</button>`;
    document.body.appendChild(lb);
    requestAnimationFrame(() => lb.classList.add("open"));
    const close = () => { lb.classList.remove("open"); document.removeEventListener("keydown", onKey); setTimeout(() => lb.parentNode && lb.parentNode.removeChild(lb), 350); };
    const onKey = (k) => { if (k.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    lb.onclick = close;
  }

  // Shrink big photos before upload so they're quick on any phone.
  async function prepFile(file) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return { blob: file, name: file.name, w: 0, h: 0 };
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.85));
      if (!blob) throw new Error("no blob");
      return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg", w, h };
    } catch { return { blob: file, name: file.name, w: 0, h: 0 }; }
  }

  // ============================================================
  // Family HQ: tabs, lists, chores, reminders
  // ============================================================
  const BELL = `<svg class="bell" viewBox="0 0 24 24" aria-label="Has a reminder"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg>`;
  const CHECK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
  const STAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>`;
  const TAB_ICONS = {
    cal: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="4"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>`,
    lists: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.5" cy="6.5" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="17.5" r="1.2"/></svg>`,
    chores: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>`,
  };

  function topbarHTML(rightHTML = "") {
    const ms = members();
    const pendingCount = TABLES.reduce((n, k) => n + Object.keys(S.pending[k]).length, 0);
    return `<div class="topbar">
      <button class="fam-btn" data-settings aria-label="Family settings"><span class="stack">${ms.slice(0, 4).map((m) => avatar(m)).join("")}</span><span class="nm">${esc(S.name)}</span></button>
      <span class="top-right">${!online || pendingCount ? `<span class="sync-dot" title="Changes will sync when you're back online"></span>` : ""}${rightHTML}</span>
    </div>`;
  }
  function tabBarHTML() {
    const left = myChoresLeft();
    const tab = (k, label) => `<button data-tab="${k}" ${view.tab === k ? 'aria-current="page"' : ""}>${TAB_ICONS[k]}<span>${label}</span>${k === "chores" && left ? `<i class="badge">${left}</i>` : ""}</button>`;
    return `<nav class="tabbar" aria-label="Sections">${tab("cal", "Calendar")}${tab("lists", "Lists")}${tab("chores", "Chores")}</nav>`;
  }
  function bindTabBar() {
    $$("[data-tab]").forEach((b) => b.onclick = () => {
      if (view.tab === b.dataset.tab) return;
      view.tab = b.dataset.tab; view.draft = null; view.open = null; view.choreDraft = null; view.newList = false;
      renderMain(); scrollTo(0, 0);
    });
    const st = $("[data-settings]"); if (st) st.onclick = openSettings;
  }
  function keepScroll(soft, fn) { const y = scrollY; fn(); if (soft) scrollTo(0, y); }

  // ---------- Lists ----------
  const LIST_ORDER = { "list-groceries": 0, "list-todo": 1 };
  const allLists = () => Object.values(S.lists).filter((l) => !l.deleted)
    .sort((a, b) => (LIST_ORDER[a.id] ?? 9) - (LIST_ORDER[b.id] ?? 9) || (a.at || 0) - (b.at || 0));
  const itemsOf = (id) => Object.values(S.items).filter((i) => !i.deleted && i.listId === id);
  const itemRow = (i) => {
    const m = i.done && S.members[i.doneBy];
    return `<button class="item ${i.done ? "is-done" : ""}" data-item="${esc(i.id)}" aria-pressed="${i.done}"><span class="tick">${CHECK}</span><span class="it">${esc(i.text)}</span>${m ? `<span class="by" style="background:${m.color}" title="Done by ${esc(m.name)}">${esc(initial(m.name))}</span>` : ""}</button>`;
  };
  function listCard(l) {
    const its = itemsOf(l.id);
    const open = its.filter((i) => !i.done).sort((a, b) => (a.at || 0) - (b.at || 0));
    const done = its.filter((i) => i.done).sort((a, b) => b.updatedAt - a.updatedAt);
    return `<section class="list-card" data-list="${esc(l.id)}">
      <header><h3>${esc(l.name)}</h3><span class="count">${open.length ? `${open.length} to go` : its.length ? "All done" : ""}</span></header>
      <div class="items" data-open="${esc(l.id)}">${open.map(itemRow).join("")}</div>
      <form class="add-item" data-additem="${esc(l.id)}"><span class="plus" aria-hidden="true">+</span><input maxlength="200" placeholder="Add to ${esc(l.name)}" enterkeyhint="done" autocomplete="off" aria-label="Add to ${esc(l.name)}"></form>
      ${done.length ? `<div class="done-head"><span>${done.length} done</span><button class="link" data-clear="${esc(l.id)}">Clear</button></div><div class="items">${done.slice(0, 6).map(itemRow).join("")}</div>` : ""}
      ${!its.length && (isParent() || l.by === S.meId) && !(l.id in LIST_ORDER) ? `<button class="link danger-link" data-rmlist="${esc(l.id)}">Remove this list</button>` : ""}
    </section>`;
  }
  function renderLists(soft) {
    if (!allLists().length && !Object.keys(S.lists).length) {
      queue("lists", { id: "list-groceries", name: "Groceries", by: S.meId, at: 1, deleted: false });
      queue("lists", { id: "list-todo", name: "To-do", by: S.meId, at: 2, deleted: false });
    }
    keepScroll(soft, () => {
      app.innerHTML = `<main class="main">${topbarHTML()}
        <div class="hero"><div class="hero-top"><span class="kicker">Shared with everyone</span></div><h1>Lists</h1></div>
        <div class="lists">${allLists().map(listCard).join("")}</div>
        ${view.newList ? `<form class="list-card new-list" data-newlist-form><input class="c-title" id="nl" maxlength="60" placeholder="Name your list" autocomplete="off" aria-label="List name"><div class="c-actions"><span style="flex:1"></span><button type="button" class="link" data-nl-cancel>Cancel</button><button class="btn small">Add list</button></div></form>`
          : `<button class="add-row" data-newlist><span class="plus" aria-hidden="true">+</span><span>New list</span></button>`}
      </main>${tabBarHTML()}`;
    });
    if (soft) $$(".list-card", app).forEach((x) => (x.style.animation = "none"));
    bindTabBar();
    bindItems(app);
    $$("[data-additem]").forEach((f) => f.onsubmit = (ev) => {
      ev.preventDefault();
      const input = $("input", f), text = input.value.trim(); if (!text) return;
      const item = { id: uid(), listId: f.dataset.additem, text, done: false, by: S.meId, at: Date.now(), deleted: false };
      queue("items", item);
      input.value = "";
      const box = $(`[data-open="${CSS.escape(item.listId)}"]`); box.insertAdjacentHTML("beforeend", itemRow(item));
      bindItems(box);
      const cnt = $(`[data-list="${CSS.escape(item.listId)}"] .count`); if (cnt) cnt.textContent = `${itemsOf(item.listId).filter((i) => !i.done).length} to go`;
    });
    $$("[data-clear]").forEach((b) => b.onclick = () => {
      const done = itemsOf(b.dataset.clear).filter((i) => i.done);
      done.forEach((i) => queue("items", { ...i, deleted: true }));
      renderMain();
      toast(`Cleared ${done.length}`, { label: "Undo", run: () => { done.forEach((i) => queue("items", { ...i, deleted: false })); renderMain(); } });
    });
    $$("[data-rmlist]").forEach((b) => b.onclick = () => {
      if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Tap again to remove"; return; }
      const l = S.lists[b.dataset.rmlist]; queue("lists", { ...l, deleted: true }); renderMain();
      toast("List removed", { label: "Undo", run: () => { queue("lists", { ...l, deleted: false }); renderMain(); } });
    });
    const nb = $("[data-newlist]"); if (nb) nb.onclick = () => { view.newList = true; renderMain(); const i = $("#nl"); if (i) i.focus(); };
    const nf = $("[data-newlist-form]");
    if (nf) {
      nf.onsubmit = (ev) => {
        ev.preventDefault(); const name = $("#nl").value.trim(); if (!name) return;
        queue("lists", { id: uid(), name, by: S.meId, at: Date.now(), deleted: false });
        view.newList = false; renderMain();
        const last = $$(".add-item input").pop(); if (last) last.focus();
      };
      $("[data-nl-cancel]").onclick = () => { view.newList = false; renderMain(); };
    }
  }
  function bindItems(root) {
    $$("[data-item]", root).forEach((b) => b.onclick = () => {
      const i = S.items[b.dataset.item]; if (!i) return;
      queue("items", { ...i, done: !i.done, doneBy: !i.done ? S.meId : "" });
      b.classList.toggle("is-done"); b.classList.add("leaving");
      setTimeout(() => renderMain(true), 380);
    });
  }

  // ---------- Chores and tasks ----------
  // Three kinds: every day, every week (on a chosen day), or just once (a task, maybe with a due date).
  const ONCE = "2000-01-01";
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ALERTS = [["", "No alert"], ["08:00", "8:00 AM"], ["16:00", "4:00 PM"], ["19:00", "7:00 PM"]];
  const periodOf = (c, day = todayStr()) => (c.freq === "daily" ? day : c.freq === "weekly" ? startOfWeek(day) : ONCE);
  const checkOf = (c, p = periodOf(c)) => S.checks[`${c.id}:${p}`];
  const isDone = (c, p = periodOf(c)) => { const k = checkOf(c, p); return !!(k && k.done && !k.deleted); };
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const allChores = () => Object.values(S.chores)
    .filter((c) => !c.deleted && S.members[c.who] && !S.members[c.who].deleted)
    // a finished one-time task stays (ticked) for the rest of the day, then tidies itself away
    .filter((c) => c.freq !== "once" || !isDone(c) || (checkOf(c).updatedAt || 0) >= startOfToday())
    .sort((a, b) => ({ daily: 0, weekly: 1, once: 2 }[a.freq] - { daily: 0, weekly: 1, once: 2 }[b.freq]) || (a.due || "9").localeCompare(b.due || "9") || (a.at || 0) - (b.at || 0));
  function streakOf(c) {
    if (c.freq === "once") return 0;
    const step = c.freq === "daily" ? 1 : 7;
    let p = periodOf(c), n = 0;
    if (!isDone(c, p)) p = addDays(p, -step);
    while (isDone(c, p) && n < 999) { n++; p = addDays(p, -step); }
    return n;
  }
  const dueNow = (c) => c.freq !== "once" || !c.due || c.due <= todayStr();
  const myChoresLeft = () => allChores().filter((c) => c.who === S.meId && !isDone(c) && dueNow(c)).length;
  const canCheck = (c) => isParent() || c.who === S.meId;
  const canEditChore = (c) => isParent() || c.by === S.meId;
  function choreWhen(c) {
    const t = todayStr();
    const alert = c.remindAt ? ` · alert ${fmtTime(c.remindAt)}` : "";
    if (c.freq === "daily") return `Every day${alert}`;
    if (c.freq === "weekly") return `Every ${WEEKDAYS[c.day ?? 6]}${alert}`;
    if (!c.due) return "Anytime";
    if (c.due < t && !isDone(c)) return `Overdue · was due ${fmt(c.due, { weekday: "short", month: "short", day: "numeric" })}`;
    if (c.due === t) return `Due today${alert}`;
    if (c.due === addDays(t, 1)) return `Due tomorrow${alert}`;
    return `Due ${fmt(c.due, { weekday: "short", month: "short", day: "numeric" })}${alert}`;
  }

  function choreRow(c) {
    if (view.choreDraft?.c.id === c.id) return choreFormHTML();
    const done = isDone(c), streak = streakOf(c), when = choreWhen(c);
    return `<div class="chore ${done ? "is-done" : ""} ${when.startsWith("Overdue") ? "overdue" : ""}">
      <button class="tick-btn" data-check="${esc(c.id)}" aria-pressed="${done}" aria-label="${done ? "Mark not done" : "Mark done"}: ${esc(c.title)}"><span class="tick">${CHECK}</span></button>
      <span class="ct">${esc(c.title)}<small>${c.remindAt ? BELL : ""}${esc(when)}</small></span>
      ${streak >= 2 ? `<span class="streak" title="${streak} ${c.freq === "daily" ? "days" : "weeks"} in a row">${STAR}${streak}</span>` : ""}
      ${canEditChore(c) ? `<button class="link chore-edit" data-cedit="${esc(c.id)}" aria-label="Change ${esc(c.title)}">Edit</button>` : ""}
    </div>`;
  }
  function choreFormHTML() {
    const { c, editing, exact } = view.choreDraft;
    const t = todayStr();
    const chip = (on, attrs, label) => `<button type="button" class="pill ${on ? "on" : ""}" ${attrs} aria-pressed="${on}">${label}</button>`;
    const who = isParent() ? members() : members().filter((m) => m.id === S.meId);
    const sat = addDays(t, (6 - parse(t).getDay() + 7) % 7 || 7);
    const dues = [t, addDays(t, 1), sat]; if (c.due && !dues.includes(c.due)) dues.push(c.due);
    const canAlert = c.freq !== "once" || !!c.due;
    const presetAlert = ALERTS.some(([v]) => v === c.remindAt);
    return `<form class="composer chore-form" data-chore-form>
      <input class="c-title" id="cht" maxlength="80" placeholder="${c.freq === "once" ? "What needs doing?" : "What's the chore?"}" value="${esc(c.title)}" autocomplete="off" aria-label="Chore or task">
      <div class="c-row"><span class="c-label">Who</span><div class="pills">${who.map((m) => chip(c.who === m.id, `data-chw="${esc(m.id)}"`, `<span class="dot" style="background:${m.color}"></span>${esc(m.name)}${m.id === S.meId ? " (me)" : ""}`)).join("")}</div></div>
      <div class="c-row"><span class="c-label">How often</span><div class="pills">${chip(c.freq === "daily", 'data-chf="daily"', "Every day")}${chip(c.freq === "weekly", 'data-chf="weekly"', "Every week")}${chip(c.freq === "once", 'data-chf="once"', "Just once")}</div></div>
      ${c.freq === "weekly" ? `<div class="c-row"><span class="c-label">On</span><div class="pills days">${WEEKDAYS.map((d, i) => chip(c.day === i, `data-chd="${i}" aria-label="${d}"`, d.slice(0, 3))).join("")}</div></div>` : ""}
      ${c.freq === "once" ? `<div class="c-row"><span class="c-label">Due</span><div class="pills">
        ${dues.map((d) => chip(c.due === d, `data-chdue="${d}"`, esc(d === t ? "Today" : d === addDays(t, 1) ? "Tomorrow" : fmt(d, { weekday: "short", month: "short", day: "numeric" })))).join("")}
        <label class="pill other">Other…<input type="date" id="chdate" value="${c.due || t}" aria-label="Pick a due date"></label>
        ${chip(!c.due, 'data-chdue=""', "Anytime")}
      </div></div>` : ""}
      ${canAlert ? `<div class="c-row"><span class="c-label">Alert ${esc(S.members[c.who]?.name || "")}${c.freq === "once" ? " on the day" : ""}</span><div class="pills">
        ${ALERTS.map(([v, l]) => chip(!exact && c.remindAt === v, `data-cha="${v}"`, l)).join("")}
        ${chip(exact || (!!c.remindAt && !presetAlert), 'data-cha="exact"', "Other time")}
      </div>
      ${exact || (!!c.remindAt && !presetAlert) ? `<div class="times"><input type="time" id="chtime" value="${c.remindAt || "17:00"}" aria-label="Alert time"></div>` : ""}
      ${c.remindAt ? `<span class="c-hint">Only if it isn't done yet. It goes to ${esc(S.members[c.who]?.name || "their")}${c.who === S.meId ? " (this phone)" : "'s phone"} once reminders are on there.</span>` : ""}
      ${c.remindAt && c.who === S.meId && !S.push ? `<button type="button" class="link more-link" data-push-on>Turn on notifications for this phone</button>` : ""}
      </div>` : ""}
      <div class="c-actions">${editing ? `<button type="button" class="link danger-link" data-chdel>Remove</button>` : ""}<span style="flex:1"></span><button type="button" class="link" data-chcancel>Cancel</button><button class="btn small">${editing ? "Save" : c.freq === "once" ? "Add task" : "Add chore"}</button></div>
    </form>`;
  }
  function renderChores(soft) {
    const ms = members(), chores = allChores();
    const groups = ms.map((m) => [m, chores.filter((c) => c.who === m.id)]).filter(([, cs]) => cs.length)
      .sort(([a], [b]) => (a.id === S.meId ? -1 : b.id === S.meId ? 1 : 0));
    const newDraft = view.choreDraft && !view.choreDraft.editing;
    keepScroll(soft, () => {
      app.innerHTML = `<main class="main">${topbarHTML()}
        <div class="hero"><div class="hero-top"><span class="kicker">${esc(fmt(todayStr(), { weekday: "long", month: "long", day: "numeric" }))}</span></div><h1>Chores</h1></div>
        ${newDraft ? choreFormHTML() : `<button class="add-row" data-addchore><span class="plus" aria-hidden="true">+</span><span>${isParent() ? "Add a chore or task" : "Add a task for me"}</span></button>`}
        ${groups.map(([m, cs]) => {
          const due = cs.filter(dueNow), doneN = due.filter((c) => isDone(c)).length;
          return `<section class="chore-card">
            <header>${avatar(m, "lg")}<span class="cn">${esc(m.name)}${m.id === S.meId ? " (you)" : ""}</span><span class="count">${!due.length ? "" : doneN === due.length ? "All done" : `${doneN} of ${due.length} done`}</span></header>
            ${cs.map(choreRow).join("")}
          </section>`;
        }).join("")}
        ${!chores.length && !newDraft ? `<div class="empty"><div class="big">No chores yet</div>${isParent() ? "Give each person a chore or a one-time task. They tick it off, and a streak keeps them going." : "Lucky you."}</div>` : ""}
      </main>${tabBarHTML()}`;
    });
    if (soft) $$(".chore-card", app).forEach((x) => (x.style.animation = "none"));
    bindTabBar();
    $$("[data-check]").forEach((b) => b.onclick = () => {
      const c = S.chores[b.dataset.check];
      if (!canCheck(c)) { toast(`That's ${S.members[c.who]?.name || "someone else"}'s`); return; }
      const p = periodOf(c), id = `${c.id}:${p}`, was = isDone(c, p);
      queue("checks", { ...(S.checks[id] || {}), id, choreId: c.id, period: p, done: !was, by: S.meId, deleted: false });
      renderMain(true);
      if (!was && c.who === S.meId && myChoresLeft() === 0) toast("All done. Nice work!");
    });
    $$("[data-cedit]").forEach((b) => b.onclick = () => { view.choreDraft = { c: { ...S.chores[b.dataset.cedit] }, editing: true, exact: false }; renderMain(); });
    const add = $("[data-addchore]");
    if (add) add.onclick = () => {
      const kid = isParent() ? (ms.find((m) => m.id !== S.meId) || ms[0]) : me();
      view.choreDraft = { c: { id: uid(), title: "", who: kid?.id || S.meId, freq: isParent() ? "daily" : "once", day: 6, due: todayStr(), remindAt: "", by: S.meId, at: Date.now(), deleted: false }, editing: false, exact: false };
      renderMain(); const t = $("#cht"); if (t) t.focus();
    };
    const f = $("[data-chore-form]");
    if (f) {
      const d = view.choreDraft, c = d.c;
      $("#cht").oninput = (x) => { c.title = x.target.value; };
      const redraw = () => { const y = scrollY; renderMain(); scrollTo(0, y); };
      $$("[data-chw]", f).forEach((b) => b.onclick = () => { c.who = b.dataset.chw; redraw(); });
      $$("[data-chf]", f).forEach((b) => b.onclick = () => { c.freq = b.dataset.chf; if (c.freq === "once" && c.due === undefined) c.due = todayStr(); redraw(); });
      $$("[data-chd]", f).forEach((b) => b.onclick = () => { c.day = +b.dataset.chd; redraw(); });
      $$("[data-chdue]", f).forEach((b) => b.onclick = () => { c.due = b.dataset.chdue; if (!c.due) c.remindAt = ""; redraw(); });
      const dd = $("#chdate", f); if (dd) dd.onchange = () => { if (dd.value) { c.due = dd.value; redraw(); } };
      $$("[data-cha]", f).forEach((b) => b.onclick = () => {
        if (b.dataset.cha === "exact") { d.exact = true; if (!c.remindAt) c.remindAt = "17:00"; } else { d.exact = false; c.remindAt = b.dataset.cha; }
        redraw();
      });
      const tm = $("#chtime", f); if (tm) tm.onchange = () => { if (tm.value) c.remindAt = tm.value; };
      const pon = $("[data-push-on]", f); if (pon) pon.onclick = async () => { await enablePush(); redraw(); };
      $("[data-chcancel]", f).onclick = () => { view.choreDraft = null; renderMain(); };
      const del = $("[data-chdel]", f);
      if (del) del.onclick = () => {
        const before = S.chores[c.id]; queue("chores", { ...before, deleted: true }); view.choreDraft = null; renderMain();
        toast("Removed", { label: "Undo", run: () => { queue("chores", { ...before, deleted: false }); renderMain(); } });
      };
      f.onsubmit = (ev) => {
        ev.preventDefault();
        c.title = $("#cht").value.trim();
        if (!c.title) { const t = $("#cht"); t.classList.remove("nudge"); void t.offsetWidth; t.classList.add("nudge"); return; }
        if (c.freq !== "once") c.due = "";
        if (c.freq === "once" && !c.due) c.remindAt = "";
        queue("chores", { ...c }); const was = d.editing; view.choreDraft = null; renderMain();
        const name = S.members[c.who]?.name;
        if (c.remindAt && c.who === S.meId && !S.push && pushSupported()) toast(was ? "Saved" : "Added", { label: "Turn on alerts", run: enablePush });
        else toast(was ? "Saved" : c.who === S.meId ? "Added" : `Added for ${name}`);
      };
    }
  }

  // ---------- Reminders (push notifications) ----------
  const remindOptions = (e) => e.allDay
    ? [[null, "No reminder"], [0, "Morning of"], [1440, "Day before"]]
    : [[null, "No reminder"], [0, "When it starts"], [10, "10 min before"], [60, "1 hour before"], [1440, "Day before"]];
  const pushSupported = () => !DEMO && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const b64uBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  async function enablePush() {
    if (DEMO) { toast("Reminders work once Together is installed"); return; }
    if (isIOS && !isStandalone()) { toast("Add Together to your Home Screen first"); return; }
    if (!pushSupported()) { toast("This browser can't show reminders"); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Notifications are turned off for this app"); return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await req("GET", `/api/families/${S.code}/push`);
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(publicKey) });
      await req("POST", `/api/families/${S.code}/push`, { memberId: S.meId, subscription: sub.toJSON(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      S.push = true; save(); toast("Reminders are on");
    } catch { toast("Couldn't turn on reminders. Try again."); }
  }
  async function disablePush() {
    try {
      const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
      if (sub) { await req("DELETE", `/api/families/${S.code}/push`, { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    } catch {}
    S.push = false; save(); toast("Reminders are off on this phone");
  }
  async function testPush() {
    try {
      const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
      const r = sub ? await req("POST", `/api/families/${S.code}/push/test`, { endpoint: sub.endpoint }) : { ok: false };
      toast(r.ok ? "Sent. It should pop up in a moment" : "That didn't go through. Turn reminders off and on again.");
    } catch { toast("That didn't go through. Try again."); }
  }

  // ---------- Sheets ----------
  function openSheet(html, bind, { label = "Sheet" } = {}) {
    const root = $("#sheet-root");
    root.innerHTML = `<div class="scrim"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="grabber"></div>${html}</div>`;
    const scrim = $(".scrim", root), sheet = $(".sheet", root);
    requestAnimationFrame(() => requestAnimationFrame(() => { scrim.classList.add("open"); sheet.classList.add("open"); }));
    const close = () => {
      scrim.classList.remove("open"); sheet.classList.remove("open");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => { if (root.contains(sheet)) root.innerHTML = ""; }, 450);
    };
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    scrim.onclick = close;
    // drag down to dismiss
    let y0 = null;
    $(".grabber", sheet).parentElement.addEventListener("touchstart", (e) => { if (sheet.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
    sheet.addEventListener("touchmove", (e) => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
    sheet.addEventListener("touchend", (e) => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; sheet.style.transform = ""; y0 = null; if (dy > 120) close(); });
    bind(sheet, close);
    return close;
  }

  // ---------- Adding and editing plans, right on the page ----------
  const PRESETS = [
    { key: "allday", label: "All day" },
    { key: "morning", label: "Morning", start: "09:00" },
    { key: "afternoon", label: "Afternoon", start: "15:00" },
    { key: "evening", label: "Evening", start: "18:00" },
  ];
  const plusHour = (t) => { const [h, m] = t.split(":").map(Number); return h >= 23 ? "23:59" : `${pad(h + 1)}:${pad(m)}`; };
  const shortDay = (d) => { const t = todayStr(); return d === t ? "Today" : d === addDays(t, 1) ? "Tomorrow" : fmt(d, { weekday: "short", month: "short", day: "numeric" }); };

  function startDraft(ev) {
    const ms = members();
    const e = ev
      ? { ...ev, who: [...(ev.who || [])] }
      : { id: uid(), title: "", date: view.sel, allDay: true, start: "", end: "", who: ms.length > 1 ? [] : (S.meId ? [S.meId] : []), notes: "", repeat: "none", files: [] };
    e.files = [...(e.files || [])];
    const exact = !!ev && !ev.allDay && !PRESETS.some((p) => p.start === ev.start);
    if (e.remind === undefined) e.remind = null;
    view.draft = { e, editing: !!ev, exact, more: !!ev && (ev.repeat !== "none" || !!ev.notes || ev.remind != null), uploading: 0, orig: (e.files || []).map((f) => f.id) };
    renderMain();
    const t = $("#ct");
    if (t && !ev) t.focus({ preventScroll: true }); // same tap, so phones open the keyboard
    const c = $(".composer"); if (c) c.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function composerHTML() {
    const { e, editing, exact, more, uploading } = view.draft;
    const ms = members(); const t = todayStr();
    const sat = addDays(t, (6 - parse(t).getDay() + 7) % 7 || 7);
    const days = [t, addDays(t, 1)]; if (!days.includes(sat)) days.push(sat); if (!days.includes(e.date)) days.push(e.date);
    const chip = (on, attrs, label) => `<button class="pill ${on ? "on" : ""}" ${attrs} aria-pressed="${on}">${label}</button>`;
    const timeOn = (p) => (p.key === "allday" ? e.allDay : !e.allDay && !exact && e.start === p.start);
    return `<div class="composer">
      <input class="c-title" id="ct" placeholder="What's happening?" maxlength="200" autocomplete="off" value="${esc(e.title)}" enterkeyhint="done" aria-label="What's happening?">
      <div class="c-row"><span class="c-label">Day</span><div class="pills">
        ${days.map((d) => chip(d === e.date, `data-cd="${d}"`, esc(shortDay(d)))).join("")}
        <label class="pill other">Other…<input type="date" id="cdate" value="${e.date}" aria-label="Pick another day"></label>
      </div></div>
      <div class="c-row"><span class="c-label">Time</span><div class="pills">
        ${PRESETS.map((p) => chip(timeOn(p), `data-ct="${p.key}"`, p.label)).join("")}
        ${chip(!e.allDay && exact, `data-ct="exact"`, "Exact time")}
      </div>
      ${!e.allDay && exact ? `<div class="times"><input type="time" id="cs" value="${e.start}" aria-label="Starts"><em>to</em><input type="time" id="ce" value="${e.end}" aria-label="Ends"></div>` : ""}</div>
      ${ms.length > 1 ? `<div class="c-row"><span class="c-label">Who</span><div class="pills">
        ${chip(!e.who.length, "data-cw-all", "Everyone")}
        ${ms.map((m) => chip(e.who.includes(m.id), `data-cw="${esc(m.id)}"`, `<span class="dot" style="background:${m.color}"></span>${esc(m.name)}`)).join("")}
      </div></div>` : ""}
      ${more ? `<div class="c-row"><span class="c-label">Remind me</span><div class="pills">
        ${remindOptions(e).map(([k, v]) => chip(e.remind === k, `data-crm="${k}"`, v)).join("")}
      </div>${e.remind != null && !S.push ? `<button class="link more-link" data-push-on>Turn on notifications for this phone</button>` : ""}</div>
      <div class="c-row"><span class="c-label">Repeats</span><div class="pills">
        ${[["none", "Just once"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]].map(([k, v]) => chip(e.repeat === k, `data-cr="${k}"`, v)).join("")}
      </div></div>
      <input class="c-note" id="cn" placeholder="Add a note (optional)" maxlength="2000" value="${esc(e.notes)}" aria-label="Note">` : `<button class="link more-link" data-cmore>Reminder, repeat or note</button>`}
      ${attachmentsHTML(e.files, true)}
      ${e.files.length < 10 ? `<label class="pill attach-pill ${uploading ? "busy" : ""}">${CLIP}${uploading ? "Adding…" : "Add a photo or file"}<input type="file" id="cfile" multiple aria-label="Add a photo or file"></label>` : ""}
      <div class="c-actions">
        ${editing ? `<button class="link danger-link" data-cdel>Remove</button>` : ""}
        <span style="flex:1"></span>
        <button class="link" data-ccancel>Cancel</button>
        <button class="btn small" data-csave ${uploading ? "disabled" : ""}>${editing ? "Save" : "Add"}</button>
      </div>
    </div>`;
  }

  function refreshComposer() {
    const host = $(".composer"); if (!host) return;
    host.outerHTML = composerHTML();
    bindComposer(true);
  }

  function bindComposer(quiet = false) {
    const c = $(".composer"); if (!c || !view.draft) return;
    if (quiet) c.style.animation = "none";
    const d = view.draft, e = d.e, ms = members();
    const title = $("#ct", c);
    title.oninput = () => { e.title = title.value; };
    title.onkeydown = (k) => { if (k.key === "Enter") { k.preventDefault(); title.blur(); } };
    const cn = $("#cn", c); if (cn) cn.oninput = (x) => { e.notes = x.target.value; };
    const more = $("[data-cmore]", c); if (more) more.onclick = () => { d.more = true; refreshComposer(); };
    $$("[data-cd]", c).forEach((b) => b.onclick = () => { e.date = b.dataset.cd; refreshComposer(); });
    $("#cdate", c).onchange = (x) => { if (x.target.value) { e.date = x.target.value; refreshComposer(); } };
    $$("[data-ct]", c).forEach((b) => b.onclick = () => {
      const k = b.dataset.ct;
      if (k === "allday") Object.assign(e, { allDay: true, start: "", end: "" }), (d.exact = false);
      else if (k === "exact") { d.exact = true; if (e.allDay || !e.start) Object.assign(e, { allDay: false, start: "17:00", end: "18:00" }); else e.allDay = false; }
      else { const p = PRESETS.find((x) => x.key === k); Object.assign(e, { allDay: false, start: p.start, end: plusHour(p.start) }); d.exact = false; }
      refreshComposer();
    });
    const cs = $("#cs", c), ce = $("#ce", c);
    if (cs) cs.onchange = () => { if (!cs.value) return; e.start = cs.value; if (!ce.value || ce.value <= cs.value) { ce.value = plusHour(cs.value); } e.end = ce.value; };
    if (ce) ce.onchange = () => { e.end = ce.value > e.start ? ce.value : ""; };
    const all = $("[data-cw-all]", c); if (all) all.onclick = () => { e.who = []; refreshComposer(); };
    $$("[data-cw]", c).forEach((b) => b.onclick = () => {
      const id = b.dataset.cw; e.who = e.who.includes(id) ? e.who.filter((x) => x !== id) : [...e.who, id];
      if (e.who.length === ms.length) e.who = [];
      refreshComposer();
    });
    $$("[data-cr]", c).forEach((b) => b.onclick = () => { e.repeat = b.dataset.cr; refreshComposer(); });
    $$("[data-crm]", c).forEach((b) => b.onclick = () => { e.remind = b.dataset.crm === "null" ? null : +b.dataset.crm; refreshComposer(); });
    const pon = $("[data-push-on]", c); if (pon) pon.onclick = async () => { await enablePush(); refreshComposer(); };
    bindAttachments(c);
    $$("[data-unattach]", c).forEach((b) => b.onclick = () => { e.files = e.files.filter((f) => f.id !== b.dataset.unattach); refreshComposer(); });
    const fileIn = $("#cfile", c);
    if (fileIn) fileIn.onchange = async () => {
      const picked = Array.from(fileIn.files || []).slice(0, 10 - e.files.length);
      if (!picked.length) return;
      d.uploading += picked.length; refreshComposer();
      for (const file of picked) {
        try {
          const { blob, name, w, h } = await prepFile(file);
          const res = await api.upload(S.code, blob, name);
          e.files.push({ id: res.id, name: res.name || name, type: res.type || blob.type, size: res.size || blob.size, w, h });
        } catch (err) { toast(err.message && err.message.length < 70 ? err.message : "That file didn't upload. Try again."); }
        d.uploading--;
        if (view.draft === d) refreshComposer();
      }
    };
    const dropNew = () => { for (const f of e.files) if (!d.orig.includes(f.id)) api.removeFile(S.code, f.id); };
    $("[data-ccancel]", c).onclick = () => { dropNew(); view.draft = null; renderMain(); };
    $("[data-csave]", c).onclick = () => {
      e.title = $("#ct", c).value.trim();
      if (!e.title) { const t = $("#ct", c); t.classList.remove("nudge"); void t.offsetWidth; t.classList.add("nudge"); t.focus(); return; }
      Object.assign(e, { notes: (e.notes || "").trim(), by: e.by || S.meId, deleted: false });
      for (const id of d.orig) if (!e.files.some((f) => f.id === id)) api.removeFile(S.code, id);
      queue("events", e);
      const was = d.editing; view.draft = null; view.sel = e.date; view.weekStart = startOfWeek(e.date); view.month = (e.date).slice(0, 8) + "01";
      renderMain();
      if (e.remind != null && !S.push && pushSupported()) toast(was ? "Saved" : "Added", { label: "Turn on reminders", run: enablePush });
      else toast(was ? "Saved" : "Added");
    };
    const del = $("[data-cdel]", c);
    if (del) del.onclick = () => {
      if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = "Tap again to remove"; return; }
      const before = S.events[e.id];
      dropNew();
      queue("events", { ...before, deleted: true }); view.draft = null; renderMain();
      toast("Removed", { label: "Undo", run: () => { queue("events", { ...before, deleted: false }); renderMain(); toast("Brought it back"); } });
    };
  }

  function openMonth() {
    view.monthCursor = view.sel.slice(0, 7) + "-01";
    const draw = (sheet, close) => {
      const first = parse(view.monthCursor); const start = addDays(view.monthCursor, -first.getDay());
      const t = todayStr(); const m = first.getMonth();
      const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
      const rows = parse(cells[35]).getMonth() !== m ? 35 : 42;
      $(".month-body", sheet).innerHTML = `<div class="month-head"><button data-m="-1" aria-label="Previous month">‹</button><h2>${esc(first.toLocaleDateString(undefined, { month: "long", year: "numeric" }))}</h2><button data-m="1" aria-label="Next month">›</button></div>
        <div class="mgrid">${["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="wd">${d}</div>`).join("")}
        ${cells.slice(0, rows).map((d) => `<button class="mday ${parse(d).getMonth() !== m ? "other" : ""} ${d === t ? "today" : ""} ${d === view.sel ? "sel" : ""}" data-pick="${d}" aria-label="${esc(fmt(d, { weekday: "long", month: "long", day: "numeric" }))}">${parse(d).getDate()}<span class="dots">${dotsFor(d)}</span></button>`).join("")}</div>
        <button class="btn soft" style="width:100%;margin-top:18px" data-pick="${t}">Go to today</button>`;
      $$("[data-m]", sheet).forEach((b) => b.onclick = () => { const d = parse(view.monthCursor); d.setMonth(d.getMonth() + +b.dataset.m); view.monthCursor = ymd(d); draw(sheet, close); });
      $$("[data-pick]", sheet).forEach((b) => b.onclick = () => { view.sel = b.dataset.pick; view.weekStart = startOfWeek(view.sel); view.month = (view.sel).slice(0, 8) + "01"; close(); renderMain(); });
    };
    openSheet(`<div class="month-body"></div>`, draw, { label: "Month" });
  }

  function openSettings() {
    const m = me();
    const html = `<div class="sheet-head"><span></span><h2>Family</h2><button class="primary" data-close>Done</button></div>
      <div class="settings-code">
        <div class="hint" style="color:var(--muted);font-size:15px">Your family code</div>
        <div class="code-big">${esc(S.code)}</div>
        ${qrHTML()}
        <button class="btn" style="width:100%" data-share>Share invite</button>
      </div>
      <div class="section-title">Calendar name</div>
      <div class="group"><div class="row"><label for="fn">Name</label><input class="inline-input" id="fn" maxlength="40" value="${esc(S.name)}" ${isParent() ? "" : "disabled"}></div></div>
      <div class="section-title">Members</div>
      <div class="group">${members().map((x) => `<div class="member-row">${avatar(x, "lg")}<span style="font-weight:600">${esc(x.name)}</span>${x.id === S.meId ? `<span class="you">You</span>` : ""}</div>`).join("")}</div>
      ${m ? `<div class="section-title">You</div>
      <div class="group"><div class="row"><label for="mn">Your name</label><input class="inline-input" id="mn" maxlength="24" value="${esc(m.name)}"></div>
        <div class="mini-swatches" role="group" aria-label="Your color">${COLORS.map((c) => `<button class="swatch" style="background:${c.hex}" aria-label="${c.name}" aria-pressed="${c.hex === m.color}" data-c="${c.hex}"></button>`).join("")}</div></div>` : ""}
      <div class="section-title">Reminders</div>
      <div class="group" id="rm"></div>
      <div class="section-title">Parent code</div>
      <div class="group" id="pc"></div>
      ${!isStandalone() ? `<div class="group"><button class="danger" style="color:var(--ink)" data-install>Add to Home Screen</button></div>` : ""}
      <div class="group"><button class="danger" data-leave>Leave this calendar</button></div>
      <p class="foot-note">Anyone with the family code can see this calendar.<br>Leaving only removes it from this device.</p>`;
    openSheet(html, (sheet, close) => {
      $("[data-close]", sheet).onclick = close;
      // Parent code: set it, unlock this phone, change it, or lock this phone again.
      const pc = $("#pc", sheet);
      const pinRow = (label, action) => `<div class="row"><input class="inline-input pin-inline" id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="4 digits" aria-label="${label}" autocomplete="off"><button class="pill on" data-pin-go>${action}</button></div><div class="pin-msg" id="pinmsg"></div>`;
      const drawPc = (mode) => {
        if (mode === "set" || mode === "change") pc.innerHTML = `<div class="row-text">${mode === "set" ? "Pick four digits only parents know." : "Pick a new four-digit code."}</div>${pinRow("New parent code", "Save")}`;
        else if (!S.pinHash) pc.innerHTML = `<div class="row"><span class="row-text">Not set. Anyone can change any plan.</span><button class="pill" data-pc="set">Set code</button></div>`;
        else if (S.parent) pc.innerHTML = `<div class="row"><span class="row-text">This phone is unlocked for a parent.</span></div><div class="row"><button class="pill" data-pc="change">Change code</button><button class="pill" data-pc="lock">Lock this phone</button></div>`;
        else pc.innerHTML = `<div class="row-text">Kids can change only their own plans. Enter the parent code to change anything.</div>${pinRow("Parent code", "Unlock")}`;
        $$("[data-pc]", pc).forEach((b) => b.onclick = () => {
          if (b.dataset.pc === "lock") { S.parent = false; save(); renderMain(true); drawPc(); toast("Locked. Kids mode is on"); }
          else drawPc(b.dataset.pc);
        });
        const pin = $("#pin", pc), go = $("[data-pin-go]", pc);
        if (!pin) return;
        pin.oninput = () => { pin.value = pin.value.replace(/\D/g, "").slice(0, 4); $("#pinmsg", pc).textContent = ""; };
        const submit = async () => {
          if (pin.value.length !== 4) { $("#pinmsg", pc).textContent = "Use four digits."; return; }
          if (mode === "set" || mode === "change") { await setPin(pin.value); toast("Parent code saved"); }
          else if ((await hashPin(pin.value)) === S.pinHash) { S.parent = true; save(); toast("Unlocked for a parent"); }
          else { $("#pinmsg", pc).textContent = "That's not the code. Try again."; pin.value = ""; return; }
          $("#fn", sheet).disabled = !isParent();
          renderMain(true); drawPc();
        };
        go.onclick = submit; pin.onkeydown = (k) => { if (k.key === "Enter") submit(); };
        if (mode) setTimeout(() => pin.focus(), 50);
      };
      drawPc();
      const rm = $("#rm", sheet);
      const drawRm = () => {
        if (S.push) rm.innerHTML = `<div class="row"><span class="row-text">On for this phone.</span></div><div class="row"><button class="pill" data-rm="test">Send a test</button><button class="pill" data-rm="off">Turn off</button></div>`;
        else if (DEMO) rm.innerHTML = `<div class="row"><span class="row-text">Reminders work once Together is installed on your phone.</span></div>`;
        else if (isIOS && !isStandalone()) rm.innerHTML = `<div class="row"><span class="row-text">Add Together to your Home Screen first, then turn reminders on here.</span></div>`;
        else rm.innerHTML = `<div class="row"><span class="row-text">Get a nudge before plans that have a reminder.</span><button class="pill on" data-rm="on">Turn on</button></div>`;
        $$("[data-rm]", rm).forEach((b) => b.onclick = async () => {
          if (b.dataset.rm === "on") await enablePush();
          else if (b.dataset.rm === "off") await disablePush();
          else await testPush();
          drawRm();
        });
      };
      drawRm();
      $("[data-share]", sheet).onclick = shareInvite;
      const fn = $("#fn", sheet);
      fn.onchange = () => { const v = fn.value.trim(); if (!v) { fn.value = S.name; return; } S.name = v; S.pending.name = { name: v, updatedAt: Date.now() }; save(); scheduleSync(); renderMain(true); };
      const mn = $("#mn", sheet);
      if (mn) mn.onchange = () => { const v = mn.value.trim(); if (!v) { mn.value = me().name; return; } queue("members", { ...me(), name: v }); renderMain(true); };
      $$("[data-c]", sheet).forEach((s) => s.onclick = () => {
        queue("members", { ...me(), color: s.dataset.c });
        $$("[data-c]", sheet).forEach((x) => x.setAttribute("aria-pressed", x === s)); renderMain(true);
      });
      const ib = $("[data-install]", sheet);
      if (ib) ib.onclick = async () => {
        if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; close(); }
        else {
          close(); ob.history = []; ob.step = "install"; renderOnboarding();
          const n = $("[data-next]"); n.textContent = "Back to calendar"; n.onclick = () => renderMain();
        }
      };
      const lv = $("[data-leave]", sheet);
      lv.onclick = () => {
        if (!lv.dataset.sure) { lv.dataset.sure = 1; lv.textContent = "Tap again to leave"; return; }
        if (me()) queue("members", { ...me(), deleted: true });
        syncNow().finally(() => { S = blank(); save(); close(); Object.assign(ob, { step: "welcome", history: [], mode: null, familyName: "", code: "", myName: "", color: null, joined: null }); renderOnboarding(); });
      };
    }, { label: "Family settings" });
  }

  // ---------- Boot ----------
  const params = new URLSearchParams(location.search);
  const joinParam = cleanCode(params.get("join"));
  const dayParam = params.get("day");
  if (dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)) { view.sel = dayParam; view.weekStart = startOfWeek(dayParam); view.month = (dayParam).slice(0, 8) + "01"; }
  if (S.ready && S.code) {
    renderMain(); syncNow();
    if (joinParam && joinParam !== S.code) toast("You're already in a family calendar");
  } else if (joinParam.length === 6) {
    ob.mode = "join"; ob.code = joinParam; ob.history = ["welcome", "choice"]; ob.step = "joinCode"; renderOnboarding();
  } else {
    renderOnboarding();
  }
  if (params.get("tab") === "chores" && S.ready && S.code) { view.tab = "chores"; renderMain(); }
  if (joinParam || dayParam || params.get("tab")) history.replaceState(null, "", location.pathname);

  if ("serviceWorker" in navigator && !DEMO && location.protocol !== "file:") {
    addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
})();
