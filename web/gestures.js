// Hand-gesture control of the graph using MediaPipe Hands, fully in the browser.
// The camera picture is never shown or uploaded: JARVIS only draws your hand as glowing
// lines on the HUD. Frames are processed locally.
//
// Tracking is built around your THUMB and INDEX finger:
//   the cursor sits between your thumb tip and index tip
//   pinch thumb + index, then let go        -> select the bubble under the cursor
//   pinch, hold and move                    -> drag the graph
//   pinch with both hands, move apart/in    -> zoom in/out
//   open palm (all five fingers), hold 1.2s -> reset the view
//   point at a bubble and hold still ~1.3s  -> select it (a ring fills up around the cursor)
//   make a fist over a bubble               -> grab it; move your fist to drag it, open to drop
//   swipe an open hand fast left or right   -> hide / show the side panels
const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
const THUMB = 4, INDEX = 8;

// Tuning
const PINCH_ON = 0.28;      // thumb-index gap / hand size to start a pinch
const PINCH_OFF = 0.42;     // ...and to release it (the gap between them stops flicker)
const CONFIRM_FRAMES = 3;   // a pinch change must hold this many frames
const DRAG_START_PX = 14;   // move this far while pinched before it counts as a drag
const LOST_GRACE_MS = 350;  // keep the last state this long if the hand drops out for a moment
const DWELL_MS = 1300;      // hold still on a bubble this long to select it
const DWELL_PX = 18;        // ...moving less than this
const SWIPE_FRAC = 0.33;    // a swipe must cross a third of the screen...
const SWIPE_MS = 260;       // ...within this time

const btn = document.getElementById("camBtn");
const video = document.getElementById("cam");
const layer = document.getElementById("handLayer");
const hint = document.getElementById("gestureHint");
const cursor = document.getElementById("cursor");
const lctx = layer.getContext("2d");
let landmarker = null, stream = null, running = false, lastVideoTime = -1;

// One Euro filter: very steady when the hand is still, still quick when it moves fast.
class OneEuro {
  constructor(minCutoff = 0.8, beta = 0.015, dCutoff = 1) { Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 }); }
  alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v, t) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
    const d = (v - this.x) / dt; this.dx += this.alpha(this.dCutoff, dt) * (d - this.dx);
    this.x += this.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (v - this.x); return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}
const fx = new OneEuro(), fy = new OneEuro(), fpinch = new OneEuro(2.0, 0.0);

const state = {
  pos: { x: innerWidth / 2, y: innerHeight / 2 },
  pinching: false, pending: 0, pinchStart: null, dragging: false, lastDrag: null,
  lastSeen: 0, anchor: null, palmSince: 0, zoomPrev: null, zoomFrames: 0,
  fist: false, fistPending: 0, dwellNode: null, dwellStart: 0, dwellAt: null, dwellDone: null,
  trail: [], swipeUntil: 0,
};

const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
// hand size = wrist to index knuckle + index knuckle to pinky knuckle (stable at any distance from camera)
const handSize = (h) => (d3(h[0], h[5]) + d3(h[5], h[17])) / 2;
const pinchRatio = (h) => d3(h[THUMB], h[INDEX]) / handSize(h);
// mirror x so moving your hand right moves things right; use the central 70% of the frame
const toScreen = (p) => [Math.min(1, Math.max(0, (1 - p.x - 0.15) / 0.7)) * innerWidth,
  Math.min(1, Math.max(0, (p.y - 0.15) / 0.7)) * innerHeight];
const midpoint = (h) => ({ x: (h[THUMB].x + h[INDEX].x) / 2, y: (h[THUMB].y + h[INDEX].y) / 2 });
// a finger is curled when its tip is closer to the wrist than its middle joint is
function fistClosed(h) {
  return [[8, 6], [12, 10], [16, 14], [20, 18]].every(([t, p]) => d3(h[t], h[0]) < d3(h[p], h[0]));
}
function allFingersOpen(h) {
  const tipsUp = [[8, 6], [12, 10], [16, 14], [20, 18]].every(([t, p]) => h[t].y < h[p].y);
  return tipsUp && d3(h[THUMB], h[17]) > handSize(h) * 1.1;
}

// Stick to the same hand between frames, so a second hand coming into view can't steal the cursor.
function primaryHand(hands) {
  if (hands.length < 2 || !state.anchor) return hands[0];
  return hands.reduce((best, h) => {
    const m = midpoint(h), b = midpoint(best);
    return Math.hypot(m.x - state.anchor.x, m.y - state.anchor.y) < Math.hypot(b.x - state.anchor.x, b.y - state.anchor.y) ? h : best;
  });
}

