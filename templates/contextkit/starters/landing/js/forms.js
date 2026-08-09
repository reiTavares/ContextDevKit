/* Decoupled lead capture — POSTs JSON to the webhook in lp.config.json
   (n8n / Make / Sheets / any endpoint). No vendor lock-in, no inline handlers.
   UI states: loading (button disabled) / success / error via data attributes. */
(function () {
  'use strict';
  var webhookUrl = (window.LP_CONFIG || {}).webhookUrl;

  document.querySelectorAll('[data-lp-form]').forEach(function (form) {
    var submit = form.querySelector('[data-lp-submit]');
    var successEl = form.querySelector('[data-lp-success]');
    var errorEl = form.querySelector('[data-lp-error]');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      if (!webhookUrl) {
        // No endpoint configured — visible refusal beats a silent drop.
        if (errorEl) { errorEl.hidden = false; errorEl.textContent += ' (webhookUrl não configurado em lp.config.json)'; }
        return;
      }
      if (successEl) successEl.hidden = true;
      if (errorEl) errorEl.hidden = true;
      if (submit) submit.disabled = true;

      var payload = {};
      new FormData(form).forEach(function (value, key) { payload[key] = value; });
      payload.page = location.href;
      payload.submittedAt = new Date().toISOString();

      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        form.reset();
        if (successEl) successEl.hidden = false;
      }).catch(function () {
        if (errorEl) errorEl.hidden = false;
      }).finally(function () {
        if (submit) submit.disabled = false;
      });
    });
  });
})();
