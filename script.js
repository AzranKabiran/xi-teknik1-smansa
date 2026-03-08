/* ═══════════════════════════════════════════════════════════
   script.js — XI TEKNIK 1 SMANSA GEBANG  v4.1 (SECURE)
   ✅ Data bersumber dari data.json (tidak ada data inline)
   ✅ localStorage sebagai cache offline backup
   ✅ Cuaca real via Open-Meteo (Gebang, Kab. Langkat, Sumut)
   ✅ Cover art Spotify: thumb hardcode di data.json
   ✅ Foto Galeri/Anggota/Struktur → Cloudinary + Firebase Firestore
   ✅ [v4.1] Firebase config dari firebase-config.js (terpisah)
   ✅ [v4.1] Admin auth: rate-limit + lockout brute-force protection
   ✅ [v4.1] Upload validation: tipe & ukuran file dicek sebelum Cloudinary
   ✅ [v4.1] Firestore write hanya diizinkan saat sesi admin aktif
════════════════════════════════════════════════════════════ */

/* ─── FIREBASE INIT ─────────────────────────────────────── */
/*
  ⚠️  PENTING — KONFIGURASI FIREBASE:
  Firebase API key TIDAK boleh ada di file ini karena file ini
  bisa dibaca siapa saja. Ikuti langkah berikut:

  1. Buat file baru: `firebase-config.js` di folder yang SAMA
     dengan script.js (dan index.html), isi dengan:

       export const firebaseConfig = {
         apiKey:            "ISI_API_KEY_KAMU",
         authDomain:        "t1-class-project.firebaseapp.com",
         projectId:         "t1-class-project",
         storageBucket:     "t1-class-project.firebasestorage.app",
         messagingSenderId: "683973742092",
         appId:             "1:683973742092:web:20ff9f24c52c80526fa829",
         measurementId:     "G-8X7JDVLZ44"
       };

  2. Tambahkan `firebase-config.js` ke .gitignore:
       echo "firebase-config.js" >> .gitignore

  3. Aktifkan Firebase App Check di Firebase Console untuk
     membatasi akses hanya dari domain resmimu:
     https://console.firebase.google.com → App Check → Enforce

  4. Terapkan Firestore Security Rules berikut di Firebase Console
     (Firestore → Rules):

     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {

         // Hanya boleh BACA — siapa saja (pengunjung biasa)
         match /galeri/{doc} {
           allow read: if true;
           allow write: if false; // ← tulis hanya via admin token
         }
         match /foto_profil/{doc} {
           allow read: if true;
           allow write: if false;
         }
         match /app_config/{doc} {
           allow read: if true;
           allow write: if false;
         }

         // Semua koleksi lain: tolak semua
         match /{document=**} {
           allow read, write: if false;
         }
       }
     }

     Catatan: dengan rules di atas, write dari browser akan
     ditolak Firestore. Untuk enable write yang aman, gunakan
     Firebase Authentication (login dengan email/password admin)
     lalu ubah rules menjadi:
       allow write: if request.auth != null && request.auth.token.admin == true;

  ─────────────────────────────────────────────────────────── */
import { firebaseConfig } from './firebase-config.js';

import { initializeApp }                        from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getFirestore, collection, addDoc,
         getDocs, deleteDoc, doc,
         setDoc, getDoc, query,
         orderBy }                              from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getAnalytics }                         from "https://www.gstatic.com/firebasejs/12.10.0/firebase-analytics.js";

const _fbApp     = initializeApp(firebaseConfig);
const _analytics = getAnalytics(_fbApp);
const DB         = getFirestore(_fbApp);

/* Helper Firestore */
const fsCol  = (path)       => collection(DB, path);
const fsAdd  = (path, data) => addDoc(fsCol(path), data);
const fsDel  = (path, id)   => deleteDoc(doc(DB, path, id));
const fsSet  = (path, id, d)=> setDoc(doc(DB, path, id), d, { merge: true });
const fsGet  = (path, id)   => getDoc(doc(DB, path, id));
const fsAll  = async (path, ord='ts') => {
  const snap = await getDocs(query(fsCol(path), orderBy(ord, 'desc')));
  return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
};

/* ─── BERSIHKAN CACHE LAMA ─────────────────────────────── */
['xi_teknik1_weather', 'xi_teknik1_data_v2'].forEach(k => {
  try { localStorage.removeItem(k); } catch(_) {}
});

/* ─── LOAD DATA.JSON → localStorage BACKUP ─────────────── */
const LS_DATA_KEY    = 'xi_teknik1_v3_data';
const LS_VERSION_KEY = 'xi_teknik1_v3_ver';

async function loadData() {
  try {
    const res  = await fetch('data.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();

    // Bust cache kalau versi data.json berubah
    const newVer = json?._meta?.versi || '';
    const oldVer = localStorage.getItem(LS_VERSION_KEY) || '';
    if (newVer && newVer !== oldVer) {
      console.info('[DATA] Versi baru terdeteksi (' + oldVer + ' → ' + newVer + '), cache di-reset.');
      localStorage.removeItem(LS_DATA_KEY);
      localStorage.setItem(LS_VERSION_KEY, newVer);
    }

    // Simpan ke localStorage sebagai backup offline
    try { localStorage.setItem(LS_DATA_KEY, JSON.stringify(json)); } catch(_) {}
    return json;
  } catch (err) {
    console.warn('[DATA] Fetch data.json gagal, coba cache localStorage...', err);
    try {
      const cached = localStorage.getItem(LS_DATA_KEY);
      if (cached) return JSON.parse(cached);
    } catch(_) {}
    console.error('[DATA] Tidak ada cache. Pastikan data.json ada di folder yang sama.');
    return { anggota:[], jadwal:{}, leaderboard:[], tracklist:[] };
  }
}

/* ═══════════════════════════════════════════════════════════
   MAIN — fetch data dulu, baru init semua
════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async function () {
  const loader    = document.getElementById('pageLoader');
  const loaderRing= document.getElementById('loaderRing');
  const loaderPct = document.getElementById('loaderPct');
  const loaderSt  = document.getElementById('loaderStatus');
  const CIRCUM    = 339.3; // 2 * PI * 54

  // Inject SVG gradient untuk ring
  const svgNS = 'http://www.w3.org/2000/svg';
  const svgEl = document.querySelector('.loader-ring');
  if (svgEl) {
    const defs = document.createElementNS(svgNS, 'defs');
    defs.innerHTML = `<linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff2d78"/>
      <stop offset="100%" stop-color="#ff9ec4"/>
    </linearGradient>`;
    svgEl.insertBefore(defs, svgEl.firstChild);
  }

  // Canvas partikel di loader
  (function initLoaderParticles() {
    const c = document.getElementById('loaderCanvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    c.width = window.innerWidth; c.height = window.innerHeight;
    const pts = Array.from({length: 60}, () => ({
      x: Math.random() * c.width, y: Math.random() * c.height,
      vx: (Math.random() - .5) * .4, vy: (Math.random() - .5) * .4,
      r: Math.random() * 2 + .5, a: Math.random(),
      color: ['#ff2d78','#ff6aa7','#ffffff'][Math.floor(Math.random()*3)]
    }));
    let alive = true;
    loader.addEventListener('transitionend', () => { alive = false; });
    (function loop() {
      if (!alive) return;
      ctx.clearRect(0, 0, c.width, c.height);
      pts.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = c.width; if (p.x > c.width) p.x = 0;
        if (p.y < 0) p.y = c.height; if (p.y > c.height) p.y = 0;
        ctx.save();
        ctx.globalAlpha = p.a * .6;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      });
      requestAnimationFrame(loop);
    })();
  })();

  let _currentPct = 0;
  function setProgress(pct, msg) {
    _currentPct = pct;
    if (loaderRing) loaderRing.style.strokeDashoffset = CIRCUM - (CIRCUM * pct / 100);
    if (loaderPct)  loaderPct.textContent  = pct + '%';
    if (loaderSt)   loaderSt.textContent   = msg;
  }

  // Lock scroll saat loading
  document.body.classList.add('is-loading');

  function hideLoader() {
    if (loader) {
      loader.style.transition = 'opacity .7s cubic-bezier(.4,0,.2,1), visibility .7s ease';
      loader.classList.add('hidden');
      document.body.classList.remove('is-loading');
    }
  }

  setProgress(10, 'INISIALISASI...');

  // Init fitur yang tidak butuh data → langsung jalan
  initParticles();
  initCursor();
  initScrollReveal();
  initClock();
  initCountdown();
  initWeather();
  initGallery();
  initLightbox();

  setProgress(25, 'MEMUAT DATA KELAS...');

  // Fetch data.json → render semua seksi berbasis data
  const DATA = await loadData();

  setProgress(45, 'RENDER JADWAL & ANGGOTA...');
  renderTracklist(DATA.tracklist  || []);
  renderRoster(DATA.jadwal        || {});
  renderMembers(DATA.anggota      || []);
  renderLeaderboard('all', DATA.leaderboard || []);
  renderStruktur(DATA.struktur    || {});

  setProgress(65, 'MEMUAT FOTO DARI CLOUD...');

  await Promise.all([
    loadGaleriFromFirestore(),
    loadFotoProfilFromFirestore(),
    loadKategori(),
  ]);

  setProgress(90, 'FINISHING...');

  // Banner ultah & QOTD — async, tidak block render utama
  showBirthdayBanner(DATA.anggota || []);
  showQOTD(DATA.quotes || []);

  setProgress(100, 'SIAP!');

  // Sembunyikan loader setelah semua beres
  setTimeout(hideLoader, 400);

  // Leaderboard filter buttons
  document.querySelectorAll('.lb-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lb-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderLeaderboard(btn.dataset.subject, DATA.leaderboard || []);
    });
  });
});

/* ─── LOAD GALERI DARI FIRESTORE → inject ke #photoGrid ── */
async function loadGaleriFromFirestore() {
  try {
    const photos = await fsAll('galeri');
    const grid   = document.getElementById('photoGrid');
    if (!grid || !photos.length) return;

    // Hapus placeholder lama yang dari Firestore (kalau ada re-render)
    grid.querySelectorAll('.photo-item[data-fsid]').forEach(el => el.remove());

    photos.forEach(r => {
      const div = document.createElement('div');
      div.className  = 'photo-item';
      div.dataset.cat   = r.kategori || 'kegiatan';
      div.dataset.title = r.judul    || 'Foto Kelas';
      div.dataset.tag   = (r.kategori || 'kegiatan').toUpperCase();
      div.dataset.fsid  = r._id;
      div.style.background = '#0d0d10';
      div.innerHTML = `
        <div class="photo-inner" style="width:100%;height:100%;overflow:hidden;">
          <img src="${clOptimize(r.url, 'gallery')}" alt="${r.judul}"
               style="width:100%;height:100%;object-fit:cover;" loading="lazy"/>
        </div>
        <div class="photo-label">
          <div class="photo-label-text">${r.judul}</div>
          <div class="photo-label-tag">${(r.kategori||'kegiatan').toUpperCase()}</div>
        </div>`;
      grid.prepend(div);
    });

    // Re-init lightbox & gallery filter supaya foto baru ikut teregister
    initGallery();
    initLightbox();
  } catch(err) {
    console.warn('[GALERI] Gagal load dari Firestore:', err);
  }
}

/* ─── LOAD FOTO PROFIL DARI FIRESTORE ───────────────────── */
async function loadFotoProfilFromFirestore() {
  try {
    const snap = await fsGet('foto_profil', 'map');
    if (!snap.exists()) return;
    const map = snap.data();

    // Terapkan ke member cards (anggota) — pakai data-num bukan index DOM
    document.querySelectorAll('.member-card[data-num]').forEach((card) => {
      const num    = card.dataset.num;
      const fid    = 'anggota_' + num;
      const url    = map[fid];
      if (!url) return;
      const emojiEl = document.getElementById('mcemoji-' + num);
      if (emojiEl) {
        emojiEl.innerHTML  = `<img src="${clOptimize(url)}" alt="" class="mc-front-bg"/>`;
        emojiEl.className  = '';
        emojiEl.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
      }
      const backBg = document.getElementById('mcbackbg-' + num);
      if (backBg) {
        backBg.innerHTML = `<img src="${clOptimize(url)}" alt="" class="mc-back-bg"/>`;
        backBg.className = '';
        backBg.style.cssText = 'position:absolute;inset:0;';
      }
    });

    // Terapkan ke org-chart (struktur)
    Object.entries(map).forEach(([fid, url]) => {
      if (!fid.startsWith('struktur_')) return;
      const nodeId = fid.replace('struktur_', '');
      const orgNode = document.getElementById('orgNode-' + nodeId);
      if (!orgNode) return;
      const avaEl = orgNode.querySelector('.org-avatar');
      if (avaEl) avaEl.innerHTML =
        `<img src="${clOptimize(url)}" alt="" style="width:100%;height:100%;object-fit:cover;"/>`;
    });

    // Global nama→foto untuk leaderboard
    _namaToFoto = {};
    document.querySelectorAll('.member-card[data-num]').forEach((card) => {
      const num = card.dataset.num;
      const url = map['anggota_' + num];
      if (!url) return;
      const namaEl = card.querySelector('.member-name');
      if (namaEl) _namaToFoto[namaEl.textContent.trim().toLowerCase()] = url;
    });

  } catch(err) {
    console.warn('[PROFIL] Gagal load dari Firestore:', err);
  }
}

/* ─── 1. PARTICLE GLITTER ──────────────────────────────── */
function initParticles() {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [], W, H;
  const rand = (a,b) => Math.random()*(b-a)+a;
  const COLORS = ['#ff2d78','#ff6aa7','#ff9ec4','#ffffff','#ffb3cc'];

  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  function spawn(x, y) {
    return { x: x??rand(0,W), y: y??rand(0,H), vx:rand(-0.4,0.4), vy:rand(-0.8,-0.2),
      size:rand(1.5,4), alpha:rand(0.4,1), decay:rand(0.003,0.008),
      color:COLORS[Math.floor(Math.random()*COLORS.length)],
      twinkle:rand(0,Math.PI*2), twinkleSpeed:rand(0.02,0.06) };
  }

  const isMobile = window.innerWidth < 768;
  for (let i = 0; i < (isMobile ? 40 : 120); i++) particles.push(spawn());
  let mx = -999, my = -999, t = 0;
  let _particlePaused = false;
  document.addEventListener('mousemove', e => { mx=e.clientX; my=e.clientY; });
  document.addEventListener('visibilitychange', () => { _particlePaused = document.hidden; });

  (function loop() {
    if (!_particlePaused) {
      ctx.clearRect(0,0,W,H);
      if (++t%3===0) for(let i=0;i<2;i++) particles.push(spawn(mx+rand(-10,10), my+rand(-10,10)));
      particles = particles.filter(p => p.alpha > 0.02);
      while (particles.length < 120) particles.push(spawn());
      particles.forEach(p => {
        p.x+=p.vx; p.y+=p.vy; p.alpha-=p.decay; p.twinkle+=p.twinkleSpeed;
        const a = p.alpha*(0.6+0.4*Math.sin(p.twinkle));
        ctx.save(); ctx.globalAlpha=Math.max(0,a); ctx.fillStyle=p.color;
        ctx.shadowColor=p.color; ctx.shadowBlur=6;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill(); ctx.restore();
      });
    }
    requestAnimationFrame(loop);
  })();
}


/* ─── 2. CUSTOM CURSOR ─────────────────────────────────── */
function initCursor() {
  let mx=0, my=0, rx=0, ry=0;
  document.addEventListener('mousemove', e => { mx=e.clientX; my=e.clientY; });
  (function loop() {
    const dot=document.getElementById('curDot'), ring=document.getElementById('curRing');
    if(dot)  { dot.style.left=mx+'px'; dot.style.top=my+'px'; }
    rx+=(mx-rx)*0.12; ry+=(my-ry)*0.12;
    if(ring) { ring.style.left=rx+'px'; ring.style.top=ry+'px'; }
    requestAnimationFrame(loop);
  })();
  document.querySelectorAll('a,button,.track-item,.photo-item,.org-node,.member-card,.lb-row')
    .forEach(el => {
      el.addEventListener('mouseenter',()=>document.body.classList.add('hovered'));
      el.addEventListener('mouseleave',()=>document.body.classList.remove('hovered'));
    });
}

/* ─── 2b. HAMBURGER MOBILE MENU ────────────────────────── */
function initHamburgerMenu() {
  const btn     = document.getElementById('navHamburger');
  const menu    = document.getElementById('mobileMenu');
  const overlay = document.getElementById('mobileMenuOverlay');
  if (!btn || !menu || !overlay) return;

  function openMenu() {
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    menu.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');
    overlay.style.display = 'block';
    requestAnimationFrame(() => overlay.classList.add('open'));
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    // Hide overlay after transition
    overlay.addEventListener('transitionend', () => {
      if (!overlay.classList.contains('open')) overlay.style.display = 'none';
    }, { once: true });
  }

  btn.addEventListener('click', () => {
    btn.classList.contains('open') ? closeMenu() : openMenu();
  });

  overlay.addEventListener('click', closeMenu);

  // Close on link click & smooth scroll
  menu.querySelectorAll('.mobile-nav-item').forEach(link => {
    link.addEventListener('click', () => {
      closeMenu();
    });
  });

  // Close on Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu.classList.contains('open')) closeMenu();
  });
}

