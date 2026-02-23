/**
 * Vasundharaa Attendance Pro v3.0
 */

// --- SUPABASE CONFIGURATION ---
// Replace these with your actual keys from Supabase Settings > API
const SUPABASE_URL = 'https://qyjzaxraxhvgfxljuhoc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2ZyElXzSwG7000mr1ZLIkg_RLsgDH1_';
let attendanceDb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// --- STATE MANAGEMENT ---
let currentUser = null;
let stream = null;
let capturedBase64 = null;
let userCoords = null;
let gpsAccuracy = 0;
let timerInterval = null;
let currentDeviceId = null;
let config = JSON.parse(localStorage.getItem('attendance_pro_config')) || {
    lat: 13.0827, // Default Chennai lat
    lng: 80.2707, // Default Chennai lng
    radius: 50,
    salaryDay: 500,
    salaryOT: 100,
    deviceBinding: true
};

let employees = JSON.parse(localStorage.getItem('attendance_pro_employees')) || [
    { id: 'EMP001', name: 'Alex Rivera', role: 'employee', pass: '123', deviceId: null },
    { id: 'admin', name: 'Store Manager', role: 'admin', pass: 'admin', deviceId: null }
];

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    // Generate or get Device ID
    currentDeviceId = localStorage.getItem('attendance_device_id');
    if (!currentDeviceId) {
        currentDeviceId = 'DEV-' + Math.random().toString(36).substr(2, 9).toUpperCase();
        localStorage.setItem('attendance_device_id', currentDeviceId);
    }

    // Initialize UI first so buttons work
    setupNav();
    setupEventListeners();
    showScreen('login-screen');

    // Then sync from DB in the background
    console.log("Connecting to Supabase...");
    syncFromSupabase().then(() => {
        console.log("Supabase Synced Successfully!");
    }).catch(err => {
        console.error("Database Connection Failed. Check if you created the tables.");
    });
}

async function syncFromSupabase() {
    if (!attendanceDb) return;
    try {
        // Sync Employees
        const { data: emps } = await attendanceDb.from('v_employees').select('*');
        if (emps) employees = emps;

        // Sync Config
        const { data: cfg } = await attendanceDb.from('v_config').select('*').eq('id', 1).single();
        if (cfg) config = cfg;
    } catch (e) { console.error("Sync Error", e); }
}

async function getRecords() {
    if (!attendanceDb) return JSON.parse(localStorage.getItem('attendance_pro_records')) || [];
    const { data } = await attendanceDb.from('v_records').select('*').order('timestamp', { ascending: false });
    return data || [];
}

async function handleLogin() {
    const id = document.getElementById('login-id').value.trim();
    const pass = document.getElementById('login-pass').value;

    let user;
    if (id === 'admin') {
        // Admin bypass - no password needed
        user = employees.find(e => e.id === 'admin');
    } else {
        user = employees.find(e => e.id === id && e.pass === pass);
    }

    if (!user) return alert('Invalid Credentials.');

    // Device Binding Check
    if (config.deviceBinding !== false && user.deviceId && user.deviceId !== currentDeviceId) {
        return alert('Security Error: This account is bound to another device. Contact Admin.');
    }

    // First time login - Bind device
    if (!user.deviceId) {
        user.deviceId = currentDeviceId;
        await saveEmployees();
    }

    currentUser = user;
    if (user.role === 'admin') {
        document.getElementById('admin-name-display').innerText = user.name;
        showScreen('admin-main');
        switchSection('home');
    } else {
        document.getElementById('emp-name-display').innerText = user.name;
        showScreen('emp-main');
        switchSection('home');
        startGPSMonitoring();
        updateShiftStatus();
    }
}
async function saveEmployees() {
    localStorage.setItem('attendance_pro_employees', JSON.stringify(employees));
    if (attendanceDb) {
        await attendanceDb.from('v_employees').upsert(employees);
    }
}

