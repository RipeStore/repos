import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';

marked.use({ gfm: true, breaks: true });

/**
 * Simple fast string hash.
 */
export function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

/**
 * Simple robust IndexedDB wrapper for large data storage.
 */
export const db = {
  _db: null,
  _dbPromise: null,
  _mem: new Map(),

  async _getDB() {
    if (this._db) return this._db;
    if (this._dbPromise) return this._dbPromise;

    this._dbPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._dbPromise = null;
        resolve(null);
      }, 1500);

      try {
        if (typeof indexedDB === 'undefined') {
          clearTimeout(timer);
          this._dbPromise = null;
          return resolve(null);
        }

        const req = indexedDB.open('RipeStoreDB', 1);

        req.onupgradeneeded = () => {
          try {
            if (!req.result.objectStoreNames.contains('kv')) {
              req.result.createObjectStore('kv');
            }
          } catch (e) {}
        };

        req.onsuccess = () => {
          clearTimeout(timer);
          this._db = req.result;
          this._db.onversionchange = () => {
            try { this._db.close(); } catch (_) {}
            this._db = null;
            this._dbPromise = null;
          };
          this._db.onclose = () => {
            this._db = null;
            this._dbPromise = null;
          };
          resolve(this._db);
        };

        req.onerror = () => {
          clearTimeout(timer);
          console.error("IDB Error", req.error);
          this._dbPromise = null;
          resolve(null);
        };

        req.onblocked = () => {
          clearTimeout(timer);
          this._dbPromise = null;
          resolve(null);
        };
      } catch (e) {
        clearTimeout(timer);
        console.error("IDB Open Failed", e);
        this._dbPromise = null;
        resolve(null);
      }
    });

    return this._dbPromise;
  },

  async get(k) {
    const idb = await this._getDB();
    if (!idb) return this._mem.has(k) ? this._mem.get(k) : null;
    return new Promise((resolve) => {
      try {
        const trans = idb.transaction('kv', 'readonly');
        const req = trans.objectStore('kv').get(k);
        req.onsuccess = () => resolve(req.result !== undefined ? req.result : (this._mem.has(k) ? this._mem.get(k) : null));
        req.onerror = () => resolve(this._mem.has(k) ? this._mem.get(k) : null);
        trans.onabort = () => resolve(this._mem.has(k) ? this._mem.get(k) : null);
      } catch (e) {
        resolve(this._mem.has(k) ? this._mem.get(k) : null);
      }
    });
  },

  async set(k, v) {
    this._mem.set(k, v);
    const idb = await this._getDB();
    if (!idb) return true;
    return new Promise((resolve) => {
      try {
        const trans = idb.transaction('kv', 'readwrite');
        const req = trans.objectStore('kv').put(v, k);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        trans.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async remove(k) {
    this._mem.delete(k);
    const idb = await this._getDB();
    if (!idb) return true;
    return new Promise((resolve) => {
      try {
        const trans = idb.transaction('kv', 'readwrite');
        const req = trans.objectStore('kv').delete(k);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        trans.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async clear() {
    this._mem.clear();
    const idb = await this._getDB();
    if (!idb) return true;
    return new Promise((resolve) => {
      try {
        const trans = idb.transaction('kv', 'readwrite');
        const req = trans.objectStore('kv').clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        trans.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }
};

/**
 * A shorthand for document.querySelector.
 */
export const $ = (q, el = document) => el.querySelector(q);

/**
 * A shorthand for document.querySelectorAll.
 */
export const $$ = (q, el = document) => Array.from(el.querySelectorAll(q));

/**
 * Gets a query string parameter from the URL.
 */
export function qs(k) {
  try {
    return new URLSearchParams(location.search).get(k);
  } catch (e) {
    return null;
  }
}

/**
 * Fetches and parses JSON from a URL.
 */
export async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (_) {}
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) throw new Error("Invalid JSON payload");
  return JSON.parse(m[0]);
}

/**
 * Converts URLs in text to clickable anchor tags.
 */
export function linkify(text) {
  if (!text) return "";
  
  let processed = text.replace(/(^|[\s(\[{])@([a-zA-Z0-9_-]+)/g, '$1[@$2](https://github.com/$2)');
  
  const seenEmojis = new Set();
  const emojiRegex = /((?:[\u2600-\u27BF]|[\uD800-\uDBFF][\uDC00-\uDFFF])(?:[\uFE0E\uFE0F]|[\uD83C][\uDFFB-\uDFFF])?(?:\u200D(?:[\u2600-\u27BF]|[\uD800-\uDBFF][\uDC00-\uDFFF])(?:[\uFE0E\uFE0F]|[\uD83C][\uDFFB-\uDFFF])?)*)\s*/g;
  processed = processed.replace(emojiRegex, (match, emojiCode, offset, fullStr) => {
    const normalized = emojiCode.replace(/\uFE0F/g, '');
    if (seenEmojis.has(normalized)) {
      const prev = fullStr[offset - 1];
      const next = fullStr[offset + match.length];
      if (prev && next && /\S/.test(prev) && /\S/.test(next) && !/^[.,!?;:]/.test(next)) {
        return ' ';
      }
      return '';
    }
    seenEmojis.add(normalized);
    return match;
  });
  
  processed = processed.replace(/^[\s]*[•◦▪⁃] /gm, '- ');

  processed = processed.replace(/^(\s*(?:-\s*)?)\[([^\]]{2,})\](?!\s*[(:])/gm, '$1<span class="changelog-tag">$2</span>');

  let html = marked.parse(processed);
  
  const alertRegex = /(?:<blockquote>\s*)?<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:<\/p>\s*<p>|<br>\s*|\s*)([\s\S]*?)<\/p>(?:\s*<\/blockquote>)?/gi;
  html = html.replace(alertRegex, (match, type, content) => {
    const t = type.toLowerCase();
    const title = t.charAt(0).toUpperCase() + t.slice(1);
    const icons = {
      note: '🔵', tip: '🟢', important: '🟣', warning: '🟡', caution: '🔴'
    };
    return `<div class="gh-alert gh-alert-${t}"><div class="gh-alert-title">${icons[t]} ${title}</div><div class="gh-alert-content"><p>${content}</p></div></div>`;
  });
  
  html = html.replace(/<a /g, '<a class="accent" target="_blank" rel="noopener noreferrer" ');
  
  return html;
}


export function formatAppTitleHTML(rawName) {
  if (!rawName) return "";
  const div = document.createElement('div');
  div.textContent = rawName;
  const escaped = div.innerHTML;

  const endRegex = /(\s+[-–—:]\s+|\s*[\[\(])(public beta|public alpha|closed beta|beta|alpha|rc|preview|nightly)[\]\)]*\s*$/i;
  const startRegex = /^\s*([\[\(])(public beta|public alpha|closed beta|beta|alpha|rc|preview|nightly)([\]\)]*\s+)|(public beta|public alpha|closed beta|beta|alpha|rc|preview|nightly)(\s+[-–—:]\s+)/i;

  let tag = null;
  let clean = escaped;

  const endMatch = escaped.match(endRegex);
  if (endMatch) {
    tag = endMatch[2];
    clean = escaped.replace(endRegex, '');
  } else {
    const startMatch = escaped.match(startRegex);
    if (startMatch) {
      tag = startMatch[2] || startMatch[4];
      clean = escaped.replace(startRegex, '');
    }
  }

  if (tag && clean.trim().length > 0) {
    tag = tag.toUpperCase();
    const tagClass = tag.toLowerCase().replace(/\s+/g, '-');
    return `${clean.trim()} <span class="app-tag tag-${tagClass}">${tag}</span>`;
  }
  
  return escaped;
}

/**
 * Fetches a key-value mapping from a JSON-like file.
 * Returns an array of { key, val } pairs.
 */
export async function fetchMapping(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return [];
    const text = await res.text();
    const pairs = [];
    const regex = /"([^"]+)"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
      pairs.push({ key: m[1], val: m[2] });
    }
    return pairs;
  } catch (e) {
    console.error('Failed to fetch mapping', url, e);
    return [];
  }
}

/**
 * Sets up basic modal dismissal (close button and clicking outside).
 */
export function setupModal(modal, closeBtn) {
  if (!modal) return;
  if (closeBtn) closeBtn.onclick = () => modal.classList.remove('flex');
  window.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('flex');
  });
}

/**
 * Truncates a string with an ellipsis.
 */
export function ellipsize(s, n = 120) {
  if (!s) return "";
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Parses a date string or number.
 */
export function parseDateString(s) {
  if (s === null || s === undefined) return null;
  
  // Handle numeric timestamps
  if (typeof s === 'number') {
    const date = new Date(s < 10000000000 ? s * 1000 : s);
    return isNaN(date.getTime()) ? null : date;
  }

  if (typeof s !== 'string' || s.trim() === '') return null;
  s = s.trim();

  // Try parsing purely numeric strings as timestamps
  if (/^\d{10,13}$/.test(s)) {
    const num = parseInt(s);
    const date = new Date(num < 10000000000 ? num * 1000 : num);
    if (!isNaN(date.getTime())) return date;
  }

  // Handle YYYYMMDDHHMMSS or YYYYMMDD
  const pureDigits = s.replace(/[-T:Z. ]/g, '');
  if (/^\d{8}(\d{6})?$/.test(pureDigits)) {
    const year = parseInt(pureDigits.slice(0, 4));
    const month = parseInt(pureDigits.slice(4, 6)) - 1;
    const day = parseInt(pureDigits.slice(6, 8));
    const hour = pureDigits.length === 14 ? parseInt(pureDigits.slice(8, 10)) : 0;
    const min = pureDigits.length === 14 ? parseInt(pureDigits.slice(10, 12)) : 0;
    const sec = pureDigits.length === 14 ? parseInt(pureDigits.slice(12, 14)) : 0;
    const date = new Date(Date.UTC(year, month, day, hour, min, sec));
    if (!isNaN(date.getTime())) return date;
  }

  // Standard Date.parse for ISO 8601 and other common formats
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t);

  // Fallback for browser-specific parsing
  try {
    const date = new Date(s);
    if (!isNaN(date.getTime())) return date;
  } catch (e) {}

  return null;
}

/**
 * Formats a date string or Date object.
 */
export function formatDate(s) {
  const d = (s instanceof Date) ? s : parseDateString(s);
  if (!d) return '';
  const opt = { year: 'numeric', month: 'short', day: 'numeric' };
  try {
    return d.toLocaleDateString(undefined, opt);
  } catch (e) {
    return d.toUTCString().split(' ').slice(1, 4).join(' ');
  }
}

/**
 * Compares two semantic version strings.
 */
export function semverCompare(a, b) {
  const seg = s => String(s || "").split(/[.+\-]/).map(x => isNaN(+x) ? x : +x);
  const A = seg(a), B = seg(b), n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const x = A[i], y = B[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === typeof y) {
      if (x < y) return -1;
      if (x > y) return 1;
    } else {
      return (typeof x === 'number') ? 1 : -1
    }
  }
  return 0;
}

/**
 * Formats bytes to a human-readable string.
 */
export function formatByteCount(bytes) {
  if (!bytes || isNaN(bytes)) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = parseFloat(bytes);
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds have elapsed.
 */
export function debounce(fn, ms) {
  let id;
  return (...a) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...a), ms);
  }
}

/**
 * Shows a toast notification.
 */
export function showToast(msg, duration = 2000) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

/**
 * Converts raw GitHub URLs to jsDelivr CDN URLs.
 */
export function cdnify(url) {
  if (typeof url !== 'string') return url;
  
  let cleanUrl = url.trim();
  
  // Handle github.com/.../raw/... URLs
  if (cleanUrl.toLowerCase().startsWith('https://github.com/') && cleanUrl.includes('/raw/')) {
    cleanUrl = cleanUrl.replace(/https:\/\/github\.com\//i, 'https://raw.githubusercontent.com/').replace(/\/raw\//i, '/');
  }

  if (!cleanUrl.toLowerCase().startsWith('https://raw.githubusercontent.com/')) return url;
  
  try {
    // Strip the protocol and domain
    const clean = cleanUrl.substring(cleanUrl.indexOf('raw.githubusercontent.com/') + 26);
    const parts = clean.split('/');
    if (parts.length < 3) return url;
    
    const user = parts[0];
    const repo = parts[1];
    let branch = parts[2];
    let pathParts = parts.slice(3);
    
    // Special handling for refs/heads which might appear in some raw urls constructed manually
    if (branch === 'refs' && pathParts[0] === 'heads') {
        branch = pathParts[1];
        pathParts = pathParts.slice(2);
    }
    
    // Remove query params or hashes (jsDelivr rejects these)
    let pathStr = pathParts.join('/');
    pathStr = pathStr.split('?')[0].split('#')[0];
    
    return `https://cdn.jsdelivr.net/gh/${user}/${repo}@${branch}/${pathStr}`;
  } catch (e) {
    return url;
  }
}

/**
 * Wraps an image URL with DuckDuckGo's external content proxy.
 * Used as a fallback when direct image loading fails (e.g. due to CORS or hotlinking).
 */
export function getProxiedImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('assets/') || trimmed.startsWith('/assets/') || trimmed.startsWith('./assets/')) {
    return null;
  }
  if (trimmed.includes('external-content.duckduckgo.com/iu/?u=')) {
    return null;
  }
  return `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(trimmed)}`;
}

