// Registers the service worker (/sw.js) so the site opens offline and can be installed. It caches only this site's own
// files; see sw.js. Fails quietly (old browser, blocked storage): the site works the same without it.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
