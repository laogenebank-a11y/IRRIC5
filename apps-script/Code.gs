/**
 * IRRIC5 - Google Apps Script backend (Web App)
 * ------------------------------------------------------------
 * ໃຊ້ຄູ່ກັບ Google Sheet ທີ່ມີ 2 ຊີດ:
 *   1) ຊີດລາຍຊື່ແນວພັນ   : ຂໍ້ມູນ                  (ຫົວຕາຕະລາງ 1 ແຖວ)
 *   2) ຊີດບັນທຶກຂໍ້ມູນ    : ຕາຕະລາງບັນທືກຂໍ້ມູນ       (ຫົວຕາຕະລາງ 2 ແຖວ)
 *
 * ຄໍລຳໃນຊີດບັນທຶກຂໍ້ມູນ:
 *   A Rap | B ເລກປ້າຍ | C ຊື່ແນວພັນ | D No of this year
 *   E SeedEst | F-J PltHgt ຕົ້ນ 1-5 | K-O Tillers ຕົ້ນ 1-5
 *   P No of hills | Q GrainYield | R PhenoAccep | S Damage | T SpeChar
 *   U ວັນທີ່ບັນທຶກ (ເພີ່ມອັດຕະໂນມັດ) | V ເວລາອັບເດດລ່າສຸດ (ເພີ່ມອັດຕະໂນມັດ)
 */

const VERSION = '1.0.0';

const CONFIG = {
  // ຊື່ຊີດ (ຖ້າຊື່ບໍ່ກົງ ລະບົບຈະໃຊ້ຊີດທີ 1 = ລາຍຊື່, ຊີດທີ 2 = ບັນທຶກຂໍ້ມູນ)
  MASTER_SHEET: 'ຂໍ້ມູນ',
  DATA_SHEET: 'ຕາຕະລາງບັນທືກຂໍ້ມູນ',

  // ລະຫັດຜ່ານ (ປ່ອຍວ່າງ '' = ບໍ່ໃຊ້). ຖ້າຕັ້ງ ຕ້ອງໃສ່ລະຫັດດຽວກັນໃນໜ້າ "ຕັ້ງຄ່າ" ຂອງແອັບ
  PASSCODE: '',

  MASTER_HEADER_ROWS: 1,
  DATA_HEADER_ROWS: 2,

  // true = ຖ້າມີແນວພັນໃໝ່ໃນຊີດລາຍຊື່ ທີ່ຍັງບໍ່ມີໃນຊີດບັນທຶກ ໃຫ້ເພີ່ມເຂົ້າໃຫ້ອັດຕະໂນມັດ
  // (ຄ່າເລີ່ມຕົ້ນ false: ໃຊ້ຊີດບັນທຶກເປັນແຫຼ່ງຂໍ້ມູນຫຼັກ)
  AUTO_SYNC_MASTER: false,
};

const COL = {
  RAP: 1, LABEL: 2, NAME: 3, NO: 4,
  SEED: 5, H1: 6, T1: 11, HILLS: 16, YIELD: 17, PHENO: 18, DAMAGE: 19, SPE: 20,
  DATE: 21, UPDATED: 22,
};
const N_COLS = 22;          // A..V
const WRITE_COLS = 18;      // E..V

