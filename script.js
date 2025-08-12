// =========================
// Skylens - script.js (complete with SW + install btn)
// =========================

/* CONFIG */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwsuhmmfT051Lb8AW2l_tPBBoizhuiLA4rjRbpzWalT7fjjw3DsKowKjcWffmYwrWaO/exec';
const INITIAL_LOAD_COUNT = 8;
const LOAD_MORE_COUNT = 16;

/* STATE */
let CURRENT_USER = localStorage.getItem('CURRENT_USER') || null;
let SKYSAFE_TOKEN = localStorage.getItem('skySafeeToken') || null;
let IMAGE_URLS = []; // {date, url, fileId, note}
let CURRENT_INDEX = -1;
let CURRENT_THEME = localStorage.getItem('theme') || 'default';
let NEXT_START = 0;
let HAS_MORE = true;
const SEEN_FILEIDS = new Set();

/* LOADING FLAGS */
const loading = { gallery:false, upload:false, note:false, delete:false };

/* NOTE LOADING */
const noteLoading = {};

/* Camera state */
let videoStream = null;
let cameraFacing = 'environment';
let cameraStarting = false;

/* PWA install flow */
let deferredPrompt = null;

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
  CURRENT_USER = null;
  SKYSAFE_TOKEN = null;
  IMAGE_URLS = [];
  SEEN_FILEIDS.clear();
  document.getElementById('gallery')?.replaceChildren();
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
      console.error('API returned non-JSON:', text);
      throw new Error('Invalid response from server');
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

/* GLOBAL UI helpers */
function setAllButtonsDisabled(disabled) {
  const selector = 'button, input[type="button"], input[type="submit"], .fab-option, .icon-btn, .link, .control';
  document.querySelectorAll(selector).forEach(el => {
    try {
      if ('disabled' in el) el.disabled = !!disabled;
      if (disabled) {
        el.classList.add('disabled');
        el.setAttribute('aria-disabled', 'true');
        el.style.pointerEvents = 'none';
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
  });
}
function disableUI() { setAllButtonsDisabled(true); }
function enableUI()  { setAllButtonsDisabled(false); }

/* LAZY LOADER */
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

/* UI BINDINGS (plus swipe handlers + touch fallback attached to both lb and image) */
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
    const img = IMAGE_URLS[CURRENT_INDEX];
    if (img && img.fileId) await saveNoteFromModal(img.fileId);
  });

  // button handlers (ensure close/next/prev are wired)
  document.querySelectorAll('.lightbox-close').forEach(b => b.addEventListener('click', closeLightbox));
  document.querySelectorAll('.lightbox-nav.prev').forEach(b => b.addEventListener('click', prevImage));
  document.querySelectorAll('.lightbox-nav.next').forEach(b => b.addEventListener('click', () => nextImage()));

  // keyboard navigation & escape
  document.addEventListener('keydown', (e) => {
    const lb = document.getElementById('lightbox');
    if (!lb || lb.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') nextImage();
    if (e.key === 'ArrowLeft') prevImage();
  });

  // SWIPE: pointer events + touch fallback on #lightbox AND #lightboxImage
  const lb = document.getElementById('lightbox');
  const lbImg = document.getElementById('lightboxImage');
  const attachSwipe = (el) => {
    if (!el) return;
    try { el.style.touchAction = 'pan-y'; } catch (e) {}
    if (window.PointerEvent) {
      let pointerDown = false;
      let startX = 0, startY = 0;
      el.addEventListener('pointerdown', (e) => {
        startX = e.clientX; startY = e.clientY;
        pointerDown = true;
      }, { passive: true });

      el.addEventListener('pointerup', (e) => {
        if (!pointerDown) return;
        pointerDown = false;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const absX = Math.abs(dx), absY = Math.abs(dy);
        if (absX > 50 && absX > absY) {
          if (dx < 0) nextImage(); else prevImage();
        }
      }, { passive: true });

      el.addEventListener('pointercancel', () => { pointerDown = false; }, { passive: true });
    }

    // touch fallback
    let tStartX = 0, tStartY = 0;
    el.addEventListener('touchstart', (e) => {
      const t = (e.touches && e.touches[0]);
      if (!t) return;
      tStartX = t.clientX; tStartY = t.clientY;
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
      const t = (e.changedTouches && e.changedTouches[0]);
      if (!t) return;
      const dx = t.clientX - tStartX;
      const dy = t.clientY - tStartY;
      const absX = Math.abs(dx), absY = Math.abs(dy);
      if (absX > 50 && absX > absY) {
        if (dx < 0) nextImage(); else prevImage();
      }
    }, { passive: true });
  };

  attachSwipe(lb);
  attachSwipe(lbImg);
}

