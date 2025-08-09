// ==========================
// 🔧 CONFIGURATION
// =========================
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzy3ZTT2YpSxJgGPHmPbqD1iR60zBzv_Vr52PR1s4cvWDvH6gW4P4_mOXpJocUhFHFjwQ/exec';
const INITIAL_LOAD_COUNT = 4;
const LOAD_MORE_COUNT = 20;

// ==========================
// ♻️ FRONTEND CACHE (sessionStorage)
// =========================
const PAGE_CACHE_PREFIX = 'sky_pages_v1_'; // key prefix for page caching in sessionStorage
function getCachedPage(start, limit) {
  try {
    const key = PAGE_CACHE_PREFIX + start + '_' + limit;
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function setCachedPage(start, limit, payload) {
  try {
    const key = PAGE_CACHE_PREFIX + start + '_' + limit;
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch (e) { /* ignore */ }
}
function clearAllPageCache() {
  try {
    for (let k of Object.keys(sessionStorage)) {
      if (k.startsWith(PAGE_CACHE_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch (e) { /* ignore */ }
}

// ==========================
// ⚙️ STATE & DOM REFS
// =========================
let HAS_MORE_IMAGES = true;
let NEXT_START_INDEX = 0;
let isSignupMode = false;

const noteBtn        = document.getElementById('lightboxNoteBtn');
const notePanel      = document.getElementById('notePanel');
const noteTextarea   = document.getElementById('noteTextarea');
const editNoteBtn    = document.getElementById('editNoteBtn');
const saveNoteBtn    = document.getElementById('saveNoteBtn');

const authBox        = document.getElementById('authBox');
const galleryContainer = document.getElementById('galleryContainer');
const galleryEl      = document.getElementById('gallery');
const loadMoreBtn    = document.getElementById('loadMoreBtn');
const loadingSpinner = document.getElementById('loadingSpinner');

let CURRENT_USER = localStorage.getItem('skySafeeUser');
let IMAGE_URLS = [];       // canonical array of urls (source of truth)
let CURRENT_INDEX = -1;    // index into IMAGE_URLS for lightbox

// ==========================
// 🧩 LAZY LOADING (IntersectionObserver)
// =========================
let io = null;
function ensureObserver() {
  if (io) return;
  io = new IntersectionObserver(entries => {
    for (const ent of entries) {
      if (!ent.isIntersecting) continue;
      const img = ent.target;
      const src = img.dataset.src;
      if (src) {
        img.src = src;
        img.removeAttribute('data-src');
      }
      io.unobserve(img);
    }
  }, { rootMargin: '200px', threshold: 0.01 });
}

// ==========================
// 📞 API HELPER
// =========================
let apiInFlight = false;
async function callAppsScript(action, params = {}) {
  try {
    const token = localStorage.getItem('skySafeeToken');
    const mergedParams = { ...params, token };

    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, params: mergedParams }),
      redirect: 'follow'
    });

    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error('API Error:', error);
    return { success: false, message: error.message };
  }
}

// ==========================
// 🎨 THEME LOGIC (unchanged)
// =========================
const THEMES = {
  default: { bg: "#fff", fg: "#333", card: "#f9f9f9", btn: "#4caf50" },
  dark:    { bg: "#121212", fg: "#f0f0f0", card: "#1e1e1e", btn: "#2196f3" },
  ocean:   { bg: "#001f3f", fg: "#ffffff", card: "#003366", btn: "#00aced" },
  sunset:  { bg: "#2e1a47", fg: "#ffd1dc", card: "#5c2a9d", btn: "#ff5e5e" }
};

function applyTheme(theme) {
  Object.entries(theme).forEach(([k, v]) => {
    document.documentElement.style.setProperty(`--${k}`, v);
  });
}

async function loadTheme() {
  const cachedTheme = localStorage.getItem('skySafeeTheme');
  if (cachedTheme && THEMES[cachedTheme]) applyTheme(THEMES[cachedTheme]);

  const res = await callAppsScript('getTheme', { userId: CURRENT_USER });
  const themeName = res.success ? res.theme : 'default';

  if (themeName && themeName !== cachedTheme) {
    localStorage.setItem('skySafeeTheme', themeName);
    applyTheme(THEMES[themeName] || THEMES.default);
  }

  const select = document.getElementById('themeSelect');
  if (select) select.value = themeName;
}
async function changeTheme(themeName) {
  applyTheme(THEMES[themeName]);
  localStorage.setItem('skySafeeTheme', themeName);
  await callAppsScript('saveTheme', { userId: CURRENT_USER, themeName });
}

// ==========================
// 🔐 AUTH LOGIC (unchanged mostly)
// =========================
function toggleMode(e) {
  e.preventDefault();
  isSignupMode = !isSignupMode;
  document.getElementById('authTitle').textContent = isSignupMode ? 'Create an Account' : 'Login to SkySafee';
  document.querySelector('#authBox button').textContent = isSignupMode ? 'Sign Up' : 'Login';
  document.getElementById('authConfirm').classList.toggle('hidden', !isSignupMode);
  document.getElementById('authError').textContent = '';
}
function showError(msg) { document.getElementById('authError').textContent = msg; }

async function handleAuth() {
  const uid = document.getElementById('authUser').value.trim();
  const pwd = document.getElementById('authPass').value;
  const isSignup = isSignupMode;

  if (!uid || !pwd) return showError("Fill all fields.");
  if (isSignup && pwd !== document.getElementById('authConfirm').value) return showError("Passwords don't match.");

  const button = document.querySelector('#authBox button');
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = isSignup ? 'Signing up...' : 'Logging in...';

  const action = isSignup ? 'createUser' : 'verifyLogin';
  const res = await callAppsScript(action, { userId: uid, password: pwd });

  button.disabled = false;
  button.textContent = originalText;

  if (res.success) {
    CURRENT_USER = uid;
    localStorage.setItem('skySafeeUser', uid);
    localStorage.setItem('skySafeeToken', res.token);
    authBox.classList.add('hidden');
    galleryContainer.classList.remove('hidden');
    clearAllPageCache(); // ensure no stale pages from previous user
    loadTheme();
    await loadImages(true);
  } else {
    showError(res.message || 'Error');
  }
}

// ==========================
// 🖼️ GALLERY: DOM helpers & event delegation
// =========================
ensureObserver();

function createGalleryItemNode(url) {
  const div = document.createElement('div');
  div.className = 'gallery-item';
  div.dataset.url = url;

  const skeleton = document.createElement('div');
  skeleton.className = 'skeleton';
  div.appendChild(skeleton);

  const img = document.createElement('img');
  img.className = 'lazy';
  img.alt = 'photo';
  img.setAttribute('data-src', url);
  img.style.display = 'none';
  img.onload = () => {
    skeleton.remove();
    img.style.display = '';
  };

  div.appendChild(img);
  // observer will pick up the img and set src when in view
  io.observe(img);

  return div;
}

// Delegated click: open lightbox by url
galleryEl.addEventListener('click', (e) => {
  const item = e.target.closest('.gallery-item');
  if (!item) return;
  const url = item.dataset.url;
  openLightboxByUrl(url);
});

// Add a batch of images (append)
function appendImagesBatch(urls) {
  if (!urls || !urls.length) return;
  const frag = document.createDocumentFragment();
  for (const url of urls) {
    frag.appendChild(createGalleryItemNode(url));
  }
  galleryEl.appendChild(frag);
}

// Prepend single image (for upload) without re-rendering all
function prependImage(url) {
  IMAGE_URLS.unshift(url);
  const node = createGalleryItemNode(url);
  const first = galleryEl.firstChild;
  if (first) galleryEl.insertBefore(node, first);
  else galleryEl.appendChild(node);
  // clear page cache because ordering changed server-side
  clearAllPageCache();
}

// Remove image node by url
function removeImageNodeByUrl(url) {
  const node = galleryEl.querySelector(`.gallery-item[data-url="${cssEscape(url)}"]`);
  if (node) node.remove();
}

// helper for querySelector when url has special chars
function cssEscape(str) {
  return str.replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g,'\\$1');
}

// ==========================
// 🏎️ FAST PAGINATION + frontend caching
// =========================
let isLoadingImages = false;
async function loadImages(reset = false) {
  if (!CURRENT_USER) return;
  if (isLoadingImages) return;

  if (reset) {
    IMAGE_URLS = [];
    NEXT_START_INDEX = 0;
    HAS_MORE_IMAGES = true;
    // remove all children efficiently
    while (galleryEl.lastChild) galleryEl.removeChild(galleryEl.lastChild);
  }

  if (!HAS_MORE_IMAGES) return;

  isLoadingImages = true;
  loadMoreBtn && loadMoreBtn.classList.add('hidden');
  loadingSpinner && loadingSpinner.classList.remove('hidden');

  const start = NEXT_START_INDEX;
  const limit = reset ? INITIAL_LOAD_COUNT : LOAD_MORE_COUNT;

  // try frontend cache first
  const cached = getCachedPage(start, limit);
  if (cached) {
    IMAGE_URLS.push(...cached.urls);
    appendImagesBatch(cached.urls);
    NEXT_START_INDEX = cached.nextStart || IMAGE_URLS.length;
    HAS_MORE_IMAGES = cached.hasMore;
    isLoadingImages = false;
    loadingSpinner && loadingSpinner.classList.add('hidden');
    loadMoreBtn && loadMoreBtn.classList.toggle('hidden', !HAS_MORE_IMAGES);
    return;
  }

  // call server
  const res = await callAppsScript('getPaginatedImages', { startIndex: start, limit });
  if (res.success) {
    const batch = res.urls || [];
    // update state and DOM in one pass
    IMAGE_URLS.push(...batch);
    appendImagesBatch(batch);

    const nextStart = res.nextStart || IMAGE_URLS.length;
    const hasMore = !!res.hasMore;

    NEXT_START_INDEX = nextStart;
    HAS_MORE_IMAGES = hasMore;

    // cache page for session
    setCachedPage(start, limit, { urls: batch, nextStart, hasMore });
  } else {
    alert("Failed to load images: " + res.message);
  }

  isLoadingImages = false;
  loadingSpinner && loadingSpinner.classList.add('hidden');
  loadMoreBtn && loadMoreBtn.classList.toggle('hidden', !HAS_MORE_IMAGES);
}

// attach load more
loadMoreBtn && (loadMoreBtn.onclick = () => loadImages());

// ==========================
// 🖱 UPLOAD / DROP / CAMERA (faster UX, optimistic prepend)
// =========================
function processAndUpload(file) {
  if (!file.type.startsWith('image/')) return;

  // show optimistic skeleton at top
  const tempNode = createGalleryItemNode(''); // empty data-src -> will be blank skeleton
  galleryEl.insertBefore(tempNode, galleryEl.firstChild);

  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    // disable multiple uploads concurrently? we still allow multiple but UX wise we can disable upload button if present
    const res = await callAppsScript('uploadToDrive', { dataUrl, filename: file.name });

    // remove temp node
    tempNode.remove();

    if (res.success) {
      // prepend new node & update state without full re-render
      prependImage(res.url);
    } else {
      alert('Upload failed: ' + res.message);
    }
  };
  reader.readAsDataURL(file);
}

const imageInput = document.getElementById('imageInput');
imageInput && (imageInput.onchange = e => [...e.target.files].forEach(processAndUpload));

const dropZone = document.getElementById('dropZone');
if (dropZone) {
  dropZone.addEventListener('click', () => document.getElementById('imageInput').click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.background = "rgba(33,150,243,0.2)"; });
  dropZone.addEventListener('dragleave', e => { e.preventDefault(); dropZone.style.background = "var(--drop-bg)"; });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.background = "var(--drop-bg)";
    [...e.dataTransfer.files].forEach(processAndUpload);
  });
}

