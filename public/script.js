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
    radius: 30,   // Strict 30m requirement
    shopName: 'Juice Shop',
    shopPincode: '',
    salaryDay: 500,
    salaryOT: 100,
    deviceBinding: true
};

let employees = JSON.parse(localStorage.getItem('attendance_pro_employees')) || [
    { id: 'EMP001', name: 'Alex Rivera', role: 'employee', pass: '123', deviceId: null },
    { id: 'admin1', name: 'Admin 1 (Owner)', role: 'admin', pass: 'admin1', deviceId: null },
    { id: 'admin2', name: 'Admin 2 (Manager)', role: 'admin', pass: 'admin2', deviceId: null },
    { id: 'admin3', name: 'Admin 3 (Supervisor)', role: 'admin', pass: 'admin3', deviceId: null }
];

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker Registered'))
            .catch(err => console.log('Service Worker Failed to Register', err));
    }

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

    // Handle Online/Offline Status
    window.addEventListener('online', () => {
        document.body.classList.remove('is-offline');
        syncUnsyncedRecords();
    });
    window.addEventListener('offline', () => {
        document.body.classList.add('is-offline');
    });
    if (!navigator.onLine) document.body.classList.add('is-offline');

    // Then sync from DB in the background
    console.log("Connecting to Supabase...");
    syncFromSupabase().then(() => {
        console.log("Supabase Synced Successfully!");
        syncUnsyncedRecords();
    }).catch(err => {
        console.error("Database Connection Failed. Working Offline.");
    });
}

// --- OFFLINE SYNC LOGIC ---
async function syncUnsyncedRecords() {
    if (!navigator.onLine || !attendanceDb) return;
    const unsynced = JSON.parse(localStorage.getItem('unsynced_records') || '[]');
    if (unsynced.length === 0) return;

    console.log(`Syncing ${unsynced.length} records...`);
    try {
        const { error } = await attendanceDb.from('v_records').insert(unsynced);
        if (!error) {
            localStorage.removeItem('unsynced_records');
            console.log("Sync Complete!");
        }
    } catch (e) { console.error("Sync Failed", e); }
}

async function syncFromSupabase() {
    if (!attendanceDb) return;
    try {
        // Sync Employees
        const { data: emps } = await attendanceDb.from('v_employees').select('*');
        if (emps) {
            employees = emps;
            localStorage.setItem('attendance_pro_employees', JSON.stringify(employees));
        }

        // Sync Config
        const { data: cfg } = await attendanceDb.from('v_config').select('*').eq('id', 1).single();
        if (cfg) {
            config = cfg;
            localStorage.setItem('attendance_pro_config', JSON.stringify(config));
        }
    } catch (e) { console.error("Sync Error", e); }
}

async function getRecords() {
    // Always get local first
    const local = JSON.parse(localStorage.getItem('attendance_pro_records')) || [];

    if (!attendanceDb || !navigator.onLine) return local;

    try {
        const { data } = await attendanceDb.from('v_records').select('*').order('timestamp', { ascending: false });
        if (data) {
            // Merge logic: If DB has newer or different data, we might want to sync, 
            // but for now, we'll return DB data as the source of truth when online
            // and update local storage to keep it in sync
            localStorage.setItem('attendance_pro_records', JSON.stringify(data));
            return data;
        }
    } catch (e) {
        console.warn("DB Fetch failed, using local records", e);
    }
    return local;
}

async function handleLogin() {
    const id = document.getElementById('login-id').value.trim();
    const pass = document.getElementById('login-pass').value;

    let user;
    const isAdminId = id.startsWith('admin');
    if (isAdminId) {
        // Any admin ID bypasses password
        user = employees.find(e => e.id === id && e.role === 'admin');
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

        // Set dynamic shop name in UI
        const shopDisplay = document.getElementById('display-shop-name');
        if (shopDisplay) shopDisplay.innerText = config.shopName || 'Shop';
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
    document.getElementById('btn-admin-direct').addEventListener('click', () => {
        document.getElementById('login-form-content').classList.add('hidden');
        document.getElementById('admin-choices').classList.remove('hidden');
    });
    document.getElementById('btn-back-to-login').addEventListener('click', () => {
        document.getElementById('login-form-content').classList.remove('hidden');
        document.getElementById('admin-choices').classList.add('hidden');
    });

    document.querySelectorAll('.admin-choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const adminId = btn.getAttribute('data-admin');
            loginAsAdmin(adminId);
        });
    });

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
    document.getElementById('btn-fetch-coords').addEventListener('click', fetchCoordinatesFromAddress);

    // Logout
    document.getElementById('nav-logout').addEventListener('click', logout);

    // Settings Toggles
    document.getElementById('toggle-device-binding').addEventListener('click', () => {
        config.deviceBinding = !config.deviceBinding;
        saveConfig(false);
        updateToggleUI();
    });

    // Dynamic Shop Search Link
    const shopNameInput = document.getElementById('shop-name');
    const shopPincodeInput = document.getElementById('shop-pincode');
    if (shopNameInput) shopNameInput.addEventListener('input', updateGmapsSearchLink);
    if (shopPincodeInput) shopPincodeInput.addEventListener('input', updateGmapsSearchLink);
}

