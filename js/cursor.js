/* ============================================
   KRKAI — Cinematic Cursor & Ribbon Trail
   ============================================ */

var KRKAI_Cursor = (function() {
  'use strict';

  var canvas, ctx;
  var cursorDot, cursorHalo;
  var isMobile = window.innerWidth < 768;

  var mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  var lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  var idleFrames = 0;
  var isIdle = false;
  // Halo position tracked in JS — avoids getBoundingClientRect() layout reflow every frame
  var haloX = window.innerWidth / 2;
  var haloY = window.innerHeight / 2;
  var points = [];
  var POINT_COUNT = 12; // Short, elegant ribbon tail

  function init() {
    if (isMobile) return; // Disable custom cursor on mobile touch devices

    // Setup DOM elements
    cursorDot = document.getElementById('cursor-dot');
    cursorHalo = document.getElementById('cursor-halo');
    canvas = document.getElementById('ribbon-canvas');

    if (!cursorDot || !cursorHalo || !canvas) return;

    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);

    // Initialize ribbon points
    for (var i = 0; i < POINT_COUNT; i++) {
      points.push({ x: mouse.x, y: mouse.y });
    }

    // Track mouse
    document.addEventListener('mousemove', function(e) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      idleFrames = 0; // reset idle
      updateCursorDOM(e.clientX, e.clientY);
      if (isIdle) { isIdle = false; requestAnimationFrame(render); }
    });

    // Hide cursor when leaving window
    document.addEventListener('mouseleave', function() {
      cursorDot.style.opacity = '0';
      cursorHalo.style.opacity = '0';
      idleFrames = 100; // force idle
    });
    document.addEventListener('mouseenter', function() {
      cursorDot.style.opacity = '1';
      cursorHalo.style.opacity = '0.5';
      idleFrames = 0;
    });

    // Start render loop
    requestAnimationFrame(render);
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function updateCursorDOM(x, y) {
    // Immediate dot update
    cursorDot.style.transform = 'translate(' + (x - 4) + 'px, ' + (y - 4) + 'px)';
  }

  // Linear interpolation
  function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
  }

  function render() {
    if (isMobile) return;

    // Performance optimization: skip rendering if mouse hasn't moved for 60 frames (~1 sec)
    if (Math.abs(mouse.x - lastMouse.x) < 0.1 && Math.abs(mouse.y - lastMouse.y) < 0.1) {
      idleFrames++;
    } else {
      idleFrames = 0;
    }

    lastMouse.x = mouse.x;
    lastMouse.y = mouse.y;

    if (idleFrames > 60) {
      isIdle = true;
      return; // Stop rAF loop — mousemove handler restarts it
    }

    requestAnimationFrame(render);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Update halo with slight lag (spring physics simple lerp)
    // haloX/haloY tracked in JS — no getBoundingClientRect() layout reflow each frame
    haloX = lerp(haloX, mouse.x, 0.15);
    haloY = lerp(haloY, mouse.y, 0.15);
    cursorHalo.style.transform = 'translate(' + (haloX - 60) + 'px, ' + (haloY - 60) + 'px)';

    // Update ribbon points
    // Head follows mouse directly
    points[0].x = lerp(points[0].x, mouse.x, 0.4);
    points[0].y = lerp(points[0].y, mouse.y, 0.4);

    // Body follows the previous point
    for (var i = 1; i < POINT_COUNT; i++) {
      points[i].x = lerp(points[i].x, points[i - 1].x, 0.35);
      points[i].y = lerp(points[i].y, points[i - 1].y, 0.35);
    }

    // Draw the ribbon snake
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (var j = 0; j < POINT_COUNT - 1; j++) {
      var xc = (points[j].x + points[j + 1].x) / 2;
      var yc = (points[j].y + points[j + 1].y) / 2;
      
      if (j === 0) {
        ctx.moveTo(xc, yc);
      } else {
        ctx.quadraticCurveTo(points[j].x, points[j].y, xc, yc);
      }
      
      // Dynamic line width - fades smaller towards the tail
      var scale = 1 - (j / POINT_COUNT);
      ctx.lineWidth = 0.5 + scale * 2;
      
      // Dynamic opacity - fades towards the tail
      ctx.strokeStyle = 'rgba(255, 215, 0, ' + (scale * 0.8) + ')'; // Golden color
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xc, yc);
    }
  }

  return { init: init };
})();
