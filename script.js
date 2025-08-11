// =========================
// Skylens - script.js (patched, gallery + overlay + skeleton)
// =========================

// CONFIG
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwsuhmmfT051Lb8AW2l_tPBBoizhuiLA4rjRbpzWalT7fjjw3DsKowKjcWffmYwrWaO/exec';
const INITIAL_LOAD_COUNT = 8; // a bit larger for nicer grid
const LOAD_MORE_COUNT = 16;

let CURRENT_USER = localStorage.getItem('CURRENT_USER') || null;
let SKYSAFE_TOKEN = localStorage.getItem('skySafeeToken') || null;
let IMAGE_URLS = []; // array of {date, url, fileId, note}
let CURRENT_INDEX = -1;
let CURRENT_THEME = localStorage.getItem('theme') || 'default';
let HAS_MORE = true;
let observer = null;
let dragCounter = 0;

// UTILS
async function callAppsScript(payload) {
  // use text/plain to avoid preflight (Apps Script reads e.postData.contents)
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

function showMessage(msg, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) { console.log(`[${type}] ${msg}`); return; }
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
}

// GLOBAL DISABLE/ENABLE
function setAllButtonsDisabled(disabled = true) {
  const selector = 'button, input[type="button"], input[type="submit"], .fab-option, .icon-btn, .link, .control';
  const nodes = document.querySelectorAll(selector);
  nodes.forEach(el => {
    try {
      if ('disabled' in el) el.disabled = disabled;
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
    } catch (e) { console.warn('setAllButtonsDisabled node error', e); }
  });
}
function disableUI(){ setAllButtonsDisabled(true); }
function enableUI(){ setAllButtonsDisabled(false); }

// init
window.addEventListener('DOMContentLoaded', () => {
  bindUIElements();
  initObservers();
  updateTopbarForAuth();
  wireGlobalDrag();

  if (CURRENT_USER && SKYSAFE_TOKEN) {
    // show gallery
    document.body.classList.remove('no-auth');
    document.getElementById('authSection')?.classList.add('hidden');
    document.getElementById('gallerySection')?.classList.remove('hidden');
    loadTheme().then(() => loadGallery(0, INITIAL_LOAD_COUNT));
  } else {
    // show auth and hide gallery
    document.body.classList.add('no-auth');
    document.getElementById('authSection')?.classList.remove('hidden');
    document.getElementById('gallerySection')?.classList.add('hidden');
  }
});

// Bind UI
function bindUIElements() {
  const loginForm = document.getElementById('loginForm');
  const signupToggleBtn = document.getElementById('signupToggleBtn');
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

  if (loginForm) loginForm.onsubmit = e => { e.preventDefault(); handleAuth(); };
  if (signupToggleBtn) signupToggleBtn.onclick = toggleSignup;
  if (loadMoreBtn) loadMoreBtn.onclick = () => loadGallery(IMAGE_URLS.length, LOAD_MORE_COUNT);
  if (themeSelect) themeSelect.onchange = () => saveTheme(themeSelect.value);
  if (browseBtn && imageInput) browseBtn.addEventListener('click', e => { e.preventDefault(); imageInput.click(); });
  if (imageInput) imageInput.onchange = e => { [...e.target.files].forEach(file => uploadImage(file)); imageInput.value=''; };
  if (fabOpen) fabOpen.onclick = () => document.getElementById('fabOptions')?.classList.toggle('hidden');
  if (openCameraBtn) openCameraBtn.onclick = () => { startCamera(); document.getElementById('cameraModal')?.classList.remove('hidden'); };
  if (captureBtn) captureBtn.onclick = () => capturePhoto();
  if (closeCameraBtn) closeCameraBtn.onclick = () => { stopCamera(); document.getElementById('cameraModal')?.classList.add('hidden'); };
  if (saveNoteBtn) saveNoteBtn.onclick = () => { const img = IMAGE_URLS[CURRENT_INDEX]; if (img && img.fileId) saveNoteForImage(img.fileId); };
  if (deleteImageBtn) deleteImageBtn.onclick = deleteCurrentImage;
  if (logoutBtn) logoutBtn.onclick = logoutUser;
}

// TOPBAR visibility for auth
function updateTopbarForAuth() {
  if (!CURRENT_USER) {
    document.body.classList.add('no-auth'); // hides top-right
  } else {
    document.body.classList.remove('no-auth');
  }
}