function updateGmapsSearchLink() {
    const name = document.getElementById('shop-name').value;
    const pin = document.getElementById('shop-pincode').value;
    const link = document.getElementById('link-find-coords');
    if (link) {
        link.href = `https://www.google.com/maps/search/${encodeURIComponent(name + ' ' + pin)}`;
    }
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
            document.getElementById('shop-name').value = config.shopName || 'Juice Shop';
            document.getElementById('shop-pincode').value = config.shopPincode || '';
            document.getElementById('shop-lat').value = config.lat;
            document.getElementById('shop-lng').value = config.lng;
            document.getElementById('shop-radius').value = config.radius;
            document.getElementById('salary-rate-day').value = config.salaryDay;
            document.getElementById('salary-rate-ot').value = config.salaryOT;
            updateToggleUI();
            updateGmapsSearchLink();
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

function loginAsAdmin(adminId = 'admin1') {
    const admin = employees.find(e => e.id === adminId) || employees.find(e => e.role === 'admin');
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

    // Use High Accuracy for strict 30m requirement
    navigator.geolocation.getCurrentPosition(pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        userCoords = { lat: latitude, lng: longitude };
        gpsAccuracy = Math.round(accuracy);

        // Update UI
        const accText = document.getElementById('gps-accuracy-text');
        accText.innerText = `GPS: ${gpsAccuracy}m`;

        // Stricter UI feedback for 30m
        const accPill = document.getElementById('gps-accuracy-pill');
        if (accuracy < 15) {
            accPill.className = 'status-pill status-valid';
        } else if (accuracy < 30) {
            accPill.className = 'status-pill status-warning';
        } else {
            accPill.className = 'status-pill status-invalid';
        }

        const dist = calculateDistance(latitude, longitude, config.lat, config.lng);
        const distEl = document.getElementById('distance-value');
        const statusEl = document.getElementById('geofence-status');

        if (distEl) distEl.innerText = `${Math.round(dist)}m`;

        // Google Maps Link for Current Location
        const gmapBtn = document.getElementById('btn-open-gmaps');
        const gmapContainer = document.getElementById('gmap-link-container');
        if (gmapBtn && gmapContainer) {
            gmapContainer.classList.remove('hidden');
            gmapBtn.href = `https://www.google.com/maps?q=${config.lat},${config.lng}`;
        }

        if (statusEl) {
            if (dist <= 30) {
                statusEl.innerText = 'Inside Shop (Secure)';
                statusEl.className = 'text-success';

                // AUTO CHECK IN LOGIC (Arrival)
                handleAutoCheckin(dist);
            } else if (dist > 40) { // 10m Buffer zone to prevent jitter
                statusEl.innerText = 'Outside (Blocked)';
                statusEl.className = 'text-error';

                // AUTO CHECK OUT LOGIC (Location)
                handleAutoCheckout(dist);
            } else {
                // Buffer zone (30m - 40m)
                statusEl.innerText = 'Warning: Boundary';
                statusEl.className = 'text-warning';
            }
        }

        // AUTO CHECK OUT LOGIC (Time: 8:00 PM)
        const now = new Date();
        if (now.getHours() >= 20) { // 8 PM
            handleShiftEndAutoCheckout();
        }

    }, err => {
        console.warn('GPS Error', err);
    }, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });
}