/**
 * Checks if an image element loaded DuckDuckGo's error placeholder SVG.
 * DuckDuckGo returns an HTTP 400 SVG with dimensions 260x180 on remote fetch failure.
 */
export function isDdgErrorImage(img) {
  if (!img) return false;
  const src = img.currentSrc || img.src || (img.dataset && img.dataset.src) || '';
  if (!src.includes('external-content.duckduckgo.com/iu/')) return false;
  return (img.naturalWidth === 260 && img.naturalHeight === 180) || (img.naturalWidth === 0 && img.naturalHeight === 0);
}

// Unregister legacy Service Workers to prevent caching issues
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for(let registration of registrations) {
      registration.unregister();
    }
  });
}

/**
 * A smart image observer for iOS memory cache busting issues.
 * Manually unloads images far out of viewport and reloads them when near.
 */
let smartImgObserver = null;
export const PLACEHOLDER_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function observeSmartImage(img) {
  if (!smartImgObserver) {
    smartImgObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const target = entry.target;
        if (entry.isIntersecting) {
          if (target.src === PLACEHOLDER_SRC || !target.src || target.src === window.location.href) {
            target.src = target.dataset.src;
          }
        } else {
          // Unload when far out of view to save iOS memory limits
          if (target.src !== PLACEHOLDER_SRC) {
            target.src = PLACEHOLDER_SRC;
          }
        }
      });
    }, {
      rootMargin: '1000px' // Load when within 1000px of scrolling into view
    });
  }
  
  smartImgObserver.observe(img);
}

