// Replace with your deployed Google Apps Script Web App URL
export const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwHWMy12vAqDSxcZATHgm05ZPfBZAiXViaNtRUPL4c1KDNqo2a4T3-h7VGyInFBPY9N/exec';


export async function callApi(action, payload = {}, role = 'user') {
  const tokenKey = role === 'admin' ? 'admin_token' : 'user_token';
  const token = localStorage.getItem(tokenKey) || '';

  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    // Omit Content-Type header so browser sends text/plain (avoids CORS OPTIONS preflight)
    body: JSON.stringify({ action, token, payload })
  });

  if (!res.ok) throw new Error(`Network Error (${res.status})`);
  const data = await res.json();

  if (data.error === 'SESSION_EXPIRED') {
    localStorage.removeItem(tokenKey);
    window.location.reload();
  }
  return data;
}

/**
 * Generates a persistent client cryptographic key paired with browser metadata.
 * Server enforces actual session uniqueness via UserSessions table.
 */
export function getDeviceMetadata() {
  let key = localStorage.getItem('device_client_secret');
  if (!key) {
    key = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem('device_client_secret', key);
  }
  const ua = navigator.userAgent;
  const browser = /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : 'Browser';
  const platform = navigator.platform || 'Mobile/Web';

  return {
    deviceFingerprint: `${key}|${screen.width}x${screen.height}|${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    deviceName: `${platform} (${screen.width}x${screen.height})`,
    browserInfo: browser
  };
}

export function showToast(message, type = 'primary') {
  const toastEl = document.getElementById('liveToast');
  const bodyEl = document.getElementById('toastBody');
  toastEl.className = `toast align-items-center text-bg-${type} border-0`;
  bodyEl.textContent = message;
  const toast = bootstrap.Toast.getOrCreateInstance(toastEl);
  toast.show();
}
