/* ============================================================
   CYBER COMMAND CENTER — main.js
   Three.js 3D globe with real-time attack visualization.
   WebSocket client connects to the Node.js backend.
   ============================================================ */

'use strict';

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const CONFIG = {
  WS_URL:             'ws://localhost:4000',
  GLOBE_RADIUS:       1.5,
  ARC_SEGMENTS:       120,
  ARC_DRAW_SPEED:     1.8,
  ATTACK_LIFETIME:    9,
  FADE_DURATION:      2.0,
  MAX_LOG_ENTRIES:    20,
  // Risk score tuning
  RISK_DECAY_RATE:    1.8,   // points drained per second
  BURST_WINDOW_MS:    8000,  // ms window to detect attack bursts
  BURST_THRESHOLD:    4,     // attacks in window = burst bonus
  BURST_BONUS:        12,    // extra risk added on burst
  HIGH_CLUSTER_MS:    10000, // ms window for HIGH threat clustering
  HIGH_CLUSTER_BONUS: 8,     // extra risk per consecutive HIGH in window
  // Clustering
  CLUSTER_WINDOW_MS:  12000, // ms window to count same-country attacks
  CLUSTER_THRESHOLD:  3,     // attacks from same country = cluster
};

// Threat level → Three.js hex color
const THREAT_HEX = { LOW: 0x00ff88, MEDIUM: 0xffcc00, HIGH: 0xff2244 };

// Threat level → CSS color string (for UI)
const THREAT_CSS = { LOW: '#00ff88', MEDIUM: '#ffcc00', HIGH: '#ff2244' };

// Country name → [latitude, longitude]
const COUNTRY_COORDS = {
  'Russia':         [ 55.75,   37.61 ],
  'China':          [ 39.91,  116.39 ],
  'North Korea':    [ 39.02,  125.75 ],
  'Iran':           [ 35.69,   51.39 ],
  'United States':  [ 38.89,  -77.03 ],
  'Brazil':         [-15.78,  -47.93 ],
  'Germany':        [ 52.52,   13.40 ],
  'India':          [ 28.61,   77.21 ],
  'Nigeria':        [  9.07,    7.40 ],
  'Ukraine':        [ 50.45,   30.52 ],
};

// ─────────────────────────────────────────────────────────────
// SCENE STATE
// ─────────────────────────────────────────────────────────────

let scene, camera, renderer, controls;
let globe;
let serverNode;
let serverNodeGlow;
let activeAttacks = [];
let logEntries    = [];

// Stored lighting refs — mutated by crisis mode
let ambientLight, keyLight, rimLight;

// Stats counters
const stats = { total: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };

// Risk score (0–100), decays over time
let riskScore = 0;

// Crisis mode state
let isCrisisMode = false;

// ── Burst detection: sliding window of recent attack timestamps ──
const recentAttackTimes = [];    // timestamps (ms) of last N attacks

// ── HIGH threat clustering: timestamps of recent HIGH events ────
const recentHighTimes = [];

// ── Country clustering: Map<country, timestamp[]> ───────────────
const countryCluster = new Map();

// ─────────────────────────────────────────────────────────────
// COORDINATE HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Convert geographic lat/lon → Three.js Vector3 on a sphere of radius r.
 * Standard spherical-to-Cartesian with Three.js Y-up convention.
 */
function latLonToVec3(lat, lon, r) {
  const phi   = (90 - lat) * (Math.PI / 180);   // polar angle from Y-axis
  const theta = (lon + 180) * (Math.PI / 180);  // azimuthal angle
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),   // X
     r * Math.cos(phi),                     // Y
     r * Math.sin(phi) * Math.sin(theta)    // Z
  );
}

// ─────────────────────────────────────────────────────────────
// SCENE SETUP
// ─────────────────────────────────────────────────────────────