// THEME
async function loadTheme() {
  if (!CURRENT_USER) { applyTheme(CURRENT_THEME); return; }
  try { disableUI();
    const res = await callAppsScript({ action:'getTheme', userId: CURRENT_USER });
    CURRENT_THEME = res.theme || 'default';
    localStorage.setItem('theme', CURRENT_THEME);
    applyTheme(CURRENT_THEME);
  } catch(e) { console.error(e); applyTheme('default'); }
  finally { enableUI(); }
}
function applyTheme(theme) {
  document.body.className = '';
  document.body.classList.add(`theme-${theme}`);
  if (!CURRENT_USER) document.body.classList.add('no-auth');
}
async function saveTheme(theme) {
  if (!CURRENT_USER || !SKYSAFE_TOKEN) { localStorage.setItem('theme', theme); applyTheme(theme); return; }
  try { disableUI(); await callAppsScript({ action:'saveTheme', userId: CURRENT_USER, theme }); CURRENT_THEME = theme; localStorage.setItem('theme', theme); applyTheme(theme); }
  catch(e){ console.error('Theme save failed', e); } finally { enableUI(); }
}

// AUTH
let isSignupMode = false;
function toggleSignup() {
  isSignupMode = !isSignupMode;
  document.getElementById('authTitle')?.textContent = isSignupMode ? 'Sign Up' : 'Login';
  document.getElementById('signupFields')?.classList.toggle('hidden', !isSignupMode);
  document.getElementById('authSubmitBtn')?.textContent = isSignupMode ? 'Sign up' : 'Continue';
  document.getElementById('signupToggleBtn')?.textContent = isSignupMode ? 'Back to login' : 'Create account';
}

async function handleAuth() {
  const userId = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword')?.value;

  if (!userId || !password) { showMessage("Please fill in all required fields",'error'); return; }
  if (isSignupMode && password !== confirmPassword) { showMessage("Passwords do not match",'error'); return; }

  try {
    disableUI();
    const action = isSignupMode ? 'createUser' : 'verifyLogin';
    const res = await callAppsScript({ action, userId, password });
    if (res.success && res.token) {
      CURRENT_USER = userId;
      SKYSAFE_TOKEN = res.token;
      localStorage.setItem('CURRENT_USER', CURRENT_USER);
      localStorage.setItem('skySafeeToken', SKYSAFE_TOKEN);
      showMessage(isSignupMode ? "Signup successful":"Login successful",'success');
      updateTopbarForAuth();
      document.getElementById('authSection')?.classList.add('hidden');
      document.getElementById('gallerySection')?.classList.remove('hidden');
      await loadTheme();
      IMAGE_URLS = []; document.getElementById('gallery').innerHTML='';
      HAS_MORE = true;
      await loadGallery(0, INITIAL_LOAD_COUNT);
    } else {
      showMessage(res.message || "Authentication failed",'error');
    }
  } catch (e) {
    console.error("Auth error", e);
    showMessage("An error occurred during authentication",'error');
  } finally { enableUI(); }
}

// PAGINATION + GALLERY
function initObservers() {
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          const src = img.dataset.src;
          if (src) {
            img.src = src;
            // once asked to load, unobserve
            observer.unobserve(img);
          }
        }
      });
    }, { rootMargin: '200px' });
  } else {
    observer = null;
  }
}

async function loadGallery(startIndex = 0, limit = INITIAL_LOAD_COUNT) {
  if (!CURRENT_USER || !SKYSAFE_TOKEN) return;
  try {
    disableUI();
    document.getElementById('loadingSpinner')?.classList.remove('hidden');
    const res = await callAppsScript({ action:'getPaginatedImages', startIndex, limit, token: SKYSAFE_TOKEN });
    if (res && res.success && Array.isArray(res.images)) {
      const baseIndex = IMAGE_URLS.length;
      IMAGE_URLS = IMAGE_URLS.concat(res.images);
      renderGallery(res.images, baseIndex);
      // pagination control: if we received fewer than requested, likely no more
      if (res.images.length < limit) {
        HAS_MORE = false;
        document.getElementById('loadMoreBtn')?.classList.add('hidden');
      } else {
        HAS_MORE = true;
        document.getElementById('loadMoreBtn')?.classList.remove('hidden');
      }
    } else {
      console.warn('Unexpected gallery response', res);
    }
  } catch (e) { console.error("Gallery load failed", e); showMessage("Failed to load images",'error'); }
  finally { enableUI(); document.getElementById('loadingSpinner')?.classList.add('hidden'); }
}

