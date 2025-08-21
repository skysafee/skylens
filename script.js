// =========================
// Skylens - script.js (grid layout, fixed lightbox ordering, slide + zoom transitions)
// Added: zoom/pan feature (double-tap, wheel, pointer pan, clamp, frame)
// =========================

/* CONFIG */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwsuhmmfT051Lb8AW2l_tPBBoizhuiLA4rjRbpzWalT7fjjw3DsKowKjcWffmYwrWaO/exec';
const INITIAL_LOAD_COUNT = 8;
const LOAD_MORE_COUNT = 16;
const noteLoading = {};

/* STATE */
let CURRENT_USER = localStorage.getItem('CURRENT_USER') || null;
let SKYSAFE_TOKEN = localStorage.getItem('skySafeeToken') || null; // exact name preserved
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

/* ZOOM state */
let IS_ZOOMED = false;
const ZOOM = {
  active: false,
  zoom: 1,
  min: 1,
  max: 4,
  frameEl: null,
  imgClone: null,
  frameW: 0,
  frameH: 0,
  imageW: 0,
  imageH: 0,
  startX: 0,
  startY: 0,
  startLeft: 0,
  startTop: 0,
  pointerId: null,
  lastTap: 0,
  lastTapX: 0,
  lastTapY: 0
};

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

/* Robust Apps Script caller */
async function callAppsScript(payload) {
  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    if (!text) throw new Error('Empty response from server');
    let data;
    try { data = JSON.parse(text); } catch (err) {
      console.error('callAppsScript parse error', text);
      throw new Error('Unexpected server response (non-JSON). See console.');
    }
    if (data && data.success === false && /unauthoriz/i.test(String(data.message || ''))) {
      forceLogoutLocal('Session expired — please sign in again');
      throw new Error('Unauthorized');
    }
    return data;
  } catch (err) {
    console.error('callAppsScript error', err);
    if (err instanceof TypeError || /failed to fetch/i.test(String(err.message))) {
      throw new Error('Could not connect to Skylens servers');
    }
    throw err;
  }
}

/* UI disable/enable — avoid disabling file-picker label */
function setAllButtonsDisabled(disabled) {
  const selector = 'button, input[type="button"], input[type="submit"], .fab-option, .icon-btn, .link, .control, label';
  const nodes = document.querySelectorAll(selector);
  for (const el of nodes) {
    try {
      if (disabled) {
        if (el.tagName === 'LABEL' && el.getAttribute('for') === 'imageInput') continue;
      }
      if ('disabled' in el) el.disabled = !!disabled;
      if (disabled) {
        el.classList.add('disabled');
        el.setAttribute('aria-disabled', 'true');
        if (!(el.tagName === 'LABEL' && el.getAttribute('for') === 'imageInput')) el.style.pointerEvents = 'none';
        el.style.opacity = '0.6';
        el.style.cursor = 'not-allowed';
      } else {
        el.classList.remove('disabled');
        el.removeAttribute('aria-disabled');
        el.style.pointerEvents = '';
        el.style.opacity = '';
        el.style.cursor = '';
      }
    } catch (e) {}
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
  } else imgObserver = null;
}

/* Create gallery tile */
function createGalleryItem(obj) {
  if (!obj || !obj.url) return null;
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

  div.addEventListener('click', () => {
    const fid = div.dataset.fileid;
    if (fid) openLightboxByFileId(fid, div);
  });
  div.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const fid = div.dataset.fileid; if (fid) openLightboxByFileId(fid, div); } });
  div.tabIndex = 0;
  return div;
}

/* Render gallery incrementally */
function renderGallery() {
  const container = document.getElementById('gallery');
  if (!container) return;

  const existingMap = new Map();
  container.querySelectorAll('.gallery-item').forEach(el => {
    const fid = el.dataset.fileid;
    if (fid) existingMap.set(String(fid), el);
  });

  const frag = document.createDocumentFragment();
  for (const obj of IMAGE_URLS) {
    if (!obj || !obj.fileId) continue;
    const fid = String(obj.fileId);
    if (existingMap.has(fid)) {
      frag.appendChild(existingMap.get(fid));
      existingMap.delete(fid);
    } else {
      const node = createGalleryItem(obj);
      if (node) frag.appendChild(node);
    }
  }

  for (const [oldFid, oldEl] of existingMap) {
    if (oldEl && oldEl.parentNode) oldEl.parentNode.removeChild(oldEl);
  }

  container.replaceChildren();
  container.appendChild(frag);
}