function setupScene() {
  // --- Scene ---
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000510);
  scene.fog = new THREE.FogExp2(0x000510, 0.06);

  // --- Camera ---
  camera = new THREE.PerspectiveCamera(
    60,                                         // FOV
    window.innerWidth / window.innerHeight,     // aspect
    0.1,                                        // near
    500                                         // far
  );
  camera.position.set(0, 0.8, 4.8);

  // --- Renderer ---
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  // --- Orbit Controls ---
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping    = true;
  controls.dampingFactor    = 0.05;
  controls.enablePan        = false;
  controls.minDistance      = 2.5;
  controls.maxDistance      = 9;
  controls.autoRotate       = true;
  controls.autoRotateSpeed  = 0.25;

  // --- Lighting ---
  // Soft ambient fill
  ambientLight = new THREE.AmbientLight(0x112244, 1.0);
  scene.add(ambientLight);

  // Key light from upper-right (simulates distant sun)
  keyLight = new THREE.DirectionalLight(0x6699ff, 0.8);
  keyLight.position.set(6, 4, 5);
  scene.add(keyLight);

  // Rim light from the left (cyan tint for atmosphere feel)
  rimLight = new THREE.DirectionalLight(0x00e5ff, 0.25);
  rimLight.position.set(-5, 0, -4);
  scene.add(rimLight);

  // Under light — subtle warm accent from below
  const underLight = new THREE.DirectionalLight(0x003355, 0.3);
  underLight.position.set(0, -5, 0);
  scene.add(underLight);

  // --- Resize Handler ---
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ─────────────────────────────────────────────────────────────
// GLOBE
// ─────────────────────────────────────────────────────────────

/**
 * Build a canvas texture with a dark ocean base and a lat/lon grid.
 * Gives the "holographic globe" look without needing an external texture.
 */
function createGlobeTexture() {
  const W = 2048, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Deep ocean base — radial gradient adds curvature illusion
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.35, W * 0.6);
  bg.addColorStop(0,   '#071e38');
  bg.addColorStop(0.6, '#041428');
  bg.addColorStop(1,   '#020a18');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Fine 10° grid
  ctx.strokeStyle = '#09273d';
  ctx.lineWidth   = 0.8;
  for (let lon = -180; lon <= 180; lon += 10) {
    const x = (lon + 180) / 360 * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let lat = -90; lat <= 90; lat += 10) {
    const y = (90 - lat) / 180 * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Bold 30° grid overlay
  ctx.strokeStyle = '#0d3f60';
  ctx.lineWidth   = 1.2;
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = (lon + 180) / 360 * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let lat = -90; lat <= 90; lat += 30) {
    const y = (90 - lat) / 180 * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Equator highlight
  ctx.strokeStyle = '#165a80';
  ctx.lineWidth   = 1.8;
  const eqY = H * 0.5;
  ctx.beginPath(); ctx.moveTo(0, eqY); ctx.lineTo(W, eqY); ctx.stroke();

  // Prime meridian highlight
  ctx.strokeStyle = '#0e4d6e';
  ctx.lineWidth   = 1.8;
  const pmX = W * 0.5;
  ctx.beginPath(); ctx.moveTo(pmX, 0); ctx.lineTo(pmX, H); ctx.stroke();

  // Subtle coastal dots — approximate continent positions
  ctx.fillStyle = '#0e3d5a';
  const dots = [
    // North America
    [38, -100],[48, -100],[28,-98],[60,-120],[50,-75],
    // Europe
    [52, 10],[48, 2],[54, 18],[40, 25],[55, 38],
    // Asia
    [35, 110],[50, 90],[25, 80],[60, 60],[40, 140],[35, 137],
    // Africa
    [0, 25],[10, 25],[20, 30],[-5, 25],[-25, 25],
    // South America
    [-15, -55],[0, -50],[5, -55],[-30,-65],[-10,-40],
    // Australia
    [-25, 135],[-30, 120],[-35, 150],
    // Antarctica hint
    [-70, 0],[-70, 90],[-70,-90],[-70, 180],
  ];
  for (const [lat, lon] of dots) {
    const dx = (lon + 180) / 360 * W;
    const dy = (90 - lat) / 180 * H;
    ctx.beginPath();
    ctx.arc(dx, dy, 1.5 + Math.random() * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  return new THREE.CanvasTexture(canvas);
}

function createGlobe() {
  const R = CONFIG.GLOBE_RADIUS;

  // Core sphere
  const geoSphere = new THREE.SphereGeometry(R, 72, 72);
  const matSphere = new THREE.MeshPhongMaterial({
    map:                createGlobeTexture(),
    emissive:           new THREE.Color(0x051830),
    emissiveIntensity:  0.6,
    shininess:          15,
    specular:           new THREE.Color(0x0077aa),
  });
  globe = new THREE.Mesh(geoSphere, matSphere);
  scene.add(globe);

  // Thin atmosphere shell — BackSide creates a soft edge glow
  const atmGeo = new THREE.SphereGeometry(R * 1.06, 32, 32);
  const atmMat = new THREE.MeshPhongMaterial({
    color:       0x1188cc,
    transparent: true,
    opacity:     0.10,
    side:        THREE.BackSide,
    depthWrite:  false,
  });
  scene.add(new THREE.Mesh(atmGeo, atmMat));

  // Outer halo (very faint) — adds the "deep space" look
  const haloGeo = new THREE.SphereGeometry(R * 1.18, 32, 32);
  const haloMat = new THREE.MeshBasicMaterial({
    color:       0x005577,
    transparent: true,
    opacity:     0.025,
    side:        THREE.BackSide,
    depthWrite:  false,
  });
  scene.add(new THREE.Mesh(haloGeo, haloMat));

  // Equator ring
  const ringGeo = new THREE.TorusGeometry(R * 1.01, 0.003, 8, 180);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x1a6a8a, transparent: true, opacity: 0.5 });
  scene.add(new THREE.Mesh(ringGeo, ringMat));
}

