// InvenTech Prototype Client-Side Application Logic

// State management
let state = {
  users: [],
  assets: [],
  licenses: [],
  maintenance: [],
  workflows: [],
  simulation_logs: []
};

// Current logged-in user
let currentUser = null;

// Canvas drawing state
let drawing = false;
let canvas, ctx;

// Charts instances
let sanitizationChartInstance = null;
let telemetryChartInstance = null;

// Selected asset for telemetry chart
let selectedTelemetryAssetTag = '';

// ===== TOAST NOTIFICATION SYSTEM =====
function showToast(type, title, message) {
  const container = document.getElementById('toast-container');
  const icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    info: 'fa-circle-info'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon"><i class="fa-solid ${icons[type] || icons.info}"></i></div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    <div class="toast-progress"></div>
  `;

  container.appendChild(toast);

  // Auto-remove after 4.5 seconds
  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// ===== LOGIN / LOGOUT SYSTEM =====
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });

    const result = await response.json();
    if (response.ok) {
      currentUser = result.user;
      sessionStorage.setItem('inventech_user', JSON.stringify(currentUser));
      showAppAfterLogin();
    } else {
      errorEl.textContent = result.error || 'Login failed.';
    }
  } catch (err) {
    errorEl.textContent = 'Connection error. Please try again.';
  }
}

function handleLogout() {
  sessionStorage.removeItem('inventech_user');
  currentUser = null;
  // Show login overlay
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('login-username').value = '';
  document.getElementById('login-error').textContent = '';
}

function showAppAfterLogin() {
  // Hide login, show loading
  document.getElementById('login-overlay').classList.add('hidden');
  document.getElementById('loading-overlay').style.display = 'flex';

  // Update user profile in header
  updateUserProfile();

  // Load data then show app
  fetchState().then(() => {
    renderAll();
    // Short delay for loading screen effect
    setTimeout(() => {
      document.getElementById('loading-overlay').classList.add('hidden');
      document.getElementById('app-container').style.display = 'flex';
      setTimeout(() => {
        document.getElementById('loading-overlay').style.display = 'none';
      }, 600);
    }, 1200);
  });
}

function updateUserProfile() {
  if (!currentUser) return;
  const names = currentUser.name.split(' ');
  const initials = names.map(n => n[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('user-avatar').textContent = initials;
  document.getElementById('user-display-name').textContent = currentUser.name;
  document.getElementById('user-display-role').textContent = currentUser.department;
}

// ===== MOBILE MENU =====
function toggleMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('mobile-open');
  overlay.classList.toggle('active');
}

// ===== RESET DEMO DATA =====
async function resetDemoData() {
  if (!confirm('Are you sure you want to reset all data back to the original demo state? This cannot be undone.')) {
    return;
  }

  try {
    const response = await fetch('/api/reset', { method: 'POST' });
    if (response.ok) {
      showToast('success', 'Data Reset', 'Database has been restored to original demo data.');
      await refreshData();
    } else {
      showToast('error', 'Reset Failed', 'Could not reset the database.');
    }
  } catch (err) {
    showToast('error', 'Connection Error', 'Failed to connect to the server.');
  }
}

// On Document Load
document.addEventListener('DOMContentLoaded', () => {
  // Check for existing session
  const savedUser = sessionStorage.getItem('inventech_user');
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    showAppAfterLogin();
  }

  // Navigation handling
  setupNavigation();
  
  // Initialize E-Signature canvas
  setupSignaturePad();
  
  // Set up periodic sync to show background workflow updates
  setInterval(refreshDataSilent, 3000);
});

// Navigation Switcher
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      
      const targetView = item.getAttribute('data-view');
      switchView(targetView);
    });
  });
}

function switchView(viewName) {
  // Update nav UI
  document.querySelectorAll('.nav-item').forEach(el => {
    if (el.getAttribute('data-view') === viewName) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  // Update views
  document.querySelectorAll('.dashboard-view').forEach(view => {
    if (view.id === `view-${viewName}`) {
      view.classList.add('active');
    } else {
      view.classList.remove('active');
    }
  });

  // Set titles
  const viewTitles = {
    overview: { title: "System Overview", desc: "Real-time status of InvenTech asset infrastructure" },
    registry: { title: "Hardware Registry", desc: "View and manage all active physical assets in the PostgreSQL database" },
    handoff: { title: "Digital Handoff Module", desc: "Perform secure equipment assignments with digital sign-offs" },
    integrations: { title: "Integration Control Panel", desc: "Simulate CDC/Kafka data flows and automated license reclamation" },
    diagnostics: { title: "AI Analytics & Diagnostics", desc: "Monitor live device telemetries and execute predictive failure inference" },
    disposal: { title: "Asset Decommissioning", desc: "Enforce sanitization protocols and sign off physical asset disposal" }
  };

  const titleConfig = viewTitles[viewName] || { title: "InvenTech", desc: "IT Asset Management" };
  document.getElementById('view-title').textContent = titleConfig.title;
  document.getElementById('view-desc').textContent = titleConfig.desc;

  // Render view-specific setups
  if (viewName === 'handoff') {
    resizeSignatureCanvas();
  }
  if (viewName === 'overview') {
    renderSanitizationChart();
  }
  if (viewName === 'diagnostics') {
    setTimeout(renderTelemetryChart, 100);
  }
  if (viewName === 'disposal') {
    renderDisposalView();
    resizeDispSignatureCanvas();
  }
}

// Data Fetching and UI Rendering
async function refreshData() {
  await fetchState();
  renderAll();
}

async function refreshDataSilent() {
  await fetchState();
  renderAllSilent();
}

async function fetchState() {
  try {
    const response = await fetch('/api/data');
    if (response.ok) {
      state = await response.json();
    }
  } catch (err) {
    console.error("Failed to load application state:", err);
  }
}

// Full Render with Charts
function renderAll() {
  renderKPIs();
  renderWorkflowsTable();
  renderActiveAssignmentsTable();
  renderFullAssetsTable();
  renderHandoffDropdowns();
  renderIntegrationsView();
  renderDiagnosticsView();
  renderSanitizationChart();
  renderTelemetryChart();
  renderDisposalView();
}

// Light Render (preserves form states and selections)
function renderAllSilent() {
  renderKPIs();
  renderWorkflowsTable();
  renderActiveAssignmentsTable();
  renderFullAssetsTable();
  renderLogsTerminal();
  updateHandoffDropdownsSilent();
  updateIntegrationUsersSilent();
  updateDiagnosticsTable();
  renderDisposalViewSilent();
}

// Render KPI Cards
function renderKPIs() {
  document.getElementById('kpi-total-assets').textContent = state.assets.length;
  
  // Total licenses seats calculation
  let totalSeats = 0;
  let allocatedSeats = 0;
  state.licenses.forEach(lic => {
    totalSeats += lic.total_seats;
    allocatedSeats += lic.seats_assigned;
  });

  document.getElementById('kpi-license-seats').textContent = `${totalSeats - allocatedSeats}`;
  document.getElementById('kpi-license-allocated').textContent = allocatedSeats;
  document.getElementById('kpi-license-total').textContent = totalSeats;

  // Pending workflows calculation
  const pendingWorkflows = state.workflows.filter(w => w.current_state === 'Manager Approval' || w.current_state === 'Ordered').length;
  document.getElementById('kpi-pending-approvals').textContent = pendingWorkflows;
}

// Render Workflows Table
function renderWorkflowsTable() {
  const tbody = document.querySelector('#table-workflows tbody');
  tbody.innerHTML = '';

  if (state.workflows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No active workflows</td></tr>`;
    return;
  }

  state.workflows.forEach(w => {
    const tr = document.createElement('tr');
    
    let stateBadge = `<span class="badge badge-pending">${w.current_state}</span>`;
    if (w.current_state === 'Registered' || w.current_state === 'Received') {
      stateBadge = `<span class="badge badge-active">${w.current_state}</span>`;
    } else if (w.current_state === 'Rejected') {
      stateBadge = `<span class="badge badge-repair">${w.current_state}</span>`;
    }

    let actionButton = '';
    if (w.current_state === 'Manager Approval') {
      actionButton = `
        <button class="btn btn-secondary" style="padding:0.35rem 0.75rem; font-size:0.8rem;" onclick="approveWorkflow('${w.id}', true)">Approve</button>
        <button class="btn btn-danger" style="padding:0.35rem 0.75rem; font-size:0.8rem; background:rgba(239,68,68,0.1);" onclick="approveWorkflow('${w.id}', false)">Reject</button>
      `;
    } else if (w.current_state === 'Ordered') {
      actionButton = `<span style="font-size:0.8rem; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Wait Cargo Sync</span>`;
    } else if (w.current_state === 'Received') {
      actionButton = `<span style="font-size:0.8rem; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Snipe-IT Intake</span>`;
    } else {
      actionButton = `<span style="font-size:0.8rem; color:var(--success);"><i class="fa-solid fa-circle-check"></i> Done</span>`;
    }

    tr.innerHTML = `
      <td><strong>${w.id}</strong></td>
      <td>${w.item_name}</td>
      <td>${w.quantity}</td>
      <td>₱${w.cost.toLocaleString()}</td>
      <td>${stateBadge}</td>
      <td>${actionButton}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Render Active Assignments (Overview Page)
function renderActiveAssignmentsTable() {
  const tbody = document.querySelector('#table-active-assignments tbody');
  tbody.innerHTML = '';

  const assignedAssets = state.assets.filter(a => a.status === 'Assigned');

  if (assignedAssets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No active hardware assignments</td></tr>`;
    return;
  }

  assignedAssets.forEach(a => {
    const user = state.users.find(u => u.id === a.assigned_to);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${a.asset_tag}</strong></td>
      <td>${a.model}</td>
      <td>${user ? user.name : 'Unknown User'}</td>
      <td>${user ? user.email : 'N/A'}</td>
      <td>${a.date_checked_out || '-'}</td>
      <td><code style="font-size:0.75rem; color:var(--secondary);">${a.signature_hash ? a.signature_hash.substring(0, 24) + '...' : '-'}</code></td>
      <td>
        <button class="btn btn-secondary" style="padding:0.35rem 0.75rem; font-size:0.8rem;" onclick="checkinAsset('${a.id}')">
          Check-in
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Render Full Registry table
function renderFullAssetsTable() {
  const tbody = document.querySelector('#table-full-assets tbody');
  tbody.innerHTML = '';

  state.assets.forEach(a => {
    const tr = document.createElement('tr');
    
    let statusBadge = `<span class="badge badge-deployable">${a.status}</span>`;
    if (a.status === 'Assigned') {
      statusBadge = `<span class="badge badge-active">Assigned</span>`;
    } else if (a.status === 'Under Repair') {
      statusBadge = `<span class="badge badge-repair">Under Repair</span>`;
    } else if (a.status === 'Retired') {
      statusBadge = `<span class="badge badge-pending">Retired</span>`;
    } else if (a.status === 'Disposed') {
      statusBadge = `<span class="badge badge-critical">Disposed</span>`;
    }

    let sanitBadge = '';
    if (a.sanitization_status === 'Verified') {
      sanitBadge = `<span class="badge badge-verified"><i class="fa-solid fa-circle-check"></i> Verified</span>`;
    } else if (a.sanitization_status === 'Pending') {
      sanitBadge = `<span class="badge badge-pending"><i class="fa-solid fa-circle-exclamation"></i> Pending</span>`;
    } else {
      sanitBadge = `<span class="badge badge-active">${a.sanitization_status || '-'}</span>`;
    }

    let actionBtn = '';
    if (a.status === 'Assigned') {
      actionBtn = `<button class="btn btn-secondary" style="padding:0.35rem 0.65rem; font-size:0.8rem;" onclick="checkinAsset('${a.id}')">Check-in</button>`;
    } else if (a.status === 'Retired') {
      actionBtn = `<button class="btn btn-primary" style="padding:0.35rem 0.65rem; font-size:0.8rem;" onclick="switchView('disposal')">Disposal Signoff</button>`;
    } else if (a.status === 'Disposed') {
      const dispRecord = (state.disposals || []).find(d => d.asset_id === a.id);
      if (dispRecord) {
        actionBtn = `<button class="btn btn-secondary" style="padding:0.35rem 0.65rem; font-size:0.8rem;" onclick="showCertificate('${dispRecord.id}')"><i class="fa-solid fa-file-shield"></i> Certificate</button>`;
      } else {
        actionBtn = `<span style="font-size:0.8rem; color:var(--text-muted);">Decommissioned</span>`;
      }
    } else if (a.sanitization_status === 'Pending') {
      actionBtn = `
        <button class="btn btn-primary" style="padding:0.35rem 0.65rem; font-size:0.8rem;" onclick="openSanitizeModal('${a.id}')"><i class="fa-solid fa-signature"></i> Sanitize</button>
        <button class="btn btn-danger" style="padding:0.35rem 0.65rem; font-size:0.8rem; background:rgba(239,68,68,0.1);" onclick="retireAsset('${a.id}')">Retire</button>
      `;
    } else {
      actionBtn = `
        <button class="btn btn-secondary" style="padding:0.35rem 0.65rem; font-size:0.8rem;" onclick="checkoutFromRegistry('${a.id}')">Check-out</button>
        <button class="btn btn-danger" style="padding:0.35rem 0.65rem; font-size:0.8rem; background:rgba(239,68,68,0.1);" onclick="retireAsset('${a.id}')">Retire</button>
      `;
    }

    tr.innerHTML = `
      <td><strong>${a.asset_tag}</strong></td>
      <td>${a.serial}</td>
      <td>${a.model}</td>
      <td>${a.type}</td>
      <td>${statusBadge}</td>
      <td>${a.location}</td>
      <td>${sanitBadge}</td>
      <td><code style="font-size:0.75rem; color:var(--text-muted);">${a.signature_hash ? a.signature_hash.substring(0, 16) + '...' : '-'}</code></td>
      <td>${actionBtn}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Render Dropdowns for Handoff View
function renderHandoffDropdowns() {
  const assetSelect = document.getElementById('checkout-asset');
  assetSelect.innerHTML = '<option value="" disabled selected>-- Select an asset --</option>';
  
  const deployableAssets = state.assets.filter(a => a.status === 'Deployable');
  deployableAssets.forEach(a => {
    const isPending = a.sanitization_status === 'Pending';
    assetSelect.innerHTML += `
      <option value="${a.id}" ${isPending ? 'disabled' : ''}>
        ${a.asset_tag} - ${a.model} ${isPending ? '(PENDING SANITIZATION)' : ''}
      </option>
    `;
  });

  const userSelect = document.getElementById('checkout-user');
  userSelect.innerHTML = '<option value="" disabled selected>-- Select a student/faculty member --</option>';
  state.users.forEach(u => {
    userSelect.innerHTML += `<option value="${u.id}">${u.name} (${u.id}) - ${u.department}</option>`;
  });
}

function updateHandoffDropdownsSilent() {
  const assetSelect = document.getElementById('checkout-asset');
  const userSelect = document.getElementById('checkout-user');
  
  const currentAssetVal = assetSelect.value;
  const currentUserVal = userSelect.value;
  
  renderHandoffDropdowns();
  
  if (currentAssetVal) assetSelect.value = currentAssetVal;
  if (currentUserVal) userSelect.value = currentUserVal;
}

// Render Integrations panel dropdowns
function renderIntegrationsView() {
  const userSelect = document.getElementById('hris-user');
  userSelect.innerHTML = '<option value="" disabled selected>-- Select Profile to Change Status --</option>';
  state.users.forEach(u => {
    const displayStatus = u.status !== 'Active' ? ` [${u.status}]` : '';
    userSelect.innerHTML += `<option value="${u.id}">${u.name} (${u.id}) - Current: ${u.status}${displayStatus}</option>`;
  });

  renderLogsTerminal();
}

function updateIntegrationUsersSilent() {
  const userSelect = document.getElementById('hris-user');
  const currentVal = userSelect.value;
  renderIntegrationsView();
  if (currentVal) userSelect.value = currentVal;
}

// Terminal logs update
function renderLogsTerminal() {
  const terminal = document.getElementById('log-terminal');
  terminal.innerHTML = '';
  
  if (!state.simulation_logs || state.simulation_logs.length === 0) {
    terminal.innerHTML = `<div class="log-entry" style="color:var(--text-muted);">No log streams captured yet...</div>`;
    return;
  }

  state.simulation_logs.forEach(log => {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    
    // Format timestamp
    const t = new Date(log.timestamp);
    const timeStr = `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}:${t.getSeconds().toString().padStart(2,'0')}`;

    let logColorClass = 'log-type';
    if (log.type.includes('CDC') || log.type.includes('Debezium')) {
      logColorClass = 'log-type text-cyan';
    } else if (log.type.includes('Auto-Reclamation')) {
      logColorClass = 'log-type text-green';
    } else if (log.type.includes('CRITICAL')) {
      logColorClass = 'log-type text-red';
    }

    entry.innerHTML = `
      <span class="log-time">[${timeStr}]</span>
      <span class="${logColorClass}">${log.type}</span>
      <span class="log-msg">${log.message}</span>
    `;
    terminal.appendChild(entry);
  });
}

// Render diagnostics view
function renderDiagnosticsView() {
  // Telemetry asset select
  const select = document.getElementById('telemetry-asset-select');
  const oldVal = select.value || selectedTelemetryAssetTag;
  
  select.innerHTML = '';
  
  const laptopAssets = state.assets.filter(a => a.type === 'Laptop');
  laptopAssets.forEach(a => {
    select.innerHTML += `<option value="${a.asset_tag}">${a.asset_tag} (${a.model})</option>`;
  });

  if (oldVal && laptopAssets.find(a => a.asset_tag === oldVal)) {
    select.value = oldVal;
    selectedTelemetryAssetTag = oldVal;
  } else if (laptopAssets.length > 0) {
    select.value = laptopAssets[0].asset_tag;
    selectedTelemetryAssetTag = laptopAssets[0].asset_tag;
  }

  updateDiagnosticsTable();
}

function updateDiagnosticsTable() {
  const tbody = document.querySelector('#table-device-risk tbody');
  tbody.innerHTML = '';

  const laptopAssets = state.assets.filter(a => a.type === 'Laptop');
  
  laptopAssets.forEach(a => {
    const tr = document.createElement('tr');
    
    // Calculate failure probability score
    let score = 0;
    if (a.battery_cycle_count > 500) score += 45;
    else if (a.battery_cycle_count > 400) score += 25;
    if (a.cpu_temp > 80) score += 40;
    else if (a.cpu_temp > 70) score += 20;
    if (a.disk_usage > 90) score += 15;

    let healthBadge = '';
    let actionTxt = '';

    if (score >= 70) {
      healthBadge = `<span class="badge badge-critical"><i class="fa-solid fa-triangle-exclamation"></i> Critical Risk (${score}%)</span>`;
      actionTxt = `<span style="color:var(--danger); font-weight:600;"><i class="fa-solid fa-circle-exclamation"></i> Auto-Ticket Raised</span>`;
    } else if (score >= 40) {
      healthBadge = `<span class="badge badge-pending"><i class="fa-solid fa-circle-info"></i> Elevated Warning (${score}%)</span>`;
      actionTxt = `<span style="color:var(--warning);"><i class="fa-solid fa-clock"></i> Monitor Closely</span>`;
    } else {
      healthBadge = `<span class="badge badge-active"><i class="fa-solid fa-circle-check"></i> Healthy (${score}%)</span>`;
      actionTxt = `<span style="color:var(--text-muted);"><i class="fa-solid fa-circle-check"></i> Normal Ops</span>`;
    }

    tr.innerHTML = `
      <td><strong>${a.asset_tag}</strong></td>
      <td>${a.model}</td>
      <td>${a.battery_cycle_count} cycles</td>
      <td>${a.cpu_temp}°C</td>
      <td>${a.disk_usage}%</td>
      <td>${healthBadge}</td>
      <td>${actionTxt}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Chart Renderings
function renderSanitizationChart() {
  const canvasElement = document.getElementById('sanitizationChart');
  if (!canvasElement) return;

  const ctx = canvasElement.getContext('2d');
  
  // Calculate states
  let verified = 0;
  let pending = 0;
  let other = 0;
  
  state.assets.forEach(a => {
    if (a.sanitization_status === 'Verified') verified++;
    else if (a.sanitization_status === 'Pending') pending++;
    else other++;
  });

  if (sanitizationChartInstance) {
    sanitizationChartInstance.destroy();
  }

  sanitizationChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Verified Secure', 'Pending Scrub', 'Under Repair/Active'],
      datasets: [{
        data: [verified, pending, other],
        backgroundColor: ['#10b981', '#f59e0b', '#3b82f6'],
        borderColor: '#0e1222',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#9ca3af',
            font: { family: 'Outfit', size: 11 }
          }
        }
      },
      cutout: '65%'
    }
  });
}

function renderTelemetryChart() {
  const canvasElement = document.getElementById('telemetryChart');
  if (!canvasElement) return;

  const ctx = canvasElement.getContext('2d');
  
  // Find selected asset
  const asset = state.assets.find(a => a.asset_tag === selectedTelemetryAssetTag);
  if (!asset) return;

  // Generate simulated history based on current value to draw a nice chart
  const labels = ['10m ago', '8m ago', '6m ago', '4m ago', '2m ago', 'Now'];
  
  // Build a trend line for CPU temp
  const baseTemp = asset.cpu_temp;
  const cpuData = [
    Math.round(baseTemp - 10 + Math.random() * 5),
    Math.round(baseTemp - 5 + Math.random() * 5),
    Math.round(baseTemp - 2 + Math.random() * 5),
    Math.round(baseTemp - 8 + Math.random() * 5),
    Math.round(baseTemp - 1 + Math.random() * 5),
    baseTemp
  ];

  // Build trend line for Disk Space
  const baseDisk = asset.disk_usage;
  const diskData = [
    baseDisk,
    baseDisk,
    baseDisk,
    baseDisk,
    baseDisk,
    baseDisk
  ];

  if (telemetryChartInstance) {
    telemetryChartInstance.destroy();
  }

  telemetryChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'CPU Temp (°C)',
          data: cpuData,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderWidth: 2,
          tension: 0.3,
          fill: true
        },
        {
          label: 'Disk Usage (%)',
          data: diskData,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.05)',
          borderWidth: 2,
          tension: 0.1,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#9ca3af', font: { family: 'Outfit' } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#9ca3af', font: { family: 'Outfit' } },
          min: 0,
          max: 100
        }
      },
      plugins: {
        legend: {
          labels: { color: '#9ca3af', font: { family: 'Outfit' } }
        }
      }
    }
  });
}

