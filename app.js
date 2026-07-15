// === GRETEX WFH TRACKER - APP LOGIC ===

let currentUser = null;
let cachedEmployees = [];
let cachedCheckpoints = [];
let cachedSchedules = []; 
let currentVerificationData = [];
let isCardView = true; 

// Chart Instances
let zoomChartInstance = null;
let cameraChartInstance = null;
let tlChartInstance = null;

const todayStr = () => new Date().toISOString().split('T')[0];

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function setBtnLoading(btn, isLoading, text = 'Saving…') {
  if (isLoading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.originalText || 'Save';
    btn.disabled = false;
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorBox = document.getElementById('loginError');
  const btn = document.getElementById('loginSubmitBtn');
  
  errorBox.style.display = 'none';
  setBtnLoading(btn, true, 'Signing In…');

  try {
    const res = await API.login(email, password);
    currentUser = res.user;
    Session.save(currentUser);
    enterApp();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.style.display = 'block';
  } finally {
    setBtnLoading(btn, false);
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  Session.clear();
  currentUser = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
});

function enterApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('userName').textContent = currentUser.name;
  document.getElementById('userRole').textContent = currentUser.role;
  document.getElementById('userAvatar').textContent = currentUser.name.charAt(0).toUpperCase();

  if (currentUser.role === 'Admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
  }

  document.getElementById('dashDate').value = todayStr();
  document.getElementById('verifyDate').value = todayStr();

  // Default dates for Emp Report (beginning of month to today)
  const d = new Date();
  const firstDay = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  document.getElementById('empReportFrom').value = firstDay;
  document.getElementById('empReportTo').value = todayStr();

  // Populate Employee Dropdown
  API.getEmployees().then(res => {
    const selector = document.getElementById('empReportSelector');
    selector.innerHTML = '<option value="">-- View Overall Daily Dashboard --</option>'; 
    res.data.forEach(emp => {
      const opt = document.createElement('option');
      opt.value = emp.EmpID;
      opt.textContent = `${emp.EmpName} (${emp.Status})`;
      selector.appendChild(opt);
    });
  }).catch(err => console.error("Could not load employees for selector"));

  loadDashboard();
}

(function checkSession() {
  const saved = Session.get();
  if (saved) { currentUser = saved; enterApp(); }
})();

document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const page = btn.dataset.page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');

    if (page === 'dashboard') loadDashboard();
    if (page === 'verification') loadVerification();
    if (page === 'schedule') loadSchedule();
    if (page === 'employees') loadEmployees();
    if (page === 'checkpoints') loadCheckpoints();
    if (page === 'users') loadUsers();
  });
});

// ============================================================
// DASHBOARD (UPGRADED)
// ============================================================
document.getElementById('dashDate').addEventListener('change', loadDashboard);

async function loadDashboard() {
  const date = document.getElementById('dashDate').value || todayStr();
  document.getElementById('kpiGrid').innerHTML = '<div class="empty-state">Loading…</div>';
  
  try {
    const res = await API.getDashboard(date);
    renderKpis(res.kpis);
    renderCheckpointBars(res.checkpointStats);
    renderFlagList(res.redFlagged);
    
    // Render Component Pie Charts
    renderDoughnutChart('zoomChart', res.componentStats.zoom, zoomChartInstance, (chart) => zoomChartInstance = chart);
    renderDoughnutChart('cameraChart', res.componentStats.camera, cameraChartInstance, (chart) => cameraChartInstance = chart);
    renderDoughnutChart('tlChart', res.componentStats.tl, tlChartInstance, (chart) => tlChartInstance = chart);

    // Render Exact Image-like Table
    renderMasterTable(res.checkpointsList, res.detailedGrid);

  } catch (err) {
    showToast(err.message, true);
  }
}

function renderKpis(k) {
  const cards = [
    { label: 'WFH Today', value: k.totalWFH, sub: `${k.totalPermanent} permanent · ${k.totalTemporary} temp`, color: 'var(--accent)' },
    { label: 'Total Checks', value: k.totalChecks, sub: 'Zoom + Camera + TL', color: 'var(--text-1)' },
    { label: 'Compliance', value: k.overallCompliance + '%', sub: `${k.yesCount} marked Yes`, color: 'var(--green)' },
    { label: 'Flagged (No)', value: k.noCount, sub: `${k.redFlagCount} employees affected`, color: 'var(--red)' },
    { label: 'Leave / NA', value: k.leaveCount + k.naCount, sub: `${k.leaveCount} leave · ${k.naCount} NA`, color: 'var(--amber)' }
  ];
  document.getElementById('kpiGrid').innerHTML = cards.map(c => `
    <div class="kpi-card" style="--bar-color:${c.color}">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-sub">${c.sub}</div>
    </div>`).join('');
}

