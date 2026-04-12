/* ============================================
   KRKAI — 3D Pen + Flight Paths + Trail
   ============================================ */

var KRKAI_Pen = (function() {
  'use strict';

  var penGroup;
  var cameraPath, penPath, cameraPosSpline;
  var trailParticles, trailPositions, trailOpacities, trailSizes;
  var trailPool = [];
  var writingLine, writingLineGeo;
  var quoteWritingLine, quoteWritingGeo;
  var lookAtSpline;

  var isMobile = window.innerWidth < 768;
  var _tpc = (typeof KRKAI_ParticleConfig !== 'undefined') ? KRKAI_ParticleConfig.trail : null;
  var TRAIL_COUNT = _tpc ? (isMobile ? _tpc.countMobile : _tpc.countDesktop) : (isMobile ? 150 : 500);
  var prevPenPos = new THREE.Vector3(-0.15, 1.6, 0.4);  // initialized to pen start — prevents huge speed spike on first frame
  var penSpeed = 0;

  // Trail only emits after first real user scroll event (prevents GSAP restoration flash)
  var trailEnabled = false;
  window.addEventListener('wheel', function() { trailEnabled = true; }, { once: true, passive: true });
  window.addEventListener('touchstart', function() { trailEnabled = true; }, { once: true, passive: true });

  // For smooth orientation
  var targetQuaternion = new THREE.Quaternion();
  var currentQuaternion = new THREE.Quaternion();

  // Reusable temp objects (avoid per-frame allocations / GC pressure)
  var _tmpV1 = new THREE.Vector3();
  var _tmpV2 = new THREE.Vector3();
  var _tmpV3 = new THREE.Vector3();
  var _tmpV4 = new THREE.Vector3();
  var _tmpV5 = new THREE.Vector3();
  var _tmpEuler1 = new THREE.Euler();
  var _tmpEuler2 = new THREE.Euler();
  var _tmpQuat1 = new THREE.Quaternion();
  var _tmpQuat2 = new THREE.Quaternion();
  // Reusable nib/trail temps (avoid per-frame allocations in update loop)
  var _nibOffset = new THREE.Vector3();
  var _nibTipPos = new THREE.Vector3();
  var _trailColor = new THREE.Color(0xD4AF37);
  var _trailColorTarget = new THREE.Color(0xFFE855);
  // (targetRotationX removed — orientation now handled via quaternion flight system)

  // Create a circular canvas texture so trail particles appear as circles (not squares)
  function createCircleTexture() {
    var size = 64;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
  }

  // === NON-LINEAR SCROLL-TO-PATH MAPPING ===
  // Slows at hero moments (macro, orbit, writing), faster through transitions
  var SCROLL_REMAP = [
    { scrollP: 0.00, splineT: 0.00 },
    { scrollP: 0.05, splineT: 0.04 },   // SLOW: macro hold
    { scrollP: 0.10, splineT: 0.12 },   // FAST: crane transition
    { scrollP: 0.16, splineT: 0.18 },
    { scrollP: 0.22, splineT: 0.26 },
    { scrollP: 0.28, splineT: 0.32 },
    { scrollP: 0.34, splineT: 0.38 },   // SLOW: orbit lingers
    { scrollP: 0.38, splineT: 0.42 },
    { scrollP: 0.48, splineT: 0.52 },
    { scrollP: 0.58, splineT: 0.62 },
    { scrollP: 0.68, splineT: 0.72 },
    { scrollP: 0.74, splineT: 0.78 },
    { scrollP: 0.80, splineT: 0.83 },   // SLOW: writing lingers
    { scrollP: 0.83, splineT: 0.85 },
    { scrollP: 0.90, splineT: 0.88 },   // SLOW: hold wider shot during fade
    { scrollP: 0.94, splineT: 1.00 }
  ];

  function remapScrollToSpline(scrollP) {
    if (scrollP <= 0) return 0;
    if (scrollP >= 0.94) return 1;
    for (var i = 0; i < SCROLL_REMAP.length - 1; i++) {
      var a = SCROLL_REMAP[i], b = SCROLL_REMAP[i + 1];
      if (scrollP >= a.scrollP && scrollP < b.scrollP) {
        var t = (scrollP - a.scrollP) / (b.scrollP - a.scrollP);
        t = t * t * (3 - 2 * t); // smoothstep for seamless joins
        return a.splineT + (b.splineT - a.splineT) * t;
      }
    }
    return SCROLL_REMAP[SCROLL_REMAP.length - 1].splineT;
  }

  function init(scene) {
    buildPen(scene);
    buildPaths();
    buildTrailSystem(scene);
    buildWritingEffect(scene);
    buildInkDripSystem(scene);
  }

  // === 3D PEN CONSTRUCTION ===
  function buildPen(scene) {
    penGroup = new THREE.Group();

    var goldMat = new THREE.MeshStandardMaterial({
      color: 0xD4AF37,       // rich cinematic gold
      roughness: 0.04,       // near-mirror — physically-based polished gold
      metalness: 0.95,       // maximum metallic response for PBR realism
      emissive: 0xD4AF37,
      emissiveIntensity: 0.08
    });
    var darkMat = new THREE.MeshStandardMaterial({
      color: 0x2C2C2C, roughness: 0.4, metalness: 0.6
    });
    var nibTipMat = new THREE.MeshStandardMaterial({
      color: 0xD4AF37,       // gold nib tip
      emissive: 0xD4AF37,
      emissiveIntensity: 0.1,  // subtle glow — 0.5 caused white bloom blast on hard restart
      roughness: 0.02,       // ultra-smooth iridium ball
      metalness: 0.98
    });

    // Cap (top)
    var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.18, 16), goldMat);
    cap.position.y = 0.24;
    penGroup.add(cap);

    // Cap finial
    var finial = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), goldMat);
    finial.position.y = 0.33;
    penGroup.add(finial);

    // Clip
    var clip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.14, 0.015), goldMat);
    clip.position.set(0.035, 0.26, 0);
    penGroup.add(clip);

    // Barrel
    var barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 16), goldMat);
    barrel.position.y = 0.04;
    penGroup.add(barrel);

    // Decorative bands
    if (!isMobile) {
      for (var b = 0; b < 3; b++) {
        var band = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.003, 6, 16), goldMat);
        band.rotation.x = Math.PI / 2;
        band.position.y = -0.02 + b * 0.06;
        penGroup.add(band);
      }
    }

    // Section joint
    var joint = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.03, 0.02, 16), goldMat);
    joint.position.y = -0.07;
    penGroup.add(joint);

    // Grip section
    var grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.06, 16), goldMat);
    grip.position.y = -0.11;
    penGroup.add(grip);

    // Nib — flat fountain pen shape using scaled cone
    var nibGeo = new THREE.ConeGeometry(0.022, 0.1, 16);
    // Flatten into nib shape (thin in X, normal in Z)
    nibGeo.scale(0.6, 1, 1);
    var nib = new THREE.Mesh(nibGeo, darkMat);
    nib.rotation.x = Math.PI;  // Flip cone so apex points DOWN toward writing tip
    nib.position.y = -0.19;
    penGroup.add(nib);

    // Nib slit (centered line down the nib)
    var slit = new THREE.Mesh(
      new THREE.PlaneGeometry(0.001, 0.08),
      new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })
    );
    slit.position.y = -0.18;
    penGroup.add(slit);

    // Nib tip — small iridium ball (glowing)
    var tipBall = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 12), nibTipMat);
    tipBall.position.y = -0.24;
    penGroup.add(tipBall);

    // Start visible on parchment — pen nib resting on 3.png image center
    // Scale 1.0 at start, grows to 1.8 during intro scroll (0.00-0.05)
    penGroup.position.set(-0.15, 1.6, 0.4);
    penGroup.scale.set(0.6, 0.6, 0.6);
    scene.add(penGroup);
  }

  // === FLIGHT PATHS ===
  function buildPaths() {
    // Pen flight path — purposeful narrative journey through the room
    // Rises from desk, passes through light shaft, weaves, spirals back for writing
    penPath = new THREE.CatmullRomCurve3([
      // Seg 1 (0.00-0.05): Intro — pen resting on parchment
      new THREE.Vector3(-0.15, 1.60, 0.40),   // On parchment (start)
      new THREE.Vector3(-0.15, 1.72, 0.40),   // Barely lifts off

      // Seg 2 (0.05-0.16): Hero rise — pen levitates upward
      new THREE.Vector3(-0.10, 2.10, 0.45),   // Rising from desk
      new THREE.Vector3( 0.00, 2.50, 0.30),   // Floats into room center (visible)

      // Seg 3 (0.16-0.28): Problem — slight drift, stays within camera view
      new THREE.Vector3(-0.30, 2.35, 0.15),   // Gentle left drift
      new THREE.Vector3(-0.55, 2.25, 0.05),   // Left side, still centred

      // Seg 4 (0.28-0.38): Mission — sweeps back toward window side
      new THREE.Vector3( 0.05, 2.50, 0.20),   // Back to centre
      new THREE.Vector3( 0.65, 2.65, 0.10),   // Moderate right move

      // Seg 5 (0.38-0.50): Programs — front area
      new THREE.Vector3( 0.40, 2.45, 0.52),   // Right-centre
      new THREE.Vector3( 0.00, 2.35, 0.62),   // Centre-front

      // Seg 6 (0.50-0.62): Timeline — weaves left
      new THREE.Vector3(-0.50, 2.55, 0.32),   // Left-centre
      new THREE.Vector3(-0.70, 2.40, 0.10),   // Left edge, still visible

      // Seg 7 (0.62-0.68): Stories — spirals back to desk
      new THREE.Vector3(-0.30, 2.15, 0.25),   // Centre return
      new THREE.Vector3( 0.10, 2.05, 0.42),   // Approaching desk

      // Seg 8 (0.68-0.80): Impact — descends toward parchment
      new THREE.Vector3( 0.00, 1.92, 0.43),   // Lower approach
      new THREE.Vector3(-0.10, 1.77, 0.41),   // Nearly at desk

      // Seg 9 (0.80-0.92): Writing + Outro
      new THREE.Vector3(-0.15, 1.62, 0.40),   // Writing position on parchment
      new THREE.Vector3(-0.15, 1.60, 0.40)    // Final rest (matches start)
    ]);

    // Camera path kept as fallback for transitions
    cameraPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.15, 1.72, 0.55),
      new THREE.Vector3(-0.05, 2.10, 0.90),
      new THREE.Vector3( 0.20, 3.40, 2.20),
      new THREE.Vector3( 2.50, 2.30, -0.50),
      new THREE.Vector3(-1.70, 2.80, -0.80),
      new THREE.Vector3(-1.00, 2.20, 1.40),
      new THREE.Vector3(-0.20, 1.80, 0.80),
      new THREE.Vector3(-0.10, 3.00, 1.80)
    ]);

    // === CINEMATIC CAMERA POSITION SPLINE ===
    // Constrained camera path — stays above desk level, avoids extreme positions
    cameraPosSpline = new THREE.CatmullRomCurve3([
      // === Seg 1 (0.00-0.05): ELEVATED CLOSE-UP REVEAL (above desk, looking down) ===
      new THREE.Vector3(-0.15, 2.30, 0.80),   // p=0.00: Above desk, looking down at parchment
      new THREE.Vector3(-0.12, 2.35, 0.85),   // p~0.025: Subtle breathing drift

      // === Seg 2 (0.05-0.16): SLOW CRANE RISE + DOLLY BACK (gentler) ===
      new THREE.Vector3(-0.05, 2.45, 0.95),   // p~0.06: Beginning crane rise
      new THREE.Vector3( 0.05, 2.55, 1.15),   // p~0.10: Mid crane — pulling back gently
      new THREE.Vector3( 0.10, 2.85, 2.10),   // p~0.16: Crane apex — pulled back for wall reveal

      // === Seg 3 (0.16-0.28): LATERAL TRACKING SHOT (less extreme) ===
      new THREE.Vector3( 0.80, 2.60, 1.40),   // p~0.19: Sliding right gently
      new THREE.Vector3( 1.60, 2.50, 0.80),   // p~0.23: Right side, near window
      new THREE.Vector3( 1.40, 2.40, 0.20),   // p~0.28: Tracking pen

      // === Seg 4 (0.28-0.38): GENTLE ORBIT (constrained) ===
      new THREE.Vector3( 1.00, 2.60, -0.60),  // p~0.30: Orbit begins
      new THREE.Vector3( 0.00, 2.70, -1.00),  // p~0.33: Orbit swings behind
      new THREE.Vector3(-0.80, 2.60, -0.40),  // p~0.36: Orbit left side
      new THREE.Vector3(-0.60, 2.50, 0.60),   // p~0.38: Orbit ends front-left

      // === Seg 5 (0.38-0.62): GENTLE WEAVING PATH (less extreme) ===
      new THREE.Vector3( 0.30, 2.40, 1.20),   // p~0.42: Front-right
      new THREE.Vector3( 1.20, 2.60, 0.40),   // p~0.46: Right side
      new THREE.Vector3( 0.60, 2.80, -0.60),  // p~0.50: Arc right-back
      new THREE.Vector3(-0.60, 2.60, -0.50),  // p~0.54: Left-back
      new THREE.Vector3(-1.20, 2.40, 0.30),   // p~0.58: Left side
      new THREE.Vector3(-0.50, 2.30, 1.00),   // p~0.62: Returns front-left

      // === Seg 6 (0.62-0.80): APPROACH (constrained) ===
      new THREE.Vector3( 0.30, 2.30, 0.60),   // p~0.68: Approaching
      new THREE.Vector3( 0.00, 2.10, 0.50),   // p~0.74: Closing in
      new THREE.Vector3(-0.20, 1.95, 0.70),   // p~0.80: Near-desk

      // === Seg 7 (0.80-0.92): INTIMATE WRITING + PULLBACK ===
      new THREE.Vector3(-0.18, 1.82, 0.75),   // p~0.84: Writing close-up
      new THREE.Vector3(-0.15, 2.20, 1.00),   // p~0.87: Beginning pullback
      new THREE.Vector3(-0.15, 2.30, 0.80)    // p~0.92: Return to macro start position
    ]);

    // === LOOKAT TARGET SPLINE ===
    // Camera gaze stays focused on desk/pen area — avoids wild look swings
    lookAtSpline = new THREE.CatmullRomCurve3([
      // Seg 1: Look at parchment/nib (macro shot)
      new THREE.Vector3(-0.15, 1.563, 0.40),  // Nib on parchment
      new THREE.Vector3(-0.15, 1.58, 0.40),   // Still on nib

      // Seg 2: Crane rise — sweep upward toward back wall for poster reveal
      new THREE.Vector3(-0.10, 1.90, 0.42),   // Tracking pen rise
      new THREE.Vector3( 0.00, 2.85, -3.20),  // Crane rise → look at back wall center poster

      // Seg 3: Back wall reveal sweep + side wall reveals
      new THREE.Vector3(-2.20, 2.75, -3.80),  // Back wall left poster reveal
      new THREE.Vector3( 2.50, 2.70, -2.00),  // Swing to right wall poster

      // Seg 4: Orbit — stable center + left wall reveal
      new THREE.Vector3( 0.10, 2.30, 0.10),   // Orbit center (recover to center)
      new THREE.Vector3( 0.00, 2.20, 0.20),   // Room center

      // Seg 5: Weaving — left wall poster reveal then return
      new THREE.Vector3(-3.80, 2.80, 1.80),   // Left wall poster reveal
      new THREE.Vector3( 0.00, 2.65, -2.50),  // Return sweep toward back wall
      new THREE.Vector3( 0.00, 2.20, 0.20),   // Return to center

      // Seg 6: Approach — look tightens on desk
      new THREE.Vector3(-0.10, 1.90, 0.35),   // Near-desk
      new THREE.Vector3(-0.15, 1.70, 0.40),   // Approaching parchment

      // Seg 7: Writing — look at pen/parchment
      new THREE.Vector3(-0.15, 1.60, 0.40),   // Writing surface
      new THREE.Vector3(-0.15, 1.58, 0.40),   // Nib detail
      new THREE.Vector3(-0.15, 1.563, 0.40)   // Return to starting nib lookAt
    ]);
  }

  // === FOV KEYFRAME INTERPOLATION ===
  var currentTargetFov = 50;

  var FOV_KEYFRAMES = [
    { p: 0.00, fov: 35 },   // Close-up but not extreme
    { p: 0.03, fov: 35 },   // Hold
    { p: 0.05, fov: 36 },   // Barely widening
    { p: 0.10, fov: 42 },   // Crane rise — widening for wall poster reveal
    { p: 0.16, fov: 50 },   // Wall reveal — wide sweep showing posters
    { p: 0.22, fov: 46 },   // Tracking — still wide for side wall
    { p: 0.28, fov: 38 },   // Orbit start
    { p: 0.34, fov: 37 },   // Orbit peak
    { p: 0.38, fov: 39 },   // Weaving exploration
    { p: 0.50, fov: 40 },   // Widest (environmental)
    { p: 0.62, fov: 38 },   // Tightening
    { p: 0.68, fov: 37 },   // Approaching
    { p: 0.74, fov: 36 },   // Close
    { p: 0.80, fov: 35 },   // Writing
    { p: 0.84, fov: 34 },   // Intimate
    { p: 0.87, fov: 37 },   // Pullback
    { p: 0.92, fov: 40 }    // Final
  ];

  function getFovForProgress(p) {
    for (var i = 0; i < FOV_KEYFRAMES.length - 1; i++) {
      if (p >= FOV_KEYFRAMES[i].p && p < FOV_KEYFRAMES[i + 1].p) {
        var t = (p - FOV_KEYFRAMES[i].p) / (FOV_KEYFRAMES[i + 1].p - FOV_KEYFRAMES[i].p);
        t = t * t * (3 - 2 * t); // smoothstep
        return FOV_KEYFRAMES[i].fov + (FOV_KEYFRAMES[i + 1].fov - FOV_KEYFRAMES[i].fov) * t;
      }
    }
    return FOV_KEYFRAMES[FOV_KEYFRAMES.length - 1].fov;
  }

  // === CAMERA POSITION FROM SPLINE + FOV ===
  function getCameraForProgress(p) {
    var splineT = Math.min(remapScrollToSpline(p), 1);
    return {
      position: cameraPosSpline.getPointAt(splineT),
      fov: getFovForProgress(p)
    };
  }

  // === INK DRIP PARTICLES (heavier, darker drops for dramatic pauses) ===
  var inkDripPool = [];
  var inkDripPositions, inkDripParticles;
  var INK_DRIP_COUNT = 30;

  function buildInkDripSystem(scene) {
    if (isMobile) return;
    var geo = new THREE.BufferGeometry();
    inkDripPositions = new Float32Array(INK_DRIP_COUNT * 3);
    for (var i = 0; i < INK_DRIP_COUNT; i++) {
      inkDripPositions[i * 3 + 1] = -100;
      inkDripPool.push({ active: false, life: 0, maxLife: 0, vy: 0 });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(inkDripPositions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0x0A1A17, size: 0.06, transparent: true, opacity: 0.8,
      blending: THREE.NormalBlending, depthWrite: false
    });
    inkDripParticles = new THREE.Points(geo, mat);
    scene.add(inkDripParticles);
  }

  function emitInkDrip(pos) {
    for (var i = 0; i < INK_DRIP_COUNT; i++) {
      if (!inkDripPool[i].active) {
        inkDripPool[i].active = true;
        inkDripPool[i].life = 0;
        inkDripPool[i].maxLife = 40 + Math.random() * 30;
        inkDripPool[i].vy = -0.001;
        var idx = i * 3;
        inkDripPositions[idx] = pos.x + (Math.random() - 0.5) * 0.03;
        inkDripPositions[idx + 1] = pos.y;
        inkDripPositions[idx + 2] = pos.z + (Math.random() - 0.5) * 0.03;
        return;
      }
    }
  }

  function updateInkDrips() {
    if (!inkDripParticles) return;
    var hasActive = false;
    for (var i = 0; i < INK_DRIP_COUNT; i++) {
      if (inkDripPool[i].active) { hasActive = true; break; }
    }
    if (!hasActive) return;
    for (var i = 0; i < INK_DRIP_COUNT; i++) {
      if (inkDripPool[i].active) {
        inkDripPool[i].life++;
        if (inkDripPool[i].life >= inkDripPool[i].maxLife) {
          inkDripPool[i].active = false;
          inkDripPositions[i * 3 + 1] = -100;
          continue;
        }
        inkDripPool[i].vy -= 0.0003; // gravity
        inkDripPositions[i * 3 + 1] += inkDripPool[i].vy;
      }
    }
    inkDripParticles.geometry.attributes.position.needsUpdate = true;
  }

  // === TRAIL PARTICLE SYSTEM ===
  function buildTrailSystem(scene) {
    var geo = new THREE.BufferGeometry();
    trailPositions = new Float32Array(TRAIL_COUNT * 3);
    trailOpacities = new Float32Array(TRAIL_COUNT);
    trailSizes = new Float32Array(TRAIL_COUNT);

    for (var i = 0; i < TRAIL_COUNT; i++) {
      trailPositions[i * 3] = 0;
      trailPositions[i * 3 + 1] = -100; // hidden below
      trailPositions[i * 3 + 2] = 0;
      trailOpacities[i] = 0;
      trailSizes[i] = 0;
      trailPool.push({
        active: false,
        life: 0,
        maxLife: 0,
        vx: 0, vy: 0, vz: 0
      });
    }

    geo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));

    // Additive blending makes overlapping particles sum their brightness
    // — physically accurate for light emission (fire, sparks, gold dust)
    var mat = new THREE.PointsMaterial({
      map: createCircleTexture(),
      color: 0xFFD700,
      size: _tpc ? (isMobile ? _tpc.sizeMobile : _tpc.sizeDesktop) : (isMobile ? 0.03 : 0.065),
      transparent: true,
      opacity: _tpc ? _tpc.opacity : 0.85,
      alphaTest: 0.01,
      blending: THREE.AdditiveBlending,
      depthWrite: false,    // required for correct additive blending layering
      depthTest: false      // always render — pen body must not occlude nib sparkles
    });
    
    // Per-particle size via shader was removed — causes 'size' redefinition error in WebGL.
    // Using uniform size from PointsMaterial instead.

    trailParticles = new THREE.Points(geo, mat);
    trailParticles.frustumCulled = false;  // bounding sphere starts at y=-100 (parked); disable culling so particles always render
    scene.add(trailParticles);
  }

  function emitTrailParticle(pos) {
    for (var i = 0; i < TRAIL_COUNT; i++) {
      if (!trailPool[i].active) {
        trailPool[i].active = true;
        trailPool[i].life = 0;
        var _lifeMin = _tpc ? _tpc.lifeMin : 20;
        var _lifeRange = _tpc ? (_tpc.lifeMax - _tpc.lifeMin) : 20;
        trailPool[i].maxLife = _lifeMin + Math.random() * _lifeRange;
        // Spherical random spread — particles float outward from nib tip in all
        // directions. depthTest:false ensures they're visible regardless of pen body.
        trailPool[i].vx = (Math.random() - 0.5) * 0.008;
        trailPool[i].vy = (Math.random() - 0.5) * 0.006 + 0.002; // slight upward drift
        trailPool[i].vz = (Math.random() - 0.5) * 0.008;
        var idx = i * 3;
        trailPositions[idx] = pos.x + (Math.random() - 0.5) * 0.006;
        trailPositions[idx + 1] = pos.y + (Math.random() - 0.5) * 0.006;
        trailPositions[idx + 2] = pos.z + (Math.random() - 0.5) * 0.006;
        return;
      }
    }
  }

  function updateTrail() {
    if (trailPool.length === 0) return;  // not yet initialized by KRKAI_Pen.init()
    var hasActive = false;
    for (var i = 0; i < TRAIL_COUNT; i++) {
      if (trailPool[i].active) { hasActive = true; break; }
    }
    if (!hasActive) return;
    for (var i = 0; i < TRAIL_COUNT; i++) {
      if (trailPool[i].active) {
        trailPool[i].life++;
        if (trailPool[i].life >= trailPool[i].maxLife) {
          trailPool[i].active = false;
          trailPositions[i * 3 + 1] = -100;
          continue;
        }
        var idx = i * 3;
        
        // Add turbulent magical float
        trailPool[i].vx += (Math.random() - 0.5) * 0.001;
        trailPool[i].vz += (Math.random() - 0.5) * 0.001;
        
        trailPositions[idx] += trailPool[i].vx;
        trailPositions[idx + 1] += trailPool[i].vy - 0.0002; // slower gravity
        trailPositions[idx + 2] += trailPool[i].vz;
        
        // Damping
        trailPool[i].vx *= 0.98;
        trailPool[i].vy *= 0.98;
        trailPool[i].vz *= 0.98;
      }
    }
    trailParticles.geometry.attributes.position.needsUpdate = true;
  }

  // === WRITING EFFECT ===
  function buildWritingEffect(scene) {
    // Tamil text கற்கை — flowing calligraphic path on the parchment
    var tamilPoints = [];
    var steps = 80;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      // Path centered on parchment at (-0.3, 1.565, 0.2)
      var x = -0.9 + t * 1.2;
      var y = 1.565;
      var z = 0.15 + Math.sin(t * Math.PI * 4) * 0.06 + Math.cos(t * Math.PI * 2) * 0.04;
      tamilPoints.push(new THREE.Vector3(x, y, z));
    }
    writingLineGeo = new THREE.BufferGeometry().setFromPoints(tamilPoints);
    writingLineGeo.setDrawRange(0, 0);
    var writingMat = new THREE.LineBasicMaterial({
      color: 0x1A1A3A,
      transparent: true,
      opacity: 0.7,
      linewidth: 2,
      blending: THREE.NormalBlending
    });
    writingLine = new THREE.Line(writingLineGeo, writingMat);
    scene.add(writingLine);

    // English quote writing (on parchment area)
    var quotePoints = [];
    var qSteps = 100;
    for (var j = 0; j <= qSteps; j++) {
      var qt = j / qSteps;
      var qx = -0.8 + qt * 1.0;
      var qy = 1.565;
      var qz = 0.35 + Math.sin(qt * Math.PI * 6) * 0.02;
      quotePoints.push(new THREE.Vector3(qx, qy, qz));
    }
    quoteWritingGeo = new THREE.BufferGeometry().setFromPoints(quotePoints);
    quoteWritingGeo.setDrawRange(0, 0);
    quoteWritingLine = new THREE.Line(quoteWritingGeo, writingMat.clone());
    scene.add(quoteWritingLine);
  }

  // === UPDATE PER SCROLL PROGRESS ===
  function update(progress, camera, nibLight) {
    if (!penGroup || !cameraPath || !penPath || !cameraPosSpline || !lookAtSpline) return;

    var p = Math.max(0, Math.min(progress, 1));

    // Map progress to path (paths have 0-1 range)
    var pathProgress = remapScrollToSpline(p);

    // === FILM DIRECTOR CAMERA CHOREOGRAPHY ===
    var camResult = getCameraForProgress(p);
    var camPos = camResult.position;
    currentTargetFov = camResult.fov;

    // Get pen position from flight path
    var penPos = penPath.getPointAt(pathProgress);

    // Clamp pen position to safe room bounds (tighter)
    penPos.x = Math.max(-2.5, Math.min(2.5, penPos.x));
    penPos.y = Math.max(1.5, Math.min(4.0, penPos.y));
    penPos.z = Math.max(-2.0, Math.min(2.0, penPos.z));

    // === ENFORCE MINIMUM CAMERA-PEN DISTANCE (dynamic for shot types) ===
    var MIN_CAM_PEN_DIST;
    if (p < 0.05 || (p > 0.78 && p < 0.88)) {
      MIN_CAM_PEN_DIST = 0.3;  // Macro/writing: camera can be very close
    } else {
      MIN_CAM_PEN_DIST = 0.8;  // Flight: prevent clipping but allow closer than before
    }
    var camToPen = camPos.distanceTo(penPos);
    if (camToPen < MIN_CAM_PEN_DIST && p > 0.03 && p < 0.87) {
      var pushDir = _tmpV1.subVectors(camPos, penPos).normalize();
      camPos.copy(penPos).addScaledVector(pushDir, MIN_CAM_PEN_DIST);
    }

    // Clamp camera inside room (tighter to prevent wall/object clipping)
    camPos.x = Math.max(-3.0, Math.min(3.0, camPos.x));
    camPos.y = Math.max(1.5, Math.min(4.5, camPos.y));
    camPos.z = Math.max(-2.5, Math.min(2.5, camPos.z));

    // === CINEMATIC LOOKAT SYSTEM ===
    // Blends between lookAt spline (anticipates motion) and direct pen tracking
    var lookTarget = _tmpV2;
    var lookSplineT = Math.min(remapScrollToSpline(p), 1);
    var lookSplinePos = lookAtSpline.getPointAt(lookSplineT);

    // Blend factor: higher = trust spline more, lower = track pen directly
    var splineWeight;
    if (p < 0.05) {
      splineWeight = 1.0;          // Macro: look at parchment (spline)
    } else if (p < 0.16) {
      splineWeight = 0.7;          // Crane: gradually shift to spline leading
    } else if (p >= 0.28 && p < 0.38) {
      splineWeight = 0.9;          // Orbit: look at orbit center, not pen
    } else if (p >= 0.38 && p < 0.62) {
      splineWeight = 0.5;          // Weaving: 50/50 blend
    } else if (p >= 0.80 && p < 0.87) {
      splineWeight = 0.2;          // Writing: track pen closely
    } else if (p >= 0.88) {
      splineWeight = 1.0;          // Outro: look at desk
    } else {
      splineWeight = 0.6;          // Default: slight spline lead
    }

    // Blend spline lookAt with direct pen position
    lookTarget.copy(lookSplinePos).lerp(penPos, 1.0 - splineWeight);

    // Intro/outro blends to desk position
    if (p < 0.01) {
      lookTarget.set(-0.3, 1.55, 0.2);
    } else if (p < 0.03) {
      var introLookT = (p - 0.01) / 0.02;
      var deskLook = _tmpV3.set(-0.3, 1.55, 0.2);
      var savedLook = _tmpV4.copy(lookTarget);
      lookTarget.copy(deskLook).lerp(savedLook, introLookT);
    } else if (p > 0.88 && p < 0.90) {
      var outroLookT = (p - 0.88) / 0.02;
      lookTarget.lerp(_tmpV3.set(-0.3, 1.55, 0.2), outroLookT);
    } else if (p >= 0.90) {
      lookTarget.set(-0.3, 1.55, 0.2);
    }

    if (window.KRKAI_Scene && KRKAI_Scene.updateSmoothCamera) {
      KRKAI_Scene.updateSmoothCamera(camPos, lookTarget);
      if (KRKAI_Scene.updateTargetFov) {
        KRKAI_Scene.updateTargetFov(currentTargetFov);
      }
    } else {
      camera.position.copy(camPos);
      camera.lookAt(lookTarget);
    }

    // === INK DRIP during Problem section (hover-and-drip) ===
    if (p >= 0.20 && p < 0.26 && !isMobile) {
      // Pen hovers and drips ink during tense Problem section
      if (Math.random() < 0.15) emitInkDrip(penPos);
    }
    updateInkDrips();

    // Position pen — steady flight with dramatic hover during Problem section
    var penFlyY = 0;
    if (p >= 0.20 && p < 0.26) {
      // Hover-and-drip: pen bobs gently during tense Problem section
      var hoverTime = Date.now() * 0.003;
      penFlyY = Math.sin(hoverTime) * 0.05;
    }
    penGroup.position.set(penPos.x, penPos.y + penFlyY, penPos.z);

    // Pen intro — visible at start, grows from 1.0 to 1.8 during 0.00-0.05
    if (p < 0.05) {
      var introT = Math.min(p / 0.05, 1);
      var introScale = 0.6 + introT * 0.8; // 0.6 → 1.4
      penGroup.scale.set(introScale, introScale, introScale);
    } else if (p > 0.87 && p <= 0.90) {
      // Pen outro fade — dissolve back into inkwell (0.87-0.90)
      var outroT = (p - 0.87) / 0.03;
      var outroScale = 1.4 - outroT * 1.39; // 1.4 → 0.01
      outroScale = Math.max(outroScale, 0.01);
      penGroup.scale.set(outroScale, outroScale, outroScale);
    } else if (p > 0.90) {
      penGroup.scale.set(0.01, 0.01, 0.01);
    } else {
      penGroup.scale.set(1.4, 1.4, 1.4);
    }

    // == HORIZONTAL PEN FLIGHT ORIENTATION ==
    // Pen flies horizontally along its flight path like a real pen in motion
    var lookAhead = Math.min(pathProgress + 0.02, 1);
    var tangentTarget = penPath.getPointAt(lookAhead);

    // Get flight direction (tangent vector)
    var flightDir = _tmpV3.subVectors(tangentTarget, penPos);

    // Smooth writing/flight blend factor
    var writingBlend = 0;
    if (p >= 0.04 && p < 0.06) {
      writingBlend = 1.0; // intro writing
    } else if (p >= 0.10 && p < 0.12) {
      writingBlend = (p - 0.10) / 0.02; // ramp into writing
    } else if (p >= 0.12 && p < 0.16) {
      writingBlend = 1.0; // full writing
    } else if (p >= 0.16 && p < 0.18) {
      writingBlend = 1.0 - (p - 0.16) / 0.02; // ramp out
    } else if (p >= 0.78 && p < 0.80) {
      writingBlend = (p - 0.78) / 0.02; // ramp into writing
    } else if (p >= 0.80 && p < 0.85) {
      writingBlend = 1.0;
    } else if (p >= 0.85 && p < 0.87) {
      writingBlend = 1.0 - (p - 0.85) / 0.02; // ramp out
    }

    if (p <= 0.88) {
      // Always compute flight quaternion
      var flatDir = _tmpV4.set(flightDir.x, 0, flightDir.z).normalize();
      var yawAngle = Math.atan2(flatDir.x, flatDir.z);
      var pitch = Math.atan2(flightDir.y, Math.sqrt(flightDir.x * flightDir.x + flightDir.z * flightDir.z));
      pitch = Math.max(-0.3, Math.min(0.3, pitch));

      var prevLookAhead = Math.max(pathProgress - 0.02, 0);
      var prevTarget = penPath.getPointAt(prevLookAhead);
      var prevDir = _tmpV4.set(penPos.x - prevTarget.x, 0, penPos.z - prevTarget.z).normalize();
      var currFlatDir = _tmpV5.set(flightDir.x, 0, flightDir.z).normalize();
      var cross = prevDir.x * currFlatDir.z - prevDir.z * currFlatDir.x;
      var bankAngle = Math.max(-0.25, Math.min(0.25, cross * 3));

      var flightEuler = _tmpEuler1.set(-Math.PI / 2 + pitch, yawAngle, bankAngle, 'YXZ');
      var flightQuat = _tmpQuat1.setFromEuler(flightEuler);

      if (writingBlend > 0) {
        // Compute writing quaternion
        var writeAngle = Math.atan2(flightDir.x, flightDir.z);
        var writeEuler = _tmpEuler2.set(-Math.PI / 3, writeAngle, 0, 'YXZ');
        var writeQuat = _tmpQuat2.setFromEuler(writeEuler);
        // Blend between flight and writing
        targetQuaternion.copy(flightQuat).slerp(writeQuat, writingBlend);
      } else {
        targetQuaternion.copy(flightQuat);
      }

      // === BARREL ROLL at mission transition (0.32-0.34) ===
      if (p >= 0.32 && p < 0.34) {
        var rollT = (p - 0.32) / 0.02;
        rollT = rollT * rollT * (3 - 2 * rollT);  // smoothstep — eases in/out for cinematic feel
        var rollAngle = rollT * Math.PI * 2;
        var rollQuat = _tmpQuat2;
        rollQuat.setFromAxisAngle(_tmpV5.set(0, 1, 0), rollAngle);
        targetQuaternion.premultiply(rollQuat);
      }

      // Frame-rate independent slerp
      var dt = (window.KRKAI_Scene && KRKAI_Scene.getDeltaTime) ? KRKAI_Scene.getDeltaTime() : 0.016;
      var slerpFactor = 1 - Math.exp(-6.0 * dt);
      currentQuaternion.slerp(targetQuaternion, slerpFactor);
      penGroup.quaternion.copy(currentQuaternion);
    }

    // In inkwell phase — pen stands upright
    if (p < 0.02) {
      penGroup.rotation.set(0, 0, 0);
      penGroup.position.set(-0.15, 1.6, 0.4);
      // CRITICAL: reset currentQuaternion to match forced visual rotation.
      // Without this, currentQuaternion drifts to the flight angle during loading
      // (the slerp above runs every frame), causing nibTipPos to be wildly wrong
      // → nibLight lands inside scene geometry → white bloom blast on hard restart.
      currentQuaternion.set(0, 0, 0, 1);
    }
    // Return to inkwell at end
    if (p > 0.88) {
      penGroup.rotation.set(0, 0, 0);
      penGroup.position.set(-0.15, 1.6, 0.4);
      currentQuaternion.set(0, 0, 0, 1);
    }

    // Compute nib tip world position using actual current scale so offset is
    // accurate at all scales (0.6 at start → 1.4 during flight → shrinks at end).
    // Use penGroup.position (includes penFlyY hover offset) so nibTipPos always
    // matches the VISUAL tip of the pen, not the raw path point.
    var nibScale = penGroup.scale.y;  // already set above
    _nibOffset.set(0, -0.24 * nibScale, 0);
    _nibOffset.applyQuaternion(currentQuaternion);
    _nibTipPos.copy(penGroup.position).add(_nibOffset);

    // Update nib light position — place AT the nib tip (quaternion-correct)
    if (nibLight) {
      nibLight.position.copy(_nibTipPos);
    }

    // Calculate pen speed for trail emission
    penSpeed = prevPenPos.distanceTo(penPos);
    prevPenPos.copy(penPos);

    // Emit trail particles — only after first real user scroll (prevents GSAP restoration flash)
    if (trailEnabled && p > 0.02 && p < 0.87) {
      var _minE = _tpc ? _tpc.minEmit : 3;
      var _maxE = _tpc ? _tpc.maxEmit : 12;
      var emitCount = Math.max(_minE, Math.min(Math.ceil(penSpeed * 600), _maxE));

      // Gold trail brightens slightly at high speed (reuse pooled Color objects)
      _trailColor.set(0xD4AF37);
      if (penSpeed > 0.04) _trailColor.lerp(_trailColorTarget, Math.min((penSpeed - 0.04) * 15, 1));
      trailParticles.material.color.lerp(_trailColor, 0.1);

      for (var e = 0; e < emitCount; e++) {
        emitTrailParticle(_nibTipPos);
      }
    }

    // (Fantasy spiral effects removed for cinematic realism)
    // Trail physics are now updated from scene.js animate loop for continuous animation

    // Writing effect — Tamil text
    // At start (0-0.03): pre-drawn golden text on desk (3.png reference)
    // Fades during rise (0.03-0.06), then re-drawn at 0.12-0.18
    if (p < 0.06) {
      // Hidden at start — 3.png image already shows the text on the parchment
      writingLineGeo.setDrawRange(0, 0);
      writingLine.material.opacity = 0.8;
    } else if (p >= 0.06 && p < 0.12) {
      // Hidden between rise and writing phase
      writingLineGeo.setDrawRange(0, 0);
      writingLine.material.opacity = 0.8;
    } else if (p >= 0.12 && p < 0.18) {
      writingLine.material.opacity = 0.8;
      var writeProgress = (p - 0.12) / 0.06;
      var drawCount = Math.floor(writeProgress * 80);
      writingLineGeo.setDrawRange(0, drawCount);
    } else if (p >= 0.18) {
      writingLine.material.opacity = 0.8;
      writingLineGeo.setDrawRange(0, 80);
    } else {
      writingLineGeo.setDrawRange(0, 0);
    }

    // Writing effect — English quote (progress 0.80-0.87)
    if (p >= 0.80 && p < 0.87) {
      var qProgress = (p - 0.80) / 0.07;
      var qDrawCount = Math.floor(qProgress * 100);
      quoteWritingGeo.setDrawRange(0, qDrawCount);
    } else if (p >= 0.87) {
      quoteWritingGeo.setDrawRange(0, 100);
    } else {
      // Reset when scrolling back before quote phase
      quoteWritingGeo.setDrawRange(0, 0);
    }
  }

  return {
    init: init,
    update: update,
    updateTrailPhysics: updateTrail,
    getPenGroup: function() { return penGroup; },
    getPenPosition: function() { return penGroup ? penGroup.position : _tmpV1.set(0,0,0); }
  };
})();
