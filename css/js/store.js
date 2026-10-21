/* ============================================================
   E360Store — Capa de abstracción de datos (MVP LOCAL)
   Hoy: localStorage + BroadcastChannel
   Mañana: Supabase (métodos ya preparados para ser async)
   ============================================================ */

(function (global) {
  'use strict';

  const STORAGE_KEY = 'e360_mvp_v1';
  const CHANNEL_NAME = 'e360_mvp_channel';

  const channel = (typeof BroadcastChannel !== 'undefined')
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;

  // ---------- Estados de incidente (máquina estricta) ----------
  const INCIDENT_STATES = {
    RECIBIDA_SERVIDOR: 'RECIBIDA_SERVIDOR',
    ACEPTADA_POR_CENTRAL: 'ACEPTADA_POR_CENTRAL',
    MOVIL_ASIGNADO: 'MOVIL_ASIGNADO',
    EN_CAMINO: 'EN_CAMINO',
    CANCELADA: 'CANCELADA'
  };

  const TRANSITION_ORDER = [
    INCIDENT_STATES.RECIBIDA_SERVIDOR,
    INCIDENT_STATES.ACEPTADA_POR_CENTRAL,
    INCIDENT_STATES.MOVIL_ASIGNADO,
    INCIDENT_STATES.EN_CAMINO
  ];

  // ---------- Seed inicial ----------
  function buildSeed() {
    return {
      version: 1,
      organizations: [
        { id: 'org_asari', name: 'ASARI S.A.S.', role: 'platform_owner' },
        { id: 'org_emp', name: 'EMP - Emergencias Médicas Privadas', role: 'emergency_provider' }
      ],
      bases: [
        { id: 'DOLORES', name: 'EMP Base Dolores', phone: '02245431234', orgId: 'org_emp' },
        { id: 'LA_COSTA', name: 'EMP Base Partido de La Costa', phone: '02246421234', orgId: 'org_emp' }
      ],
      moviles: [
        { id: 'mov_dol_01', baseId: 'DOLORES', unit: 'AMB-01', status: 'disponible' },
        { id: 'mov_dol_02', baseId: 'DOLORES', unit: 'AMB-02', status: 'disponible' },
        { id: 'mov_cos_01', baseId: 'LA_COSTA', unit: 'AMB-11', status: 'disponible' },
        { id: 'mov_cos_02', baseId: 'LA_COSTA', unit: 'AMB-12', status: 'disponible' }
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
      profiles: {},          // por DNI
      incidents: [],          // historial
      audit_logs: [],         // trazabilidad
      context: {
        activeBaseId: 'DOLORES',
        platformMode: 'LOCAL_MVP'
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
      if (!parsed || parsed.version !== 1) {
        const seed = buildSeed();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
        return seed;
      }
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

  // ---------- Auditoría ----------
  function appendAudit(state, action, payload) {
    state.audit_logs.unshift({
      id: uid('aud'),
      ts: nowISO(),
      action,
      payload: payload || {},
      actor: 'socio_app'
    });
    // límite defensivo
    if (state.audit_logs.length > 500) state.audit_logs.length = 500;
  }

  // ---------- API pública ----------
  const E360Store = {

    INCIDENT_STATES,
    TRANSITION_ORDER,

    getActiveContext() {
      const state = loadState();
      const base = state.bases.find(b => b.id === state.context.activeBaseId) || state.bases[0];
      return {
        activeBaseId: state.context.activeBaseId,
        base: { ...base },
        platformMode: state.context.platformMode,
        organizations: state.organizations.map(o => ({ ...o }))
      };
    },

    setActiveBase(baseId) {
      const state = loadState();
      if (!state.bases.some(b => b.id === baseId)) return false;
      state.context.activeBaseId = baseId;
      appendAudit(state, 'SET_ACTIVE_BASE', { baseId });
      saveState(state);
      return true;
    },

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
      appendAudit(state, 'SAVE_PROFILE', { dni });
      saveState(state);
      return { ...record };
    },

    getProfile(dni) {
      const state = loadState();
      const p = state.profiles[String(dni || '').trim()];
      return p ? { ...p } : null;
    },

    createSOSIncident(payload) {
      const state = loadState();
      const incident = {
        id: uid('inc'),
        createdAt: nowISO(),
        baseId: state.context.activeBaseId,
        status: INCIDENT_STATES.RECIBIDA_SERVIDOR,
        statusHistory: [
          { status: INCIDENT_STATES.RECIBIDA_SERVIDOR, ts: nowISO() }
        ],
        location: payload.location || null,       // { lat, lng, accuracy }
        manualAddress: payload.manualAddress || '',
        profileDni: payload.profileDni || null,
        notes: payload.notes || ''
      };
      state.incidents.unshift(incident);
      appendAudit(state, 'CREATE_SOS_INCIDENT', { incidentId: incident.id, baseId: incident.baseId });
      saveState(state);
      return { ...incident };
    },

    getLatestIncident() {
      const state = loadState();
      return state.incidents[0] ? JSON.parse(JSON.stringify(state.incidents[0])) : null;
    },

    transitionIncidentStatus(incidentId, nextStatus) {
      const state = loadState();
      const incident = state.incidents.find(i => i.id === incidentId);
      if (!incident) throw new Error('Incidente no encontrado.');

      const currentIdx = TRANSITION_ORDER.indexOf(incident.status);
      const nextIdx = TRANSITION_ORDER.indexOf(nextStatus);

      if (nextStatus === INCIDENT_STATES.CANCELADA) {
        // cancelación permitida desde cualquier estado no final
        if (incident.status === INCIDENT_STATES.EN_CAMINO) {
          throw new Error('No se puede cancelar un móvil ya en camino desde la app del socio.');
        }
      } else {
        if (nextIdx === -1) throw new Error('Estado destino inválido: ' + nextStatus);
        if (currentIdx === -1) throw new Error('Estado actual inválido.');
        // Solo se permite avanzar exactamente un paso (máquina estricta)
        if (nextIdx !== currentIdx + 1) {
          throw new Error('Transición no permitida: ' + incident.status + ' → ' + nextStatus);
        }
      }

      incident.status = nextStatus;
      incident.statusHistory.push({ status: nextStatus, ts: nowISO() });
      appendAudit(state, 'TRANSITION_INCIDENT', {
        incidentId,
        from: incident.statusHistory[incident.statusHistory.length - 2]?.status || null,
        to: nextStatus
      });
      saveState(state);
      return JSON.parse(JSON.stringify(incident));
    },

    getVisibleBenefits(locality) {
      const state = loadState();
      return state.benefits
        .filter(b => b.status === 'activo')                       // regla innegociable
        .filter(b => !locality || b.locality === locality)        // filtro localidad
        .map(b => ({ id: b.id, name: b.name, locality: b.locality, description: b.description }));
    },

    getAllBenefitsRaw() {
      const state = loadState();
      return state.benefits.map(b => ({ ...b }));
    },

    getAuditLogs() {
      const state = loadState();
      return state.audit_logs.map(l => ({ ...l }));
    },

    // ---------- Suscripción en vivo ----------
    subscribe(callback) {
      if (!channel) {
        // Fallback: storage events (para navegadores sin BroadcastChannel)
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

    // Utilidades de prueba (solo MVP)
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
