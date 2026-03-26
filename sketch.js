// Infinite-scroll Instagram-ish feed posts (LIGHT MODE) - responsive p5.js
// - Full-screen responsive canvas
// - Square feed posts sized to screen width
// - Double-tap / double-click on photo: big heart pops and flies away
// - Fast scrolling / swiping: random hearts appear on screen and animate independently
// - Floating lover-comments appear while scrolling fast
// - Touch drag + release fling for tablet/phone
// - Mouse drag fallback for desktop testing
// - HUD in top-left shows live game state
// - If tier 6 is sustained for tier6HoldTargetMs, a bomb-like blast sequence triggers
// - Blast lasts blastDurationMs, then a calm ocean lasts calmDurationMs
// - Interaction is locked during blast + calm
//
// Controls:
// - Touch drag / swipe on phone or tablet
// - Mouse drag on desktop
// - Double tap / double click on a photo
// - Press H to hide/show HUD

let PHOTO = 720;

const BASE_W = 720;
const BASE_H = 790;

function sx(v) {
  return v * (width / BASE_W);
}

function sy(v) {
  return v * (height / BASE_H);
}

function smin(v) {
  return v * min(width / BASE_W, height / BASE_H);
}

let IG_RED;
let ICON_BLACK;

let lastTapWX = 0;
let lastTapWY = 0;
let lastTapMillis = -9999;
let doubleTapWindowMs = 240;

var scroll = 0;
let scrollVel = 0;

// ---------- input / velocity model ----------
let maxScrollVel = 320;
let flickEnergy = 0; // 0..1

// ---------- touch scrolling ----------
let touchDragging = false;
let touchLastY = 0;
let touchLastTime = 0;
let swipeSamples = [];
let maxSwipeSamples = 6;

// desktop drag fallback
let mouseDragging = false;

// ---------- Fast-scroll heart trigger ----------
let scrollHeartThreshold = 115;
let scrollHeartIntervalMs = 150;
let lastScrollHeartMillis = -9999;

// ---------- Floating comments / intensity ----------
let commentScrollThreshold = 105;
let commentSpawnMillis = 280;
let lastCommentMillis = -9999;

// ---------- Game-like intensity model ----------
let smoothedScrollSpeed = 0;
let desireCharge = 0; // 0..1
let heat = 0;         // 0..1
let tierHold = 0;     // 0..1
let commentCooldown = 0;

// tuning
let CHARGE_THRESHOLD = 125;
let CHARGE_GAIN = 0.0048;
let CHARGE_DECAY = 0.0038;
let HEAT_LERP_UP = 0.028;
let HEAT_LERP_DOWN = 0.010;
let TIER_HOLD_GAIN = 0.005;
let TIER_HOLD_DECAY = 0.0032;

// ---------- HUD ----------
let showHUD = true;

// ---------- Bomb / aftermath sequence ----------
let tier6HoldMs = 0;
let tier6HoldTargetMs = 2000;

let blastActive = false;
let blastStartMs = -1;
let blastDurationMs = 10000;

let calmActive = false;
let calmStartMs = -1;
let calmDurationMs = 10000;

let interactionLocked = false;
let tier6Exploded = false;

let explosionParticles = [];
let explosionHearts = [];
let smokeParticles = [];


// ---------- Lover Lexicons (6 tiers) ----------
const CORE_TIERS = [
  ["lovely", "liking this", "feels nice", "soft", "yes", "please", "that's it"],
  ["beautiful", "love this", "so good", "stay here", "there", "yum"],
  ["don't stop", "amazing", "keep going", "intoxicating", "more please"],
  ["can't get enough", "incredible", "getting lost", "aaaah", "oh yes"],
  ["it's overwhelming", "keep flicking", "that's perfect", "closer", "this is everything"],
  ["come on that's it", "it's all here", "never end", "all consuming", "losing it"]
];

const STYLE_TIERS = [
  ["stay close", "don't move", "just like that", "thats it"],
  ["close", "feeling it", "right there", "don't move", "scroll"],
  ["tighter", "don't go", "keep doing that", "flick flick flick"],
  ["faster...", "stay with me", "feeling", "connection"],
  ["right there", "just like this", "harder", "flickier", "don't stop now"],
  ["more... please", "neeeeeed", "stay!", "fuck yes"]
];

const EMOTION_TIERS = [
  ["nice", "warm", "smooth"],
  ["this feeling", "getting hot", "meaningful"],
  ["deep", "connected", "special"],
  ["overwhelmed",  "that flicking - fuck", "it's everything", "intense"],
  ["taking over", "YESS", "consuming"],
  ["spinning", "YES keep flicking", "all here", "just like that!!", "nearly there"]
];

const INTENSIFIERS = [
  "so", "really", "deeply", "completely", "utterly",
  "honestly", "truly", "fully", "entirely", "achingly", "fucking", "flicking"
];

const EMOJIS = ["❤️", "🔥", "✨", "🥺", "🫶", "💫", "💞", "🌙", "💋"];

let particles = [];
let bigHearts = [];
let screenHearts = [];
let floatingComments = [];

// ---------- Sound system ----------
let commentSounds = {};

function preload() {
  soundFormats('mp3', 'wav');

  let allPhrases = collectAllLexiconPhrases();

  for (let phrase of allPhrases) {
    let filename = "audio/" + phraseToFilename(phrase) + ".mp3";
    commentSounds[phrase] = loadSound(filename);
  }
}

function collectAllLexiconPhrases() {
  let seen = new Set();
  let out = [];

  function addPhrase(p) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }

  function addTieredArray(arr2d) {
    for (let tier of arr2d) {
      for (let phrase of tier) {
        addPhrase(phrase);
      }
    }
  }

  function addFlatArray(arr) {
    for (let phrase of arr) {
      addPhrase(phrase);
    }
  }

  addTieredArray(CORE_TIERS);
  addTieredArray(STYLE_TIERS);
  addTieredArray(EMOTION_TIERS);
  addFlatArray(INTENSIFIERS);

  return out;
}

