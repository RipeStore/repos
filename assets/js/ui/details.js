import { $, qs, fetchJSON, formatDate, semverCompare, formatByteCount, linkify, showToast, cdnify, getProxiedImageUrl, isDdgErrorImage, fetchMapping, setupModal, observeSmartImage, PLACEHOLDER_SRC, formatAppTitleHTML, updateSEO, updateMeta } from '../core/utils.js';
import { normalizeRepo, fetchRepo } from '../core/repo.js';
import { initCarousel } from '../core/carousel.js';
import { getSources } from '../core/sources.js';
import { getDominantColor, ensureContrast } from '../core/color.js';
import { removeSplash, getSourceLabel, renderError } from './components.js';

// Preload session metadata in background for instant, zero-delay modal interactions
const sessionData = {
  privacy: fetchMapping('assets/data/privacy.json').then(pairs => {
    const fullMap = {};
    pairs.forEach(({ key, val }) => {
      if (!fullMap[val]) fullMap[val] = [];
      if (!fullMap[val].includes(key)) fullMap[val].push(key);
    });
    return fullMap;
  }).catch(e => {
    console.error('Failed to preload privacy mappings', e);
    return {};
  }),

  entitlements: fetchMapping('assets/data/entitlements.json').then(pairs => {
    const fullMap = {};
    pairs.forEach(({ key, val }) => {
      if (!fullMap[val]) fullMap[val] = [];
      if (!fullMap[val].includes(key)) fullMap[val].push(key);
    });
    return fullMap;
  }).catch(e => {
    console.error('Failed to preload entitlements mappings', e);
    return {};
  }),

  actions: fetchJSON('assets/data/actions.json').catch(e => {
    console.error('Failed to preload actions', e);
    return [];
  })
};

async function init() {
  const bundle = qs('bundle');
  const repo = qs('repo');
  const nameParam = qs('name');
  const versionParam = qs('version');
  
  if (nameParam) {
    updateSEO({
      title: `${nameParam} | RipeStore`,
      description: `Download ${nameParam} on RipeStore. Alternative iOS app store.`,
      url: window.location.href
    });
  }
  
  if (!bundle || !repo) {
    renderError($('main'), 'Missing Information', 'The link you followed is incomplete. Please try searching for the app instead.');
    removeSplash();
    return;
  }

  let app = null;

  // 1. Fast path: Fetch primary repo
  try {
    const primary = await fetchRepo(repo);
    const norm = normalizeRepo(primary.data, primary.url);
    
    // Find by bundle AND name if available, otherwise just bundle
    app = norm.apps.find(a => {
      const matchBundle = a.bundle === bundle;
      if (!nameParam) return matchBundle;
      return matchBundle && a.name.toLowerCase() === nameParam.toLowerCase();
    });
    
    if (app) {
      // Sort versions initially
      sortVersions(app);
      render(app, versionParam);
      removeSplash();
      return;
    }
  } catch (e) {
    console.error('Primary repo fetch failed', e);
    renderError($('main'), 'Connection Error', `Failed to load the repository: ${repo}. Please check your internet connection or the source URL.`);
    removeSplash();
    return;
  }

  // 2. Fallback: Search in other repos if not found in primary
  if (!app) {
    renderError($('main'), 'App Not Found', `The app with bundle ID "<strong>${bundle}</strong>" could not be found in the specified repository.`);
    removeSplash();
  }
}

function sortVersions(app) {
  if (!app.versions) return;
  const seen = new Set();
  const uniqVers = [];
  app.versions.forEach(v => {
    const k = v.version + v.url;
    if (!seen.has(k)) {
      seen.add(k);
      uniqVers.push(v);
    }
  });
  app.versions = uniqVers.sort((a, b) => semverCompare(b.version, a.version));
}

