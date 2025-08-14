// =========================
// Skylens - script.js (grid layout, fixed lightbox ordering, slide + zoom transitions)
// UPDATED: fixes for lightbox z-index, animation guard fallback, safer parsing,
// incremental gallery rendering, drag overlay checks, delete confirmation, and more.
// =========================

/* CONFIG */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwsuhmmfT051Lb8AW2l_tPBBoizhuiLA4rjRbpzWalT7fjjw3DsKowKjcWffmYwrWaO/exec';
const INITIAL_LOAD_COUNT = 8;
const LOAD_MORE_COUNT = 16;
const noteLoading = {};

/* STATE */
let CURRENT_USER = localStorage.getItem('CURRENT_USER') || null;
let SKYSAFE_TOKEN = localStorage.getItem('skySafeeToken') || null; // note: kept original name as requested
let IMAGE_URLS = []; // canonical array of images in display order (newest-first)
let CURRENT_INDEX = -1;
let CURRENT_THEME = localStorage.getItem('theme') || 'default';
let NEXT_START = 0;
let HAS_MORE = true;
const SEEN_FILEIDS = new Set();

/* Loading flags */
const loading = { gallery:false, upload:false, note:false, delete:false };

/* Camera */
let videoStream = null;
let cameraFacing = 'environment';
let cameraStarting = false;

/* Lightbox animation guard */
let lightboxAnimating = false;
let _lightboxAnimTimer = null;

/* HELPERS */
function toast(msg, timeout = 2200) {
  const t = document.getElementById('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.add('hidden'), timeout);
}

function forceLogoutLocal(reasonMsg) {
  // clear local state but do NOT reload here — caller (logoutUser) will reload if desired
  localStorage.removeItem('CURRENT_USER');
  localStorage.removeItem('skySafeeToken');
  CURRENT_USER = null; SKYSAFE_TOKEN = null;
  IMAGE_URLS = [];
  SEEN_FILEIDS.clear();
  const gallery = document.getElementById('gallery');
  if (gallery) gallery.replaceChildren();
  updateTopbar();
  document.getElementById('authSection')?.classList.remove('hidden');
  document.getElementById('gallerySection')?.classList.add('hidden');
  if (reasonMsg) toast(reasonMsg);
}

/* Robust Apps Script caller with safer parsing + improved error messaging */
async function callAppsScript(payload) {
  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    if (!text) throw new Error('Empty response from server');
    // Try parse and capture raw text on failure for debugging
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      console.error('callAppsScript: failed to parse JSON response', text);
      throw new Error('Unexpected server response (non-JSON). See console for details.');
    }
    if (data && data.success === false && /unauthoriz/i.test(String(data.message || ''))) {
      forceLogoutLocal('Session expired — please sign in again');
      throw new Error('Unauthorized');
    }
    return data;
  } catch (err) {
    console.error('callAppsScript error', err);
    if (err instanceof TypeError || /failed to fetch/i.test(String(err.message))) {
      throw new Error('Network error or CORS blocked. Check Apps Script deployment (Anyone, even anonymous).');
    }
    throw err;
  }
}

/* UI disable/enable — avoid disabling native <label for="imageInput"> used for file picker */
function setAllButtonsDisabled(disabled) {
  const selector = 'button, input[type="button"], input[type="submit"], .fab-option, .icon-btn, .link, .control, label';
  const nodes = document.querySelectorAll(selector);
  for (const el of nodes) {
    try {
      // Preserve file-picker label functionality — if this label targets the file input, don't disable it
      if (disabled) {
        if (el.tagName === 'LABEL' && el.getAttribute('for') === 'imageInput') {
          // leave it interactive so users can still open file picker
          continue;
        }
      }

      if ('disabled' in el) el.disabled = !!disabled;

      if (disabled) {
        el.classList.add('disabled');
        el.setAttribute('aria-disabled', 'true');
        // avoid globally removing pointer events for labels that need to remain interactive
        if (!(el.tagName === 'LABEL' && el.getAttribute('for') === 'imageInput')) {
          el.style.pointerEvents = 'none';
        }
        el.style.opacity = '0.6';
        el.style.cursor = 'not-allowed';
      } else {
        el.classList.remove('disabled');
        el.removeAttribute('aria-disabled');
        el.style.pointerEvents = '';
        el.style.opacity = '';
        el.style.cursor = '';
      }
    } catch (e) {
      // swallow individual element errors
    }
  }
}
function disableUI(){ setAllButtonsDisabled(true); }
function enableUI(){ setAllButtonsDisabled(false); }

/* Lazy loader */
let imgObserver = null;
function initObserver() {
  if ('IntersectionObserver' in window) {
    imgObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          const src = img.dataset.src;
          if (src) img.src = src;
          imgObserver.unobserve(img);
        }
      });
    }, { rootMargin: '200px' });
  } else {
    imgObserver = null;
  }
}