// Call hamburger init alongside cursor init
document.addEventListener('DOMContentLoaded', initHamburgerMenu);


/* ─── 3. SCROLL REVEAL ─────────────────────────────────── */
function initScrollReveal() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach((e,i) => {
      if(e.isIntersecting){ setTimeout(()=>e.target.classList.add('up'),i*70); obs.unobserve(e.target); }
    });
  }, { threshold:0.07 });
  document.querySelectorAll('.reveal').forEach(el=>obs.observe(el));

  const sObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if(!e.isIntersecting) return;
      const f=e.target; if(f.dataset.src){f.src=f.dataset.src;delete f.dataset.src;}
      sObs.unobserve(f);
    });
  },{ rootMargin:'200px' });
  document.querySelectorAll('iframe[data-src]').forEach(el=>sObs.observe(el));
}


/* ─── 4. LIVE CLOCK ────────────────────────────────────── */
function initClock() {
  const DN = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const MN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  function tick() {
    const n=new Date(), hh=String(n.getHours()).padStart(2,'0'),
          mm=String(n.getMinutes()).padStart(2,'0'), ss=String(n.getSeconds()).padStart(2,'0');
    const e1=document.getElementById('clockDisplay'), e2=document.getElementById('clockDate');
    if(e1) e1.textContent=`${hh}:${mm}:${ss}`;
    if(e2) e2.textContent=`${DN[n.getDay()]}, ${n.getDate()} ${MN[n.getMonth()]} ${n.getFullYear()}`;
  }
  tick(); setInterval(tick,1000);
}


/* ─── 5. COUNTDOWN KELULUSAN ───────────────────────────── */
function initCountdown() {
  const GRAD = new Date('2027-05-01T08:00:00');
  const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=String(v).padStart(2,'0'); };
  function tick() {
    const diff = GRAD - new Date();
    if(diff<=0){ ['cdDays','cdHours','cdMins','cdSecs'].forEach(id=>set(id,'00'));
      const ev=document.querySelector('.cd-event'); if(ev) ev.textContent='🎓 SELAMAT! KALIAN SUDAH LULUS!'; return; }
    set('cdDays',  Math.floor(diff/86400000));
    set('cdHours', Math.floor((diff%86400000)/3600000));
    set('cdMins',  Math.floor((diff%3600000)/60000));
    set('cdSecs',  Math.floor((diff%60000)/1000));
  }
  tick(); setInterval(tick,1000);
}


/* ─── 6. CUACA REAL — Gebang, Kab. Langkat, Sumatera Utara */
async function initWeather() {
  const LAT=3.9500, LON=98.3000, LOC='Gebang, Langkat';
  const WMO = {
    0:{icon:'☀️',desc:'Cerah Terik'},1:{icon:'🌤️',desc:'Sebagian Cerah'},
    2:{icon:'⛅',desc:'Berawan Sebagian'},3:{icon:'☁️',desc:'Mendung'},
    45:{icon:'🌫️',desc:'Berkabut'},51:{icon:'🌦️',desc:'Gerimis Ringan'},
    53:{icon:'🌦️',desc:'Gerimis Sedang'},55:{icon:'🌧️',desc:'Gerimis Lebat'},
    61:{icon:'🌧️',desc:'Hujan Ringan'},63:{icon:'🌧️',desc:'Hujan Sedang'},
    65:{icon:'🌧️',desc:'Hujan Lebat'},80:{icon:'🌦️',desc:'Hujan Singkat'},
    81:{icon:'🌧️',desc:'Hujan Deras'},95:{icon:'⛈️',desc:'Badai Petir'},
    99:{icon:'⛈️',desc:'Badai + Es'},
  };
  const q = id => document.getElementById(id);
  const setUI = (icon,desc,temp,humid) => {
    if(q('weatherIcon'))   q('weatherIcon').textContent   = icon;
    if(q('weatherTemp'))   q('weatherTemp').textContent   = temp;
    if(q('weatherDesc'))   q('weatherDesc').textContent   = desc;
    if(q('weatherDetail')) q('weatherDetail').textContent = `Kelembaban: ${humid} · ${LOC}`;
  };

  // Cek cache valid (max 30 menit, lokasi harus Gebang)
  try {
    const c = JSON.parse(localStorage.getItem('xii_wx_gebang')||'null');
    if(c && c.loc===LOC && (Date.now()-c.ts)<1800000) { setUI(c.icon, c.desc, c.temp, c.humid); }
    else setUI('🔄','Memuat cuaca...','--°C','--%');
  } catch(_) { setUI('🔄','Memuat cuaca...','--°C','--%'); }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
                `&current=temperature_2m,relative_humidity_2m,weathercode&timezone=Asia%2FJakarta`;
    const res  = await fetch(url);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();
    const cur  = json.current;
    const wx   = WMO[cur.weathercode] || WMO[2];
    const temp = Math.round(cur.temperature_2m)+'°C';
    const hum  = cur.relative_humidity_2m+'%';
    setUI(wx.icon, wx.desc, temp, hum);
    localStorage.setItem('xii_wx_gebang', JSON.stringify({icon:wx.icon,desc:wx.desc,temp,humid:hum,loc:LOC,ts:Date.now()}));
  } catch(err) {
    console.warn('[WEATHER] Gagal fetch:', err);
    try {
      const c = JSON.parse(localStorage.getItem('xii_wx_gebang')||'null');
      if(c && c.loc===LOC) { setUI(c.icon, c.desc+' (offline)', c.temp, c.humid); return; }
    } catch(_) {}
    setUI('⛅','Berawan Sebagian','30°C','78%'); // fallback khas Langkat pesisir
  }
}


