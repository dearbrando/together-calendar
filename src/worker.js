// Together — a calm family calendar.
// One Cloudflare Worker serves the app and a tiny sync API.
// Each family lives in its own Durable Object, addressed by its share code.

import { DurableObject } from "cloudflare:workers";
import { makeVapidKeys, sendPush } from "./push.js";

// No 0/O, 1/I/L — codes are easy to read aloud and type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LEN}}$`);

const LIMITS = { lists: 50, items: 3000, chores: 200, checks: 20000, subs: 60, events: 5000, members: 30, text: 200, notes: 2000, filesPerEvent: 10, fileBytes: 10 * 1024 * 1024, familyBytes: 1024 * 1024 * 1024 };
const CHUNK = 1024 * 1024; // Durable Object values are capped near 2 MB, so files are stored in 1 MB pieces
// Types the browser may show inline. Everything else downloads, so an uploaded page can never run on our site.
const INLINE_TYPES = /^(image\/(jpeg|png|gif|webp|heic|heif|avif)|application\/pdf|text\/plain|video\/(mp4|quicktime|webm)|audio\/(mpeg|mp4|aac|wav|webm))$/;
const TOMBSTONE_TTL = 1000 * 60 * 60 * 24 * 60; // forget deletions after 60 days

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api","families",code,"sync"]
    if (parts[0] !== "api") return env.ASSETS.fetch(request);

    try {
      // POST /api/families  -> create a family, returns its code
      if (parts[1] === "families" && parts.length === 2 && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        for (let tries = 0; tries < 8; tries++) {
          const code = newCode();
          const stub = env.FAMILY.get(env.FAMILY.idFromName(code));
          const res = await stub.create(code, body);
          if (res) return json(res, 201);
        }
        return json({ error: "Could not create a code, please try again." }, 503);
      }

      if (parts[1] === "families" && parts[2]) {
        const code = parts[2].toUpperCase();
        if (!CODE_RE.test(code)) return json({ error: "That code doesn't look right." }, 400);
        const stub = env.FAMILY.get(env.FAMILY.idFromName(code));

        // GET /api/families/:code -> whole calendar
        if (parts.length === 3 && request.method === "GET") {
          const state = await stub.read();
          return state ? json(state) : json({ error: "No family uses that code." }, 404);
        }
        // Files: POST /api/families/:code/files, GET|DELETE /api/families/:code/files/:id
        if (parts[3] === "files") {
          if (parts.length === 4 && request.method === "POST") {
            const len = Number(request.headers.get("content-length") || 0);
            if (len > LIMITS.fileBytes) return json({ error: "That file is bigger than 10 MB." }, 413);
            const bytes = new Uint8Array(await request.arrayBuffer());
            if (!bytes.length) return json({ error: "That file is empty." }, 400);
            if (bytes.length > LIMITS.fileBytes) return json({ error: "That file is bigger than 10 MB." }, 413);
            const name = str(url.searchParams.get("name") || "file", 120);
            const type = str(request.headers.get("content-type") || "application/octet-stream", 100).split(";")[0].trim().toLowerCase();
            const res = await stub.putFile(name, type, bytes);
            return res.error ? json(res, res.status) : json(res, 201);
          }
          if (parts.length === 5 && /^[a-z0-9-]{8,40}$/.test(parts[4])) {
            if (request.method === "GET") {
              const f = await stub.getFile(parts[4]);
              if (!f) return json({ error: "That file is gone." }, 404);
              const inline = INLINE_TYPES.test(f.type);
              return new Response(f.bytes, {
                headers: {
                  "content-type": inline ? f.type : "application/octet-stream",
                  "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
                  "cache-control": "private, max-age=31536000, immutable",
                  "x-content-type-options": "nosniff",
                  "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
                },
              });
            }
            if (request.method === "DELETE") {
              await stub.deleteFile(parts[4]);
              return json({ ok: true });
            }
          }
        }
        // Reminders: GET push-key, POST push (subscribe), DELETE push, POST push/test
        if (parts[3] === "push") {
          if (parts.length === 4 && request.method === "GET") return json(await stub.pushKey());
          const body = await request.json().catch(() => ({}));
          if (parts.length === 4 && request.method === "POST") {
            const r = await stub.subscribe(body, `https://${url.host}`);
            return r.error ? json(r, 400) : json(r);
          }
          if (parts.length === 4 && request.method === "DELETE") return json(await stub.unsubscribe(body.endpoint));
          if (parts[4] === "test" && request.method === "POST") return json(await stub.testPush(body.endpoint));
        }
        // POST /api/families/:code/sync -> merge changes, return whole calendar
        if (parts[3] === "sync" && request.method === "POST") {
          const body = await request.json().catch(() => null);
          if (!body) return json({ error: "Bad request" }, 400);
          const state = await stub.sync(body);
          return state ? json(state) : json({ error: "No family uses that code." }, 404);
        }
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: "Something went wrong.", detail: String(err?.message || err) }, 500);
    }
  },
};

