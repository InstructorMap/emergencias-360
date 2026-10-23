/* ============================================================
   app-guardia.js — Controlador de guardia.html (MVP)
   - Alertas por audio + vibración + Notification API
   - watchPosition GPS con throttle de 20s
   - Solicitud de apoyo / refuerzo a central (monkey-patch sobre Store)
   - Botón de navegación rápida OSM / Google Maps
   - Suscripción BroadcastChannel (live)
   - Fix H-01: helper el() respeta disabled=null/false
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  const C = window.E360Config;
  const SM = window.E360StateMachine;

  if (!Store || !C || !SM) {
    console.error('[app-guardia] Faltan config.js / state-machine.js / store.js.');
    return;
  }

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const THROTTLE_MS = 20000;
  const STORAGE_UI_KEY = 'e360_guardia_ui_v1';

  const uiState = {
    baseId: 'DOLORES',
    unitId: null,
    crewName: '',
    lastIncidentId: null,
    lastStatus: null,
    lastPendingAssignedId: null,
    audioCtx: null,
    watchId: null,
    lastPositionUpdateAt: 0,
    notificationPermission: (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported',
    refreshTimer: null
  };

  // ============================================================
  // H-01: helper el() seguro
  // ============================================================
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const val = attrs[k];
        if (val === null || val === undefined || val === false) return;
        if (val === true) { node.setAttribute(k, ''); return; }
        if (k === 'className') { node.className = val; return; }
        if (k === 'textContent') { node.textContent = val; return; }
        if (k === 'onclick' && typeof val === 'function') { node.addEventListener('click', val); return; }
        node.setAttribute(k, val);
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
    try {
      return new Date(iso).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (_) { return iso; }
  }

  // ============================================================
  // PERSISTENCIA LOCAL DE LA UI (recordar base/móvil/nombre)
  // ============================================================
  function saveUiState() {
    try {
      localStorage.setItem(STORAGE_UI_KEY, JSON.stringify({
        baseId: uiState.baseId,
        unitId: uiState.unitId,
        crewName: uiState.crewName
      }));
    } catch (_) {}
  }
  function loadUiState() {
    try {
      const raw = localStorage.getItem(STORAGE_UI_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.baseId) uiState.baseId = parsed.baseId;
      if (parsed.unitId) uiState.unitId = parsed.unitId;
      if (parsed.crewName) uiState.crewName = parsed.crewName;
    } catch (_) {}
  }

  // ============================================================
  // AUDIO + VIBRACIÓN + NOTIFICACIÓN
  // ============================================================
  function ensureAudio() {
    if (uiState.audioCtx) return uiState.audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      uiState.audioCtx = new Ctx();
    } catch (err) {
      console.warn('[app-guardia] AudioContext error', err);
    }
    return uiState.audioCtx;
  }

  function playNewAssignmentAlert() {
    // Audio: secuencia ascendente tipo sirena suave
    const ctx = ensureAudio();
    if (ctx) {
      try {
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        const seq = [660, 880, 1100, 1320];
        seq.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, now + i * 0.18);
          gain.gain.exponentialRampToValueAtTime(0.28, now + i * 0.18 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.18);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now + i * 0.18);
          osc.stop(now + i * 0.18 + 0.2);
        });
      } catch (err) {
        console.warn('[app-guardia] play error', err);
      }
    }
    // Vibración
    if (navigator.vibrate) {
      try { navigator.vibrate(C.GUARDIA.vibrationPattern); } catch (_) {}
    }
    // Notification API
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('🚨 Nuevo incidente asignado', {
          body: 'Central Operativa te asignó un móvil. Abrí la app para confirmar salida.',
          tag: 'e360-guardia',
          requireInteraction: true
        });
      } catch (_) {}
    }
  }

  function requestNotificationPermissionOnce() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') return;
    Notification.requestPermission().then((perm) => {
      uiState.notificationPermission = perm;
    }).catch(() => {});
  }

  // ============================================================
  // SELECTORES: BASE, MÓVIL, NOMBRE
  // ============================================================
  function populateUnitSelector() {
    const sel = $('#guardiaUnitSelector');
    if (!sel) return;
    sel.innerHTML = '';
    const units = Store.getFleet(uiState.baseId);
    if (!units.length) {
      sel.appendChild(el('option', { value: '', textContent: '— Sin móviles en esta base —' }));
      uiState.unitId = null;
      return;
    }
    units.forEach((u) => {
      const opt = el('option', {
        value: u.id,
        textContent: u.unit + ' · ' + u.status.toUpperCase()
      });
      if (u.id === uiState.unitId) opt.selected = true;
      sel.appendChild(opt);
    });
    // Si la unidad guardada no existe en la nueva base, tomar la primera
    if (!units.some(u => u.id === uiState.unitId)) {
      uiState.unitId = units[0].id;
      sel.value = uiState.unitId;
    }
  }

  function initSelectors() {
    loadUiState();

    const baseSel = $('#guardiaBaseSelector');
    const unitSel = $('#guardiaUnitSelector');
    const nameInput = $('#guardiaNameInput');

    baseSel.value = uiState.baseId;
    nameInput.value = uiState.crewName;

    populateUnitSelector();
    if (uiState.unitId) unitSel.value = uiState.unitId;

    baseSel.addEventListener('change', () => {
      uiState.baseId = baseSel.value;
      uiState.unitId = null;
      populateUnitSelector();
      saveUiState();
      stopWatchPosition();
      render();
    });

    unitSel.addEventListener('change', () => {
      uiState.unitId = unitSel.value;
      saveUiState();
      stopWatchPosition();
      render();
    });

    nameInput.addEventListener('input', () => {
      uiState.crewName = nameInput.value.trim();
      saveUiState();
    });

    nameInput.addEventListener('blur', () => {
      if (uiState.crewName) requestNotificationPermissionOnce();
    });
  }

  // ============================================================
  // GPS: watchPosition con throttle de 20s (H-03)
  // ============================================================
  function updateGpsStatus(text, color) {
    const node = document.getElementById('gpsStatusText');
    if (!node) return;
    node.textContent = text;
    node.style.color = color === 'green' ? 'var(--color-green)'
      : color === 'red' ? 'var(--color-red)'
      : 'var(--color-amber)';
  }

  function startWatchPosition() {
    if (!navigator.geolocation) {
      updateGpsStatus('GPS no disponible en este dispositivo.', 'red');
      return;
    }
    if (!uiState.crewName) {
      alert('Ingresá tu nombre primero.');
      return;
    }
    const inc = Store.getActiveIncidentForUnit(uiState.unitId);
    if (!inc) {
      alert('Sin incidente activo asignado a este móvil.');
      return;
    }
    if (uiState.watchId) return;

    uiState.lastPositionUpdateAt = 0;
    uiState.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - uiState.lastPositionUpdateAt < THROTTLE_MS) return;

        const active = Store.getActiveIncidentForUnit(uiState.unitId);
        if (!active) return;
        if (active.status !== 'EN_CAMINO' && active.status !== 'EN_ESCENA') return;

        uiState.lastPositionUpdateAt = now;
        try {
          Store.updateCrewPosition(active.id, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          }, uiState.crewName);
          updateGpsStatus('GPS activo — última actualización ' + new Date().toLocaleTimeString('es-AR'), 'green');
          render();
        } catch (err) {
          console.warn('[app-guardia] updateCrewPosition error', err);
        }
      },
      (err) => {
        console.warn('[app-guardia] watchPosition error', err);
        updateGpsStatus('GPS error: ' + err.message, 'red');
      },
      C.GUARDIA.watchPositionOptions
    );
    updateGpsStatus('GPS activo — actualización cada ' + (THROTTLE_MS / 1000) + 's', 'green');
    render();
  }

  function stopWatchPosition() {
    if (uiState.watchId) {
      try { navigator.geolocation.clearWatch(uiState.watchId); } catch (_) {}
      uiState.watchId = null;
    }
    updateGpsStatus('GPS inactivo.', 'amber');
  }

  function updatePositionManual() {
    if (!navigator.geolocation) {
      alert('GPS no disponible.');
      return;
    }
    if (!uiState.crewName) {
      alert('Ingresá tu nombre primero.');
      return;
    }
    const inc = Store.getActiveIncidentForUnit(uiState.unitId);
    if (!inc) {
      alert('Sin incidente activo.');
      return;
    }
    updateGpsStatus('Obteniendo GPS…', 'amber');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        try {
          Store.updateCrewPosition(inc.id, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          }, uiState.crewName);
          uiState.lastPositionUpdateAt = Date.now();
          updateGpsStatus('Posición enviada (manual).', 'green');
          render();
        } catch (err) {
          updateGpsStatus('Error: ' + err.message, 'red');
        }
      },
      (err) => {
        updateGpsStatus('GPS error: ' + err.message, 'red');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  }

  // ============================================================
  // SOLICITAR APOYO (monkey-patch sobre Store)
  // ============================================================
  function ensureSupportMethod() {
    if (Store.requestSupportFromCrew) return;

    Store.requestSupportFromCrew = function (incidentId, unitId, supportType, notes, crewName) {
      const actor = String(crewName || '').trim();
      if (!actor) throw new Error('Se requiere identificación del personal de guardia.');
      const type = String(supportType || '').trim();
      if (!type) throw new Error('Seleccioná un tipo de apoyo.');

      const state = this._getState();
      const inc = state.incidents.find(i => i.id === incidentId);
      if (!inc) throw new Error('Incidente no encontrado.');
      if (inc.assignedUnitId !== unitId) throw new Error('El incidente no está asignado a tu móvil.');
      if (inc.status !== 'EN_CAMINO' && inc.status !== 'EN_ESCENA') {
        throw new Error('Solo se puede solicitar apoyo en EN_CAMINO o EN_ESCENA.');
      }

      const ts = new Date().toISOString();
      inc.supportRequests = inc.supportRequests || [];
      inc.supportRequests.push({ ts, type, notes: notes || '', requestedBy: actor });
      inc.statusHistory.push({
        status: inc.status,
        ts,
        actor,
        detail: 'Solicitud de apoyo: ' + type + (notes ? ' — ' + notes : '')
      });

      state.audit_logs.unshift({
        id: 'aud_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        ts,
        action: 'REQUEST_SUPPORT',
        payload: { incidentId, unitId, supportType: type, notes: notes || '' },
        actor
      });
      if (state.audit_logs.length > C.AUDIT_MAX_ENTRIES) {
        state.audit_logs.length = C.AUDIT_MAX_ENTRIES;
      }

      try {
        localStorage.setItem(C.STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        throw new Error('No se pudo guardar la solicitud.');
      }
      try {
        const ch = new BroadcastChannel(C.CHANNEL_NAME);
        ch.postMessage({ type: 'STATE_CHANGED', ts: Date.now() });
        ch.close();
      } catch (_) {}
      return JSON.parse(JSON.stringify(inc));
    };
  }

  function openSupportDialog(incident) {
    const types = [
      'Segunda unidad médica EMP',
      'Apoyo Policial 911',
      'Bomberos / Rescate'
    ];

    const overlay = el('div', { className: 'guardia-modal-overlay' });
    const dialog = el('div', { className: 'guardia-modal' }, [
      el('h3', { textContent: '🚨 Solicitar Apoyo / Refuerzo a Central' }),
      el('p', { className: 'guardia-modal-sub', textContent: 'Seleccioná el tipo de apoyo y agregá notas si corresponde. La solicitud queda registrada en el historial del incidente y en auditoría.' }),
      el('label', {}, [
        el('span', { textContent: 'Tipo de apoyo' }),
        (function () {
          const sel = el('select', { id: 'supportType' });
          types.forEach(t => sel.appendChild(el('option', { value: t, textContent: t })));
          return sel;
        })()
      ]),
      el('label', {}, [
        el('span', { textContent: 'Notas adicionales (opcional)' }),
        el('textarea', { id: 'supportNotes', rows: '3', maxlength: '200', placeholder: 'Ej: paciente politraumatizado, requiere inmovilización.' })
      ]),
      el('div', { className: 'guardia-modal-actions' }, [
        el('button', {
          type: 'button', className: 'btn-cancel',
          textContent: 'Cancelar',
          onclick: () => document.body.removeChild(overlay)
        }),
        el('button', {
          type: 'button', className: 'btn-confirm',
          textContent: 'Enviar solicitud',
          onclick: () => {
            try {
              if (!uiState.crewName) throw new Error('Ingresá tu nombre primero.');
              const type = document.getElementById('supportType').value;
              const notes = document.getElementById('supportNotes').value.trim();
              Store.requestSupportFromCrew(incident.id, uiState.unitId, type, notes, uiState.crewName);
              document.body.removeChild(overlay);
              render();
            } catch (err) {
              alert('Error: ' + err.message);
            }
          }
        })
      ])
    ]);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  // ============================================================
  // NAVEGACIÓN RÁPIDA (OSM + Google Maps dirección)
  // ============================================================
  function buildNavigationUrl(incident) {
    if (incident.location && typeof incident.location.lat === 'number') {
      return 'https://www.google.com/maps/dir/?api=1&destination=' +
        incident.location.lat + ',' + incident.location.lng + '&travelmode=driving';
    }
    if (incident.manualAddress) {
      return 'https://www.google.com/maps/dir/?api=1&destination=' +
        encodeURIComponent(incident.manualAddress) + '&travelmode=driving';
    }
    return null;
  }

  function buildOsmUrl(incident) {
    if (incident.location && typeof incident.location.lat === 'number') {
      return 'https://www.openstreetmap.org/?mlat=' + incident.location.lat +
        '&mlon=' + incident.location.lng +
        '#map=17/' + incident.location.lat + '/' + incident.location.lng;
    }
    if (incident.manualAddress) {
      return 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(incident.manualAddress);
    }
    return null;
  }

  // ============================================================
  // RENDER: ESTADO DE UNIDAD
  // ============================================================
  function renderUnitStatus() {
    const container = $('#unitStatus');
    if (!container) return;
    container.innerHTML = '';

    if (!uiState.unitId) {
      container.appendChild(el('span', { className: 'unit-status-text', textContent: 'Seleccioná base y móvil.' }));
      return;
    }
    const units = Store.getFleet(uiState.baseId);
    const unit = units.find(u => u.id === uiState.unitId);
    if (!unit) {
      container.appendChild(el('span', { className: 'unit-status-text', textContent: 'Móvil no encontrado.' }));
      return;
    }

    const cls = 'unit-pill unit-status-' + unit.status;
    container.appendChild(el('div', { className: 'unit-status-row' }, [
      el('span', { className: 'unit-status-label', textContent: 'Estado de la unidad' }),
      el('span', { className: cls, textContent: unit.unit + ' · ' + unit.status.toUpperCase() })
    ]));
    container.appendChild(el('div', {
      className: 'unit-status-hint',
      textContent: uiState.crewName
        ? 'Guardia: ' + uiState.crewName
        : '⚠ Ingresá tu nombre en la cabecera para operar.'
    }));
  }

  // ============================================================
  // RENDER: INCIDENTE ACTIVO
  // ============================================================
  function renderActiveIncident() {
    const container = $('#activeIncidentContainer');
    const emptyPanel = $('#noIncidentPanel');
    if (!container || !emptyPanel) return;

    if (!uiState.unitId) {
      container.hidden = true;
      emptyPanel.hidden = false;
      return;
    }

    const incident = Store.getActiveIncidentForUnit(uiState.unitId);
    if (!incident) {
      container.hidden = true;
      emptyPanel.hidden = false;
      return;
    }

    container.hidden = false;
    emptyPanel.hidden = true;
    container.innerHTML = '';

    // ---------- Detección de nuevo incidente ----------
    if (incident.id !== uiState.lastIncidentId || incident.status !== uiState.lastStatus) {
      if (uiState.lastIncidentId && incident.id !== uiState.lastIncidentId) {
        playNewAssignmentAlert();
      }
      uiState.lastIncidentId = incident.id;
      uiState.lastStatus = incident.status;
    }

    // ---------- Tarjeta principal ----------
    const statusBadgeClass = 'badge badge-state-' + incident.status;
    const priorityClass = incident.priority ? 'badge badge-priority-' + incident.priority : null;

    const header = el('div', { className: 'guardia-card-header' }, [
      el('div', { className: 'guardia-card-id' }, [
        el('span', { textContent: incident.id }),
        el('span', { className: 'guardia-card-time', textContent: fmtDateTime(incident.createdAt) })
      ]),
      el('div', { className: 'guardia-card-badges' }, [
        el('span', { className: statusBadgeClass, textContent: incident.status }),
        priorityClass ? el('span', { className: priorityClass, textContent: 'CÓDIGO ' + incident.priority }) : null
      ].filter(Boolean))
    ]);

    // ---------- Datos del paciente ----------
    const profile = incident.profileDni ? Store.getProfile(incident.profileDni) : null;
    const patientCard = el('div', { className: 'guardia-card-block' }, [
      el('h3', { textContent: 'Datos del paciente' })
    ]);

    if (profile) {
      patientCard.appendChild(kv('Nombre', profile.nombre || '—'));
      patientCard.appendChild(kv('DNI', profile.dni || '—'));
      if (profile.telefono) {
        const telLink = el('a', {
          href: 'tel:' + profile.telefono,
          className: 'guardia-link',
          textContent: '📞 Llamar ' + profile.telefono
        });
        patientCard.appendChild(el('div', { className: 'kv' }, [
          el('span', { className: 'k', textContent: 'Teléfono' }),
          el('span', { className: 'v' }, [telLink])
        ]));
      }
      patientCard.appendChild(el('div', { className: 'guardia-alert' }, [
        el('strong', { textContent: '⚠ Alerta clínica' }),
        el('div', { textContent: 'Grupo sanguíneo: ' + (profile.grupoSanguineo || 'No informado') }),
        el('div', { textContent: 'Alergias críticas: ' + (profile.alergias || 'Sin registro') }),
        el('div', { textContent: 'Patologías: ' + (profile.patologias || 'Sin registro') }),
        el('div', { textContent: 'Contacto emergencia: ' + (profile.contacto || '—') })
      ]));
    } else {
      patientCard.appendChild(el('div', {
        className: 'guardia-warn',
        textContent: 'El socio no completó ficha. Solicitá datos por teléfono a la Central.'
      }));
    }

    // ---------- Ubicación + navegación ----------
    const locationCard = el('div', { className: 'guardia-card-block' }, [
      el('h3', { textContent: 'Ubicación del incidente' })
    ]);
    if (incident.location) {
      locationCard.appendChild(kv('Coordenadas', incident.location.lat.toFixed(6) + ', ' + incident.location.lng.toFixed(6)));
      locationCard.appendChild(kv('Precisión', '± ' + Math.round(incident.location.accuracy) + ' m'));
    } else {
      locationCard.appendChild(el('div', { className: 'guardia-warn', textContent: 'Sin GPS del socio. Solo dirección manual.' }));
    }
    if (incident.manualAddress) {
      locationCard.appendChild(kv('Dirección manual', incident.manualAddress));
    }

    // Botón grande de navegación
    const navUrl = buildNavigationUrl(incident);
    if (navUrl) {
      locationCard.appendChild(el('a', {
        className: 'btn-nav-big',
        href: navUrl,
        target: '_blank',
        rel: 'noopener',
        textContent: '🧭 Abrir Navegación (Google Maps)'
      }));
    }
    const osmUrl = buildOsmUrl(incident);
    if (osmUrl) {
      locationCard.appendChild(el('a', {
        className: 'guardia-link',
        href: osmUrl,
        target: '_blank',
        rel: 'noopener',
        textContent: '🗺 Ver punto en OpenStreetMap'
      }));
    }

    // ---------- Notas de la Central ----------
    if (incident.clinicalNotes || incident.crewNotes) {
      const notesCard = el('div', { className: 'guardia-card-block' }, [
        el('h3', { textContent: 'Notas de Central / Despacho' }),
        incident.priority ? kv('Prioridad', 'Código ' + incident.priority) : null,
        incident.clinicalNotes ? kv('Clínicas', incident.clinicalNotes) : null,
        incident.crewNotes ? kv('Dotación', incident.crewNotes) : null
      ].filter(Boolean));
      patientCard.parentNode; // no-op para no romper
      // Se agrega al bloque siguiente, no al paciente
      // (lo dejamos abajo en el render final)
      // Guardamos en una variable externa:
    }

    // ---------- GPS + Solicitar Apoyo ----------
    const gpsCard = el('div', { className: 'guardia-card-block' }, [
      el('h3', { textContent: 'GPS de la unidad' }),
      el('div', { id: 'gpsStatusText', className: 'guardia-gps-status', textContent: uiState.watchId ? 'GPS activo.' : 'GPS inactivo.' }),
      el('div', { className: 'guardia-gps-actions' }, [
        el('button', {
          type: 'button',
          className: uiState.watchId ? 'btn-gps-stop' : 'btn-gps-start',
          textContent: uiState.watchId ? '⏹ Detener GPS en vivo' : '▶ Activar GPS en vivo',
          onclick: () => {
            if (uiState.watchId) stopWatchPosition();
            else startWatchPosition();
            render();
          }
        }),
        el('button', {
          type: 'button',
          className: 'btn-gps-manual',
          textContent: '📍 Actualizar mi posición ahora',
          onclick: () => updatePositionManual()
        })
      ])
    ]);

    // Soporte (solo EN_CAMINO o EN_ESCENA)
    const canSupport = incident.status === 'EN_CAMINO' || incident.status === 'EN_ESCENA';
    if (canSupport) {
      gpsCard.appendChild(el('button', {
        type: 'button',
        className: 'btn-support',
        textContent: '🚨 Solicitar Apoyo / Refuerzo a Central',
        onclick: () => openSupportDialog(incident)
      }));
    }

    // ---------- Acciones por estado ----------
    const actionsCard = el('div', { className: 'guardia-card-block guardia-actions-block' }, [
      el('h3', { textContent: 'Acciones del incidente' })
    ]);

    const requireCrew = () => {
      if (!uiState.crewName) throw new Error('Ingresá tu nombre en la cabecera antes de operar.');
      return uiState.crewName;
    };

    const runAction = (fn) => {
      try { fn(); render(); }
      catch (err) { alert('Acción rechazada: ' + err.message); }
    };

    switch (incident.status) {
      case 'MOVIL_ASIGNADO': {
        actionsCard.appendChild(el('button', {
          type: 'button', className: 'btn-action-big btn-action-go',
          textContent: '▶ Confirmar Salida (Móvil en Camino)',
          onclick: () => runAction(() => {
            const crew = requireCrew();
            Store.guardiaDispatchIncident(incident.id, uiState.unitId, crew);
          })
        }));
        break;
      }
      case 'EN_CAMINO': {
        actionsCard.appendChild(el('button', {
          type: 'button', className: 'btn-action-big btn-action-go',
          textContent: '📍 Marcar Arribo (EN_ESCENA)',
          onclick: () => runAction(() => {
            const crew = requireCrew();
            Store.guardiaMarkOnScene(incident.id, uiState.unitId, crew);
          })
        }));
        break;
      }
      case 'EN_ESCENA': {
        const destInput = el('input', {
          type: 'text', id: 'guardiaDestCenter',
          maxlength: '120',
          placeholder: 'Ej: Hospital San Roque Dolores'
        });
        const closeReasonSel = el('select', { id: 'guardiaCloseReason' });
        [
          'Atención en domicilio sin traslado',
          'Traslado efectivo a centro de salud',
          'Falsa alarma / Error de usuario',
          'Derivado a sistema público 107/911'
        ].forEach(r => closeReasonSel.appendChild(el('option', { value: r, textContent: r })));

        actionsCard.appendChild(el('label', { className: 'guardia-label' }, [
          el('span', { textContent: 'Centro receptor (si hay traslado)' }),
          destInput
        ]));
        actionsCard.appendChild(el('button', {
          type: 'button', className: 'btn-action-big btn-action-blue',
          textContent: '🚑 Iniciar Traslado (EN_TRASLADO)',
          onclick: () => runAction(() => {
            const crew = requireCrew();
            const dest = destInput.value.trim();
            Store.guardiaMarkInTransit(incident.id, uiState.unitId, dest, crew);
          })
        }));

        actionsCard.appendChild(el('label', { className: 'guardia-label' }, [
          el('span', { textContent: 'Motivo de cierre' }),
          closeReasonSel
        ]));
        const closeNotes = el('textarea', {
          id: 'guardiaCloseNotes',
          rows: '2',
          maxlength: '400',
          placeholder: 'Notas de cierre obligatorias'
        });
        actionsCard.appendChild(el('label', { className: 'guardia-label' }, [
          el('span', { textContent: 'Notas de cierre (obligatorias)' }),
          closeNotes
        ]));
        actionsCard.appendChild(el('button', {
          type: 'button', className: 'btn-action-big btn-action-close',
          textContent: '✔ Cerrar Intervención (CERRADA)',
          onclick: () => runAction(() => {
            const crew = requireCrew();
            const reason = closeReasonSel.value;
            const notes = closeNotes.value.trim();
            Store.guardiaCloseIncident(incident.id, uiState.unitId, reason, notes, crew);
            stopWatchPosition();
          })
        }));
        break;
      }
      case 'EN_TRASLADO': {
        const closeReasonSel = el('select', { id: 'guardiaCloseReason2' });
        [
          'Traslado efectivo a centro de salud',
          'Derivado a sistema público 107/911'
        ].forEach(r => closeReasonSel.appendChild(el('option', { value: r, textContent: r })));
        const closeNotes = el('textarea', {
          id: 'guardiaCloseNotes2',
          rows: '2',
          maxlength: '400',
          placeholder: 'Notas de cierre obligatorias'
        });
        actionsCard.appendChild(el('div', {
          className: 'guardia-info',
          textContent: 'Traslado en curso hacia: ' + (incident.destinationCenter || '—')
        }));
        actionsCard.appendChild(el('label', { className: 'guardia-label' }, [
          el('span', { textContent: 'Motivo de cierre' }),
          closeReasonSel
        ]));
        actionsCard.appendChild(el('label', { className: 'guardia-label' }, [
          el('span', { textContent: 'Notas de cierre' }),
          closeNotes
        ]));
        actionsCard.appendChild(el('button', {
          type: 'button', className: 'btn-action-big btn-action-close',
          textContent: '✔ Cerrar Intervención (CERRADA)',
          onclick: () => runAction(() => {
            const crew = requireCrew();
            Store.guardiaCloseIncident(incident.id, uiState.unitId, closeReasonSel.value, closeNotes.value.trim(), crew);
            stopWatchPosition();
          })
        }));
        break;
      }
      default: {
        actionsCard.appendChild(el('div', {
          className: 'guardia-warn',
          textContent: 'Estado no operable por guardia en este momento: ' + incident.status
        }));
      }
    }

    // ---------- Notas de Central (si existen) ----------
    let notesCardEl = null;
    if (incident.clinicalNotes || incident.crewNotes) {
      notesCardEl = el('div', { className: 'guardia-card-block' }, [
        el('h3', { textContent: 'Notas de Central / Despacho' }),
        incident.priority ? kv('Prioridad', 'Código ' + incident.priority) : null,
        incident.clinicalNotes ? kv('Clínicas', incident.clinicalNotes) : null,
        incident.crewNotes ? kv('Dotación', incident.crewNotes) : null
      ].filter(Boolean));
    }

    // ---------- Bitácora ----------
    const bitacoraCard = el('div', { className: 'guardia-card-block' }, [
      el('h3', { textContent: 'Bitácora' }),
      el('ul', { className: 'guardia-bitacora' },
        incident.statusHistory.slice().reverse().map(h =>
          el('li', {}, [
            el('strong', { textContent: h.status }),
            el('span', { textContent: ' · ' + fmtDateTime(h.ts) + ' · ' + (h.actor || 'system') }),
            h.detail ? el('div', { className: 'guardia-bitacora-detail', textContent: h.detail }) : null
          ].filter(Boolean))
        )
      )
    ]);

    // ---------- Montaje ----------
    container.appendChild(el('div', { className: 'guardia-card guardia-card-main' }, [header]));
    container.appendChild(el('div', { className: 'guardia-card' }, [patientCard]));
    if (notesCardEl) container.appendChild(el('div', { className: 'guardia-card' }, [notesCardEl]));
    container.appendChild(el('div', { className: 'guardia-card' }, [locationCard]));
    container.appendChild(el('div', { className: 'guardia-card' }, [gpsCard]));
    container.appendChild(el('div', { className: 'guardia-card' }, [actionsCard]));
    container.appendChild(el('div', { className: 'guardia-card' }, [bitacoraCard]));
  }

  function kv(k, v) {
    return el('div', { className: 'kv' }, [
      el('span', { className: 'k', textContent: k }),
      el('span', { className: 'v', textContent: v })
    ]);
  }

  // ============================================================
  // RENDER: HISTORIAL
  // ============================================================
  function renderHistory() {
    const list = $('#historyList');
    const empty = $('#historyEmpty');
    if (!list || !empty) return;
    list.innerHTML = '';

    if (!uiState.unitId) {
      empty.hidden = false;
      return;
    }
    const items = Store.getGuardiaHistory(uiState.unitId, 10);
    if (!items.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    items.forEach((inc) => {
      const li = el('li', { className: 'guardia-history-item' }, [
        el('div', { className: 'ghi-top' }, [
          el('span', { className: 'ghi-id', textContent: inc.id }),
          el('span', { className: 'ghi-status', textContent: inc.status })
        ]),
        el('div', { className: 'ghi-meta' }, [
          el('span', { textContent: fmtDateTime(inc.createdAt) + ' · ' }),
          el('span', { textContent: inc.closureReason || 'Sin motivo de cierre' })
        ])
      ]);
      list.appendChild(li);
    });
  }

  // ============================================================
  // RENDER GLOBAL
  // ============================================================
  function render() {
    renderUnitStatus();
    renderActiveIncident();
    renderHistory();
  }

  // ============================================================
  // POLLING + SUSCRIPCIÓN
  // ============================================================
  function initLiveUpdates() {
    Store.subscribe((msg) => {
      if (!msg || msg.type !== 'STATE_CHANGED') return;
      // Si la unidad pasó a "disponible" y no hay incidente, paramos GPS
      const incident = uiState.unitId ? Store.getActiveIncidentForUnit(uiState.unitId) : null;
      if (!incident && uiState.watchId) {
        stopWatchPosition();
      }
      render();
    });

    // Polling defensivo cada 5s (para navegadores sin BroadcastChannel)
    uiState.refreshTimer = setInterval(() => {
      render();
    }, C.GUARDIA.refreshIntervalMs);
  }

  // ============================================================
  // BOOT
  // ============================================================
  document.addEventListener('DOMContentLoaded', () => {
    ensureSupportMethod();
    initSelectors();
    initLiveUpdates();
    render();

    // Intento de pedir permiso de notificación cuando el usuario escribe su nombre
    const nameInput = $('#guardiaNameInput');
    if (nameInput) {
      nameInput.addEventListener('change', () => {
        if (uiState.crewName) requestNotificationPermissionOnce();
      });
    }
  });

  // Cleanup al cerrar
  window.addEventListener('beforeunload', () => {
    stopWatchPosition();
    if (uiState.refreshTimer) clearInterval(uiState.refreshTimer);
  });
})();