async function start() {
  btn.textContent = "Loading…";
  try {
    if (!landmarker) {
      const { FilesetResolver, HandLandmarker } = await import(`${VISION}/vision_bundle.mjs`);
      const files = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", numHands: 2,
        minHandDetectionConfidence: 0.7, minHandPresenceConfidence: 0.7, minTrackingConfidence: 0.7,
      });
      try { landmarker = await HandLandmarker.createFromOptions(files, opts("GPU")); }
      catch { landmarker = await HandLandmarker.createFromOptions(files, opts("CPU")); }  // some PCs lack WebGL2
    }
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: { ideal: 30 } } });
    video.srcObject = stream; await video.play();
    layer.hidden = false; hint.hidden = false; cursor.hidden = false; running = true;
    btn.textContent = "✋ Camera on"; btn.classList.add("on"); window.HUD.setMode("GESTURE");
    requestAnimationFrame(tick);
  } catch (e) {
    btn.textContent = "✋ Camera"; window.HUD.setMode("STANDBY");
    console.error("Camera/gesture setup failed:", e);
  }
}

function stop() {
  running = false; stream && stream.getTracks().forEach((t) => t.stop());
  layer.hidden = true; hint.hidden = true; cursor.hidden = true;
  btn.textContent = "✋ Camera"; btn.classList.remove("on"); window.HUD.setMode("STANDBY");
  releaseAll();
}

btn.addEventListener("click", () => (running ? stop() : start()));

function releaseAll() {
  fx.reset(); fy.reset(); fpinch.reset();
  if (state.fist) window.HUD.drop();
  Object.assign(state, { pinching: false, pending: 0, pinchStart: null, dragging: false, lastDrag: null, anchor: null, zoomPrev: null, zoomFrames: 0,
    fist: false, fistPending: 0, dwellNode: null, dwellAt: null, trail: [] });
  cursor.classList.remove("pinch", "grab"); cursor.style.setProperty("--dwellOn", 0);
}

function drawHands(hands, primary, ratio) {
  const d = devicePixelRatio;
  if (layer.width !== innerWidth * d) { layer.width = innerWidth * d; layer.height = innerHeight * d; }
  lctx.clearRect(0, 0, layer.width, layer.height);
  lctx.save(); lctx.scale(d, d); lctx.lineCap = "round";
  hands.forEach((h) => {
    const pts = h.map(toScreen), main = h === primary;
    lctx.strokeStyle = main ? "rgba(39,211,255,.55)" : "rgba(39,211,255,.25)";
    lctx.shadowColor = "#27d3ff"; lctx.shadowBlur = 10; lctx.lineWidth = 1.5;
    lctx.beginPath();
    BONES.forEach(([a, b]) => { lctx.moveTo(...pts[a]); lctx.lineTo(...pts[b]); });
    lctx.stroke();
    if (!main) return;
    // thumb and index are the controls: draw them bright, joined by a line that fills in as you pinch
    const close = Math.max(0, Math.min(1, (PINCH_OFF - ratio) / (PINCH_OFF - PINCH_ON * 0.6)));
    lctx.strokeStyle = `rgba(207,239,255,${0.3 + 0.7 * close})`; lctx.lineWidth = 1 + 3 * close; lctx.shadowBlur = 8 + 16 * close;
    lctx.beginPath(); lctx.moveTo(...pts[THUMB]); lctx.lineTo(...pts[INDEX]); lctx.stroke();
    lctx.fillStyle = "#e6fbff";
    [THUMB, INDEX].forEach((i) => { lctx.beginPath(); lctx.arc(...pts[i], 5, 0, 7); lctx.fill(); });
  });
  lctx.restore();
}