function render(app, initialVersion) {
  // Apply tint color logic
  let currentBaseAccent = app.tintColor;
  
  const updateAccent = () => {
      if (!currentBaseAccent) {
           document.documentElement.style.removeProperty('--accent');
           return;
      }
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const adjusted = ensureContrast(currentBaseAccent, isDark);
      document.documentElement.style.setProperty('--accent', adjusted);
  };
  
  window.matchMedia('(prefers-color-scheme: dark)').onchange = updateAccent;
  
  if (currentBaseAccent) {
      updateAccent();
  } else {
      document.documentElement.style.removeProperty('--accent');
      // Extract from hidden image to avoid CORS issues on display image
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.src = cdnify(app.icon);
      img.onload = async () => {
          if (isDdgErrorImage(img)) {
              img.onerror();
              return;
          }
          try {
              const col = await getDominantColor(img);
              currentBaseAccent = col;
              updateAccent();
          } catch(e) {}
      };
      let colorDdgTried = false;
      img.onerror = () => {
          if (!colorDdgTried) {
              colorDdgTried = true;
              const proxied = getProxiedImageUrl(cdnify(app.icon));
              if (proxied) {
                  img.src = proxied;
              }
          }
      };
  }

  // Hero
  const heroIcon = $('#hero-icon');
  const heroTitle = $('#hero-title');
  const heroSub = $('#hero-subtitle');
  
  const updateFavicon = (url) => {
      document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(tag => tag.href = url);
  };
  
  const all = app.allIcons || (app.icon ? [app.icon] : []);
  heroIcon.dataset.src = cdnify(app.icon);
  heroIcon.src = PLACEHOLDER_SRC;
  observeSmartImage(heroIcon);
  updateFavicon(heroIcon.dataset.src);
  heroIcon.dataset.idx = 0;
  heroIcon.dataset.ddgTried = '0';
  heroIcon.onload = () => {
      if (heroIcon.src === PLACEHOLDER_SRC) return;
      if (isDdgErrorImage(heroIcon)) {
          heroIcon.onerror();
      }
  };
  heroIcon.onerror = () => {
      if (heroIcon.src === PLACEHOLDER_SRC) return;
      const curIdx = parseInt(heroIcon.dataset.idx || '0');
      const curUrl = all[curIdx] || app.icon;

      if (heroIcon.dataset.ddgTried !== '1') {
          heroIcon.dataset.ddgTried = '1';
          const proxied = getProxiedImageUrl(curUrl ? cdnify(curUrl) : heroIcon.dataset.src);
          if (proxied) {
              heroIcon.dataset.src = proxied;
              heroIcon.src = proxied;
              updateFavicon(proxied);
              return;
          }
      }

      heroIcon.dataset.ddgTried = '0';
      let idx = curIdx + 1;
      if (idx < all.length) {
          heroIcon.dataset.idx = idx;
          const nextUrl = cdnify(all[idx]);
          heroIcon.dataset.src = nextUrl;
          heroIcon.src = nextUrl;
          updateFavicon(nextUrl);
      } else {
          heroIcon.onerror = null;
          heroIcon.onload = null;
          heroIcon.dataset.src = 'assets/img/placeholder.png';
          heroIcon.src = heroIcon.dataset.src;
          updateFavicon('assets/img/placeholder.png');
      }
  };

  heroTitle.innerHTML = formatAppTitleHTML(app.name);
  heroSub.textContent = app.subtitle || app.dev || 'Utility';
  
  // Dynamic SEO Meta Tags
  const cleanDesc = (app.subtitle || app.desc || "Download on RipeStore.").replace(/<[^>]*>?/gm, '').replace(/\\n/g, ' ').substring(0, 160);
  updateSEO({
    title: `${app.name} | RipeStore`,
    description: cleanDesc,
    url: window.location.href,
    image: app.icon ? cdnify(app.icon) : undefined,
    keywords: `${app.name}, ${app.category || 'iOS app'}, sideload, IPA download, RipeStore`
  });
  
  // Versions Dropdown
  const verSel = $('#version-select');
  const currentVal = verSel.value;
  verSel.innerHTML = '';

  app.versions.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.version;
    const dateStr = formatDate(v.date);
    opt.textContent = dateStr ? `${v.version} (${dateStr})` : v.version;
    opt.dataset.url = v.url;
    opt.dataset.notes = v.notes;
    opt.dataset.size = v.size || '';
    opt.dataset.minOS = v.minOS || '';
    opt.dataset.source = v.source || '';
    verSel.appendChild(opt);
  });
  
  // Set initial selection
  if (currentVal && Array.from(verSel.options).some(o => o.value === currentVal)) {
    verSel.value = currentVal;
  } else if (initialVersion) {
    const found = Array.from(verSel.options).find(o => o.value === initialVersion);
    if (found) verSel.value = initialVersion;
  }
  
  // Event listener (remove old one to avoid dupe if re-rendering? actually replacing innerHTML clears old option listeners, but not the select listener)
  // To avoid duplicate listeners on the select element, we can set onclick or check a flag. 
  // Easier: clone and replace, or just ensure we don't add it multiple times.
  // Since render is called multiple times, we should use a named function or check.
  if (!verSel.dataset.listening) {
    verSel.addEventListener('change', () => updateVersionUI(verSel, app));
    verSel.dataset.listening = 'true';
  }
  updateVersionUI(verSel, app); 
  
  // Description - Render immediately
  const descEl = $('#app-desc');
  descEl.innerHTML = linkify(app.desc || "No description.");
  
  // Info grid (Metadata) - Render immediately
  const devName = app.dev || 'Unknown';
  const devEl = $('#meta-provider');
  if (app.dev) {
    devEl.innerHTML = `<a href="./?q=${encodeURIComponent('provider:' + app.dev)}" class="accent" style="text-decoration:none">${devName}</a>`;
  } else {
    devEl.textContent = devName;
  }

  let cat = app.category || 'Utility';
  cat = cat.charAt(0).toUpperCase() + cat.slice(1);
  $('#meta-cat').innerHTML = `<a href="./?q=${encodeURIComponent('category:' + cat)}" class="accent" style="text-decoration:none">${cat}</a>`;
  
  const sourceName = app.repoName || getSourceLabel(app.versions[0] || { source: app.source });
  const sourceUrl = (app.versions[0] && app.versions[0].source) ? app.versions[0].source : app.source;
  $('#meta-source-name').innerHTML = `<a href="./?q=${encodeURIComponent('source:' + sourceUrl)}" class="accent" style="text-decoration:none">${sourceName}</a>`;

  // HEAVY items: Screenshots, "More" buttons calculations, Modals -> Defer
  requestAnimationFrame(() => {
     renderHeavy(app);
  });
}

