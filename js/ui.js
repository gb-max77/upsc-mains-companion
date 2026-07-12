// tiny modal-sheet helper
export function sheet(html, onMount) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="sheet">${html}</div>`;
  root.onclick = (e) => { if (e.target === root) closeSheet(); };
  if (onMount) onMount(root.firstElementChild);
  return root.firstElementChild;
}

export function closeSheet() {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  root.onclick = null;
}

export function toast(msg, ms = 2200) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#2a2e3a;color:#fff;padding:10px 18px;border-radius:99px;font-size:13px;font-weight:600;z-index:200;transition:opacity .3s;max-width:86vw;text-align:center';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.style.opacity = '0'; }, ms);
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
