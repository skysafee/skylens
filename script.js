// =========================
// Skylens - script.js (grid layout, fixed lightbox ordering, slide + zoom transitions)
// With zoom integration (double-tap mobile, wheel desktop, pan inside frame)
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
      throw new Error('Network error or CORS blocked. Check Apps Script deployment (Anyone, even anonymous).');
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

/* … existing loadGallery, uploadImage, etc. … */

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

  // per-call timer
  let localTimer = setTimeout(() => {
    const newImgLocal = wrap?.querySelector('.lightbox-image:not(.old)');
    const existingLocal = wrap?.querySelector('img.old');
    if (newImgLocal) {
      newImgLocal.classList.add('visible');
      newImgLocal.style.opacity = '1';
    }
    if (existingLocal && existingLocal.parentNode) existingLocal.parentNode.removeChild(existingLocal);
    lightboxAnimating = false;
  }, 3500);

  const item = IMAGE_URLS[index] || {};
  const url = item.url;
  const direction = options.direction || null;
  const sourceEl = options.sourceEl || null;
  const openZoom = !!options.openZoom;
  const wrapExisting = wrap.querySelector('img.lightbox-image');

  if (!url) {
    clearTimeout(localTimer);
    lightboxAnimating = false;
    toast('Image not available');
    return;
  }

  const newImg = document.createElement('img');
  newImg.className = 'lightbox-image';
  newImg.alt = item.alt || 'Lightbox image';
  newImg.draggable = false;
  newImg.dataset.fileid = item.fileId ? String(item.fileId) : '';
  newImg.style.zIndex = '1330';

  if (wrapExisting) wrapExisting.style.zIndex = '1320';

  newImg.onload = () => {};
  newImg.src = url;

  // handle transitions
  if (wrapExisting && direction) {
    if (!newImg.parentNode) wrap.appendChild(newImg);
    if (direction === 'left') newImg.classList.add('enter-from-right');
    else newImg.classList.add('enter-from-left');
    void newImg.offsetWidth;
    requestAnimationFrame(() => {
      if (direction === 'left') wrapExisting.classList.add('exit-to-left');
      else wrapExisting.classList.add('exit-to-right');
      newImg.classList.remove('enter-from-right', 'enter-from-left');
      newImg.classList.add('visible');
      newImg.style.opacity = '1';
    });
  } else {
    if (!newImg.parentNode) wrap.appendChild(newImg);
    newImg.style.opacity = '0';
    void newImg.offsetWidth;
    requestAnimationFrame(() => {
      newImg.style.opacity = '1';
      newImg.classList.add('visible');
    });
  }

  // cleanup old, finalize
  newImg.addEventListener('transitionend', () => {
    const existing = wrap.querySelector('img.lightbox-image.old') || wrap.querySelector('img.lightbox-image.visible:not([data-fileid="' + newImg.dataset.fileid + '"])');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    clearTimeout(localTimer);
    lightboxAnimating = false;
    CURRENT_INDEX = index;
  });

  // 👉 attach zoom handlers for this new image
  try { attachZoomHandlers(newImg); } catch(e) { console.warn('attachZoomHandlers failed', e); }
}
const _zoom = {
  scale: 1,
  min: 1,
  max: 4,
  translateX: 0,
  translateY: 0,
  isZoomed: false,
  pointerActive: false,
  activePointerId: null,
  lastPointer: null,
  lastTap: 0
};

function resetZoomState() {
  _zoom.scale = 1;
  _zoom.translateX = 0;
  _zoom.translateY = 0;
  _zoom.isZoomed = false;
  _zoom.pointerActive = false;
  _zoom.activePointerId = null;
  _zoom.lastPointer = null;
}

function applyTransformToImage(img) {
  const s = Math.round(_zoom.scale * 1000) / 1000;
  const tx = Math.round(_zoom.translateX * 10) / 10;
  const ty = Math.round(_zoom.translateY * 10) / 10;
  img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  if (_zoom.isZoomed) {
    img.classList.add('zoomed', 'grabbable');
  } else {
    img.classList.remove('zoomed', 'grabbable', 'grabbing');
    img.style.transform = '';
  }
}