// ─────────────────────────────────────────────────────────────
// SERVER NODE (the attack target floating above the globe)
// ─────────────────────────────────────────────────────────────

// All attack arcs converge on this point
const SERVER_POS = new THREE.Vector3(0, 2.4, 0);

function createServerNode() {
  // Rotating octahedron wireframe
  const geo  = new THREE.OctahedronGeometry(0.10, 0);
  const mat  = new THREE.MeshBasicMaterial({ color: 0x00e5ff, wireframe: true });
  serverNode = new THREE.Mesh(geo, mat);
  serverNode.position.copy(SERVER_POS);
  scene.add(serverNode);

  // Pulsing glow ball
  const glowGeo  = new THREE.SphereGeometry(0.16, 16, 16);
  const glowMat  = new THREE.MeshBasicMaterial({
    color:       0x00e5ff,
    transparent: true,
    opacity:     0.12,
    depthWrite:  false,
  });
  serverNodeGlow = new THREE.Mesh(glowGeo, glowMat);
  serverNodeGlow.position.copy(SERVER_POS);
  scene.add(serverNodeGlow);

  // Horizontal ring below the node (landing pad look)
  const padGeo = new THREE.TorusGeometry(0.25, 0.003, 6, 64);
  const padMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.3 });
  const pad    = new THREE.Mesh(padGeo, padMat);
  pad.position.copy(SERVER_POS);
  pad.rotation.x = Math.PI / 2;
  scene.add(pad);

  // Vertical connector line from server down to globe north pole
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, CONFIG.GLOBE_RADIUS, 0),
    SERVER_POS,
  ]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.2 });
  scene.add(new THREE.Line(lineGeo, lineMat));
}

// ─────────────────────────────────────────────────────────────
// STARFIELD
// ─────────────────────────────────────────────────────────────

function createStarfield() {
  const COUNT     = 4000;
  const positions = new Float32Array(COUNT * 3);
  const sizes     = new Float32Array(COUNT);

  for (let i = 0; i < COUNT; i++) {
    const r     = 60 + Math.random() * 140;
    const phi   = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    sizes[i] = 0.04 + Math.random() * 0.12;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color:       0xaaccff,
    size:        0.07,
    transparent: true,
    opacity:     0.65,
    sizeAttenuation: true,
  });

  scene.add(new THREE.Points(geo, mat));
}

// ─────────────────────────────────────────────────────────────
// ATTACK VISUALIZATION
// ─────────────────────────────────────────────────────────────

/**
 * Returns how many attacks have come from `country` within CLUSTER_WINDOW_MS.
 * Prunes stale entries as a side-effect.
 */