const str = (v, max = LIMITS.text) => (typeof v === "string" ? v.slice(0, max) : "");
const cleanFiles = (a) => (Array.isArray(a) ? a : []).slice(0, LIMITS.filesPerEvent)
  .filter((f) => f && typeof f.id === "string" && /^[a-z0-9-]{8,40}$/.test(f.id))
  .map((f) => ({ id: f.id, name: str(f.name, 120), type: str(f.type, 100), size: Number(f.size) || 0, w: Number(f.w) || 0, h: Number(f.h) || 0 }));
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v) => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);

function cleanMember(m) {
  if (!m || typeof m.id !== "string") return null;
  return {
    id: str(m.id, 40),
    name: str(m.name, 40),
    color: str(m.color, 20),
    updatedAt: Number(m.updatedAt) || 0,
    deleted: !!m.deleted,
  };
}

const isId = (v) => typeof v === "string" && v.length > 0 && v.length <= 60;
const base = (x) => ({ id: str(x.id, 60), updatedAt: Number(x.updatedAt) || 0, deleted: !!x.deleted, by: str(x.by, 40), at: Number(x.at) || 0 });
const cleanList = (x) => (x && isId(x.id) ? { ...base(x), name: str(x.name, 60) } : null);
const cleanItem = (x) => (x && isId(x.id) && isId(x.listId) ? { ...base(x), listId: str(x.listId, 60), text: str(x.text), done: !!x.done, doneBy: str(x.doneBy, 40) } : null);
const cleanChore = (x) => (x && isId(x.id) ? {
  ...base(x), title: str(x.title, 80), who: str(x.who, 40),
  freq: ["daily", "weekly", "once"].includes(x.freq) ? x.freq : "weekly",
  day: Number.isInteger(x.day) && x.day >= 0 && x.day <= 6 ? x.day : 6,
  due: isDate(x.due) ? x.due : "",
  remindAt: isTime(x.remindAt) ? x.remindAt : "",
} : null);
const ONCE = "2000-01-01"; // the single "period" a one-time task has
const cleanCheck = (x) => (x && isId(x.id) && isId(x.choreId) && isDate(x.period) ? { ...base(x), choreId: str(x.choreId, 60), period: x.period, done: !!x.done } : null);

function cleanEvent(e) {
  if (!e || typeof e.id !== "string") return null;
  return {
    id: str(e.id, 40),
    title: str(e.title),
    date: isDate(e.date) ? e.date : "1970-01-01",
    allDay: !!e.allDay,
    start: isTime(e.start) ? e.start : "",
    end: isTime(e.end) ? e.end : "",
    who: Array.isArray(e.who) ? e.who.filter((w) => typeof w === "string").slice(0, LIMITS.members) : [],
    notes: str(e.notes, LIMITS.notes),
    repeat: ["none", "daily", "weekly", "monthly", "yearly"].includes(e.repeat) ? e.repeat : "none",
    files: cleanFiles(e.files),
    remind: [0, 10, 60, 1440].includes(e.remind) ? e.remind : null,
    by: str(e.by, 40),
    updatedAt: Number(e.updatedAt) || 0,
    deleted: !!e.deleted,
  };
}