/* clamp translate so you can’t pan beyond image edges */
function clampTranslate(img, frame) {
  const scale = _zoom.scale;
  if (!img || !frame) return;
  const imgW = img.naturalWidth || img.width || img.clientWidth;
  const imgH = img.naturalHeight || img.height || img.clientHeight;

  const frameW = frame.clientWidth;
  const frameH = frame.clientHeight;

  const ratioImg = imgW / imgH;
  let baseW = frameW;
  let baseH = frameW / ratioImg;
  if (baseH > frameH) {
    baseH = frameH;
    baseW = frameH * ratioImg;
  }
  const dispW = baseW * scale;
  const dispH = baseH * scale;

  const limitX = Math.max(0, (dispW - frameW) / 2);
  const limitY = Math.max(0, (dispH - frameH) / 2);
  _zoom.translateX = Math.min(limitX, Math.max(-limitX, _zoom.translateX));
  _zoom.translateY = Math.min(limitY, Math.max(-limitY, _zoom.translateY));
}

/* Ensure zoom frame wrapper exists (keeps zoomed image inside a box) */
function ensureFrameForImage(img) {
  const wrap = img.parentElement;
  if (!wrap) return null;
  if (wrap.classList.contains('zoom-frame')) return wrap;
  const frame = document.createElement('div');
  frame.className = 'zoom-frame';
  wrap.replaceChild(frame, img);
  frame.appendChild(img);
  return frame;
}

/* Size the frame to the image’s aspect (bounded to viewport) */
function sizeFrameToImage(img, frame) {
  if (!img.naturalWidth || !img.naturalHeight) {
    frame.style.maxWidth = '86vw';
    frame.style.maxHeight = '82vh';
    return;
  }
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const aspect = iw / ih;

  const maxW = Math.min(window.innerWidth * 0.86, 1100);
  const maxH = Math.min(window.innerHeight * 0.82, window.innerHeight - 140);

  let fw = maxW;
  let fh = fw / aspect;
  if (fh > maxH) {
    fh = maxH;
    fw = fh * aspect;
  }
  frame.style.width = fw + 'px';
  frame.style.height = fh + 'px';
}

/* Attach zoom/pan handlers for a newly shown lightbox image */
function attachZoomHandlers(img) {
  if (!img) return;
  const frame = ensureFrameForImage(img);
  if (!frame) return;

  resetZoomState();
  applyTransformToImage(img);

  if (!img.complete) {
    img.addEventListener('load', () => sizeFrameToImage(img, frame), { once: true });
  } else {
    sizeFrameToImage(img, frame);
  }

  // Recompute frame on resize/orientation change
  const onResize = () => { sizeFrameToImage(img, frame); clampTranslate(img, frame); applyTransformToImage(img); };
  window.addEventListener('resize', onResize);

  const onPointerDown = (ev) => {
    if (ev.button && ev.button !== 0) return;
    frame.setPointerCapture?.(ev.pointerId);
    _zoom.pointerActive = true;
    _zoom.activePointerId = ev.pointerId;
    _zoom.lastPointer = { x: ev.clientX, y: ev.clientY };
    img.classList.add('grabbing');
  };
  const onPointerMove = (ev) => {
    if (!_zoom.pointerActive || ev.pointerId !== _zoom.activePointerId) return;
    ev.preventDefault();
    const cur = { x: ev.clientX, y: ev.clientY };
    const dx = cur.x - _zoom.lastPointer.x;
    const dy = cur.y - _zoom.lastPointer.y;
    _zoom.lastPointer = cur;
    if (_zoom.isZoomed) {
      _zoom.translateX += dx;
      _zoom.translateY += dy;
      clampTranslate(img, frame);
      applyTransformToImage(img);
    }
  };
  const onPointerUp = (ev) => {
    try { frame.releasePointerCapture?.(ev.pointerId); } catch(e) {}
    _zoom.pointerActive = false;
    _zoom.activePointerId = null;
    _zoom.lastPointer = null;
    img.classList.remove('grabbing');

    // Double-tap detection (pointerup works for touch)
    const now = Date.now();
    if (now - _zoom.lastTap < 300) {
      toggleZoomAtPoint(img, frame, ev.clientX, ev.clientY);
      _zoom.lastTap = 0;
      return;
    }
    _zoom.lastTap = now;
  };

  // Wheel zoom (desktop)
  const onWheel = (ev) => {
    if (!ev.deltaY) return;
    ev.preventDefault();
    const prevScale = _zoom.scale;
    const delta = ev.deltaY > 0 ? -0.15 : 0.15;
    let next = Math.min(_zoom.max, Math.max(_zoom.min, prevScale + delta));
    if (Math.abs(next - prevScale) < 0.0001) return;

    _zoom.scale = next;
    _zoom.isZoomed = _zoom.scale > 1.0001;
    if (!_zoom.isZoomed) {
      _zoom.translateX = 0; _zoom.translateY = 0;
    } else {
      clampTranslate(img, frame);
    }
    applyTransformToImage(img);
    updateNavForZoomState();
  };

  // Fallback double-tap via touchend (some browsers)
  const onTouchEnd = (ev) => {
    const now = Date.now();
    if (now - _zoom.lastTap < 300) {
      const t = (ev.changedTouches && ev.changedTouches[0]);
      const cx = t ? t.clientX : (ev.clientX || window.innerWidth / 2);
      const cy = t ? t.clientY : (ev.clientY || window.innerHeight / 2);
      toggleZoomAtPoint(img, frame, cx, cy);
      _zoom.lastTap = 0;
      return;
    }
    _zoom.lastTap = now;
  };

  img.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  frame.addEventListener('wheel', onWheel, { passive: false });
  frame.addEventListener('touchend', onTouchEnd);

  // Detacher stored on element for cleanup
  img._zoomDetach = () => {
    try { img.removeEventListener('pointerdown', onPointerDown); } catch(e) {}
    try { window.removeEventListener('pointermove', onPointerMove); } catch(e) {}
    try { window.removeEventListener('pointerup', onPointerUp); } catch(e) {}
    try { frame.removeEventListener('wheel', onWheel); } catch(e) {}
    try { frame.removeEventListener('touchend', onTouchEnd); } catch(e) {}
    try { window.removeEventListener('resize', onResize); } catch(e) {}
    delete img._zoomDetach;
  };

  updateNavForZoomState();
}

