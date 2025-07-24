// ==========================
// 🔧 CONFIGURATION
// ==========================
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzy3ZTT2YpSxJgGPHmPbqD1iR60zBzv_Vr52PR1s4cvWDvH6gW4P4_mOXpJocUhFHFjwQ/exec';
let CURRENT_PAGE = 1;
const IMAGES_PER_PAGE = 2;
let HAS_MORE_IMAGES = true;
// ==========================
// ✨ PWA Service Worker
// ==========================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then(registration => console.log('ServiceWorker registration successful'))
      .catch(err => console.log('ServiceWorker registration failed: ', err));
  });
}

// ==========================
// 📞 API HELPER
// ==========================
async function callAppsScript(action, params = {}) {
  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Use text/plain for GAS
      body: JSON.stringify({ action, params }),
      redirect: 'follow'
    });
    if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    console.error('Error calling Apps Script:', error);
    return { success: false, message: `Network or script error: ${error.message}` };
  }
}

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
// 🎨 THEME LOGIC
// ==========================
const THEMES = {
  default: { bg: "#fff", fg: "#333", card: "#f9f9f9", btn: "#4caf50" },
  dark:    { bg: "#121212", fg: "#f0f0f0", card: "#1e1e1e", btn: "#2196f3" },
  ocean:   { bg: "#001f3f", fg: "#ffffff", card: "#003366", btn: "#00aced" },
  sunset:  { bg: "#2e1a47", fg: "#ffd1dc", card: "#5c2a9d", btn: "#ff5e5e" }
};
const offlineBanner = document.getElementById('offlineStatus');

function updateOnlineStatus() {
  if (!offlineBanner) return;

  if (!navigator.onLine) {
    offlineBanner.textContent = "You're offline";
    offlineBanner.classList.remove('hidden');
  } else {
    offlineBanner.textContent = "You're back online!";
    offlineBanner.classList.remove('hidden');
    setTimeout(() => {
      offlineBanner.classList.add('hidden');
    }, 3000);

    if (CURRENT_USER && CURRENT_FOLDER) {
      loadTheme();
      loadImages(true);
    }
  }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// Initial check on load
updateOnlineStatus();


function applyTheme(theme) {
  Object.keys(theme).forEach(key => document.documentElement.style.setProperty(`--${key}`, theme[key]));
}

async function loadTheme() {
  const response = await callAppsScript('getTheme', { userId: CURRENT_USER });
  const themeName = (response.success && response.theme) ? response.theme : 'default';
  applyTheme(THEMES[themeName] || THEMES.default);
  document.getElementById('themeSelect').value = themeName;
}

async function changeTheme(themeName) {
  applyTheme(THEMES[themeName] || THEMES.default);
  await callAppsScript('saveTheme', { userId: CURRENT_USER, themeName });
}


// ==========================
// 🔐 AUTH LOGIC
// ==========================
function toggleMode(e) {
  e.preventDefault();
  const mode = document.getElementById('authTitle').textContent.includes('Login') ? 'signup' : 'login';
  document.getElementById('authTitle').textContent = mode === 'signup' ? 'Create an Account' : 'Login to SkySafee';
  document.querySelector('#authBox button').textContent = mode === 'signup' ? 'Sign Up' : 'Login';
  document.getElementById('authConfirm').classList.toggle('hidden', mode !== 'signup');
  document.getElementById('authError').textContent = '';
}

function showError(msg) {
  document.getElementById('authError').textContent = msg;
}

async function handleAuth() {
  const uid = document.getElementById('authUser').value.trim();
  const pwd = document.getElementById('authPass').value;
  const isSignup = document.getElementById('authTitle').textContent.includes('Create');

  if (isSignup) {
    const conf = document.getElementById('authConfirm').value;
    if (pwd !== conf) return showError('Passwords must match.');
  }
  if (!uid || !pwd) return showError('Please fill in all fields.');

  const action = isSignup ? 'createUser' : 'verifyLogin';
  const response = await callAppsScript(action, { userId: uid, password: pwd });

  if (response && response.success) {
    CURRENT_USER = uid;
    CURRENT_FOLDER = response.folderId;
    localStorage.setItem('skySafeeUser', CURRENT_USER);
    localStorage.setItem('skySafeeFolder', CURRENT_FOLDER);
    document.getElementById('authBox').classList.add('hidden');
    document.getElementById('galleryContainer').classList.remove('hidden');
    loadTheme();
    loadImages();
  } else {
    showError(response.message || 'An unknown error occurred.');
  }
}

// ==========================
// 🖼️ IMAGE & GALLERY LOGIC
// ==========================
async function loadImages(reset = false) {
  if (!CURRENT_FOLDER) return;
  if (reset) {
    CURRENT_PAGE = 1;
    IMAGE_URLS = [];
    document.getElementById('gallery').innerHTML = '';
    HAS_MORE_IMAGES = true;
  }

  if (!HAS_MORE_IMAGES) return;

  // Add skeleton loaders
  for (let i = 0; i < 0; i++) addSkeleton();

const response = await callAppsScript('getPaginatedImages', {
  folderId: CURRENT_FOLDER,
  offset: (CURRENT_PAGE - 1) * IMAGES_PER_PAGE,
  limit: IMAGES_PER_PAGE
});


  document.querySelectorAll('.gallery-item.skeleton').forEach(el => el.remove());

  if (response && response.success) {
    if (response.urls.length === 0) {
      HAS_MORE_IMAGES = false;
      document.getElementById('loadMoreBtn').classList.add('hidden');
      return;
    }

response.urls.forEach(url => {
  if (!IMAGE_URLS.includes(url)) {
    IMAGE_URLS.push(url);
    addImageToDOM(url, IMAGE_URLS.length - 1);
  }
});


    CURRENT_PAGE++;

    if (response.urls.length < IMAGES_PER_PAGE) {
      HAS_MORE_IMAGES = false;
      document.getElementById('loadMoreBtn').classList.add('hidden');
    } else {
      document.getElementById('loadMoreBtn').classList.remove('hidden');
    }
  } else {
    alert("Failed to load images: " + (response.message || "Unknown error"));
  }
}
function addSkeleton() {
    const div = document.createElement('div');
    div.className = 'gallery-item skeleton';
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton';
    div.appendChild(skeleton);
    document.getElementById('gallery').appendChild(div);
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
    
    // Add a skeleton loader immediately for better UX
    const tempDiv = document.createElement('div');
    tempDiv.className = 'gallery-item';
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton';
    tempDiv.appendChild(skeleton);
    document.getElementById('gallery').prepend(tempDiv);

    reader.onload = async () => {
      const dataUrl = reader.result;
      const response = await callAppsScript('uploadToDrive', {
        dataUrl,
        filename: file.name,
        folderId: CURRENT_FOLDER
      });
      if (response && response.success) {
        // Replace skeleton with the actual image
        tempDiv.remove();
        IMAGE_URLS.unshift(response.url); // Add to start of array
        // Re-render all images to fix indices
        document.getElementById('gallery').innerHTML = '';
        IMAGE_URLS.forEach((u, i) => addImageToDOM(u, i));
      } else {
        tempDiv.remove();
        alert('Upload failed: ' + response.message);
      }
    };
    reader.readAsDataURL(file);
}

// Event listeners for uploads
document.getElementById('imageInput').onchange = e => {
    [...e.target.files].forEach(processAndUpload);
};

const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('click', () => document.getElementById('imageInput').click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.background = "rgba(33,150,243,0.2)"; });
dropZone.addEventListener('dragleave', e => { e.preventDefault(); dropZone.style.background = "var(--drop-bg)"; });
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.style.background = "var(--drop-bg)";
  [...e.dataTransfer.files].forEach(processAndUpload);
});

