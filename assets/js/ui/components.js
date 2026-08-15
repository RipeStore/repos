import { $, cdnify, getProxiedImageUrl, isDdgErrorImage, observeSmartImage, PLACEHOLDER_SRC, formatAppTitleHTML } from '../core/utils.js';

/**
 * Removes the splash screen with a fade-out effect.
 */
export function removeSplash() {
  const splash = $('#splash');
  if (splash) {
    splash.classList.add('fade-out');
    setTimeout(() => splash.remove(), 600);
  }
}

/**
 * Builds a standard App Card element.
 */
export function buildAppCard(app) {
  const card = document.createElement('a');
  card.className = 'app-item';
  
  const ver = app._isVersion ? app.version : app.currentVersion;
  const verParam = ver ? `&version=${encodeURIComponent(ver)}` : '';
  card.href = `app?bundle=${app.bundle}&name=${encodeURIComponent(app.name)}&repo=${app.source}${verParam}`;
  
  const icon = document.createElement('img');
  icon.dataset.src = cdnify(app.icon);
  icon.src = PLACEHOLDER_SRC;
  icon.loading = 'lazy';
  icon.className = 'app-icon';
  
  observeSmartImage(icon);

  const all = app.allIcons || (app.icon ? [app.icon] : []);
  icon.dataset.idx = 0;
  icon.dataset.ddgTried = '0';
  icon.onload = () => {
    if (icon.src === PLACEHOLDER_SRC) return;
    if (isDdgErrorImage(icon)) {
      icon.onerror();
    }
  };
  icon.onerror = () => {
    if (icon.src === PLACEHOLDER_SRC) return;
    const curIdx = parseInt(icon.dataset.idx || '0');
    const curUrl = all[curIdx] || app.icon;

    if (icon.dataset.ddgTried !== '1') {
      icon.dataset.ddgTried = '1';
      const proxied = getProxiedImageUrl(curUrl ? cdnify(curUrl) : icon.dataset.src);
      if (proxied) {
        icon.dataset.src = proxied;
        icon.src = proxied;
        return;
      }
    }

    icon.dataset.ddgTried = '0';
    let idx = curIdx + 1;
    if (idx < all.length) {
      icon.dataset.idx = idx;
      icon.dataset.src = cdnify(all[idx]);
      icon.src = icon.dataset.src;
    } else {
      icon.onerror = null;
      icon.onload = null;
      icon.dataset.src = 'assets/img/placeholder.png';
      icon.src = icon.dataset.src;
    }
  };

  const meta = document.createElement('div');
  meta.className = 'app-meta';
  
  const title = document.createElement('div');
  title.className = 'app-name';
  title.innerHTML = formatAppTitleHTML(app.name);
  
  const sub = document.createElement('div');
  sub.className = 'app-sub';
  
  const subtitle = app.subtitle || app.dev || '';
  const sourceName = app.repoName || getSourceLabel({ source: app.source });
  const parts = [ver, sourceName, subtitle].filter(p => p && p.trim().length > 0);
  sub.textContent = parts.join(' • ');
  
  const btn = document.createElement('button');
  btn.className = 'get-btn';
  btn.textContent = 'GET';
  
  meta.appendChild(title);
  meta.appendChild(sub);
  card.appendChild(icon);
  card.appendChild(meta);
  card.appendChild(btn);
  
  return card;
}

/**
 * Renders a standardized error message into a container.
 */
export function renderError(container, title, msg, btnOptions) {
  if (!container) return;
  
  let btnHTML = '';
  if (btnOptions !== null) {
    const text = btnOptions?.text || 'Go Back Home';
    const href = btnOptions?.href || './';
    btnHTML = `<a href="${href}" class="btn-primary" style="display:inline-flex; text-decoration:none; margin-top: 16px;">${text}</a>`;
  }

  container.innerHTML = `
    <div class="error-container">
      <div class="error-icon">⚠️</div>
      <h2 class="error-title">${title}</h2>
      <p class="error-text">${msg}</p>
      ${btnHTML}
    </div>
  `;
}

/**
 * Returns the source display label.
 */
export function getSourceLabel(v) {
  if (v.repoName) return v.repoName;
  const src = v.source;
  if (!src) return 'Unknown';
  if (src.includes('ripestore/repos/main/')) {
    const parts = src.split('/');
    const file = parts[parts.length - 1];
    return file.replace('.json', '');
  }
  if (src.includes('://')) {
    try { return new URL(src).hostname; } catch(e) { return src; }
  }
  return src;
}