function phraseToFilename(phrase) {
  return phrase
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function playCommentSound(phrase, tier = 0, intensity = 0, group = "core") {
  let s = commentSounds[phrase];
  if (!s) return;

  if (s.isPlaying()) s.stop();

  let tierNorm = constrain(tier / 5.0, 0, 1);
  let i = constrain(intensity, 0, 1);
  let energy = constrain(tierNorm * 0.5 + i * 0.5, 0, 1);

  let rateBase = 1.0;
  let volumeBase = 0.8;

  if (group === "core") {
    // lower / steadier / grounded
    rateBase = lerp(0.88, 1.18, energy);
    volumeBase = lerp(0.72, 0.95, energy);
  } else if (group === "style") {
    // brighter / more playful
    rateBase = lerp(0.98, 1.42, energy);
    volumeBase = lerp(0.68, 0.92, energy);
  } else if (group === "emotion") {
    // more expressive / stretched / intense
    rateBase = lerp(0.82, 1.28, pow(energy, 0.85));
    volumeBase = lerp(0.75, 1.0, energy);
  }

  if (blastActive) rateBase *= 1.05;
  if (calmActive) rateBase *= 0.93;

  s.rate(rateBase);
  s.setVolume(volumeBase);
  s.play();
}

function spawnCommentWithSound(tier) {
  let c = buildTieredComment(tier);
  floatingComments.push(new FloatingComment(c.text, tier));

  let intensity = getIntensity01();

  // always play the main sound
  playCommentSound(c.soundKey, tier, intensity, c.group);

  // occasional layering at tier 6
  if (tier >= 5) {
    let layerChance = lerp(0.12, 0.42, intensity);

    if (random(1) < layerChance) {
      let alt = buildLayeredCompanionComment(tier, c.group, c.soundKey);
      if (alt) {
        playLayeredCommentSound(alt.soundKey, tier, intensity, alt.group, random(0.04, 0.12));
      }
    }
  }

  if (tier >= 5 && intensity > 0.9 && random(1) < 0.14) {
  let alt2 = buildLayeredCompanionComment(tier, c.group, c.soundKey);
  if (alt2) {
    playLayeredCommentSound(alt2.soundKey, tier, intensity, alt2.group, random(0.10, 0.18));
  }
}
}
function buildLayeredCompanionComment(tier, avoidGroup, avoidSoundKey) {
  let groups = ["core", "style", "emotion"];

  // prefer a different group from the main one
  groups = shuffle(groups.filter(g => g !== avoidGroup));

  for (let group of groups) {
    let pool = null;

    if (group === "core") pool = CORE_TIERS[tier];
    if (group === "style") pool = STYLE_TIERS[tier];
    if (group === "emotion") pool = EMOTION_TIERS[tier];

    if (!pool || pool.length === 0) continue;

    let options = pool.filter(p => p !== avoidSoundKey);
    if (options.length === 0) continue;

    let phrase = pick(options);
    return {
      text: phrase,
      soundKey: phrase,
      group: group
    };
  }

  return null;
}

function updateResponsiveLayout() {
  PHOTO = width;

  maxScrollVel = max(maxScrollVel, width * 0.44);
  scrollHeartThreshold = max(90, width * 0.16);
  commentScrollThreshold = max(82, width * 0.145);
  CHARGE_THRESHOLD = max(100, width * 0.17);
}


function playLayeredCommentSound(phrase, tier = 0, intensity = 0, group = "core", delaySec = 0.06) {
  let s = commentSounds[phrase];
  if (!s) return;

  let tierNorm = constrain(tier / 5.0, 0, 1);
  let i = constrain(intensity, 0, 1);
  let energy = constrain(tierNorm * 0.5 + i * 0.5, 0, 1);

  let rateBase = 1.0;
  let volumeBase = 0.8;

  if (group === "core") {
    rateBase = lerp(0.84, 1.08, energy);
    volumeBase = lerp(0.35, 0.62, energy);
  } else if (group === "style") {
    rateBase = lerp(0.96, 1.30, energy);
    volumeBase = lerp(0.30, 0.56, energy);
  } else if (group === "emotion") {
    rateBase = lerp(0.78, 1.18, pow(energy, 0.85));
    volumeBase = lerp(0.38, 0.70, energy);
  }

  // small random variation makes overlap feel less robotic
  rateBase *= random(0.97, 1.03);

  if (blastActive) rateBase *= 1.05;
  if (calmActive) rateBase *= 0.93;

  s.rate(rateBase);
  s.setVolume(volumeBase);
  s.play(0, rateBase, volumeBase, delaySec);
}


function setup() {
  createCanvas(windowWidth, windowHeight);
  smooth();

  IG_RED = color(255, 45, 85);
  ICON_BLACK = color(20);

  textFont("sans-serif");
  updateResponsiveLayout();

  document.body.style.overscrollBehavior = "none";
  document.body.style.touchAction = "none";
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  updateResponsiveLayout();
}

function draw() {
  let timeScale = 1.0;
  if (blastActive) {
    let p = getBlastProgress();
    timeScale = lerp(0.30, 1.0, p);
  }

  if (!touchDragging && !mouseDragging && !interactionLocked) {
    scroll += scrollVel * timeScale;

    flickEnergy *= 0.94;
    if (flickEnergy < 0.001) flickEnergy = 0;

    let speedRatio = constrain(abs(scrollVel) / maxScrollVel, 0, 1);
    let drag = lerp(0.90, 0.94, speedRatio);
    scrollVel *= pow(drag, timeScale);

    if (abs(scrollVel) < 0.05) scrollVel = 0;
  }

  if (scroll < 0) {
    scroll = 0;
    scrollVel = 0;
  }

  maybeTriggerScrollHeart();
  updateScrollEmotion();
  maybeSpawnFloatingComment();
  updateTier6SequenceState();

  background(255);

  let shakeX = 0;
  let shakeY = 0;

  if (blastActive) {
    let p = getBlastProgress();
    let impact = pow(1.0 - p, 1.8);
    let shakeAmt = impact * smin(48);

    shakeX = random(-shakeAmt, shakeAmt);
    shakeY = random(-shakeAmt, shakeAmt);
    shakeX += sin(frameCount * 1.2) * shakeAmt * 0.45;
    shakeY += cos(frameCount * 0.9) * shakeAmt * 0.18;
  }

  push();
  translate(shakeX, shakeY);

  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update(timeScale);
    if (particles[i].dead()) particles.splice(i, 1);
  }

  for (let i = bigHearts.length - 1; i >= 0; i--) {
    bigHearts[i].update(timeScale);
    if (bigHearts[i].dead()) bigHearts.splice(i, 1);
  }

  for (let i = screenHearts.length - 1; i >= 0; i--) {
    screenHearts[i].update(timeScale);
    if (screenHearts[i].dead()) screenHearts.splice(i, 1);
  }

  for (let i = floatingComments.length - 1; i >= 0; i--) {
    floatingComments[i].update(timeScale);
    if (floatingComments[i].dead()) floatingComments.splice(i, 1);
  }

  for (let i = explosionParticles.length - 1; i >= 0; i--) {
    explosionParticles[i].update(timeScale);
    if (explosionParticles[i].dead()) explosionParticles.splice(i, 1);
  }

  for (let i = explosionHearts.length - 1; i >= 0; i--) {
    explosionHearts[i].update(timeScale);
    if (explosionHearts[i].dead()) explosionHearts.splice(i, 1);
  }

  for (let i = smokeParticles.length - 1; i >= 0; i--) {
    smokeParticles[i].update(timeScale);
    if (smokeParticles[i].dead()) smokeParticles.splice(i, 1);
  }

  push();
  translate(0, -scroll);

  let firstPost = max(0, floor(scroll / PHOTO) - 1);
  let lastPost = floor((scroll + height) / PHOTO) + 2;

  for (let idx = firstPost; idx <= lastPost; idx++) {
    let topY = idx * PHOTO;
    drawFakePhoto(idx, 0, topY, width, PHOTO);

    stroke(0, 14);
    line(0, topY + PHOTO, width, topY + PHOTO);
  }

  for (const p of particles) p.render();
  for (const b of bigHearts) b.render();

  pop();

  if (calmActive) {
    push();
    noStroke();
    fill(255, 255, 255, 70);
    rect(0, 0, width, height);
    pop();
  }

  for (const b of screenHearts) b.render();
  for (const fc of floatingComments) fc.render();
  for (const eh of explosionHearts) eh.render();
  for (const ep of explosionParticles) ep.render();
  for (const sp of smokeParticles) sp.render();

  drawBombFlash();
  drawHeatDistortion();
  drawShockwaveRings();
  drawBlastGlitch();
  drawSmokeCloudOverlay();
  drawCalmOceanOverlay();

  pop();

  drawHUD();
}