/* Create one tile (returns null for invalid objects) */
function createGalleryItem(obj) {
  if (!obj || !obj.url) return null; // skip invalid items (prevents empty placeholders)
  const div = document.createElement('div');
  div.className = 'gallery-item';
  if (obj.fileId) div.dataset.fileid = String(obj.fileId);

  const sk = document.createElement('div');
  sk.className = 'skeleton';
  div.appendChild(sk);

  const img = document.createElement('img');
  img.alt = `SkyLens image`;
  img.dataset.src = obj.url || '';
  img.loading = 'lazy';
  img.draggable = false;

  // attach handlers BEFORE assigning src (observer will assign src later)
  img.onload = () => {
    div.classList.add('loaded');
    if (sk.parentNode) sk.remove();
    img.style.opacity = '1';
  };
  img.onerror = () => {
    if (sk.parentNode) sk.remove();
    const broken = document.createElement('div');
    broken.className = 'broken';
    broken.innerHTML = `<div>Failed to load<br><button class="btn retry-btn">Retry</button></div>`;
    const btn = broken.querySelector('.retry-btn');
    btn.addEventListener('click', () => {
      if (img.dataset.src) {
        img.src = img.dataset.src + '?r=' + Date.now();
        if (imgObserver) imgObserver.observe(img);
      }
    });
    div.appendChild(broken);
  };

  div.appendChild(img);

  if (imgObserver) imgObserver.observe(img);
  else img.src = img.dataset.src;

  // pass the thumbnail element so we can animate from it
  div.addEventListener('click', (e) => {
    const fid = div.dataset.fileid;
    if (fid) openLightboxByFileId(fid, div);
  });
  div.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const fid = div.dataset.fileid; if (fid) openLightboxByFileId(fid, div); } });
  div.tabIndex = 0;

  return div;
}

/* Render gallery from canonical IMAGE_URLS array using incremental updates
   Reuses existing DOM nodes by fileId where possible to avoid full re-render churn.
*/
function renderGallery() {
  const container = document.getElementById('gallery');
  if (!container) return;

  const existingMap = new Map();
  container.querySelectorAll('.gallery-item').forEach(el => {
    const fid = el.dataset.fileid;
    if (fid) existingMap.set(String(fid), el);
  });

  const frag = document.createDocumentFragment();
  const toKeep = new Set();

  for (const obj of IMAGE_URLS) {
    // createGalleryItem can return null for invalid objects
    if (!obj || !obj.fileId) continue;
    const fid = String(obj.fileId);
    toKeep.add(fid);
    if (existingMap.has(fid)) {
      // move existing node into fragment (keeps its image/focus state)
      frag.appendChild(existingMap.get(fid));
      existingMap.delete(fid);
    } else {
      const node = createGalleryItem(obj);
      if (node) frag.appendChild(node);
    }
  }

  // Remove leftover nodes (those not present in current IMAGE_URLS)
  for (const [oldFid, oldEl] of existingMap) {
    if (oldEl && oldEl.parentNode) oldEl.parentNode.removeChild(oldEl);
  }

  // Clear and append frag (this moves nodes in-place)
  container.replaceChildren();
  container.appendChild(frag);
}

/* Load paginated images and update canonical IMAGE_URLS
   Server returns newest-first (we keep that ordering)
*/
async function loadGallery(start = 0, limit = INITIAL_LOAD_COUNT) {
  if (loading.gallery) return;
  if (!CURRENT_USER || !SKYSAFE_TOKEN) return;
  loading.gallery = true;
  try {
    disableUI();
    document.getElementById('loadingSpinner')?.classList.remove('hidden');

    const res = await callAppsScript({ action: 'getPaginatedImages', startIndex: start, limit, token: SKYSAFE_TOKEN });
    if (!res || !res.success) {
      console.warn('Unexpected gallery response', res);
      return;
    }

    // server returns images array newest-first
    const images = Array.isArray(res.images) ? res.images : [];

    // Filter duplicates and preserve order; skip items lacking fileId/url to avoid unopenable tiles
    const newImages = [];
    for (const img of images) {
      const fid = String(img.fileId || '');
      if (!fid) continue; // skip items without fileId
      if (SEEN_FILEIDS.has(fid)) continue;
      SEEN_FILEIDS.add(fid);
      newImages.push(img);
    }

    // Append older items to the end of IMAGE_URLS (we keep newest-first at start)
    IMAGE_URLS = IMAGE_URLS.concat(newImages);

    // Render incrementally (reuses existing nodes)
    renderGallery();

    // Pagination bookkeeping
    if (typeof res.nextStart !== 'undefined') {
      NEXT_START = res.nextStart;
      HAS_MORE = !!res.hasMore;
    } else {
      NEXT_START = IMAGE_URLS.length;
      HAS_MORE = images.length === limit;
    }

    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (HAS_MORE) loadMoreBtn?.classList.remove('hidden'); else loadMoreBtn?.classList.add('hidden');

  } catch (e) {
    console.error('loadGallery', e);
    toast(e.message || 'Failed to load images');
  } finally {
    loading.gallery = false;
    enableUI();
    document.getElementById('loadingSpinner')?.classList.add('hidden');
  }
}