function getClusterCount(country) {
  const now   = Date.now();
  const times = countryCluster.get(country) || [];
  const fresh = times.filter(t => now - t < CONFIG.CLUSTER_WINDOW_MS);
  countryCluster.set(country, fresh);
  return fresh.length;
}

/**
 * Record a new attack timestamp for `country` in the cluster map.
 */
function recordCluster(country) {
  const times = countryCluster.get(country) || [];
  times.push(Date.now());
  countryCluster.set(country, times);
}

/**
 * Create and add a full attack object (marker + ring + arc line) to the scene.
 * Marker size and halo intensity scale with country cluster count.
 * @param {Object} data – attack payload from WebSocket
 */
function spawnAttack(data) {
  const coords = COUNTRY_COORDS[data.country];
  if (!coords) return;

  const [lat, lon] = coords;
  const color3     = new THREE.Color(THREAT_HEX[data.threatLevel] || 0xffffff);
  const origin     = latLonToVec3(lat, lon, CONFIG.GLOBE_RADIUS);

  // ── Cluster scaling ──────────────────────────────────────
  const clusterCount = getClusterCount(data.country);
  // Scale marker and halo up with cluster intensity (caps at 3×)
  const clusterScale  = 1 + Math.min(clusterCount, 5) * 0.35;
  const haloOpacity   = Math.min(0.90, 0.45 + clusterCount * 0.1);

  // In crisis mode, further emphasize HIGH, fade LOW
  let arcOpacity = 0.80;
  if (isCrisisMode) {
    if (data.threatLevel === 'HIGH')   arcOpacity = 1.0;
    if (data.threatLevel === 'LOW')    arcOpacity = 0.25;
    if (data.threatLevel === 'MEDIUM') arcOpacity = 0.55;
  }

  // ── Marker sphere ────────────────────────────────────────
  const markerRadius = 0.028 * clusterScale;
  const markerGeo    = new THREE.SphereGeometry(markerRadius, 8, 8);
  const markerMat    = new THREE.MeshBasicMaterial({ color: color3 });
  const marker       = new THREE.Mesh(markerGeo, markerMat);
  marker.position.copy(origin);
  scene.add(marker);

  // ── Pulsing halo ring ────────────────────────────────────
  const haloInner = 0.045 * clusterScale;
  const haloOuter = 0.075 * clusterScale;
  const haloGeo   = new THREE.RingGeometry(haloInner, haloOuter, 20);
  const haloMat   = new THREE.MeshBasicMaterial({
    color:       color3,
    transparent: true,
    opacity:     haloOpacity,
    side:        THREE.DoubleSide,
    depthWrite:  false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.copy(origin);
  halo.lookAt(new THREE.Vector3(0, 0, 0));
  scene.add(halo);

  // ── Attack arc ───────────────────────────────────────────
  const midpoint  = new THREE.Vector3().addVectors(origin, SERVER_POS).multiplyScalar(0.5);
  const controlPt = midpoint.clone().normalize().multiplyScalar(CONFIG.GLOBE_RADIUS * 2.8);
  const curve     = new THREE.QuadraticBezierCurve3(origin, controlPt, SERVER_POS);
  const points    = curve.getPoints(CONFIG.ARC_SEGMENTS);

  const arcGeo = new THREE.BufferGeometry().setFromPoints(points);
  arcGeo.setDrawRange(0, 0);

  const arcMat = new THREE.LineBasicMaterial({
    color:       color3,
    transparent: true,
    opacity:     arcOpacity,
    depthWrite:  false,
  });
  const arc = new THREE.Line(arcGeo, arcMat);
  scene.add(arc);

  // ── Impact ring ──────────────────────────────────────────
  const impactGeo = new THREE.RingGeometry(0.01, 0.02, 20);
  const impactMat = new THREE.MeshBasicMaterial({
    color:       color3,
    transparent: true,
    opacity:     0.0,
    side:        THREE.DoubleSide,
    depthWrite:  false,
  });
  const impact = new THREE.Mesh(impactGeo, impactMat);
  impact.position.copy(SERVER_POS);
  scene.add(impact);

  activeAttacks.push({
    marker, halo, arc, impact,
    age:           0,
    drawProgress:  0,
    arcFullyDrawn: false,
    maxAge:        CONFIG.ATTACK_LIFETIME,
    baseArcOpacity: arcOpacity,
    data,
  });
}

// ─────────────────────────────────────────────────────────────
// WEBSOCKET CONNECTION
// ─────────────────────────────────────────────────────────────

function connectWebSocket() {
  const statusEl = document.getElementById('ws-status');
  let   ws;

  function connect() {
    ws = new WebSocket(CONFIG.WS_URL);

    ws.onopen = () => {
      statusEl.textContent = '● LIVE';
      statusEl.className   = 'status-live';
      console.log('[WS] Connected to Cyber Command Center');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'ATTACK') {
          onAttackReceived(msg.data);
        }
      } catch (e) {
        console.warn('[WS] Failed to parse message:', e);
      }
    };

    ws.onclose = () => {
      statusEl.textContent = '● RECONNECTING...';
      statusEl.className   = 'status-reconnect';
      console.log('[WS] Disconnected — retrying in 3s…');
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      statusEl.textContent = '● OFFLINE';
      statusEl.className   = 'status-offline';
    };
  }

  connect();
}

