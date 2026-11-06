/**
 * ============================================================
 *  มหกรรมวิชาการ โรงพยาบาลสวี — Backend (Google Apps Script)
 *  เวอร์ชัน 2  ·  ใช้กับ academic/index.html และ academic/admin.html
 * ============================================================
 *  วิธีติดตั้ง (ทำครั้งเดียว)
 *  1) เปิดโปรเจ็กต์ Apps Script เดิม → ลบโค้ดเก่าในไฟล์ Code.gs → วางไฟล์นี้ทั้งหมด → บันทึก
 *  2) เลือกฟังก์ชัน setup ด้านบน → กด Run → อนุญาตสิทธิ์ (Drive / Sheets / Gmail / Docs)
 *  3) Project Settings → Script Properties → ต้องมี ADMIN_PASSWORD (รหัสผ่านหน้า Admin)
 *  4) Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy
 *     (Execute as: Me · Who has access: Anyone)  URL /exec จะเหมือนเดิม
 *
 *  - ไม่ต้องเปิด Advanced Drive Service แล้ว (ระบบเรียก Drive REST API เอง)
 *  - ใช้ Google Sheet เดิมได้เลย ระบบจะเพิ่มชีต/คอลัมน์ใหม่ให้อัตโนมัติ ข้อมูลเดิมไม่หาย
 * ============================================================
 */

const VERSION = '2.0.0';
const DEFAULT_SHEET_ID = '1jT8jw6KF0LWuoyRtaPAnRSjaB8QU3u9gpDLRsNdsE0w';
const TZ = 'Asia/Bangkok';
const CATS = ['ระดับทีม/หน่วยงาน', 'CQI', 'Photo voice', 'วิจัยและ R2R', 'นวัตกรรม'];
const UNCAT = 'ยังไม่จัดประเภท';
const CAT_CODE = { 'ระดับทีม/หน่วยงาน': 'TEAM', 'CQI': 'CQI', 'Photo voice': 'PV', 'วิจัยและ R2R': 'R2R', 'นวัตกรรม': 'INNO' };
const ACCESS = ['filename_only', 'metadata', 'verified', 'public'];
const SUB_STATUS = ['submitted', 'reviewing', 'revise', 'accepted', 'rejected', 'withdrawn'];
const SUB_STATUS_TH = { submitted: 'ส่งแล้ว รอตรวจ', reviewing: 'กำลังพิจารณา', revise: 'ขอให้แก้ไข', accepted: 'ผ่านการคัดเลือก', rejected: 'ไม่ผ่านการคัดเลือก', withdrawn: 'ถอนผลงาน' };
const OCR_MAX_MB = 20;
const TEXT_MAX = 45000;
const RUN_BUDGET_MS = 270000; // 4.5 นาที (Apps Script จำกัด 6 นาที)
const GDOC = 'application/vnd.google-apps.document';
const GSLIDE = 'application/vnd.google-apps.presentation';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const SUPPORTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', GDOC, GSLIDE, DOCX, PPTX];
const UPLOAD_MIME = ['application/pdf', 'image/jpeg', 'image/png', DOCX, PPTX];

const SCHEMA = {
  Settings: ['key', 'value'],
  Sources: ['sourceId', 'folderUrl', 'folderId', 'folderName', 'year', 'category', 'enabled', 'lastSync', 'note'],
  Works: ['id', 'sourceId', 'year', 'category', 'title', 'authors', 'department', 'keywords', 'summary', 'access', 'published', 'featured',
    'showThumb', 'locked', 'fileId', 'fileName', 'fileUrl', 'mimeType', 'sizeMB', 'modified', 'ocrStatus', 'ocrNote', 'thumbId', 'viewId',
    'createdAt', 'updatedAt', 'code', 'award', 'awardRank', 'score', 'submissionId', 'abstract', 'reviewed', 'reviewedAt', 'dupOf'],
  Texts: ['id', 'chars', 'updatedAt', 'text'],
  Visitors: ['email', 'name', 'org', 'firstSeen', 'lastSeen', 'logins'],
  Sessions: ['token', 'email', 'expires', 'createdAt'],
  Events: ['time', 'date', 'workId', 'year', 'category', 'event', 'visitor'],
  Calls: ['callId', 'year', 'title', 'opens', 'closes', 'categories', 'maxMB', 'guideUrl', 'eventDate', 'venue', 'resultsPublic', 'enabled', 'note', 'updatedAt', 'folderUrl'],
  Submissions: ['subId', 'code', 'callId', 'year', 'category', 'title', 'authors', 'department', 'email', 'phone', 'keywords', 'background',
    'objective', 'method', 'result', 'conclusion', 'extraUrl', 'fileId', 'fileName', 'fileUrl', 'mimeType', 'sizeMB', 'status', 'reviewNote',
    'score', 'workId', 'createdAt', 'updatedAt', 'log'],
  Departments: ['name', 'group', 'shortName', 'active', 'order']
};

const DEFAULT_SETTINGS = {
  hospitalName: 'โรงพยาบาลสวี', hospitalNameEn: 'Sawee Hospital', province: 'ชุมพร',
  eventTitle: 'มหกรรมวิชาการ', eventSubtitle: 'องค์ความรู้สู่คุณภาพการดูแล',
  intro: 'คลังผลงานวิชาการ การพัฒนาคุณภาพ งานวิจัย และนวัตกรรมของบุคลากรโรงพยาบาลสวี สืบค้นและอ้างอิงได้',
  logoUrl: 'https://sawee-hosp.github.io/sawee-hosp/hosp_logo.png', defaultYear: '', requireVerify: 'TRUE', allowDownload: 'FALSE',
  useAI: 'FALSE', contactEmail: '', notifyEmail: '', siteUrl: 'https://sawee-hosp.github.io/sawee-hosp/academic/', citePrefix: 'SWH'
};
const PUBLIC_SETTING_KEYS = ['hospitalName', 'hospitalNameEn', 'province', 'eventTitle', 'eventSubtitle', 'intro', 'logoUrl', 'defaultYear',
  'requireVerify', 'allowDownload', 'contactEmail', 'siteUrl', 'citePrefix'];

/* ============================================================
 *  ENTRY POINTS
 * ============================================================ */
