// =========================
// Skylens - script.js (patched & optimized)
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

// keep set of seen fileIds to avoid duplicates from server responses
const SEEN_FILEIDS = new Set();

/* PER-OP LOADING FLAGS (avoid overlapping requests) */
const loading = {
  gallery: false,
  upload: false,
  note: false,
  delete: false
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

// Robust Apps Script caller
async function callAppsScript(payload) {
  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Read as text (safer for non-json responses)
    const text = await res.text();
    if (!text) throw new Error('Empty response from server');

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      console.error('API returned non-JSON:', text);
      throw new Error('Invalid response from server');
    }

    // Central auth failure detection
    if (data && data.success === false && /unauthoriz/i.test(String(data.message || ''))) {
      // do a local logout (avoid calling API again)
      forceLogoutLocal('Session expired — please sign in again');
      throw new Error('Unauthorized');
    }

    return data;
  } catch (err) {
    console.error('callAppsScript error', err);
    // Typical network/cors error shows as TypeError: Failed to fetch
    if (err instanceof TypeError || /failed to fetch/i.test(String(err.message))) {
      throw new Error('Network error or CORS blocked. Check your Apps Script deployment (Anyone, even anonymous).');
    }
    throw err;
  }
}

/* GLOBAL UI DISABLE / ENABLE */
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
    } catch (e) { /* ignore node issues */ }
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
          if (src) {
            img.src = src;
          }
          imgObserver.unobserve(img);
        }
      });
    }, { rootMargin: '200px' });
  } else {
    imgObserver = null;
  }
}

/* UI BINDINGS */
function bindUI() {
  const loginForm = document.getElementById('loginForm');
  const signupToggleBtn = document.getElementById('signupToggleBtn');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const themeSelect = document.getElementById('themeSelect');
  const browseBtn = document.getElementById('browseBtn');
  const imageInput = document.getElementById('imageInput');
  const fabOpen = document.getElementById('fabOpen');
  const openCameraBtn = document.getElementById('openCameraBtn');
  const captureBtn = document.getElementById('captureBtn');
  const closeCameraBtn = document.getElementById('closeCameraBtn');
  const saveNoteBtn = document.getElementById('saveNoteBtn');
  const deleteImageBtn = document.getElementById('deleteImageBtn');
  const logoutBtn = document.getElementById('logoutButton');

  if (loginForm) loginForm.addEventListener('submit', e => { e.preventDefault(); handleAuth(); });
  if (signupToggleBtn) signupToggleBtn.addEventListener('click', toggleSignup);
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', () => loadGallery(NEXT_START, LOAD_MORE_COUNT));
  if (themeSelect) themeSelect.addEventListener('change', () => saveTheme(themeSelect.value));
  if (browseBtn && imageInput) browseBtn.addEventListener('click', e => { e.preventDefault(); imageInput.click(); });
  if (imageInput) imageInput.addEventListener('change', e => { [...e.target.files].forEach(f => uploadImage(f)); imageInput.value = ''; });
  if (fabOpen) fabOpen.addEventListener('click', () => document.getElementById('fabOptions')?.classList.toggle('hidden'));
  if (openCameraBtn) openCameraBtn.addEventListener('click', () => { startCamera(); document.getElementById('cameraModal')?.classList.remove('hidden'); });
  if (captureBtn) captureBtn.addEventListener('click', () => capturePhoto());
  if (closeCameraBtn) closeCameraBtn.addEventListener('click', () => { stopCamera(); document.getElementById('cameraModal')?.classList.add('hidden'); });
  if (saveNoteBtn) saveNoteBtn.addEventListener('click', () => { const img = IMAGE_URLS[CURRENT_INDEX]; if (img && img.fileId) saveNoteForImage(img.fileId); });
  if (deleteImageBtn) deleteImageBtn.addEventListener('click', deleteCurrentImage);
  if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);

  // keyboard navigation for lightbox
  document.addEventListener('keydown', (e) => {
    const lb = document.getElementById('lightbox');
    if (!lb || lb.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') nextImage();
    if (e.key === 'ArrowLeft') prevImage();
  });
}

/* TOPBAR VISIBILITY (hide controls pre-login) */
function updateTopbar() {
  if (!CURRENT_USER) {
    document.body.classList.add('no-auth');
  } else {
    document.body.classList.remove('no-auth');
  }
}