// ==========================
// 💡 LIGHTBOX (open by url -> compute index)
// =========================
function openLightboxByUrl(url) {
  const index = IMAGE_URLS.indexOf(url);
  if (index === -1) {
    // fallback: set image directly without changing IMAGE_URLS
    document.getElementById('lightboxImage').src = url;
    CURRENT_INDEX = -1;
  } else {
    CURRENT_INDEX = index;
    document.getElementById('lightboxImage').src = IMAGE_URLS[index];
  }
  notePanel.classList.add('hidden');
  noteTextarea.value = '';
  noteTextarea.readOnly = true;
  editNoteBtn.classList.add('hidden');
  saveNoteBtn.classList.add('hidden');
  document.getElementById('lightboxOverlay').classList.remove('hidden');
}

function closeLightbox() { document.getElementById('lightboxOverlay').classList.add('hidden'); }

function showNext() {
  if (IMAGE_URLS.length === 0) return;
  if (CURRENT_INDEX === -1) return;
  CURRENT_INDEX = (CURRENT_INDEX + 1) % IMAGE_URLS.length;
  openLightboxByUrl(IMAGE_URLS[CURRENT_INDEX]);
}

function showPrev() {
  if (IMAGE_URLS.length === 0) return;
  if (CURRENT_INDEX === -1) return;
  CURRENT_INDEX = (CURRENT_INDEX - 1 + IMAGE_URLS.length) % IMAGE_URLS.length;
  openLightboxByUrl(IMAGE_URLS[CURRENT_INDEX]);
}