function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'รูปแบบคำขอไม่ถูกต้อง' }); }
  return json_(api(req));
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.page === 'admin') {
    try {
      return HtmlService.createHtmlOutputFromFile('admin').setTitle('Admin · คลังผลงานวิชาการ')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch (err) { /* ไม่มีไฟล์ admin.html ในโปรเจ็กต์ ให้ใช้หน้าบน GitHub */ }
  }
  if (p.action) {
    const r = PUBLIC[p.action] ? api(p) : { ok: false, error: 'คำสั่งนี้ต้องใช้ POST' };
    if (p.callback && /^[\w.$]+$/.test(p.callback)) {
      return ContentService.createTextOutput(p.callback + '(' + JSON.stringify(r) + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return json_(r);
  }
  return json_({ ok: true, data: { service: 'Sawee Academic API', version: VERSION, time: new Date().toISOString() } });
}

/** ใช้ได้ทั้งจาก doPost และ google.script.run.api(req) */
function api(req) {
  req = req || {};
  const action = String(req.action || '');
  try {
    if (action === 'adminLogin') return { ok: true, data: adminLogin_(req) };
    if (PUBLIC[action]) return { ok: true, data: PUBLIC[action](req) };
    if (ADMIN[action]) { requireAdmin_(req.token); return { ok: true, data: ADMIN[action](req) }; }
    return { ok: false, error: 'ไม่รู้จักคำสั่ง: ' + action };
  } catch (err) {
    const m = String((err && err.message) || err);
    if (m.indexOf('SESSION_EXPIRED') < 0) console.error(action + ': ' + m + (err && err.stack ? '\n' + err.stack : ''));
    return { ok: false, error: m };
  }
}

const PUBLIC = {
  catalog: function () { return catalog_(); },
  work: function (r) { return workDetail_(r); },
  open: function (r) { logOpen_(r); return true; },
  search: function (r) { return deepSearch_(r); },
  requestOtp: function (r) { return requestOtp_(r); },
  verifyOtp: function (r) { return verifyOtp_(r); },
  session: function (r) { const e = sessionEmail_(r.session); return { valid: !!e, email: e || '' }; },
  logout: function (r) { logout_(r.session); return true; },
  mySubmissions: function (r) { return mySubmissions_(r); },
  submit: function (r) { return submit_(r); },
  withdraw: function (r) { return withdraw_(r); },
  ping: function () { return { version: VERSION, time: new Date().toISOString() }; }
};

const ADMIN = {
  dashboard: function (r) { return dashboard_(r); },
  diagnose: function () { return diagnose_(); },
  sources: function () { return listSources_(); },
  previewFolder: function (r) { return previewFolder_(r.url); },
  addSource: function (r) { return addSource_(r.source || {}); },
  updateSource: function (r) { return updateSource_(r); },
  deleteSource: function (r) { return deleteSource_(r.sourceId); },
  syncNow: function () { return runJob_(true); },
  processNow: function () { return runJob_(false).ocr; },
  requeueErrors: function () { return requeueErrors_(); },
  setAutoSync: function (r) { return setAutoSync_(!!r.on); },
  listWorks: function () { return listWorksAdmin_(); },
  bulk: function (r) { return bulk_(r); },
  saveWork: function (r) { return saveWork_(r.work || {}); },
  setAwards: function (r) { return setAwards_(r.items || []); },
  suggestMeta: function (r) { return suggestMeta_(r.id, !!r.ai); },
  mergeDup: function (r) { return mergeDup_(r.id, r.into, !!r.undo); },
  auditSources: function () { return auditSources_(); },
  getText: function (r) { return getText_(r.id); },
  saveText: function (r) { saveText_(r.id, r.text); clearCatalog_(); return true; },
  rerunOcr: function (r) { return { result: rerunOcr_(r.id) }; },
  hideWork: function (r) { return hideWork_(r.id, !!r.hide); },
  assignCodes: function () { return assignCodes_(); },
  listVisitors: function () { return table_('Visitors').rows.map(clean_); },
  getSettings: function () { return getSettingsAdmin_(); },
  saveSettings: function (r) { return saveSettings_(r.settings || {}); },
  setAiKey: function (r) { return setAiKey_(r.key, r.model); },
  listCalls: function () { return listCalls_(); },
  saveCall: function (r) { return saveCall_(r.call || {}); },
  deleteCall: function (r) { return deleteCall_(r.callId); },
  listSubmissions: function () { return listSubsAdmin_(); },
  saveSubmission: function (r) { return saveSubAdmin_(r); },
  importSubmission: function (r) { return importSub_(r.subId); },
  listDepts: function () { return deptRows_(); },
  saveDepts: function (r) { return saveDepts_(r.depts || []); },
  participation: function () { return participation_(true); }
};

/** รันครั้งแรกจากหน้า Editor เพื่ออนุญาตสิทธิ์ สร้างชีต/โฟลเดอร์ และตรวจระบบ */
/** ล้างการล็อกหลังใส่รหัสผิดหลายครั้ง — Run ฟังก์ชันนี้จาก Editor ได้เลย */
function unlockAdmin() { cache_().remove('admfail'); console.log('ปลดล็อกแล้ว · ADMIN_PASSWORD ยาว ' + str_(prop_('ADMIN_PASSWORD')).length + ' ตัวอักษร'); }

function setup() {
  Object.keys(SCHEMA).forEach(sheet_);
  ['root', 'view', 'thumbs', 'temp', 'submissions'].forEach(folderId_);
  if (!prop_('ADMIN_PASSWORD')) console.warn('ยังไม่ได้ตั้ง ADMIN_PASSWORD ใน Script Properties');
  seedCall2570_();
  const d = diagnose_();
  d.checks.forEach(function (c) { console.log((c.ok ? '✅ ' : '⚠️ ') + c.name + ' — ' + c.detail); });
  return d;
}

/** สร้างรอบรับผลงานปีงบประมาณ 2570 ตามโปสเตอร์ประชาสัมพันธ์ (ถ้ายังไม่มีรอบของปี 2570) */
function seedCall2570_() {
  if (callsRows_().some(function (c) { return c.year === '2570'; })) return;
  saveCall_({
    year: '2570', title: 'มหกรรมวิชาการเครือข่ายโรงพยาบาลสวี ประจำปีงบประมาณ 2570',
    opens: today_(), closes: '2026-12-18', eventDate: '2026-12-24', venue: 'โรงพยาบาลสวี', maxMB: 30, categories: CATS,
    guideUrl: 'https://drive.google.com/drive/folders/1DMINZ2mm-CWRwnHShrd4QnBWB5w9H3LK',
    folderUrl: 'https://drive.google.com/drive/folders/1DMINZ2mm-CWRwnHShrd4QnBWB5w9H3LK',
    note: 'พิเศษ! เชิญชวนนำเสนอผลงานเด่นด้าน Healthcare Logistic ของเครือข่ายโรงพยาบาลสวี ในรอบ 5 ทศวรรษ\n' +
      'กิจกรรมในงาน: Oral Presentation · E-Poster Presentation · แลกเปลี่ยนเรียนรู้/ถอดบทเรียน · นิทรรศการผลงานเด่น นวัตกรรม และ CQI · ประกาศเกียรติคุณและมอบรางวัล\n' +
      'สอบถาม: คณะกรรมการพัฒนาคุณภาพ โรงพยาบาลสวี โทร 077 531 206 ต่อ 106',
    resultsPublic: false, enabled: true
  });
  console.log('สร้างรอบรับผลงานปี 2570 แล้ว (ปิดรับ 18 ธ.ค. 2569 · นำเสนอ 24 ธ.ค. 2569)');
}

/** ตัวตั้งเวลาซิงก์อัตโนมัติ (ทุก 1 ชั่วโมง) */
function autoSync() { runJob_(true); }

/* ============================================================
 *  UTILITIES
 * ============================================================ */
let SS_ = null;
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function setProp_(k, v) { const p = PropertiesService.getScriptProperties(); if (v === null || v === '') p.deleteProperty(k); else p.setProperty(k, String(v)); }
function cache_() { return CacheService.getScriptCache(); }
function uuid_() { return Utilities.getUuid(); }
function nowIso_() { return new Date().toISOString(); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function bool_(v) { return v === true || String(v).trim().toUpperCase() === 'TRUE'; }
function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function isYear_(y) { return /^\d{4}$/.test(str_(y)); }
function clip_(s, n) { s = str_(s); return s.length > n ? s.slice(0, n) : s; }
function norm_(s) { return String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' '); }
function dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = str_(v); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : s;
}
function iso_(v) { if (v instanceof Date) return v.toISOString(); return str_(v); }
function clean_(o) {
  const r = {};
  Object.keys(o).forEach(function (k) { const v = o[k]; r[k] = v instanceof Date ? v.toISOString() : v; });
  return r;
}
function cleanTitle_(n) {
  return String(n || '').replace(/\.(pdf|jpe?g|png|gif|webp|docx?|pptx?)$/i, '').replace(/\s*-\s*Google\s*(เอกสาร|Docs|สไลด์|Slides)\s*/i, ' ')
    .replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function pad_(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
function safeCell_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v;
  v = String(v);
  if (/^[=+\-@]/.test(v) || /^0\d+$/.test(v)) return "'" + v; // กันสูตร/เลข 0 นำหน้าหาย
  return v;
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('ระบบกำลังบันทึกข้อมูลอื่นอยู่ กรุณาลองใหม่อีกครั้ง');
  try { return fn(); } finally { lock.releaseLock(); }
}
function guessCat_(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return '';
  if (/photo\s*-?\s*voice|โฟโต้|photovoice/.test(n)) return 'Photo voice';
  if (/วิจัย|r2r|research/.test(n)) return 'วิจัยและ R2R';
  if (/นวัตกรรม|innovat/.test(n)) return 'นวัตกรรม';
  if (/cqi|พัฒนาคุณภาพ/.test(n)) return 'CQI';
  if (/ทีม|หน่วยงาน|team|unit/.test(n)) return 'ระดับทีม/หน่วยงาน';
  return '';
}
function kind_(mime) { mime = String(mime || ''); if (mime.indexOf('image/') === 0) return 'image'; if (mime === 'application/pdf') return 'pdf'; return 'doc'; }

/* ---------- Sheet tables ---------- */
function ss_() {
  if (SS_) return SS_;
  let s = null;
  try { s = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { s = null; }
  if (!s) s = SpreadsheetApp.openById(str_(prop_('SPREADSHEET_ID') || prop_('SHEET_ID')) || DEFAULT_SHEET_ID);
  SS_ = s;
  return s;
}
function sheet_(name) {
  const s = ss_(), want = SCHEMA[name];
  let sh = s.getSheetByName(name);
  if (!sh) {
    sh = s.insertSheet(name);
    sh.getRange(1, 1, 1, want.length).setValues([want]);
    sh.setFrozenRows(1);
    if (name === 'Settings') {
      const rows = Object.keys(DEFAULT_SETTINGS).map(function (k) { return [k, DEFAULT_SETTINGS[k]]; });
      sh.getRange(2, 1, rows.length, 2).setValues(rows);
    }
    return sh;
  }
  const lc = Math.max(1, sh.getLastColumn());
  const head = sh.getRange(1, 1, 1, lc).getValues()[0].map(String);
  const miss = want.filter(function (h) { return head.indexOf(h) < 0; });
  if (miss.length) sh.getRange(1, (head.join('') ? lc : 0) + 1, 1, miss.length).setValues([miss]);
  return sh;
}
function table_(name) {
  const sh = sheet_(name);
  const v = sh.getDataRange().getValues();
  const head = (v[0] || []).map(String);
  const rows = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i];
    if (!r.some(function (c) { return c !== '' && c !== null; })) continue;
    const o = {};
    head.forEach(function (h, j) { if (h) o[h] = r[j]; });
    rows.push(o);
  }
  return {
    sh: sh, head: head, rows: rows,
    save: function () {
      const data = this.rows.map(function (o) { return head.map(function (h) { return safeCell_(o[h]); }); });
      const last = sh.getLastRow();
      if (last > 1) sh.getRange(2, 1, last - 1, head.length).clearContent();
      if (data.length) sh.getRange(2, 1, data.length, head.length).setValues(data);
    }
  };
}
function appendRow_(name, obj) {
  const sh = sheet_(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(head.map(function (h) { return safeCell_(obj[h]); }));
}
function mutate_(name, fn) { return withLock_(function () { const t = table_(name); const r = fn(t.rows, t); t.save(); return r; }); }

/* ---------- Cache (แบ่งก้อนเพราะ Cache จำกัด 100KB/คีย์) ---------- */
function putBig_(key, str, ttl) {
  const c = cache_(), size = 90000, n = Math.ceil(str.length / size), o = {};
  if (n > 20) return;
  for (let i = 0; i < n; i++) o[key + ':' + i] = str.slice(i * size, (i + 1) * size);
  o[key + ':n'] = String(n);
  c.putAll(o, ttl);
}
function getBig_(key) {
  const c = cache_(), n = Number(c.get(key + ':n') || 0);
  if (!n) return null;
  const keys = []; for (let i = 0; i < n; i++) keys.push(key + ':' + i);
  const got = c.getAll(keys); let s = '';
  for (let i = 0; i < n; i++) { if (got[keys[i]] == null) return null; s += got[keys[i]]; }
  return s;
}
function clearCatalog_() { cache_().removeAll(['catalog:n', 'evstats']); }

/* ---------- Settings ---------- */
function settings_() {
  const s = Object.assign({}, DEFAULT_SETTINGS);
  table_('Settings').rows.forEach(function (r) { const k = str_(r.key); if (k) s[k] = r.value instanceof Date ? dateStr_(r.value) : str_(r.value); });
  return s;
}
function publicSettings_(s) { const o = {}; PUBLIC_SETTING_KEYS.forEach(function (k) { o[k] = s[k] || ''; }); return o; }

/* ---------- Drive folders (ของบัญชีที่รันสคริปต์) ---------- */
function folderId_(key) {
  const pk = 'FOLDER_' + key.toUpperCase();
  let id = prop_(pk);
  if (id) { try { DriveApp.getFolderById(id).getName(); return id; } catch (e) { id = null; } }
  const names = { root: 'ระบบคลังผลงานวิชาการ (อย่าลบ)', view: 'ไฟล์สำหรับเปิดดู (สาธารณะ)', thumbs: 'ภาพปก (สาธารณะ)', temp: 'OCR ชั่วคราว', submissions: 'ผลงานที่ส่งเข้าประกวด' };
  const parent = key === 'root' ? DriveApp.getRootFolder() : DriveApp.getFolderById(folderId_('root'));
  const it = parent.getFoldersByName(names[key]);
  const f = it.hasNext() ? it.next() : parent.createFolder(names[key]);
  setProp_(pk, f.getId());
  return f.getId();
}
function subFolder_(parentId, name) {
  const p = DriveApp.getFolderById(parentId), it = p.getFoldersByName(name);
  return it.hasNext() ? it.next() : p.createFolder(name);
}
function trash_(id) { if (!id) return; try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { } }

/** เรียก Drive REST API v3 ด้วยสิทธิ์ของสคริปต์ (ไม่ต้องเปิด Advanced Service) */
function driveApi_(method, path, payload, query) {
  const url = 'https://www.googleapis.com/drive/v3/' + path + (query ? '?' + query : '');
  const opt = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (payload) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(payload); }
  const r = UrlFetchApp.fetch(url, opt), code = r.getResponseCode(), t = r.getContentText();
  if (code >= 300) {
    let m = t; try { m = JSON.parse(t).error.message; } catch (e) { }
    throw new Error('Drive API ' + code + ': ' + clip_(m, 200));
  }
  return t ? JSON.parse(t) : {};
}
function thumbBlob_(fileId, px) {
  try {
    const meta = driveApi_('get', 'files/' + fileId, null, 'fields=thumbnailLink,hasThumbnail&supportsAllDrives=true');
    if (meta.thumbnailLink) {
      const link = meta.thumbnailLink.replace(/=s\d+[^=]*$/, '') + '=s' + px;
      const r = UrlFetchApp.fetch(link, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
      if (r.getResponseCode() < 300) return r.getBlob().setContentType('image/png');
    }
  } catch (e) { console.warn('thumbBlob ' + fileId + ': ' + e.message); }
  try { const b = DriveApp.getFileById(fileId).getThumbnail(); if (b) return b; } catch (e) { }
  return null;
}

/* ============================================================
 *  PUBLIC: CATALOG
 * ============================================================ */
function catalog_() {
  const c = getBig_('catalog');
  if (c) return JSON.parse(c);
  const out = buildCatalog_();
  try { putBig_('catalog', JSON.stringify(out), 300); } catch (e) { }
  return out;
}
function textChars_() {
  const m = {};
  table_('Texts').rows.forEach(function (r) { m[str_(r.id)] = num_(r.chars) || str_(r.text).length; });
  return m;
}
function callsRows_() {
  return table_('Calls').rows.map(function (c) {
    return {
      callId: str_(c.callId), year: str_(c.year), title: str_(c.title), opens: dateStr_(c.opens), closes: dateStr_(c.closes),
      categories: str_(c.categories) ? str_(c.categories).split(/\s*[,|]\s*/).filter(String) : CATS.slice(),
      maxMB: num_(c.maxMB) || 20, guideUrl: str_(c.guideUrl), eventDate: dateStr_(c.eventDate), venue: str_(c.venue),
      resultsPublic: bool_(c.resultsPublic), enabled: c.enabled === '' || c.enabled === undefined ? true : bool_(c.enabled), note: str_(c.note),
      updatedAt: iso_(c.updatedAt), folderUrl: str_(c.folderUrl)
    };
  });
}
/** เปิดรับตั้งแต่ 00:00 น. ของวันเปิด ถึง 23:59 น. ของวันปิด (เวลาประเทศไทย) */
function bkkTime_(d, hms) { const m = str_(d).match(/^\d{4}-\d{2}-\d{2}/); return m ? Date.parse(m[0] + 'T' + hms + '+07:00') : NaN; }
function callStatus_(c) {
  const now = Date.now();
  if (!c.enabled) return 'disabled';
  if (c.opens && now < bkkTime_(c.opens, '00:00:00')) return 'upcoming';
  if (c.closes && now > bkkTime_(c.closes, '23:59:59')) return 'closed';
  return 'open';
}
function resultsVisibleFn_(calls) {
  const by = {};
  calls.forEach(function (c) { if (!by[c.year]) by[c.year] = []; by[c.year].push(c); });
  return function (y) { const l = by[String(y)]; return !l || l.some(function (c) { return c.resultsPublic; }); };
}
function isListed_(w) { return bool_(w.published) && ['ignored', 'missing'].indexOf(str_(w.ocrStatus)) < 0; }
function buildCatalog_() {
  const st = settings_(), works = table_('Works').rows, calls = callsRows_(), stats = eventStats_(), chars = textChars_();
  const visible = resultsVisibleFn_(calls);
  const list = works.filter(isListed_).map(function (w) { return pubWork_(w, stats, chars, visible); });
  return {
    settings: publicSettings_(st),
    works: list,
    calls: calls.filter(function (c) { return c.enabled; }).map(function (c) {
      return { callId: c.callId, year: c.year, title: c.title, opens: c.opens, closes: c.closes, categories: c.categories, maxMB: c.maxMB,
        guideUrl: c.guideUrl, eventDate: c.eventDate, venue: c.venue, resultsPublic: c.resultsPublic, status: callStatus_(c), note: c.note };
    }),
    departments: deptRows_().filter(function (d) { return bool_(d.active) || d.active === ''; }).map(function (d) { return { name: d.name, group: d.group }; }),
    participation: participation_(false, works, calls),
    cats: CATS,
    generatedAt: nowIso_(),
    version: VERSION
  };
}
function pubWork_(w, stats, chars, visible) {
  const id = str_(w.id), acc = ACCESS.indexOf(str_(w.access)) >= 0 ? str_(w.access) : 'verified', fo = acc === 'filename_only';
  const o = {
    id: id, code: str_(w.code), year: str_(w.year), category: str_(w.category) || UNCAT,
    title: fo ? cleanTitle_(w.fileName) : (str_(w.title) || cleanTitle_(w.fileName)),
    access: acc, featured: bool_(w.featured), views: stats.views[id] || 0, kind: kind_(w.mimeType), updatedAt: iso_(w.updatedAt)
  };
  if (!fo) {
    o.authors = str_(w.authors); o.department = str_(w.department); o.keywords = str_(w.keywords); o.summary = str_(w.summary);
    o.thumb = bool_(w.showThumb) && str_(w.thumbId) ? str_(w.thumbId) : '';
    o.hasText = acc !== 'metadata' && (chars[id] || 0) > 0;
  }
  if (str_(w.award) && visible(w.year)) { o.award = str_(w.award); o.awardRank = num_(w.awardRank) || 99; }
  return o;
}
function findWork_(rows, idOrCode) {
  const k = str_(idOrCode);
  return rows.filter(function (w) { return str_(w.id) === k || (str_(w.code) && str_(w.code).toLowerCase() === k.toLowerCase()); })[0];
}

/* ---------- รายละเอียดผลงาน ---------- */
function canRead_(w, st, email) {
  const a = str_(w.access);
  if (a === 'public') return true;
  if (a === 'verified') return !bool_(st.requireVerify) || !!email;
  return false;
}
function workDetail_(r) {
  const st = settings_(), works = table_('Works').rows, w = findWork_(works, r.id);
  if (!w || !isListed_(w)) throw new Error('ไม่พบผลงานนี้ หรือผลงานยังไม่เผยแพร่');
  const email = sessionEmail_(r.session), stats = eventStats_(), chars = textChars_();
  const o = pubWork_(w, stats, chars, resultsVisibleFn_(callsRows_()));
  const ok = canRead_(w, st, email);
  o.canRead = ok;
  o.needVerify = str_(w.access) === 'verified' && !ok;
  if (str_(w.access) !== 'filename_only') o.abstract = str_(w.abstract);
  if (ok) {
    o.text = getText_(w.id);
    if (str_(w.viewId)) {
      const v = str_(w.viewId);
      o.viewerUrl = 'https://drive.google.com/file/d/' + v + '/preview';
      o.openUrl = 'https://drive.google.com/file/d/' + v + '/view';
      if (bool_(st.allowDownload)) o.downloadUrl = 'https://drive.google.com/uc?export=download&id=' + v;
    }
  }
  logEvent_(w, 'view', r.visitor);
  return o;
}
function logOpen_(r) {
  const w = findWork_(table_('Works').rows, r.id);
  if (w && isListed_(w)) logEvent_(w, 'open', r.visitor);
}
function logEvent_(w, ev, visitor) {
  try {
    appendRow_('Events', { time: nowIso_(), date: today_(), workId: str_(w.id), year: str_(w.year), category: str_(w.category), event: ev, visitor: clip_(visitor, 60) });
  } catch (e) { }
}
function eventStats_() {
  const c = cache_().get('evstats');
  if (c) return JSON.parse(c);
  const sh = sheet_('Events'), v = sh.getDataRange().getValues(), h = (v[0] || []).map(String);
  const iW = h.indexOf('workId'), iE = h.indexOf('event'), iV = h.indexOf('visitor'), iD = h.indexOf('date');
  const s = { views: {}, opens: {}, visitors: 0, byMonth: {}, totalViews: 0, totalOpens: 0 }, vis = {};
  for (let i = 1; i < v.length; i++) {
    const id = String(v[i][iW]), ev = String(v[i][iE]);
    if (!id) continue;
    if (ev === 'view') {
      s.views[id] = (s.views[id] || 0) + 1; s.totalViews++;
      const m = dateStr_(v[i][iD]).slice(0, 7); if (m) s.byMonth[m] = (s.byMonth[m] || 0) + 1;
    } else if (ev === 'open') { s.opens[id] = (s.opens[id] || 0) + 1; s.totalOpens++; }
    if (v[i][iV]) vis[v[i][iV]] = 1;
  }
  s.visitors = Object.keys(vis).length;
  try { cache_().put('evstats', JSON.stringify(s), 120); } catch (e) { }
  return s;
}

/* ---------- ค้นในเนื้อหา OCR ---------- */
function deepSearch_(r) {
  const q = norm_(r.q).trim();
  if (q.length < 2) return [];
  const terms = q.split(' ').filter(String);
  const st = settings_(), email = sessionEmail_(r.session);
  const works = {}; table_('Works').rows.forEach(function (w) { if (isListed_(w) && ['public', 'verified'].indexOf(str_(w.access)) >= 0) works[str_(w.id)] = w; });
  const out = [];
  table_('Texts').rows.forEach(function (t) {
    const w = works[str_(t.id)]; if (!w || out.length >= 200) return;
    const raw = String(t.text || ''), n = norm_(raw);
    if (!terms.every(function (x) { return n.indexOf(x) >= 0; })) return;
    let snip = '';
    if (canRead_(w, st, email)) {
      const flat = raw.replace(/\s+/g, ' '), i = norm_(flat).indexOf(terms[0]);
      snip = flat.slice(Math.max(0, i - 60), i + terms[0].length + 80).trim();
    }
    out.push({ id: str_(w.id), snippet: snip });
  });
  return out;
}

/* ============================================================
 *  PUBLIC: ยืนยันอีเมล (OTP) + SESSION
 * ============================================================ */
function validEmail_(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }
function requestOtp_(r) {
  const email = str_(r.email).toLowerCase();
  if (!validEmail_(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  const c = cache_();
  if (c.get('otpw:' + email)) throw new Error('เพิ่งส่งรหัสไปเมื่อสักครู่ กรุณารอ 1 นาทีแล้วลองใหม่');
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('วันนี้ระบบส่งอีเมลครบโควตาแล้ว กรุณาลองใหม่พรุ่งนี้ หรือติดต่อผู้ดูแล');
  const code = pad_(Math.floor(Math.random() * 1000000), 6), st = settings_();
  c.put('otp:' + email, JSON.stringify({ c: code, n: 0, name: clip_(r.name, 80), org: clip_(r.org, 120) }), 600);
  c.put('otpw:' + email, '1', 60);
  MailApp.sendEmail({
    to: email, name: st.hospitalName + ' · คลังผลงานวิชาการ',
    subject: 'รหัสยืนยันอีเมล ' + code + ' · ' + st.eventTitle + ' ' + st.hospitalName,
    htmlBody: mailBox_(st, 'รหัสยืนยันอีเมลของคุณ', '<p style="font-size:34px;letter-spacing:10px;font-weight:700;margin:10px 0;color:#0b2540">' + code + '</p>' +
      '<p>รหัสนี้ใช้ได้ 10 นาที หากคุณไม่ได้ขอรหัสนี้ ไม่ต้องดำเนินการใด ๆ</p>')
  });
  return { sent: true };
}
function verifyOtp_(r) {
  const email = str_(r.email).toLowerCase(), code = str_(r.code), c = cache_(), raw = c.get('otp:' + email);
  if (!raw) throw new Error('รหัสหมดอายุหรือยังไม่ได้ขอรหัส กรุณาขอรหัสใหม่');
  const o = JSON.parse(raw);
  if (o.n >= 5) { c.remove('otp:' + email); throw new Error('ใส่รหัสผิดหลายครั้ง กรุณาขอรหัสใหม่'); }
  if (o.c !== code) { o.n++; c.put('otp:' + email, JSON.stringify(o), 600); throw new Error('รหัสไม่ถูกต้อง (เหลือ ' + (5 - o.n) + ' ครั้ง)'); }
  c.remove('otp:' + email);
  const token = uuid_().replace(/-/g, '') + uuid_().replace(/-/g, '').slice(0, 8);
  const exp = new Date(Date.now() + 30 * 864e5).toISOString();
  withLock_(function () {
    appendRow_('Sessions', { token: token, email: email, expires: exp, createdAt: nowIso_() });
    const t = table_('Visitors'), v = t.rows.filter(function (x) { return str_(x.email).toLowerCase() === email; })[0];
    if (v) { v.lastSeen = nowIso_(); v.logins = num_(v.logins) + 1; if (o.name) v.name = o.name; if (o.org) v.org = o.org; }
    else t.rows.push({ email: email, name: o.name, org: o.org, firstSeen: nowIso_(), lastSeen: nowIso_(), logins: 1 });
    t.save();
  });
  cache_().put('ses:' + token, email, 21600);
  return { token: token, email: email, expires: exp };
}
function sessionEmail_(token) {
  token = str_(token);
  if (!token || token.length < 20) return '';
  const c = cache_().get('ses:' + token);
  if (c) return c === '-' ? '' : c;
  const s = table_('Sessions').rows.filter(function (x) { return str_(x.token) === token; })[0];
  const ok = s && new Date(iso_(s.expires)).getTime() > Date.now();
  cache_().put('ses:' + token, ok ? str_(s.email) : '-', ok ? 21600 : 600);
  return ok ? str_(s.email) : '';
}
function requireSession_(token) {
  const e = sessionEmail_(token);
  if (!e) throw new Error('กรุณายืนยันอีเมลก่อน (เซสชันหมดอายุหรือไม่ถูกต้อง)');
  return e;
}
function logout_(token) {
  token = str_(token); if (!token) return;
  cache_().remove('ses:' + token);
  mutate_('Sessions', function (rows, t) {
    const now = Date.now();
    t.rows = rows.filter(function (x) { return str_(x.token) !== token && new Date(iso_(x.expires)).getTime() > now; });
  });
}
function mailBox_(st, title, inner) {
  return '<div style="font-family:Tahoma,sans-serif;max-width:560px;margin:auto;border:1px solid #dfe8ef;border-radius:16px;overflow:hidden">' +
    '<div style="background:#0b2540;color:#fff;padding:18px 22px"><b>' + esc_(st.hospitalName) + '</b><br><small>' + esc_(st.eventTitle) + ' · คลังผลงานวิชาการ</small></div>' +
    '<div style="padding:22px;color:#0f2a43;line-height:1.7"><h3 style="margin:0 0 8px">' + esc_(title) + '</h3>' + inner + '</div>' +
    '<div style="background:#f3f7fb;padding:12px 22px;font-size:12px;color:#5d7083">อีเมลนี้ส่งโดยระบบอัตโนมัติ' +
    (st.siteUrl ? ' · <a href="' + esc_(st.siteUrl) + '">' + esc_(st.siteUrl) + '</a>' : '') + '</div></div>';
}
function sendMail_(to, subject, title, inner) {
  try {
    if (!to || MailApp.getRemainingDailyQuota() < 1) return false;
    const st = settings_();
    MailApp.sendEmail({ to: to, subject: subject, name: st.hospitalName + ' · คลังผลงานวิชาการ', htmlBody: mailBox_(st, title, inner) });
    return true;
  } catch (e) { console.warn('mail: ' + e.message); return false; }
}

/* ============================================================
 *  PUBLIC: ส่งผลงาน (Submission)
 * ============================================================ */
function subPublic_(s) {
  return {
    subId: str_(s.subId), code: str_(s.code), callId: str_(s.callId), year: str_(s.year), category: str_(s.category), title: str_(s.title),
    authors: str_(s.authors), department: str_(s.department), phone: str_(s.phone), keywords: str_(s.keywords), background: str_(s.background),
    objective: str_(s.objective), method: str_(s.method), result: str_(s.result), conclusion: str_(s.conclusion), extraUrl: str_(s.extraUrl),
    fileName: str_(s.fileName), sizeMB: str_(s.sizeMB), status: str_(s.status), statusText: SUB_STATUS_TH[str_(s.status)] || str_(s.status),
    reviewNote: str_(s.reviewNote), workId: str_(s.workId), createdAt: iso_(s.createdAt), updatedAt: iso_(s.updatedAt)
  };
}
function mySubmissions_(r) {
  const email = requireSession_(r.session);
  return table_('Submissions').rows.filter(function (s) { return str_(s.email).toLowerCase() === email; })
    .map(subPublic_).sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
}
function submit_(r) {
  const email = requireSession_(r.session), d = r.sub || {}, file = r.file || null;
  if (!d.consent) throw new Error('กรุณายืนยันว่าผลงานไม่มีข้อมูลที่ระบุตัวผู้ป่วยได้ และยินยอมให้เผยแพร่');
  const calls = callsRows_(), call = calls.filter(function (c) { return c.callId === str_(d.callId); })[0];
  if (!call) throw new Error('ไม่พบรอบรับผลงานที่เลือก');
  const f = {
    category: str_(d.category), title: clip_(d.title, 400), authors: clip_(d.authors, 600), department: clip_(d.department, 200),
    phone: clip_(d.phone, 30), keywords: clip_(d.keywords, 300), background: clip_(d.background, 4000), objective: clip_(d.objective, 2000),
    method: clip_(d.method, 4000), result: clip_(d.result, 4000), conclusion: clip_(d.conclusion, 3000), extraUrl: clip_(d.extraUrl, 500)
  };
  if (f.extraUrl && !/^https?:\/\//i.test(f.extraUrl)) throw new Error('ลิงก์เพิ่มเติมต้องขึ้นต้นด้วย http:// หรือ https://');
  if (!f.title) throw new Error('กรุณากรอกชื่อผลงาน');
  if (!f.authors) throw new Error('กรุณากรอกชื่อผู้จัดทำ');
  if (!f.department) throw new Error('กรุณาเลือกหน่วยงาน');
  if (call.categories.indexOf(f.category) < 0) throw new Error('ประเภทผลงานไม่อยู่ในรอบนี้');
  if (file && file.data) {
    if (UPLOAD_MIME.indexOf(file.mime) < 0) throw new Error('รองรับเฉพาะไฟล์ PDF, JPG, PNG, DOCX, PPTX');
    const mb = Math.round(file.data.length * 0.75 / 1048576 * 10) / 10;
    if (mb > call.maxMB) throw new Error('ไฟล์ใหญ่เกิน ' + call.maxMB + ' MB');
  }
  const st = callStatus_(call);
  let result, isNew = false;
  withLock_(function () {
    const t = table_('Submissions');
    let s = d.subId ? t.rows.filter(function (x) { return str_(x.subId) === str_(d.subId); })[0] : null;
    if (d.subId && !s) throw new Error('ไม่พบผลงานที่ต้องการแก้ไข');
    if (s) {
      if (str_(s.email).toLowerCase() !== email) throw new Error('คุณไม่มีสิทธิ์แก้ไขผลงานนี้');
      const stt = str_(s.status);
      if (stt === 'revise') { /* แก้ไขได้แม้ปิดรับแล้ว */ }
      else if (stt === 'submitted' && st === 'open') { }
      else throw new Error('ผลงานนี้อยู่ในสถานะ "' + (SUB_STATUS_TH[stt] || stt) + '" แก้ไขไม่ได้แล้ว');
    } else {
      if (st !== 'open') throw new Error(st === 'upcoming' ? 'ยังไม่ถึงเวลาเปิดรับผลงาน' : 'ปิดรับผลงานรอบนี้แล้ว');
      if (!file || !file.data) throw new Error('กรุณาแนบไฟล์ผลงาน');
      const n = t.rows.filter(function (x) { return str_(x.year) === call.year; }).length + 1;
      s = { subId: uuid_(), code: 'S' + call.year + '-' + pad_(n, 4), email: email, createdAt: nowIso_(), status: 'submitted', log: '' };
      while (t.rows.some(function (x) { return str_(x.code) === s.code; })) s.code = 'S' + call.year + '-' + pad_(++n, 4);
      t.rows.push(s); isNew = true;
    }
    Object.assign(s, f, { callId: call.callId, year: call.year, updatedAt: nowIso_() });
    if (!isNew) s.status = 'submitted';
    if (file && file.data) {
      const blob = Utilities.newBlob(Utilities.base64Decode(file.data), file.mime, clip_((s.code + ' - ' + s.department + ' - ' + s.title).replace(/[\\/:*?"<>|\n\r]+/g, ' '), 150) + extOf_(file.name, file.mime));
      const dir = uploadDir_(call, s.category);
      const nf = dir.createFile(blob);
      if (s.fileId) trash_(s.fileId);
      s.fileId = nf.getId(); s.fileName = nf.getName(); s.fileUrl = nf.getUrl(); s.mimeType = file.mime;
      s.sizeMB = Math.round(nf.getSize() / 1048576 * 10) / 10;
    }
    s.log = clip_((str_(s.log) ? str_(s.log) + '\n' : '') + nowIso_() + ' ' + (isNew ? 'ส่งผลงาน' : 'แก้ไข/ส่งใหม่') + ' โดย ' + email, 4000);
    t.save();
    result = subPublic_(s);
  });
  clearCatalog_();
  const set = settings_();
  sendMail_(email, (isNew ? 'ได้รับผลงานแล้ว ' : 'ได้รับผลงานฉบับแก้ไขแล้ว ') + result.code, isNew ? 'ระบบได้รับผลงานของคุณแล้ว' : 'ระบบได้รับผลงานฉบับแก้ไขแล้ว',
    '<p>รหัสติดตาม: <b>' + esc_(result.code) + '</b><br>ชื่อผลงาน: ' + esc_(result.title) + '<br>ประเภท: ' + esc_(result.category) + ' · ปี ' + esc_(result.year) +
    '<br>หน่วยงาน: ' + esc_(result.department) + '</p><p>ติดตามสถานะได้ที่เมนู "ผลงานของฉัน" บนหน้าเว็บ</p>');
  if (set.notifyEmail) sendMail_(set.notifyEmail, '[ผลงานใหม่] ' + result.code + ' ' + clip_(result.title, 60), 'มีผลงาน' + (isNew ? 'ใหม่' : 'ฉบับแก้ไข') + 'ส่งเข้ามา',
    '<p>' + esc_(result.code) + ' · ' + esc_(result.title) + '<br>' + esc_(result.department) + ' · ' + esc_(result.category) + '<br>ผู้ส่ง: ' + esc_(email) + '</p>');
  return result;
}
/** โฟลเดอร์เก็บไฟล์ที่ส่ง: ถ้ารอบมี folderUrl จะใส่ในโฟลเดอร์ย่อยตามประเภท (และโฟลเดอร์ "ส่งผลงาน" ข้างใน ถ้ามี) */
function uploadDir_(call, cat) { return resolveUpload_(call, cat).folder; }
/** คืน { folder, path, ok } — ok=false เมื่อต้องใช้โฟลเดอร์สำรองของระบบ */
function resolveUpload_(call, cat) {
  if (call.folderUrl) {
    try {
      const root = DriveApp.getFolderById(folderIdFromUrl_(call.folderUrl)), it = root.getFolders();
      while (it.hasNext()) {
        const f = it.next();
        if (guessCat_(f.getName()) === cat) {
          const s = f.getFoldersByName('ส่งผลงาน');
          return s.hasNext() ? { folder: s.next(), path: root.getName() + ' / ' + f.getName() + ' / ส่งผลงาน', ok: true } : { folder: f, path: root.getName() + ' / ' + f.getName(), ok: true };
        }
      }
      return { folder: root, path: root.getName() + ' (ไม่พบโฟลเดอร์ย่อยของประเภทนี้)', ok: false };
    } catch (e) { console.warn('uploadDir: ' + e.message); }
  }
  const f = subFolder_(subFolder_(folderId_('submissions'), call.year).getId(), cat || UNCAT);
  return { folder: f, path: 'โฟลเดอร์สำรองของระบบ / ' + call.year + ' / ' + (cat || UNCAT), ok: false };
}
function extOf_(name, mime) {
  const m = String(name || '').match(/\.[a-z0-9]{2,5}$/i);
  if (m) return m[0].toLowerCase();
  return { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[mime] || '';
}
function withdraw_(r) {
  const email = requireSession_(r.session);
  const out = mutate_('Submissions', function (rows) {
    const s = rows.filter(function (x) { return str_(x.subId) === str_(r.subId); })[0];
    if (!s || str_(s.email).toLowerCase() !== email) throw new Error('ไม่พบผลงาน');
    if (['submitted', 'reviewing', 'revise'].indexOf(str_(s.status)) < 0) throw new Error('ถอนผลงานในสถานะนี้ไม่ได้');
    s.status = 'withdrawn'; s.updatedAt = nowIso_();
    s.log = clip_(str_(s.log) + '\n' + nowIso_() + ' ถอนผลงานโดยผู้ส่ง', 4000);
    return subPublic_(s);
  });
  clearCatalog_();
  return out;
}

/* ============================================================
 *  หน่วยงาน + การมีส่วนร่วม
 * ============================================================ */
function deptRows_() {
  return table_('Departments').rows.map(function (d) {
    return { name: str_(d.name), group: str_(d.group), shortName: str_(d.shortName), active: d.active === '' ? true : bool_(d.active), order: num_(d.order) };
  }).filter(function (d) { return d.name; }).sort(function (a, b) { return (a.order - b.order) || a.name.localeCompare(b.name, 'th'); });
}
function saveDepts_(list) {
  const seen = {};
  const rows = list.map(function (d, i) {
    return { name: clip_(d.name, 150), group: clip_(d.group, 150), shortName: clip_(d.shortName, 60), active: d.active !== false && String(d.active).toUpperCase() !== 'FALSE', order: num_(d.order) || i + 1 };
  }).filter(function (d) { if (!d.name || seen[d.name]) return false; seen[d.name] = 1; return true; });
  withLock_(function () { const t = table_('Departments'); t.rows = rows; t.save(); });
  clearCatalog_();
  return deptRows_();
}
function deptCanon_(depts) {
  const map = {};
  depts.forEach(function (d) {
    map[norm_(d.name)] = d.name;
    if (d.shortName) d.shortName.split(/\s*,\s*/).forEach(function (a) { if (a) map[norm_(a)] = d.name; });
  });
  return function (name) { const n = norm_(name).trim(); return n ? (map[n] || str_(name)) : ''; };
}
/** สรุปการมีส่วนร่วมรายหน่วยงาน × ปี (admin=true รวมผลงานที่ยังไม่เผยแพร่ด้วย) */
function participation_(admin, works, calls) {
  works = works || table_('Works').rows;
  calls = calls || callsRows_();
  const depts = deptRows_(), canon = deptCanon_(depts), visible = resultsVisibleFn_(calls), subs = table_('Submissions').rows;
  const data = {}, years = {}, extra = {};
  function cell(y, d) {
    years[y] = 1;
    if (!data[y]) data[y] = {};
    if (!data[y][d]) data[y][d] = { works: 0, published: 0, submitted: 0, awards: 0, cats: {} };
    return data[y][d];
  }
  works.forEach(function (w) {
    const y = str_(w.year); if (!y || str_(w.ocrStatus) === 'ignored') return;
    const pub = isListed_(w);
    if (!admin && !pub) return;
    const d = canon(w.department) || 'ไม่ระบุหน่วยงาน';
    const c = cell(y, d);
    c.works++; if (pub) c.published++;
    c.cats[str_(w.category) || UNCAT] = (c.cats[str_(w.category) || UNCAT] || 0) + 1;
    if (str_(w.award) && (admin || visible(y))) c.awards++;
  });
  subs.forEach(function (s) {
    const y = str_(s.year); if (!y || str_(s.status) === 'withdrawn' || str_(s.workId)) return;
    const d = canon(s.department) || 'ไม่ระบุหน่วยงาน';
    const c = cell(y, d); c.submitted++;
    c.cats[str_(s.category) || UNCAT] = (c.cats[str_(s.category) || UNCAT] || 0) + 1;
  });
  Object.keys(data).forEach(function (y) { Object.keys(data[y]).forEach(function (d) { if (!depts.some(function (x) { return x.name === d; })) extra[d] = 1; }); });
  return {
    years: Object.keys(years).sort().reverse(),
    departments: depts.filter(function (d) { return d.active; }).map(function (d) { return { name: d.name, group: d.group }; })
      .concat(Object.keys(extra).sort(function (a, b) { return a.localeCompare(b, 'th'); }).map(function (n) { return { name: n, group: '', unlisted: true }; })),
    data: data
  };
}

/* ============================================================
 *  ADMIN: LOGIN
 * ============================================================ */
function adminLogin_(r) {
  const pw = str_(prop_('ADMIN_PASSWORD')); // ตัดช่องว่าง/ขึ้นบรรทัดที่ติดมาตอนวางค่า
  if (!pw) throw new Error('ยังไม่ได้ตั้งรหัสผ่าน: Apps Script → Project Settings → Script Properties → เพิ่ม ADMIN_PASSWORD');
  const c = cache_(), fails = Number(c.get('admfail') || 0);
  if (fails >= 10) throw new Error('ใส่รหัสผิดหลายครั้ง กรุณารอ 10 นาที');
  if (str_(r.password) !== pw) { c.put('admfail', String(fails + 1), 600); throw new Error('รหัสผ่านไม่ถูกต้อง (ผิดได้อีก ' + (9 - fails) + ' ครั้ง ก่อนถูกล็อก 10 นาที)'); }
  c.remove('admfail');
  const t = 'a' + uuid_().replace(/-/g, '');
  c.put('adm:' + t, '1', 21600);
  return t;
}
function requireAdmin_(t) {
  t = str_(t);
  if (!t || !cache_().get('adm:' + t)) throw new Error('SESSION_EXPIRED');
  cache_().put('adm:' + t, '1', 21600);
}

/* ============================================================
 *  ADMIN: DASHBOARD + DIAGNOSE
 * ============================================================ */
function dashboard_(r) {
  const y = str_(r.year), all = table_('Works').rows, stats = eventStats_(), st = settings_();
  const years = Array.from(new Set(all.map(function (w) { return str_(w.year); }).filter(String))).sort().reverse();
  const ws = all.filter(function (w) { return !y || str_(w.year) === y; });
  const k = { total: 0, published: 0, review: 0, pending: 0, error: 0, missing: 0, ignored: 0, awards: 0, views: 0, opens: 0, visitors: stats.visitors, submissions: 0, subPending: 0 };
  const byCat = {};
  ws.forEach(function (w) {
    const s = str_(w.ocrStatus), pub = bool_(w.published), id = str_(w.id);
    if (s === 'ignored') { k.ignored++; return; }
    k.total++;
    if (pub && s !== 'missing') k.published++;
    if (!pub && ['done', 'skipped', 'error'].indexOf(s) >= 0) k.review++;
    if (s === 'pending') k.pending++;
    if (s === 'error') k.error++;
    if (s === 'missing') k.missing++;
    if (str_(w.award)) k.awards++;
    k.views += stats.views[id] || 0; k.opens += stats.opens[id] || 0;
    const c = str_(w.category) || UNCAT;
    if (!byCat[c]) byCat[c] = { total: 0, published: 0, views: 0 };
    byCat[c].total++; if (pub) byCat[c].published++; byCat[c].views += stats.views[id] || 0;
  });
  table_('Submissions').rows.forEach(function (s) {
    if (y && str_(s.year) !== y) return;
    if (str_(s.status) === 'withdrawn') return;
    k.submissions++;
    if (['submitted', 'reviewing'].indexOf(str_(s.status)) >= 0) k.subPending++;
  });
  const top = ws.filter(function (w) { return stats.views[str_(w.id)]; })
    .sort(function (a, b) { return (stats.views[str_(b.id)] || 0) - (stats.views[str_(a.id)] || 0); }).slice(0, 10)
    .map(function (w) { return { id: str_(w.id), title: str_(w.title) || cleanTitle_(w.fileName), category: str_(w.category), views: stats.views[str_(w.id)] || 0, opens: stats.opens[str_(w.id)] || 0 }; });
  let quota = 0; try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { }
  return {
    years: years, kpi: k, byCat: byCat, byMonth: stats.byMonth, top: top, autoSync: hasTrigger_(), mailQuota: quota,
    useAI: bool_(st.useAI), aiReady: !!prop_('GEMINI_KEY'), siteUrl: st.siteUrl, verifiedUsers: table_('Visitors').rows.length,
    calls: callsRows_().map(function (c) { return { callId: c.callId, year: c.year, title: c.title, status: callStatus_(c), closes: c.closes, resultsPublic: c.resultsPublic }; }),
    version: VERSION
  };
}
function diagnose_() {
  const checks = [];
  function add(name, fn) {
    try { const d = fn(); checks.push({ name: name, ok: d !== false, detail: d === false ? 'ไม่ผ่าน' : String(d || 'ปกติ') }); }
    catch (e) { checks.push({ name: name, ok: false, detail: String(e.message || e) }); }
  }
  add('Google Sheet ฐานข้อมูล', function () { return ss_().getName() + ' (' + ss_().getId() + ')'; });
  add('รหัสผ่าน Admin', function () { return prop_('ADMIN_PASSWORD') ? 'ตั้งแล้ว' : false; });
  add('โฟลเดอร์ระบบใน Drive', function () { return DriveApp.getFolderById(folderId_('root')).getName(); });
  add('Drive REST API (ใช้ทำ OCR)', function () { const a = driveApi_('get', 'about', null, 'fields=user(emailAddress),storageQuota'); return 'บัญชี ' + a.user.emailAddress; });
  add('สิทธิ์อ่านโฟลเดอร์แหล่งไฟล์', function () {
    const s = table_('Sources').rows.filter(function (x) { return bool_(x.enabled); });
    if (!s.length) return 'ยังไม่มีแหล่งไฟล์';
    return s.map(function (x) { return DriveApp.getFolderById(str_(x.folderId)).getName(); }).join(', ');
  });
  add('โควตาอีเมลวันนี้', function () { const q = MailApp.getRemainingDailyQuota(); return q > 0 ? 'เหลือ ' + q + ' ฉบับ' : false; });
  callsRows_().filter(function (c) { return ['open', 'upcoming'].indexOf(callStatus_(c)) >= 0; }).forEach(function (c) {
    c.categories.forEach(function (cat) {
      add('ปลายทางไฟล์ ' + c.year + ' · ' + cat, function () { const r = resolveUpload_(c, cat); if (!r.ok) throw new Error(r.path); return r.path; });
    });
  });
  add('ซิงก์อัตโนมัติ', function () { return hasTrigger_() ? 'เปิด (ทุก 1 ชั่วโมง)' : 'ปิดอยู่'; });
  add('URL ของ Web app', function () { const u = ScriptApp.getService().getUrl(); return u || 'ยังไม่ได้ Deploy เป็น Web app'; });
  add('AI (Gemini)', function () { return prop_('GEMINI_KEY') ? 'มี API key · ' + (prop_('GEMINI_MODEL') || 'gemini-2.5-flash') : 'ไม่ได้ใช้'; });
  const w = table_('Works').rows;
  add('ผลงานที่เผยแพร่แล้ว', function () { const n = w.filter(isListed_).length; return n ? n + ' รายการ' : false; });
  add('OCR ผิดพลาดค้างอยู่', function () { const n = w.filter(function (x) { return str_(x.ocrStatus) === 'error'; }).length; return n ? false : 'ไม่มี'; });
  return { version: VERSION, checks: checks, time: nowIso_() };
}

/* ============================================================
 *  ADMIN: SOURCES + SYNC
 * ============================================================ */
function folderIdFromUrl_(u) {
  u = str_(u);
  const m = u.match(/folders\/([\w-]{10,})/) || u.match(/[?&]id=([\w-]{10,})/) || u.match(/^([\w-]{20,})$/);
  if (!m) throw new Error('ลิงก์โฟลเดอร์ไม่ถูกต้อง');
  return m[1];
}
function listSources_() {
  const counts = {};
  table_('Works').rows.forEach(function (w) { counts[str_(w.sourceId)] = (counts[str_(w.sourceId)] || 0) + 1; });
  return table_('Sources').rows.map(function (s) { const o = clean_(s); o.works = counts[str_(s.sourceId)] || 0; return o; });
}
function walk_(folder, fixedCat, depth, out, levelCat, skipped, path) {
  const fi = folder.getFiles();
  path = path || folder.getName();
  while (fi.hasNext()) {
    const f = fi.next(), mime = f.getMimeType();
    if (SUPPORTED.indexOf(mime) < 0) { if (skipped) skipped.push({ id: f.getId(), name: f.getName(), mime: mime, url: f.getUrl(), path: path, sizeMB: Math.round(f.getSize() / 1048576 * 10) / 10 }); continue; }
    out.push({ id: f.getId(), name: f.getName(), mime: mime, size: f.getSize(), modified: f.getLastUpdated().getTime(), url: f.getUrl(), category: fixedCat || levelCat || UNCAT });
  }
  if (depth >= 4) return;
  const fo = folder.getFolders();
  while (fo.hasNext()) { const sub = fo.next(); walk_(sub, fixedCat, depth + 1, out, levelCat || guessCat_(sub.getName()), skipped, path + ' / ' + sub.getName()); }
}
function previewFolder_(url) {
  const id = folderIdFromUrl_(url), root = DriveApp.getFolderById(id), name = root.getName();
  const rootFiles = []; walk_(root, '', 4, rootFiles, '');
  const subs = [], it = root.getFolders(); let total = rootFiles.length;
  while (it.hasNext()) {
    const s = it.next(), files = []; walk_(s, '', 1, files, '');
    total += files.length;
    subs.push({ name: s.getName(), category: guessCat_(s.getName()), files: files.length });
  }
  const ym = name.match(/25\d\d/);
  return { id: id, name: name, total: total, rootFiles: rootFiles.length, category: guessCat_(name), guessYear: ym ? ym[0] : '', subfolders: subs };
}
function addSource_(o) {
  const id = folderIdFromUrl_(o.folderUrl);
  if (!isYear_(o.year)) throw new Error('ปีต้องเป็นตัวเลข 4 หลัก');
  const f = DriveApp.getFolderById(id);
  mutate_('Sources', function (rows) {
    if (rows.some(function (s) { return str_(s.folderId) === id; })) throw new Error('มีโฟลเดอร์นี้อยู่แล้ว');
    rows.push({ sourceId: uuid_().slice(0, 8), folderUrl: 'https://drive.google.com/drive/folders/' + id, folderId: id, folderName: f.getName(),
      year: str_(o.year), category: CATS.indexOf(o.category) >= 0 ? o.category : '', enabled: true, lastSync: '', note: clip_(o.note, 300) });
  });
  return listSources_();
}
function updateSource_(r) {
  mutate_('Sources', function (rows) {
    const s = rows.filter(function (x) { return str_(x.sourceId) === str_(r.sourceId); })[0];
    if (!s) throw new Error('ไม่พบแหล่งไฟล์');
    if (r.enabled !== undefined) s.enabled = !!r.enabled;
    if (r.year !== undefined && isYear_(r.year)) s.year = str_(r.year);
    if (r.category !== undefined) s.category = CATS.indexOf(r.category) >= 0 ? r.category : '';
  });
  return listSources_();
}
function deleteSource_(id) {
  mutate_('Sources', function (rows, t) { t.rows = rows.filter(function (x) { return str_(x.sourceId) !== str_(id); }); });
  return listSources_();
}
function hasTrigger_() { return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'autoSync'; }); }
function setAutoSync_(on) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'autoSync') ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger('autoSync').timeBased().everyHours(1).create();
  return { on: hasTrigger_() };
}
function runJob_(doSync) {
  const c = cache_(), t0 = Date.now();
  if (c.get('jobBusy')) return { sync: {}, ocr: { busy: true, done: 0, errors: 0, left: 0 } };
  c.put('jobBusy', '1', 360);
  try {
    const sync = doSync ? syncAll_(t0) : {};
    sync.media = prepMissingMedia_(t0);
    const ocr = processQueue_(t0);
    clearCatalog_();
    return { sync: sync, ocr: ocr };
  } finally { c.remove('jobBusy'); }
}
function syncAll_(t0) {
  const res = { added: 0, changed: 0, missing: 0, errors: [] };
  const sources = table_('Sources').rows.filter(function (s) { return bool_(s.enabled); });
  const found = {};
  sources.forEach(function (s) {
    if (Date.now() - t0 > RUN_BUDGET_MS * 0.5) { res.errors.push(s.folderName + ': หมดเวลา จะซิงก์ต่อรอบหน้า'); return; }
    try {
      const out = []; walk_(DriveApp.getFolderById(str_(s.folderId)), str_(s.category), 0, out, '');
      found[str_(s.sourceId)] = out;
    } catch (e) { res.errors.push((s.folderName || s.folderId) + ': ' + e.message); }
  });
  withLock_(function () {
    const t = table_('Works'), byFile = {};
    t.rows.forEach(function (w) { byFile[str_(w.fileId)] = w; });
    Object.keys(found).forEach(function (sid) {
      const src = sources.filter(function (s) { return str_(s.sourceId) === sid; })[0], seen = {};
      found[sid].forEach(function (f) {
        seen[f.id] = 1;
        const w = byFile[f.id], sizeMB = Math.round(f.size / 1048576 * 10) / 10;
        if (!w) {
          const nw = { id: uuid_(), sourceId: sid, year: str_(src.year), category: f.category, title: cleanTitle_(f.name), authors: '', department: '',
            keywords: '', summary: '', access: 'verified', published: false, featured: false, showThumb: true, locked: false, fileId: f.id, fileName: f.name,
            fileUrl: f.url, mimeType: f.mime, sizeMB: sizeMB, modified: f.modified, ocrStatus: 'pending', ocrNote: '', thumbId: '', viewId: '',
            createdAt: nowIso_(), updatedAt: nowIso_(), code: '', award: '', awardRank: '', score: '', submissionId: '', abstract: '' };
          t.rows.push(nw); byFile[f.id] = nw; res.added++;
          return;
        }
        if (str_(w.ocrStatus) === 'ignored') return;
        if (str_(w.ocrStatus) === 'missing') { w.ocrStatus = 'pending'; w.ocrNote = 'พบไฟล์อีกครั้ง'; res.changed++; }
        if (String(w.modified) !== String(f.modified)) {
          w.fileName = f.name; w.fileUrl = f.url; w.mimeType = f.mime; w.sizeMB = sizeMB; w.modified = f.modified;
          if (!bool_(w.locked)) { w.ocrStatus = 'pending'; w.ocrNote = 'ไฟล์ถูกแก้ไข'; if (f.category !== UNCAT) w.category = f.category; }
          if (str_(w.viewId)) { trash_(w.viewId); w.viewId = ''; }
          if (str_(w.thumbId)) { trash_(w.thumbId); w.thumbId = ''; }
          w.updatedAt = nowIso_(); res.changed++;
        }
      });
      t.rows.forEach(function (w) {
        if (str_(w.sourceId) !== sid || seen[str_(w.fileId)] || ['ignored', 'missing'].indexOf(str_(w.ocrStatus)) >= 0) return;
        w.ocrStatus = 'missing'; w.ocrNote = 'ไม่พบไฟล์ในโฟลเดอร์ต้นทาง'; w.published = false; w.updatedAt = nowIso_(); res.missing++;
      });
    });
    t.save();
    const s = table_('Sources');
    s.rows.forEach(function (x) { const l = found[str_(x.sourceId)]; if (l) { x.lastSync = nowIso_(); x.note = 'พบ ' + l.length + ' ไฟล์'; } });
    s.save();
  });
  return res;
}
/** เตรียมภาพปก/ไฟล์เปิดดูที่ยังขาด ของผลงานที่เผยแพร่อยู่ (เช่น เผยแพร่ทีละมาก ๆ แล้วหมดเวลา หรือไฟล์ต้นฉบับถูกแก้) */
function prepMissingMedia_(t0) {
  const need = table_('Works').rows.filter(function (w) { return isListed_(w) && mediaMissing_(w); }).map(function (w) { return str_(w.id); });
  let n = 0;
  need.forEach(function (id) { if (Date.now() - t0 < RUN_BUDGET_MS * 0.6) { try { prepareMediaById_(id); n++; } catch (e) { } } });
  return n;
}
/** รวมไฟล์ซ้ำ: ซ่อนไฟล์ id และผูกไว้กับผลงานหลัก into (undo = แยกกลับ) */
function mergeDup_(id, into, undo) {
  mutate_('Works', function (rows) {
    const w = findWork_(rows, id); if (!w) throw new Error('ไม่พบไฟล์');
    if (undo) { w.dupOf = ''; w.ocrStatus = getText_(id) ? 'done' : 'pending'; w.ocrNote = 'แยกออกจากไฟล์ซ้ำ'; }
    else {
      const m = findWork_(rows, into); if (!m || str_(m.id) === str_(w.id)) throw new Error('ไม่พบผลงานหลัก');
      w.dupOf = str_(m.id); w.ocrStatus = 'ignored'; w.published = false; w.reviewed = true; w.reviewedAt = nowIso_();
      w.ocrNote = 'ไฟล์ซ้ำ/ไฟล์ประกอบของ ' + (str_(m.code) || clip_(m.title, 60));
    }
    w.updatedAt = nowIso_();
  });
  clearCatalog_();
  return listWorksAdmin_().filter(function (x) { return x.id === str_(id); })[0];
}
/** ตรวจไฟล์ตกหล่น: ไฟล์ในโฟลเดอร์ที่ยังไม่อยู่ในระบบ ไฟล์ชนิดที่ไม่รองรับ และรายการที่ไฟล์หาย */
function auditSources_() {
  const works = table_('Works').rows, byFile = {};
  works.forEach(function (w) { byFile[str_(w.fileId)] = w; });
  const out = [];
  table_('Sources').rows.forEach(function (s) {
    const r = { sourceId: str_(s.sourceId), name: str_(s.folderName), year: str_(s.year), enabled: bool_(s.enabled), total: 0, registered: 0, newFiles: [], unsupported: [], error: '' };
    try {
      const files = [], skipped = [];
      walk_(DriveApp.getFolderById(str_(s.folderId)), str_(s.category), 0, files, '', skipped);
      r.total = files.length;
      files.forEach(function (f) { if (byFile[f.id]) r.registered++; else r.newFiles.push({ name: f.name, mime: f.mime, url: f.url, category: f.category }); });
      r.unsupported = skipped;
    } catch (e) { r.error = e.message; }
    out.push(r);
  });
  const missing = works.filter(function (w) { return str_(w.ocrStatus) === 'missing'; }).map(function (w) { return { id: str_(w.id), title: str_(w.title), fileName: str_(w.fileName) }; });
  return { sources: out, missing: missing };
}
function requeueErrors_() {
  return mutate_('Works', function (rows) {
    let n = 0;
    rows.forEach(function (w) { if (str_(w.ocrStatus) === 'error') { w.ocrStatus = 'pending'; w.ocrNote = 'ส่งกลับเข้าคิว'; n++; } });
    return { count: n };
  });
}

/* ============================================================
 *  OCR
 * ============================================================ */
function processQueue_(t0) {
  const res = { done: 0, errors: 0, left: 0, busy: false };
  const ids = table_('Works').rows.filter(function (w) { return str_(w.ocrStatus) === 'pending'; }).map(function (w) { return str_(w.id); });
  for (let i = 0; i < ids.length; i++) {
    if (Date.now() - t0 > RUN_BUDGET_MS) { res.left = ids.length - i; break; }
    const r = ocrOne_(ids[i]);
    if (r) res.done++; else res.errors++;
  }
  return res;
}
function rerunOcr_(id) {
  const c = cache_();
  if (c.get('jobBusy')) { mutate_('Works', function (rows) { const w = findWork_(rows, id); if (w) w.ocrStatus = 'pending'; }); return { busy: true }; }
  c.put('jobBusy', '1', 360);
  try { const ok = ocrOne_(id); clearCatalog_(); return { done: ok }; } finally { c.remove('jobBusy'); }
}
function ocrOne_(id) {
  const w = findWork_(table_('Works').rows, id);
  if (!w) return false;
  let text = '', note = '', status = 'done';
  try {
    const r = extractText_(str_(w.fileId), str_(w.mimeType), num_(w.sizeMB), str_(w.fileName));
    text = r.text; note = r.note; if (r.skipped) status = 'skipped';
  } catch (e) {
    status = 'error'; note = 'OCR ไม่สำเร็จ: ' + clip_(e.message || e, 200);
  }
  if (status !== 'error' && !(bool_(w.locked) && getText_(id))) saveText_(id, text);
  let meta = {};
  if (status === 'done' && text && !bool_(w.locked)) {
    meta = heuristics_(text);
    const st = settings_();
    if (bool_(st.useAI) && prop_('GEMINI_KEY')) { try { meta = Object.assign(meta, aiExtract_(text, w)); } catch (e) { note = (note ? note + ' · ' : '') + 'AI: ' + clip_(e.message, 80); } }
  }
  mutate_('Works', function (rows) {
    const x = findWork_(rows, id); if (!x) return;
    x.ocrStatus = status; x.ocrNote = note || (status === 'done' ? 'อ่านข้อความได้ ' + text.length + ' ตัวอักษร' : '');
    ['authors', 'department', 'keywords', 'summary'].forEach(function (k) { if (!str_(x[k]) && meta[k]) x[k] = clip_(meta[k], k === 'summary' ? 1200 : 400); });
    if (meta.title && (!str_(x.title) || str_(x.title) === cleanTitle_(x.fileName)) && meta.title.length > 8) x.title = clip_(meta.title, 400);
    x.updatedAt = nowIso_();
  });
  return status !== 'error';
}
function extractText_(fileId, mime, sizeMB, name) {
  if (mime === GDOC) return { text: clip_(DocumentApp.openById(fileId).getBody().getText(), TEXT_MAX), note: '' };
  if (mime === GSLIDE) return { text: clip_(slidesText_(fileId), TEXT_MAX), note: '' };
  const tmp = folderId_('temp'), made = [];
  try {
    if (mime === PPTX) {
      const c = driveApi_('post', 'files/' + fileId + '/copy', { name: 'tmp_' + name, mimeType: GSLIDE, parents: [tmp] }, 'supportsAllDrives=true&fields=id');
      made.push(c.id); return { text: clip_(slidesText_(c.id), TEXT_MAX), note: '' };
    }
    let src = fileId, note = '';
    const ocrable = mime === 'application/pdf' || mime.indexOf('image/') === 0;
    if (!ocrable && mime !== DOCX) return { text: '', note: 'ไม่รองรับไฟล์ชนิดนี้', skipped: true };
    if (ocrable && sizeMB > OCR_MAX_MB) {
      const b = thumbBlob_(fileId, 2400);
      if (!b) throw new Error('ไฟล์ใหญ่กว่า ' + OCR_MAX_MB + ' MB และสร้างภาพย่อไม่ได้');
      const f = DriveApp.getFolderById(tmp).createFile(b.setName('ocr_' + fileId + '.png'));
      src = f.getId(); made.push(src);
      note = 'OCR จากภาพย่อ (ไฟล์ใหญ่ ' + sizeMB + ' MB) ข้อความอาจไม่ครบ' + (mime === 'application/pdf' ? ' · อ่านเฉพาะหน้าแรก' : '');
    }
    const copy = driveApi_('post', 'files/' + src + '/copy', { name: 'ocr_' + name, mimeType: GDOC, parents: [tmp] },
      (ocrable ? 'ocrLanguage=th&' : '') + 'supportsAllDrives=true&fields=id');
    made.push(copy.id);
    const text = DocumentApp.openById(copy.id).getBody().getText().replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    return { text: clip_(text, TEXT_MAX), note: note };
  } finally { made.forEach(trash_); }
}
function slidesText_(id) {
  const out = [];
  SlidesApp.openById(id).getSlides().forEach(function (s) {
    s.getShapes().forEach(function (sh) { try { const t = sh.getText().asString().trim(); if (t) out.push(t); } catch (e) { } });
  });
  return out.join('\n');
}
function saveText_(id, text) {
  text = clip_(text, TEXT_MAX);
  mutate_('Texts', function (rows) {
    const r = rows.filter(function (x) { return str_(x.id) === str_(id); })[0];
    if (r) { r.text = text; r.chars = text.length; r.updatedAt = nowIso_(); }
    else rows.push({ id: str_(id), chars: text.length, updatedAt: nowIso_(), text: text });
  });
}
function getText_(id) {
  const r = table_('Texts').rows.filter(function (x) { return str_(x.id) === str_(id); })[0];
  return r ? String(r.text || '') : '';
}
function heuristics_(text) {
  const flat = text.replace(/[ \t]+/g, ' ');
  const lines = flat.split(/\n+/).map(function (s) { return s.trim(); }).filter(String);
  const stop = '(?=\\s(?:โดย|ผู้จัดทำ|ผู้วิจัย|ผู้นำเสนอ|คณะผู้จัดทำ|หน่วยงาน|ชื่อหน่วยงาน|กลุ่มงาน|สังกัด|คำสำคัญ|บทคัดย่อ)|$)';
  function pick(labels) {
    const re = new RegExp('(?:' + labels + ')\\s*[:：]?\\s*(.+?)' + stop, 'i');
    for (let i = 0; i < lines.length; i++) { const m = lines[i].match(re); if (m && m[1] && m[1].trim().length > 2) return m[1].trim().replace(/[.,;:]+$/, ''); }
    return '';
  }
  const o = {
    title: pick('ชื่อเรื่อง|ชื่อผลงาน|ชื่อโครงการ|ชื่องานวิจัย'),
    authors: pick('คณะผู้จัดทำ|ผู้จัดทำ|ผู้วิจัย|ผู้นำเสนอ|ผู้รับผิดชอบ'),
    department: pick('ชื่อหน่วยงาน|หน่วยงาน|กลุ่มงาน|สังกัด'),
    keywords: pick('คำสำคัญ|keywords?')
  };
  if (!o.authors) {
    const m = flat.match(/โดย\s*((?:ภก\.|ภญ\.|นพ\.|พญ\.|พว\.|พยาบาล|ทพ\.|ทพญ\.|นาย|นางสาว|นาง|น\.ส\.|ดร\.|คุณ)\s*\S+\s+\S+(?:\s*(?:,|และ)\s*(?:ภก\.|ภญ\.|นพ\.|พญ\.|พว\.|ทพ\.|ทพญ\.|นาย|นางสาว|นาง|น\.ส\.|ดร\.|คุณ)\s*\S+\s+\S+)*)/);
    if (m) o.authors = m[1].trim();
  }
  for (let i = 0; i < lines.length; i++) {
    if (/^(บทคัดย่อ|บทสรุป|abstract|สรุปผล(การดำเนินงาน)?|ผลลัพธ์)\s*[:：]?/i.test(lines[i])) {
      let s = lines[i].replace(/^(บทคัดย่อ|บทสรุป|abstract|สรุปผล(การดำเนินงาน)?|ผลลัพธ์)\s*[:：]?\s*/i, '');
      for (let j = i + 1; j < lines.length && s.length < 600; j++) s += ' ' + lines[j];
      o.summary = clip_(s.trim(), 600); break;
    }
  }
  return o;
}
function aiExtract_(text, w) {
  const key = prop_('GEMINI_KEY'), model = prop_('GEMINI_MODEL') || 'gemini-2.5-flash';
  if (!key) throw new Error('ยังไม่ได้ตั้ง API key');
  const prompt = 'อ่านข้อความจากโปสเตอร์/เอกสารผลงานวิชาการของโรงพยาบาลด้านล่าง แล้วตอบเป็น JSON เท่านั้น มีคีย์: title (ชื่อผลงาน), authors (ชื่อผู้จัดทำ คั่นด้วยจุลภาค), ' +
    'department (หน่วยงาน), keywords (คำสำคัญ 3-6 คำ คั่นด้วยจุลภาค), summary (บทสรุปภาษาไทย 2-4 ประโยค ห้ามมีข้อมูลที่ระบุตัวผู้ป่วย) ' +
    'ถ้าไม่พบให้ใส่ "" ห้ามแต่งข้อมูลเอง\nชื่อไฟล์: ' + w.fileName + '\nข้อความ:\n' + clip_(text, 12000);
  const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } })
  });
  if (r.getResponseCode() >= 300) throw new Error('Gemini ' + r.getResponseCode());
  const j = JSON.parse(r.getContentText());
  const t = j.candidates && j.candidates[0] && j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
  const o = JSON.parse(String(t || '{}').replace(/^```json|```$/g, ''));
  const out = {}; ['title', 'authors', 'department', 'keywords', 'summary'].forEach(function (k) { if (o[k]) out[k] = str_(o[k]); });
  return out;
}
function suggestMeta_(id, ai) {
  const w = findWork_(table_('Works').rows, id);
  if (!w) throw new Error('ไม่พบผลงาน');
  const text = getText_(id);
  if (!text) throw new Error('ยังไม่มีข้อความ OCR ของไฟล์นี้ ลองกด "ทำ OCR ใหม่" ก่อน');
  return ai ? aiExtract_(text, w) : heuristics_(text);
}

/* ============================================================
 *  ADMIN: WORKS
 * ============================================================ */
function listWorksAdmin_() {
  const chars = textChars_(), stats = eventStats_();
  return table_('Works').rows.map(function (w) {
    const o = clean_(w); o.id = str_(w.id); o.year = str_(w.year);
    o.textChars = chars[o.id] || 0; o.views = stats.views[o.id] || 0; o.opens = stats.opens[o.id] || 0;
    ['published', 'featured', 'showThumb', 'locked', 'reviewed'].forEach(function (k) { o[k] = bool_(w[k]); });
    return o;
  });
}
function mediaMissing_(w) {
  const a = str_(w.access);
  if (a === 'filename_only') return false;
  if (bool_(w.showThumb) && !str_(w.thumbId)) return true;
  return (a === 'public' || a === 'verified') && !str_(w.viewId);
}
/** สร้างภาพปกและสำเนาสำหรับเปิดดู (แชร์แบบผู้มีลิงก์ดูได้) — คืนข้อความเตือนถ้ามี */
function prepareMedia_(w) {
  const warns = [], a = str_(w.access), name = clip_(cleanTitle_(w.fileName) || w.title, 120);
  if (a === 'filename_only' || a === 'metadata') { if (str_(w.viewId)) { trash_(w.viewId); w.viewId = ''; } }
  if (a === 'filename_only' || !bool_(w.showThumb)) { if (str_(w.thumbId)) { trash_(w.thumbId); w.thumbId = ''; } }
  if (a !== 'filename_only' && bool_(w.showThumb) && !str_(w.thumbId)) {
    try {
      let b = null;
      if (str_(w.mimeType).indexOf('image/') === 0 && num_(w.sizeMB) <= 2) b = DriveApp.getFileById(str_(w.fileId)).getBlob();
      if (!b) b = thumbBlob_(str_(w.fileId), 1000);
      if (!b) throw new Error('สร้างภาพปกไม่ได้');
      const f = DriveApp.getFolderById(folderId_('thumbs')).createFile(b.setName('thumb_' + name));
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      w.thumbId = f.getId();
    } catch (e) { warns.push('ภาพปก: ' + e.message); }
  }
  if ((a === 'public' || a === 'verified') && !str_(w.viewId)) {
    try {
      const c = DriveApp.getFileById(str_(w.fileId)).makeCopy(name, DriveApp.getFolderById(folderId_('view')));
      c.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      w.viewId = c.getId();
    } catch (e) { warns.push('ไฟล์เปิดดู: ' + e.message); }
  }
  return warns;
}
function prepareMediaById_(id) {
  const w = findWork_(table_('Works').rows, id); if (!w) return [];
  const copy = clean_(w), warns = prepareMedia_(copy);
  mutate_('Works', function (rows) { const x = findWork_(rows, id); if (x) { x.thumbId = copy.thumbId; x.viewId = copy.viewId; } });
  return warns;
}
function ensureCode_(w, rows, prefix) {
  if (str_(w.code)) return;
  const y = str_(w.year), cc = CAT_CODE[str_(w.category)] || 'GEN', head = (prefix || 'SWH') + '-' + y + '-' + cc + '-';
  let max = 0;
  rows.forEach(function (x) { const c = str_(x.code); if (c.indexOf(head) === 0) max = Math.max(max, Number(c.slice(head.length)) || 0); });
  w.code = head + pad_(max + 1, 3);
}
function assignCodes_() {
  const prefix = settings_().citePrefix || 'SWH';
  const n = mutate_('Works', function (rows) {
    let c = 0;
    rows.slice().sort(function (a, b) { return iso_(a.createdAt).localeCompare(iso_(b.createdAt)); })
      .forEach(function (w) { if (!str_(w.code) && str_(w.ocrStatus) !== 'ignored' && isYear_(w.year)) { ensureCode_(w, rows, prefix); c++; } });
    return c;
  });
  clearCatalog_();
  return { count: n };
}
function saveWork_(d) {
  const id = str_(d.id), prefix = settings_().citePrefix || 'SWH';
  if (d.year !== undefined && !isYear_(d.year)) throw new Error('ปีต้องเป็นตัวเลข 4 หลัก');
  if (d.access !== undefined && ACCESS.indexOf(d.access) < 0) throw new Error('สิทธิ์การเข้าถึงไม่ถูกต้อง');
  let snap;
  withLock_(function () {
    const t = table_('Works'), w = findWork_(t.rows, id);
    if (!w) throw new Error('ไม่พบผลงาน');
    ['title', 'authors', 'department', 'keywords', 'summary', 'abstract', 'year', 'category', 'access', 'award', 'awardRank', 'score'].forEach(function (k) {
      if (d[k] !== undefined) w[k] = clip_(d[k], k === 'abstract' ? 8000 : (k === 'summary' ? 2000 : 600));
    });
    ['published', 'featured', 'showThumb', 'locked'].forEach(function (k) { if (d[k] !== undefined) w[k] = !!d[k]; });
    if (d.reviewed !== undefined) { w.reviewed = !!d.reviewed; w.reviewedAt = d.reviewed ? nowIso_() : ''; if (d.reviewed) w.locked = true; }
    if (d.text !== undefined && str_(d.text) && ['error', 'pending', 'skipped'].indexOf(str_(w.ocrStatus)) >= 0) { w.ocrStatus = 'done'; w.ocrNote = 'กรอกข้อความเอง'; }
    if (bool_(w.published) && ['ignored', 'missing'].indexOf(str_(w.ocrStatus)) >= 0) w.published = false;
    if (str_(w.access) === 'filename_only') w.showThumb = false;
    if (bool_(w.published)) ensureCode_(w, t.rows, prefix);
    w.updatedAt = nowIso_();
    t.save();
    snap = clean_(w);
  });
  if (d.text !== undefined) saveText_(id, d.text);
  let warns = [];
  if (bool_(snap.published)) warns = prepareMediaById_(id);
  else if (str_(snap.viewId) || (str_(snap.access) === 'filename_only' && str_(snap.thumbId))) {
    const fo = str_(snap.access) === 'filename_only';
    trash_(snap.viewId); if (fo) trash_(snap.thumbId);
    mutate_('Works', function (rows) { const x = findWork_(rows, id); if (x) { x.viewId = ''; if (fo) x.thumbId = ''; } });
  }
  clearCatalog_();
  const w2 = listWorksAdmin_().filter(function (x) { return x.id === id; })[0];
  return { work: w2, warn: warns.length ? 'บันทึกแล้ว แต่มีบางส่วนไม่สำเร็จ:\n' + warns.join('\n') : '' };
}
function bulk_(r) {
  const ids = (r.ids || []).map(String), mode = String(r.mode || ''), val = r.value, prefix = settings_().citePrefix || 'SWH', t0 = Date.now();
  let count = 0;
  withLock_(function () {
    const t = table_('Works');
    t.rows.forEach(function (w) {
      if (ids.indexOf(str_(w.id)) < 0) return;
      if (mode === 'publish') { if (['ignored', 'missing'].indexOf(str_(w.ocrStatus)) >= 0) return; w.published = true; ensureCode_(w, t.rows, prefix); }
      else if (mode === 'unpublish') w.published = false;
      else if (mode === 'feature') w.featured = true;
      else if (mode === 'unfeature') w.featured = false;
      else if (mode === 'access') { if (ACCESS.indexOf(val) < 0) throw new Error('สิทธิ์ไม่ถูกต้อง'); w.access = val; if (val === 'filename_only') w.showThumb = false; }
      else if (mode === 'category') { w.category = clip_(val, 100); }
      else if (mode === 'department') { w.department = clip_(val, 200); }
      else if (mode === 'year') { if (!isYear_(val)) throw new Error('ปีไม่ถูกต้อง'); w.year = str_(val); }
      else throw new Error('ไม่รู้จักคำสั่ง ' + mode);
      w.updatedAt = nowIso_(); count++;
    });
    t.save();
  });
  const warns = [];
  const rows = table_('Works').rows.filter(function (w) { return ids.indexOf(str_(w.id)) >= 0; });
  rows.forEach(function (w) {
    const needs = (isListed_(w) && mediaMissing_(w)) || (!bool_(w.published) && str_(w.viewId)) || (str_(w.access) === 'filename_only' && str_(w.thumbId));
    if (!needs) return;
    if (Date.now() - t0 > RUN_BUDGET_MS) { warns.push((w.title || w.fileName) + ': หมดเวลา จะเตรียมไฟล์ในรอบซิงก์ถัดไป'); return; }
    if (!bool_(w.published) && str_(w.viewId)) { trash_(w.viewId); mutate_('Works', function (rs) { const x = findWork_(rs, w.id); if (x) x.viewId = ''; }); return; }
    prepareMediaById_(str_(w.id)).forEach(function (m) { warns.push(clip_(w.title || w.fileName, 50) + ' — ' + m); });
  });
  clearCatalog_();
  return { count: count, warns: warns };
}
function setAwards_(items) {
  const n = mutate_('Works', function (rows) {
    let c = 0;
    items.forEach(function (it) {
      const w = findWork_(rows, it.id); if (!w) return;
      w.award = clip_(it.award, 120); w.awardRank = it.award ? (num_(it.awardRank) || '') : ''; if (it.score !== undefined) w.score = clip_(it.score, 20);
      w.updatedAt = nowIso_(); c++;
    });
    return c;
  });
  clearCatalog_();
  return { count: n };
}
function hideWork_(id, hide) {
  let viewId = '', thumbId = '';
  mutate_('Works', function (rows) {
    const w = findWork_(rows, id); if (!w) throw new Error('ไม่พบผลงาน');
    if (hide) { w.ocrStatus = 'ignored'; w.published = false; viewId = str_(w.viewId); thumbId = str_(w.thumbId); w.viewId = ''; w.thumbId = ''; }
    else { w.ocrStatus = 'pending'; w.ocrNote = 'กู้คืน'; }
    w.updatedAt = nowIso_();
  });
  trash_(viewId); trash_(thumbId);
  clearCatalog_();
  return true;
}

/* ============================================================
 *  ADMIN: SETTINGS
 * ============================================================ */
function getSettingsAdmin_() {
  let url = ''; try { url = ScriptApp.getService().getUrl(); } catch (e) { }
  return { settings: settings_(), aiKey: !!prop_('GEMINI_KEY'), aiModel: prop_('GEMINI_MODEL') || 'gemini-2.5-flash', url: url, version: VERSION };
}
function saveSettings_(o) {
  const keys = Object.keys(DEFAULT_SETTINGS);
  if (o.defaultYear && !isYear_(o.defaultYear)) throw new Error('ปีเริ่มต้นต้องเป็นตัวเลข 4 หลัก');
  mutate_('Settings', function (rows) {
    keys.forEach(function (k) {
      if (o[k] === undefined) return;
      const v = clip_(o[k], 2000), r = rows.filter(function (x) { return str_(x.key) === k; })[0];
      if (r) r.value = v; else rows.push({ key: k, value: v });
    });
  });
  clearCatalog_();
  return true;
}
function setAiKey_(key, model) {
  key = str_(key); model = str_(model);
  if (key === '-') setProp_('GEMINI_KEY', null); else if (key) setProp_('GEMINI_KEY', key);
  if (model) setProp_('GEMINI_MODEL', model);
  return true;
}

/* ============================================================
 *  ADMIN: CALLS (รอบรับผลงาน / ปีการประกวด)
 * ============================================================ */
function listCalls_() {
  const subs = table_('Submissions').rows;
  return callsRows_().map(function (c) {
    c.status = callStatus_(c);
    c.submissions = subs.filter(function (s) { return str_(s.callId) === c.callId && str_(s.status) !== 'withdrawn'; }).length;
    return c;
  }).sort(function (a, b) { return b.year.localeCompare(a.year) || b.opens.localeCompare(a.opens); });
}
function saveCall_(c) {
  if (!isYear_(c.year)) throw new Error('ปีต้องเป็นตัวเลข 4 หลัก เช่น 2570');
  if (!str_(c.title)) throw new Error('กรุณาใส่ชื่อรอบ');
  ['opens', 'closes', 'eventDate'].forEach(function (k) { if (str_(c[k]) && !/^\d{4}-\d{2}-\d{2}$/.test(str_(c[k]))) throw new Error('รูปแบบวันที่ไม่ถูกต้อง'); });
  if (str_(c.opens) && str_(c.closes) && str_(c.opens) > str_(c.closes)) throw new Error('วันเปิดรับต้องไม่หลังวันปิดรับ');
  const cats = (Array.isArray(c.categories) ? c.categories : String(c.categories || '').split(',')).map(str_).filter(String);
  mutate_('Calls', function (rows) {
    let r = c.callId ? rows.filter(function (x) { return str_(x.callId) === str_(c.callId); })[0] : null;
    if (!r) { r = { callId: 'C' + str_(c.year) + '-' + uuid_().slice(0, 4) }; rows.push(r); }
    Object.assign(r, {
      year: str_(c.year), title: clip_(c.title, 200), opens: str_(c.opens), closes: str_(c.closes), categories: (cats.length ? cats : CATS).join(', '),
      maxMB: Math.min(40, num_(c.maxMB) || 20), guideUrl: clip_(c.guideUrl, 500), eventDate: str_(c.eventDate), venue: clip_(c.venue, 200),
      resultsPublic: !!c.resultsPublic, enabled: c.enabled !== false, note: clip_(c.note, 2000), updatedAt: nowIso_(),
      folderUrl: str_(c.folderUrl) ? 'https://drive.google.com/drive/folders/' + folderIdFromUrl_(c.folderUrl) : ''
    });
  });
  clearCatalog_();
  return listCalls_();
}
function deleteCall_(id) {
  if (table_('Submissions').rows.some(function (s) { return str_(s.callId) === str_(id); })) throw new Error('รอบนี้มีผลงานส่งเข้ามาแล้ว ลบไม่ได้ (ปิดการใช้งานแทนได้)');
  mutate_('Calls', function (rows, t) { t.rows = rows.filter(function (x) { return str_(x.callId) !== str_(id); }); });
  clearCatalog_();
  return listCalls_();
}

/* ============================================================
 *  ADMIN: SUBMISSIONS
 * ============================================================ */
function listSubsAdmin_() {
  return table_('Submissions').rows.map(function (s) { const o = subPublic_(s); o.email = str_(s.email); o.score = str_(s.score); o.fileUrl = str_(s.fileUrl); o.fileId = str_(s.fileId); o.mimeType = str_(s.mimeType); o.log = str_(s.log); return o; })
    .sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
}
function saveSubAdmin_(r) {
  let mail = null;
  const out = mutate_('Submissions', function (rows) {
    const s = rows.filter(function (x) { return str_(x.subId) === str_(r.subId); })[0];
    if (!s) throw new Error('ไม่พบผลงาน');
    const old = str_(s.status);
    if (r.status !== undefined) { if (SUB_STATUS.indexOf(r.status) < 0) throw new Error('สถานะไม่ถูกต้อง'); s.status = r.status; }
    ['reviewNote', 'score', 'title', 'authors', 'department', 'category', 'keywords'].forEach(function (k) { if (r[k] !== undefined) s[k] = clip_(r[k], k === 'reviewNote' ? 3000 : 600); });
    s.updatedAt = nowIso_();
    if (old !== str_(s.status)) s.log = clip_(str_(s.log) + '\n' + nowIso_() + ' เปลี่ยนสถานะ ' + old + ' → ' + s.status + ' (ผู้ดูแล)', 4000);
    if (r.notify) mail = { to: str_(s.email), code: str_(s.code), title: str_(s.title), status: str_(s.status), note: str_(s.reviewNote) };
    return clean_(s);
  });
  let mailed = false;
  if (mail) mailed = sendMail_(mail.to, 'แจ้งสถานะผลงาน ' + mail.code + ': ' + (SUB_STATUS_TH[mail.status] || mail.status), 'สถานะผลงานของคุณ: ' + (SUB_STATUS_TH[mail.status] || mail.status),
    '<p>รหัส: <b>' + esc_(mail.code) + '</b><br>ชื่อผลงาน: ' + esc_(mail.title) + '</p>' + (mail.note ? '<p style="background:#f3f7fb;padding:12px;border-radius:10px">ความเห็นกรรมการ:<br>' + esc_(mail.note).replace(/\n/g, '<br>') + '</p>' : '') +
    (mail.status === 'revise' ? '<p>กรุณาเข้าเมนู "ผลงานของฉัน" บนหน้าเว็บเพื่อแก้ไขและส่งใหม่</p>' : ''));
  clearCatalog_();
  return { sub: out, mailed: mailed };
}
const ABS_LABELS = {
  'ระดับทีม/หน่วยงาน': ['ที่มาและปัญหา', 'เป้าหมาย/วัตถุประสงค์', 'กิจกรรมการพัฒนา', 'ผลลัพธ์', 'บทเรียนและแผนพัฒนาต่อ'],
  'วิจัยและ R2R': ['บทนำ', 'วัตถุประสงค์การวิจัย', 'ระเบียบวิธีวิจัย', 'ผลการวิจัย', 'อภิปรายผลและการนำไปใช้'],
  'CQI': ['สถานการณ์และปัญหา', 'วัตถุประสงค์และตัวชี้วัด', 'กิจกรรมการพัฒนาคุณภาพ', 'ผลลัพธ์การพัฒนา', 'ข้อเสนอแนะและโอกาสพัฒนา'],
  'นวัตกรรม': ['หลักการและเหตุผล', 'วัตถุประสงค์และขอบเขต', 'ขั้นตอนการพัฒนา', 'ผลของนวัตกรรม', 'การนำไปใช้ประโยชน์และข้อจำกัด'],
  'Photo voice': ['ที่มาของภาพ', 'สิ่งที่ต้องการสื่อสาร', 'คำบรรยายภาพ', 'สิ่งที่ได้เรียนรู้', 'ข้อเสนอแนะ']
};
function absText_(s) {
  const L = ABS_LABELS[str_(s.category)] || ['หลักการและเหตุผล', 'วัตถุประสงค์', 'วิธีดำเนินการ', 'ผลการดำเนินงาน', 'สรุปและบทเรียนที่ได้'];
  const parts = [[L[0], s.background], [L[1], s.objective], [L[2], s.method], [L[3], s.result], [L[4], s.conclusion]];
  return parts.filter(function (p) { return str_(p[1]); }).map(function (p) { return '## ' + p[0] + '\n' + str_(p[1]); }).join('\n\n');
}
function importSub_(subId) {
  const s = table_('Submissions').rows.filter(function (x) { return str_(x.subId) === str_(subId); })[0];
  if (!s) throw new Error('ไม่พบผลงาน');
  if (str_(s.workId)) throw new Error('นำเข้าคลังแล้ว');
  if (!str_(s.fileId)) throw new Error('ผลงานนี้ไม่มีไฟล์');
  const id = uuid_();
  mutate_('Works', function (rows) {
    rows.push({ id: id, sourceId: 'submission', year: str_(s.year), category: str_(s.category) || UNCAT, title: str_(s.title), authors: str_(s.authors),
      department: str_(s.department), keywords: str_(s.keywords), summary: clip_(str_(s.conclusion) || str_(s.result) || str_(s.objective), 1200), access: 'verified',
      published: false, featured: false, showThumb: true, locked: true, fileId: str_(s.fileId), fileName: str_(s.fileName), fileUrl: str_(s.fileUrl),
      mimeType: str_(s.mimeType), sizeMB: str_(s.sizeMB), modified: '', ocrStatus: 'pending', ocrNote: 'นำเข้าจากระบบส่งผลงาน ' + str_(s.code), thumbId: '', viewId: '',
      createdAt: nowIso_(), updatedAt: nowIso_(), code: '', award: '', awardRank: '', score: str_(s.score), submissionId: str_(s.subId), abstract: absText_(s) });
  });
  mutate_('Submissions', function (rows) {
    const x = rows.filter(function (y) { return str_(y.subId) === str_(subId); })[0];
    x.workId = id; if (str_(x.status) !== 'accepted') x.status = 'accepted'; x.updatedAt = nowIso_();
    x.log = clip_(str_(x.log) + '\n' + nowIso_() + ' นำเข้าคลังผลงาน', 4000);
  });
  clearCatalog_();
  return { workId: id };
}