function updateTelemetryChart() {
  const select = document.getElementById('telemetry-asset-select');
  selectedTelemetryAssetTag = select.value;
  renderTelemetryChart();
}

// Interactive Operations API Calls

// E-Signature Drawing Logic
function setupSignaturePad() {
  canvas = document.getElementById('sig-canvas');
  if (!canvas) return;

  ctx = canvas.getContext('2d');
  
  // Mouse Events
  canvas.addEventListener('mousedown', (e) => {
    drawing = true;
    const pos = getMousePos(canvas, e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    const pos = getMousePos(canvas, e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  });

  canvas.addEventListener('mouseup', () => {
    drawing = false;
  });

  // Touch Events for Mobile
  canvas.addEventListener('touchstart', (e) => {
    drawing = true;
    const touch = e.touches[0];
    const pos = getMousePos(canvas, touch);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    e.preventDefault();
  });

  canvas.addEventListener('touchmove', (e) => {
    if (!drawing) return;
    const touch = e.touches[0];
    const pos = getMousePos(canvas, touch);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    e.preventDefault();
  });

  canvas.addEventListener('touchend', () => {
    drawing = false;
  });
}

function getMousePos(canvasDom, e) {
  const rect = canvasDom.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function resizeSignatureCanvas() {
  // Wait slightly for layout to calculate parent width
  setTimeout(() => {
    if (!canvas) return;
    const rect = canvas.parentNode.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    clearSignatureCanvas();
  }, 50);
}

function clearSignatureCanvas() {
  if (!ctx || !canvas) return;
  ctx.fillStyle = '#0a0d1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Write guidance text
  ctx.font = '14px Outfit';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.textAlign = 'center';
  ctx.fillText('Draw signature here', canvas.width / 2, canvas.height / 2);
}

// API Submission handlers

// Check out Asset
async function handleCheckoutSubmit(e) {
  e.preventDefault();
  const assetId = document.getElementById('checkout-asset').value;
  const userId = document.getElementById('checkout-user').value;

  if (!assetId || !userId) {
    showToast('error', 'Missing Selection', 'Please select both an asset and a user.');
    return;
  }

  // Get drawing signature as base64 string
  const sigDataUrl = canvas.toDataURL();

  try {
    const response = await fetch(`/api/assets/${assetId}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, signature_data: sigDataUrl })
    });

    const result = await response.json();
    if (response.ok) {
      showToast('success', 'Checkout Complete', `Asset checked out. Signature hash: ${result.signatureHash.substring(0, 24)}...`);
      // Clean form
      document.getElementById('checkout-asset').value = '';
      document.getElementById('checkout-user').value = '';
      clearSignatureCanvas();
      
      // Update UI
      await refreshData();
      switchView('overview');
    } else {
      showToast('error', 'Checkout Failed', result.error);
    }
  } catch (err) {
    console.error("Checkout request failed:", err);
  }
}

// Checkout asset directly from registry page (pre-selects values)
function checkoutFromRegistry(assetId) {
  switchView('handoff');
  setTimeout(() => {
    document.getElementById('checkout-asset').value = assetId;
  }, 100);
}

// Check in Asset
async function checkinAsset(assetId) {
  if (!confirm("Are you sure you want to check in this asset? It will be flagged as PENDING SANITIZATION before deployment.")) {
    return;
  }

  try {
    const response = await fetch(`/api/assets/${assetId}/checkin`, {
      method: 'POST'
    });

    if (response.ok) {
      showToast('success', 'Asset Returned', 'Status reset to DEPLOYABLE. Marked for sanitization audit.');
      await refreshData();
    } else {
      const err = await response.json();
      showToast('error', 'Check-in Failed', err.error);
    }
  } catch (err) {
    console.error("Check-in failed:", err);
  }
}

// Sanitization modal actions
function openSanitizeModal(assetId) {
  document.getElementById('sanitize-asset-id').value = assetId;
  document.getElementById('modal-sanitize').classList.add('active');
  // reset checkboxes
  document.getElementById('check-bios').checked = false;
  document.getElementById('check-mdm').checked = false;
  document.getElementById('check-firmware').checked = false;
}

function closeSanitizeModal() {
  document.getElementById('modal-sanitize').classList.remove('active');
}

async function handleModalSanitizeSubmit(e) {
  e.preventDefault();
  const assetId = document.getElementById('sanitize-asset-id').value;
  const method = document.getElementById('sanitize-method').value;

  try {
    const response = await fetch(`/api/assets/${assetId}/sanitize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: method, status: "Verified" })
    });

    if (response.ok) {
      showToast('success', 'Sanitization Verified', 'Asset is now ready for deployment.');
      closeSanitizeModal();
      await refreshData();
    } else {
      const err = await response.json();
      showToast('error', 'Sanitization Failed', err.error);
    }
  } catch (err) {
    console.error("Sanitize post failed:", err);
  }
}