/* Load paginated images */
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

    const images = Array.isArray(res.images) ? res.images : [];
    const newImages = [];
    for (const img of images) {
      const fid = String(img.fileId || '');
      if (!fid) continue;
      if (SEEN_FILEIDS.has(fid)) continue;
      SEEN_FILEIDS.add(fid);
      newImages.push(img);
    }

    IMAGE_URLS = IMAGE_URLS.concat(newImages);
    renderGallery();

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

/* Upload flow */
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
        placeholder.remove();
        const newImage = { date: (new Date()).toISOString(), url: res.url || '', fileId: res.fileId || '', note: '' };
        if (newImage.fileId && !SEEN_FILEIDS.has(newImage.fileId)) {
          SEEN_FILEIDS.add(newImage.fileId);
          IMAGE_URLS.unshift(newImage);
          renderGallery();
        } else {
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
  div.dataset.uploadPlaceholder = '1';
  const sk = document.createElement('div');
  sk.className = 'skeleton';
  div.appendChild(sk);
  return div;
}

/* Resolve current index robustly (keeps navigation safe) */
function resolveCurrentIndex() {
  if (typeof CURRENT_INDEX === 'number' && CURRENT_INDEX >= 0 && CURRENT_INDEX < IMAGE_URLS.length) return CURRENT_INDEX;
  const wrap = document.querySelector('.lightbox-image-wrap');
  const img = wrap?.querySelector('.lightbox-image');
  const fid = img?.dataset?.fileid;
  if (fid) {
    const idx = IMAGE_URLS.findIndex(i => String(i.fileId) === String(fid));
    if (idx !== -1) { CURRENT_INDEX = idx; return idx; }
  }
  const src = img?.src;
  if (src) {
    const idx2 = IMAGE_URLS.findIndex(i => (i.url || '') === src || (i.url && src && src.indexOf(i.url) !== -1));
    if (idx2 !== -1) { CURRENT_INDEX = idx2; return idx2; }
  }
  return -1;
}

/* ---------- ZOOM/PAN UTILITIES ---------- */