/* TOPBAR visibility */
function updateTopbar() {
  if (!CURRENT_USER) document.body.classList.add('no-auth'); else document.body.classList.remove('no-auth');
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
  document.body.className = '';
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

/* AUTH (login/signup) */
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
      IMAGE_URLS = [];
      SEEN_FILEIDS.clear();
      document.getElementById('gallery')?.replaceChildren();
      NEXT_START = 0;
      HAS_MORE = true;
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

/* GALLERY & RENDER (masonry columns) */
function makeSkeletonItem() {
  const div = document.createElement('div');
  div.className = 'gallery-item';
  const sk = document.createElement('div');
  sk.className = 'skeleton';
  div.appendChild(sk);
  return div;
}

function createGalleryItem(obj) {
  const div = document.createElement('div');
  div.className = 'gallery-item';
  if (obj.fileId) div.dataset.fileid = obj.fileId;

  const sk = document.createElement('div');
  sk.className = 'skeleton';
  div.appendChild(sk);

  const img = document.createElement('img');
  img.alt = `SkyLens image`;
  img.dataset.src = obj.url || '';
  img.loading = 'lazy';
  img.style.display = 'block';
  img.style.opacity = '0';
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
      img.dataset.src && (img.src = img.dataset.src + '?r=' + Date.now());
      if (imgObserver) imgObserver.observe(img);
    });
    div.appendChild(broken);
  };

  div.appendChild(img);

  if (imgObserver) imgObserver.observe(img);
  else img.src = img.dataset.src;

  div.addEventListener('click', () => {
    const fid = div.dataset.fileid;
    if (fid) openLightboxByFileId(fid);
  });
  div.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const fid = div.dataset.fileid; if (fid) openLightboxByFileId(fid); } });
  div.tabIndex = 0;

  return div;
}

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
    const newImages = images.filter(img => {
      const fid = String(img.fileId || '');
      if (!fid) return true;
      if (SEEN_FILEIDS.has(fid)) return false;
      SEEN_FILEIDS.add(fid);
      return true;
    });

    IMAGE_URLS = IMAGE_URLS.concat(newImages);

    const container = document.getElementById('gallery');
    if (container && newImages.length) {
      const frag = document.createDocumentFragment();
      newImages.forEach(imgObj => frag.appendChild(createGalleryItem(imgObj)));
      container.appendChild(frag);
    }

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