function setupEventListeners() {
    // Auth
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('btn-admin-direct').addEventListener('click', loginAsAdmin);

    // Employee Actions
    document.getElementById('btn-toggle-attendance').addEventListener('click', startVerificationFlow);
    document.getElementById('btn-capture').addEventListener('click', captureSelfie);
    document.getElementById('btn-confirm-attendance').addEventListener('click', submitAttendance);
    document.getElementById('btn-retake').addEventListener('click', () => {
        document.getElementById('confirm-controls').classList.add('hidden');
        document.getElementById('verification-controls').classList.remove('hidden');
        document.getElementById('video').style.display = 'block';
        document.getElementById('captured-image').style.display = 'none';
        startCamera();
    });
    document.getElementById('btn-cancel-verification').addEventListener('click', () => {
        stopCamera();
        showScreen('emp-main');
    });

    // Admin Actions
    document.getElementById('btn-save-config').addEventListener('click', saveConfig);
    document.getElementById('btn-set-current-loc').addEventListener('click', setCurrentGPS);
    document.getElementById('btn-add-employee').addEventListener('click', addEmployee);
    document.getElementById('btn-export-reports').addEventListener('click', exportExcel);

    // Logout
    document.getElementById('nav-logout').addEventListener('click', logout);

    // Settings Toggles
    document.getElementById('toggle-device-binding').addEventListener('click', () => {
        config.deviceBinding = !config.deviceBinding;
        saveConfig(false);
        updateToggleUI();
    });
}

// --- NAVIGATION & UI ---
function setupNav() {
    const navItems = document.querySelectorAll('.nav-item[data-section]');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const section = item.getAttribute('data-section');
            switchSection(section);

            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

function switchSection(sectionName) {
    const isEmp = currentUser && currentUser.role === 'employee';
    const sections = document.querySelectorAll('.dashboard-section');
    sections.forEach(s => s.classList.remove('active'));

    if (isEmp) {
        if (sectionName === 'home') document.getElementById('section-emp-home').classList.add('active');
        if (sectionName === 'history') {
            document.getElementById('section-emp-history').classList.add('active');
            renderEmployeeHistory();
        }
        if (sectionName === 'reports') alert('Salary reports are visible to Admin only.');
    } else {
        if (sectionName === 'home') {
            document.getElementById('section-admin-home').classList.add('active');
            renderAdminStats();
        }
        if (sectionName === 'history') {
            document.getElementById('section-admin-team').classList.add('active');
            renderEmployeeManagement();
        }
        if (sectionName === 'reports') {
            document.getElementById('section-admin-salary').classList.add('active');
            renderSalaryModule();
        }
        if (sectionName === 'settings') {
            document.getElementById('section-admin-geofence').classList.add('active');
            // Update inputs with current config
            document.getElementById('shop-lat').value = config.lat;
            document.getElementById('shop-lng').value = config.lng;
            document.getElementById('shop-radius').value = config.radius;
            document.getElementById('salary-rate-day').value = config.salaryDay;
            document.getElementById('salary-rate-ot').value = config.salaryOT;
            updateToggleUI();
        }
    }
}

function showScreen(screenId) {
    const screens = ['login-screen', 'emp-main', 'admin-main', 'verification-screen'];
    screens.forEach(s => document.getElementById(s).classList.add('hidden'));

    const dashboardContent = document.getElementById('dashboard-content');

    if (screenId === 'emp-main' || screenId === 'admin-main') {
        dashboardContent.classList.remove('hidden');
        document.getElementById(screenId).classList.remove('hidden');
        document.getElementById('app-nav').classList.remove('hidden');
    } else {
        dashboardContent.classList.add('hidden');
        document.getElementById(screenId).classList.remove('hidden');
        document.getElementById('app-nav').classList.add('hidden');
    }
}

// --- AUTH LOGIC ---
function logout() {
    currentUser = null;
    document.getElementById('nav-reports').classList.remove('hidden'); // Reset visibility
    stopGPSMonitoring();
    stopShiftTimer();
    showScreen('login-screen');
}

function loginAsAdmin() {
    const admin = employees.find(e => e.role === 'admin') || { id: 'admin', name: 'Store Manager', role: 'admin' };
    currentUser = admin;
    document.getElementById('admin-name-display').innerText = admin.name;
    showScreen('admin-main');
    switchSection('home');
}

// --- GPS & GEOFENCING ---
let gpsInterval = null;
function startGPSMonitoring() {
    if (gpsInterval) clearInterval(gpsInterval);
    gpsInterval = setInterval(updatePosition, 5000);
    updatePosition();
}

function stopGPSMonitoring() {
    if (gpsInterval) clearInterval(gpsInterval);
}

function updatePosition() {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        userCoords = { lat: latitude, lng: longitude };
        gpsAccuracy = Math.round(accuracy);

        // Update UI
        const accText = document.getElementById('gps-accuracy-text');
        accText.innerText = `GPS: ${gpsAccuracy}m`;
        document.getElementById('gps-accuracy-pill').className =
            accuracy < 20 ? 'status-pill status-valid' : 'status-pill status-warning';

        const dist = calculateDistance(latitude, longitude, config.lat, config.lng);
        const distEl = document.getElementById('distance-value');
        const statusEl = document.getElementById('geofence-status');

        if (distEl) distEl.innerText = `${Math.round(dist)}m`;
        if (statusEl) {
            if (dist <= config.radius) {
                statusEl.innerText = 'Inside Radius';
                statusEl.className = 'text-success';
            } else {
                statusEl.innerText = 'Outside Range';
                statusEl.className = 'text-error';
            }
        }
    }, err => {
        console.warn('GPS Error', err);
    }, { enableHighAccuracy: true });
}

