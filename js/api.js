/* ຊັ້ນເຊື່ອມຕໍ່ Google Sheet + ເກັບຂໍ້ມູນໃນເຄື່ອງ (offline) + ຄິວລໍຖ້າສົ່ງ */
(function () {
  var CFG = window.IRRIC5_CONFIG || {};
  var K = { data: 'irric5_data_v1', queue: 'irric5_queue_v1', settings: 'irric5_settings_v1' };

  function jget(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  /* ---------- key helpers (ຕ້ອງກົງກັບ Code.gs) ---------- */
  function normRap(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase(); }
  function normNum(v) {
    if (v === '' || v == null) return '';
    var n = Number(v);
    return isNaN(n) ? String(v).trim() : String(n);
  }
  function keyOf(rap, label, no) { return normRap(rap) + '|' + normNum(label) + '|' + normNum(no); }

  /* ---------- state ---------- */
  var rows = [];
  var index = new Map();      // key -> row
  var fetchedAt = 0;
  var listeners = [];
  var inflight = Promise.resolve();

  function emit(type) { listeners.forEach(function (fn) { try { fn(type); } catch (e) {} }); }
  function on(fn) { listeners.push(fn); }

  function rebuildIndex() {
    index = new Map();
    rows.forEach(function (r) { var k = keyOf(r.rap, r.label, r.no); if (!index.has(k)) index.set(k, r); });
  }

  function applyRecord(row, rec) {
    row.seed = rec.seed; row.h = rec.h.slice(); row.t = rec.t.slice();
    row.hills = rec.hills; row.yield = rec.yield; row.pheno = rec.pheno;
    row.damage = rec.damage; row.spe = rec.spe; row.date = rec.date;
    row._pending = true;
  }

  function overlayQueue() {
    jget(K.queue, []).forEach(function (rec) {
      var row = index.get(keyOf(rec.rap, rec.label, rec.no));
      if (row) applyRecord(row, rec);
    });
  }

  function loadCache() {
    var c = jget(K.data, null);
    if (c && c.rows) { rows = c.rows; fetchedAt = c.ts || 0; rebuildIndex(); }
    return rows;
  }
  function saveCache() { jset(K.data, { ts: fetchedAt, rows: rows }); }

  /* ---------- settings ---------- */
  function settings() {
    var s = jget(K.settings, {});
    return {
      url: (s.url || CFG.GAS_URL || '').trim(),
      key: (s.key != null && s.key !== '') ? s.key : (CFG.PASSCODE || '')
    };
  }
  function saveSettings(url, key) { return jset(K.settings, { url: (url || '').trim(), key: key || '' }); }
  function configured() { return !!settings().url; }

  /* ---------- http ---------- */
  function withQuery(url, params) {
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + q;
  }

  function http(url, opts, ms) {
    var ctl = new AbortController();
    var to = setTimeout(function () { ctl.abort(); }, ms || 30000);
    opts = opts || {};
    opts.signal = ctl.signal;
    opts.redirect = 'follow';
    return fetch(url, opts).then(function (res) { return res.text(); }).then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) { throw new Error('BAD_RESPONSE'); }
      return data;
    }).then(function (d) { clearTimeout(to); return d; }, function (e) { clearTimeout(to); throw e; });
  }

  function ping() {
    var s = settings();
    if (!s.url) return Promise.reject(new Error('NOT_CONFIGURED'));
    return http(withQuery(s.url, { action: 'ping', key: s.key }), {}, 20000).then(function (d) {
      if (!d.ok) throw new Error(d.error || 'SERVER');
      return d;
    });
  }

  function refresh() {
    var s = settings();
    if (!s.url) return Promise.reject(new Error('NOT_CONFIGURED'));
    return http(withQuery(s.url, { action: 'all', key: s.key }), {}, 40000).then(function (d) {
      if (!d.ok) throw new Error(d.error || 'SERVER');
      rows = d.rows || [];
      rebuildIndex();
      overlayQueue();
      fetchedAt = Date.now();
      saveCache();
      emit('data');
      return rows;
    });
  }

  /* ---------- queries ---------- */
  function getRows() { return rows; }
  function lastFetched() { return fetchedAt; }
  function raps() {
    var set = {};
    rows.forEach(function (r) { set[r.rap] = true; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
  }
  function find(rap, label) {
    var rr = normRap(rap), ll = normNum(label);
    return rows.filter(function (r) { return normRap(r.rap) === rr && normNum(r.label) === ll; });
  }

  /* ---------- queue ---------- */
  function queue() { return jget(K.queue, []); }
  function queueLength() { return queue().length; }

  function enqueue(rec) {
    var k = keyOf(rec.rap, rec.label, rec.no);
    var q = queue().filter(function (x) { return keyOf(x.rap, x.label, x.no) !== k; });
    q.push(rec);
    if (!jset(K.queue, q)) throw new Error('STORAGE');
    var row = index.get(k);
    if (row) { applyRecord(row, rec); saveCache(); }
    emit('queue');
  }

  function runFlush() {
    var q = queue();
    if (!q.length) return Promise.resolve({ sent: 0, failed: [] });
    var s = settings();
    if (!s.url) return Promise.reject(new Error('NOT_CONFIGURED'));
    return http(s.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'save', key: s.key, records: q })
    }, 60000).then(function (d) {
      if (!d.ok) throw new Error(d.error || 'SERVER');
      var done = {}, failed = [], sent = 0;
      (d.results || []).forEach(function (r) {
        if (r.ok) { done[r.id] = true; sent++; }
        else if (r.error === 'NOT_FOUND') { done[r.id] = true; failed.push(r); }
      });
      jset(K.queue, queue().filter(function (x) { return !done[x.id]; }));
      // ລຶບເຄື່ອງໝາຍ "ຍັງບໍ່ໄດ້ສົ່ງ" ຂອງແຖວທີ່ສົ່ງສຳເລັດ
      var left = {};
      queue().forEach(function (x) { left[keyOf(x.rap, x.label, x.no)] = true; });
      rows.forEach(function (r) { if (r._pending && !left[keyOf(r.rap, r.label, r.no)]) delete r._pending; });
      saveCache();
      emit('queue');
      return { sent: sent, failed: failed };
    });
  }

  // ສົ່ງຄິວແບບລຽງຕາມລຳດັບ (ບໍ່ໃຫ້ຊ້ອນກັນ)
  function flush() {
    inflight = inflight.then(runFlush, runFlush);
    return inflight;
  }

  window.API = {
    on: on, settings: settings, saveSettings: saveSettings, configured: configured,
    loadCache: loadCache, refresh: refresh, ping: ping, getRows: getRows, lastFetched: lastFetched,
    raps: raps, find: find, enqueue: enqueue, flush: flush, queueLength: queueLength
  };
})();
