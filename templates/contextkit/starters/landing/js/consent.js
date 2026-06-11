/* Consent gate — single owner of the cookie-consent state (LGPD).
   Trackers NEVER run before an explicit "granted": partials/gtm.html and any
   model in js/tracking-models.js listen for the `lp:consent-granted` event or
   call LPConsent.granted(). Choice persists in localStorage. */
(function () {
  'use strict';
  var KEY = 'lp-consent';
  var banner = document.getElementById('lp-consent');

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function store(choice) {
    try { localStorage.setItem(KEY, choice); } catch (e) { /* private mode */ }
  }
  function announce(choice) {
    if (choice === 'granted') {
      document.dispatchEvent(new CustomEvent('lp:consent-granted'));
    }
  }

  window.LPConsent = {
    granted: function () { return stored() === 'granted'; },
    reset: function () {
      try { localStorage.removeItem(KEY); } catch (e) { /* no-op */ }
    }
  };

  var choice = stored();
  if (choice) {
    announce(choice);
    return; // a stored decision means no banner
  }
  if (!banner) return;
  banner.hidden = false;
  banner.querySelectorAll('[data-consent]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var picked = btn.getAttribute('data-consent');
      store(picked);
      banner.hidden = true;
      announce(picked);
    });
  });
})();