export class Family extends DurableObject {
  async load() {
    if (this.state === undefined) this.state = (await this.ctx.storage.get("family")) || null;
    return this.state;
  }

  async save() {
    await this.ctx.storage.put("family", this.state);
  }

  view() {
    const s = this.state;
    return {
      code: s.code,
      name: s.name,
      nameUpdatedAt: s.nameUpdatedAt,
      pinHash: s.pinHash || "",
      pinUpdatedAt: s.pinUpdatedAt || 0,
      members: Object.values(s.members),
      events: Object.values(s.events),
      lists: Object.values(s.lists || {}),
      items: Object.values(s.items || {}),
      chores: Object.values(s.chores || {}),
      checks: Object.values(s.checks || {}),
      serverTime: Date.now(),
    };
  }

  async create(code, body) {
    if (await this.load()) return null; // code taken, caller retries
    const now = Date.now();
    this.state = {
      code,
      name: str(body?.name, 60) || "Our family",
      nameUpdatedAt: now,
      createdAt: now,
      members: {},
      events: {},
    };
    await this.save();
    return this.view();
  }

  async read() {
    return (await this.load()) ? this.view() : null;
  }

  async sync(body) {
    if (!(await this.load())) return null;
    const s = this.state;
    let changed = false;

    if (typeof body.name === "string" && Number(body.nameUpdatedAt) > s.nameUpdatedAt) {
      s.name = str(body.name, 60) || s.name;
      s.nameUpdatedAt = Number(body.nameUpdatedAt);
      changed = true;
    }

    if (typeof body.pinHash === "string" && Number(body.pinUpdatedAt) > (s.pinUpdatedAt || 0)) {
      s.pinHash = /^[0-9a-f]{64}$/.test(body.pinHash) ? body.pinHash : "";
      s.pinUpdatedAt = Number(body.pinUpdatedAt);
      changed = true;
    }

    const merge = (table, items, clean, cap) => {
      if (!Array.isArray(items)) return;
      for (const raw of items.slice(0, 1000)) {
        const item = clean(raw);
        if (!item) continue;
        const cur = table[item.id];
        if (!cur && Object.keys(table).length >= cap) continue;
        if (!cur || item.updatedAt > cur.updatedAt) {
          table[item.id] = item;
          changed = true;
        }
      }
    };
    merge(s.members, body.members, cleanMember, LIMITS.members);
    merge(s.events, body.events, cleanEvent, LIMITS.events);
    for (const k of ["lists", "items", "chores", "checks"]) s[k] = s[k] || {};
    merge(s.lists, body.lists, cleanList, LIMITS.lists);
    merge(s.items, body.items, cleanItem, LIMITS.items);
    merge(s.chores, body.chores, cleanChore, LIMITS.chores);
    merge(s.checks, body.checks, cleanCheck, LIMITS.checks);

    if (changed) {
      const cutoff = Date.now() - TOMBSTONE_TTL;
      for (const t of [s.members, s.events, s.lists, s.items, s.chores, s.checks])
        for (const [id, item] of Object.entries(t)) if (item.deleted && item.updatedAt < cutoff) {
          for (const f of item.files || []) await this.deleteFile(f.id);
          delete t[id];
        }
      // Old chore check-offs only matter for streaks; keep about four months.
      const old = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
      for (const [id, c] of Object.entries(s.checks)) if (c.period < old && c.period !== ONCE) delete s.checks[id];
      // One-time tasks: drop their check once the task itself is gone.
      for (const [id, c] of Object.entries(s.checks)) if (c.period === ONCE && !s.chores[c.choreId]) delete s.checks[id];
      await this.save();
      await this.armReminders();
    }
    return this.view();
  }

