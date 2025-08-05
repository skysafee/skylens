// ==========================
// 🔧 CONFIGURATION
// ==========================
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzy3ZTT2YpSxJgGPHmPbqD1iR60zBzv_Vr52PR1s4cvWDvH6gW4P4_mOXpJocUhFHFjwQ/exec';
const INITIAL_LOAD_COUNT = 4;
const LOAD_MORE_COUNT = 20;
let HAS_MORE_IMAGES = true;
let NEXT_START_INDEX = 0;
let isSignupMode = false;
// ── Note Feature Handlers ───────────────────────────────────────────────────

// Cache DOM refs
const noteBtn        = document.getElementById('lightboxNoteBtn');
const notePanel      = document.getElementById('notePanel');
const noteTextarea   = document.getElementById('noteTextarea');
const editNoteBtn    = document.getElementById('editNoteBtn');
const saveNoteBtn    = document.getElementById('saveNoteBtn');

let currentNote = '';  // to store fetched note

// ==========================
// 🌍 GLOBAL STATE
// ==========================
let CURRENT_USER = localStorage.getItem('skySafeeUser');
let IMAGE_URLS = [];
let CURRENT_INDEX = -1;
let videoStream = null;
let cropper = null;
let cameraDevices = [];
let currentCameraIndex = 0;

// ==========================
// ✨ PWA Service Worker
// ==========================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then(() => console.log('ServiceWorker registered'))
      .catch(err => console.error('ServiceWorker registration failed:', err));
  });
}
navigator.serviceWorker?.addEventListener('message', event => {
  if (event.data?.type === 'SKY_UPDATE') {
    const banner = document.createElement('div');
    banner.textContent = "SkyLens was updated!";
    banner.style.position = 'fixed';
    banner.style.bottom = '20px';
    banner.style.left = '50%';
    banner.style.transform = 'translateX(-50%)';
    banner.style.background = '#4caf50';
    banner.style.color = '#fff';
    banner.style.padding = '0.8rem 1.2rem';
    banner.style.borderRadius = '8px';
    banner.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    banner.style.zIndex = '9999';
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 8000);
  }
});
// ==========================
// 📞 API HELPER
// ==========================
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
// 🎨 THEME LOGIC
// ==========================
const THEMES = {
  default: { bg: "#fff", fg: "#333", card: "#f9f9f9", btn: "#4caf50" },
  dark:    { bg: "#121212", fg: "#f0f0f0", card: "#1e1e1e", btn: "#2196f3" },
  ocean:   { bg: "#001f3f", fg: "#ffffff", card: "#003366", btn: "#00aced" },
  sunset:  { bg: "#2e1a47", fg: "#ffd1dc", card: "#5c2a9d", btn: "#ff5e5e" }
};

