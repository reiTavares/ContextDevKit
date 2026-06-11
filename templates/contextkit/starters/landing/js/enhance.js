/* Progressive enhancement only — content lives 100% in the HTML (AISO: LLM
   crawlers do not run JS). Reveal-on-scroll with per-sibling stagger; fully
   disabled under prefers-reduced-motion. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var targets = document.querySelectorAll('.section, .hero-inner, .benefit, .qa-item, .offer-card');

  if (reduce || !('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  targets.forEach(function (el) {
    el.classList.add('reveal');
    var parent = el.parentElement;
    if (parent) {
      var peers = Array.prototype.filter.call(parent.children, function (c) {
        return c.classList.contains('reveal');
      });
      var idx = peers.indexOf(el);
      if (idx > 0) el.style.setProperty('--d', Math.min(idx, 6) * 70 + 'ms');
    }
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  targets.forEach(function (el) { io.observe(el); });
})();
