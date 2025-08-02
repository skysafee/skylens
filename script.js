// ==========================
// 🔧 CONFIGURATION
// ==========================
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzy3ZTT2YpSxJgGPHmPbqD1iR60zBzv_Vr52PR1s4cvWDvH6gW4P4_mOXpJocUhFHFjwQ/exec';
const INITIAL_LOAD_COUNT = 4;
const LOAD_MORE_COUNT = 20;
let HAS_MORE_IMAGES = true;
let NEXT_START_INDEX = 0;
let isSignupMode = false;

// ==========================
// 🌍 GLOBAL STATE
// ==========================
let CURRENT_USER = localStorage.getItem('skySafeeUser');
let CURRENT_FOLDER = localStorage.getItem('skySafeeFolder');
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

// ==========================
// 📞 API HELPER
// ==========================
async function callAppsScript(action, params = {}) {
  try {
    const token = localStorage.getItem('skySafeeToken');
    const mergedParams = { ...params, token }; // ← Inject token into params

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
    applyTheme(THEMES[cachedTheme]); // apply cached instantly
  }

  const res = await callAppsScript('getTheme', { userId: CURRENT_USER });
  const themeName = res.success ? res.theme : 'default';

  if (themeName !== cachedTheme) {
    localStorage.setItem('skySafeeTheme', themeName); // update cache if needed
    applyTheme(THEMES[themeName] || THEMES.default);
  }

  document.getElementById('themeSelect').value = themeName;
}

async function changeTheme(themeName) {
  applyTheme(THEMES[themeName]);
  localStorage.setItem('skySafeeTheme', themeName); // cache it
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
    CURRENT_FOLDER = res.folderId;
    localStorage.setItem('skySafeeUser', uid);
    localStorage.setItem('skySafeeFolder', res.folderId);
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
  if (!CURRENT_FOLDER) return;

  const btn = document.getElementById('loadMoreBtn');
  const spinner = document.getElementById('loadingSpinner');

if (reset) {
  // Reset pagination state
  IMAGE_URLS = [];
  NEXT_START_INDEX = 0;     // ← **NEW**: reset start index!
  HAS_MORE_IMAGES = true;

  // Fully clear the gallery DOM
  const gallery = document.getElementById('gallery');
  while (gallery.firstChild) {
    gallery.removeChild(gallery.firstChild);
  }
}


  if (!HAS_MORE_IMAGES) return;

  if (btn) btn.classList.add('hidden');
  if (spinner) spinner.classList.remove('hidden');

  const res = await callAppsScript('getPaginatedImages', {
    folderId: CURRENT_FOLDER,
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
      filename: file.name,
      folderId: CURRENT_FOLDER
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
    folderId: CURRENT_FOLDER,
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
  const btn = document.getElementById('uploadButton');
  btn.disabled = true;
  btn.textContent = 'Uploading...';

  cropper.getCroppedCanvas().toBlob(blob => {
    processAndUpload(new File([blob], `webcam_${Date.now()}.png`, { type: 'image/png' }));
    btn.disabled = false;
    btn.textContent = 'Upload';
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
// 🚀 INIT
// ==========================
window.onload = () => {
  IMAGE_URLS = []; // hard reset in case of weird session caching

  if (CURRENT_USER && CURRENT_FOLDER) {
    document.getElementById('authBox').classList.add('hidden');
    document.getElementById('galleryContainer').classList.remove('hidden');
    loadTheme();
    loadImages(true);
  }
};

document.getElementById('logoutButton').onclick = () => {
  localStorage.removeItem('skySafeeUser');
  localStorage.removeItem('skySafeeFolder');
  localStorage.removeItem('skySafeeToken'); // ← NEW
  localStorage.removeItem('skySafeeTheme');
  sessionStorage.clear();
  location.reload();
};

document.getElementById('loadMoreBtn').onclick = () => loadImages();
