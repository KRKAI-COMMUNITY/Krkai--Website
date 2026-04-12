/* ============================================
   KRKAI — INIIBO Guide (HTML-only, bottom-right)
   ============================================ */

var KRKAI_INIIBO = (function() {
  'use strict';

  var speechEl, faqEl;
  var htmlIniiboEl;
  var progress = 0;
  var _lastSection = null;  // cache to avoid FAQ DOM rebuild every scroll frame

  // === SPEECH BUBBLE DATA (per section) ===
  var SPEECH_DATA = {
    en: {
      hero:     { text: "Welcome to KRKAI! Let me show you our mission." },
      problem:  { text: "Every child deserves access to technology education." },
      mission:  { text: "We bring free robotics to orphanages across India." },
      programs: { text: "Our programs cover Arduino, AI, and real-world projects!" },
      timeline: { text: "Look how far we've come since 2023!" },
      stories:  { text: "These stories inspire everything we do." },
      impact:   { text: "10,000 children by 2027 \u2014 that's our promise." },
      gallery:  { text: "See our classrooms in action!" },
      closing:  { text: "Will you join our mission?" }
    },
    ta: {
      hero:     { text: "KRKAI-\u0b95\u0bcd\u0b95\u0bc1 \u0bb5\u0bb0\u0bb5\u0bc7\u0bb1\u0bcd\u0b95\u0bbf\u0bb1\u0bcb\u0bae\u0bcd! \u0b8e\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0baa\u0ba3\u0bbf\u0baf\u0bc8\u0b95\u0bcd \u0b95\u0bbe\u0b9f\u0bcd\u0b9f\u0bc1\u0b95\u0bbf\u0bb1\u0bc7\u0ba9\u0bcd." },
      problem:  { text: "\u0b92\u0bb5\u0bcd\u0bb5\u0bca\u0bb0\u0bc1 \u0b95\u0bc1\u0bb4\u0ba8\u0bcd\u0ba4\u0bc8\u0baf\u0bc1\u0bae\u0bcd \u0ba4\u0bca\u0bb4\u0bbf\u0bb2\u0bcd\u0ba8\u0bc1\u0b9f\u0bcd\u0baa\u0b95\u0bcd \u0b95\u0bb2\u0bcd\u0bb5\u0bbf\u0b95\u0bcd\u0b95\u0bc1 \u0ba4\u0b95\u0bc1\u0ba4\u0bbf\u0baf\u0bbe\u0ba9\u0bb5\u0bb0\u0bcd\u0b95\u0bb3\u0bcd." },
      mission:  { text: "\u0b87\u0ba8\u0bcd\u0ba4\u0bbf\u0baf\u0bbe \u0bae\u0bc1\u0bb4\u0bc1\u0bb5\u0ba4\u0bc1\u0bae\u0bcd \u0b85\u0ba9\u0bbe\u0ba4\u0bc8 \u0b87\u0bb2\u0bcd\u0bb2\u0b99\u0bcd\u0b95\u0bb3\u0bc1\u0b95\u0bcd\u0b95\u0bc1 \u0b87\u0bb2\u0bb5\u0b9a \u0bb0\u0bcb\u0baa\u0bcb\u0b9f\u0bbf\u0b95\u0bcd\u0bb8\u0bcd." },
      programs: { text: "Arduino, AI \u0bae\u0bb1\u0bcd\u0bb1\u0bc1\u0bae\u0bcd \u0ba8\u0bbf\u0b9c \u0b89\u0bb2\u0b95 \u0ba4\u0bbf\u0b9f\u0bcd\u0b9f\u0b99\u0bcd\u0b95\u0bb3\u0bcd!" },
      timeline: { text: "2023 \u0bae\u0bc1\u0ba4\u0bb2\u0bcd \u0b8e\u0bb5\u0bcd\u0bb5\u0bb3\u0bb5\u0bc1 \u0ba4\u0bc2\u0bb0\u0bae\u0bcd \u0bb5\u0ba8\u0bcd\u0ba4\u0bc1\u0bb3\u0bcd\u0bb3\u0bcb\u0bae\u0bcd!" },
      stories:  { text: "\u0b87\u0ba8\u0bcd\u0ba4\u0b95\u0bcd \u0b95\u0ba4\u0bc8\u0b95\u0bb3\u0bcd \u0b8e\u0b99\u0bcd\u0b95\u0bb3\u0bc8 \u0b8a\u0b95\u0bcd\u0b95\u0bc1\u0bb5\u0bbf\u0b95\u0bcd\u0b95\u0bbf\u0ba9\u0bcd\u0bb1\u0ba9." },
      impact:   { text: "2027\u0b95\u0bcd\u0b95\u0bc1\u0bb3\u0bcd 10,000 \u0b95\u0bc1\u0bb4\u0ba8\u0bcd\u0ba4\u0bc8\u0b95\u0bb3\u0bcd \u2014 \u0b87\u0ba4\u0bc1 \u0b8e\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0b89\u0bb1\u0bc1\u0ba4\u0bbf\u0bae\u0bca\u0bb4\u0bbf." },
      gallery:  { text: "\u0b8e\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0bb5\u0b95\u0bc1\u0baa\u0bcd\u0baa\u0bb1\u0bc8\u0b95\u0bb3\u0bc8\u0baa\u0bcd \u0baa\u0bbe\u0bb0\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd!" },
      closing:  { text: "\u0b8e\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0baa\u0ba3\u0bbf\u0baf\u0bbf\u0bb2\u0bcd \u0b9a\u0bc7\u0bb0\u0bcd\u0bb5\u0bc0\u0bb0\u0bcd\u0b95\u0bb3\u0bbe?" }
    }
  };

  // === FAQ DATA (per section, expandable) ===
  var FAQ_DATA = {
    en: {
      hero: [
        { q: "What is KRKAI?", a: "KRKAI provides free robotics education to orphanages and government schools across India." },
        { q: "Is it really free?", a: "Yes! 100% free for all students. Funded by donations and partnerships." },
        { q: "Where do you operate?", a: "Currently in Tamil Nadu, expanding across India by 2027." }
      ],
      programs: [
        { q: "What do children learn?", a: "Arduino programming, AI basics, sensor integration, and real-world projects." },
        { q: "What age groups?", a: "Programs designed for children aged 8-16." },
        { q: "Do kids keep their projects?", a: "Yes! Every student takes home their completed robotics project." }
      ],
      impact: [
        { q: "How many children reached?", a: "Over 1,000 so far, with a goal of 10,000 by 2027." },
        { q: "How can I help?", a: "Donate, volunteer, or spread the word." },
        { q: "Can I visit a classroom?", a: "Absolutely! Contact us to schedule a visit." }
      ]
    },
    ta: {
      hero: [
        { q: "KRKAI \u0b8e\u0ba9\u0bcd\u0bb1\u0bbe\u0bb2\u0bcd \u0b8e\u0ba9\u0bcd\u0ba9?", a: "\u0b87\u0ba8\u0bcd\u0ba4\u0bbf\u0baf\u0bbe \u0bae\u0bc1\u0bb4\u0bc1\u0bb5\u0ba4\u0bc1\u0bae\u0bcd \u0b87\u0bb2\u0bb5\u0b9a \u0bb0\u0bcb\u0baa\u0bcb\u0b9f\u0bbf\u0b95\u0bcd\u0bb8\u0bcd \u0b95\u0bb2\u0bcd\u0bb5\u0bbf." },
        { q: "\u0b87\u0ba4\u0bc1 \u0b89\u0ba3\u0bcd\u0bae\u0bc8\u0baf\u0bbf\u0bb2\u0bcd \u0b87\u0bb2\u0bb5\u0b9a\u0bae\u0bbe?", a: "\u0b86\u0bae\u0bcd! 100% \u0b87\u0bb2\u0bb5\u0b9a\u0bae\u0bcd." },
        { q: "\u0b8e\u0b99\u0bcd\u0b95\u0bc7 \u0b9a\u0bc6\u0baf\u0bb2\u0bcd\u0baa\u0b9f\u0bc1\u0b95\u0bbf\u0bb1\u0bc0\u0bb0\u0bcd\u0b95\u0bb3\u0bcd?", a: "\u0ba4\u0bb1\u0bcd\u0baa\u0bcb\u0ba4\u0bc1 \u0ba4\u0bae\u0bbf\u0bb4\u0bcd\u0ba8\u0bbe\u0b9f\u0bcd\u0b9f\u0bbf\u0bb2\u0bcd." }
      ],
      programs: [
        { q: "\u0b95\u0bc1\u0bb4\u0ba8\u0bcd\u0ba4\u0bc8\u0b95\u0bb3\u0bcd \u0b8e\u0ba9\u0bcd\u0ba9 \u0b95\u0bb1\u0bcd\u0b95\u0bbf\u0bb1\u0bbe\u0bb0\u0bcd\u0b95\u0bb3\u0bcd?", a: "Arduino, AI, \u0b9a\u0bc6\u0ba9\u0bcd\u0b9a\u0bbe\u0bb0\u0bcd, \u0ba8\u0bbf\u0b9c \u0ba4\u0bbf\u0b9f\u0bcd\u0b9f\u0b99\u0bcd\u0b95\u0bb3\u0bcd." },
        { q: "\u0b8e\u0ba8\u0bcd\u0ba4 \u0bb5\u0baf\u0ba4\u0bbf\u0ba9\u0bb0\u0bc1\u0b95\u0bcd\u0b95\u0bc1?", a: "8-16 \u0bb5\u0baf\u0ba4\u0bc1 \u0b95\u0bc1\u0bb4\u0ba8\u0bcd\u0ba4\u0bc8\u0b95\u0bb3\u0bc1\u0b95\u0bcd\u0b95\u0bc1." },
        { q: "\u0ba4\u0bbf\u0b9f\u0bcd\u0b9f\u0b99\u0bcd\u0b95\u0bb3\u0bc8 \u0bb5\u0bc0\u0b9f\u0bcd\u0b9f\u0bbf\u0bb1\u0bcd\u0b95\u0bc1 \u0b8e\u0b9f\u0bc1\u0ba4\u0bcd\u0ba4\u0bc1\u0b9a\u0bcd \u0b9a\u0bc6\u0bb2\u0bcd\u0bb2\u0bb2\u0bbe\u0bae\u0bbe?", a: "\u0b86\u0bae\u0bcd!" }
      ],
      impact: [
        { q: "\u0b8e\u0ba4\u0bcd\u0ba4\u0ba9\u0bc8 \u0b95\u0bc1\u0bb4\u0ba8\u0bcd\u0ba4\u0bc8\u0b95\u0bb3\u0bc8 \u0b9a\u0bc6\u0ba9\u0bcd\u0bb1\u0b9f\u0bc8\u0ba8\u0bcd\u0ba4\u0bc0\u0bb0\u0bcd\u0b95\u0bb3\u0bcd?", a: "1,000\u0b95\u0bcd\u0b95\u0bc1\u0bae\u0bcd \u0bae\u0bc7\u0bb1\u0bcd\u0baa\u0b9f\u0bcd\u0b9f, 2027\u0b95\u0bcd\u0b95\u0bc1\u0bb3\u0bcd 10,000 \u0b87\u0bb2\u0b95\u0bcd\u0b95\u0bc1." },
        { q: "\u0ba8\u0bbe\u0ba9\u0bcd \u0b8e\u0baa\u0bcd\u0baa\u0b9f\u0bbf \u0b89\u0ba4\u0bb5 \u0bae\u0bc1\u0b9f\u0bbf\u0baf\u0bc1\u0bae\u0bcd?", a: "\u0ba8\u0ba9\u0bcd\u0b95\u0bca\u0b9f\u0bc8, \u0ba4\u0ba9\u0bcd\u0ba9\u0bbe\u0bb0\u0bcd\u0bb5\u0bb2\u0bb0\u0bcd, \u0baa\u0bb0\u0baa\u0bcd\u0baa\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd." },
        { q: "\u0bb5\u0b95\u0bc1\u0baa\u0bcd\u0baa\u0bb1\u0bc8\u0baf\u0bc8 \u0baa\u0bbe\u0bb0\u0bcd\u0bb5\u0bc8\u0baf\u0bbf\u0b9f\u0bb2\u0bbe\u0bae\u0bbe?", a: "\u0ba8\u0bbf\u0b9a\u0bcd\u0b9a\u0baf\u0bae\u0bbe\u0b95! \u0ba4\u0bca\u0b9f\u0bb0\u0bcd\u0baa\u0bc1\u0b95\u0bca\u0bb3\u0bcd\u0bb3\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd." }
      ]
    }
  };

  function init() {
    // HTML-only init — no 3D model, no scene needed
    buildHTMLElements();
  }

  // === HTML SPEECH BUBBLE + FAQ ===
  function buildHTMLElements() {
    // Speech bubble — always fixed bottom-right near INIIBO icon
    speechEl = document.createElement('div');
    speechEl.id = 'iniibo-speech';
    speechEl.className = 'iniibo-speech';
    var speechText = document.createElement('span');
    speechText.className = 'iniibo-speech-text';
    speechEl.appendChild(speechText);
    speechEl.style.display = 'none';
    document.body.appendChild(speechEl);

    // FAQ panel
    faqEl = document.createElement('div');
    faqEl.id = 'iniibo-faq';
    faqEl.className = 'iniibo-faq';
    faqEl.style.display = 'none';
    document.body.appendChild(faqEl);

    // HTML INIIBO element (bottom-right icon)
    htmlIniiboEl = document.getElementById('iniibo-float');
  }

  // === BUILD FAQ DOM (safe method — no innerHTML) ===
  function buildFaqDOM(faqData) {
    while (faqEl.firstChild) faqEl.removeChild(faqEl.firstChild);

    var title = document.createElement('div');
    title.className = 'iniibo-faq-title';
    title.textContent = 'Quick FAQ';
    faqEl.appendChild(title);

    for (var i = 0; i < faqData.length; i++) {
      var details = document.createElement('details');
      details.className = 'iniibo-faq-item';
      var summary = document.createElement('summary');
      summary.textContent = faqData[i].q;
      details.appendChild(summary);
      var answer = document.createElement('p');
      answer.textContent = faqData[i].a;
      details.appendChild(answer);
      faqEl.appendChild(details);
    }
  }

  // === UPDATE PER FRAME ===
  function update(scrollProgress) {
    progress = scrollProgress;
    var p = Math.max(0, Math.min(progress, 1));
    updateSpeechBubble(p);
  }

  // === SPEECH BUBBLE UPDATE (always bottom-right) ===
  function updateSpeechBubble(p) {
    if (!speechEl) return;

    // Determine current section
    var section = null;
    if (p >= 0.05 && p < 0.16) section = 'hero';
    else if (p >= 0.18 && p < 0.28) section = 'problem';
    else if (p >= 0.28 && p < 0.38) section = 'mission';
    else if (p >= 0.38 && p < 0.48) section = 'programs';
    else if (p >= 0.48 && p < 0.58) section = 'timeline';
    else if (p >= 0.58 && p < 0.68) section = 'stories';
    else if (p >= 0.68 && p < 0.80) section = 'impact';
    else if (p >= 0.80 && p < 0.90) section = 'gallery';
    else if (p >= 0.95) section = 'closing';

    if (!section) {
      if (_lastSection !== null) {
        speechEl.style.display = 'none';
        faqEl.style.display = 'none';
        _lastSection = null;
      }
      return;
    }

    // Get language
    var lang = (window.KRKAI_i18n && KRKAI_i18n.getLang) ? KRKAI_i18n.getLang() : 'en';
    if (!SPEECH_DATA[lang]) lang = 'en';

    var data = SPEECH_DATA[lang][section];
    if (!data) {
      speechEl.style.display = 'none';
      return;
    }

    // Only update DOM when section or language changes (avoids rebuild every scroll frame)
    var sectionKey = lang + ':' + section;
    if (sectionKey !== _lastSection) {
      _lastSection = sectionKey;

      // Fixed position near bottom-right INIIBO icon
      speechEl.style.left = '';
      speechEl.style.right = '90px';
      speechEl.style.top = '';
      speechEl.style.bottom = '100px';

      speechEl.style.display = '';
      speechEl.querySelector('.iniibo-speech-text').textContent = data.text;

      // FAQ panel
      var faqData = FAQ_DATA[lang] && FAQ_DATA[lang][section];
      if (faqData && faqData.length > 0) {
        buildFaqDOM(faqData);
        faqEl.style.left = '';
        faqEl.style.right = '90px';
        faqEl.style.top = '';
        faqEl.style.bottom = '160px';
        faqEl.style.display = '';
      } else {
        faqEl.style.display = 'none';
      }
    }
  }

  return {
    init: init,
    update: update
  };
})();
