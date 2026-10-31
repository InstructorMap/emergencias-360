/* ============================================================
   app-central.js v8.3 — Consola Operativa EMP (C1 + F2 Push FCM)
   - Login staff (admin/operador) por email con spinner
   - F2: ui.operatorId + initPushRegistration() + profiles.on_duty + deep_link ?incident=
   - applyBrandingToPage() en el boot
   - Bandeja de incidentes en vivo (realtime)
   - Despacho con withButtonLoading y alertas de apoyo
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  const C = window.E360Config;
  if (!Store) { console.error('[app-central] E360Store no disponible.'); return; }

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

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
        if (k === 'innerHTML') { node.innerHTML = v; return; }
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

  function fmtTime(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return iso; } }
  function fmtDateTime(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return iso; } }

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

  const ui = {
    baseFilter: 'ALL',
    incidentFilter: 'active',
    selectedIncidentId: null,
    operatorId: null,
    operatorName: '',
    onDuty: true,
    lastPendingCount: 0
  };

  // ============ F2: REGISTRO PUSH FCM Y ESTADO ON_DUTY ============
  async function setOnDutyStatus(isOnDuty) {
    try {
      const rawState = typeof Store._getState === 'function' ? Store._getState() : null;
      const sb = rawState && rawState.supabase;
      const user = typeof Store.getUser === 'function' ? Store.getUser() : (rawState && rawState.user);
      const profileId = ui.operatorId || (rawState && rawState.profile && rawState.profile.id);
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
      console.warn('[app-central] Error actualizando on_duty:', e);
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
      const targetUserId = (authUser && authUser.id) || ui.operatorId;
      if (!sb || !targetUserId) return;

      await cap.registerPushToken(sb, targetUserId);
    } catch (err) {
      console.warn('[app-central] initPushRegistration:', err);
    }
  }

  function checkDeepLinkIncident() {
    try {
      const params = new URLSearchParams(window.location.search);
      const incId = params.get('incident');
      if (incId && Store.getIncidentById(incId)) {
        ui.selectedIncidentId = incId;
      }
    } catch (_) {}
  }

  // ============ LOGIN ============
  function showLogin() {
    const ov = $('#centralLoginOverlay'); if (ov) ov.hidden = false;
    const app = $('#centralApp'); if (app) app.hidden = true;
  }
  function hideLogin() {
    const ov = $('#centralLoginOverlay'); if (ov) ov.hidden = true;
    const app = $('#centralApp'); if (app) app.hidden = false;
  }

  function initLogin() {
    const form = $('#centralLoginForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#centralLoginMsg');
      const btn = $('#centralLoginBtn');
      const email = $('#centralLoginEmail').value.trim();
      const password = $('#centralLoginPassword').value;
      if (!email || !password) {
        if (msg) { msg.textContent = 'Completá email y contraseña.'; msg.style.color = '#DC2626'; }
        return;
      }
      await runLoading(btn, async () => {
        try {
          const profile = await Store.loginWithEmail(email, password);
          if (!profile || (profile.role !== 'admin' && profile.role !== 'operador')) {
            await Store.logout();
            throw new Error('Tu cuenta no tiene permisos de operador.');
          }
          ui.operatorName = profile.nombre || profile.dni;
          ui.operatorId = profile.id;
          hideLogin();
          await bootCentral();
          await initPushRegistration();
        } catch (err) {
          if (msg) { msg.textContent = fmtErr(err); msg.style.color = '#DC2626'; }
        }
      }, 'Ingresando…');
    });
    const logout = $('#centralLogout');
    if (logout) logout.addEventListener('click', async () => {
      if (!confirm('¿Cerrar sesión y salir de guardia?')) return;
      await runLoading(logout, async () => {
        await setOnDutyStatus(false);
        await Store.logout();
        location.reload();
      }, 'Saliendo…');
    });
  }

  // ============ BRANDING ============
  async function applyBranding() {
    try {
      const b = typeof Store.applyBrandingToPage === 'function'
        ? await Store.applyBrandingToPage()
        : await Store.loadBranding();
      if (b && b.logoUrl) {
        const brand = $('#centralHeaderBrand');
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

  // ============ FILTROS ============
  function initBaseSelector() {
    const sel = $('#centralBaseSelector');
    if (!sel) return;
    sel.value = ui.baseFilter;
    sel.addEventListener('change', () => {
      ui.baseFilter = sel.value;
      ui.selectedIncidentId = null;
      renderAll();
    });
  }

  function initIncidentFilters() {
    $$('.btn-incident-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.btn-incident-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        ui.incidentFilter = btn.dataset.filter;
        renderIncidentList();
      });
    });
  }

  // ============ BANDEJA ============
  function renderAlertCounter() {
    const counter = $('#alertCounter');
    if (!counter) return;
    const incidents = Store.getIncidents(ui.baseFilter);
    const pending = incidents.filter(i => i.status === 'RECIBIDA_SERVIDOR').length;
    counter.textContent = String(pending);
    if (pending > 0) counter.classList.add('pulse');
    else counter.classList.remove('pulse');
    ui.lastPendingCount = pending;
  }

  function renderIncidentList() {
    const list = $('#incidentList');
    const empty = $('#incidentEmpty');
    if (!list) return;
    list.innerHTML = '';
    const all = Store.getIncidents(ui.baseFilter);
    const closedStates = ['CERRADA', 'CANCELADA'];
    let items = ui.incidentFilter === 'active'
      ? all.filter(i => !closedStates.includes(i.status))
      : all.filter(i => closedStates.includes(i.status));
    if (!items.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    items.forEach(inc => {
      const pendingClass = inc.status === 'RECIBIDA_SERVIDOR' ? ' pending' : '';
      const selectedClass = inc.id === ui.selectedIncidentId ? ' selected' : '';
      const hasSupport = Array.isArray(inc.supportRequests) && inc.supportRequests.length > 0;
      list.appendChild(el('li', {
        className: 'incident-card' + pendingClass + selectedClass,
        onclick: () => { ui.selectedIncidentId = inc.id; renderIncidentList(); renderDetail(); }
      }, [
        el('div', { className: 'card-top' }, [
          el('span', { className: 'card-id', textContent: inc.id }),
          el('span', { className: 'card-time', textContent: fmtTime(inc.createdAt) })
        ]),
        el('div', { className: 'card-meta' }, [
          el('span', { className: 'badge badge-state-' + inc.status, textContent: inc.status }),
          inc.priority ? el('span', { className: 'badge badge-priority-' + inc.priority, textContent: inc.priority }) : null,
          hasSupport ? el('span', { className: 'badge badge-priority-ROJO', textContent: '🚨 PIDE APOYO' }) : null
        ].filter(Boolean)),
        el('div', { className: 'card-loc', textContent: 'Base: ' + (inc.baseId || 'DOLORES') + ' · ' + (inc.manualAddress || (inc.location ? ('GPS ' + inc.location.lat.toFixed(4) + ',' + inc.location.lng.toFixed(4)) : 'Sin ubicación')) })
      ]));
    });
  }

  // ============ DETALLE ============
  function kv(k, v) {
    return el('div', { className: 'kv' }, [
      el('span', { className: 'k', textContent: k }),
      el('span', { className: 'v', textContent: v || '—' })
    ]);
  }

  async function renderDetail() {
    const container = $('#detailContainer');
    if (!container) return;
    container.innerHTML = '';
    if (!ui.selectedIncidentId) {
      container.appendChild(el('div', { className: 'detail-empty', textContent: 'Seleccioná un incidente.' }));
      return;
    }
    const inc = Store.getIncidentById(ui.selectedIncidentId);
    if (!inc) {
      container.appendChild(el('div', { className: 'detail-empty', textContent: 'Incidente no disponible.' }));
      return;
    }

    if (Array.isArray(inc.supportRequests) && inc.supportRequests.length > 0) {
      const supBlock = el('div', { className: 'alerta-clinica' }, [
        el('strong', { textContent: '🚨 SOLICITUDES DE APOYO EN ESCENA (' + inc.supportRequests.length + ')' })
      ]);
      inc.supportRequests.forEach(sr => {
        supBlock.appendChild(el('div', { className: 'clin-row' }, [
          el('strong', { textContent: sr.type + ': ' }),
          el('span', { textContent: (sr.notes || 'Sin detalle') + ' · (' + fmtTime(sr.ts) + ' - ' + (sr.requestedBy || 'guardia') + ')' })
        ]));
      });
      container.appendChild(supBlock);
    }

    if (inc.b2bEstablishmentId) {
      const est = Store.getB2BById(inc.b2bEstablishmentId);
      if (est) {
        const b2bBlock = el('div', { className: 'detail-block' }, [
          el('h3', { textContent: '📍 Ingreso por QR Área Protegida B2B' }),
          kv('Establecimiento', est.name),
          kv('Rubro', est.type),
          kv('Dirección', est.address),
          kv('Teléfono referente', est.referencePhone),
          kv('Protocolo', est.protocol)
        ]);
        container.appendChild(b2bBlock);
      }
    }

    const patientBlock = el('div', { className: 'detail-block' }, [el('h3', { textContent: 'Datos del Socio' })]);
    let profile = null;
    try {
      const profiles = Store.listProfiles();
      profile = profiles.find(p => p.dni === inc.profileDni);
    } catch (_) {}

    if (profile) {
      patientBlock.appendChild(kv('Nombre', profile.nombre));
      patientBlock.appendChild(kv('DNI', profile.dni));
      patientBlock.appendChild(kv('N° socio', profile.socioNumber));
      patientBlock.appendChild(kv('Plan', (C.PLANS[profile.plan] || {}).label || profile.plan));
      patientBlock.appendChild(kv('Teléfono', profile.telefono));
      patientBlock.appendChild(kv('Grupo sanguíneo', profile.grupoSanguineo));
      patientBlock.appendChild(kv('Alergias', profile.alergias));
      patientBlock.appendChild(kv('Patologías', profile.patologias));
      patientBlock.appendChild(kv('Contacto emergencia', profile.contacto));

      try {
        const meds = await Store.getMedicationsForProfile(profile.id);
        if (meds.length) {
          const medsBlock = el('div', { className: 'detail-block' }, [el('h3', { textContent: '💊 Medicación activa' })]);
          meds.forEach(m => {
            medsBlock.appendChild(el('div', { className: 'med-line' }, [
              el('strong', { textContent: m.nombre }),
              el('span', { textContent: ' — ' + (m.dosis || '') + (m.frecuencia ? ' · ' + m.frecuencia : '') + (m.horarios && m.horarios.length ? ' · ' + m.horarios.join(', ') : '') })
            ]));
          });
          patientBlock.appendChild(medsBlock);
        }
      } catch (_) {}
    } else {
      patientBlock.appendChild(el('div', { className: 'warn-operador', textContent: 'Socio sin ficha.' }));
    }

    const geoBlock = el('div', { className: 'detail-block' }, [el('h3', { textContent: 'Ubicación y ETA' })]);
    if (inc.location) {
      geoBlock.appendChild(kv('Coordenadas', inc.location.lat.toFixed(6) + ', ' + inc.location.lng.toFixed(6)));
      geoBlock.appendChild(el('a', {
        href: 'https://www.openstreetmap.org/?mlat=' + inc.location.lat + '&mlon=' + inc.location.lng + '#map=17/' + inc.location.lat + '/' + inc.location.lng,
        target: '_blank', rel: 'noopener', className: 'gps-link', textContent: '🗺 Abrir en OpenStreetMap'
      }));
    }
    if (inc.manualAddress) geoBlock.appendChild(kv('Dirección manual', inc.manualAddress));

    try {
      const eta = Store.getIncidentEta(inc.id);
      if (eta && eta.hasEta) {
        geoBlock.appendChild(kv('ETA referencial', eta.etaMinutes + ' min (' + (eta.source === 'gps' ? 'GPS Móvil' : 'Estimación Base') + ')'));
      }
    } catch (_) {}

    const actionsBlock = buildActions(inc);

    const bitacoraBlock = el('div', { className: 'detail-block' }, [
      el('h3', { textContent: 'Bitácora' }),
      el('ul', { className: 'bitacora-list' }, (inc.statusHistory || []).slice().reverse().map(h =>
        el('li', {}, [
          el('strong', { textContent: h.status }),
          el('span', { textContent: ' · ' + fmtDateTime(h.ts) + ' · ' + (h.actor || 'system') }),
          h.detail ? el('div', { textContent: h.detail }) : null
        ].filter(Boolean))
      ))
    ]);

    container.appendChild(patientBlock);
    container.appendChild(geoBlock);
    container.appendChild(actionsBlock);
    container.appendChild(bitacoraBlock);
  }

  function buildActions(inc) {
    const block = el('div', { className: 'detail-actions' });
    const op = ui.operatorName || 'central';

    const run = async (btn, fn, label) => {
      await runLoading(btn, async () => {
        try { await fn(); renderAll(); }
        catch (err) { alert('Acción rechazada: ' + fmtErr(err)); }
      }, label);
    };

    const appendCancelBtn = () => {
      const cancelBtn = el('button', {
        type: 'button', className: 'btn-action btn-danger', textContent: 'Cancelar Incidente',
        onclick: () => {
          const reason = prompt('Motivo de cancelación (obligatorio):');
          if (!reason) return;
          run(cancelBtn, () => Store.cancelIncident(inc.id, reason, op), 'Cancelando…');
        }
      });
      block.appendChild(cancelBtn);
    };

    switch (inc.status) {
      case 'RECIBIDA_SERVIDOR': {
        const bAck = el('button', {
          type: 'button', className: 'btn-action btn-warn', textContent: '1. Acusar recibo',
          onclick: () => run(bAck, () => Store.acknowledgeIncident(inc.id, op), 'Acusando recibo…')
        });
        block.appendChild(bAck);
        appendCancelBtn();
        return block;
      }
      case 'ACEPTADA_POR_CENTRAL': {
        const bTri = el('button', {
          type: 'button', className: 'btn-action btn-ok', textContent: 'Confirmar Triage',
          onclick: () => run(bTri, () => Store.triageIncident(inc.id, $('#triagePriority').value, $('#triageNotes').value, op), 'Clasificando…')
        });
        block.appendChild(el('div', { className: 'inline-form' }, [
          el('label', {}, [
            el('span', { textContent: '2. Prioridad (Triage)' }),
            (function () {
              const sel = el('select', { id: 'triagePriority' });
              sel.appendChild(el('option', { value: 'ROJO', textContent: 'ROJO — Emergencia' }));
              sel.appendChild(el('option', { value: 'AMARILLO', textContent: 'AMARILLO — Urgencia' }));
              sel.appendChild(el('option', { value: 'VERDE', textContent: 'VERDE — Baja complejidad' }));
              return sel;
            })()
          ]),
          el('label', {}, [
            el('span', { textContent: 'Observación' }),
            el('textarea', { id: 'triageNotes', rows: '2', maxlength: '300' })
          ]),
          bTri
        ]));
        appendCancelBtn();
        return block;
      }
      case 'CLASIFICADA': {
        const units = Store.getFleet(inc.baseId).filter(u => u.status === 'disponible');
        const bAss = el('button', {
          type: 'button', className: 'btn-action btn-ok', textContent: 'Asignar',
          disabled: !units.length,
          onclick: () => run(bAss, () => Store.assignUnitToIncident(inc.id, $('#assignUnitId').value, $('#assignCrew').value, op), 'Asignando móvil…')
        });
        block.appendChild(el('div', { className: 'inline-form' }, [
          el('label', {}, [
            el('span', { textContent: '3. Asignar móvil' }),
            (function () {
              const sel = el('select', { id: 'assignUnitId' });
              if (!units.length) sel.appendChild(el('option', { value: '', textContent: '— Sin móviles —' }));
              else units.forEach(u => sel.appendChild(el('option', { value: u.id, textContent: u.unit + ' (' + u.tipoUnidad + ')' })));
              return sel;
            })()
          ]),
          el('label', {}, [
            el('span', { textContent: 'Dotación / notas' }),
            el('input', { type: 'text', id: 'assignCrew', maxlength: '120' })
          ]),
          bAss
        ]));
        appendCancelBtn();
        return block;
      }
      case 'MOVIL_ASIGNADO': {
        const bDisp = el('button', {
          type: 'button', className: 'btn-action btn-ok', textContent: '4. Confirmar salida — Móvil en camino',
          onclick: () => run(bDisp, () => Store.dispatchIncidentUnit(inc.id, op), 'Despachando…')
        });
        block.appendChild(bDisp);
        appendCancelBtn();
        return block;
      }
      case 'EN_CAMINO': {
        const bScn = el('button', {
          type: 'button', className: 'btn-action btn-ok', textContent: '5. Marcar arribo en escena',
          onclick: () => run(bScn, () => Store.markIncidentOnScene(inc.id, op), 'Marcando arribo…')
        });
        block.appendChild(bScn);
        appendCancelBtn();
        return block;
      }
      case 'EN_ESCENA': {
        const bTr = el('button', {
          type: 'button', className: 'btn-action', textContent: 'Registrar traslado',
          onclick: () => run(bTr, () => Store.markIncidentInTransit(inc.id, $('#destCenter').value, op), 'Registrando traslado…')
        });
        block.appendChild(el('div', { className: 'inline-form' }, [
          el('label', {}, [
            el('span', { textContent: '6. Centro receptor (traslado)' }),
            el('input', { type: 'text', id: 'destCenter', maxlength: '120', placeholder: 'Ej: Hospital San Roque' })
          ]),
          bTr,
          buildCloseForm(inc, op, run)
        ]));
        return block;
      }
      case 'EN_TRASLADO':
        block.appendChild(el('div', { className: 'inline-form' }, [buildCloseForm(inc, op, run)]));
        return block;
      case 'CERRADA':
      case 'CANCELADA':
        block.appendChild(el('div', { className: 'warn-operador', textContent: 'Incidente finalizado. Motivo: ' + (inc.closureReason || '—') }));
        if (inc.outcomeNotes) block.appendChild(el('div', { className: 'detail-block', textContent: inc.outcomeNotes }));
        return block;
      default:
        block.appendChild(el('div', { className: 'warn-operador', textContent: 'Estado no manejado: ' + inc.status }));
        return block;
    }
  }

  function buildCloseForm(inc, op, run) {
    const reasons = ['Atención en domicilio sin traslado', 'Traslado efectivo a centro de salud', 'Falsa alarma', 'Derivado a sistema público'];
    const sel = el('select', { id: 'closeReason' });
    reasons.forEach(r => sel.appendChild(el('option', { value: r, textContent: r })));
    const bCl = el('button', {
      type: 'button', className: 'btn-action btn-ok', textContent: 'Cerrar incidente',
      onclick: () => run(bCl, () => Store.closeIncident(inc.id, $('#closeReason').value, $('#closeNotes').value, op), 'Cerrando…')
    });
    return el('div', { className: 'inline-form' }, [
      el('label', {}, [el('span', { textContent: 'Motivo de cierre' }), sel]),
      el('label', {}, [el('span', { textContent: 'Notas de cierre (obligatorias)' }), el('textarea', { id: 'closeNotes', rows: '2', maxlength: '400' })]),
      bCl
    ]);
  }

  // ============ FLOTA ============
  function renderFleet() {
    const container = $('#fleetContainer');
    if (!container) return;
    container.innerHTML = '';
    const bases = Store.getBases();
    bases.forEach(base => {
      const units = Store.getFleet(base.id);
      container.appendChild(el('div', { className: 'fleet-base-header' }, [
        el('div', { className: 'fb-name', textContent: base.name }),
        el('div', { className: 'fb-phone', textContent: '📞 ' + base.phone })
      ]));
      const list = el('ul', { className: 'fleet-list' });
      units.forEach(u => {
        list.appendChild(el('li', { className: 'unit-card' }, [
          el('div', { className: 'unit-top' }, [
            el('span', { className: 'unit-name', textContent: u.unit }),
            el('span', { className: 'unit-status-' + u.status, textContent: u.status.toUpperCase() })
          ]),
          el('div', { style: 'font-size:0.72rem;color:#94A3B8;', textContent: 'Tipo: ' + u.tipoUnidad })
        ]));
      });
      container.appendChild(list);
      container.appendChild(el('div', { style: 'height:8px' }));
    });
  }

  function renderAll() {
    renderAlertCounter();
    renderIncidentList();
    renderDetail();
    renderFleet();
  }

  function initSubscription() {
    Store.subscribe(msg => {
      if (!msg) return;
      if (msg.type === 'AUTH_CHANGED') { location.reload(); return; }
      if (msg.type === 'BRANDING_CHANGED') applyBranding();
      if (msg.type !== 'STATE_CHANGED') return;
      renderAll();
    });
  }

  async function bootCentral() {
    await applyBranding();
    initBaseSelector();
    initIncidentFilters();
    checkDeepLinkIncident();
    initSubscription();
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await applyBranding();
    initLogin();
    const session = await Store.initSession();
    if (session.loggedIn && session.profile && (session.profile.role === 'admin' || session.profile.role === 'operador')) {
      ui.operatorName = session.profile.nombre || session.profile.dni;
      ui.operatorId = session.profile.id;
      hideLogin();
      await bootCentral();
      await initPushRegistration();
    } else {
      if (session.loggedIn) await Store.logout();
      showLogin();
    }
  });
})();