// Approval action
async function approveWorkflow(id, isApproved) {
  try {
    const response = await fetch(`/api/workflows/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: isApproved })
    });

    if (response.ok) {
      const actionName = isApproved ? 'approved' : 'rejected';
      showToast(isApproved ? 'success' : 'info', `Workflow ${actionName.charAt(0).toUpperCase() + actionName.slice(1)}`, `Temporal Workflow ${id} ${actionName}. State machine processing.`);
      await refreshData();
    } else {
      const err = await response.json();
      showToast('error', 'Workflow Error', err.error);
    }
  } catch (err) {
    console.error("Workflow update failed:", err);
  }
}

// HRIS sync simulator
async function handleHrisSubmit(e) {
  e.preventDefault();
  const userId = document.getElementById('hris-user').value;
  const status = document.getElementById('hris-status').value;

  if (!userId || !status) {
    showToast('error', 'Missing Selection', 'Please select a profile to modify.');
    return;
  }

  try {
    const response = await fetch('/api/simulation/hris-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, new_status: status })
    });

    const result = await response.json();
    if (response.ok) {
      showToast('success', 'HRIS Sync Complete', `Reclaimed ${result.licensesReclaimed} license seats and ${result.assetsReclaimed} hardware assets. Check CDC logs for details.`);
      await refreshData();
    } else {
      showToast('error', 'HRIS Sync Error', result.error);
    }
  } catch (err) {
    console.error("HRIS sync simulator failed:", err);
  }
}

// Procurement simulator
async function handleProcurementSubmit(e) {
  e.preventDefault();
  const item = document.getElementById('proc-item').value;
  const qty = document.getElementById('proc-qty').value;
  const cost = document.getElementById('proc-cost').value;

  try {
    const response = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_name: item, quantity: qty, cost: cost, requested_by: "Procurement Simulator" })
    });

    if (response.ok) {
      showToast('success', 'Request Submitted', 'Procurement request sent to Temporal workflow. Approve it in the workflows table.');
      await refreshData();
      switchView('overview');
    } else {
      const err = await response.json();
      showToast('error', 'Procurement Error', err.error);
    }
  } catch (err) {
    console.error("Procurement submission failed:", err);
  }
}

// SageMaker Inference
async function runMlInference() {
  try {
    const response = await fetch('/api/simulation/predictive-maintenance', {
      method: 'POST'
    });

    const result = await response.json();
    if (response.ok) {
      showToast('info', 'ML Inference Complete', `Scanned ${result.scannedCount} devices. Critical: ${result.criticalCount}, Warnings: ${result.warningCount}. Check diagnostics for details.`);
      await refreshData();
    } else {
      showToast('error', 'Inference Failed', result.error);
    }
  } catch (err) {
    console.error("Inference run failed:", err);
  }
}

// Modal open/close helpers
function openNewWorkflowModal() {
  document.getElementById('modal-workflow').classList.add('active');
}
function closeWorkflowModal() {
  document.getElementById('modal-workflow').classList.remove('active');
}
async function handleModalProcurementSubmit(e) {
  e.preventDefault();
  const item = document.getElementById('modal-proc-item').value;
  const qty = document.getElementById('modal-proc-qty').value;
  const cost = document.getElementById('modal-proc-cost').value;
  const by = document.getElementById('modal-proc-by').value;

  try {
    const response = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_name: item, quantity: qty, cost: cost, requested_by: by })
    });

    if (response.ok) {
      showToast('success', 'Workflow Created', 'Procurement workflow initiated. Approve it in the workflows table.');
      closeWorkflowModal();
      await refreshData();
      switchView('overview');
    } else {
      const err = await response.json();
      showToast('error', 'Workflow Error', err.error);
    }
  } catch (err) {
    console.error("Modal workflow fail:", err);
  }
}

function openNewAssetModal() {
  document.getElementById('modal-asset').classList.add('active');
  
  // Auto-generate tag code
  const lastNum = state.assets.length + 1;
  document.getElementById('modal-asset-tag').value = `CCT-LPT-${String(100 + lastNum).substring(1)}`;
  document.getElementById('modal-asset-serial').value = `SN-PF4X${Math.floor(1000 + Math.random() * 9000)}`;
}
function closeAssetModal() {
  document.getElementById('modal-asset').classList.remove('active');
}
async function handleModalAssetSubmit(e) {
  e.preventDefault();
  const tag = document.getElementById('modal-asset-tag').value;
  const serial = document.getElementById('modal-asset-serial').value;
  const model = document.getElementById('modal-asset-model').value;
  const type = document.getElementById('modal-asset-type').value;
  const loc = document.getElementById('modal-asset-loc').value;


  try {
    const response = await fetch('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_tag: tag, serial, model, type, location: loc })
    });

    if (response.ok) {
      showToast('success', 'Asset Registered', `Asset ${tag} saved to PostgreSQL database.`);
      closeAssetModal();
      await refreshData();
    } else {
      const err = await response.json();
      showToast('error', 'Registration Failed', err.error);
    }
  } catch (err) {
    console.error("Asset register failed:", err);
  }
}

// Clear logs simulator terminal
function clearLogs() {
  state.simulation_logs = [];
  renderLogsTerminal();
}

// === Asset Retirement & Disposal Workflow Implementation ===

let dispCanvas, dispCtx;
let dispDrawing = false;

// Initialize signature canvas for compliance officer
function setupDispSignaturePad() {
  dispCanvas = document.getElementById('disp-sig-canvas');
  if (!dispCanvas) return;

  dispCtx = dispCanvas.getContext('2d');
  
  dispCanvas.addEventListener('mousedown', (e) => {
    dispDrawing = true;
    const pos = getMousePos(dispCanvas, e);
    dispCtx.beginPath();
    dispCtx.moveTo(pos.x, pos.y);
    dispCtx.strokeStyle = '#ef4444'; // Red signature for warning/disposal
    dispCtx.lineWidth = 3;
    dispCtx.lineCap = 'round';
  });

  dispCanvas.addEventListener('mousemove', (e) => {
    if (!dispDrawing) return;
    const pos = getMousePos(dispCanvas, e);
    dispCtx.lineTo(pos.x, pos.y);
    dispCtx.stroke();
  });

  dispCanvas.addEventListener('mouseup', () => {
    dispDrawing = false;
  });

  // Touch support
  dispCanvas.addEventListener('touchstart', (e) => {
    dispDrawing = true;
    const touch = e.touches[0];
    const pos = getMousePos(dispCanvas, touch);
    dispCtx.beginPath();
    dispCtx.moveTo(pos.x, pos.y);
    dispCtx.strokeStyle = '#ef4444';
    dispCtx.lineWidth = 3;
    dispCtx.lineCap = 'round';
    e.preventDefault();
  });

  dispCanvas.addEventListener('touchmove', (e) => {
    if (!dispDrawing) return;
    const touch = e.touches[0];
    const pos = getMousePos(dispCanvas, touch);
    dispCtx.lineTo(pos.x, pos.y);
    dispCtx.stroke();
    e.preventDefault();
  });

  dispCanvas.addEventListener('touchend', () => {
    dispDrawing = false;
  });
}

function resizeDispSignatureCanvas() {
  setTimeout(() => {
    if (!dispCanvas) {
      setupDispSignaturePad();
    }
    if (!dispCanvas) return;
    const rect = dispCanvas.parentNode.getBoundingClientRect();
    dispCanvas.width = rect.width;
    dispCanvas.height = rect.height;
    clearDispSignatureCanvas();
  }, 50);
}

function clearDispSignatureCanvas() {
  if (!dispCtx || !dispCanvas) return;
  dispCtx.fillStyle = '#0a0d1a';
  dispCtx.fillRect(0, 0, dispCanvas.width, dispCanvas.height);
  
  dispCtx.font = '14px Outfit';
  dispCtx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  dispCtx.textAlign = 'center';
  dispCtx.fillText('Compliance Officer Sign Here', dispCanvas.width / 2, dispCanvas.height / 2);
}

// API Action: Move Asset to "Retired"
async function retireAsset(id) {
  const asset = state.assets.find(a => a.id === id);
  if (!asset) return;

  if (!confirm(`Are you sure you want to retire asset ${asset.asset_tag} (${asset.model})? This enforces data sanitization before final disposal.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/assets/${id}/retire`, {
      method: 'POST'
    });

    if (response.ok) {
      showToast('info', 'Asset Retired', `${asset.asset_tag} retired. Go to Disposal & Wipes to sanitize and decommission.`);
      await refreshData();
    } else {
      const err = await response.json();
      showToast('error', 'Retirement Failed', err.error);
    }
  } catch (err) {
    console.error("Retire asset failed:", err);
  }
}

// Render Decommission & Disposal tables
function renderDisposalView() {
  renderRetiredAssetsTable();
  renderDisposalRecordsTable();
}

function renderDisposalViewSilent() {
  renderRetiredAssetsTable();
  renderDisposalRecordsTable();
}

// Populate retired assets
function renderRetiredAssetsTable() {
  const tbody = document.querySelector('#table-retired-assets tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  
  const retiredAssets = state.assets.filter(a => a.status === 'Retired');

  if (retiredAssets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No assets currently retired</td></tr>`;
    return;
  }

  retiredAssets.forEach(a => {
    const tr = document.createElement('tr');
    
    let sanitBadge = '';
    let actionBtn = '';
    
    if (a.sanitization_status === 'Verified') {
      sanitBadge = `<span class="badge badge-verified"><i class="fa-solid fa-check-double"></i> Verified</span>`;
      actionBtn = `<button class="btn btn-danger" style="padding:0.35rem 0.65rem; font-size:0.8rem;" onclick="openDisposeModal('${a.id}')"><i class="fa-solid fa-file-shield"></i> Finalize Decommission</button>`;
    } else {
      sanitBadge = `<span class="badge badge-pending"><i class="fa-solid fa-circle-exclamation"></i> Scrub Required</span>`;
      actionBtn = `<button class="btn btn-primary" style="padding:0.35rem 0.65rem; font-size:0.8rem;" onclick="openSanitizeModal('${a.id}')"><i class="fa-solid fa-soap"></i> Perform Sanitization</button>`;
    }

    tr.innerHTML = `
      <td><strong>${a.asset_tag}</strong></td>
      <td>${a.model}</td>
      <td>${sanitBadge}</td>
      <td>${a.sanitization_method || '<em style="color:var(--text-muted)">Unwiped</em>'}</td>
      <td>${actionBtn}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Populate historical disposals
function renderDisposalRecordsTable() {
  const tbody = document.querySelector('#table-disposal-records tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  const disposals = state.disposals || [];

  if (disposals.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No decommission audit records found</td></tr>`;
    return;
  }

  disposals.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${d.id}</strong></td>
      <td>${d.asset_tag}</td>
      <td>${d.certified_by}</td>
      <td>${d.disposal_date}</td>
      <td>
        <button class="btn btn-secondary" style="padding:0.35rem 0.65rem; font-size:0.8rem;" onclick="showCertificate('${d.id}')">
          <i class="fa-solid fa-file-pdf"></i> View Certificate
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Open final dispose modal
function openDisposeModal(assetId) {
  const asset = state.assets.find(a => a.id === assetId);
  if (!asset) return;

  document.getElementById('dispose-asset-id').value = assetId;
  document.getElementById('dispose-info-tag').textContent = asset.asset_tag;
  document.getElementById('dispose-info-serial').textContent = asset.serial;
  document.getElementById('dispose-info-sanitize').textContent = asset.sanitization_method;

  document.getElementById('modal-dispose').classList.add('active');
  
  // Resize signature pad and initialize drawing
  resizeDispSignatureCanvas();
}

function closeDisposeModal() {
  document.getElementById('modal-dispose').classList.remove('active');
}

// Submit final disposal sign-off
async function handleModalDisposeSubmit(e) {
  e.preventDefault();
  const assetId = document.getElementById('dispose-asset-id').value;
  const officer = document.getElementById('dispose-officer').value;
  const sigDataUrl = dispCanvas.toDataURL();

  try {
    const response = await fetch(`/api/assets/${assetId}/dispose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compliance_officer: officer, signature_data: sigDataUrl })
    });

    const result = await response.json();
    if (response.ok) {
      showToast('success', 'Disposal Finalized', `Audit certificate generated: ${result.disposalRecord.certificate_hash.substring(0, 30)}...`);
      closeDisposeModal();
      
      // Update data and refresh UI
      await refreshData();
      
      // Open the certificate preview automatically for the newly created record
      showCertificate(result.disposalRecord.id);
    } else {
      showToast('error', 'Disposal Failed', result.error);
    }
  } catch (err) {
    console.error("Disposal sign-off failed:", err);
  }
}

// Show Printable Certificate Modal
function showCertificate(dispRecordId) {
  const disposals = state.disposals || [];
  const record = disposals.find(d => d.id === dispRecordId);
  if (!record) return;

  document.getElementById('cert-id').textContent = record.id;
  document.getElementById('cert-model').textContent = record.model;
  document.getElementById('cert-tag').textContent = record.asset_tag;
  document.getElementById('cert-serial').textContent = record.serial;
  document.getElementById('cert-method').textContent = record.sanitize_method;
  document.getElementById('cert-date').textContent = record.disposal_date;
  document.getElementById('cert-officer').textContent = record.certified_by;
  document.getElementById('cert-hash').textContent = record.certificate_hash;

  // Render compliance officer name signature representation
  const sigContainer = document.getElementById('cert-signature-draw');
  sigContainer.innerHTML = `<span style="font-family:'Courier New', monospace; font-size:1.1rem; font-style:italic; font-weight:700; color:#ef4444; border-bottom:1px solid rgba(255,255,255,0.2); letter-spacing:-1px;">/s/ ${record.certified_by}</span>`;

  document.getElementById('modal-certificate').classList.add('active');
}

function closeCertificateModal() {
  document.getElementById('modal-certificate').classList.remove('active');
}