function updateOnlineStatus() {
  const banner = document.getElementById('offlineStatus');
  if (!banner) return;

  if (!navigator.onLine) {
    banner.textContent = "You're offline";
    banner.classList.remove('hidden');
  } else {
    banner.textContent = "You're back online!";
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('hidden'), 3000);
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

function applyTheme(theme) {
  Object.entries(theme).forEach(([k, v]) => {
    document.documentElement.style.setProperty(`--${k}`, v);
  });
}

async function loadTheme() {
  const cachedTheme = localStorage.getItem('skySafeeTheme');
  if (cachedTheme && THEMES[cachedTheme]) {
    applyTheme(THEMES[cachedTheme]);
  }

  const res = await callAppsScript('getTheme', { userId: CURRENT_USER });
  const themeName = res.success ? res.theme : 'default';

  if (themeName !== cachedTheme) {
    localStorage.setItem('skySafeeTheme', themeName);
    applyTheme(THEMES[themeName] || THEMES.default);
  }

  document.getElementById('themeSelect').value = themeName;
}

async function changeTheme(themeName) {
  applyTheme(THEMES[themeName]);
  localStorage.setItem('skySafeeTheme', themeName);
  await callAppsScript('saveTheme', { userId: CURRENT_USER, themeName });
}

// ==========================
// 🔐 AUTH LOGIC
// ==========================
function toggleMode(e) {
  e.preventDefault();
  isSignupMode = !isSignupMode;

  document.getElementById('authTitle').textContent = isSignupMode ? 'Create an Account' : 'Login to SkySafee';
  document.querySelector('#authBox button').textContent = isSignupMode ? 'Sign Up' : 'Login';
  document.getElementById('authConfirm').classList.toggle('hidden', !isSignupMode);
  document.getElementById('authError').textContent = '';
}

function showError(msg) {
  document.getElementById('authError').textContent = msg;
}

async function handleAuth() {
  const uid = document.getElementById('authUser').value.trim();
  const pwd = document.getElementById('authPass').value;
  const isSignup = isSignupMode;

  if (!uid || !pwd) return showError("Fill all fields.");
  if (isSignup && pwd !== document.getElementById('authConfirm').value) return showError("Passwords don't match.");

  const action = isSignup ? 'createUser' : 'verifyLogin';
  const button = document.querySelector('#authBox button');
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = isSignup ? 'Signing up...' : 'Logging in...';

  const res = await callAppsScript(action, { userId: uid, password: pwd });

  button.disabled = false;
  button.textContent = originalText;

  if (res.success) {
    CURRENT_USER = uid;
    localStorage.setItem('skySafeeUser', uid);
    localStorage.setItem('skySafeeToken', res.token);
    document.getElementById('authBox').classList.add('hidden');
    document.getElementById('galleryContainer').classList.remove('hidden');
    loadTheme();
    loadImages(true);
  } else {
    showError(res.message || 'Error');
  }
}
// ==========================
// 🖼️ GALLERY & PAGINATION
// ==========================
async function loadImages(reset = false) {
  if (!CURRENT_USER) return;

  const btn = document.getElementById('loadMoreBtn');
  const spinner = document.getElementById('loadingSpinner');

  if (reset) {
    IMAGE_URLS = [];
    NEXT_START_INDEX = 0;
    HAS_MORE_IMAGES = true;

    const gallery = document.getElementById('gallery');
    while (gallery.firstChild) {
      gallery.removeChild(gallery.firstChild);
    }
  }

  if (!HAS_MORE_IMAGES) return;

  if (btn) btn.classList.add('hidden');
  if (spinner) spinner.classList.remove('hidden');

  const res = await callAppsScript('getPaginatedImages', {
    startIndex: NEXT_START_INDEX,
    limit: reset ? INITIAL_LOAD_COUNT : LOAD_MORE_COUNT
  });

  if (res.success) {
    const batch = res.urls || [];
    batch.forEach(url => {
      IMAGE_URLS.push(url);
      addImageToDOM(url, IMAGE_URLS.length - 1);
    });
    NEXT_START_INDEX = res.nextStart || IMAGE_URLS.length;
    HAS_MORE_IMAGES = res.hasMore;
  } else {
    alert("Failed to load images: " + res.message);
  }

  if (spinner) spinner.classList.add('hidden');
  if (btn) btn.classList.toggle('hidden', !HAS_MORE_IMAGES);
}

function addImageToDOM(url, index) {
  const div = document.createElement('div');
  div.className = 'gallery-item';
  div.dataset.index = index;
  div.dataset.url = url;

  const skeleton = document.createElement('div');
  skeleton.className = 'skeleton';
  div.appendChild(skeleton);

  const img = document.createElement('img');
  img.style.display = 'none';
  img.onload = () => {
    skeleton.remove();
    img.style.display = '';
  };
  img.src = url;
  img.onclick = () => openLightbox(index);

  div.appendChild(img);
  document.getElementById('gallery').appendChild(div);
}

function processAndUpload(file) {
  if (!file.type.startsWith('image/')) return;

  const reader = new FileReader();
  const tempDiv = document.createElement('div');
  tempDiv.className = 'gallery-item';
  const skeleton = document.createElement('div');
  skeleton.className = 'skeleton';
  tempDiv.appendChild(skeleton);
  document.getElementById('gallery').prepend(tempDiv);

  reader.onload = async () => {
    const dataUrl = reader.result;
    const res = await callAppsScript('uploadToDrive', {
      dataUrl,
      filename: file.name
    });
    tempDiv.remove();
    if (res.success) {
      IMAGE_URLS.unshift(res.url);
      document.getElementById('gallery').innerHTML = '';
      IMAGE_URLS.forEach((u, i) => addImageToDOM(u, i));
    } else {
      alert('Upload failed: ' + res.message);
    }
  };
  reader.readAsDataURL(file);
}

document.getElementById('imageInput').onchange = e => [...e.target.files].forEach(processAndUpload);

const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('click', () => document.getElementById('imageInput').click());
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.style.background = "rgba(33,150,243,0.2)";
});
dropZone.addEventListener('dragleave', e => {
  e.preventDefault();
  dropZone.style.background = "var(--drop-bg)";
});
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.style.background = "var(--drop-bg)";
  [...e.dataTransfer.files].forEach(processAndUpload);
});