// ==========================
// 💡 LIGHTBOX LOGIC
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
    const urlToDelete = IMAGE_URLS[CURRENT_INDEX];
    if (!urlToDelete || !confirm('Are you sure you want to delete this image permanently?')) return;

    const response = await callAppsScript('deleteImage', { folderId: CURRENT_FOLDER, imageUrl: urlToDelete });
    if (response && response.success) {
        // Remove from UI
        document.querySelector(`.gallery-item[data-url="${urlToDelete}"]`).remove();
        const nextIndex = CURRENT_INDEX;
        closeLightbox();
        // Reload images to get correct state from server
        loadImages();
    } else {
        alert('Deletion failed: ' + response.message);
    }
}


document.getElementById('lightboxClose').onclick = closeLightbox;
document.getElementById('lightboxNext').onclick = showNext;
document.getElementById('lightboxPrev').onclick = showPrev;
document.getElementById('lightboxDelete').onclick = deleteCurrentImage;
document.addEventListener('keydown', e => {
  if (document.getElementById('lightboxOverlay').classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowRight') showNext();
  else if (e.key === 'ArrowLeft') showPrev();
});


// ==========================
// 📷 CAMERA LOGIC
// ==========================
async function openCamera() {
  document.getElementById('cameraModal').classList.remove('hidden');
  try {
    cameraDevices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    if (!cameraDevices.length) throw new Error("No camera found.");
    currentCameraIndex = 0; // default to the first camera
    startCamera(cameraDevices[0].deviceId);
  } catch (err) {
    alert("Camera error: " + err.message);
    closeCamera();
  }
}

function startCamera(deviceId) {
  if (videoStream) videoStream.getTracks().forEach(track => track.stop());

  const constraints = {
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      facingMode: 'environment' // Prefer rear camera
    }
  };

  navigator.mediaDevices.getUserMedia(constraints)
    .then(stream => {
      videoStream = stream;
      document.getElementById('cameraVideo').srcObject = stream;
    })
    .catch(err => {
      console.error("Camera start error:", err);
      // Fallback for devices that don't like exact deviceId
      navigator.mediaDevices.getUserMedia({video:true}).then(stream => {
         videoStream = stream;
         document.getElementById('cameraVideo').srcObject = stream;
      }).catch(e => alert("Could not access camera."));
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
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
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
  if (cropper) { cropper.destroy(); cropper = null; }

  document.getElementById('cameraModal').classList.add('hidden');
  document.getElementById('cameraVideo').classList.remove('hidden');
  document.getElementById('cameraImage').classList.add('hidden');
  document.getElementById('uploadButton').classList.add('hidden');
  videoStream = null;
}

// ==========================
// 🚀 APP INITIALIZATION
// ==========================
window.onload = () => {
  if (CURRENT_USER && CURRENT_FOLDER) {
    document.getElementById('authBox').classList.add('hidden');
    document.getElementById('galleryContainer').classList.remove('hidden');
    loadTheme();
    loadImages(true);  // Pass reset = true
  }
};

document.getElementById('logoutButton').onclick = () => {
  sessionStorage.removeItem('skySafeeUser');
  sessionStorage.removeItem('skySafeeFolder');
  localStorage.removeItem('skySafeeUser');
  localStorage.removeItem('skySafeeFolder');
  location.reload();
};
document.getElementById('loadMoreBtn').onclick = () => {
  loadImages();
};