function drawFakePhoto(idx, x, y, w, h) {
  randomSeed(idx * 99991);

  let c1 = color(int(random(225, 245)), int(random(225, 245)), int(random(230, 250)));
  let c2 = color(int(random(200, 230)), int(random(200, 230)), int(random(205, 235)));

  noStroke();
  for (let yy = 0; yy < h; yy += max(2, sy(4))) {
    let t = yy / h;
    fill(lerpColor(c1, c2, t));
    rect(x, y + yy, w, max(2, sy(4)));
  }

  noFill();
  stroke(0, 20);
  strokeWeight(smin(60));
  rect(x, y, w, h);
  strokeWeight(1);
}

function drawHUD() {
  if (!showHUD) return;

  push();
  textAlign(LEFT, TOP);
  textSize(smin(15));

  let x = sx(14);
  let y = sy(14);
  let w = sx(305);
  let h = sy(330);

  noStroke();
  fill(255, 235);
  rect(x, y, w, h, smin(14));

  fill(20);
  text("SCROLL HUD", x + sx(12), y + sy(10));

  let v = abs(scrollVel);
  let tier = getEmotionTier();

  text("scrollVel: " + nf(v, 1, 2), x + sx(12), y + sy(34));
  text("maxVel:    " + nf(maxScrollVel, 1, 0), x + sx(12), y + sy(54));
  text("flickEng:  " + nf(flickEnergy, 1, 3), x + sx(12), y + sy(74));
  text("smoothed:  " + nf(smoothedScrollSpeed, 1, 2), x + sx(12), y + sy(94));
  text("charge:    " + nf(desireCharge, 1, 3), x + sx(12), y + sy(114));
  text("tierHold:  " + nf(tierHold, 1, 3), x + sx(12), y + sy(134));
  text("heat:      " + nf(heat, 1, 3), x + sx(12), y + sy(154));
  text("tier:      " + (tier + 1) + " / 6", x + sx(12), y + sy(174));
  text("comments:  " + floatingComments.length, x + sx(12), y + sy(194));
  text("dragging:  " + ((touchDragging || mouseDragging) ? "yes" : "no"), x + sx(12), y + sy(214));
  text(
    "tier6Hold: " +
    nf(tier6HoldMs / 1000.0, 1, 1) +
    " / " +
    nf(tier6HoldTargetMs / 1000.0, 1, 1) +
    "s",
    x + sx(12), y + sy(234)
  );
  text("locked:    " + (interactionLocked ? "yes" : "no"), x + sx(12), y + sy(254));
  text("phase:     " + (blastActive ? "blast" : calmActive ? "calm" : "live"), x + sx(12), y + sy(274));
  text("blast:     " + nf(blastDurationMs / 1000.0, 1, 1) + "s", x + sx(12), y + sy(294));
  text("calm:      " + nf(calmDurationMs / 1000.0, 1, 1) + "s", x + sx(12), y + sy(314));

  drawHUDBar(x + sx(146), y + sy(118), sx(120), sy(8), desireCharge);
  drawHUDBar(x + sx(146), y + sy(138), sx(120), sy(8), tierHold);
  drawHUDBar(x + sx(146), y + sy(158), sx(120), sy(8), heat);

  pop();
}

function drawHUDBar(x, y, w, h, t) {
  noStroke();
  fill(0, 20);
  rect(x, y, w, h, smin(5));
  fill(255, 80, 120, 220);
  rect(x, y, w * constrain(t, 0, 1), h, smin(5));
}

/* =========================
   Input
   ========================= */
// ---------- Updated mousePressed ----------
function mousePressed() {
  userStartAudio();

  if (touches.length > 0) return;
  if (interactionLocked) return;

  let wx = mouseX;
  let wy = mouseY + scroll;

  let now = millis();
  let d = dist(wx, wy, lastTapWX, lastTapWY);

  let withinTime = (now - lastTapMillis) <= doubleTapWindowMs;
  let withinSpace = d < smin(55);

  if (withinTime && withinSpace) {
    handleDoubleTap(wx, wy);
    lastTapMillis = -9999;
  } else {
    lastTapMillis = now;
    lastTapWX = wx;
    lastTapWY = wy;
  }

  mouseDragging = true;
  scrollVel = 0;
  swipeSamples = [];
}

// ---------- Updated mouseDragged ----------
function mouseDragged() {
  if (touches.length > 0) return false;
  if (interactionLocked) return false;

  let now = millis();
  let dy = mouseY - pmouseY;
  let dt = max(1, deltaTime);

  scroll -= dy;
  if (scroll < 0) scroll = 0;

  let dragSpeed = abs(dy) * (16.0 / dt) * 8.0;
  smoothedScrollSpeed = lerp(smoothedScrollSpeed, dragSpeed, 0.22);

  let frequencyNorm = constrain(map(dt, 120, 8, 0, 1), 0, 1);
  flickEnergy += 0.08 * frequencyNorm;
  flickEnergy = constrain(flickEnergy, 0, 1);

  swipeSamples.push({ dy, dt, time: now });
  if (swipeSamples.length > maxSwipeSamples) swipeSamples.shift();

  if (dragSpeed > scrollHeartThreshold * 0.55) {
    maybeTriggerTouchScrollHeart(dragSpeed);
  }

  if (!blastActive && !calmActive && dragSpeed > commentScrollThreshold * 0.7 && now - lastCommentMillis > 120) {
    let tier = getEmotionTier();
    spawnCommentWithSound(tier);
    lastCommentMillis = now;
  }

  return false;
}

// ---------- Updated mouseWheel ----------
function mouseWheel(event) {
  if (interactionLocked) return false;
  if (touches.length > 0) return false;

  let dy = event.deltaY;
  dy = constrain(dy, -140, 140);

  scroll += dy * 0.95;
  if (scroll < 0) scroll = 0;

  let impulse = dy * 0.32;
  scrollVel += impulse;
  scrollVel = constrain(scrollVel, -maxScrollVel, maxScrollVel);

  let wheelSpeed = abs(impulse) * 8.5;
  smoothedScrollSpeed = lerp(smoothedScrollSpeed, wheelSpeed, 0.32);

  flickEnergy += map(abs(dy), 0, 140, 0.0, 0.18);
  flickEnergy = constrain(flickEnergy, 0, 1);

  let now = millis();

  if (wheelSpeed > scrollHeartThreshold * 0.55) {
    let speedT = constrain(map(wheelSpeed, scrollHeartThreshold * 0.5, maxScrollVel, 0, 1), 0, 1);
    let interval = int(lerp(scrollHeartIntervalMs, 80, speedT));

    if (now - lastScrollHeartMillis >= interval) {
      triggerScrollHeart();
      lastScrollHeartMillis = now;
    }
  }

  if (!blastActive && !calmActive && wheelSpeed > commentScrollThreshold * 0.65 && now - lastCommentMillis > 110) {
    let tier = getEmotionTier();
    let burstCount = (wheelSpeed > commentScrollThreshold * 1.1 && random(1) < 0.25) ? 2 : 1;

    for (let i = 0; i < burstCount; i++) {
      spawnCommentWithSound(tier);
    }

    lastCommentMillis = now;
  }

  return false;
}




function mouseReleased() {
  if (touches.length > 0) return;
  if (interactionLocked) return;

  if (mouseDragging) {
    let releaseVel = estimateTouchReleaseVelocity();
    scrollVel = constrain(-releaseVel, -maxScrollVel, maxScrollVel);
  }

  mouseDragging = false;
  swipeSamples = [];
}

