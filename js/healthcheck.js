/* ============================================================
   healthcheck.js v8.5 — Auto-diagnóstico visual
   - C1 + F2 + F3 (PTT, Storage, TURN)
   - C2: initOfflineBanner / toastOfflineCritico + #offlineBanner
   - Probe de red opcional con ?healthcheck=storage
   ============================================================ */

(function (global) {
  'use strict';

  const LS_LOG_KEY = 'e360_healthcheck_log_v1';
  const LS_LOG_MAX = 20;

  if (new URLSearchParams(global.location.search).get('healthcheck') === 'off') return;

  function getPagePlan() {
    const path = (global.location.pathname.split('/').pop() || 'index.html').toLowerCase();

    function expectedVersion() {
      try {
        const v = global.E360Config && global.E360Config.STORAGE_VERSION;
        return (typeof v === 'number') ? v : 6.1;
      } catch (_) { return 6.1; }
    }

    const baseStoreMethods = [
      'initSession', 'login', 'loginWithEmail', 'logout', 'changePassword',
      'getSession', 'getUser', 'isLoggedIn', 'isAdmin',
      'getPublicCarnetInfo', 'getPublicPulseraInfo',
      'getActiveProfile', 'getProfile', 'listProfiles', 'saveProfile',
      'createSocio', 'bulkCreateSocios', 'setProfilePlan', 'setCarnetStatus', 'renewCarnet',
      'getIncidents', 'getIncidentsByDni', 'getIncidentById', 'getLatestIncident', 'getMyIncidents',
      'getActiveIncidentForUnit', 'getIncidentEta', 'createSOSIncident',
      'transitionIncidentStatus', 'acknowledgeIncident', 'dispatchIncidentUnit',
      'markIncidentOnScene', 'markIncidentInTransit', 'closeIncident', 'cancelIncident',
      'updateCrewPosition', 'getFleet', 'getBases',
      'getMedications', 'getMedicationsForProfile', 'saveMedication', 'deleteMedication',
      'logDose', 'scheduleDosesForMedication', 'getDosesForDay',
      'submitSocioRequest', 'submitRecategorizacion', 'getSocioRequests',
      'approveSocioRequest', 'rejectSocioRequest',
      'getVisibleBenefits', 'getAllBenefitsRaw', 'updateBenefitStatus',
      'getB2BEstablishments', 'getB2BById', 'saveB2BEstablishment', 'toggleB2BStatus',
      'getExternalServices', 'setExternalServices',
      'getPaymentConfigPublic', 'getPaymentConfigAdmin', 'setPaymentConfig',
      'getBranding', 'loadBranding', 'setBranding', 'uploadBrandingFile',
      'applyBrandingToPage', 'notifySOSEmitted', 'withButtonLoading', 'humanizeError',
      'getActiveContext', 'setActiveBase', 'getSupabaseStatus', 'subscribe',
      'calcCarnetStatus', 'daysToExpire',
      'createManualIncident', 'getIncidentMedia', 'getIncidentExportUrl',
      'getSpeedLimit', 'setSpeedLimit',
      // C2:
      'initOfflineBanner', 'toastOfflineCritico'
    ];

    const baseGlobals = ['E360Config', 'E360StateMachine', 'E360Store', 'E360SupabaseConfig'];
    const baseConfigKeys = [
      'STORAGE_KEY', 'STORAGE_VERSION', 'BASES', 'PLANS', 'PLAN_IDS',
      'CARNET_STATUSES', 'PULSERA_STATUSES', 'PULSERA_DEFAULTS',
      'PAYMENT_DEFAULTS', 'EXTERNAL_SERVICES_DEFAULTS', 'BRAND', 'SUPABASE'
    ];

    if (path === 'index.html' || path === '' || path === '/') {
      return {
        page: path, globals: [], storeMethods: [], configKeys: [],
        requiredIds: ['servicios', 'planes', 'sos', 'nosotros', 'contacto'],
        assets: [], expectedVersion: null
      };
    }

    if (path === 'socio.html') {
      return {
        page: path, globals: baseGlobals, storeMethods: baseStoreMethods, configKeys: baseConfigKeys,
        requiredIds: [
          'loginOverlay', 'loginForm', 'loginDni', 'loginPassword', 'loginBtn', 'loginMsg',
          'changePasswordOverlay', 'changePasswordForm', 'publicVerifyMode', 'appNormal',
          'btnModoMayor', 'pillSocio', 'connDot', 'connText', 'baseSelector', 'btnToggleBanner', 'bannerDetalle',
          'tab-inicio', 'btnSOSInicio', 'sosProgressInicio', 'incidentEstadoInicio', 'btnCallBaseInicio',
          'servicioFarmacia', 'servicioTeleconsulta', 'servicioPulsera', 'servicioCursos',
          'tab-sos', 'btnSOS', 'sosProgress', 'gpsStatus', 'btnGps', 'manualDir',
          'incidentPanel', 'incidentState', 'timeline', 'etaBlock', 'btnCallBase', 'b2bBanner',
          'tab-credencial', 'credencialTarjeta', 'ctPlanLabel', 'ctNombre', 'ctCuilDni', 'ctSocio', 'ctOrden', 'ctSede',
          'csCodigo', 'csRenueva', 'qrSvgWrap', 'gfPildoras', 'btnShareCredencial', 'btnDownloadPDF',
          'tab-beneficios', 'benefitsList', 'benefitsEmpty', 'planBenefitsHint',
          'tab-ficha', 'btnRecategorizar', 'medicacionHoy', 'medicacionLista', 'btnAddMedicacion',
          'formFicha', 'fNombre', 'fDni', 'fCuil', 'fTelefono', 'fGrupo', 'fAlergias', 'fPatologias', 'fContacto', 'fConsent',
          'fichaMsg', 'misIncidentes', 'pagosContainer',
          'nav-inicio', 'nav-sos', 'nav-credencial', 'nav-beneficios', 'nav-ficha',
          // C2:
          'offlineBanner'
        ],
        assets: [
          'js/supabase.config.js', 'js/config.js', 'js/state-machine.js',
          'js/store.js', 'js/qr.js', 'js/capacitor-bridge.js', 'js/app-socio.js', 'css/styles.css'
        ],
        expectedVersion: expectedVersion()
      };
    }

    if (path === 'central.html') {
      return {
        page: path, globals: baseGlobals, storeMethods: baseStoreMethods, configKeys: baseConfigKeys,
        requiredIds: [
          'centralLoginOverlay', 'centralLoginForm', 'centralLoginEmail', 'centralLoginPassword', 'centralLoginBtn', 'centralLoginMsg',
          'centralApp', 'centralHeaderBrand', 'centralLogout',
          'centralBaseSelector', 'alertCounter', 'incidentList', 'incidentEmpty',
          'detailContainer', 'fleetContainer',
          // C2:
          'offlineBanner'
        ],
        assets: ['js/supabase.config.js', 'js/config.js', 'js/state-machine.js', 'js/store.js', 'js/ptt.js', 'js/media.js', 'js/app-central.js', 'css/styles.css'],
        expectedVersion: expectedVersion()
      };
    }

    if (path === 'guardia.html') {
      return {
        page: path, globals: baseGlobals, storeMethods: baseStoreMethods, configKeys: baseConfigKeys,
        requiredIds: [
          'guardiaLoginOverlay', 'guardiaLoginForm', 'guardiaLoginEmail', 'guardiaLoginPassword', 'guardiaLoginBtn', 'guardiaLoginMsg',
          'guardiaApp', 'guardiaHeaderBrand', 'guardiaLogout',
          'guardiaBaseSelector', 'guardiaUnitSelector',
          'unitStatus', 'noIncidentPanel', 'activeIncidentContainer',
          'historyList', 'historyEmpty',
          // C2:
          'offlineBanner'
        ],
        assets: ['js/supabase.config.js', 'js/config.js', 'js/state-machine.js', 'js/store.js', 'js/ptt.js', 'js/media.js', 'js/app-guardia.js', 'css/styles.css', 'css/guardia-v2.css'],
        expectedVersion: expectedVersion()
      };
    }

    if (path === 'b2b.html') {
      return {
        page: path, globals: baseGlobals, storeMethods: baseStoreMethods, configKeys: baseConfigKeys,
        requiredIds: [
          'b2bLoginOverlay', 'b2bLoginForm', 'b2bLoginEmail', 'b2bLoginPassword', 'b2bLoginBtn', 'b2bLoginMsg',
          'b2bApp', 'b2bHeaderBrand', 'b2bLogout', 'b2bBaseSelector',
          'b2bForm', 'b2bId', 'b2bName', 'b2bType', 'b2bBase', 'b2bStatus', 'b2bAddress',
          'b2bPhone', 'b2bTipoUnidad', 'b2bProtocol', 'b2bSubmit', 'b2bCancelEdit', 'b2bMsg',
          'b2bList', 'b2bEmpty', 'formTitle',
          // C2:
          'offlineBanner'
        ],
        assets: ['js/supabase.config.js', 'js/config.js', 'js/state-machine.js', 'js/store.js', 'js/qr.js', 'js/app-b2b.js', 'css/styles.css'],
        expectedVersion: expectedVersion()
      };
    }

    if (path === 'admin.html') {
      return {
        page: path, globals: baseGlobals, storeMethods: baseStoreMethods, configKeys: baseConfigKeys,
        requiredIds: [
          'adminLoginOverlay', 'adminLoginForm', 'adminLoginEmail', 'adminLoginPassword', 'adminLoginBtn',
          'adminApp', 'adminHeaderBrand', 'adminLogout', 'adminMsgBar',
          'sociosTbody', 'sociosCount', 'sociosSearch', 'sociosFilterPlan', 'sociosFilterBase', 'btnExportSociosCSV',
          'formAltaIndividual', 'aiNombre', 'aiDni', 'btnCreateSocio', 'altaIndividualMsg',
          'excelFile', 'btnSelectExcel', 'btnImportExcel', 'excelPreview',
          'socioRequestsList', 'requestsCount',
          'logoFile', 'btnUploadLogo', 'formBrandingColors',
          'formMercadoPago', 'mpEnabled', 'mpPublicKey', 'mpAccessToken',
          'formExtServices', 'extMedicoUrl', 'extSeguroUrl',
          'benefitsTbody', 'adminMsg', 'b2bTbody',
          'btnExportAudit', 'btnRefreshAudit', 'auditList',
          // C2:
          'offlineBanner'
        ],
        assets: ['js/supabase.config.js', 'js/config.js', 'js/state-machine.js', 'js/store.js', 'js/app-admin.js', 'css/styles.css'],
        expectedVersion: expectedVersion()
      };
    }

    return {
      page: path, globals: baseGlobals,
      storeMethods: baseStoreMethods, configKeys: baseConfigKeys,
      requiredIds: [], assets: [], expectedVersion: expectedVersion()
    };
  }

  function checkGlobals(plan) {
    const issues = [];
    plan.globals.forEach(g => {
      if (typeof global[g] === 'undefined') {
        issues.push({ level: 'error', code: 'GLOBAL_MISSING', msg: 'Falta global window.' + g });
      }
    });
    return issues;
  }

  function checkStoreMethods(plan) {
    const issues = [];
    if (!global.E360Store) return issues;
    plan.storeMethods.forEach(m => {
      if (typeof global.E360Store[m] !== 'function') {
        issues.push({ level: 'error', code: 'STORE_METHOD_MISSING', msg: 'E360Store.' + m + ' no es función' });
      }
    });
    return issues;
  }

  function checkCapacitorBridge() {
    const issues = [];
    if (typeof global.E360Capacitor !== 'undefined') {
      if (typeof global.E360Capacitor.registerPushToken !== 'function') {
        issues.push({ level: 'error', code: 'CAPACITOR_PUSH_MISSING', msg: 'E360Capacitor.registerPushToken no es función (F2)' });
      }
      if (typeof global.E360Capacitor.showLocalNotification !== 'function') {
        issues.push({ level: 'error', code: 'CAPACITOR_LOCAL_NOTIF_MISSING', msg: 'E360Capacitor.showLocalNotification no es función (C1)' });
      }
    }
    return issues;
  }

  // ============ F3: CHEQUEO DE PTT (runtime) ============
  function checkPTT() {
    const issues = [];
    if (typeof global.E360PTT === 'undefined' || typeof global.E360PTT.debug !== 'function') {
      return issues;
    }
    const pd = global.E360PTT.debug();
    if (!pd.initialized) return issues;

    if (pd.pcExists && pd.pcIceState === 'failed') {
      issues.push({ level: 'error', code: 'PTT_ICE_FAILED', msg: 'PTT: ICE failed. TURN no funciona. ' + (pd.lastIceError || '') });
    }
    if (pd.pcExists && pd.pcIceState === 'disconnected') {
      issues.push({ level: 'warn', code: 'PTT_ICE_DISCONNECTED', msg: 'PTT: ICE disconnected.' });
    }
    if (!pd.localStreamActive) {
      issues.push({ level: 'error', code: 'PTT_NO_MIC', msg: 'PTT: micrófono no captura.' });
    }
    if (pd.remoteAudioExists && pd.remoteAudioPaused) {
      issues.push({ level: 'warn', code: 'PTT_AUDIO_PAUSED', msg: 'PTT: audio remoto pausado (autoplay bloqueado).' });
    }
    if (pd.channelState !== 'joined') {
      issues.push({ level: 'error', code: 'PTT_CHANNEL_NOT_JOINED', msg: 'PTT: canal ' + pd.channelState });
    }
    if (!pd.turnCached) {
      issues.push({ level: 'warn', code: 'PTT_NO_TURN', msg: 'PTT: sin credenciales TURN. ' + (pd.lastIceError || '') });
    }
    return issues;
  }

  function checkConfigKeys(plan) {
    const issues = [];
    if (!global.E360Config) return issues;
    plan.configKeys.forEach(k => {
      if (typeof global.E360Config[k] === 'undefined') {
        issues.push({ level: 'error', code: 'CONFIG_KEY_MISSING', msg: 'E360Config.' + k + ' no existe' });
      }
    });
    const actual = global.E360Config.STORAGE_VERSION;
    const exp = plan.expectedVersion;
    if (typeof exp === 'number' && actual !== exp) {
      issues.push({ level: 'error', code: 'STORAGE_VERSION_MISMATCH', msg: 'STORAGE_VERSION = ' + actual + ' (esperado ' + exp + ')' });
    }
    return issues;
  }

  function checkDomIds(plan) {
    const issues = [];
    plan.requiredIds.forEach(id => {
      if (!document.getElementById(id)) {
        issues.push({ level: 'error', code: 'DOM_ID_MISSING', msg: 'Falta #' + id });
      }
    });
    return issues;
  }

  function checkStorage() {
    const issues = [];
    try {
      const key = global.E360Config && global.E360Config.STORAGE_KEY;
      if (!key) return issues;
      const raw = localStorage.getItem(key);
      if (!raw) {
        issues.push({ level: 'info', code: 'STORAGE_EMPTY', msg: 'localStorage[' + key + '] vacío.' });
      }
    } catch (e) {
      issues.push({ level: 'error', code: 'STORAGE_PARSE_ERROR', msg: e.message });
    }
    return issues;
  }

  function checkAssets(plan, done) {
    let pending = plan.assets.length;
    const issues = [];
    if (!pending) { done(issues); return; }
    plan.assets.forEach(asset => {
      fetch(asset + '?hc=' + Date.now(), { method: 'HEAD', cache: 'no-store' })
        .then(res => {
          if (!res.ok) issues.push({ level: 'error', code: 'ASSET_404', msg: asset + ' → HTTP ' + res.status });
        })
        .catch(err => {
          issues.push({ level: 'warn', code: 'ASSET_FETCH_ERROR', msg: asset + ': ' + err.message });
        })
        .finally(() => { pending--; if (pending === 0) done(issues); });
    });
  }

  // ============ F3: PROBES DE RED (Storage + TURN) ============
  async function checkSupabaseRuntime(plan) {
    const issues = [];
    const authedPages = ['socio.html', 'central.html', 'guardia.html', 'admin.html', 'b2b.html'];
    if (authedPages.indexOf(plan.page) === -1) return issues;

    const params = new URLSearchParams(global.location.search);
    if (params.get('healthcheck') !== 'storage') return issues;

    const Store = global.E360Store;
    if (!Store) return issues;
    const raw = typeof Store._getState === 'function' ? Store._getState() : null;
    const sb = raw && raw.supabase;
    const profile = raw && raw.profile;
    if (!sb || !profile) return issues;

    // Probe 1: Storage INSERT
    try {
      const blob = new Blob(['healthcheck'], { type: 'text/plain' });
      const path = 'healthcheck/' + Date.now() + '.txt';
      const { error: upErr } = await sb.storage.from('incident-media').upload(path, blob);
      if (upErr) {
        issues.push({ level: 'error', code: 'STORAGE_UPLOAD_FAILED', msg: 'Storage incident-media: ' + upErr.message });
      } else {
        await sb.storage.from('incident-media').remove([path]);
      }
    } catch (e) {
      issues.push({ level: 'error', code: 'STORAGE_PROBE_CRASH', msg: e.message });
    }

    // Probe 2: get-turn-credentials
    try {
      const { data, error } = await sb.functions.invoke('get-turn-credentials', { body: { ttl: 60 } });
      if (error) {
        issues.push({ level: 'error', code: 'TURN_FUNCTION_FAILED', msg: 'get-turn-credentials: ' + (error.message || 'error desconocido') });
      } else if (!data || !data.iceServers) {
        issues.push({ level: 'error', code: 'TURN_FUNCTION_BAD_RESPONSE', msg: 'get-turn-credentials devolvió sin iceServers' });
      }
    } catch (e) {
      issues.push({ level: 'error', code: 'TURN_PROBE_CRASH', msg: e.message });
    }

    return issues;
  }

  function renderPanel(plan, issues) {
    const hasErrors = issues.some(i => i.level === 'error');
    const hasWarns = issues.some(i => i.level === 'warn');
    const page = plan.page;

    if (!hasErrors && !hasWarns) {
      const ok = document.createElement('div');
      ok.id = 'e360-hc-ok';
      ok.textContent = '✅ Healthcheck OK — ' + page;
      ok.title = 'Click para ver detalle.';
      ok.style.cssText = 'position:fixed;right:10px;bottom:80px;z-index:99998;background:#16A34A;color:#fff;font:600 11px Poppins,sans-serif;padding:6px 10px;border-radius:999px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3)';
      ok.addEventListener('click', () => showDetailModal(plan, issues));
      document.body.appendChild(ok);
      return;
    }

    const panel = document.createElement('div');
    panel.id = 'e360-hc-panel';
    panel.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:' + (hasErrors ? '#DC2626' : '#D97706') + ';color:#fff;font:12px/1.4 Poppins,system-ui,sans-serif;padding:10px 14px;box-shadow:0 2px 12px rgba(0,0,0,0.4);max-height:50vh;overflow:auto';

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:800;font-size:13px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px';
    title.appendChild(document.createTextNode((hasErrors ? '🔴 HEALTHCHECK FALLÓ' : '🟠 HEALTHCHECK CON ADVERTENCIAS') + ' — ' + page + ' (' + issues.length + ')'));

    const btn = document.createElement('button');
    btn.textContent = 'Ver detalle';
    btn.style.cssText = 'background:rgba(0,0,0,0.3);color:#fff;border:1px solid rgba(255,255,255,0.5);border-radius:6px;padding:4px 10px;font:600 11px Poppins,sans-serif;cursor:pointer';
    btn.addEventListener('click', () => showDetailModal(plan, issues));
    title.appendChild(btn);
    panel.appendChild(title);

    const list = document.createElement('ul');
    list.style.cssText = 'list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:3px';
    issues.slice(0, 8).forEach(i => {
      const li = document.createElement('li');
      li.textContent = '• [' + i.level.toUpperCase() + '] ' + i.msg;
      li.style.cssText = 'padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.2)';
      list.appendChild(li);
    });
    if (issues.length > 8) {
      const more = document.createElement('li');
      more.textContent = '… y ' + (issues.length - 8) + ' más.';
      more.style.cssText = 'padding:3px 0;font-style:italic';
      list.appendChild(more);
    }
    panel.appendChild(list);
    document.body.appendChild(panel);
    document.body.style.paddingTop = (panel.offsetHeight + 8) + 'px';
  }

  function showDetailModal(plan, issues) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px';
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#0F172A;color:#F1F5F9;max-width:720px;width:100%;max-height:85vh;overflow:auto;border-radius:12px;padding:16px;font:12px/1.5 ui-monospace,monospace';
    const h = document.createElement('h2');
    h.textContent = 'Healthcheck — ' + plan.page;
    h.style.cssText = 'font:800 16px Poppins,sans-serif;color:#60A5FA;margin:0 0 10px';
    modal.appendChild(h);

    const meta = document.createElement('div');
    meta.style.cssText = 'margin-bottom:10px;color:#94A3B8;font-size:11px';
    meta.textContent = 'Fecha: ' + new Date().toLocaleString('es-AR') + ' | URL: ' + global.location.href;
    modal.appendChild(meta);

    if (!issues.length) {
      const p = document.createElement('p');
      p.textContent = '✅ Todo OK.';
      p.style.cssText = 'color:#22C55E;font-weight:700';
      modal.appendChild(p);
    } else {
      const ul = document.createElement('ul');
      ul.style.cssText = 'list-style:none;padding:0;margin:0';
      issues.forEach(i => {
        const li = document.createElement('li');
        li.style.cssText = 'padding:6px 0;border-bottom:1px solid #334155';
        const badge = document.createElement('span');
        badge.textContent = i.level.toUpperCase();
        badge.style.cssText = 'display:inline-block;padding:1px 6px;border-radius:4px;font-weight:800;font-size:10px;margin-right:6px;' + (i.level === 'error' ? 'background:#DC2626;color:#fff' : i.level === 'warn' ? 'background:#D97706;color:#fff' : 'background:#3B82F6;color:#fff');
        li.appendChild(badge);
        const code = document.createElement('code');
        code.textContent = i.code;
        code.style.cssText = 'color:#FCD34D;margin-right:6px';
        li.appendChild(code);
        li.appendChild(document.createTextNode(i.msg));
        ul.appendChild(li);
      });
      modal.appendChild(ul);
    }

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copiar todo';
    copyBtn.style.cssText = 'background:#0B3C78;color:#fff;border:none;border-radius:6px;padding:8px 14px;font:700 12px Poppins,sans-serif;cursor:pointer';
    copyBtn.addEventListener('click', () => {
      const txt = 'HEALTHCHECK ' + plan.page + '\nURL: ' + global.location.href + '\nFecha: ' + new Date().toISOString() + '\n\n' + issues.map(i => '[' + i.level.toUpperCase() + '] ' + i.code + ': ' + i.msg).join('\n');
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => { copyBtn.textContent = '✅ Copiado'; setTimeout(() => copyBtn.textContent = '📋 Copiar todo', 2000); });
      else prompt('Copiá:', txt);
    });
    actions.appendChild(copyBtn);
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Cerrar';
    closeBtn.style.cssText = 'background:#7A1C32;color:#fff;border:none;border-radius:6px;padding:8px 14px;font:700 12px Poppins,sans-serif;cursor:pointer;margin-left:auto';
    closeBtn.addEventListener('click', () => document.body.removeChild(overlay));
    actions.appendChild(closeBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay);
  }

  function logToLS(plan, issues) {
    try {
      const raw = localStorage.getItem(LS_LOG_KEY);
      const log = raw ? JSON.parse(raw) : [];
      log.unshift({ ts: new Date().toISOString(), page: plan.page, url: global.location.href, issueCount: issues.length, issues: issues.slice(0, 50) });
      while (log.length > LS_LOG_MAX) log.pop();
      localStorage.setItem(LS_LOG_KEY, JSON.stringify(log));
    } catch (_) {}
  }

  async function run() {
    const plan = getPagePlan();
    const issues = [];
    Array.prototype.push.apply(issues, checkGlobals(plan));
    Array.prototype.push.apply(issues, checkConfigKeys(plan));
    Array.prototype.push.apply(issues, checkStoreMethods(plan));
    Array.prototype.push.apply(issues, checkCapacitorBridge());
    Array.prototype.push.apply(issues, checkPTT());
    Array.prototype.push.apply(issues, checkDomIds(plan));
    Array.prototype.push.apply(issues, checkStorage());

    try {
      const runtimeIssues = await checkSupabaseRuntime(plan);
      Array.prototype.push.apply(issues, runtimeIssues);
    } catch (e) {
      issues.push({ level: 'warn', code: 'RUNTIME_PROBE_CRASH', msg: e.message });
    }

    checkAssets(plan, assetIssues => {
      Array.prototype.push.apply(issues, assetIssues);
      logToLS(plan, issues);
      renderPanel(plan, issues);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { run(); });
  } else {
    run();
  }
})(typeof window !== 'undefined' ? window : globalThis);
