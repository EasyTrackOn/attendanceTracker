import { callApi, getDeviceMetadata, showToast } from './config.js';
import { openScanner, closeScanner } from './scanner.js';

let pendingLoginPayload = null;

export function initUserPortal() {
  document.getElementById('userLoginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('userUsername').value.trim();
    const password = document.getElementById('userPassword').value;
    const devMeta = getDeviceMetadata();

    pendingLoginPayload = { username, password, ...devMeta, forceTakeover: false };
    await executeUserLogin(pendingLoginPayload);
  });

  document.getElementById('btnForceTakeover').addEventListener('click', async () => {
    if (!pendingLoginPayload) return;
    bootstrap.Modal.getInstance(document.getElementById('sessionConflictModal')).hide();
    await executeUserLogin({ ...pendingLoginPayload, forceTakeover: true });
  });

  document.getElementById('btnOpenScanner').addEventListener('click', () => {
    openScanner(receipt => {
      document.getElementById('receiptUserName').textContent = receipt.userName;
      document.getElementById('receiptDate').textContent = receipt.date;
      document.getElementById('receiptTime').textContent = receipt.time;
      document.getElementById('receiptLocation').textContent = receipt.qrLocation;
      document.getElementById('receiptStatus').textContent = `${receipt.attendanceStatus} (${receipt.verificationStatus})`;
      new bootstrap.Modal(document.getElementById('scanSuccessModal')).show();
      loadUserDashboard();
    });
  });

  document.getElementById('btnCloseScanner').addEventListener('click', closeScanner);

  document.getElementById('btnUserLogout').addEventListener('click', async () => {
    await callApi('LOGOUT', {}, 'user');
    localStorage.removeItem('user_token');
    localStorage.removeItem('user_profile');
    window.location.reload();
  });

  // Restore session if token exists
  if (localStorage.getItem('user_token')) {
    showUserDashboardView();
    loadUserDashboard();
  }
}

async function executeUserLogin(payload) {
  const res = await callApi('USER_LOGIN', payload, 'user');
  if (res.ok) {
    localStorage.setItem('user_token', res.token);
    localStorage.setItem('user_profile', JSON.stringify(res.user));
    showUserDashboardView();
    loadUserDashboard();
    showToast('Logged in successfully', 'success');
  } else if (res.code === 'ACTIVE_SESSION_EXISTS') {
    const s = res.activeSession;
    document.getElementById('conflictDeviceInfo').innerHTML = `
      <li><strong>Device:</strong> ${s.deviceName}</li>
      <li><strong>Browser:</strong> ${s.browser}</li>
      <li><strong>Last Active:</strong> ${new Date(s.lastActiveTime).toLocaleString()}</li>
      <li><strong>Location:</strong> ${s.loginLocation}</li>
    `;
    document.getElementById('btnForceTakeover').style.display = res.canRequestTakeover ? 'inline-block' : 'none';
    new bootstrap.Modal(document.getElementById('sessionConflictModal')).show();
  } else {
    showToast(res.error || 'Login failed', 'danger');
  }
}

function showUserDashboardView() {
  document.getElementById('userLoginSection').classList.add('d-none');
  document.getElementById('userDashboardSection').classList.remove('d-none');

  const profile = JSON.parse(localStorage.getItem('user_profile') || '{}');
  document.getElementById('uProfileName').textContent = profile.name || '';
  document.getElementById('uProfileMeta').textContent = `ID: ${profile.admission_number || ''} | ${profile.class_name || ''} ${profile.division_name || ''}`;
}

export async function loadUserDashboard() {
  const res = await callApi('GET_MY_ATTENDANCE', {}, 'user');
  if (!res.ok) return;

  document.getElementById('uStatPct').textContent = `${res.stats.monthlyPercentage}%`;
  document.getElementById('uStatPresent').textContent = res.stats.presentDays;
  document.getElementById('uStatAbsent').textContent = res.stats.absentDays;
  document.getElementById('uStatLate').textContent = res.stats.lateArrivals;

  const todayEl = document.getElementById('uTodayStatus');
  if (res.today) {
    todayEl.innerHTML = `<span class="badge bg-success">${res.today.attendance_status}</span> at ${new Date(res.today.scan_time).toLocaleTimeString()}`;
  } else {
    todayEl.innerHTML = `<span class="badge bg-warning text-dark">Not Marked Yet</span>`;
  }

  const tbody = document.getElementById('uHistoryTableBody');
  tbody.innerHTML = res.history.length
    ? res.history.map(r => `
        <tr>
          <td>${r.attendance_date}</td>
          <td>${new Date(r.scan_time).toLocaleTimeString()}</td>
          <td><span class="badge bg-${r.attendance_status === 'Present' ? 'success' : r.attendance_status === 'Late' ? 'warning' : 'danger'}">${r.attendance_status}</span></td>
          <td>${r.verification_status} (${r.security_score})</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4" class="text-center text-muted">No attendance records this month</td></tr>';
}
