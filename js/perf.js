/* ============================================================
   KRKAI — Hardware Performance Tier Detection
   ============================================================
   Runs BEFORE scene.js and sets window.KRKAI_PerfTier:
     'high'      — modern desktop/laptop, full effects
     'mid'       — mid-range device, reduced effects
     'low'       — budget device, minimal effects (30fps)
     'ultra-low' — very old/slow device, bare minimum (20fps)

   Uses: deviceMemory, hardwareConcurrency, WebGL maxTextureSize
   All have safe defaults for unsupported browsers.
   ============================================================ */

(function() {
  'use strict';

  // === SIGNAL 1: RAM (deviceMemory API, GB) ===
  // 2GB or less = budget phone; 8GB+ = capable device
  var mem = (navigator.deviceMemory !== undefined) ? navigator.deviceMemory : 4;

  // === SIGNAL 2: CPU Cores (hardwareConcurrency) ===
  // 2-core = budget; 4-core = mid; 8+ = capable
  var cores = (navigator.hardwareConcurrency !== undefined) ? navigator.hardwareConcurrency : 4;

  // === SIGNAL 3: WebGL MAX_TEXTURE_SIZE (GPU proxy) ===
  // Old mobile GPUs: 2048; mid-range: 4096; modern: 8192-16384
  var maxTex = 4096;
  try {
    var probe = document.createElement('canvas');
    probe.width = 1; probe.height = 1;
    var gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
    if (gl) {
      maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      // Clean up — avoid leaving a live WebGL context
      var ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  } catch (e) { /* ignore probe errors */ }

  // === SIGNAL 4: Screen DPR (HiDPI indicator) ===
  // If a low-end device has a high DPR it renders more pixels — that's expensive
  var dpr = window.devicePixelRatio || 1;

  // === CLASSIFY INTO TIER ===
  var tier;
  if (mem <= 2 || cores <= 2 || maxTex <= 2048) {
    // Very old phone or tablet (e.g. Galaxy A10, Redmi 7, Moto E5)
    tier = 'ultra-low';
  } else if (mem <= 3 || cores <= 3 || (maxTex <= 4096 && cores <= 4)) {
    // Budget phone or Chromebook (e.g. Redmi Note 9, Celeron N4020)
    tier = 'low';
  } else if (mem <= 4 || cores <= 4) {
    // Mid-range phone or entry laptop (e.g. Realme 7, Intel Core i3)
    tier = 'mid';
  } else {
    // Capable desktop, gaming laptop, flagship phone
    tier = 'high';
  }

  // === EXPOSE GLOBALLY ===
  window.KRKAI_PerfTier = tier;

  // === TIER SETTINGS TABLE ===
  // These values are READ by scene.js to configure the renderer.
  window.KRKAI_TierSettings = {
    'high':      { fpsTarget: 60, pixelRatioMax: 1.5,  shadows: true,  bloom: true,  fxaa: true,  bokeh: true  },
    'mid':       { fpsTarget: 60, pixelRatioMax: 1.25, shadows: true,  bloom: true,  fxaa: false, bokeh: false },
    'low':       { fpsTarget: 30, pixelRatioMax: 1.0,  shadows: false, bloom: false, fxaa: false, bokeh: false },
    'ultra-low': { fpsTarget: 20, pixelRatioMax: 1.0,  shadows: false, bloom: false, fxaa: false, bokeh: false }
  };

})();
