// Shared Envoy utilities — included on all app pages

(async function () {
  // Don't show on the landing page
  if (document.body.classList.contains('landing-page')) return;

  try {
    const data = await fetch('/api/version').then(r => r.json());
    const d = new Date(data.started);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const el = document.createElement('div');
    el.id = 'last-updated-indicator';
    el.style.cssText = [
      'position:fixed',
      'top:14px',
      'right:20px',
      'font-size:11px',
      'color:#bdc1c6',
      'z-index:999',
      'pointer-events:none',
      'letter-spacing:0.3px',
      'font-family:inherit',
    ].join(';');
    el.textContent = `Updated ${dateStr} ${timeStr}`;
    document.body.appendChild(el);
  } catch (_) {}
}());