function renderHeavy(app) {
  // Reset visibility
  $('#perm-section').classList.add('hidden');
  $('#ent-section').classList.add('hidden');

  // Screenshots
  const shotContainer = $('#screenshots-scroll');
  const shots = app.screenshots?.iphone?.length ? app.screenshots.iphone : (app.screenshots?.ipad || []);
  
  // Only render screenshots if not already populated to avoid flickering/resetting scroll
  if (shots.length && shotContainer.children.length === 0) {
    shotContainer.innerHTML = '';

    // Find first non-video image to determine aspect ratio
    let firstImageIdx = -1;
    for (let i = 0; i < shots.length; i++) {
        if (!getVideoId(shots[i])) {
            firstImageIdx = i;
            break;
        }
    }
    
    // If no images (only videos), default to 16:9
    if (firstImageIdx === -1) {
        shotContainer.style.setProperty('--screenshot-ratio', 16/9);
    }

    shotContainer.scrollLeft = 0; // Reset scroll position

    const renderShots = () => {
      // Aggressively disable scrolling features during DOM insertion to prevent WebKit panicking
      shotContainer.style.overflowX = 'hidden';
      shotContainer.style.scrollSnapType = 'none';
      
      const fragment = document.createDocumentFragment();

      shots.forEach((s, idx) => {
        const videoData = getVideoId(s);
        if (videoData) {
            const iframe = document.createElement('iframe');
            iframe.src = videoData.embedUrl;
            iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
            iframe.allowFullscreen = true;
            iframe.classList.add('screenshot-video');
            fragment.appendChild(iframe);
            return;
        }
      
        const img = document.createElement('img');
        img.loading = 'lazy'; 
        
        img.onload = () => {
          if ((img.naturalWidth <= 1 && img.naturalHeight <= 1) || isDdgErrorImage(img)) {
            img.onerror(true);
            return;
          }
          
          // Deep inspection for full-size transparent dummy spacers (e.g., LiveContainer)
          const probe = new Image();
          probe.crossOrigin = 'Anonymous';
          probe.onload = () => {
            try {
              const cvs = document.createElement('canvas');
              cvs.width = 1; cvs.height = 1;
              const ctx = cvs.getContext('2d', { willReadFrequently: true });
              ctx.drawImage(probe, 0, 0, 1, 1);
              // If the center pixel's alpha channel is completely 0, it's a transparent spacer
              if (ctx.getImageData(0, 0, 1, 1).data[3] === 0) {
                img.onerror(true);
              }
            } catch (e) {
              // Tainted canvas (CORS restricted repo), assume valid image to be safe
            }
          };
          probe.src = img.src;
        };
        
        img.onerror = (isSpacer = false) => {
          if (!isSpacer && !img.dataset.ddgTried) {
            img.dataset.ddgTried = 'true';
            const proxied = getProxiedImageUrl(cdnify(s));
            if (proxied) {
              img.src = proxied;
              return;
            }
          }
          img.remove();
          if (shotContainer.children.length === 0) {
            $('#screenshots-section').classList.add('hidden');
            $('#desc-heading')?.classList.remove('hidden');
          } else {
            shotContainer.dispatchEvent(new Event('scroll'));
          }
        };

        img.src = cdnify(s);
        fragment.appendChild(img);
      });
      
      // Append all items in a single synchronous DOM operation
      if (fragment.children.length > 0) {
        $('#screenshots-section').classList.remove('hidden');
        $('#desc-heading')?.classList.add('hidden');
        shotContainer.appendChild(fragment);
      }
      
      const wrapper = $('#screenshots-section .carousel-container');
      if (wrapper) initCarousel(wrapper);

      // Force browser layout recalculation
      shotContainer.offsetHeight;
      shotContainer.scrollLeft = 0;

      // Restore scrolling incrementally to bypass Safari's eager-snapping bugs
      setTimeout(() => {
        shotContainer.style.overflowX = '';
        shotContainer.scrollLeft = 0;
        
        requestAnimationFrame(() => {
          shotContainer.style.scrollSnapType = '';
          shotContainer.scrollLeft = 0;
          shotContainer.dispatchEvent(new Event('scroll'));
        });
      }, 50);
    };

    if (firstImageIdx !== -1) {
        const preImg = new Image();
        preImg.onload = () => {
             if ((preImg.naturalWidth <= 1 && preImg.naturalHeight <= 1) || isDdgErrorImage(preImg)) {
                 preImg.onerror(true);
                 return;
             }
             const ratio = preImg.naturalWidth / preImg.naturalHeight;
             shotContainer.style.setProperty('--screenshot-ratio', ratio);
             if (ratio > 1) {
                 shotContainer.classList.add('is-landscape');
             } else {
                 shotContainer.classList.add('is-portrait');
             }
             renderShots();
        };
        let preDdgTried = false;
        preImg.onerror = (isSpacer = false) => {
             if (!isSpacer && !preDdgTried) {
                 preDdgTried = true;
                 const proxied = getProxiedImageUrl(cdnify(shots[firstImageIdx]));
                 if (proxied) {
                     preImg.src = proxied;
                     return;
                 }
             }
             renderShots();
        };
        preImg.src = cdnify(shots[firstImageIdx]);
    } else {
        renderShots();
    }
  } else if (!shots.length) {
    $('#desc-heading')?.classList.remove('hidden');
  }
  
  // Handle "more" button for Description
  const descEl = $('#app-desc');
  const moreBtn = $('#desc-more-btn');
  
  // Get the height while clamped
  const clampedHeight = descEl.clientHeight;
  
  descEl.classList.remove('desc-clamped');
  descEl.classList.remove('desc-expanded');
  
  // Force layout recalculation
  void descEl.offsetHeight;
  
  // If un-clamped height is strictly larger than clamped height
  const isDescOverflowing = descEl.scrollHeight > (clampedHeight + 2);
  descEl.classList.add('desc-clamped');

  if (isDescOverflowing) {
      moreBtn.classList.remove('hidden');
      const toggleDesc = () => {
        const isClamped = descEl.classList.toggle('desc-clamped');
        descEl.classList.toggle('desc-expanded', !isClamped);
        moreBtn.textContent = isClamped ? 'more' : 'less';
      };
      moreBtn.onclick = toggleDesc;
      descEl.onclick = toggleDesc;
      descEl.style.cursor = 'pointer';
  } else {
      moreBtn.classList.add('hidden');
      descEl.onclick = null;
      descEl.style.cursor = 'default';
  }

  const formatActionUrl = (urlTemplate, ipaUrl, appData) => {
    if (!urlTemplate) return '#';
    const sourceUrl = (appData && appData.source) ? appData.source : '';
    const sourceName = (appData && (appData.repoName || getSourceLabel({ source: appData.source }))) || '';
    const appName = (appData && appData.name) || '';
    const bundleId = (appData && appData.bundle) || '';

    return urlTemplate
      .replace(/<ipaurl>|\{ipaurl\}/gi, ipaUrl || '')
      .replace(/<sourceurl>|\{sourceurl\}|<repourl>|\{repourl\}/gi, sourceUrl)
      .replace(/<sourcename>|\{sourcename\}|<reponame>|\{reponame\}/gi, sourceName)
      .replace(/<appname>|\{appname\}/gi, appName)
      .replace(/<bundle>|\{bundle\}|<bundleid>|\{bundleid\}/gi, bundleId);
  };

  // Permissions Modal Setup
  if (app.permissions && Array.isArray(app.permissions) && app.permissions.length > 0) {
    $('#perm-section').classList.remove('hidden');
    $('#perm-btn').onclick = async () => {
      $('#perm-modal').classList.add('flex');
      const list = $('#perm-list');
      try {
        const fullMap = await sessionData.privacy;
        list.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'perm-list';
        app.permissions.forEach(p => {
          const names = fullMap[p.name];
          const displayName = names ? names.join(' / ') : p.name;
          const row = document.createElement('div');
          row.className = 'perm-row';
          row.innerHTML = `<strong>${displayName}</strong>${p.text ? `<p>${p.text}</p>` : ''}`;
          container.appendChild(row);
        });
        list.appendChild(container);
      } catch (e) {
        console.error('Failed to render permissions', e);
        list.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'perm-list';
        app.permissions.forEach(p => {
          const row = document.createElement('div');
          row.className = 'perm-row';
          row.innerHTML = `<strong>${p.name}</strong>${p.text ? `<p>${p.text}</p>` : ''}`;
          container.appendChild(row);
        });
        list.appendChild(container);
      }
    };
    $('#close-perm').onclick = () => $('#perm-modal').classList.remove('flex');
  } else {
    $('#perm-section').classList.add('hidden');
  }

  // Entitlements Modal Setup
  if (app.entitlements && Array.isArray(app.entitlements) && app.entitlements.length > 0) {
    $('#ent-section').classList.remove('hidden');
    $('#ent-btn').onclick = async () => {
      $('#ent-modal').classList.add('flex');
      const list = $('#ent-list');
      try {
        const fullMap = await sessionData.entitlements;
        list.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'perm-list';
        app.entitlements.forEach(e => {
          const names = fullMap[e.name];
          const displayName = names ? names.join(' / ') : e.name;
          const row = document.createElement('div');
          row.className = 'perm-row';
          row.innerHTML = `<strong>${displayName}</strong>${e.text ? `<p>${e.text}</p>` : ''}`;
          container.appendChild(row);
        });
        list.appendChild(container);
      } catch (e) {
        console.error('Failed to render entitlements', e);
        list.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'perm-list';
        app.entitlements.forEach(e => {
          const row = document.createElement('div');
          row.className = 'perm-row';
          row.innerHTML = `<strong>${e.name}</strong>${e.text ? `<p>${e.text}</p>` : ''}`;
          container.appendChild(row);
        });
        list.appendChild(container);
      }
    };
    $('#close-ent').onclick = () => $('#ent-modal').classList.remove('flex');
  } else {
    $('#ent-section').classList.add('hidden');
  }

  // Actions Modal Setup
  const actionsBtn = $('#btn-more-actions');
  const actionsModal = $('#actions-modal');
  const actionsList = $('#actions-list');
  const closeActions = $('#close-actions');

  // Custom Actions Logic
  const getCustomActions = () => {
      try { return JSON.parse(localStorage.getItem('custom_actions')) || []; }
      catch { return []; }
  };
  const setCustomActions = (arr) => localStorage.setItem('custom_actions', JSON.stringify(arr));

  const getHiddenDefaults = () => {
      try { return JSON.parse(localStorage.getItem('hidden_default_actions')) || []; }
      catch { return []; }
  };
  const setHiddenDefaults = (arr) => localStorage.setItem('hidden_default_actions', JSON.stringify(arr));

  let cachedDefaults = null;

  const renderActionsList = async () => {
      const ipaUrl = $('#hero-get').href;
      const titleEl = $('#actions-modal-title');
      if (titleEl) titleEl.textContent = 'Alternatives';

      actionsList.className = 'modal-body p-0';
      actionsList.innerHTML = '';
      
      const listGroup = document.createElement('div');
      listGroup.className = 'actions-menu';

      // Custom Actions
      const customs = getCustomActions();
      customs.forEach(c => {
          const item = document.createElement('a');
          item.className = 'action-item';
          item.href = formatActionUrl(c.url, ipaUrl, app);
          item.onclick = () => actionsModal.classList.remove('flex');
          item.innerHTML = `
            <span>${c.title}</span>
            <svg class="action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          `;
          listGroup.appendChild(item);
      });

      // Default Actions
      try {
        if (!cachedDefaults) {
            cachedDefaults = await sessionData.actions;
        }
        const hidden = getHiddenDefaults();
        cachedDefaults.forEach(a => {
          if (hidden.includes(a.title)) return;
          const item = document.createElement('a');
          item.className = 'action-item';
          item.href = formatActionUrl(a.url, ipaUrl, app);
          item.onclick = () => actionsModal.classList.remove('flex');
          item.innerHTML = `
            <span>${a.title}</span>
            <svg class="action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          `;
          listGroup.appendChild(item);
        });
      } catch (e) {
        console.error('Failed to load actions', e);
      }

      actionsList.appendChild(listGroup);

      // Edit Button
      const editBtn = document.createElement('div');
      editBtn.className = 'action-edit-trigger';
      editBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <span>Edit Alternatives</span>
      `;
      editBtn.onclick = (e) => {
          e.stopPropagation();
          renderEditMode();
      };
      actionsList.appendChild(editBtn);
  };

  const renderEditMode = async () => {
      const titleEl = $('#actions-modal-title');
      if (titleEl) titleEl.textContent = 'Edit Alternatives';

      actionsList.className = 'modal-body';
      actionsList.innerHTML = '';
      
      const editSection = document.createElement('div');
      editSection.className = 'edit-section';

      const listContainer = document.createElement('div');
      const formContainer = document.createElement('div');
      
      editSection.appendChild(listContainer);
      editSection.appendChild(formContainer);
      actionsList.appendChild(editSection);

      // Ensure defaults are loaded
      if (!cachedDefaults) {
          try { cachedDefaults = await sessionData.actions; }
          catch { cachedDefaults = []; }
      }

      const refreshList = () => {
          listContainer.innerHTML = '';
          const customs = getCustomActions();
          const hidden = getHiddenDefaults();
          const defaults = cachedDefaults || [];
          
          const header = document.createElement('div');
          header.className = 'edit-section-header';
          header.textContent = 'Current Options';
          listContainer.appendChild(header);

          const listGroup = document.createElement('div');
          listGroup.className = 'edit-list-group';
          
          const allItems = [
              ...customs.map((c, i) => ({ ...c, type: 'custom', idx: i })),
              ...defaults.map(d => ({ ...d, type: 'default' })).filter(d => !hidden.includes(d.title))
          ];

          if (allItems.length === 0) {
              const empty = document.createElement('div');
              empty.className = 'p-16 text-center text-secondary text-small';
              empty.textContent = 'No alternatives configured.';
              listGroup.appendChild(empty);
          } else {
              allItems.forEach((item) => {
                  const row = document.createElement('div');
                  row.className = 'edit-row';
                  
                  const info = document.createElement('div');
                  info.className = 'edit-row-info';
                  
                  const title = document.createElement('div');
                  title.className = 'edit-row-title';
                  title.innerHTML = `
                    <span>${item.title}</span>
                    <span class="edit-badge ${item.type}">${item.type}</span>
                  `;
                  
                  const url = document.createElement('div');
                  url.className = 'edit-row-url';
                  url.textContent = item.url;
                  url.title = item.url;
                  
                  info.appendChild(title);
                  info.appendChild(url);
                  
                  const del = document.createElement('button');
                  del.className = 'btn-delete';
                  del.textContent = item.type === 'custom' ? 'Delete' : 'Hide';
                  del.onclick = () => {
                      if (item.type === 'custom') {
                          const current = getCustomActions();
                          current.splice(item.idx, 1);
                          setCustomActions(current);
                      } else {
                          const currentHidden = getHiddenDefaults();
                          if (!currentHidden.includes(item.title)) {
                              currentHidden.push(item.title);
                              setHiddenDefaults(currentHidden);
                          }
                      }
                      refreshList();
                  };
                  
                  row.appendChild(info);
                  row.appendChild(del);
                  listGroup.appendChild(row);
              });
          }
          listContainer.appendChild(listGroup);

          // Reset Button (if any defaults hidden)
          if (hidden.length > 0) {
              const resetBtn = document.createElement('button');
              resetBtn.className = 'reset-btn w-full mt-8';
              resetBtn.textContent = 'Reset Default Alternatives';
              resetBtn.onclick = () => {
                  setHiddenDefaults([]);
                  refreshList();
              };
              listContainer.appendChild(resetBtn);
          }
      };

      // Form Setup
      formContainer.innerHTML = `
        <div class="edit-section-header">Add Custom Alternative</div>
        <div class="list-group mb-12">
          <div class="info-row">
            <input id="new-act-title" placeholder="Name (e.g. TrollStore, AltStore, Sideloadly)" class="input-minimal">
          </div>
          <div class="info-row">
            <input id="new-act-url" placeholder="URL Scheme (e.g. apple-magnifier://<ipaurl>)" class="input-minimal">
          </div>
        </div>
        <div class="text-secondary text-tiny mb-6" style="padding-left: 4px;">Tap placeholder to insert:</div>
        <div class="placeholder-chips">
          <button type="button" class="placeholder-chip" data-val="<ipaurl>">&lt;ipaurl&gt;</button>
          <button type="button" class="placeholder-chip" data-val="<sourcename>">&lt;sourcename&gt;</button>
          <button type="button" class="placeholder-chip" data-val="<sourceurl>">&lt;sourceurl&gt;</button>
        </div>
        <button id="add-act-btn" class="btn-primary w-full mb-12">Add Alternative</button>
        <button id="done-act-btn" class="btn-secondary w-full">Done</button>
      `;

      const addBtn = formContainer.querySelector('#add-act-btn');
      const doneBtn = formContainer.querySelector('#done-act-btn');
      const titleInp = formContainer.querySelector('#new-act-title');
      const urlInp = formContainer.querySelector('#new-act-url');

      // Clickable placeholder chips
      formContainer.querySelectorAll('.placeholder-chip').forEach(chip => {
        chip.onclick = (e) => {
          e.preventDefault();
          const val = chip.dataset.val;
          const start = urlInp.selectionStart || urlInp.value.length;
          const end = urlInp.selectionEnd || urlInp.value.length;
          const current = urlInp.value;
          urlInp.value = current.substring(0, start) + val + current.substring(end);
          urlInp.focus();
          urlInp.selectionStart = urlInp.selectionEnd = start + val.length;
        };
      });

      addBtn.onclick = () => {
          const t = titleInp.value.trim();
          const u = urlInp.value.trim();
          if (t && u) {
              const current = getCustomActions();
              current.push({ title: t, url: u });
              setCustomActions(current);
              titleInp.value = '';
              urlInp.value = '';
              refreshList();
          }
      };

      doneBtn.onclick = renderActionsList;

      refreshList();
  };

  if (actionsBtn && actionsModal && !actionsBtn.dataset.setup) {
    actionsBtn.dataset.setup = 'true';
    actionsBtn.onclick = async () => {
      await renderActionsList();
      actionsModal.classList.add('flex');
    };
    
    setupModal(actionsModal, closeActions);
    setupModal($('#perm-modal'), $('#close-perm'));
    setupModal($('#ent-modal'), $('#close-ent'));
  }
  
  // Share setup
  const shareBtn = $('#btn-share');
  if (shareBtn && !shareBtn.dataset.setup) {
      shareBtn.dataset.setup = 'true';
      shareBtn.onclick = async () => {
        const verSel = $('#version-select');
        const selectedVersion = verSel.value;
        const shareUrl = new URL(window.location.href);
        if (selectedVersion) shareUrl.searchParams.set('version', selectedVersion);
        
        const shareText = `${app.name}${app.subtitle ? ' - ' + app.subtitle : ''}`;

        if (navigator.share) {
            try { await navigator.share({ title: app.name, text: shareText, url: shareUrl.toString() }); }
            catch (err) {}
        } else {
            try { await navigator.clipboard.writeText(shareUrl.toString()); showToast('Link copied to clipboard!'); }
            catch (err) {}
        }
      };
  }
}

function getVideoId(url) {
  if (!url) return null;
  // YouTube
  let m = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
  if (m) return { type: 'youtube', embedUrl: `https://www.youtube.com/embed/${m[1]}` };
  
  // Vimeo
  m = url.match(/vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^\/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)(\d+)(?:$|\/|\?)/);
  if (m) return { type: 'vimeo', embedUrl: `https://player.vimeo.com/video/${m[1]}` };
  
  // Dailymotion
  m = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
  if (m) return { type: 'dailymotion', embedUrl: `https://www.dailymotion.com/embed/video/${m[1]}` };
  
  return null;
}