/* THEME */
async function loadTheme() {
  if (!CURRENT_USER) { applyTheme(CURRENT_THEME); return; }
  if (loading.theme) return;
  try {
    disableUI();
    // Keep compatibility: backend expects userId
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
  // Compatibility: send userId as backend expects
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
      // Reset gallery state
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

/* GALLERY & PAGINATION */
function makeSkeletonItem() {
  const div = document.createElement('div');
  div.className = 'gallery-item';
  const sk = document.createElement('div');
  sk.className = 'skeleton';
  div.appendChild(sk);
  return div;
}

function createGalleryItem(obj) {
  // obj: { date, url, fileId, note }
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

  // lazy-load
  if (imgObserver) imgObserver.observe(img);
  else img.src = img.dataset.src;

  // open lightbox by fileId (safer than relying on indexes which may shift)
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
    // Filter out images we have already (avoid duplicates)
    const newImages = images.filter(img => {
      const fid = String(img.fileId || '');
      if (!fid) return true; // keep if no ID (rare)
      if (SEEN_FILEIDS.has(fid)) return false;
      SEEN_FILEIDS.add(fid);
      return true;
    });

    // add to state
    const baseIndex = IMAGE_URLS.length;
    IMAGE_URLS = IMAGE_URLS.concat(newImages);

    // render using DocumentFragment (faster)
    const container = document.getElementById('gallery');
    if (container && newImages.length) {
      const frag = document.createDocumentFragment();
      newImages.forEach((imgObj) => {
        const el = createGalleryItem(imgObj);
        frag.appendChild(el);
      });
      // append to end (newest-first already from server -> but we reversed in backend; keep server contract)
      container.appendChild(frag);
    }

    // pagination bookkeeping: prefer server-sent nextStart/hasMore
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

  // optimistic skeleton at top
  const container = document.getElementById('gallery');
  const placeholder = makeSkeletonItem();
  // show placeholder at top
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

        // Optimistically insert new item locally (backend returns url & fileId)
        const newImage = {
          date: (new Date()).toISOString ? new Date().toISOString() : (new Date()).toString(),
          url: res.url || '',
          fileId: res.fileId || '',
          note: ''
        };

        // avoid duplicates
        if (newImage.fileId && !SEEN_FILEIDS.has(newImage.fileId)) {
          SEEN_FILEIDS.add(newImage.fileId);
          IMAGE_URLS.unshift(newImage);
          // prepend DOM item
          const el = createGalleryItem(newImage);
          container.insertBefore(el, container.firstChild);
        } else {
          // fallback: refresh first page
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
  const img = IMAGE_URLS[CURRENT_INDEX];
  if (img && img.fileId) loadNoteForImage(img.fileId);
}
function openLightboxByFileId(fileId) {
  // find index in IMAGE_URLS
  const idx = IMAGE_URLS.findIndex(i => String(i.fileId || '') === String(fileId || ''));
  if (idx === -1) {
    // not found locally — as fallback, refresh first page
    // set minimal reload: reset and load first page
    IMAGE_URLS = [];
    SEEN_FILEIDS.clear();
    document.getElementById('gallery').innerHTML = '';
    NEXT_START = 0;
    HAS_MORE = true;
    loadGallery(0, INITIAL_LOAD_COUNT).then(() => {
      const newIdx = IMAGE_URLS.findIndex(i => String(i.fileId || '') === String(fileId || ''));
      if (newIdx !== -1) openLightbox(newIdx);
    });
    return;
  }
  openLightbox(idx);
}
function closeLightbox() {
  document.getElementById('lightbox')?.classList.add('hidden');
}
function updateLightboxImage() {
  const obj = IMAGE_URLS[CURRENT_INDEX];
  if (!obj) return;
  const el = document.getElementById('lightboxImage');
  if (el) el.src = obj.url;
}
function nextImage() {
  if (CURRENT_INDEX < IMAGE_URLS.length - 1) {
    CURRENT_INDEX++;
    updateLightboxImage();
    const i = IMAGE_URLS[CURRENT_INDEX];
    if (i && i.fileId) loadNoteForImage(i.fileId);
  }
}
function prevImage() {
  if (CURRENT_INDEX > 0) {
    CURRENT_INDEX--;
    updateLightboxImage();
    const i = IMAGE_URLS[CURRENT_INDEX];
    if (i && i.fileId) loadNoteForImage(i.fileId);
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
      // Remove from local state and DOM without full reload
      const fid = String(item.fileId);
      // remove from IMAGE_URLS
      const idx = IMAGE_URLS.findIndex(i => String(i.fileId) === fid);
      if (idx !== -1) IMAGE_URLS.splice(idx, 1);
      // remove from DOM
      const el = document.querySelector(`.gallery-item[data-fileid="${fid}"]`);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      SEEN_FILEIDS.delete(fid);
      toast('Image deleted');
      // adjust CURRENT_INDEX
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

/* NOTES */
async function loadNoteForImage(fileId) {
  if (!fileId || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  if (loading.note) return;
  loading.note = true;
  try {
    disableUI();
    const res = await callAppsScript({ action: 'getImageNote', fileId, token: SKYSAFE_TOKEN });
    if (res && res.success) {
      document.getElementById('imageNote').value = res.note || '';
      // Update local cache
      const idx = IMAGE_URLS.findIndex(i => String(i.fileId) === String(fileId));
      if (idx !== -1) IMAGE_URLS[idx].note = res.note || '';
    } else {
      document.getElementById('imageNote').value = '';
    }
  } catch (e) {
    console.error('loadNoteForImage', e);
  } finally {
    loading.note = false;
    enableUI();
  }
}
async function saveNoteForImage(fileId) {
  if (!fileId || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  if (loading.note) return;
  const note = (document.getElementById('imageNote') || { value: '' }).value;
  loading.note = true;
  try {
    disableUI();
    const res = await callAppsScript({ action: 'saveImageNote', fileId, note, token: SKYSAFE_TOKEN });
    if (res && res.success) {
      // Update local copy
      const idx = IMAGE_URLS.findIndex(i => String(i.fileId) === String(fileId));
      if (idx !== -1) IMAGE_URLS[idx].note = note;
      toast('Note saved');
    } else {
      toast((res && res.message) ? res.message : 'Save failed');
    }
  } catch (e) {
    console.error('saveNoteForImage', e);
    toast(e.message || 'Save failed');
  } finally {
    loading.note = false;
    enableUI();
  }
}

/* LOGOUT */
async function logoutUser() {
  // Call server logout but do local cleanup regardless of server
  try {
    disableUI();
    try {
      if (SKYSAFE_TOKEN) await callAppsScript({ action: 'logout', token: SKYSAFE_TOKEN });
    } catch (e) { /* ignore call errors when logging out */ }
  } finally {
    forceLogoutLocal();
    enableUI();
  }
}

/* CAMERA (basic) */
let videoStream = null;
async function startCamera() {
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
    const v = document.getElementById('cameraPreview');
    if (v) { v.srcObject = videoStream; v.play(); }
  } catch (e) { console.error('startCamera', e); toast('Camera access denied'); }
}
function capturePhoto() {
  const v = document.getElementById('cameraPreview');
  if (!v) return;
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  c.toBlob(blob => {
    const file = new File([blob], `camera_${Date.now()}.png`, { type: 'image/png' });
    uploadImage(file);
  }, 'image/png');
}
function stopCamera() {
  if (!videoStream) return;
  videoStream.getTracks().forEach(t => t.stop());
  videoStream = null;
}

/* FULL-SCREEN DRAG UX */
let dragCounter = 0;
function wireDragOverlay() {
  const overlay = document.getElementById('fullDropOverlay');
  if (!overlay) return;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    overlay.classList.remove('hidden');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) overlay.classList.add('hidden');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.add('hidden');
    const files = [...(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : [])];
    if (files.length) files.forEach(f => uploadImage(f));
  });
}

/* INIT */
window.addEventListener('DOMContentLoaded', () => {
  bindUI();
  initObserver();
  wireDragOverlay();
  updateTopbar();

  if (CURRENT_USER && SKYSAFE_TOKEN) {
    document.getElementById('authSection')?.classList.add('hidden');
    document.getElementById('gallerySection')?.classList.remove('hidden');
    loadTheme().then(() => loadGallery(0, INITIAL_LOAD_COUNT));
  } else {
    document.getElementById('authSection')?.classList.remove('hidden');
    document.getElementById('gallerySection')?.classList.add('hidden');
  }
});