/**
 * Handle graceful restoration from bfcache (Back-Forward Cache).
 * Mobile browsers (especially iOS Safari) aggressively unload images from memory 
 * to save resources when navigating away. When returning via the back button, 
 * the DOM is restored but images may remain invisible. 
 * This forces unloaded images to safely re-render.
 */
const pageLoadTime = Date.now();

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    const sourcesChanged = parseInt(localStorage.getItem('ripe_sources_changed') || '0');
    if (sourcesChanged > pageLoadTime) {
      location.reload();
      return;
    }

    // Delay the image restoration check slightly.
    // iOS Safari uses a cached snapshot for the swipe-back gesture. 
    // Checking naturalWidth synchronously during the transition can cause it to return 0 erroneously, 
    // and re-assigning img.src causes a visible flicker by interrupting the snapshot.
    setTimeout(() => {
      document.querySelectorAll('img').forEach(img => {
        if (img.src && img.naturalWidth === 0) {
          img.src = img.src;
        }
      });
    }, 500);
  }
});

// Intercept back links to pop the history stack like a native app
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.back-link').forEach(link => {
    link.addEventListener('click', (e) => {
      if (document.referrer && document.referrer.includes(location.host)) {
        e.preventDefault();
        window.history.back();
      }
    });
  });
});

/**
 * Updates or creates a meta tag in document.head.
 */
export function updateMeta(name, content) {
  if (content === undefined || content === null) return;
  let el = document.querySelector(`meta[name="${name}"]`) || document.querySelector(`meta[property="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    if (name.startsWith('og:') || name.startsWith('twitter:')) {
      el.setAttribute('property', name);
    } else {
      el.setAttribute('name', name);
    }
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/**
 * Updates full page SEO meta tags and document.title.
 */
export function updateSEO({ title, description, url, image, keywords, type = 'website' } = {}) {
  if (title) {
    document.title = title;
    updateMeta('og:title', title);
    updateMeta('twitter:title', title);
  }
  if (description) {
    const cleanDesc = description.replace(/<[^>]*>?/gm, '').replace(/\\n/g, ' ').substring(0, 160).trim();
    updateMeta('description', cleanDesc);
    updateMeta('og:description', cleanDesc);
    updateMeta('twitter:description', cleanDesc);
  }
  if (url) {
    updateMeta('og:url', url);
  }
  if (image) {
    updateMeta('og:image', image);
    updateMeta('twitter:image', image);
  }
  if (keywords) {
    updateMeta('keywords', keywords);
  }
  if (type) {
    updateMeta('og:type', type);
  }
}

