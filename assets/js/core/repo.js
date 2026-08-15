import { fetchJSON, semverCompare, parseDateString, db, hashString, cdnify } from './utils.js';
import { getSources } from './sources.js';
import { DEFAULTS as CFG } from './config.js';

const CACHE_PREFIX = 'repo_cache_';
const NORM_PREFIX = 'norm_cache_';
const CACHE_DURATION = CFG.CACHE_DURATION;
const MASTER_CACHE_KEY = CFG.MASTER_CACHE_KEY;

/**
 * Fetches and merges all configured repositories.
 */
export async function fetchAllRepos() {
  const sources = getSources();
  const now = Date.now();
  
  // 1. Try master cache
  let master = await db.get(MASTER_CACHE_KEY);
  if (master && (now - (master.timestamp || 0)) < CACHE_DURATION && JSON.stringify(master.sources) === JSON.stringify(sources)) {
    return master.data;
  }

  // 2. Fetch all and check for changes
  const results = await Promise.allSettled(sources.map(src => fetchRepo(src)));
  let anyChanged = !master || JSON.stringify(master.sources) !== JSON.stringify(sources);
  
  const allApps = [];
  let allNews = [];
  let featuredIds = [];

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    const src = sources[i];
    if (res.status === 'fulfilled') {
      const { data, url, changed } = res.value;
      
      // Get normalized data (from cache if not changed)
      let normalized = await db.get(NORM_PREFIX + src);
      if (!normalized || changed) {
        normalized = normalizeRepo(data, url);
        await db.set(NORM_PREFIX + src, normalized);
        anyChanged = true;
      }
      
      if (normalized.news) allNews = allNews.concat(normalized.news);
      if (normalized.featured) featuredIds = featuredIds.concat(normalized.featured);
      allApps.push(...normalized.apps);
    }
  }

  // 3. If nothing changed, just refresh master timestamp
  if (!anyChanged && master) {
    master.timestamp = now;
    await db.set(MASTER_CACHE_KEY, master);
    return master.data;
  }

  // 4. Something changed, re-merge
  const mergedApps = mergeByBundle(allApps);
  const appBundles = new Set(mergedApps.map(a => a.bundle));
  const seenNews = new Set();
  const uniqueNews = [];
  allNews.forEach(n => {
    if (n.appID && !appBundles.has(n.appID)) return;
    let sig = n.identifier || `${n.appID || n.title || 'unknown'}|${n.date || 'nodate'}`;
    if (!seenNews.has(sig)) {
      seenNews.add(sig);
      uniqueNews.push(n);
    }
  });

  const finalData = { apps: mergedApps, news: uniqueNews, featured: featuredIds };
  await db.set(MASTER_CACHE_KEY, { sources, data: finalData, timestamp: now });
  return finalData;
}

/**
 * Streams repository data as it loads.
 */
