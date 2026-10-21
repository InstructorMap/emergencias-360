/* ============================================================
   E360Store — Capa de abstracción de datos (MVP LOCAL)
   Hoy: localStorage + BroadcastChannel
   Mañana: Supabase (métodos ya preparados para ser async)
   Incluye: ciclo completo de incidentes (Módulos 3 y 4),
            gestión de flota, perfiles y auditoría.
   ============================================================ */

(function (global) {
  'use strict';

  const STORAGE_KEY = 'e360_mvp_v2';
  const CHANNEL_NAME = 'e360_mvp_channel';

  const channel = (typeof BroadcastChannel !== 'undefined')
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;

  // ---------- Estados de incidente ----------
  const INCIDENT_STATES = {
    RECIBIDA_SERVIDOR: 'RECIBIDA_SERVIDOR',
    ACEPTADA_POR_CENTRAL: 'ACEPTADA_POR_CENTRAL',
    CLASIFICADA: 'CLASIFICADA',
    MOVIL_ASIGNADO: 'MOVIL_ASIGNADO',
    EN_CAMINO: 'EN_CAMINO',
    EN_ESCENA: 'EN_ESCENA',
    EN_TRASLADO: 'EN_TRASLADO',
    CERRADA: 'CERRADA',
    CANCELADA: 'CANCELADA'
  };

  const TRANSITION_ORDER = [
    INCIDENT_STATES.RECIBIDA_SERVIDOR,
    INCIDENT_STATES.ACEPTADA_POR_CENTRAL,
    INCIDENT_STATES.CLASIFICADA,
    INCIDENT_STATES.MOVIL_ASIGNADO,
    INCIDENT_STATES.EN_CAMINO,
    INCIDENT_STATES.EN_ESCENA,
    INCIDENT_STATES.EN_TRASLADO,
    INCIDENT_STATES.CERRADA
  ];

  const PRIORITIES = ['ROJO', 'AMARILLO', 'VERDE'];

  const UNIT_STATUS = {
    DISPONIBLE: 'disponible',
    ASIGNADO: 'asignado',
    EN_SALIDA: 'en_salida',
    MANTENIMIENTO: 'mantenimiento'
  };

  // ---------- Seed inicial ----------
  function buildSeed() {
    return {
      version: 2,
      organizations: [
        { id: 'org_asari', name: 'ASARI S.A.S.', role: 'platform_owner' },
        { id: 'org_emp', name: 'EMP - Emergencias Médicas Privadas', role: 'emergency_provider' }
      ],
      bases: [
        { id: 'DOLORES', name: 'EMP Base Dolores', phone: '02245431234', orgId: 'org_emp', isActive: true },
        { id: 'LA_COSTA', name: 'EMP Base Partido de La Costa', phone: '02246421234', orgId: 'org_emp', isActive: true }
      ],
      moviles: [
        { id: 'mov_dol_01', baseId: 'DOLORES', unit: 'AMB-01', status: UNIT_STATUS.DISPONIBLE },
        { id: 'mov_dol_02', baseId: 'DOLORES', unit: 'AMB-02', status: UNIT_STATUS.DISPONIBLE },
        { id: 'mov_cos_01', baseId: 'LA_COSTA', unit: 'AMB-11', status: UNIT_STATUS.DISPONIBLE },
        { id: 'mov_cos_02', baseId: 'LA_COSTA', unit: 'AMB-12', status: UNIT_STATUS.DISPONIBLE }
      ],
      benefits: [
        {
          id: 'ben_sanatorio_dolores',
          name: 'Sanatorio Dolores',
          locality: 'Dolores',
          description: 'Convenio en negociación (no visible al socio).',
          status: 'en_negociacion'
        },
        {
          id: 'ben_consultorios_dolores',
          name: 'Consultorios Médicos Dolores',
          locality: 'Dolores',
          description: 'Convenio en negociación (no visible al socio).',
          status: 'en_negociacion'
        },
        {
          id: 'ben_red_consultorios_costa',
          name: 'Red Consultorios La Costa',
          locality: 'La Costa',
          description: 'Convenio en negociación (no visible al socio).',
          status: 'en_negociacion'
        },
        {
          id: 'ben_demo_farmacia',
          name: '[DEMO CONVENIO ACTIVO] Farmacia Adherida',
          locality: 'Dolores',
          description: 'Descuento demostrativo en medicamentos de venta libre.',
          status: 'activo'
        },
        {
          id: 'ben_demo_optica',
          name: '[DEMO CONVENIO ACTIVO] Óptica Adherida',
          locality: 'La Costa',
          description: 'Descuento demostrativo en anteojos recetados.',
          status: 'activo'
        }
      ],
      profiles: {},
      incidents: [],
      audit_logs: [],
      context: {
        activeBaseId: 'DOLORES',
        platformMode: 'LOCAL_MVP',
        activeProfileDni: null
      }
    };
  }

  // ---------- Persistencia ----------
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const seed = buildSeed();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
        return seed;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 2) {
        const seed = buildSeed();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
        return seed;
      }
      // Migración defensiva de context
      if (!parsed.context) parsed.context = { activeBaseId: 'DOLORES', platformMode: 'LOCAL_MVP', activeProfileDni: null };
      if (parsed.context.activeProfileDni === undefined) parsed.context.activeProfileDni = null;
      return parsed;
    } catch (e) {
      console.error('[E360Store] Error cargando estado, usando seed.', e);
      const seed = buildSeed();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(seed)); } catch (_) {}
      return seed;
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('[E360Store] Error guardando estado.', e);
    }
    if (channel) {
      channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now() });
    }
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function requireOperator(operatorName) {
    const name = String(operatorName || '').trim();
    if (!name) throw new Error('Se requiere identificación del operador en turno.');
    return name;
  }

  // ---------- Auditoría ----------
  function appendAudit(state, action, payload, actor) {
    state.audit_logs.unshift({
      id: uid('aud'),
      ts: nowISO(),
      action,
      payload: payload || {},
      actor: actor || 'system'
    });
    if (state.audit_logs.length > 1000) state.audit_logs.length = 1000;
  }

  function findIncident(state, incidentId) {
    const inc = state.incidents.find(i => i.id === incidentId);
    if (!inc) throw new Error('Incidente no encontrado.');
    return inc;
  }

  function pushStatus(incident, status, actor, detail) {
    incident.status = status;
    incident.statusHistory.push({
      status,
      ts: nowISO(),
      actor: actor || 'system',
      detail: detail || ''
    });
  }

  function releaseUnitIfAny(state, incident) {
    if (!incident.assignedUnitId) return;
    const unit = state.moviles.find(m => m.id === incident.assignedUnitId);
    if (unit && unit.status !== UNIT_STATUS.MANTENIMIENTO) {
      unit.status = UNIT_STATUS.DISPONIBLE;
    }
  }

  // ---------- API pública ----------
  const E360Store = {

    INCIDENT_STATES,
    TRANSITION_ORDER,
    PRIORITIES,
    UNIT_STATUS,

    // ======================= CONTEXTO =======================
    getActiveContext() {
      const state = loadState();
      const base = state.bases.find(b => b.id === state.context.activeBaseId) || state.bases[0];
      return {
        activeBaseId: state.context.activeBaseId,
        base: { ...base },
        platformMode: state.context.platformMode,
        organizations: state.organizations.map(o => ({ ...o })),
        activeProfileDni: state.context.activeProfileDni
      };
    },

    setActiveBase(baseId) {
      const state = loadState();
      if (!state.bases.some(b => b.id === baseId)) return false;
      state.context.activeBaseId = baseId;
      appendAudit(state, 'SET_ACTIVE_BASE', { baseId }, 'socio_app');
      saveState(state);
      return true;
    },

    // ======================= PERFILES =======================
    saveProfile(profile) {
      const state = loadState();
      const dni = String(profile.dni || '').trim();
      if (!dni) throw new Error('DNI requerido para guardar ficha.');
      const record = {
        ...profile,
        dni,
        updatedAt: nowISO()
      };
      state.profiles[dni] = record;
      state.context.activeProfileDni = dni;
      appendAudit(state, 'SAVE_PROFILE', { dni }, 'socio_app');
      saveState(state);
      return { ...record };
    },

    getProfile(dni) {
      const state = loadState();
      const p = state.profiles[String(dni || '').trim()];
      return p ? { ...p } : null;
    },

    getActiveProfile() {
      const state = loadState();
      const dni = state.context.activeProfileDni;
      if (!dni) return null;
      const p = state.profiles[dni];
      return p ? { ...p } : null;
    },

    // ======================= INCIDENTES (SOCIO) =======================
    createSOSIncident(payload) {
      const state = loadState();
      const dni = payload.profileDni || state.context.activeProfileDni || null;
      const incident = {
        id: uid('inc'),
        createdAt: nowISO(),
        baseId: state.context.activeBaseId,
        status: INCIDENT_STATES.RECIBIDA_SERVIDOR,
        priority: null,
        assignedUnitId: null,
        clinicalNotes: '',
        crewNotes: '',
        destinationCenter: '',
        closureReason: '',
        outcomeNotes: '',
        location: payload.location || null,
        manualAddress: payload.manualAddress || '',
        profileDni: dni,
        notes: payload.notes || '',
        statusHistory: [
          { status: INCIDENT_STATES.RECIBIDA_SERVIDOR, ts: nowISO(), actor: 'socio_app', detail: 'Alerta emitida por el socio.' }
        ]
      };
      state.incidents.unshift(incident);
      appendAudit(state, 'CREATE_SOS_INCIDENT', { incidentId: incident.id, baseId: incident.baseId, dni }, 'socio_app');
      saveState(state);
      return JSON.parse(JSON.stringify(incident));
    },

    getLatestIncident() {
      const state = loadState();
      return state.incidents[0] ? JSON.parse(JSON.stringify(state.incidents[0])) : null;
    },

    getIncidents(filterBaseId) {
      const state = loadState();
      let list = state.incidents.slice();
      if (filterBaseId && filterBaseId !== 'ALL') {
        list = list.filter(i => i.baseId === filterBaseId);
      }
      return list.map(i => JSON.parse(JSON.stringify(i)));
    },

    getIncidentById(incidentId) {
      const state = loadState();
      const inc = state.incidents.find(i => i.id === incidentId);
      return inc ? JSON.parse(JSON.stringify(inc)) : null;
    },

    // ======================= FLUJO OPERATIVO CENTRAL =======================
    acknowledgeIncident(incidentId, operatorName) {
      const actor = requireOperator(operatorName);
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.RECIBIDA_SERVIDOR) {
        throw new Error('Solo se puede acusar recibo de incidentes en RECIBIDA_SERVIDOR.');
      }
      pushStatus(inc, INCIDENT_STATES.ACEPTADA_POR_CENTRAL, actor, 'Acuse de recibo por operador.');
      appendAudit(state, 'ACK_INCIDENT', { incidentId, operatorName: actor }, actor);
      saveState(state);
      return JSON.parse(JSON.stringify(inc));
    },

    triageIncident(incidentId, priority, clinicalNotes, operatorName) {
      const actor = requireOperator(operatorName);
      if (!PRIORITIES.includes(priority)) {
        throw new Error('Prioridad inválida. Debe ser ROJO, AMARILLO o VERDE.');
      }
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.ACEPTADA_POR_CENTRAL) {
        throw new Error('El incidente debe estar en ACEPTADA_POR_CENTRAL para clasificar.');
      }
      inc.priority = priority;
      inc.clinicalNotes = String(clinicalNotes || '').trim();
      pushStatus(inc, INCIDENT_STATES.CLASIFICADA, actor, 'Prioridad ' + priority + '.');
      appendAudit(state, 'TRIAGE_INCIDENT', { incidentId, priority, operatorName: actor }, actor);
      saveState(state);
      return JSON.parse(JSON.stringify(inc));
    },

    assignUnitToIncident(incidentId, unitId, crewNotes, operatorName) {
      const actor = requireOperator(operatorName);
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.CLASIFICADA) {
        throw new Error('El incidente debe estar CLASIFICADA para asignar móvil.');
      }
      const unit = state.moviles.find(m => m.id === unitId);
      if (!unit) throw new Error('Móvil no encontrado.');
      if (unit.baseId !== inc.baseId) throw new Error('El móvil no pertenece a la base del incidente.');
      if (unit.status !== UNIT_STATUS.DISPONIBLE) throw new Error('El móvil no está disponible.');

      unit.status = UNIT_STATUS.ASIGNADO;
      inc.assignedUnitId = unit.id;
      inc.crewNotes = String(crewNotes || '').trim();
      pushStatus(inc, INCIDENT_STATES.MOVIL_ASIGNADO, actor, 'Móvil ' + unit.unit + ' asignado.');
      appendAudit(state, 'ASSIGN_UNIT', { incidentId, unitId, operatorName: actor }, actor);
      saveState(state);
      return JSON.parse(JSON.stringify(inc));
    },

    dispatchIncidentUnit(incidentId, operatorName) {
      const actor = requireOperator(operatorName);
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.MOVIL_ASIGNADO) {
        throw new Error('El incidente debe estar MOVIL_ASIGNADO para despachar.');
      }
      const unit = state.moviles.find(m => m.id === inc.assignedUnitId);
      if (!unit) throw new Error('Móvil asignado no encontrado.');
      unit.status = UNIT_STATUS.EN_SALIDA;
      pushStatus(inc, INCIDENT_STATES.EN_CAMINO, actor, 'Móvil ' + unit.unit + ' despachado.');
      appendAudit(state, 'DISPATCH_INCIDENT', { incidentId, unitId: unit.id, operatorName: actor }, actor);
      saveState(state);
      return JSON.parse(JSON.stringify(inc));
    },

    markIncidentOnScene(incidentId, operatorName) {
      const actor = requireOperator(operatorName);
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.EN_CAMINO) {
        throw new Error('El incidente debe estar EN_CAMINO para marcar arribo.');
      }
      pushStatus(inc, INCIDENT_STATES.EN_ESCENA, actor, 'Móvil arribó al lugar.');
      appendAudit(state, 'ON_SCENE', { incidentId, operatorName: actor }, actor);
      saveState(state);
      return JSON.parse(JSON.stringify(inc));
    },

    markIncidentInTransit(incidentId, destinationCenter, operatorName) {
      const actor = requireOperator(operatorName);
      const dest = String(destinationCenter || '').trim();
      if (!dest) throw new Error('Indicá el centro receptor para registrar el traslado.');
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.EN_ESCENA) {
        throw new Error('El incidente debe estar EN_ESCENA para registrar traslado.');
      }
      inc.destinationCenter = dest;
      pushStatus(inc, INCIDENT_STATES.EN_TRASLADO, actor, 'Derivación a ' + dest + '.');
      appendAudit(state, 'IN_TRANSIT', { incidentId, destinationCenter: dest, operatorName: actor }, actor);
      saveState(state);
      return JSON.parse(JSON.stringify(inc));
    },

    closeIncident(incidentId, closureReason, outcomeNotes, operatorName) {
      const actor = requireOperator(operatorName);
      const reason = String(closureReason || '').trim();
      const notes = String(outcomeNotes || '').trim();
      if (!reason) throw new Error('El motivo de cierre es obligatorio.');
      if (!notes) throw new Error('Las notas de cierre son obligatorias.');

      const state = loadState();
      const inc = findIncident(state, incidentId);
      const closable = [
        INCIDENT_STATES.EN_ESCENA,
        INCIDENT_STATES.EN_TRASLADO
      ];
      if (!closable.includes(inc.status)) {
        throw new Error('Solo se puede cerrar desde EN_ESCENA o EN_TRASLADO.');
      }
      inc.closureReason = reason;
      inc.outcomeNotes = notes;
      pushStatus(inc, INCIDENT_STATES.CERRADA, actor, 'Cierre: ' + reason);
      releaseUnitIfAny(state, inc);
      appendAudit(state, 'CLOSE_INCIDENT', { incidentId, closureReason: reason, operatorName: actor }, actor);
      saveState(state);
      return JSON.parse(JSON.stringify(inc));
    },

    cancelIncident(incidentId, cancelReason, operatorName) {
      const actor = requireOperator(operatorName);
      const reason = String(cancelReason || '').trim();
      if (!reason) throw new Error('El motivo de cancelación es obligatorio.');
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status === INCIDENT_STATES.CERRADA || inc.status === INCIDENT_STATES.CANCELADA) {
        throw new Error('El incidente ya está finalizado.');
      }
      inc.closureReason = reason;
      pushStatus(inc, INCIDENT_STATES.CANCELADA, actor, 'Cancelación: ' + reason);
      releaseUnitIfAny(state, inc);
      appendAudit(state, 'CANCEL_INCIDENT', { incidentId, cancelReason: reason, operatorName: actor }, actor);
      saveState(state);
      return JSON.parse(JSON.stringify(inc));
    },

    // Compatibilidad con el simulador embebido del socio (opcional)
    transitionIncidentStatus(incidentId, nextStatus) {
      return this._genericTransition(incidentId, nextStatus, 'simulador_socio');
    },

    _genericTransition(incidentId, nextStatus, actor) {
      const state = loadState();
      const inc = findIncident(state, incidentId);
      const currentIdx = TRANSITION_ORDER.indexOf(inc.status);
      const nextIdx = TRANSITION_ORDER.indexOf(nextStatus);
      if (nextStatus === INCIDENT_STATES.CANCELADA) {
        inc.closureReason = 'Cancelado desde simulador.';
        pushStatus(inc, INCIDENT_STATES.CANCELADA, actor, 'Cancelación simulada.');
        releaseUnitIfAny(state, inc);
      } else {
        if (nextIdx === -1) throw new Error('Estado destino inválido: ' + nextStatus);
        if (nextIdx !== currentIdx + 1) throw new Error('Transición no permitida.');
        pushStatus(inc, nextStatus, actor, 'Simulación de transición.');
      }
      appendAudit(state, 'SIM_TRANSITION', { incidentId, nextStatus }, actor);
      saveState(state);
      return JSON.parse(JSON.stringify(inc));
    },

    // ======================= FLOTA =======================
    getFleet(baseId) {
      const state = loadState();
      const list = baseId && baseId !== 'ALL'
        ? state.moviles.filter(m => m.baseId === baseId)
        : state.moviles.slice();
      return list.map(m => ({ ...m }));
    },

    getBases() {
      const state = loadState();
      return state.bases.map(b => ({ ...b }));
    },

    setUnitMaintenanceStatus(unitId, newStatus, operatorName) {
      const actor = requireOperator(operatorName);
      if (![UNIT_STATUS.DISPONIBLE, UNIT_STATUS.MANTENIMIENTO].includes(newStatus)) {
        throw new Error('Estado de móvil no permitido.');
      }
      const state = loadState();
      const unit = state.moviles.find(m => m.id === unitId);
      if (!unit) throw new Error('Móvil no encontrado.');
      if ([UNIT_STATUS.ASIGNADO, UNIT_STATUS.EN_SALIDA].includes(unit.status)) {
        throw new Error('No se puede cambiar el estado de un móvil asignado o en salida.');
      }
      unit.status = newStatus;
      appendAudit(state, 'SET_UNIT_STATUS', { unitId, newStatus, operatorName: actor }, actor);
      saveState(state);
      return { ...unit };
    },

    toggleBaseOperationalStatus(baseId, isActive, operatorName) {
      const actor = requireOperator(operatorName);
      const state = loadState();
      const base = state.bases.find(b => b.id === baseId);
      if (!base) throw new Error('Base no encontrada.');
      base.isActive = !!isActive;
      appendAudit(state, 'TOGGLE_BASE_STATUS', { baseId, isActive: !!isActive, operatorName: actor }, actor);
      saveState(state);
      return { ...base };
    },

    // ======================= BENEFICIOS =======================
    getVisibleBenefits(locality) {
      const state = loadState();
      return state.benefits
        .filter(b => b.status === 'activo')
        .filter(b => !locality || b.locality === locality)
        .map(b => ({ id: b.id, name: b.name, locality: b.locality, description: b.description }));
    },

    getAllBenefitsRaw() {
      const state = loadState();
      return state.benefits.map(b => ({ ...b }));
    },

    // ======================= AUDITORÍA =======================
    getAuditLogs() {
      const state = loadState();
      return state.audit_logs.map(l => ({ ...l }));
    },

    // ======================= SUSCRIPCIÓN =======================
    subscribe(callback) {
      if (!channel) {
        const handler = (e) => {
          if (e.key === STORAGE_KEY) callback({ type: 'STATE_CHANGED', ts: Date.now() });
        };
        global.addEventListener('storage', handler);
        return () => global.removeEventListener('storage', handler);
      }
      const handler = (msg) => { callback(msg.data); };
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },

    // ======================= UTILIDADES PRUEBA =======================
    _resetStore() {
      const seed = buildSeed();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now() });
      return seed;
    },

    _getState() {
      return loadState();
    }
  };

  global.E360Store = E360Store;
})(typeof window !== 'undefined' ? window : globalThis);