// Chart.js Renderer
function renderDoughnutChart(canvasId, stats, existingInstance, saveInstance) {
  if (existingInstance) { existingInstance.destroy(); }
  
  const ctx = document.getElementById(canvasId).getContext('2d');
  const dataVals = [stats.yes || 0, stats.no || 0, stats.leave || 0, stats.na || 0];
  
  if(dataVals.reduce((a,b)=>a+b, 0) === 0) {
      const chart = new Chart(ctx, { 
        type: 'doughnut', 
        data: { labels: ['No Data Yet'], datasets: [{ data: [1], backgroundColor: ['#2a3040'] }] }, 
        options: { plugins: { legend: { display: false } } } 
      });
      saveInstance(chart); 
      return;
  }

  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Yes', 'No', 'Leave', 'NA'],
      datasets: [{
        data: dataVals,
        backgroundColor: ['#33d17a', '#ff4d5e', '#ffb020', '#6b7285'],
        borderWidth: 0, 
        hoverOffset: 4
      }]
    },
    options: {
      cutout: '70%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#aab1c2', font: { size: 10 } } }
      }
    }
  });
  saveInstance(chart);
}

// Full Spreadsheet Table Renderer
function renderMasterTable(checkpoints, gridData) {
  const wrap = document.getElementById('masterTableWrapper');
  
  if(!gridData.length) { 
    wrap.innerHTML = '<div class="empty-state">No scheduled WFH data found for this date.</div>'; 
    return; 
  }

  let theadHTML = `
    <tr>
      <th rowspan="2">EMP NAMES</th>
      ${checkpoints.map(cp => `<th colspan="3">${cp.name}<br><span style="font-size:9px;font-weight:normal">${cp.time}</span></th>`).join('')}
    </tr>
    <tr>
      ${checkpoints.map(() => `<th>Zoom log in</th><th>Camera Status</th><th>TL -Sc Visiblity</th>`).join('')}
    </tr>
  `;

  let tbodyHTML = gridData.map(emp => {
    const tds = emp.checks.map(c => {
      return `${getFormattedTd(c.zoom)}${getFormattedTd(c.camera)}${getFormattedTd(c.tlsc)}`;
    }).join('');
    
    return `<tr><td class="emp-name-col">${emp.empName.toUpperCase()}</td>${tds}</tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="master-report-table">
      <thead>${theadHTML}</thead>
      <tbody>${tbodyHTML}</tbody>
    </table>
  `;
}

function getFormattedTd(val) {
  if (!val) return '<td></td>';
  let formatted = val.toUpperCase();
  let cssClass = '';
  if (formatted === 'YES') cssClass = 'bg-yes';
  else if (formatted === 'NO') cssClass = 'bg-no';
  else if (formatted === 'LEAVE') cssClass = 'bg-leave';
  else if (formatted === 'NA') cssClass = 'bg-na';

  else if (formatted === 'MEETING') cssClass = 'bg-meeting'; 
  else if (formatted === 'HD') cssClass = 'bg-hd';
  else if (formatted === 'SHIFT OVER') cssClass = 'bg-shift-over';
  
  return `<td class="${cssClass}">${formatted}</td>`;
}

function renderCheckpointBars(stats) {
  const el = document.getElementById('checkpointBars');
  if (!stats.length) { 
    el.innerHTML = '<div class="empty-state">No checkpoints configured</div>'; 
    return; 
  }
  
  // Store globally for modal access
  window.currentCpStats = stats;

  el.innerHTML = stats.map((s, index) => {
    const total = s.total || 1;
    const yesPct = (s.yes / total) * 100;
    const noPct = (s.no / total) * 100;
    const otherPct = 100 - yesPct - noPct;
    
    return `
      <div class="cp-row" style="cursor:pointer;" onclick="showPendingModal(${index})" title="Click to view pending employees">
        <div class="cp-row-top">
          <span class="name">${s.checkpointName} <span style="color:var(--text-2);font-weight:400;">${s.time}</span></span>
          <span class="pct">${s.completed} / ${s.required} Done</span>
        </div>
        <div class="bar-track">
          <div class="bar-seg" style="width:${yesPct}%;background:var(--green);"></div>
          <div class="bar-seg" style="width:${noPct}%;background:var(--red);"></div>
          <div class="bar-seg" style="width:${otherPct}%;background:var(--gray);"></div>
        </div>
      </div>`;
  }).join('');
}

// Function to open pending modal
window.showPendingModal = function(index) {
  const stat = window.currentCpStats[index];
  document.getElementById('pendingModalTitle').textContent = `Pending: ${stat.checkpointName}`;
  const listEl = document.getElementById('pendingModalList');
  
  if (stat.pendingEmployees.length === 0) {
    listEl.innerHTML = '<div style="padding:10px 0; color:var(--green); font-weight:600;">All required compliance checks are completed! 🎉</div>';
  } else {
    listEl.innerHTML = stat.pendingEmployees.map(name => `
      <div style="padding:10px 12px; border-bottom:1px solid var(--glass-border); display:flex; align-items:center; gap:8px;">
        <span style="color:var(--amber); font-size:14px;">•</span> ${name}
      </div>
    `).join('');
  }
  openModal('pendingModalOverlay');
}

function renderFlagList(flags) {
  const el = document.getElementById('flagList');
  document.getElementById('flagCount').textContent = flags.length ? `(${flags.length})` : '';
  if (!flags.length) { 
    el.innerHTML = '<div class="empty-state">No red flags — everyone compliant 🎉</div>'; 
    return; 
  }
  el.innerHTML = flags.map(f => `
    <div class="flag-item">
      <div class="flag-dot"></div>
      <div>
        <div class="flag-name">${f.empName}</div>
        <div class="flag-detail">${f.flags.join(' · ')}</div>
      </div>
    </div>`).join('');
}

// ============================================================
// EMPLOYEE REPORT FEATURE
// ============================================================
document.getElementById('generateEmpReportBtn').addEventListener('click', async (e) => {
  const empId = document.getElementById('empReportSelector').value;
  const fromDate = document.getElementById('empReportFrom').value;
  const toDate = document.getElementById('empReportTo').value;
  const btn = e.target;

  if (!empId) {
    // If no employee selected, show overall dashboard
    document.getElementById('overallDashboardContainer').style.display = 'block';
    document.getElementById('employeeReportContainer').style.display = 'none';
    return;
  }

  if (!fromDate || !toDate) {
    showToast('Please select both From and To dates', true);
    return;
  }

  setBtnLoading(btn, true, 'Generating...');
  try {
    const res = await API.getEmployeeReport({ empId, fromDate, toDate });
    renderEmployeeReport(res.data);
    
    // Switch views
    document.getElementById('overallDashboardContainer').style.display = 'none';
    document.getElementById('employeeReportContainer').style.display = 'block';
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setBtnLoading(btn, false);
  }
});

// FIX: Added Back to Dashboard Button Listener
document.getElementById('backToOverallDashBtn').addEventListener('click', () => {
  document.getElementById('overallDashboardContainer').style.display = 'block';
  document.getElementById('employeeReportContainer').style.display = 'none';
  document.getElementById('empReportSelector').value = ''; 
});

function renderEmployeeReport(data) {
  // 1. KPIs
  document.getElementById('empReportKpis').innerHTML = `
    <div class="kpi-card" style="--bar-color:var(--accent);">
      <div class="kpi-label">Total WFH Days</div>
      <div class="kpi-value">${data.totalWfhDays}</div>
      <div class="kpi-sub">In selected period</div>
    </div>
    <div class="kpi-card" style="--bar-color:var(--green);">
      <div class="kpi-label">Total Compliance</div>
      <div class="kpi-value">${data.compliance}%</div>
      <div class="kpi-sub">Overall score</div>
    </div>
    <div class="kpi-card" style="--bar-color:var(--green);">
      <div class="kpi-label">Total Achievement</div>
      <div class="kpi-value">${data.totalPass}</div>
      <div class="kpi-sub">Checks marked 'Yes'</div>
    </div>
    <div class="kpi-card" style="--bar-color:var(--red);">
      <div class="kpi-label">Not Achievement</div>
      <div class="kpi-value">${data.totalFail}</div>
      <div class="kpi-sub">Checks marked 'No'</div>
    </div>
  `;

  // 2. Breakdown Table
  const tbody = document.getElementById('empReportBreakdownBody');
  if(!data.breakdown.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No checkpoints found.</td></tr>';
  } else {
    tbody.innerHTML = data.breakdown.map(cp => `
      <tr>
        <td><b>${cp.name}</b><br><span style="font-size:11px;color:var(--text-2);">${cp.time}</span></td>
        <td style="text-align:center;">${cp.zoom.req} / <span style="color:var(--green)">${cp.zoom.pass}</span> / <span style="color:var(--red)">${cp.zoom.fail}</span></td>
        <td style="text-align:center;">${cp.camera.req} / <span style="color:var(--green)">${cp.camera.pass}</span> / <span style="color:var(--red)">${cp.camera.fail}</span></td>
        <td style="text-align:center;">${cp.tl.req} / <span style="color:var(--green)">${cp.tl.pass}</span> / <span style="color:var(--red)">${cp.tl.fail}</span></td>
      </tr>
    `).join('');
  }

  // 3. Non-Compliance List
  const ncList = document.getElementById('empReportNonComplianceList');
  if(!data.nonCompliantDates.length) {
    ncList.innerHTML = '<div class="empty-state" style="color:var(--green);">Perfect record! No non-compliance found in this period.</div>';
  } else {
    ncList.innerHTML = data.nonCompliantDates.map(d => `
      <div class="flag-item">
        <div class="flag-dot"></div>
        <div>
          <div class="flag-name">${d.date}</div>
          <div class="flag-detail" style="color:var(--red); font-weight:600;">Failed: ${d.flags.join(' · ')}</div>
        </div>
      </div>
    `).join('');
  }
  
  // 4. FIX: Date-Wise Matrix Report Generation
  renderEmployeeMatrixTable(data.checkpointsList, data.detailedGrid);
}

// NEW FIX: Function to render the matrix table by Date
function renderEmployeeMatrixTable(checkpoints, gridData) {
  const wrap = document.getElementById('empMasterTableWrapper');
  
  if(!gridData || !gridData.length) { 
    wrap.innerHTML = '<div class="empty-state">No scheduled WFH data found for this period.</div>'; 
    return; 
  }

  let theadHTML = `
    <tr>
      <th rowspan="2">DATE</th>
      ${checkpoints.map(cp => `<th colspan="3">${cp.name}<br><span style="font-size:9px;font-weight:normal">${cp.time}</span></th>`).join('')}
    </tr>
    <tr>
      ${checkpoints.map(() => `<th>Zoom log in</th><th>Camera Status</th><th>TL -Sc Visiblity</th>`).join('')}
    </tr>
  `;

  let tbodyHTML = gridData.map(row => {
    const tds = row.checks.map(c => {
      return `${getFormattedTd(c.zoom)}${getFormattedTd(c.camera)}${getFormattedTd(c.tlsc)}`;
    }).join('');
    
    return `<tr><td class="emp-name-col">${row.date}</td>${tds}</tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="master-report-table">
      <thead>${theadHTML}</thead>
      <tbody>${tbodyHTML}</tbody>
    </table>
  `;
}

// ============================================================
// VERIFICATION
// ============================================================
document.getElementById('verifyDate').addEventListener('change', loadVerification);

document.getElementById('verifyViewToggle').addEventListener('change', (e) => {
  isCardView = e.target.checked;
  const listEl = document.getElementById('verificationList');
  if (isCardView) { 
    listEl.classList.remove('list-layout'); 
    listEl.classList.add('card-layout'); 
  } else { 
    listEl.classList.remove('card-layout'); 
    listEl.classList.add('list-layout'); 
  }
});

document.getElementById('verifySearchInput').addEventListener('input', renderVerificationUI);

async function loadVerification() {
  const date = document.getElementById('verifyDate').value || todayStr();
  const el = document.getElementById('verificationList');
  el.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const res = await API.getVerificationSheet(date);
    currentVerificationData = res.employees || [];
    renderVerificationUI();
  } catch (err) {
    showToast(err.message, true); 
    el.innerHTML = '<div class="empty-state">Could not load verification sheet.</div>';
  }
}

window.toggleEmpView = function(empId) {
  if(!isCardView) return; 
  const container = document.querySelector(`.emp-container[data-emp-id="${empId}"]`);
  if (container) { 
    container.classList.toggle('expanded'); 
  }
}

function renderVerificationUI() {
  const date = document.getElementById('verifyDate').value || todayStr();
  const el = document.getElementById('verificationList');
  const searchVal = document.getElementById('verifySearchInput').value.toLowerCase();
  
  const filteredData = currentVerificationData.filter(e => e.empName.toLowerCase().includes(searchVal));

  if (!currentVerificationData.length) { 
    el.innerHTML = '<div class="empty-state">No employees are scheduled WFH on this date.</div>'; 
    return; 
  }
  
  if (!filteredData.length) { 
    el.innerHTML = '<div class="empty-state">No matching employees found.</div>'; 
    return; 
  }

  el.innerHTML = filteredData.map(emp => {
    const pillsHTML = emp.checks.map(c => {
      const isMarked = c.zoomStatus !== '' || c.cameraStatus !== '' || c.tlScStatus !== '';
      return `<span class="cp-pill ${isMarked ? 'done' : 'pending'}">${c.checkpointName} ${isMarked ? '✓' : '•'}</span>`;
    }).join('');

    return `
      <div class="emp-container" data-emp-id="${emp.empId}">
        <div class="emp-card" onclick="toggleEmpView('${emp.empId}')">
          <div class="emp-group-title">${emp.empName}</div>
          <div class="emp-group-sub">${emp.team} · <span style="color:var(--accent);">${emp.wfhType}</span></div>
          <div class="card-pills-wrap">${pillsHTML}</div>
        </div>
        <div class="emp-group emp-details" data-emp-name="${emp.empName}">
          <div class="emp-group-header">
            <div>
              <div class="emp-group-title">${emp.empName}</div>
              <div class="emp-group-sub">${emp.team} · <span class="badge badge-${emp.wfhType.toLowerCase()}">${emp.wfhType}</span></div>
            </div>
            ${isCardView ? `<button class="btn btn-sm" onclick="toggleEmpView('${emp.empId}')" style="background:transparent; border:1px solid var(--glass-border);">Close ✕</button>` : ''}
          </div>
          ${emp.checks.map(c => {
            const isLocked = c.zoomStatus !== '' || c.cameraStatus !== '' || c.tlScStatus !== '';
            const lockClass = isLocked ? 'locked-check-row' : '';
            return `
            <div class="check-row ${lockClass}" data-checkpoint-id="${c.checkpointId}" data-checkpoint-name="${c.checkpointName}">
              <div class="check-row-top">
                <div class="check-row-label"><b>${c.checkpointName}</b>${c.time}</div>
                <div class="status-groups">
                  <div class="status-group" data-field="zoom">
                    <div class="check-col-label">Zoom</div>
                    <div class="btn-toggle-group">${statusButtons(c.zoomStatus, isLocked)}</div>
                  </div>
                  <div class="status-group" data-field="camera">
                    <div class="check-col-label">Camera</div>
                    <div class="btn-toggle-group">${statusButtons(c.cameraStatus, isLocked)}</div>
                  </div>
                  <div class="status-group" data-field="tlsc">
                    <div class="check-col-label">TL / Screenshot</div>
                    <div class="btn-toggle-group">${statusButtons(c.tlScStatus, isLocked)}</div>
                  </div>
                </div>
              </div>
              <div class="check-row-bottom">
                <input type="text" class="remarks-input" placeholder="Add a remark (optional)" value="${(c.remarks || '').replace(/"/g, '&quot;')}" ${isLocked ? 'readonly' : ''}>
                
                ${isLocked 
                  ? (c.proofUrl ? `<a href="${c.proofUrl}" target="_blank" class="proof-link">📎 View Proofs</a>` : `<span style="font-size:11px;color:var(--text-2);margin-left:8px;">No proof</span>`)
                  : `<input type="file" class="file-input proof-upload" accept="image/*" multiple title="Attach proofs (Max 5MB per file)">
                     <input type="hidden" class="existing-proof" value="${c.proofUrl || ''}">`
                }
                
                <button class="btn btn-sm btn-accent save-check-btn">Save</button>
                <div class="locked-badge">✓ Verified ${c.verifiedBy ? 'by ' + c.verifiedBy : ''}</div>
              </div>
            </div>
          `}).join('')}
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.status-group');
      group.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active')); 
      btn.classList.add('active');
    });
  });
  
  el.querySelectorAll('.save-check-btn').forEach(btn => { 
    btn.addEventListener('click', () => saveCheckRow(btn, date)); 
  });
}

function statusButtons(current, isLocked) {
  return ['Yes', 'No', 'NA', 'Leave', 'Meeting', 'HD', 'Shift Over'].map(o => `
    <button type="button" class="status-btn ${o === current ? 'active' : ''}" data-value="${o}" ${isLocked ? 'disabled' : ''}>${o}</button>
  `).join('');
}

async function saveCheckRow(btn, date) {
  const row = btn.closest('.check-row');
  const detailsGroup = btn.closest('.emp-details'); 
  const empContainer = btn.closest('.emp-container');
  const empId = empContainer.dataset.empId;
  const cpId = row.dataset.checkpointId;
  
  const getVal = (field) => { 
    const active = row.querySelector(`.status-group[data-field="${field}"] .status-btn.active`); 
    return active ? active.dataset.value : ''; 
  };

  setBtnLoading(btn, true);

  // File processing logic for MULTIPLE files
  let proofFiles = [];
  const fileInput = row.querySelector('.proof-upload');
  const existingProof = row.querySelector('.existing-proof') ? row.querySelector('.existing-proof').value : '';

  if (fileInput && fileInput.files.length > 0) {
    for (let i = 0; i < fileInput.files.length; i++) {
      const file = fileInput.files[i];
      if (file.size > 5 * 1024 * 1024) { // 5MB Limit per file
        showToast(`File ${file.name} is too large. Max 5MB allowed.`, true);
        setBtnLoading(btn, false);
        return;
      }
      
      const ext = file.name.split('.').pop();
      const safeName = (detailsGroup.dataset.empName + '_' + row.dataset.checkpointName + '_img' + (i+1)).replace(/[^a-z0-9]/gi, '_');
      const proofName = `${safeName}_${date}.${ext}`;

      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
      });
      
      proofFiles.push({
        base64: base64,
        mimeType: file.type,
        name: proofName
      });
    }
  }
  
  const payload = {
    date, 
    empId: empId, 
    empName: detailsGroup.dataset.empName, 
    checkpointId: cpId, 
    checkpointName: row.dataset.checkpointName,
    zoomStatus: getVal('zoom'), 
    cameraStatus: getVal('camera'), 
    tlScStatus: getVal('tlsc'), 
    verifiedBy: currentUser.name, 
    remarks: row.querySelector('.remarks-input').value.trim(),
    proofFiles: proofFiles, // Sending array of files
    existingProof: existingProof
  };
  
  try {
    const res = await API.saveTransaction(payload);
    showToast(`Saved: ${payload.empName} — ${payload.checkpointName}`);
    
    const empData = currentVerificationData.find(e => e.empId === empId);
    if(empData) {
      const checkData = empData.checks.find(c => c.checkpointId === cpId);
      if(checkData) { 
        checkData.zoomStatus = payload.zoomStatus; 
        checkData.cameraStatus = payload.cameraStatus; 
        checkData.tlScStatus = payload.tlScStatus; 
        checkData.remarks = payload.remarks; 
        checkData.verifiedBy = currentUser.name; 
        checkData.proofUrl = res.proofUrl; // Update with Drive folder link
      }
    }
    
    row.classList.add('locked-check-row');
    row.querySelectorAll('.status-btn, .remarks-input, .proof-upload').forEach(el => el.disabled = true);
    row.querySelector('.locked-badge').innerHTML = `✓ Verified by ${currentUser.name}`;

    const wasExpanded = empContainer.classList.contains('expanded');
    renderVerificationUI(); 
    if (wasExpanded && isCardView) { 
      document.querySelector(`.emp-container[data-emp-id="${empId}"]`).classList.add('expanded'); 
    }
  } catch (err) { 
    showToast(err.message, true); 
    setBtnLoading(btn, false); 
  }
}

// ============================================================
// SCHEDULE WFH
// ============================================================
document.getElementById('openScheduleModal').addEventListener('click', async () => {
  if (!cachedEmployees.length) await refreshEmployeeCache();
  if (!cachedSchedules.length) await loadSchedule(); 
  
  const today = todayStr();
  document.getElementById('scheduleDate').value = today; 
  
  const targetDateObj = new Date(today); 
  targetDateObj.setHours(0,0,0,0); 
  const targetTime = targetDateObj.getTime();
  
  const alreadyScheduledIds = cachedSchedules.filter(s => {
    if (s.Status !== 'Active') return false;
    const from = new Date(s.FromDate); from.setHours(0,0,0,0);
    const to = new Date(s.ToDate); to.setHours(0,0,0,0);
    return targetTime >= from.getTime() && targetTime <= to.getTime();
  }).map(s => s.EmpID);

  const list = document.getElementById('scheduleEmpList');
  const availableEmps = cachedEmployees.filter(e => e.Status === 'Active' && !alreadyScheduledIds.includes(e.EmpID));

  if (availableEmps.length === 0) { 
    list.innerHTML = `<div class="empty-state" style="padding:10px;">All active employees are already scheduled for today!</div>`; 
  } else { 
    list.innerHTML = availableEmps.map(e => `
      <label class="checkbox-item" data-wfh-type="${e.WFHType}">
        <input type="checkbox" value="${e.EmpID}" data-name="${e.EmpName}" data-type="${e.WFHType}"> 
        ${e.EmpName} (${e.WFHType})
      </label>
    `).join(''); 
  }

  document.getElementById('selectAllPerm').checked = false; 
  openModal('scheduleModalOverlay');
});

document.getElementById('selectAllPerm').addEventListener('change', (e) => {
  const isChecked = e.target.checked; 
  const items = document.querySelectorAll('#scheduleEmpList .checkbox-item');
  items.forEach(item => {
    const checkbox = item.querySelector('input[type="checkbox"]');
    if (isChecked) { 
      if (checkbox.dataset.type === 'Permanent') { 
        checkbox.checked = true; 
        item.style.display = 'flex'; 
      } else { 
        checkbox.checked = false; 
        item.style.display = 'none'; 
      } 
    } else { 
      checkbox.checked = false; 
      item.style.display = 'flex'; 
    }
  });
});

document.getElementById('submitSchedule').addEventListener('click', async (e) => {
  const btn = e.target; 
  const checkedBoxes = Array.from(document.querySelectorAll('#scheduleEmpList input:checked'));
  if (!checkedBoxes.length) { 
    showToast('Select at least one employee', true); 
    return; 
  }
  
  const employees = checkedBoxes.map(cb => ({ empId: cb.value, empName: cb.dataset.name }));
  const dateVal = todayStr();

  setBtnLoading(btn, true);
  try { 
    await API.addSchedule({ employees, fromDate: dateVal, toDate: dateVal, requestedBy: currentUser.name }); 
    showToast(`Scheduled WFH for ${employees.length} employee(s)`); 
    closeModal('scheduleModalOverlay'); 
    loadSchedule(); 
  } catch (err) { 
    showToast(err.message, true); 
  } finally { 
    setBtnLoading(btn, false); 
  }
});

async function loadSchedule() {
  const tbody = document.getElementById('scheduleTableBody'); 
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading…</td></tr>';
  try {
    const res = await API.getSchedules(); 
    cachedSchedules = res.data; 
    if (!res.data.length) { 
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No WFH schedules yet.</td></tr>'; 
      return; 
    }
    tbody.innerHTML = res.data.map(s => `
      <tr>
        <td>${s.EmpName}</td>
        <td>${fmtDate(s.FromDate)}</td>
        <td>${fmtDate(s.ToDate)}</td>
        <td><span class="badge badge-${String(s.Status).toLowerCase()}">${s.Status}</span></td>
        <td>${s.RequestedBy}</td>
        <td>${s.Status === 'Active' ? `<button class="btn btn-sm btn-danger" onclick="closeSchedule(this, '${s.ScheduleID}')">Close</button>` : ''}</td>
      </tr>
    `).join('');
  } catch (err) { 
    showToast(err.message, true); 
  }
}

async function closeSchedule(btn, scheduleId) {
  setBtnLoading(btn, true, '…');
  try { 
    await API.updateScheduleStatus({ scheduleId, status: 'Closed', updatedBy: currentUser.name }); 
    showToast('Schedule closed'); 
    loadSchedule(); 
  } catch (err) { 
    showToast(err.message, true); 
    setBtnLoading(btn, false); 
  }
}

function fmtDate(d) { 
  const date = new Date(d); 
  if (isNaN(date)) return d; 
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); 
}

// ============================================================
// EMPLOYEES
// ============================================================
document.getElementById('openEmployeeModal').addEventListener('click', () => { 
  document.getElementById('empNameInput').value = ''; 
  document.getElementById('empTeamInput').value = 'General'; 
  document.getElementById('empTypeInput').value = 'Permanent'; 
  openModal('employeeModalOverlay'); 
});

document.getElementById('submitEmployee').addEventListener('click', async (e) => {
  const btn = e.target; 
  const empName = document.getElementById('empNameInput').value.trim();
  if (!empName) { 
    showToast('Enter employee name', true); 
    return; 
  }
  
  setBtnLoading(btn, true);
  try { 
    await API.addEmployee({ 
      empName, 
      team: document.getElementById('empTeamInput').value.trim() || 'General', 
      wfhType: document.getElementById('empTypeInput').value, 
      createdBy: currentUser.name 
    }); 
    showToast('Employee added'); 
    closeModal('employeeModalOverlay'); 
    loadEmployees(); 
  } catch (err) { 
    showToast(err.message, true); 
  } finally { 
    setBtnLoading(btn, false); 
  }
});

async function refreshEmployeeCache() { 
  const res = await API.getEmployees(); 
  cachedEmployees = res.data; 
}

// NEW: Search Input Event Listener
document.getElementById('empSearchInput').addEventListener('input', (e) => {
  const searchVal = e.target.value.toLowerCase();
  const filteredData = cachedEmployees.filter(emp => 
    emp.EmpName.toLowerCase().includes(searchVal) || 
    emp.EmpID.toLowerCase().includes(searchVal)
  );
  renderEmployeeTable(filteredData);
});

async function loadEmployees() {
  const tbody = document.getElementById('employeeTableBody'); 
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading…</td></tr>';
  // Clear search bar on reload
  document.getElementById('empSearchInput').value = ''; 
  
  try {
    await refreshEmployeeCache();
    renderEmployeeTable(cachedEmployees);
  } catch (err) { 
    showToast(err.message, true); 
  }
}

// NEW: Extracted rendering logic into its own function so search can use it
function renderEmployeeTable(data) {
  const tbody = document.getElementById('employeeTableBody');
  if (!data.length) { 
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No employees found.</td></tr>'; 
    return; 
  }
  
  tbody.innerHTML = data.map(e => `
    <tr>
      <td style="color:var(--text-2);font-family:var(--font-mono);font-size:12px;">${e.EmpID}</td>
      <td>${e.EmpName}</td>
      <td>${e.Team}</td>
      <td>
        <select class="status-select" onchange="updateEmpField('${e.EmpID}','wfhType',this.value)">
          <option ${e.WFHType === 'Permanent' ? 'selected' : ''}>Permanent</option>
          <option ${e.WFHType === 'Temporary' ? 'selected' : ''}>Temporary</option>
        </select>
      </td>
      <td>
        <select class="status-select" onchange="updateEmpField('${e.EmpID}','status',this.value)">
          <option ${e.Status === 'Active' ? 'selected' : ''}>Active</option>
          <option ${e.Status === 'Inactive' ? 'selected' : ''}>Inactive</option>
        </select>
      </td>
      <td></td>
    </tr>
  `).join('');
}

async function updateEmpField(empId, field, value) { 
  try { 
    await API.updateEmployee({ empId, [field]: value, updatedBy: currentUser.name }); 
    showToast('Employee updated'); 
  } catch (err) { 
    showToast(err.message, true); 
  } 
}

// ============================================================
// CHECKPOINTS (admin)
// ============================================================
document.getElementById('openCheckpointModal').addEventListener('click', () => { 
  document.getElementById('cpNameInput').value = ''; 
  document.getElementById('cpTimeInput').value = ''; 
  openModal('checkpointModalOverlay'); 
});

document.getElementById('submitCheckpoint').addEventListener('click', async (e) => {
  const btn = e.target; 
  const checkpointName = document.getElementById('cpNameInput').value.trim(); 
  const time = document.getElementById('cpTimeInput').value.trim();
  
  if (!checkpointName || !time) { 
    showToast('Fill all fields', true); 
    return; 
  }
  
  setBtnLoading(btn, true);
  try { 
    await API.addCheckpoint({ checkpointName, time, createdBy: currentUser.name }); 
    showToast('Checkpoint added'); 
    closeModal('checkpointModalOverlay'); 
    loadCheckpoints(); 
  } catch (err) { 
    showToast(err.message, true); 
  } finally { 
    setBtnLoading(btn, false); 
  }
});

async function loadCheckpoints() {
  const tbody = document.getElementById('checkpointTableBody'); 
  tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Loading…</td></tr>';
  try {
    const res = await API.getCheckpoints(); 
    cachedCheckpoints = res.data;
    if (!cachedCheckpoints.length) { 
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No checkpoints yet.</td></tr>'; 
      return; 
    }
    tbody.innerHTML = cachedCheckpoints.map(c => `
      <tr>
        <td>${c.CheckpointName}</td>
        <td style="font-family:var(--font-mono);">${c.Time}</td>
        <td>
          <select class="status-select" onchange="updateCheckpointStatus('${c.CheckpointID}',this.value)">
            <option ${c.Status === 'Active' ? 'selected' : ''}>Active</option>
            <option ${c.Status === 'Inactive' ? 'selected' : ''}>Inactive</option>
          </select>
        </td>
        <td></td>
      </tr>
    `).join('');
  } catch (err) { 
    showToast(err.message, true); 
  }
}

async function updateCheckpointStatus(checkpointId, status) { 
  try { 
    await API.updateCheckpoint({ checkpointId, status, updatedBy: currentUser.name }); 
    showToast('Checkpoint updated'); 
  } catch (err) { 
    showToast(err.message, true); 
  } 
}

// ============================================================
// USERS (admin)
// ============================================================
document.getElementById('openUserModal').addEventListener('click', () => { 
  document.getElementById('userNameInput').value = ''; 
  document.getElementById('userEmailInput').value = ''; 
  document.getElementById('userPasswordInput').value = ''; 
  document.getElementById('userRoleInput').value = 'Verifier'; 
  openModal('userModalOverlay'); 
});

document.getElementById('submitUser').addEventListener('click', async (e) => {
  const btn = e.target; 
  const name = document.getElementById('userNameInput').value.trim(); 
  const email = document.getElementById('userEmailInput').value.trim(); 
  const password = document.getElementById('userPasswordInput').value; 
  const role = document.getElementById('userRoleInput').value;
  
  if (!name || !email || !password) { 
    showToast('Fill all fields', true); 
    return; 
  }
  
  setBtnLoading(btn, true);
  try { 
    await API.addUser({ name, email, password, role, createdBy: currentUser.name }); 
    showToast('User added'); 
    closeModal('userModalOverlay'); 
    loadUsers(); 
  } catch (err) { 
    showToast(err.message, true); 
  } finally { 
    setBtnLoading(btn, false); 
  }
});

async function loadUsers() {
  const tbody = document.getElementById('userTableBody'); 
  tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading…</td></tr>';
  try {
    const res = await API.getUsers();
    if (!res.data.length) { 
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No users yet.</td></tr>'; 
      return; 
    }
    tbody.innerHTML = res.data.map(u => `
      <tr>
        <td>${u.Name}</td>
        <td style="color:var(--text-1);">${u.Email}</td>
        <td><span class="badge badge-permanent">${u.Role}</span></td>
        <td>
          <select class="status-select" onchange="updateUserStatusField('${u.UserID}',this.value)">
            <option ${u.Status === 'Active' ? 'selected' : ''}>Active</option>
            <option ${u.Status === 'Inactive' ? 'selected' : ''}>Inactive</option>
          </select>
        </td>
        <td></td>
      </tr>
    `).join('');
  } catch (err) { 
    showToast(err.message, true); 
  }
}

async function updateUserStatusField(userId, status) { 
  try { 
    await API.updateUserStatus({ userId, status, updatedBy: currentUser.name }); 
    showToast('User updated'); 
  } catch (err) { 
    showToast(err.message, true); 
  } 
}