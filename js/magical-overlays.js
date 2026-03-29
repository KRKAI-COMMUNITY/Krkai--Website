/* ============================================================
   KRKAI — Magical CSS Overlays Initializer
   ============================================================
   Reads KRKAI_ParticleConfig and dynamically generates fireflies,
   fog layers, and falling petals. Also applies config-driven CSS
   custom properties for glowing text, god-rays, and card glow.

   Must load AFTER particles.config.js and BEFORE app.js.
   ============================================================ */

var KRKAI_MagicalOverlays = (function() {
  'use strict';

  var cfg = typeof KRKAI_ParticleConfig !== 'undefined' ? KRKAI_ParticleConfig : {};

  // === HELPERS ===
  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }
  function randSign() {
    return Math.random() < 0.5 ? -1 : 1;
  }
  function clearChildren(el) {
    while (el.firstChild) { el.removeChild(el.firstChild); }
  }

  // === GENERATE FIREFLIES ===
  function initFireflies() {
    var fc = cfg.fireflies;
    if (!fc || fc.count <= 0) return;

    var container = document.getElementById('firefly-overlay');
    if (!container) return;
    clearChildren(container);

    for (var i = 0; i < fc.count; i++) {
      var el = document.createElement('div');
      el.className = 'firefly';

      var drift = fc.driftRange || 80;
      var dur = rand(fc.durationMin || 7, fc.durationMax || 13);
      var del = rand(0, dur);
      var size = fc.size || 5;
      var glowR = fc.glowRadius || 8;
      var glowOp = fc.glowOpacity || 0.5;
      var coreOp = fc.opacity || 0.95;

      el.style.cssText =
        'left:' + rand(2, 96) + '%;' +
        'top:' + rand(5, 92) + '%;' +
        'width:' + size + 'px;' +
        'height:' + size + 'px;' +
        '--fx:' + (randSign() * rand(20, drift)) + 'px;' +
        '--fy:' + (randSign() * rand(20, drift)) + 'px;' +
        '--fx2:' + (randSign() * rand(20, drift)) + 'px;' +
        '--fy2:' + (randSign() * rand(20, drift)) + 'px;' +
        '--dur:' + dur.toFixed(1) + 's;' +
        '--del:' + del.toFixed(1) + 's;' +
        'background:radial-gradient(circle,rgba(255,215,0,' + coreOp + ') 0%,rgba(212,175,55,0.4) 40%,transparent 70%);' +
        'box-shadow:0 0 ' + glowR + 'px 2px rgba(255,215,0,' + glowOp + '),0 0 ' + (glowR * 2.5) + 'px 4px rgba(212,175,55,' + (glowOp * 0.4) + ');';

      container.appendChild(el);
    }
  }

  // === GENERATE DREAMY MIST CLOUDS ===
  function initFog() {
    var fc = cfg.fog;
    if (!fc || !fc.enabled) return;

    var container = document.getElementById('fog-overlay');
    if (!container) return;
    clearChildren(container);

    var count = fc.cloudCount || 10;
    var opacity = fc.cloudOpacity || 0.12;
    var blurMin = fc.blurMin || 50;
    var blurMax = fc.blurMax || 90;
    var sizeMin = fc.sizeMin || 250;
    var sizeMax = fc.sizeMax || 500;
    var speedMin = fc.speedMin || 18;
    var speedMax = fc.speedMax || 35;
    var driftRange = fc.driftRange || 120;

    // Color palette for mist clouds
    var colors = [
      { r: 200, g: 180, b: 220 },  // soft lavender
      { r: 160, g: 130, b: 200 },  // purple mist
      { r: 180, g: 170, b: 200 },  // cool silver-purple
      { r: 220, g: 200, b: 240 },  // light violet
      { r: 170, g: 160, b: 190 }   // dusty lilac
    ];

    for (var i = 0; i < count; i++) {
      var el = document.createElement('div');
      el.className = 'mist-cloud';

      var size = rand(sizeMin, sizeMax);
      var blur = rand(blurMin, blurMax);
      var dur = rand(speedMin, speedMax);
      var del = rand(0, dur);
      var col = colors[i % colors.length];
      // Gradient alpha is high (0.5) so the color is rich; element opacity controls overall visibility
      var elemOp = opacity * rand(0.7, 1.3);

      el.style.cssText =
        'left:' + rand(-10, 90) + '%;' +
        'top:' + rand(-5, 85) + '%;' +
        'width:' + size + 'px;' +
        'height:' + (size * rand(0.5, 0.8)) + 'px;' +
        'background:radial-gradient(ellipse,rgba(' + col.r + ',' + col.g + ',' + col.b + ',0.5) 0%,transparent 70%);' +
        '--mist-blur:' + blur.toFixed(0) + 'px;' +
        '--mist-op:' + elemOp.toFixed(3) + ';' +
        '--mist-dur:' + dur.toFixed(1) + 's;' +
        '--mist-del:' + del.toFixed(1) + 's;' +
        '--mx1:' + (randSign() * rand(30, driftRange)) + 'px;' +
        '--my1:' + (randSign() * rand(15, driftRange * 0.5)) + 'px;' +
        '--mx2:' + (randSign() * rand(30, driftRange)) + 'px;' +
        '--my2:' + (randSign() * rand(15, driftRange * 0.5)) + 'px;' +
        '--mx3:' + (randSign() * rand(30, driftRange)) + 'px;' +
        '--my3:' + (randSign() * rand(15, driftRange * 0.5)) + 'px;';

      container.appendChild(el);
    }
  }

  // === GENERATE FALLING PETALS ===
  function initPetals() {
    var pc = cfg.petals;
    if (!pc || pc.count <= 0) return;
    // Reduce petal count on mobile to avoid DOM layout churn
    if (window.innerWidth < 768) pc = Object.assign({}, pc, { count: 20 });

    var container = document.getElementById('petal-overlay');
    if (!container) return;
    clearChildren(container);

    var purpleCount = Math.round(pc.count * (pc.purpleRatio || 0.5));

    for (var i = 0; i < pc.count; i++) {
      var el = document.createElement('div');
      var isPurple = i < purpleCount;
      var sizeW = rand(pc.sizeMin || 7, pc.sizeMax || 12);
      var sizeH = sizeW * 0.7;
      var dur = rand(pc.durationMin || 9, pc.durationMax || 14);
      var del = rand(0, dur);
      var driftR = pc.driftRange || 90;
      var op = pc.opacity || 0.65;

      el.className = 'petal ' + (isPurple ? 'petal-purple' : 'petal-gold');
      el.style.cssText =
        'left:' + rand(3, 95) + '%;' +
        'width:' + sizeW.toFixed(1) + 'px;' +
        'height:' + sizeH.toFixed(1) + 'px;' +
        '--drift:' + (randSign() * rand(15, driftR)) + 'px;' +
        '--drift2:' + (randSign() * rand(15, driftR)) + 'px;' +
        '--dur:' + dur.toFixed(1) + 's;' +
        '--del:' + del.toFixed(1) + 's;' +
        'opacity:' + op + ';';

      container.appendChild(el);
    }
  }

  // === APPLY CSS CUSTOM PROPERTIES FROM CONFIG ===
  function applyConfigStyles() {
    var root = document.documentElement;

    // Glowing text
    var gt = cfg.glowingText;
    if (gt) {
      if (!gt.enabled) {
        var style = document.createElement('style');
        style.textContent = 'h2, .hero-card h1, .impact-heading { animation: none !important; }';
        document.head.appendChild(style);
      } else {
        root.style.setProperty('--glow-speed', (gt.speed || 4) + 's');
        root.style.setProperty('--glow-intensity', gt.intensity || 0.6);
      }
    }

    // God-ray
    var gr = cfg.godray;
    if (gr) {
      root.style.setProperty('--godray-breathe-speed', (gr.breatheSpeed || 8) + 's');
      root.style.setProperty('--godray-drift-speed', (gr.driftSpeed || 22) + 's');
    }

    // Card glow
    var cg = cfg.cardGlow;
    if (cg) {
      if (!cg.enabled) {
        var style2 = document.createElement('style');
        style2.textContent = '.flip-card, .story-card, .counter-card { animation: none !important; }';
        document.head.appendChild(style2);
      } else {
        root.style.setProperty('--card-glow-speed', (cg.speed || 4) + 's');
        root.style.setProperty('--card-glow-intensity', cg.intensity || 0.15);
      }
    }
  }

  // === INIT ===
  function init() {
    // Skip on mobile (CSS hides overlays anyway)
    if (window.innerWidth < 768) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    initFireflies();
    initFog();
    initPetals();
    applyConfigStyles();
  }

  // === PUBLIC API ===
  return {
    init: init,
    getConfig: function() { return cfg; }
  };

})();