// --- ATTENDANCE FLOW ---
async function startVerificationFlow() {
    if (!userCoords) {
        return alert('Detecting your location... Please wait a moment.');
    }

    const dist = calculateDistance(userCoords.lat, userCoords.lng, config.lat, config.lng);

    if (dist > config.radius) {
        return alert(`Access Blocked. You are ${Math.round(dist)}m away from the shop.`);
    }

    // Relaxed accuracy check: Increase limit for indoor use (500m)
    if (gpsAccuracy > 500) {
        return alert('GPS signal is too weak (Accuracy: ' + gpsAccuracy + 'm). Please move closer to a window.');
    }

    showScreen('verification-screen');
    await startCamera();
}

async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' },
            audio: false
        });
        document.getElementById('video').srcObject = stream;
    } catch (err) {
        alert('Camera Access Denied.');
        showScreen('emp-main');
    }
}

function stopCamera() {
    if (stream) stream.getTracks().forEach(t => t.stop());
}

function captureSelfie() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    capturedBase64 = canvas.toDataURL('image/jpeg', 0.8);

    video.style.display = 'none';
    const img = document.getElementById('captured-image');
    img.src = capturedBase64;
    img.style.display = 'block';

    document.getElementById('verification-controls').classList.add('hidden');
    document.getElementById('confirm-controls').classList.remove('hidden');
    stopCamera();
}

async function submitAttendance() {
    const records = await getRecords();
    const now = new Date();
    const today = now.toLocaleDateString();

    const todayIn = records.find(r => r.empId === currentUser.id && r.date === today && r.type === 'IN');
    const type = todayIn ? 'OUT' : 'IN';

    // Status Logic
    let status = 'Present';
    if (type === 'IN') {
        const hour = now.getHours();
        const mins = now.getMinutes();
        if (hour > 9 || (hour === 9 && mins > 30)) status = 'Late';
    }

    const record = {
        empId: currentUser.id,
        empName: currentUser.name,
        timestamp: now.toISOString(),
        time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: today,
        coords: userCoords,
        image: capturedBase64,
        type: type,
        status: status,
        deviceId: currentDeviceId
    };

    if (attendanceDb) {
        await attendanceDb.from('v_records').insert([record]);
    } else {
        records.unshift(record);
        localStorage.setItem('attendance_pro_records', JSON.stringify(records));
    }

    alert(`Successfully Checked ${type}!`);
    showScreen('emp-main');
    updateShiftStatus();
    switchSection('home');
}

