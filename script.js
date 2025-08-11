// =========================
// Skylens - script.js (clean consolidated)
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

/* HELPERS */
// Use text/plain to avoid preflight; Apps Script reads e.postData.contents
async function callAppsScript(payload) {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

function toast(msg, timeout = 2200) {
  const t = document.getElementById('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.add('hidden'), timeout);
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

/* BIND UI */
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
  if (!CURRENT_USER || !SKYSAFE_TOKEN) { localStorage.setItem('theme', theme); applyTheme(theme); return; }
  try {
    disableUI();
    await callAppsScript({ action: 'saveTheme', userId: CURRENT_USER, theme });
    localStorage.setItem('theme', theme);
    applyTheme(theme);
  } catch (e) { console.error('saveTheme', e); } finally { enableUI(); }
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
      NEXT_START = 0;
      HAS_MORE = true;
      await loadTheme();
      await loadGallery(0, INITIAL_LOAD_COUNT);
    } else {
      toast((res && res.message) ? res.message : 'Authentication failed');
    }
  } catch (e) {
    console.error('handleAuth', e);
    toast('Auth error');
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

function createGalleryItem(obj, absoluteIndex) {
  const div = document.createElement('div');
  div.className = 'gallery-item';
  div.dataset.index = absoluteIndex;

  const sk = document.createElement('div');
  sk.className = 'skeleton';
  div.appendChild(sk);

  const img = document.createElement('img');
  img.alt = `SkyLens image ${absoluteIndex + 1}`;
  img.dataset.src = obj.url || '';
  img.loading = 'lazy';
  img.style.display = 'block';

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

  // open lightbox
  div.addEventListener('click', () => openLightbox(absoluteIndex));
  div.addEventListener('keydown', (e) => { if (e.key === 'Enter') openLightbox(absoluteIndex); });
  div.tabIndex = 0;

  return div;
}

async function loadGallery(start = 0, limit = INITIAL_LOAD_COUNT) {
  if (!CURRENT_USER || !SKYSAFE_TOKEN) return;
  try {
    disableUI();
    document.getElementById('loadingSpinner')?.classList.remove('hidden');

    const res = await callAppsScript({ action: 'getPaginatedImages', startIndex: start, limit, token: SKYSAFE_TOKEN });

    if (!res || !res.success) {
      console.warn('Unexpected gallery response', res);
      return;
    }

    // server is expected to return newest-first `images` and optionally nextStart, hasMore
    const images = Array.isArray(res.images) ? res.images : [];
    const baseIndex = IMAGE_URLS.length;
    IMAGE_URLS = IMAGE_URLS.concat(images);

    // render
    const container = document.getElementById('gallery');
    if (container && images.length) {
      images.forEach((imgObj, idx) => {
        const absoluteIndex = baseIndex + idx;
        const el = createGalleryItem(imgObj, absoluteIndex);
        container.appendChild(el);
      });
    }

    // pagination bookkeeping: prefer server-sent nextStart/hasMore, fallback to heuristics
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
    toast('Failed to load images');
  } finally {
    enableUI();
    document.getElementById('loadingSpinner')?.classList.add('hidden');
  }
}

/* UPLOAD */
async function uploadImage(file) {
  if (!file || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  const allowed = ['image/jpeg','image/png','image/gif','image/webp'];
  const max = 5 * 1024 * 1024;
  if (!allowed.includes(file.type)) { toast('Unsupported file type'); return; }
  if (file.size > max) { toast('File too large (max 5MB)'); return; }

  // optimistic skeleton at top
  const container = document.getElementById('gallery');
  const placeholder = makeSkeletonItem();
  container.insertBefore(placeholder, container.firstChild);

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      disableUI();
      const dataUrl = e.target.result;
      const res = await callAppsScript({ action: 'uploadToDrive', dataUrl, filename: file.name, token: SKYSAFE_TOKEN });
      if (res && res.success) {
        placeholder.remove();
        IMAGE_URLS = [];
        document.getElementById('gallery').innerHTML = '';
        NEXT_START = 0;
        HAS_MORE = true;
        await loadGallery(0, INITIAL_LOAD_COUNT);
        toast('Upload successful');
      } else {
        placeholder.remove();
        toast((res && res.message) ? res.message : 'Upload failed');
      }
    } catch (err) {
      placeholder.remove();
      console.error('uploadImage', err);
      toast('Upload failed');
    } finally { enableUI(); }
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
  if (CURRENT_INDEX < 0 || !IMAGE_URLS[CURRENT_INDEX]) return;
  const item = IMAGE_URLS[CURRENT_INDEX];
  try {
    disableUI();
    const res = await callAppsScript({ action: 'deleteImage', fileId: item.fileId, token: SKYSAFE_TOKEN });
    if (res && res.success) {
      toast('Image deleted');
      IMAGE_URLS.splice(CURRENT_INDEX, 1);
      document.getElementById('gallery').innerHTML = '';
      IMAGE_URLS = [];
      NEXT_START = 0;
      HAS_MORE = true;
      await loadGallery(0, INITIAL_LOAD_COUNT);
      closeLightbox();
    } else {
      toast((res && res.message) ? res.message : 'Delete failed');
    }
  } catch (e) {
    console.error('deleteCurrentImage', e);
    toast('Delete failed');
  } finally { enableUI(); }
}

/* NOTES */
async function loadNoteForImage(fileId) {
  if (!fileId || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  try {
    disableUI();
    const res = await callAppsScript({ action: 'getImageNote', fileId, token: SKYSAFE_TOKEN });
    if (res && res.success) {
      document.getElementById('imageNote').value = res.note || '';
    }
  } catch (e) { console.error('loadNoteForImage', e); } finally { enableUI(); }
}
async function saveNoteForImage(fileId) {
  const note = (document.getElementById('imageNote') || { value: '' }).value;
  if (!fileId || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  try {
    disableUI();
    const res = await callAppsScript({ action: 'saveImageNote', fileId, note, token: SKYSAFE_TOKEN });
    if (res && res.success) toast('Note saved'); else toast((res && res.message) ? res.message : 'Save failed');
  } catch (e) { console.error('saveNoteForImage', e); toast('Save failed'); } finally { enableUI(); }
}

/* LOGOUT */
async function logoutUser() {
  if (!CURRENT_USER || !SKYSAFE_TOKEN) return;
  try {
    disableUI();
    await callAppsScript({ action: 'logout', token: SKYSAFE_TOKEN });
  } catch (e) { console.warn('logoutUser', e); } finally {
    localStorage.removeItem('CURRENT_USER');
    localStorage.removeItem('skySafeeToken');
    CURRENT_USER = null; SKYSAFE_TOKEN = null;
    IMAGE_URLS = [];
    document.getElementById('gallery').innerHTML = '';
    updateTopbar();
    document.getElementById('authSection')?.classList.remove('hidden');
    document.getElementById('gallerySection')?.classList.add('hidden');
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
