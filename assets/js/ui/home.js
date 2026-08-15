import { $, ellipsize, parseDateString, qs, debounce, cdnify, getProxiedImageUrl, isDdgErrorImage, observeSmartImage, PLACEHOLDER_SRC } from '../core/utils.js';
import { streamRepos } from '../core/repo.js';
import { getSources } from '../core/sources.js';
import { initSearch, searchApps } from '../core/search.js';
import { initCarousel } from '../core/carousel.js';
import { removeSplash, buildAppCard, renderError } from './components.js';

const BATCH = 24;

const state = {
  allMerged: [],
  allNews: [],
  featuredIds: [],
  list: [],
  rendered: 0,
  q: '',
  sort: 'date-desc',
  initialized: false
};

async function loadAll() {
  state.allMerged = [];
  state.allNews = [];
  state.featuredIds = [];
  
  const splashStatus = $('#splash-status');
  const splash = $('#splash');

  showSkeleton();

  let showTimeout = setTimeout(() => {
    if (!state.initialized) {
       finishLoading();
    }
  }, 4000); // Max 4 seconds on splash guarantee

  const finishLoading = () => {
    if (state.initialized) return;
    state.initialized = true;
    clearTimeout(showTimeout);
    
    try { renderFeatured(); } catch(e) { console.error('renderFeatured failed', e); }
    try { renderNews(); } catch(e) { console.error('renderNews failed', e); }
    try { initSearch(state.allMerged); } catch(e) { console.error('initSearch failed', e); }
    try { filterAndPrepare(); } catch(e) { console.error('filterAndPrepare failed', e); }

    if (state.allMerged.length === 0) {
      try {
        const sources = getSources();
        if (sources.length === 0) {
          renderError($('main'), 'No Sources Added', 'You haven\'t added any app sources yet. Add a repository to discover apps.', { text: 'Manage Sources', href: 'sources.html' });
        } else {
          renderError($('main'), 'Failed to Load Apps', 'We couldn\'t load any apps from your sources. Please check your internet connection or manage your sources.', { text: 'Manage Sources', href: 'sources.html' });
        }
      } catch (e) {
        console.error('renderError failed', e);
      }
    }

    try { removeSplash(); } catch(e) { console.error('removeSplash failed', e); }
  };

  await streamRepos(
    (data) => {
      if (data.apps) state.allMerged = data.apps;
      if (data.news) state.allNews = data.news;
      if (data.featured) state.featuredIds = data.featured;
      
      if (data.currentRepo && splashStatus) {
        splashStatus.textContent = `Loading ${data.currentRepo}...`;
      }

      if (data.progress === 1) {
          finishLoading();
      }
    },
    () => {
      finishLoading();
      console.log('All repositories loaded');
    }
  );

  // Check for search query param
  const urlQ = qs('q');
  if (urlQ) {
    state.q = urlQ;
    const input = $('#search-input');
    if (input) input.value = urlQ;
    const clearBtn = $('#search-clear');
    if (clearBtn) clearBtn.classList.remove('hidden');
    $('#featured-section')?.classList.add('collapsed');
    $('#news-section')?.classList.add('collapsed');
    filterAndPrepare();
  }
}

function showSkeleton() {
  const grid = $('#app-grid');
  if (!grid || grid.children.length > 0) return;
  
  grid.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const skel = document.createElement('div');
    skel.className = 'app-item skeleton';
    skel.innerHTML = `
      <div class="skel-icon"></div>
      <div class="skel-meta">
        <div class="skel-line title"></div>
        <div class="skel-line sub"></div>
      </div>
      <div class="skel-btn"></div>
    `;
    grid.appendChild(skel);
  }
}