// ---------- Updated touchStarted ----------
function touchStarted() {
  userStartAudio();

  if (interactionLocked) return false;

  if (touches.length > 0) {
    let tx = touches[0].x;
    let ty = touches[0].y;

    let wx = tx;
    let wy = ty + scroll;

    let now = millis();
    let d = dist(wx, wy, lastTapWX, lastTapWY);

    let withinTime = (now - lastTapMillis) <= doubleTapWindowMs;
    let withinSpace = d < smin(55);

    if (withinTime && withinSpace) {
      handleDoubleTap(wx, wy);
      lastTapMillis = -9999;
    } else {
      lastTapMillis = now;
      lastTapWX = wx;
      lastTapWY = wy;
    }

    touchDragging = true;
    touchLastY = touches[0].y;
    touchLastTime = millis();
    swipeSamples = [];
    scrollVel = 0;
  }
  return false;
}

// ---------- Updated touchMoved ----------
function touchMoved() {
  if (interactionLocked) return false;

  if (touches.length > 0) {
    let now = millis();
    let y = touches[0].y;

    let dy = y - touchLastY;
    let dt = max(1, now - touchLastTime);

    scroll -= dy;
    if (scroll < 0) scroll = 0;

    swipeSamples.push({
      dy: dy,
      dt: dt,
      time: now
    });

    if (swipeSamples.length > maxSwipeSamples) {
      swipeSamples.shift();
    }

    let frequencyNorm = constrain(map(dt, 120, 8, 0, 1), 0, 1);
    flickEnergy += 0.10 * frequencyNorm;
    flickEnergy = constrain(flickEnergy, 0, 1);

    let dragSpeed = abs(dy) * (16.0 / dt) * 8.0;
    smoothedScrollSpeed = lerp(smoothedScrollSpeed, dragSpeed, 0.22);

    if (dragSpeed > scrollHeartThreshold * 0.55) {
      maybeTriggerTouchScrollHeart(dragSpeed);
    }

    if (!blastActive && !calmActive && dragSpeed > commentScrollThreshold * 0.7 && now - lastCommentMillis > 120) {
      let tier = getEmotionTier();
      spawnCommentWithSound(tier);
      lastCommentMillis = now;
    }

    touchLastY = y;
    touchLastTime = now;
  }
  return false;
}

function touchEnded() {
  if (interactionLocked) return false;

  if (touchDragging) {
    let releaseVel = estimateTouchReleaseVelocity();
    scrollVel = constrain(-releaseVel, -maxScrollVel, maxScrollVel);

    touchDragging = false;
    swipeSamples = [];
  }
  return false;
}

function keyPressed() {
  if (key === "h" || key === "H") showHUD = !showHUD;
}

function estimateTouchReleaseVelocity() {
  if (swipeSamples.length === 0) return 0;

  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 0; i < swipeSamples.length; i++) {
    let s = swipeSamples[i];
    let v = (s.dy / max(1, s.dt)) * 16.0 * 8.5;
    let w = (swipeSamples.length === 1) ? 1.0 : map(i, 0, swipeSamples.length - 1, 0.6, 1.4);

    weightedSum += v * w;
    weightTotal += w;
  }

  let avgVel = (weightTotal > 0) ? weightedSum / weightTotal : 0;

  let mag = abs(avgVel);
  let flingBoost = constrain(map(mag, 0, 60, 0.9, 1.25), 0.9, 1.25);

  return avgVel * flingBoost;
}

function handleDoubleTap(wx, wy) {
  let idx = int(floor(wy / PHOTO));
  let topY = idx * PHOTO;

  if (wy < topY || wy > topY + PHOTO) return;

  let target = createVector(sx(56), topY + PHOTO - sx(56));
  bigHearts.push(new BigHeart(idx, wx, wy, target));

  let dotCount = int(random(10, 16));
  for (let i = 0; i < dotCount; i++) {
    particles.push(new SparkleDot(wx, wy));
  }
}

/* =========================
   Scroll hearts
   ========================= */
function triggerScrollHeart() {
  let hx = random(width * 0.15, width * 0.85);
  let hy = random(height * 0.20, height * 0.75);
  let start = createVector(hx, hy);

  let tx = hx + random(-width * 0.30, width * 0.30);
  let ty = -random(height * 0.18, height * 0.36);
  let target = createVector(tx, ty);

  screenHearts.push(new BigHeart(-1, start.x, start.y, target));
}

function maybeTriggerScrollHeart() {
  if (interactionLocked) return;

  let v = (touchDragging || mouseDragging) ? smoothedScrollSpeed : abs(scrollVel);
  if (v < scrollHeartThreshold) return;

  let now = millis();
  let speedT = constrain(map(v, scrollHeartThreshold, maxScrollVel, 0, 1), 0, 1);
  let interval = int(lerp(scrollHeartIntervalMs, 70, speedT));

  if (now - lastScrollHeartMillis >= interval) {
    triggerScrollHeart();
    lastScrollHeartMillis = now;
  }
}

function maybeTriggerTouchScrollHeart(dragSpeed) {
  let now = millis();
  let speedT = constrain(map(dragSpeed, scrollHeartThreshold * 0.5, maxScrollVel, 0, 1), 0, 1);
  let interval = int(lerp(scrollHeartIntervalMs, 80, speedT));

  if (now - lastScrollHeartMillis >= interval) {
    triggerScrollHeart();
    lastScrollHeartMillis = now;
  }
}

/* =========================
   Floating comment logic
   ========================= */
function updateScrollEmotion() {
  let v = (touchDragging || mouseDragging) ? smoothedScrollSpeed : abs(scrollVel);

  smoothedScrollSpeed = lerp(smoothedScrollSpeed, v, 0.16);

  let speedNorm = constrain(map(smoothedScrollSpeed, commentScrollThreshold, maxScrollVel, 0, 1), 0, 1);

  if (smoothedScrollSpeed >= CHARGE_THRESHOLD) {
    let bonus = constrain(map(smoothedScrollSpeed, CHARGE_THRESHOLD, maxScrollVel, 0.0, 1.0), 0, 1);
    desireCharge += CHARGE_GAIN * lerp(0.35, 1.0, pow(bonus, 1.5));
  } else {
    desireCharge -= CHARGE_DECAY;
  }
  desireCharge = constrain(desireCharge, 0, 1);

  if (desireCharge > 0.30) tierHold += TIER_HOLD_GAIN;
  else tierHold -= TIER_HOLD_DECAY;
  tierHold = constrain(tierHold, 0, 1);

  let targetHeat = speedNorm * 0.22 + desireCharge * 0.50 + tierHold * 0.28;
  targetHeat = constrain(targetHeat, 0, 1);

  if (targetHeat > heat) heat = lerp(heat, targetHeat, HEAT_LERP_UP);
  else heat = lerp(heat, targetHeat, HEAT_LERP_DOWN);

  if (commentCooldown > 0) commentCooldown--;
}

// ---------- Updated maybeSpawnFloatingComment ----------
function maybeSpawnFloatingComment() {
  if (blastActive || calmActive) return;

  let v = (touchDragging || mouseDragging) ? smoothedScrollSpeed : abs(scrollVel);
  if (v < commentScrollThreshold) return;
  if (commentCooldown > 0) return;

  let now = millis();
  let intensity = getIntensity01();
  let tier = getEmotionTier();

  let interval = int(lerp(commentSpawnMillis, 78, intensity));

  if (now - lastCommentMillis >= interval) {
    let burstCount = 1;

    if (tier >= 3 && random(1) < 0.18) burstCount = 2;
    if (tier >= 4 && random(1) < 0.12) burstCount = max(burstCount, 2);
    if (tier >= 5 && random(1) < 0.10) burstCount = 3;

    for (let i = 0; i < burstCount; i++) {
      spawnCommentWithSound(tier);
    }

    lastCommentMillis = now;
    commentCooldown = (tier >= 4) ? 3 : 5;
  }
}

