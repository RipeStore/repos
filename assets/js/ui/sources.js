import { $, fetchJSON, showToast, setupModal, cdnify } from '../core/utils.js';
import { fetchRepo } from '../core/repo.js';
import { getSources, setSources, getOrigins, setOrigins, addSource as coreAddSource, removeSource } from '../core/sources.js';
import { removeSplash } from './components.js';
import { DEFAULTS as CFG } from '../core/config.js';

const SUGGESTIONS_URL = CFG.SUGGESTIONS_URL;

let allSuggestions = [];

let selected = null;

function render() {
  const box = $('#sourceList');
  if (!box) return;
  
  const sources = getSources();
  
  // If box is empty, do a full render. 
  // Otherwise, we just want to update states if we're just selecting.
  if (box.children.length !== sources.length) {
    box.innerHTML = '';
    sources.forEach(url => {
      const row = document.createElement('div');
      row.className = 'info-row clickable';
      row.dataset.url = url;
      
      const val = document.createElement('div');
      val.className = 'val break-all';
      
      row.appendChild(val);
      updateRowContent(row, url);

      row.onclick = async (e) => {
          e.stopPropagation();
          const url = row.dataset.url;
          if (selected === url) {
              await removeSource(url);
              selected = null;
              render(); // Full render on removal is fine
              return;
          }
          
          // Deselect old
          const old = box.querySelector(`[data-url="${selected}"]`);
          selected = url;
          if (old) updateRowContent(old, old.dataset.url);
          
          // Select new
          updateRowContent(row, url);
      };
      
      box.appendChild(row);
    });
  } else {
    // Just refresh contents to reflect selection
    Array.from(box.children).forEach(row => {
        updateRowContent(row, row.dataset.url);
    });
  }

  renderSuggestions();
}

function updateRowContent(row, url) {
    const val = row.querySelector('.val');
    if (!val) return;

    const renderState = (name) => {
        if (selected === url) {
            val.classList.add('accent');
            val.innerHTML = `<span class="repo-name">Tap again to remove</span><br><span class="url-sublabel">${name ? name + ' - ' : ''}${url}</span>`;
        } else {
            val.classList.remove('accent');
            if (name) {
                val.innerHTML = `<span class="repo-name">${name}</span><br><span class="url-sublabel">${url}</span>`;
            } else {
                val.innerHTML = `<span class="repo-name" style="visibility:hidden">Unknown</span><br><span class="url-sublabel">${url}</span>`;
            }
        }
    };

    // Show loading or cached name
    if (!val.innerHTML.includes('<br>')) {
        renderState('');
    }
    
    fetchRepo(url).then(res => {
        const name = (res && res.data && res.data.name) ? res.data.name : '';
        renderState(name);
    }).catch(() => {
        if (selected !== url) val.classList.add('accent');
        renderState('');
    });
}

function renderSuggestions() {
  const list = getSources();
  
  // Add RipeStore to suggestions if not installed
  const suggestions = [...allSuggestions];
  if (!list.includes(CFG.SOURCE_NAME) && !suggestions.some(s => s.name === CFG.SOURCE_NAME)) {
      suggestions.unshift({ name: CFG.SOURCE_NAME, url: CFG.SOURCE_URL });
  }

  const available = suggestions.filter(r => !list.includes(r.name));
  available.sort((a, b) => a.name.localeCompare(b.name));

  const section = $('#suggestedSection');
  const container = $('#suggestedList');

  if (!section || !container) return;

  if (available.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  container.innerHTML = '';

  available.forEach(r => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.textContent = r.name;
    chip.onclick = () => addSourceWrapper(r.name, 'suggested');
    
    container.appendChild(chip);
  });
}

async function addSourceWrapper(v, type = 'manual') {
  if (await coreAddSource(v, type)) {
    render();
  }
}

async function initSuggestions() {
  try {
    let data = null;
    try {
      data = await fetchJSON(SUGGESTIONS_URL + '?t=' + Date.now());
    } catch (directErr) {
      const cdnUrl = cdnify(SUGGESTIONS_URL);
      if (cdnUrl !== SUGGESTIONS_URL) {
        data = await fetchJSON(cdnUrl);
      } else {
        throw directErr;
      }
    }

    if (Array.isArray(data)) {
      allSuggestions = data;
      
      // Auto-removal logic for 'suggested' sources that are no longer in the list
      const list = getSources();
      const origins = getOrigins();
      const suggestionNames = new Set(data.map(d => d.name));
      suggestionNames.add(CFG.SOURCE_NAME); // Protect RipeStore

      let changed = false;
      const newList = list.filter(src => {
        if (origins[src] === 'suggested' && !suggestionNames.has(src)) {
            delete origins[src];
            changed = true;
            return false;
        }
        return true;
      });

      if (changed) {
          await setSources(newList);
          setOrigins(origins);
          render();
      }

      renderSuggestions();
    }
  } catch (e) {
    console.warn('Failed to load suggestions', e);
  }
}