function computeFrameSizeFor(imgEl) {
  // Compute a centered frame size that preserves image aspect ratio and is clamped to viewport
  const nw = imgEl.naturalWidth || imgEl.width || 800;
  const nh = imgEl.naturalHeight || imgEl.height || 600;
  const maxW = Math.max(200, window.innerWidth - 48);           // leave margins so not full-screen
  const maxH = Math.max(200, window.innerHeight - 180);         // leave top controls/spacing
  const aspect = nw / nh;
  let w, h;
  if (aspect >= (maxW / maxH)) {
    w = maxW;
    h = Math.round(w / aspect);
  } else {
    h = maxH;
    w = Math.round(h * aspect);
  }
  return { frameW: Math.round(w), frameH: Math.round(h), naturalW: nw, naturalH: nh };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function enableZoomOnCurrentImage(centerX = null, centerY = null, initialZoom = 2) {
  if (IS_ZOOMED) return;
  const wrap = document.querySelector('.lightbox-image-wrap');
  const img = wrap?.querySelector('.lightbox-image');
  if (!wrap || !img) return;

  const dims = computeFrameSizeFor(img);
  const { frameW, frameH, naturalW, naturalH } = dims;

  // Cleanup previous state if any
  disableZoom();

  // Build frame & clone (clone is visual only; pointer events go to frame)
  const frame = document.createElement('div');
  frame.className = 'zoom-frame';
  frame.style.width = frameW + 'px';
  frame.style.height = frameH + 'px';

  const clone = img.cloneNode(true);
  clone.removeAttribute('id');
  clone.className = 'zoom-image-clone';
  clone.draggable = false;
  clone.style.position = 'absolute';
  clone.style.userSelect = 'none';
  clone.style.pointerEvents = 'none'; // do not receive pointer events

  const fitScale = Math.min(frameW / naturalW, frameH / naturalH);
  const zoom = clamp(initialZoom || 2, ZOOM.min, ZOOM.max);
  const displayScale = fitScale * zoom;
  const imageW = Math.round(naturalW * displayScale);
  const imageH = Math.round(naturalH * displayScale);

  clone.style.width = imageW + 'px';
  clone.style.height = imageH + 'px';
  const initialLeft = Math.round((frameW - imageW) / 2);
  const initialTop = Math.round((frameH - imageH) / 2);
  clone.style.left = initialLeft + 'px';
  clone.style.top = initialTop + 'px';

  frame.appendChild(clone);
  const container = document.createElement('div');
  container.className = 'zoom-frame-container';
  container.style.pointerEvents = 'none';
  container.appendChild(frame);
  img.style.visibility = 'hidden';
  wrap.appendChild(container);

  // Save state
  ZOOM.frameEl = frame;
  ZOOM.imgClone = clone;
  ZOOM.frameW = frameW;
  ZOOM.frameH = frameH;
  ZOOM.imageW = imageW;
  ZOOM.imageH = imageH;
  ZOOM.zoom = zoom;
  ZOOM.min = 1;
  ZOOM.max = 4;
  ZOOM.active = true;
  IS_ZOOMED = true;
  const lb = document.getElementById('lightbox'); if (lb) lb.classList.add('zoom-active');

  /* ---------- Handlers (all attached to FRAME) ---------- */
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    ZOOM.pointerId = e.pointerId;
    try { frame.setPointerCapture(ZOOM.pointerId); } catch (err) {}
    ZOOM.startX = e.clientX; ZOOM.startY = e.clientY;
    ZOOM.startLeft = parseFloat(clone.style.left) || 0;
    ZOOM.startTop = parseFloat(clone.style.top) || 0;
  };

  const onPointerMove = (e) => {
    if (!ZOOM.pointerId || e.pointerId !== ZOOM.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - ZOOM.startX;
    const dy = e.clientY - ZOOM.startY;
    let newLeft = ZOOM.startLeft + dx;
    let newTop = ZOOM.startTop + dy;
    const minLeft = Math.min(ZOOM.frameW - ZOOM.imageW, 0);
    const maxLeft = 0;
    const minTop = Math.min(ZOOM.frameH - ZOOM.imageH, 0);
    const maxTop = 0;
    newLeft = clamp(newLeft, minLeft, maxLeft);
    newTop = clamp(newTop, minTop, maxTop);
    clone.style.left = newLeft + 'px';
    clone.style.top = newTop + 'px';
  };

  const onPointerUp = (e) => {
    if (ZOOM.pointerId && e.pointerId === ZOOM.pointerId) {
      try { frame.releasePointerCapture(ZOOM.pointerId); } catch (err) {}
      ZOOM.pointerId = null;
    }
  };

  const onWheel = (e) => {
    if (!ZOOM.active) return;
    e.preventDefault();
    const rect = frame.getBoundingClientRect();
    const px = clamp(e.clientX - rect.left, 0, rect.width);
    const py = clamp(e.clientY - rect.top, 0, rect.height);
    const oldZoom = ZOOM.zoom;
    const factor = Math.exp(-e.deltaY * 0.0012);
    let newZoom = clamp(oldZoom * factor, ZOOM.min, ZOOM.max);

    // if zoom returns back to ~1, treat as unzoom
    if (newZoom <= 1.001) { disableZoom(); return; }

    const ratio = newZoom / oldZoom;
    const newImageW = Math.round(ZOOM.imageW * ratio);
    const newImageH = Math.round(ZOOM.imageH * ratio);
    const curLeft = parseFloat(clone.style.left) || 0;
    const curTop = parseFloat(clone.style.top) || 0;
    const imagePointX = px - curLeft;
    const imagePointY = py - curTop;
    const newLeft = px - (imagePointX * ratio);
    const newTop = py - (imagePointY * ratio);

    ZOOM.zoom = newZoom; ZOOM.imageW = newImageW; ZOOM.imageH = newImageH;
    clone.style.width = newImageW + 'px'; clone.style.height = newImageH + 'px';

    const minLeft = Math.min(ZOOM.frameW - ZOOM.imageW, 0);
    const maxLeft = 0;
    const minTop = Math.min(ZOOM.frameH - ZOOM.imageH, 0);
    const maxTop = 0;
    clone.style.left = clamp(newLeft, minLeft, maxLeft) + 'px';
    clone.style.top = clamp(newTop, minTop, maxTop) + 'px';
  };

  // --- Robust double-tap detection on pointerup (touch) ---
  // Use pointerup so it doesn't race with pointer capture; keep time+pos local to frame
  let _lastTapTime = 0;
  let _lastTapX = 0;
  let _lastTapY = 0;
  const onPointerUpDoubleTap = (ev) => {
    if (ev.pointerType !== 'touch') return;
    const now = Date.now();
    const dx = Math.abs(ev.clientX - _lastTapX);
    const dy = Math.abs(ev.clientY - _lastTapY);
    const dist = Math.sqrt((dx*dx)+(dy*dy));
    if (now - _lastTapTime < 350 && dist < 30) {
      // double-tap detected -> always unzoom when currently zoomed
      disableZoom();
      _lastTapTime = 0; _lastTapX = 0; _lastTapY = 0;
      return;
    }
    _lastTapTime = now; _lastTapX = ev.clientX; _lastTapY = ev.clientY;
  };

  // attach to frame (consistent add/remove)
  frame.addEventListener('pointerdown', onPointerDown);
  frame.addEventListener('pointermove', onPointerMove);
  frame.addEventListener('pointerup', onPointerUp);
  frame.addEventListener('pointercancel', onPointerUp);
  frame.addEventListener('wheel', onWheel, { passive: false });
  frame.addEventListener('pointerup', onPointerUpDoubleTap);

  // store handlers for cleanup
  frame._zoomHandlers = { onPointerDown, onPointerMove, onPointerUp, onWheel, onPointerUpDoubleTap };

  // Slight focus nudge for accessibility
  setTimeout(() => { try { (frame.querySelector('img') || frame).focus(); } catch (e) {} }, 30);
}

function disableZoom() {
  if (!IS_ZOOMED && !ZOOM.active) return;
  try {
    const wrap = document.querySelector('.lightbox-image-wrap');
    const img = wrap?.querySelector('.lightbox-image');
    if (img) img.style.visibility = ''; // restore original

    if (ZOOM.frameEl) {
      const frame = ZOOM.frameEl;
      if (frame._zoomHandlers) {
        try { frame.removeEventListener('pointerdown', frame._zoomHandlers.onPointerDown); } catch(e){}
        try { frame.removeEventListener('pointermove', frame._zoomHandlers.onPointerMove); } catch(e){}
        try { frame.removeEventListener('pointerup', frame._zoomHandlers.onPointerUp); } catch(e){}
        try { frame.removeEventListener('pointercancel', frame._zoomHandlers.onPointerUp); } catch(e){}
        try { frame.removeEventListener('wheel', frame._zoomHandlers.onWheel); } catch(e){}
        try { frame.removeEventListener('pointerup', frame._zoomHandlers.onPointerUpDoubleTap); } catch(e){}
        frame._zoomHandlers = null;
      }
      const container = frame.parentNode;
      if (container && container.parentNode) container.parentNode.removeChild(container);
    }
  } catch (e) {
    console.warn('disableZoom cleanup error', e);
  } finally {
    ZOOM.frameEl = null;
    ZOOM.imgClone = null;
    ZOOM.frameW = 0; ZOOM.frameH = 0; ZOOM.imageW = 0; ZOOM.imageH = 0;
    ZOOM.pointerId = null;
    ZOOM.active = false;
    IS_ZOOMED = false;
    const lb = document.getElementById('lightbox'); if (lb) lb.classList.remove('zoom-active');
  }
}


/* ---------- LIGHTBOX: open/close (modified to integrate zoom) ---------- */

function openLightbox(index, sourceEl) {
  if (typeof index !== 'number' || index < 0 || index >= IMAGE_URLS.length) return;
  CURRENT_INDEX = index;
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  document.getElementById('gallery')?.classList.add('gallery-dimmed');

  lb.classList.remove('hidden');
  const actions = lb.querySelector('.lightbox-actions');
  if (actions) {
    actions.style.position = 'relative';
    actions.style.zIndex = '1360';
    actions.style.pointerEvents = 'auto';
  }
  requestAnimationFrame(() => lb.classList.add('visible'));
  showImageAtIndex(index, { sourceEl, openZoom: !!sourceEl });
}

function openLightboxByFileId(fileId, sourceEl) {
  const idx = IMAGE_URLS.findIndex(i => String(i.fileId || '') === String(fileId || ''));
  if (idx === -1) {
    if (!loading.gallery && HAS_MORE) {
      loadGallery(NEXT_START, LOAD_MORE_COUNT).then(() => {
        const newIdx = IMAGE_URLS.findIndex(i => String(i.fileId) === String(fileId || ''));
        if (newIdx !== -1) openLightbox(newIdx, sourceEl);
      }).catch(() => {});
    }
    return;
  }
  openLightbox(idx, sourceEl);
}

function closeLightbox() {
  if (lightboxAnimating) return;
  // ensure zoom disabled
  disableZoom();

  const lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.classList.remove('visible');
  document.getElementById('gallery')?.classList.remove('gallery-dimmed');

  setTimeout(() => {
    lb.classList.add('hidden');
    const wrap = document.querySelector('.lightbox-image-wrap');
    if (wrap) wrap.replaceChildren();
    CURRENT_INDEX = -1;
    if (_lightboxAnimTimer) { clearTimeout(_lightboxAnimTimer); _lightboxAnimTimer = null; lightboxAnimating = false; }
  }, 320);
}

/* showImageAtIndex — robust, per-call fallback, z-index control */
function showImageAtIndex(index, options = {}) {
  if (typeof index !== 'number' || index < 0 || index >= IMAGE_URLS.length) {
    console.warn('showImageAtIndex: invalid index', index);
    return;
  }

  const wrap = document.querySelector('.lightbox-image-wrap');
  if (!wrap) { console.warn('showImageAtIndex: missing wrapper'); return; }
  if (lightboxAnimating) { console.warn('showImageAtIndex: animation in progress, skip'); return; }

  // set CURRENT_INDEX early so navigation sees a valid value
  CURRENT_INDEX = index;

  lightboxAnimating = true;

  // per-call timer which will finalize if transitionend not fired
  let localTimer = setTimeout(() => {
    console.warn('lightbox animation timeout fallback - finalizing animation');
    // ensure we clear the global ref
    if (_lightboxAnimTimer === localTimer) _lightboxAnimTimer = null;
    // attempt to cleanup visible/in-progress states: remove any exit classes and force visible on new image
    const wrapLocal = document.querySelector('.lightbox-image-wrap');
    const newImgLocal = wrapLocal?.querySelector('.lightbox-image:not(.old)');
    const existingLocal = wrapLocal?.querySelector('img.old');
    if (newImgLocal) {
      newImgLocal.classList.add('visible');
      newImgLocal.style.opacity = '1';
    }
    if (existingLocal && existingLocal.parentNode) existingLocal.parentNode.removeChild(existingLocal);
    lightboxAnimating = false;
  }, 3500);

  // store it globally so other code can clear if needed
  _lightboxAnimTimer = localTimer;

  const item = IMAGE_URLS[index] || {};
  const url = item.url;
  const direction = options.direction || null;
  const sourceEl = options.sourceEl || null;
  const openZoom = !!options.openZoom;
  const wrapExisting = wrap.querySelector('img.lightbox-image');

  console.debug('showImageAtIndex', { index, url, direction, openZoom, existingPresent: !!wrapExisting, item });

  if (!url) {
    console.error('showImageAtIndex: missing url for', item);
    toast('Image not available');
    clearTimeout(localTimer);
    _lightboxAnimTimer = null;
    lightboxAnimating = false;
    return;
  }

  // spinner
  const spinner = document.createElement('div');
  spinner.className = 'small-spinner';
  spinner.style.margin = '10px auto';
  spinner.setAttribute('aria-hidden', 'true');

  // new image element
  const newImg = document.createElement('img');
  newImg.className = 'lightbox-image';
  newImg.alt = item.alt || 'Lightbox image';
  newImg.draggable = false;
  newImg.dataset.fileid = item.fileId ? String(item.fileId) : '';
  newImg.style.transition = 'transform .42s cubic-bezier(.2,.9,.25,1), opacity .32s ease';
  newImg.style.opacity = '0';
  newImg.style.willChange = 'transform, opacity';
  // ensure it's above existing image
  newImg.style.zIndex = '1330';
  if (wrapExisting) wrapExisting.style.zIndex = '1320';

  // finalize closure
  const finalize = () => {
    if (spinner.parentNode) spinner.remove();
    // if existing is present and not same as newImg, remove it
    const existing = wrap.querySelector('img.lightbox-image.old') || wrap.querySelector('img.lightbox-image.visible:not([data-fileid="' + newImg.dataset.fileid + '"])');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    if (localTimer) { clearTimeout(localTimer); localTimer = null; }
    if (_lightboxAnimTimer) { clearTimeout(_lightboxAnimTimer); _lightboxAnimTimer = null; }
    lightboxAnimating = false;
    CURRENT_INDEX = index;
  };

  newImg.onerror = (ev) => {
    console.error('Lightbox image failed to load', url, ev);
    if (spinner.parentNode) spinner.remove();
    if (newImg.parentNode) newImg.parentNode.removeChild(newImg);
    if (localTimer) { clearTimeout(localTimer); localTimer = null; }
    if (_lightboxAnimTimer) { clearTimeout(_lightboxAnimTimer); _lightboxAnimTimer = null; }
    lightboxAnimating = false;
    toast('Failed to load image (see console)');
  };

  const onTransitionEnd = (ev) => {
    newImg.removeEventListener('transitionend', onTransitionEnd);
    finalize();
  };
  newImg.addEventListener('transitionend', onTransitionEnd);

  newImg.onload = () => {
    // no-op; animation handles visibility; loaded image is ready for transition
  };

  // set src early so browser starts fetching
  try {
    newImg.src = url;
  } catch (errSrc) {
    console.error('Failed to set image src', errSrc, url);
    if (localTimer) { clearTimeout(localTimer); localTimer = null; }
    if (_lightboxAnimTimer) { clearTimeout(_lightboxAnimTimer); _lightboxAnimTimer = null; }
    lightboxAnimating = false;
    spinner.remove();
    return;
  }

  wrap.appendChild(spinner);

  // If there's already an image showing, mark it as old so we can remove it after
  if (wrapExisting && wrapExisting !== newImg) {
    wrapExisting.classList.remove('visible');
    wrapExisting.classList.add('old');
    // make sure old is below new
    wrapExisting.style.zIndex = '1320';
  }

  // Zoom-from-thumb (pixel-based) — wait for decode so we don't animate before the image has a size
  if (openZoom && sourceEl) {
    try {
      const startZoomAnim = () => {
        const thumbRect = sourceEl.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();

        const thumbCenterX = thumbRect.left + thumbRect.width / 2;
        const thumbCenterY = thumbRect.top + thumbRect.height / 2;
        const wrapCenterX = wrapRect.left + wrapRect.width / 2;
        const wrapCenterY = wrapRect.top + wrapRect.height / 2;
        const deltaX = thumbCenterX - wrapCenterX;
        const deltaY = thumbCenterY - wrapCenterY;

        const finalMaxWidth = Math.min(window.innerWidth - 48, wrapRect.width || (window.innerWidth - 48));
        const scale = Math.max(0.06, (thumbRect.width / Math.max(1, finalMaxWidth)));

        // lock visual layout to the final max width to avoid reflow-jumps during animation
        newImg.style.maxWidth = finalMaxWidth + 'px';
        newImg.style.transformOrigin = 'center center';
        newImg.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scale})`;
        newImg.style.opacity = '0';
        if (!newImg.parentNode) wrap.appendChild(newImg);
        // ensure start state applied
        void newImg.offsetWidth;
        requestAnimationFrame(() => {
          newImg.style.transform = 'translate(0px, 0px) scale(1)';
          newImg.style.opacity = '1';
          setTimeout(() => newImg.classList.add('visible'), 50);
        });
      };

      // If already loaded/decoded, run immediately; otherwise wait for load/decode
      if (newImg.complete && newImg.naturalWidth) {
        startZoomAnim();
      } else if (newImg.decode) {
        // modern browsers: decode returns a promise
        newImg.decode().then(startZoomAnim).catch(() => {
          // fallback to load event if decode fails
          newImg.addEventListener('load', startZoomAnim, { once: true });
          if (!newImg.parentNode) wrap.appendChild(newImg);
        });
      } else {
        newImg.addEventListener('load', startZoomAnim, { once: true });
        if (!newImg.parentNode) wrap.appendChild(newImg);
      }
      // ensure zoom is disabled (same behavior you had)
      return;
    } catch (errZoom) {
      console.warn('zoom-from-thumb fallback', errZoom);
    }
  }

  // Slide transition when existing image present (safe: wait for load before kicking the CSS transition)
  if (wrapExisting && direction) {
    // append early so load starts and spinner shows
    if (!newImg.parentNode) wrap.appendChild(newImg);

    const startSlide = () => {
      if (direction === 'left') newImg.classList.add('enter-from-right');
      else newImg.classList.add('enter-from-left');

      // ensure start state registered
      void newImg.offsetWidth;

      requestAnimationFrame(() => {
        if (direction === 'left') {
          wrapExisting.classList.add('exit-to-left');
        } else {
          wrapExisting.classList.add('exit-to-right');
        }
        // bring new in
        newImg.classList.remove('enter-from-right', 'enter-from-left');
        // make sure visible class gets added so opacity/transform go to final state
        newImg.classList.add('visible');
        attachLightboxZoomHandlers();
      });
    };

    if (newImg.complete && newImg.naturalWidth) {
      startSlide();
    } else if (newImg.decode) {
      newImg.decode().then(startSlide).catch(() => newImg.addEventListener('load', startSlide, { once: true }));
    } else {
      newImg.addEventListener('load', startSlide, { once: true });
    }
  } else {
    // fallback non-slide entrance (single image) — keep existing behavior but ensure image has decoded
    newImg.style.opacity = '0';
    if (!newImg.parentNode) wrap.appendChild(newImg);
    const startPlainEnter = () => {
      void newImg.offsetWidth;
      requestAnimationFrame(() => {
        newImg.style.transform = 'translate(0px, 0px) scale(1)';
        newImg.style.opacity = '1';
        newImg.classList.add('visible');
        attachLightboxZoomHandlers();
      });
    };
    if (newImg.complete && newImg.naturalWidth) startPlainEnter();
    else if (newImg.decode) newImg.decode().then(startPlainEnter).catch(() => newImg.addEventListener('load', startPlainEnter, { once: true }));
    else newImg.addEventListener('load', startPlainEnter, { once: true });
  }
}

/* Navigation */
async function nextImage() {
  if (lightboxAnimating) return;
  if (IS_ZOOMED) return; // navigation disabled while zoomed

  let current = resolveCurrentIndex();
  if (current === -1) return;

  if (current < IMAGE_URLS.length - 1) {
    const newIndex = current + 1;
    showImageAtIndex(newIndex, { direction: 'left' });
    return;
  }

  if (HAS_MORE && !loading.gallery) {
    const prevLen = IMAGE_URLS.length;
    await loadGallery(NEXT_START, LOAD_MORE_COUNT);
    current = resolveCurrentIndex();
    if (IMAGE_URLS.length > prevLen) {
      const newIndex = Math.min(IMAGE_URLS.length - 1, current + 1);
      if (newIndex > current) showImageAtIndex(newIndex, { direction: 'left' });
    }
  }
}

function prevImage() {
  if (lightboxAnimating) return;
  if (IS_ZOOMED) return; // navigation disabled while zoomed

  const current = resolveCurrentIndex();
  if (current === -1) return;

  if (current > 0) {
    const newIndex = current - 1;
    showImageAtIndex(newIndex, { direction: 'right' });
  }
}

/* DELETE with confirmation */
async function deleteCurrentImage() {
  if (loading.delete) return;
  const idxResolved = resolveCurrentIndex();
  if (idxResolved < 0 || !IMAGE_URLS[idxResolved]) return;
  const item = IMAGE_URLS[idxResolved];
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
      if (IMAGE_URLS.length === 0) {
        closeLightbox();
      } else {
        const newIdx = Math.max(0, Math.min(idx, IMAGE_URLS.length - 1));
        showImageAtIndex(newIdx, {});
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

/* Notes: unchanged behaviour */
async function openNoteModal(fileId) {
  if (!fileId || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  const modal = document.getElementById('noteModal');
  if (!modal) return;
  const noteView = document.getElementById('noteView');
  const noteTextarea = document.getElementById('noteTextarea');
  const editBtn = document.getElementById('noteEditBtn');
  const saveBtn = document.getElementById('noteSaveBtn');
  const spinner = document.getElementById('noteSpinner');

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

/* AUTH */
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

/* Drag overlay */
let dragCounter = 0;
function wireDragOverlay() {
  const overlay = document.getElementById('fullDropOverlay');
  if (!overlay) return;
  window.addEventListener('dragenter', (e) => {
    try {
      if (!e.dataTransfer) return;
      const types = Array.from(e.dataTransfer.types || []);
      if (!types.includes('Files')) return;
    } catch (ex) {}
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

/* Camera */
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

/* Service worker registration */
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

/* Attach lightbox-level handlers for zoom toggles (double-tap) and wheel fallback */
function attachLightboxZoomHandlers() {
  const wrap = document.querySelector('.lightbox-image-wrap');
  if (!wrap) return;

  // Prevent multiple attachments by flagging on element
  if (wrap._zoomHandlersAttached) return;
  wrap._zoomHandlersAttached = true;

  // Double-tap (pointer) detection for mobile: toggles zoom in/out
  let lastTap = 0;
  let lastX = 0, lastY = 0;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const now = Date.now();
    const dx = Math.abs(e.clientX - lastX);
    const dy = Math.abs(e.clientY - lastY);
    const dist = Math.sqrt((dx*dx)+(dy*dy));
    if (now - lastTap < 350 && dist < 30) {
      // double tap: toggle zoom
      if (!IS_ZOOMED) {
        enableZoomOnCurrentImage(e.clientX, e.clientY, 2);
      } else {
        disableZoom();
      }
      lastTap = 0;
      lastX = 0; lastY = 0;
    } else {
      lastTap = now;
      lastX = e.clientX; lastY = e.clientY;
    }
  });

// Wheel on lightbox-wrap: for desktop quick zoom-in/out
wrap.addEventListener('wheel', (e) => {
  // If an inner handler already consumed this event (e.g. the zoom frame), do nothing.
  if (e.defaultPrevented) return;
  // if zoom active, the frame already handles wheel. If not, interpret wheel as zoom trigger
  if (IS_ZOOMED) return;
  // only handle when pointer is over the image area
  e.preventDefault();
  // on wheel start, enable zoom centered at cursor and let frame handle further wheel events
  enableZoomOnCurrentImage(e.clientX, e.clientY, 1.2);
}, { passive: false });

}

/* Bind UI */
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
    const img = IMAGE_URLS[resolveCurrentIndex()];
    if (img && img.fileId) openNoteModal(img.fileId);
  });
  if (noteCloseBtn) noteCloseBtn.addEventListener('click', closeNoteModal);
  if (noteEditBtn) noteEditBtn.addEventListener('click', toggleNoteEdit);
  if (noteSaveBtn) noteSaveBtn.addEventListener('click', async () => {
    const modal = document.getElementById('noteModal');
    const fid = modal?.dataset?.fileid;
    if (fid) await saveNoteFromModal(fid);
  });

  document.querySelectorAll('.lightbox-close').forEach(b => b.addEventListener('click', closeLightbox));
  document.querySelectorAll('.lightbox-nav.prev').forEach(b => b.addEventListener('click', prevImage));
  document.querySelectorAll('.lightbox-nav.next').forEach(b => b.addEventListener('click', () => nextImage()));

  document.addEventListener('keydown', (e) => {
    const lb = document.getElementById('lightbox');
    if (!lb || lb.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      if (IS_ZOOMED) disableZoom();
      else closeLightbox();
    }
    if (e.key === 'ArrowRight') nextImage();
    if (e.key === 'ArrowLeft') prevImage();
  });

  const lb = document.getElementById('lightbox');
  const attachSwipe = (el) => {
    if (!el) return;
    try { el.style.touchAction = 'pan-y'; } catch (e) {}
    if (window.PointerEvent) {
      let pointerDown = false;
      let startX = 0, startY = 0;
      el.addEventListener('pointerdown', (e) => { startX = e.clientX; startY = e.clientY; pointerDown = true; });
      el.addEventListener('pointerup', (e) => {
        if (!pointerDown) return;
        pointerDown = false;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const absX = Math.abs(dx), absY = Math.abs(dy);
        // If zoomed we do not want swipe navigation; panning handled in zoom frame
        if (IS_ZOOMED) return;
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
        if (IS_ZOOMED) return;
        if (absX > 50 && absX > absY) { if (dx < 0) nextImage(); else prevImage(); }
      }, { passive: true });
    }
  };
  attachSwipe(lb);

  // ensure lightbox zoom handlers are attached when the lightbox wrapper is present
  attachLightboxZoomHandlers();
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
    window.location.reload(true);
  }
}

/* INIT */
window.addEventListener('DOMContentLoaded', () => {
  bindUI();
  initObserver();
  wireDragOverlay();
  updateTopbar();

  try {
    const lb = document.getElementById('lightbox');
    if (lb) lb.style.touchAction = 'pan-y';
    const wrap = document.querySelector('.lightbox-image-wrap');
    if (wrap) wrap.style.touchAction = 'none';
  } catch (e) {}

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

// ensure zoom state cleanup when navigating away or resizing
window.addEventListener('resize', () => {
  if (IS_ZOOMED) {
    // recompute frame to fit new viewport: easiest is to disable and re-enable with default zoom
    // keep it simple and safe: disable zoom (user can re-open)
    disableZoom();
  }
});