export async function streamRepos(onUpdate, onComplete) {
  try {
    const sources = getSources();
    if (!sources || sources.length === 0) {
      onUpdate({ apps: [], news: [], featured: [], progress: 1 });
      if (onComplete) onComplete();
      return;
    }
    
    const now = Date.now();
    
    let master = await db.get(MASTER_CACHE_KEY);
    if (master && (now - (master.timestamp || 0)) < CACHE_DURATION && JSON.stringify(master.sources) === JSON.stringify(sources)) {
      onUpdate({ ...master.data, progress: 1 });
      if (onComplete) onComplete();
      return;
    }

    let allApps = [];
    let allNews = [];
    let featuredIds = [];
    let loadedCount = 0;
    let anyChanged = !master || JSON.stringify(master?.sources) !== JSON.stringify(sources);

    let lastUpdateTime = 0;
    const UPDATE_THROTTLE = 500; 

    const handleResult = async (res, src, isFinal = false) => {
      loadedCount++;
      if (res.status === 'fulfilled') {
        const { data, url, changed } = res.value;
        
        let normalized = await db.get(NORM_PREFIX + src);
        if (!normalized || changed) {
          normalized = normalizeRepo(data, url);
          await db.set(NORM_PREFIX + src, normalized);
          anyChanged = true;
        }
        
        if (normalized.news) allNews = allNews.concat(normalized.news);
        if (normalized.featured) featuredIds = featuredIds.concat(normalized.featured);
        allApps.push(...normalized.apps);

        const now = Date.now();
        if (isFinal || (now - lastUpdateTime > UPDATE_THROTTLE)) {
            lastUpdateTime = now;
            
            const mergedApps = mergeByBundle(allApps);
            const appBundles = new Set(mergedApps.map(a => a.bundle));
            const seenNews = new Set();
            const uniqueNews = [];
            allNews.forEach(n => {
              if (n.appID && !appBundles.has(n.appID)) return;
              let sig = n.identifier || `${n.appID || n.title || 'unknown'}|${n.date || 'nodate'}`;
              if (!seenNews.has(sig)) {
                seenNews.add(sig);
                uniqueNews.push(n);
              }
            });

            const updateData = {
              apps: mergedApps,
              news: uniqueNews,
              featured: featuredIds,
              progress: (loadedCount / sources.length),
              currentRepo: normalized.repoName || src
            };

            if (isFinal) {
                const finalData = { apps: mergedApps, news: uniqueNews, featured: featuredIds };
                await db.set(MASTER_CACHE_KEY, { sources, data: finalData, timestamp: Date.now() });
            }

            onUpdate(updateData);
        } else {
            onUpdate({ progress: (loadedCount / sources.length), currentRepo: normalized.repoName || src });
        }
      } else {
          onUpdate({ progress: (loadedCount / sources.length) });
      }
    };

    const CHUNK_SIZE = 8;
    for (let i = 0; i < sources.length; i += CHUNK_SIZE) {
      const chunk = sources.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(chunk.map(src => fetchRepo(src)));
      for (let j = 0; j < results.length; j++) {
          const isFinal = (i + j + 1) === sources.length;
          await handleResult(results[j], chunk[j], isFinal);
      }
    }

    if (onComplete) onComplete();
  } catch (err) {
    console.error('streamRepos error', err);
    if (onComplete) onComplete();
  }
}

/**
 * Fetches a repository JSON and checks for changes using content hashing.
 */
