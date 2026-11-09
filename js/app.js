/* IRRIC5 - ໂລຈິກຫຼັກຂອງແອັບ (ໜ້າຫຼັກ / ອັບເດດຂໍ້ມູນ / ເບິ່ງຂໍ້ມູນ) */
(function () {
  'use strict';

  var CFG = window.IRRIC5_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var state = {
    view: 'home',
    current: null,      // ແຖວທີ່ເລືອກໃນຟອມ
    preferNo: null,     // ໃຊ້ເລືອກແຖວຕອນມີເລກປ້າຍຊ້ຳ
    pheno: '',
    dirty: false,
    saving: false,
    limit: 100,
    filter: { rap: '', label: '', status: 'all' }
  };

  /* ---------------- utils ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad3(n) {
    var s = String(n == null ? '' : n);
    return /^\d+$/.test(s) ? s.padStart(3, '0') : s;
  }
  function todayStr() {
    var d = new Date(); // ໃຊ້ເວລາທ້ອງຖິ່ນຂອງມືຖື (ບໍ່ແມ່ນ UTC)
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function isBlank(v) { return v === '' || v == null; }
  function hasAny(r) {
    if (!isBlank(r.seed) || !isBlank(r.hills) || !isBlank(r.yield) || !isBlank(r.pheno) || !isBlank(r.damage) || !isBlank(r.spe)) return true;
    return (r.h || []).some(function (x) { return !isBlank(x); }) || (r.t || []).some(function (x) { return !isBlank(x); });
  }
  var toastTimer;
  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 3000);
  }
  function errText(e) {
    var m = (e && e.message) || String(e);
    if (m === 'UNAUTHORIZED') return t('errAuth');
    if (m === 'BAD_RESPONSE') return t('errBadResp');
    if (m === 'NOT_CONFIGURED') return t('needSetup');
    if (m === 'STORAGE') return t('errStorage');
    return t('errNetwork');
  }

  /* ---------------- router ---------------- */
  var TITLES = { home: null, update: 'homeUpdate', data: 'homeView' };

  function show(view) {
    state.view = view;
    ['home', 'update', 'data'].forEach(function (v) { $('view-' + v).hidden = (v !== view); });
    $('btnBack').hidden = (view === 'home');
    $('title').textContent = TITLES[view] ? t(TITLES[view]) : 'IRRIC5';
    window.scrollTo(0, 0);
    if (view === 'home') updateHome();
    if (view === 'update') enterUpdate();
    if (view === 'data') enterData();
  }
  function go(view) {
    if (location.hash !== '#/' + view) history.pushState({ view: view }, '', '#/' + view);
    show(view);
  }
  function guardedGo(view) {
    if (state.view === 'update' && state.dirty && !confirm(t('leaveWarn'))) return false;
    state.dirty = false;
    go(view);
    return true;
  }
  function viewFromHash() {
    var v = (location.hash || '#/home').replace('#/', '');
    return (v === 'update' || v === 'data') ? v : 'home';
  }
  window.addEventListener('popstate', function () {
    var v = viewFromHash();
    if (state.view === 'update' && v !== 'update' && state.dirty) {
      if (!confirm(t('leaveWarn'))) { history.pushState({ view: 'update' }, '', '#/update'); return; }
      state.dirty = false;
    }
    show(v);
  });
  // ກັນ refresh / ປິດແທັບ ຕອນມີຂໍ້ມູນທີ່ຍັງບໍ່ໄດ້ບັນທຶກ ຫຼື ຍັງບໍ່ໄດ້ສົ່ງ
  window.addEventListener('beforeunload', function (e) {
    if (state.dirty || API.queueLength() > 0) { e.preventDefault(); e.returnValue = ''; return ''; }
  });

  /* ---------------- status bar ---------------- */
  function updateStatus() {
    var on = navigator.onLine;
    $('netDot').className = 'dot ' + (on ? 'on' : 'off');
    $('netText').textContent = on ? t('online') : t('offline');
    var n = API.queueLength();
    $('pendText').textContent = n > 0 ? t('pending', { n: n }) : t('allSynced');
    $('btnSync').hidden = !(n > 0 && on);
  }
  function updateHome() {
    $('setupWarn').hidden = API.configured();
    $('verText').textContent = CFG.APP_VERSION || '';
  }
  API.on(function () { updateStatus(); });
  window.addEventListener('online', function () { updateStatus(); autoSync(); backgroundRefresh(); });
  window.addEventListener('offline', updateStatus);

  function autoSync() {
    if (!navigator.onLine || !API.configured() || API.queueLength() === 0) return;
    API.flush().then(function (r) {
      if (r && r.failed && r.failed.length) toast(t('errRowGone'), 5000);
      if (state.view === 'data') renderData();
    }).catch(function () {});
  }
  setInterval(autoSync, 30000);

  var refreshing = null;
  function backgroundRefresh(force) {
    if (!navigator.onLine || !API.configured()) return Promise.resolve();
    if (!force && Date.now() - API.lastFetched() < 60000) return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = API.refresh().then(function () {
      if (state.view === 'update') { fillRapOptions('fRap'); lookup(true); }
      if (state.view === 'data') { fillRapOptions('vRap', true); renderData(); }
    }).catch(function (e) {
      if (force) toast(t('loadFail') + ': ' + errText(e), 4500);
    }).then(function () { refreshing = null; });
    return refreshing;
  }

  /* ---------------- rap selects ---------------- */
  function fillRapOptions(selId, withAll) {
    var sel = $(selId), cur = sel.value;
    var raps = API.raps();
    if (!raps.length && !withAll) raps = [];
    var html = withAll ? '<option value="">' + esc(t('all')) + '</option>' : '<option value="">' + esc(t('chooseRap')) + '</option>';
    raps.forEach(function (r) { html += '<option value="' + esc(r) + '">' + esc(r) + '</option>'; });
    sel.innerHTML = html;
    if (cur && raps.indexOf(cur) >= 0) sel.value = cur;
  }

  /* ---------------- UPDATE view ---------------- */
  var NUM_IDS = ['in_seed', 'in_hills', 'in_yield', 'in_damage'];

  function buildFormOnce() {
    var gh = '', gt = '', ph = '';
    for (var i = 0; i < 5; i++) {
      gh += '<div class="cell"><span>' + (i + 1) + '</span><input type="text" class="num" id="in_h_' + i + '" inputmode="decimal" enterkeyhint="next"></div>';
      gt += '<div class="cell"><span>' + (i + 1) + '</span><input type="text" class="num" id="in_t_' + i + '" inputmode="decimal" enterkeyhint="next"></div>';
    }
    $('gridH').innerHTML = gh;
    $('gridT').innerHTML = gt;
    for (var p = 1; p <= 10; p++) ph += '<button type="button" data-v="' + p + '">' + p + '</button>';
    $('phenoBox').innerHTML = ph;

    // ບັງຄັບໃຫ້ພິມໄດ້ສະເພາະຕົວເລກ
    $('fields').addEventListener('input', function (e) {
      var el = e.target;
      if (el.classList && el.classList.contains('num')) {
        var v = el.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
        var first = v.indexOf('.');
        if (first >= 0) v = v.slice(0, first + 1) + v.slice(first + 1).replace(/\./g, '');
        if (v !== el.value) el.value = v;
        el.classList.remove('invalid');
      }
      state.dirty = true;
    });
    $('phenoBox').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      setPheno(state.pheno === b.dataset.v ? '' : b.dataset.v);
      state.dirty = true;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    });
    $('fLabel').addEventListener('input', function () {
      var v = $('fLabel').value.replace(/[^0-9]/g, '');
      if (v !== $('fLabel').value) $('fLabel').value = v;
      state.preferNo = null;
      lookup();
    });
    $('fRap').addEventListener('change', function () { state.preferNo = null; lookup(); });

    // Enter = ໄປຊ່ອງຕໍ່ໄປ (ສະດວກເວລາປ້ອນໃນນາ)
    $('form').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      var els = Array.prototype.slice.call($('form').querySelectorAll('input[type=text],input[type=date],textarea'));
      var i = els.indexOf(e.target);
      if (i >= 0 && i < els.length - 1) els[i + 1].focus(); else e.target.blur();
    });
    $('form').addEventListener('submit', function (e) { e.preventDefault(); onSave(); });
  }

  function setPheno(v) {
    state.pheno = v || '';
    Array.prototype.forEach.call($('phenoBox').children, function (b) {
      b.classList.toggle('sel', b.dataset.v === state.pheno);
    });
  }

  function clearFields() {
    NUM_IDS.forEach(function (id) { $(id).value = ''; });
    for (var i = 0; i < 5; i++) { $('in_h_' + i).value = ''; $('in_t_' + i).value = ''; }
    $('in_spe').value = '';
    setPheno('');
    clearInvalid();
  }
  function fillFields(r) {
    var v = function (x) { return isBlank(x) ? '' : String(x); };
    $('in_seed').value = v(r.seed);
    $('in_hills').value = v(r.hills);
    $('in_yield').value = v(r.yield);
    $('in_damage').value = v(r.damage);
    for (var i = 0; i < 5; i++) { $('in_h_' + i).value = v((r.h || [])[i]); $('in_t_' + i).value = v((r.t || [])[i]); }
    $('in_spe').value = v(r.spe);
    setPheno(isBlank(r.pheno) ? '' : String(r.pheno));
  }
  function clearInvalid() {
    Array.prototype.forEach.call(document.querySelectorAll('.invalid'), function (el) { el.classList.remove('invalid'); });
    $('formErr').hidden = true;
  }

  function enterUpdate() {
    fillRapOptions('fRap');
    if (!state.keepForm) {
      $('fDate').value = todayStr();
      $('fRap').value = '';
      $('fLabel').value = '';
      state.current = null;
      state.dirty = false;
      clearFields();
      lookup();
    }
    state.keepForm = false;
    backgroundRefresh();
  }

  function lookup(fromRefresh) {
    var rap = $('fRap').value, lab = $('fLabel').value.trim();
    var prev = state.current;
    var matches = (rap && lab) ? API.find(rap, lab) : [];
    var amb = $('ambig');
    amb.hidden = true; amb.innerHTML = '';
    var cur = null;

    if (matches.length === 1) {
      cur = matches[0];
    } else if (matches.length > 1) {
      var pick = null;
      if (state.preferNo != null) pick = matches.filter(function (m) { return String(m.no) === String(state.preferNo); })[0] || null;
      if (!pick && prev) pick = matches.filter(function (m) { return m.row === prev.row; })[0] || null;
      var html = '<div><b>' + esc(t('ambig')) + '</b></div>';
      matches.forEach(function (m) {
        html += '<label><input type="radio" name="amb" value="' + m.row + '"' + (pick && pick.row === m.row ? ' checked' : '') + '> ' +
          esc(m.name || t('blankVar')) + ' · No ' + esc(pad3(m.no)) + '</label>';
      });
      amb.innerHTML = html; amb.hidden = false;
      Array.prototype.forEach.call(amb.querySelectorAll('input'), function (inp) {
        inp.addEventListener('change', function () {
          var row = parseInt(inp.value, 10);
          state.current = matches.filter(function (m) { return m.row === row; })[0] || null;
          applyCurrent(null);
        });
      });
      cur = pick;
    }

    var sameRecord = prev && cur && prev.row === cur.row;
    state.current = cur;
    applyCurrent((fromRefresh === true || sameRecord) ? prev : null, matches, rap, lab, fromRefresh === true);
  }

  function applyCurrent(prev, matches, rap, lab, keepValues) {
    var nameEl = $('fName'), noEl = $('fNo'), cur = state.current;
    nameEl.className = 'readout';
    if (cur) {
      if (cur.name) nameEl.textContent = cur.name;
      else { nameEl.textContent = t('blankVar'); nameEl.classList.add('empty'); }
      noEl.textContent = pad3(cur.no);
    } else {
      noEl.textContent = '—';
      if (!API.getRows().length) { nameEl.textContent = t('noList'); nameEl.classList.add('bad'); }
      else if ((rap || $('fRap').value) && ($('fLabel').value.trim()) && (!matches || !matches.length)) { nameEl.textContent = t('notFound'); nameEl.classList.add('bad'); }
      else if (matches && matches.length > 1) { nameEl.textContent = '…'; nameEl.classList.add('empty'); }
      else { nameEl.textContent = t('waitInput'); nameEl.classList.add('empty'); }
    }
    // ເມື່ອປ່ຽນໄປແຖວໃໝ່ → ໂຫຼດຄ່າເກົ່າ (ຖ້າມີ) ມາໃສ່ຟອມ
    // (ຖ້າຍັງພິມເລກປ້າຍບໍ່ຄົບ ຈະບໍ່ລ້າງຂໍ້ມູນທີ່ປ້ອນໄວ້ — ຈະປ່ຽນກໍຕໍ່ເມື່ອພົບແຖວໃໝ່ເທົ່ານັ້ນ)
    var changed = !(prev && cur && prev.row === cur.row);
    if (changed && cur) {
      fillFields(cur);
      state.dirty = false;
    }
    $('hasData').hidden = !(cur && hasAny(cur));
  }

  function collect() {
    var g = function (id) { return $(id).value.trim(); };
    var num = function (v) { return v === '' ? '' : Number(v); };
    var h = [], tt = [];
    for (var i = 0; i < 5; i++) { h.push(num(g('in_h_' + i))); tt.push(num(g('in_t_' + i))); }
    return {
      id: uid(),
      rap: state.current.rap, label: state.current.label, no: state.current.no,
      date: $('fDate').value,
      seed: num(g('in_seed')), h: h, t: tt,
      hills: num(g('in_hills')), yield: num(g('in_yield')),
      pheno: state.pheno === '' ? '' : Number(state.pheno),
      damage: num(g('in_damage')),
      spe: g('in_spe'),
      ts: Date.now()
    };
  }

  function validate() {
    clearInvalid();
    var errs = [], firstEl = null;
    function bad(el, msg) { if (el) el.classList.add('invalid'); if (!firstEl && el) firstEl = el; errs.push(msg); }

    if (!state.current) {
      bad($('fLabel'), t('errNoRecord'));
    }
    if (!$('fDate').value) bad($('fDate'), t('errDate'));

    var ids = NUM_IDS.slice();
    for (var i = 0; i < 5; i++) { ids.push('in_h_' + i); ids.push('in_t_' + i); }
    var any = false;
    ids.forEach(function (id) {
      var v = $(id).value.trim();
      if (v === '') return;
      any = true;
      if (!/^\d+(\.\d+)?$/.test(v)) bad($(id), t('errNum'));
    });
    if (state.pheno !== '') {
      any = true;
      var p = Number(state.pheno);
      if (!(p >= 1 && p <= 10)) bad(null, t('errPheno'));
    }
    if ($('in_spe').value.trim() !== '') any = true;
    if (!any && !errs.length) bad($('in_seed'), t('errEmpty'));

    if (errs.length) {
      var uniq = errs.filter(function (m, i) { return errs.indexOf(m) === i; });
      $('formErr').textContent = uniq.join(' • ');
      $('formErr').hidden = false;
      if (firstEl) { firstEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); try { firstEl.focus(); } catch (e) {} }
      return false;
    }
    return true;
  }

  function onSave() {
    if (state.saving) return;
    if (!validate()) return;
    var btn = $('btnSave');
    state.saving = true; btn.disabled = true; btn.textContent = t('saving');

    var rec = collect();
    try { API.enqueue(rec); }
    catch (e) {
      state.saving = false; btn.disabled = false; btn.textContent = t('save');
      $('formErr').textContent = errText(e); $('formErr').hidden = false;
      return;
    }

    var p = Promise.resolve({ synced: false, failed: [], err: null });
    if (!API.configured()) p = Promise.resolve({ synced: false, failed: [], err: new Error('NOT_CONFIGURED') });
    else if (navigator.onLine) {
      p = API.flush().then(function (r) {
        return { synced: API.queueLength() === 0, failed: r.failed || [], err: null };
      }).catch(function (e) { return { synced: false, failed: [], err: e }; });
    }

    p.then(function (res) {
      state.saving = false; btn.disabled = false; btn.textContent = t('save');
      state.dirty = false;
      if (res.failed.length) {
        $('formErr').textContent = t('errRowGone'); $('formErr').hidden = false;
        return;
      }
      openSaved(res);
    });
  }

  function openSaved(res) {
    var synced = res.synced;
    $('savedMsg').textContent = synced ? t('savedMsg') : t('savedOffline');
    $('savedMark').className = 'okmark' + (synced ? '' : ' warn');
    $('savedMark').textContent = synced ? '✓' : '⏳';
    $('savedErr').textContent = (!synced && res.err) ? errText(res.err) : '';
    var dlg = $('dlgSaved');
    if (!dlg.open) dlg.showModal();
  }

  /* ---------------- VIEW DATA ---------------- */
  function enterData() {
    fillRapOptions('vRap', true);
    $('vRap').value = state.filter.rap;
    $('vLabel').value = state.filter.label;
    $('vStatus').value = state.filter.status;
    state.limit = 100;
    renderData();
    backgroundRefresh();
  }

  function filteredRows() {
    var f = state.filter, q = f.label.trim();
    return API.getRows().filter(function (r) {
      if (f.rap && r.rap !== f.rap) return false;
      if (q && String(r.label).indexOf(q) < 0) return false;
      if (f.status === 'filled' && !hasAny(r)) return false;
      if (f.status === 'empty' && hasAny(r)) return false;
      return true;
    });
  }

  function cell(v) { return isBlank(v) ? '' : esc(v); }

  function renderData() {
    var out = $('dataOut');
    var all = API.getRows();
    var info = $('vInfo');
    var lf = API.lastFetched();
    var when = lf ? (t('lastLoaded') + ': ' + new Date(lf).toLocaleString()) : '';

    if (!all.length) {
      info.textContent = '';
      out.innerHTML = '<div class="card"><div class="note warn">' + esc(API.configured() ? t('noList') : t('needSetup')) + '</div></div>';
      return;
    }

    var rows = filteredRows();
    var f = state.filter, q = f.label.trim();
    info.textContent = when;

    // ເລືອກ Rap + ເລກປ້າຍ ຄົບ (ກົງເປ໊ະ) → ສະແດງເປັນກາດ
    if (f.rap && q) {
      var exact = rows.filter(function (r) { return String(r.label) === q; });
      if (exact.length) {
        out.innerHTML = exact.map(cardHTML).join('') +
          '<button class="btn ghost" id="btnShowAll" type="button">' + esc(t('showAll')) + '</button>';
        return;
      }
    }

    if (!rows.length) { out.innerHTML = '<div class="card"><p class="muted">' + esc(t('noData')) + '</p></div>'; return; }

    var shown = rows.slice(0, state.limit);
    var h = '<p class="muted small" style="margin:0 0 6px">' + esc(t('tipClick')) + '</p>';
    h += '<div class="tbl-wrap"><table class="grid"><thead>';
    h += '<tr>' +
      '<th rowspan="2" class="c1">Rap</th><th rowspan="2" class="c2">' + esc(t('label')) + '</th>' +
      '<th rowspan="2" class="l">' + esc(t('varName')) + '</th><th rowspan="2">No WS2026</th>' +
      '<th rowspan="2">SeedEst</th><th colspan="5">PltHgt (cm)</th><th colspan="5">Tillers</th>' +
      '<th rowspan="2">Hills</th><th rowspan="2">GrainYield</th><th rowspan="2">PhenoAccep</th><th rowspan="2">Damage</th>' +
      '<th rowspan="2" class="l">SpeChar</th><th rowspan="2">' + esc(t('recDate')) + '</th></tr>';
    h += '<tr>';
    for (var k = 0; k < 2; k++) for (var i = 1; i <= 5; i++) h += '<th>' + i + '</th>';
    h += '</tr></thead><tbody>';
    shown.forEach(function (r) {
      h += '<tr' + (r._pending ? ' class="pend"' : '') + '>' +
        '<td class="c1">' + esc(r.rap) + '</td>' +
        '<td class="c2"><a class="lbl-link" data-row="' + r.row + '">' + esc(r.label) + '</a></td>' +
        '<td class="nm">' + (r.name ? esc(r.name) : '<i>' + esc(t('blankVar')) + '</i>') + '</td>' +
        '<td>' + esc(pad3(r.no)) + '</td>' +
        '<td>' + cell(r.seed) + '</td>';
      for (var a = 0; a < 5; a++) h += '<td>' + cell((r.h || [])[a]) + '</td>';
      for (var b = 0; b < 5; b++) h += '<td>' + cell((r.t || [])[b]) + '</td>';
      h += '<td>' + cell(r.hills) + '</td><td>' + cell(r.yield) + '</td><td>' + cell(r.pheno) + '</td><td>' + cell(r.damage) + '</td>' +
        '<td class="nm">' + cell(r.spe) + '</td><td>' + cell(r.date) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="muted small" style="text-align:center">' + esc(t('showing', { n: shown.length, m: rows.length })) + '</p>';
    if (rows.length > shown.length) h += '<button class="btn ghost more" id="btnMore" type="button">' + esc(t('showMore')) + '</button>';
    out.innerHTML = h;
  }

  function kv(label, val) {
    return '<div><small>' + esc(label) + '</small><b>' + (isBlank(val) ? '—' : esc(val)) + '</b></div>';
  }
  function mini5(label, arr) {
    var h = '<div class="full"><small>' + esc(label) + '</small><div class="mini5">';
    for (var i = 0; i < 5; i++) h += '<div><span>' + (i + 1) + '</span><b>' + (isBlank((arr || [])[i]) ? '—' : esc(arr[i])) + '</b></div>';
    return h + '</div></div>';
  }
  function cardHTML(r) {
    var h = '<div class="card detail">';
    h += '<h3><span style="color:var(--blue)">' + esc(r.label) + '</span> · ' + esc(r.rap) +
      (r._pending ? ' <span class="badge">' + esc(t('unsynced')) + '</span>' : '') + '</h3>';
    h += '<div class="name">' + (r.name ? esc(r.name) : '<i>' + esc(t('blankVar')) + '</i>') + ' · No ' + esc(pad3(r.no)) + '</div>';
    if (!hasAny(r)) h += '<p class="muted">' + esc(t('notEntered')) + '</p>';
    h += '<div class="kv">';
    h += kv('SeedEst', r.seed);
    h += kv(t('recDate'), r.date);
    h += mini5('PltHgt (cm)', r.h);
    h += mini5('No. of Tillers', r.t);
    h += kv('No of hills', r.hills) + kv('GrainYield (g/plot)', r.yield);
    h += kv('PhenoAccep (1-10)', r.pheno) + kv('Damage', r.damage);
    h += '<div class="full"><small>SpeChar</small><b>' + (isBlank(r.spe) ? '—' : esc(r.spe)) + '</b></div>';
    h += '</div>';
    h += '<button class="btn primary" type="button" data-edit="' + r.row + '">✏️ ' + esc(t('edit')) + '</button>';
    h += '</div>';
    return h;
  }

  function startEdit(row) {
    var r = API.getRows().filter(function (x) { return x.row === row; })[0];
    if (!r) return;
    state.keepForm = true;
    go('update');          // enterUpdate ຈະຂ້າມການລ້າງຟອມ
    fillRapOptions('fRap');
    $('fDate').value = todayStr();
    $('fRap').value = r.rap;
    $('fLabel').value = r.label;
    state.preferNo = r.no;
    state.current = null;
    lookup();
    state.dirty = false;
  }

  /* ---------------- settings dialog ---------------- */
  function openSettings() {
    var s = API.settings();
    $('sUrl').value = s.url;
    $('sKey').value = s.key;
    $('sMsg').hidden = true;
    $('dlgSettings').showModal();
  }
  function setMsg(text, cls) {
    var m = $('sMsg'); m.textContent = text; m.className = 'note ' + (cls || 'info'); m.hidden = false;
  }

  /* ---------------- boot ---------------- */
  function init() {
    I18N.apply();
    API.loadCache();
    buildFormOnce();
    $('btnLang').textContent = I18N.lang === 'lo' ? 'EN' : 'ລາວ';
    $('verText').textContent = CFG.APP_VERSION || '';

    $('btnLang').addEventListener('click', function () {
      I18N.set(I18N.lang === 'lo' ? 'en' : 'lo');
      $('btnLang').textContent = I18N.lang === 'lo' ? 'EN' : 'ລາວ';
      $('title').textContent = TITLES[state.view] ? t(TITLES[state.view]) : 'IRRIC5';
      fillRapOptions('fRap'); fillRapOptions('vRap', true);
      $('vRap').value = state.filter.rap;
      if (state.view === 'update') lookup(true);
      if (state.view === 'data') renderData();
      updateStatus();
    });
    $('btnSettings').addEventListener('click', openSettings);
    $('btnBack').addEventListener('click', function () { guardedGo('home'); });
    $('goUpdate').addEventListener('click', function () { go('update'); });
    $('goView').addEventListener('click', function () { go('data'); });
    $('btnSync').addEventListener('click', function () { autoSync(); toast(t('loading'), 1500); });

    // saved dialog
    $('dlgSaved').addEventListener('cancel', function (e) { e.preventDefault(); });
    $('btnHome').addEventListener('click', function () { $('dlgSaved').close(); state.dirty = false; go('home'); });
    $('btnContinue').addEventListener('click', function () {
      $('dlgSaved').close();
      // ເກັບ Rap + ວັນທີ່ໄວ້ ລ້າງສະເພາະເລກປ້າຍ ແລະ ຂໍ້ມູນ
      $('fLabel').value = '';
      state.current = null; state.preferNo = null; state.dirty = false;
      clearFields();
      lookup();
      window.scrollTo(0, 0);
      setTimeout(function () { $('fLabel').focus(); }, 50);
    });

    // settings dialog
    $('btnSetClose').addEventListener('click', function () { $('dlgSettings').close(); });
    $('btnSetSave').addEventListener('click', function () {
      API.saveSettings($('sUrl').value, $('sKey').value);
      setMsg(t('setSaved'), 'info');
      updateHome();
      backgroundRefresh(true);
    });
    $('btnTest').addEventListener('click', function () {
      API.saveSettings($('sUrl').value, $('sKey').value);
      setMsg(t('testing'), 'info');
      API.ping().then(function () {
        setMsg(t('testOk'), 'info');
        updateHome();
        backgroundRefresh(true);
      }).catch(function (e) { setMsg('✗ ' + errText(e), 'warn'); });
    });

    // data view filters
    $('vRap').addEventListener('change', function () { state.filter.rap = $('vRap').value; state.limit = 100; renderData(); });
    $('vLabel').addEventListener('input', function () {
      var v = $('vLabel').value.replace(/[^0-9]/g, '');
      if (v !== $('vLabel').value) $('vLabel').value = v;
      state.filter.label = v; state.limit = 100; renderData();
    });
    $('vStatus').addEventListener('change', function () { state.filter.status = $('vStatus').value; state.limit = 100; renderData(); });
    $('btnReload').addEventListener('click', function () {
      $('vInfo').textContent = t('loading');
      backgroundRefresh(true).then(function () { renderData(); });
    });
    $('dataOut').addEventListener('click', function (e) {
      var a = e.target.closest('.lbl-link');
      if (a) {
        var row = parseInt(a.dataset.row, 10);
        var r = API.getRows().filter(function (x) { return x.row === row; })[0];
        if (r) {
          state.filter.rap = r.rap; state.filter.label = String(r.label);
          $('vRap').value = r.rap; $('vLabel').value = String(r.label);
          renderData(); window.scrollTo(0, 0);
        }
        return;
      }
      var ed = e.target.closest('[data-edit]');
      if (ed) { startEdit(parseInt(ed.dataset.edit, 10)); return; }
      if (e.target.id === 'btnShowAll') {
        state.filter.label = ''; $('vLabel').value = ''; renderData(); return;
      }
      if (e.target.id === 'btnMore') { state.limit += 100; renderData(); }
    });

    // install prompt
    var deferred = null;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); deferred = e; $('btnInstall').hidden = false;
    });
    $('btnInstall').addEventListener('click', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; $('btnInstall').hidden = true; });
    });
    window.addEventListener('appinstalled', function () { $('btnInstall').hidden = true; });

    // service worker (offline)
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }

    history.replaceState({ view: 'home' }, '', '#/home');
    show('home');
    updateStatus();
    backgroundRefresh();
    autoSync();
  }

  init();
})();