/* ─── 7. ROSTER ─────────────────────────────────────────── */
function renderRoster(jadwal) {
  const DAY_MAP = {0:null,1:'senin',2:'selasa',3:'rabu',4:'kamis',5:'jumat',6:null};
  const todayKey = DAY_MAP[new Date().getDay()];
  document.querySelectorAll('.roster-grid').forEach(g=>g.remove());
  const container = document.querySelector('#roster .container');
  if(!container) return;

  Object.entries(jadwal).forEach(([hari, items]) => {
    const grid = document.createElement('div');
    grid.className='roster-grid'; grid.dataset.day=hari;
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'subj-card'+((item.isBreak||item.break)?' break-card':'');
      card.dataset.start=item.start; card.dataset.end=item.end;
      card.innerHTML=`
        <span class="subj-time">${item.start} – ${item.end}</span>
        ${item.ruang?`<span class="subj-room">${item.ruang}</span>`:''}
        <div class="subj-name">${item.mapel}</div>
        ${item.guru?`<div class="subj-teacher">${item.guru}</div>`:''}
        <div class="subj-now-badge">🔴 SEDANG BERLANGSUNG</div>`;
      grid.appendChild(card);
    });
    container.appendChild(grid);
  });

  document.querySelectorAll('.day-btn').forEach(btn=>{
    if(btn.dataset.day===todayKey) btn.classList.add('today-btn');
  });

  function highlightNow() {
    if(!todayKey) return;
    const cur=new Date().getHours()*60+new Date().getMinutes();
    document.querySelectorAll(`.roster-grid[data-day="${todayKey}"] .subj-card`).forEach(card=>{
      card.classList.remove('active-now');
      const [sh,sm]=card.dataset.start.split(':').map(Number);
      const [eh,em]=card.dataset.end.split(':').map(Number);
      if(cur>=sh*60+sm && cur<eh*60+em) card.classList.add('active-now');
    });
  }

  function showDay(day) {
    document.querySelectorAll('.day-btn').forEach(b=>b.classList.toggle('active',b.dataset.day===day));
    document.querySelectorAll('.roster-grid').forEach(g=>g.classList.toggle('active',g.dataset.day===day));
    if(day===todayKey) highlightNow();
  }
  todayKey?showDay(todayKey):showDay('senin');
  setInterval(highlightNow,30000);
  document.querySelectorAll('.day-btn').forEach(btn=>btn.addEventListener('click',()=>showDay(btn.dataset.day)));
}


/* ─── 8. TRACKLIST + COVER ART ─────────────────────────── */
function renderTracklist(tracks) {
  const list=document.getElementById('trackList');
  if(!list) return;
  list.innerHTML='';

  tracks.forEach((t,i)=>{
    const li=document.createElement('li');
    li.className='track-item';
    li.dataset.song=t.judul; li.dataset.artist=t.artis; li.dataset.trackid=t.trackid;

    // Cover art: fetch oEmbed Spotify langsung (CORS allow *)
    // Render placeholder dulu, swap ke thumbnail asli setelah fetch
    li.innerHTML=`
      <span class="track-num">${i+1}</span><span class="track-play">▶</span>
      <div class="track-thumb track-cover" id="cov-${t.trackid}"
        style="background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">
        🎵
      </div>
      <div class="track-info"><div class="track-title">${t.judul}</div><div class="track-artist">${t.artis}</div></div>
      <span class="track-dur">${t.durasi}</span>`;
    list.appendChild(li);

    // Fetch thumbnail dari Spotify oEmbed — support CORS, tidak perlu proxy
    fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${t.trackid}`)
      .then(r => r.json())
      .then(d => {
        if (!d.thumbnail_url) return;
        const el = document.getElementById(`cov-${t.trackid}`);
        if (!el) return;
        const img = new Image();
        img.onload = () => {
          el.innerHTML = '';
          el.style.background = 'none';
          el.style.fontSize = '0';
          el.appendChild(img);
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        };
        img.src = d.thumbnail_url;
      })
      .catch(() => {}); // Tetap 🎵 kalau gagal
  });

  const npText=document.getElementById('npText'), embed=document.getElementById('spotifyEmbed'),
        pw=document.getElementById('spotifyPreviewWrap'), plCov=document.getElementById('plCover');
  list.querySelectorAll('.track-item').forEach(item=>{
    item.addEventListener('click',()=>{
      list.querySelectorAll('.track-item').forEach(t=>t.style.background='');
      item.style.background='rgba(255,45,120,0.1)';
      if(npText) npText.textContent=`NOW PLAYING: ${item.dataset.song} — ${item.dataset.artist}`;
      const img=item.querySelector('.track-cover img');
      if(img&&plCov) plCov.innerHTML=`<img src="${img.src}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;" alt="">`;
      const tid=item.dataset.trackid;
      if(tid&&embed&&pw){embed.src=`https://open.spotify.com/embed/track/${tid}?utm_source=generator&theme=0&autoplay=1`;pw.style.display='block';}
    });
  });
}


/* ─── 9. GALLERY ────────────────────────────────────────── */
function initGallery() {
  document.querySelectorAll('.gf-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.gf-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const f=btn.dataset.filter;
      document.querySelectorAll('.photo-item').forEach(item=>{
        item.style.display=(f==='all'||item.dataset.cat===f)?'':'none';
      });
    });
  });
}


/* ─── 10. LIGHTBOX ──────────────────────────────────────── */
function initLightbox() {
  const lb      = document.getElementById('lightbox');
  const lbImg   = document.getElementById('lbImg');
  const lbTitle = document.getElementById('lbTitle');
  const lbTag   = document.getElementById('lbTag');
  const lbZoom  = document.getElementById('lbZoomWrap');
  const lbDots  = document.getElementById('lbDots');
  const lbPrev  = document.getElementById('lbPrev');
  const lbNext  = document.getElementById('lbNext');
  if (!lb) return;

  let _items = [], _cur = 0, _scale = 1, _tx = 0, _ty = 0;

  function applyTransform(animated) {
    if (!lbZoom) return;
    lbZoom.style.transition = animated ? 'transform .25s ease' : 'none';
    lbZoom.style.transform  = `scale(${_scale}) translate(${_tx}px,${_ty}px)`;
  }

  function setPhoto(idx) {
    _items = [...document.querySelectorAll('.photo-item')];
    _cur   = ((idx % _items.length) + _items.length) % _items.length;
    _scale = 1; _tx = 0; _ty = 0;
    applyTransform(false);
    const item  = _items[_cur];
    const imgEl = item.querySelector('.photo-inner img');
    if (imgEl) {
      lbImg.innerHTML = `<img src="${imgEl.src}" alt="${item.dataset.title || ''}"/>`;
    } else {
      lbImg.innerHTML = `<div class="lb-img-emoji">${item.querySelector('.photo-inner').innerHTML}</div>`;
    }
    if (lbTitle) lbTitle.textContent = item.dataset.title || '';
    if (lbTag)   lbTag.textContent   = (item.dataset.tag  || '').toUpperCase();
    renderDots();
  }

  function renderDots() {
    if (!lbDots) return;
    const total = _items.length;
    if (total > 20) {
      lbDots.innerHTML = `<span style="font-family:var(--mono);font-size:.6rem;color:rgba(255,255,255,.4);letter-spacing:2px;">${_cur+1} / ${total}</span>`;
      return;
    }
    lbDots.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const d = document.createElement('div');
      d.className = 'lb-dot' + (i === _cur ? ' active' : '');
      d.addEventListener('click', () => setPhoto(i));
      lbDots.appendChild(d);
    }
  }

  function open(idx) {
    _items = [...document.querySelectorAll('.photo-item')];
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    setPhoto(idx);
  }

  function close() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    _scale=1; _tx=0; _ty=0;
    applyTransform(false);
  }

  function attachClicks() {
    document.querySelectorAll('.photo-item').forEach((item, i) => {
      const clone = item.cloneNode(true);
      item.parentNode.replaceChild(clone, item);
      clone.addEventListener('click', () => open(i));
    });
  }
  attachClicks();

  lbPrev?.addEventListener('click', () => { _scale=1;_tx=0;_ty=0; setPhoto(_cur-1); });
  lbNext?.addEventListener('click', () => { _scale=1;_tx=0;_ty=0; setPhoto(_cur+1); });
  document.getElementById('lbClose')?.addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape')      close();
    if (e.key === 'ArrowLeft')  { _scale=1;_tx=0;_ty=0; setPhoto(_cur-1); }
    if (e.key === 'ArrowRight') { _scale=1;_tx=0;_ty=0; setPhoto(_cur+1); }
  });

  // Touch: swipe + pinch zoom + pan
  let _t0x=0,_t0y=0,_pinchDist=0,_dragging=false,_dtx=0,_dty=0,_dx0=0,_dy0=0,_tc=0;

  lb.addEventListener('touchstart', e => {
    _tc = e.touches.length;
    if (_tc === 1) {
      _t0x = e.touches[0].clientX; _t0y = e.touches[0].clientY;
      if (_scale > 1) {
        _dragging=true; _dtx=_tx; _dty=_ty;
        _dx0=e.touches[0].clientX; _dy0=e.touches[0].clientY;
      }
    } else if (_tc === 2) {
      _dragging = false;
      _pinchDist = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
    }
  }, {passive:true});

  lb.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
      _scale = Math.min(Math.max(_scale * (d/_pinchDist), 1), 4);
      _pinchDist = d;
      applyTransform(false);
    } else if (e.touches.length === 1 && _dragging && _scale > 1) {
      _tx = _dtx + (e.touches[0].clientX - _dx0) / _scale;
      _ty = _dty + (e.touches[0].clientY - _dy0) / _scale;
      applyTransform(false);
    }
  }, {passive:true});

  // Combined touchend: swipe + double-tap (single listener, no conflict)
  let _lastTap = 0;
  lb.addEventListener('touchend', e => {
    const now = Date.now();
    const isDoubleTap = (now - _lastTap) < 300;
    _lastTap = now;

    if (_dragging) { _dragging = false; return; }

    if (isDoubleTap) {
      // Double-tap: toggle zoom
      _scale = _scale > 1 ? 1 : 2.5;
      if (_scale === 1) { _tx = 0; _ty = 0; }
      applyTransform(true);
      return;
    }

    // Single finger swipe — only when not zoomed
    if (_tc === 1 && _scale <= 1) {
      const dx = e.changedTouches[0].clientX - _t0x;
      const dy = Math.abs(e.changedTouches[0].clientY - _t0y);
      if (Math.abs(dx) > 50 && dy < 80) {
        _scale=1; _tx=0; _ty=0;
        dx < 0 ? setPhoto(_cur+1) : setPhoto(_cur-1);
        return;
      }
    }

    // Snap back only if scale somehow went below 1
    if (_scale < 1) { _scale=1; _tx=0; _ty=0; applyTransform(true); }
    _tc = e.touches.length;
  }, {passive:true});

  window._lbInit = attachClicks;
}


