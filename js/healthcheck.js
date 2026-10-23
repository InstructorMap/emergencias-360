/* ============================================================
   healthcheck.js — Auto-diagnóstico visual de Emergencias 360
   - Se carga al final de los 5 HTML
   - Detecta globals faltantes, métodos faltantes, IDs faltantes,
     versión de storage, y rutas de assets (200 vs 404)
   - Muestra un panel rojo fijo arriba si hay errores
   - Muestra un badge verde chiquito si todo OK
   - Loguea a localStorage los últimos 20 diagnósticos
   - Apagable con ?healthcheck=off en la URL
   ============================================================ */

(function (global) {
  'use strict';

  const LS_LOG_KEY = 'e360_healthcheck_log_v1';
  const LS_LOG_MAX = 20;

  if (new URLSearchParams(global.location.search).get('healthcheck') === 'off') return;

  // ---------- Plan de chequeos por página ----------
  function getPagePlan() {
    const path = (global.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const baseCommon = {
      page: path,
      globals: ['E360Config', 'E360StateMachine', 'E360Store'],
      storeMethods: [
        'getActiveContext', 'getIncidents', 'getIncidentById',
        'canTransitionIncident', 'getFleet', 'getBases', 'subscribe',
        'getProfile', 'getActiveProfile', 'saveProfile',
        'getVisibleBenefits', 'getAllBenefitsRaw',
        'getB2BEstablishments', 'getB2BById',
        'getExternalServicesConfig', 'getPaymentConfig',
        'getProfileByCarnetToken', 'setProfilePlan', 'setCarnetStatus',
        'renewCarnet', 'listProfiles', 'calcCarnetStatus', 'daysToExpire',
        'getProfileByPulseraToken', 'setPulseraStatus', 'regeneratePulseraToken',
        'setHomeCoords', 'getActiveIncidentForUnit', 'updateCrewPosition',
        'guardiaDispatchIncident', 'guardiaMarkOnScene', 'guardiaMarkInTransit',
        'guardiaCloseIncident', 'getGuardiaHistory', 'requestSupportFromCrew'
      ],
      configKeys: [
        'STORAGE_KEY', 'STORAGE_VERSION', 'BASES', 'PLANS', 'PLAN_IDS',
        'CARNET_STATUSES', 'PULSERA_STATUSES', 'PULSERA_DEFAULTS',
        'PAYMENT_DEFAULTS', 'EXTERNAL_SERVICES_DEFAULTS', 'BRAND'
      ],
      requiredIds: [],
      assets: []
    };

    if (path === 'index.html' || path === '' || path === '/') {
      return Object.assign({}, baseCommon, {
        expectedVersion: 6,
        requiredIds: [
          'btnSOS', 'sosProgress', 'gpsStatus', 'btnGps', 'manualDir',
          'incidentPanel', 'incidentState', 'timeline', 'etaBlock',
          'btnCallBase', 'formFicha', 'fNombre', 'fDni', 'fTelefono',
          'fGrupo', 'fAlergias', 'fPatologias', 'fContacto', 'fConsent',
          'fichaMsg', 'carnetBlock', 'externalServicesBlock',
          'benefitsList', 'benefitsEmpty', 'planBenefitsHint',
          'pagosContainer', 'planBadgeSlot', 'b2bBanner',
          'baseSelector', 'connDot', 'connText',
          'btnToggleBanner', 'bannerDetalle',
          'testTools', 'btnTestToggle', 'testPanel',
          'nav-sos', 'nav-ficha', 'nav-beneficios', 'nav-pagos',
          'tab-sos', 'tab-ficha', 'tab-beneficios', 'tab-pagos'
        ],
        assets: ['js/config.js', 'js/state-machine.js', 'js/store.js', 'js/qr.js', 'js/app-socio.js', 'css/styles.css']
      });
    }

    if (path === 'central.html') {
      return Object.assign({}, baseCommon, {
        expectedVersion: 6,
        // NOTA: 'detailEmpty' NO se chequea porque app-central.js hace
        // container.innerHTML = '' en renderDetail() y lo reemplaza
        // por un div sin id. Es un falso positivo del healthcheck.
        requiredIds: [
          'centralBaseSelector', 'operatorInput', 'alertCounter',
          'incidentList', 'incidentEmpty', 'detailContainer',
          'fleetContainer'
        ],
        assets: ['js/config.js', 'js/state-machine.js', 'js/store.js', 'js/app-central.js', 'css/styles.css']
      });
    }

    if (path === 'guardia.html') {
      return Object.assign({}, baseCommon, {
        expectedVersion: 6,
        requiredIds: [
          'guardiaBaseSelector', 'guardiaUnitSelector', 'guardiaNameInput',
          'unitStatus', 'noIncidentPanel', 'activeIncidentContainer',
          'historyList', 'historyEmpty'
        ],
        assets: ['js/config.js', 'js/state-machine.js', 'js/store.js', 'js/app-guardia.js', 'css/styles.css']
      });
    }

    if (path === 'b2b.html') {
      return Object.assign({}, baseCommon, {
        expectedVersion: 6,
        requiredIds: [
          'b2bBaseSelector', 'b2bOperatorInput', 'b2bForm', 'b2bId',
          'b2bName', 'b2bType', 'b2bBase', 'b2bStatus', 'b2bAddress',
          'b2bLat', 'b2bLng', 'b2bPhone', 'b2bProtocol', 'b2bSubmit',
          'b2bCancelEdit', 'b2bMsg', 'b2bList', 'b2bEmpty', 'formTitle'
        ],
        assets: ['js/config.js', 'js/state-machine.js', 'js/store.js', 'js/app-b2b.js', 'css/styles.css']
      });
    }

    if (path === 'admin.html') {
      return Object.assign({}, baseCommon, {
        expectedVersion: 6,
        requiredIds: [
          'adminInput', 'orgsContainer',
          'benefitsTbody', 'benefitsTable', 'adminMsg',
          'btnExportAudit', 'btnResetDemo', 'auditList',
          'extServicesForm', 'extMedicoVirtualUrl', 'extSeguroViajeroUrl',
          'extServicesMsg', 'extServicesStatus', 'extServicesClear',
          'paymentForm', 'payMpEnabled', 'payMpPublicKey',
          'payCuotaBRONCE', 'payCuotaPLATA', 'payCuotaORO', 'payCuotaPLATINO',
          'payMsg', 'payStatus',
          'planManagerTbody', 'planManagerTable'
        ],
        assets: ['js/config.js', 'js/state-machine.js', 'js/store.js', 'js/app-admin.js', 'css/styles.css']
      });
    }

    return baseCommon;
  }

  // ---------- Chequeos ----------
  function checkGlobals(plan) {
    const issues = [];
    plan.globals.forEach((g) => {
      if (typeof global[g] === 'undefined') {
        issues.push({ level: 'error', code: 'GLOBAL_MISSING', msg: 'Falta global window.' + g + ' (¿no cargó el archivo?)' });
      }
    });
    return issues;
  }

  function checkStoreMethods(plan) {
    const issues = [];
    if (!global.E360Store) return issues;
    plan.storeMethods.forEach((m) => {
      if (typeof global.E360Store[m] !== 'function') {
        issues.push({ level: 'error', code: 'STORE_METHOD_MISSING', msg: 'E360Store.' + m + ' no es función (falta en store.js)' });
      }
    });
    return issues;
  }

  function checkConfigKeys(plan) {
    const issues = [];
    if (!global.E360Config) return issues;
    plan.configKeys.forEach((k) => {
      if (typeof global.E360Config[k] === 'undefined') {
        issues.push({ level: 'error', code: 'CONFIG_KEY_MISSING', msg: 'E360Config.' + k + ' no existe (falta en config.js)' });
      }
    });
    if (plan.expectedVersion && global.E360Config.STORAGE_VERSION !== plan.expectedVersion) {
      issues.push({ level: 'error', code: 'STORAGE_VERSION_MISMATCH', msg: 'E360Config.STORAGE_VERSION = ' + global.E360Config.STORAGE_VERSION + ' (esperado ' + plan.expectedVersion + '). Actualizá config.js.' });
    }
    return issues;
  }

  function checkDomIds(plan) {
    const issues = [];
    plan.requiredIds.forEach((id) => {
      if (!document.getElementById(id)) {
        issues.push({ level: 'error', code: 'DOM_ID_MISSING', msg: 'Falta #' + id + ' en el HTML' });
      }
    });
    return issues;
  }

  function checkStorage() {
    const issues = [];
    try {
      const key = global.E360Config && global.E360Config.STORAGE_KEY;
      const version = global.E360Config && global.E360Config.STORAGE_VERSION;
      if (!key || !version) return issues;
      const raw = localStorage.getItem(key);
      if (!raw) {
        issues.push({ level: 'info', code: 'STORAGE_EMPTY', msg: 'localStorage[' + key + '] vacío. Se inicializará con seed al usar el store.' });
        return issues;
      }
      const parsed = JSON.parse(raw);
      if (parsed.version !== version) {
        issues.push({ level: 'warn', code: 'STORAGE_VERSION_DIFF', msg: 'localStorage tiene versión ' + parsed.version + ' (esperado ' + version + '). Migración suave al primer uso.' });
      }
    } catch (e) {
      issues.push({ level: 'error', code: 'STORAGE_PARSE_ERROR', msg: 'Error parseando localStorage: ' + e.message });
    }
    return issues;
  }

  function checkAssets(plan, done) {
    let pending = plan.assets.length;
    const issues = [];
    if (!pending) { done(issues); return; }

    const cacheBust = '?hc=' + Date.now();
    plan.assets.forEach((asset) => {
      fetch(asset + cacheBust, { method: 'HEAD', cache: 'no-store' })
        .then((res) => {
          if (!res.ok) {
            issues.push({ level: 'error', code: 'ASSET_404', msg: 'Asset ' + asset + ' devuelve HTTP ' + res.status });
          }
        })
        .catch((err) => {
          issues.push({ level: 'warn', code: 'ASSET_FETCH_ERROR', msg: 'No se pudo verificar ' + asset + ': ' + err.message });
        })
        .finally(() => {
          pending--;
          if (pending === 0) done(issues);
        });
    });
  }

  // ---------- Render UI ----------
  function renderPanel(plan, issues) {
    const hasErrors = issues.some((i) => i.level === 'error');
    const hasWarns = issues.some((i) => i.level === 'warn');
    const page = plan.page;

    if (!hasErrors && !hasWarns) {
      const ok = document.createElement('div');
      ok.id = 'e360-hc-ok';
      ok.textContent = '✅ Healthcheck OK — ' + page;
      ok.title = 'Todos los chequeos pasaron. Click para ver detalle.';
      ok.style.cssText = [
        'position:fixed', 'right:10px', 'bottom:80px', 'z-index:99998',
        'background:#16A34A', 'color:#fff', 'font:600 11px Poppins,sans-serif',
        'padding:6px 10px', 'border-radius:999px', 'cursor:pointer',
        'box-shadow:0 2px 8px rgba(0,0,0,0.3)'
      ].join(';');
      ok.addEventListener('click', () => showDetailModal(plan, issues));
      document.body.appendChild(ok);
      return;
    }

    const panel = document.createElement('div');
    panel.id = 'e360-hc-panel';
    panel.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
      'background:' + (hasErrors ? '#DC2626' : '#D97706'), 'color:#fff',
      'font:12px/1.4 Poppins,system-ui,sans-serif', 'padding:10px 14px',
      'box-shadow:0 2px 12px rgba(0,0,0,0.4)',
      'max-height:50vh', 'overflow:auto'
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:800; font-size:13px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; gap:8px;';
    const titleText = document.createElement('span');
    titleText.textContent = (hasErrors ? '🔴 HEALTHCHECK FALLÓ' : '🟠 HEALTHCHECK CON ADVERTENCIAS') + ' — ' + page + ' (' + issues.length + ')';
    title.appendChild(titleText);

    const btn = document.createElement('button');
    btn.textContent = 'Ver detalle';
    btn.style.cssText = 'background:rgba(0,0,0,0.3); color:#fff; border:1px solid rgba(255,255,255,0.5); border-radius:6px; padding:4px 10px; font:600 11px Poppins,sans-serif; cursor:pointer;';
    btn.addEventListener('click', () => showDetailModal(plan, issues));
    title.appendChild(btn);
    panel.appendChild(title);

    const list = document.createElement('ul');
    list.style.cssText = 'list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:3px;';
    issues.slice(0, 8).forEach((i) => {
      const li = document.createElement('li');
      li.textContent = '• [' + i.level.toUpperCase() + '] ' + i.msg;
      li.style.cssText = 'padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.2);';
      list.appendChild(li);
    });
    if (issues.length > 8) {
      const more = document.createElement('li');
      more.textContent = '… y ' + (issues.length - 8) + ' más. Click en "Ver detalle".';
      more.style.cssText = 'padding:3px 0; font-style:italic;';
      list.appendChild(more);
    }
    panel.appendChild(list);

    document.body.appendChild(panel);
    document.body.style.paddingTop = (panel.offsetHeight + 8) + 'px';
  }

  function showDetailModal(plan, issues) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; padding:16px;';
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#0F172A; color:#F1F5F9; max-width:720px; width:100%; max-height:85vh; overflow:auto; border-radius:12px; padding:16px; font:12px/1.5 ui-monospace,monospace;';
    const h = document.createElement('h2');
    h.textContent = 'Healthcheck — ' + plan.page;
    h.style.cssText = 'font:800 16px Poppins,sans-serif; color:#60A5FA; margin:0 0 10px;';
    modal.appendChild(h);

    const meta = document.createElement('div');
    meta.style.cssText = 'margin-bottom:10px; color:#94A3B8; font-size:11px;';
    meta.textContent = 'Fecha: ' + new Date().toLocaleString('es-AR') + ' | URL: ' + global.location.href;
    modal.appendChild(meta);

    if (!issues.length) {
      const p = document.createElement('p');
      p.textContent = '✅ Todo OK. No hay problemas detectados.';
      p.style.cssText = 'color:#22C55E; font-weight:700;';
      modal.appendChild(p);
    } else {
      const ul = document.createElement('ul');
      ul.style.cssText = 'list-style:none; padding:0; margin:0;';
      issues.forEach((i) => {
        const li = document.createElement('li');
        li.style.cssText = 'padding:6px 0; border-bottom:1px solid #334155;';
        const badge = document.createElement('span');
        badge.textContent = i.level.toUpperCase();
        badge.style.cssText = 'display:inline-block; padding:1px 6px; border-radius:4px; font-weight:800; font-size:10px; margin-right:6px;' +
          (i.level === 'error' ? 'background:#DC2626; color:#fff;' :
           i.level === 'warn' ? 'background:#D97706; color:#fff;' :
           'background:#3B82F6; color:#fff;');
        li.appendChild(badge);
        const code = document.createElement('code');
        code.textContent = i.code;
        code.style.cssText = 'color:#FCD34D; margin-right:6px;';
        li.appendChild(code);
        li.appendChild(document.createTextNode(i.msg));
        ul.appendChild(li);
      });
      modal.appendChild(ul);
    }

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copiar todo';
    copyBtn.style.cssText = 'background:#3D5CA4; color:#fff; border:none; border-radius:6px; padding:8px 14px; font:700 12px Poppins,sans-serif; cursor:pointer;';
    copyBtn.addEventListener('click', () => {
      const txt = 'HEALTHCHECK ' + plan.page + '\nURL: ' + global.location.href +
        '\nFecha: ' + new Date().toISOString() + '\n\n' +
        issues.map((i) => '[' + i.level.toUpperCase() + '] ' + i.code + ': ' + i.msg).join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(() => {
          copyBtn.textContent = '✅ Copiado';
          setTimeout(() => { copyBtn.textContent = '📋 Copiar todo'; }, 2000);
        }).catch(() => { prompt('Copiá manualmente:', txt); });
      } else {
        prompt('Copiá manualmente:', txt);
      }
    });
    actions.appendChild(copyBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '🗑 Limpiar log';
    clearBtn.style.cssText = 'background:#334155; color:#fff; border:none; border-radius:6px; padding:8px 14px; font:700 12px Poppins,sans-serif; cursor:pointer;';
    clearBtn.addEventListener('click', () => {
      try { localStorage.removeItem(LS_LOG_KEY); } catch (_) {}
      clearBtn.textContent = '✅ Log limpiado';
    });
    actions.appendChild(clearBtn);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Cerrar';
    closeBtn.style.cssText = 'background:#740821; color:#fff; border:none; border-radius:6px; padding:8px 14px; font:700 12px Poppins,sans-serif; cursor:pointer; margin-left:auto;';
    closeBtn.addEventListener('click', () => document.body.removeChild(overlay));
    actions.appendChild(closeBtn);

    modal.appendChild(actions);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay);
  }

  // ---------- Log a localStorage ----------
  function logToLS(plan, issues) {
    try {
      const raw = localStorage.getItem(LS_LOG_KEY);
      const log = raw ? JSON.parse(raw) : [];
      log.unshift({
        ts: new Date().toISOString(),
        page: plan.page,
        url: global.location.href,
        issueCount: issues.length,
        issues: issues.slice(0, 50)
      });
      while (log.length > LS_LOG_MAX) log.pop();
      localStorage.setItem(LS_LOG_KEY, JSON.stringify(log));
    } catch (_) {}
  }

  // ---------- Boot ----------
  function run() {
    const plan = getPagePlan();
    const issues = [];
    Array.prototype.push.apply(issues, checkGlobals(plan));
    Array.prototype.push.apply(issues, checkConfigKeys(plan));
    Array.prototype.push.apply(issues, checkStoreMethods(plan));
    Array.prototype.push.apply(issues, checkDomIds(plan));
    Array.prototype.push.apply(issues, checkStorage());

    checkAssets(plan, (assetIssues) => {
      Array.prototype.push.apply(issues, assetIssues);
      logToLS(plan, issues);
      renderPanel(plan, issues);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})(typeof window !== 'undefined' ? window : globalThis);