/* ===================== Web App entry points ===================== */

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    checkAuth_(p.key);
    const action = p.action || 'ping';
    if (action === 'ping') {
      return json_({ ok: true, version: VERSION, time: new Date().toISOString() });
    }
    if (action === 'all') {
      return json_({ ok: true, version: VERSION, rows: readAll_(), serverTime: new Date().toISOString() });
    }
    return json_({ ok: false, error: 'UNKNOWN_ACTION' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkAuth_(body.key);
    if (body.action === 'save') {
      return json_(saveRecords_(body.records || []));
    }
    return json_({ ok: false, error: 'UNKNOWN_ACTION' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ===================== Helpers ===================== */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkAuth_(key) {
  if (CONFIG.PASSCODE && String(key || '') !== String(CONFIG.PASSCODE)) {
    throw new Error('UNAUTHORIZED');
  }
}

function getSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const all = ss.getSheets();
  const master = ss.getSheetByName(CONFIG.MASTER_SHEET) || all[0];
  const data = ss.getSheetByName(CONFIG.DATA_SHEET) || (all.length > 1 ? all[1] : all[0]);
  return { ss: ss, master: master, data: data };
}

function normRap_(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase();
}
function normNum_(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  return isNaN(n) ? String(v).trim() : String(n);
}
function keyOf_(rap, label, no) {
  return normRap_(rap) + '|' + normNum_(label) + '|' + normNum_(no);
}
function numOrBlank_(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  return isNaN(n) ? '' : n;
}
function strOrBlank_(v) {
  return v == null ? '' : String(v);
}
function cellText_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return v == null ? '' : v;
}
function cellStamp_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  return v == null ? '' : v;
}

/** ເພີ່ມຫົວຄໍລຳ U, V ແລະຮັບປະກັນວ່າມີຄໍລຳພຽງພໍ (ເຮັດຄັ້ງທຳອິດຄັ້ງດຽວ) */
function ensureLayout_(sh) {
  if (sh.getMaxColumns() < N_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), N_COLS - sh.getMaxColumns());
  }
  const first = CONFIG.DATA_HEADER_ROWS + 1;
  if (String(sh.getRange(1, COL.DATE).getValue()) === '') {
    sh.getRange(1, COL.DATE).setValue('ວັນທີ່ບັນທຶກ Date');
    sh.getRange(1, COL.UPDATED).setValue('ອັບເດດລ່າສຸດ Updated');
    if (CONFIG.DATA_HEADER_ROWS >= 2) {
      try { sh.getRange(1, COL.DATE, 2, 1).merge(); } catch (e) {}
      try { sh.getRange(1, COL.UPDATED, 2, 1).merge(); } catch (e) {}
    }
    const rows = Math.max(sh.getMaxRows() - first + 1, 1);
    sh.getRange(first, COL.DATE, rows, 2).setNumberFormat('@'); // ເກັບເປັນຂໍ້ຄວາມ ບໍ່ໃຫ້ປ່ຽນຮູບແບບວັນທີ່
    sh.getRange(1, COL.DATE, 2, 2).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle');
  }
}

/** ສ້າງ Map: key(rap|label|no) -> ເລກແຖວໃນຊີດ */
function indexData_(sh) {
  const first = CONFIG.DATA_HEADER_ROWS + 1;
  const last = sh.getLastRow();
  const map = new Map();
  if (last < first) return map;
  const vals = sh.getRange(first, 1, last - first + 1, 4).getValues();
  for (let i = 0; i < vals.length; i++) {
    const r = vals[i];
    if (r[0] === '' && r[1] === '') continue;
    const k = keyOf_(r[0], r[1], r[3]);
    if (!map.has(k)) map.set(k, first + i);
  }
  return map;
}

function syncMaster_(s) {
  if (s.master.getSheetId() === s.data.getSheetId()) return 0;
  const mFirst = CONFIG.MASTER_HEADER_ROWS + 1;
  const mLast = s.master.getLastRow();
  if (mLast < mFirst) return 0;
  const m = s.master.getRange(mFirst, 1, mLast - mFirst + 1, 4).getValues();
  const existing = indexData_(s.data);
  const add = [];
  m.forEach(function (r) {
    if (r[0] === '' || r[1] === '') return;
    const k = keyOf_(r[0], r[1], r[3]);
    if (!existing.has(k)) { add.push([r[0], r[1], r[2], r[3]]); existing.set(k, -1); }
  });
  if (add.length) {
    const start = Math.max(s.data.getLastRow(), CONFIG.DATA_HEADER_ROWS) + 1;
    s.data.getRange(start, 1, add.length, 4).setValues(add);
  }
  return add.length;
}

/* ===================== Read ===================== */