/* Toggle zoom: double-tap or programmatically */
function toggleZoomAtPoint(img, frame, clientX, clientY) {
  if (!img || !frame) return;
  const prev = _zoom.scale;
  if (prev <= 1.01) {
    _zoom.scale = Math.min(_zoom.max, Math.max(1.8, 2));
    _zoom.isZoomed = true;

    const rect = frame.getBoundingClientRect();
    const offsetX = (clientX - rect.left) - rect.width / 2;
    const offsetY = (clientY - rect.top) - rect.height / 2;

    _zoom.translateX = -offsetX * ((_zoom.scale - 1) / _zoom.scale) * 0.9;
    _zoom.translateY = -offsetY * ((_zoom.scale - 1) / _zoom.scale) * 0.9;

    clampTranslate(img, frame);
  } else {
    _zoom.scale = 1;
    _zoom.translateX = 0;
    _zoom.translateY = 0;
    _zoom.isZoomed = false;
  }
  applyTransformToImage(img);
  updateNavForZoomState();
}

/* Enable/disable navigation controls while zoomed */
function updateNavForZoomState() {
  const prevBtn = document.querySelector('.lightbox-nav.prev');
  const nextBtn = document.querySelector('.lightbox-nav.next');
  if (_zoom.isZoomed) {
    prevBtn?.setAttribute('aria-disabled', 'true');
    nextBtn?.setAttribute('aria-disabled', 'true');
  } else {
    prevBtn?.removeAttribute('aria-disabled');
    nextBtn?.removeAttribute('aria-disabled');
  }
}

/* Detach zoom handlers from an image and unwrap frame */
function detachZoomHandlersFromImage(img) {
  if (!img) return;
  if (img._zoomDetach) img._zoomDetach();
  const parent = img.parentElement;
  if (parent && parent.classList && parent.classList.contains('zoom-frame')) {
    const container = parent.parentElement;
    if (container) {
      container.replaceChild(img, parent);
      parent.remove();
    }
  }
  resetZoomState();
  updateNavForZoomState();
}

/* Optional: prevent arrow navigation while zoomed; let Escape close */
window.addEventListener('keydown', (ev) => {
  if (_zoom.isZoomed) {
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      ev.preventDefault();
      ev.stopPropagation();
    }
    if (ev.key === 'Escape') {
      closeLightbox();
    }
  }
});
/* =========================
   Lightbox navigation
   ========================= */

function nextImage() {
  if (lightboxAnimating) return;
  if (_zoom.isZoomed) return; // disable while zoomed
  if (CURRENT_INDEX < IMAGE_URLS.length - 1) {
    showImageAtIndex(CURRENT_INDEX + 1, { direction: 'left' });
  }
}

function prevImage() {
  if (lightboxAnimating) return;
  if (_zoom.isZoomed) return; // disable while zoomed
  if (CURRENT_INDEX > 0) {
    showImageAtIndex(CURRENT_INDEX - 1, { direction: 'right' });
  }
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.classList.add('hidden');

  const wrapEl = document.querySelector('.lightbox-image-wrap');
  const currImg = wrapEl?.querySelector('img.lightbox-image');
  if (currImg) detachZoomHandlersFromImage(currImg);
  resetZoomState();

  CURRENT_INDEX = -1;
  setTimeout(() => {
    if (wrapEl) wrapEl.replaceChildren();
  }, 300);
}

