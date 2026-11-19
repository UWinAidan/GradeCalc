// Shared page chrome: theme toggle and the About page's "Copy" email button. No network.
const themeBtn = document.getElementById('theme-btn');
if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('gc-theme', next); } catch (e) { /* not saved; still switches */ }
  });
}

const copyBtn = document.getElementById('about-copy');
if (copyBtn) {
  const EMAIL = 'contact@aidanwbrown.com';
  const done = (ok) => { copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); };
  const fallback = () => {
    const t = document.createElement('textarea');
    t.readOnly = true; t.style.cssText = 'position:fixed;opacity:0'; t.value = EMAIL;
    document.body.append(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
    t.remove(); done(ok);
  };
  copyBtn.addEventListener('click', () => {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(EMAIL).then(() => done(true), fallback);
    else fallback();
  });
}