/* ─── 11. MEMBER CARDS ──────────────────────────────────── */
function renderMembers(members) {
  const grid = document.getElementById('memberGrid');
  if (!grid) return;
  grid.innerHTML = '';
  members.forEach((m, i) => {
    const num  = String(i + 1).padStart(2, '0');
    const card = document.createElement('div');
    card.className = 'member-card';
    card.dataset.num = num; // simpan nomor absen di attribute
    card.innerHTML = `
      <div class="mc-inner">
        <div class="mc-front">
          <div class="mc-front-emoji" id="mcemoji-${num}">${m.emoji}</div>
          <div class="mc-front-overlay">
            <div class="member-num">#${num}</div>
            <div class="member-name">${m.nama}</div>
          </div>
        </div>
        <div class="mc-back">
          <div class="mc-back-emoji" id="mcbackbg-${num}">${m.emoji}</div>
          <div class="mc-back-content">
            <div class="mc-back-name">${m.nama.split(' ')[0].toUpperCase()}</div>
            <div class="mc-back-cita">🎯 ${m.cita}</div>
            <div class="mc-back-hobi">❤️ ${m.hobi}</div>
          </div>
        </div>
      </div>`;
    card.addEventListener('click', () => card.classList.toggle('flipped'));
    grid.appendChild(card);
  });
}


/* ─── 13. RENDER STRUKTUR KELAS ─────────────────────────── */
function renderStruktur(s) {
  const chart = document.getElementById('orgChartMain');
  if (!chart || !s.waliKelas) return;

  function makeNode(data, idPrefix, isChief = false) {
    const div = document.createElement('div');
    div.className = 'org-node' + (isChief ? ' chief' : '');
    div.id = 'orgNode-' + idPrefix;
    div.innerHTML = `
      <div class="org-avatar">${data.avatar}</div>
      <div class="org-overlay">
        <div class="org-role">${data.peran || ''}</div>
        <div class="org-name">${data.nama}</div>
      </div>
      <div class="org-tooltip">
        <strong>${data.nama}</strong><br>
        ${data.gelar ? data.gelar + ' · ' + data.mapel + '<br>' : ''}
        ${data.absen ? 'Absen ' + data.absen + ' · ' + (data.organisasi || '') + '<br>' : ''}
        <span class="tooltip-contact">${data.email ? '📧 ' + data.email : data.ig || ''}</span>
      </div>`;
    // Toggle tooltip on click (mobile friendly)
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = div.classList.contains('tooltip-open');
      // Tutup semua tooltip lain
      document.querySelectorAll('.org-node.tooltip-open').forEach(n => n.classList.remove('tooltip-open'));
      if (!isOpen) div.classList.add('tooltip-open');
    });

    return div;
  }

  // Klik di luar → tutup semua tooltip (dipasang sekali saja di luar fungsi)
  if (!document._orgTooltipListenerAdded) {
    document._orgTooltipListenerAdded = true;
    document.addEventListener('click', () => {
      document.querySelectorAll('.org-node.tooltip-open').forEach(n => n.classList.remove('tooltip-open'));
    });
  }

  const svg = chart.querySelector('#orgSvgLines');

  // Level 1 — Wali Kelas
  const lvl1 = document.createElement('div');
  lvl1.className = 'org-level'; lvl1.id = 'orgLevel1';
  lvl1.appendChild(makeNode({ ...s.waliKelas, peran: 'Wali Kelas' }, 'wali', true));
  chart.insertBefore(lvl1, svg);

  // Level 2 — Ketua & Wakil (keduanya chief)
  const lvl2 = document.createElement('div');
  lvl2.className = 'org-level'; lvl2.id = 'orgLevel2';
  (s.ketuaWakil || []).forEach(p => lvl2.appendChild(makeNode(p, p.id, true)));
  chart.insertBefore(lvl2, svg);

  // Level 3 — Sekretaris 1 & 2 (sub)
  const lvl3 = document.createElement('div');
  lvl3.className = 'org-level'; lvl3.id = 'orgLevel3';
  (s.pengurus || []).filter(p => p.id.startsWith('sek')).forEach(p => {
    const node = makeNode(p, p.id);
    node.classList.add('sub');
    lvl3.appendChild(node);
  });
  chart.insertBefore(lvl3, svg);

  requestAnimationFrame(initOrgLines);
}


/* ─── 14. ORG CHART NEON SVG LINES ─────────────────────── */
function initOrgLines() {
  const chart = document.getElementById('orgChartMain');
  const svg   = document.getElementById('orgSvgLines');
  if (!chart || !svg) return;

  function getBox(el) {
    const cr = chart.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return {
      x:      er.left - cr.left + er.width  / 2,
      top:    er.top  - cr.top,
      bottom: er.top  - cr.top + er.height,
    };
  }

  function line(x1, y1, x2, y2) {
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    bg.setAttribute('x1', x1); bg.setAttribute('y1', y1);
    bg.setAttribute('x2', x2); bg.setAttribute('y2', y2);
    bg.setAttribute('class', 'neon-path-bg');
    svg.appendChild(bg);
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('class', 'neon-path');
    svg.appendChild(l);
  }

  function drawLines() {
    svg.innerHTML = '';
    const cr = chart.getBoundingClientRect();
    svg.setAttribute('width',  cr.width);
    svg.setAttribute('height', cr.height);

    const wali  = document.getElementById('orgNode-wali');
    const ketua = document.getElementById('orgNode-ketua');
    const wakil = document.getElementById('orgNode-wakil');
    const sek1  = document.getElementById('orgNode-sek1');
    const sek2  = document.getElementById('orgNode-sek2');
    if (!wali || !ketua || !sek1) return;

    const W  = getBox(wali);
    const K  = getBox(ketua);
    const Wk = wakil ? getBox(wakil) : null;
    const S1 = getBox(sek1);
    const S2 = sek2  ? getBox(sek2)  : null;

    // Wali → junction → Ketua & Wakil
    const jY1 = W.bottom + (K.top - W.bottom) / 2;
    line(W.x, W.bottom, W.x, jY1);
    if (Wk) {
      line(K.x,  jY1, Wk.x, jY1);
      line(Wk.x, jY1, Wk.x, Wk.top);
    }
    line(K.x, jY1, K.x, K.top);

    // Ketua → Sek1 lurus ke bawah
    line(K.x, K.bottom, K.x, S1.top);

    // Wakil → Sek2 lurus ke bawah (hanya kalau keduanya ada)
    if (Wk && S2) line(Wk.x, Wk.bottom, Wk.x, S2.top);


  }

  // Gambar sekali setelah layout settled — pakai requestAnimationFrame biar smooth
  requestAnimationFrame(() => {
    drawLines();
    // Satu redraw backup setelah font/foto selesai
    setTimeout(drawLines, 500);
  });

  // Resize: debounce supaya tidak lag saat resize
  let _resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(drawLines, 200);
  });
}

// Global foto map for leaderboard
let _namaToFoto = {};

function injectLbPhotos(sorted, sc) {
  if (!Object.keys(_namaToFoto).length) return;
  ['pod1','pod2','pod3'].forEach((id, idx) => {
    const st = sorted[idx]; if (!st) return;
    const avaEl = document.getElementById(id + 'ava'); if (!avaEl) return;
    const url = _namaToFoto[st.nama.toLowerCase()]; if (!url) return;
    avaEl.innerHTML = `<img src="${clOptimize(url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`;
    avaEl.style.cssText = 'width:48px;height:48px;overflow:hidden;border-radius:50%;margin:0 auto;';
  });
  document.querySelectorAll('#lbList .lb-row').forEach(row => {
    const namaEl = row.querySelector('.lb-rname'); if (!namaEl) return;
    const url = _namaToFoto[namaEl.textContent.trim().toLowerCase()]; if (!url) return;
    const avaEl = row.querySelector('.lb-ava'); if (!avaEl) return;
    avaEl.innerHTML = `<img src="${clOptimize(url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`;
    avaEl.style.cssText = 'width:36px;height:36px;overflow:hidden;border-radius:50%;flex-shrink:0;';
  });
}

const SUBJECT_LABELS = {
  all:           'Semua Mapel',
  agama_islam:   'Agama Islam',
  agama_kristen: 'Agama Kristen',
  pkn:           'PKN',
  b_indo:        'B. Indonesia',
  mtk_umum:      'Matematika U',
  b_inggris:     'B. Inggris',
  sejarah:       'Sejarah',
  pjok:          'PJOK',
  seni_budaya:   'Seni Budaya',
  mtk_l:         'Matematika L',
  fisika:        'Fisika',
  kimia:         'Kimia',
  prakarya:      'Prakarya',
  informatika:   'Informatika'
};

function renderLeaderboard(subject, lbData) {
  let sorted, sc;
  if (subject === 'all') {
    const totals = {};
    lbData.forEach(s => {
      const key = s.nama;
      if (!totals[key]) totals[key] = { nama: s.nama, emoji: s.emoji, total: 0 };
      Object.values(s.nilai).forEach(v => { totals[key].total += v; });
    });
    sc = s => s.nilai.all;
    sorted = Object.values(totals)
      .map(t => ({ nama: t.nama, emoji: t.emoji, nilai: { all: t.total } }))
      .sort((a,b) => sc(b) - sc(a)).slice(0, 10);
  } else {
    sc = s => s.nilai[subject] ?? 0;
    sorted = lbData.filter(s => s.nilai[subject] !== undefined)
                   .sort((a,b) => sc(b) - sc(a)).slice(0, 10);
  }
  const max = sorted.length ? sc(sorted[0]) : 100;

  [[0,'pod1name','pod1score','pod1ava'],[1,'pod2name','pod2score','pod2ava'],[2,'pod3name','pod3score','pod3ava']]
    .forEach(([idx,n,s,a])=>{
      const st=sorted[idx]; if(!st) return;
      document.getElementById(n).textContent=st.nama.split(' ')[0];
      document.getElementById(s).textContent=sc(st);
      document.getElementById(a).textContent=st.emoji;
    });

  const listEl=document.getElementById('lbList'); if(!listEl) return;
  listEl.innerHTML='';
  sorted.forEach((st,i)=>{
    const s=sc(st), pct=Math.round((s/max)*100);
    const row=document.createElement('div');
    row.className='lb-row'+(i===0?' gold':'');
    row.innerHTML=`
      <div class="lb-rank">${i<3?['🥇','🥈','🥉'][i]:'#'+(i+1)}</div>
      <div class="lb-ava">${st.emoji}</div>
      <div style="flex:1"><div class="lb-rname">${st.nama}</div>
        <div class="lb-subj">${SUBJECT_LABELS[subject]||subject.toUpperCase()}</div></div>
      <div><div class="lb-val">${s}</div>
        <div class="lb-bar-wrap"><div class="lb-bar-fill" style="width:0%" data-pct="${pct}"></div></div></div>`;
    listEl.appendChild(row);
  });
  setTimeout(()=>{listEl.querySelectorAll('.lb-bar-fill').forEach(b=>b.style.width=b.dataset.pct+'%');},100);
  injectLbPhotos(sorted, sc);
}