/* =========================
   Lightbox open
   ========================= */
function openLightboxByFileId(fid, sourceEl) {
  const index = IMAGE_URLS.findIndex(x => String(x.fileId) === String(fid));
  if (index === -1) return;
  const lb = document.getElementById('lightbox');
  lb.classList.remove('hidden');
  showImageAtIndex(index, { sourceEl });
}

/* =========================
   Notes & Delete
   ========================= */

async function addNote(fileId) {
  const note = prompt('Enter note text:');
  if (!note) return;
  try {
    await callAppsScript({ action:'addNote', token:SKYSAFE_TOKEN, fileId, note });
    toast('Note added');
  } catch (err) { toast(err.message || 'Failed to add note'); }
}

async function deleteImage(fileId) {
  if (!confirm('Delete this image?')) return;
  try {
    await callAppsScript({ action:'deleteImage', token:SKYSAFE_TOKEN, fileId });
    IMAGE_URLS = IMAGE_URLS.filter(x => String(x.fileId) !== String(fileId));
    renderGallery();
    toast('Deleted');
    closeLightbox();
  } catch (err) { toast(err.message || 'Failed to delete image'); }
}

/* =========================
   Auth & Load
   ========================= */

async function doLogin(user, pass) {
  disableUI();
  try {
    const data = await callAppsScript({ action:'login', user, pass });
    if (!data || !data.token) throw new Error('Login failed');
    CURRENT_USER = user;
    SKYSAFE_TOKEN = data.token;
    localStorage.setItem('CURRENT_USER', CURRENT_USER);
    localStorage.setItem('skySafeeToken', SKYSAFE_TOKEN);
    updateTopbar();
    document.getElementById('authSection')?.classList.add('hidden');
    document.getElementById('gallerySection')?.classList.remove('hidden');
    loadGallery(true);
  } catch (err) {
    toast(err.message || 'Login error');
  } finally { enableUI(); }
}

function doLogout() {
  forceLogoutLocal();
}

function updateTopbar() {
  const el = document.getElementById('topbar-user');
  if (el) el.textContent = CURRENT_USER || '';
}

/* =========================
   Load Gallery
   ========================= */
async function loadGallery(reset=false) {
  if (loading.gallery) return;
  loading.gallery = true;
  try {
    if (reset) {
      NEXT_START = 0;
      IMAGE_URLS = [];
      HAS_MORE = true;
      const gallery = document.getElementById('gallery');
      if (gallery) gallery.replaceChildren();
    }
    if (!HAS_MORE) return;
    const data = await callAppsScript({ action:'listImages', token:SKYSAFE_TOKEN, start:NEXT_START, count:LOAD_MORE_COUNT });
    if (!data || !Array.isArray(data.images)) throw new Error('Bad listImages data');
    const newItems = data.images;
    IMAGE_URLS = IMAGE_URLS.concat(newItems);
    NEXT_START += newItems.length;
    if (newItems.length < LOAD_MORE_COUNT) HAS_MORE = false;
    renderGallery();
  } catch (err) { toast(err.message || 'Failed to load images'); }
  finally { loading.gallery = false; }
}

/* =========================
   Upload
   ========================= */
async function uploadImage(file) {
  if (!file) return;
  disableUI();
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('token', SKYSAFE_TOKEN);
    const res = await fetch(SCRIPT_URL + '?action=uploadImage', { method:'POST', body:formData });
    const data = await res.json();
    if (!data || !data.success) throw new Error(data.message || 'Upload failed');
    toast('Uploaded');
    loadGallery(true);
  } catch (err) { toast(err.message || 'Upload error'); }
  finally { enableUI(); }
}

/* =========================
   Event bindings
   ========================= */
document.getElementById('loginForm')?.addEventListener('submit', e => {
  e.preventDefault();
  const user = e.target.user.value.trim();
  const pass = e.target.pass.value;
  doLogin(user, pass);
});

document.getElementById('logoutBtn')?.addEventListener('click', doLogout);

document.getElementById('imageInput')?.addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) uploadImage(f);
});

document.querySelector('.lightbox-nav.next')?.addEventListener('click', nextImage);
document.querySelector('.lightbox-nav.prev')?.addEventListener('click', prevImage);
document.querySelector('.lightbox-close')?.addEventListener('click', closeLightbox);