async function handleAutoCheckin(distance) {
    if (!currentUser || currentUser.role === 'admin') return;

    // Shift Hours: 8:00 AM to 8:00 PM
    const now = new Date();
    const hour = now.getHours();
    if (hour < 8 || hour >= 20) return;

    const records = await getRecords();
    const today = new Date().toLocaleDateString();
    const todayLogs = records.filter(r => r.empId === currentUser.id && r.date === today);
    const lastRecord = todayLogs[0];

    // Only auto-checkin if they are currently OFF DUTY (either never checked in today, or last record was OUT)
    if (!lastRecord || lastRecord.type === 'OUT') {
        console.log(`Auto-Checkin Triggered: Arrived at Shop (${Math.round(distance)}m)`);
        await autoSubmitAttendance('IN', 'Auto-Checkin (Arrived)');
        alert(`Auto-Checkin Success: You have been clocked in automatically upon arrival at the shop.`);
    }
}

async function handleShiftEndAutoCheckout() {
    if (!currentUser || currentUser.role === 'admin') return;
    const records = await getRecords();
    const today = new Date().toLocaleDateString();
    const todayLogs = records.filter(r => r.empId === currentUser.id && r.date === today);
    const lastRecord = todayLogs[0];

    if (lastRecord && lastRecord.type === 'IN') {
        console.log("Shift End Auto-Checkout: 8:00 PM reached.");
        await autoSubmitAttendance('OUT', 'Auto-Checkout (Shift Ended)');
        alert("Shift Ended: You have been automatically clocked out (8:00 PM).");
    }
}

async function handleAutoCheckout(distance) {
    if (!currentUser || currentUser.role === 'admin') return;

    const records = await getRecords();
    const today = new Date().toLocaleDateString();
    const todayLogs = records.filter(r => r.empId === currentUser.id && r.date === today);
    const lastRecord = todayLogs[0]; // records is sorted desc

    // Only auto-checkout if they are currently clocked IN and beyond the 40m buffer
    if (lastRecord && lastRecord.type === 'IN' && distance > 40) {
        console.log(`Auto-Checkout Triggered: Distance ${Math.round(distance)}m`);
        await autoSubmitAttendance('OUT', 'Auto-Checkout (Left Area)');
        alert(`Auto-Checkout: You have been clocked out because you left the shop premises (${Math.round(distance)}m away).`);
    }
}

async function autoSubmitAttendance(type, status) {
    const now = new Date();
    const record = {
        empId: currentUser.id,
        empName: currentUser.name,
        shopName: config.shopName,
        timestamp: now.toISOString(),
        time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: now.toLocaleDateString(),
        coords: userCoords,
        image: 'https://cdn-icons-png.flaticon.com/512/9131/9131546.png', // Placeholder for auto-log
        type: type,
        status: status,
        deviceId: currentDeviceId
    };

    // Always save locally first for offline support
    const localRecords = JSON.parse(localStorage.getItem('attendance_pro_records')) || [];
    localRecords.unshift(record);
    localStorage.setItem('attendance_pro_records', JSON.stringify(localRecords));

    if (attendanceDb && navigator.onLine) {
        await attendanceDb.from('v_records').insert([record]);
    } else {
        // Queue for sync
        const unsynced = JSON.parse(localStorage.getItem('unsynced_records') || '[]');
        unsynced.push(record);
        localStorage.setItem('unsynced_records', JSON.stringify(unsynced));
    }

    updateShiftStatus();
    if (document.getElementById('section-emp-history').classList.contains('active')) {
        renderEmployeeHistory();
    }
}