const DEFAULT_CATEGORIES = ['kegiatan','wisata','prestasi','sehari-hari'];
let _galeriKategori = [...DEFAULT_CATEGORIES];
let _katLoaded = false;

/* ─── KATEGORI GALERI (DYNAMIC) ─────────────────────────── */
async function loadKategori() {
  try {
    const snap = await fsGet('galeri_config', 'kategori');
    if (snap && snap.exists()) {
      const extra = (snap.data().list || []).map(k => k.trim().toLowerCase()).filter(Boolean);
      _galeriKategori = [...new Set([...DEFAULT_CATEGORIES, ...extra])];
    } else {
      _galeriKategori = [...DEFAULT_CATEGORIES];
    }
  } catch(e) {
    _galeriKategori = [...DEFAULT_CATEGORIES];
  }
  _katLoaded = true;
  syncFilterButtons();
  syncKatSelect();
}

async function saveKategori() {
  const extra = _galeriKategori.filter(k => !DEFAULT_CATEGORIES.includes(k));
  await fsSet('galeri_config', 'kategori', { list: extra });
}

function syncFilterButtons() {
  const wrap = document.getElementById('galleryFilter');
  if (!wrap) return;
  const active = wrap.querySelector('.gf-btn.active')?.dataset.filter || 'all';
  wrap.innerHTML = `<button class="gf-btn${active==='all'?' active':''}" data-filter="all">SEMUA</button>`;
  _galeriKategori.forEach(k => {
    const btn = document.createElement('button');
    btn.className = 'gf-btn' + (active===k?' active':'');
    btn.dataset.filter = k;
    btn.textContent = k.toUpperCase().replace(/-/g,' ');
    wrap.appendChild(btn);
  });
  wrap.querySelectorAll('.gf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.gf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const f = btn.dataset.filter;
      document.querySelectorAll('.photo-item').forEach(item => {
        item.style.display = (f==='all' || item.dataset.cat===f) ? '' : 'none';
      });
    });
  });
}

function syncKatSelect() {
  const sel = document.getElementById('admGaleriKat');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = _galeriKategori.map(k =>
    `<option value="${k}"${k===cur?' selected':''}>${k.toUpperCase().replace(/-/g,' ')}</option>`
  ).join('');
}

async function admLoadKategori() {
  const listEl = document.getElementById('admKatList');
  if (listEl) listEl.innerHTML = '<div class="adm-loading">MEMUAT...</div>';
  await loadKategori();
  renderKatList();
}

function renderKatList() {
  const listEl = document.getElementById('admKatList');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!_galeriKategori.length) {
    listEl.innerHTML = '<div style="opacity:.4;font-size:.8rem">Belum ada kategori.</div>';
    return;
  }
  _galeriKategori.forEach(k => {
    const isDefault = DEFAULT_CATEGORIES.includes(k);
    const item = document.createElement('div');
    item.className = 'adm-kat-item' + (isDefault ? ' default' : '');
    const label = k.toUpperCase().replace(/-/g,' ');
    if (isDefault) {
      item.innerHTML = `<span>${label}</span><small style="opacity:.35;font-size:.6rem;margin-left:.3rem">(default)</small>`;
    } else {
      item.innerHTML = `<span>${label}</span><button class="adm-kat-del" data-kat="${k}" title="Hapus kategori ini">✕</button>`;
    }
    listEl.appendChild(item);
  });
  listEl.querySelectorAll('.adm-kat-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kat = btn.dataset.kat;
      if (!confirm('Hapus kategori "' + kat.toUpperCase() + '"?')) return;
      _galeriKategori = _galeriKategori.filter(k => k !== kat);
      try {
        await saveKategori();
        admToast('✅ Kategori dihapus!');
      } catch(e) {
        admToast('❌ Gagal hapus: ' + e.message);
        return;
      }
      renderKatList();
      syncFilterButtons();
      syncKatSelect();
    });
  });
}

/* ══════════════════════════════════════════════════════════
   ADMIN PANEL — INTEGRATED
   Cloudinary: dt3jniwcc / class-t1-project
   Trigger: tap 3x pada footer copyright
══════════════════════════════════════════════════════════ */

const CL_CLOUD_NAME    = 'dt3jniwcc';
const CL_UPLOAD_PRESET = 'class-t1-project';


/* ─── CLOUDINARY URL OPTIMIZER ──────────────────────────────
   mode 'profile' → f_auto,q_auto,w_400,c_fill  (foto profil/struktur, resize aman)
   mode 'gallery' → f_auto,q_auto               (galeri, full resolution, cuma ganti format)
   ──────────────────────────────────────────────────────────── */
function clOptimize(url, mode = 'profile') {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  if (url.includes('/f_auto') || url.includes('/q_auto')) return url;
  const transform = mode === 'gallery'
    ? 'f_auto,q_auto'
    : 'f_auto,q_auto,w_400,c_fill';
  return url.replace('/image/upload/', `/image/upload/${transform}/`);
}
/* ══ ULTAH ADMIN ════════════════════════════════════════════ */

// Cache anggota supaya tidak fetch ulang
let _admAnggotaCache = null;

async function admGetAnggota() {
  if (_admAnggotaCache) return _admAnggotaCache;
  try {
    const d = await fetch('data.json').then(r => r.json());
    _admAnggotaCache = d.anggota || [];
    return _admAnggotaCache;
  } catch(_) { return []; }
}

async function admLoadUltah() {
  const grid    = document.getElementById('admUltahGrid');
  const countEl = document.getElementById('admUltahCount');
  if (!grid) return;
  grid.innerHTML = '<div class="adm-loading">⏳ MEMUAT...</div>';

  const anggota = await admGetAnggota();

  // Ambil data lahir dari Firestore
  let lahirMap = {};
  try {
    const snap = await fsGet('app_config', 'lahir');
    if (snap.exists()) lahirMap = snap.data();
  } catch(_) {}

  if (countEl) countEl.textContent = anggota.length + ' ANGGOTA';
  grid.innerHTML = '';

  anggota.forEach((m, i) => {
    const num  = String(i + 1).padStart(2, '0');
    const fid  = 'anggota_' + num;
    const lahir = lahirMap[fid] || m.lahir || '';

    // Hitung hari ultah
    let badge = '';
    if (lahir) {
      const parts = lahir.split('-');
      if (parts.length === 3) {
        const now     = new Date();
        const mm      = String(now.getMonth() + 1).padStart(2,'0');
        const dd      = String(now.getDate()).padStart(2,'0');
        const todayMD = `${mm}-${dd}`;
        const birthMD = `${parts[1]}-${parts[2]}`;
        if (birthMD === todayMD) badge = '🎂 HARI INI!';
        else {
          // Hitung berapa hari lagi
          const thisYear  = new Date(now.getFullYear(), parts[1]-1, parts[2]);
          const nextYear  = new Date(now.getFullYear()+1, parts[1]-1, parts[2]);
          const nextBday  = thisYear > now ? thisYear : nextYear;
          const diffDays  = Math.ceil((nextBday - now) / (1000*60*60*24));
          if (diffDays <= 7) badge = `⚡ ${diffDays} HARI LAGI`;
        }
      }
    }

    const card = document.createElement('div');
    card.className = 'adm-ultah-card';
    card.innerHTML = `
      <div class="adm-ultah-emoji">${m.emoji || '👤'}</div>
      <div class="adm-ultah-nama">${m.nama}</div>
      <input type="date" class="adm-ultah-input" id="ultah-${fid}"
        value="${lahir}" title="Tanggal lahir ${m.nama}"/>
      <div class="adm-ultah-badge" id="ultahbadge-${fid}">${badge}</div>`;
    grid.appendChild(card);
  });

  // Tombol simpan semua
  document.getElementById('admSaveUltahBtn').onclick = () => admSaveUltah(anggota);
}