  async putFile(name, type, bytes) {
    if (!(await this.load())) return { error: "No family uses that code.", status: 404 };
    const used = (await this.ctx.storage.get("bytesUsed")) || 0;
    if (used + bytes.length > LIMITS.familyBytes) return { error: "Your family's storage is full. Remove some old files first.", status: 413 };
    const id = crypto.randomUUID();
    const chunks = Math.ceil(bytes.length / CHUNK);
    const entries = { [`file:${id}`]: { id, name, type, size: bytes.length, chunks, createdAt: Date.now() }, bytesUsed: used + bytes.length };
    for (let i = 0; i < chunks; i++) entries[`file:${id}:${i}`] = bytes.slice(i * CHUNK, (i + 1) * CHUNK);
    await this.ctx.storage.put(entries);
    return { id, name, type, size: bytes.length };
  }

  async getFile(id) {
    const meta = await this.ctx.storage.get(`file:${id}`);
    if (!meta) return null;
    const keys = Array.from({ length: meta.chunks }, (_, i) => `file:${id}:${i}`);
    const parts = await this.ctx.storage.get(keys);
    const bytes = new Uint8Array(meta.size);
    let off = 0;
    for (const k of keys) { const c = new Uint8Array(parts.get(k)); bytes.set(c, off); off += c.length; }
    return { ...meta, bytes };
  }

  async deleteFile(id) {
    const meta = await this.ctx.storage.get(`file:${id}`);
    if (!meta) return;
    const used = (await this.ctx.storage.get("bytesUsed")) || 0;
    await this.ctx.storage.delete([`file:${id}`, ...Array.from({ length: meta.chunks }, (_, i) => `file:${id}:${i}`)]);
    await this.ctx.storage.put("bytesUsed", Math.max(0, used - meta.size));
  }

  // ---------- Reminders ----------
  async vapid() {
    let v = await this.ctx.storage.get("vapid");
    if (!v) { v = await makeVapidKeys(); await this.ctx.storage.put("vapid", v); }
    return v;
  }

  async pushKey() {
    return { publicKey: (await this.vapid()).publicKey };
  }

  async subscribe(body, subject) {
    if (!(await this.load())) return { error: "No family uses that code." };
    const sub = body?.subscription;
    if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return { error: "That phone can't get reminders." };
    const subs = (await this.ctx.storage.get("subs")) || {};
    if (!subs[sub.endpoint] && Object.keys(subs).length >= LIMITS.subs) return { error: "Too many phones have reminders on." };
    let tz = "UTC";
    try { new Intl.DateTimeFormat("en-US", { timeZone: body.tz }); tz = body.tz; } catch {}
    subs[sub.endpoint] = { endpoint: sub.endpoint, keys: { p256dh: str(sub.keys.p256dh, 200), auth: str(sub.keys.auth, 100) }, memberId: str(body.memberId, 40), tz, subject };
    await this.ctx.storage.put("subs", subs);
    await this.armReminders();
    return { ok: true };
  }

  async unsubscribe(endpoint) {
    const subs = (await this.ctx.storage.get("subs")) || {};
    delete subs[endpoint];
    await this.ctx.storage.put("subs", subs);
    return { ok: true };
  }

  async testPush(endpoint) {
    const subs = (await this.ctx.storage.get("subs")) || {};
    const sub = subs[endpoint];
    if (!sub) return { ok: false };
    const status = await sendPush(sub, { title: "Reminders are on", body: "You'll get a nudge before your plans.", tag: "test" }, await this.vapid(), sub.subject).catch(() => 0);
    return { ok: status >= 200 && status < 300, status };
  }

  // Check every minute while anyone has reminders coming up in the next few days.
  async armReminders() {
    await this.load();
    const subs = (await this.ctx.storage.get("subs")) || {};
    const anyRemind = this.state && (Object.values(this.state.events).some((e) => !e.deleted && e.remind != null)
      || Object.values(this.state.chores || {}).some((c) => !c.deleted && c.remindAt));
    if (!Object.keys(subs).length || !anyRemind) { await this.ctx.storage.deleteAlarm(); return; }
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
  }