// --- DASHBOARD UPDATES ---
async function updateShiftStatus() {
    const records = await getRecords();
    const today = new Date().toLocaleDateString();
    const todayLogs = records.filter(r => r.empId === currentUser.id && r.date === today);

    const todayIn = todayLogs.find(r => r.type === 'IN');
    const todayOut = todayLogs.find(r => r.type === 'OUT');

    const badge = document.getElementById('attendance-status-badge');
    const btnText = document.getElementById('attendance-btn-text');
    const toggleBtn = document.getElementById('btn-toggle-attendance');
    const timerLabel = document.getElementById('timer-label');

    if (todayOut) {
        badge.className = 'status-pill status-invalid';
        badge.querySelector('span').innerText = 'Shift Ended';
        btnText.innerText = 'Completed';
        toggleBtn.disabled = true;
        stopShiftTimer();
    } else if (todayIn) {
        badge.className = 'status-pill status-valid';
        badge.querySelector('span').innerText = 'At Work';
        btnText.innerText = 'Check Out';
        toggleBtn.disabled = false;
        timerLabel.classList.remove('hidden');
        startShiftTimer(new Date(todayIn.timestamp));
    } else {
        badge.className = 'status-pill status-invalid';
        badge.querySelector('span').innerText = 'Off Duty';
        btnText.innerText = 'Check In';
        toggleBtn.disabled = false;
        timerLabel.classList.add('hidden');
        stopShiftTimer();
    }
}

function startShiftTimer(startTime) {
    if (timerInterval) clearInterval(timerInterval);
    const timerEl = document.getElementById('live-timer');

    timerInterval = setInterval(() => {
        const diff = new Date() - startTime;
        const hrs = Math.floor(diff / 3600000).toString().padStart(2, '0');
        const mins = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
        const secs = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
        timerEl.innerText = `${hrs}:${mins}:${secs}`;
    }, 1000);
}

function stopShiftTimer() {
    if (timerInterval) clearInterval(timerInterval);
    document.getElementById('live-timer').innerText = '00:00:00';
}

// --- RENDERERS ---
async function renderEmployeeHistory() {
    const listEl = document.getElementById('employee-history-list');
    const records = await getRecords();
    const myRecords = records.filter(r => r.empId === currentUser.id);

    listEl.innerHTML = myRecords.length ? '' : '<p class="text-center py-8">No records found.</p>';

    myRecords.forEach(r => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <img src="${r.image}" class="list-img">
            <div class="list-content">
                <div class="list-title">${r.type} Check-in</div>
                <div class="list-subtitle">${r.date} • ${r.time}</div>
            </div>
            <div class="status-pill status-${r.status === 'Present' ? 'valid' : 'warning'}">${r.status}</div>
        `;
        listEl.appendChild(item);
    });
}

async function renderAdminStats() {
    const records = await getRecords();
    const today = new Date().toLocaleDateString();
    const todayRecords = records.filter(r => r.date === today);

    const uniquePresent = [...new Set(todayRecords.map(r => r.empId))];
    const lateCount = todayRecords.filter(r => r.status === 'Late' && r.type === 'IN').length;
    const totalEmps = employees.filter(e => e.role === 'employee').length;

    document.getElementById('stats-present').innerText = uniquePresent.length;
    document.getElementById('stats-late').innerText = lateCount;
    document.getElementById('stats-absent').innerText = totalEmps - uniquePresent.length;

    // Live Table
    const tableEl = document.getElementById('admin-live-table');
    tableEl.innerHTML = todayRecords.length ? '' : '<p class="text-center py-4">No activity yet.</p>';

    todayRecords.forEach(r => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <img src="${r.image}" class="list-img">
            <div class="list-content">
                <div class="list-title">${r.empName}</div>
                <div class="list-subtitle">${r.type} @ ${r.time}</div>
            </div>
            <div class="status-pill status-${r.status === 'Present' ? 'valid' : 'warning'}">${r.status}</div>
        `;
        tableEl.appendChild(item);
    });
}

