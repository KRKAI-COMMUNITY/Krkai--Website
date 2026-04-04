/* ============================================================
   KRKAI — Magical Particle Configuration
   ============================================================
   Edit these values to tune the magical atmosphere.
   Changes take effect on next page load (Ctrl+Shift+R).
   ============================================================ */

var KRKAI_ParticleConfig = {

  // ── GOLDEN BOKEH / MAGICAL DUST ─────────────────────────
  magical: {
    countDesktop: 600,   // particles on desktop
    countTablet: 400,   // particles on tablet
    countMobile: 100,   // particles on mobile
    size: 0.058,  // base size in world units
    sizeBreath: 0.30,   // breathing amplitude (0=static, 0.5=big pulse)
    opacity: 0.55,   // transparency (0=invisible, 1=solid)
    speed: 0.003   // drift speed
  },

  // ── MAGICAL BUTTERFLIES ──────────────────────────────────
  butterflies: {
    countDesktop: 100,    // total butterflies on desktop
    countTablet: 150,    // total butterflies on tablet
    countMobile: 45,    // butterflies on mobile (0 = disabled)
    sizeSmall: 0.14,     // small variant base size
    sizeMed: 0.24,     // medium variant base size
    sizeLarge: 0.36,     // large variant base size
    opacity: 0.82      // wing transparency
  },

  // ── MAGICAL FLOWERS ─────────────────────────────────────
  flowers: {
    countDesktop: 800,    // total flowers on desktop
    countTablet: 500,    // total flowers on tablet
    countMobile: 100,    // flowers on mobile (0 = disabled)
    sizeSmall: 0.12,     // small variant base size
    sizeMed: 0.22,     // medium variant base size
    sizeLarge: 0.34,     // large variant base size
    opacity: 0.75      // petal transparency
  },

  // ── AMBIENT DUST MOTES ───────────────────────────────────
  ambient: {
    countDesktop: 1000,    // dust motes on desktop
    countTablet: 1000,    // dust motes on tablet
    countMobile: 500,    // dust motes on mobile
    opacity: 0.22     // dust mote transparency
  },

  // ── CLUSTER LIGHT BRIGHTNESS ────────────────────────────
  // Multiplier applied to all cluster point light intensities.
  // 1.0 = default, 2.0 = double brightness, 0.5 = half brightness
  clusterBrightness: 1.0,

  // ── PEN TRAIL ────────────────────────────────────────────
  trail: {
    countDesktop: 300,    // trail particle pool size on desktop
    countMobile: 150,    // trail particle pool size on mobile
    sizeDesktop: 0.01,    // particle size on desktop — large enough to be clearly visible
    sizeMobile: 0.01,    // particle size on mobile
    opacity: 1.0,     // trail transparency — fully opaque for max visibility
    minEmit: 5,     // minimum particles emitted per frame
    maxEmit: 10,     // maximum particles emitted per frame (at high speed)
    lifeMin: 40,     // minimum particle lifetime (frames)
    lifeMax: 80      // maximum particle lifetime (frames)
  },

  // ── CSS FIREFLIES (golden floating light orbs) ─────────
  fireflies: {
    count: 10,         // number of fireflies (0 = disabled)
    size: 25,           // diameter in px (3-10 recommended)
    glowRadius: 100,     // box-shadow glow spread in px
    glowOpacity: 0.6,  // glow intensity (0=none, 1=full)
    driftRange: 300,    // max drift distance in px per cycle
    durationMin: 7,    // shortest animation cycle (seconds)
    durationMax: 13,   // longest animation cycle (seconds)
    opacity: 0.95,     // core brightness (0=invisible, 1=solid)
    scrollStart: 0.02, // scroll progress when fireflies appear
    scrollEnd: 0.88    // scroll progress when fireflies disappear
  },

  // ── DREAMY MIST CLOUDS (soft blurred fog patches) ───────
  // Creates large, soft, blurry mist clouds that float across the
  // entire room — like a dreamy enchanted atmosphere.
  fog: {
    enabled: true,      // set false to disable mist entirely
    cloudCount: 5,     // number of mist clouds (5=light, 15=heavy)
    cloudOpacity: 0.05, // base opacity of each cloud (0.05=faint, 0.50=thick)
    blurMin: 15,        // minimum blur radius in px (higher = softer)
    blurMax: 35,        // maximum blur radius in px
    sizeMin: 500,       // smallest cloud width in px
    sizeMax: 1000,       // largest cloud width in px
    speedMin: 18,       // fastest drift cycle (seconds)
    speedMax: 35,       // slowest drift cycle (seconds)
    driftRange: 1200,    // max movement distance in px per cycle
    scrollStart: 0.02,  // scroll progress when mist appears
    scrollEnd: 0.88     // scroll progress when mist disappears
  },

  // ── CSS FALLING PETALS (purple & gold) ─────────────────
  petals: {
    count: 30,          // total petals (0 = disabled)
    purpleRatio: 5.0,  // fraction that are purple (rest are gold)
    sizeMin: 10,        // smallest petal size in px
    sizeMax: 15,       // largest petal size in px
    durationMin: 9,    // fastest fall cycle (seconds)
    durationMax: 14,   // slowest fall cycle (seconds)
    driftRange: 90,    // max horizontal drift in px
    opacity: 0.65,     // petal transparency (0=invisible, 1=solid)
    scrollStart: 0.28, // scroll progress when petals appear
    scrollEnd: 0.68    // scroll progress when petals disappear
  },

  // ── GLOWING TEXT ───────────────────────────────────────
  glowingText: {
    enabled: true,     // set false to disable gold glow on headings
    speed: 4,          // glow breathing cycle (seconds, lower = faster)
    intensity: 0.6     // peak glow opacity (0.1=subtle, 1=intense)
  },

  // ── GOD-RAY ENHANCEMENTS (currently disabled via CSS) ──
  godray: {
    enabled: false,    // god-rays are disabled — set true to re-enable
    breatheSpeed: 20,
    driftSpeed: 22,
    scrollStart: 0.04,
    scrollEnd: 0.50
  },

  // ── CARD GLOW PULSE ───────────────────────────────────
  cardGlow: {
    enabled: true,     // set false to disable pulsing glow on cards
    speed: 4,          // pulse cycle (seconds)
    intensity: 0.15    // peak glow spread opacity (0=none, 0.5=strong)
  },

  // ── SECTION SCROLL TIMINGS ────────────────────────────
  // Controls when each content panel appears and disappears.
  // Values are scroll progress: 0.0 = page top, 1.0 = page bottom.
  // enter = panel becomes visible, exit = panel hides.
  // Tip: panels can overlap (e.g. gallery/impact) for smooth crossfades.
  sections: {
    scrollHint:  { enter: 0.00, exit: 0.03 },  // "Scroll to begin" arrow
    hero:        { enter: 0.03, exit: 0.10 },  // Title / hero card
    problem:     { enter: 0.11, exit: 0.21 },  // The Problem section
    mission:     { enter: 0.22, exit: 0.32 },  // Our Mission
    program:     { enter: 0.32, exit: 0.42 },  // The Program
    timeline:    { enter: 0.42, exit: 0.52 },  // Timeline
    stories:     { enter: 0.52, exit: 0.62 },  // Success Stories
    impact:      { enter: 0.62, exit: 0.72 },  // Impact / Stats
    gallery:     { enter: 0.72, exit: 0.82 },  // Photo Gallery (overlaps impact)
    video:       { enter: 0.82, exit: 0.95 }   // See KRKAI in Action (video)
  },

  // ── CANVAS FADE TIMING ────────────────────────────────
  // Controls when the 3D background fades out and normal scroll sections
  // (About, Volunteer, Contact, Footer) appear underneath.
  // fadeStart must be >= video.exit to avoid overlap.
  canvasFade: {
    fadeStart:             0.96,  // 3D canvas begins fading (over next 0.03)
    normalSectionsAppear:  0.96   // About / Volunteer / Contact / Footer fade in
  }

};