function updateVersionUI(sel, app) {
  const opt = sel.options[sel.selectedIndex];
  if (!opt) return;
  
  const url = opt.dataset.url;
  const notes = opt.dataset.notes;
  const size = opt.dataset.size || app.size;
  const minOS = opt.dataset.minOS || app.minOS;
  
  $('#hero-get').href = url;
  
  const whatsNew = $('#whats-new');
  const whatsNewTitle = whatsNew.querySelector('h2');
  const whatsNewText = $('#whats-new-text');
  const whatsNewMoreBtn = $('#whats-new-more-btn');
  
  whatsNew.style.display = 'block';
  whatsNew.classList.remove('hidden');

  if (notes && notes.length > 5) {
    if (whatsNewTitle) whatsNewTitle.style.display = 'block';
    whatsNewText.style.display = 'block';
    whatsNewText.innerHTML = linkify(notes);
    
    // Reset state
    whatsNewText.classList.remove('desc-expanded');
    whatsNewText.classList.add('desc-clamped');
    whatsNewMoreBtn.textContent = 'more';
    
    // Check if expansion is needed
    requestAnimationFrame(() => {
      const whatsNewClampedHeight = whatsNewText.clientHeight;
      
      whatsNewText.classList.remove('desc-clamped');
      void whatsNewText.offsetHeight;
      
      const isOverflowing = whatsNewText.scrollHeight > (whatsNewClampedHeight + 2);
      whatsNewText.classList.add('desc-clamped');

      if (isOverflowing) {
        whatsNewMoreBtn.classList.remove('hidden');
        const toggleWhatsNew = () => {
          const isClamped = whatsNewText.classList.toggle('desc-clamped');
          whatsNewText.classList.toggle('desc-expanded', !isClamped);
          whatsNewMoreBtn.textContent = isClamped ? 'more' : 'less';
        };
        whatsNewMoreBtn.onclick = toggleWhatsNew;
        whatsNewText.onclick = toggleWhatsNew;
        whatsNewText.style.cursor = 'pointer';
      } else {
        whatsNewMoreBtn.classList.add('hidden');
        whatsNewText.onclick = null;
        whatsNewText.style.cursor = 'default';
      }
    });
  } else {
    if (whatsNewTitle) whatsNewTitle.style.display = 'none';
    whatsNewText.style.display = 'none';
    whatsNewMoreBtn.style.display = 'none';
  }

  // Update Metadata
  $('#meta-size').textContent = formatByteCount(size);
  $('#meta-min-os').textContent = minOS ? `iOS ${minOS} or later` : 'Unknown';
}

init();