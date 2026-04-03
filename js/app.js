/* ============================================
   KRKAI — App Init & Navbar
   ============================================ */

(function() {
  'use strict';

  // === DEVICE DETECTION ===
  var isMobile = window.innerWidth < 768;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // === INIT ALL MODULES ===
  function initApp() {
    // Dismiss loading curtain
    var curtain = document.getElementById('loading-curtain');
    if (curtain) {
      setTimeout(function() {
        curtain.classList.add('dismissed');
        setTimeout(function() {
          curtain.style.display = 'none';
        }, 800);
      }, 3000);

      // Click to dismiss early
      curtain.addEventListener('click', function() {
        curtain.classList.add('dismissed');
        setTimeout(function() {
          curtain.style.display = 'none';
        }, 800);
      });
    }

    // Skip 3D for reduced motion
    if (reducedMotion) {
      var canvas = document.getElementById('three-canvas');
      if (canvas) canvas.style.display = 'none';
      var panels = document.querySelectorAll('.content-panel');
      for (var i = 0; i < panels.length; i++) {
        panels[i].style.position = 'relative';
        panels[i].style.opacity = '1';
        panels[i].style.pointerEvents = 'auto';
      }
      var spacer = document.getElementById('scroll-spacer');
      if (spacer) spacer.style.height = 'auto';
      // Normal sections are in regular flow, no special handling needed for reduced motion

      // Still init non-3D features
      KRKAI_i18n.init();
      KRKAI_Features.init();
      if (typeof KRKAI_Gallery !== 'undefined') KRKAI_Gallery.init();
      if (typeof KRKAI_Rooms !== 'undefined') KRKAI_Rooms.init();
      // if (typeof KRKAI_Cursor !== 'undefined') KRKAI_Cursor.init();
      setupNavbar();
      return;
    }

    // Init 3D scene
    KRKAI_Scene.init();

    // Init pen (needs scene)
    var scene = KRKAI_Scene.getScene();
    if (scene) {
      KRKAI_Pen.init(scene);
      // Init INIIBO guide (HTML-only)
      if (typeof KRKAI_INIIBO !== 'undefined') {
        KRKAI_INIIBO.init();
      }
    }

    // Init magical CSS overlays (fireflies, fog, petals — reads from particles.config.js)
    if (typeof KRKAI_MagicalOverlays !== 'undefined') KRKAI_MagicalOverlays.init();

    // Init scroll system (connects scene + pen + content panels)
    KRKAI_Scroll.init();

    // Init i18n
    KRKAI_i18n.init();

    // Init features (calculator, forms, PDF, counters, map)
    KRKAI_Features.init();
    
    // Init Visual Enhancements
    if (typeof KRKAI_Gallery !== 'undefined') KRKAI_Gallery.init();
    if (typeof KRKAI_Rooms !== 'undefined') KRKAI_Rooms.init();
    // if (typeof KRKAI_Cursor !== 'undefined') KRKAI_Cursor.init();

    // Dynamic copyright year
    var footerCopy = document.querySelector('.footer-copy');
    if (footerCopy) {
      footerCopy.innerHTML = footerCopy.innerHTML.replace('2025', new Date().getFullYear());
    }

    // Navbar
    setupNavbar();
  }

  // === NAVBAR ===
  function setupNavbar() {
    var navbar = document.getElementById('navbar');
    var hamburger = document.getElementById('hamburger');
    var navLinks = document.getElementById('nav-links');

    // Hamburger toggle
    if (hamburger && navLinks) {
      hamburger.addEventListener('click', function() {
        hamburger.classList.toggle('open');
        navLinks.classList.toggle('open');
      });

      // Close on link click
      var links = navLinks.querySelectorAll('a');
      for (var i = 0; i < links.length; i++) {
        links[i].addEventListener('click', function() {
          hamburger.classList.remove('open');
          navLinks.classList.remove('open');
        });
      }

      // Close on outside click
      document.addEventListener('click', function(e) {
        if (!navLinks.contains(e.target) && !hamburger.contains(e.target)) {
          hamburger.classList.remove('open');
          navLinks.classList.remove('open');
        }
      });
    }

    // Scroll effect on navbar — passive + rAF throttle avoids classList mutation on every scroll pixel
    var navbarScrollTick = false;
    window.addEventListener('scroll', function() {
      if (!navbarScrollTick) {
        navbarScrollTick = true;
        requestAnimationFrame(function() {
          if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 100);
          navbarScrollTick = false;
        });
      }
    }, { passive: true });

    // Active section highlight
    setupActiveSection();
  }

  // === ACTIVE SECTION HIGHLIGHT ===
  function setupActiveSection() {
    var sections = document.querySelectorAll('.normal-section');
    var navLinks = document.querySelectorAll('#nav-links a');

    if (!sections.length || !navLinks.length) return;

    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        var id = entry.target.id;
        for (var i = 0; i < navLinks.length; i++) {
          var href = navLinks[i].getAttribute('href');
          if (href === '#' + id) {
            // Add active when entering, remove when leaving
            navLinks[i].classList.toggle('active', entry.isIntersecting);
          }
        }
      });
    }, { threshold: 0.3 });

    for (var i = 0; i < sections.length; i++) {
      observer.observe(sections[i]);
    }
  }

  // === SMOOTH SCROLL FOR ANCHOR LINKS ===
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href^="#"]');
    if (!link) return;
    var targetId = link.getAttribute('href');
    if (targetId === '#') return;
    var target = document.querySelector(targetId);
    if (!target) return;

    e.preventDefault();

    // If target is a content-panel (inside scroll-spacer), scroll to the
    // correct scroll-spacer position matching the panel's data-enter attribute
    if (target.classList.contains('content-panel')) {
      var enter = parseFloat(target.getAttribute('data-enter'));
      if (!isNaN(enter)) {
        var scrollSpacer = document.getElementById('scroll-spacer');
        if (scrollSpacer) {
          // GSAP progress = scrollY / (spacerHeight - viewportHeight)
          var targetScroll = enter * (scrollSpacer.offsetHeight - window.innerHeight);
          window.scrollTo({ top: targetScroll, behavior: 'smooth' });
          return;
        }
      }
    }

    // Normal scroll for non-content-panel sections
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // === SERVICE WORKER ===
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('./sw.js').then(function(reg) {
        // After SW is active and controlling the page, trigger silent pre-cache of all
        // room thumbnails so the next visit opens every room instantly (zero network).
        function triggerPrecache(sw) {
          if (!sw) return;
          // Only run on idle to avoid competing with visible content loads
          var run = function() {
            fetch('rooms-manifest.json')
              .then(function(r) { return r.ok ? r.json() : null; })
              .then(function(data) {
                if (!data || !Array.isArray(data.rooms)) return;
                var isMobile = window.innerWidth < 768;
                var thumbDir = isMobile ? 'thumbs-sm/' : 'thumbs/';
                var urls = [];
                data.rooms.forEach(function(room) {
                  for (var n = 1; n <= (room.count || 50); n++) {
                    urls.push(room.path + thumbDir + n + '.avif');
                    urls.push(room.path + thumbDir + n + '.webp');
                  }
                });
                sw.postMessage({ type: 'precache', urls: urls });
              })
              .catch(function() {});
          };
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(run, { timeout: 5000 });
          } else {
            setTimeout(run, 3000);
          }
        }

        var sw = reg.active || (reg.installing || reg.waiting);
        if (reg.active) {
          triggerPrecache(reg.active);
        } else {
          reg.addEventListener('updatefound', function() {
            var newSw = reg.installing;
            newSw.addEventListener('statechange', function() {
              if (newSw.state === 'activated') triggerPrecache(newSw);
            });
          });
        }
      }).catch(function() {});
    });
  }

  // === START ===
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
