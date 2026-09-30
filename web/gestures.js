// Hand-gesture control of the graph using MediaPipe Hands, fully in the browser.
// Video never leaves your device: frames are processed locally and nothing is uploaded.
//   point (index finger)  -> move the cursor, hover bubbles
//   pinch (thumb+index)   -> select the bubble under the cursor
//   pinch and move        -> pan the graph
//   open palm, hold 1s    -> reset the view
//   two-hand pinch        -> zoom (spread hands apart = zoom in)
const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const btn = document.getElementById("camBtn");
const wrap = document.getElementById("camWrap");
const video = document.getElementById("cam");
const overlay = document.getElementById("camOverlay");
const cursor = document.getElementById("cursor");
let landmarker = null, stream = null, running = false;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const smooth = { x: innerWidth / 2, y: innerHeight / 2 };
let pinchStart = null, lastPinch = null, palmSince = 0, twoHandStart = null;

function fingersUp(h) {
  // tip above pip joint (y grows downward) for index, middle, ring, pinky
  return [[8, 6], [12, 10], [16, 14], [20, 18]].filter(([t, p]) => h[t].y < h[p].y).length;
}

function isPinch(h) { return dist(h[4], h[8]) < dist(h[0], h[9]) * 0.35; }

async function start() {
  btn.textContent = "Loading…";
  try {
    if (!landmarker) {
      const { FilesetResolver, HandLandmarker } = await import(`${VISION}/vision_bundle.mjs`);
      const files = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
      landmarker = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate: "GPU" }, runningMode: "VIDEO", numHands: 2,
      });
    }
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    video.srcObject = stream; await video.play();
    wrap.hidden = false; cursor.hidden = false; running = true;
    btn.textContent = "✋ Camera on"; btn.classList.add("on"); window.HUD.setMode("GESTURE");
    requestAnimationFrame(tick);
  } catch (e) {
    btn.textContent = "✋ Camera"; alert("Camera/gesture setup failed: " + e.message);
  }
}

function stop() {
  running = false; stream && stream.getTracks().forEach((t) => t.stop());
  wrap.hidden = true; cursor.hidden = true; btn.textContent = "✋ Camera"; btn.classList.remove("on");
  window.HUD.setMode("STANDBY");
}

btn.addEventListener("click", () => (running ? stop() : start()));

function drawHands(hands) {
  overlay.width = video.videoWidth; overlay.height = video.videoHeight;
  const c = overlay.getContext("2d"); c.clearRect(0, 0, overlay.width, overlay.height);
  c.fillStyle = "#27d3ff";
  hands.forEach((h) => h.forEach((p) => { c.beginPath(); c.arc(p.x * overlay.width, p.y * overlay.height, 3, 0, 7); c.fill(); }));
}

function tick() {
  if (!running) return;
  const res = landmarker.detectForVideo(video, performance.now());
  const hands = res.landmarks || [];
  drawHands(hands);

  if (hands.length === 2 && isPinch(hands[0]) && isPinch(hands[1])) {
    const d = dist(hands[0][8], hands[1][8]);
    if (twoHandStart) window.HUD.zoomBy(1 + (d - twoHandStart) * 2);
    twoHandStart = d;
  } else twoHandStart = null;

  if (hands.length >= 1 && !twoHandStart) {
    const h = hands[0];
    // mirror x so moving your hand right moves the cursor right; use the central 70% of the frame
    const nx = Math.min(1, Math.max(0, (1 - h[8].x - 0.15) / 0.7));
    const ny = Math.min(1, Math.max(0, (h[8].y - 0.15) / 0.7));
    smooth.x += (nx * innerWidth - smooth.x) * 0.35; smooth.y += (ny * innerHeight - smooth.y) * 0.35;
    cursor.style.left = smooth.x + "px"; cursor.style.top = smooth.y + "px";

    const pinch = isPinch(h);
    cursor.classList.toggle("pinch", pinch);
    if (pinch) {
      if (!pinchStart) { pinchStart = { x: smooth.x, y: smooth.y, t: performance.now() }; window.HUD.pick(smooth.x, smooth.y); }
      else if (lastPinch) window.HUD.panBy(smooth.x - lastPinch.x, smooth.y - lastPinch.y);
      lastPinch = { x: smooth.x, y: smooth.y };
    } else {
      pinchStart = lastPinch = null; window.HUD.hover(smooth.x, smooth.y);
    }

    if (fingersUp(h) === 4 && !pinch) {
      palmSince = palmSince || performance.now();
      if (performance.now() - palmSince > 1000) { window.HUD.reset(); palmSince = 0; }
    } else palmSince = 0;
  }
  requestAnimationFrame(tick);
}
