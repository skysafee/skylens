// =========================
// Skylens - script.js (patched)
// =========================

// =========================
// CONFIG
// =========================
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwsuhmmfT051Lb8AW2l_tPBBoizhuiLA4rjRbpzWalT7fjjw3DsKowKjcWffmYwrWaO/exec';
const INITIAL_LOAD_COUNT = 4;

// =========================
// STATE
// =========================
let CURRENT_USER = localStorage.getItem('CURRENT_USER') || null;
let SKYSAFE_TOKEN = localStorage.getItem('skySafeeToken') || null;
let IMAGE_URLS = [];
let CURRENT_INDEX = -1;
let CURRENT_THEME = localStorage.getItem('theme') || 'default';

// =========================
// UTILS
// =========================
async function callAppsScript(payload) {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

function showMessage(msg, type = 'info') {
  console.log(`[${type}] ${msg}`);
  // TODO: implement UI notifications if desired
}

// =========================
// DOM READY INITIALIZER
// =========================
window.addEventListener('DOMContentLoaded', () => {
  bindUIElements();
  if (CURRENT_USER && SKYSAFE_TOKEN) {
    loadTheme().then(() => {
      loadGallery(0, INITIAL_LOAD_COUNT);
    });
  }
});

// =========================
// BINDING UI ELEMENTS SAFELY
// =========================
function bindUIElements() {
  const loginForm = document.getElementById('loginForm');
  const signupToggleBtn = document.getElementById('signupToggleBtn');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const themeSelect = document.getElementById('themeSelect');

  if (loginForm) {
    loginForm.onsubmit = (e) => {
      e.preventDefault();
      handleAuth();
    };
  }

  if (signupToggleBtn) {
    signupToggleBtn.onclick = toggleSignup;
  }

  if (loadMoreBtn) {
    loadMoreBtn.onclick = () => {
      loadGallery(IMAGE_URLS.length, INITIAL_LOAD_COUNT);
    };
  }

  if (themeSelect) {
    themeSelect.onchange = () => {
      saveTheme(themeSelect.value);
    };
  }
}

// =========================
// THEME MANAGEMENT
// =========================
async function loadTheme() {
  if (!CURRENT_USER) {
    applyTheme(CURRENT_THEME);
    return;
  }
  try {
    const res = await callAppsScript({
      action: 'getTheme',
      userId: CURRENT_USER
    });
    CURRENT_THEME = res.theme || 'default';
    localStorage.setItem('theme', CURRENT_THEME);
    applyTheme(CURRENT_THEME);
  } catch (e) {
    console.error("Theme load failed", e);
    applyTheme('default');
  }
}

function applyTheme(theme) {
  document.body.className = ''; // reset
  document.body.classList.add(`theme-${theme}`);
}

async function saveTheme(theme) {
  if (!CURRENT_USER || !SKYSAFE_TOKEN) {
    localStorage.setItem('theme', theme);
    applyTheme(theme);
    return;
  }
  try {
    await callAppsScript({
      action: 'saveTheme',
      userId: CURRENT_USER,
      theme
    });
    CURRENT_THEME = theme;
    localStorage.setItem('theme', theme);
    applyTheme(theme);
  } catch (e) {
    console.error("Theme save failed", e);
  }
}

// =========================
// AUTHENTICATION
// =========================
let isSignupMode = false;

function toggleSignup() {
  isSignupMode = !isSignupMode;
  document.getElementById('authTitle').textContent = isSignupMode ? 'Sign Up' : 'Login';
  document.getElementById('signupFields').style.display = isSignupMode ? 'block' : 'none';
}

async function handleAuth() {
  const userId = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword')?.value;

  if (!userId || !password) {
    showMessage("Please fill in all required fields", "error");
    return;
  }

  if (isSignupMode && password !== confirmPassword) {
    showMessage("Passwords do not match", "error");
    return;
  }

  try {
    const action = isSignupMode ? 'createUser' : 'verifyLogin';
    const res = await callAppsScript({
      action,
      userId,
      password
    });

    if (res.success && res.token) {
      CURRENT_USER = userId;
      SKYSAFE_TOKEN = res.token;
      localStorage.setItem('CURRENT_USER', CURRENT_USER);
      localStorage.setItem('skySafeeToken', SKYSAFE_TOKEN);
      showMessage(isSignupMode ? "Signup successful" : "Login successful", "success");
      await loadTheme();
      loadGallery(0, INITIAL_LOAD_COUNT);
    } else {
      showMessage(res.message || "Authentication failed", "error");
    }
  } catch (e) {
    console.error("Auth error", e);
    showMessage("An error occurred during authentication", "error");
  }
}
// =========================
// GALLERY & PAGINATION
// =========================
async function loadGallery(startIndex, limit) {
  if (!CURRENT_USER || !SKYSAFE_TOKEN) return;
  try {
    const res = await callAppsScript({
      action: 'getPaginatedImages',
      startIndex,
      limit,
      token: SKYSAFE_TOKEN
    });

    if (res.success && Array.isArray(res.images)) {
      IMAGE_URLS = IMAGE_URLS.concat(res.images);
      renderGallery(res.images);
    }
  } catch (e) {
    console.error("Gallery load failed", e);
  }
}

function renderGallery(images) {
  const container = document.getElementById('gallery');
  if (!container) return;
  images.forEach((img, idx) => {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    div.innerHTML = `<img src="${img.url}" alt="Image" />`;
    div.onclick = () => openLightbox(startIndex + idx);
    container.appendChild(div);
  });
}

// =========================
// IMAGE UPLOAD
// =========================
async function uploadImage(file) {
  if (!file || !CURRENT_USER || !SKYSAFE_TOKEN) return;

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const maxSize = 5 * 1024 * 1024; // 5MB

  if (!allowedTypes.includes(file.type)) {
    showMessage("Unsupported file type", "error");
    return;
  }
  if (file.size > maxSize) {
    showMessage("File too large (max 5MB)", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const dataUrl = e.target.result;
      const res = await callAppsScript({
        action: 'uploadToDrive',
        dataUrl,
        filename: file.name,
        token: SKYSAFE_TOKEN
      });
      if (res.success) {
        showMessage("Upload successful", "success");
        IMAGE_URLS = [];
        document.getElementById('gallery').innerHTML = '';
        loadGallery(0, INITIAL_LOAD_COUNT);
      } else {
        showMessage(res.message || "Upload failed", "error");
      }
    } catch (err) {
      console.error("Upload error", err);
      showMessage("Upload failed", "error");
    }
  };
  reader.readAsDataURL(file);
}

// =========================
// LIGHTBOX VIEWER
// =========================
function openLightbox(index) {
  CURRENT_INDEX = index;
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.style.display = 'block';
  updateLightboxImage();
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (lb) lb.style.display = 'none';
}

function updateLightboxImage() {
  const imgData = IMAGE_URLS[CURRENT_INDEX];
  if (!imgData) return;
  const lbImg = document.getElementById('lightboxImage');
  if (lbImg) lbImg.src = imgData.url;
}

function nextImage() {
  if (CURRENT_INDEX < IMAGE_URLS.length - 1) {
    CURRENT_INDEX++;
    updateLightboxImage();
  }
}

function prevImage() {
  if (CURRENT_INDEX > 0) {
    CURRENT_INDEX--;
    updateLightboxImage();
  }
}

async function deleteCurrentImage() {
  if (CURRENT_INDEX < 0 || !IMAGE_URLS[CURRENT_INDEX]) return;
  const imgData = IMAGE_URLS[CURRENT_INDEX];
  try {
    const res = await callAppsScript({
      action: 'deleteImage',
      fileId: imgData.fileId,
      token: SKYSAFE_TOKEN
    });
    if (res.success) {
      showMessage("Image deleted", "success");
      IMAGE_URLS.splice(CURRENT_INDEX, 1);
      closeLightbox();
      document.getElementById('gallery').innerHTML = '';
      loadGallery(0, INITIAL_LOAD_COUNT);
    } else {
      showMessage(res.message || "Delete failed", "error");
    }
  } catch (e) {
    console.error("Delete error", e);
  }
}

// =========================
// CAMERA CAPTURE & CROPPING
// =========================
let videoStream = null;

async function startCamera() {
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
    const videoEl = document.getElementById('cameraPreview');
    if (videoEl) {
      videoEl.srcObject = videoStream;
      videoEl.play();
    }
  } catch (e) {
    console.error("Camera access denied", e);
    showMessage("Unable to access camera", "error");
  }
}

