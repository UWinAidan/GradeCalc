// Runs in <head> before first paint so the page never flashes the wrong theme.
// Order: the visitor's saved choice → their system setting → dark (the brand default).
(() => {
  let t = null;
  try { t = localStorage.getItem('gc-theme'); } catch (e) { /* storage blocked: fall through */ }
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();
