/* ============================================================================
 * TRACKING MODELS — reference templates, ALL COMMENTED OUT by design.
 *
 * This file is documentation you copy FROM, never code that runs. It is NOT
 * included in the built page (lp-build.mjs skips it). To activate a pixel:
 *   1. Prefer GTM: paste the tag inside your GTM container (partials/gtm.html
 *      already loads GTM consent-gated once lp.config.json has a gtmId).
 *   2. If you must inline a pixel, copy the model below into a script the page
 *      loads, KEEPING the consent wrapper — firing a tracker before consent
 *      violates the LGPD posture this starter ships with.
 * ==========================================================================*/

/* --- MODEL: Meta Pixel (consent-gated) --------------------------------------
document.addEventListener('lp:consent-granted', function () {
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', 'SEU_PIXEL_ID');
  fbq('track', 'PageView');
});
----------------------------------------------------------------------------*/

/* --- MODEL: TikTok Pixel (consent-gated) ------------------------------------
document.addEventListener('lp:consent-granted', function () {
  !function (w, d, t) { w.TiktokAnalyticsObject = t; var ttq = w[t] = w[t] || [];
  ttq.methods = ['page', 'track', 'identify']; ttq.load = function (e) {
  var s = d.createElement('script'); s.async = true;
  s.src = 'https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=' + e;
  d.head.appendChild(s); }; ttq.load('SEU_PIXEL_ID'); ttq.page();
  }(window, document, 'ttq');
});
----------------------------------------------------------------------------*/

/* --- MODEL: LinkedIn Insight Tag (consent-gated) ----------------------------
document.addEventListener('lp:consent-granted', function () {
  window._linkedin_partner_id = 'SEU_PARTNER_ID';
  window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
  window._linkedin_data_partner_ids.push(window._linkedin_partner_id);
  var s = document.createElement('script'); s.async = true;
  s.src = 'https://snap.licdn.com/li.lms-analytics/insight.min.js';
  document.head.appendChild(s);
});
----------------------------------------------------------------------------*/
