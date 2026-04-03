/* ============================================
   KRKAI — 3D Photo Room Gallery
   Interactive Three.js rooms with OrbitControls
   Features: click-zoom, nav, minimap, thumbs,
             progress, room-switcher, tour, sound
   ============================================ */

var KRKAI_Rooms = (function() {
  'use strict';

  // Loaded from rooms-manifest.json at init — allows adding rooms without code changes.
  // Fallback to hardcoded list if manifest fetch fails.
  var ROOM_CONFIG = [
    { id: 'porur-1',         label: 'Porur 1',         path: 'images/rooms/porur-1/',         count: 63 },
    { id: 'porur-2',         label: 'Porur 2',         path: 'images/rooms/porur-2/',         count: 11 },
    { id: 'chembarambakkam', label: 'Chembarambakkam', path: 'images/rooms/Chembarambakkam/', count: 27 }
  ];

  var MAX_PHOTOS  = 100;  // safety cap for rooms without a count in manifest
  var FRAME_WIDTH = 1.2;
  var FRAME_HEIGHT= 0.9;
  var FRAME_GAP   = 0.4;
  var FRAME_Y     = 1.6;
  var AMBIENT_COUNT = 150;

  // ── state ──────────────────────────────────────────────────────────────
  var renderer, camera, scene, controls;
  var isOpen = false;
  var animationId = null;
  var loadingRoomId = null;
  var currentRoomId = null;

  var ambientParticles, ambientVelocities, ambientPositions;

  // Raycasting & focus
  var raycaster = null;
  var mousePx = { x: 0, y: 0 };
  var mouseNdc= { x: 0, y: 0 };
  var mouseMoved = false;          // only raycast when mouse actually moved
  var frameMeshes = [];
  var frameMeshList = [];          // flat array cached so map() never runs in animate loop
  var focusedIndex = -1;
  var hoveredIndex = -1;
  var isTweening   = false;
  var roomCanvas   = null;         // cached once to avoid getElementById in hot path

  // Session-scoped caches — survive room close for instant re-open
  var textureCache     = {};  // url → THREE.Texture (kept alive across room closes)
  var roomPhotoCache   = {};  // roomId → photoUrls[] (skip rediscovery on reopen)
  var roomPreloadCache = {};  // roomId → { status: 'loading'|'done', photoUrls:[] }
  var lqipCache        = {};  // roomId → { num → dataURL } (blur-up placeholders)

  // Default camera pose
  var DEFAULT_POS    = { x: 0, y: 1.6, z: 1.5 };
  var DEFAULT_TARGET = { x: 0, y: 1.6, z: 0 };

  // Auto-tour
  var tourActive  = false;
  var tourTimeout = null;
  var TOUR_INTERVAL = 3500;

  // Ambient sound
  var audioCtx    = null;
  var audioGain   = null;
  var soundEnabled= false;

  // ── safe DOM helpers ───────────────────────────────────────────────────
  function clearChildren(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  // ── texture utilities ──────────────────────────────────────────────────
  function createCircleTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 32;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(16,16,0,16,16,16);
    g.addColorStop(0,   'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.3)');
    g.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,32,32);
    var tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  function loadRoomImageTexture(src, onLoad, fallbackCanvas) {
    // Return cached texture immediately — avoids re-downloading on room reopen
    if (textureCache[src]) { onLoad(textureCache[src]); return; }
    var loader = new THREE.TextureLoader();
    loader.load(src, function(tex) {
      tex.minFilter = THREE.LinearFilter;
      textureCache[src] = tex;  // store for reuse across room sessions
      onLoad(tex);
    }, undefined, function() {
      var img = new Image();
      img.onload = function() {
        try {
          var c = document.createElement('canvas');
          c.width  = img.naturalWidth  || 512;
          c.height = img.naturalHeight || 512;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var tex = new THREE.CanvasTexture(c);
          tex.minFilter = THREE.LinearFilter;
          tex.needsUpdate = true;
          onLoad(tex);
        } catch(e) { useFallback(); }
      };
      img.onerror = useFallback;
      img.src = src;
    });
    function useFallback() {
      if (fallbackCanvas) {
        var t = new THREE.CanvasTexture(fallbackCanvas);
        t.minFilter = THREE.LinearFilter;
        onLoad(t);
      }
    }
  }

  // Minimal dark placeholder — shown only while real photo loads
  // Creates a placeholder canvas: solid dark if no LQIP available,
  // or a blurry mini-image when an LQIP base64 is provided.
  function createRoomPhotoCanvas(lqipDataUrl) {
    var c = document.createElement('canvas');
    c.width = 400; c.height = 300;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#1A1410';
    ctx.fillRect(0, 0, 400, 300);
    if (lqipDataUrl) {
      var img = new Image();
      img.onload = function() {
        ctx.filter = 'blur(4px)';
        ctx.drawImage(img, 0, 0, 400, 300);
        ctx.filter = 'none';
      };
      img.src = lqipDataUrl;
    }
    return c;
  }

  // Fetches lqip.json for a room and caches it. No-op if already cached or missing.
  function fetchLqip(config) {
    var roomId = config.id;
    if (lqipCache[roomId]) return;  // already fetched
    lqipCache[roomId] = {};         // mark as fetching (avoid duplicate requests)
    fetch(config.path + 'lqip.json')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) { if (data) lqipCache[roomId] = data; })
      .catch(function() {});  // silently ignore missing lqip.json
  }

  function createGalleryWallTexture() {
    var S = 512;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var ctx = c.getContext('2d');

    // Fast ImageData approach — avoids 40k CSS string parses from fillStyle in a loop
    var imgData = ctx.createImageData(S, S);
    var d = imgData.data;
    // Fill base color #1A0F30
    for (var p = 0; p < S * S * 4; p += 4) {
      d[p] = 0x1A; d[p+1] = 0x0F; d[p+2] = 0x30; d[p+3] = 255;
    }
    // Add stucco noise — direct pixel manipulation, no fillStyle/fillRect per iteration
    for (var i = 0; i < 40000; i++) {
      var x = (Math.random() * (S - 1)) | 0;
      var y = (Math.random() * (S - 1)) | 0;
      var alpha = (Math.random() * 0.04 * 255) | 0;
      var isWhite = Math.random() > 0.5;
      // Apply to a 2×2 block
      for (var dy = 0; dy < 2; dy++) {
        for (var dx = 0; dx < 2; dx++) {
          var pi = ((y + dy) * S + (x + dx)) * 4;
          if (isWhite) {
            d[pi]   = Math.min(255, d[pi]   + alpha);
            d[pi+1] = Math.min(255, d[pi+1] + alpha);
            d[pi+2] = Math.min(255, d[pi+2] + alpha);
          } else {
            var darkAlpha = alpha * 2;
            d[pi]   = Math.max(0, d[pi]   - ((d[pi]   * darkAlpha) >> 8));
            d[pi+1] = Math.max(0, d[pi+1] - ((d[pi+1] * darkAlpha) >> 8));
            d[pi+2] = Math.max(0, d[pi+2] - ((d[pi+2] * darkAlpha) >> 8));
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Soft ambient occlusion gradient on top
    var grad = ctx.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0,    'rgba(8,3,18,0.3)');
    grad.addColorStop(0.12, 'rgba(8,3,18,0)');
    grad.addColorStop(0.88, 'rgba(8,3,18,0)');
    grad.addColorStop(1,    'rgba(8,3,18,0.4)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, S, S);

    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.repeat.set(4, 2);
    return tex;
  }

  // ── init ───────────────────────────────────────────────────────────────
  function init() {
    // Try to load rooms-manifest.json for up-to-date room list + photo counts.
    // Falls back to the hardcoded ROOM_CONFIG if the fetch fails.
    fetch('rooms-manifest.json')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (data && Array.isArray(data.rooms) && data.rooms.length) {
          ROOM_CONFIG = data.rooms;
        }
        afterManifestLoaded();
      })
      .catch(function() { afterManifestLoaded(); });
  }

  function afterManifestLoaded() {
    buildRoomButtons();
    buildRoomSwitcher();
    setupExitButton();
    setupResizeHandler();
    setupNavButtons();
    setupMinimap();

    // Scroll preload — start loading the first room silently when the
    // Stories section scrolls into view, giving a head start before any hover.
    if (typeof IntersectionObserver !== 'undefined') {
      var scrollTarget = document.getElementById('room-buttons');
      if (scrollTarget && ROOM_CONFIG.length > 0) {
        var obs = new IntersectionObserver(function(entries) {
          if (entries[0].isIntersecting) {
            preloadRoom(ROOM_CONFIG[0].id);
            obs.disconnect();
          }
        }, { threshold: 0.3 });
        obs.observe(scrollTarget);
      }
    }
  }

  function buildRoomButtons() {
    var container = document.getElementById('room-buttons');
    if (!container) return;
    for (var i=0; i<ROOM_CONFIG.length; i++) {
      var btn = document.createElement('button');
      btn.className = 'btn btn-outline room-select-btn';
      btn.textContent = ROOM_CONFIG[i].label;
      btn.setAttribute('data-room', ROOM_CONFIG[i].id);
      btn.addEventListener('click', onRoomClick);
      // Hover preload — start fetching images before the user clicks
      (function(roomId) {
        btn.addEventListener('mouseenter', function() { preloadRoom(roomId); });
      })(ROOM_CONFIG[i].id);
      container.appendChild(btn);
    }
  }

  function buildRoomSwitcher() {
    var sw = document.getElementById('room-switcher');
    if (!sw) return;
    clearChildren(sw);
    for (var i=0; i<ROOM_CONFIG.length; i++) {
      (function(cfg) {
        var btn = document.createElement('button');
        btn.className = 'room-switch-btn';
        btn.textContent = cfg.label;
        btn.setAttribute('data-room', cfg.id);
        btn.addEventListener('click', function() {
          if (cfg.id !== currentRoomId) switchRoom(cfg.id);
        });
        sw.appendChild(btn);
      })(ROOM_CONFIG[i]);
    }
  }

  function updateSwitcherHighlight() {
    var btns = document.querySelectorAll('.room-switch-btn');
    for (var i=0; i<btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-room') === currentRoomId);
    }
  }

  function onRoomClick(e) {
    var roomId = e.target.getAttribute('data-room');
    if (roomId) openRoom(roomId);
  }

  // ── open / close / switch ──────────────────────────────────────────────
  function openRoom(roomId) {
    var config = null;
    for (var i=0; i<ROOM_CONFIG.length; i++) {
      if (ROOM_CONFIG[i].id === roomId) { config = ROOM_CONFIG[i]; break; }
    }
    if (!config) return;

    loadingRoomId  = roomId;
    currentRoomId  = roomId;
    focusedIndex   = -1;
    hoveredIndex   = -1;
    frameMeshes    = [];
    tourActive     = false;
    clearTourTimeout();

    var overlay = document.getElementById('room-overlay');
    if (overlay) overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    initRoomRenderer();
    isOpen = true;

    updateSwitcherHighlight();
    updateTourBtn();
    resetThumbs();

    // Start fetching LQIP placeholders in the background (non-blocking).
    fetchLqip(config);

    // Build room geometry immediately from the known photo count — no waiting.
    var entries = buildKnownPhotoList(config);
    buildRoom(entries, config);
    animateRoom();
    hideLoading();

    // Stream textures in progressively. Visible-wall frames load first.
    // Cache resolved URLs so reopening the room is instant (zero network).
    var cachedUrls = roomPhotoCache[roomId];
    if (cachedUrls) {
      populateThumbs(cachedUrls);
    } else {
      resolveAllPhotos(config, function(photoUrls) {
        if (currentRoomId === roomId) {
          roomPhotoCache[roomId] = photoUrls;
          populateThumbs(photoUrls);
        }
      });
    }
  }

  function switchRoom(roomId) {
    stopTour();
    var canvas = document.getElementById('room-canvas');
    if (canvas) {
      canvas.style.transition = 'opacity 0.3s ease';
      canvas.style.opacity = '0';
    }
    setTimeout(function() {
      closeRoomInternal();
      if (canvas) { canvas.style.transition = ''; canvas.style.opacity = '1'; }
      openRoom(roomId);
    }, 320);
  }

  function closeRoomInternal() {
    isOpen = false;
    loadingRoomId = null;
    if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
    frameMeshes  = [];
    frameMeshList = [];
    roomCanvas   = null;
    focusedIndex = -1;
    hoveredIndex = -1;
    stopAmbientSound();

    if (scene) {
      scene.traverse(function(obj) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          // Skip disposing textures in the session cache — they'll be reused on room reopen
          var map = obj.material.map;
          if (map && !(map.image && textureCache[map.image.src])) map.dispose();
          obj.material.dispose();
        }
      });
    }
    var canvas = document.getElementById('room-canvas');
    if (canvas) { canvas.removeEventListener('mousemove', onMouseMove); canvas.removeEventListener('click', onCanvasClick); canvas.removeEventListener('touchstart', onTouchStart); }
    if (renderer) { renderer.dispose(); renderer = null; }
    scene = null; camera = null; controls = null;
  }

  function closeRoom() {
    stopTour();
    closeRoomInternal();
    var overlay = document.getElementById('room-overlay');
    if (overlay) overlay.classList.add('hidden');
    document.body.style.overflow = '';
    resetThumbs();
    hideCaption();
  }

  // ── renderer + scene setup ─────────────────────────────────────────────
  function initRoomRenderer() {
    var canvas = document.getElementById('room-canvas');
    if (!canvas) return;

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x0A0308);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 50);
    camera.position.set(DEFAULT_POS.x, DEFAULT_POS.y, DEFAULT_POS.z);

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0A0308, 0.010);

    raycaster = new THREE.Raycaster();

    if (typeof THREE.OrbitControls !== 'undefined') {
      controls = new THREE.OrbitControls(camera, canvas);
      controls.enableDamping  = true;
      controls.dampingFactor  = 0.08;
      controls.enableZoom     = true;
      controls.minDistance    = 0.5;
      controls.maxDistance    = 8;
      controls.enablePan      = false;
      controls.target.set(DEFAULT_TARGET.x, DEFAULT_TARGET.y, DEFAULT_TARGET.z);
      controls.maxPolarAngle  = Math.PI * 0.85;
      controls.minPolarAngle  = Math.PI * 0.15;
    }

    // Lights
    scene.add(new THREE.HemisphereLight(0xFFAA44, 0x1A0F30, 0.35));
    scene.add(new THREE.AmbientLight(0x4A2A08, 0.3));
    var centerLight = new THREE.PointLight(0xFFB347, 0.6, 25);
    centerLight.position.set(0, 2.8, 0); scene.add(centerLight);
    var warmFill = new THREE.PointLight(0xFF8C30, 0.30, 20);
    warmFill.position.set(0, 1.0, 0); scene.add(warmFill);

    // Particles
    var pGeo = new THREE.BufferGeometry();
    ambientPositions  = new Float32Array(AMBIENT_COUNT * 3);
    ambientVelocities = [];
    for (var i=0; i<AMBIENT_COUNT; i++) {
      ambientPositions[i*3]   = (Math.random()-0.5)*15;
      ambientPositions[i*3+1] = Math.random()*4;
      ambientPositions[i*3+2] = (Math.random()-0.5)*15;
      ambientVelocities.push({
        x: (Math.random()-0.5)*0.005,
        y: Math.random()*0.01+0.002,
        z: (Math.random()-0.5)*0.005
      });
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(ambientPositions, 3));
    var pMat = new THREE.PointsMaterial({
      color: 0xD4AF37, size: 0.015, transparent: true, opacity: 0.12,
      map: createCircleTexture(), blending: THREE.NormalBlending, depthWrite: false
    });
    ambientParticles = new THREE.Points(pGeo, pMat);
    scene.add(ambientParticles);

    // Events
    canvas.addEventListener('mousemove',  onMouseMove);
    canvas.addEventListener('click',      onCanvasClick);
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  }

  // ── room geometry ──────────────────────────────────────────────────────
  // entries: array of { num, avif, webp, fallback } from buildKnownPhotoList()
  function buildRoom(entries, config) {
    var count = entries.length;
    if (count === 0) { showLoading('No photos found in this room yet.'); return; }

    var perWall    = Math.ceil(count / 4);
    var wallLength = Math.max(perWall * (FRAME_WIDTH + FRAME_GAP) + FRAME_GAP, 4);
    var halfLen    = wallLength / 2;
    var roomHeight = 3.2;

    var floorMat   = new THREE.MeshStandardMaterial({ color: 0x5C4033, roughness: 0.7, metalness: 0 });
    var wallTex    = createGalleryWallTexture();
    var wallMat    = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.92, metalness: 0, color: 0x1A0F30, side: THREE.DoubleSide });
    var ceilMat    = new THREE.MeshStandardMaterial({ color: 0x0A0415, roughness: 1.0, metalness: 0 });
    var frameMat   = new THREE.MeshStandardMaterial({ color: 0xD4AF37, roughness: 0.4, metalness: 0.4 });
    var wainscotMat= new THREE.MeshStandardMaterial({ color: 0x3D2B1F, roughness: 0.75, metalness: 0 });
    var moldingMat = new THREE.MeshStandardMaterial({ color: 0xD4AF37, roughness: 0.4, metalness: 0.4 });

    var floor = new THREE.Mesh(new THREE.PlaneGeometry(wallLength, wallLength), floorMat);
    floor.rotation.x = -Math.PI/2; scene.add(floor);
    var ceil = new THREE.Mesh(new THREE.PlaneGeometry(wallLength, wallLength), ceilMat);
    ceil.rotation.x = Math.PI/2; ceil.position.y = roomHeight; scene.add(ceil);

    var wallDefs = [
      { pos: [0, roomHeight/2, -halfLen], rotY: 0 },
      { pos: [0, roomHeight/2,  halfLen], rotY: Math.PI },
      { pos: [-halfLen, roomHeight/2, 0], rotY:  Math.PI/2 },
      { pos: [ halfLen, roomHeight/2, 0], rotY: -Math.PI/2 }
    ];
    for (var w=0; w<4; w++) {
      var wall = new THREE.Mesh(new THREE.PlaneGeometry(wallLength, roomHeight), wallMat);
      wall.position.set(wallDefs[w].pos[0], wallDefs[w].pos[1], wallDefs[w].pos[2]);
      wall.rotation.y = wallDefs[w].rotY;
      scene.add(wall);
    }

    // Wainscoting
    function createWainscoting(width, posX, posZ, rotY) {
      var group  = new THREE.Group();
      var panelH = 1.0;
      var backPanel = new THREE.Mesh(new THREE.BoxGeometry(width, panelH, 0.03), wainscotMat);
      backPanel.position.set(0, panelH/2, 0); group.add(backPanel);
      var baseboard = new THREE.Mesh(new THREE.BoxGeometry(width, 0.15, 0.05), moldingMat);
      baseboard.position.set(0, 0.075, 0.01); group.add(baseboard);
      var runicMat = new THREE.MeshStandardMaterial({ color: 0xD4AF37, roughness: 0.4, metalness: 0.4 });
      var glowRail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.02, 0.065), runicMat);
      glowRail.position.set(0, panelH, 0.015); group.add(glowRail);
      var chairBase = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 0.06), moldingMat);
      chairBase.position.set(0, panelH, 0.01); group.add(chairBase);
      var panelWidth = 1.0;
      var panelCount = Math.floor(width/panelWidth);
      var spacing    = (width - panelCount*panelWidth)/(panelCount+1);
      for (var p=0; p<panelCount; p++) {
        var px = -width/2 + spacing + panelWidth/2 + p*(panelWidth+spacing);
        var trim = new THREE.Mesh(new THREE.BoxGeometry(panelWidth-0.1, panelH-0.3, 0.045), moldingMat);
        trim.position.set(px, panelH/2, 0.005); group.add(trim);
        var inner = new THREE.Mesh(new THREE.BoxGeometry(panelWidth-0.16, panelH-0.36, 0.05), wainscotMat);
        inner.position.set(px, panelH/2, 0.005); group.add(inner);
      }
      group.position.set(posX, 0, posZ);
      group.rotation.y = rotY;
      return group;
    }
    scene.add(createWainscoting(wallLength, 0,       -halfLen+0.02, 0));
    scene.add(createWainscoting(wallLength, 0,        halfLen-0.02, Math.PI));
    scene.add(createWainscoting(wallLength, -halfLen+0.02, 0,  Math.PI/2));
    scene.add(createWainscoting(wallLength,  halfLen-0.02, 0, -Math.PI/2));

    // Crown molding
    for (var ww=0; ww<4; ww++) {
      var crown = new THREE.Mesh(new THREE.BoxGeometry(wallLength, 0.15, 0.15), moldingMat);
      var cy = roomHeight - 0.075;
      if      (ww===0) crown.position.set(0,  cy, -halfLen+0.075);
      else if (ww===1) crown.position.set(0,  cy,  halfLen-0.075);
      else if (ww===2) { crown.geometry = new THREE.BoxGeometry(0.15,0.15,wallLength); crown.position.set(-halfLen+0.075, cy, 0); }
      else             { crown.geometry = new THREE.BoxGeometry(0.15,0.15,wallLength); crown.position.set( halfLen-0.075, cy, 0); }
      scene.add(crown);
    }

    // Photo frames
    var photoIndex = 0;
    var lightCount = 0, MAX_LIGHTS = 16;
    var roomLabel  = config.label;

    for (var wi=0; wi<4 && photoIndex<count; wi++) {
      var photosOnWall = Math.min(perWall, count-photoIndex);
      var totalWidth   = photosOnWall*FRAME_WIDTH + (photosOnWall-1)*FRAME_GAP;
      var startX       = -totalWidth/2 + FRAME_WIDTH/2;

      for (var f=0; f<photosOnWall; f++) {
        var localX = startX + f*(FRAME_WIDTH+FRAME_GAP);
        placePhoto(entries[photoIndex], wi, localX, halfLen, frameMat, photoIndex, roomLabel);

        if (lightCount < MAX_LIGHTS) {
          var lp = getFramePosition(wi, localX, halfLen);
          var pLight = new THREE.PointLight(0xFFCC88, 0.18, 5);
          var lx = lp.x, ly = FRAME_Y+0.8, lz = lp.z;
          if      (wi===0) lz += 0.8;
          else if (wi===1) lz -= 0.8;
          else if (wi===2) lx += 0.8;
          else             lx -= 0.8;
          pLight.position.set(lx, ly, lz);
          scene.add(pLight);
          lightCount++;
        }
        photoIndex++;
      }
    }

    // Wall wash
    var washColor = 0xD4C4A8, washDist = wallLength*2, washY = roomHeight-0.3;
    var washInset = halfLen-0.5;
    [[0,washY,-washInset],[0,washY,washInset],[-washInset,washY,0],[washInset,washY,0]].forEach(function(p) {
      var wl = new THREE.PointLight(washColor, 0.35, washDist);
      wl.position.set(p[0],p[1],p[2]); scene.add(wl);
    });

    if (controls) { controls.target.set(0,1.6,0); controls.update(); }
  }

  function getFramePosition(wallIndex, localX, halfLen) {
    var off = 0.03;
    switch(wallIndex) {
      case 0: return { x:  localX, y: FRAME_Y, z: -halfLen+off };
      case 1: return { x: -localX, y: FRAME_Y, z:  halfLen-off };
      case 2: return { x: -halfLen+off, y: FRAME_Y, z:  localX };
      case 3: return { x:  halfLen-off, y: FRAME_Y, z: -localX };
    }
    return { x:0, y:FRAME_Y, z:0 };
  }

  // entry: { num, avif, webp, fallback } from buildKnownPhotoList(), or a plain URL string
  //        (plain string used when re-opening from roomPhotoCache)
  function placePhoto(entry, wallIndex, localX, halfLen, frameMat, idx, roomLabel) {
    var off     = 0.03;
    var frameGroup = new THREE.Group();

    // Use LQIP blur-up placeholder if available — shows blurry colour hint while real thumb loads.
    var lqipDataUrl = null;
    if (typeof entry === 'object' && entry.num) {
      var lqipRoom = lqipCache[currentRoomId];
      if (lqipRoom) lqipDataUrl = lqipRoom[String(entry.num)] || null;
    }
    var fallbackCanvas = createRoomPhotoCanvas(lqipDataUrl);
    var fallbackTex    = new THREE.CanvasTexture(fallbackCanvas);
    fallbackTex.minFilter = THREE.LinearFilter;

    var photoMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(FRAME_WIDTH, FRAME_HEIGHT),
      new THREE.MeshBasicMaterial({ map: fallbackTex, side: THREE.DoubleSide })
    );
    // Show the dark placeholder immediately — user sees the frame while texture loads.
    photoMesh.visible = true;
    frameGroup.add(photoMesh);

    // Determine load URL: either a plain string (cached reopen) or an entry object.
    // Camera-facing wall (wall 0) gets priority — its textures load before other walls.
    var expectedRoom = currentRoomId;
    var isFront      = (wallIndex === 0);
    var primaryUrl   = (typeof entry === 'string') ? entry : (entry.webp || entry.fallback);

    function loadTex() {
      if (typeof entry === 'string') {
        loadRoomImageTexture(entry, onTexReady, fallbackCanvas);
      } else {
        // Try AVIF first (smaller), fall back to WebP thumbnail, then full-res WebP
        resolvePhotoSrc(entry, function(resolvedUrl) {
          if (!resolvedUrl) return;  // genuinely missing — placeholder stays
          loadRoomImageTexture(resolvedUrl, onTexReady, fallbackCanvas);
        });
      }
    }

    function onTexReady(tex) {
      if (currentRoomId !== expectedRoom) { tex.dispose(); return; }
      photoMesh.material.dispose();
      photoMesh.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    }

    // Front wall loads immediately; other walls are deferred by one rAF tick
    // so the renderer gets a chance to paint the first frame before background loading starts.
    if (isFront) {
      loadTex();
    } else {
      setTimeout(loadTex, 0);
    }

    var url = primaryUrl;  // for frameMeshes metadata

    function createRoomFrameBar(w,h,d,x,y,z,mat) {
      var bar = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
      bar.position.set(x,y,z);
      return bar;
    }
    var bt = 0.05, bd = 0.04;
    frameGroup.add(createRoomFrameBar(FRAME_WIDTH+bt*2, bt, bd, 0,  FRAME_HEIGHT/2+bt/2, bd/2, frameMat));
    frameGroup.add(createRoomFrameBar(FRAME_WIDTH+bt*2, bt, bd, 0, -FRAME_HEIGHT/2-bt/2, bd/2, frameMat));
    frameGroup.add(createRoomFrameBar(bt, FRAME_HEIGHT, bd, -FRAME_WIDTH/2-bt/2, 0, bd/2, frameMat));
    frameGroup.add(createRoomFrameBar(bt, FRAME_HEIGHT, bd,  FRAME_WIDTH/2+bt/2, 0, bd/2, frameMat));

    switch(wallIndex) {
      case 0: frameGroup.position.set( localX, FRAME_Y, -halfLen+off); break;
      case 1: frameGroup.position.set(-localX, FRAME_Y,  halfLen-off); frameGroup.rotation.y = Math.PI;    break;
      case 2: frameGroup.position.set(-halfLen+off, FRAME_Y,  localX); frameGroup.rotation.y = Math.PI/2;  break;
      case 3: frameGroup.position.set( halfLen-off, FRAME_Y, -localX); frameGroup.rotation.y = -Math.PI/2; break;
    }
    scene.add(frameGroup);

    frameGroup.updateMatrixWorld(true);
    var wp = new THREE.Vector3();
    photoMesh.getWorldPosition(wp);

    var photoNum = (url.match(/\/(\d+)\.\w+(\?|$)/) || [])[1] || String(idx + 1);
    frameMeshes.push({
      mesh:      photoMesh,
      worldPos:  wp.clone(),
      wallIndex: wallIndex,
      index:     idx,
      url:       url,
      roomLabel: roomLabel,
      photoNum:  photoNum
    });
    frameMeshList.push(photoMesh);  // flat cache — avoids map() every frame
  }

  // ── raycasting / hover / click ─────────────────────────────────────────
  function onMouseMove(e) {
    var rect = renderer ? renderer.domElement.getBoundingClientRect() : null;
    if (!rect) return;
    mousePx.x = e.clientX;
    mousePx.y = e.clientY;
    mouseNdc.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    mouseNdc.y =-((e.clientY - rect.top)  / rect.height) * 2 + 1;
    mouseMoved = true;
  }

  function onTouchStart(e) {
    if (!e.touches.length) return;
    var rect = renderer ? renderer.domElement.getBoundingClientRect() : null;
    if (!rect) return;
    var tx = e.touches[0].clientX, ty = e.touches[0].clientY;
    mousePx.x = tx; mousePx.y = ty;
    mouseNdc.x = ((tx - rect.left) / rect.width)  * 2 - 1;
    mouseNdc.y =-((ty - rect.top)  / rect.height) * 2 + 1;
    var savedNdc = { x: mouseNdc.x, y: mouseNdc.y };
    setTimeout(function() { handlePickAt(savedNdc); }, 80);
  }

  function onCanvasClick(e) {
    if (!renderer) return;
    var rect = renderer.domElement.getBoundingClientRect();
    handlePickAt({
      x: ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      y:-((e.clientY - rect.top)  / rect.height) * 2 + 1
    });
  }

  function handlePickAt(ndc) {
    if (isTweening || !raycaster || !camera) return;
    var meshes = frameMeshes.map(function(fm) { return fm.mesh; });
    raycaster.setFromCamera(ndc, camera);
    var hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      var hitMesh = hits[0].object;
      for (var i=0; i<frameMeshes.length; i++) {
        if (frameMeshes[i].mesh === hitMesh) {
          stopTour();
          zoomToFrame(i);
          return;
        }
      }
    }
    if (focusedIndex >= 0) zoomToDefault();
  }

  function updateHover() {
    if (isTweening || !raycaster || !camera || frameMeshList.length === 0) return;
    // Only raycast when mouse has actually moved — saves ~60 intersection tests/sec at rest
    if (!mouseMoved) return;
    mouseMoved = false;

    raycaster.setFromCamera(mouseNdc, camera);
    var hits = raycaster.intersectObjects(frameMeshList, false);

    var newHover = -1;
    if (hits.length > 0) {
      var hitMesh = hits[0].object;
      for (var i = 0; i < frameMeshes.length; i++) {
        if (frameMeshes[i].mesh === hitMesh) { newHover = i; break; }
      }
    }

    if (newHover !== hoveredIndex) {
      if (hoveredIndex >= 0 && frameMeshes[hoveredIndex] && hoveredIndex !== focusedIndex) {
        frameMeshes[hoveredIndex].mesh.material.color.setRGB(1, 1, 1);
      }
      hoveredIndex = newHover;
      if (hoveredIndex >= 0 && frameMeshes[hoveredIndex] && hoveredIndex !== focusedIndex) {
        frameMeshes[hoveredIndex].mesh.material.color.setRGB(1, 0.96, 0.88);
      }
    }

    if (!roomCanvas) roomCanvas = document.getElementById('room-canvas');
    if (hoveredIndex >= 0) {
      var fm = frameMeshes[hoveredIndex];
      showCaption('Photo ' + fm.photoNum + ' \u00B7 ' + fm.roomLabel, mousePx.x, mousePx.y);
      if (roomCanvas) roomCanvas.style.cursor = 'pointer';
    } else {
      hideCaption();
      if (roomCanvas) roomCanvas.style.cursor = '';
    }
  }

  // ── zoom / navigation ─────────────────────────────────────────────────
  function zoomToFrame(idx) {
    if (idx < 0 || idx >= frameMeshes.length || !camera || !controls) return;
    var fm   = frameMeshes[idx];
    var wp   = fm.worldPos;
    var wi   = fm.wallIndex;
    var dist = 0.95;

    var cx = wp.x, cy = wp.y, cz = wp.z;
    if      (wi===0) cz += dist;
    else if (wi===1) cz -= dist;
    else if (wi===2) cx += dist;
    else             cx -= dist;

    focusedIndex = idx;
    isTweening   = true;

    if (typeof gsap !== 'undefined') {
      gsap.killTweensOf(camera.position);
      gsap.killTweensOf(controls.target);
      gsap.to(camera.position, {
        x: cx, y: cy, z: cz, duration: 1.1, ease: 'power2.inOut',
        onStart:    function() { controls.enabled = false; },
        onComplete: function() { controls.enabled = true; controls.update(); isTweening = false; }
      });
      gsap.to(controls.target, {
        x: wp.x, y: wp.y, z: wp.z, duration: 1.1, ease: 'power2.inOut'
      });
    } else {
      camera.position.set(cx, cy, cz);
      controls.target.set(wp.x, wp.y, wp.z);
      controls.update();
      isTweening = false;
    }

    for (var i=0; i<frameMeshes.length; i++) {
      if (i === idx) {
        frameMeshes[i].mesh.material.color.setRGB(1, 0.97, 0.92); // very subtle warm tint when focused
      } else {
        frameMeshes[i].mesh.material.color.setRGB(1, 1, 1); // pure white = true colors
      }
    }
    updateThumbHighlight(idx);
    setActiveMinimap(wi);
  }

  function zoomToDefault() {
    if (!camera || !controls) return;
    focusedIndex = -1;
    isTweening   = true;

    if (typeof gsap !== 'undefined') {
      gsap.killTweensOf(camera.position);
      gsap.killTweensOf(controls.target);
      gsap.to(camera.position, {
        x: DEFAULT_POS.x, y: DEFAULT_POS.y, z: DEFAULT_POS.z,
        duration: 1.0, ease: 'power2.inOut',
        onStart:    function() { controls.enabled = false; },
        onComplete: function() { controls.enabled = true; controls.update(); isTweening = false; }
      });
      gsap.to(controls.target, {
        x: DEFAULT_TARGET.x, y: DEFAULT_TARGET.y, z: DEFAULT_TARGET.z,
        duration: 1.0, ease: 'power2.inOut'
      });
    } else {
      camera.position.set(DEFAULT_POS.x, DEFAULT_POS.y, DEFAULT_POS.z);
      controls.target.set(DEFAULT_TARGET.x, DEFAULT_TARGET.y, DEFAULT_TARGET.z);
      controls.update();
      isTweening = false;
    }

    for (var i=0; i<frameMeshes.length; i++) {
      frameMeshes[i].mesh.material.color.setRGB(1, 1, 1);
    }
    updateThumbHighlight(-1);
  }

  function flyToWall(wallIndex) {
    if (!camera || !controls) return;
    stopTour();
    focusedIndex = -1;
    isTweening   = true;

    var dist = 2.0;
    var cx = DEFAULT_POS.x, cy = DEFAULT_POS.y, cz = DEFAULT_POS.z;
    var tx = 0, ty = FRAME_Y, tz = 0;
    if      (wallIndex===0) { cz = -dist; tz = -dist-1; }
    else if (wallIndex===1) { cz =  dist; tz =  dist+1; }
    else if (wallIndex===2) { cx = -dist; tx = -dist-1; }
    else if (wallIndex===3) { cx =  dist; tx =  dist+1; }

    if (typeof gsap !== 'undefined') {
      gsap.killTweensOf(camera.position);
      gsap.killTweensOf(controls.target);
      gsap.to(camera.position, {
        x: cx, y: cy, z: cz, duration: 1.0, ease: 'power2.inOut',
        onStart:    function() { controls.enabled = false; },
        onComplete: function() { controls.enabled = true; controls.update(); isTweening = false; }
      });
      gsap.to(controls.target, {
        x: tx, y: ty, z: tz, duration: 1.0, ease: 'power2.inOut'
      });
    } else {
      camera.position.set(cx, cy, cz);
      controls.target.set(tx, ty, tz);
      controls.update();
      isTweening = false;
    }
    setActiveMinimap(wallIndex);
  }

  // Walls 2 (left) and 3 (right) have localX mapped to z-axis, so visual
  // left-to-right order is reversed relative to array index order.
  function wallNavReversed() {
    return focusedIndex >= 0 && frameMeshes[focusedIndex] &&
      (frameMeshes[focusedIndex].wallIndex === 2 || frameMeshes[focusedIndex].wallIndex === 3);
  }

  function navPrev() {
    stopTour();
    if (frameMeshes.length === 0) return;
    var step = wallNavReversed() ? 1 : -1;
    var next = focusedIndex + step;
    if (next >= frameMeshes.length) next = 0;
    if (next < 0) next = frameMeshes.length - 1;
    zoomToFrame(next);
  }

  function navNext() {
    stopTour();
    if (frameMeshes.length === 0) return;
    var step = wallNavReversed() ? -1 : 1;
    var next = focusedIndex + step;
    if (next >= frameMeshes.length) next = 0;
    if (next < 0) next = frameMeshes.length - 1;
    zoomToFrame(next);
  }

  // ── UI helpers ─────────────────────────────────────────────────────────
  function setupNavButtons() {
    var prev = document.getElementById('room-prev-btn');
    var next = document.getElementById('room-next-btn');
    if (prev) prev.addEventListener('click', navPrev);
    if (next) next.addEventListener('click', navNext);
  }

  function setupMinimap() {
    var chips = document.querySelectorAll('.room-wall-chip');
    for (var i=0; i<chips.length; i++) {
      chips[i].addEventListener('click', (function(chip) {
        return function() { flyToWall(parseInt(chip.getAttribute('data-wall'), 10)); };
      })(chips[i]));
    }
  }

  function setActiveMinimap(wallIndex) {
    var chips = document.querySelectorAll('.room-wall-chip');
    for (var i=0; i<chips.length; i++) {
      chips[i].classList.toggle('active', parseInt(chips[i].getAttribute('data-wall'),10) === wallIndex);
    }
  }

  var _minimapDir = new THREE.Vector3(); // reused each call — avoids heap allocation every 12 frames
  function updateMinimapFromCamera() {
    if (!camera) return;
    camera.getWorldDirection(_minimapDir);
    var dir = _minimapDir;
    var walls = [
      { index:0, nx:0, nz:-1 },
      { index:1, nx:0, nz: 1 },
      { index:2, nx:-1,nz: 0 },
      { index:3, nx: 1,nz: 0 }
    ];
    var best = 0, bestDot = -Infinity;
    walls.forEach(function(w) {
      var d = dir.x*w.nx + dir.z*w.nz;
      if (d > bestDot) { bestDot = d; best = w.index; }
    });
    setActiveMinimap(best);
  }

  function showLoading(msg) {
    var el = document.getElementById('room-loading');
    if (el) { el.style.display = 'block'; el.textContent = msg; }
  }
  function hideLoading() {
    var el = document.getElementById('room-loading');
    if (el) el.style.display = 'none';
  }

  function setProgress(pct) {
    var fill = document.getElementById('room-progress-fill');
    if (fill) fill.style.width = pct + '%';
  }

  function showCaption(text, px, py) {
    var el = document.getElementById('room-caption');
    if (!el) return;
    el.textContent = text;
    el.style.left = (px + 12) + 'px';
    el.style.top  = (py - 30) + 'px';
    el.classList.add('visible');
  }
  function hideCaption() {
    var el = document.getElementById('room-caption');
    if (el) el.classList.remove('visible');
  }

  // ── thumbnails ─────────────────────────────────────────────────────────
  function populateThumbs(photoUrls) {
    var strip = document.getElementById('room-thumbs');
    if (!strip) return;
    clearChildren(strip);
    for (var i=0; i<photoUrls.length; i++) {
      var img = document.createElement('img');
      img.className = 'room-thumb';
      img.src = photoUrls[i];
      img.alt = 'Photo ' + (i+1);
      img.setAttribute('data-index', i);
      img.addEventListener('click', (function(idx) {
        return function() { stopTour(); zoomToFrame(idx); };
      })(i));
      strip.appendChild(img);
    }
  }

  function resetThumbs() {
    var strip = document.getElementById('room-thumbs');
    if (strip) clearChildren(strip);
  }

  function updateThumbHighlight(idx) {
    var thumbs = document.querySelectorAll('.room-thumb');
    for (var i=0; i<thumbs.length; i++) {
      thumbs[i].classList.toggle('active', parseInt(thumbs[i].getAttribute('data-index'),10) === idx);
    }
    if (idx >= 0) {
      var active = document.querySelector('.room-thumb.active');
      if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  // ── auto-tour ──────────────────────────────────────────────────────────
  function startTour() {
    if (frameMeshes.length === 0) return;
    tourActive = true;
    updateTourBtn();
    advanceTour();
  }

  function advanceTour() {
    if (!tourActive) return;
    // Always advance by +1 in index order for the tour (covers all walls)
    var next = (focusedIndex + 1) >= frameMeshes.length ? 0 : focusedIndex + 1;
    zoomToFrame(next);
    tourTimeout = setTimeout(advanceTour, TOUR_INTERVAL);
  }

  function stopTour() {
    tourActive = false;
    clearTourTimeout();
    updateTourBtn();
  }

  function clearTourTimeout() {
    if (tourTimeout) { clearTimeout(tourTimeout); tourTimeout = null; }
  }

  function updateTourBtn() {
    var btn = document.getElementById('room-tour-btn');
    if (!btn) return;
    // Use Unicode characters directly (safe textContent)
    btn.textContent = tourActive ? '\u23F8' : '\u25B6';
    btn.classList.toggle('active', tourActive);
    btn.title = tourActive ? 'Stop Tour' : 'Auto Tour';
  }

  // ── ambient sound ──────────────────────────────────────────────────────
  function initAmbientSound() {
    if (audioCtx) return;
    try {
      var AudioCtxCtor = window.AudioContext || (window['webkitAudioContext']);
      audioCtx  = new AudioCtxCtor();
      audioGain = audioCtx.createGain();
      audioGain.gain.value = 0;
      audioGain.connect(audioCtx.destination);

      var osc1 = audioCtx.createOscillator();
      osc1.type = 'sine'; osc1.frequency.value = 48;
      var g1 = audioCtx.createGain(); g1.gain.value = 0.04;

      var osc2 = audioCtx.createOscillator();
      osc2.type = 'sine'; osc2.frequency.value = 48 * Math.pow(2, 7/1200);
      var g2 = audioCtx.createGain(); g2.gain.value = 0.025;

      var filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 200;

      osc1.connect(g1); g1.connect(filter);
      osc2.connect(g2); g2.connect(filter);
      filter.connect(audioGain);
      osc1.start(); osc2.start();
    } catch(e) {
      console.warn('KRKAI: Ambient sound unavailable', e);
      audioCtx = null; audioGain = null;
    }
  }

  function enableSound() {
    initAmbientSound();
    if (!audioCtx || !audioGain) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    audioGain.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.5);
    soundEnabled = true;
    updateSoundBtn();
  }

  function disableSound() {
    if (audioCtx && audioGain) {
      audioGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.3);
    }
    soundEnabled = false;
    updateSoundBtn();
  }

  function stopAmbientSound() {
    if (audioCtx) {
      try { audioCtx.close(); } catch(e) {}
      audioCtx = null; audioGain = null;
    }
    soundEnabled = false;
    updateSoundBtn();
  }

  function updateSoundBtn() {
    var btn = document.getElementById('room-sound-btn');
    if (!btn) return;
    // U+1F50A = speaker with three sound waves, U+1F507 = muted speaker
    btn.textContent = soundEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
    btn.title       = soundEnabled ? 'Mute Sound' : 'Enable Sound';
    btn.classList.toggle('active', soundEnabled);
  }

  // ── photo URL generation ───────────────────────────────────────────────
  // Generates the photo URL list instantly from the manifest count — no network probing.
  // Falls back to AVIF thumbnails first, then WebP. Full-res WebP/JPG/PNG as last resort.
  function buildKnownPhotoList(config) {
    var isMobile = window.innerWidth < 768;
    var thumbDir = isMobile ? 'thumbs-sm/' : 'thumbs/';
    var count    = config.count || MAX_PHOTOS;
    var urls     = [];
    for (var n = 1; n <= count; n++) {
      // Prefer AVIF (smallest), fall back to WebP thumbnail, then full-res WebP
      urls.push({
        num:      n,
        avif:     config.path + thumbDir + n + '.avif',
        webp:     config.path + thumbDir + n + '.webp',
        fallback: config.path + n + '.webp'
      });
    }
    return urls;
  }

  // Resolves the best available URL for a single photo slot.
  // Tries AVIF → WebP thumb → full-res WebP → JPG → PNG.
  function resolvePhotoSrc(entry, onResolved) {
    var img = new Image();
    img.onload = function() { onResolved(entry.avif); };
    img.onerror = function() {
      var img2 = new Image();
      img2.onload = function() { onResolved(entry.webp); };
      img2.onerror = function() {
        var img3 = new Image();
        img3.onload = function() { onResolved(entry.fallback); };
        img3.onerror = function() {
          // Try JPG / PNG variants of the original
          var jpgSrc = entry.fallback.replace('.webp', '.jpg');
          var img4 = new Image();
          img4.onload = function() { onResolved(jpgSrc); };
          img4.onerror = function() { onResolved(null); };  // photo genuinely missing
          img4.src = jpgSrc;
        };
        img3.src = entry.fallback;
      };
      img2.src = entry.webp;
    };
    img.src = entry.avif;
  }

  // Silent background preload helper — resolves all URLs without building the room.
  function resolveAllPhotos(config, callback) {
    var entries   = buildKnownPhotoList(config);
    var resolved  = new Array(entries.length);
    var remaining = entries.length;
    entries.forEach(function(entry, i) {
      resolvePhotoSrc(entry, function(src) {
        resolved[i] = src;
        remaining--;
        if (remaining === 0) callback(resolved.filter(Boolean));
      });
    });
  }

  // Silent background preload — called on hover or scroll into view.
  // Resolves photo URLs and caches them so openRoom() skips the probe phase.
  function preloadRoom(roomId) {
    if (roomPreloadCache[roomId]) return;  // already loading or done
    var config = null;
    for (var i = 0; i < ROOM_CONFIG.length; i++) {
      if (ROOM_CONFIG[i].id === roomId) { config = ROOM_CONFIG[i]; break; }
    }
    if (!config) return;
    roomPreloadCache[roomId] = { status: 'loading' };
    resolveAllPhotos(config, function(photoUrls) {
      roomPreloadCache[roomId] = { status: 'done', photoUrls: photoUrls };
      roomPhotoCache[roomId]   = photoUrls;
    });
  }

  // ── animate loop ───────────────────────────────────────────────────────
  var frameCount = 0;
  function animateRoom() {
    if (!isOpen) return;
    animationId = requestAnimationFrame(animateRoom);
    frameCount++;

    // Update particles every 2nd frame — halves particle CPU cost with no visible difference
    if (frameCount % 2 === 0 && ambientParticles && ambientPositions && ambientVelocities) {
      for (var i=0; i<AMBIENT_COUNT; i++) {
        var idx = i*3;
        ambientPositions[idx]   += ambientVelocities[i].x * 2;
        ambientPositions[idx+1] += ambientVelocities[i].y * 2;
        ambientPositions[idx+2] += ambientVelocities[i].z * 2;
        if (ambientPositions[idx+1] > 4.5) ambientPositions[idx+1] = 0;
      }
      ambientParticles.geometry.attributes.position.needsUpdate = true;
    }

    updateHover();
    if (frameCount % 12 === 0) updateMinimapFromCamera();

    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  // ── event wiring ───────────────────────────────────────────────────────
  function setupExitButton() {
    var btn = document.getElementById('room-exit-btn');
    if (btn) btn.addEventListener('click', closeRoom);

    var tourBtn = document.getElementById('room-tour-btn');
    if (tourBtn) tourBtn.addEventListener('click', function() {
      if (tourActive) stopTour(); else startTour();
    });

    var soundBtn = document.getElementById('room-sound-btn');
    if (soundBtn) soundBtn.addEventListener('click', function() {
      if (soundEnabled) disableSound(); else enableSound();
    });

    document.addEventListener('keydown', function(e) {
      if (!isOpen) return;
      if      (e.key === 'Escape')     closeRoom();
      else if (e.key === 'ArrowLeft')  navPrev();
      else if (e.key === 'ArrowRight') navNext();
    });
  }

  function setupResizeHandler() {
    window.addEventListener('resize', function() {
      if (!isOpen || !renderer || !camera) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  return { init: init };
})();