// Delete image (optimistic UI + server call + cache clear)
async function deleteCurrentImage() {
  const url = CURRENT_INDEX >= 0 ? IMAGE_URLS[CURRENT_INDEX] : document.getElementById('lightboxImage').src;
  if (!url || !confirm('Delete this image permanently?')) return;

  // optimistic remove UI first
  removeImageNodeByUrl(url);
  if (CURRENT_INDEX >= 0) IMAGE_URLS.splice(CURRENT_INDEX, 1);

  // clear local page cache
  clearAllPageCache();

  const res = await callAppsScript('deleteImage', { imageUrl: url });

  if (res.success) {
    // success — nothing else needed (already removed)
  } else {
    alert("Delete failed: " + res.message);
    // ideally re-fetch the current page or re-add node — for simplicity, reload first page
    await loadImages(true);
  }

  notePanel.classList.add('hidden');
  noteTextarea.value = '';
  noteTextarea.readOnly = true;
  editNoteBtn.classList.add('hidden');
  saveNoteBtn.classList.add('hidden');
  closeLightbox();
}

// bind lightbox controls
document.getElementById('lightboxClose').onclick = closeLightbox;
document.getElementById('lightboxNext').onclick = showNext;
document.getElementById('lightboxPrev').onclick = showPrev;
document.getElementById('lightboxDelete').onclick = deleteCurrentImage;
document.addEventListener('keydown', e => {
  if (document.getElementById('lightboxOverlay').classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowRight') showNext();
  if (e.key === 'ArrowLeft') showPrev();
});

// ==========================
// 📷 CAMERA (unchanged behaviour)
// =========================
let videoStream = null;
let cropper = null;
let cameraDevices = [];
let currentCameraIndex = 0;

async function openCamera() {
  document.getElementById('cameraModal').classList.remove('hidden');
  try {
    cameraDevices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    if (!cameraDevices.length) throw new Error("No camera found");
    currentCameraIndex = 0;
    startCamera(cameraDevices[0].deviceId);
  } catch (err) {
    alert("Camera error: " + err.message);
    closeCamera();
  }
}

function startCamera(deviceId) {
  if (videoStream) videoStream.getTracks().forEach(track => track.stop());
  navigator.mediaDevices.getUserMedia({
    video: { deviceId: deviceId ? { exact: deviceId } : undefined, facingMode: 'environment' }
  }).then(stream => {
    videoStream = stream;
    document.getElementById('cameraVideo').srcObject = stream;
  }).catch(() => {
    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      videoStream = stream;
      document.getElementById('cameraVideo').srcObject = stream;
    }).catch(() => alert("Camera access denied"));
  });
}