/* UPLOAD */
async function uploadImage(file) {
  if (!file || !CURRENT_USER || !SKYSAFE_TOKEN) return;
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
          const el = createGalleryItem(newImage);
          container.insertBefore(el, container.firstChild);
        } else {
          IMAGE_URLS = [];
          SEEN_FILEIDS.clear();
          document.getElementById('gallery').innerHTML = '';
          NEXT_START = 0;
          HAS_MORE = true;
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

/* LIGHTBOX */
function openLightbox(index) {
  if (index < 0 || index >= IMAGE_URLS.length) return;
  CURRENT_INDEX = index;
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.classList.remove('hidden');
  updateLightboxImage();
}
function openLightboxByFileId(fileId) {
  const idx = IMAGE_URLS.findIndex(i => String(i.fileId || '') === String(fileId || ''));
  if (idx === -1) {
    IMAGE_URLS = [];
    SEEN_FILEIDS.clear();
    document.getElementById('gallery').innerHTML = '';
    NEXT_START = 0; HAS_MORE = true;
    loadGallery(0, INITIAL_LOAD_COUNT).then(() => {
      const newIdx = IMAGE_URLS.findIndex(i => String(i.fileId) === String(fileId || ''));
      if (newIdx !== -1) openLightbox(newIdx);
    });
    return;
  }
  openLightbox(idx);
}
function closeLightbox() { document.getElementById('lightbox')?.classList.add('hidden'); }
function updateLightboxImage() {
  const obj = IMAGE_URLS[CURRENT_INDEX];
  if (!obj) return;
  const el = document.getElementById('lightboxImage');
  if (el) el.src = obj.url;
}
async function nextImage() {
  if (CURRENT_INDEX < IMAGE_URLS.length - 1) {
    CURRENT_INDEX++;
    updateLightboxImage();
    return;
  }

  if (HAS_MORE && !loading.gallery) {
    const prevLen = IMAGE_URLS.length;
    await loadGallery(NEXT_START, LOAD_MORE_COUNT);
    if (IMAGE_URLS.length > prevLen) {
      CURRENT_INDEX++;
      updateLightboxImage();
    }
  }
}
function prevImage() {
  if (CURRENT_INDEX > 0) {
    CURRENT_INDEX--;
    updateLightboxImage();
  }
}

/* DELETE */
async function deleteCurrentImage() {
  if (loading.delete) return;
  if (CURRENT_INDEX < 0 || !IMAGE_URLS[CURRENT_INDEX]) return;
  const item = IMAGE_URLS[CURRENT_INDEX];
  if (!item.fileId) return;
  loading.delete = true;
  try {
    disableUI();
    const res = await callAppsScript({ action: 'deleteImage', fileId: item.fileId, token: SKYSAFE_TOKEN });
    if (res && res.success) {
      const fid = String(item.fileId);
      const idx = IMAGE_URLS.findIndex(i => String(i.fileId) === fid);
      if (idx !== -1) IMAGE_URLS.splice(idx, 1);
      const el = document.querySelector(`.gallery-item[data-fileid="${fid}"]`);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      SEEN_FILEIDS.delete(fid);
      toast('Image deleted');
      CURRENT_INDEX = Math.max(0, Math.min(CURRENT_INDEX, IMAGE_URLS.length - 1));
      closeLightbox();
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

/* NOTES: On-demand modal workflow */
async function openNoteModal(fileId) {
  if (!fileId || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  const modal = document.getElementById('noteModal');
  const noteView = document.getElementById('noteView');
  const noteTextarea = document.getElementById('noteTextarea');
  const editBtn = document.getElementById('noteEditBtn');
  const saveBtn = document.getElementById('noteSaveBtn');
  const spinner = document.getElementById('noteSpinner');

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
      if (Date.now() > waitUntil) {
        noteView.textContent = '';
        if (spinner) spinner.classList.add('hidden');
        return;
      }
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
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
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

  const idx = IMAGE_URLS.findIndex(i => i && String(i.fileId) === String(IMAGE_URLS[CURRENT_INDEX]?.fileId));
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

/* LOGOUT */
async function logoutUser() {
  try {
    disableUI();
    try { if (SKYSAFE_TOKEN) await callAppsScript({ action: 'logout', token: SKYSAFE_TOKEN }); } catch (e) {}
  } finally {
    forceLogoutLocal();
    enableUI();
  }
}

/* CAMERA improved (unchanged logic) */
async function startCamera() {
  if (cameraStarting) return;
  cameraStarting = true;
  try {
    if (videoStream) stopCamera();
    const constraints = { video: { facingMode: cameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
    videoStream = await navigator.mediaDevices.getUserMedia(constraints);
    const v = document.getElementById('cameraPreview');
    if (v) { v.srcObject = videoStream; await v.play(); }
  } catch (e) {
    console.error('startCamera', e);
    toast('Camera access denied or not available');
  } finally { cameraStarting = false; }
}

async function switchCamera() {
  cameraFacing = (cameraFacing === 'environment') ? 'user' : 'environment';
  try {
    if (videoStream) stopCamera();
    await startCamera();
    toast(cameraFacing === 'environment' ? 'Rear camera' : 'Front camera');
  } catch (e) { console.error('switchCamera', e); }
}

function stopCamera() {
  if (!videoStream) return;
  videoStream.getTracks().forEach(t => t.stop());
  videoStream = null;
}

function capturePhoto() {
  const v = document.getElementById('cameraPreview');
  if (!v || !videoStream) { toast('Camera not ready'); return; }
  const c = document.createElement('canvas');
  c.width = v.videoWidth || 1280;
  c.height = v.videoHeight || 720;
  const ctx = c.getContext('2d');
  ctx.drawImage(v, 0, 0, c.width, c.height);

  const flash = document.getElementById('videoFlash');
  if (flash) { flash.style.opacity = '0.9'; setTimeout(() => { flash.style.opacity = '0'; }, 160); }

  c.toBlob(blob => {
    const file = new File([blob], `camera_${Date.now()}.png`, { type: 'image/png' });
    uploadImage(file);
  }, 'image/png');
}

/* DRAG overlay */
let dragCounter = 0;
function wireDragOverlay() {
  const overlay = document.getElementById('fullDropOverlay');
  if (!overlay) return;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; overlay.classList.remove('hidden'); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter = Math.max(0, dragCounter - 1); if (dragCounter === 0) overlay.classList.add('hidden'); });
  window.addEventListener('drop', (e) => { e.preventDefault(); dragCounter = 0; overlay.classList.add('hidden'); const files = [...(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : [])]; if (files.length) files.forEach(f => uploadImage(f)); });
}

/* PWA: create/hide install button & handle beforeinstallprompt */
function createInstallButtonIfNeeded() {
  // If already installed (standalone), don't show
  const isStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = window.navigator.standalone; // iOS
  if (isStandalone || iosStandalone) return;

  const topRight = document.querySelector('.top-right');
  if (!topRight) return;
  if (document.getElementById('installBtn')) return; // already exists

  const btn = document.createElement('button');
  btn.id = 'installBtn';
  btn.className = 'control';
  btn.title = 'Install app';
  btn.setAttribute('aria-label', 'Install app');
  btn.innerHTML = `<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M5 12l7-7 7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M5 21h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg> Install`;
  btn.style.display = 'none'; // hidden until we know install is available
  topRight.insertBefore(btn, topRight.firstChild);

  btn.addEventListener('click', async () => {
    if (!deferredPrompt) {
      toast('Install not available');
      return;
    }
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      btn.style.display = 'none';
      if (choice.outcome === 'accepted') toast('Thanks — app installed');
      else toast('Install dismissed');
    } catch (e) {
      console.error('install prompt error', e);
      toast('Install failed');
    }
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  // prevent automatic prompt
  e.preventDefault();
  deferredPrompt = e;
  createInstallButtonIfNeeded();
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'inline-flex';
});

window.addEventListener('appinstalled', (evt) => {
  // App installed — hide install button
  deferredPrompt = null;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'none';
  toast('App installed');
});

// SW registration: register relative path so it works under repo subpath
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./service-worker.js');
    console.log('Service Worker registered:', reg);
    navigator.serviceWorker.addEventListener('message', ev => {
      if (ev.data && ev.data.type === 'SKY_UPDATE') {
        // non-intrusive update available
        console.log('SW update message', ev.data);
        toast('App updated');
      }
    });
  } catch (e) {
    console.warn('SW registration failed', e);
  }
}

/* INIT */
window.addEventListener('DOMContentLoaded', () => {
  bindUI();
  initObserver();
  wireDragOverlay();
  updateTopbar();

  // ensure lightbox gets appropriate touch-action to help pointer/touch delivery
  try {
    const lb = document.getElementById('lightbox');
    if (lb) lb.style.touchAction = 'pan-y';
    const img = document.getElementById('lightboxImage');
    if (img) img.style.touchAction = 'none';
  } catch (e) {}

  // create install button DOM (hidden until beforeinstallprompt fires)
  createInstallButtonIfNeeded();

  // register service worker
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
