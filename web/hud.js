// JARVIS HUD: force-directed memory/account graph, chat, approvals, security panel.
(() => {
  const TYPES = {
    core: "#27d3ff", hub: "#9fe8ff", account: "#3ef2a0", threat: "#ff4d5e", defense: "#ffb547",
    security: "#ff8a5c", memory: "#b58cff", learning: "#5ca8ff", ghost: "#3b5566",
  };
  const STATUS = { connected: "#3ef2a0", partial: "#ffb547", planned: "#5f7f8f", unsupported: "#39424a" };
  const $ = (id) => document.getElementById(id);
  const canvas = $("graph"), ctx = canvas.getContext("2d");
  let W, H, nodes = [], edges = [], byId = {}, hidden = new Set(), selected = null, hover = null, flash = new Set();
  const view = { x: 0, y: 0, k: 1 };
  let target = null, baseK = 1, energy = 0, talking = 0;
  const BIG = ["core", "hub"];
  // small circles fade in as you zoom in past the overview
  const reveal = () => Math.max(0, Math.min(1, (view.k / baseK - 0.75) / 0.35));

  function resize() { W = canvas.width = innerWidth * devicePixelRatio; H = canvas.height = innerHeight * devicePixelRatio; }
  addEventListener("resize", resize); resize();

  const api = (path, body) => fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json", "X-Jarvis-Token": window.JARVIS_TOKEN },
    body: JSON.stringify(body),
  });

  // ---------------------------------------------------------------- graph
  async function loadGraph() {
    const g = await (await api("/api/graph")).json();
    const old = byId; byId = {};
    nodes = g.nodes.map((n, i) => {
      const prev = old[n.id];
      const a = (i / g.nodes.length) * Math.PI * 2;
      const r = n.type === "core" ? 0 : n.type === "hub" ? 200 : 380;
      const node = Object.assign(n, prev ? { x: prev.x, y: prev.y, vx: 0, vy: 0 } :
        { x: Math.cos(a) * r + Math.random() * 40, y: Math.sin(a) * r + Math.random() * 40, vx: 0, vy: 0 });
      node.r = n.type === "core" ? 34 : n.type === "hub" ? 18 : n.type === "account" ? 14 : 7;
      byId[n.id] = node; return node;
    });
    edges = g.edges.map(([s, t]) => [byId[s], byId[t]]).filter(([s, t]) => s && t);
    const deg = {}; edges.forEach(([s, t]) => { deg[s.id] = (deg[s.id] || 0) + 1; deg[t.id] = (deg[t.id] || 0) + 1; });
    nodes.forEach((n) => { if (!["core", "hub", "account"].includes(n.type)) n.r = 5 + Math.min(8, (deg[n.id] || 0)); });
    heat = 1; buildFilters();
  }

  function buildFilters() {
    const f = $("filters"); f.innerHTML = "";
    [...new Set(nodes.map((n) => n.type))].forEach((t) => {
      const l = document.createElement("label");
      l.textContent = t; l.style.color = TYPES[t] || "#aaa"; l.className = hidden.has(t) ? "off" : "";
      l.onclick = () => { heat = 1; hidden.has(t) ? hidden.delete(t) : hidden.add(t); l.className = hidden.has(t) ? "off" : ""; };
      f.appendChild(l);
    });
  }

  const visible = (n) => !hidden.has(n.type);

  // The layout "cools down" so the graph settles and stops moving; dragging or reloading reheats it.
  let heat = 1;
  function step() {
    heat = Math.max(0, heat * 0.985);
    if (heat < 0.01 && !dragging) return;
    const vis = nodes.filter(visible);
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i], b = vis[j]; let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01;
      if (d2 > 250000) continue;
      const f = 1800 * heat / d2; dx *= f; dy *= f; a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
    }
    edges.forEach(([a, b]) => {
      if (!visible(a) || !visible(b)) return;
      const rest = a.type === "core" || b.type === "core" ? 230 : 80;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - rest) * 0.02 * heat;
      a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
    });
    vis.forEach((n) => {
      if (n.type === "core") { n.x = n.y = 0; return; }
      if (n === dragging) return;
      n.vx -= n.x * 0.004 * heat; n.vy -= n.y * 0.004 * heat;
      n.vx *= 0.7; n.vy *= 0.7;
      if (Math.abs(n.vx) < 0.02) n.vx = 0; if (Math.abs(n.vy) < 0.02) n.vy = 0; n.x += Math.max(-8, Math.min(8, n.vx)); n.y += Math.max(-8, Math.min(8, n.vy));
    });
  }

  function toScreen(n) { return [(n.x * view.k + view.x) + W / 2, (n.y * view.k + view.y) + H / 2]; }
  function toWorld(px, py) { return [(px - W / 2 - view.x) / view.k, (py - H / 2 - view.y) / view.k]; }

  function drawCore(x, y, r, t, color) {
    const d = devicePixelRatio, e = energy;
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.shadowColor = color;
    // radial lines going out of the core; they stretch and flicker while someone speaks
    const spokes = 48;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + t / 9000;
      const len = r * (0.5 + 0.35 * ((i * 7) % 5) / 5 + e * 0.9 * Math.abs(Math.sin(t / 110 + i * 1.7)));
      ctx.globalAlpha = 0.25 + 0.6 * e; ctx.lineWidth = 1.2 * d; ctx.shadowBlur = (4 + 14 * e) * d;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 1.55, y + Math.sin(a) * r * 1.55);
      ctx.lineTo(x + Math.cos(a) * (r * 1.55 + len), y + Math.sin(a) * (r * 1.55 + len)); ctx.stroke();
    }
    // tick ring
    ctx.globalAlpha = 0.7; ctx.shadowBlur = 8 * d;
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2 - t / 6000, l = i % 5 ? 4 : 9;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r * 1.4);
      ctx.lineTo(x + Math.cos(a) * (r * 1.4 - l * d), y + Math.sin(a) * (r * 1.4 - l * d)); ctx.stroke();
    }
    // rotating dashed rings and arcs
    ctx.lineWidth = 2 * d; ctx.setLineDash([14 * d, 8 * d]);
    ctx.beginPath(); ctx.arc(x, y, r * 1.15, t / 2500, t / 2500 + Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 3 * d;
    for (let k = 0; k < 3; k++) {
      const a0 = -t / 1800 + k * (Math.PI * 2 / 3);
      ctx.beginPath(); ctx.arc(x, y, r * 0.9, a0, a0 + 1.3); ctx.stroke();
    }
    // hexagon + inner glow
    ctx.lineWidth = 1.5 * d; ctx.beginPath();
    for (let k = 0; k <= 6; k++) { const a = k * Math.PI / 3 + t / 4000; ctx[k ? "lineTo" : "moveTo"](x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62); }
    ctx.stroke();
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.55);
    g.addColorStop(0, "rgba(220,250,255,.95)"); g.addColorStop(0.5, color); g.addColorStop(1, "rgba(39,211,255,0)");
    ctx.globalAlpha = 0.8 + 0.2 * e; ctx.fillStyle = g; ctx.shadowBlur = (20 + 30 * e) * d;
    ctx.beginPath(); ctx.arc(x, y, r * (0.5 + 0.08 * e * Math.sin(t / 70)), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    const d = devicePixelRatio, rv = reveal();
    const alphaOf = (n) => (BIG.includes(n.type) ? 1 : rv);
    edges.forEach(([a, b], i) => {
      if (!visible(a) || !visible(b)) return;
      const al = Math.min(alphaOf(a), alphaOf(b)); if (al <= 0.01) return;
      const hot = selected && (a === selected || b === selected);
      const pulse = energy * (0.45 + 0.4 * Math.sin(t / 90 + i * 0.9));
      ctx.globalAlpha = al; ctx.lineWidth = (1 + 1.6 * energy) * d;
      ctx.shadowColor = "#27d3ff"; ctx.shadowBlur = energy * 14 * d;
      ctx.strokeStyle = `rgba(39,211,255,${hot ? 0.75 : 0.14 + pulse})`;
      const [x1, y1] = toScreen(a), [x2, y2] = toScreen(b);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    nodes.forEach((n) => {
      if (!visible(n)) return;
      const al = alphaOf(n); if (al <= 0.01) return;
      const [x, y] = toScreen(n);
      const r = n.type === "core" ? Math.max(n.r * view.k, 58) * d : n.type === "hub" ? Math.max(n.r * view.k, 11) * d : n.r * view.k * d;
      let color = TYPES[n.type] || "#8aa";
      if (n.type === "account") color = STATUS[n.status] || color;
      if (n.type === "core") { drawCore(x, y, r, t, color); return; }
      const glow = flash.has(n.id) ? 30 + 10 * Math.sin(t / 120) : n === selected || n === hover ? 24 : 10 + 16 * energy;
      ctx.shadowColor = color; ctx.shadowBlur = glow * d;
      ctx.globalAlpha = al * (n.status === "unsupported" ? 0.45 : 0.9);
      if (n.type === "hub") {
        ctx.strokeStyle = color; ctx.lineWidth = 2 * d;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, r * 1.35, t / 1500, t / 1500 + 2); ctx.stroke();
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
      if (n.type === "hub" || (n.type === "account" && rv > 0.5) || n === hover || n === selected || view.k > baseK * 1.8) {
        ctx.fillStyle = "#cfefff"; ctx.font = `${(n.type === "hub" ? 12 : 11) * d}px ui-monospace,monospace`; ctx.textAlign = "center";
        ctx.fillText(n.label + (n.status === "unsupported" ? " (no API)" : ""), x, y + r * (n.type === "hub" ? 1.35 : 1) + 14 * d);
      }
      ctx.globalAlpha = 1;
    });
  }

  function loop(t) {
    step(); if (!userMoved && t - fitStart < 5000) fit();
    if (target) {
      view.x += (target.x - view.x) * 0.12; view.y += (target.y - view.y) * 0.12; view.k += (target.k - view.k) * 0.12;
      if (Math.abs(target.k - view.k) < 0.002 && Math.abs(target.x - view.x) < 1) target = null;
    }
    energy += ((talking > 0 ? 1 : 0) - energy) * 0.08;
    draw(t); requestAnimationFrame(loop);
  }

  function nodeAt(cx, cy) {
    const px = cx * devicePixelRatio, py = cy * devicePixelRatio; let best = null, bd = Infinity;
    nodes.forEach((n) => {
      if (!visible(n) || (!BIG.includes(n.type) && reveal() < 0.3)) return;
      const [x, y] = toScreen(n), d = Math.hypot(x - px, y - py);
      if (d < Math.max(18 * devicePixelRatio, n.r * view.k * devicePixelRatio + 6) && d < bd) { best = n; bd = d; }
    });
    return best;
  }

  function focus(n) {
    userMoved = true; const k = baseK * 1.6;
    target = { x: -n.x * k, y: -n.y * k + 52 * devicePixelRatio, k };
  }

  function select(n) {
    selected = n;
    if (n && n.type === "hub") focus(n);
    const d = $("detail");
    if (!n) { d.innerHTML = '<p class="muted">Tap a bubble, or pinch it with the camera on.</p>'; return; }
    const status = n.status ? `<p class="${n.status === "connected" ? "ok" : n.status === "unsupported" ? "bad" : "warn"}">status: ${n.status}</p>` : "";
    d.innerHTML = `<h3></h3>${status}<div class="body"></div>`;
    d.querySelector("h3").textContent = n.label;
    d.querySelector(".body").textContent = n.body || "(no note yet)";
  }

  // mouse / touch
  let dragging = null, panFrom = null;
  canvas.addEventListener("pointerdown", (e) => {
    const n = nodeAt(e.clientX, e.clientY);
    if (n) { dragging = n; heat = Math.max(heat, 0.3); select(n); } else panFrom = [e.clientX, e.clientY, view.x, view.y];
  });
  addEventListener("pointermove", (e) => {
    hover = nodeAt(e.clientX, e.clientY);
    if (dragging) { const [wx, wy] = toWorld(e.clientX * devicePixelRatio, e.clientY * devicePixelRatio); dragging.x = wx; dragging.y = wy; heat = Math.max(heat, 0.3); }
    else if (panFrom) { userMoved = true; target = null; view.x = panFrom[2] + (e.clientX - panFrom[0]) * devicePixelRatio; view.y = panFrom[3] + (e.clientY - panFrom[1]) * devicePixelRatio; }
  });
  addEventListener("pointerup", () => { dragging = null; panFrom = null; });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 0.9); }, { passive: false });

  function zoomBy(f) { userMoved = true; target = null; view.k = Math.max(0.2, Math.min(4, view.k * f)); }
  function reset() { userMoved = false; target = null; fitStart = performance.now(); select(null); }

  // keep the whole graph inside the space between the two panels
  let userMoved = false, fitStart = 0;
  function fit() {
    // overview: the core in the middle with the main circles on a ring around it;
    // small circles stay hidden until you zoom in (see reveal())
    const hubs = nodes.filter((n) => n.type === "hub" && visible(n)); if (!hubs.length) return;
    const d = devicePixelRatio, side = innerWidth > 900 ? 350 * d : 16 * d, top = 120 * d;
    const room = Math.min(W - 2 * side, H - top - 16 * d) / 2 - 50 * d;
    const far = Math.max(...hubs.map((n) => Math.hypot(n.x, n.y)), 1);
    const kk = Math.max(0.15, room / far); baseK = kk / 0.72;
    view.k += (kk - view.k) * 0.15;
    view.x += (0 - view.x) * 0.15; view.y += ((top - 16 * d) / 2 - view.y) * 0.15;
  }


  // gesture API (used by gestures.js)
  window.HUD = {
    hover: (cx, cy) => { hover = nodeAt(cx, cy); return hover; },
    pick: (cx, cy) => { const n = nodeAt(cx, cy); if (n) select(n); return n; },
    panBy: (dx, dy) => { userMoved = true; target = null; view.x += dx * devicePixelRatio; view.y += dy * devicePixelRatio; },
    positions: () => nodes.map((n) => [n.x, n.y]),
    zoomBy, reset, talk: (on) => { talking = Math.max(0, talking + (on ? 1 : -1)); }, setMode: (m) => { $("mode").textContent = m; },
  };

  // ---------------------------------------------------------------- panels
  async function loadSecurity() {
    const s = await (await api("/api/security")).json();
    $("secScore").textContent = `${s.score}/${s.total}`;
    $("secScore").className = s.score === s.total ? "ok" : "warn";
    $("secChecks").innerHTML = "";
    s.checks.forEach((c) => {
      const li = document.createElement("li");
      li.innerHTML = `<b class="${c.ok ? "ok" : c.level === "high" ? "bad" : "warn"}">${c.ok ? "✓" : "!"}</b>`;
      li.append(c.name); li.title = c.detail; $("secChecks").appendChild(li);
    });
  }

  async function loadPending() {
    const items = await (await api("/api/pending")).json();
    const box = $("pending"); box.innerHTML = "";
    if (!items.length) { box.innerHTML = '<p class="muted">Nothing waiting.</p>'; return; }
    items.forEach((p) => {
      const c = document.createElement("div"); c.className = "card" + (p.flags.length ? " flagged" : "");
      const title = document.createElement("div");
      title.textContent = p.kind === "action" ? `ACTION on ${p.account}: ${p.summary}` : `LEARN (${p.type}): ${p.title}`;
      const det = document.createElement("div"); det.className = "muted";
      det.textContent = p.kind === "action" ? p.instruction : p.body; c.append(title, det);
      if (p.flags.length) { const f = document.createElement("div"); f.className = "flag"; f.textContent = "⚠ " + p.flags.join(", "); c.appendChild(f); }
      const row = document.createElement("div"); row.className = "row";
      const ok = document.createElement("button"); ok.textContent = "Approve";
      const no = document.createElement("button"); no.textContent = "Reject";
      ok.onclick = async () => {
        ok.disabled = no.disabled = true; ok.textContent = "Running…";
        const r = await (await api("/api/approve", { id: p.id })).json();
        say("jarvis", r.error ? "⚠ " + r.error : r.result || `Saved "${r.note}" to memory.`);
        refresh(); loadGraph();
      };
      no.onclick = async () => { await api("/api/reject", { id: p.id }); refresh(); };
      row.append(ok, no); c.appendChild(row); box.appendChild(c);
    });
  }

  async function loadAudit() {
    const a = await (await api("/api/audit")).json();
    $("audit").innerHTML = "";
    a.slice(-25).reverse().forEach((e) => {
      const li = document.createElement("li");
      li.textContent = `${e.ts.slice(11)} ${e.kind}${e.flags && e.flags.length ? " ⚠ " + e.flags.join(",") : ""}`;
      if (e.flags && e.flags.length) li.className = "bad";
      $("audit").appendChild(li);
    });
  }

  function refresh() { loadSecurity(); loadPending(); loadAudit(); }

  // ---------------------------------------------------------------- chat
  function say(who, text) {
    const m = document.createElement("div"); m.className = "msg " + (who === "me" ? "me" : "");
    m.textContent = text; $("chat").appendChild(m); $("chat").scrollTop = 1e9; return m;
  }

  $("ask").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("msg").value.trim(); if (!text) return;
    $("msg").value = ""; say("me", text);
    const out = say("jarvis", "…");
    document.querySelector(".dial").classList.add("busy"); $("mode").textContent = "THINKING";
    try {
      var talkingText = false;
      const res = await api("/api/chat", { message: text });
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "", streamed = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf("\n")) >= 0) {
          const ev = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
          if (ev.type === "context") { flash = new Set(ev.notes); setTimeout(() => (flash = new Set()), 6000);
            if (ev.flags.length) say("jarvis", "⚠ Your message matched: " + ev.flags.join(", ")); }
          if (ev.type === "text") { if (!streamed) { window.HUD.talk(true); talkingText = true; } streamed += ev.text; out.textContent = streamed; }
          if (ev.type === "done") {
            out.textContent = ev.text || streamed;
            if (ev.flags.length) say("jarvis", "⚠ Reply flagged by scanner: " + ev.flags.join(", "));
            if (ev.proposals.length) say("jarvis", `${ev.proposals.length} item(s) waiting for your OK on the left.`);
            if (talkingText) { window.HUD.talk(false); talkingText = false; }
            speak(ev.text);
          }
        }
      }
    } catch (err) { out.textContent = "⚠ " + err; }
    if (talkingText) window.HUD.talk(false);
    document.querySelector(".dial").classList.remove("busy"); $("mode").textContent = "STANDBY"; idleMode(); refresh();
  });

  // voice (browser built-ins; Fish Audio voice is a later phase)
  function speak(text) {
    if (!window.speechSynthesis || !text || !voiceOn) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 600)); let on = false;
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => /en-GB/.test(v.lang) && /male|daniel|george|arthur/i.test(v.name)) || voices.find((v) => /en-GB/.test(v.lang)) || null;
    u.rate = 1.05; u.pitch = 0.9;
    u.onstart = () => { if (!on) { on = true; window.HUD.talk(true); } };
    u.onend = u.onerror = () => { if (on) { on = false; window.HUD.talk(false); } idleMode(); };
    speechSynthesis.speak(u);
  }
  let voiceOn = true;
  $("voiceBtn").onclick = () => {
    voiceOn = !voiceOn; $("voiceBtn").textContent = voiceOn ? "🔊 Voice" : "🔇 Voice";
    if (!voiceOn && window.speechSynthesis) speechSynthesis.cancel();
  };
  // ---------------------------------------------------------------- "Hey Jarvis" wake word
  // Always-on listening in the browser. Say "Hey Jarvis" then your question, in one go
  // ("Hey Jarvis, what's on my calendar") or with a pause ("Hey Jarvis" ... "what's on my calendar").
  // Nothing is sent to JARVIS until it hears the wake word. Toggle with the 👂 button.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const WAKE = /\b(?:hey|hi|ok|okay|yo)[\s,]+(?:jarvis|jervis|travis|service)\b[\s,.!?]*/i;
  const AWAKE_MS = 10000;   // how long it waits for your question after "Hey Jarvis"
  let wakeOn = false, rec = null, awakeUntil = 0, awakeGlow = false, restartDelay = 300, chimeCtx = null;
  try { wakeOn = localStorage.getItem("jarvis.wake") !== "off"; } catch {}
  const busy = () => document.querySelector(".dial").classList.contains("busy") || (window.speechSynthesis && speechSynthesis.speaking);
  const idleMode = () => { if (!busy() && !awakeGlow) $("mode").textContent = wakeOn ? "EARS ON" : "STANDBY"; };

  function chime() {  // short rising beep so you hear that it woke up
    try {
      chimeCtx = chimeCtx || new AudioContext(); chimeCtx.resume();
      const o = chimeCtx.createOscillator(), g = chimeCtx.createGain(), t = chimeCtx.currentTime;
      o.frequency.setValueAtTime(660, t); o.frequency.linearRampToValueAtTime(990, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(chimeCtx.destination); o.start(t); o.stop(t + 0.3);
    } catch {}
  }
  // Awake = lines glow, the dial pulses and says LISTENING, and it stays that way until you finish
  // your question or go quiet for 10 seconds. Anything you say keeps it awake.
  function wakeUp() {
    awakeUntil = Date.now() + AWAKE_MS;
    if (awakeGlow) return;
    awakeGlow = true; chime(); window.HUD.talk(true);
    document.querySelector(".dial").classList.add("awake"); $("mode").textContent = "LISTENING";
    $("msg").placeholder = "Listening…";
  }
  function sleep() {
    awakeUntil = 0;
    if (!awakeGlow) return;
    awakeGlow = false; window.HUD.talk(false);
    document.querySelector(".dial").classList.remove("awake"); $("msg").placeholder = "Ask JARVIS…";
    idleMode();
  }
  setInterval(() => { if (awakeGlow && Date.now() > awakeUntil) { $("msg").value = ""; sleep(); } }, 250);

  function ask(text) {
    sleep(); $("msg").value = text; $("ask").requestSubmit();
  }
  const afterWake = (t) => { const m = t.match(WAKE); return m ? t.slice(m.index + m[0].length).trim() : null; };

  function startWake() {
    if (!SR || !wakeOn || rec) return;
    rec = new SR(); rec.lang = "en-US"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      if (busy()) return;  // don't let JARVIS hear itself talking
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const heard = e.results[i][0].transcript.trim();
        const rest = afterWake(heard);
        if (!e.results[i].isFinal) {
          // live: wake the moment "Hey Jarvis" is heard, and show what you're saying in the box
          if (rest !== null) wakeUp();
          if (awakeGlow) { awakeUntil = Date.now() + AWAKE_MS; $("msg").value = rest !== null ? rest : heard; }
          continue;
        }
        if (rest !== null) rest.length > 2 ? ask(rest) : wakeUp();
        else if (awakeGlow && heard.length > 2) ask(heard);
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setWake(false); say("jarvis", "I'd love to listen, but the microphone is blocked. Allow it in the address bar, then press 👂.");
      } else if (e.error === "network") restartDelay = Math.min(10000, restartDelay * 2);
    };
    rec.onstart = () => { restartDelay = 300; idleMode(); };
    rec.onend = () => { rec = null; if (wakeOn) setTimeout(startWake, restartDelay); };  // Chrome stops every minute or so; just restart
    try { rec.start(); } catch { rec = null; }
  }
  function setWake(on) {
    wakeOn = on; try { localStorage.setItem("jarvis.wake", on ? "on" : "off"); } catch {}
    $("wakeBtn").textContent = on ? "👂 Hey Jarvis" : "👂 Off"; $("wakeBtn").classList.toggle("on", on);
    if (on) startWake(); else { sleep(); if (rec) { const r = rec; rec = null; r.onend = null; r.abort(); } }
    idleMode();
  }
  if (!SR) $("wakeBtn").hidden = true;
  else { $("wakeBtn").onclick = () => setWake(!wakeOn); setWake(wakeOn); }

  // 🎙 button: talk without saying the wake word
  $("micBtn").onclick = () => {
    if (!SR) { say("jarvis", "This browser has no speech recognition. Try Chrome or Edge."); return; }
    if (rec) { wakeUp(); return; }  // the always-on listener is already running, just open the window
    const r = new SR(); r.lang = "en-US"; $("mode").textContent = "LISTENING"; let heard = false;
    r.onspeechstart = () => { if (!heard) { heard = true; window.HUD.talk(true); } };
    r.onspeechend = () => { if (heard) { heard = false; window.HUD.talk(false); } };
    r.onresult = (e) => ask(e.results[0][0].transcript);
    r.onend = () => { if (heard) { heard = false; window.HUD.talk(false); } if ($("mode").textContent === "LISTENING") idleMode(); };
    r.start();
  };

  $("refreshBtn").onclick = async () => {
    const r = await (await api("/api/refresh-accounts", {})).json();
    say("jarvis", r.error ? "⚠ " + r.error : r.changed.length ? "Updated: " + r.changed.join(", ") : "No account changes.");
    loadGraph();
  };

  loadGraph().then(() => requestAnimationFrame(loop));
  refresh(); setInterval(refresh, 15000);
})();