function switchCamera() {
  if (cameraDevices.length <= 1) return;
  currentCameraIndex = (currentCameraIndex + 1) % cameraDevices.length;
  startCamera(cameraDevices[currentCameraIndex].deviceId);
}

function captureImage() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  const image = document.getElementById('cameraImage');

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  image.src = canvas.toDataURL('image/png');
  image.classList.remove('hidden');
  document.getElementById('cropperContainer').classList.remove('hidden');
  video.classList.add('hidden');
  document.getElementById('uploadButton').classList.remove('hidden');

  if (cropper) cropper.destroy();
  cropper = new Cropper(image, { aspectRatio: NaN, viewMode: 1 });
}

function cropAndUpload() {
  if (!cropper) return;
  cropper.getCroppedCanvas().toBlob(blob => {
    processAndUpload(new File([blob], `webcam_${Date.now()}.png`, { type: 'image/png' }));
    closeCamera();
  }, 'image/png');
}

function closeCamera() {
  if (videoStream) videoStream.getTracks().forEach(track => track.stop());
  if (cropper) cropper.destroy();
  cropper = null;
  videoStream = null;
  document.getElementById('cameraModal').classList.add('hidden');
  document.getElementById('cameraImage').classList.add('hidden');
  document.getElementById('cameraVideo').classList.remove('hidden');
  document.getElementById('uploadButton').classList.add('hidden');
}

