/* ============================================
   KRKAI — Three.js 3D Room Scene
   ============================================ */

var KRKAI_Scene = (function() {
  'use strict';

  var renderer, camera, scene, composer;
  var ambientLight, spotLight, inkwellLight, fillLight, nibLight;
  var room = {};
  var ambientParticles, ambientPositions, ambientVelocities;
  var progress = 0;
  var isRunning = false;
  var isMobile = window.innerWidth < 768;
  var isTablet = window.innerWidth >= 768 && window.innerWidth < 1024;
  var bloomPass; // reference for dynamic threshold adjustments
  var bokehPass = null;

  // === HARDWARE TIER (set by perf.js, loaded before this script) ===
  var _tier = window.KRKAI_PerfTier || (isMobile ? 'low' : 'high');
  var _tierSettings = (window.KRKAI_TierSettings && window.KRKAI_TierSettings[_tier]) || {
    fpsTarget: isMobile ? 30 : 60,
    pixelRatioMax: isMobile ? 1.0 : 1.5,
    shadows: !isMobile,
    bloom:   !isMobile,
    fxaa:    !isMobile,
    bokeh:   !isMobile
  };

  var AMBIENT_COUNT = _pc ? (isMobile ? _pc.ambient.countMobile : (isTablet ? _pc.ambient.countTablet : _pc.ambient.countDesktop)) : (isMobile ? 30 : (isTablet ? 50 : 100));

  // === SMOOTH CAMERA SYSTEM ===
  var cameraLookTarget = new THREE.Vector3(-0.15, 1.563, 0.4);
  var cameraCurrentLook = new THREE.Vector3(-0.15, 1.563, 0.4);
  var cameraTargetPos = new THREE.Vector3(-0.15, 2.6, 0.4);
  var cameraTargetFov = 50;
  var CAMERA_POS_SMOOTH = 2.5;    // Base cinematic inertia — adaptive boost added for fast scroll
  var CAMERA_LOOK_SMOOTH = 3.0;   // Base look transitions — adaptive boost for fast pan
  var CAMERA_FOV_SMOOTH = 1.2;    // No jarring FOV shifts (slower transitions)

  // === FPS LIMITER ===
  var lastFrameTime = 0;
  var targetFPS = _tierSettings.fpsTarget;
  var frameDuration = 1000 / targetFPS;
  var deltaTime = 0.016; // default 60fps frame time in seconds
  var _animTime = 0;     // cached time from animate loop (performance.now * 0.001)

  // === AUTO-PERFORMANCE DETECTION ===
  var fpsFrameCount = 0;
  var fpsAccumulator = 0;
  var _isMobileDevice = /Mobi|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
  var perfBloomDisabled = !_tierSettings.bloom;  // off on mobile and low/ultra-low tiers
  var perfFxaaDisabled  = !_tierSettings.fxaa;   // off on mobile and low/ultra-low tiers

  // Reusable temp vector (avoid per-frame allocations)
  var _scTmpV = new THREE.Vector3();

  // === SMOOTH LIGHT TRANSITION TARGETS ===
  var lightTargets = {
    ambient: 0.25, spot: 1.5, inkwell: 0.3, fill: 0.5,
    particleR: 0.831, particleG: 0.686, particleB: 0.216,
    particleOpacity: 0.5,
    fogR: 0.027, fogG: 0.102, fogB: 0.090
  };
  var LIGHT_SMOOTH = 2.5; // exponential damping speed for lights

  // === FRAME-RATE INDEPENDENT EXPONENTIAL DAMPING ===
  function dampVal(current, target, speed, dt) {
    var diff = target - current;
    if (diff > -0.0001 && diff < 0.0001) return target;
    return current + diff * (1 - Math.exp(-speed * dt));
  }
  function dampVec3(vec, target, speed, dt) {
    var dx = target.x - vec.x, dy = target.y - vec.y, dz = target.z - vec.z;
    if (dx > -0.0001 && dx < 0.0001 && dy > -0.0001 && dy < 0.0001 && dz > -0.0001 && dz < 0.0001) {
      vec.x = target.x; vec.y = target.y; vec.z = target.z;
      return;
    }
    var f = 1 - Math.exp(-speed * dt);
    vec.x += dx * f;
    vec.y += dy * f;
    vec.z += dz * f;
  }

  // === TEXTURE RESOLUTION ===
  var TEX_SIZE = isMobile ? 512 : 1024;

  // Reliable texture loader — tries Image→Canvas approach, falls back to canvas art
  var isHttpProtocol = window.location.protocol.indexOf('http') === 0;

  function loadImageTexture(src, onLoad, fallbackCanvas) {
    // Strategy: Try TextureLoader first (works on HTTP and some file:// setups).
    // On failure, try canvas-redraw approach to avoid WebGL taint.
    // Final fallback: use the generated canvas art.
    var loader = new THREE.TextureLoader();
    var maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    loader.load(src, function(tex) {
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = maxAniso;
      tex.generateMipmaps = true;
      onLoad(tex);
    }, undefined, function() {
      // TextureLoader failed — try manual Image + canvas redraw
      var img = new Image();
      img.onload = function() {
        try {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth || img.width || 512;
          c.height = img.naturalHeight || img.height || 512;
          var cx = c.getContext('2d');
          cx.drawImage(img, 0, 0, c.width, c.height);
          var tex = new THREE.CanvasTexture(c);
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.anisotropy = maxAniso;
          tex.generateMipmaps = true;
          tex.needsUpdate = true;
          onLoad(tex);
        } catch (e) {
          console.warn('KRKAI: Canvas taint for', src);
          useFallback();
        }
      };
      img.onerror = function() {
        console.warn('KRKAI: Image load failed:', src);
        useFallback();
      };
      img.src = src;
    });

    function useFallback() {
      if (fallbackCanvas) {
        var fallbackTex = new THREE.CanvasTexture(fallbackCanvas);
        fallbackTex.minFilter = THREE.LinearMipmapLinearFilter;
        fallbackTex.magFilter = THREE.LinearFilter;
        fallbackTex.anisotropy = maxAniso;
        fallbackTex.generateMipmaps = true;
        onLoad(fallbackTex);
      }
    }
  }

  // Create golden Tamil calligraphy texture for parchment
  function createTamilCalligraphyTexture() {
    var canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 384;
    var ctx = canvas.getContext('2d');

    // Dark parchment background (matches 3.png cinematic look — dark surface, golden text)
    ctx.fillStyle = '#0A0505';
    ctx.fillRect(0, 0, 512, 384);

    // Subtle dark grain effect
    for (var i = 0; i < 1000; i++) {
      var x = Math.random() * 512;
      var y = Math.random() * 384;
      ctx.fillStyle = 'rgba(20,10,5,' + (Math.random() * 0.15) + ')';
      ctx.fillRect(x, y, 1, 1);
    }

    // Bright golden Tamil text — glowing on dark surface (3.png effect)
    ctx.fillStyle = '#FFD700';
    ctx.strokeStyle = '#DAA520';
    ctx.lineWidth = 1.5;
    ctx.textAlign = 'center';

    // Main Tamil title
    ctx.font = 'bold 52px serif';
    ctx.fillText('கற்கை நன்றே', 256, 100);
    ctx.strokeText('கற்கை நன்றே', 256, 100);

    // Subtitle
    ctx.font = '36px serif';
    ctx.fillText('கற்க கசடறக் கற்பவை', 256, 170);

    // English translation
    ctx.font = 'italic 20px Georgia, serif';
    ctx.fillStyle = '#DAA520';
    ctx.fillText('"Learn thoroughly what you learn"', 256, 230);

    // Decorative line
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, 260);
    ctx.lineTo(432, 260);
    ctx.stroke();

    // Dark crimson border frame (like 3.png)
    ctx.strokeStyle = '#3A0A0A';
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, 500, 372);
    ctx.strokeStyle = '#DAA520';
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, 484, 356);

    // KRKAI text
    ctx.font = 'bold 28px Georgia, serif';
    ctx.fillStyle = '#DAA520';
    ctx.fillText('KRKAI — கார்த்திகேஷ் ரோபோடிக்ஸ்', 256, 310);

    // Small decorative flourishes
    ctx.font = '18px serif';
    ctx.fillText('✦  ✦  ✦', 256, 350);

    var tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    tex.generateMipmaps = true;
    return tex;
  }

  // Create realistic plaster/stucco wall texture
  function createWallTexture() {
    var S = TEX_SIZE;
    var canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    var ctx = canvas.getContext('2d');

    // Fast ImageData approach — avoids 18k CSS string parses from fillStyle in a loop
    var imgData = ctx.createImageData(S, S);
    var d = imgData.data;
    // Base deep purple color #1A0F30
    for (var p = 0; p < S * S * 4; p += 4) {
      d[p] = 0x1A; d[p+1] = 0x0F; d[p+2] = 0x30; d[p+3] = 255;
    }
    // Subtle stucco grain — direct pixel manipulation, no fillStyle/fillRect per iteration
    var noiseCount = Math.floor(18000 * (S / 512) * (S / 512));
    for (var i = 0; i < noiseCount; i++) {
      var x = (Math.random() * (S - 1)) | 0;
      var y = (Math.random() * (S - 1)) | 0;
      var alpha = (Math.random() * 0.04 * 255) | 0;
      var isWhite = Math.random() > 0.5;
      for (var dy = 0; dy < 2; dy++) {
        for (var dx = 0; dx < 2; dx++) {
          var pi = ((y + dy) * S + (x + dx)) * 4;
          if (isWhite) {
            d[pi]   = Math.min(255, d[pi]   + alpha);
            d[pi+1] = Math.min(255, d[pi+1] + alpha);
            d[pi+2] = Math.min(255, d[pi+2] + alpha);
          } else {
            var darkAlpha = (alpha * 1.5) | 0;
            d[pi]   = Math.max(0, d[pi]   - ((d[pi]   * darkAlpha) >> 8));
            d[pi+1] = Math.max(0, d[pi+1] - ((d[pi+1] * darkAlpha) >> 8));
            d[pi+2] = Math.max(0, d[pi+2] - ((d[pi+2] * darkAlpha) >> 8));
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Soft ambient occlusion gradient — dark purple shadows
    var g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, 'rgba(8, 3, 18, 0.3)');
    g.addColorStop(0.12, 'rgba(8, 3, 18, 0.0)');
    g.addColorStop(0.88, 'rgba(8, 3, 18, 0.0)');
    g.addColorStop(1, 'rgba(8, 3, 18, 0.4)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    tex.generateMipmaps = true;
    // Repeat to cover walls properly
    tex.repeat.set(4, 2);
    return tex;
  }

  // Generate poster canvas art (fallbacks when image loading fails)
  function createPosterCanvas(index) {
    var canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    var ctx = canvas.getContext('2d');
    var designs = [
      function(ctx) { // Poster 1: KRKAI — clean minimal
        ctx.fillStyle = '#0A1A18'; ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = '#D4AF37'; ctx.lineWidth = 1;
        ctx.strokeRect(24, 24, 464, 464);
        ctx.font = 'bold 56px Georgia, serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#E8F0EE'; ctx.fillText('KRKAI', 256, 200);
        ctx.font = '24px serif'; ctx.fillStyle = '#9A8AAE';
        ctx.fillText('Free Robotics Education', 256, 280);
        ctx.fillText('for Every Child', 256, 315);
        ctx.strokeStyle = '#D4AF37'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(160, 360); ctx.lineTo(352, 360); ctx.stroke();
        ctx.font = '18px serif'; ctx.fillStyle = '#9A8AAE';
        ctx.fillText('Tamil Nadu, India', 256, 400);
      },
      function(ctx) { // Poster 2: Community
        ctx.fillStyle = '#0A1A18'; ctx.fillRect(0, 0, 512, 512);
        ctx.fillStyle = '#E8F0EE'; ctx.font = 'bold 28px Georgia, serif';
        ctx.textAlign = 'center'; ctx.fillText('Our Community', 256, 180);
        ctx.strokeStyle = '#D4AF37'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(160, 200); ctx.lineTo(352, 200); ctx.stroke();
        ctx.fillStyle = '#9A8AAE'; ctx.font = '20px serif';
        ctx.fillText('Building Tomorrow', 256, 280);
        ctx.fillText('Together', 256, 310);
        // Minimal figures
        ctx.fillStyle = '#2A8B7A';
        for (var s = 0; s < 5; s++) {
          var sx = 140 + s * 60;
          ctx.beginPath(); ctx.arc(sx, 390, 8, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(sx - 5, 400, 10, 20);
        }
      },
      function(ctx) { // Poster 3: Tamil wisdom — parchment style
        ctx.fillStyle = '#F5E6C8'; ctx.fillRect(0, 0, 512, 512);
        ctx.fillStyle = '#0A1A18'; ctx.font = '28px serif'; ctx.textAlign = 'center';
        ctx.fillText('கற்க கசடறக் கற்பவை', 256, 160);
        ctx.fillText('கற்றபின் நிற்க அதற்குத்', 256, 220);
        ctx.fillText('தக', 256, 270);
        ctx.strokeStyle = '#D4AF37'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(120, 310); ctx.lineTo(392, 310); ctx.stroke();
        ctx.fillStyle = '#9A8AAE'; ctx.font = 'italic 16px Georgia, serif';
        ctx.fillText('"Learn well what is to be learnt"', 256, 360);
      },
      function(ctx) { // Poster 4: KRKAI logo — dark minimal
        ctx.fillStyle = '#0A0308'; ctx.fillRect(0, 0, 512, 512);
        ctx.font = 'bold 72px Georgia, serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#E8F0EE'; ctx.fillText('KR', 256, 220);
        ctx.fillText('KAI', 256, 300);
        ctx.strokeStyle = '#D4AF37'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(160, 330); ctx.lineTo(352, 330); ctx.stroke();
        ctx.font = '18px serif'; ctx.fillStyle = '#9A8AAE';
        ctx.fillText('KARTHIKESH ROBOTICS', 256, 370);
        ctx.fillText('& AI', 256, 400);
      },
      function(ctx) { // Poster 5: Badge — minimal
        ctx.fillStyle = '#0A1A18'; ctx.fillRect(0, 0, 512, 512);
        ctx.beginPath(); ctx.arc(256, 256, 130, 0, Math.PI * 2);
        ctx.strokeStyle = '#D4AF37'; ctx.lineWidth = 2; ctx.stroke();
        ctx.font = 'bold 44px Georgia, serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#E8F0EE'; ctx.fillText('KRKAI', 256, 265);
        ctx.font = '16px serif'; ctx.fillStyle = '#9A8AAE';
        ctx.fillText('EST. 2024', 256, 305);
      }
    ];
    designs[index](ctx);
    return canvas;
  }

  // Create a circular canvas texture so particles appear as circles (not squares)
  var _cachedCircleTex = null;
  function createCircleTexture() {
    if (_cachedCircleTex) return _cachedCircleTex;
    var size = 64;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    var tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    _cachedCircleTex = tex;
    return tex;
  }

  function init() {
    var canvas = document.getElementById('three-canvas');
    if (!canvas) return;

    // Renderer — pixel ratio and antialias from hardware tier
    var pixelRatio = Math.min(window.devicePixelRatio, _tierSettings.pixelRatioMax);
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: (_tier === 'high' || _tier === 'mid'),
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor(0x0A0308);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.9;  // matches p<0.05 target — no first-frame flash

    // === MINIMAL SHADOWS (tier-based — disabled on low/ultra-low) ===
    if (_tierSettings.shadows) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    // Camera — directly above parchment, looking down at pen nib + dark calligraphy (3.png recreation)
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(-0.15, 2.6, 0.4);
    camera.lookAt(-0.15, 1.563, 0.4);

    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0A0308, 0.022);  // warm dark purple-black, lower density so particles glow through

    buildLights();
    buildRoom();
    buildWallArt();
    buildAmbientParticles();
    buildMagicalParticles();
    buildButterflyParticles();
    buildFlowerParticles();

    // === BAKE STATIC SHADOW MAP (render once — geometry never moves) ===
    if (_tierSettings.shadows && renderer.shadowMap.enabled) {
      renderer.shadowMap.autoUpdate  = false;
      renderer.shadowMap.needsUpdate = true;  // forces one render on first frame
    }

    // === POST-PROCESSING PIPELINE (tier-based) ===
    var _usePP = (_tier === 'high' || _tier === 'mid') && typeof THREE.EffectComposer !== 'undefined';
    if (_usePP) {
      composer = new THREE.EffectComposer(renderer);
      composer.addPass(new THREE.RenderPass(scene, camera));

      // Unreal Bloom — half-resolution bloom (blur hides lower resolution, saves 75% GPU on 2x DPR)
      var bloomScale = pixelRatio >= 1.5 ? 0.5 : 0.75;
      var resolution = new THREE.Vector2(window.innerWidth * pixelRatio * bloomScale, window.innerHeight * pixelRatio * bloomScale);
      bloomPass = new THREE.UnrealBloomPass(resolution, 0.0, 0.40, 0.90);
      // strength: starts at 0 (no bloom at intro overhead view), radius: 0.40 (tight), threshold: 0.90 (only true emissives bloom — prevents parchment washout)
      bloomPass.enabled = false;  // disabled until strength > 0 (saves a full render pass)
      composer.addPass(bloomPass);

      // === DEPTH OF FIELD (BokehPass) — high tier only ===
      if (_tierSettings.bokeh && !_isMobileDevice && typeof THREE.BokehPass !== 'undefined' && typeof THREE.BokehShader !== 'undefined') {
        try {
          bokehPass = new THREE.BokehPass(scene, camera, {
            focus: 2.0,
            aperture: 0.0008,
            maxblur: 0.008
          });
          composer.addPass(bokehPass);
        } catch (e) {
          bokehPass = null;
        }
      }

      // FXAA — fast anti-aliasing pass (high/mid tier only)
      if (_tierSettings.fxaa && typeof THREE.FXAAShader !== 'undefined') {
        var fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
        var fxaaW = window.innerWidth * pixelRatio;
        var fxaaH = window.innerHeight * pixelRatio;
        fxaaPass.material.uniforms['resolution'].value.set(1 / fxaaW, 1 / fxaaH);
        composer.addPass(fxaaPass);
      }
    }

    // === PAUSE WHEN TAB IS HIDDEN ===
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        isRunning = false;
      } else {
        if (!isRunning) {
          isRunning = true;
          lastFrameTime = performance.now();
          animate();
        }
      }
    });

    window.addEventListener('resize', onResize);
    isRunning = true;
    lastFrameTime = performance.now();
    animate();
  }

  // === LIGHTS ===
  function buildLights() {
    // 1. Ambient — warm amber glow (enough for walls to be visible)
    ambientLight = new THREE.AmbientLight(0x4A2A08, 0.25);  // match lightTargets.ambient target
    scene.add(ambientLight);

    // 2. SpotLight — initialized at lightTargets.spot target to avoid first-frame flash
    spotLight = new THREE.SpotLight(0xFFAA44, 1.5);
    spotLight.position.set(0, 5.5, -5);
    spotLight.angle = Math.PI / 4;
    spotLight.penumbra = 0.70;
    spotLight.distance = 22;
    spotLight.target.position.set(0, 1.5, 0.5);
    if (!isMobile) {
      spotLight.castShadow = true;
      spotLight.shadow.mapSize.width = 1024;
      spotLight.shadow.mapSize.height = 1024;
      spotLight.shadow.camera.near = 0.5;
      spotLight.shadow.camera.far = 22;
      spotLight.shadow.bias = -0.001;
      spotLight.shadow.radius = 4;
    }
    scene.add(spotLight);
    scene.add(spotLight.target);

    // 3. Inkwell light — kept as variable (referenced in update loop) but not added to scene
    inkwellLight = new THREE.PointLight(0xFFD700, 0.0, 3);
    inkwellLight.position.set(0, 1.74, 0.5);

    // 4. Fill light — moderate front fill (keeps desk + foreground visible)
    fillLight = new THREE.PointLight(0xFF8C30, 0.50, 15);  // match lightTargets.fill target
    fillLight.position.set(0, 4.5, 2.0);
    scene.add(fillLight);

    // 5. Nib light — gold glow following pen (kept subtle to avoid bloom wash)
    nibLight = new THREE.PointLight(0xFFD700, 0.15, 2);
    nibLight.position.set(-0.15, 1.7, 0.4);
    scene.add(nibLight);

    // Warm golden wall fills — reduced but still visible
    var wallFillA = new THREE.PointLight(0xFFB347, 0.40, 20);
    wallFillA.position.set(-3.5, 2.5, 1.0);
    scene.add(wallFillA);
    var wallFillB = new THREE.PointLight(0xFFB347, 0.35, 20);
    wallFillB.position.set(3.5, 2.5, -1.5);
    scene.add(wallFillB);

    // Back wall golden glow — warm arched window effect
    var backWallGlow = new THREE.PointLight(0xFFCC55, 1.5, 18);
    backWallGlow.position.set(0, 3.2, -4.5);
    scene.add(backWallGlow);

    // Cluster point lights — each bush cluster glows from within
    var clusterLights = [
      { color: 0xFFAA33, intensity: 1.2, range: 4.5, x: -3.8, y: 1.8, z:  1.5 },
      { color: 0xFFAA33, intensity: 1.2, range: 4.5, x:  3.8, y: 1.8, z: -1.5 },
      { color: 0xFFCC44, intensity: 1.5, range: 5.0, x: -2.0, y: 3.5, z: -3.7 },
      { color: 0xFFCC44, intensity: 1.5, range: 5.0, x:  2.0, y: 3.5, z: -3.7 },
      { color: 0xFFAA33, intensity: 0.9, range: 4.0, x:  1.5, y: 4.0, z: -1.0 },
      { color: 0xFFAA33, intensity: 0.9, range: 4.0, x: -3.0, y: 2.0, z: -1.5 },
      { color: 0xFFCC44, intensity: 0.8, range: 3.5, x:  3.0, y: 0.9, z:  1.5 },
      { color: 0xFFCC44, intensity: 0.8, range: 3.5, x:  0.0, y: 2.2, z:  1.8 },
      // New clusters for expanded room coverage
      { color: 0xFFBB44, intensity: 0.7, range: 4.0, x: -4.0, y: 4.5, z: -2.5 },
      { color: 0xFFBB44, intensity: 0.7, range: 4.0, x:  4.0, y: 4.5, z:  0.5 },
      { color: 0xFF99AA, intensity: 0.6, range: 3.5, x:  0.0, y: 5.0, z: -1.5 },
      { color: 0xFFCC55, intensity: 0.6, range: 3.5, x: -2.0, y: 1.2, z: -2.5 },
      { color: 0xFFCC55, intensity: 0.6, range: 3.5, x:  2.0, y: 1.2, z:  0.5 }
    ];
    var clusterBrightness = (_pc && _pc.clusterBrightness) ? _pc.clusterBrightness : 1.0;
    clusterLights.forEach(function(cl) {
      var light = new THREE.PointLight(cl.color, cl.intensity * clusterBrightness, cl.range);
      light.position.set(cl.x, cl.y, cl.z);
      scene.add(light);
    });
  }

  // === ROOM GEOMETRY ===
  function buildRoom() {
    var woodMat = new THREE.MeshStandardMaterial({ color: 0x5C4033, roughness: 0.7, metalness: 0.0 });
    woodMat.receiveShadow = true;
    
    // Enhanced wall material with procedural texture
    var wallTex = createWallTexture();
    var wallMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      roughness: 0.92,
      metalness: 0.0,
      color: 0x1A0F30,
      side: THREE.DoubleSide
    });

    var ceilMat = new THREE.MeshStandardMaterial({ color: 0x0A0415, roughness: 1.0, metalness: 0 }); // Very dark purple ceiling
    var brassMat = new THREE.MeshStandardMaterial({ color: 0xD4AF37, roughness: 0.4, metalness: 0.5 }); // Rich gold brass
    var darkBrassMat = new THREE.MeshStandardMaterial({ color: 0x18083A, roughness: 0.4, metalness: 0.5 }); // Dark purple-brass
    var inkMat = new THREE.MeshStandardMaterial({ color: 0x050005, roughness: 0.1, metalness: 0.9 });
    var deskMat = new THREE.MeshStandardMaterial({ color: 0x0A0505, roughness: 0.35, metalness: 0.12 }); // Dark desk surface to match 3.png cinematic look

    // Rich dark wood for wainscoting
    var wainscotMat = new THREE.MeshStandardMaterial({ color: 0x3D2B1F, roughness: 0.75, metalness: 0.0 });
    var moldingMat = new THREE.MeshStandardMaterial({ color: 0xD4AF37, roughness: 0.4, metalness: 0.4 });

    // Floor
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), woodMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    if (!isMobile) floor.receiveShadow = true;
    scene.add(floor);
    room.floor = floor;

    // Back wall
    var backWall = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), wallMat);
    backWall.position.set(0, 3, -4);
    scene.add(backWall);

    // Left wall
    var leftWall = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-5, 3, 0);
    scene.add(leftWall);

    // Right wall
    var rightWall = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), wallMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(5, 3, 0);
    scene.add(rightWall);

    // Front wall (closes the room — prevents black void)
    var frontWall = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), wallMat);
    frontWall.rotation.y = Math.PI;
    frontWall.position.set(0, 3, 4);
    scene.add(frontWall);

    // Ceiling base
    var ceiling = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 6;
    scene.add(ceiling);

    // === ORNATE CEILING DECORATION ===
    var ceilOrnamentMat = new THREE.MeshStandardMaterial({ color: 0x0F2A28, roughness: 0.7, metalness: 0.05 });
    var ceilGoldMat = new THREE.MeshStandardMaterial({ color: 0xD4AF37, roughness: 0.3, metalness: 0.6 });
    // ceilDarkMat removed — unused

    // Center ceiling medallion — concentric rings
    var medallionGroup = new THREE.Group();
    medallionGroup.position.set(0, 5.98, 0);
    medallionGroup.rotation.x = -Math.PI / 2;

    // Outer ring
    var outerRing = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.15, 48),
      ceilGoldMat
    );
    medallionGroup.add(outerRing);

    // Middle ring
    var midRing = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 0.75, 48),
      ceilGoldMat
    );
    medallionGroup.add(midRing);

    // Inner ring
    var innerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.38, 48),
      ceilGoldMat
    );
    medallionGroup.add(innerRing);

    // Center disc
    var centerDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 48),
      ceilOrnamentMat
    );
    medallionGroup.add(centerDisc);

    // Decorative radial lines (like sun rays from center)
    for (var r = 0; r < 12; r++) {
      var angle = (r / 12) * Math.PI * 2;
      var rayLine = new THREE.Mesh(
        new THREE.PlaneGeometry(0.03, 0.85),
        ceilGoldMat
      );
      rayLine.position.set(
        Math.cos(angle) * 0.55,
        Math.sin(angle) * 0.55,
        0.001
      );
      rayLine.rotation.z = angle + Math.PI / 2;
      medallionGroup.add(rayLine);
    }

    scene.add(medallionGroup);

    // Coffered ceiling grid — recessed panels with molding borders
    var cofferMat = new THREE.MeshStandardMaterial({ color: 0x112E2A, roughness: 0.85, metalness: 0.0 });
    var cofferBorderMat = new THREE.MeshStandardMaterial({ color: 0xD4AF37, roughness: 0.4, metalness: 0.4 });

    var cofferCols = 4;
    var cofferRows = 3;
    var cofferW = 10 / cofferCols;
    var cofferD = 8 / cofferRows;
    var cofferInset = 0.15;

    for (var cx = 0; cx < cofferCols; cx++) {
      for (var cz = 0; cz < cofferRows; cz++) {
        var cpx = -5 + cofferW / 2 + cx * cofferW;
        var cpz = -4 + cofferD / 2 + cz * cofferD;

        // Skip if too close to medallion center
        if (Math.sqrt(cpx * cpx + cpz * cpz) < 1.5) continue;

        // Recessed panel (slightly below ceiling)
        var panel = new THREE.Mesh(
          new THREE.PlaneGeometry(cofferW - cofferInset * 2, cofferD - cofferInset * 2),
          cofferMat
        );
        panel.rotation.x = Math.PI / 2;
        panel.position.set(cpx, 5.96, cpz);
        scene.add(panel);

        // Panel border — 4 thin strips
        var bThick = 0.06;
        var bW = cofferW - cofferInset * 2;
        var bD = cofferD - cofferInset * 2;

        // Top border
        var topB = new THREE.Mesh(new THREE.BoxGeometry(bW, 0.04, bThick), cofferBorderMat);
        topB.position.set(cpx, 5.97, cpz - bD / 2);
        scene.add(topB);
        // Bottom border
        var botB = new THREE.Mesh(new THREE.BoxGeometry(bW, 0.04, bThick), cofferBorderMat);
        botB.position.set(cpx, 5.97, cpz + bD / 2);
        scene.add(botB);
        // Left border
        var lefB = new THREE.Mesh(new THREE.BoxGeometry(bThick, 0.04, bD), cofferBorderMat);
        lefB.position.set(cpx - bW / 2, 5.97, cpz);
        scene.add(lefB);
        // Right border
        var rigB = new THREE.Mesh(new THREE.BoxGeometry(bThick, 0.04, bD), cofferBorderMat);
        rigB.position.set(cpx + bW / 2, 5.97, cpz);
        scene.add(rigB);
      }
    }

    // Chandelier — simple elegant hanging fixture at center
    var chandelierGroup = new THREE.Group();
    chandelierGroup.position.set(0, 5.5, 0);

    // Chain/rod from ceiling
    var rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.5, 8),
      ceilGoldMat
    );
    rod.position.y = 0.25;
    chandelierGroup.add(rod);

    // Main ring
    var chanRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.35, 0.025, 12, 32),
      ceilGoldMat
    );
    chandelierGroup.add(chanRing);

    // Inner decorative ring
    var chanRingInner = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.015, 12, 32),
      ceilGoldMat
    );
    chanRingInner.position.y = -0.05;
    chandelierGroup.add(chanRingInner);

    // Light bulb positions — warm glow points
    for (var li = 0; li < 6; li++) {
      var la = (li / 6) * Math.PI * 2;
      // Small sphere as bulb
      var bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xFFF5E6, emissive: 0xFFE4B5, emissiveIntensity: 1.5, roughness: 0.2 })
      );
      bulb.position.set(Math.cos(la) * 0.35, 0, Math.sin(la) * 0.35);
      chandelierGroup.add(bulb);

      // Arm connecting ring to bulb
      var arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6),
        ceilGoldMat
      );
      arm.position.set(Math.cos(la) * 0.35, 0.04, Math.sin(la) * 0.35);
      chandelierGroup.add(arm);
    }

    // Chandelier warm light
    var chanLight = new THREE.PointLight(0xFFE4B5, 0.6, 8);
    chanLight.position.set(0, -0.1, 0);
    chandelierGroup.add(chanLight);

    scene.add(chandelierGroup);

    // === FULL WAINSCOTING SYSTEM ===
    
    function createWainscoting(width, posX, posZ, rotY) {
      var group = new THREE.Group();
      
      // Main back panel for lower wall
      var panelH = 1.4;
      var backPanel = new THREE.Mesh(new THREE.BoxGeometry(width, panelH, 0.03), wainscotMat);
      backPanel.position.set(0, panelH/2, 0);
      group.add(backPanel);
      
      // Baseboard
      var baseboard = new THREE.Mesh(new THREE.BoxGeometry(width, 0.18, 0.05), moldingMat);
      baseboard.position.set(0, 0.09, 0.01);
      group.add(baseboard);
      
      // Chair rail (top molding)
      var chairRail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 0.06), moldingMat);
      chairRail.position.set(0, panelH, 0.015);
      group.add(chairRail);
      
      // Decorative recessed panels
      var panelWidth = 1.2;
      var panelCount = Math.floor(width / panelWidth);
      var spacing = (width - (panelCount * panelWidth)) / (panelCount + 1);
      
      for (var p = 0; p < panelCount; p++) {
        var px = -width/2 + spacing + panelWidth/2 + p * (panelWidth + spacing);
        
        // Inner recessed box
        var trim = new THREE.Mesh(
          new THREE.BoxGeometry(panelWidth - 0.1, panelH - 0.4, 0.045),
          moldingMat
        );
        trim.position.set(px, panelH/2, 0.005);
        group.add(trim);
        
        var inner = new THREE.Mesh(
          new THREE.BoxGeometry(panelWidth - 0.16, panelH - 0.46, 0.05),
          wainscotMat
        );
        inner.position.set(px, panelH/2, 0.005);
        group.add(inner);
      }
      
      group.position.set(posX, 0, posZ);
      group.rotation.y = rotY;
      return group;
    }

    // Add wainscoting to walls
    scene.add(createWainscoting(10, 0, -3.97, 0)); // Back wall
    scene.add(createWainscoting(8, -4.97, 0, Math.PI / 2)); // Left wall
    scene.add(createWainscoting(8, 4.97, 0, -Math.PI / 2)); // Right wall
    scene.add(createWainscoting(10, 0, 3.97, Math.PI)); // Front wall

    // Crown Molding at Ceiling (all 4 walls)
    var crownMat = moldingMat;
    var backCrown = new THREE.Mesh(new THREE.BoxGeometry(10, 0.15, 0.15), crownMat);
    backCrown.position.set(0, 5.925, -3.925);
    scene.add(backCrown);

    var frontCrown = new THREE.Mesh(new THREE.BoxGeometry(10, 0.15, 0.15), crownMat);
    frontCrown.position.set(0, 5.925, 3.925);
    scene.add(frontCrown);

    var leftCrown = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 8), crownMat);
    leftCrown.position.set(-4.925, 5.925, 0);
    scene.add(leftCrown);

    var rightCrown = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 8), crownMat);
    rightCrown.position.set(4.925, 5.925, 0);
    scene.add(rightCrown);

    // === DESK ===
    var deskTop = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 1.5), deskMat);
    deskTop.position.set(0, 1.5, 0.5);
    if (!isMobile) { deskTop.castShadow = true; deskTop.receiveShadow = true; }
    scene.add(deskTop);

    // Desk trim
    var deskTrim = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.04, 1.6), brassMat);
    deskTrim.position.set(0, 1.54, 0.5);
    scene.add(deskTrim);

    // Desk legs
    var legGeo = new THREE.BoxGeometry(0.08, 1.5, 0.08);
    var legPositions = [
      [-1.4, 0.75, -0.15], [1.4, 0.75, -0.15],
      [-1.4, 0.75, 1.15], [1.4, 0.75, 1.15]
    ];
    for (var i = 0; i < legPositions.length; i++) {
      var leg = new THREE.Mesh(legGeo, deskMat);
      leg.position.set(legPositions[i][0], legPositions[i][1], legPositions[i][2]);
      scene.add(leg);
    }


    // === WINDOW (right wall glow) ===
    var windowFrame = new THREE.Group();
    var frameMat = brassMat;
    var fTop = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.06), frameMat);
    fTop.position.set(0, 0.9, 0);
    windowFrame.add(fTop);
    var fBot = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.06), frameMat);
    fBot.position.set(0, -0.9, 0);
    windowFrame.add(fBot);
    var fLeft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.8, 0.06), frameMat);
    fLeft.position.set(-0.67, 0, 0);
    windowFrame.add(fLeft);
    var fRight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.8, 0.06), frameMat);
    fRight.position.set(0.67, 0, 0);
    windowFrame.add(fRight);
    windowFrame.rotation.y = -Math.PI / 2;
    windowFrame.position.set(4.97, 3.5, 0);
    scene.add(windowFrame);

    // Window pane — visible glow effect
    var windowPane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 1.8),
      new THREE.MeshBasicMaterial({ color: 0xFFCC88, transparent: true, opacity: 0.15 })
    );
    windowPane.rotation.y = -Math.PI / 2;
    windowPane.position.set(4.96, 3.5, 0);
    scene.add(windowPane);
    room.windowPane = windowPane;

    // Window cross-bars (mullions)
    var mullionMat = new THREE.MeshStandardMaterial({ color: 0xD4AF37, roughness: 0.4, metalness: 0.5 });
    var hMullion = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.8, 0.04), mullionMat);
    hMullion.rotation.y = -Math.PI / 2;
    hMullion.position.set(4.97, 3.5, 0);
    scene.add(hMullion);
    var vMullion = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 1.2), mullionMat);
    vMullion.position.set(4.97, 3.5, 0);
    scene.add(vMullion);

    // Window sill
    var windowSill = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.05, 1.5), mullionMat
    );
    windowSill.position.set(4.85, 2.6, 0);
    scene.add(windowSill);

    // Outer glow behind window (simulates daylight/moonlight)
    var windowGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 2.0),
      new THREE.MeshBasicMaterial({
        color: 0xFFCC88, transparent: true, opacity: 0.06,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      })
    );
    windowGlow.rotation.y = -Math.PI / 2;
    windowGlow.position.set(4.98, 3.5, 0);
    scene.add(windowGlow);

    // === VOLUMETRIC LIGHT SHAFT from window (desktop only) ===
    if (!isMobile) {
      var shaftGeo = new THREE.ConeGeometry(2.5, 6, 32, 1, true);
      var shaftMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0xFFCC88) },
          uOpacity: { value: 0.06 }
        },
        vertexShader: [
          'varying float vY;',
          'void main() {',
          '  vY = position.y;',
          '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 uColor;',
          'uniform float uOpacity;',
          'varying float vY;',
          'void main() {',
          '  float fade = smoothstep(-3.0, 3.0, vY);',
          '  gl_FragColor = vec4(uColor, uOpacity * fade);',
          '}'
        ].join('\n'),
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      var lightShaft = new THREE.Mesh(shaftGeo, shaftMat);
      lightShaft.position.set(3.0, 2.5, 0);
      lightShaft.rotation.z = Math.PI / 6; // angled from window
      scene.add(lightShaft);
      room.lightShaft = lightShaft;
    }

    // === BOOKSHELVES (left wall) — skip on mobile ===
    if (!isMobile) {
      buildBookshelves(deskMat, wallMat);
    }

    // === ROBOTICS DESK ITEMS (replaces globe) ===
    buildDeskItems(brassMat);

    // === ENRICHED SCHOLAR'S STUDY OBJECTS ===
    buildStudyObjects();

    // === LARGE PARCHMENT WITH 3.PNG IMAGE ===
    var fallbackCanvas = createTamilCalligraphyTexture();
    // Start with fallback canvas texture, then upgrade to 3.png when loaded
    // Use MeshStandardMaterial for proper mipmap filtering at angled views (prevents line artifacts)
    var parchMat = new THREE.MeshStandardMaterial({
      map: fallbackCanvas,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0.0,
      emissive: 0x221100,
      emissiveIntensity: 0.15,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4
    });
    // Load the actual parchment image (WebP preferred, PNG fallback)
    loadImageTexture('images/3.webp', function(tex) {
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
      tex.generateMipmaps = true;
      // Prevent texture shimmering at oblique angles
      if (tex.image) {
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
      }
      parchMat.map = tex;
      parchMat.needsUpdate = true;
    }, fallbackCanvas.image);

    var rollerMat = new THREE.MeshStandardMaterial({ color: 0x5A3015, roughness: 0.6, metalness: 0.15 });

    // 3.png parchment on desk — fits within desk bounds (desk is 3x1.5 at y=1.5, center 0,0.5)
    var parchment = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), parchMat);
    parchment.rotation.x = -Math.PI / 2;
    parchment.position.set(-0.15, 1.563, 0.4);
    scene.add(parchment);

    // Rollers at top and bottom edges of parchment
    var roller1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 8), rollerMat);
    roller1.rotation.z = Math.PI / 2;
    roller1.position.set(-0.15, 1.57, -0.1);
    scene.add(roller1);
    var roller2 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 8), rollerMat);
    roller2.rotation.z = Math.PI / 2;
    roller2.position.set(-0.15, 1.57, 0.9);
    scene.add(roller2);

    // Warm light illuminating the parchment from above — kept low to prevent bloom washout at p=0
    var parchLight = new THREE.PointLight(0xFFDD88, 0.35, 3);
    parchLight.position.set(-0.15, 2.2, 0.4);
    scene.add(parchLight);
  }

  function buildBookshelves(deskMat, wallMat) {
    var shelfMat = new THREE.MeshStandardMaterial({ color: 0x4A2808, roughness: 0.7, metalness: 0.1 });
    var bookColors = [0x5C1A1A, 0x1A3D1A, 0x1A2040, 0x6B4A14, 0x3D2208, 0x253535, 0x5C1030];

    for (var s = 0; s < 3; s++) {
      var shelfY = 2 + s * 1.2;
      var shelf = new THREE.Mesh(new THREE.BoxGeometry(2, 0.06, 0.4), shelfMat);
      shelf.position.set(-3.8, shelfY, -3.6);
      shelf.rotation.y = Math.PI / 2;
      scene.add(shelf);

      // Books on shelf — positioned on the shelf surface
      // Shelf after PI/2 rotation: X range -4.0 to -3.6, Z range -4.6 to -2.6
      var bookZ = -0.8;
      for (var b = 0; b < 8; b++) {
        var bw = 0.06 + Math.random() * 0.06;
        var bh = 0.25 + Math.random() * 0.2;
        var bookMat = new THREE.MeshStandardMaterial({
          color: bookColors[Math.floor(Math.random() * bookColors.length)],
          roughness: 0.8, metalness: 0.05
        });
        var book = new THREE.Mesh(new THREE.BoxGeometry(0.3, bh, bw), bookMat);
        book.position.set(-3.85, shelfY + 0.03 + bh / 2, -3.6 + bookZ);
        book.rotation.y = (Math.random() - 0.5) * 0.08;
        scene.add(book);
        bookZ += bw + 0.02;
      }
    }
  }

  // === ROBOTICS DESK ITEMS ===
  function buildDeskItems(brassMat) {
    var robotGroup = new THREE.Group();
    var bodyMat = new THREE.MeshStandardMaterial({ color: 0xD4AF37, roughness: 0.4, metalness: 0.5 });
    var eyeMat = new THREE.MeshStandardMaterial({ color: 0xC0C0C0, emissive: 0x888888, emissiveIntensity: 0.3, roughness: 0.3, metalness: 0.5 });
    var darkMat = new THREE.MeshStandardMaterial({ color: 0x2C2C2C, roughness: 0.7, metalness: 0.3 });

    // Body
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.08), bodyMat);
    body.position.y = 0.08;
    robotGroup.add(body);

    // Head
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), bodyMat);
    head.position.y = 0.20;
    robotGroup.add(head);

    // Eyes
    var leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 8), eyeMat);
    leftEye.position.set(-0.02, 0.21, 0.04);
    robotGroup.add(leftEye);
    var rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 8), eyeMat);
    rightEye.position.set(0.02, 0.21, 0.04);
    robotGroup.add(rightEye);

    // Antenna
    var antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 6), darkMat);
    antenna.position.y = 0.27;
    robotGroup.add(antenna);
    var antTip = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 8), eyeMat);
    antTip.position.y = 0.305;
    robotGroup.add(antTip);

    // Arms
    var leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 6), darkMat);
    leftArm.position.set(-0.08, 0.08, 0);
    leftArm.rotation.z = 0.3;
    robotGroup.add(leftArm);
    var rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 6), darkMat);
    rightArm.position.set(0.08, 0.08, 0);
    rightArm.rotation.z = -0.3;
    robotGroup.add(rightArm);

    // Legs
    var leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6), darkMat);
    leftLeg.position.set(-0.03, -0.03, 0);
    robotGroup.add(leftLeg);
    var rightLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6), darkMat);
    rightLeg.position.set(0.03, -0.03, 0);
    robotGroup.add(rightLeg);

    robotGroup.position.set(0.8, 1.58, 0.3);
    robotGroup.scale.set(1.2, 1.2, 1.2);
    scene.add(robotGroup);

    // === CIRCUIT BOARD ===
    var boardMat = new THREE.MeshStandardMaterial({ color: 0x1A5C1A, roughness: 0.7, metalness: 0.1 });
    var board = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.015, 0.18), boardMat);
    board.position.set(1.1, 1.565, 0.6);
    scene.add(board);

    // Components on board
    var compColors = [0x222222, 0x1A2A6E, 0x8B1515, 0xCCA832, 0x1A1A1A];
    var compPositions = [[-0.06, 0.01, -0.04], [0.04, 0.01, -0.02], [-0.03, 0.01, 0.04], [0.07, 0.01, 0.03], [0, 0.01, 0]];
    for (var c = 0; c < compColors.length; c++) {
      var comp = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.015, 0.015),
        new THREE.MeshStandardMaterial({ color: compColors[c], roughness: 0.6, metalness: 0.2 })
      );
      comp.position.set(1.1 + compPositions[c][0], 1.565 + compPositions[c][1], 0.6 + compPositions[c][2]);
      scene.add(comp);
    }

    // Gold traces on board
    var traceMat = new THREE.MeshStandardMaterial({ color: 0xCCA832, roughness: 0.4, metalness: 0.5 });
    var trace1 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.002, 0.003), traceMat);
    trace1.position.set(1.1, 1.574, 0.58);
    scene.add(trace1);
    var trace2 = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.002, 0.12), traceMat);
    trace2.position.set(1.05, 1.574, 0.6);
    scene.add(trace2);

    // === GEAR ===
    var gear = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 16), brassMat);
    gear.rotation.x = Math.PI / 2;
    gear.position.set(1.15, 1.58, 0.2);
    scene.add(gear);
    room.gear = gear;
  }

  // === ENRICHED SCHOLAR'S STUDY OBJECTS (Phase 3 — enhanced) ===
  function buildStudyObjects() {
    if (isMobile) return;

    var goldMat = new THREE.MeshStandardMaterial({
      color: 0xD4AF37, roughness: 0.35, metalness: 0.6
    });
    var legMat = new THREE.MeshStandardMaterial({ color: 0x2C2C2C, roughness: 0.7, metalness: 0.3 });

    // --- GLOBE on floor (left of desk, larger) ---
    var globeGroup = new THREE.Group();
    // Stand base
    var standBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.18, 0.04, 16), goldMat
    );
    standBase.position.y = 0.02;
    globeGroup.add(standBase);
    // Stand pole
    var standPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), goldMat
    );
    standPole.position.y = 0.32;
    globeGroup.add(standPole);
    // Support arc
    var supportArc = new THREE.Mesh(
      new THREE.TorusGeometry(0.35, 0.012, 8, 32, Math.PI), goldMat
    );
    supportArc.rotation.x = Math.PI / 2;
    supportArc.position.y = 0.62;
    globeGroup.add(supportArc);
    // Sphere with procedural canvas texture
    var globeCanvas = document.createElement('canvas');
    globeCanvas.width = 512; globeCanvas.height = 256;
    var gCtx = globeCanvas.getContext('2d');
    gCtx.fillStyle = '#1A0F30';
    gCtx.fillRect(0, 0, 512, 256);
    gCtx.fillStyle = '#D4AF37';
    var continents = [[80,40,70,80],[200,30,100,70],[340,60,60,50],[120,140,80,60],[380,120,70,60]];
    for (var ci = 0; ci < continents.length; ci++) {
      var c = continents[ci];
      gCtx.beginPath();
      gCtx.ellipse(c[0], c[1], c[2]/2, c[3]/2, 0, 0, Math.PI*2);
      gCtx.fill();
    }
    // Grid lines
    gCtx.strokeStyle = 'rgba(212,175,55,0.3)';
    gCtx.lineWidth = 1;
    for (var gl = 0; gl < 8; gl++) {
      gCtx.beginPath();
      gCtx.moveTo(0, gl * 32); gCtx.lineTo(512, gl * 32);
      gCtx.stroke();
      gCtx.beginPath();
      gCtx.moveTo(gl * 64, 0); gCtx.lineTo(gl * 64, 256);
      gCtx.stroke();
    }
    var globeTex = new THREE.CanvasTexture(globeCanvas);
    globeTex.minFilter = THREE.LinearMipmapLinearFilter;
    globeTex.magFilter = THREE.LinearFilter;
    globeTex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    globeTex.generateMipmaps = true;
    var globe = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 32, 32),
      new THREE.MeshStandardMaterial({ map: globeTex, roughness: 0.5, metalness: 0.15 })
    );
    globe.position.y = 0.62;
    globeGroup.add(globe);
    globeGroup.position.set(-2.5, 0, 1.5);
    scene.add(globeGroup);
    room.globe = globe;

    // --- CANDLE HOLDERS (on desk edges) ---
    function buildCandle(px, pz) {
      var candleGroup = new THREE.Group();
      var holder = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.035, 0.05, 12), goldMat
      );
      candleGroup.add(holder);
      var candle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8),
        new THREE.MeshStandardMaterial({ color: 0xFFF8E7, roughness: 0.9 })
      );
      candle.position.y = 0.085;
      candleGroup.add(candle);
      var flame = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 8, 8),
        new THREE.MeshStandardMaterial({
          color: 0xFFAA33, emissive: 0xFFAA33, emissiveIntensity: 2.0,
          transparent: true, opacity: 0.9
        })
      );
      flame.position.y = 0.155;
      candleGroup.add(flame);
      candleGroup.position.set(px, 1.56, pz);
      scene.add(candleGroup);
      return { group: candleGroup, flame: flame };
    }
    // Candles on desk edges — equal distance from center, at front edge
    room.candleL = buildCandle(-1.35, 1.1);
    room.candleR = buildCandle(1.35, 1.1);

    // Single combined candle light (between both candles)
    var candleCombinedLight = new THREE.PointLight(0xFFAA33, 0.5, 4);
    candleCombinedLight.position.set(0, 1.72, 1.1);
    scene.add(candleCombinedLight);
    room.candleCombinedLight = candleCombinedLight;

    // --- TELESCOPE near window (refractor design — clearly recognisable) ---
    var scopeGroup = new THREE.Group();

    // Inner tubeGroup holds the optical assembly — tilt it 30° upward as a unit
    var tubeGroup = new THREE.Group();
    tubeGroup.rotation.z = -Math.PI / 6; // 30° above horizontal toward window
    scopeGroup.add(tubeGroup);

    // Main optical tube — horizontal axis (+X direction), wide objective end at +X
    var scopeTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.040, 1.05, 16), goldMat
    );
    scopeTube.rotation.z = Math.PI / 2; // align cylinder Y-axis → X-axis
    tubeGroup.add(scopeTube);

    // Objective dew-shield / lens housing (wide end, at +X)
    var objHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.090, 0.080, 0.08, 16), goldMat
    );
    objHousing.rotation.z = Math.PI / 2;
    objHousing.position.x = 0.565;
    tubeGroup.add(objHousing);

    // Objective lens — blue glass disc
    var scopeLens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 0.012, 16),
      new THREE.MeshStandardMaterial({ color: 0x4488AA, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.65 })
    );
    scopeLens.rotation.z = Math.PI / 2;
    scopeLens.position.x = 0.612;
    tubeGroup.add(scopeLens);

    // Focus adjustment ring (dark knurled band near eyepiece end)
    var focusRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.050, 0.050, 0.055, 16), legMat
    );
    focusRing.rotation.z = Math.PI / 2;
    focusRing.position.x = -0.28;
    tubeGroup.add(focusRing);

    // Second decorative band
    var bandRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.068, 0.040, 16), legMat
    );
    bandRing.rotation.z = Math.PI / 2;
    bandRing.position.x = 0.18;
    tubeGroup.add(bandRing);

    // Eyepiece focuser barrel — sticks upward from the eyepiece (small/-X) end
    var focusTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.032, 0.14, 12), goldMat
    );
    // Default cylinder orientation (Y axis) = vertical = perpendicular to horizontal tube
    focusTube.position.set(-0.42, 0.10, 0);
    tubeGroup.add(focusTube);

    // Eyepiece lens cap at top of focuser
    var eyepieceCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.033, 0.028, 0.016, 12), legMat
    );
    eyepieceCap.position.set(-0.42, 0.178, 0);
    tubeGroup.add(eyepieceCap);

    // Tube mounting/support ring
    var mountRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.068, 0.010, 8, 16), goldMat
    );
    mountRing.rotation.y = Math.PI / 2;
    mountRing.position.x = 0.0;
    tubeGroup.add(mountRing);

    // Mount head connecting tube to tripod
    var mountHead = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.040, 0.10, 8), goldMat
    );
    mountHead.position.y = -0.18;
    scopeGroup.add(mountHead);

    // Azimuth column
    var azCol = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8), legMat
    );
    azCol.position.y = -0.38;
    scopeGroup.add(azCol);

    // Tripod legs — wider spread for stability
    for (var tli = 0; tli < 3; tli++) {
      var tla = (tli / 3) * Math.PI * 2;
      var tleg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.013, 0.009, 1.25, 6), legMat
      );
      tleg.position.set(Math.cos(tla) * 0.24, -0.72, Math.sin(tla) * 0.24);
      tleg.rotation.x = Math.sin(tla) * 0.24;
      tleg.rotation.z = -Math.cos(tla) * 0.24;
      scopeGroup.add(tleg);
    }

    // Tripod hub
    var tripodHub = new THREE.Mesh(
      new THREE.SphereGeometry(0.050, 8, 8), legMat
    );
    tripodHub.position.y = -0.60;
    scopeGroup.add(tripodHub);

    // Tripod spreader ring for realism
    var spreadRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.007, 6, 16), legMat
    );
    spreadRing.rotation.x = Math.PI / 2;
    spreadRing.position.y = -0.74;
    scopeGroup.add(spreadRing);

    scopeGroup.position.set(3.8, 1.35, -0.5);
    scene.add(scopeGroup);

    // --- WALL CLOCK on back wall (larger) ---
    var clockGroup = new THREE.Group();
    var clockFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.45, 32),
      new THREE.MeshStandardMaterial({ color: 0x0A0415, roughness: 0.8 })
    );
    clockGroup.add(clockFace);
    var bezel = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.03, 8, 32), goldMat
    );
    clockGroup.add(bezel);
    // Outer decorative ring
    var outerBezel = new THREE.Mesh(
      new THREE.TorusGeometry(0.50, 0.015, 8, 32), goldMat
    );
    clockGroup.add(outerBezel);
    // Hour markers + Roman numerals canvas
    for (var hi = 0; hi < 12; hi++) {
      var ha = (hi / 12) * Math.PI * 2;
      var marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.06, 0.005), goldMat
      );
      marker.position.set(Math.sin(ha) * 0.36, Math.cos(ha) * 0.36, 0.01);
      marker.rotation.z = -ha;
      clockGroup.add(marker);
    }
    // Center boss
    var clockCenter = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 12, 12), goldMat
    );
    clockCenter.position.z = 0.02;
    clockGroup.add(clockCenter);
    // Hands
    var hourHand = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.22, 0.008), goldMat
    );
    hourHand.position.y = 0.11;
    var hourPivot = new THREE.Group();
    hourPivot.add(hourHand);
    clockGroup.add(hourPivot);
    room.clockHour = hourPivot;
    var minuteHand = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.32, 0.008), goldMat
    );
    minuteHand.position.y = 0.16;
    var minutePivot = new THREE.Group();
    minutePivot.add(minuteHand);
    clockGroup.add(minutePivot);
    room.clockMinute = minutePivot;
    clockGroup.position.set(0, 4.5, -3.93);
    scene.add(clockGroup);

    // --- CRYSTAL ORB on desk ---
    var orbMat = new THREE.MeshStandardMaterial({
      color: 0x2A8B7A, emissive: 0x2A8B7A, emissiveIntensity: 0.15,
      transparent: true, opacity: 0.7, roughness: 0.05, metalness: 0.1
    });
    var orb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 32, 32), orbMat);
    orb.position.set(0.5, 1.64, 0.2);
    scene.add(orb);
    room.crystalOrb = orb;

    // --- WALL SCONCES (4 pairs — warm accent lights) ---
    function buildSconce(px, py, pz, rotY) {
      var sconceGroup = new THREE.Group();
      // Backplate
      var backplate = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.18, 0.02), goldMat
      );
      sconceGroup.add(backplate);
      // Arm
      var sconceArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.01, 0.15, 6), goldMat
      );
      sconceArm.rotation.z = Math.PI / 2;
      sconceArm.position.set(0, 0, 0.08);
      sconceGroup.add(sconceArm);
      // Shade
      var shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.1, 8, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0xFFF5E6, transparent: true, opacity: 0.4,
          emissive: 0xFFE4B5, emissiveIntensity: 0.3, side: THREE.DoubleSide
        })
      );
      shade.position.set(0, 0.02, 0.15);
      sconceGroup.add(shade);
      sconceGroup.position.set(px, py, pz);
      sconceGroup.rotation.y = rotY;
      scene.add(sconceGroup);
    }
    // Back wall sconces — positioned far from posters (posters at x=-2.5, 0, 2.5)
    buildSconce(-4.2, 3.5, -3.9, 0);
    buildSconce(4.2, 3.5, -3.9, 0);
    // Left wall sconces — spaced between poster at z=2.0 and panel at z=0.0
    buildSconce(-4.9, 3.5, -2.5, Math.PI / 2);
    buildSconce(-4.9, 3.5, 1.0, Math.PI / 2);
    // Right wall sconces — away from window (z=0, extends ±0.6) and poster (z=-2.0)
    buildSconce(4.9, 3.5, -1.2, -Math.PI / 2);
    buildSconce(4.9, 3.5, 1.5, -Math.PI / 2);

    // Combined sconce lighting — 2 lights instead of 6
    var sconceCombinedBack = new THREE.PointLight(0xFFE4B5, 0.6, 6);
    sconceCombinedBack.position.set(0, 3.5, -3.7);
    scene.add(sconceCombinedBack);
    var sconceCombinedSide = new THREE.PointLight(0xFFE4B5, 0.5, 6);
    sconceCombinedSide.position.set(0, 3.5, 0);
    scene.add(sconceCombinedSide);

    // --- DECORATIVE WALL PANELS (upper wall ornamental frames) ---
    var panelFrameMat = new THREE.MeshStandardMaterial({
      color: 0xD4AF37, roughness: 0.4, metalness: 0.5
    });
    var panelInnerMat = new THREE.MeshStandardMaterial({
      color: 0x153830, roughness: 0.85, metalness: 0.0
    });

    function buildWallPanel(px, py, pz, pw, ph, rotY) {
      var panelGroup = new THREE.Group();
      // Outer frame
      var frameW = 0.04;
      panelGroup.add(new THREE.Mesh(new THREE.BoxGeometry(pw, frameW, 0.03), panelFrameMat)); // top
      var topFrame = panelGroup.children[panelGroup.children.length-1];
      topFrame.position.y = ph/2;
      panelGroup.add(new THREE.Mesh(new THREE.BoxGeometry(pw, frameW, 0.03), panelFrameMat)); // bottom
      panelGroup.children[panelGroup.children.length-1].position.y = -ph/2;
      panelGroup.add(new THREE.Mesh(new THREE.BoxGeometry(frameW, ph, 0.03), panelFrameMat)); // left
      panelGroup.children[panelGroup.children.length-1].position.x = -pw/2;
      panelGroup.add(new THREE.Mesh(new THREE.BoxGeometry(frameW, ph, 0.03), panelFrameMat)); // right
      panelGroup.children[panelGroup.children.length-1].position.x = pw/2;
      // Inner recessed panel
      var inner = new THREE.Mesh(
        new THREE.PlaneGeometry(pw - 0.08, ph - 0.08), panelInnerMat
      );
      inner.position.z = 0.005;
      panelGroup.add(inner);
      // Diamond accent in center
      var diamond = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 0.12), panelFrameMat
      );
      diamond.rotation.z = Math.PI / 4;
      diamond.position.z = 0.01;
      panelGroup.add(diamond);
      panelGroup.position.set(px, py, pz);
      panelGroup.rotation.y = rotY;
      scene.add(panelGroup);
    }

    // Upper back wall decorative panels — positioned ABOVE posters to avoid overlap
    buildWallPanel(-1.2, 5.0, -3.92, 0.7, 0.6, 0);
    buildWallPanel(1.2, 5.0, -3.92, 0.7, 0.6, 0);

    // Left wall panels (above wainscoting, between sconces)
    buildWallPanel(-4.92, 3.0, 0.0, 1.0, 1.2, Math.PI/2);

    // Right wall panels (flanking the window — away from poster at z=-2.0)
    buildWallPanel(4.92, 3.0, -3.3, 0.6, 0.8, -Math.PI/2);
    buildWallPanel(4.92, 3.0, 2.5, 0.8, 1.0, -Math.PI/2);

    // Front wall panels
    buildWallPanel(-2.5, 3.0, 3.92, 0.8, 1.0, Math.PI);
    buildWallPanel(2.5, 3.0, 3.92, 0.8, 1.0, Math.PI);

    // --- STANDING LAMP (floor, near left wall) ---
    var lampGroup = new THREE.Group();
    // Lamp base
    var lampBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.15, 0.03, 16), goldMat
    );
    lampBase.position.y = 0.015;
    lampGroup.add(lampBase);
    // Pole
    var lampPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 1.6, 8), goldMat
    );
    lampPole.position.y = 0.82;
    lampGroup.add(lampPole);
    // Shade
    var lampShade = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.25, 12, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xFFF5E6, transparent: true, opacity: 0.35,
        emissive: 0xFFE4B5, emissiveIntensity: 0.2, side: THREE.DoubleSide
      })
    );
    lampShade.position.y = 1.72;
    lampGroup.add(lampShade);
    lampGroup.position.set(-4.2, 0, 2.5);
    scene.add(lampGroup);

    // --- LEATHER CHAIR (behind desk) ---
    var chairMat = new THREE.MeshStandardMaterial({ color: 0x2A1810, roughness: 0.75, metalness: 0.05 });
    var chairGroup = new THREE.Group();
    // Seat
    var seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.5), chairMat);
    seat.position.y = 0.6;
    chairGroup.add(seat);
    // Back
    var chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.06), chairMat);
    chairBack.position.set(0, 0.98, -0.22);
    chairGroup.add(chairBack);
    // Armrests
    var armL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.4), chairMat);
    armL.position.set(-0.27, 0.72, 0);
    chairGroup.add(armL);
    var armR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.4), chairMat);
    armR.position.set(0.27, 0.72, 0);
    chairGroup.add(armR);
    // Legs
    for (var cli = 0; cli < 4; cli++) {
      var clx = (cli % 2 === 0) ? -0.22 : 0.22;
      var clz = (cli < 2) ? -0.18 : 0.18;
      var chairLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.56, 6), legMat);
      chairLeg.position.set(clx, 0.28, clz);
      chairGroup.add(chairLeg);
    }
    chairGroup.position.set(0, 0, -0.5);
    scene.add(chairGroup);

    // --- SIDE TABLE (right side, near telescope) ---
    var sideTableMat = new THREE.MeshStandardMaterial({ color: 0x3D2B1F, roughness: 0.5, metalness: 0.1 });
    var sideTableGroup = new THREE.Group();
    var sTableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16), sideTableMat);
    sTableTop.position.y = 0.75;
    sideTableGroup.add(sTableTop);
    var sTablePole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 8), sideTableMat);
    sTablePole.position.y = 0.375;
    sideTableGroup.add(sTablePole);
    var sTableBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 16), sideTableMat);
    sTableBase.position.y = 0.015;
    sideTableGroup.add(sTableBase);
    sideTableGroup.position.set(3.2, 0, 1.5);
    scene.add(sideTableGroup);

    // Small lamp on side table
    var tLampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.02, 8), goldMat);
    tLampBase.position.set(3.2, 0.78, 1.5);
    scene.add(tLampBase);
    var tLampBody = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 8), goldMat);
    tLampBody.position.set(3.2, 0.89, 1.5);
    scene.add(tLampBody);
    var tLampShade = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.12, 8, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xFFF5E6, transparent: true, opacity: 0.35, emissive: 0xFFE4B5, emissiveIntensity: 0.2, side: THREE.DoubleSide })
    );
    tLampShade.position.set(3.2, 1.05, 1.5);
    scene.add(tLampShade);

    // --- RUG on floor (under desk area) ---
    var rugCanvas = document.createElement('canvas');
    rugCanvas.width = 256; rugCanvas.height = 256;
    var rCtx = rugCanvas.getContext('2d');
    rCtx.fillStyle = '#1A0A08';
    rCtx.fillRect(0, 0, 256, 256);
    // Border
    rCtx.strokeStyle = '#D4AF37';
    rCtx.lineWidth = 8;
    rCtx.strokeRect(12, 12, 232, 232);
    rCtx.lineWidth = 3;
    rCtx.strokeRect(24, 24, 208, 208);
    // Center pattern
    rCtx.strokeStyle = '#8B4513';
    rCtx.lineWidth = 2;
    for (var ri = 0; ri < 4; ri++) {
      var rAngle = (ri / 4) * Math.PI * 2;
      rCtx.beginPath();
      rCtx.moveTo(128, 128);
      rCtx.lineTo(128 + Math.cos(rAngle) * 80, 128 + Math.sin(rAngle) * 80);
      rCtx.stroke();
    }
    rCtx.beginPath();
    rCtx.arc(128, 128, 40, 0, Math.PI * 2);
    rCtx.strokeStyle = '#D4AF37';
    rCtx.lineWidth = 2;
    rCtx.stroke();
    var rugTex = new THREE.CanvasTexture(rugCanvas);
    rugTex.minFilter = THREE.LinearMipmapLinearFilter;
    rugTex.magFilter = THREE.LinearFilter;
    rugTex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    rugTex.generateMipmaps = true;
    var rug = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 3),
      new THREE.MeshStandardMaterial({ map: rugTex, roughness: 0.95, metalness: 0 })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.01, 0.5);
    scene.add(rug);

    // --- DESK OBJECT LAYOUT (evenly spaced, no overlaps) ---
    // Desk: x=-1.5 to 1.5, z=-0.25 to 1.25
    // Parchment: (-0.3, 1.555, 0.2), Inkwell: (0, 1.64, 0.5), Orb: (0.5, 1.64, 0.2)
    // Candles: desk edges at x=±1.5

    // Gears — front-right of desk (away from quill/books)
    for (var gi = 0; gi < 3; gi++) {
      var gearSmall = new THREE.Mesh(
        new THREE.TorusGeometry(0.03 + gi * 0.01, 0.008, 6, 12), goldMat
      );
      gearSmall.rotation.x = Math.PI / 2;
      gearSmall.position.set(0.8 + gi * 0.12, 1.56, 0.9 - gi * 0.12);
      scene.add(gearSmall);
    }

    // Quill pen holder — far left of desk
    var quillHolder = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.04, 0.08, 8),
      new THREE.MeshStandardMaterial({ color: 0x3D2B1F, roughness: 0.6, metalness: 0.1 })
    );
    quillHolder.position.set(-1.2, 1.58, 0.8);
    scene.add(quillHolder);
    // Quill
    var quill = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.003, 0.2, 6), goldMat
    );
    quill.position.set(-1.2, 1.72, 0.8);
    quill.rotation.z = 0.2;
    scene.add(quill);

    // Stack of books — left side of desk (between parchment edge and desk edge)
    var bookStackColors = [0x5C1A1A, 0x1A3D1A, 0x1A2040];
    for (var bi = 0; bi < 3; bi++) {
      var stackBook = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.04, 0.12),
        new THREE.MeshStandardMaterial({ color: bookStackColors[bi], roughness: 0.8, metalness: 0.05 })
      );
      stackBook.position.set(-1.2, 1.58 + bi * 0.04, 0.15);
      stackBook.rotation.y = bi * 0.15;
      scene.add(stackBook);
    }
  }

  // === WALL ART (framed posters) ===
  function buildWallArt() {
    if (isMobile) return;

    var frameMat = new THREE.MeshStandardMaterial({ color: 0xD4AF37, roughness: 0.4, metalness: 0.4 });

    var posters = [
      { src: 'images/poster1.webp', w: 1.0, h: 1.4, canvasIdx: 0 },
      { src: 'images/poster4.webp', w: 1.2, h: 0.9, canvasIdx: 1 },
      { src: 'images/poster5.webp', w: 1.0, h: 1.0, canvasIdx: 2 },
      { src: 'images/poster2.webp', w: 0.9, h: 0.9, canvasIdx: 3 },
      { src: 'images/poster3.webp', w: 0.7, h: 0.7, canvasIdx: 4 }
    ];

    var placements = [
      [-2.5, 2.75, -3.93, 0, 0],
      [0, 2.90, -3.93, 0, 1],
      [2.5, 2.75, -3.93, 0, 2],
      [4.93, 2.75, -2.0, -Math.PI / 2, 3],
      [-4.93, 2.90, 2.0, Math.PI / 2, 4]
    ];

    for (var i = 0; i < placements.length; i++) {
      (function(idx) {
        var pl = placements[idx];
        var p = posters[pl[4]];

        var frameGroup = new THREE.Group();

        // Start with canvas-generated poster art (always works)
        var fallback = createPosterCanvas(p.canvasIdx);
        var canvasTex = new THREE.CanvasTexture(fallback);
        canvasTex.minFilter = THREE.LinearMipmapLinearFilter;
        canvasTex.magFilter = THREE.LinearFilter;
        canvasTex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
        canvasTex.generateMipmaps = true;
        var canvasMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(p.w, p.h),
          new THREE.MeshStandardMaterial({ map: canvasTex, roughness: 0.9, metalness: 0.0, emissive: 0x000000, emissiveIntensity: 0 })
        );
        frameGroup.add(canvasMesh);

        // Try loading the real image — swap texture on existing material (avoids shader recompile)
        loadImageTexture(p.src, function(tex) {
          tex.encoding = THREE.sRGBEncoding;
          canvasMesh.material.map = tex;
          canvasMesh.material.emissiveMap = tex;
          canvasMesh.material.roughness = 0.2;
          canvasMesh.material.emissive.set(1, 1, 1);
          canvasMesh.material.emissiveIntensity = 0.10;
          canvasMesh.material.needsUpdate = true;  // update textures only, no shader recompile
        }, fallback);

        // Frame border bars
        var barThick = 0.05;
        var barDepth = 0.04;
        frameGroup.add(createFrameBar(p.w + barThick * 2, barThick, barDepth, 0, p.h / 2 + barThick / 2, barDepth / 2, frameMat));
        frameGroup.add(createFrameBar(p.w + barThick * 2, barThick, barDepth, 0, -p.h / 2 - barThick / 2, barDepth / 2, frameMat));
        frameGroup.add(createFrameBar(barThick, p.h, barDepth, -p.w / 2 - barThick / 2, 0, barDepth / 2, frameMat));
        frameGroup.add(createFrameBar(barThick, p.h, barDepth, p.w / 2 + barThick / 2, 0, barDepth / 2, frameMat));

        frameGroup.position.set(pl[0], pl[1], pl[2]);
        frameGroup.rotation.y = pl[3];
        scene.add(frameGroup);

      })(i);
    }

    // Combined poster lighting — warm golden to match magical theme
    var posterLightA = new THREE.PointLight(0xFFCC88, 0.18, 5);
    posterLightA.position.set(-3.5, 2.8, -1.5);
    scene.add(posterLightA);
    var posterLightB = new THREE.PointLight(0xFFCC88, 0.18, 5);
    posterLightB.position.set(3.5, 2.8, -1.5);
    scene.add(posterLightB);
    // Purple accent lights on side walls
    var sideAccentL = new THREE.PointLight(0xBB44FF, 0.15, 5);
    sideAccentL.position.set(-4.0, 2.8, 2.0);
    scene.add(sideAccentL);
    var sideAccentR = new THREE.PointLight(0xBB44FF, 0.15, 5);
    sideAccentR.position.set(4.0, 2.8, -2.0);
    scene.add(sideAccentR);
  }

  function createFrameBar(w, h, d, x, y, z, mat) {
    var bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    bar.position.set(x, y, z);
    return bar;
  }

  // === GPU PARTICLE SHADER SOURCES ===
  // Shared between all particle systems. Vertex shader computes position on GPU —
  // the only data uploaded per frame is the 'time' uniform (4 bytes).
  var _gpuVertexShader = [
    'attribute vec3 initialPos;',
    'attribute vec3 gpuVel;',       // drift velocities (stored as speed, not per-frame delta)
    'attribute float phase;',        // random phase offset per particle
    'attribute float driftX;',       // XZ oscillation radius
    'attribute float driftZ;',
    'uniform float time;',
    'uniform float uSize;',
    'uniform float uScale;',         // viewport scale (innerHeight * 0.5) for sizeAttenuation
    'uniform float uSizeBreath;',    // breathing amplitude (0 = no breathing)
    'uniform float uSizeBreathSpd;', // breathing speed (radians/sec)
    'void main() {',
    '  vec3 pos;',
    // XZ: sinusoidal oscillation around initial cluster position
    '  pos.x = initialPos.x + sin(time * gpuVel.x + phase) * driftX;',
    '  pos.z = initialPos.z + cos(time * gpuVel.z + phase * 0.9) * driftZ;',
    // Y: upward drift with modular wrap (0.3 to 5.5 = 5.2 units range)
    '  float yRange  = 5.2;',
    '  float yDrift  = mod(time * gpuVel.y + phase * yRange, yRange);',
    '  pos.y = 0.3 + yDrift;',
    // Size breathing
    '  float breathe = 1.0 + sin(time * uSizeBreathSpd + phase) * uSizeBreath;',
    '  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);',
    '  gl_PointSize = uSize * breathe * uScale / (-mvPos.z);',
    '  gl_Position  = projectionMatrix * mvPos;',
    '}'
  ].join('\n');

  // Cluster-aware variant: particles orbit a cluster center (used for magical/butterfly/flower)
  var _gpuClusterVertexShader = [
    'attribute vec3 initialPos;',
    'attribute vec3 clusterPos;',    // cluster center in world space
    'attribute vec3 gpuVel;',        // orbit speed per axis
    'attribute float phase;',
    'attribute float driftX;',
    'attribute float driftZ;',
    'uniform float time;',
    'uniform float uSize;',
    'uniform float uScale;',
    'uniform float uSizeBreath;',
    'uniform float uSizeBreathSpd;',
    'void main() {',
    '  vec3 pos;',
    // XZ: orbit around cluster center with multi-frequency sinusoids
    '  pos.x = clusterPos.x + sin(time * gpuVel.x + phase) * driftX',
    '        + sin(time * gpuVel.x * 2.1 + phase * 0.5) * driftX * 0.25;',
    '  pos.z = clusterPos.z + cos(time * gpuVel.z + phase * 0.8) * driftZ',
    '        + cos(time * gpuVel.z * 1.7 + phase * 1.3) * driftZ * 0.25;',
    // Y: slow bob around cluster Y
    '  float yBob   = sin(time * gpuVel.y + phase) * 0.08;',
    '  float yRange  = 5.2;',
    '  pos.y         = clamp(clusterPos.y + yBob, 0.2, 5.5);',
    '  float breathe = 1.0 + sin(time * uSizeBreathSpd + phase) * uSizeBreath;',
    '  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);',
    '  gl_PointSize = uSize * breathe * uScale / (-mvPos.z);',
    '  gl_Position  = projectionMatrix * mvPos;',
    '}'
  ].join('\n');

  // Butterfly variant: cluster-attracted with wing-flap Y bobbing
  var _gpuButterflyVertexShader = [
    'attribute vec3 clusterPos;',
    'attribute vec3 gpuVel;',
    'attribute float phase;',
    'attribute float driftX;',
    'attribute float driftZ;',
    'attribute float baseY;',
    'uniform float time;',
    'uniform float uSize;',
    'uniform float uScale;',
    'uniform float uFlapSpeed;',
    'void main() {',
    // Butterflies drift around cluster with damped oscillation
    '  float px = clusterPos.x + sin(time * gpuVel.x + phase) * driftX',
    '           + sin(time * gpuVel.x * 0.37 + phase * 1.7) * driftX * 0.4;',
    '  float pz = clusterPos.z + cos(time * gpuVel.z + phase * 0.8) * driftZ',
    '           + cos(time * gpuVel.z * 0.51 + phase * 0.6) * driftZ * 0.4;',
    // Y: wing-flap bobbing
    '  float py = baseY + sin(time * 2.5 + phase) * 0.18;',
    // Wing-flap size variation (point size changes like a flapping wing)
    '  float flap = 0.75 + sin(time * uFlapSpeed + phase) * 0.25;',
    '  vec4 mvPos = modelViewMatrix * vec4(px, py, pz, 1.0);',
    '  gl_PointSize = uSize * flap * uScale / (-mvPos.z);',
    '  gl_Position  = projectionMatrix * mvPos;',
    '}'
  ].join('\n');

  // Fragment shader: sample circle/sprite texture at gl_PointCoord
  var _gpuFragShader = [
    'uniform sampler2D uMap;',
    'uniform float uOpacity;',
    'void main() {',
    '  vec4 texel = texture2D(uMap, gl_PointCoord);',
    '  gl_FragColor = vec4(texel.rgb, texel.a * uOpacity);',
    '  if (gl_FragColor.a < 0.01) discard;',
    '}'
  ].join('\n');

  // === AMBIENT PARTICLES (GPU shader — zero per-frame CPU-to-GPU upload) ===
  function buildAmbientParticles() {
    var geo = new THREE.BufferGeometry();
    var iPos    = new Float32Array(AMBIENT_COUNT * 3);
    var gVel    = new Float32Array(AMBIENT_COUNT * 3);
    var phase   = new Float32Array(AMBIENT_COUNT);
    var driftXA = new Float32Array(AMBIENT_COUNT);
    var driftZA = new Float32Array(AMBIENT_COUNT);

    for (var i = 0; i < AMBIENT_COUNT; i++) {
      // 60% clustered, 40% spread loosely for atmosphere (same distribution as before)
      if (Math.random() < 0.6) {
        var cl = MAGIC_CLUSTERS_GLOBAL[Math.floor(Math.random() * MAGIC_CLUSTERS_GLOBAL.length)];
        iPos[i * 3]     = cl.x;
        iPos[i * 3 + 1] = cl.y;
        iPos[i * 3 + 2] = cl.z;
        driftXA[i] = 0.5 + Math.random() * 1.1;
        driftZA[i] = 0.5 + Math.random() * 1.1;
      } else {
        iPos[i * 3]     = (Math.random() - 0.5) * 8;
        iPos[i * 3 + 1] = 0.5 + Math.random() * 4.5;
        iPos[i * 3 + 2] = (Math.random() - 0.5) * 6;
        driftXA[i] = 1.0 + Math.random() * 2.0;
        driftZA[i] = 1.0 + Math.random() * 2.0;
      }
      gVel[i * 3]     = (0.08 + Math.random() * 0.12) * (Math.random() < 0.5 ? 1 : -1); // X orbit speed
      gVel[i * 3 + 1] = 0.001 + Math.random() * 0.003;  // Y rise speed
      gVel[i * 3 + 2] = (0.08 + Math.random() * 0.12) * (Math.random() < 0.5 ? 1 : -1); // Z orbit speed
      phase[i] = Math.random() * Math.PI * 2;
    }

    // Only position is needed for geometry (ShaderMaterial ignores it, but Three.js needs it)
    geo.setAttribute('position',  new THREE.BufferAttribute(iPos,    3));
    geo.setAttribute('initialPos',new THREE.BufferAttribute(iPos,    3));
    geo.setAttribute('gpuVel',    new THREE.BufferAttribute(gVel,    3));
    geo.setAttribute('phase',     new THREE.BufferAttribute(phase,   1));
    geo.setAttribute('driftX',    new THREE.BufferAttribute(driftXA, 1));
    geo.setAttribute('driftZ',    new THREE.BufferAttribute(driftZA, 1));

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        time:          { value: 0 },
        uSize:         { value: isMobile ? 0.01 : 0.015 },
        uScale:        { value: window.innerHeight * 0.5 },
        uSizeBreath:   { value: 0.15 },
        uSizeBreathSpd:{ value: 0.5 },
        uMap:          { value: createCircleTexture() },
        uOpacity:      { value: 0.22 }
      },
      vertexShader:   _gpuVertexShader,
      fragmentShader: _gpuFragShader,
      transparent:    true,
      blending:       THREE.AdditiveBlending,
      depthWrite:     false
    });

    ambientParticles = new THREE.Points(geo, mat);
    scene.add(ambientParticles);
  }

  // === MAGICAL CLUSTER CENTERS (reused by all 3 systems below) ===
  var MAGIC_CLUSTERS_GLOBAL = [
    { x: -4.0, y: 1.5, z:  1.5 },   // 0: Left wall floor bush
    { x:  4.0, y: 1.5, z: -1.5 },   // 1: Right wall floor bush
    { x: -2.5, y: 3.8, z: -3.7 },   // 2: Back wall upper-left
    { x:  2.5, y: 3.8, z: -3.7 },   // 3: Back wall upper-right
    { x:  0.0, y: 4.2, z: -3.5 },   // 4: Back wall center top
    { x: -4.2, y: 3.0, z:  0.0 },   // 5: Left wall mid-height
    { x:  4.2, y: 3.0, z: -2.0 },   // 6: Right wall mid-height
    { x: -1.5, y: 0.8, z:  1.0 },   // 7: Near floor corner
    { x:  1.5, y: 4.5, z: -1.0 },   // 8: Ceiling center-right
    { x: -3.0, y: 2.0, z: -1.5 },   // 9: Left-back corner
    { x:  3.0, y: 0.8, z:  1.5 },   // 10: Right-front floor
    { x:  0.0, y: 2.2, z:  1.8 },   // 11: Center front
    { x: -4.0, y: 4.5, z: -2.5 },   // 12: Left wall ceiling corner
    { x:  4.0, y: 4.5, z:  0.5 },   // 13: Right wall ceiling corner
    { x:  0.0, y: 5.0, z: -1.5 },   // 14: Ceiling center
    { x: -2.0, y: 1.2, z: -2.5 },   // 15: Left mid-floor near back
    { x:  2.0, y: 1.2, z:  0.5 },   // 16: Right mid-floor near front
    { x: -3.5, y: 5.2, z:  1.0 },   // 17: Left ceiling high
    { x:  3.5, y: 5.2, z: -3.0 },   // 18: Right ceiling high
    { x:  0.5, y: 3.5, z:  3.0 },   // 19: Front wall high center
    { x: -1.0, y: 5.5, z: -3.0 }    // 20: Ceiling back-left
  ];

  // === GOLDEN BOKEH PARTICLES (GPU shader) ===
  var magicalParticles = null;
  var _pc = (typeof KRKAI_ParticleConfig !== 'undefined') ? KRKAI_ParticleConfig : null;
  var MAGICAL_COUNT = _pc ? (isMobile ? _pc.magical.countMobile : (isTablet ? _pc.magical.countTablet : _pc.magical.countDesktop)) : (isMobile ? 15 : (isTablet ? 50 : 200));

  function buildMagicalParticles() {
    var geo    = new THREE.BufferGeometry();
    var cPos   = new Float32Array(MAGICAL_COUNT * 3); // cluster centers
    var iPos   = new Float32Array(MAGICAL_COUNT * 3); // initial positions (for position attr)
    var gVel   = new Float32Array(MAGICAL_COUNT * 3);
    var phase  = new Float32Array(MAGICAL_COUNT);
    var driftX = new Float32Array(MAGICAL_COUNT);
    var driftZ = new Float32Array(MAGICAL_COUNT);

    for (var i = 0; i < MAGICAL_COUNT; i++) {
      var cl = MAGIC_CLUSTERS_GLOBAL[Math.floor(Math.random() * MAGIC_CLUSTERS_GLOBAL.length)];
      cPos[i * 3]     = cl.x;
      cPos[i * 3 + 1] = cl.y;
      cPos[i * 3 + 2] = cl.z;
      iPos[i * 3]     = cl.x + (Math.random() - 0.5) * 1.6;
      iPos[i * 3 + 1] = cl.y + (Math.random() - 0.5) * 1.0;
      iPos[i * 3 + 2] = cl.z + (Math.random() - 0.5) * 1.6;
      gVel[i * 3]     = 0.10 + Math.random() * 0.15;
      gVel[i * 3 + 1] = 0.25 + Math.random() * 0.25;
      gVel[i * 3 + 2] = 0.10 + Math.random() * 0.15;
      phase[i]  = Math.random() * Math.PI * 2;
      driftX[i] = 0.8 + Math.random() * 1.2;
      driftZ[i] = 0.8 + Math.random() * 1.2;
    }

    geo.setAttribute('position',   new THREE.BufferAttribute(iPos,   3));
    geo.setAttribute('clusterPos', new THREE.BufferAttribute(cPos,   3));
    geo.setAttribute('gpuVel',     new THREE.BufferAttribute(gVel,   3));
    geo.setAttribute('phase',      new THREE.BufferAttribute(phase,  1));
    geo.setAttribute('driftX',     new THREE.BufferAttribute(driftX, 1));
    geo.setAttribute('driftZ',     new THREE.BufferAttribute(driftZ, 1));

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        time:          { value: 0 },
        uSize:         { value: isMobile ? 0.04 : 0.058 },
        uScale:        { value: window.innerHeight * 0.5 },
        uSizeBreath:   { value: 0.30 },
        uSizeBreathSpd:{ value: 0.55 },
        uMap:          { value: createCircleTexture() },
        uOpacity:      { value: 0.45 }
      },
      vertexShader:   _gpuClusterVertexShader,
      fragmentShader: _gpuFragShader,
      transparent:    true,
      blending:       THREE.AdditiveBlending,
      depthWrite:     false
    });
    magicalParticles = new THREE.Points(geo, mat);
    magicalParticles.renderOrder = 1;
    scene.add(magicalParticles);
  }

  function updateMagicalParticles(time) {
    if (!magicalParticles || progress > 0.91) return;
    magicalParticles.material.uniforms.time.value = time;
  }

  // === BUTTERFLY PARTICLES (GPU shader — 3 size variants) ===
  var butterflyMeshes = [];
  var butterflyCounts = [];
  var BUTTERFLY_COUNT = _pc ? (isMobile ? _pc.butterflies.countMobile : (isTablet ? _pc.butterflies.countTablet : _pc.butterflies.countDesktop)) : (isMobile ? 0 : (isTablet ? 25 : 80));
  var _cachedButterflyTex = null;

  function createButterflyTexture() {
    if (_cachedButterflyTex) return _cachedButterflyTex;
    var canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 48;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 48);

    // Upper wings — amber/orange gradient
    var gradUL = ctx.createRadialGradient(20, 18, 1, 16, 20, 15);
    gradUL.addColorStop(0, 'rgba(255,200,80,0.95)');
    gradUL.addColorStop(0.5, 'rgba(255,140,20,0.80)');
    gradUL.addColorStop(1, 'rgba(180,60,0,0.10)');
    ctx.fillStyle = gradUL;
    ctx.beginPath();
    ctx.ellipse(16, 20, 14, 17, -0.55, 0, Math.PI * 2);
    ctx.fill();

    var gradUR = ctx.createRadialGradient(44, 18, 1, 48, 20, 15);
    gradUR.addColorStop(0, 'rgba(255,200,80,0.95)');
    gradUR.addColorStop(0.5, 'rgba(255,140,20,0.80)');
    gradUR.addColorStop(1, 'rgba(180,60,0,0.10)');
    ctx.fillStyle = gradUR;
    ctx.beginPath();
    ctx.ellipse(48, 20, 14, 17, 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Lower wings — slightly smaller, darker amber
    var gradLL = ctx.createRadialGradient(20, 36, 1, 18, 35, 11);
    gradLL.addColorStop(0, 'rgba(255,160,40,0.85)');
    gradLL.addColorStop(1, 'rgba(150,40,0,0.05)');
    ctx.fillStyle = gradLL;
    ctx.beginPath();
    ctx.ellipse(18, 35, 10, 12, -0.7, 0, Math.PI * 2);
    ctx.fill();

    var gradLR = ctx.createRadialGradient(44, 36, 1, 46, 35, 11);
    gradLR.addColorStop(0, 'rgba(255,160,40,0.85)');
    gradLR.addColorStop(1, 'rgba(150,40,0,0.05)');
    ctx.fillStyle = gradLR;
    ctx.beginPath();
    ctx.ellipse(46, 35, 10, 12, 0.7, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = 'rgba(60,20,5,0.90)';
    ctx.beginPath();
    ctx.ellipse(32, 26, 2.5, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    _cachedButterflyTex = new THREE.CanvasTexture(canvas);
    _cachedButterflyTex.minFilter = THREE.LinearFilter;
    return _cachedButterflyTex;
  }

  function buildButterflyParticles() {
    if (BUTTERFLY_COUNT === 0) return;
    // Split into 3 size groups: 35% small (0.14), 40% medium (0.24), 25% large (0.36)
    var cntSmall = Math.floor(BUTTERFLY_COUNT * 0.35);
    var cntMed   = Math.floor(BUTTERFLY_COUNT * 0.40);
    var cntLarge = BUTTERFLY_COUNT - cntSmall - cntMed;
    butterflyCounts = [cntSmall, cntMed, cntLarge];

    var sizes      = [0.14, 0.24, 0.36];
    var flapSpeeds = [2.5, 2.0, 1.5];
    var btex = createButterflyTexture();
    // Exclude desk area cluster (index 7) — butterflies stay near walls
    var wallClusters = MAGIC_CLUSTERS_GLOBAL.filter(function(c, idx) { return idx !== 7; });

    for (var s = 0; s < 3; s++) {
      var cnt = butterflyCounts[s];
      var cPos   = new Float32Array(cnt * 3); // cluster centers
      var iPos   = new Float32Array(cnt * 3); // placeholder position attr
      var gVel   = new Float32Array(cnt * 3);
      var phase  = new Float32Array(cnt);
      var driftX = new Float32Array(cnt);
      var driftZ = new Float32Array(cnt);
      var baseYA = new Float32Array(cnt);

      for (var i = 0; i < cnt; i++) {
        var cl = wallClusters[Math.floor(Math.random() * wallClusters.length)];
        cPos[i * 3]     = cl.x;
        cPos[i * 3 + 1] = cl.y;
        cPos[i * 3 + 2] = cl.z;
        iPos[i * 3]     = cl.x + (Math.random() - 0.5) * 1.4;
        iPos[i * 3 + 1] = cl.y + (Math.random() - 0.5) * 0.9;
        iPos[i * 3 + 2] = cl.z + (Math.random() - 0.5) * 1.4;
        gVel[i * 3]     = 0.08 + Math.random() * 0.07;
        gVel[i * 3 + 1] = 1.0;  // unused, butterflies use baseY
        gVel[i * 3 + 2] = 0.08 + Math.random() * 0.07;
        phase[i]  = Math.random() * Math.PI * 2;
        driftX[i] = 0.20 + Math.random() * 0.20;
        driftZ[i] = 0.20 + Math.random() * 0.20;
        baseYA[i] = iPos[i * 3 + 1];
      }

      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position',   new THREE.BufferAttribute(iPos,   3));
      geo.setAttribute('clusterPos', new THREE.BufferAttribute(cPos,   3));
      geo.setAttribute('gpuVel',     new THREE.BufferAttribute(gVel,   3));
      geo.setAttribute('phase',      new THREE.BufferAttribute(phase,  1));
      geo.setAttribute('driftX',     new THREE.BufferAttribute(driftX, 1));
      geo.setAttribute('driftZ',     new THREE.BufferAttribute(driftZ, 1));
      geo.setAttribute('baseY',      new THREE.BufferAttribute(baseYA, 1));

      var mat = new THREE.ShaderMaterial({
        uniforms: {
          time:       { value: 0 },
          uSize:      { value: sizes[s] },
          uScale:     { value: window.innerHeight * 0.5 },
          uFlapSpeed: { value: flapSpeeds[s] },
          uMap:       { value: btex },
          uOpacity:   { value: 0.82 }
        },
        vertexShader:   _gpuButterflyVertexShader,
        fragmentShader: _gpuFragShader,
        transparent:    true,
        blending:       THREE.AdditiveBlending,
        depthWrite:     false
      });
      var mesh = new THREE.Points(geo, mat);
      mesh.renderOrder = 3;
      butterflyMeshes.push(mesh);
      scene.add(mesh);
    }
  }

  function updateButterflyParticles(time) {
    if (butterflyMeshes.length === 0 || progress > 0.91) return;
    for (var s = 0; s < butterflyMeshes.length; s++) {
      if (butterflyMeshes[s]) {
        butterflyMeshes[s].material.uniforms.time.value = time;
      }
    }
  }

  // === MAGICAL FLOWER PARTICLES (GPU shader — 3 size variants) ===
  var flowerMeshes = [];
  var flowerCounts = [];
  var FLOWER_COUNT = _pc ? (isMobile ? _pc.flowers.countMobile : (isTablet ? _pc.flowers.countTablet : _pc.flowers.countDesktop)) : (isMobile ? 0 : (isTablet ? 30 : 120));
  var _cachedFlowerTex = null;

  function createFlowerTexture() {
    if (_cachedFlowerTex) return _cachedFlowerTex;
    var canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);

    // Outer glow
    var glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, 'rgba(220,100,255,0.25)');
    glow.addColorStop(1, 'rgba(220,100,255,0.00)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 64, 64);

    // 6 petals arranged in circle
    var petalColors = [
      'rgba(180,60,255,0.82)',
      'rgba(200,80,240,0.75)',
      'rgba(220,100,255,0.70)'
    ];
    for (var p = 0; p < 6; p++) {
      var angle = (p / 6) * Math.PI * 2;
      var px = 32 + Math.cos(angle) * 12;
      var py = 32 + Math.sin(angle) * 12;
      var grad = ctx.createRadialGradient(px, py, 1, px, py, 10);
      grad.addColorStop(0, petalColors[p % 3]);
      grad.addColorStop(1, 'rgba(180,60,255,0.00)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(px, py, 9, 6, angle, 0, Math.PI * 2);
      ctx.fill();
    }

    // Golden center
    var center = ctx.createRadialGradient(32, 32, 0, 32, 32, 7);
    center.addColorStop(0, 'rgba(255,230,80,1.0)');
    center.addColorStop(0.5, 'rgba(255,180,30,0.9)');
    center.addColorStop(1, 'rgba(255,120,0,0.0)');
    ctx.fillStyle = center;
    ctx.beginPath();
    ctx.arc(32, 32, 7, 0, Math.PI * 2);
    ctx.fill();

    _cachedFlowerTex = new THREE.CanvasTexture(canvas);
    _cachedFlowerTex.minFilter = THREE.LinearFilter;
    return _cachedFlowerTex;
  }

  function buildFlowerParticles() {
    if (FLOWER_COUNT === 0) return;
    // Split into 3 size groups: 35% small (0.12), 40% medium (0.22), 25% large (0.34)
    var cntSmall = Math.floor(FLOWER_COUNT * 0.35);
    var cntMed   = Math.floor(FLOWER_COUNT * 0.40);
    var cntLarge = FLOWER_COUNT - cntSmall - cntMed;
    flowerCounts = [cntSmall, cntMed, cntLarge];

    var sizes       = [0.12, 0.22, 0.34];
    var breathSpeeds= [1.4,  1.2,  0.9];
    var ftex = createFlowerTexture();

    for (var s = 0; s < 3; s++) {
      var cnt = flowerCounts[s];
      var cPos   = new Float32Array(cnt * 3);
      var iPos   = new Float32Array(cnt * 3);
      var gVel   = new Float32Array(cnt * 3);
      var phase  = new Float32Array(cnt);
      var driftX = new Float32Array(cnt);
      var driftZ = new Float32Array(cnt);

      for (var i = 0; i < cnt; i++) {
        var cl = MAGIC_CLUSTERS_GLOBAL[Math.floor(Math.random() * MAGIC_CLUSTERS_GLOBAL.length)];
        cPos[i * 3]     = cl.x;
        cPos[i * 3 + 1] = cl.y;
        cPos[i * 3 + 2] = cl.z;
        iPos[i * 3]     = cl.x + (Math.random() - 0.5) * 0.90;
        iPos[i * 3 + 1] = cl.y + (Math.random() - 0.5) * 0.70;
        iPos[i * 3 + 2] = cl.z + (Math.random() - 0.5) * 0.90;
        gVel[i * 3]     = 0.02 + Math.random() * 0.03;
        gVel[i * 3 + 1] = breathSpeeds[s];  // Y bob speed
        gVel[i * 3 + 2] = 0.02 + Math.random() * 0.03;
        phase[i]  = Math.random() * Math.PI * 2;
        driftX[i] = 0.25 + Math.random() * 0.25;  // spread like a bush, slow drift
        driftZ[i] = 0.25 + Math.random() * 0.25;
      }

      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position',   new THREE.BufferAttribute(iPos,   3));
      geo.setAttribute('clusterPos', new THREE.BufferAttribute(cPos,   3));
      geo.setAttribute('gpuVel',     new THREE.BufferAttribute(gVel,   3));
      geo.setAttribute('phase',      new THREE.BufferAttribute(phase,  1));
      geo.setAttribute('driftX',     new THREE.BufferAttribute(driftX, 1));
      geo.setAttribute('driftZ',     new THREE.BufferAttribute(driftZ, 1));

      var mat = new THREE.ShaderMaterial({
        uniforms: {
          time:          { value: 0 },
          uSize:         { value: sizes[s] },
          uScale:        { value: window.innerHeight * 0.5 },
          uSizeBreath:   { value: 0.15 },
          uSizeBreathSpd:{ value: breathSpeeds[s] * 0.75 },
          uMap:          { value: ftex },
          uOpacity:      { value: 0.55 }
        },
        vertexShader:   _gpuClusterVertexShader,
        fragmentShader: _gpuFragShader,
        transparent:    true,
        blending:       THREE.AdditiveBlending,
        depthWrite:     false
      });
      var mesh = new THREE.Points(geo, mat);
      mesh.renderOrder = 2;
      flowerMeshes.push(mesh);
      scene.add(mesh);
    }
  }

  function updateFlowerParticles(time) {
    if (flowerMeshes.length === 0 || progress > 0.91) return;
    for (var s = 0; s < flowerMeshes.length; s++) {
      if (flowerMeshes[s]) {
        flowerMeshes[s].material.uniforms.time.value = time;
      }
    }
  }

  // Helper: smooth lerp
  function lerpVal(current, target, alpha) {
    return current + (target - current) * alpha;
  }

  // === UPDATE PER FRAME ===
  function updateAmbientParticles(time) {
    // GPU shader: only update the time uniform — zero CPU-to-GPU vertex upload
    if (ambientParticles && progress <= 0.91) {
      ambientParticles.material.uniforms.time.value = time;
    }
  }

  // === SCENE STATE PER PROGRESS (SMOOTH TRANSITIONS) ===
  function updateSceneState(p, time) {
    progress = p;
    // time is passed from the animate loop — avoids a duplicate Date.now() call per frame

    // Rotate gear
    if (room.gear) {
      room.gear.rotation.z += 0.005;
    }

    // === STUDY OBJECTS ANIMATION ===
    // Globe slow rotation
    if (room.globe) {
      room.globe.rotation.y += 0.002;
    }
    // Candle flame flicker
    if (room.candleL) {
      room.candleL.flame.scale.y = 0.8 + Math.sin(time * 12) * 0.3;
    }
    if (room.candleR) {
      room.candleR.flame.scale.y = 0.8 + Math.sin(time * 12 + 1.5) * 0.3;
    }
    if (room.candleCombinedLight) {
      var flicker = 0.5 + Math.sin(time * 8) * 0.1 + Math.random() * 0.05;
      room.candleCombinedLight.intensity = flicker;
    }
    // Wall clock hands
    if (room.clockMinute) {
      room.clockMinute.rotation.z = -time * 0.02;
    }
    if (room.clockHour) {
      room.clockHour.rotation.z = -time * 0.0017;
    }
    // Crystal orb pulse
    if (room.crystalOrb) {
      var orbPulse = 0.4 + Math.sin(time * 2) * 0.15;
      room.crystalOrb.material.emissiveIntensity = orbPulse;
      if (room.orbLight) room.orbLight.intensity = 0.15 + Math.sin(time * 2) * 0.08;
    }

    // === CINEMATIC TEAL & GOLD LIGHTING ===
    lightTargets.ambient = 0.25;
    lightTargets.spot = 1.5;
    lightTargets.inkwell = 0.0;
    lightTargets.fill = 0.5;
    lightTargets.fogR = 0.027; lightTargets.fogG = 0.102; lightTargets.fogB = 0.090;

    // === SMOOTH DAMPED light values toward targets ===
    ambientLight.intensity = dampVal(ambientLight.intensity, lightTargets.ambient, LIGHT_SMOOTH, deltaTime);
    spotLight.intensity = dampVal(spotLight.intensity, lightTargets.spot, LIGHT_SMOOTH, deltaTime);
    inkwellLight.intensity = dampVal(inkwellLight.intensity, lightTargets.inkwell, LIGHT_SMOOTH, deltaTime);
    fillLight.intensity = dampVal(fillLight.intensity, lightTargets.fill, LIGHT_SMOOTH, deltaTime);

    // Dust motes — keep consistent neutral color (no dynamic color shifts)

    // === SMOOTH FOG COLOR SHIFT ===
    scene.fog.color.r = dampVal(scene.fog.color.r, lightTargets.fogR, LIGHT_SMOOTH, deltaTime);
    scene.fog.color.g = dampVal(scene.fog.color.g, lightTargets.fogG, LIGHT_SMOOTH, deltaTime);
    scene.fog.color.b = dampVal(scene.fog.color.b, lightTargets.fogB, LIGHT_SMOOTH, deltaTime);

    // === DYNAMIC RIM LIGHTING — spotlight follows camera for cinematic backlight ===
    if (p > 0.16 && p < 0.62 && window.KRKAI_Pen) {
      var penRimPos = KRKAI_Pen.getPenPosition();
      var rimDir = _scTmpV.subVectors(penRimPos, camera.position).normalize();
      spotLight.position.set(
        penRimPos.x + rimDir.x * 4,
        Math.max(penRimPos.y + 1.5, 3.0),
        penRimPos.z + rimDir.z * 4
      );
      if (spotLight.target) spotLight.target.position.copy(penRimPos);
    }

    // === DYNAMIC BLOOM INTENSITY per narrative section ===
    // Lazily enable bloom when needed (saves full render pass during intro)
    if (bloomPass && !bloomPass.enabled && !perfBloomDisabled && p >= 0.03) {
      bloomPass.enabled = true;
    }
    if (bloomPass && bloomPass.enabled) {
      var targetBloom;
      if (p < 0.03) targetBloom = 0.0;         // Intro overhead view — OFF (parchment fills frame, any bloom = white washout)
      else if (p < 0.06) targetBloom = 0.35;   // Pen rising — gentle build
      else if (p < 0.16) targetBloom = 0.65;   // Wall reveal: moderate bloom
      else if (p < 0.28) targetBloom = 0.50;   // Problem: dim
      else if (p < 0.38) targetBloom = 0.60;   // Mission: building
      else if (p < 0.62) targetBloom = 0.60;   // Programs/Timeline: steady
      else if (p < 0.80) targetBloom = 0.65;   // Impact: building
      else targetBloom = 0.75;                  // Writing climax: peak bloom
      bloomPass.strength = dampVal(bloomPass.strength, targetBloom, LIGHT_SMOOTH, deltaTime);

      // Dynamic threshold — high at intro/hero (parchment-facing) to prevent desk bloom, lower during flight
      var targetThreshold;
      if (p < 0.08) targetThreshold = 0.90;    // Overhead parchment view — only true emissives bloom
      else if (p < 0.16) targetThreshold = 0.80; // Transitioning — gradually allow more
      else targetThreshold = 0.70;              // Flight — magical bloom on particles/nib glow
      bloomPass.threshold = dampVal(bloomPass.threshold, targetThreshold, LIGHT_SMOOTH, deltaTime);
    }

    // === VOLUMETRIC LIGHT SHAFT ANIMATION ===
    if (room.lightShaft) {
      var shaftTarget = p < 0.28 ? 0.06 + p * 0.15 : (p < 0.50 ? 0.08 : 0.04);
      room.lightShaft.material.uniforms.uOpacity.value = dampVal(
        room.lightShaft.material.uniforms.uOpacity.value, shaftTarget, LIGHT_SMOOTH, deltaTime
      );
    }

    // === CINEMATIC EXPOSURE ANIMATION PER SECTION ===
    var targetExposure;
    if (p < 0.05) {
      targetExposure = 1.9;                          // Intro — warm golden open
    } else if (p < 0.16) {
      targetExposure = 2.1;                          // Hero — magical bright
    } else if (p < 0.28) {
      targetExposure = 1.7;                          // Problem — slightly darker
    } else if (p < 0.38) {
      targetExposure = 2.0;                          // Mission — rising warmth
    } else if (p < 0.50) {
      targetExposure = 2.1;                          // Programs — peak golden glow
    } else if (p < 0.62) {
      targetExposure = 1.9;                          // Timeline — moderate warmth
    } else if (p < 0.68) {
      targetExposure = 1.8;                          // Stories — intimate amber
    } else if (p < 0.80) {
      targetExposure = 2.0;                          // Impact — grand golden
    } else {
      targetExposure = 2.2;                          // Closing — warm magical climax
    }
    renderer.toneMappingExposure = dampVal(renderer.toneMappingExposure, targetExposure, LIGHT_SMOOTH, deltaTime);

    // Window pane glow intensity
    if (room.windowPane) {
      var targetOpacity = p < 0.28 ? 0.05 + p * 0.3 : 0.12;
      room.windowPane.material.opacity = dampVal(room.windowPane.material.opacity, targetOpacity, LIGHT_SMOOTH, deltaTime);
    }

    // === DESK SINK (Phase 6: 3D-to-HTML transition at 85%+) ===
    if (p > 0.85) {
      var sinkT = Math.min((p - 0.85) / 0.05, 1);
      var sinkY = sinkT * -2.0;
      if (room.candleL) room.candleL.group.position.y = 1.56 + sinkY;
      if (room.candleR) room.candleR.group.position.y = 1.56 + sinkY;
      if (room.crystalOrb) room.crystalOrb.position.y = 1.64 + sinkY;
      if (room.orbLight) room.orbLight.position.y = 1.64 + sinkY;
    }
  }

  // === SMOOTH CAMERA UPDATE (called from pen.js via scroll.js) ===
  function updateSmoothCamera(targetPos, lookTarget) {
    if (!camera) return;
    cameraTargetPos.copy(targetPos);
    cameraLookTarget.copy(lookTarget);
  }

  function updateTargetFov(fov) {
    cameraTargetFov = fov;
  }

  function applySmoothCamera() {
    if (!camera) return;

    // Adaptive exponential damping — scales with distance for fast-scroll catch-up
    // Near target: cinematic inertia; far away (fast scroll): aggressive recovery
    var posDist = camera.position.distanceTo(cameraTargetPos);
    var adaptivePosSpeed = CAMERA_POS_SMOOTH + Math.min(posDist * 10.0, 14.0);
    dampVec3(camera.position, cameraTargetPos, adaptivePosSpeed, deltaTime);

    // Clamp camera inside room bounds (tighter to prevent wall/object clipping)
    camera.position.x = Math.max(-3.0, Math.min(3.0, camera.position.x));
    camera.position.y = Math.max(1.5, Math.min(4.5, camera.position.y));
    camera.position.z = Math.max(-3.0, Math.min(3.0, camera.position.z));

    // === CINEMATIC HAND-HELD MICRO-SHAKE ===
    // Multi-frequency Lissajous sum creates organic, non-mechanical camera tremor.
    // Amplitude scales with shot type: imperceptible during intimate/macro shots,
    // subtly present during flight, slightly stronger during dramatic orbit.
    var breatheTime = _animTime;
    var t = breatheTime;
    var shakeAmp = 0.0040;
    if (progress < 0.05 || (progress > 0.78 && progress < 0.88)) {
      shakeAmp = 0.0010;  // Macro / writing: near-imperceptible
    } else if (progress >= 0.28 && progress < 0.38) {
      shakeAmp = 0.0055;  // Orbit: subtle extra emphasis
    }
    // Three-frequency sums per axis for incommensurate (non-repeating) motion
    camera.position.x += (Math.sin(t * 0.41) * 0.55 + Math.sin(t * 1.37) * 0.30 + Math.sin(t * 2.73) * 0.15) * shakeAmp;
    camera.position.y += (Math.sin(t * 0.37 + 1.2) * 0.60 + Math.sin(t * 1.09) * 0.40) * shakeAmp * 0.60;
    camera.position.z += (Math.cos(t * 0.44) * 0.55 + Math.cos(t * 1.51) * 0.30 + Math.cos(t * 2.90) * 0.15) * shakeAmp;

    // Adaptive look-at damping — keeps pen in frame during fast scroll
    var lookDist = cameraCurrentLook.distanceTo(cameraLookTarget);
    var adaptiveLookSpeed = CAMERA_LOOK_SMOOTH + Math.min(lookDist * 12.0, 16.0);
    dampVec3(cameraCurrentLook, cameraLookTarget, adaptiveLookSpeed, deltaTime);
    camera.lookAt(cameraCurrentLook);

    // Frame-rate independent FOV damping
    var newFov = dampVal(camera.fov, cameraTargetFov, CAMERA_FOV_SMOOTH, deltaTime);
    if (Math.abs(newFov - camera.fov) > 0.01) {
      camera.fov = newFov;
      camera.updateProjectionMatrix();
    }
  }

  // === ANIMATION LOOP (ON-DEMAND RENDERING) ===
  var particleThrottleFrame = 0; // throttle slow-moving particles to every 2nd frame
  function animate() {
    if (!isRunning) return;
    requestAnimationFrame(animate);

    var now = performance.now();
    var delta = now - lastFrameTime;
    lastFrameTime = now;
    deltaTime = Math.min(delta / 1000, 0.05);

    // Particles always animate — render every frame while 3D scene is active
    // Use performance.now() (seconds since page load, starts near 0) NOT Date.now()
    // — GLSL 32-bit float loses precision at epoch time (~1.7e9), freezing GPU animations
    var time = now * 0.001;
    _animTime = time;
    particleThrottleFrame++;

    updateAmbientParticles(time);
    updateMagicalParticles(time);
    updateButterflyParticles(time);
    updateFlowerParticles(time);
    if (particleThrottleFrame % 2 === 0 && window.KRKAI_Pen && KRKAI_Pen.updateTrailPhysics) {
      KRKAI_Pen.updateTrailPhysics();
    }
    updateSceneState(progress, time);
    applySmoothCamera();

    // === DYNAMIC DEPTH OF FIELD TRACKING ===
    if (bokehPass && bokehPass.enabled && window.KRKAI_Pen) {
      var penPos = KRKAI_Pen.getPenPosition();
      var focusDist = camera.position.distanceTo(penPos);
      bokehPass.uniforms['focus'].value = dampVal(
        bokehPass.uniforms['focus'].value, focusDist, 2.0, deltaTime
      );
      // Aperture varies: shallow during macro/writing, deeper during environmental
      var targetAperture;
      if (progress < 0.05 || (progress > 0.80 && progress < 0.87)) {
        targetAperture = 0.002;    // Very shallow DOF for macro/writing shots
      } else if (progress > 0.38 && progress < 0.62) {
        targetAperture = 0.0003;   // Deeper DOF for environmental exploration
      } else {
        targetAperture = 0.0008;   // Medium DOF default
      }
      bokehPass.uniforms['aperture'].value = dampVal(
        bokehPass.uniforms['aperture'].value, targetAperture, 1.5, deltaTime
      );
    }

    if (composer) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }

    // === AUTO-PERFORMANCE MONITOR (every 30 frames — 2× faster response than before) ===
    // Skip for low/ultra-low: they have no composer passes to disable.
    // Skip for mobile: uses isMobile flag as before.
    var _skipAutoTune = (_tier === 'low' || _tier === 'ultra-low');
    if (composer && !isMobile && !_skipAutoTune) {
      fpsFrameCount++;
      fpsAccumulator += delta;
      if (fpsFrameCount >= 30) {
        var avgFPS = 30000 / fpsAccumulator;  // was 60000/60frames
        if (avgFPS < 35 && bokehPass && bokehPass.enabled) {
          bokehPass.enabled = false;
        }
        if (avgFPS < 30 && !perfBloomDisabled && bloomPass) {
          bloomPass.enabled = false;
          perfBloomDisabled = true;
        }
        if (avgFPS < 25 && !perfFxaaDisabled && composer.passes.length > 2) {
          composer.passes[composer.passes.length - 1].enabled = false;
          perfFxaaDisabled = true;
        }
        fpsFrameCount = 0;
        fpsAccumulator = 0;
      }
    }
  }

  function onResize() {
    if (!renderer || !camera) return;
    var w = window.innerWidth;
    var h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, _tierSettings.pixelRatioMax));

    // Update post-processing pipeline on resize
    if (composer) {
      composer.setSize(w, h);
      // Update FXAA resolution uniform (must account for pixel ratio)
      var pr = renderer.getPixelRatio();
      var fxaaPass = composer.passes[composer.passes.length - 1];
      if (fxaaPass && fxaaPass.material && fxaaPass.material.uniforms['resolution']) {
        fxaaPass.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
      }
    }
  }

  function setProgress(p) {
    progress = p;

    // Stop rendering entirely once past the 3D section
    if (p >= 0.92 && isRunning) {
      isRunning = false;
    } else if (p < 0.92 && !isRunning) {
      // Restart if user scrolls back up into 3D section
      isRunning = true;
      lastFrameTime = performance.now();
      animate();
    }
  }

  function stop() {
    isRunning = false;
  }

  function start() {
    if (!isRunning) {
      isRunning = true;
      lastFrameTime = performance.now();
      animate();
    }
  }

  function fadeCanvas(opacity) {
    var canvas = document.getElementById('three-canvas');
    if (canvas) canvas.style.opacity = opacity;
  }

  return {
    init: init,
    setProgress: setProgress,
    stop: stop,
    start: start,
    fadeCanvas: fadeCanvas,
    updateSmoothCamera: updateSmoothCamera,
    updateTargetFov: updateTargetFov,
    getDeltaTime: function() { return deltaTime; },
    getCamera: function() { return camera; },
    getScene: function() { return scene; },
    getRenderer: function() { return renderer; },
    getNibLight: function() { return nibLight; },
    getRoom: function() { return room; }
  };
})();
