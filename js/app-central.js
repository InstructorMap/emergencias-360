/* ============================================================
   app-central.js — Controlador de central.html
   Consola Operativa EMP: bandeja, despacho paso a paso,
   flota y sincronización en vivo con index.html.
   Fix H-01: helper el() respeta disabled=null/false.
   ============================================================ */

(function () {
  'use strict';

  const Store = window.E360Store;
  if (!Store) {
    console.error('[app-central] E360Store no disponible.');
    return;
  }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const uiState = {
    baseFilter: 'DOLORES',
    operatorName: '',
    selectedIncidentId: null,
    incidentFilter: 'active',
    lastPendingCount: 0,
    audioCtx: null
  };

  // ============================================================
  // HELPER el() — Fix H-01
  // ============================================================
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const val = attrs[k];
        // Fix H-01: null/false no deben escribir atributo (ni disabled="null")
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

  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (_) { return iso; }
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch (_) { return iso; }
  }

  function stateBadge(status) {
    return el('span', { className: 'badge badge-state-' + status, textContent: status });
  }

  function priorityBadge(priority) {
    if (!priority) return null;
    return el('span', { className: 'badge badge-priority-' + priority, textContent: 'CÓDIGO ' + priority });
  }

  // ============================================================
  // OPERADOR
  // ============================================================
  function initOperatorInput() {
    const input = $('#operatorInput');
    input.value = uiState.operatorName;
    input.addEventListener('input', () => {
      uiState.operatorName = input.value.trim();
    });
  }

  function requireOperatorOrThrow() {
    if (!uiState.operatorName) {
      throw new Error('Ingresá tu nombre de operador en turno antes de operar.');
    }
    return uiState.operatorName;
  }

  // ============================================================
  // BEEP
  // ============================================================
  function playAlertBeep() {
    try {
      if (!uiState.audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        uiState.audioCtx = new Ctx();
      }
      const ctx = uiState.audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      [880, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.18 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.18);
        osc.stop(now + i * 0.18 + 0.2);
      });
    } catch (err) {
      console.warn('[app-central] beep error', err);
    }
  }

  // ============================================================
  // BASE SELECTOR
  // ============================================================
  function initBaseSelector() {
    const sel = $('#centralBaseSelector');
    sel.value = uiState.baseFilter;
    sel.addEventListener('change', () => {
      uiState.baseFilter = sel.value;
      uiState.selectedIncidentId = null;
      renderAll();
    });
  }

  // ============================================================
  // FILTROS
  // ============================================================
  function initIncidentFilters() {
    $$('.btn-incident-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.btn-incident-filter').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        uiState.incidentFilter = btn.dataset.filter;
        renderIncidentList();
      });
    });
  }

  // ============================================================
  // CONTADOR
  // ============================================================
  function renderAlertCounter() {
    const counter = $('#alertCounter');
    const incidents = Store.getIncidents(uiState.baseFilter);
    const pending = incidents.filter(i => i.status === 'RECIBIDA_SERVIDOR').length;
    counter.textContent = String(pending);

    if (pending > 0) counter.classList.add('pulse');
    else counter.classList.remove('pulse');

    if (pending > uiState.lastPendingCount) playAlertBeep();
    uiState.lastPendingCount = pending;
  }

  // ============================================================
  // BANDEJA
  // ============================================================
  function renderIncidentList() {
    const list = $('#incidentList');
    const empty = $('#incidentEmpty');
    list.innerHTML = '';

    const all = Store.getIncidents(uiState.baseFilter);
    const closedStates = ['CERRADA', 'CANCELADA'];

    let items;
    if (uiState.incidentFilter === 'active') {
      items = all.filter(i => !closedStates.includes(i.status));
    } else {
      items = all.filter(i => closedStates.includes(i.status));
    }

    if (!items.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    items.forEach((inc) => {
      const pendingClass = inc.status === 'RECIBIDA_SERVIDOR' ? ' pending' : '';
      const selectedClass = inc.id === uiState.selectedIncidentId ? ' selected' : '';

      const card = el('li', {
        className: 'incident-card' + pendingClass + selectedClass,
        onclick: () => {
          uiState.selectedIncidentId = inc.id;
          renderIncidentList();
          renderDetail();
        }
      }, [
        el('div', { className: 'card-top' }, [
          el('span', { className: 'card-id', textContent: inc.id }),
          el('span', { className: 'card-time', textContent: fmtTime(inc.createdAt) })
        ]),
        el('div', { className: 'card-meta' }, [
          stateBadge(inc.status),
          priorityBadge(inc.priority)
        ].filter(Boolean)),
        el('div', { className: 'card-loc' }, [
          el('span', { textContent: 'Base: ' + inc.baseId + ' · ' }),
          el('span', { textContent: inc.manualAddress || (inc.location ? ('GPS ' + inc.location.lat.toFixed(4) + ',' + inc.location.lng.toFixed(4)) : 'Sin ubicación') })
        ])
      ]);

      list.appendChild(card);
    });
  }

  // ============================================================
  // DETALLE
  // ============================================================
  function renderDetail() {
    const container = $('#detailContainer');
    container.innerHTML = '';

    if (!uiState.selectedIncidentId) {
      container.appendChild(
        el('div', { className: 'detail-empty', textContent: 'Seleccioná un incidente de la bandeja para operar.' })
      );
      return;
    }

    const inc = Store.getIncidentById(uiState.selectedIncidentId);
    if (!inc) {
      container.appendChild(
        el('div', { className: 'detail-empty', textContent: 'El incidente ya no está disponible.' })
      );
      uiState.selectedIncidentId = null;
      return;
    }

    const profile = inc.profileDni ? Store.getProfile(inc.profileDni) : null;
    const patientBlock = el('div', { className: 'detail-block' }, [
      el('h3', { textContent: 'Datos del Paciente / Socio' })
    ]);

    if (profile) {
      patientBlock.appendChild(kv('Nombre', profile.nombre || '—'));
      patientBlock.appendChild(kv('DNI', profile.dni || '—'));
      const tel = profile.telefono || '';
      const telLink = el('a', { href: 'tel:' + tel, className: 'gps-link', textContent: '📞 Llamar ' + tel });
      patientBlock.appendChild(el('div', { className: 'kv' }, [
        el('span', { className: 'k', textContent: 'Teléfono' }),
        el('span', { className: 'v' }, [telLink])
      ]));

      const alerta = el('div', { className: 'alerta-clinica' }, [
        el('strong', { textContent: '⚠ Alerta clínica del paciente' }),
        el('div', { className: 'clin-row' }, [
          el('span', { textContent: 'Grupo sanguíneo: ' }),
          el('strong', { textContent: profile.grupoSanguineo || 'No informado' })
        ]),
        el('div', { className: 'clin-row' }, [
          el('span', { textContent: 'Alergias críticas: ' }),
          el('strong', { textContent: profile.alergias || 'Sin registro' })
        ]),
        el('div', { className: 'clin-row' }, [
          el('span', { textContent: 'Patologías: ' }),
          el('strong', { textContent: profile.patologias || 'Sin registro' })
        ])
      ]);
      patientBlock.appendChild(alerta);
      patientBlock.appendChild(kv('Contacto de emergencia', profile.contacto || '—'));
    } else {
      patientBlock.appendChild(
        el('div', { className: 'warn-operador', textContent: 'El socio no completó su ficha de emergencia. Solicitá datos por teléfono.' })
      );
    }

    // B2B
    if (inc.b2bEstablishmentId) {
      const b2b = Store.getB2BById(inc.b2bEstablishmentId);
      if (b2b) {
        const b2bBlock = el('div', { className: 'detail-block' }, [
          el('h3', { textContent: 'Establecimiento B2B (Área Protegida)' }),
          kv('Nombre', b2b.name),
          kv('Rubro', b2b.type),
          kv('Dirección', b2b.address),
          kv('Protocolo', b2b.protocol || '—'),
          kv('Teléfono del referente', b2b.referencePhone || '—')
        ]);
        patientBlock.appendChild(b2bBlock);
      }
    }

    const geoBlock = el('div', { className: 'detail-block' }, [
      el('h3', { textContent: 'Geolocalización' })
    ]);
    if (inc.location) {
      geoBlock.appendChild(kv('Coordenadas', inc.location.lat.toFixed(6) + ', ' + inc.location.lng.toFixed(6)));
      geoBlock.appendChild(kv('Precisión', '± ' + Math.round(inc.location.accuracy) + ' m'));
      const mapsUrl = 'https://www.openstreetmap.org/?mlat=' + inc.location.lat +
        '&mlon=' + inc.location.lng + '#map=17/' + inc.location.lat + '/' + inc.location.lng;
      geoBlock.appendChild(el('a', {
        href: mapsUrl, target: '_blank', rel: 'noopener',
        className: 'gps-link', textContent: '🗺 Abrir punto en OpenStreetMap'
      }));
    } else {
      geoBlock.appendChild(el('div', { className: 'warn-operador', textContent: 'Sin GPS. Usá la referencia manual.' }));
    }
    if (inc.manualAddress) {
      geoBlock.appendChild(kv('Dirección manual', inc.manualAddress));
    }

    const actionsBlock = buildActionsBlock(inc);

    const bitacoraBlock = el('div', { className: 'detail-block' }, [
      el('h3', { textContent: 'Bitácora Cronológica' }),
      el('ul', { className: 'bitacora-list' },
        inc.statusHistory.slice().reverse().map(h =>
          el('li', {}, [
            el('strong', { textContent: h.status }),
            el('span', { textContent: ' · ' + fmtDateTime(h.ts) + ' · ' + (h.actor || 'system') }),
            h.detail ? el('div', { textContent: h.detail }) : null
          ].filter(Boolean))
        )
      )
    ]);

    container.appendChild(patientBlock);
    container.appendChild(geoBlock);
    container.appendChild(actionsBlock);
    container.appendChild(bitacoraBlock);
  }

  function kv(k, v) {
    return el('div', { className: 'kv' }, [
      el('span', { className: 'k', textContent: k }),
      el('span', { className: 'v', textContent: v })
    ]);
  }

  // ============================================================
  // BOTONES POR ESTADO
  // ============================================================
  function buildActionsBlock(inc) {
    const block = el('div', { className: 'detail-actions' });
    const activeStatesForCancel = ['RECIBIDA_SERVIDOR', 'ACEPTADA_POR_CENTRAL', 'CLASIFICADA', 'MOVIL_ASIGNADO', 'EN_CAMINO'];

    function appendCancel() {
      if (!activeStatesForCancel.includes(inc.status)) return;
      block.appendChild(el('button', {
        type: 'button', className: 'btn-action btn-danger',
        textContent: 'Cancelar Incidente (Falsa alarma / Duplicado)',
        onclick: () => runAction(() => {
          const op = requireOperatorOrThrow();
          const reason = window.prompt('Motivo de cancelación (obligatorio):');
          if (!reason) throw new Error('Motivo de cancelación obligatorio.');
          Store.cancelIncident(inc.id, reason, op);
        })
      }));
    }

    try {
      switch (inc.status) {
        case 'RECIBIDA_SERVIDOR': {
          block.appendChild(el('button', {
            type: 'button', className: 'btn-action btn-warn',
            textContent: '1. Acusar Recibo en Central',
            onclick: () => runAction(() => {
              const op = requireOperatorOrThrow();
              Store.acknowledgeIncident(inc.id, op);
            })
          }));
          appendCancel();
          return block;
        }
        case 'ACEPTADA_POR_CENTRAL': {
          block.appendChild(el('div', { className: 'inline-form' }, [
            el('label', {}, [
              el('span', { textContent: '2. Clasificar prioridad (Triage)' }),
              (function () {
                const sel = el('select', { id: 'triagePriority' });
                sel.appendChild(el('option', { value: 'ROJO', textContent: 'Código Rojo - Emergencia' }));
                sel.appendChild(el('option', { value: 'AMARILLO', textContent: 'Código Amarillo - Urgencia' }));
                sel.appendChild(el('option', { value: 'VERDE', textContent: 'Código Verde - Baja complejidad' }));
                return sel;
              })()
            ]),
            el('label', {}, [
              el('span', { textContent: 'Observación inicial' }),
              el('textarea', { id: 'triageNotes', rows: '2', maxlength: '300', placeholder: 'Detalle clínico preliminar' })
            ]),
            el('button', {
              type: 'button', className: 'btn-action btn-ok',
              textContent: 'Confirmar Triage',
              onclick: () => runAction(() => {
                const op = requireOperatorOrThrow();
                const prio = $('#triagePriority').value;
                const notes = $('#triageNotes').value;
                Store.triageIncident(inc.id, prio, notes, op);
              })
            })
          ]));
          appendCancel();
          return block;
        }
        case 'CLASIFICADA': {
          const units = Store.getFleet(inc.baseId).filter(u => u.status === 'disponible');
          block.appendChild(el('div', { className: 'inline-form' }, [
            el('label', {}, [
              el('span', { textContent: '3. Asignar móvil disponible de la base' }),
              (function () {
                const sel = el('select', { id: 'assignUnitId' });
                if (!units.length) {
                  sel.appendChild(el('option', { value: '', textContent: '— Sin móviles disponibles —' }));
                } else {
                  units.forEach(u => {
                    sel.appendChild(el('option', { value: u.id, textContent: u.unit + ' (' + u.status + ')' }));
                  });
                }
                return sel;
              })()
            ]),
            el('label', {}, [
              el('span', { textContent: 'Dotación asignada / notas' }),
              el('input', { type: 'text', id: 'assignCrew', maxlength: '120', placeholder: 'Ej: Chofer + Enfermero' })
            ]),
            el('button', {
              type: 'button', className: 'btn-action btn-ok',
              textContent: 'Asignar Móvil',
              disabled: units.length === 0,
              onclick: () => runAction(() => {
                const op = requireOperatorOrThrow();
                const unitId = $('#assignUnitId').value;
                if (!unitId) throw new Error('No hay móvil seleccionado.');
                const crew = $('#assignCrew').value;
                Store.assignUnitToIncident(inc.id, unitId, crew, op);
              })
            })
          ]));
          appendCancel();
          return block;
        }
        case 'MOVIL_ASIGNADO': {
          block.appendChild(el('div', { className: 'inline-form' }, [
            el('div', { className: 'warn-operador', textContent: 'Este paso notificará "Móvil en camino" al socio.' }),
            el('button', {
              type: 'button', className: 'btn-action btn-ok',
              textContent: '4. Confirmar Salida — Móvil en Camino',
              onclick: () => runAction(() => {
                const op = requireOperatorOrThrow();
                Store.dispatchIncidentUnit(inc.id, op);
              })
            })
          ]));
          appendCancel();
          return block;
        }
        case 'EN_CAMINO': {
          block.appendChild(el('button', {
            type: 'button', className: 'btn-action btn-ok',
            textContent: '5. Marcar Arribo en Escena (EN_ESCENA)',
            onclick: () => runAction(() => {
              const op = requireOperatorOrThrow();
              Store.markIncidentOnScene(inc.id, op);
            })
          }));
          appendCancel();
          return block;
        }
        case 'EN_ESCENA': {
          block.appendChild(el('div', { className: 'inline-form' }, [
            el('label', {}, [
              el('span', { textContent: 'Registrar derivación / traslado' }),
              el('input', { type: 'text', id: 'destCenter', maxlength: '120', placeholder: 'Ej: Hospital San Roque Dolores' })
            ]),
            el('button', {
              type: 'button', className: 'btn-action',
              textContent: '6. Registrar Traslado (EN_TRASLADO)',
              onclick: () => runAction(() => {
                const op = requireOperatorOrThrow();
                const dest = $('#destCenter').value;
                Store.markIncidentInTransit(inc.id, dest, op);
              })
            }),
            el('div', { className: 'warn-operador', textContent: 'O bien cerrá directamente el incidente sin traslado:' }),
            buildCloseForm(inc)
          ]));
          return block;
        }
        case 'EN_TRASLADO': {
          block.appendChild(el('div', { className: 'inline-form' }, [
            el('div', { className: 'warn-operador', textContent: 'Traslado en curso hacia: ' + (inc.destinationCenter || '—') }),
            buildCloseForm(inc)
          ]));
          return block;
        }
        case 'CERRADA':
        case 'CANCELADA': {
          block.appendChild(el('div', { className: 'inline-form' }, [
            el('div', { className: 'warn-operador', textContent: 'Incidente finalizado. Motivo: ' + (inc.closureReason || '—') })
          ]));
          if (inc.outcomeNotes) {
            block.appendChild(el('div', { className: 'detail-block' }, [
              el('h3', { textContent: 'Notas de cierre' }),
              el('div', { textContent: inc.outcomeNotes })
            ]));
          }
          return block;
        }
        default: {
          block.appendChild(el('div', { className: 'warn-operador', textContent: 'Estado no manejado: ' + inc.status }));
          return block;
        }
      }
    } catch (err) {
      block.appendChild(el('div', { className: 'warn-operador', textContent: 'Error: ' + err.message }));
      return block;
    }
  }

  function buildCloseForm(inc) {
    const closeReasons = [
      'Atención en domicilio sin traslado',
      'Traslado efectivo a centro de salud',
      'Falsa alarma / Error de usuario',
      'Derivado a sistema público 107/911'
    ];
    const reasonSel = el('select', { id: 'closeReason' });
    closeReasons.forEach(r => reasonSel.appendChild(el('option', { value: r, textContent: r })));

    return el('div', { className: 'inline-form' }, [
      el('div', { className: 'warn-operador', textContent: 'Cierre documentado obligatorio:' }),
      el('label', {}, [el('span', { textContent: 'Motivo de cierre' }), reasonSel]),
      el('label', {}, [
        el('span', { textContent: 'Notas de cierre (obligatorias)' }),
        el('textarea', { id: 'closeNotes', rows: '2', maxlength: '400', placeholder: 'Resultado, observaciones, derivación...' })
      ]),
      el('button', {
        type: 'button', className: 'btn-action btn-ok',
        textContent: '7. Cerrar Incidente (CERRADA)',
        onclick: () => runAction(() => {
          const op = requireOperatorOrThrow();
          const reason = $('#closeReason').value;
          const notes = $('#closeNotes').value;
          Store.closeIncident(inc.id, reason, notes, op);
        })
      }),
      el('button', {
        type: 'button', className: 'btn-action btn-danger',
        textContent: 'Cancelar Incidente (Falsa alarma / Duplicado)',
        onclick: () => runAction(() => {
          const op = requireOperatorOrThrow();
          const reason = window.prompt('Motivo de cancelación (obligatorio):');
          if (!reason) throw new Error('Motivo de cancelación obligatorio.');
          Store.cancelIncident(inc.id, reason, op);
        })
      })
    ]);
  }

  function runAction(fn) {
    try {
      fn();
      renderAll();
    } catch (err) {
      alert('Acción rechazada: ' + err.message);
    }
  }

  // ============================================================
  // FLOTA
  // ============================================================
  function renderFleet() {
    const container = $('#fleetContainer');
    container.innerHTML = '';

    const bases = Store.getBases().filter(b => {
      if (uiState.baseFilter === 'ALL') return true;
      return b.id === uiState.baseFilter;
    });

    bases.forEach((base) => {
      const units = Store.getFleet(base.id);

      const header = el('div', { className: 'fleet-base-header' }, [
        el('div', { className: 'fb-name', textContent: base.name }),
        el('div', { className: 'fb-phone', textContent: 'Despacho: ' + base.phone }),
        el('button', {
          type: 'button',
          className: 'fb-toggle' + (base.isActive ? ' active' : ''),
          textContent: base.isActive ? 'Base OPERATIVA (click para inhabilitar)' : 'Base INHABILITADA (click para habilitar)',
          onclick: () => runAction(() => {
            const op = requireOperatorOrThrow();
            Store.toggleBaseOperationalStatus(base.id, !base.isActive, op);
          })
        })
      ]);
      container.appendChild(header);

      const list = el('ul', { className: 'fleet-list' });
      units.forEach((u) => {
        const statusClass = 'unit-status-' + u.status;
        const card = el('li', { className: 'unit-card' }, [
          el('div', { className: 'unit-top' }, [
            el('span', { className: 'unit-name', textContent: u.unit }),
            el('span', { className: statusClass, textContent: u.status.toUpperCase() })
          ]),
          el('div', { className: 'unit-actions' }, [
            el('button', {
              type: 'button',
              textContent: 'Mantenimiento',
              disabled: (u.status === 'asignado' || u.status === 'en_salida' || u.status === 'mantenimiento'),
              onclick: () => runAction(() => {
                const op = requireOperatorOrThrow();
                Store.setUnitMaintenanceStatus(u.id, 'mantenimiento', op);
              })
            }),
            el('button', {
              type: 'button',
              textContent: 'Rehabilitar',
              disabled: (u.status !== 'mantenimiento'),
              onclick: () => runAction(() => {
                const op = requireOperatorOrThrow();
                Store.setUnitMaintenanceStatus(u.id, 'disponible', op);
              })
            })
          ])
        ]);
        list.appendChild(card);
      });
      container.appendChild(list);
      container.appendChild(el('div', { style: 'height: 8px' }));
    });
  }

  // ============================================================
  // RENDER GLOBAL
  // ============================================================
  function renderAll() {
    renderAlertCounter();
    renderIncidentList();
    renderDetail();
    renderFleet();
  }

  // ============================================================
  // SUSCRIPCIÓN EN VIVO
  // ============================================================
  function initSubscription() {
    Store.subscribe((msg) => {
      if (!msg || msg.type !== 'STATE_CHANGED') return;
      renderAll();
    });
  }

  // ============================================================
  // BOOT
  // ============================================================
  document.addEventListener('DOMContentLoaded', () => {
    initOperatorInput();
    initBaseSelector();
    initIncidentFilters();
    initSubscription();
    renderAll();
  });
})();