function renderFeatured() {
  const container = $('#featured-section');
  const grid = $('#featured-grid');
  if (!state.featuredIds.length) {
    container?.classList.add('hidden');
    return;
  }
  
  const uniqueFeatured = [];
  const seenFeatured = new Set();
  state.featuredIds.forEach(f => {
    const key = typeof f === 'string' ? f : `${f.id}|${f.source}`;
    if (!seenFeatured.has(key)) {
      seenFeatured.add(key);
      uniqueFeatured.push(f);
    }
  });

  const featuredApps = uniqueFeatured.map(f => {
    if (typeof f === 'string') return state.allMerged.find(a => a.bundle === f);
    return state.allMerged.find(a => a.bundle === f.id && a.source === f.source);
  }).filter(Boolean);

  if (!featuredApps.length) {
    container?.classList.add('hidden');
    return;
  }

  grid.innerHTML = '';
  
  // Calculate how many fit
  // Card width 320px + 16px gap = 336px. Container padding approx 40px.
  // We want to avoid scrolling, so we show N items that fit.
  // Wait, user wants more items, so we SHOULD allow scrolling.
  let limit = 12;

  featuredApps.slice(0, limit).forEach(a => {
    const card = document.createElement('a');
    card.className = 'featured-card';
    card.href = `app?bundle=${a.bundle}&name=${encodeURIComponent(a.name)}&repo=${a.source}`;
    
    // Background image if available (using icon as fallback blurred maybe? or just standard style)
    // For now standard style
    const icon = document.createElement('img');
    icon.dataset.src = cdnify(a.icon);
    icon.src = PLACEHOLDER_SRC;
    icon.className = 'featured-icon';
    
    observeSmartImage(icon);

    const all = a.allIcons || (a.icon ? [a.icon] : []);
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
      const curUrl = all[curIdx] || a.icon;

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
    
    const info = document.createElement('div');
    info.className = 'featured-info';
    
    const title = document.createElement('div');
    title.className = 'featured-title';
    title.textContent = a.name;
    
    const sub = document.createElement('div');
    sub.className = 'featured-subtitle';
    const ver = a.currentVersion;
    const sourceName = a.repoName || getSourceLabel({ source: a.source });
    const subText = a.subtitle || a.desc || 'Featured App';
    const parts = [ver, sourceName, ellipsize(subText, 45)].filter(p => p && p.trim().length > 0);
    sub.textContent = parts.join(' • ');
    
    info.appendChild(title);
    info.appendChild(sub);
    card.appendChild(icon);
    card.appendChild(info);
    
    grid.appendChild(card);
  });
  if (container) {
    container.classList.remove('hidden');
    // Initialize carousel buttons
    const wrapper = container.querySelector('.carousel-container');
    if (wrapper) initCarousel(wrapper);
  }
}

function renderNews() {
  const container = $('#news-section');
  const grid = $('#news-grid');
  if (!state.allNews.length) {
    container?.classList.add('hidden');
    return;
  }
  
  state.allNews.sort((a, b) => {
    const da = parseDateString(a.date);
    const db = parseDateString(b.date);
    return (da && db) ? db - da : 0;
  });

  const seenBundles = new Set();
  const filteredNews = state.allNews.filter(n => {
    if (n.appID) {
      if (seenBundles.has(n.appID)) return false;
      seenBundles.add(n.appID);
    }
    return true;
  });

  // Push items without images to the end
  filteredNews.sort((a, b) => {
      const hasA = !!a.image;
      const hasB = !!b.image;
      if (hasA === hasB) return 0; // Keep date order
      return hasA ? -1 : 1;
  });

  grid.innerHTML = '';
  
  // Calculate fit
  // Card width 260px + 16px gap = 276px.
  let limit = 10;

  filteredNews.slice(0, limit).forEach(n => {
    const card = document.createElement('div');
    card.className = 'news-card';
    card.onclick = () => {
      if (n.appID) {
        const app = state.allMerged.find(a => a.bundle === n.appID);
        const nameParam = app ? `&name=${encodeURIComponent(app.name)}` : '';
        location.href = `app?bundle=${n.appID}${nameParam}&repo=${n.source}`;
      }
      else if (n.url) location.href = n.url;
    };
    
    if (n.image) {
      const img = document.createElement('img');
      img.dataset.src = cdnify(n.image);
      img.src = PLACEHOLDER_SRC;
      
      observeSmartImage(img);
      
      img.onload = () => {
        if (img.src === PLACEHOLDER_SRC) return;
        if (isDdgErrorImage(img)) {
          img.onerror();
        }
      };
      img.onerror = () => {
        if (img.src === PLACEHOLDER_SRC) return;
        if (!img.dataset.ddgTried) {
          img.dataset.ddgTried = 'true';
          const proxied = getProxiedImageUrl(cdnify(n.image));
          if (proxied) {
            img.dataset.src = proxied;
            img.src = proxied;
            return;
          }
        }
        const placeholder = document.createElement('div');
        placeholder.className = 'news-placeholder';
        img.replaceWith(placeholder);
      };
      card.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'news-placeholder';
      card.appendChild(placeholder);
    }
    
    const content = document.createElement('div');
    content.className = 'news-content';
    
    const title = document.createElement('div');
    title.className = 'news-title';
    title.textContent = n.title;
    if (n.tintColor) title.style.color = n.tintColor;
    
    const caption = document.createElement('div');
    caption.className = 'news-caption';
    caption.textContent = ellipsize(n.caption, 60);
    
    content.appendChild(title);
    content.appendChild(caption);
    card.appendChild(content);
    
    grid.appendChild(card);
  });
  if (container) {
    container.classList.remove('hidden');
    const wrapper = container.querySelector('.carousel-container');
    if (wrapper) initCarousel(wrapper);
  }
}