function getIntensity01() {
  return constrain(heat, 0, 1);
}

function getEmotionTier() {
  let h = getIntensity01();

  if (h < 0.18) return 0;
  if (h < 0.36) return 1;
  if (h < 0.54) return 2;
  if (h < 0.72) return 3;
  if (h < 0.88) return 4;
  return 5;
}

/* =========================
   Tier 6 blast/calm sequence
   ========================= */
function updateTier6SequenceState() {
  let dt = deltaTime;
  let tier = getEmotionTier();

  if (!blastActive && !calmActive) {
    if (tier === 5) {
      tier6HoldMs += dt;
    } else {
      tier6HoldMs = max(0, tier6HoldMs - dt * 2.5);
      if (tier6HoldMs <= 2000) tier6Exploded = false;
    }
  }

  if (!tier6Exploded && tier6HoldMs >= tier6HoldTargetMs) {
    triggerBombBlast();
  }

  if (blastActive) {
    let elapsed = millis() - blastStartMs;
    if (elapsed >= blastDurationMs) {
      blastActive = false;
      calmActive = true;
      calmStartMs = millis();
    }
  }

  if (calmActive) {
    let elapsed = millis() - calmStartMs;
    if (elapsed >= calmDurationMs) {
      calmActive = false;
      interactionLocked = false;
      tier6HoldMs = 0;
      tier6Exploded = false;
      explosionParticles = [];
      explosionHearts = [];
      smokeParticles = [];
    }
  }

  interactionLocked = blastActive || calmActive;
}

function getBlastProgress() {
  if (!blastActive) return 1;
  return constrain((millis() - blastStartMs) / blastDurationMs, 0, 1);
}

function getCalmProgress() {
  if (!calmActive) return 0;
  return constrain((millis() - calmStartMs) / calmDurationMs, 0, 1);
}

function triggerBombBlast() {
  tier6Exploded = true;
  blastActive = true;
  calmActive = false;
  interactionLocked = true;
  blastStartMs = millis();

  floatingComments = [];
  explosionParticles = [];
  explosionHearts = [];
  smokeParticles = [];

  let cx = width * 0.5;
  let cy = height * 0.56;

  for (let i = 0; i < 320; i++) {
    explosionParticles.push(new ExplosionParticle(cx, cy));
  }

  for (let i = 0; i < 72; i++) {
    explosionHearts.push(new ExplosionHeart(cx, cy));
  }

  for (let i = 0; i < 180; i++) {
    smokeParticles.push(new SmokeParticle(cx, cy));
  }

  for (let i = 0; i < 20; i++) {
    triggerScrollHeart();
  }
}


function drawBombFlash() {
  if (!blastActive && !calmActive) return;

  let blastP = blastActive ? getBlastProgress() : 1.0;
  let calmP = calmActive ? getCalmProgress() : 0.0;

  // fire fades out through late blast and early calm
  let fireAlpha =
    blastActive
      ? constrain(map(blastP, 0.0, 0.85, 1.0, 0.35), 0.35, 1.0)
      : constrain(map(calmP, 0.0, 0.35, 0.35, 0.0), 0.0, 0.35);

  if (fireAlpha <= 0.001) return;

  push();
  noStroke();

  // only do the hard flash during blast
  if (blastActive) {
    let whiteFlash = constrain(map(blastP, 0.0, 0.05, 1, 0), 0, 1);
    fill(255, 255 * whiteFlash);
    rect(0, 0, width, height);
  }

  let cx = width * 0.5;
  let cy = height * 0.52;

  let fireGrow = blastActive
    ? constrain(map(blastP, 0.00, 0.42, 0, 1), 0, 1)
    : lerp(1.0, 1.08, calmP);

  cy -= sy(50) * min(fireGrow, 1.0);

  drawFireCloudBlob(
    cx,
    cy + sy(8),
    width * (0.10 + 0.95 * fireGrow),
    height * (0.08 + 0.42 * fireGrow),
    color(120, 35, 10, 120 * fireAlpha),
    0.012,
    1.8,
    millis() * 0.0007
  );

  drawFireCloudBlob(
    cx,
    cy,
    width * (0.08 + 0.82 * fireGrow),
    height * (0.07 + 0.36 * fireGrow),
    color(255, 95, 20, 145 * fireAlpha),
    0.014,
    1.55,
    millis() * 0.0009
  );

  drawFireCloudBlob(
    cx,
    cy - sy(4),
    width * (0.06 + 0.68 * fireGrow),
    height * (0.055 + 0.29 * fireGrow),
    color(255, 150, 35, 170 * fireAlpha),
    0.016,
    1.35,
    millis() * 0.0012
  );

  drawFireCloudBlob(
    cx,
    cy - sy(10),
    width * (0.04 + 0.48 * fireGrow),
    height * (0.04 + 0.20 * fireGrow),
    color(255, 220, 90, 185 * fireAlpha),
    0.018,
    1.15,
    millis() * 0.0016
  );

  drawFireCloudBlob(
    cx,
    cy - sy(14),
    width * (0.025 + 0.26 * fireGrow),
    height * (0.025 + 0.11 * fireGrow),
    color(255, 250, 210, 165 * fireAlpha),
    0.021,
    0.95,
    millis() * 0.0020
  );

  drawFireCloudBlob(
    cx - sx(24) * min(fireGrow, 1.0),
    cy + sy(6) * min(fireGrow, 1.0),
    width * (0.02 + 0.18 * fireGrow),
    height * (0.03 + 0.15 * fireGrow),
    color(90, 25, 8, 75 * fireAlpha),
    0.020,
    0.80,
    millis() * 0.0014 + 12.3
  );

  drawFireCloudBlob(
    cx + sx(20) * min(fireGrow, 1.0),
    cy - sy(10) * min(fireGrow, 1.0),
    width * (0.02 + 0.16 * fireGrow),
    height * (0.02 + 0.12 * fireGrow),
    color(110, 30, 8, 62 * fireAlpha),
    0.022,
    0.75,
    millis() * 0.0018 + 27.1
  );

  pop();
}

function drawFireCloudBlob(cx, cy, rx, ry, col, noiseScale, jag, t) {
  push();
  translate(cx, cy);
  fill(col);
  noStroke();

  beginShape();

  let topBias = 1.22;   // makes the top puffier like your reference
  let bottomBias = 0.82;

  for (let a = 0; a <= TWO_PI + 0.08; a += 0.08) {
    let nx = cos(a);
    let ny = sin(a);

    let n1 = noise(
      100 + nx * rx * noiseScale + t,
      200 + ny * ry * noiseScale + t * 1.3
    );

    let n2 = noise(
      400 + nx * rx * noiseScale * 1.9 - t * 0.7,
      700 + ny * ry * noiseScale * 1.5 + t * 1.1
    );

    let turbulence = lerp(0.78, 1.28, 0.65 * n1 + 0.35 * n2);

    // puff the upper half outward
    let verticalShape = (ny < 0)
      ? lerp(1.0, topBias, -ny)
      : lerp(1.0, bottomBias, ny);

    // slight left-right asymmetry so it feels organic
    let sideWarp = 1.0 + 0.10 * sin(a * 3.0 + t * 4.0);

    let px = nx * rx * turbulence * jag * sideWarp;
    let py = ny * ry * turbulence * jag * verticalShape;

    vertex(px, py);
  }

  endShape(CLOSE);
  pop();
}