/**
 * Central handler for each incoming attack event.
 * Computes risk score with burst detection and HIGH clustering,
 * then updates all 3D and UI state.
 */
function onAttackReceived(data) {
  const now = Date.now();

  // ── Counter update ───────────────────────────────────────
  stats.total++;
  stats[data.threatLevel] = (stats[data.threatLevel] || 0) + 1;

  // ── Cluster tracking ─────────────────────────────────────
  recordCluster(data.country);

  // ── Burst detection: prune stale, then check window ──────
  recentAttackTimes.push(now);
  // Remove timestamps outside the burst window
  while (recentAttackTimes.length && now - recentAttackTimes[0] > CONFIG.BURST_WINDOW_MS) {
    recentAttackTimes.shift();
  }
  const isBurst = recentAttackTimes.length >= CONFIG.BURST_THRESHOLD;

  // ── HIGH clustering bonus ─────────────────────────────────
  let highClusterBonus = 0;
  if (data.threatLevel === 'HIGH') {
    recentHighTimes.push(now);
    while (recentHighTimes.length && now - recentHighTimes[0] > CONFIG.HIGH_CLUSTER_MS) {
      recentHighTimes.shift();
    }
    // Every HIGH beyond the first in the window adds a bonus
    if (recentHighTimes.length > 1) {
      highClusterBonus = (recentHighTimes.length - 1) * CONFIG.HIGH_CLUSTER_BONUS;
    }
  }

  // ── Risk score calculation ────────────────────────────────
  const baseBump  = data.threatLevel === 'HIGH' ? 14 : data.threatLevel === 'MEDIUM' ? 6 : 2;
  const burstBump = isBurst ? CONFIG.BURST_BONUS : 0;
  riskScore = Math.min(100, riskScore + baseBump + burstBump + highClusterBonus);

  // ── Spawn 3D visual ───────────────────────────────────────
  spawnAttack(data);

  // ── UI refresh ────────────────────────────────────────────
  updateCounters();
  updateAttackLog(data);
  updateBottomBar(data);
}

// ─────────────────────────────────────────────────────────────
// UI UPDATES
// ─────────────────────────────────────────────────────────────

function updateCounters() {
  document.getElementById('count-total').textContent  = stats.total;
  document.getElementById('count-high').textContent   = stats.HIGH   || 0;
  document.getElementById('count-medium').textContent = stats.MEDIUM || 0;
  document.getElementById('count-low').textContent    = stats.LOW    || 0;
}

/**
 * Updates the risk score panel: number, bar fill, colour, status badge,
 * detail text, and triggers/clears crisis mode.
 */
