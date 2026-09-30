// Hand-gesture control of the graph using MediaPipe Hands, fully in the browser.
// The camera picture is never shown or uploaded: JARVIS only draws your hand as glowing
// lines on the HUD. Frames are processed locally.
//   point (index finger)  -> move the cursor, hover bubbles
//   pinch (thumb+index)   -> select the bubble under the cursor
//   pinch and move        -> pan the graph
//   open palm, hold 1s    -> reset the view
//   two-hand pinch        -> zoom (spread hands apart = zoom in)
const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

const btn = document.getElementById("camBtn");
const video = document.getElementById("cam");
const layer = document.getElementById("handLayer");
const hint = document.getElementById("gestureHint");
const cursor = document.getElementById("cursor");
const lctx = layer.getContext("2d");
let landmarker = null, stream = null, running = false, lastVideoTime = -1;

// One Euro filter: smooth when the hand is still, responsive when it moves fast.
class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1) { Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 }); }
  alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v, t) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
    const d = (v - this.x) / dt; this.dx += this.alpha(this.dCutoff, dt) * (d - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cutoff, dt) * (v - this.x); return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}
const fx = new OneEuro(), fy = new OneEuro();
const pos = { x: innerWidth / 2, y: innerHeight / 2 };
let pinching = false, pinchFrames = 0, lastPinch = null, palmSince = 0, twoHandStart = null, zoomSmooth = null;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// mirror x so moving your hand right moves things right; use the central 70% of the frame
const toScreen = (p) => [Math.min(1, Math.max(0, (1 - p.x - 0.15) / 0.7)) * innerWidth,
  Math.min(1, Math.max(0, (p.y - 0.15) / 0.7)) * innerHeight];
function fingersUp(h) { return [[8, 6], [12, 10], [16, 14], [20, 18]].filter(([t, p]) => h[t].y < h[p].y).length; }
// hysteresis: harder to start a pinch than to keep one, so it doesn't flicker on and off
function pinchState(h, was) { const r = dist(h[4], h[8]) / dist(h[0], h[9]); return was ? r < 0.5 : r < 0.3; }

async function start() {
  btn.textContent = "Loading…";
  try {
    if (!landmarker) {
      const { FilesetResolver, HandLandmarker } = await import(`${VISION}/vision_bundle.mjs`);
      const files = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
      landmarker = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate: "GPU" }, runningMode: "VIDEO", numHands: 2,
        minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6,
      });
    }
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
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
  fx.reset(); fy.reset();
}

btn.addEventListener("click", () => (running ? stop() : start()));

function drawHands(hands) {
  const d = devicePixelRatio;
  if (layer.width !== innerWidth * d) { layer.width = innerWidth * d; layer.height = innerHeight * d; }
  lctx.clearRect(0, 0, layer.width, layer.height);
  lctx.save(); lctx.scale(d, d);
  lctx.strokeStyle = "rgba(39,211,255,.75)"; lctx.fillStyle = "#cfefff";
  lctx.shadowColor = "#27d3ff"; lctx.shadowBlur = 12; lctx.lineWidth = 2; lctx.lineCap = "round";
  hands.forEach((h) => {
    const pts = h.map(toScreen);
    lctx.beginPath();
    BONES.forEach(([a, b]) => { lctx.moveTo(...pts[a]); lctx.lineTo(...pts[b]); });
    lctx.stroke();
    pts.forEach(([x, y], i) => { lctx.beginPath(); lctx.arc(x, y, i % 4 === 0 ? 3.5 : 2, 0, 7); lctx.fill(); });
  });
  lctx.restore();
}

function tick(now) {
  if (!running) return;
  if (video.currentTime === lastVideoTime) return requestAnimationFrame(tick);
  lastVideoTime = video.currentTime;
  const hands = landmarker.detectForVideo(video, now).landmarks || [];
  drawHands(hands);

  if (hands.length === 2 && pinchState(hands[0], true) && pinchState(hands[1], true)) {
    const dd = dist(hands[0][8], hands[1][8]);
    zoomSmooth = zoomSmooth === null ? dd : zoomSmooth + (dd - zoomSmooth) * 0.3;
    if (twoHandStart !== null) window.HUD.zoomBy(1 + (zoomSmooth - twoHandStart) * 1.5);
    twoHandStart = zoomSmooth;
  } else { twoHandStart = null; zoomSmooth = null; }

  if (hands.length >= 1 && twoHandStart === null) {
    const h = hands[0];
    const [rx, ry] = toScreen(h[8]);
    pos.x = fx.filter(rx, now); pos.y = fy.filter(ry, now);
    cursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;

    const p = pinchState(h, pinching);
    pinchFrames = p === pinching ? 0 : pinchFrames + 1;
    if (pinchFrames >= 2) { pinching = p; pinchFrames = 0; }  // must hold for 2 frames to switch
    cursor.classList.toggle("pinch", pinching);
    if (pinching) {
      if (!lastPinch) window.HUD.pick(pos.x, pos.y);
      else if (Math.hypot(pos.x - lastPinch.x, pos.y - lastPinch.y) > 1.5) window.HUD.panBy(pos.x - lastPinch.x, pos.y - lastPinch.y);
      lastPinch = { x: pos.x, y: pos.y };
    } else {
      lastPinch = null; window.HUD.hover(pos.x, pos.y);
    }

    if (fingersUp(h) === 4 && !pinching) {
      palmSince = palmSince || now;
      if (now - palmSince > 1000) { window.HUD.reset(); palmSince = 0; }
    } else palmSince = 0;
  } else if (!hands.length) { fx.reset(); fy.reset(); pinching = false; lastPinch = null; }
  requestAnimationFrame(tick);
}
