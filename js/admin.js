import { callApi, showToast } from './config.js';

let classChartInstance = null;

export function initAdminPortal() {
  document.getElementById('adminLoginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('adminUsername').value.trim();
    const password = document.getElementById('adminPassword').value;
    const res = await callApi('ADMIN_LOGIN', { username, password }, 'admin');
    if (res.ok) {
      localStorage.setItem('admin_token', res.token);
      localStorage.setItem('admin_profile', JSON.stringify(res.admin));
      enterAdminWorkspace();
    } else {
      showToast(res.error || 'Admin login failed', 'danger');
    }
  });

  document.getElementById('btnAdminLogout').addEventListener('click', async () => {
    await callApi('LOGOUT', {}, 'admin');
    localStorage.removeItem('admin_token');
    window.location.reload();
  });

  // Navigation Tabs
  document.querySelectorAll('[data-admin-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-admin-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-admin-tab');
      document.querySelectorAll('.admin-pane').forEach(p => p.classList.add('d-none'));
      document.getElementById(target).classList.remove('d-none');

      if (target === 'paneDashboard') loadAdminDashboard();
      if (target === 'paneUsers') loadUsersList();
      if (target === 'paneClasses') loadClassesList();
      if (target === 'paneQR') loadQRLocations();
      if (target === 'paneAttendance') loadAttendanceRecords();
      if (target === 'paneSecurity') loadSecurityLogs();
    });
  });

  // Create Class
  document.getElementById('createClassForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('newClassName').value;
    const category = document.getElementById('newClassCategory').value;
    const res = await callApi('CREATE_CLASS', { name, category }, 'admin');
    if (res.ok) {
      e.target.reset();
      showToast('Class created', 'success');
      loadClassesList();
    }
  });

  // Create Individual User
  document.getElementById('createUserForm').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      admission_number: document.getElementById('uAdmNo').value,
      name: document.getElementById('uFullName').value,
      class_id: document.getElementById('uClassSelect').value,
      mobile_number: document.getElementById('uMobile').value,
      username: document.getElementById('uLoginUser').value,
      password: document.getElementById('uInitPass').value,
      user_type: document.getElementById('uTypeSelect').value
    };
    const res = await callApi('CREATE_USER', payload, 'admin');
    if (res.ok) {
      e.target.reset();
      showToast(`User added! Initial Password: ${res.generatedPassword}`, 'success');
      loadUsersList();
    } else {
      showToast(res.error, 'danger');
    }
  });

  // Bulk CSV User Import
  document.getElementById('btnBulkCsvImport').addEventListener('click', async () => {
    const file = document.getElementById('csvUserFile').files[0];
    if (!file) return showToast('Select a CSV file first', 'warning');
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',');
      const obj = {};
      headers.forEach((h, i) => obj[h] = (vals[i] || '').trim());
      return obj;
    });
    const res = await callApi('BULK_IMPORT_USERS', { rows }, 'admin');
    if (res.ok) {
      showToast(`Imported ${res.imported} users (${res.errors.length} skipped)`, 'success');
      loadUsersList();
    }
  });

  // Generate QR & Poster Preview
  document.getElementById('createQRForm').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      qr_name: document.getElementById('qrName').value,
      location_name: document.getElementById('qrLocationName').value,
      latitude: document.getElementById('qrLat').value,
      longitude: document.getElementById('qrLng').value,
      allowed_radius_m: Number(document.getElementById('qrRadius').value || 50)
    };
    const res = await callApi('CREATE_QR', payload, 'admin');
    if (res.ok) {
      renderQRPoster(res.qr, res.signed_payload);
      loadQRLocations();
      showToast('Permanent QR generated with 4 geometric markers', 'success');
    }
  });

  document.getElementById('posterSizeSelect').addEventListener('change', e => {
    const sheet = document.getElementById('printablePosterArea');
    sheet.className = `qr-poster-sheet ${e.target.value}`;
  });

  if (localStorage.getItem('admin_token')) {
    enterAdminWorkspace();
  }
}

function enterAdminWorkspace() {
  document.getElementById('adminLoginSection').classList.add('d-none');
  document.getElementById('adminWorkspace').classList.remove('d-none');
  loadAdminDashboard();
  loadClassesList();
}

async function loadAdminDashboard() {
  const res = await callApi('GET_DASHBOARD', {}, 'admin');
  if (!res.ok) return;
  const s = res.summary;
  document.getElementById('dTotalUsers').textContent = s.totalUsers;
  document.getElementById('dTotalClasses').textContent = s.totalClasses;
  document.getElementById('dPresent').textContent = s.todaysPresent;
  document.getElementById('dAbsent').textContent = s.todaysAbsent;
  document.getElementById('dLate').textContent = s.lateArrivals;
  document.getElementById('dPct').textContent = `${s.attendancePercentage}%`;
  document.getElementById('dDevices').textContent = s.registeredDevices;
  document.getElementById('dAlerts').textContent = s.securityAlerts;

  const ctx = document.getElementById('classComparisonChart');
  if (classChartInstance) classChartInstance.destroy();
  classChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: res.classComparison.map(c => c.class_name),
      datasets: [
        { label: 'Present', data: res.classComparison.map(c => c.present), backgroundColor: '#0d6efd' },
        { label: 'Absent', data: res.classComparison.map(c => c.absent), backgroundColor: '#e2e8f0' }
      ]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });
}

