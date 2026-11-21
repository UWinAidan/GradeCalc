// How to use: FAQ search. Every word typed must appear in a question, its answer or its keywords (any order, any case).
// One match opens; ?q=… in the address fills the box. No network.
const box = document.getElementById('faq-search');
const items = [...document.querySelectorAll('#faq-list .faq-item')];
const count = document.getElementById('faq-count');
const none = document.getElementById('faq-none');

const norm = (s) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9.+%]+/g, ' ');
const haystack = new Map(items.map((d) => [d, norm(`${d.textContent} ${d.dataset.keywords || ''}`)]));

function search() {
  const words = norm(box.value).split(' ').filter(Boolean);
  let shown = 0;
  for (const d of items) {
    const hit = words.every((w) => haystack.get(d).includes(w));
    d.hidden = !hit;
    if (hit) shown++;
  }
  const only = items.filter((d) => !d.hidden);
  if (words.length && only.length === 1) only[0].open = true;
  none.hidden = shown > 0;
  count.textContent = words.length ? `${shown} of ${items.length} questions` : `${items.length} questions`;
}

if (box) {
  const q = new URLSearchParams(location.search).get('q');
  if (q) box.value = q.slice(0, 100);
  box.addEventListener('input', search);
  search();
}
// A link to one question (#q-backup) opens it.
const target = location.hash && document.getElementById(location.hash.slice(1));
if (target && target.classList.contains('faq-item')) target.open = true;