function updateRiskScoreUI() {
  const score  = Math.round(riskScore);
  const numEl  = document.getElementById('risk-value');
  const fillEl = document.getElementById('risk-bar-fill');
  const badge  = document.getElementById('risk-status-badge');
  const detail = document.getElementById('risk-detail');

  // Colour and label thresholds: LOW 0–40, MEDIUM 40–70, HIGH 70–100
  let color, levelLabel, badgeClass, detailClass, detailMsg;
  if (score >= 70) {
    color = THREAT_CSS.HIGH; levelLabel = 'HIGH';
    badgeClass = 'status-high'; detailClass = 'alert';
    detailMsg = recentHighTimes.length > 2
      ? `${recentHighTimes.length} HIGH threats clustered`
      : 'Critical threat activity';
  } else if (score >= 40) {
    color = THREAT_CSS.MEDIUM; levelLabel = 'MEDIUM';
    badgeClass = 'status-medium'; detailClass = 'warn';
    const burstCount = recentAttackTimes.length;
    detailMsg = burstCount >= CONFIG.BURST_THRESHOLD
      ? `Burst detected — ${burstCount} attacks`
      : 'Elevated threat level';
  } else {
    color = THREAT_CSS.LOW; levelLabel = 'LOW';
    badgeClass = 'status-low'; detailClass = '';
    detailMsg = 'Systems nominal';
  }

  numEl.textContent       = score;
  numEl.style.color       = color;
  numEl.style.textShadow  = `0 0 14px ${color}`;
  fillEl.style.width      = score + '%';
  fillEl.style.background = color;
  fillEl.style.boxShadow  = `0 0 8px ${color}`;

  badge.textContent  = levelLabel;
  badge.className    = `risk-status-badge ${badgeClass}`;

  detail.textContent = detailMsg;
  detail.className   = `risk-detail ${detailClass}`;

  // ── Crisis mode toggle ────────────────────────────────────
  const shouldBeCrisis = score >= 70;
  if (shouldBeCrisis !== isCrisisMode) {
    setCrisisMode(shouldBeCrisis);
  }
}

/**
 * Activates or deactivates crisis mode.
 * Toggles UI elements and mutates Three.js scene lighting.
 * @param {boolean} active
 */
function setCrisisMode(active) {
  isCrisisMode = active;

  const banner  = document.getElementById('crisis-banner');
  const overlay = document.getElementById('crisis-overlay');

  if (active) {
    banner.classList.remove('hidden');
    overlay.classList.remove('hidden');
    document.body.classList.add('crisis-mode');

    // Shift scene lighting toward red
    ambientLight.color.set(0x330808);
    keyLight.color.set(0xff3322);
    keyLight.intensity = 1.1;
    rimLight.color.set(0xff1100);
    rimLight.intensity = 0.5;
    scene.fog.color.set(0x1a0000);
    scene.background.set(0x0a0000);
  } else {
    banner.classList.add('hidden');
    overlay.classList.add('hidden');
    document.body.classList.remove('crisis-mode');

    // Restore normal lighting
    ambientLight.color.set(0x112244);
    keyLight.color.set(0x6699ff);
    keyLight.intensity = 0.8;
    rimLight.color.set(0x00e5ff);
    rimLight.intensity = 0.25;
    scene.fog.color.set(0x000510);
    scene.background.set(0x000510);
  }
}

function updateAttackLog(data) {
  logEntries.unshift(data);
  if (logEntries.length > CONFIG.MAX_LOG_ENTRIES) logEntries.pop();

  const listEl = document.getElementById('attack-list');
  listEl.innerHTML = logEntries.map((d, i) => {
    // Show cluster badge if country has active cluster
    const clusterCount = getClusterCount(d.country);
    const clusterBadge = clusterCount >= CONFIG.CLUSTER_THRESHOLD
      ? `<span class="cluster-badge">×${clusterCount}</span>`
      : '';
    const levelClass = `level-${d.threatLevel.toLowerCase()}`;
    return `
      <div class="log-entry ${levelClass}" style="opacity:${1 - i * 0.035}">
        <span class="log-dot" style="color:${THREAT_CSS[d.threatLevel]}">▸</span>
        <span class="log-type">${d.attackType}</span>
        <span class="log-country">${d.country}${clusterBadge}</span>
        <span class="log-level" style="color:${THREAT_CSS[d.threatLevel]}">${d.threatLevel}</span>
        <span class="log-ip">${d.sourceIP}</span>
      </div>`;
  }).join('');
}

