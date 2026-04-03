/* ============================================
   KRKAI — Features (Calculator, Forms, PDF, etc)
   ============================================ */

var KRKAI_Features = (function() {
  'use strict';

  function init() {
    setupCSRCalculator();
    setupInstitutionForm();
    setupDonationTiers();
    setupPDFGenerator();
    setupMapTooltips();
    setupStatCounters();
    setupFlipCardsMobile();
  }

  // === CSR IMPACT CALCULATOR ===
  function setupCSRCalculator() {
    var slider = document.getElementById('csr-slider');
    if (!slider) return;

    slider.addEventListener('input', function() {
      updateCalc(parseInt(this.value));
    });
    updateCalc(10);
  }

  function updateCalc(students) {
    var costPerKit = 1500;
    var costPerSession = 10000;
    var totalKitCost = students * costPerKit;
    var sessions = Math.max(1, Math.floor(students / 30));
    var totalCost = totalKitCost + sessions * costPerSession;

    var elStudents = document.getElementById('calc-students');
    var elAmount = document.getElementById('calc-amount');
    var elKits = document.getElementById('calc-kits-num');
    var elSessions = document.getElementById('calc-sessions-num');

    if (elStudents) elStudents.textContent = students;
    if (elAmount) elAmount.textContent = '\u20B9' + totalCost.toLocaleString('en-IN');
    if (elKits) elKits.textContent = students;
    if (elSessions) elSessions.textContent = sessions;
    var elWord = document.getElementById('calc-sessions-word');
    if (elWord) elWord.textContent = sessions === 1 ? 'workshop session' : 'workshop sessions';
  }

  // === INSTITUTION FORM ===
  function setupInstitutionForm() {
    var form = document.getElementById('institution-form');
    if (!form) return;

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var name = document.getElementById('inst-name').value;
      var contact = document.getElementById('inst-contact').value;
      var city = document.getElementById('inst-city').value;
      var message = document.getElementById('inst-message').value;

      var subject = encodeURIComponent('KRKAI Partnership Request - ' + name);
      var body = encodeURIComponent(
        'Institution: ' + name + '\n' +
        'Contact Person: ' + contact + '\n' +
        'City: ' + city + '\n' +
        'Message: ' + (message || 'N/A') + '\n\n' +
        'We would like to invite KRKAI to our institution.'
      );

      window.location.href = 'mailto:krkaifreeforall@gmail.com?subject=' + subject + '&body=' + body;
    });
  }

  // === DONATION TIERS ===
  function setupDonationTiers() {
    var tiers = document.querySelectorAll('.tier-card');
    for (var i = 0; i < tiers.length; i++) {
      tiers[i].addEventListener('click', function() {
        var amount = this.getAttribute('data-amount');
        var desc = this.querySelector('p');
        var descText = desc ? desc.textContent : '';
        var subject = encodeURIComponent('KRKAI Donation - \u20B9' + parseInt(amount).toLocaleString('en-IN'));
        var body = encodeURIComponent(
          'I would like to donate \u20B9' + parseInt(amount).toLocaleString('en-IN') + '\n' +
          'Purpose: ' + descText + '\n\n' +
          'Please share payment details.'
        );
        window.location.href = 'mailto:krkaifreeforall@gmail.com?subject=' + subject + '&body=' + body;
      });
    }
  }

  // === PDF GENERATOR ===
  function setupPDFGenerator() {
    var btn = document.getElementById('download-pdf');
    if (!btn) return;

    btn.addEventListener('click', function() {
      // Lazy-load jsPDF only when the user actually clicks download
      if (typeof window.jspdf !== 'undefined') {
        generatePDF();
        return;
      }
      btn.textContent = 'Loading…';
      btn.disabled = true;
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = function() {
        btn.textContent = 'Download PDF';
        btn.disabled = false;
        generatePDF();
      };
      s.onerror = function() {
        btn.textContent = 'Download PDF';
        btn.disabled = false;
        alert('Could not load PDF library. Please check your internet connection.');
      };
      document.head.appendChild(s);
    });
  }

  function generatePDF() {
    var jsPDF = window.jspdf ? window.jspdf.jsPDF : jspdf.jsPDF;
    var doc = new jsPDF();

    // Header
    doc.setFontSize(22);
    doc.setTextColor(218, 165, 32);
    doc.text('KRKAI - Free Robotics for Every Child', 20, 25);

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text('Karthikesh Robotics | krkaifreeforall@gmail.com | +91 7548832497', 20, 35);

    doc.setDrawColor(218, 165, 32);
    doc.line(20, 40, 190, 40);

    // Body
    doc.setFontSize(14);
    doc.setTextColor(40);
    doc.text('Proposal for Free Robotics Education Program', 20, 52);

    doc.setFontSize(10);
    doc.setTextColor(60);
    var yPos = 65;
    var lineHeight = 6;

    var paragraphs = [
      'Dear Sir/Madam,',
      '',
      'KRKAI (Karthikesh Robotics) is a mission-driven initiative founded by Veera Saravanan S',
      'to bring free robotics education to every orphanage and government school child in India.',
      '',
      'Our North Star Goals:',
      '  - 100 Orphanages & Government Schools in 2 Years',
      '  - 10,000 Children Impacted by 2027',
      '  - Free Robotics for Every Orphan in Tamil Nadu',
      '',
      'What We Offer (All Free of Cost):',
      '  1. Twice-a-month robotics + career development workshops at your campus',
      '  2. Free robotics kits for every student after completing basics',
      '  3. Dedicated coding workspace setup in your institution',
      '  4. Personal mentorship and job placement for top performers',
      '',
      'Our Impact So Far:',
      '  - 20+ Workshops Conducted',
      '  - 500+ Students Impacted',
      '  - 10+ Schools & Orphanages Covered',
      '  - 100+ Free Robotics Kits Distributed',
      '',
      'Program Journey: Orientation > Build First Robot > Kit Distribution > Independent',
      'Exploration > Mentorship > Future Pathways (University Prep & Job Placement)',
      '',
      'For CSR Partners:',
      '  - 100% of funding goes to kits, travel, and setup',
      '  - Trackable impact with photos and reports',
      '  - Cost: Rs.1,500 per kit | Rs.10,000 per workshop session',
      '',
      'We would love to partner with your institution to bring this transformative',
      'program to the children you serve.',
      '',
      'With warm regards,',
      'Veera Saravanan S',
      'Founder, KRKAI / Karthikesh Robotics',
      'Phone: +91 7548832497',
      'Email: krkaifreeforall@gmail.com',
      'Website: karthikeshrobotics.in'
    ];

    for (var i = 0; i < paragraphs.length; i++) {
      if (yPos > 270) {
        doc.addPage();
        yPos = 20;
      }
      doc.text(paragraphs[i], 20, yPos);
      yPos += lineHeight;
    }

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Technology is a right, not a privilege. | Generated from krkai website', 20, 285);

    doc.save('KRKAI_Proposal.pdf');
  }

  // === MAP TOOLTIPS ===
  function setupMapTooltips() {
    var dots = document.querySelectorAll('.map-dot');
    var tooltip = document.getElementById('map-tooltip');
    if (!tooltip) return;

    for (var i = 0; i < dots.length; i++) {
      dots[i].addEventListener('mouseenter', function(e) {
        var city = this.getAttribute('data-city');
        tooltip.textContent = 'Workshop Conducted Here \u2713 - ' + city;
        tooltip.style.opacity = '1';
        var rect = this.getBoundingClientRect();
        var mapRect = this.closest('.map-container').getBoundingClientRect();
        tooltip.style.left = (rect.left - mapRect.left + 15) + 'px';
        tooltip.style.top = (rect.top - mapRect.top - 30) + 'px';
      });
      dots[i].addEventListener('mouseleave', function() {
        tooltip.style.opacity = '0';
      });
    }
  }

  // === STAT COUNTERS ===
  function setupStatCounters() {
    var counters = document.querySelectorAll('.counter-num, .stat-number');
    if (!counters.length) return;

    var observed = new Set();

    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting && !observed.has(entry.target)) {
          observed.add(entry.target);
          animateCounter(entry.target);
        }
      });
    }, { threshold: 0.5 });

    for (var i = 0; i < counters.length; i++) {
      observer.observe(counters[i]);
    }
  }

  // Gold particle burst when a counter finishes animating
  function burstParticles(el) {
    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var colors = ['#D4A856', '#FFE490', '#C8956C', '#FFD700'];
    for (var p = 0; p < 12; p++) {
      var dot = document.createElement('div');
      var angle = (p / 12) * Math.PI * 2;
      var dist = 38 + Math.random() * 28;
      dot.style.cssText = [
        'position:fixed',
        'width:5px', 'height:5px',
        'border-radius:50%',
        'pointer-events:none',
        'z-index:9000',
        'left:' + cx + 'px',
        'top:' + cy + 'px',
        'background:' + colors[p % 4],
        'transition:transform 0.72s ease-out,opacity 0.72s ease-out'
      ].join(';');
      document.body.appendChild(dot);
      // Trigger on next frame so CSS transition fires
      (function(d, a, r) {
        setTimeout(function() {
          d.style.transform = 'translate(' +
            (Math.cos(a) * r - 2.5) + 'px,' +
            (Math.sin(a) * r - 2.5) + 'px)';
          d.style.opacity = '0';
          setTimeout(function() { d.remove(); }, 750);
        }, 10);
      })(dot, angle, dist);
    }
  }

  function animateCounter(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    if (isNaN(target)) return;

    var isFloat = target % 1 !== 0;
    var duration = 1500;
    var start = 0;
    var startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      var current = start + (target - start) * eased;

      el.textContent = isFloat ? current.toFixed(1) : Math.floor(current);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = isFloat ? target.toFixed(1) : target;
        burstParticles(el);
      }
    }

    requestAnimationFrame(step);
  }

  // === FLIP CARDS MOBILE (tap to flip) ===
  function setupFlipCardsMobile() {
    if (window.innerWidth >= 768) return;

    var cards = document.querySelectorAll('.flip-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function() {
        this.classList.toggle('flipped');
      });
    }
  }

  return {
    init: init
  };
})();