function drawHeatDistortion() {
  if (!blastActive) return;

  let p = getBlastProgress();
  let a = constrain(map(p, 0.0, 0.55, 1, 0), 0, 1);

  push();
  noFill();
  stroke(255, 200, 120, 20 * a);
  strokeWeight(smin(2));

  let t = millis() * 0.006;
  for (let j = 0; j < 8; j++) {
    beginShape();
    let yy = map(j, 0, 7, 0, height);
    for (let x = 0; x <= width; x += width / 26.0) {
      let warp = sin(t + x * 0.018 + j * 0.8) * sy(5) * a;
      vertex(x, yy + warp);
    }
    endShape();
  }

  pop();
}

function drawShockwaveRings() {
  if (!blastActive) return;

  let p = getBlastProgress();

  push();
  noFill();

  for (let i = 0; i < 3; i++) {
    let localP = constrain((p - i * 0.06) / (1.0 - i * 0.06), 0, 1);
    let r = width * (0.08 + localP * (0.65 + i * 0.22));
    let a = 200 * (1.0 - localP);

    stroke(255, 255, 255, a);
    strokeWeight(smin(14) * (1.0 - localP));
    ellipse(width * 0.5, height * 0.5, r, r);

    stroke(255, 180, 100, a * 0.65);
    strokeWeight(smin(5));
    ellipse(width * 0.5, height * 0.5, r * 1.08, r * 1.08);
  }

  pop();
}


function drawBlastGlitch() {
  if (!blastActive) return;

  let p = getBlastProgress();
  let glitchAmt = constrain(map(p, 0.0, 0.45, 1, 0), 0, 1);

  push();
  rectMode(CORNER);
  noStroke();

  for (let i = 0; i < 18; i++) {
    let y = random(height);
    let h = random(sy(6), sy(28));
    let dx = random(-sx(22), sx(22)) * glitchAmt;

    fill(255, 255, 255, random(18, 55) * glitchAmt);
    rect(dx, y, width, h);
  }

  blendMode(ADD);
  for (let i = 0; i < 10; i++) {
    let y = random(height);
    let h = random(sy(8), sy(22));

    fill(255, 60, 60, 26 * glitchAmt);
    rect(random(-sx(10), sx(10)), y, width, h);

    fill(80, 180, 255, 20 * glitchAmt);
    rect(random(-sx(14), sx(14)), y, width, h);
  }
  blendMode(BLEND);

  pop();
}

function drawSmokeCloudOverlay() {
  if (!blastActive) return;

  let p = getBlastProgress();
  let haze = constrain(map(p, 0.08, 1.0, 0, 1), 0, 1);

  push();
  noStroke();

  // warm residual glow instead of dark smoke circles
  fill(255, 140, 70, 38 * haze);
  ellipse(width * 0.5, height * 0.54, width * (0.24 + p * 0.92), width * (0.24 + p * 0.92));

  fill(255, 190, 120, 24 * haze);
  ellipse(width * 0.5, height * 0.50, width * (0.16 + p * 0.72), width * (0.16 + p * 0.72));

  pop();
}

function drawCalmOceanOverlay() {
  if (!calmActive) return;

  let p = getCalmProgress();

  // ocean appears immediately, but builds gently
  let oceanAlpha = constrain(map(p, 0.0, 0.45, 0.15, 1.0), 0.15, 1.0);

  push();
  noStroke();

  fill(105, 175, 240, 120 * oceanAlpha);
  rect(0, 0, width, height);

  fill(75, 145, 220, 90 * oceanAlpha);
  rect(0, 0, width, height);

  let t = millis() * 0.0009;

  for (let i = 0; i < 8; i++) {
    let yy = map(i, 0, 7, 0, height);
    let phase = t * (0.55 + i * 0.08) + i * 0.9;

    fill(160, 225, 255, (18 + i * 5) * oceanAlpha);
    beginShape();
    vertex(0, height);
    vertex(0, yy);

    for (let x = 0; x <= width; x += width / 22.0) {
      let wave =
        sin(phase + x * 0.008) * sy(14) +
        sin(phase * 1.4 + x * 0.014) * sy(8);
      vertex(x, yy + wave);
    }

    vertex(width, height);
    endShape(CLOSE);
  }

  stroke(255, 255, 255, 55 * oceanAlpha);
  strokeWeight(smin(2));
  noFill();

  for (let j = 0; j < 5; j++) {
    let yy = height * (0.22 + j * 0.10);
    beginShape();
    for (let x = 0; x <= width; x += width / 28.0) {
      let wave =
        sin(t * 1.8 + j + x * 0.012) * sy(5) +
        cos(t * 1.1 + j * 0.5 + x * 0.008) * sy(4);
      vertex(x, yy + wave);
    }
    endShape();
  }

  fill(220, 245, 255, 45 * oceanAlpha);
  noStroke();
  ellipse(width * 0.5, height * 0.58, width * 0.9, width * 0.9);

  fill(255, 255, 255, 120 * constrain(map(p, 0.86, 1.0, 0, 1), 0, 1));
  rect(0, 0, width, height);

  pop();
}

function pick(arr) {
  return arr[int(random(arr.length))];
}

function maybeEmoji(chance) {
  return (random(1) < chance) ? " " + pick(EMOJIS) : "";
}