async function admSaveUltah(anggota) {
  const btn = document.getElementById('admSaveUltahBtn');
  btn.disabled = true; btn.textContent = '⏳ MENYIMPAN...';
  const map = {};
  anggota.forEach((m, i) => {
    const num  = String(i + 1).padStart(2, '0');
    const fid  = 'anggota_' + num;
    const val  = document.getElementById('ultah-' + fid)?.value || '';
    if (val) map[fid] = val;
  });
  try {
    await fsSet('app_config', 'lahir', map);
    admToast('✅ TANGGAL LAHIR TERSIMPAN!');
    // Refresh badge
    admLoadUltah();
  } catch(err) {
    admToast('❌ GAGAL: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '💾 SIMPAN SEMUA';
  }
}


/* ══ QUOTES ADMIN ═══════════════════════════════════════════ */

let _admQuotesCache = [];

async function admLoadQuotes() {
  const grid    = document.getElementById('admQuotesGrid');
  const countEl = document.getElementById('admQuotesCount');
  if (!grid) return;
  grid.innerHTML = '<div class="adm-loading">⏳ MEMUAT...</div>';

  // Ambil dari Firestore dulu, fallback ke data.json
  try {
    const snap = await fsGet('app_config', 'quotes');
    if (snap.exists() && snap.data().list?.length) {
      _admQuotesCache = snap.data().list;
    } else {
      const d = await fetch('data.json').then(r => r.json());
      _admQuotesCache = d.quotes || [];
    }
  } catch(_) {
    try {
      const d = await fetch('data.json').then(r => r.json());
      _admQuotesCache = d.quotes || [];
    } catch(__) { _admQuotesCache = []; }
  }

  admRenderQuotes();
  if (countEl) countEl.textContent = _admQuotesCache.length + ' QUOTES';

  // Tombol tambah quote
  document.getElementById('admAddQuoteBtn').onclick = () => {
    _admQuotesCache.push({ teks: '', penulis: '' });
    admRenderQuotes();
    // Scroll ke bawah ke quote baru
    grid.lastElementChild?.scrollIntoView({ behavior: 'smooth' });
  };
}

function admRenderQuotes() {
  const grid    = document.getElementById('admQuotesGrid');
  const countEl = document.getElementById('admQuotesCount');
  if (!grid) return;
  grid.innerHTML = '';

  _admQuotesCache.forEach((q, i) => {
    const card = document.createElement('div');
    card.className = 'adm-quote-card';
    card.innerHTML = `
      <div class="adm-quote-num">#${String(i+1).padStart(2,'0')}</div>
      <div class="adm-quote-fields">
        <textarea class="adm-quote-teks" id="qteks-${i}"
          placeholder="Isi quote di sini...">${q.teks || ''}</textarea>
        <input type="text" class="adm-quote-penulis" id="qpenulis-${i}"
          placeholder="— Nama Penulis" value="${q.penulis || ''}"/>
      </div>
      <button class="adm-quote-del" data-idx="${i}" title="Hapus quote ini">🗑</button>
      <button class="adm-add-btn" id="qsave-${i}"
        style="align-self:center;padding:.4rem .9rem;font-size:.6rem;flex-shrink:0;">
        💾
      </button>`;

    // Hapus quote
    card.querySelector('.adm-quote-del').addEventListener('click', async () => {
      if (!confirm('Hapus quote ini?')) return;
      _admQuotesCache.splice(i, 1);
      admRenderQuotes();
      await admSaveQuotes();
    });

    // Simpan satu quote
    card.querySelector('#qsave-' + i).addEventListener('click', async () => {
      const teks    = document.getElementById('qteks-' + i)?.value.trim();
      const penulis = document.getElementById('qpenulis-' + i)?.value.trim();
      if (!teks) { admToast('⚠️ TEKS QUOTE TIDAK BOLEH KOSONG'); return; }
      _admQuotesCache[i] = { teks, penulis: penulis || 'Anonim' };
      await admSaveQuotes();
      admToast('✅ QUOTE #' + (i+1) + ' TERSIMPAN!');
      admRenderQuotes();
    });

    grid.appendChild(card);
  });

  if (countEl) countEl.textContent = _admQuotesCache.length + ' QUOTES';
}

async function admSaveQuotes() {
  try {
    // Ambil nilai terkini dari DOM sebelum simpan
    const updated = _admQuotesCache.map((q, i) => ({
      teks:    document.getElementById('qteks-' + i)?.value.trim()    || q.teks,
      penulis: document.getElementById('qpenulis-' + i)?.value.trim() || q.penulis || 'Anonim',
    })).filter(q => q.teks);
    _admQuotesCache = updated;
    await fsSet('app_config', 'quotes', { list: updated });
    return true;
  } catch(err) {
    admToast('❌ GAGAL SIMPAN: ' + err.message);
    return false;
  }
}


/* ══ BIRTHDAY BANNER (tampil saat web dibuka) ═══════════════ */
async function showBirthdayBanner(anggota) {
  // Ambil data lahir + foto profil dari Firestore secara paralel
  let lahirMap = {}, fotoMap = {};
  try {
    const [lahirSnap, fotoSnap] = await Promise.all([
      fsGet('app_config', 'lahir'),
      fsGet('foto_profil', 'map'),
    ]);
    if (lahirSnap.exists()) lahirMap = lahirSnap.data();
    if (fotoSnap.exists())  fotoMap  = fotoSnap.data();
  } catch(_) {}

  const now      = new Date();
  const todayMM  = String(now.getMonth() + 1).padStart(2, '0');
  const todayDD  = String(now.getDate()).padStart(2, '0');
  const todayKey = `${todayMM}-${todayDD}`;

  // Kumpulkan siapa yang ultah hari ini + index mereka
  const ultahHariIni = anggota
    .map((m, i) => ({ m, i }))
    .filter(({ m, i }) => {
      const num   = String(i + 1).padStart(2, '0');
      const fid   = 'anggota_' + num;
      const lahir = lahirMap[fid] || m.lahir || '';
      if (!lahir) return false;
      const parts = lahir.split('-');
      return parts.length === 3 && `${parts[1]}-${parts[2]}` === todayKey;
    });

  if (!ultahHariIni.length) return;

  // Inject style banner
  const s = document.createElement('style');
  s.textContent = `
    #bdayBanner {
      position: fixed; top: 0; left: 0; right: 0; z-index: 600;
      background: linear-gradient(135deg, #1a0010, #2d0020, #1a0010);
      border-bottom: 1px solid rgba(255,45,120,.5);
      padding: .8rem 3rem .8rem 1.5rem;
      display: flex; align-items: center; justify-content: center;
      gap: 1.2rem; flex-wrap: wrap;
      box-shadow: 0 4px 30px rgba(255,45,120,.2);
      animation: bdaySlideIn .5s cubic-bezier(.4,0,.2,1) both;
    }
    @keyframes bdaySlideIn {
      from { transform: translateY(-100%); opacity:0; }
      to   { transform: none; opacity:1; }
    }
    .bday-confetti {
      font-size: 1.2rem;
      animation: confettiSpin 2s ease-in-out infinite alternate;
      flex-shrink: 0;
    }
    @keyframes confettiSpin {
      from { transform: rotate(-15deg) scale(1); }
      to   { transform: rotate(15deg) scale(1.1); }
    }
    /* Foto avatar ultah */
    .bday-avatars {
      display: flex; gap: .5rem; align-items: center; flex-shrink: 0;
    }
    .bday-avatar-wrap {
      position: relative;
      width: 44px; height: 44px; flex-shrink: 0;
    }
    .bday-avatar-ring {
      position: absolute; inset: -2px; border-radius: 50%;
      background: conic-gradient(
        #f09433 0deg, #e6683c 60deg, #dc2743 120deg,
        #cc2366 180deg, #bc1888 240deg, #ff2d78 300deg, #f09433 360deg
      );
      animation: bdayRingSpin 3s linear infinite;
    }
    @keyframes bdayRingSpin { to { transform: rotate(360deg); } }
    .bday-avatar-ring::after {
      content: ''; position: absolute; inset: 2px;
      border-radius: 50%; background: #1a0010;
    }
    .bday-avatar-img {
      position: absolute; inset: 3px;
      width: calc(100% - 6px); height: calc(100% - 6px);
      border-radius: 50%; object-fit: cover; z-index: 2;
      background: linear-gradient(135deg, #2d0020, #1a0010);
      display: flex; align-items: center; justify-content: center;
      font-size: 1.3rem; overflow: hidden;
    }
    .bday-avatar-img img {
      width: 100%; height: 100%; object-fit: cover; border-radius: 50%;
    }
    /* Teks */
    .bday-text-wrap {
      display: flex; flex-direction: column; align-items: center;
      gap: .2rem; text-align: center;
    }
    .bday-text-main {
      font-family: 'Share Tech Mono', monospace; font-size: .72rem;
      letter-spacing: 3px; color: #fff; line-height: 1.5;
    }
    .bday-text-main .bday-name { color: #ff2d78; font-size: .85rem; }
    .bday-text-sub {
      font-family: 'Share Tech Mono', monospace; font-size: .58rem;
      letter-spacing: 2px; color: rgba(255,255,255,.45);
    }
    #bdayBannerClose {
      position: absolute; right: .8rem; top: 50%; transform: translateY(-50%);
      background: transparent; border: none; color: rgba(255,255,255,.35);
      font-size: 1rem; cursor: pointer; transition: color .2s; padding: .3rem .5rem;
    }
    #bdayBannerClose:hover { color: #ff2d78; }
    @media (max-width: 480px) {
      #bdayBanner { padding: .8rem 2.5rem .8rem 1rem; gap: .7rem; }
      .bday-avatar-wrap { width: 36px; height: 36px; }
      .bday-text-main { font-size: .62rem; letter-spacing: 2px; }
    }`;
  document.head.appendChild(s);

  // Buat HTML avatar untuk setiap yang ultah
  const avatarsHTML = ultahHariIni.map(({ m, i }) => {
    const num    = String(i + 1).padStart(2, '0');
    const fid    = 'anggota_' + num;
    const foto   = fotoMap[fid];
    const inner  = foto
      ? `<img src="${clOptimize(foto)}" alt="${m.nama}" loading="lazy"/>`
      : m.emoji || '🎂';
    return `
      <div class="bday-avatar-wrap" title="${m.nama}">
        <div class="bday-avatar-ring"></div>
        <div class="bday-avatar-img">${inner}</div>
      </div>`;
  }).join('');

  const namaList = ultahHariIni.map(({ m }) => m.nama.split(' ')[0]).join(' & ');

  const banner = document.createElement('div');
  banner.id = 'bdayBanner';
  banner.innerHTML = `
    <span class="bday-confetti">🎊</span>
    <div class="bday-avatars">${avatarsHTML}</div>
    <div class="bday-text-wrap">
      <div class="bday-text-main">
        🎂 SELAMAT ULANG TAHUN
        <span class="bday-name"> ${namaList.toUpperCase()}</span>!
      </div>
      <div class="bday-text-sub">SEMOGA SUKSES, SEHAT &amp; BAHAGIA SELALU 🎉</div>
    </div>
    <span class="bday-confetti">🎊</span>
    <button id="bdayBannerClose" title="Tutup">✕</button>`;

  const nav = document.querySelector('nav');
  nav ? nav.insertAdjacentElement('afterend', banner) : document.body.prepend(banner);
  document.getElementById('bdayBannerClose').addEventListener('click', () => banner.remove());
  setTimeout(() => document.getElementById('bdayBanner')?.remove(), 20000);
}


/* ══ QUOTE OF THE DAY (tampil saat web dibuka) ══════════════ */
async function showQOTD(quotesFromData) {
  // Ambil quotes dari Firestore dulu (admin bisa edit), fallback ke data.json
  let quotes = [];
  try {
    const snap = await fsGet('app_config', 'quotes');
    if (snap.exists() && snap.data().list?.length) {
      quotes = snap.data().list;
    } else {
      quotes = quotesFromData;
    }
  } catch(_) {
    quotes = quotesFromData;
  }

  if (!quotes.length) return;

  // Quote acak setiap kali halaman dibuka
  const q = quotes[Math.floor(Math.random() * quotes.length)];
  if (!q?.teks) return;

  const s = document.createElement('style');
  s.textContent = `
    #qotdToast {
      position:fixed; bottom:1.5rem; left:1.5rem; z-index:700;
      background:rgba(13,13,16,.97); border:1px solid rgba(255,45,120,.3);
      padding:1.2rem 1.4rem; max-width:min(360px,calc(100vw - 3rem));
      box-shadow:0 0 40px rgba(255,45,120,.12);
      animation:qotdIn .4s cubic-bezier(.4,0,.2,1) both;
    }
    @keyframes qotdIn { from{opacity:0;transform:translateY(20px);} to{opacity:1;transform:none;} }
    #qotdToast .qotd-label {
      font-family:'Share Tech Mono',monospace; font-size:.55rem;
      letter-spacing:4px; color:#ff2d78; margin-bottom:.6rem;
    }
    #qotdToast .qotd-teks {
      font-size:.82rem; color:rgba(255,255,255,.85);
      line-height:1.7; font-style:italic; margin-bottom:.5rem;
    }
    #qotdToast .qotd-penulis {
      font-family:'Share Tech Mono',monospace; font-size:.65rem;
      color:rgba(255,45,120,.7); letter-spacing:1px;
    }
    #qotdClose {
      position:absolute; top:.6rem; right:.8rem;
      background:transparent; border:none; color:rgba(255,255,255,.25);
      font-size:.9rem; cursor:pointer; transition:color .2s; padding:.2rem .4rem;
    }
    #qotdClose:hover { color:#ff2d78; }`;
  document.head.appendChild(s);

  const toast = document.createElement('div');
  toast.id = 'qotdToast';
  toast.innerHTML = `
    <button id="qotdClose" title="Tutup">✕</button>
    <div class="qotd-label">💬 QUOTE OF THE DAY</div>
    <div class="qotd-teks">"${q.teks}"</div>
    <div class="qotd-penulis">— ${q.penulis || 'Anonim'}</div>`;

  document.body.appendChild(toast);
  document.getElementById('qotdClose').addEventListener('click', () => toast.remove());
  setTimeout(() => document.getElementById('qotdToast')?.remove(), 12000);
}


/* ─── ADMIN AUTH — Rate-limited + Lockout ────────────────
   ⚠️  Password TIDAK disimpan di sini lagi.
       Hash dipindahkan ke Firestore (koleksi: app_config / doc: admin_auth)
       dengan field `pwHash` (SHA-256). Cara set pertama kali:
         1. Di browser console sementara jalankan:
              const h = async p => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(p)))].map(b=>b.toString(16).padStart(2,'0')).join('');
              console.log(await h('PASSWORD_BARU_KAMU'));
         2. Salin hash-nya, lalu di Firebase Console → Firestore →
            app_config → admin_auth → field: pwHash → paste hash.

   🔒 Proteksi brute-force:
       - Maks 5 percobaan salah per 10 menit (disimpan sessionStorage)
       - Setelah terkunci, form diblokir 10 menit
   ─────────────────────────────────────────────────────── */

const AUTH_MAX_ATTEMPTS  = 5;
const AUTH_LOCKOUT_MS    = 10 * 60 * 1000; // 10 menit
const AUTH_LS_KEY        = 'xi_adm_attempts';

function _getAuthState() {
  try {
    return JSON.parse(sessionStorage.getItem(AUTH_LS_KEY)) || { count: 0, since: 0 };
  } catch(_) { return { count: 0, since: 0 }; }
}
function _setAuthState(s) {
  try { sessionStorage.setItem(AUTH_LS_KEY, JSON.stringify(s)); } catch(_) {}
}
function _resetAuthState() {
  try { sessionStorage.removeItem(AUTH_LS_KEY); } catch(_) {}
}

/** Cek apakah sedang dalam masa lockout. Return sisa ms, atau 0. */
function getAuthLockoutRemaining() {
  const s = _getAuthState();
  if (s.count < AUTH_MAX_ATTEMPTS) return 0;
  const elapsed = Date.now() - s.since;
  if (elapsed >= AUTH_LOCKOUT_MS) { _resetAuthState(); return 0; }
  return AUTH_LOCKOUT_MS - elapsed;
}

/** Hash password input lalu bandingkan dengan hash di Firestore */
async function checkAdminPassword(input) {
  // 1. Cek lockout terlebih dahulu
  const remaining = getAuthLockoutRemaining();
  if (remaining > 0) {
    const menit = Math.ceil(remaining / 60000);
    throw new Error(`TERKUNCI — coba lagi dalam ${menit} menit.`);
  }

  // 2. Hash input
  const encoded = new TextEncoder().encode(input.trim());
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  const hashHex = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');

  // 3. Ambil hash yang benar dari Firestore
  let storedHash = '';
  try {
    const snap = await fsGet('app_config', 'admin_auth');
    if (snap.exists()) storedHash = snap.data().pwHash || '';
  } catch(e) {
    console.error('[AUTH] Gagal membaca hash dari Firestore:', e);
    throw new Error('Gagal verifikasi — cek koneksi internet.');
  }

  if (!storedHash) {
    // Fallback: jika admin_auth belum diset di Firestore, tolak semua
    console.warn('[AUTH] admin_auth belum diset di Firestore. Akses ditolak.');
    throw new Error('Admin belum dikonfigurasi. Hubungi pembuat website.');
  }

  const ok = hashHex === storedHash;

  // 4. Catat percobaan gagal
  if (!ok) {
    const s = _getAuthState();
    const newCount = s.count + 1;
    _setAuthState({ count: newCount, since: newCount === 1 ? Date.now() : s.since });
    const sisa = AUTH_MAX_ATTEMPTS - newCount;
    if (sisa <= 0) {
      throw new Error(`Password salah. Akun terkunci 10 menit.`);
    }
    throw new Error(`Password salah. Sisa percobaan: ${sisa}`);
  }

  // 5. Berhasil — reset counter
  _resetAuthState();
  return true;
}

/* localStorage hanya untuk cache ringan — sumber kebenaran = Firestore */
function loadFotoLocal() { /* tidak dipakai lagi, diganti Firestore */ }

/* ─── Cloudinary upload (dengan validasi keamanan) ──
   ⚠️  Gunakan SIGNED upload preset untuk produksi:
       1. Cloudinary Console → Settings → Upload Presets
       2. Ubah preset 'class-t1-project' dari Unsigned → Signed
       3. Set "Allowed formats": jpg,png,webp
       4. Set "Max file size": 5000000 (5MB)
   Saat ini: validasi dilakukan di sisi browser sebelum upload.
   ───────────────────────────────────────────────── */

const CL_ALLOWED_TYPES  = ['image/jpeg', 'image/png', 'image/webp'];
const CL_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function validateImageFile(file) {
  if (!file) throw new Error('Tidak ada file yang dipilih.');
  if (!CL_ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`Tipe file tidak diizinkan: ${file.type}. Gunakan JPG, PNG, atau WEBP.`);
  }
  if (file.size > CL_MAX_SIZE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`Ukuran file terlalu besar: ${mb}MB. Maksimal 5MB.`);
  }
  return true;
}