function tick(now) {
  if (!running) return;
  if (video.currentTime === lastVideoTime) return requestAnimationFrame(tick);
  lastVideoTime = video.currentTime;
  const hands = landmarker.detectForVideo(video, now).landmarks || [];

  if (!hands.length) {
    if (now - state.lastSeen > LOST_GRACE_MS) { releaseAll(); drawHands([], null, 1); }
    return requestAnimationFrame(tick);
  }
  state.lastSeen = now;

  // two-hand zoom: both hands pinched for a few frames
  if (hands.length === 2 && pinchRatio(hands[0]) < PINCH_ON && pinchRatio(hands[1]) < PINCH_ON) {
    state.zoomFrames++;
    const gap = Math.hypot(midpoint(hands[0]).x - midpoint(hands[1]).x, midpoint(hands[0]).y - midpoint(hands[1]).y);
    if (state.zoomFrames > CONFIRM_FRAMES) {
      if (state.zoomPrev !== null && Math.abs(gap - state.zoomPrev) > 0.004) window.HUD.zoomBy(1 + (gap - state.zoomPrev) * 2);
      state.zoomPrev = state.zoomPrev === null ? gap : state.zoomPrev + (gap - state.zoomPrev) * 0.5;
    }
    drawHands(hands, null, 1);
    return requestAnimationFrame(tick);
  }
  state.zoomFrames = 0; state.zoomPrev = null;

  const h = primaryHand(hands);
  state.anchor = midpoint(h);
  const ratio = fpinch.filter(pinchRatio(h), now);
  drawHands(hands, h, ratio);

  // cursor between thumb and index, so closing the pinch doesn't drag the cursor sideways
  const [rx, ry] = toScreen(state.anchor);
  const pos = state.pos;
  if (!state.pinching || state.dragging) { pos.x = fx.filter(rx, now); pos.y = fy.filter(ry, now); }
  else { fx.filter(rx, now); fy.filter(ry, now); }  // keep the filter warm, but freeze the cursor while deciding click vs drag
  cursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;

  // ---- fist: grab and drag a single bubble (checked first, so a closing fist never counts as a pinch)
  const fistNow = fistClosed(h);
  state.fistPending = fistNow === state.fist ? 0 : state.fistPending + 1;
  if (state.fistPending >= CONFIRM_FRAMES) {
    state.fistPending = 0; state.fist = fistNow;
    if (fistNow) {
      Object.assign(state, { pinching: false, pending: 0, dragging: false, lastDrag: null, pinchStart: null });
      window.HUD.grab(pos.x, pos.y);
    } else window.HUD.drop();
  }
  cursor.classList.toggle("grab", state.fist);
  if (state.fist || (fistNow && state.fistPending)) {
    if (state.fist) window.HUD.dragTo(pos.x, pos.y);
    cursor.style.setProperty("--dwellOn", 0); state.dwellNode = null;
    return requestAnimationFrame(tick);
  }

  const want = state.pinching ? ratio < PINCH_OFF : ratio < PINCH_ON;
  state.pending = want === state.pinching ? 0 : state.pending + 1;
  if (state.pending >= CONFIRM_FRAMES) {
    state.pending = 0; state.pinching = want;
    if (want) { state.pinchStart = { x: rx, y: ry }; state.dragging = false; }
    else {
      if (!state.dragging) window.HUD.pick(pos.x, pos.y);  // pinch and release without moving = select
      state.dragging = false; state.lastDrag = null; state.pinchStart = null;
    }
  }
  cursor.classList.toggle("pinch", state.pinching);

  if (state.pinching) {
    if (!state.dragging && Math.hypot(rx - state.pinchStart.x, ry - state.pinchStart.y) > DRAG_START_PX) {
      state.dragging = true; state.lastDrag = { x: pos.x, y: pos.y };
    }
    if (state.dragging) {
      window.HUD.panBy(pos.x - state.lastDrag.x, pos.y - state.lastDrag.y);
      state.lastDrag = { x: pos.x, y: pos.y };
    }
  } else {
    // ---- dwell: point at a bubble and hold still to select it (not with an open palm, that's reset)
    const n = window.HUD.hover(pos.x, pos.y);
    if (n && !allFingersOpen(h) && n === state.dwellNode && Math.hypot(pos.x - state.dwellAt.x, pos.y - state.dwellAt.y) < DWELL_PX) {
      const p = (now - state.dwellStart) / DWELL_MS;
      if (p >= 1 && state.dwellDone !== n) { window.HUD.pick(pos.x, pos.y); state.dwellDone = n; }
      cursor.style.setProperty("--dwell", Math.min(1, p)); cursor.style.setProperty("--dwellOn", state.dwellDone === n ? 0 : 1);
    } else {
      state.dwellNode = n; state.dwellStart = now; state.dwellAt = { x: pos.x, y: pos.y };
      if (n !== state.dwellDone) state.dwellDone = null;
      cursor.style.setProperty("--dwellOn", 0);
    }
  }
  if (state.pinching) cursor.style.setProperty("--dwellOn", 0);

  // ---- swipe: fast sideways move of an open hand toggles the side panels
  const open = allFingersOpen(h);
  state.trail = open ? state.trail.filter((p) => now - p.t < SWIPE_MS).concat({ t: now, x: rx }) : [];
  if (open && now > state.swipeUntil && state.trail.length > 2 && Math.abs(rx - state.trail[0].x) > innerWidth * SWIPE_FRAC) {
    window.HUD.togglePanels(); state.swipeUntil = now + 1000; state.trail = []; state.palmSince = 0;
  }

  if (open && !state.pinching && now > state.swipeUntil) {
    state.palmSince = state.palmSince || now;
    if (now - state.palmSince > 1200) { window.HUD.reset(); state.palmSince = 0; }
  } else state.palmSince = 0;

  requestAnimationFrame(tick);
}
