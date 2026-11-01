/* ============================================================
   app-guardia.js v9.0 — Guardia Móvil EMP (B2 alto contraste)
   - Re-render quirúrgico (sin parpadeo)
   - Cards profesionales (gv-card)
   - PTT flotante fijo
   - Toggle claro/oscuro persistente
   - Media list estilizada
   - F2: push FCM + on_duty + speed alert
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  const C = window.E360Config;
  if (!Store) { console.error('[app-guardia] E360Store no disponible.'); return; }

  const $ = (s) => document.querySelector(s);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (v === true) { node.setAttribute(k, ''); return; }
        if (k === 'className') { node.className = v; return; }
        if (k === 'textContent') { node.textContent = v; return; }
        if (k === 'onclick' && typeof v === 'function') { node.addEventListener('click', v); return; }
        if (k === 'oninput' && typeof v === 'function') { node.addEventListener('input', v); return; }
        node.setAttribute(k, v);
      });
    }
    (children || []).forEach((c) => {
      if (c === null || c === undefined) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return iso; }
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return iso; }
  }

  function toast(text) {
    let t = document.getElementById('e360Toast');
    if (!t) { t = document.createElement('div'); t.id = 'e360Toast'; document.body.appendChild(t); }
    t.textContent = text;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function runLoading(btn, fn, label) {
    if (typeof Store.withButtonLoading === 'function') {
      return await Store.withButtonLoading(btn, fn, label);
    }
    return await fn();
  }

  function fmtErr(err) {
    return typeof Store.humanizeError === 'function' ? Store.humanizeError(err) : (err.message || 'Error');
  }

  const THROTTLE_MS = 20000;
  const UI_KEY = 'e360_guardia_ui_v9';
  const THEME_KEY = 'e360_guardia_theme';
  const SPEED_ALERT_COOLDOWN_MS = 120000;

  const ui = {
    baseId: 'DOLORES',
    unitId: null,
    crewId: null,
    crewName: '',
    onDuty: true,
    pushRegistered: false,
    watchId: null,
    lastPositionAt: 0,
    lastSpeedAlertAt: 0,
    audioCtx: null,
    lastIncidentId: null,
    initialBootDone: false,
    pttIncidentId: null,
    lastRenderHash: null,
    theme: 'dark'
  };

  function saveUI() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ baseId: ui.baseId, unitId: ui.unitId, crewName: ui.crewName })); } catch (_) {}
  }
  function loadUI() {
    try {
      const raw = localStorage.getItem(UI_KEY); if (!raw) return;
      const p = JSON.parse(raw);
      if (p.baseId) ui.baseId = p.baseId;
      if (p.unitId) ui.unitId = p.unitId;
      if (p.crewName) ui.crewName = p.crewName;
    } catch (_) {}
  }

  // ============ TEMA CLARO/OSCURO ============
  function initTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      ui.theme = saved === 'light' ? 'light' : 'dark';
    } catch (_) { ui.theme = 'dark'; }
    applyTheme();
  }
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', ui.theme);
    document.body.setAttribute('data-theme', ui.theme);
    const btn = $('#btnThemeToggle');
    if (btn) btn.textContent = ui.theme === 'light' ? '🌙' : '☀️';
  }
  function toggleTheme() {
    ui.theme = ui.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, ui.theme); } catch (_) {}
    applyTheme();
  }

  // ============ ALERTA DE VELOCIDAD ============
  async function checkSpeedAlert(speedMps) {
    if (typeof speedMps !== 'number' || speedMps <= 0) return;
    const kmh = speedMps * 3.6;
    const limit = typeof Store.getSpeedLimit === 'function' ? Store.getSpeedLimit() : 60;
    if (kmh <= limit) return;
    const now = Date.now();
    if (now - ui.lastSpeedAlertAt < SPEED_ALERT_COOLDOWN_MS) return;
    ui.lastSpeedAlertAt = now;

    const title = '⚠ Exceso de velocidad';
    const body = 'Velocidad actual: ' + kmh.toFixed(0) + ' km/h (límite ' + limit + ' km/h). Reducí la marcha.';

    const cap = window.E360Capacitor;
    if (cap && typeof cap.showLocalNotification === 'function') {
      try {
        await cap.showLocalNotification({
          title, body, channelId: 'emp_sos_channel',
          extra: { type: 'speed_alert', kmh: Math.round(kmh), limit }
        });
      } catch (_) {}
    }
    toast('⚠ ' + kmh.toFixed(0) + ' km/h — límite ' + limit + ' km/h');
    if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch (_) {} }
  }

  // ============ F2: PUSH Y ON_DUTY ============
  async function setOnDutyStatus(isOnDuty) {
    try {
      const rawState = typeof Store._getState === 'function' ? Store._getState() : null;
      const sb = rawState && rawState.supabase;
      const user = typeof Store.getUser === 'function' ? Store.getUser() : (rawState && rawState.user);
      const profileId = ui.crewId || (rawState && rawState.profile && rawState.profile.id);
      if (!sb || (!profileId && !user)) return false;

      let query = sb.from('profiles').update({ on_duty: !!isOnDuty });
      if (profileId) query = query.eq('id', profileId);
      else query = query.eq('user_id', user.id);

      const { error } = await query;
      if (!error) { ui.onDuty = !!isOnDuty; return true; }
    } catch (e) { console.warn('[app-guardia] Error on_duty:', e); }
    return false;
  }

  async function initPushRegistration() {
    try {
      await setOnDutyStatus(true);
      const cap = window.E360Capacitor;
      if (!cap || typeof cap.registerPushToken !== 'function') return;
      const rawState = typeof Store._getState === 'function' ? Store._getState() : null;
      const sb = rawState && rawState.supabase;
      const authUser = typeof Store.getUser === 'function' ? Store.getUser() : (rawState && rawState.user);
      const targetUserId = (authUser && authUser.id) || ui.crewId;
      if (!sb || !targetUserId) return;
      const res = await cap.registerPushToken(sb, targetUserId);
      if (res && res.ok) { ui.pushRegistered = true; renderUnitStatus(); }
    } catch (err) { console.warn('[app-guardia] initPushRegistration:', err); }
  }

  function ensureAudio() {
    if (ui.audioCtx) return ui.audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try { ui.audioCtx = new Ctx(); } catch (_) {}
    return ui.audioCtx;
  }
  function playAlert() {
    const ctx = ensureAudio();
    if (ctx) {
      try {
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        [660, 880, 1100, 1320].forEach((freq, i) => {
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.type = 'sine'; osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, now + i * 0.18);
          gain.gain.exponentialRampToValueAtTime(0.28, now + i * 0.18 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.18);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now + i * 0.18); osc.stop(now + i * 0.18 + 0.2);
        });
      } catch (_) {}
    }
    if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200, 100, 400]); } catch (_) {} }
  }

  function showLogin() {
    const ov = $('#guardiaLoginOverlay'); if (ov) ov.hidden = false;
    const app = $('#guardiaApp'); if (app) app.hidden = true;
  }
  function hideLogin() {
    const ov = $('#guardiaLoginOverlay'); if (ov) ov.hidden = true;
    const app = $('#guardiaApp'); if (app) app.hidden = false;
  }

  function initLogin() {
    const form = $('#guardiaLoginForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#guardiaLoginMsg');
      const btn = $('#guardiaLoginBtn');
      const email = $('#guardiaLoginEmail').value.trim();
      const password = $('#guardiaLoginPassword').value;
      if (!email || !password) {
        if (msg) { msg.textContent = 'Completá email y contraseña.'; msg.style.color = '#DC2626'; }
        return;
      }
      await runLoading(btn, async () => {
        try {
          const profile = await Store.loginWithEmail(email, password);
          if (!profile || (profile.role !== 'admin' && profile.role !== 'operador')) {
            await Store.logout();
            throw new Error('Tu cuenta no tiene permisos de guardia.');
          }
          ui.crewName = profile.nombre || profile.dni;
          ui.crewId = profile.id;
          hideLogin();
          await bootGuardia();
          await initPushRegistration();
        } catch (err) {
          if (msg) { msg.textContent = fmtErr(err); msg.style.color = '#DC2626'; }
        }
      }, 'Ingresando…');
    });
    const logout = $('#guardiaLogout');
    if (logout) logout.addEventListener('click', async () => {
      if (!confirm('¿Cerrar sesión y salir de guardia activa?')) return;
      stopWatch();
      if (typeof window.E360PTT !== 'undefined') window.E360PTT.destroy();
      await runLoading(logout, async () => {
        await setOnDutyStatus(false);
        await Store.logout();
        location.reload();
      }, 'Saliendo…');
    });
  }

  async function applyBranding() {
    try {
      const b = typeof Store.applyBrandingToPage === 'function'
        ? await Store.applyBrandingToPage()
        : await Store.loadBranding();
      if (b && b.logoUrl) {
        const brand = $('#guardiaHeaderBrand');
        if (brand) {
          const svg = brand.querySelector('svg');
          if (svg) {
            const img = document.createElement('img');
            img.src = b.logoUrl;
            img.alt = 'EMP';
            img.className = 'emp-logo-chip';
            img.style.height = '38px';
            svg.replaceWith(img);
          }
        }
      }
    } catch (_) {}
  }

  function populateUnitSelector() {
    const sel = $('#guardiaUnitSelector');
    if (!sel) return;
    sel.innerHTML = '';
    const units = Store.getFleet(ui.baseId);
    if (!units.length) { sel.appendChild(el('option', { value: '', textContent: '— Sin móviles —' })); ui.unitId = null; return; }
    units.forEach(u => {
      const opt = el('option', { value: u.id, textContent: u.unit + ' · ' + u.tipoUnidad });
      if (u.id === ui.unitId) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!units.some(u => u.id === ui.unitId)) { ui.unitId = units[0].id; sel.value = ui.unitId; }
  }

  function initSelectors() {
    loadUI();
    const baseSel = $('#guardiaBaseSelector');
    const unitSel = $('#guardiaUnitSelector');
    if (baseSel) baseSel.value = ui.baseId;
    populateUnitSelector();
    if (unitSel && ui.unitId) unitSel.value = ui.unitId;

    if (baseSel) baseSel.addEventListener('change', () => {
      ui.baseId = baseSel.value;
      ui.unitId = null;
      populateUnitSelector();
      saveUI();
      stopWatch();
      ui.lastRenderHash = null;
      render();
    });
    if (unitSel) unitSel.addEventListener('change', () => {
      ui.unitId = unitSel.value;
      saveUI();
      stopWatch();
      ui.lastRenderHash = null;
      render();
    });
  }

  // ============ GPS ============
  function updateGpsStatus(text, color) {
    const node = document.getElementById('gpsStatusText');
    if (!node) return;
    node.textContent = text;
    node.style.color = color === 'green' ? 'var(--gv-ok)' : color === 'red' ? 'var(--gv-danger)' : 'var(--gv-warn)';
  }

  function startWatch() {
    if (!navigator.geolocation) { updateGpsStatus('GPS no disponible.', 'red'); return; }
    const inc = Store.getActiveIncidentForUnit(ui.unitId);
    if (!inc) { alert('Sin incidente activo.'); return; }
    if (ui.watchId) return;
    ui.lastPositionAt = 0;
    ui.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        checkSpeedAlert(pos.coords.speed);
        if (now - ui.lastPositionAt < THROTTLE_MS) return;
        const active = Store.getActiveIncidentForUnit(ui.unitId);
        if (!active) return;
        if (active.status !== 'EN_CAMINO' && active.status !== 'EN_ESCENA') return;
        ui.lastPositionAt = now;
        Store.updateCrewPosition(active.id, {
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy, speed: pos.coords.speed
        }, ui.crewName).then(() => {
          const speedTxt = (typeof pos.coords.speed === 'number' && pos.coords.speed > 0)
            ? ' · ' + (pos.coords.speed * 3.6).toFixed(0) + ' km/h' : '';
          updateGpsStatus('GPS activo — ' + new Date().toLocaleTimeString('es-AR') + speedTxt, 'green');
        }).catch(err => console.warn('GPS error', err));
      },
      (err) => updateGpsStatus('GPS error: ' + err.message, 'red'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
    updateGpsStatus('GPS activo — cada ' + (THROTTLE_MS / 1000) + 's', 'green');
  }

  function stopWatch() {
    if (ui.watchId) { try { navigator.geolocation.clearWatch(ui.watchId); } catch (_) {} ui.watchId = null; }
    updateGpsStatus('GPS inactivo.', 'amber');
  }

  async function updatePositionManual(btn) {
    if (!navigator.geolocation) { alert('GPS no disponible.'); return; }
    const inc = Store.getActiveIncidentForUnit(ui.unitId);
    if (!inc) { alert('Sin incidente activo.'); return; }
    updateGpsStatus('Obteniendo GPS…', 'amber');
    await runLoading(btn, () => new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          checkSpeedAlert(pos.coords.speed);
          Store.updateCrewPosition(inc.id, {
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy, speed: pos.coords.speed
          }, ui.crewName).then(() => {
            updateGpsStatus('Posición enviada', 'green');
            toast('Posición GPS actualizada');
            resolve();
          }).catch(err => {
            updateGpsStatus('Error: ' + fmtErr(err), 'red');
            resolve();
          });
        },
        (err) => {
          updateGpsStatus('GPS error: ' + err.message, 'red');
          resolve();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      );
    }), 'Enviando GPS…');
  }

  // ============ APOYO ============
  function openSupportDialog(incident) {
    const overlay = el('div', { className: 'guardia-modal-overlay' });
    const confirmBtn = el('button', {
      type: 'button', className: 'btn-confirm', textContent: 'Enviar',
      onclick: async () => {
        await runLoading(confirmBtn, async () => {
          try {
            await Store.requestSupportFromCrew(
              incident.id, ui.unitId,
              document.getElementById('supportType').value,
              document.getElementById('supportNotes').value.trim(),
              ui.crewName
            );
            if (overlay.parentNode) document.body.removeChild(overlay);
            ui.lastRenderHash = null;
            render();
            toast('Solicitud de apoyo enviada');
          } catch (err) { alert('Error: ' + fmtErr(err)); }
        }, 'Enviando…');
      }
    });

    const dialog = el('div', { className: 'guardia-modal' }, [
      el('h3', { textContent: '🚨 Solicitar Apoyo' }),
      el('p', { className: 'guardia-modal-sub', textContent: 'Seleccioná tipo de apoyo. Queda registrado en bitácora y alerta a Central.' }),
      el('label', {}, [
        el('span', { textContent: 'Tipo de apoyo' }),
        (function () {
          const sel = el('select', { id: 'supportType' });
          ['Segunda unidad médica EMP', 'Apoyo Policial 911', 'Bomberos / Rescate'].forEach(t => sel.appendChild(el('option', { value: t, textContent: t })));
          return sel;
        })()
      ]),
      el('label', {}, [
        el('span', { textContent: 'Notas (opcional)' }),
        el('textarea', { id: 'supportNotes', rows: '3', maxlength: '200' })
      ]),
      el('div', { className: 'guardia-modal-actions' }, [
        el('button', { type: 'button', className: 'btn-cancel', textContent: 'Cancelar', onclick: () => document.body.removeChild(overlay) }),
        confirmBtn
      ])
    ]);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  function navUrl(incident) {
    if (incident.location && typeof incident.location.lat === 'number')
      return 'https://www.google.com/maps/dir/?api=1&destination=' + incident.location.lat + ',' + incident.location.lng + '&travelmode=driving';
    if (incident.manualAddress) return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(incident.manualAddress) + '&travelmode=driving';
    return null;
  }
  function osmUrl(incident) {
    if (incident.location && typeof incident.location.lat === 'number')
      return 'https://www.openstreetmap.org/?mlat=' + incident.location.lat + '&mlon=' + incident.location.lng + '#map=17/' + incident.location.lat + '/' + incident.location.lng;
    if (incident.manualAddress) return 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(incident.manualAddress);
    return null;
  }
  // ============ RENDER: UNIT STATUS ============
  function renderUnitStatus() {
    const container = $('#unitStatus');
    if (!container) return;
    container.innerHTML = '';
    if (!ui.unitId) { container.appendChild(el('span', { textContent: 'Seleccioná móvil.' })); return; }
    const unit = Store.getFleet(ui.baseId).find(u => u.id === ui.unitId);
    if (!unit) { container.appendChild(el('span', { textContent: 'Móvil no encontrado.' })); return; }

    const limit = typeof Store.getSpeedLimit === 'function' ? Store.getSpeedLimit() : 60;

    const dutyBtn = el('button', {
      type: 'button',
      className: 'gv-btn ' + (ui.onDuty ? 'gv-btn-success' : 'gv-btn-danger'),
      style: 'min-height:44px;padding:0 16px;font-size:0.75rem;width:auto;margin:0;',
      textContent: ui.onDuty ? '🟢 EN GUARDIA' : '🔴 FUERA DE GUARDIA',
      onclick: async () => {
        await setOnDutyStatus(!ui.onDuty);
        renderUnitStatus();
        toast(ui.onDuty ? 'En guardia activa (Push habilitado)' : 'Fuera de guardia');
      }
    });

    container.appendChild(el('div', { className: 'unit-status-row' }, [
      el('span', { className: 'unit-status-label', textContent: 'Unidad' }),
      el('span', { className: 'unit-pill unit-status-' + unit.status, textContent: unit.unit + ' · ' + unit.tipoUnidad })
    ]));
    container.appendChild(el('div', { className: 'unit-status-row', style: 'margin-top:8px;' }, [
      el('span', { className: 'unit-status-hint', textContent: (ui.crewName ? 'Guardia: ' + ui.crewName : '⚠ Sin identificar') + (ui.pushRegistered ? ' · 📱 Push OK' : '') + ' · ⚠ Límite ' + limit + ' km/h' }),
      dutyBtn
    ]));
  }

  // ============ RENDER: INCIDENTE ACTIVO (quirúrgico) ============
  function computeIncidentHash(incident) {
    if (!incident) return 'none';
    return [
      incident.id,
      incident.status,
      (incident.statusHistory || []).length,
      (incident.supportRequests || []).length,
      incident.assignedUnitId || '',
      incident.unitLocation && incident.unitLocation.ts ? incident.unitLocation.ts : '',
      incident.destinationCenter || '',
      ui.pttIncidentId || ''
    ].join('|');
  }

  function renderActiveIncident() {
    const container = $('#activeIncidentContainer');
    const empty = $('#noIncidentPanel');
    if (!container || !empty) return;
    if (!ui.unitId) {
      container.hidden = true; empty.hidden = false;
      container.innerHTML = '';
      ui.lastRenderHash = null;
      return;
    }
    const incident = Store.getActiveIncidentForUnit(ui.unitId);
    if (!incident) {
      ui.lastIncidentId = null;
      container.hidden = true;
      empty.hidden = false;
      if (typeof window.E360PTT !== 'undefined' && ui.pttIncidentId) {
        window.E360PTT.destroy();
        ui.pttIncidentId = null;
      }
      if (ui.lastRenderHash !== 'none') {
        container.innerHTML = '';
        renderPTTFloating(null);
        ui.lastRenderHash = 'none';
      }
      return;
    }

    container.hidden = false; empty.hidden = true;

    if (ui.initialBootDone && incident.id !== ui.lastIncidentId) {
      playAlert();
    }
    ui.lastIncidentId = incident.id;

    const hash = computeIncidentHash(incident);
    if (hash === ui.lastRenderHash) {
      renderPTTFloating(incident);
      return;
    }
    ui.lastRenderHash = hash;

    container.innerHTML = '';
    container.appendChild(buildIncidentCard(incident));
    container.appendChild(buildPatientCard(incident));
    container.appendChild(buildLocationCard(incident));
    container.appendChild(buildGpsCard(incident));
    container.appendChild(buildActionsCard(incident));
    container.appendChild(buildMediaCard(incident));
    container.appendChild(buildBitacoraCard(incident));

    renderPTTFloating(incident);
  }

  function buildIncidentCard(incident) {
    const header = el('div', { className: 'gv-incident-header' }, [
      el('div', {}, [
        el('div', { className: 'gv-incident-id', textContent: incident.id }),
        el('span', { className: 'gv-incident-time', textContent: fmtDateTime(incident.createdAt) })
      ]),
      el('div', { className: 'gv-incident-badges' }, [
        el('span', { className: 'gv-badge gv-badge-' + incident.status.toLowerCase().replace('_', '_'), textContent: incident.status.replace(/_/g, ' ') }),
        incident.priority ? el('span', { className: 'gv-badge gv-badge-' + incident.priority.toLowerCase(), textContent: incident.priority }) : null
      ].filter(Boolean))
    ]);
    return el('div', { className: 'gv-card' }, [header]);
  }

  function gvKv(k, v) {
    return el('div', { className: 'gv-kv' }, [
      el('span', { className: 'k', textContent: k }),
      el('span', { className: 'v', textContent: v || '—' })
    ]);
  }

  function buildPatientCard(incident) {
    const profiles = Store.listProfiles();
    const profile = profiles.find(p => p.dni === incident.profileDni);
    const body = el('div', { className: 'gv-card-body' });

    if (profile) {
      body.appendChild(gvKv('Nombre', profile.nombre));
      body.appendChild(gvKv('DNI', profile.dni));
      body.appendChild(gvKv('N° socio', profile.socioNumber));
      body.appendChild(gvKv('Plan', (C.PLANS[profile.plan] || {}).label || profile.plan));
      if (profile.telefono) {
        body.appendChild(el('div', { className: 'gv-kv' }, [
          el('span', { className: 'k', textContent: 'Teléfono' }),
          el('span', { className: 'v' }, [el('a', { href: 'tel:' + profile.telefono, style: 'color:var(--gv-accent);font-weight:800;', textContent: '📞 ' + profile.telefono })])
        ]));
      }

      body.appendChild(el('div', { className: 'gv-alert' }, [
        el('strong', { textContent: '⚠ Alerta clínica' }),
        el('div', { className: 'gv-alert-row', textContent: 'Grupo sanguíneo: ' + (profile.grupoSanguineo || 'No informado') }),
        el('div', { className: 'gv-alert-row', textContent: 'Alergias: ' + (profile.alergias || 'Sin registro') }),
        el('div', { className: 'gv-alert-row', textContent: 'Patologías: ' + (profile.patologias || 'Sin registro') }),
        el('div', { className: 'gv-alert-row', textContent: 'Contacto: ' + (profile.contacto || '—') })
      ]));
    } else {
      body.appendChild(el('p', { style: 'color:var(--gv-text-muted);', textContent: 'Socio sin ficha.' }));
    }

    return el('div', { className: 'gv-card' }, [
      el('div', { className: 'gv-card-header' }, [
        el('span', { className: 'gv-icon', textContent: '👤' }),
        el('h3', { textContent: 'Datos del paciente' })
      ]),
      body
    ]);
  }

  function buildLocationCard(incident) {
    const body = el('div', { className: 'gv-card-body' });
    if (incident.location) {
      body.appendChild(gvKv('Coordenadas', incident.location.lat.toFixed(6) + ', ' + incident.location.lng.toFixed(6)));
      body.appendChild(gvKv('Precisión', '± ' + Math.round(incident.location.accuracy) + ' m'));
    }
    if (incident.manualAddress) body.appendChild(gvKv('Dirección', incident.manualAddress));

    const footer = el('div', { className: 'gv-card-footer' });
    const nav = navUrl(incident);
    if (nav) footer.appendChild(el('a', { href: nav, target: '_blank', rel: 'noopener', className: 'gv-btn gv-btn-primary', style: 'text-decoration:none;', textContent: '🧭 Navegar' }));
    const osm = osmUrl(incident);
    if (osm) footer.appendChild(el('a', { href: osm, target: '_blank', rel: 'noopener', className: 'gv-btn gv-btn-secondary', style: 'text-decoration:none;', textContent: '🗺 OSM' }));

    return el('div', { className: 'gv-card' }, [
      el('div', { className: 'gv-card-header' }, [
        el('span', { className: 'gv-icon', textContent: '📍' }),
        el('h3', { textContent: 'Ubicación' })
      ]),
      body,
      footer
    ]);
  }

  function buildGpsCard(incident) {
    const limit = typeof Store.getSpeedLimit === 'function' ? Store.getSpeedLimit() : 60;
    const manualGpsBtn = el('button', {
      type: 'button', className: 'gv-btn gv-btn-secondary', textContent: '📍 Actualizar',
      onclick: () => updatePositionManual(manualGpsBtn)
    });
    const toggleBtn = el('button', {
      type: 'button',
      className: 'gv-btn ' + (ui.watchId ? 'gv-btn-danger' : 'gv-btn-success'),
      textContent: ui.watchId ? '⏹ Detener GPS' : '▶ Activar GPS',
      onclick: () => {
        if (ui.watchId) stopWatch(); else startWatch();
        renderActiveIncident();
      }
    });

    const body = el('div', { className: 'gv-card-body' }, [
      el('div', { id: 'gpsStatusText', style: 'font-weight:700;font-size:0.85rem;margin-bottom:12px;', textContent: ui.watchId ? 'GPS activo.' : 'GPS inactivo.' }),
      el('p', { style: 'font-size:0.75rem;color:var(--gv-text-muted);margin:0 0 12px;', textContent: '⚠ Límite despacho: ' + limit + ' km/h' }),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;' }, [toggleBtn, manualGpsBtn])
    ]);

    if (incident.status === 'EN_CAMINO' || incident.status === 'EN_ESCENA') {
      body.appendChild(el('button', {
        type: 'button', className: 'gv-btn gv-btn-warn', style: 'margin-top:8px;',
        textContent: '🚨 Solicitar Apoyo',
        onclick: () => openSupportDialog(incident)
      }));
    }

    return el('div', { className: 'gv-card' }, [
      el('div', { className: 'gv-card-header' }, [
        el('span', { className: 'gv-icon', textContent: '🛰' }),
        el('h3', { textContent: 'GPS de la unidad' })
      ]),
      body
    ]);
  }

  function buildActionsCard(incident) {
    const body = el('div', { className: 'gv-card-body' });
    const run = async (btn, fn, label) => {
      await runLoading(btn, async () => {
        try {
          await fn();
          ui.lastRenderHash = null;
          render();
        } catch (err) { alert('Error: ' + fmtErr(err)); }
      }, label);
    };

    switch (incident.status) {
      case 'MOVIL_ASIGNADO': {
        const b = el('button', {
          type: 'button', className: 'gv-btn gv-btn-success', textContent: '▶ Confirmar salida',
          onclick: () => run(b, () => Store.guardiaDispatchIncident(incident.id, ui.unitId, ui.crewName), 'Confirmando…')
        });
        body.appendChild(b);
        break;
      }
      case 'EN_CAMINO': {
        const b = el('button', {
          type: 'button', className: 'gv-btn gv-btn-success', textContent: '📍 Marcar arribo',
          onclick: () => run(b, () => Store.guardiaMarkOnScene(incident.id, ui.unitId, ui.crewName), 'Marcando…')
        });
        body.appendChild(b);
        break;
      }
      case 'EN_ESCENA': {
        const destInput = el('input', { type: 'text', id: 'destCenter', maxlength: '120', placeholder: 'Ej: Hospital San Roque' });
        body.appendChild(el('label', { className: 'gv-label' }, [
          el('span', { textContent: 'Centro receptor (si hay traslado)' }),
          destInput
        ]));
        const bTr = el('button', {
          type: 'button', className: 'gv-btn gv-btn-primary', textContent: '🚑 Iniciar traslado',
          onclick: () => run(bTr, () => Store.guardiaMarkInTransit(incident.id, ui.unitId, destInput.value.trim(), ui.crewName), 'Iniciando…')
        });
        body.appendChild(bTr);

        const selReason = el('select', { id: 'closeReason' });
        ['Atención en domicilio sin traslado', 'Traslado efectivo', 'Falsa alarma', 'Derivado a sistema público'].forEach(r => selReason.appendChild(el('option', { value: r, textContent: r })));
        body.appendChild(el('label', { className: 'gv-label' }, [el('span', { textContent: 'Motivo de cierre' }), selReason]));
        body.appendChild(el('label', { className: 'gv-label' }, [el('span', { textContent: 'Notas de cierre' }), el('textarea', { id: 'closeNotes', rows: '2', maxlength: '400' })]));

        const bCl = el('button', {
          type: 'button', className: 'gv-btn gv-btn-danger', textContent: '✔ Cerrar intervención',
          onclick: () => run(bCl, async () => {
            await Store.guardiaCloseIncident(incident.id, ui.unitId, document.getElementById('closeReason').value, document.getElementById('closeNotes').value.trim(), ui.crewName);
            stopWatch();
          }, 'Cerrando…')
        });
        body.appendChild(bCl);
        break;
      }
      case 'EN_TRASLADO': {
        const selReason = el('select', { id: 'closeReason' });
        ['Traslado efectivo', 'Derivado a sistema público'].forEach(r => selReason.appendChild(el('option', { value: r, textContent: r })));
        body.appendChild(el('div', { className: 'gv-kv' }, [
          el('span', { className: 'k', textContent: 'Traslado hacia' }),
          el('span', { className: 'v', textContent: incident.destinationCenter || '—' })
        ]));
        body.appendChild(el('label', { className: 'gv-label' }, [el('span', { textContent: 'Motivo de cierre' }), selReason]));
        body.appendChild(el('label', { className: 'gv-label' }, [el('span', { textContent: 'Notas de cierre' }), el('textarea', { id: 'closeNotes', rows: '2', maxlength: '400' })]));
        const bCl = el('button', {
          type: 'button', className: 'gv-btn gv-btn-danger', textContent: '✔ Cerrar intervención',
          onclick: () => run(bCl, async () => {
            await Store.guardiaCloseIncident(incident.id, ui.unitId, document.getElementById('closeReason').value, document.getElementById('closeNotes').value.trim(), ui.crewName);
            stopWatch();
          }, 'Cerrando…')
        });
        body.appendChild(bCl);
        break;
      }
      default:
        body.appendChild(el('p', { style: 'color:var(--gv-text-muted);', textContent: 'Estado: ' + incident.status }));
    }

    return el('div', { className: 'gv-card' }, [
      el('div', { className: 'gv-card-header' }, [
        el('span', { className: 'gv-icon', textContent: '⚙' }),
        el('h3', { textContent: 'Acciones' })
      ]),
      body
    ]);
  }

  function buildMediaCard(incident) {
    const body = el('div', { className: 'gv-card-body' });
    const listEl = el('div', { className: 'gv-media-list', textContent: 'Cargando…' });

    const photoInput = document.createElement('input');
    photoInput.type = 'file';
    photoInput.accept = 'image/*';
    photoInput.capture = 'environment';
    photoInput.style.display = 'none';

    const photoBtn = el('button', { type: 'button', className: 'gv-btn gv-btn-secondary', textContent: '📷 Foto' });
    const videoBtn = el('button', { type: 'button', className: 'gv-btn gv-btn-secondary', textContent: '🎥 Video (30s)' });

    const canUpload = ['RECIBIDA_SERVIDOR', 'ACEPTADA_POR_CENTRAL', 'CLASIFICADA', 'MOVIL_ASIGNADO', 'EN_CAMINO', 'EN_ESCENA'].indexOf(incident.status) !== -1;

    if (canUpload && typeof window.E360Media !== 'undefined') {
      const sb = Store._getState().supabase;

      photoBtn.addEventListener('click', () => photoInput.click());
      photoInput.addEventListener('change', async () => {
        if (!photoInput.files || !photoInput.files[0]) return;
        await runLoading(photoBtn, async () => {
          try {
            await window.E360Media.uploadPhoto(sb, incident.id, photoInput.files[0]);
            toast('Foto subida');
            await refreshMediaList();
          } catch (e) { toast('Error: ' + fmtErr(e)); }
        }, 'Subiendo…');
      });

      videoBtn.addEventListener('click', async () => {
        try {
          toast('Grabando 30s…');
          await window.E360Media.recordVideo(async (file) => {
            await runLoading(videoBtn, async () => {
              try {
                await window.E360Media.uploadVideo(sb, incident.id, file);
                toast('Video subido');
                await refreshMediaList();
              } catch (e) { toast('Error: ' + fmtErr(e)); }
            }, 'Subiendo…');
          });
        } catch (e) { toast('Error: ' + fmtErr(e)); }
      });
    }

    async function refreshMediaList() {
      try {
        const items = await Store.getIncidentMedia(incident.id);
        listEl.innerHTML = '';
        if (!items || items.length === 0) {
          listEl.appendChild(el('p', { style: 'color:var(--gv-text-muted);font-size:0.85rem;margin:0;', textContent: 'Sin archivos adjuntos.' }));
          return;
        }
        items.forEach(m => {
          const label = m.type === 'audio' ? '🎙' : m.type === 'photo' ? '📷' : '🎥';
          const tipo = m.type === 'audio' ? 'Audio' : m.type === 'photo' ? 'Foto' : 'Video';
          const row = el('div', { className: 'gv-media-item' }, [
            el('span', { textContent: label + ' ' + tipo + ' · ' + fmtTime(m.created_at) })
          ]);
          if (m.signedUrl) {
            row.appendChild(el('a', { href: m.signedUrl, target: '_blank', rel: 'noopener', className: 'gv-media-link', textContent: 'Ver' }));
          }
          listEl.appendChild(row);
        });
      } catch (e) {
        listEl.textContent = 'Error: ' + fmtErr(e);
      }
    }

    refreshMediaList();

    body.appendChild(listEl);
    if (canUpload && typeof window.E360Media !== 'undefined') {
      body.appendChild(el('div', { style: 'display:flex;gap:8px;margin-top:12px;' }, [photoBtn, videoBtn]));
    }
    body.appendChild(photoInput);

    return el('div', { className: 'gv-card' }, [
      el('div', { className: 'gv-card-header' }, [
        el('span', { className: 'gv-icon', textContent: '📎' }),
        el('h3', { textContent: 'Adjuntos del incidente' })
      ]),
      body
    ]);
  }

  function buildBitacoraCard(incident) {
    const body = el('div', { className: 'gv-card-body' });
    const history = (incident.statusHistory || []).slice().reverse();
    if (!history.length) {
      body.appendChild(el('p', { style: 'color:var(--gv-text-muted);font-size:0.85rem;', textContent: 'Sin movimientos registrados.' }));
    } else {
      history.forEach(h => {
        body.appendChild(el('div', { style: 'padding:8px 0;border-bottom:1px solid var(--gv-border);' }, [
          el('div', { style: 'display:flex;justify-content:space-between;gap:8px;font-size:0.85rem;' }, [
            el('strong', { textContent: h.status }),
            el('span', { style: 'color:var(--gv-text-muted);font-size:0.75rem;', textContent: fmtDateTime(h.ts) })
          ]),
          el('div', { style: 'color:var(--gv-text-muted);font-size:0.75rem;margin-top:2px;', textContent: h.actor || 'system' }),
          h.detail ? el('div', { style: 'font-size:0.8rem;margin-top:4px;', textContent: h.detail }) : null
        ].filter(Boolean)));
      });
    }

    return el('div', { className: 'gv-card' }, [
      el('div', { className: 'gv-card-header' }, [
        el('span', { className: 'gv-icon', textContent: '📋' }),
        el('h3', { textContent: 'Bitácora' })
      ]),
      body
    ]);
  }

  // ============ PTT FLOTANTE FIJO ============
  function renderPTTFloating(incident) {
    let existing = document.getElementById('gvPttFloating');
    const canPTT = incident && ['EN_CAMINO', 'EN_ESCENA'].indexOf(incident.status) !== -1 && typeof window.E360PTT !== 'undefined';

    if (!canPTT) {
      if (existing) existing.remove();
      return;
    }

    const isConnected = ui.pttIncidentId === incident.id;

    if (existing) {
      existing.querySelector('.gv-ptt-connect').className = 'gv-ptt-connect' + (isConnected ? ' connected' : '');
      existing.querySelector('.gv-ptt-connect').innerHTML = isConnected ? '🔌<br>DESCONECTAR' : '🔗<br>CONECTAR';
      existing.querySelector('.gv-ptt-talk').disabled = !isConnected;
      return;
    }

    const wrapper = el('div', { className: 'gv-ptt-floating', id: 'gvPttFloating' });

    const statusEl = el('div', { className: 'gv-ptt-status', textContent: isConnected ? 'PTT conectado — presioná para hablar' : 'Conectá PTT para hablar con Central' });
    wrapper.appendChild(statusEl);

    const connectBtn = el('button', {
      type: 'button',
      className: 'gv-ptt-connect' + (isConnected ? ' connected' : ''),
      innerHTML: isConnected ? '🔌<br>DESCONECTAR' : '🔗<br>CONECTAR',
      onclick: async () => {
        if (isConnected) {
          window.E360PTT.destroy();
          ui.pttIncidentId = null;
          ui.lastRenderHash = null;
          renderActiveIncident();
        } else {
          const sb = Store._getState().supabase;
          const ok = await window.E360PTT.init(sb, incident.id, 'guardia');
          if (ok) { ui.pttIncidentId = incident.id; toast('PTT conectado'); }
          else { toast('No se pudo acceder al micrófono'); }
          ui.lastRenderHash = null;
          renderActiveIncident();
        }
      }
    });

    const talkBtn = el('button', {
      type: 'button',
      className: 'gv-ptt-talk',
      textContent: '🎙 MANTENER PARA HABLAR',
      disabled: !isConnected
    });

    if (isConnected) {
      const startTalk = async (e) => {
        if (e) e.preventDefault();
        const sb = Store._getState().supabase;
        await window.E360PTT.startTalking(sb);
        talkBtn.textContent = '🔴 TRANSMITIENDO…';
        talkBtn.classList.add('is-transmitting');
        statusEl.textContent = '🔴 Transmitiendo a Central';
        if (navigator.vibrate) { try { navigator.vibrate(50); } catch (_) {} }
      };
      const stopTalk = async (e) => {
        if (e) e.preventDefault();
        const sb = Store._getState().supabase;
        const path = await window.E360PTT.stopTalking(sb);
        talkBtn.textContent = '🎙 MANTENER PARA HABLAR';
        talkBtn.classList.remove('is-transmitting');
        statusEl.textContent = path ? '✅ Clip guardado en el incidente' : 'PTT detenido';
        if (path) { toast('Clip de audio guardado'); setTimeout(() => { ui.lastRenderHash = null; renderActiveIncident(); }, 1500); }
      };
      talkBtn.addEventListener('mousedown', startTalk);
      talkBtn.addEventListener('mouseup', stopTalk);
      talkBtn.addEventListener('mouseleave', stopTalk);
      talkBtn.addEventListener('touchstart', startTalk, { passive: false });
      talkBtn.addEventListener('touchend', stopTalk, { passive: false });
      talkBtn.addEventListener('touchcancel', stopTalk);
    }

    wrapper.appendChild(connectBtn);
    wrapper.appendChild(talkBtn);
    document.body.appendChild(wrapper);
  }
  // ============ RENDER: HISTORIAL ============
  async function renderHistory() {
    const list = $('#historyList');
    const empty = $('#historyEmpty');
    if (!list) return;
    list.innerHTML = '';
    if (!ui.unitId) { if (empty) empty.hidden = false; return; }
    try {
      const items = await Store.getGuardiaHistory(ui.unitId, 10);
      if (!items.length) { if (empty) empty.hidden = false; return; }
      if (empty) empty.hidden = true;
      items.forEach(inc => {
        list.appendChild(el('li', { className: 'guardia-history-item' }, [
          el('div', { className: 'ghi-top' }, [
            el('span', { className: 'ghi-id', textContent: inc.id }),
            el('span', { className: 'ghi-status', textContent: inc.status })
          ]),
          el('div', { className: 'ghi-meta', textContent: fmtDateTime(inc.createdAt) + ' · ' + (inc.closureReason || 'Sin motivo') })
        ]));
      });
    } catch (_) { if (empty) empty.hidden = false; }
  }

  // ============ RENDER GENERAL ============
  function render() {
    renderUnitStatus();
    renderActiveIncident();
    renderHistory();
  }

  // ============ SUBSCRIPCIÓN ============
  function initSubscription() {
    Store.subscribe(msg => {
      if (!msg) return;
      if (msg.type === 'AUTH_CHANGED') { location.reload(); return; }
      if (msg.type === 'BRANDING_CHANGED') { applyBranding(); return; }
      if (msg.type !== 'STATE_CHANGED') return;
      ui.lastRenderHash = null;
      render();
    });
    setInterval(() => render(), 5000);
  }

  // ============ BOOT ============
  async function bootGuardia() {
    await applyBranding();
    initSelectors();
    initTheme();
    render();
    ui.initialBootDone = true;
    initSubscription();
  }

  // ============ INIT ============
  document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    const themeBtn = $('#btnThemeToggle');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    await applyBranding();
    initLogin();

    const session = await Store.initSession();
    if (session.loggedIn && session.profile && (session.profile.role === 'admin' || session.profile.role === 'operador')) {
      ui.crewName = session.profile.nombre || session.profile.dni;
      ui.crewId = session.profile.id;
      hideLogin();
      await bootGuardia();
      await initPushRegistration();
    } else {
      if (session.loggedIn) await Store.logout();
      showLogin();
    }
  });

  window.addEventListener('beforeunload', () => {
    stopWatch();
    if (typeof window.E360PTT !== 'undefined') window.E360PTT.destroy();
  });
})();