// ==========================
// 📝 NOTES (unchanged behaviour; you can cache client-side later)
// =========================
noteBtn.onclick = async () => {
  const isOpen = !notePanel.classList.contains('hidden');
  if (isOpen) { notePanel.classList.add('hidden'); return; }
  notePanel.classList.remove('hidden');

  const url = CURRENT_INDEX >= 0 ? IMAGE_URLS[CURRENT_INDEX] : document.getElementById('lightboxImage').src;
  const res = await callAppsScript('getImageNote', { imageUrl: url });
  if (res.success) currentNote = res.note || '';
  else { currentNote = ''; console.warn('getImageNote error:', res.message); }

  noteTextarea.value = currentNote;
  if (currentNote) {
    noteTextarea.readOnly = true;
    editNoteBtn.classList.remove('hidden');
    saveNoteBtn.classList.add('hidden');
  } else {
    noteTextarea.readOnly = false;
    editNoteBtn.classList.add('hidden');
    saveNoteBtn.classList.remove('hidden');
  }
};

editNoteBtn.onclick = () => {
  noteTextarea.readOnly = false;
  editNoteBtn.classList.add('hidden');
  saveNoteBtn.classList.remove('hidden');
  noteTextarea.focus();
};

saveNoteBtn.onclick = async () => {
  const url = CURRENT_INDEX >= 0 ? IMAGE_URLS[CURRENT_INDEX] : document.getElementById('lightboxImage').src;
  const newNote = noteTextarea.value.trim();
  saveNoteBtn.disabled = true;
  saveNoteBtn.textContent = 'Saving…';
  const res = await callAppsScript('saveImageNote', { imageUrl: url, note: newNote });
  saveNoteBtn.disabled = false;
  saveNoteBtn.textContent = 'Save';
  if (res.success) {
    currentNote = newNote;
    noteTextarea.readOnly = true;
    saveNoteBtn.classList.add('hidden');
    editNoteBtn.classList.remove('hidden');
    const toast = document.createElement('div');
    toast.textContent = '✓ Note saved';
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = 'var(--btn-bg)';
    toast.style.color = '#fff';
    toast.style.padding = '0.6rem 1rem';
    toast.style.borderRadius = '5px';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  } else {
    alert('Failed to save note: ' + res.message);
  }
};

// ==========================
// 🚀 INIT
// =========================
window.addEventListener('load', async () => {
  IMAGE_URLS = [];
  if (CURRENT_USER) {
    authBox.classList.add('hidden');
    galleryContainer.classList.remove('hidden');
    await loadTheme();
    await loadImages(true);
  }
});

// LOGOUT
document.getElementById('logoutButton').onclick = async () => {
  const btn = document.getElementById('logoutButton');
  btn.disabled = true;
  btn.textContent = "Logging out...";
  try {
    const token = localStorage.getItem('skySafeeToken');
    if (token) await callAppsScript('logout', { token });
  } catch (err) { console.warn("Logout error:", err.message); }
  localStorage.removeItem('skySafeeUser');
  localStorage.removeItem('skySafeeFolder');
  localStorage.removeItem('skySafeeToken');
  localStorage.removeItem('skySafeeTheme');
  sessionStorage.clear();
  setTimeout(() => location.reload(), 500);
};