// ---------- Rewritten comment builder ----------
function buildTieredComment(tier) {
  tier = constrain(tier, 0, 5);

  let core = pick(CORE_TIERS[tier]);
  let style = pick(STYLE_TIERS[tier]);
  let emotion = pick(EMOTION_TIERS[tier]);
  let intensifier = pick(INTENSIFIERS);

  let r = random(1);

  if (tier === 0) {
    if (r < 0.35) {
      return { text: core + maybeEmoji(0.18), soundKey: core, group: "core" };
    }
    if (r < 0.65) {
      return { text: style + maybeEmoji(0.12), soundKey: style, group: "style" };
    }
    if (r < 0.88) {
      return { text: emotion + maybeEmoji(0.20), soundKey: emotion, group: "emotion" };
    }
    return { text: intensifier + " " + core + maybeEmoji(0.18), soundKey: core, group: "core" };
  }

  if (tier === 1) {
    if (r < 0.28) {
      return { text: intensifier + " " + core + maybeEmoji(0.24), soundKey: core, group: "core" };
    }
    if (r < 0.56) {
      return { text: core + "... " + style + maybeEmoji(0.22), soundKey: style, group: "style" };
    }
    if (r < 0.82) {
      return { text: emotion + maybeEmoji(0.28), soundKey: emotion, group: "emotion" };
    }
    return { text: style + " — " + core + maybeEmoji(0.22), soundKey: style, group: "style" };
  }

  if (tier === 2) {
    if (r < 0.25) {
      return { text: intensifier + " " + core + maybeEmoji(0.34), soundKey: core, group: "core" };
    }
    if (r < 0.50) {
      return { text: core + "... " + style + maybeEmoji(0.34), soundKey: style, group: "style" };
    }
    if (r < 0.75) {
      return { text: emotion + ", " + core + maybeEmoji(0.38), soundKey: emotion, group: "emotion" };
    }
    return { text: style + maybeEmoji(0.34), soundKey: style, group: "style" };
  }

  if (tier === 3) {
    if (r < 0.24) {
      return { text: intensifier + " " + core + maybeEmoji(0.46), soundKey: core, group: "core" };
    }
    if (r < 0.49) {
      return { text: core + "... " + style + maybeEmoji(0.46), soundKey: style, group: "style" };
    }
    if (r < 0.74) {
      return { text: emotion + ", " + core + maybeEmoji(0.50), soundKey: emotion, group: "emotion" };
    }
    return { text: intensifier + " " + emotion + maybeEmoji(0.46), soundKey: emotion, group: "emotion" };
  }

  if (tier === 4) {
    if (r < 0.24) {
      return { text: intensifier + " " + core + maybeEmoji(0.58), soundKey: core, group: "core" };
    }
    if (r < 0.48) {
      return { text: core + "... " + style + maybeEmoji(0.58), soundKey: style, group: "style" };
    }
    if (r < 0.72) {
      return { text: emotion + ", " + core + maybeEmoji(0.62), soundKey: emotion, group: "emotion" };
    }
    return { text: style + " — " + emotion + maybeEmoji(0.58), soundKey: style, group: "style" };
  }

  if (r < 0.25) {
    return { text: intensifier + " " + core + maybeEmoji(0.72), soundKey: core, group: "core" };
  }
  if (r < 0.50) {
    return { text: core + "... " + style + maybeEmoji(0.72), soundKey: style, group: "style" };
  }
  if (r < 0.75) {
    return { text: emotion + ", " + core + maybeEmoji(0.76), soundKey: emotion, group: "emotion" };
  }
  return { text: intensifier + " " + emotion + maybeEmoji(0.72), soundKey: emotion, group: "emotion" };
}

/* =========================
   Big heart animation
   ========================= */
class BigHeart {
  constructor(postIdx, wx, wy, target) {
    this.postIdx = postIdx;
    this.start = createVector(wx, wy);
    this.target = target.copy();
    this.frame = 0;

    this.popDur = 14;
    this.tiltDur = 10;
    this.flyDur = 22;
    this.totalDur = this.popDur + this.tiltDur + this.flyDur;

    this.snapTriggered = false;
  }

  update(ts = 1.0) {
    this.frame += ts;
  }

  render() {
    let tAll = this.frame / this.totalDur;

    let a = 255;
    if (tAll > 0.72) a = map(tAll, 0.72, 1.0, 255, 0);

    let basePx = smin(145);
    let s = 1.0;
    let rot = 0;
    let pos = this.start.copy();

    if (this.frame <= this.popDur) {
      let p = this.frame / this.popDur;
      if (p < 0.55) s = lerp(0.18, 1.08, easeOutCubic(p / 0.55));
      else s = lerp(1.08, 1.00, easeOutCubic((p - 0.55) / 0.45));
      rot = radians(2.0) * sin(p * PI);
    } else if (this.frame <= this.popDur + this.tiltDur) {
      let p = (this.frame - this.popDur) / this.tiltDur;
      rot = lerp(radians(-14), radians(-6), easeOutCubic(p));
    } else {
      let p = constrain((this.frame - this.popDur - this.tiltDur) / this.flyDur, 0, 1);

      let cp = createVector(
        lerp(this.start.x, this.target.x, 0.55) - sx(70),
        lerp(this.start.y, this.target.y, 0.55) + sy(110)
      );

      pos = quadBezier(this.start, cp, this.target, easeInOutCubic(p));
      s = lerp(1.0, 0.26, easeInOutCubic(p));
      rot = lerp(radians(-6), radians(-26), easeInOutCubic(p));

      if (!this.snapTriggered && p >= 0.985) this.snapTriggered = true;
    }

    push();
    translate(pos.x, pos.y);
    rotate(rot);

    this.renderBloom(basePx * s, a, tAll);
    this.renderHeart(basePx * s, a);

    pop();
  }

  renderBloom(sizePx, a, tAll) {
    let bloom = (tAll < 0.22)
      ? easeOutCubic(tAll / 0.22)
      : (1.0 - easeOutCubic((tAll - 0.22) / 0.78));
    bloom = max(0, bloom);

    noStroke();
    fill(255, 45, 85, a * 0.10 * bloom);
    drawHeartShape(0, 0, sizePx * 1.18);

    fill(255, 160, 90, a * 0.04 * bloom);
    drawHeartShape(0, 0, sizePx * 1.34);
  }

  renderHeart(sizePx, a) {
    noStroke();

    fill(255, 160, 90, a * 0.55);
    drawHeartShape(0, 0, sizePx * 1.03);

    fill(255, 95, 135, a * 0.90);
    drawHeartShape(0, 0, sizePx * 0.96);

    fill(255, 45, 85, a);
    drawHeartShape(0, 0, sizePx * 0.88);

    fill(255, 210, 220, a * 0.25);
    drawHeartShape(-sizePx * 0.06, -sizePx * 0.10, sizePx * 0.34);
  }

  dead() {
    return this.frame >= this.totalDur;
  }
}

/* =========================
   Floating comment
   ========================= */
class FloatingComment {
  constructor(txt, tier) {
    this.txt = txt;
    this.tier = tier;

    let spread = map(tier, 0, 5, width * 0.22, width * 0.10);

    this.pos = createVector(
      width * 0.5 + random(-spread, spread),
      random(height * 0.62, height * 0.84)
    );

    this.vel = createVector(
      random(-0.12, 0.12),
      random(-0.85 - 0.10 * tier, -1.35 - 0.16 * tier)
    );

    this.life = 0;
    this.lifeMax = random(86 + tier * 6, 126 + tier * 10);
    this.alpha = 0;
    this.txtSize = random(smin(24 + tier * 1.5), smin(34 + tier * 2.8));
    this.drift = random(TWO_PI);
  }

  update(ts = 1.0) {
    this.life += ts;
    this.pos.add(p5.Vector.mult(this.vel, ts));
    this.pos.x += sin(this.drift + this.life * 0.045) * 0.32;

    let p = this.life / this.lifeMax;

    if (p < 0.12) this.alpha = map(p, 0, 0.12, 0, 255);
    else if (p > 0.74) this.alpha = map(p, 0.74, 1.0, 255, 0);
    else this.alpha = 255;
  }

  render() {
    push();
    textAlign(CENTER, CENTER);
    textSize(this.txtSize);

    fill(255, 160);
    text(this.txt, this.pos.x - 1, this.pos.y - 1);

    fill(0, this.alpha * 0.18);
    text(this.txt, this.pos.x + 3, this.pos.y + 3);

    fill(255, 140, 180, this.alpha * 0.26);
    text(this.txt, this.pos.x + 1, this.pos.y + 1);

    fill(20, this.alpha);
    text(this.txt, this.pos.x, this.pos.y);
    pop();
  }

  dead() {
    return this.life >= this.lifeMax;
  }
}

/* =========================
   Sparkle particle
   ========================= */
class Particle {
  constructor() {
    this.pos = createVector(0, 0);
    this.vel = createVector(0, 0);
    this.life = 0;
    this.lifeMax = 0;
    this.alpha = 255;
  }

  dead() {
    return this.life >= this.lifeMax;
  }
}