// ==========================
// 💡 LIGHTBOX
// ==========================
function openLightbox(index) {
  CURRENT_INDEX = index;
  document.getElementById('lightboxImage').src = IMAGE_URLS[index];
  document.getElementById('lightboxOverlay').classList.remove('hidden');
}

function closeLightbox() {
  document.getElementById('lightboxOverlay').classList.add('hidden');
}

function showNext() {
  CURRENT_INDEX = (CURRENT_INDEX + 1) % IMAGE_URLS.length;
  openLightbox(CURRENT_INDEX);
}

function showPrev() {
  CURRENT_INDEX = (CURRENT_INDEX - 1 + IMAGE_URLS.length) % IMAGE_URLS.length;
  openLightbox(CURRENT_INDEX);
}

async function deleteCurrentImage() {
  const url = IMAGE_URLS[CURRENT_INDEX];
  if (!url || !confirm('Delete this image permanently?')) return;

  const res = await callAppsScript('deleteImage', {
    imageUrl: url
  });

  if (res.success) {
    document.querySelector(`.gallery-item[data-url="${url}"]`)?.remove();
    IMAGE_URLS.splice(CURRENT_INDEX, 1);
    closeLightbox();
  } else {
    alert("Delete failed: " + res.message);
  }
}

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
// 📷 CAMERA
// ==========================
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

// Show/hide panel
noteBtn.onclick = async () => {
  // Toggle panel visibility
  const isOpen = !notePanel.classList.contains('hidden');
  if (isOpen) {
    notePanel.classList.add('hidden');
    return;
  }
  notePanel.classList.remove('hidden');

  // Fetch existing note
  const url = IMAGE_URLS[CURRENT_INDEX];
  const res = await callAppsScript('getImageNote', { imageUrl: url });
  if (res.success) {
    currentNote = res.note || '';
  } else {
    currentNote = '';
    console.warn('getImageNote error:', res.message);
  }

  // Populate textarea & determine state
  noteTextarea.value = currentNote;
  if (currentNote) {
    // Existing note: readonly + show Edit
    noteTextarea.readOnly = true;
    editNoteBtn.classList.remove('hidden');
    saveNoteBtn.classList.add('hidden');
  } else {
    // No note: editable + show Save
    noteTextarea.readOnly = false;
    editNoteBtn.classList.add('hidden');
    saveNoteBtn.classList.remove('hidden');
  }
};

// Enable editing
editNoteBtn.onclick = () => {
  noteTextarea.readOnly = false;
  editNoteBtn.classList.add('hidden');
  saveNoteBtn.classList.remove('hidden');
  noteTextarea.focus();
};

// Save note
saveNoteBtn.onclick = async () => {
  const url = IMAGE_URLS[CURRENT_INDEX];
  const newNote = noteTextarea.value.trim();

  // Disable button while saving
  saveNoteBtn.disabled = true;
  saveNoteBtn.textContent = 'Saving…';

  const res = await callAppsScript('saveImageNote', {
    imageUrl: url,
    note: newNote
  });

  // Restore button
  saveNoteBtn.disabled = false;
  saveNoteBtn.textContent = 'Save';

  if (res.success) {
    currentNote = newNote;
    // Switch back to readonly and toggle buttons
    noteTextarea.readOnly = true;
    saveNoteBtn.classList.add('hidden');
    editNoteBtn.classList.remove('hidden');
    // Quick feedback
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
// ==========================
window.onload = () => {
  IMAGE_URLS = [];

  if (CURRENT_USER) {
    document.getElementById('authBox').classList.add('hidden');
    document.getElementById('galleryContainer').classList.remove('hidden');
    loadTheme();
    loadImages(true);
  }
};

document.getElementById('logoutButton').onclick = async () => {
  const btn = document.getElementById('logoutButton');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Logging out...";

  try {
    const token = localStorage.getItem('skySafeeToken');
    if (token) await callAppsScript('logout', { token });
  } catch (err) {
    console.warn("Logout error:", err.message);
  }

  localStorage.removeItem('skySafeeUser');
  localStorage.removeItem('skySafeeFolder');
  localStorage.removeItem('skySafeeToken');
  localStorage.removeItem('skySafeeTheme');
  sessionStorage.clear();

  setTimeout(() => location.reload(), 500);
};

document.getElementById('loadMoreBtn').onclick = () => loadImages();
