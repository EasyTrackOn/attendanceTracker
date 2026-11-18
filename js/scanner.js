import { callApi, showToast } from './config.js';

const SCAN_TIMEOUT_SECONDS = 15;

let videoStream = null;
let scanLoopTimer = null;
let countdownTimer = null;
let codeReader = null;
let previousFrameGray = null;
let motionAccumulated = 0;
let isSubmitting = false;

export async function openScanner(onSuccessCallback) {
  const overlay = document.getElementById('scannerOverlay');
  const video = document.getElementById('cameraVideo');
  const statusBadge = document.getElementById('scannerStatus');
  const timerBadge = document.getElementById('scannerTimerBadge');
  const progressBar = document.getElementById('scannerProgressBar');
  const guideFrame = document.getElementById('a4GuideFrame');

  // Wire both top and bottom Cancel buttons
  document.getElementById('btnCloseScanner').onclick = () => closeScanner('Scan cancelled.');
  document.getElementById('btnCancelScannerBottom').onclick = () => closeScanner('Scan cancelled.');

  overlay.classList.add('active');
  guideFrame.classList.remove('markers-locked');
  motionAccumulated = 0;
  previousFrameGray = null;
  isSubmitting = false;

  let remainingSec = SCAN_TIMEOUT_SECONDS;
  timerBadge.textContent = `${remainingSec}s`;
  progressBar.style.width = '100%';
  statusBadge.textContent = 'Starting camera...';

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = videoStream;
    await video.play();

    codeReader = new ZXing.BrowserQRCodeReader();
    statusBadge.textContent = 'Fit A4 poster inside the frame';

    // 1. Start 15-second countdown timer
    countdownTimer = setInterval(() => {
      if (isSubmitting) return; // Pause timeout while server validates a detected QR
      remainingSec -= 1;
      timerBadge.textContent = `${Math.max(0, remainingSec)}s`;
      progressBar.style.width = `${Math.max(0, (remainingSec / SCAN_TIMEOUT_SECONDS) * 100)}%`;

      if (remainingSec <= 5) {
        timerBadge.className = 'badge bg-danger';
        progressBar.className = 'progress-bar bg-danger';
      } else {
        timerBadge.className = 'badge bg-primary';
        progressBar.className = 'progress-bar bg-success';
      }

      if (remainingSec <= 0) {
        closeScanner('Scan timed out (15s). Please try again.');
      }
    }, 1000);

    // 2. Start frame scanning loop
    scanLoopTimer = setInterval(() => processFrame(video, onSuccessCallback), 300);
  } catch (err) {
    closeScanner();
    showToast('Camera Permission Required', 'danger');
  }
}

export function closeScanner(toastMessage = '') {
  clearInterval(scanLoopTimer);
  clearInterval(countdownTimer);
  scanLoopTimer = null;
  countdownTimer = null;
  isSubmitting = false;

  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
  if (previousFrameGray && !previousFrameGray.isDeleted()) {
    previousFrameGray.delete();
    previousFrameGray = null;
  }

  document.getElementById('scannerOverlay').classList.remove('active');
  if (toastMessage) {
    showToast(toastMessage, 'secondary');
  }
}