async function clUpload(file, folder) {
  // Validasi sebelum upload
  validateImageFile(file);

  // Pastikan hanya admin yang bisa upload (sesi aktif)
  if (!sessionStorage.getItem('xii_admin')) {
    throw new Error('Akses ditolak. Silakan login sebagai admin.');
  }

  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CL_UPLOAD_PRESET);
  fd.append('folder', 'xi-teknik1/' + folder);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CL_CLOUD_NAME}/image/upload`,
      { method: 'POST', body: fd, signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error('Upload gagal: ' + (errData.error?.message || res.status));
    }
    const d = await res.json();
    if (!d.secure_url) throw new Error('Respons Cloudinary tidak valid.');
    return { url: d.secure_url, public_id: d.public_id };
  } catch(e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Upload timeout. Cek koneksi internet.');
    throw e;
  }
}

/* ─── Storage helpers → FIRESTORE ──────────────────────── */
const getFotoMap  = async () => {
  try { const s = await fsGet('foto_profil','map'); return s.exists() ? s.data() : {}; }
  catch(_) { return {}; }
};
const getGaleri   = async () => {
  try { return await fsAll('galeri'); }
  catch(_) { return []; }
};
const saveFotoMap = async (m) => fsSet('foto_profil', 'map', m);
const saveGaleri  = async (_arr) => { /* tidak dipakai — pakai fsAdd/fsDel langsung */ };

/* ─── Toast ─────────────────────────────────────────────── */
function admToast(msg, dur=2800) {
  const t = document.getElementById('admToast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

/* ─── Init admin ────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function() {
  const trigger = document.getElementById('admTrigger');
  if (!trigger) return;

  /* Tap 3x untuk buka login */
  let tapCount = 0, tapTimer = null;
  function handleTrigger() {
    tapCount++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapCount = 0; }, 800);
    if (tapCount >= 3) {
      tapCount = 0; clearTimeout(tapTimer);
      if (sessionStorage.getItem('xii_admin') === '1') {
        openAdminPanel();
      } else {
        document.getElementById('admLoginOverlay').classList.add('open');
        setTimeout(() => document.getElementById('admPassInput').focus(), 150);
      }
    }
  }
  trigger.addEventListener('click',      handleTrigger);
  trigger.addEventListener('touchstart', handleTrigger, { passive: true });

  /* Trigger ke-2 — logo navbar (tap 3x) */
  const trigger2 = document.getElementById('admTrigger2');
  if (trigger2) {
    trigger2.addEventListener('click',      handleTrigger);
    trigger2.addEventListener('touchstart', handleTrigger, { passive: true });
  }

  /* Login */
  const passInput = document.getElementById('admPassInput');
  passInput.addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('admLoginBtn').click(); });
  const loginBtn = document.getElementById('admLoginBtn');
  document.getElementById('admLoginBtn').addEventListener('click', async () => {
    loginBtn.disabled = true;
    loginBtn.textContent = 'MEMVERIFIKASI...';
    const errEl = document.getElementById('admErr');
    errEl.style.display = 'none';
    try {
      await checkAdminPassword(passInput.value);
      // Sukses
      sessionStorage.setItem('xii_admin','1');
      document.getElementById('admLoginOverlay').classList.remove('open');
      passInput.value = '';
      openAdminPanel();
    } catch(e) {
      errEl.textContent = '\u274C ' + e.message;
      errEl.style.display = 'block';
      passInput.select();
      // Disable tombol sementara jika terkunci
      if (e.message.includes('TERKUNCI')) {
        loginBtn.disabled = true;
        loginBtn.textContent = 'TERKUNCI...';
        setTimeout(() => {
          loginBtn.disabled = false;
          loginBtn.textContent = 'MASUK \u2192';
          errEl.style.display = 'none';
        }, getAuthLockoutRemaining() || 60000);
      }
    } finally {
      if (!loginBtn.disabled || !e?.message?.includes('TERKUNCI')) {
        loginBtn.disabled = false;
        loginBtn.textContent = 'MASUK \u2192';
      }
    }
  });
  document.getElementById('admLoginClose').addEventListener('click', () => {
    document.getElementById('admLoginOverlay').classList.remove('open');
    passInput.value = '';
    document.getElementById('admErr').style.display = 'none';
  });
  document.getElementById('admLoginOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('admLoginOverlay'))
      document.getElementById('admLoginClose').click();
  });

  /* Logout & tutup panel */
  document.getElementById('admLogoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem('xii_admin');
    document.getElementById('admPanelOverlay').classList.remove('open');
    document.body.style.overflow = '';
    admToast('👋 LOGGED OUT');
  });
  document.getElementById('admPanelClose').addEventListener('click', () => {
    document.getElementById('admPanelOverlay').classList.remove('open');
    document.body.style.overflow = '';
  });

  /* Tabs */
  document.querySelectorAll('.adm-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.adm-tab').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.adm-pane').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('adm-tab-'+btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'galeri')   admLoadGaleri();
      if (btn.dataset.tab === 'kategori') admLoadKategori();
      if (btn.dataset.tab === 'anggota')  admLoadAnggota();
      if (btn.dataset.tab === 'struktur') admLoadStruktur();
    });
  });

  /* Kategori — tambah */
  document.getElementById('admAddKatBtn')?.addEventListener('click', async () => {
    const inp = document.getElementById('admKatInput');
    const raw = inp.value.trim();
    if (!raw) { admToast('⚠️ Nama kategori tidak boleh kosong!'); return; }
    const val = raw.toLowerCase().replace(/\s+/g,'-');
    if (_galeriKategori.includes(val)) { admToast('⚠️ Kategori "' + val.toUpperCase() + '" sudah ada!'); return; }
    const btn = document.getElementById('admAddKatBtn');
    btn.disabled = true;
    btn.textContent = '...';
    try {
      _galeriKategori.push(val);
      await saveKategori();
      inp.value = '';
      admToast('✅ Kategori "' + val.toUpperCase().replace(/-/g,' ') + '" ditambahkan!');
      renderKatList();
      syncFilterButtons();
      syncKatSelect();
    } catch(e) {
      _galeriKategori.pop(); // rollback
      admToast('❌ Gagal simpan: ' + e.message);
    }
    btn.disabled = false;
    btn.textContent = '+ TAMBAH';
  });
  document.getElementById('admKatInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('admAddKatBtn')?.click();
  });

  /* Modal galeri */
  document.getElementById('admAddPhotoBtn').addEventListener('click', () =>
    document.getElementById('admGaleriModal').classList.add('open'));
  document.getElementById('admModalClose').addEventListener('click', admCloseModal);
  document.getElementById('admGaleriModal').addEventListener('click', e => {
    if (e.target === document.getElementById('admGaleriModal')) admCloseModal();
  });

  /* File input & drag-drop */
  document.getElementById('admGaleriFile').addEventListener('change', e => {
    if (e.target.files[0]) admHandleFile(e.target.files[0]);
  });
  const dz = document.getElementById('admDropzone');
  dz.addEventListener('dragover', e=>{e.preventDefault();dz.classList.add('over');});
  dz.addEventListener('dragleave', ()=>dz.classList.remove('over'));
  dz.addEventListener('drop', e=>{
    e.preventDefault(); dz.classList.remove('over');
    if(e.dataTransfer.files[0]) admHandleFile(e.dataTransfer.files[0]);
  });

  document.getElementById('admGaleriSaveBtn').addEventListener('click', admUploadGaleri);
});

function openAdminPanel() {
  document.getElementById('admPanelOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  admLoadGaleri();
  admLoadStruktur();
  admLoadAnggota();
  admLoadUltah();
  admLoadQuotes();
}

/* ══ GALERI ════════════════════════════════════════════════ */
async function admLoadGaleri() {
  const grid    = document.getElementById('admGaleriGrid');
  const countEl = document.getElementById('admGaleriCount');
  grid.innerHTML = '<div class="adm-loading">⏳ MEMUAT DARI CLOUD...</div>';
  const data = await getGaleri();
  if (countEl) countEl.textContent = data.length + ' FOTO';
  if (!data.length) {
    grid.innerHTML = '<div class="adm-loading">BELUM ADA FOTO — KLIK TAMBAH FOTO</div>';
    return;
  }
  grid.innerHTML = '';
  data.forEach((r) => {
    const div = document.createElement('div'); div.className = 'adm-photo-card';
    div.innerHTML = `<img src="${clOptimize(r.url, 'profile')}" alt="${r.judul}" loading="lazy"/>
      <div class="adm-photo-ov">
        <div class="adm-photo-title">${r.judul}</div>
        <div class="adm-photo-kat">${r.kategori.toUpperCase()}</div>
        <button class="adm-del-btn">🗑 HAPUS</button>
      </div>`;
    div.querySelector('.adm-del-btn').addEventListener('click', async () => {
      if (!confirm('Hapus foto "' + r.judul + '"?')) return;
      try {
        await fsDel('galeri', r._id);
        admToast('🗑 FOTO DIHAPUS');
        document.querySelector(`[data-fsid="${r._id}"]`)?.remove();
        admLoadGaleri();
      } catch(err) { admToast('❌ GAGAL: ' + err.message); }
    });
    grid.appendChild(div);
  });
}

let admSelFile = null;
function admHandleFile(file) {
  admSelFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    const p = document.getElementById('admDzPreview');
    p.src = ev.target.result; p.style.display='block';
  };
  reader.readAsDataURL(file);
  document.getElementById('admGaleriSaveBtn').disabled = false;
}

function admCloseModal() {
  document.getElementById('admGaleriModal').classList.remove('open');
  document.getElementById('admGaleriFile').value = '';
  document.getElementById('admDzPreview').style.display = 'none';
  document.getElementById('admGaleriSaveBtn').disabled = true;
  document.getElementById('admGaleriJudul').value = '';
  admSelFile = null;
}

async function admUploadGaleri() {
  if (!admSelFile) return;
  const btn      = document.getElementById('admGaleriSaveBtn');
  const judul    = document.getElementById('admGaleriJudul').value.trim() || 'Foto Kelas';
  const kategori = document.getElementById('admGaleriKat').value;
  btn.disabled = true; btn.textContent = '⏳ MENGUPLOAD...';
  try {
    const { url, public_id } = await clUpload(admSelFile, 'galeri');
    // Simpan ke Firestore (bukan localStorage)
    const docRef = await fsAdd('galeri', { judul, kategori, url, public_id, ts: Date.now() });
    admToast('✅ FOTO BERHASIL DIUPLOAD!');
    admCloseModal(); admLoadGaleri();
    // Inject langsung ke grid website (tanpa perlu refresh)
    const grid = document.getElementById('photoGrid');
    if (grid) {
      const div = document.createElement('div');
      div.className = 'photo-item';
      div.dataset.cat   = kategori;
      div.dataset.title = judul;
      div.dataset.tag   = kategori.toUpperCase();
      div.dataset.fsid  = docRef.id;
      div.style.background = '#0d0d10';
      div.innerHTML = `<div class="photo-inner" style="width:100%;height:100%;overflow:hidden;">
        <img src="${clOptimize(url, 'gallery')}" alt="${judul}" style="width:100%;height:100%;object-fit:cover;" loading="lazy"/>
        </div><div class="photo-label"><div class="photo-label-text">${judul}</div>
        <div class="photo-label-tag">${kategori.toUpperCase()}</div></div>`;
      grid.prepend(div);
      initGallery(); initLightbox();
    }
  } catch(err) { admToast('❌ GAGAL: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'UPLOAD & SIMPAN'; }
}

/* ══ STRUKTUR ══════════════════════════════════════════════ */
async function admLoadStruktur() {
  const grid = document.getElementById('admStrukturGrid');
  grid.innerHTML = '<div class="adm-loading">⏳ MEMUAT...</div>';
  let s = {};
  try { const d = await fetch('data.json').then(r => r.json()); s = d.struktur || {}; }
  catch(_) { grid.innerHTML = '<div class="adm-loading">⚠️ GAGAL LOAD data.json</div>'; return; }
  const fotoMap = await getFotoMap();
  const semua = [
    { id: 'wali', nama: s.waliKelas?.nama || 'Wali Kelas', peran: 'Wali Kelas' },
    ...(s.ketuaWakil || []).map(p => ({ id: p.id, nama: p.nama, peran: p.peran })),
    ...(s.pengurus   || []).map(p => ({ id: p.id, nama: p.nama, peran: p.peran })),
  ];
  grid.innerHTML = '';
  semua.forEach(p => {
    const fid = 'struktur_' + p.id;
    const fotoUrl = fotoMap[fid];
    const card = document.createElement('div'); card.className = 'adm-person-card';
    card.innerHTML = `${fotoUrl ? '<div class="adm-check">✅</div>' : ''}
      <div class="adm-person-ava" id="admava-${fid}">
        ${fotoUrl ? `<img src="${clOptimize(fotoUrl)}" alt="${p.nama}"/>` : (p.id === 'wali' ? '👩‍🏫' : '👤')}
      </div>
      <div class="adm-person-role">${p.peran}</div>
      <div class="adm-person-name">${p.nama}</div>
      <input type="file" class="adm-file-input" id="admfile-${fid}" accept="image/*"/>
      <button class="adm-upload-btn" onclick="document.getElementById('admfile-${fid}').click()">📷 UPLOAD FOTO</button>`;
    card.querySelector('#admfile-' + fid).addEventListener('change', e => admUploadProfil(e, fid, p.nama));
    grid.appendChild(card);
  });
}

/* ══ ANGGOTA ═══════════════════════════════════════════════ */
async function admLoadAnggota() {
  const grid = document.getElementById('admAnggotaGrid');
  grid.innerHTML = '<div class="adm-loading">⏳ MEMUAT...</div>';
  let anggota = [];
  try { const d = await fetch('data.json').then(r => r.json()); anggota = d.anggota || []; }
  catch(_) { grid.innerHTML = '<div class="adm-loading">⚠️ GAGAL LOAD data.json</div>'; return; }
  const fotoMap = await getFotoMap();
  grid.innerHTML = '';
  anggota.forEach((m, i) => {
    const num     = String(i + 1).padStart(2, '0');
    const fid     = 'anggota_' + num;
    const fotoUrl = fotoMap[fid];
    const card    = document.createElement('div'); card.className = 'adm-person-card';
    card.innerHTML = `${fotoUrl ? '<div class="adm-check">✅</div>' : ''}
      <div class="adm-person-ava" id="admava-${fid}">
        ${fotoUrl ? `<img src="${clOptimize(fotoUrl)}" alt="${m.nama}"/>` : (m.emoji || '👤')}
      </div>
      <div class="adm-person-role">ABSEN ${num}</div>
      <div class="adm-person-name">${m.nama}</div>
      <input type="file" class="adm-file-input" id="admfile-${fid}" accept="image/*"/>
      <button class="adm-upload-btn" onclick="document.getElementById('admfile-${fid}').click()">📷 UPLOAD FOTO</button>`;
    card.querySelector('#admfile-' + fid).addEventListener('change', e => admUploadProfil(e, fid, m.nama));
    grid.appendChild(card);
  });
}

/* ── Upload profil → Cloudinary + Firestore ────────────── */
async function admUploadProfil(e, fid, nama) {
  const file = e.target.files[0]; if (!file) return;
  const ava  = document.getElementById('admava-' + fid);
  ava.classList.add('uploading'); ava.innerHTML = '⏳';
  admToast('⏳ MENGUPLOAD...');
  try {
    const folder    = fid.startsWith('struktur') ? 'struktur' : 'anggota';
    const { url }   = await clUpload(file, folder);
    // Simpan ke Firestore (merge ke doc 'map' di koleksi 'foto_profil')
    const map       = await getFotoMap();
    map[fid]        = url;
    await saveFotoMap(map);
    ava.innerHTML   = `<img src="${clOptimize(url)}" alt="${nama}"/>`;
    ava.classList.remove('uploading');
    const card = ava.closest('.adm-person-card');
    if (card && !card.querySelector('.adm-check')) {
      const b = document.createElement('div'); b.className = 'adm-check'; b.textContent = '✅';
      card.insertBefore(b, card.firstChild);
    }
    // Refresh avatar di org-chart (struktur)
    const nodeId  = fid.replace('struktur_', '');
    const orgNode = document.getElementById('orgNode-' + nodeId);
    if (orgNode) {
      const avaEl = orgNode.querySelector('.org-avatar');
      if (avaEl) avaEl.innerHTML =
        `<img src="${clOptimize(url)}" alt="${nama}" style="width:100%;height:100%;object-fit:cover;"/>`;
    }
    // Refresh avatar di member cards (anggota)
    if (fid.startsWith('anggota_')) {
      const num     = fid.replace('anggota_', '');
      const emojiEl = document.getElementById('mcemoji-' + num);
      if (emojiEl) {
        emojiEl.innerHTML     = `<img src="${clOptimize(url)}" alt="${nama}" class="mc-front-bg"/>`;
        emojiEl.className     = '';
        emojiEl.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
      }
      const backBg = document.getElementById('mcbackbg-' + num);
      if (backBg) {
        backBg.innerHTML = `<img src="${clOptimize(url)}" alt="${nama}" class="mc-back-bg"/>`;
        backBg.className = '';
        backBg.style.cssText = 'position:absolute;inset:0;';
      }
    }
    admToast('✅ FOTO ' + nama.split(' ')[0].toUpperCase() + ' BERHASIL!');
  } catch(err) {
    ava.classList.remove('uploading'); ava.innerHTML = '❌';
    admToast('❌ GAGAL: ' + err.message);
  }
}