function capturePhoto() {
  const videoEl = document.getElementById('cameraPreview');
  const canvas = document.createElement('canvas');
  if (!videoEl) return;
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0);
  canvas.toBlob((blob) => {
    const file = new File([blob], "camera_capture.png", { type: "image/png" });
    uploadImage(file);
  }, "image/png");
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }
}

// =========================
// NOTES FEATURE
// =========================
async function loadNoteForImage(fileId) {
  if (!fileId || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  try {
    const res = await callAppsScript({
      action: 'getImageNote',
      fileId,
      token: SKYSAFE_TOKEN
    });
    if (res.success) {
      document.getElementById('imageNote').value = res.note || "";
    }
  } catch (e) {
    console.error("Note load failed", e);
  }
}

async function saveNoteForImage(fileId) {
  const note = document.getElementById('imageNote').value;
  if (!fileId || !CURRENT_USER || !SKYSAFE_TOKEN) return;
  try {
    await callAppsScript({
      action: 'saveImageNote',
      fileId,
      note,
      token: SKYSAFE_TOKEN
    });
    showMessage("Note saved", "success");
  } catch (e) {
    console.error("Note save failed", e);
  }
}

// =========================
// LOGOUT
// =========================
async function logoutUser() {
  if (!CURRENT_USER || !SKYSAFE_TOKEN) return;
  try {
    await callAppsScript({
      action: 'logout',
      token: SKYSAFE_TOKEN
    });
  } catch (e) {
    console.error("Logout error", e);
  }
  localStorage.removeItem('CURRENT_USER');
  localStorage.removeItem('skySafeeToken');
  CURRENT_USER = null;
  SKYSAFE_TOKEN = null;
  location.reload();
}