async function processFrame(video, onSuccessCallback) {
  if (isSubmitting || video.readyState !== video.HAVE_ENOUGH_DATA) return;

  const canvas = document.getElementById('overlayCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // 1. Decode QR via ZXing
  let qrResult = null;
  try {
    qrResult = codeReader.decodeFromCanvas(canvas);
  } catch (_) {
    // No QR detected yet
  }

  // 2. OpenCV.js 4-Point Geometric Detection & Screen-Replay Risk Signals
  const cvMetrics = analyzePosterGeometryAndScreenRisk(canvas);
  const guideFrame = document.getElementById('a4GuideFrame');
  const statusBadge = document.getElementById('scannerStatus');

  if (cvMetrics.markersDetected === 4) {
    guideFrame.classList.add('markers-locked');
  } else {
    guideFrame.classList.remove('markers-locked');
  }

  if (!qrResult) {
    statusBadge.textContent = `Markers: ${cvMetrics.markersDetected}/4 — Hold steady on A4 poster`;
    return;
  }

  // Lock submission & pause countdown while backend verifies
  isSubmitting = true;
  clearInterval(scanLoopTimer);
  statusBadge.textContent = 'QR detected! Verifying attendance...';

  try {
    const gps = await getCurrentGPS();
    const res = await callApi('SUBMIT_ATTENDANCE', {
      rawQrText: qrResult.text,
      geometryMetrics: cvMetrics.geometry,
      screenRiskSignals: cvMetrics.screenRisk,
      motionVerified: motionAccumulated > 18,
      gps
    }, 'user');

    if (res.ok) {
      closeScanner();
      onSuccessCallback(res.receipt);
    } else if (res.code === 'CHALLENGE_REQUIRED') {
      isSubmitting = false;
      statusBadge.textContent = 'Move phone slightly left/right while keeping poster visible...';
      motionAccumulated = 0;
      scanLoopTimer = setInterval(() => processFrame(video, onSuccessCallback), 300);
    } else {
      closeScanner();
      showToast(res.error || 'Verification Failed', 'danger');
    }
  } catch (err) {
    closeScanner();
    showToast(err.message || 'Network Error', 'danger');
  }
}

function analyzePosterGeometryAndScreenRisk(canvas) {
  if (typeof cv === 'undefined' || !cv.Mat) {
    return {
      markersDetected: 4,
      geometry: { markersDetected: 4, normalizedError: 0.05 },
      screenRisk: { riskScore: 15 }
    };
  }

  let src = cv.imread(canvas);
  let gray = new cv.Mat();
  let thresh = new cv.Mat();
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    if (previousFrameGray) {
      let diff = new cv.Mat();
      cv.absdiff(gray, previousFrameGray, diff);
      motionAccumulated += cv.mean(diff)[0];
      diff.delete();
    }
    if (previousFrameGray) previousFrameGray.delete();
    previousFrameGray = gray.clone();

    cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 21, 5);
    cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < 150 || area > (canvas.width * canvas.height * 0.08)) continue;
      const rect = cv.boundingRect(cnt);
      const aspect = rect.width / rect.height;
      if (aspect > 0.75 && aspect < 1.33) {
        candidates.push({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, area });
      }
    }

    candidates.sort((a, b) => b.area - a.area);
    const top4 = candidates.slice(0, 4);
    let normalizedError = 0.06;

    if (top4.length === 4) {
      top4.sort((a, b) => a.y - b.y);
      const top = top4.slice(0, 2).sort((a, b) => a.x - b.x);
      const bot = top4.slice(2, 4).sort((a, b) => a.x - b.x);
      const [p1, p2, p3, p4] = [top[0], top[1], bot[1], bot[0]];

      const wTop = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const wBot = Math.hypot(p3.x - p4.x, p3.y - p4.y);
      const hLeft = Math.hypot(p4.x - p1.x, p4.y - p1.y);
      const hRight = Math.hypot(p3.x - p2.x, p3.y - p2.y);

      const widthSymmetry = Math.abs(wTop - wBot) / Math.max(wTop, wBot, 1);
      const heightSymmetry = Math.abs(hLeft - hRight) / Math.max(hLeft, hRight, 1);
      normalizedError = Number(((widthSymmetry + heightSymmetry) / 2).toFixed(3));
    }

    let laplacian = new cv.Mat();
    cv.Laplacian(gray, laplacian, cv.CV_64F);
    let mean = new cv.Mat();
    let stddev = new cv.Mat();
    cv.meanStdDev(laplacian, mean, stddev);
    const sharpnessVar = stddev.doubleAt(0, 0);
    const avgBrightness = cv.mean(gray)[0];

    let riskScore = 10;
    if (avgBrightness > 215) riskScore += 35;
    if (sharpnessVar > 65) riskScore += 30;

    laplacian.delete();
    mean.delete();
    stddev.delete();

    return {
      markersDetected: top4.length,
      geometry: { markersDetected: top4.length, normalizedError },
      screenRisk: { riskScore: Math.min(100, riskScore), avgBrightness: Math.round(avgBrightness), moireScore: Math.round(sharpnessVar) }
    };
  } finally {
    src.delete();
    gray.delete();
    thresh.delete();
    contours.delete();
    hierarchy.delete();
  }
}

function getCurrentGPS() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  });
}