function renderEmployeeManagement() {
    const listEl = document.getElementById('admin-employee-list');
    listEl.innerHTML = '';

    employees.forEach(e => {
        if (e.role === 'admin') return;
        const item = document.createElement('div');
        item.className = 'list-item';
        const profileImg = e.image || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(e.name) + '&background=random';
        item.innerHTML = `
            <img src="${profileImg}" class="list-img">
            <div class="flex-col" style="flex:1">
                <div class="list-title">${e.name}</div>
                <div class="list-subtitle">ID: ${e.id} | Device: ${e.deviceId ? 'Linked' : 'Pending'}</div>
            </div>
            <div class="flex gap-2">
                ${e.deviceId ? `
                <button onclick="resetDevice('${e.id}')" title="Reset Device" style="background:none; border:none; color:var(--warning);">
                    <i class="fas fa-unlink"></i>
                </button>` : ''}
                <button onclick="deleteEmployee('${e.id}')" title="Delete" style="background:none; border:none; color:var(--error);">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        listEl.appendChild(item);
    });
}

async function renderSalaryModule() {
    const listEl = document.getElementById('admin-salary-list');
    const records = await getRecords();
    listEl.innerHTML = '<h3 class="mb-4 mt-4">Staff Payroll & Hours Breakdown</h3>';

    employees.filter(e => e.role === 'employee').forEach(e => {
        const empRecs = records.filter(r => r.empId === e.id);
        const dates = [...new Set(empRecs.map(r => r.date))];

        let totalHours = 0;
        let dayBreakdownHTML = '';

        dates.forEach(d => {
            const dLogs = empRecs.filter(r => r.date === d);
            const cin = dLogs.find(r => r.type === 'IN');
            const cout = dLogs.find(r => r.type === 'OUT');
            let dayHours = 0;

            if (cin && cout) {
                dayHours = (new Date(cout.timestamp) - new Date(cin.timestamp)) / 3600000;
                totalHours += dayHours;
                dayBreakdownHTML += `
                    <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-dim); padding: 4px 0; border-bottom: 1px dotted rgba(255,255,255,0.05);">
                        <span>${d}</span>
                        <span style="font-weight:700; color:var(--secondary);">${dayHours.toFixed(2)} hrs</span>
                    </div>`;
            } else if (cin) {
                dayBreakdownHTML += `
                    <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-dim); padding: 4px 0; border-bottom: 1px dotted rgba(255,255,255,0.05);">
                        <span>${d}</span>
                        <span style="color:var(--warning);">Working...</span>
                    </div>`;
            }
        });

        const daysPresent = dates.length;
        const basePay = daysPresent * config.salaryDay;
        const otPay = Math.max(0, totalHours - (daysPresent * 8)) * config.salaryOT;

        const item = document.createElement('div');
        item.className = 'card';
        item.style.marginBottom = '20px';
        item.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <div class="flex items-center gap-3">
                    <img src="${e.image || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(e.name)}" class="list-img">
                    <div class="flex-col">
                        <div class="list-title" style="font-size:1.1rem;">${e.name}</div>
                        <div class="list-subtitle">${daysPresent} Days | ${totalHours.toFixed(1)} Total Hours</div>
                    </div>
                </div>
                <div class="text-primary" style="font-size:1.2rem; font-weight:800;">₹${Math.round(basePay + otPay)}</div>
            </div>
            <div class="daily-logs" style="background: rgba(0,0,0,0.2); padding:10px; border-radius:12px;">
                <p style="font-size:0.7rem; text-transform:uppercase; margin-bottom:8px; font-weight:700;">Daily Hours Tracking</p>
                ${dayBreakdownHTML || '<p style="font-size:0.75rem;">No completed sessions yet.</p>'}
            </div>
        `;
        listEl.appendChild(item);
    });
}

