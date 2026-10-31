/* ============================================================
   app-guardia.js v8.3 — Guardia Móvil EMP (C1 + F2 Push FCM)
   - Login staff (admin/operador) por email con spinner
   - F2: ui.crewId + initPushRegistration() + sincronización de profiles.on_duty
   - applyBrandingToPage() en el boot
   - Incidente asignado en vivo (realtime) con alarma desde el 1er incidente
   - Ficha del paciente + medicación + alergias
   - GPS con throttle 20s, navegación, acciones con spinner, apoyo
   - Historial de la unidad
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
  const UI_KEY = 'e360_guardia_ui_v8';

  const ui = {
    baseId: 'DOLORES',
    unitId: null,
    crewId: null,
    crewName: '',
    onDuty: true,
    pushRegistered: false,
    watchId: null,
    lastPositionAt: 0,
    audioCtx: null,
    lastIncidentId: null,
    initialBootDone: false
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

  // ============ F2: REGISTRO PUSH FCM Y ESTADO ON_DUTY ============
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
      if (!error) {
        ui.onDuty = !!isOnDuty;
        return true;
      }
    } catch (e) {
      console.warn('[app-guardia] Error actualizando on_duty:', e);
    }
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
      if (res && res.ok) {
        ui.pushRegistered = true;
        renderUnitStatus();
      }
    } catch (err) {
      console.warn('[app-guardia] initPushRegistration:', err);
    }
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
      const opt = el('option', { value: u.id, textContent: u.unit + ' · ' + u.tipoUnidad + ' · ' + u.status.toUpperCase() });
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
      render();
    });
    if (unitSel) unitSel.addEventListener('change', () => {
      ui.unitId = unitSel.value;
      saveUI();
      stopWatch();
      render();
    });
  }

  // ============ GPS ============
  function updateGpsStatus(text, color) {
    const node = document.getElementById('gpsStatusText');
    if (!node) return;
    node.textContent = text;
    node.style.color = color === 'green' ? '#16A34A' : color === 'red' ? '#DC2626' : '#D97706';
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
        if (now - ui.lastPositionAt < THROTTLE_MS) return;
        const active = Store.getActiveIncidentForUnit(ui.unitId);
        if (!active) return;
        if (active.status !== 'EN_CAMINO' && active.status !== 'EN_ESCENA') return;
        ui.lastPositionAt = now;
        Store.updateCrewPosition(active.id, {
          lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy
        }, ui.crewName).then(() => {
          updateGpsStatus('GPS activo — ' + new Date().toLocaleTimeString('es-AR'), 'green');
          render();
        }).catch(err => console.warn('GPS error', err));
      },
      (err) => updateGpsStatus('GPS error: ' + err.message, 'red'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
    updateGpsStatus('GPS activo — cada ' + (THROTTLE_MS / 1000) + 's', 'green');
    render();
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
          Store.updateCrewPosition(inc.id, {
            lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy
          }, ui.crewName).then(() => {
            updateGpsStatus('Posición enviada.', 'green');
            toast('Posición GPS actualizada');
            render();
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
      type: 'button',
      className: 'btn-confirm',
      textContent: 'Enviar',
      onclick: async () => {
        await runLoading(confirmBtn, async () => {
          try {
            await Store.requestSupportFromCrew(
              incident.id,
              ui.unitId,
              document.getElementById('supportType').value,
              document.getElementById('supportNotes').value.trim(),
              ui.crewName
            );
            if (overlay.parentNode) document.body.removeChild(overlay);
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

  // ============ NAVEGACIÓN ============
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

  // ============ RENDER ============
  function renderUnitStatus() {
    const container = $('#unitStatus');
    if (!container) return;
    container.innerHTML = '';
    if (!ui.unitId) { container.appendChild(el('span', { textContent: 'Seleccioná móvil.' })); return; }
    const unit = Store.getFleet(ui.baseId).find(u => u.id === ui.unitId);
    if (!unit) { container.appendChild(el('span', { textContent: 'Móvil no encontrado.' })); return; }

    const dutyBtn = el('button', {
      type: 'button',
      className: ui.onDuty ? 'btn-gps-start' : 'btn-gps-stop',
      style: 'padding:4px 10px;font-size:0.72rem;border-radius:999px;border:none;cursor:pointer;font-weight:700;',
      textContent: ui.onDuty ? '🟢 En Guardia (Recibe Push)' : '🔴 Fuera de Guardia',
      onclick: async () => {
        await setOnDutyStatus(!ui.onDuty);
        renderUnitStatus();
        toast(ui.onDuty ? 'En guardia activa (Push SOS habilitado)' : 'Fuera de guardia');
      }
    });

    container.appendChild(el('div', { className: 'unit-status-row' }, [
      el('span', { className: 'unit-status-label', textContent: 'Unidad' }),
      el('span', { className: 'unit-pill unit-status-' + unit.status, textContent: unit.unit + ' · ' + unit.tipoUnidad + ' · ' + unit.status.toUpperCase() })
    ]));
    container.appendChild(el('div', { className: 'unit-status-row', style: 'margin-top:6px;' }, [
      el('span', { className: 'unit-status-hint', textContent: (ui.crewName ? 'Guardia: ' + ui.crewName : '⚠ Sin identificar.') + (ui.pushRegistered ? ' · 📱 Push FCM OK' : '') }),
      dutyBtn
    ]));
  }

  function kv(k, v) {
    return el('div', { className: 'kv' }, [
      el('span', { className: 'k', textContent: k }),
      el('span', { className: 'v', textContent: v || '—' })
    ]);
  }

  async function renderActiveIncident() {
    const container = $('#activeIncidentContainer');
    const empty = $('#noIncidentPanel');
    if (!container || !empty) return;
    if (!ui.unitId) { container.hidden = true; empty.hidden = false; return; }
    const incident = Store.getActiveIncidentForUnit(ui.unitId);
    if (!incident) {
      ui.lastIncidentId = null;
      container.hidden = true;
      empty.hidden = false;
      return;
    }
    container.hidden = false; empty.hidden = true; container.innerHTML = '';

    if (ui.initialBootDone && incident.id !== ui.lastIncidentId) {
      playAlert();
    }
    ui.lastIncidentId = incident.id;

    const header = el('div', { className: 'guardia-card-header' }, [
      el('div', { className: 'guardia-card-id' }, [
        el('span', { textContent: incident.id }),
        el('span', { className: 'guardia-card-time', textContent: fmtDateTime(incident.createdAt) })
      ]),
      el('div', { className: 'guardia-card-badges' }, [
        el('span', { className: 'badge badge-state-' + incident.status, textContent: incident.status }),
        incident.priority ? el('span', { className: 'badge badge-priority-' + incident.priority, textContent: incident.priority }) : null
      ].filter(Boolean))
    ]);

    // Paciente
    const profiles = Store.listProfiles();
    const profile = profiles.find(p => p.dni === incident.profileDni);
    const patientCard = el('div', { className: 'guardia-card-block' }, [el('h3', { textContent: 'Datos del paciente' })]);
    if (profile) {
      patientCard.appendChild(kv('Nombre', profile.nombre));
      patientCard.appendChild(kv('DNI', profile.dni));
      patientCard.appendChild(kv('N° socio', profile.socioNumber));
      patientCard.appendChild(kv('Plan', (C.PLANS[profile.plan] || {}).label || profile.plan));
      if (profile.telefono) patientCard.appendChild(el('div', { className: 'kv' }, [
        el('span', { className: 'k', textContent: 'Teléfono' }),
        el('span', { className: 'v' }, [el('a', { href: 'tel:' + profile.telefono, className: 'guardia-link', textContent: '📞 ' + profile.telefono })])
      ]));
      patientCard.appendChild(el('div', { className: 'guardia-alert' }, [
        el('strong', { textContent: '⚠ Alerta clínica' }),
        el('div', { textContent: 'Grupo sanguíneo: ' + (profile.grupoSanguineo || 'No informado') }),
        el('div', { textContent: 'Alergias: ' + (profile.alergias || 'Sin registro') }),
        el('div', { textContent: 'Patologías: ' + (profile.patologias || 'Sin registro') }),
        el('div', { textContent: 'Contacto: ' + (profile.contacto || '—') })
      ]));
      try {
        const meds = await Store.getMedicationsForProfile(profile.id);
        if (meds.length) {
          const medsBlock = el('div', { className: 'guardia-card-block' }, [el('h3', { textContent: '💊 Medicación activa' })]);
          meds.forEach(m => {
            medsBlock.appendChild(el('div', { className: 'kv' }, [
              el('span', { className: 'k', textContent: m.nombre }),
              el('span', { className: 'v', textContent: (m.dosis || '') + (m.frecuencia ? ' · ' + m.frecuencia : '') })
            ]));
          });
          patientCard.appendChild(medsBlock);
        }
      } catch (_) {}
    } else {
      patientCard.appendChild(el('div', { className: 'guardia-warn', textContent: 'Socio sin ficha.' }));
    }

    // Ubicación
    const locationCard = el('div', { className: 'guardia-card-block' }, [el('h3', { textContent: 'Ubicación' })]);
    if (incident.location) {
      locationCard.appendChild(kv('Coordenadas', incident.location.lat.toFixed(6) + ', ' + incident.location.lng.toFixed(6)));
      locationCard.appendChild(kv('Precisión', '± ' + Math.round(incident.location.accuracy) + 'm'));
    }
    if (incident.manualAddress) locationCard.appendChild(kv('Dirección', incident.manualAddress));
    const nav = navUrl(incident);
    if (nav) locationCard.appendChild(el('a', { href: nav, target: '_blank', rel: 'noopener', className: 'btn-nav-big', textContent: '🧭 Navegar (Google Maps)' }));
    const osm = osmUrl(incident);
    if (osm) locationCard.appendChild(el('a', { href: osm, target: '_blank', rel: 'noopener', className: 'guardia-link', textContent: '🗺 OpenStreetMap' }));

    // GPS
    const manualGpsBtn = el('button', {
      type: 'button',
      className: 'btn-gps-manual',
      textContent: '📍 Actualizar ahora',
      onclick: () => updatePositionManual(manualGpsBtn)
    });
    const gpsCard = el('div', { className: 'guardia-card-block' }, [
      el('h3', { textContent: 'GPS de la unidad' }),
      el('div', { id: 'gpsStatusText', className: 'guardia-gps-status', textContent: ui.watchId ? 'GPS activo.' : 'GPS inactivo.' }),
      el('div', { className: 'guardia-gps-actions' }, [
        el('button', { type: 'button', className: ui.watchId ? 'btn-gps-stop' : 'btn-gps-start', textContent: ui.watchId ? '⏹ Detener GPS' : '▶ Activar GPS', onclick: () => { ui.watchId ? stopWatch() : startWatch(); render(); } }),
        manualGpsBtn
      ])
    ]);
    if (incident.status === 'EN_CAMINO' || incident.status === 'EN_ESCENA') {
      gpsCard.appendChild(el('button', { type: 'button', className: 'btn-support', textContent: '🚨 Solicitar Apoyo', onclick: () => openSupportDialog(incident) }));
    }

    // Acciones
    const actionsCard = el('div', { className: 'guardia-card-block' }, [el('h3', { textContent: 'Acciones' })]);
    const run = async (btn, fn, label) => {
      await runLoading(btn, async () => {
        try { await fn(); await render(); }
        catch (err) { alert('Error: ' + fmtErr(err)); }
      }, label);
    };

    switch (incident.status) {
      case 'MOVIL_ASIGNADO': {
        const bGo = el('button', {
          type: 'button', className: 'btn-action-big btn-action-go', textContent: '▶ Confirmar salida',
          onclick: () => run(bGo, () => Store.guardiaDispatchIncident(incident.id, ui.unitId, ui.crewName), 'Confirmando salida…')
        });
        actionsCard.appendChild(bGo);
        break;
      }
      case 'EN_CAMINO': {
        const bArr = el('button', {
          type: 'button', className: 'btn-action-big btn-action-go', textContent: '📍 Marcar arribo',
          onclick: () => run(bArr, () => Store.guardiaMarkOnScene(incident.id, ui.unitId, ui.crewName), 'Marcando arribo…')
        });
        actionsCard.appendChild(bArr);
        break;
      }
      case 'EN_ESCENA': {
        const destInput = el('input', { type: 'text', id: 'destCenter', maxlength: '120', placeholder: 'Ej: Hospital San Roque' });
        const bTr = el('button', {
          type: 'button', className: 'btn-action-big btn-action-blue', textContent: '🚑 Iniciar traslado',
          onclick: () => run(bTr, () => Store.guardiaMarkInTransit(incident.id, ui.unitId, destInput.value.trim(), ui.crewName), 'Iniciando traslado…')
        });
        const bCl = el('button', {
          type: 'button', className: 'btn-action-big btn-action-close', textContent: '✔ Cerrar intervención',
          onclick: () => run(bCl, async () => {
            await Store.guardiaCloseIncident(incident.id, ui.unitId, document.getElementById('closeReason').value, document.getElementById('closeNotes').value.trim(), ui.crewName);
            stopWatch();
          }, 'Cerrando…')
        });
        actionsCard.appendChild(el('label', { className: 'guardia-label' }, [el('span', { textContent: 'Centro receptor (si hay traslado)' }), destInput]));
        actionsCard.appendChild(bTr);
        actionsCard.appendChild(el('label', { className: 'guardia-label' }, [el('span', { textContent: 'Motivo de cierre' }), (function () {
          const sel = el('select', { id: 'closeReason' });
          ['Atención en domicilio sin traslado', 'Traslado efectivo', 'Falsa alarma', 'Derivado a sistema público'].forEach(r => sel.appendChild(el('option', { value: r, textContent: r })));
          return sel;
        })()]));
        actionsCard.appendChild(el('label', { className: 'guardia-label' }, [el('span', { textContent: 'Notas de cierre' }), el('textarea', { id: 'closeNotes', rows: '2', maxlength: '400' })]));
        actionsCard.appendChild(bCl);
        break;
      }
      case 'EN_TRASLADO': {
        const bCl2 = el('button', {
          type: 'button', className: 'btn-action-big btn-action-close', textContent: '✔ Cerrar intervención',
          onclick: () => run(bCl2, async () => {
            await Store.guardiaCloseIncident(incident.id, ui.unitId, document.getElementById('closeReason').value, document.getElementById('closeNotes').value.trim(), ui.crewName);
            stopWatch();
          }, 'Cerrando…')
        });
        actionsCard.appendChild(el('div', { className: 'guardia-info', textContent: 'Traslado hacia: ' + (incident.destinationCenter || '—') }));
        actionsCard.appendChild(el('label', { className: 'guardia-label' }, [el('span', { textContent: 'Motivo de cierre' }), (function () {
          const sel = el('select', { id: 'closeReason' });
          ['Traslado efectivo', 'Derivado a sistema público'].forEach(r => sel.appendChild(el('option', { value: r, textContent: r })));
          return sel;
        })()]));
        actionsCard.appendChild(el('label', { className: 'guardia-label' }, [el('span', { textContent: 'Notas de cierre' }), el('textarea', { id: 'closeNotes', rows: '2', maxlength: '400' })]));
        actionsCard.appendChild(bCl2);
        break;
      }
      default:
        actionsCard.appendChild(el('div', { className: 'guardia-warn', textContent: 'Estado: ' + incident.status }));
    }

    // Bitácora
    const bitacoraCard = el('div', { className: 'guardia-card-block' }, [
      el('h3', { textContent: 'Bitácora' }),
      el('ul', { className: 'guardia-bitacora' }, (incident.statusHistory || []).slice().reverse().map(h =>
        el('li', {}, [
          el('strong', { textContent: h.status }),
          el('span', { textContent: ' · ' + fmtDateTime(h.ts) + ' · ' + (h.actor || 'system') }),
          h.detail ? el('div', { className: 'guardia-bitacora-detail', textContent: h.detail }) : null
        ].filter(Boolean))
      ))
    ]);

    container.appendChild(el('div', { className: 'guardia-card guardia-card-main' }, [header]));
    container.appendChild(el('div', { className: 'guardia-card' }, [patientCard]));
    container.appendChild(el('div', { className: 'guardia-card' }, [locationCard]));
    container.appendChild(el('div', { className: 'guardia-card' }, [gpsCard]));
    container.appendChild(el('div', { className: 'guardia-card' }, [actionsCard]));
    container.appendChild(el('div', { className: 'guardia-card' }, [bitacoraCard]));
  }

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

  async function render() {
    renderUnitStatus();
    await renderActiveIncident();
    await renderHistory();
  }

  function initSubscription() {
    Store.subscribe(msg => {
      if (!msg) return;
      if (msg.type === 'AUTH_CHANGED') { location.reload(); return; }
      if (msg.type === 'BRANDING_CHANGED') applyBranding();
      if (msg.type !== 'STATE_CHANGED') return;
      render();
    });
    setInterval(() => render(), 5000);
  }

  async function bootGuardia() {
    await applyBranding();
    initSelectors();
    await render();
    ui.initialBootDone = true;
    initSubscription();
  }

  document.addEventListener('DOMContentLoaded', async () => {
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

  window.addEventListener('beforeunload', () => { stopWatch(); });
})();