$('#addBtn').addEventListener('click', () => {
  const input = $('#newSource');
  addSourceWrapper(input.value);
  input.value = '';
  selected = null;
});

$('#newSource').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addSourceWrapper(e.target.value);
    e.target.value = '';
    selected = null;
  }
});

const updateBtn = $('#updateBtn');
if (updateBtn) {
  updateBtn.addEventListener('click', async () => {
    const originalText = updateBtn.textContent;
    updateBtn.textContent = 'Updating...';
    updateBtn.disabled = true;
    updateBtn.classList.add('disabled-btn');
    
    const list = getSources();
    await Promise.allSettled(list.map(url => fetchRepo(url, true)));
    
    render();
    
    updateBtn.textContent = originalText;
    updateBtn.disabled = false;
    updateBtn.classList.remove('disabled-btn');
  });
}

document.addEventListener('click', () => {
  if (selected) {
    selected = null;
    render();
  }
});

render();
initSuggestions();

removeSplash();

// --- Export / Import Logic ---

function resolveSourcesToUrls() {
  const list = getSources();
  const suggestions = [...allSuggestions];
  if (!suggestions.some(s => s.name === CFG.SOURCE_NAME)) {
    suggestions.push({ name: CFG.SOURCE_NAME, url: CFG.SOURCE_URL });
  }

  return list.map(src => {
    if (src.includes('://')) return src;
    const found = suggestions.find(s => s.name === src);
    if (found) return found.url;
    // Fallback to internal structure
    return `${CFG.INTERNAL_REPO_BASE}${src}.json`;
  });
}

function processImport(text) {
  if (!text) return;
  text = text.trim();
  
  // Try Base64 Decode
  try {
    const decoded = atob(text);
    // basic check if it looks like a url list or just junk
    if (decoded.includes('http') || decoded.includes('.')) {
      text = decoded;
    }
  } catch (e) {
    // Not base64, proceed as raw text
  }
  
  const lines = text.split(/[\n\r\s,]+/);
  let count = 0;
  lines.forEach(line => {
    line = line.trim();
    if (line && (line.startsWith('http') || line.indexOf('.') > 0)) {
       if (coreAddSource(line, 'manual')) count++;
    }
  });
  
  if (count > 0) {
    showToast(`Imported ${count} new source(s).`);
    render();
  } else {
    showToast('No valid new sources found.');
  }
}

// Export
const exportMenuBtn = $('#exportMenuBtn');
const importMenuBtn = $('#importMenuBtn');
const ioModal = $('#io-modal');
const ioTitle = $('#io-title');
const ioList = $('#io-list');
const closeIo = $('#close-io');
const importFileInput = $('#importFileInput');

setupModal(ioModal, closeIo);

function showIoOption(label, onClick) {
    const item = document.createElement('div');
    item.className = 'list-menu-item clickable';
    item.textContent = label;
    item.onclick = () => {
        ioModal.classList.remove('flex');
        onClick();
    };
    ioList.appendChild(item);
}

if (exportMenuBtn) {
  exportMenuBtn.onclick = () => {
      ioTitle.textContent = 'Export Sources';
      ioList.innerHTML = '';
      
      showIoOption('Save to File', () => {
        const list = resolveSourcesToUrls();
        const blob = new Blob([list.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ripestore-sources.txt';
        a.click();
        URL.revokeObjectURL(url);
      });
      
      showIoOption('Copy to Clipboard', async () => {
        const list = resolveSourcesToUrls();
        try {
            await navigator.clipboard.writeText(list.join('\n'));
            showToast('Copied to clipboard!');
        } catch(e) {
            showToast('Failed to copy: ' + e.message);
        }
      });
      
      ioModal.classList.add('flex');
  };
}

if (importMenuBtn) {
  importMenuBtn.onclick = () => {
      ioTitle.textContent = 'Import Sources';
      ioList.innerHTML = '';
      
      showIoOption('Import from File', () => {
          importFileInput.click();
      });
      
      showIoOption('Paste from Clipboard', async () => {
        try {
            const text = await navigator.clipboard.readText();
            processImport(text);
        } catch (e) {
            showToast('Failed to read clipboard: ' + e.message);
        }
      });
      
      ioModal.classList.add('flex');
  };
}

if (importFileInput) {
  importFileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => processImport(ev.target.result);
    reader.readAsText(file);
    importFileInput.value = ''; // reset
  };
}