/* Upload flow: optimistic skeleton then insert at the top (newest-first) */
async function uploadImage(file) {
  if (!file || !CURRENT_USER || !SKYSAFE_TOKEN) { toast('Not signed in'); return; }
  if (loading.upload) return;
  const allowed = ['image/jpeg','image/png','image/gif','image/webp'];
  const max = 5 * 1024 * 1024;
  if (!allowed.includes(file.type)) { toast('Unsupported file type'); return; }
  if (file.size > max) { toast('File too large (max 5MB)'); return; }

  const container = document.getElementById('gallery');
  const placeholder = makeSkeletonItem();
  if (container) container.insertBefore(placeholder, container.firstChild);

  const reader = new FileReader();
  reader.onload = async (e) => {
    loading.upload = true;
    try {
      disableUI();
      const dataUrl = e.target.result;
      const res = await callAppsScript({ action: 'uploadToDrive', dataUrl, filename: file.name, token: SKYSAFE_TOKEN });
      if (res && res.success) {
        // On success remove placeholder and add new image at top (newest-first)
        placeholder.remove();
        const newImage = { date: (new Date()).toISOString(), url: res.url || '', fileId: res.fileId || '', note: '' };
        if (newImage.fileId && !SEEN_FILEIDS.has(newImage.fileId)) {
          SEEN_FILEIDS.add(newImage.fileId);
          IMAGE_URLS.unshift(newImage);
          renderGallery();
        } else {
          // fallback: refresh a small page
          IMAGE_URLS = [];
          SEEN_FILEIDS.clear();
          document.getElementById('gallery').innerHTML = '';
          NEXT_START = 0; HAS_MORE = true;
          await loadGallery(0, INITIAL_LOAD_COUNT);
        }
        toast('Upload successful');
      } else {
        placeholder.remove();
        toast((res && res.message) ? res.message : 'Upload failed');
      }
    } catch (err) {
      placeholder.remove();
      console.error('uploadImage', err);
      toast(err.message || 'Upload failed');
    } finally {
      loading.upload = false;
      enableUI();
    }
  };
  reader.readAsDataURL(file);
}

function makeSkeletonItem() {
  const div = document.createElement('div');
  div.className = 'gallery-item';
  div.dataset.uploadPlaceholder = '1'; // mark optimistic placeholder
  const sk = document.createElement('div');
  sk.className = 'skeleton';
  div.appendChild(sk);
  return div;
}

/* LIGHTBOX — keep indices in sync with IMAGE_URLS by using canonical array */
/* openLightboxByFileId optionally accepts sourceEl (thumbnail DOM element) to animate from */
function openLightbox(index, sourceEl) {
  if (index < 0 || index >= IMAGE_URLS.length) return;
  CURRENT_INDEX = index;
  const lb = document.getElementById('lightbox');
  if (!lb) return;

  // dim gallery
  document.getElementById('gallery')?.classList.add('gallery-dimmed');

  lb.classList.remove('hidden');
  // ensure actions sit above images (JS safety-net for overlapping)
  const actions = lb.querySelector('.lightbox-actions');
  if (actions) {
    actions.style.position = 'relative';
    actions.style.zIndex = '1360';
    // ensure clickable
    actions.style.pointerEvents = 'auto';
  }

  // toggle visible state for fade-in
  requestAnimationFrame(() => lb.classList.add('visible'));

  // show image with animation (zoom from thumbnail if provided)
  showImageAtIndex(index, { sourceEl, openZoom: !!sourceEl });
}

function openLightboxByFileId(fileId, sourceEl) {
  const idx = IMAGE_URLS.findIndex(i => String(i.fileId || '') === String(fileId || ''));
  if (idx === -1) {
    // try loading more pages (do not clear current state) and attempt again once loaded
    if (!loading.gallery && HAS_MORE) {
      loadGallery(NEXT_START, LOAD_MORE_COUNT).then(() => {
        const newIdx = IMAGE_URLS.findIndex(i => String(i.fileId) === String(fileId || ''));
        if (newIdx !== -1) openLightbox(newIdx, sourceEl);
      }).catch(() => {
        // no-op
      });
    }
    return;
  }
  openLightbox(idx, sourceEl);
}

function closeLightbox() {
  if (lightboxAnimating) return; // avoid closing mid-animation
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  // remove visible classes for fade-out
  lb.classList.remove('visible');
  // remove dim on gallery
  document.getElementById('gallery')?.classList.remove('gallery-dimmed');

  // after transition remove hidden (match CSS transition duration ~280ms)
  setTimeout(() => {
    lb.classList.add('hidden');
    // clear images
    const wrap = document.querySelector('.lightbox-image-wrap');
    if (wrap) wrap.replaceChildren();
    CURRENT_INDEX = -1;
    // clear any lingering animation timer
    if (_lightboxAnimTimer) { clearTimeout(_lightboxAnimTimer); _lightboxAnimTimer = null; lightboxAnimating = false; }
  }, 320);
}

