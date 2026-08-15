import { $, qs, parseDateString, cdnify, getProxiedImageUrl, isDdgErrorImage, observeSmartImage, PLACEHOLDER_SRC, updateSEO, updateMeta } from '../core/utils.js';
import { streamRepos } from '../core/repo.js';
import { getSources } from '../core/sources.js';
import { removeSplash, buildAppCard, renderError } from './components.js';

async function loadList() {
  const type = qs('type'); // 'featured' or 'news'
  if (!type) {
    $('#list-title').textContent = 'App List';
    updateSEO({
      title: 'App List | RipeStore',
      description: 'Discover and sideload alternative iOS apps from community repositories on RipeStore.',
      keywords: 'iOS, App Store, RipeStore, alternative apps, sideloading',
      url: window.location.href
    });
    return;
  }
  
  if (type === 'news') {
    $('#list-title').textContent = 'Latest News';
    updateSEO({
      title: 'Latest News | RipeStore',
      description: 'Stay updated with the latest iOS app releases, announcements, sideloading updates, and news on RipeStore.',
      keywords: 'iOS news, app updates, sideloading news, RipeStore news, iOS releases, AltStore news, Scarlet news',
      url: window.location.href
    });
  } else if (type === 'featured') {
    $('#list-title').textContent = 'Featured Apps';
    updateSEO({
      title: 'Featured Apps | RipeStore',
      description: 'Discover top recommended and featured sideloadable iOS apps curated from your repositories on RipeStore.',
      keywords: 'featured iOS apps, recommended apps, iOS sideloading, IPA download, RipeStore',
      url: window.location.href
    });
  } else {
    const formatted = type.charAt(0).toUpperCase() + type.slice(1);
    $('#list-title').textContent = formatted;
    updateSEO({
      title: `${formatted} | RipeStore`,
      description: `Browse ${formatted.toLowerCase()} apps and updates on RipeStore.`,
      keywords: `${formatted.toLowerCase()}, iOS apps, sideloading, RipeStore`,
      url: window.location.href
    });
  }
  
  const splashStatus = $('#splash-status');
  const splash = $('#splash');

  let initialized = false;
  let showTimeout = setTimeout(() => {
    if (!initialized) finishLoading();
  }, 4000);

  const finishLoading = () => {
    if (initialized) return;
    initialized = true;
    clearTimeout(showTimeout);
    removeSplash();
  };

  await streamRepos(
    (data) => {
      if (data.currentRepo && splashStatus) {
        splashStatus.textContent = `Loading ${data.currentRepo}...`;
      }
      
      if (data.apps && type === 'featured') {
        renderFeatured(data.apps, data.featured);
      } else if (data.news && type === 'news') {
        renderNews(data.news, data.apps);
      }

      if (data.progress === 1) {
          if ((type === 'featured' && (!data.featured || data.featured.length === 0)) ||
              (type === 'news' && (!data.news || data.news.length === 0))) {
            const sources = getSources();
            if (sources.length === 0) {
              renderError($('main'), 'No Sources Added', 'You haven\'t added any app sources yet. Add a repository to discover apps.', { text: 'Manage Sources', href: 'sources.html' });
            } else {
              renderError($('main'), 'List Empty', `No ${type} items were found in your sources.`, { text: 'Go Back Home', href: './' });
            }
          }
          finishLoading();
      }
    },
    () => {
      finishLoading();
    }
  );
}

function renderFeatured(apps, ids) {
  const grid = $('#list-grid');
  grid.innerHTML = '';
  
  if (!ids.length) {
    grid.innerHTML = 'No featured apps found.';
    return;
  }
  
  const uniqueFeatured = [];
  const seenFeatured = new Set();
  ids.forEach(f => {
    const key = typeof f === 'string' ? f : `${f.id}|${f.source}`;
    if (!seenFeatured.has(key)) {
      seenFeatured.add(key);
      uniqueFeatured.push(f);
    }
  });

  const featuredApps = uniqueFeatured.map(f => {
    if (typeof f === 'string') return apps.find(a => a.bundle === f);
    return apps.find(a => a.bundle === f.id && a.source === f.source);
  }).filter(Boolean);

  if (!featuredApps.length) {
    grid.innerHTML = 'No featured apps found.';
    return;
  }

  // Update social sharing image with first featured app icon if present
  const firstApp = featuredApps.find(a => a.icon);
  if (firstApp) {
    const fullIcon = cdnify(firstApp.icon);
    updateMeta('og:image', fullIcon);
    updateMeta('twitter:image', fullIcon);
  }

  featuredApps.forEach(a => {
    grid.appendChild(buildAppCard(a));
  });
}

function renderNews(news, allApps = []) {
  const grid = $('#list-grid');
  grid.innerHTML = '';
  
  if (!news.length) {
    grid.innerHTML = 'No news found.';
    return;
  }
  
  news.sort((a, b) => {
    const da = parseDateString(a.date);
    const db = parseDateString(b.date);
    return (da && db) ? db - da : 0;
  });

  const seenBundles = new Set();
  const filteredNews = news.filter(n => {
    if (n.appID) {
      if (seenBundles.has(n.appID)) return false;
      seenBundles.add(n.appID);
    }
    return true;
  });

  // Update social preview image with first available news image
  const firstNewsWithImage = filteredNews.find(n => n.image);
  if (firstNewsWithImage) {
    const fullImg = cdnify(firstNewsWithImage.image);
    updateMeta('og:image', fullImg);
    updateMeta('twitter:image', fullImg);
  }

  // Use a different grid layout for news? Or just stack them.
  // We can reuse .news-card but remove the fixed width/flex
  // We need a wrapper to make them full width or grid
  
  filteredNews.forEach(n => {
    const card = document.createElement('div');
    card.className = 'news-card list-view';
    
    card.onclick = () => {
      if (n.appID) {
        const app = allApps.find(a => a.bundle === n.appID);
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
    caption.textContent = n.caption;
    
    content.appendChild(title);
    content.appendChild(caption);
    card.appendChild(content);
    
    grid.appendChild(card);
  });
}

loadList();