  async alarm() {
    if (!(await this.load())) return;
    const now = Date.now();
    const last = Math.max((await this.ctx.storage.get("lastCheck")) || 0, now - 15 * 60 * 1000);
    const subs = (await this.ctx.storage.get("subs")) || {};
    const sent = (await this.ctx.storage.get("sent")) || {};
    const vapid = await this.vapid();
    const events = Object.values(this.state.events).filter((e) => !e.deleted && e.remind != null);
    let subsChanged = false;

    for (const sub of Object.values(subs)) {
      const today = dayIn(now, sub.tz);
      for (const e of events) {
        if (e.who.length && !e.who.includes(sub.memberId)) continue;
        for (let i = -1; i <= 2; i++) {
          const day = addDay(today, i);
          if (!occursOn(e, day)) continue;
          const at = localToUtc(day, e.allDay ? "08:00" : e.start || "08:00", sub.tz) - e.remind * 60000;
          const key = `${sub.endpoint}|${e.id}|${day}|${e.remind}`;
          if (at <= last || at > now || sent[key]) continue;
          sent[key] = now;
          const status = await sendPush(sub, { title: e.title, body: reminderText(e), tag: `${e.id}:${day}`, url: `/?day=${day}` }, vapid, sub.subject).catch(() => 0);
          if (status === 404 || status === 410) { delete subs[sub.endpoint]; subsChanged = true; break; }
        }
        if (!subs[sub.endpoint]) break;
      }
      // Chore alerts: only for the person it's assigned to, and only if it isn't done yet.
      for (const c of Object.values(this.state.chores || {})) {
        if (!subs[sub.endpoint]) break;
        if (c.deleted || !c.remindAt || c.who !== sub.memberId) continue;
        const dow = new Date(today + "T00:00:00Z").getUTCDay();
        if (c.freq === "weekly" && dow !== c.day) continue;
        if (c.freq === "once" && c.due !== today) continue;
        const period = c.freq === "daily" ? today : c.freq === "weekly" ? addDay(today, -dow) : ONCE;
        const chk = this.state.checks?.[`${c.id}:${period}`];
        if (chk && chk.done && !chk.deleted) continue;
        const at = localToUtc(today, c.remindAt, sub.tz);
        const key = `${sub.endpoint}|${c.id}|${today}`;
        if (at <= last || at > now || sent[key]) continue;
        sent[key] = now;
        const body = c.freq === "once" ? "Due today" : c.freq === "daily" ? "Still to do today" : "Still to do this week";
        const status = await sendPush(sub, { title: c.title, body, tag: `chore:${c.id}:${today}`, url: "/?tab=chores" }, vapid, sub.subject).catch(() => 0);
        if (status === 404 || status === 410) { delete subs[sub.endpoint]; subsChanged = true; }
      }
    }
    for (const [k, t] of Object.entries(sent)) if (t < now - 3 * 864e5) delete sent[k];
    await this.ctx.storage.put({ lastCheck: now, sent, ...(subsChanged ? { subs } : {}) });
    await this.ctx.storage.deleteAlarm();
    await this.armReminders();
  }
}

// ---------- Dates, in each phone's own time zone ----------
function tzOffset(ts, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}
function localToUtc(date, time, tz) {
  const [y, m, d] = date.split("-").map(Number), [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - tzOffset(guess, tz);
  return guess - tzOffset(first, tz);
}
const dayIn = (ts, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
const addDay = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
function occursOn(e, day) {
  if (day < e.date) return false;
  if (day === e.date) return true;
  const a = new Date(e.date + "T00:00:00Z"), b = new Date(day + "T00:00:00Z");
  switch (e.repeat) {
    case "daily": return true;
    case "weekly": return a.getUTCDay() === b.getUTCDay();
    case "monthly": return a.getUTCDate() === b.getUTCDate();
    case "yearly": return a.getUTCDate() === b.getUTCDate() && a.getUTCMonth() === b.getUTCMonth();
    default: return false;
  }
}
function reminderText(e) {
  const t = e.allDay || !e.start ? "" : new Date(`2000-01-01T${e.start}:00Z`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  if (e.remind === 1440) return t ? `Tomorrow at ${t}` : "Tomorrow";
  if (e.remind === 60) return t ? `In 1 hour, at ${t}` : "Today";
  if (e.remind === 10) return t ? `In 10 minutes, at ${t}` : "Today";
  return t ? `Now, at ${t}` : "Today";
}