function updateBottomBar(data) {
  const c   = THREAT_CSS[data.threatLevel];
  const el  = document.getElementById('last-event-text');
  el.style.color = c;
  el.textContent =
    `${data.attackType.toUpperCase()} from ${data.country.toUpperCase()} ` +
    `[${data.sourceIP}] — ${data.threatLevel} THREAT — ${new Date(data.timestamp).toUTCString()}`;
}

/** Tick the UTC clock in the top bar */
function tickClock() {
  const now = new Date();
  const h   = String(now.getUTCHours()).padStart(2, '0');
  const m   = String(now.getUTCMinutes()).padStart(2, '0');
  const s   = String(now.getUTCSeconds()).padStart(2, '0');
  document.getElementById('hud-clock').textContent = `${h}:${m}:${s} UTC`;
}
setInterval(tickClock, 1000);
tickClock();

// ─────────────────────────────────────────────────────────────
// ANIMATION LOOP
// ─────────────────────────────────────────────────────────────

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta   = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  // ── Slow globe rotation ──────────────────────────────────
  globe.rotation.y += 0.0012;

  // ── Server node animation ────────────────────────────────
  serverNode.rotation.x += 0.015;
  serverNode.rotation.y += 0.022;
  // Pulse glow
  const pulse = 0.12 + 0.06 * Math.sin(elapsed * 3.5);
  serverNodeGlow.material.opacity = pulse;
  serverNodeGlow.scale.setScalar(1 + 0.15 * Math.sin(elapsed * 3.5));

  // ── Risk score decay (slow drain) ───────────────────────
  riskScore = Math.max(0, riskScore - delta * CONFIG.RISK_DECAY_RATE);
  updateRiskScoreUI();

  // ── Update each active attack ────────────────────────────
  for (let i = activeAttacks.length - 1; i >= 0; i--) {
    const atk  = activeAttacks[i];
    atk.age   += delta;

    const totalPts = CONFIG.ARC_SEGMENTS + 1;

    // Phase 1 — draw arc progressively
    if (atk.drawProgress < 1) {
      atk.drawProgress = Math.min(1, atk.drawProgress + delta / CONFIG.ARC_DRAW_SPEED);
      const visible = Math.floor(atk.drawProgress * totalPts);
      atk.arc.geometry.setDrawRange(0, visible);

      // Trigger impact flash once arc finishes
      if (atk.drawProgress >= 1 && !atk.arcFullyDrawn) {
        atk.arcFullyDrawn = true;
        atk.impact.material.opacity = 0.7; // visible flash
      }
    }

    // Phase 2 — impact ring expands and fades
    if (atk.arcFullyDrawn && atk.impact.material.opacity > 0) {
      atk.impact.scale.addScalar(delta * 3.5);
      atk.impact.material.opacity = Math.max(0, atk.impact.material.opacity - delta * 1.2);
    }

    // Phase 3 — halo ring pulses while alive
    const pulseFactor = 1 + 0.35 * Math.sin(elapsed * 5 + i * 1.3);
    atk.halo.scale.setScalar(pulseFactor);

    // Phase 4 — fade out in final FADE_DURATION seconds
    const fadeStart = atk.maxAge - CONFIG.FADE_DURATION;
    if (atk.age > fadeStart) {
      const t = Math.max(0, 1 - (atk.age - fadeStart) / CONFIG.FADE_DURATION);
      atk.arc.material.opacity      = 0.80 * t;
      atk.halo.material.opacity     = 0.55 * t;
      atk.marker.material.opacity   = t;
      atk.marker.material.transparent = true;
    }

    // Phase 5 — remove and clean up once lifespan exhausted
    if (atk.age >= atk.maxAge) {
      [atk.marker, atk.halo, atk.arc, atk.impact].forEach(obj => {
        scene.remove(obj);
        obj.geometry.dispose();
        obj.material.dispose();
      });
      activeAttacks.splice(i, 1);
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────

function init() {
  setupScene();
  createStarfield();
  createGlobe();
  createServerNode();
  connectWebSocket();
  animate();
  console.log('[INIT] Cyber Command Center ready.');
}

init();