function renderGallery(images, baseIndex = 0) {
  const container = document.getElementById('gallery');
  if (!container) return;
  images.forEach((imgObj, idx) => {
    const absoluteIndex = baseIndex + idx;
    const item = createGalleryItem(imgObj, absoluteIndex);
    container.appendChild(item);
  });
}

function createGalleryItem(imgObj, index) {
  const div = document.createElement('div');
  div.className = 'gallery-item';
  div.setAttribute('data-index', String(index));
  div.setAttribute('role', 'button');
  div.setAttribute('tabindex', '0');

  // skeleton placeholder
  const skeleton = document.createElement('div');
  skeleton.className = 'skeleton';
  div.appendChild(skeleton);

  // image element (lazy)
  const img = document.createElement('img');
  img.alt = `SkyLens image ${index+1}`;
  img.dataset.src = imgObj.url || '';
  img.loading = 'lazy';
  img.style.display = 'block';

  // onload: remove skeleton, mark loaded
  img.onload = () => {
    div.classList.add('loaded');
    if (skeleton && skeleton.parentNode) skeleton.remove();
    img.style.opacity = '1';
  };

  img.onerror = () => {
    if (skeleton && skeleton.parentNode) skeleton.remove();
    const broken = document.createElement('div');
    broken.className = 'broken';
    broken.innerHTML = `<div>Failed to load<br><button class="btn" type="button">Retry</button></div>`;
    const retryBtn = broken.querySelector('button');
    retryBtn.onclick = () => {
      // try reloading once
      img.dataset.src && (img.src = img.dataset.src + '?r=' + Date.now());
      if (observer) observer.observe(img);
    };
    div.appendChild(broken);
  };

  div.appendChild(img);

  // wire lazy-loading via IntersectionObserver (or immediate load fallback)
  if (observer) observer.observe(img);
  else { img.src = img.dataset.src; }

  // click opens lightbox
  div.onclick = () => openLightbox(index);

  return div;
}

// IMAGE UPLOAD (optimistic skeleton insertion)
async function uploadImage(file) {
  if (!file || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  const allowedTypes = ['image/jpeg','image/png','image/gif','image/webp'];
  const maxSize = 5*1024*1024;
  if (!allowedTypes.includes(file.type)) { showMessage("Unsupported file type",'error'); return; }
  if (file.size > maxSize) { showMessage("File too large (max 5MB)",'error'); return; }

  // optimistic skeleton at top
  const container = document.getElementById('gallery');
  const placeholder = document.createElement('div');
  placeholder.className = 'gallery-item';
  const sk = document.createElement('div'); sk.className='skeleton';
  placeholder.appendChild(sk);
  container.insertBefore(placeholder, container.firstChild);

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      disableUI();
      const dataUrl = e.target.result;
      const res = await callAppsScript({ action:'uploadToDrive', dataUrl, filename: file.name, token: SKYSAFE_TOKEN });
      if (res.success && res.url) {
        // remove placeholder and refresh gallery from server (safer)
        placeholder.remove();
        IMAGE_URLS = [];
        document.getElementById('gallery').innerHTML = '';
        HAS_MORE = true;
        await loadGallery(0, INITIAL_LOAD_COUNT);
        showMessage("Upload successful",'success');
      } else {
        placeholder.remove();
        showMessage(res.message || "Upload failed",'error');
      }
    } catch (err) {
      placeholder.remove();
      console.error("Upload error", err);
      showMessage("Upload failed",'error');
    } finally { enableUI(); }
  };
  reader.readAsDataURL(file);
}

// LIGHTBOX
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
function closeLightbox() { document.getElementById('lightbox')?.classList.add('hidden'); }
function updateLightboxImage() {
  const imgObj = IMAGE_URLS[CURRENT_INDEX];
  if (!imgObj) return;
  const lbImg = document.getElementById('lightboxImage');
  if (lbImg) lbImg.src = imgObj.url;
}
function nextImage(){ if (CURRENT_INDEX < IMAGE_URLS.length-1) { CURRENT_INDEX++; updateLightboxImage(); const i=IMAGE_URLS[CURRENT_INDEX]; if(i.fileId) loadNoteForImage(i.fileId); } }
function prevImage(){ if (CURRENT_INDEX>0){ CURRENT_INDEX--; updateLightboxImage(); const i=IMAGE_URLS[CURRENT_INDEX]; if(i.fileId) loadNoteForImage(i.fileId); } }