class SparkleDot extends Particle {
  constructor(wx, wy) {
    super();
    this.pos = createVector(wx, wy);

    let ang = radians(random(-112, -68));
    let sp = random(smin(2.4), smin(6.0));
    this.vel = createVector(cos(ang), sin(ang)).mult(sp);

    this.pos.x += random(-smin(8), smin(8));
    this.pos.y += random(-smin(8), smin(8));

    this.lifeMax = random(26, 44);
    this.r0 = random(smin(2.0), smin(4.6));
    this.r = this.r0;

    this.twinkleFreq = random(0.18, 0.34);
    this.phase = random(TWO_PI);
    this.white = random(1) < 0.78;
  }

  update(ts = 1.0) {
    this.life += ts;
    this.pos.add(p5.Vector.mult(this.vel, ts));
    this.vel.mult(pow(0.992, ts));
    this.vel.y -= 0.010 * ts;

    let p = this.life / this.lifeMax;
    let tw = 0.55 + 0.45 * sin(this.phase + this.life * this.twinkleFreq * TWO_PI);
    this.r = this.r0 * (0.85 + 0.45 * tw);
    this.alpha = (p > 0.30) ? map(p, 0.30, 1.0, 210, 0) : 210;
  }

  render() {
    noStroke();
    if (this.white) fill(0, this.alpha * 0.35);
    else fill(255, 45, 85, this.alpha * 0.25);

    ellipse(this.pos.x, this.pos.y, this.r * 2.0, this.r * 2.0);
    fill(0, this.alpha * 0.10);
    ellipse(this.pos.x, this.pos.y, this.r * 4.2, this.r * 4.2);
  }
}

/* =========================
   Explosion particles
   ========================= */
class ExplosionParticle {
  constructor(x, y) {
    this.pos = createVector(x, y);

    let ang = random(TWO_PI);
    let sp = random(smin(6), smin(28));
    this.vel = p5.Vector.fromAngle(ang).mult(sp);

    this.life = 0;
    this.lifeMax = random(28, 64);
    this.alpha = 255;
    this.r = random(smin(3), smin(10));
    this.kind = random(1) < 0.55 ? 0 : 1;
    this.rot = random(TWO_PI);
    this.rotVel = random(-0.2, 0.2);
  }

  update(ts = 1.0) {
    this.life += ts;

    if (this.life < 8) {
      this.vel.mult(1.08);
    }

    this.pos.add(p5.Vector.mult(this.vel, ts));
    this.vel.mult(pow(0.965, ts));
    this.vel.y += 0.06 * ts;
    this.rot += this.rotVel * ts;

    let p = this.life / this.lifeMax;
    this.alpha = (p < 0.7) ? 255 : map(p, 0.7, 1.0, 255, 0);
  }

  render() {
    push();
    translate(this.pos.x, this.pos.y);
    rotate(this.rot);
    noStroke();
  
    if (this.kind === 0) {
      fill(255, 245, 180, this.alpha);
      ellipse(0, 0, this.r * 1.0, this.r * 1.0);
  
      fill(255, 175, 50, this.alpha * 0.9);
      ellipse(0, 0, this.r * 2.0, this.r * 2.0);
  
      fill(255, 80, 20, this.alpha * 0.35);
      ellipse(0, 0, this.r * 3.8, this.r * 3.8);
    } else {
      fill(255, 220, 120, this.alpha);
      rectMode(CENTER);
      rect(0, 0, this.r * 2.6, this.r * 0.42, this.r * 0.08);
  
      fill(255, 100, 30, this.alpha * 0.55);
      rect(0, 0, this.r * 4.2, this.r * 0.16, this.r * 0.04);
    }
  
    pop();
  }
  dead() {
    return this.life >= this.lifeMax;
  }
}

class ExplosionHeart {
  constructor(x, y) {
    this.pos = createVector(x, y);

    let ang = random(TWO_PI);
    let sp = random(smin(8), smin(26));
    this.vel = p5.Vector.fromAngle(ang).mult(sp);

    this.life = 0;
    this.lifeMax = random(42, 90);
    this.alpha = 255;
    this.size = random(smin(26), smin(72));
    this.rot = random(TWO_PI);
    this.rotVel = random(-0.12, 0.12);
  }

  update(ts = 1.0) {
    this.life += ts;

    if (this.life < 10) {
      this.vel.mult(1.05);
    }

    this.pos.add(p5.Vector.mult(this.vel, ts));
    this.vel.mult(pow(0.97, ts));
    this.vel.y += 0.04 * ts;
    this.rot += this.rotVel * ts;

    let p = this.life / this.lifeMax;
    this.alpha = (p < 0.65) ? 255 : map(p, 0.65, 1.0, 255, 0);
  }

  render() {
    push();
    translate(this.pos.x, this.pos.y);
    rotate(this.rot);
    noStroke();

    fill(255, 180, 210, this.alpha * 0.25);
    drawHeartShape(0, 0, this.size * 1.2);

    fill(255, 95, 145, this.alpha * 0.9);
    drawHeartShape(0, 0, this.size);

    fill(255, 45, 85, this.alpha);
    drawHeartShape(0, 0, this.size * 0.82);

    pop();
  }

  dead() {
    return this.life >= this.lifeMax;
  }
}

class SmokeParticle {
  constructor(x, y) {
    this.pos = createVector(
      x + random(-smin(30), smin(30)),
      y + random(-smin(30), smin(30))
    );

    let ang = random(TWO_PI);
    let sp = random(smin(1.5), smin(10));
    this.vel = p5.Vector.fromAngle(ang).mult(sp);

    this.life = 0;
    this.lifeMax = random(80, 180);
    this.alphaBase = random(80, 180);
    this.alpha = this.alphaBase;
    this.r = random(smin(20), smin(90));
  }

  update(ts = 1.0) {
    this.life += ts;
    this.pos.add(p5.Vector.mult(this.vel, ts));
    this.vel.mult(pow(0.985, ts));
    this.vel.y -= 0.01 * ts;

    let p = this.life / this.lifeMax;
    this.alpha = (p < 0.65) ? this.alphaBase : map(p, 0.65, 1.0, this.alphaBase, 0);
  }

  render() {
    push();
    noStroke();
    fill(55, 55, 65, this.alpha * 0.6);
    ellipse(this.pos.x, this.pos.y, this.r, this.r);

    fill(100, 100, 110, this.alpha * 0.25);
    ellipse(this.pos.x, this.pos.y, this.r * 1.5, this.r * 1.5);
    pop();
  }

  dead() {
    return this.life >= this.lifeMax;
  }
}

/* =========================
   Heart shape / math
   ========================= */
function drawHeartShape(x, y, sizePx) {
  beginShape();
  for (let a = 0; a < TWO_PI; a += 0.08) {
    let px = 16 * pow(sin(a), 3);
    let py = -(13 * cos(a) - 5 * cos(2 * a) - 2 * cos(3 * a) - cos(4 * a));

    px *= sizePx / 22.0;
    py *= sizePx / 22.0;
    vertex(x + px, y + py);
  }
  endShape(CLOSE);
}

function quadBezier(a, b, c, t) {
  let u = 1 - t;
  return createVector(
    u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    u * u * a.y + 2 * u * t * b.y + t * t * c.y
  );
}

function easeOutCubic(t) {
  t = constrain(t, 0, 1);
  return 1 - pow(1 - t, 3);
}

function easeInOutCubic(t) {
  t = constrain(t, 0, 1);
  return (t < 0.5) ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2;
}