export async function fetchRepo(src, force = false) {
  const cacheKey = CACHE_PREFIX + src;
  const now = Date.now();
  const cached = await db.get(cacheKey);

  if (!force && cached && (now - (cached.timestamp || 0)) < CACHE_DURATION) {
    return { ...cached.data, changed: false };
  }

  const url = src.includes('://') ? src : `${CFG.INTERNAL_REPO_BASE}${src}.json`;
  
  let text = null;

  // 1. Try original URL directly
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Fetch failed ${response.status}`);
    text = await response.text();
  } catch (directErr) {
    // 2. If direct fetch fails and it's a GitHub raw URL, try jsDelivr CDN fallback
    const cdnUrl = cdnify(url);
    if (cdnUrl !== url) {
      try {
        const cdnResp = await fetch(cdnUrl, { cache: 'no-cache' });
        if (!cdnResp.ok) throw new Error(`CDN fallback failed ${cdnResp.status}`);
        text = await cdnResp.text();
      } catch (cdnErr) {
        if (cached) return { ...cached.data, changed: false };
        throw directErr;
      }
    } else {
      if (cached) return { ...cached.data, changed: false };
      throw directErr;
    }
  }

  try {
    const hash = hashString(text);

    if (cached && cached.hash === hash && !force) {
      cached.timestamp = now;
      await db.set(cacheKey, cached);
      return { ...cached.data, changed: false };
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (!m) throw new Error("Invalid JSON payload");
      data = JSON.parse(m[0]);
    }

    const result = { data, url };
    await db.set(cacheKey, { timestamp: now, hash, data: result });
    
    return { ...result, changed: true };
  } catch (err) {
    if (cached) return { ...cached.data, changed: false };
    throw err;
  }
}

/**
 * Normalizes repository data.
 */
export function normalizeRepo(data, sourceUrl) {
  const apps = [];
  const news = [];
  const featured = [];
  const repoName = data.name || null;

  const push = (o) => {
    if (o && (o.bundleIdentifier || o.bundleID || o.bundle || o.id)) {
      if (o.marketplaceID && typeof o.marketplaceID === 'string' && o.marketplaceID.trim() !== "") return;
      apps.push(toUnified(o, sourceUrl, repoName));
    }
  };

  if (Array.isArray(data)) {
    data.forEach(push);
  } else if (data && Array.isArray(data.apps)) { // AltStore-like
    data.apps.forEach(push);
    if (Array.isArray(data.news)) {
      data.news.forEach(n => {
        news.push({
          title: n.title,
          caption: n.caption,
          date: n.date,
          image: cdnify(n.imageURL),
          url: n.url,
          appID: n.appID,
          identifier: n.identifier,
          notify: n.notify,
          source: sourceUrl,
          tintColor: n.tintColor,
          repoName: repoName
        });
      });
    }
    if (Array.isArray(data.featuredApps)) {
       data.featuredApps.forEach(id => featured.push({ id, source: sourceUrl }));
    }
  } else if (data && typeof data === 'object') { // Scarlet-like
    Object.keys(data).forEach(k => {
      if (/^(meta|info|news)$/i.test(k)) return;
      const v = data[k];
      if (Array.isArray(v)) v.forEach(o => push({ ...o, category: o.category || k }));
    });
  }
  
  return { apps, news, featured, repoName };
}

function parseScreenshots(val) {
  const result = { iphone: [], ipad: [] };
  if (!val) return result;
  const add = (dest, item) => {
    if (typeof item === 'string') dest.push(cdnify(item));
    else if (item && item.url) dest.push(cdnify(item.url));
  };
  if (Array.isArray(val)) {
    val.forEach(v => add(result.iphone, v));
  } else if (typeof val === 'object') {
    if (val.iphone && Array.isArray(val.iphone)) val.iphone.forEach(v => add(result.iphone, v));
    if (val.ipad && Array.isArray(val.ipad)) val.ipad.forEach(v => add(result.ipad, v));
  }
  return result;
}

function parsePermissions(val) {
  if (!val) return null;
  const privacy = (val && typeof val === 'object' && !Array.isArray(val) && val.privacy) ? val.privacy : val;
  if (!privacy) return null;

  const perms = [];
  if (Array.isArray(privacy)) {
    if (privacy.length === 0) return null;
    privacy.forEach(p => {
      if (p && p.name) perms.push({ name: p.name, text: p.usageDescription || p.description || "" });
    });
  } else if (privacy && typeof privacy === 'object') {
    const entries = Object.entries(privacy);
    if (entries.length === 0) return null;
    entries.forEach(([k, v]) => {
      if (typeof v === 'string') perms.push({ name: k, text: v });
    });
  }
  return perms.length > 0 ? perms : null;
}

function parseEntitlements(val) {
  if (!val) return null;
  const data = (val && typeof val === 'object' && !Array.isArray(val) && val.entitlements) ? val.entitlements : val;
  if (!data) return null;

  const ents = [];
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    data.forEach(e => {
      if (typeof e === 'string') ents.push({ name: e, text: "" });
      else if (e && e.name) ents.push({ name: e.name, text: e.usageDescription || e.description || "" });
    });
  } else if (data && typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) return null;
    entries.forEach(([k, v]) => {
      ents.push({ name: k, text: typeof v === 'string' ? v : "" });
    });
  }
  return ents.length > 0 ? ents : null;
}

function toUnified(o, sourceUrl, repoName) {
  const bundle = (o.bundleIdentifier || o.bundleID || o.bundle || o.id || "").trim();
  const icon = cdnify(o.iconURL || o.icon || o.image || "");
  let name = o.name || o.title || bundle || "Unknown";
  if (!name || name.trim() === "") name = "Unknown";
  if (bundle.endsWith("Beta")) name += " (BETA)";
  const dev = o.developerName || o.dev || o.developer || "";
  const desc = o.localizedDescription || o.description || o.subtitle || "";
  const subtitle = o.subtitle || "";
  const category = o.category || "";
  const tintColor = o.tintColor || null;
  const size = o.size || null;
  const minOS = o.minOSVersion || null;
  
  const screenshots = parseScreenshots(o.screenshots || o.screenshotURLs);
  const appPerms = o.appPermissions || o.permissions;
  const permissions = parsePermissions(appPerms);
  const entitlements = parseEntitlements(o.entitlements);

  let versions = [];
  if (Array.isArray(o.versions) && o.versions.length) {
    versions = o.versions.map(v => ({
      version: v.version || v.build || v.tag || "",
      date: v.fullDate || v.versionDate || v.date || v.published || "",
      notes: v.localizedDescription || v.changelog || v.notes || "",
      url: v.downloadURL || v.down || v.url || v.ipa || v.download || "",
      size: v.size || null,
      minOS: v.minOSVersion || null,
      source: sourceUrl,
      repoName: repoName
    })).filter(v => v.url);
  }
  if (!versions.length) {
    const url = o.downloadURL || o.down || o.url || o.ipa || o.download || "";
    const version = o.version || o.latest || "";
    if (url) versions = [{
      version,
      date: "",
      notes: "",
      url,
      size: size,
      minOS: minOS,
      source: sourceUrl,
      repoName: repoName
    }];
  }
  const currentVersion = (versions[0] && versions[0].version) || o.version || o.latest || "";
  const currentDescription = subtitle || o.localizedDescription || o.description || "";

  return {
    name, bundle, icon, dev, desc, subtitle, category,
    tintColor, size, minOS, screenshots, permissions, entitlements, versions,
    source: sourceUrl,
    repoName,
    currentVersion,
    currentDescription,
    allIcons: icon ? [icon] : []
  };
}

/**
 * Merges apps from different sources by their bundle ID.
 */
export function mergeByBundle(apps) {
  const bundles = new Map();
  const noBundleApps = [];

  for (const a of apps) {
    if (!a.bundle) {
      noBundleApps.push(a);
      continue;
    }

    if (!bundles.has(a.bundle)) {
      bundles.set(a.bundle, new Map());
    }

    const sourceMap = bundles.get(a.bundle);
    
    // Treat multiple instances of a same bundleid in the same repo as same app
    if (!sourceMap.has(a.source)) {
      const newEntry = { ...a, versions: [...(a.versions || [])] };
      if (!newEntry.allIcons) newEntry.allIcons = newEntry.icon ? [newEntry.icon] : [];
      sourceMap.set(a.source, newEntry);
    } else {
      const existing = sourceMap.get(a.source);
      if (a.versions && a.versions.length) {
         existing.versions.push(...a.versions);
      }
      if (a.icon && !existing.allIcons.includes(a.icon)) {
         existing.allIcons.push(a.icon);
      }
    }
  }

  // Second pass: Cross-bucket inheritance for icons/screenshots within the same bundle ID
  for (const sourceMap of bundles.values()) {
    const buckets = Array.from(sourceMap.values());
    if (buckets.length > 1) {
      // Find best icon and screenshots among all buckets for this bundle
      let bestIcon = null;
      let bestScreenshots = null;
      const combinedIcons = new Set();
      
      for (const b of buckets) {
        if (!bestIcon && b.icon) bestIcon = b.icon;
        if (!bestScreenshots && (b.screenshots?.iphone?.length || b.screenshots?.ipad?.length)) {
          bestScreenshots = b.screenshots;
        }
        if (b.allIcons) b.allIcons.forEach(i => combinedIcons.add(i));
      }
      
      const sharedIcons = [...combinedIcons];
      
      if (bestIcon || bestScreenshots || sharedIcons.length > 0) {
        for (const b of buckets) {
          if (!b.icon) b.icon = bestIcon;
          if (!b.screenshots || !(b.screenshots.iphone?.length || b.screenshots.ipad?.length)) {
            b.screenshots = bestScreenshots;
          }
          // Merge all icons from same bundle ID for fallbacks
          b.allIcons = sharedIcons;
        }
      }
    }
  }

  const result = [...noBundleApps];
  for (const sourceMap of bundles.values()) {
    result.push(...sourceMap.values());
  }

  for (const v of result) {
    if (Array.isArray(v.versions)) {
      v.versions.sort((x, y) => {
        // Prioritize semantic versioning first
        const sv = semverCompare(y.version, x.version);
        if (sv !== 0) return sv;
        
        // Fallback to date if versions are identical
        const dx = parseDateString(x.date);
        const dy = parseDateString(y.date);
        if (dx && dy) return dy - dx;
        if (dx) return -1;
        if (dy) return 1;
        return 0;
      });
      
      // Deduplicate versions by version string to avoid identical dropdown items
      const uniqueVers = [];
      const seenVers = new Set();
      for (const ver of v.versions) {
         const k = ver.version + ver.url;
         if (!seenVers.has(k)) {
            seenVers.add(k);
            uniqueVers.push(ver);
         }
      }
      v.versions = uniqueVers;
      
      if (v.versions.length > 0) {
        v.currentVersion = v.versions[0].version;
      }
    }
  }
  return result;
}