// --- ATTENDANCE FLOW ---
async function startVerificationFlow() {
    if (!userCoords) {
        return alert('Detecting your location... Please wait a moment.');
    }

    const dist = calculateDistance(userCoords.lat, userCoords.lng, config.lat, config.lng);

    // Enforce strict 30m limit
    if (dist > 30) {
        return alert(`ERROR: Out of Range. You are ${Math.round(dist)}m away. You must be within 30m of the shop.`);
    }

    // Strict accuracy check for 30m geofencing
    if (gpsAccuracy > 100) {
        return alert('GPS signal too inaccurate (' + gpsAccuracy + 'm). Please move around or ensure you are outdoors/near a window to get a better lock.');
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

    const todayLogs = records.filter(r => r.empId === currentUser.id && r.date === today);
    const lastRecord = todayLogs[0]; // records is sorted desc

    const type = (lastRecord && lastRecord.type === 'IN') ? 'OUT' : 'IN';

    // Status Logic: Shift starts at 8:00 AM
    let status = 'Present';
    if (type === 'IN') {
        const hour = now.getHours();
        const mins = now.getMinutes();
        if (hour > 8 || (hour === 8 && mins > 0)) status = 'Late';
    } else if (lastRecord && lastRecord.status && lastRecord.status.includes('Auto')) {
        status = 'Re-check-out';
    }

    const record = {
        empId: currentUser.id,
        empName: currentUser.name,
        shopName: config.shopName,
        timestamp: now.toISOString(),
        time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: today,
        coords: userCoords,
        image: capturedBase64,
        type: type,
        status: status,
        deviceId: currentDeviceId
    };

    // Always save locally first
    const localRecords = JSON.parse(localStorage.getItem('attendance_pro_records')) || [];
    localRecords.unshift(record);
    localStorage.setItem('attendance_pro_records', JSON.stringify(localRecords));

    if (attendanceDb && navigator.onLine) {
        await attendanceDb.from('v_records').insert([record]);
    } else {
        // Queue for sync
        const unsynced = JSON.parse(localStorage.getItem('unsynced_records') || '[]');
        unsynced.push(record);
        localStorage.setItem('unsynced_records', JSON.stringify(unsynced));
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
    const lastRecord = todayLogs[0]; // sorted desc

    const badge = document.getElementById('attendance-status-badge');
    const btnText = document.getElementById('attendance-btn-text');
    const toggleBtn = document.getElementById('btn-toggle-attendance');
    const timerLabel = document.getElementById('timer-label');

    if (lastRecord && lastRecord.type === 'IN') {
        badge.className = 'status-pill status-valid';
        badge.querySelector('span').innerText = 'At Work';
        btnText.innerText = 'Check Out';
        toggleBtn.disabled = false;
        timerLabel.classList.remove('hidden');
        startShiftTimer(new Date(lastRecord.timestamp));
    } else if (lastRecord && lastRecord.type === 'OUT') {
        badge.className = 'status-pill status-invalid';
        badge.querySelector('span').innerText = 'Off Duty (Out)';
        btnText.innerText = 'Check In Again';
        toggleBtn.disabled = false;
        timerLabel.classList.add('hidden');
        stopShiftTimer();
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
        const gmapUrl = r.coords ? `https://www.google.com/maps?q=${r.coords.lat},${r.coords.lng}` : '#';
        item.innerHTML = `
            <img src="${r.image}" class="list-img">
            <div class="list-content">
                <div class="list-title">${r.empName}</div>
                <div class="list-subtitle">${r.type} @ ${r.time}</div>
                ${r.coords ? `<a href="${gmapUrl}" target="_blank" style="font-size:0.7rem; color:var(--primary); text-decoration:none;"><i class="fas fa-location-dot"></i> View Location</a>` : ''}
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
        item.className = 'list-item-container card';
        item.style.marginBottom = '15px';
        item.style.padding = '15px';

        const profileImg = e.image || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(e.name) + '&background=random';

        item.innerHTML = `
            <div class="list-item" style="border:none; padding:0; background:none;">
                <img src="${profileImg}" class="list-img">
                <div class="flex-col" style="flex:1">
                    <div class="list-title">${e.name}</div>
                    <div class="list-subtitle">ID: ${e.id} | Device: ${e.deviceId ? 'Linked' : 'Pending'}</div>
                </div>
                <div class="flex gap-2">
                    <button onclick="toggleWorkerDetails('${e.id}')" class="btn-icon" title="View Details">
                        <i class="fas fa-eye text-primary"></i>
                    </button>
                    ${e.deviceId ? `
                    <button onclick="resetDevice('${e.id}')" title="Reset Device" class="btn-icon" style="color:var(--warning);">
                        <i class="fas fa-unlink"></i>
                    </button>` : ''}
                    <button onclick="deleteEmployee('${e.id}')" title="Delete" class="btn-icon" style="color:var(--error);">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div id="details-${e.id}" class="hidden mt-4 pt-4" style="border-top:1px solid rgba(255,255,255,0.1); font-size:0.85rem;">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <p style="color:var(--text-dim); font-size:0.7rem; text-transform:uppercase;">Phone Number</p>
                        <p>${e.phone || 'Not provided'}</p>
                    </div>
                    <div>
                        <p style="color:var(--text-dim); font-size:0.7rem; text-transform:uppercase;">Identity Proof</p>
                        <p>${e.idProof || 'Not provided'}</p>
                    </div>
                </div>
                <div class="mt-3">
                    <p style="color:var(--text-dim); font-size:0.7rem; text-transform:uppercase;">Home Address</p>
                    <p>${e.address || 'Not provided'}</p>
                </div>
                <div class="mt-3">
                    <p style="color:var(--text-dim); font-size:0.7rem; text-transform:uppercase;">Password (Security)</p>
                    <p style="font-family:monospace; background:rgba(0,0,0,0.2); padding:4px 8px; border-radius:4px; display:inline-block;">${e.pass}</p>
                </div>
            </div>
        `;
        listEl.appendChild(item);
    });
}

function toggleWorkerDetails(id) {
    const el = document.getElementById(`details-${id}`);
    el.classList.toggle('hidden');
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
        const otPay = Math.max(0, totalHours - (daysPresent * 12)) * config.salaryOT;

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
            <div class="flex justify-between items-center mb-4">
                <div class="flex items-center gap-3">
                    <span id="distance-value" style="font-size: 1.2rem; font-weight: 800;">-- m</span>
                </div>
                <div id="gmap-link-container" class="mt-4 hidden">
                    <a id="btn-open-gmaps" href="#" target="_blank" class="btn btn-secondary w-full" style="padding: 10px; font-size: 0.8rem; background: rgba(255,255,255,0.05);">
                        <i class="fas fa-map-location-dot"></i>
                        <span>See Shop on Google Maps</span>
                    </a>
                </div>
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
    config.shopName = document.getElementById('shop-name').value || 'Juice Shop';
    config.shopPincode = document.getElementById('shop-pincode').value || '';
    config.lat = parseFloat(document.getElementById('shop-lat').value);
    config.lng = parseFloat(document.getElementById('shop-lng').value);
    config.radius = parseInt(document.getElementById('shop-radius').value);
    config.salaryDay = parseInt(document.getElementById('salary-rate-day').value);
    config.salaryOT = parseInt(document.getElementById('salary-rate-ot').value);

    // Update UI elements immediately
    const shopDisplay = document.getElementById('display-shop-name');
    if (shopDisplay) shopDisplay.innerText = config.shopName;

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

async function fetchCoordinatesFromAddress() {
    const name = document.getElementById('shop-name').value;
    const pincode = document.getElementById('shop-pincode').value;
    const statusEl = document.getElementById('geocoding-status');

    if (!name || !pincode) return alert('Please enter both Location Name and Pincode.');

    statusEl.innerText = 'Searching coordinates...';
    statusEl.classList.remove('hidden');

    try {
        const query = encodeURIComponent(`${name} ${pincode} India`);
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`);
        const data = await response.json();

        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);

            document.getElementById('shop-lat').value = lat.toFixed(6);
            document.getElementById('shop-lng').value = lon.toFixed(6);

            statusEl.innerText = `Success: Found ${data[0].display_name}`;
            statusEl.style.color = 'var(--success)';

            // Auto update search link
            updateGmapsSearchLink();

            setTimeout(() => statusEl.classList.add('hidden'), 5000);
        } else {
            statusEl.innerText = 'Location not found. Try a more specific name or manual capture.';
            statusEl.style.color = 'var(--error)';
        }
    } catch (error) {
        console.error('Geocoding Error:', error);
        statusEl.innerText = 'Search failed. Please check your internet or use manual capture.';
        statusEl.style.color = 'var(--error)';
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
    const phone = document.getElementById('new-emp-phone').value;
    const idProof = document.getElementById('new-emp-id-proof').value;
    const address = document.getElementById('new-emp-address').value;
    const photoInput = document.getElementById('new-emp-photo');

    if (!name || !id || !pass) return alert('Fill all mandatory fields (Name, ID, Pass).');
    if (employees.find(e => e.id === id)) return alert('ID already exists.');

    let imageData = null;
    if (photoInput.files && photoInput.files[0]) {
        imageData = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(photoInput.files[0]);
        });
    }

    employees.push({
        id,
        name,
        pass,
        phone,
        idProof,
        address,
        role: 'employee',
        deviceId: null,
        image: imageData
    });

    saveEmployees();
    renderEmployeeManagement();

    // Reset form
    document.getElementById('new-emp-name').value = '';
    document.getElementById('new-emp-id').value = '';
    document.getElementById('new-emp-pass').value = '';
    document.getElementById('new-emp-phone').value = '';
    document.getElementById('new-emp-id-proof').value = '';
    document.getElementById('new-emp-address').value = '';
    document.getElementById('new-emp-photo').value = '';

    alert('Employee Registered with Details.');
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