// --- HELPERS ---
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}





async function saveConfig(showMsg = true) {
    config.lat = parseFloat(document.getElementById('shop-lat').value);
    config.lng = parseFloat(document.getElementById('shop-lng').value);
    config.radius = parseInt(document.getElementById('shop-radius').value);
    config.salaryDay = parseInt(document.getElementById('salary-rate-day').value);
    config.salaryOT = parseInt(document.getElementById('salary-rate-ot').value);

    localStorage.setItem('attendance_pro_config', JSON.stringify(config));
    if (attendanceDb) {
        await attendanceDb.from('v_config').upsert([{ id: 1, ...config }]);
    }
    if (showMsg) alert('Settings Updated Successfully.');
}

function updateToggleUI() {
    const dbToggle = document.getElementById('toggle-device-binding');
    if (config.deviceBinding) {
        dbToggle.className = 'fas fa-toggle-on text-primary';
    } else {
        dbToggle.className = 'fas fa-toggle-off text-dim';
    }
}

function setCurrentGPS() {
    navigator.geolocation.getCurrentPosition(pos => {
        document.getElementById('shop-lat').value = pos.coords.latitude;
        document.getElementById('shop-lng').value = pos.coords.longitude;
    });
}

async function addEmployee() {
    const name = document.getElementById('new-emp-name').value;
    const id = document.getElementById('new-emp-id').value;
    const pass = document.getElementById('new-emp-pass').value;
    const photoInput = document.getElementById('new-emp-photo');

    if (!name || !id || !pass) return alert('Fill all fields.');
    if (employees.find(e => e.id === id)) return alert('ID already exists.');

    let imageData = null;
    if (photoInput.files && photoInput.files[0]) {
        imageData = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(photoInput.files[0]);
        });
    }

    employees.push({ id, name, pass, role: 'employee', deviceId: null, image: imageData });
    saveEmployees();
    renderEmployeeManagement();

    // Reset form
    document.getElementById('new-emp-name').value = '';
    document.getElementById('new-emp-id').value = '';
    document.getElementById('new-emp-pass').value = '';
    document.getElementById('new-emp-photo').value = '';

    alert('Employee Registered.');
}

async function deleteEmployee(id) {
    if (!confirm('Are you sure?')) return;
    employees = employees.filter(e => e.id !== id);
    await saveEmployees();
    if (attendanceDb) {
        await attendanceDb.from('v_employees').delete().eq('id', id);
    }
    renderEmployeeManagement();
}

async function resetDevice(id) {
    if (!confirm('Unlink device for this employee? They will be able to login from a new device.')) return;
    const emp = employees.find(e => e.id === id);
    if (emp) {
        emp.deviceId = null;
        await saveEmployees();
        alert('Device Unlinked Successfully.');
        renderEmployeeManagement();
    }
}

function exportExcel() {
    const records = getRecords();
    if (records.length === 0) return alert('No records found to export.');

    // Prepare data for Excel
    const data = records.map(r => ({
        'Date': r.date,
        'Time': r.time,
        'Employee ID': r.empId,
        'Employee Name': r.empName,
        'Type': r.type,
        'Status': r.status,
        'Latitude': r.coords.lat,
        'Longitude': r.coords.lng,
        'Device ID': r.deviceId || 'N/A'
    }));

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance Logs");

    // Fix column widths
    const wscols = [
        { wch: 12 }, // Date
        { wch: 10 }, // Time
        { wch: 12 }, // ID
        { wch: 20 }, // Name
        { wch: 8 },  // Type
        { wch: 10 }, // Status
        { wch: 15 }, // Lat
        { wch: 15 }, // Lng
        { wch: 15 }  // Device
    ];
    worksheet['!cols'] = wscols;

    // Trigger download
    const fileName = `Attendance_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
}

// Initialize GPS object to prevent null errors
userCoords = { lat: config.lat, lng: config.lng };