async function deleteCurrentImage() {
  if (CURRENT_INDEX<0 || !IMAGE_URLS[CURRENT_INDEX]) return;
  const imgData = IMAGE_URLS[CURRENT_INDEX];
  try {
    disableUI();
    const res = await callAppsScript({ action:'deleteImage', fileId: imgData.fileId, token: SKYSAFE_TOKEN });
    if (res.success) {
      showMessage("Image deleted",'success');
      IMAGE_URLS.splice(CURRENT_INDEX,1);
      document.getElementById('gallery').innerHTML='';
      IMAGE_URLS=[]; HAS_MORE=true;
      await loadGallery(0, INITIAL_LOAD_COUNT);
      closeLightbox();
    } else showMessage(res.message || "Delete failed",'error');
  } catch(e){ console.error("Delete error",e); showMessage("Delete failed",'error'); }
  finally { enableUI(); }
}

// CAMERA
let videoStream = null;
async function startCamera() {
  try { videoStream = await navigator.mediaDevices.getUserMedia({ video:true }); const videoEl=document.getElementById('cameraPreview'); if(videoEl){ videoEl.srcObject=videoStream; videoEl.play(); } } catch(e){ console.error(e); showMessage("Unable to access camera",'error'); }
}
function capturePhoto() {
  const videoEl = document.getElementById('cameraPreview'); if(!videoEl) return;
  const canvas = document.createElement('canvas'); canvas.width = videoEl.videoWidth; canvas.height = videoEl.videoHeight; canvas.getContext('2d').drawImage(videoEl,0,0);
  canvas.toBlob(blob => { const file = new File([blob], `camera_${Date.now()}.png`, { type:'image/png' }); uploadImage(file); }, 'image/png');
}
function stopCamera(){ if(videoStream){ videoStream.getTracks().forEach(t=>t.stop()); videoStream=null; } }

// NOTES
async function loadNoteForImage(fileId) {
  if (!fileId || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  try { disableUI();
    const res = await callAppsScript({ action:'getImageNote', fileId, token: SKYSAFE_TOKEN });
    if (res.success) document.getElementById('imageNote').value = res.note || '';
  } catch(e){ console.error("Note load failed", e); } finally { enableUI(); }
}
async function saveNoteForImage(fileId) {
  const note = document.getElementById('imageNote').value || '';
  if (!fileId || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  try { disableUI();
    const res = await callAppsScript({ action:'saveImageNote', fileId, note, token: SKYSAFE_TOKEN });
    if (res.success) showMessage("Note saved",'success'); else showMessage(res.message || "Save failed",'error');
  } catch(e){ console.error("Note save failed", e); showMessage("Save failed",'error'); } finally { enableUI(); }
}

// LOGOUT
async function logoutUser() {
  if (!CURRENT_USER || !SKYSAFE_TOKEN) return;
  try { disableUI(); await callAppsScript({ action:'logout', token: SKYSAFE_TOKEN }); } catch(e){ console.warn(e); } finally {
    localStorage.removeItem('CURRENT_USER'); localStorage.removeItem('skySafeeToken'); CURRENT_USER=null; SKYSAFE_TOKEN=null;
    IMAGE_URLS=[]; document.getElementById('gallery').innerHTML=''; updateTopbarForAuth();
    document.getElementById('authSection')?.classList.remove('hidden'); document.getElementById('gallerySection')?.classList.add('hidden');
    enableUI();
  }
}

// FULLSCREEN DRAG UX
function wireGlobalDrag() {
  const overlay = document.getElementById('fullDropOverlay');
  if (!overlay) return;

  // dragenter/dragleave counters to avoid flicker
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    overlay.classList.remove('hidden');
  });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter = Math.max(0, dragCounter-1);
    if (dragCounter === 0) overlay.classList.add('hidden');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.add('hidden');
    // process files
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) files.forEach(f => uploadImage(f));
  });
}

// end of file