async function loadClassesList() {
  const res = await callApi('LIST_CLASSES', {}, 'admin');
  if (!res.ok) return;

  const select = document.getElementById('uClassSelect');
  select.innerHTML = '<option value="">Select Class / Dept</option>' +
    res.classes.map(c => `<option value="${c.class_id}">${c.name} (${c.category})</option>`).join('');

  document.getElementById('classesTableBody').innerHTML = res.classes.map(c => `
    <tr>
      <td><strong>${c.name}</strong></td>
      <td><span class="badge bg-light text-dark">${c.category}</span></td>
      <td>${c.strength}</td>
      <td>
        <button class="btn btn-sm btn-outline-danger" onclick="window.deleteClass('${c.class_id}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

window.deleteClass = async class_id => {
  await callApi('DELETE_CLASS', { class_id }, 'admin');
  loadClassesList();
};

async function loadUsersList() {
  const res = await callApi('LIST_USERS', {}, 'admin');
  if (!res.ok) return;
  document.getElementById('usersTableBody').innerHTML = res.users.map(u => `
    <tr>
      <td>${u.admission_number}</td>
      <td>${u.name}</td>
      <td>${u.user_type}</td>
      <td>${u.mobile_number}</td>
      <td><span class="badge bg-${u.status === 'Active' ? 'success' : 'secondary'}">${u.status}</span></td>
      <td>
        <button class="btn btn-sm btn-outline-warning" onclick="window.resetUserPass('${u.user_id}')">Reset Pass</button>
      </td>
    </tr>
  `).join('');
}

window.resetUserPass = async user_id => {
  const res = await callApi('RESET_USER_PASSWORD', { user_id }, 'admin');
  if (res.ok) alert(`New temporary password: ${res.newPassword}`);
};

async function loadQRLocations() {
  const res = await callApi('LIST_QRS', {}, 'admin');
  if (!res.ok) return;
  document.getElementById('qrListTableBody').innerHTML = res.qrLocations.map(q => `
    <tr>
      <td>${q.qr_name}</td>
      <td>${q.location_name}</td>
      <td><span class="badge bg-${String(q.is_active) === 'true' ? 'success' : 'secondary'}">${String(q.is_active) === 'true' ? 'Active' : 'Inactive'}</span></td>
      <td>
        <button class="btn btn-sm btn-outline-primary" onclick='window.previewSavedQR(${JSON.stringify(q)})'>Poster</button>
      </td>
    </tr>
  `).join('');
}

window.previewSavedQR = qr => renderQRPoster(qr, qr.signed_payload);

function renderQRPoster(qr, signedPayload) {
  document.getElementById('posterLocationTitle').textContent = qr.location_name;
  document.getElementById('posterQrId').textContent = `QR ID: ${qr.qr_id}`;
  const container = document.getElementById('posterQrCanvas');
  container.innerHTML = '';
  new QRCode(container, {
    text: signedPayload,
    width: 240,
    height: 240,
    correctLevel: QRCode.CorrectLevel.H
  });
}

async function loadAttendanceRecords() {
  const res = await callApi('LIST_ATTENDANCE', {}, 'admin');
  if (!res.ok) return;
  document.getElementById('attendanceTableBody').innerHTML = res.records.map(r => `
    <tr>
      <td>${r.attendance_date}</td>
      <td>${r.user_name} (${r.admission_number})</td>
      <td>${new Date(r.scan_time).toLocaleTimeString()}</td>
      <td>${r.qr_location}</td>
      <td><span class="badge bg-${r.verification_status === 'Verified' ? 'success' : 'warning'}">${r.verification_status} (${r.security_score})</span></td>
      <td><strong>${r.attendance_status}</strong></td>
    </tr>
  `).join('');
}

async function loadSecurityLogs() {
  const res = await callApi('GET_SECURITY_LOGS', {}, 'admin');
  if (!res.ok) return;
  document.getElementById('securityLogsTableBody').innerHTML = res.logs.map(l => `
    <tr>
      <td>${new Date(l.created_at).toLocaleString()}</td>
      <td><span class="badge bg-danger">${l.event_type}</span></td>
      <td>${l.severity}</td>
      <td><code>${l.metadata_json}</code></td>
    </tr>
  `).join('');
}