function readAll_() {
  const s = getSheets_();
  const sh = s.data;
  ensureLayoutWithLock_(sh, s);
  const first = CONFIG.DATA_HEADER_ROWS + 1;
  const last = sh.getLastRow();
  if (last < first) return [];
  const vals = sh.getRange(first, 1, last - first + 1, N_COLS).getValues();
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v[0] === '' && v[1] === '') continue;
    out.push({
      row: first + i,
      rap: String(v[0]).trim(),
      label: normNum_(v[1]),
      name: strOrBlank_(v[2]).trim(),
      no: normNum_(v[3]),
      seed: v[4],
      h: [v[5], v[6], v[7], v[8], v[9]],
      t: [v[10], v[11], v[12], v[13], v[14]],
      hills: v[15],
      yield: v[16],
      pheno: v[17],
      damage: v[18],
      spe: strOrBlank_(v[19]),
      date: cellText_(v[20]),
      updated: cellStamp_(v[21]),
    });
  }
  return out;
}

function ensureLayoutWithLock_(sh, s) {
  const needLayout = sh.getMaxColumns() < N_COLS || String(sh.getRange(1, COL.DATE).getValue()) === '';
  if (!needLayout && !CONFIG.AUTO_SYNC_MASTER) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    ensureLayout_(sh);
    if (CONFIG.AUTO_SYNC_MASTER) syncMaster_(s);
  } finally {
    lock.releaseLock();
  }
}

/* ===================== Write ===================== */

function saveRecords_(records) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const s = getSheets_();
    const sh = s.data;
    ensureLayout_(sh);
    if (CONFIG.AUTO_SYNC_MASTER) syncMaster_(s);
    const idx = indexData_(sh);
    const tz = Session.getScriptTimeZone();
    const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
    const results = [];

    records.forEach(function (rec) {
      const k = keyOf_(rec.rap, rec.label, rec.no);
      const row = idx.get(k);
      if (!row || row < 0) {
        results.push({ id: rec.id, key: k, ok: false, error: 'NOT_FOUND' });
        return;
      }
      const h = rec.h || [], t = rec.t || [];
      const arr = [
        numOrBlank_(rec.seed),
        numOrBlank_(h[0]), numOrBlank_(h[1]), numOrBlank_(h[2]), numOrBlank_(h[3]), numOrBlank_(h[4]),
        numOrBlank_(t[0]), numOrBlank_(t[1]), numOrBlank_(t[2]), numOrBlank_(t[3]), numOrBlank_(t[4]),
        numOrBlank_(rec.hills),
        numOrBlank_(rec.yield),
        numOrBlank_(rec.pheno),
        numOrBlank_(rec.damage),
        strOrBlank_(rec.spe),
        strOrBlank_(rec.date),
        stamp,
      ];
      sh.getRange(row, COL.SEED, 1, WRITE_COLS).setValues([arr]);
      results.push({ id: rec.id, key: k, ok: true, row: row, updated: stamp });
    });

    SpreadsheetApp.flush();
    return { ok: true, results: results };
  } finally {
    lock.releaseLock();
  }
}

/* ===================== Manual test (ກົດ Run ເພື່ອຢືນຢັນສິດ ແລະ ກວດຊີດ) ===================== */

function setupCheck() {
  const s = getSheets_();
  Logger.log('ຊີດລາຍຊື່  : ' + s.master.getName() + ' (' + s.master.getLastRow() + ' ແຖວ)');
  Logger.log('ຊີດບັນທຶກ  : ' + s.data.getName() + ' (' + s.data.getLastRow() + ' ແຖວ)');
  ensureLayout_(s.data);
  const rows = readAll_();
  Logger.log('ອ່ານໄດ້ ' + rows.length + ' ແຖວ, ຕົວຢ່າງ: ' + JSON.stringify(rows[0]));
  const seen = {};
  const dups = [];
  rows.forEach(function (r) {
    const k = keyOf_(r.rap, r.label, r.no);
    if (seen[k]) dups.push(r.rap + ' ' + r.label);
    seen[k] = true;
  });
  Logger.log(dups.length ? 'ເຕືອນ: ພົບຄີຊ້ຳ ' + dups.join(', ') : 'ບໍ່ພົບຄີຊ້ຳ');
}
