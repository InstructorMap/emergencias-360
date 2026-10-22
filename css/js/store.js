/* ============================================================
   E360Store v3.1 — Capa de abstracción de datos (MVP LOCAL)
   Consume E360Config (constantes) y E360StateMachine (reglas).
   API pública intacta respecto a v3 → los app-*.js no cambian.
   ============================================================ */

(function (global) {
  'use strict';

  const C = global.E360Config;
  const SM = global.E360StateMachine;
  if (!C || !SM) {
    console.error('[E360Store] Faltan config.js y/o state-machine.js. Cargalos ANTES de store.js.');
    return;
  }

  const STORAGE_KEY = C.STORAGE_KEY;
  const STORAGE_VERSION = C.STORAGE_VERSION;
  const CHANNEL_NAME = C.CHANNEL_NAME;
  const INCIDENT_STATES = C.INCIDENT_STATES;
  const TRANSITION_ORDER = C.TRANSITION_ORDER;
  const PRIORITIES = C.PRIORITIES;
  const UNIT_STATUS = C.UNIT_STATUS;
  const BENEFIT_STATUSES = C.BENEFIT_STATUSES;
  const B2B_STATUSES = C.B2B_STATUSES;

  const channel = (typeof BroadcastChannel !== 'undefined')
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;

  // ---------- Seed inicial ----------
  function buildSeed() {
    return {
      version: STORAGE_VERSION,
      organizations: [
        {
          id: 'org_asari',
          name: 'ASARI S.A.S.',
          role: C.ROLES.PLATFORM_OWNER,
          lineAEnabled: true,
          lineBEnabled: true
        },
        {
          id: 'org_emp',
          name: 'EMP - Emergencias Médicas Privadas',
          role: C.ROLES.EMERGENCY_PROVIDER,
          lineAEnabled: true,
          lineBEnabled: true
        }
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
          id: 'ben_internacion_costa',
          name: 'Empresa de Internación Domiciliaria (La Costa)',
          category: 'Internación Domiciliaria',
          locality: 'La Costa',
          benefitDetail: 'Cobertura parcial en internación domiciliaria programada.',
          agreementRef: 'Pendiente de firma',
          validUntil: '2026-12-31',
          status: 'en_negociacion'
        },
        {
          id: 'ben_cartilla_costa',
          name: 'Red de Cartilla de Médicos para Consultorios (La Costa)',
          category: 'Consultorios',
          locality: 'La Costa',
          benefitDetail: 'Descuento en consultas de cartilla.',
          agreementRef: 'Pendiente de firma',
          validUntil: '2026-12-31',
          status: 'en_negociacion'
        },
        {
          id: 'ben_sanatorio_dolores',
          name: 'Sanatorio Dolores',
          category: 'Sanatorio / Clínica',
          locality: 'Dolores',
          benefitDetail: 'Convenio en negociación (no visible al socio).',
          agreementRef: 'Pendiente de firma',
          validUntil: '2026-12-31',
          status: 'en_negociacion'
        },
        {
          id: 'ben_consultorios_dolores',
          name: 'Consultorios Médicos de Dolores (sin emergencias propias)',
          category: 'Consultorios',
          locality: 'Dolores',
          benefitDetail: 'Convenio en negociación (no visible al socio).',
          agreementRef: 'Pendiente de firma',
          validUntil: '2026-12-31',
          status: 'en_negociacion'
        },
        {
          id: 'ben_demo_farmacia',
          name: '[DEMO CONVENIO ACTIVO] Farmacia / Óptica Adherida',
          category: 'Farmacia / Óptica',
          locality: 'Dolores',
          benefitDetail: 'Descuento demostrativo en medicamentos y anteojos.',
          agreementRef: 'DEMO-01',
          validUntil: '2026-12-31',
          status: 'activo'
        }
      ],
      b2b_establishments: [
        {
          id: 'b2b_hotel_costa',
          name: 'Complejo Turístico & Hotel Costero [DEMO]',
          type: 'Hotel / Complejo',
          baseId: 'LA_COSTA',
          address: 'Av. Costanera y Calle 34, Santa Teresita',
          coords: null,
          referencePhone: '02246-420000',
          protocol: 'Ingreso ambulancia por dársena de recepción. Conserjería 24hs.',
          status: 'activo',
          createdAt: '2026-01-10T10:00:00.000Z'
        },
        {
          id: 'b2b_balneario_costa',
          name: 'Balneario Parador Sur [DEMO]',
          type: 'Balneario / Camping',
          baseId: 'LA_COSTA',
          address: 'Playa y Bajada Náutica, San Clemente',
          coords: null,
          referencePhone: '02246-430000',
          protocol: 'Acceso vehicular por bajada náutica. Guardavidas en puesto 2.',
          status: 'activo',
          createdAt: '2026-01-12T10:00:00.000Z'
        },
        {
          id: 'b2b_comercio_dolores',
          name: 'Galería Comercial Centro [DEMO]',
          type: 'Empresa / Comercio',
          baseId: 'DOLORES',
          address: 'Calle Buenos Aires 450, Dolores',
          coords: null,
          referencePhone: '02245-440000',
          protocol: 'Acceso libre por entrada principal.',
          status: 'activo',
          createdAt: '2026-01-15T10:00:00.000Z'
        },
        {
          id: 'b2b_consultorio_dolores',
          name: 'Consultorios Externos Sin Emergencia Propia [DEMO]',
          type: 'Institución / Consultorio',
          baseId: 'DOLORES',
          address: 'Calle Belgrano 820, Dolores',
          coords: null,
          referencePhone: '02245-450000',
          protocol: 'Prioridad de derivación por puerta lateral.',
          status: 'en_revision',
          createdAt: '2026-01-20T10:00:00.000Z'
        }
      ],
      profiles: {},
      incidents: [],
      audit_logs: [],
      context: {
        activeBaseId: 'DOLORES',
        platformMode: C.MODE,
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
      if (!parsed || parsed.version !== STORAGE_VERSION) {
        const seed = buildSeed();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
        return seed;
      }
      if (!parsed.context) parsed.context = { activeBaseId: 'DOLORES', platformMode: C.MODE, activeProfileDni: null };
      if (parsed.context.activeProfileDni === undefined) parsed.context.activeProfileDni = null;
      if (!Array.isArray(parsed.b2b_establishments)) parsed.b2b_establishments = buildSeed().b2b_establishments;
      if (!Array.isArray(parsed.benefits)) parsed.benefits = [];
      if (!Array.isArray(parsed.audit_logs)) parsed.audit_logs = [];
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

  function nowISO() { return new Date().toISOString(); }

  function requireOperator(operatorName) {
    const name = String(operatorName || '').trim();
    if (!name) throw new Error('Se requiere identificación del operador en turno.');
    return name;
  }

  function requireAdmin(adminName) {
    const name = String(adminName || '').trim();
    if (!name) throw new Error('Se requiere identificación del administrador.');
    return name;
  }

  function appendAudit(state, action, payload, actor) {
    state.audit_logs.unshift({
      id: uid('aud'),
      ts: nowISO(),
      action,
      payload: payload || {},
      actor: actor || 'system'
    });
    if (state.audit_logs.length > C.AUDIT_MAX_ENTRIES) {
      state.audit_logs.length = C.AUDIT_MAX_ENTRIES;
    }
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

    // Constantes re-expuestas (compatibilidad con v3)
    INCIDENT_STATES,
    TRANSITION_ORDER,
    PRIORITIES,
    UNIT_STATUS,
    BENEFIT_STATUSES,
    B2B_STATUSES,

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

    getOrganizations() {
      const state = loadState();
      return state.organizations.map(o => ({ ...o }));
    },

    updateOrganizationFlags(orgId, lineA, lineB, adminName) {
      const actor = requireAdmin(adminName);
      const state = loadState();
      const org = state.organizations.find(o => o.id === orgId);
      if (!org) throw new Error('Organización no encontrada.');
      org.lineAEnabled = !!lineA;
      org.lineBEnabled = !!lineB;
      appendAudit(state, 'UPDATE_ORG_FLAGS', { orgId, lineA: !!lineA, lineB: !!lineB }, actor);
      saveState(state);
      return { ...org };
    },

    // ======================= PERFILES =======================
    saveProfile(profile) {
      const state = loadState();
      const dni = String(profile.dni || '').trim();
      if (!dni) throw new Error('DNI requerido para guardar ficha.');
      const record = { ...profile, dni, updatedAt: nowISO() };
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

    // ======================= INCIDENTES =======================
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
        b2bEstablishmentId: payload.b2bEstablishmentId || null,
        profileDni: dni,
        notes: payload.notes || '',
        statusHistory: [
          { status: INCIDENT_STATES.RECIBIDA_SERVIDOR, ts: nowISO(), actor: 'socio_app', detail: 'Alerta emitida por el socio.' }
        ]
      };
      state.incidents.unshift(incident);
      appendAudit(state, 'CREATE_SOS_INCIDENT', { incidentId: incident.id, baseId: incident.baseId, dni, b2b: incident.b2bEstablishmentId }, 'socio_app');
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

    // Helpers de solo lectura para la UI
    canTransitionIncident(fromStatus, toStatus) {
      return SM.canTransitionIncident(fromStatus, toStatus);
    },

    getAllowedNextStatesIncident(currentStatus) {
      return SM.getAllowedNextStatesIncident(currentStatus);
    },

    acknowledgeIncident(incidentId, operatorName) {
      const actor = requireOperator(operatorName);
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.RECIBIDA_SERVIDOR) {
        throw new Error('Solo se puede acusar recibo de incidentes en RECIBIDA_SERVIDOR.');
      }
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.ACEPTADA_POR_CENTRAL);
      if (!check.ok) throw new Error(check.reason);
      pushStatus(inc, INCIDENT_STATES.ACEPTADA_POR_CENTRAL, actor, 'Acuse de recibo por operador.');
      appendAudit(state, 'ACK_INCIDENT', { incidentId, operatorName: actor }, actor);
      saveState(state);
      return JSON.parse(JSON.stringify(inc));
    },

    triageIncident(incidentId, priority, clinicalNotes, operatorName) {
      const actor = requireOperator(operatorName);
      if (PRIORITIES.indexOf(priority) === -1) {
        throw new Error('Prioridad inválida. Debe ser ROJO, AMARILLO o VERDE.');
      }
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.ACEPTADA_POR_CENTRAL) {
        throw new Error('El incidente debe estar en ACEPTADA_POR_CENTRAL para clasificar.');
      }
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.CLASIFICADA);
      if (!check.ok) throw new Error(check.reason);
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
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.MOVIL_ASIGNADO);
      if (!check.ok) throw new Error(check.reason);
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
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.EN_CAMINO);
      if (!check.ok) throw new Error(check.reason);
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
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.EN_ESCENA);
      if (!check.ok) throw new Error(check.reason);
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
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.EN_TRASLADO);
      if (!check.ok) throw new Error(check.reason);
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
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.CERRADA);
      if (!check.ok) throw new Error(check.reason);
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
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.CANCELADA);
      if (!check.ok) throw new Error(check.reason);
      inc.closureReason = reason;
      pushStatus(inc, INCIDENT_STATES.CANCELADA, actor, 'Cancelación: ' + reason);
      releaseUnitIfAny(state, inc);
      appendAudit(state, 'CANCEL_INCIDENT', { incidentId, cancelReason: reason, operatorName: actor }, actor);
      saveState(state);
      return JSON.parse(JSON.stringify(inc));
    },

    transitionIncidentStatus(incidentId, nextStatus) {
      return this._genericTransition(incidentId, nextStatus, 'simulador_socio');
    },

    _genericTransition(incidentId, nextStatus, actor) {
      const state = loadState();
      const inc = findIncident(state, incidentId);
      const check = SM.canTransitionIncident(inc.status, nextStatus);
      if (!check.ok) throw new Error(check.reason);
      if (nextStatus === INCIDENT_STATES.CANCELADA) {
        inc.closureReason = 'Cancelado desde simulador.';
        pushStatus(inc, INCIDENT_STATES.CANCELADA, actor, 'Cancelación simulada.');
        releaseUnitIfAny(state, inc);
      } else {
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
      const state = loadState();
      const unit = state.moviles.find(m => m.id === unitId);
      if (!unit) throw new Error('Móvil no encontrado.');
      const check = SM.canChangeUnitStatus(unit.status, newStatus);
      if (!check.ok) throw new Error(check.reason);
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
      const check = SM.canToggleBaseOperationalStatus(base);
      if (!check.ok) throw new Error(check.reason);
      base.isActive = !!isActive;
      appendAudit(state, 'TOGGLE_BASE_STATUS', { baseId, isActive: !!isActive, operatorName: actor }, actor);
      saveState(state);
      return { ...base };
    },

    // ======================= BENEFICIOS =======================
    getVisibleBenefits(locality) {
      const state = loadState();
      const lineBAllowedByOrg = () => state.organizations.some(o => o.lineBEnabled);
      return state.benefits
        .filter(b => SM.isBenefitVisibleToSocio(b))
        .filter(b => lineBAllowedByOrg())
        .filter(b => !locality || b.locality === locality)
        .map(b => ({
          id: b.id,
          name: b.name,
          category: b.category,
          locality: b.locality,
          benefitDetail: b.benefitDetail,
          agreementRef: b.agreementRef,
          validUntil: b.validUntil,
          status: b.status
        }));
    },

    getAllBenefitsRaw() {
      const state = loadState();
      return state.benefits.map(b => ({ ...b }));
    },

    updateBenefitStatus(benefitId, newStatus, agreementRef, validUntil, adminName) {
      const actor = requireAdmin(adminName);
      const state = loadState();
      const benefit = state.benefits.find(b => b.id === benefitId);
      if (!benefit) throw new Error('Prestador no encontrado.');
      const check = SM.canTransitionBenefit(benefit.status, newStatus, agreementRef);
      if (!check.ok) throw new Error(check.reason);
      const prevStatus = benefit.status;
      benefit.status = newStatus;
      const ref = String(agreementRef || '').trim();
      if (ref) benefit.agreementRef = ref;
      if (validUntil) benefit.validUntil = validUntil;
      appendAudit(state, 'UPDATE_BENEFIT_STATUS', {
        benefitId,
        from: prevStatus,
        to: newStatus,
        agreementRef: benefit.agreementRef,
        validUntil: benefit.validUntil,
        adminName: actor
      }, actor);
      saveState(state);
      return { ...benefit };
    },

    // ======================= B2B =======================
    getB2BEstablishments(baseId) {
      const state = loadState();
      const list = baseId && baseId !== 'ALL'
        ? state.b2b_establishments.filter(e => e.baseId === baseId)
        : state.b2b_establishments.slice();
      return list.map(e => ({ ...e }));
    },

    getB2BById(id) {
      const state = loadState();
      const est = state.b2b_establishments.find(e => e.id === id);
      return est ? { ...est } : null;
    },

    saveB2BEstablishment(data, actorName) {
      const actor = requireAdmin(actorName);
      const name = String(data.name || '').trim();
      const type = String(data.type || '').trim();
      const baseId = String(data.baseId || '').trim();
      const address = String(data.address || '').trim();
      if (!name || !type || !baseId || !address) {
        throw new Error('Completá nombre, rubro, base asignada y dirección.');
      }
      if (['DOLORES', 'LA_COSTA'].indexOf(baseId) === -1) {
        throw new Error('Base asignada inválida.');
      }
      const state = loadState();
      const isNew = !data.id;
      const record = {
        id: data.id || uid('b2b'),
        name,
        type,
        baseId,
        address,
        coords: data.coords || null,
        referencePhone: String(data.referencePhone || '').trim(),
        protocol: String(data.protocol || '').trim(),
        status: B2B_STATUSES.indexOf(data.status) !== -1 ? data.status : 'en_revision',
        createdAt: isNew ? nowISO() : (data.createdAt || nowISO())
      };
      if (isNew) {
        state.b2b_establishments.push(record);
      } else {
        const idx = state.b2b_establishments.findIndex(e => e.id === record.id);
        if (idx === -1) throw new Error('Establecimiento B2B no encontrado.');
        state.b2b_establishments[idx] = record;
      }
      appendAudit(state, isNew ? 'CREATE_B2B_ESTABLISHMENT' : 'UPDATE_B2B_ESTABLISHMENT', {
        b2bId: record.id,
        name: record.name,
        baseId: record.baseId
      }, actor);
      saveState(state);
      return { ...record };
    },

    toggleB2BStatus(id, newStatus, actorName) {
      const actor = requireAdmin(actorName);
      const state = loadState();
      const est = state.b2b_establishments.find(e => e.id === id);
      if (!est) throw new Error('Establecimiento B2B no encontrado.');
      const check = SM.canTransitionB2B(est.status, newStatus);
      if (!check.ok) throw new Error(check.reason);
      const prev = est.status;
      est.status = newStatus;
      appendAudit(state, 'TOGGLE_B2B_STATUS', { b2bId: id, from: prev, to: newStatus }, actor);
      saveState(state);
      return { ...est };
    },

    // ======================= ADMIN / RESET =======================
    clearAndResetDemo(adminName) {
      const actor = requireAdmin(adminName);
      const seed = buildSeed();
      seed.audit_logs.unshift({
        id: uid('aud'),
        ts: nowISO(),
        action: 'CLEAR_AND_RESET_DEMO',
        payload: {},
        actor
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now() });
      return seed;
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

    // ======================= UTILIDADES =======================
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
