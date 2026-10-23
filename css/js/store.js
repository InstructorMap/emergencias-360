/* ============================================================
   E360Store v4 — Capa de abstracción de datos (MVP LOCAL)
   Consume E360Config (constantes) y E360StateMachine (reglas).
   v4: datos operativos reales EMP + external_services + migración suave v3→v4.
   API pública intacta respecto a v3 → los app-*.js no se rompen.
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

  // ---------- Seed inicial (datos reales EMP) ----------
  function buildSeed() {
    const bDol = C.BASES.DOLORES;
    const bCos = C.BASES.LA_COSTA;
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
        {
          id: bDol.id,
          name: bDol.name,
          address: bDol.address,
          phone: bDol.phone,
          phoneAlt: bDol.phoneAlt,
          adminPhone: bDol.adminPhone,
          whatsapp: bDol.whatsapp,
          orgId: bDol.orgId,
          isActive: true
        },
        {
          id: bCos.id,
          name: bCos.name,
          address: bCos.address,
          phone: bCos.phone,
          phoneAlt: bCos.phoneAlt,
          adminPhone: bCos.adminPhone,
          whatsapp: bCos.whatsapp,
          orgId: bCos.orgId,
          isActive: true
        }
      ],
      moviles: [
        { id: 'mov_dol_01', baseId: 'DOLORES', unit: 'AMB-01', tipoUnidad: 'UTIM', status: UNIT_STATUS.DISPONIBLE },
        { id: 'mov_dol_02', baseId: 'DOLORES', unit: 'AMB-02', tipoUnidad: 'COMUN', status: UNIT_STATUS.DISPONIBLE },
        { id: 'mov_cos_01', baseId: 'LA_COSTA', unit: 'AMB-11', tipoUnidad: 'UTIM', status: UNIT_STATUS.DISPONIBLE },
        { id: 'mov_cos_02', baseId: 'LA_COSTA', unit: 'AMB-12', tipoUnidad: 'PEDIATRICA_CON_INCUBADORA', status: UNIT_STATUS.DISPONIBLE }
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
          referencePhone: '2246-420000',
          protocol: 'Ingreso ambulancia por dársena de recepción. Conserjería 24hs.',
          tipoUnidadRequerida: 'UTIM',
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
          referencePhone: '2246-430000',
          protocol: 'Acceso vehicular por bajada náutica. Guardavidas en puesto 2.',
          tipoUnidadRequerida: 'COMUN',
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
          referencePhone: '2245-440000',
          protocol: 'Acceso libre por entrada principal.',
          tipoUnidadRequerida: 'COMUN',
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
          referencePhone: '2245-450000',
          protocol: 'Prioridad de derivación por puerta lateral.',
          tipoUnidadRequerida: 'TRASLADO_PROGRAMADO',
          status: 'en_revision',
          createdAt: '2026-01-20T10:00:00.000Z'
        }
      ],
      profiles: {},
      incidents: [],
      audit_logs: [],
      external_services: {
        medicoVirtualUrl: C.EXTERNAL_SERVICES_DEFAULTS.medicoVirtualUrl,
        seguroViajeroUrl: C.EXTERNAL_SERVICES_DEFAULTS.seguroViajeroUrl,
        updatedAt: null,
        updatedBy: null
      },
      context: {
        activeBaseId: 'DOLORES',
        platformMode: C.MODE,
        activeProfileDni: null
      }
    };
  }

  // ---------- Migración suave v3 → v4 ----------
  function migrateIfNeeded(parsed) {
    if (!parsed || typeof parsed !== 'object') return buildSeed();
    if (parsed.version === STORAGE_VERSION) return parsed;

    // v3 → v4: preservar datos, agregar external_services, datos reales de bases, tipoUnidad
    if (parsed.version === 3) {
      const seed = buildSeed();
      // Bases: reemplazar por datos reales manteniendo isActive si existía
      parsed.bases = seed.bases.map((nb) => {
        const prev = (parsed.bases || []).find(b => b.id === nb.id);
        return prev ? Object.assign({}, nb, { isActive: prev.isActive !== false }) : nb;
      });
      // Móviles: agregar tipoUnidad si falta
      parsed.moviles = (parsed.moviles || []).map((m) => {
        if (m.tipoUnidad) return m;
        const match = seed.moviles.find(sm => sm.id === m.id);
        return Object.assign({}, m, { tipoUnidad: match ? match.tipoUnidad : 'COMUN' });
      });
      // B2B: agregar tipoUnidadRequerida si falta
      parsed.b2b_establishments = (parsed.b2b_establishments || []).map((e) => {
        if (e.tipoUnidadRequerida) return e;
        return Object.assign({}, e, { tipoUnidadRequerida: 'COMUN' });
      });
      // External services
      parsed.external_services = parsed.external_services || {
        medicoVirtualUrl: C.EXTERNAL_SERVICES_DEFAULTS.medicoVirtualUrl,
        seguroViajeroUrl: C.EXTERNAL_SERVICES_DEFAULTS.seguroViajeroUrl,
        updatedAt: null,
        updatedBy: null
      };
      parsed.version = STORAGE_VERSION;
      return parsed;
    }

    // Cualquier otra versión desconocida: reset al seed actual
    return buildSeed();
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
      const migrated = migrateIfNeeded(parsed);
      if (migrated !== parsed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      }
      // Saneamientos defensivos
      if (!migrated.context) migrated.context = { activeBaseId: 'DOLORES', platformMode: C.MODE, activeProfileDni: null };
      if (migrated.context.activeProfileDni === undefined) migrated.context.activeProfileDni = null;
      if (!Array.isArray(migrated.b2b_establishments)) migrated.b2b_establishments = [];
      if (!Array.isArray(migrated.benefits)) migrated.benefits = [];
      if (!Array.isArray(migrated.audit_logs)) migrated.audit_logs = [];
      if (!migrated.external_services) {
        migrated.external_services = {
          medicoVirtualUrl: C.EXTERNAL_SERVICES_DEFAULTS.medicoVirtualUrl,
          seguroViajeroUrl: C.EXTERNAL_SERVICES_DEFAULTS.seguroViajeroUrl,
          updatedAt: null,
          updatedBy: null
        };
      }
      return migrated;
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

    tri
