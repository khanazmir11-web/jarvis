// JARVIS HUD: force-directed memory/account graph, chat, approvals, security panel.
(() => {
  const TYPES = {
    core: "#27d3ff", hub: "#9fe8ff", account: "#3ef2a0", threat: "#ff4d5e", defense: "#ffb547",
    security: "#ff8a5c", memory: "#b58cff", learning: "#5ca8ff", ghost: "#3b5566", link: "#4fd8ff",
  };
  const STATUS = { connected: "#3ef2a0", partial: "#ffb547", "needs-auth": "#ffb547", planned: "#5f7f8f", unsupported: "#39424a" };
  const ALERT_COL = { phishing: "#ff4d5e", warn: "#ffb547", info: "#27d3ff" };
  let alerted = {};   // account id -> worst alert level in the last 24h
  const $ = (id) => document.getElementById(id);
  const canvas = $("graph"), ctx = canvas.getContext("2d");
  let W, H, nodes = [], edges = [], byId = {}, hidden = new Set(), selected = null, hover = null, flash = new Set();
  const view = { x: 0, y: 0, k: 1 };
  let target = null, baseK = 1, energy = 0, talking = 0;
  const BIG = ["core", "hub"];
  // ---- themes: the accent colour of the core, default lines and panels
  const THEMES = { jarvis: { accent: "#27d3ff", hot: "#e6fbff" }, ironman: { accent: "#ff4433", hot: "#ffd36b" }, stealth: { accent: "#dfe8ee", hot: "#ffffff" } };
  let theme = "jarvis";
  try { theme = THEMES[localStorage.getItem("jarvis.theme")] ? localStorage.getItem("jarvis.theme") : "jarvis"; } catch {}
  function applyTheme(name) {
    theme = name; document.body.dataset.theme = name; TYPES.core = THEMES[name].accent;
    try { localStorage.setItem("jarvis.theme", name); } catch {}
  }
  applyTheme(theme);
  // ---- live sound level (your mic while listening, JARVIS's voice while speaking) drives the voice ring
  let audioCtx = null, bins = null;
  const analysers = [];
  function ensureAudio() { if (!audioCtx) { try { audioCtx = new AudioContext(); } catch { return null; } } audioCtx.resume(); return audioCtx; }
  function addAnalyser(node) { const a = audioCtx.createAnalyser(); a.fftSize = 256; a.smoothingTimeConstant = 0.75; node.connect(a); analysers.push(a); return a; }
  async function listenMicLevel() {
    if (!ensureAudio() || !navigator.mediaDevices) return;
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); addAnalyser(audioCtx.createMediaStreamSource(st)); } catch {}
  }
  function soundBins() {
    if (!analysers.length) return null;
    const n = analysers[0].frequencyBinCount; bins = bins || new Float32Array(n); bins.fill(0);
    const tmp = new Uint8Array(n);
    analysers.forEach((a) => { a.getByteFrequencyData(tmp); for (let i = 0; i < n; i++) bins[i] = Math.max(bins[i], tmp[i] / 255); });
    return bins;
  }
  // each main brain gets its own colour so the overview reads at a glance
  const HUB_COLORS = { "hub:security": "#ff5d6c", "hub:memory": "#b58cff", "grp:Google": "#27d3ff", "grp:E-learning": "#5ca8ff",
    "grp:Social": "#ff6fd8", "grp:Stores": "#ffb547", "grp:Infra": "#3ef2a0" };
  const SPARE = ["#7cf7ff", "#c3ff6b", "#ff9b5c", "#9f9bff"];
  const hubColor = (n) => HUB_COLORS[n.id] || SPARE[[...n.id].reduce((a, c) => a + c.charCodeAt(0), 0) % SPARE.length];
  const bootStart = performance.now();
  const boot = () => Math.min(1, (performance.now() - bootStart) / 1800);   // 0 -> 1 during the start-up animation
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const dust = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, p: Math.random() * 6.28 }));
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
      node.r = n.type === "core" ? 34 : n.type === "hub" ? 18 : n.type === "account" ? 14 : n.type === "link" ? 11 : 7;
      byId[n.id] = node; return node;
    });
    edges = g.edges.map(([s, t]) => [byId[s], byId[t]]).filter(([s, t]) => s && t);
    edges.forEach(([a, b]) => { if (a.type === "hub" && b.type !== "core") b.hubC = hubColor(a); if (b.type === "hub" && a.type !== "core") a.hubC = hubColor(b); });
    const deg = {}; edges.forEach(([s, t]) => { deg[s.id] = (deg[s.id] || 0) + 1; deg[t.id] = (deg[t.id] || 0) + 1; });
    nodes.forEach((n) => { if (!["core", "hub", "account", "link"].includes(n.type)) n.r = 5 + Math.min(8, (deg[n.id] || 0)); });
    nodes.forEach((n) => { n.kids = n.type === "hub" ? edges.filter(([a, b]) => (a === n || b === n) && a.type !== "core" && b.type !== "core").length : 0; });
    updateStats();
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
    r *= 0.2 + 0.8 * ease(boot());
    ctx.save(); ctx.strokeStyle = color;
    // outer orbit with three satellites
    ctx.globalAlpha = 0.25; ctx.lineWidth = 1 * d; ctx.setLineDash([2 * d, 6 * d]);
    ctx.beginPath(); ctx.arc(x, y, r * 2.75, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    for (let k = 0; k < 3; k++) {
      const a = t / (2600 + k * 900) + k * 2.1, sx = x + Math.cos(a) * r * 2.75, sy = y + Math.sin(a) * r * 2.75;
      ctx.globalAlpha = 0.9; ctx.shadowColor = color; ctx.shadowBlur = 12 * d;
      ctx.beginPath(); ctx.arc(sx, sy, 2.6 * d, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0; ctx.fillStyle = color; ctx.shadowColor = color;
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
    // voice ring: a waveform circle that moves with real sound (mic while listening, JARVIS's voice while talking)
    const fb = soundBins();
    if (fb) {
      const N = 96, R0 = r * 1.98; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.6 * d; ctx.shadowBlur = 12 * d; ctx.beginPath();
      for (let k = 0; k <= N; k++) {
        const v = fb[Math.floor(((k % N) < N / 2 ? (k % N) : N - (k % N)) / (N / 2) * fb.length * 0.6)] || 0;
        const a = (k / N) * Math.PI * 2 - Math.PI / 2, rr = R0 + v * r * 0.55;
        ctx[k ? "lineTo" : "moveTo"](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.stroke(); ctx.shadowBlur = 8 * d;
    }
    // rotating wireframe globe in place of the old hexagon
    const G = r * 0.66, spin = t / 5000;
    ctx.lineWidth = 1 * d; ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.arc(x, y, G, 0, Math.PI * 2); ctx.stroke();
    for (let k = 0; k < 6; k++) {          // meridians: ellipses whose width follows the rotation
      const ph = spin + k * Math.PI / 6, w = Math.abs(Math.cos(ph)) * G;
      ctx.globalAlpha = 0.18 + 0.4 * Math.abs(Math.sin(ph)); ctx.beginPath(); ctx.ellipse(x, y, w, G, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 0.35;
    for (let k = -2; k <= 2; k++) {        // parallels
      const yy = y + (k / 3) * G, ww = Math.sqrt(Math.max(0, G * G - (k / 3 * G) ** 2));
      ctx.beginPath(); ctx.ellipse(x, yy, ww, ww * 0.18, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.55);
    g.addColorStop(0, "rgba(220,250,255,.95)"); g.addColorStop(0.5, color); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.8 + 0.2 * e; ctx.fillStyle = g; ctx.shadowBlur = (20 + 30 * e) * d;
    ctx.beginPath(); ctx.arc(x, y, r * (0.5 + 0.08 * e * Math.sin(t / 70)), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawBackdrop(t) {
    const d = devicePixelRatio;
    // drifting dust, with a little parallax when you pan
    ctx.fillStyle = "#9fe8ff";
    dust.forEach((p) => {
      const x = ((p.x * W + view.x * 0.08 * p.z + t * 0.004 * p.z) % W + W) % W;
      const y = ((p.y * H + view.y * 0.08 * p.z) % H + H) % H;
      ctx.globalAlpha = (0.12 + 0.25 * p.z) * (0.6 + 0.4 * Math.sin(t / 900 + p.p)) * (1 + energy);
      ctx.beginPath(); ctx.arc(x, y, p.z * 1.3 * d, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // tinted line colour for an edge: the hub's own colour, so each branch has its own hue
  const edgeColor = (a, b) => (a.type === "hub" ? hubColor(a) : b.type === "hub" ? hubColor(b) : a.hubC || b.hubC || THEMES[theme].accent);
  const rgba = (hex, al) => { const v = parseInt(hex.slice(1), 16); return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${al})`; };

  function hexPath(x, y, r, rot) {
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) { const a = rot + k * Math.PI / 3; ctx[k ? "lineTo" : "moveTo"](x + Math.cos(a) * r, y + Math.sin(a) * r); }
  }

  function drawReticle(x, y, r, t, color) {
    const d = devicePixelRatio, R = r + 10 * d, L = 7 * d;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5 * d; ctx.shadowColor = color; ctx.shadowBlur = 10 * d;
    ctx.translate(x, y); ctx.rotate(t / 1400);
    for (let k = 0; k < 4; k++) {
      ctx.rotate(Math.PI / 2); ctx.beginPath();
      ctx.moveTo(R - L, -R); ctx.lineTo(R, -R); ctx.lineTo(R, -R + L); ctx.stroke();
    }
    ctx.restore();
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    drawBackdrop(t);
    const d = devicePixelRatio, rv = reveal(), b0 = ease(boot());
    const alphaOf = (n) => (BIG.includes(n.type) ? b0 : rv * (boot() < 1 ? 0 : 1));
    edges.forEach(([a, b], i) => {
      if (!visible(a) || !visible(b)) return;
      const al = Math.min(alphaOf(a), alphaOf(b)); if (al <= 0.01) return;
      const hot = selected && (a === selected || b === selected);
      const pulse = energy * (0.45 + 0.4 * Math.sin(t / 90 + i * 0.9));
      const col = edgeColor(a, b);
      ctx.globalAlpha = al; ctx.lineWidth = (1 + 1.6 * energy + (hot ? 1 : 0)) * d;
      ctx.shadowColor = col; ctx.shadowBlur = (energy * 14 + (hot ? 8 : 0)) * d;
      ctx.strokeStyle = rgba(col, hot ? 0.8 : 0.16 + pulse);
      let [x1, y1] = toScreen(a), [x2, y2] = toScreen(b);
      if (a.type === "core" || b.type === "core") {  // spokes grow out of the core during start-up
        if (b.type === "core") [x1, y1, x2, y2] = [x2, y2, x1, y1];
        x2 = x1 + (x2 - x1) * b0; y2 = y1 + (y2 - y1) * b0;
      }
      // gentle curve so the web looks organic rather than a star of straight lines
      const mx = (x1 + x2) / 2 - (y2 - y1) * 0.08, my = (y1 + y2) / 2 + (x2 - x1) * 0.08;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
      // data packets travelling along the line (faster and brighter while someone talks)
      if (al > 0.5 && (a.type === "core" || b.type === "core" || hot || energy > 0.1)) {
        const n = 1 + Math.round(energy * 2);
        for (let k = 0; k < n; k++) {
          const u = ((t / (2400 - 1500 * energy) + i * 0.37 + k / n) % 1), v = 1 - u;
          const px = v * v * x1 + 2 * v * u * mx + u * u * x2, py = v * v * y1 + 2 * v * u * my + u * u * y2;
          ctx.globalAlpha = al * Math.sin(u * Math.PI); ctx.fillStyle = "#e6fbff"; ctx.shadowBlur = 10 * d;
          ctx.beginPath(); ctx.arc(px, py, (1.6 + energy) * d, 0, Math.PI * 2); ctx.fill();
        }
      }
    });
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    nodes.forEach((n) => {
      if (!visible(n)) return;
      const al = alphaOf(n); if (al <= 0.01) return;
      const [x, y] = toScreen(n);
      const r = n.type === "core" ? Math.max(n.r * view.k, 58) * d : n.type === "hub" ? Math.max(n.r * view.k, 11) * d : n.r * view.k * d;
      let color = n.type === "hub" ? hubColor(n) : TYPES[n.type] || "#8aa";
      if (n.type === "account") color = STATUS[n.status] || color;
      if (n.type === "core") { drawCore(x, y, r, t, color); return; }
      const glow = flash.has(n.id) ? 30 + 10 * Math.sin(t / 120) : n === selected || n === hover ? 24 : 10 + 16 * energy;
      ctx.shadowColor = color; ctx.shadowBlur = glow * d;
      ctx.globalAlpha = al * (n.status === "unsupported" ? 0.45 : 0.9);
      if (n.type === "hub") {
        const R = r * 1.25;
        ctx.globalAlpha = al * 0.12; ctx.fillStyle = color; hexPath(x, y, R, Math.PI / 6); ctx.fill();
        ctx.globalAlpha = al; ctx.strokeStyle = color; ctx.lineWidth = 1.6 * d; hexPath(x, y, R, Math.PI / 6); ctx.stroke();
        // segmented ring spinning around the brain, one segment per thing inside it
        const segs = Math.max(3, Math.min(12, n.kids || 3)), gap = 0.18;
        ctx.lineWidth = 2.5 * d; ctx.globalAlpha = al * 0.85;
        for (let k = 0; k < segs; k++) {
          const a0 = t / 2200 + k * (Math.PI * 2 / segs);
          ctx.beginPath(); ctx.arc(x, y, R * 1.45, a0, a0 + Math.PI * 2 / segs - gap); ctx.stroke();
        }
        ctx.globalAlpha = al; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r * 0.42 * (1 + 0.15 * energy * Math.sin(t / 80)), 0, Math.PI * 2); ctx.fill();
        if (n.kids) {  // count badge
          ctx.shadowBlur = 0; ctx.font = `600 ${9 * d}px Orbitron,ui-monospace,monospace`; ctx.textAlign = "center";
          ctx.fillStyle = "#02070d"; ctx.fillText(n.kids, x, y + 3.2 * d);
        }
      } else {
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
      if (n.type === "hub" || (n.type === "account" && rv > 0.5) || n === hover || n === selected || view.k > baseK * 1.8) {
        ctx.textAlign = "center";
        if (n.type === "hub") {
          const txt = n.label.toUpperCase(), ly = y + r * 1.25 * 1.45 + 18 * d;
          ctx.font = `600 ${10.5 * d}px Orbitron,ui-monospace,monospace`;
          const w = ctx.measureText(txt).width + 18 * d;
          ctx.globalAlpha = al * 0.85; ctx.fillStyle = "rgba(2,10,18,.8)"; ctx.fillRect(x - w / 2, ly - 12 * d, w, 17 * d);
          ctx.strokeStyle = rgba(color, 0.6); ctx.lineWidth = 1 * d; ctx.strokeRect(x - w / 2, ly - 12 * d, w, 17 * d);
          ctx.fillStyle = color; ctx.fillRect(x - w / 2, ly - 12 * d, 2 * d, 17 * d);
          ctx.globalAlpha = al; ctx.fillStyle = "#e6fbff"; ctx.fillText(txt, x, ly);
        } else {
          ctx.fillStyle = "#cfefff"; ctx.font = `${11 * d}px Rajdhani,ui-monospace,monospace`;
          ctx.fillText(n.label + (n.status === "unsupported" ? " (no API)" : ""), x, y + r + 14 * d);
        }
      }
      const alert = n.type === "account" && alerted[n.id.slice(4)];
      if (alert || n.live) {  // pulsing ring: account with a fresh alert, or a live threat from the feed
        const c = alert ? ALERT_COL[alert] || "#ffb547" : "#ff4d5e", ph = (t / 1200) % 1;
        ctx.globalAlpha = al * (1 - ph) * 0.9; ctx.strokeStyle = c; ctx.lineWidth = 2 * d; ctx.shadowColor = c; ctx.shadowBlur = 12 * d;
        ctx.beginPath(); ctx.arc(x, y, r + (4 + 16 * ph) * d, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
      }
      if (n === selected || n === hover) drawReticle(x, y, n.type === "hub" ? r * 1.25 * 1.45 : r, t, color);
      ctx.globalAlpha = 1;
    });
  }

  // ---- orbit: when you leave it alone, the whole system slowly turns around the core.
  // It eases to a stop the moment you touch the mouse, a hand shows up on the camera, or you reset,
  // and only starts again after ORBIT_IDLE_MS with no hand in view and nothing selected.
  const ORBIT_SPEED = 0.06, ORBIT_IDLE_MS = 6000;   // radians per second (about one turn every 105 s)
  let spin = 0, lastTouch = performance.now(), handOn = false, lastT = 0;
  const touched = () => { lastTouch = performance.now(); };
  function orbit(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
    const want = !handOn && !dragging && !panFrom && !selected && boot() >= 1 && t - lastTouch > ORBIT_IDLE_MS ? ORBIT_SPEED : 0;
    spin += (want - spin) * (want ? 0.01 : 0.12);   // gentle start, quick stop
    if (spin < 1e-4) { spin = want ? spin : 0; return; }
    const a = spin * dt, c = Math.cos(a), sn = Math.sin(a);
    nodes.forEach((n) => { if (n.type === "core" || n === dragging) return; const x = n.x; n.x = x * c - n.y * sn; n.y = x * sn + n.y * c; });
  }

  function loop(t) {
    step(); orbit(t); if (!userMoved && t - fitStart < 5000) fit();
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
    const label = { connected: "connected", "needs-auth": "needs sign-in (Settings > Connectors on claude.ai)", planned: "not connected yet", partial: "partly connected", unsupported: "no way to connect" };
    const status = n.status ? `<p class="${n.status === "connected" ? "ok" : n.status === "unsupported" ? "bad" : "warn"}">status: ${label[n.status] || n.status}</p>` : "";
    d.innerHTML = `<h3></h3>${status}<div class="body"></div>`;
    d.querySelector("h3").textContent = n.label;
    d.querySelector(".body").textContent = n.body || "(no note yet)";
    if (n.url) {
      const row = document.createElement("div"); row.className = "linkrow";
      const open = document.createElement("button"); open.textContent = "Open ↗"; open.onclick = () => openNode(n);
      row.append(open);
      if (n.type === "link") {
        const rm = document.createElement("button"); rm.textContent = "Remove"; rm.className = "ghost";
        rm.onclick = async () => { await api("/api/links", { action: "remove", id: n.id }); select(null); loadGraph(); };
        row.append(rm);
      }
      d.append(row);
    }
  }

  // ---- web pages: every bubble with a url opens its site in a new window (your normal browser sign-ins apply)
  function openNode(n) {
    if (!n || !n.url) return false;
    window.open(n.url, "_blank", "noopener,noreferrer");
    say("jarvis", "Opening " + n.label + ". Try not to get lost in there.");
    return true;
  }
  function findNode(name) {
    const q = name.toLowerCase().replace(/^(my|the)\s+/, "").replace(/[.!?]+$/, "").trim();
    const withUrl = nodes.filter((n) => n.url);
    return withUrl.find((n) => n.label.toLowerCase() === q) || withUrl.find((n) => n.label.toLowerCase().includes(q)) ||
      withUrl.find((n) => q.includes(n.label.toLowerCase().split(/[\s/(]/)[0]));
  }
  $("linkForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await (await api("/api/links", { name: $("linkName").value, url: $("linkUrl").value, group: $("linkGroup").value })).json();
    if (r.error) { say("jarvis", "⚠ " + r.error); return; }
    $("linkName").value = $("linkUrl").value = ""; loadGraph();
    say("jarvis", "Link added. Zoom in on its main circle to find it.");
  });

  // mouse / touch
  let dragging = null, panFrom = null;
  canvas.addEventListener("pointerdown", (e) => {
    touched();
    const n = nodeAt(e.clientX, e.clientY);
    if (n) { dragging = n; heat = Math.max(heat, 0.3); select(n); } else panFrom = [e.clientX, e.clientY, view.x, view.y];
  });
  addEventListener("pointermove", (e) => {
    touched();
    hover = nodeAt(e.clientX, e.clientY);
    if (dragging) { const [wx, wy] = toWorld(e.clientX * devicePixelRatio, e.clientY * devicePixelRatio); dragging.x = wx; dragging.y = wy; heat = Math.max(heat, 0.3); }
    else if (panFrom) { userMoved = true; target = null; view.x = panFrom[2] + (e.clientX - panFrom[0]) * devicePixelRatio; view.y = panFrom[3] + (e.clientY - panFrom[1]) * devicePixelRatio; }
  });
  addEventListener("pointerup", () => { dragging = null; panFrom = null; });
  canvas.addEventListener("dblclick", (e) => openNode(nodeAt(e.clientX, e.clientY)));
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); touched(); zoomBy(e.deltaY < 0 ? 1.1 : 0.9); }, { passive: false });

  function zoomBy(f) { userMoved = true; target = null; view.k = Math.max(0.2, Math.min(4, view.k * f)); }
  function reset() { touched(); spin = 0; userMoved = false; target = null; fitStart = performance.now(); select(null); }

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
    handActive: (on) => { handOn = on; if (on) touched(); },
    pick: (cx, cy) => { const n = nodeAt(cx, cy); if (n) select(n); return n; },
    open: (cx, cy) => openNode(nodeAt(cx, cy)),
    panBy: (dx, dy) => { userMoved = true; target = null; view.x += dx * devicePixelRatio; view.y += dy * devicePixelRatio; },
    positions: () => nodes.map((n) => [n.x, n.y]),
    // fist gesture: grab one bubble and move it
    grab: (cx, cy) => { const n = nodeAt(cx, cy); if (n && n.type !== "core") { dragging = n; heat = Math.max(heat, 0.3); select(n); } return n; },
    dragTo: (cx, cy) => { if (!dragging) return; const [wx, wy] = toWorld(cx * devicePixelRatio, cy * devicePixelRatio); dragging.x = wx; dragging.y = wy; heat = Math.max(heat, 0.3); },
    drop: () => { dragging = null; },
    togglePanels: () => document.body.classList.toggle("hide-panels"),
    zoomBy, reset, talk: (on) => { talking = Math.max(0, talking + (on ? 1 : -1)); }, setMode: (m) => { $("mode").textContent = m; },
  };

  // ---------------------------------------------------------------- top-bar readouts
  function updateStats() {
    const acc = nodes.filter((n) => n.type === "account");
    const on = acc.filter((n) => n.status === "connected").length;
    const notes = nodes.filter((n) => !["core", "hub", "account", "link"].includes(n.type)).length;
    $("statAcc").textContent = `${on}/${acc.length}`; $("statNotes").textContent = notes;
    $("statThreats").textContent = nodes.filter((n) => n.type === "threat").length;
  }
  function tickClock() {
    const now = new Date();
    $("clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    $("date").textContent = now.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" }).toUpperCase();
  }
  tickClock(); setInterval(tickClock, 1000);

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

  async function loadAlerts() {
    const list = await (await api("/api/alerts")).json();
    const day = Date.now() - 864e5; alerted = {};
    const rank = { info: 1, warn: 2, phishing: 3 };
    const box = $("alerts"); box.innerHTML = "";
    const recent = list.filter((a) => a.account && Date.parse(a.ts) > day);
    recent.forEach((a) => { if (a.level !== "setup" && (rank[a.level] || 0) > (rank[alerted[a.account]] || 0)) alerted[a.account] = a.level; });
    if (!recent.length) { box.innerHTML = '<li class="muted">All quiet. Suspiciously quiet.</li>'; return; }
    recent.slice(-12).reverse().forEach((a) => {
      const li = document.createElement("li"); li.className = "alert " + (a.level || "info");
      const tag = document.createElement("b"); tag.textContent = (a.level === "phishing" ? "PHISHING " : a.level === "setup" ? "FIX ACCESS · " : "") + a.account;
      li.append(tag, " " + a.text); li.title = a.ts; box.appendChild(li);
    });
  }

  function refresh() { loadSecurity(); loadPending(); loadAudit(); loadAlerts(); }

  // ---------------------------------------------------------------- chat
  function say(who, text) {
    const m = document.createElement("div"); m.className = "msg " + (who === "me" ? "me" : "");
    m.textContent = text; $("chat").appendChild(m); $("chat").scrollTop = 1e9; return m;
  }

  $("ask").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("msg").value.trim(); if (!text) return;
    $("msg").value = ""; say("me", text);
    const op = text.match(/^(?:hey\s+jarvis[,\s]*)?(?:please\s+)?(?:open|launch|go to|show me)\s+(.+)/i);
    if (op && openNode(findNode(op[1]))) return;
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
  // JARVIS's own voice through Fish Audio when a key is set in .env, otherwise the browser's voice
  let voiceAudio = null;
  async function speak(text) {
    if (!text || !voiceOn) return;
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (voiceAudio) { voiceAudio.pause(); voiceAudio = null; }
    try {
      const r = await api("/api/tts", { text: text.slice(0, 900) });
      if (r.status === 200) {
        const url = URL.createObjectURL(await r.blob()), a = new Audio(url); voiceAudio = a;
        let on = false, an = null;
        if (audioCtx && audioCtx.state === "running") {  // route through an analyser so the voice ring moves with JARVIS's voice
          const src = audioCtx.createMediaElementSource(a); src.connect(audioCtx.destination); an = addAnalyser(src);
        }
        a.onplay = () => { if (!on) { on = true; window.HUD.talk(true); } };
        a.onended = a.onerror = a.onpause = () => { if (on) { on = false; window.HUD.talk(false); } URL.revokeObjectURL(url); if (voiceAudio === a) voiceAudio = null; if (an) { analysers.splice(analysers.indexOf(an) >>> 0, 1); an = null; } idleMode(); };
        await a.play(); return;
      }
    } catch {}
    browserSpeak(text);
  }
  function browserSpeak(text) {
    if (!window.speechSynthesis) return;
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
    if (!voiceOn) { if (window.speechSynthesis) speechSynthesis.cancel(); if (voiceAudio) voiceAudio.pause(); }
  };
  // ---------------------------------------------------------------- "Hey Jarvis" wake word
  // Always-on listening in the browser. Say "Hey Jarvis" then your question, in one go
  // ("Hey Jarvis, what's on my calendar") or with a pause ("Hey Jarvis" ... "what's on my calendar").
  // Nothing is sent to JARVIS until it hears the wake word. Toggle with the 👂 button.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const WAKE = /\b(?:hey|hi|ok|okay|yo)[\s,]+(?:jarvis|jervis|travis|service)\b[\s,.!?]*/i;
  const AWAKE_MS = 10000;   // how long it waits for your question after "Hey Jarvis"
  // wake modes: "on" = browser speech service, "private" = speech turned into text on this PC (whisper), "off"
  let wakeMode = "on", rec = null, awakeUntil = 0, awakeGlow = false, restartDelay = 300, chimeCtx = null;
  try { wakeMode = { off: "off", private: "private" }[localStorage.getItem("jarvis.wake")] || "on"; } catch {}
  let wakeOn = wakeMode !== "off";
  const busy = () => document.querySelector(".dial").classList.contains("busy") || (window.speechSynthesis && speechSynthesis.speaking) || (voiceAudio && !voiceAudio.paused);
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

  // one heard phrase (final): wake word + question, wake word alone, or the question after waking
  function heardFinal(heard) {
    const rest = afterWake(heard);
    if (rest !== null) rest.length > 2 ? ask(rest) : wakeUp();
    else if (awakeGlow && heard.length > 2) ask(heard);
  }

  // ---- private listening: cut speech into clips with a simple loudness detector and transcribe them on this PC
  const JUNK = /^(you|thank you\.?|thanks for watching!?|\.+|bye\.?)$/i;
  let priv = null;
  async function startPrivate() {
    if (priv || wakeMode !== "private") return;
    if (!ensureAudio()) return;
    let st;
    try { st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { setWake("off"); say("jarvis", "The microphone is blocked. Allow it in the address bar, then press 👂."); return; }
    const an = addAnalyser(audioCtx.createMediaStreamSource(st)), buf = new Float32Array(an.fftSize);
    priv = { st, an, rec: null, chunks: [], loudAt: 0, startAt: 0, timer: null };
    let noise = 0.01;
    priv.timer = setInterval(() => {
      if (!priv) return;
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length), now = performance.now(), loud = rms > Math.max(0.02, noise * 3);
      if (!loud && !priv.rec) noise = noise * 0.98 + rms * 0.02;   // learn the room's background level
      if (loud && !busy()) priv.loudAt = now;
      if (loud && !priv.rec && !busy()) {
        priv.chunks = []; priv.startAt = now;
        priv.rec = new MediaRecorder(st); priv.rec.ondataavailable = (e) => priv && priv.chunks.push(e.data);
        priv.rec.onstop = () => sendClip(priv ? priv.chunks : [], now);
        priv.rec.start(); if (awakeGlow) awakeUntil = Date.now() + AWAKE_MS;
      } else if (priv.rec && (now - priv.loudAt > 800 || now - priv.startAt > 12000)) {
        const r = priv.rec; priv.rec = null; const dur = now - priv.startAt;
        r.onstop = dur > 900 ? () => sendClip(priv ? priv.chunks : [], dur) : null; r.stop();
      }
    }, 50);
  }
  async function sendClip(chunks) {
    if (!chunks.length) return;
    const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
    try {
      const r = await fetch("/api/stt", { method: "POST", headers: { "X-Jarvis-Token": window.JARVIS_TOKEN, "Content-Type": blob.type }, body: blob });
      const j = await r.json();
      if (j.error) { say("jarvis", "⚠ Private listening: " + j.error); setWake("on"); return; }
      const text = (j.text || "").trim();
      if (text && !JUNK.test(text) && !busy()) heardFinal(text);
    } catch {}
  }
  function stopPrivate() {
    if (!priv) return;
    clearInterval(priv.timer); if (priv.rec) { priv.rec.onstop = null; priv.rec.stop(); }
    priv.st.getTracks().forEach((t) => t.stop());
    analysers.splice(analysers.indexOf(priv.an) >>> 0, 1); priv = null;
  }

  function startWake() {
    if (wakeMode === "private") return startPrivate();
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
        heardFinal(heard);
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setWake("off"); say("jarvis", "I'd love to listen, but the microphone is blocked. Allow it in the address bar, then press 👂.");
      } else if (e.error === "network") restartDelay = Math.min(10000, restartDelay * 2);
    };
    rec.onstart = () => { restartDelay = 300; idleMode(); };
    rec.onend = () => { rec = null; if (wakeOn) setTimeout(startWake, restartDelay); };  // Chrome stops every minute or so; just restart
    try { rec.start(); } catch { rec = null; }
  }
  function setWake(mode) {
    wakeMode = mode; wakeOn = mode !== "off"; try { localStorage.setItem("jarvis.wake", mode); } catch {}
    $("wakeBtn").textContent = { on: "👂 Hey Jarvis", private: "🔒 Hey Jarvis", off: "👂 Off" }[mode];
    $("wakeBtn").title = { on: "Listening with the browser's speech service. Click for private mode.", private: "Private: speech is turned into text on this PC. Click to turn off.", off: "Not listening. Click to turn on." }[mode];
    $("wakeBtn").classList.toggle("on", wakeOn);
    if (rec) { const r = rec; rec = null; r.onend = null; r.abort(); }
    if (mode !== "private") stopPrivate();
    if (wakeOn) { startWake(); if (!analysers.length) listenMicLevel(); } else sleep();
    idleMode();
  }
  const NEXT = SR ? { on: "private", private: "off", off: "on" } : { private: "off", off: "private", on: "private" };
  if (!SR && wakeMode === "on") wakeMode = "private";
  $("wakeBtn").onclick = () => { ensureAudio(); setWake(NEXT[wakeMode]); };
  setWake(wakeMode);

  // 🎙 button: talk without saying the wake word
  $("micBtn").onclick = () => {
    if (!SR) { say("jarvis", "This browser has no speech recognition. Try Chrome or Edge."); return; }
    if (rec || priv) { wakeUp(); return; }  // the always-on listener is already running, just open the window
    const r = new SR(); r.lang = "en-US"; $("mode").textContent = "LISTENING"; let heard = false;
    r.onspeechstart = () => { if (!heard) { heard = true; window.HUD.talk(true); } };
    r.onspeechend = () => { if (heard) { heard = false; window.HUD.talk(false); } };
    r.onresult = (e) => ask(e.results[0][0].transcript);
    r.onend = () => { if (heard) { heard = false; window.HUD.talk(false); } if ($("mode").textContent === "LISTENING") idleMode(); };
    r.start();
  };

  $("refreshBtn").onclick = async () => {
    $("refreshBtn").textContent = "⟳ Checking…";
    const r = await (await api("/api/refresh-accounts", {})).json();
    $("refreshBtn").textContent = "⟳ Accounts";
    if (r.error) say("jarvis", "⚠ " + r.error);
    else if (!r.connected.length) say("jarvis", "No accounts connected yet. On claude.ai go to Settings > Connectors, connect Gmail, Google Calendar and Google Drive, then press ⟳ Accounts again.");
    if (r.seen && !(r.connected || []).length) say("jarvis", r.seen.length ? "Claude Code on this PC sees: " + r.seen.map((x) => `${x.name} (${x.status})`).join(", ") : "Claude Code on this PC lists no connectors at all.");
    else say("jarvis", "Connected: " + r.connected.join(", ") + ". Reading is allowed; anything that sends or changes stuff still waits for your Approve.");
    loadGraph();
  };

  // ---------------------------------------------------------------- morning briefing
  async function runBriefing(force) {
    const out = say("jarvis", "☀ Preparing your briefing… (reading calendar and email)");
    document.querySelector(".dial").classList.add("busy"); $("mode").textContent = "BRIEFING";
    try {
      const b = await (await api("/api/briefing", { force })).json();
      out.textContent = "☀ " + (b.text || "Nothing to report.");
      if (b.flags && b.flags.length) say("jarvis", "⚠ Briefing flagged by scanner: " + b.flags.join(", "));
      document.querySelector(".dial").classList.remove("busy"); idleMode();
      speak(b.text);
    } catch (e) { out.textContent = "⚠ " + e; document.querySelector(".dial").classList.remove("busy"); idleMode(); }
  }
  $("briefBtn").onclick = () => runBriefing(true);
  $("themeBtn").onclick = () => { const k = Object.keys(THEMES); applyTheme(k[(k.indexOf(theme) + 1) % k.length]); };
  addEventListener("pointerdown", () => audioCtx && audioCtx.resume(), { once: true });
  async function autoBriefing() {
    // once a day, the first time you open JARVIS after 5am, if any account is connected
    const b = await (await api("/api/briefing")).json();
    const today = new Date().toLocaleDateString("en-CA");
    const any = nodes.some((n) => n.type === "account" && n.status === "connected");
    if (any && b.date !== today && new Date().getHours() >= 5) runBriefing(false);
    else if (b.date === today && b.text) say("jarvis", "☀ " + b.text);
  }

  loadGraph().then(() => { requestAnimationFrame(loop); setTimeout(autoBriefing, 2500); });
  refresh(); setInterval(refresh, 15000);
})();