/* showImageAtIndex handles entry animations and slide transitions */
/* showImageAtIndex — updated to use flex-centered layout and translate-based animations */
function showImageAtIndex(index, options = {}) {
  if (typeof index !== 'number' || index < 0 || index >= IMAGE_URLS.length) {
    console.warn('showImageAtIndex: invalid index', index);
    return;
  }

  const wrap = document.querySelector('.lightbox-image-wrap');
  if (!wrap) { console.warn('showImageAtIndex: missing wrapper'); return; }
  if (lightboxAnimating) { console.warn('showImageAtIndex: animating, skip'); return; }

  lightboxAnimating = true;
  if (_lightboxAnimTimer) { clearTimeout(_lightboxAnimTimer); _lightboxAnimTimer = null; }
  _lightboxAnimTimer = setTimeout(() => {
    console.warn('lightbox animation timeout fallback - resetting state');
    lightboxAnimating = false;
    _lightboxAnimTimer = null;
  }, 3000);

  const item = IMAGE_URLS[index] || {};
  const url = item.url;
  const direction = options.direction || null;
  const sourceEl = options.sourceEl || null;
  const openZoom = !!options.openZoom;
  const existing = wrap.querySelector('img.lightbox-image');

  console.debug('showImageAtIndex', { index, url, direction, openZoom, existingPresent: !!existing });

  if (!url) {
    console.error('showImageAtIndex: missing url', item);
    toast('Image not available');
    if (_lightboxAnimTimer) { clearTimeout(_lightboxAnimTimer); _lightboxAnimTimer = null; }
    lightboxAnimating = false;
    return;
  }

  // small spinner to show while the image loads
  const spinner = document.createElement('div');
  spinner.className = 'small-spinner';
  spinner.style.margin = '10px auto';
  wrap.appendChild(spinner);

  // Create image element
  const newImg = document.createElement('img');
  newImg.className = 'lightbox-image';
  newImg.alt = item.alt || 'Lightbox image';
  newImg.draggable = false;
  newImg.style.opacity = '0';
  // ensure transitions are present
  newImg.style.transition = 'transform .42s cubic-bezier(.2,.9,.25,1), opacity .32s ease';

  // Transition end cleanup (common)
  const finalize = () => {
    if (spinner.parentNode) spinner.remove();
    if (existing && existing.parentNode) existing.remove();
    if (_lightboxAnimTimer) { clearTimeout(_lightboxAnimTimer); _lightboxAnimTimer = null; }
    lightboxAnimating = false;
    CURRENT_INDEX = index;
  };

  // Error handler
  newImg.onerror = (ev) => {
    console.error('Lightbox image failed to load', url, ev);
    if (spinner.parentNode) spinner.remove();
    if (newImg.parentNode) newImg.parentNode.removeChild(newImg);
    if (_lightboxAnimTimer) { clearTimeout(_lightboxAnimTimer); _lightboxAnimTimer = null; }
    lightboxAnimating = false;
    toast('Failed to load image (see console)');
  };

  // When image loads, perform the appropriate animation
  newImg.onload = () => {
    try {
      // ----- Zoom-from-thumb -----
      if (openZoom && sourceEl) {
        try {
          const thumbRect = sourceEl.getBoundingClientRect();
          const wrapRect = wrap.getBoundingClientRect();

          // compute pixel deltas: how far the thumb center is from the wrap center
          const thumbCenterX = thumbRect.left + thumbRect.width / 2;
          const thumbCenterY = thumbRect.top + thumbRect.height / 2;
          const wrapCenterX = wrapRect.left + wrapRect.width / 2;
          const wrapCenterY = wrapRect.top + wrapRect.height / 2;
          const deltaX = thumbCenterX - wrapCenterX;
          const deltaY = thumbCenterY - wrapCenterY;

          // scale estimate: thumb width to final visible width
          const finalMaxWidth = Math.min(window.innerWidth - 48, wrapRect.width || (window.innerWidth - 48));
          const scale = Math.max(0.08, (thumbRect.width / Math.max(1, finalMaxWidth)));

          // set starting transform: translate by delta px and scale down
          newImg.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scale})`;
          newImg.style.opacity = '0';
          // append and force reflow
          if (!newImg.parentNode) wrap.appendChild(newImg);
          void newImg.offsetWidth;
          // animate to center (translate to 0,0 and scale 1)
          requestAnimationFrame(() => {
            newImg.style.transform = 'translate(0px, 0px) scale(1)';
            newImg.style.opacity = '1';
          });
          // wait for transition end then finalize
          const onEndZoom = (ev) => {
            newImg.removeEventListener('transitionend', onEndZoom);
            newImg.classList.add('visible');
            finalize();
          };
          newImg.addEventListener('transitionend', onEndZoom);
          return;
        } catch (errZoom) {
          console.warn('zoom-from-thumb failed, falling back', errZoom);
        }
      }

      // ----- Slide transitions (existing) -----
      if (existing && direction) {
        // set starting transform for new image
        if (!newImg.parentNode) wrap.appendChild(newImg);
        if (direction === 'left') {
          newImg.classList.add('enter-from-right');
        } else {
          newImg.classList.add('enter-from-left');
        }
        // force reflow then animate both
        void newImg.offsetWidth;
        requestAnimationFrame(() => {
          // move old out
          if (direction === 'left') {
            existing.classList.add('exit-to-left');
          } else {
            existing.classList.add('exit-to-right');
          }
          existing.classList.remove('visible');

          // bring new in
          newImg.classList.remove('enter-from-right', 'enter-from-left');
          newImg.classList.add('visible');

          const onEndSlide = (ev) => {
            newImg.removeEventListener('transitionend', onEndSlide);
            finalize();
          };
          newImg.addEventListener('transitionend', onEndSlide);
        });
        return;
      }

      // ----- Default: simple fade-in -----
      if (!newImg.parentNode) wrap.appendChild(newImg);
      // initial tiny scale to allow smooth pop
      newImg.style.transform = 'translate(0px, 0px) scale(0.98)';
      newImg.style.opacity = '0';
      void newImg.offsetWidth;
      requestAnimationFrame(() => {
        newImg.style.transform = 'translate(0px, 0px) scale(1)';
        newImg.style.opacity = '1';
      });
      const onEndDefault = () => {
        newImg.removeEventListener('transitionend', onEndDefault);
        finalize();
      };
      newImg.addEventListener('transitionend', onEndDefault);

    } catch (err) {
      console.error('onload animation error', err);
      if (spinner.parentNode) spinner.remove();
      if (_lightboxAnimTimer) { clearTimeout(_lightboxAnimTimer); _lightboxAnimTimer = null; }
      lightboxAnimating = false;
    }
  };

  // Append the image element early so layout / transforms are predictable
  if (!newImg.parentNode) wrap.appendChild(newImg);

  // Assign src last so onload triggers consistently
  try {
    newImg.src = url;
  } catch (errSrc) {
    console.error('Failed to set image src', errSrc, url);
    if (newImg.parentNode) newImg.parentNode.removeChild(newImg);
    if (spinner.parentNode) spinner.remove();
    if (_lightboxAnimTimer) { clearTimeout(_lightboxAnimTimer); _lightboxAnimTimer = null; }
    lightboxAnimating = false;
  }

  // If cached, onload will have fired or will fire synchronously with handlers attached
}

async function nextImage() {
  if (lightboxAnimating) return;
  if (CURRENT_INDEX < IMAGE_URLS.length - 1) {
    const newIndex = CURRENT_INDEX + 1;
    showImageAtIndex(newIndex, { direction: 'left' });
    return;
  }

  // If at last loaded but server has more, load more, then advance
  if (HAS_MORE && !loading.gallery) {
    const prevLen = IMAGE_URLS.length;
    await loadGallery(NEXT_START, LOAD_MORE_COUNT);
    if (IMAGE_URLS.length > prevLen) {
      const newIndex = CURRENT_INDEX + 1;
      showImageAtIndex(newIndex, { direction: 'left' });
    }
  }
}
function prevImage() {
  if (lightboxAnimating) return;
  if (CURRENT_INDEX > 0) {
    const newIndex = CURRENT_INDEX - 1;
    showImageAtIndex(newIndex, { direction: 'right' });
  }
}

/* DELETE with confirmation */
async function deleteCurrentImage() {
  if (loading.delete) return;
  if (CURRENT_INDEX < 0 || !IMAGE_URLS[CURRENT_INDEX]) return;
  const item = IMAGE_URLS[CURRENT_INDEX];
  if (!item.fileId) return;

  const ok = window.confirm('Delete this image? This action cannot be undone.');
  if (!ok) return;

  loading.delete = true;
  try {
    disableUI();
    const res = await callAppsScript({ action: 'deleteImage', fileId: item.fileId, token: SKYSAFE_TOKEN });
    if (res && res.success) {
      const fid = String(item.fileId);
      const idx = IMAGE_URLS.findIndex(i => String(i.fileId) === fid);
      if (idx !== -1) IMAGE_URLS.splice(idx, 1);
      SEEN_FILEIDS.delete(fid);
      renderGallery();
      toast('Image deleted');
      // adjust index & close lightbox if needed
      if (IMAGE_URLS.length === 0) {
        closeLightbox();
      } else {
        CURRENT_INDEX = Math.max(0, Math.min(CURRENT_INDEX, IMAGE_URLS.length - 1));
        showImageAtIndex(CURRENT_INDEX, {}); // refresh displayed image
      }
    } else {
      toast((res && res.message) ? res.message : 'Delete failed');
    }
  } catch (e) {
    console.error('deleteCurrentImage', e);
    toast(e.message || 'Delete failed');
  } finally {
    loading.delete = false;
    enableUI();
  }
}

/* NOTES (on-demand modal) */
async function openNoteModal(fileId) {
  if (!fileId || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  const modal = document.getElementById('noteModal');
  if (!modal) return;
  const noteView = document.getElementById('noteView');
  const noteTextarea = document.getElementById('noteTextarea');
  const editBtn = document.getElementById('noteEditBtn');
  const saveBtn = document.getElementById('noteSaveBtn');
  const spinner = document.getElementById('noteSpinner');

  // store fileId on modal so save uses the correct target
  modal.dataset.fileid = String(fileId);

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  noteView.textContent = 'Loading…';
  noteView.classList.remove('hidden');
  noteTextarea.classList.add('hidden');
  editBtn.textContent = 'Edit';
  saveBtn.classList.add('hidden');
  if (spinner) spinner.classList.remove('hidden');

  if (noteLoading[fileId]) {
    // wait a little if another request is ongoing
    const waitUntil = Date.now() + 5000;
    const poll = () => {
      const idx = IMAGE_URLS.findIndex(i => String(i.fileId) === String(fileId));
      if (idx !== -1 && typeof IMAGE_URLS[idx].note !== 'undefined') {
        noteView.textContent = IMAGE_URLS[idx].note || '';
        if (spinner) spinner.classList.add('hidden');
        return;
      }
      if (Date.now() > waitUntil) { noteView.textContent = ''; if (spinner) spinner.classList.add('hidden'); return; }
      setTimeout(poll, 150);
    };
    poll();
    return;
  }

  const idx = IMAGE_URLS.findIndex(i => String(i.fileId) === String(fileId));
  if (idx !== -1 && typeof IMAGE_URLS[idx].note !== 'undefined') {
    noteView.textContent = IMAGE_URLS[idx].note || '';
    if (spinner) spinner.classList.add('hidden');
    setTimeout(() => editBtn?.focus(), 50);
    return;
  }

  noteLoading[fileId] = true;
  try {
    disableUI();
    const res = await callAppsScript({ action: 'getImageNote', fileId, token: SKYSAFE_TOKEN });
    if (res && res.success) {
      const txt = res.note || '';
      noteView.textContent = txt;
      if (idx !== -1) IMAGE_URLS[idx].note = txt;
    } else {
      noteView.textContent = '';
      if (idx !== -1) IMAGE_URLS[idx].note = '';
    }
    setTimeout(() => editBtn?.focus(), 50);
  } catch (e) {
    console.error('openNoteModal', e);
    noteView.textContent = '';
    toast(e.message || 'Failed to load note');
  } finally {
    noteLoading[fileId] = false;
    if (spinner) spinner.classList.add('hidden');
    enableUI();
  }
}

function closeNoteModal() {
  const modal = document.getElementById('noteModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  delete modal.dataset.fileid;
  const noteView = document.getElementById('noteView');
  const noteTextarea = document.getElementById('noteTextarea');
  const editBtn = document.getElementById('noteEditBtn');
  const saveBtn = document.getElementById('noteSaveBtn');
  if (noteView) noteView.classList.remove('hidden');
  if (noteTextarea) noteTextarea.classList.add('hidden');
  if (editBtn) editBtn.textContent = 'Edit';
  if (saveBtn) saveBtn.classList.add('hidden');
}
function toggleNoteEdit() {
  const modal = document.getElementById('noteModal');
  if (!modal) return;
  const fid = modal.dataset.fileid;
  const noteView = document.getElementById('noteView');
  const noteTextarea = document.getElementById('noteTextarea');
  const editBtn = document.getElementById('noteEditBtn');
  const saveBtn = document.getElementById('noteSaveBtn');

  // Use button text as state fallback but prefer modal presence/state
  if (editBtn.textContent === 'Cancel') {
    noteTextarea.classList.add('hidden');
    noteView.classList.remove('hidden');
    editBtn.textContent = 'Edit';
    saveBtn.classList.add('hidden');
    return;
  }

  const idx = IMAGE_URLS.findIndex(i => i && String(i.fileId) === String(fid));
  let currentNote = '';
  if (idx !== -1 && typeof IMAGE_URLS[idx].note !== 'undefined') currentNote = IMAGE_URLS[idx].note || '';
  noteTextarea.value = currentNote;
  noteView.classList.add('hidden');
  noteTextarea.classList.remove('hidden');
  editBtn.textContent = 'Cancel';
  saveBtn.classList.remove('hidden');
  setTimeout(() => noteTextarea.focus(), 50);
}
async function saveNoteFromModal(fileId) {
  if (!fileId || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  const noteTextarea = document.getElementById('noteTextarea');
  const newNote = (noteTextarea && noteTextarea.value) ? noteTextarea.value : '';
  try {
    disableUI();
    const res = await callAppsScript({ action: 'saveImageNote', fileId, note: newNote, token: SKYSAFE_TOKEN });
    if (res && res.success) {
      const idx = IMAGE_URLS.findIndex(i => String(i.fileId) === String(fileId));
      if (idx !== -1) IMAGE_URLS[idx].note = newNote;
      const noteView = document.getElementById('noteView');
      const noteTextareaEl = document.getElementById('noteTextarea');
      const editBtn = document.getElementById('noteEditBtn');
      const saveBtn = document.getElementById('noteSaveBtn');
      noteView.textContent = newNote;
      noteTextareaEl.classList.add('hidden');
      noteView.classList.remove('hidden');
      editBtn.textContent = 'Edit';
      saveBtn.classList.add('hidden');
      toast('Note saved');
    } else {
      toast((res && res.message) ? res.message : 'Save failed');
    }
  } catch (e) {
    console.error('saveNoteFromModal', e);
    toast(e.message || 'Save failed');
  } finally {
    enableUI();
  }
}

/* AUTH (unchanged) */
let isSignupMode = false;
function toggleSignup() {
  isSignupMode = !isSignupMode;
  const authTitle = document.getElementById('authTitle');
  const signupFields = document.getElementById('signupFields');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const signupToggleBtn = document.getElementById('signupToggleBtn');
  if (authTitle) authTitle.textContent = isSignupMode ? 'Sign Up' : 'Login';
  if (signupFields) signupFields.classList.toggle('hidden', !isSignupMode);
  if (authSubmitBtn) authSubmitBtn.textContent = isSignupMode ? 'Sign up' : 'Continue';
  if (signupToggleBtn) signupToggleBtn.textContent = isSignupMode ? 'Back to login' : 'Create account';
}
async function handleAuth() {
  const userId = (document.getElementById('username') || { value: '' }).value.trim();
  const password = (document.getElementById('password') || { value: '' }).value;
  const confirm = (document.getElementById('confirmPassword') || { value: '' }).value;

  if (!userId || !password) { toast('Fill required fields'); return; }
  if (isSignupMode && password !== confirm) { toast('Passwords do not match'); return; }

  try {
    disableUI();
    const action = isSignupMode ? 'createUser' : 'verifyLogin';
    const res = await callAppsScript({ action, userId, password });
    if (res && res.success && res.token) {
      CURRENT_USER = userId;
      SKYSAFE_TOKEN = res.token;
      localStorage.setItem('CURRENT_USER', CURRENT_USER);
      localStorage.setItem('skySafeeToken', SKYSAFE_TOKEN);
      toast(isSignupMode ? 'Signup successful' : 'Login successful');
      updateTopbar();
      document.getElementById('authSection')?.classList.add('hidden');
      document.getElementById('gallerySection')?.classList.remove('hidden');
      IMAGE_URLS = []; SEEN_FILEIDS.clear();
      document.getElementById('gallery')?.replaceChildren();
      NEXT_START = 0; HAS_MORE = true;
      await loadTheme();
      await loadGallery(0, INITIAL_LOAD_COUNT);
    } else {
      toast((res && res.message) ? res.message : 'Authentication failed');
    }
  } catch (e) {
    console.error('handleAuth', e);
    toast(e.message || 'Auth error');
  } finally { enableUI(); }
}

/* THEME */
async function loadTheme() {
  if (!CURRENT_USER) { applyTheme(CURRENT_THEME); return; }
  try {
    disableUI();
    const res = await callAppsScript({ action: 'getTheme', userId: CURRENT_USER });
    CURRENT_THEME = (res && res.theme) ? res.theme : 'default';
    localStorage.setItem('theme', CURRENT_THEME);
    applyTheme(CURRENT_THEME);
  } catch (e) {
    console.error('loadTheme', e);
    applyTheme('default');
  } finally { enableUI(); }
}
function applyTheme(name) {
  // don't clobber unrelated classes — only remove classes that start with "theme-"
  const cls = Array.from(document.body.classList);
  cls.forEach(c => { if (c && c.indexOf('theme-') === 0) document.body.classList.remove(c); });
  document.body.classList.add(`theme-${name}`);
  if (!CURRENT_USER) document.body.classList.add('no-auth');
}
async function saveTheme(theme) {
  if (!CURRENT_USER) { localStorage.setItem('theme', theme); applyTheme(theme); return; }
  try {
    disableUI();
    await callAppsScript({ action: 'saveTheme', userId: CURRENT_USER, theme });
    localStorage.setItem('theme', theme);
    applyTheme(theme);
  } catch (e) {
    console.error('saveTheme', e);
    toast('Theme save failed');
  } finally { enableUI(); }
}

/* Wire drag-drop overlay - only show for file drags */
let dragCounter = 0;
function wireDragOverlay() {
  const overlay = document.getElementById('fullDropOverlay');
  if (!overlay) return;
  window.addEventListener('dragenter', (e) => {
    try {
      if (!e.dataTransfer) return;
      const types = Array.from(e.dataTransfer.types || []);
      if (!types.includes('Files')) return;
    } catch (ex) { /* ignore and continue */ }
    e.preventDefault();
    dragCounter++;
    overlay.classList.remove('hidden');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter = Math.max(0, dragCounter - 1); if (dragCounter === 0) overlay.classList.add('hidden'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.add('hidden');
    const files = [...(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : [])];
    if (files.length) files.forEach(f => uploadImage(f));
  });
}

/* Camera functions (unchanged-ish) */
async function startCamera() {
  if (cameraStarting) return;
  cameraStarting = true;
  try {
    if (videoStream) stopCamera();
    const constraints = { video: { facingMode: cameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
    videoStream = await navigator.mediaDevices.getUserMedia(constraints);
    const v = document.getElementById('cameraPreview');
    if (v) { v.srcObject = videoStream; await v.play(); }
  } catch (e) { console.error('startCamera', e); toast('Camera access denied or not available'); } finally { cameraStarting = false; }
}
async function switchCamera() {
  cameraFacing = (cameraFacing === 'environment') ? 'user' : 'environment';
  try { if (videoStream) stopCamera(); await startCamera(); toast(cameraFacing === 'environment' ? 'Rear camera' : 'Front camera'); } catch (e) { console.error('switchCamera', e); }
}
function stopCamera() { if (!videoStream) return; videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
function capturePhoto() {
  const v = document.getElementById('cameraPreview');
  if (!v || !videoStream) { toast('Camera not ready'); return; }
  const c = document.createElement('canvas');
  c.width = v.videoWidth || 1280; c.height = v.videoHeight || 720;
  const ctx = c.getContext('2d'); ctx.drawImage(v, 0, 0, c.width, c.height);
  const flash = document.getElementById('videoFlash'); if (flash) { flash.style.opacity = '0.9'; setTimeout(() => { flash.style.opacity = '0'; }, 160); }
  c.toBlob(blob => { const file = new File([blob], `camera_${Date.now()}.png`, { type: 'image/png' }); uploadImage(file); }, 'image/png');
}

/* Service worker registration (non-invasive) */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./service-worker.js');
    console.log('SW registered', reg);
    navigator.serviceWorker.addEventListener('message', ev => {
      if (ev.data && ev.data.type === 'SKY_UPDATE') {
        console.log('SW update', ev.data);
        toast('App updated');
      }
    });
  } catch (e) {
    console.warn('SW registration failed', e);
  }
}

/* Bind UI controls and add swipe handlers */
function bindUI() {
  const loginForm = document.getElementById('loginForm');
  const signupToggleBtn = document.getElementById('signupToggleBtn');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const themeSelect = document.getElementById('themeSelect');
  const browseBtn = document.getElementById('browseBtn');
  const imageInput = document.getElementById('imageInput');
  const fabOpen = document.getElementById('fabOpen');
  const fabOptions = document.getElementById('fabOptions');
  const openCameraBtn = document.getElementById('openCameraBtn');
  const captureBtn = document.getElementById('captureBtn');
  const closeCameraBtn = document.getElementById('closeCameraBtn');
  const switchCameraBtn = document.getElementById('switchCameraBtn');
  const deleteImageBtn = document.getElementById('deleteImageBtn');
  const logoutBtn = document.getElementById('logoutButton');

  const openNoteBtn = document.getElementById('openNoteBtn');
  const noteCloseBtn = document.getElementById('noteCloseBtn');
  const noteEditBtn = document.getElementById('noteEditBtn');
  const noteSaveBtn = document.getElementById('noteSaveBtn');

  if (loginForm) loginForm.addEventListener('submit', e => { e.preventDefault(); handleAuth(); });
  if (signupToggleBtn) signupToggleBtn.addEventListener('click', toggleSignup);
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', () => loadGallery(NEXT_START, LOAD_MORE_COUNT));
  if (themeSelect) themeSelect.addEventListener('change', () => saveTheme(themeSelect.value));
  if (browseBtn && imageInput) browseBtn.addEventListener('click', e => { e.preventDefault(); imageInput.click(); });
  if (imageInput) imageInput.addEventListener('change', e => { [...e.target.files].forEach(f => uploadImage(f)); imageInput.value = ''; });
  if (fabOpen) fabOpen.addEventListener('click', () => fabOptions?.classList.toggle('hidden'));
  if (openCameraBtn) openCameraBtn.addEventListener('click', () => { document.getElementById('cameraModal')?.classList.remove('hidden'); startCamera(); fabOptions?.classList.add('hidden'); });
  if (captureBtn) captureBtn.addEventListener('click', () => capturePhoto());
  if (closeCameraBtn) closeCameraBtn.addEventListener('click', () => { stopCamera(); document.getElementById('cameraModal')?.classList.add('hidden'); });
  if (switchCameraBtn) switchCameraBtn.addEventListener('click', () => switchCamera());
  if (deleteImageBtn) deleteImageBtn.addEventListener('click', deleteCurrentImage);
  if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);

  if (openNoteBtn) openNoteBtn.addEventListener('click', () => {
    const img = IMAGE_URLS[CURRENT_INDEX];
    if (img && img.fileId) openNoteModal(img.fileId);
  });
  if (noteCloseBtn) noteCloseBtn.addEventListener('click', closeNoteModal);
  if (noteEditBtn) noteEditBtn.addEventListener('click', toggleNoteEdit);
  if (noteSaveBtn) noteSaveBtn.addEventListener('click', async () => {
    const modal = document.getElementById('noteModal');
    const fid = modal?.dataset?.fileid;
    if (fid) await saveNoteFromModal(fid);
  });

  // simple lightbox buttons
  document.querySelectorAll('.lightbox-close').forEach(b => b.addEventListener('click', closeLightbox));
  document.querySelectorAll('.lightbox-nav.prev').forEach(b => b.addEventListener('click', prevImage));
  document.querySelectorAll('.lightbox-nav.next').forEach(b => b.addEventListener('click', () => nextImage()));

  // keyboard navigation
  document.addEventListener('keydown', (e) => {
    const lb = document.getElementById('lightbox');
    if (!lb || lb.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') nextImage();
    if (e.key === 'ArrowLeft') prevImage();
  });

  // Attach swipe handlers to the lightbox container only (prevents duplicate / conflicting events)
  const lb = document.getElementById('lightbox');

  const attachSwipe = (el) => {
    if (!el) return;
    try { el.style.touchAction = 'pan-y'; } catch (e) {}

    if (window.PointerEvent) {
      let pointerDown = false;
      let startX = 0, startY = 0;

      el.addEventListener('pointerdown', (e) => {
        startX = e.clientX;
        startY = e.clientY;
        pointerDown = true;
      });

      el.addEventListener('pointerup', (e) => {
        if (!pointerDown) return;
        pointerDown = false;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const absX = Math.abs(dx), absY = Math.abs(dy);
        if (absX > 50 && absX > absY) { if (dx < 0) nextImage(); else prevImage(); }
      });

      el.addEventListener('pointercancel', () => { pointerDown = false; });
    } else {
      let tStartX = 0, tStartY = 0;
      el.addEventListener('touchstart', (e) => { const t = e.touches && e.touches[0]; if (!t) return; tStartX = t.clientX; tStartY = t.clientY; }, { passive: true });
      el.addEventListener('touchend', (e) => {
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - tStartX;
        const dy = t.clientY - tStartY;
        const absX = Math.abs(dx), absY = Math.abs(dy);
        if (absX > 50 && absX > absY) { if (dx < 0) nextImage(); else prevImage(); }
      }, { passive: true });
    }
  };
  attachSwipe(lb);
}

/* TOPBAR visibility */
function updateTopbar() {
  if (!CURRENT_USER) document.body.classList.add('no-auth'); else document.body.classList.remove('no-auth');
}

/* LOGOUT */
async function logoutUser() {
  try {
    disableUI();
    try { if (SKYSAFE_TOKEN) await callAppsScript({ action: 'logout', token: SKYSAFE_TOKEN }); } catch (e) {}
  } finally {
    forceLogoutLocal();
    enableUI();
    // single reload point
    window.location.reload(true);
  }
}

/* INIT */
window.addEventListener('DOMContentLoaded', () => {
  bindUI();
  initObserver();
  wireDragOverlay();
  updateTopbar();

  // set touch-action hints: apply to lightbox wrap/general selector (not to non-existent id)
  try {
    const lb = document.getElementById('lightbox');
    if (lb) lb.style.touchAction = 'pan-y';
    // we cannot target a single persistent .lightbox-image here because images are dynamic
    const wrap = document.querySelector('.lightbox-image-wrap');
    if (wrap) wrap.style.touchAction = 'none';
  } catch (e) {}

  // register SW (non-invasive)
  registerServiceWorker();

  if (CURRENT_USER && SKYSAFE_TOKEN) {
    document.getElementById('authSection')?.classList.add('hidden');
    document.getElementById('gallerySection')?.classList.remove('hidden');
    loadTheme().then(() => loadGallery(0, INITIAL_LOAD_COUNT));
  } else {
    document.getElementById('authSection')?.classList.remove('hidden');
    document.getElementById('gallerySection')?.classList.add('hidden');
  }
});

