// CCT/SEXA continuous reader: sixteen volumes (6,409 PDF pages; 6,215 dissertation pages), lazily loaded in small PDF chunks with PDF.js.
const D = JSON.parse(document.getElementById('r-data').textContent);
const V = document.getElementById('viewer');
const $ = id => document.getElementById(id);
const sel = $('r-book'), inp = $('r-page'), dl = $('r-dl');
const TOTAL = D.total;
const W0 = 612, H0 = 792;
const chunkOf = new Array(TOTAL + 1); // global page -> [file, localIndex, bookIdx]
D.books.forEach((b, bi) => b.c.forEach(([f, from, to]) => { for (let p = from; p <= to; p++) chunkOf[b.s + p - 1] = [f, p - from + 1, bi]; }));
const bookOf = p => chunkOf[p][2];

let opened = false;
// Build page placeholders once (cheap: empty divs with fixed aspect ratio).
const pages = [null];
function build() {
const frag = document.createDocumentFragment();
for (let p = 1; p <= TOTAL; p++) {
  const d = document.createElement('div'); d.className = 'pg'; d.dataset.p = p;
  d.innerHTML = '<span class="lbl">' + p.toLocaleString() + '</span>';
  pages.push(d); frag.appendChild(d);
}
V.appendChild(frag);
}

let pdfjs = null, pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) pdfjsP = import('./pdfjs/pdf.min.mjs').then(m => {
    m.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    pdfjs = m; return m;
  });
  return pdfjsP;
}
const fontUrl = new URL('./pdfjs/standard_fonts/', import.meta.url).href;
const docs = new Map(); // file -> promise
function getDoc(file) {
  if (docs.has(file)) { const v = docs.get(file); docs.delete(file); docs.set(file, v); return v; }
  const pr = loadPdfjs().then(m => m.getDocument({ url: 'pdf/view/' + file, standardFontDataUrl: fontUrl, disableAutoFetch: true, isEvalSupported: false }).promise);
  docs.set(file, pr);
  while (docs.size > 5) { const [k, v] = docs.entries().next().value; docs.delete(k); v.then(d => d.destroy()).catch(() => {}); }
  return pr;
}

const rendered = new Map(); // p -> {canvas, task, w}
const want = new Set();
async function render(p) {
  const el = pages[p]; const cssW = el.clientWidth; if (!cssW) return;
  const cur = rendered.get(p); if (cur && cur.w === cssW) return;
  const [file, local] = chunkOf[p];
  const token = {}; rendered.set(p, { w: cssW, token });
  try {
    const doc = await getDoc(file);
    if (!want.has(p) || rendered.get(p)?.token !== token) return;
    const page = await doc.getPage(local);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = page.getViewport({ scale: cssW * dpr / W0 });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    c.setAttribute('aria-label', 'Page ' + p);
    await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
    if (!want.has(p) || rendered.get(p)?.token !== token) return;
    el.querySelector('canvas')?.remove(); el.appendChild(c); page.cleanup();
  } catch (e) { if (rendered.get(p)?.token === token) rendered.delete(p); }
}
function unrender(p) { pages[p].querySelector('canvas')?.remove(); rendered.delete(p); }

const io = new IntersectionObserver(es => {
  for (const e of es) {
    const p = +e.target.dataset.p;
    if (e.isIntersecting) { want.add(p); render(p); } else { want.delete(p); unrender(p); }
  }
}, { root: V, rootMargin: '1000px 0px' });

let started = false;
function start() { if (started) return; started = true; loadPdfjs(); pages.forEach(d => d && io.observe(d)); }

// Position helpers (all pages share one size, so position is arithmetic).
// Average stride over the whole document: per-page offsets are rounded to whole pixels, so a two-page stride drifts over thousands of pages.
function stride() { return pages.length > 2 ? (pages[TOTAL].offsetTop - pages[1].offsetTop) / (TOTAL - 1) : pages[1].offsetHeight; }
function curPage() { const s = stride(); return Math.max(1, Math.min(TOTAL, Math.floor((V.scrollTop - pages[1].offsetTop + s * 0.35) / s) + 1)); }
function goto(p, smooth) { p = Math.max(1, Math.min(TOTAL, p | 0)); start(); V.scrollTo({ top: pages[p].offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' }); update(p); }
let lastBook = -1;
function update(p) {
  p = p || curPage(); if (document.activeElement !== inp) inp.value = p;
  const bi = bookOf(p); if (bi !== lastBook) { lastBook = bi; sel.value = String(D.books[bi].s); dl.href = D.books[bi].f; dl.textContent = 'PDF, free to download · Book ' + D.books[bi].r; }
}
let ticking = false;
V.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); } }, { passive: true });
sel.addEventListener('change', () => goto(+sel.value));
inp.addEventListener('change', () => goto(+inp.value));
inp.addEventListener('keydown', e => { if (e.key === 'Enter') goto(+inp.value); });
$('r-prev').onclick = () => goto(curPage() - 1, true);
$('r-next').onclick = () => goto(curPage() + 1, true);
let pw = Math.min(860, V.clientWidth - 20);
function zoom(f) { const p = curPage(); pw = Math.max(320, Math.min(1800, Math.round(pw * f))); V.style.setProperty('--pw', pw + 'px'); goto(p); [...want].forEach(render); }
$('r-in').onclick = () => zoom(1.2); $('r-out').onclick = () => zoom(1 / 1.2);
$('r-fs').onclick = () => { const r = document.getElementById('reader'); document.fullscreenElement ? document.exitFullscreen() : (V.requestFullscreen ? V.requestFullscreen() : null); };
document.addEventListener('fullscreenchange', () => setTimeout(() => [...want].forEach(render), 100));
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => [...want].forEach(render), 200); });

// Links from covers / hash (#p=123)
document.addEventListener('click', e => {
  const a = e.target.closest('[data-goto]'); if (!a) return;
  e.preventDefault(); openReader(+a.dataset.goto); document.getElementById('read').scrollIntoView();
  history.replaceState(null, '', '#p=' + a.dataset.goto);
});


const wrapR = document.getElementById('r-wrap'), openB = document.getElementById('r-open');
function openReader(p) {
  if (!opened) { opened = true; wrapR.hidden = false; openB.setAttribute('aria-expanded', 'true'); openB.textContent = 'Close the reader'; build(); pw = Math.min(860, V.clientWidth - 20); start(); update(1); }
  else if (p === undefined) { wrapR.hidden = !wrapR.hidden; openB.textContent = wrapR.hidden ? 'Open the reader' : 'Close the reader'; openB.setAttribute('aria-expanded', String(!wrapR.hidden)); return; }
  wrapR.hidden = false;
  if (p) setTimeout(() => goto(p), 60);
}
openB.addEventListener('click', () => openReader());
const m = location.hash.match(/^#p=(\d+)/);
if (m) { openReader(+m[1]); document.getElementById('read').scrollIntoView(); }