function filterAndPrepare() {
  const q = state.q.trim();
  let result = state.allMerged;

  if (q) {
    if (q.toLowerCase().startsWith('provider:')) {
      const provider = q.substring(9).trim().toLowerCase();
      if (provider) {
        result = state.allMerged.filter(app => (app.dev || '').toLowerCase().includes(provider));
      }
    } else if (q.toLowerCase().startsWith('category:')) {
      const cat = q.substring(9).trim().toLowerCase();
      if (cat) {
        result = state.allMerged.filter(app => (app.category || 'Utility').toLowerCase().includes(cat));
      }
    } else if (q.toLowerCase().startsWith('source:')) {
      const src = q.substring(7).trim().toLowerCase();
      if (src) {
        result = state.allMerged.filter(app => {
          const s1 = ((app.versions && app.versions[0] && app.versions[0].source) || app.source || '').toLowerCase();
          const s2 = (app.repoName || '').toLowerCase();
          return s1.includes(src) || s2.includes(src);
        });
      }
    } else {
      result = searchApps(q, state.allMerged);
    }
  }

  // If sort is relevance and we are searching, searchApps already sorted it.
  // If not searching, relevance is same as date-desc.
  if (state.sort === 'relevance' && !q) {
     state.sort = 'date-desc';
     const sel = $('#sort-select');
     if (sel) sel.value = 'date-desc';
  }

  if (state.sort === 'relevance') {
    // Keep search order
  } else {
    // Sort helper
    const getDate = (app) => {
      const dStr = (app.versions && app.versions[0] && app.versions[0].date) || app.date;
      const d = parseDateString(dStr);
      return d ? d.getTime() : 0;
    };

    if (state.sort === 'date-desc') {
      result.sort((a, b) => getDate(b) - getDate(a));
    } else if (state.sort === 'date-asc') {
      result.sort((a, b) => getDate(a) - getDate(b));
    } else if (state.sort === 'name-desc') {
      result.sort((a, b) => b.name.localeCompare(a.name));
    } else {
      // Default name-asc
      result.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  state.list = result;
  state.rendered = 0;
  $('#app-grid').innerHTML = '';
  appendBatch();
  window.scrollTo(0, 0);
}

function appendBatch() {
  const grid = $('#app-grid');
  const next = Math.min(state.rendered + BATCH, state.list.length);
  for (let i = state.rendered; i < next; i++) {
    grid.appendChild(buildAppCard(state.list[i]));
  }
  state.rendered = next;
}

// Event Listeners
if ($('#sort-select')) {
  $('#sort-select').addEventListener('change', e => {
    state.sort = e.target.value;
    filterAndPrepare();
  });
}

$('#search-input').addEventListener('input', e => {
  state.q = e.target.value;
  
  const isSearching = state.q.trim().length > 0;
  
  const clearBtn = $('#search-clear');
  if (clearBtn) clearBtn.classList.toggle('hidden', state.q.length === 0);

  $('#featured-section').classList.toggle('collapsed', isSearching);
  $('#news-section').classList.toggle('collapsed', isSearching);

  if (isSearching && state.sort !== 'relevance') {
      state.sort = 'relevance';
      const sel = $('#sort-select');
      if (sel) sel.value = 'relevance';
  } else if (!isSearching && state.sort === 'relevance') {
      state.sort = 'date-desc';
      const sel = $('#sort-select');
      if (sel) sel.value = 'date-desc';
  }

  debounce(filterAndPrepare, 300)();
});

const clearBtn = $('#search-clear');
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    const input = $('#search-input');
    if (input) {
      input.value = '';
      input.dispatchEvent(new Event('input'));
      input.focus();
    }
  });
}

let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    if ((window.innerHeight + window.scrollY) >= (document.body.offsetHeight - 500)) {
      appendBatch();
    }
    ticking = false;
  });
});

loadAll();
