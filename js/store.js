/* ============================================================
   E360Store v6.1 — Capa de abstracción de datos (MVP LOCAL + Supabase híbrido)
   v6.1: EMP rediseño. Agrega:
     - Migración v6 → v6.1 (cuil, familyGroup, orden, filial)
     - Seed con PATRI, MARCELO ALEJANDRO (PLATINO)
     - getIncidentEta(incidentId)
     - Puente Supabase: initSupabaseBridge, configureSupabaseConnection,
       getSupabaseStatus, syncWithSupabase (defensivo, fallback LOCAL_MVP)
   API pública v6 intacta → app-*.js no se rompe.
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

  const PULSERA_DEFAULTS = C.PULSERA_DEFAULTS || { pulseraStatus: 'inactivo', homeCoords: null, homeAddress: '' };
  const PULSERA_STATUSES = C.PULSERA_STATUSES || ['activo', 'inactivo'];

  const channel = (typeof BroadcastChannel !== 'undefined')
    ? new BroadcastChannel(CHANNEL_NAME) : null;

  // ============================================================
  // HELPERS
  // ============================================================
  function padNum(n, digits) {
    const s = String(Math.max(0, Math.floor(n)));
    return s.length >= digits ? s : '0'.repeat(digits - s.length) + s;
  }

  function uuidv4() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function addMonthsISO(iso, months) {
    const d = new Date(iso);
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day) d.setDate(0);
    return d.toISOString();
  }

  // ============================================================
  // SUPABASE BRIDGE (defensivo)
  // ============================================================
  // Estado interno del puente. Si no hay URL/KEY o window.supabase,
  // queda en LOCAL_MVP. Nunca lanza en el camino crítico.
  const supabaseBridge = {
    client: null,
    connected: false,
    mode: 'LOCAL_MVP',
    url: '',
    channelSub: null,
    lastError: null
  };

  function readSupabaseConfig() {
    let url = '';
    let anonKey = '';
    try {
      url = (global.localStorage && global.localStorage.getItem('e360_supabase_url')) || '';
      anonKey = (global.localStorage && global.localStorage.getItem('e360_supabase_anon_key')) || '';
    } catch (_) {}
    if (!url && C.SUPABASE && C.SUPABASE.URL) url = C.SUPABASE.URL;
    if (!anonKey && C.SUPABASE && C.SUPABASE.ANON_KEY) anonKey = C.SUPABASE.ANON_KEY;
    return { url: String(url).trim(), anonKey: String(anonKey).trim() };
  }

  function initSupabaseBridge() {
    const { url, anonKey } = readSupabaseConfig();
    supabaseBridge.url = url;
    if (!url || !anonKey) {
      supabaseBridge.connected = false;
      supabaseBridge.mode = 'LOCAL_MVP';
      supabaseBridge.lastError = null;
      return;
    }
    if (!global.supabase || typeof global.supabase.createClient !== 'function') {
      supabaseBridge.connected = false;
      supabaseBridge.mode = 'LOCAL_MVP';
      supabaseBridge.lastError = 'SDK Supabase no cargado.';
      return;
    }
    try {
      if (supabaseBridge.channelSub && typeof supabaseBridge.channelSub.unsubscribe === 'function') {
        try { supabaseBridge.channelSub.unsubscribe(); } catch (_) {}
      }
      supabaseBridge.client = global.supabase.createClient(url, anonKey);
      supabaseBridge.connected = true;
      supabaseBridge.mode = 'SUPABASE_LIVE';
      supabaseBridge.lastError = null;

      // Suscripción realtime (defensiva; si falla no rompe)
      try {
        supabaseBridge.channelSub = supabaseBridge.client
          .channel('e360_realtime')
          .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
            // Notificamos a la UI para que re-lea de localStorage o refresque.
            // No aplicamos el payload directamente (evita conflictos con estado local).
            if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now(), source: 'supabase' });
          })
          .subscribe();
      } catch (e) {
        supabaseBridge.lastError = 'Realtime: ' + (e && e.message ? e.message : 'error');
      }
    } catch (e) {
      supabaseBridge.connected = false;
      supabaseBridge.mode = 'LOCAL_MVP';
      supabaseBridge.lastError = e && e.message ? e.message : 'Error inicializando Supabase.';
    }
  }

  function tryUpsert(table, record) {
    if (!supabaseBridge.connected || !supabaseBridge.client) return;
    try {
      const promise = supabaseBridge.client.from(table).upsert(record);
      if (promise && typeof promise.catch === 'function') {
        promise.catch((err) => {
          supabaseBridge.lastError = table + ': ' + (err && err.message ? err.message : 'error');
          // No relanzamos: es no bloqueante.
        });
      }
    } catch (e) {
      supabaseBridge.lastError = table + ': ' + (e && e.message ? e.message : 'error');
    }
  }

  // ============================================================
  // SEED (v6.1)
  // ============================================================
  function buildSeed() {
    const bDol = C.BASES.DOLORES;
    const bCos = C.BASES.LA_COSTA;

    // Perfil demo titular (activo por defecto)
    const demoDni = '33656107';
    const demoProfile = {
      nombre: 'PATRI, MARCELO ALEJANDRO',
      dni: demoDni,
      cuil: '20-33656107-9',
      socioNumber: C.SOCIO_PREFIX + '-' + padNum(1, C.SOCIO_DIGITS),
      plan: 'PLATINO',
      baseId: 'DOLORES',
      telefono: '2245-406323',
      grupoSanguineo: 'O+',
      alergias: 'Ninguna declarada',
      patologias: 'Sin antecedentes críticos',
      contacto: 'Mariana Larrea (Co-titular)',
      orden: '00',
      filial: 'DOLORES',
      familyGroup: [
        { id: 'fam_01', nombre: 'PATRI, MARCELO ALEJANDRO', dni: demoDni, cuil: '20-33656107-9', orden: '00', filial: 'DOLORES' },
        { id: 'fam_02', nombre: 'LARREA, MARIANA TIZIANA', dni: '35123456', cuil: '27-35123456-4', orden: '01', filial: 'DOLORES' }
      ],
      carnetToken: uuidv4(),
      carnetStatus: 'activo',
      carnetValidUntil: addMonthsISO(new Date().toISOString(), C.CARNET_VALIDITY_MONTHS),
      pulseraToken: uuidv4(),
      pulseraStatus: 'activo',
      homeCoords: null,
      homeAddress: '',
      updatedAt: new Date().toISOString()
    };

    return {
      version: STORAGE_VERSION,
      socioCounter: 1,
      organizations: [
        { id:'org_asari', name:'ASARI S.A.S.', role:C.ROLES.PLATFORM_OWNER, lineAEnabled:true, lineBEnabled:true },
        { id:'org_emp', name:'EMP - Emergencias Médicas Privadas', role:C.ROLES.EMERGENCY_PROVIDER, lineAEnabled:true, lineBEnabled:true }
      ],
      bases: [
        { id:bDol.id, name:bDol.name, address:bDol.address, phone:bDol.phone, phoneAlt:bDol.phoneAlt, adminPhone:bDol.adminPhone, whatsapp:bDol.whatsapp, orgId:bDol.orgId, isActive:true },
        { id:bCos.id, name:bCos.name, address:bCos.address, phone:bCos.phone, phoneAlt:bCos.phoneAlt, adminPhone:bCos.adminPhone, whatsapp:bCos.whatsapp, orgId:bCos.orgId, isActive:true }
      ],
      moviles: [
        { id:'mov_dol_01', baseId:'DOLORES', unit:'AMB-01', tipoUnidad:'UTIM', status:UNIT_STATUS.DISPONIBLE },
        { id:'mov_dol_02', baseId:'DOLORES', unit:'AMB-02', tipoUnidad:'COMUN', status:UNIT_STATUS.DISPONIBLE },
        { id:'mov_cos_01', baseId:'LA_COSTA', unit:'AMB-11', tipoUnidad:'UTIM', status:UNIT_STATUS.DISPONIBLE },
        { id:'mov_cos_02', baseId:'LA_COSTA', unit:'AMB-12', tipoUnidad:'PEDIATRICA_CON_INCUBADORA', status:UNIT_STATUS.DISPONIBLE }
      ],
      benefits: [
        { id:'ben_internacion_costa', name:'Empresa de Internación Domiciliaria (La Costa)', category:'Internación Domiciliaria', locality:'La Costa', benefitDetail:'Cobertura parcial en internación domiciliaria programada.', agreementRef:'Pendiente de firma', validUntil:'2026-12-31', status:'en_negociacion', plans:['ORO','PLATINO'] },
        { id:'ben_cartilla_costa', name:'Red de Cartilla de Médicos para Consultorios (La Costa)', category:'Consultorios', locality:'La Costa', benefitDetail:'Descuento en consultas de cartilla.', agreementRef:'Pendiente de firma', validUntil:'2026-12-31', status:'en_negociacion', plans:['PLATA','ORO','PLATINO'] },
        { id:'ben_sanatorio_dolores', name:'Sanatorio Dolores', category:'Sanatorio / Clínica', locality:'Dolores', benefitDetail:'Convenio en negociación (no visible al socio).', agreementRef:'Pendiente de firma', validUntil:'2026-12-31', status:'en_negociacion', plans:['ORO','PLATINO'] },
        { id:'ben_consultorios_dolores', name:'Consultorios Médicos de Dolores (sin emergencias propias)', category:'Consultorios', locality:'Dolores', benefitDetail:'Convenio en negociación (no visible al socio).', agreementRef:'Pendiente de firma', validUntil:'2026-12-31', status:'en_negociacion', plans:['PLATA','ORO','PLATINO'] },
        { id:'ben_demo_farmacia', name:'[DEMO CONVENIO ACTIVO] Farmacia / Óptica Adherida', category:'Farmacia / Óptica', locality:'Dolores', benefitDetail:'Descuento demostrativo en medicamentos y anteojos.', agreementRef:'DEMO-01', validUntil:'2026-12-31', status:'activo', plans:['BRONCE','PLATA','ORO','PLATINO'] }
      ],
      b2b_establishments: [
        { id:'b2b_hotel_costa', name:'Complejo Turístico & Hotel Costero [DEMO]', type:'Hotel / Complejo', baseId:'LA_COSTA', address:'Av. Costanera y Calle 34, Santa Teresita', coords:null, referencePhone:'2246-420000', protocol:'Ingreso ambulancia por dársena de recepción. Conserjería 24hs.', tipoUnidadRequerida:'UTIM', status:'activo', createdAt:'2026-01-10T10:00:00.000Z' },
        { id:'b2b_balneario_costa', name:'Balneario Parador Sur [DEMO]', type:'Balneario / Camping', baseId:'LA_COSTA', address:'Playa y Bajada Náutica, San Clemente', coords:null, referencePhone:'2246-430000', protocol:'Acceso vehicular por bajada náutica. Guardavidas en puesto 2.', tipoUnidadRequerida:'COMUN', status:'activo', createdAt:'2026-01-12T10:00:00.000Z' },
        { id:'b2b_comercio_dolores', name:'Galería Comercial Centro [DEMO]', type:'Empresa / Comercio', baseId:'DOLORES', address:'Calle Buenos Aires 450, Dolores', coords:null, referencePhone:'2245-440000', protocol:'Acceso libre por entrada principal.', tipoUnidadRequerida:'COMUN', status:'activo', createdAt:'2026-01-15T10:00:00.000Z' },
        { id:'b2b_consultorio_dolores', name:'Consultorios Externos Sin Emergencia Propia [DEMO]', type:'Institución / Consultorio', baseId:'DOLORES', address:'Calle Belgrano 820, Dolores', coords:null, referencePhone:'2245-450000', protocol:'Prioridad de derivación por puerta lateral.', tipoUnidadRequerida:'TRASLADO_PROGRAMADO', status:'en_revision', createdAt:'2026-01-20T10:00:00.000Z' }
      ],
      profiles: { [demoDni]: demoProfile },
      incidents: [],
      audit_logs: [],
      external_services: {
        medicoVirtualUrl: C.EXTERNAL_SERVICES_DEFAULTS.medicoVirtualUrl,
        seguroViajeroUrl: C.EXTERNAL_SERVICES_DEFAULTS.seguroViajeroUrl,
        updatedAt: null, updatedBy: null
      },
      payment_config: JSON.parse(JSON.stringify(C.PAYMENT_DEFAULTS)),
      context: { activeBaseId:'DOLORES', platformMode:C.MODE, activeProfileDni:demoDni }
    };
  }

  // ============================================================
  // MIGRACIÓN v3/v4/v5/v6 → v6.1
  // ============================================================
  function migrateIfNeeded(parsed) {
    if (!parsed || typeof parsed !== 'object') return buildSeed();

    if (parsed.version === STORAGE_VERSION) {
      // Mismo schema: normalizar campos nuevos por si acaso.
      normalizeProfilesV61(parsed);
      return parsed;
    }

    if (parsed.version === 6 || parsed.version === 5 || parsed.version === 4 || parsed.version === 3) {
      const seed = buildSeed();
      parsed.bases = seed.bases.map((nb) => {
        const prev = (parsed.bases || []).find(b => b.id === nb.id);
        return prev ? Object.assign({}, nb, { isActive: prev.isActive !== false }) : nb;
      });
      parsed.moviles = (parsed.moviles || []).map((m) => {
        if (m.tipoUnidad) return m;
        const match = seed.moviles.find(sm => sm.id === m.id);
        return Object.assign({}, m, { tipoUnidad: match ? match.tipoUnidad : 'COMUN' });
      });
      parsed.b2b_establishments = (parsed.b2b_establishments || []).map((e) => {
        if (e.tipoUnidadRequerida) return e;
        return Object.assign({}, e, { tipoUnidadRequerida: 'COMUN' });
      });
      parsed.external_services = parsed.external_services || {
        medicoVirtualUrl:'', seguroViajeroUrl:'', updatedAt:null, updatedBy:null
      };
      parsed.benefits = (parsed.benefits || []).map((b) => {
        if (Array.isArray(b.plans)) return b;
        const cat = String(b.category || '').toLowerCase();
        let plans = ['ORO','PLATINO'];
        if (cat.indexOf('farmacia') !== -1 || cat.indexOf('óptica') !== -1 || cat.indexOf('optica') !== -1) plans = C.PLAN_IDS.slice();
        if (cat.indexOf('consultorio') !== -1) plans = ['PLATA','ORO','PLATINO'];
        return Object.assign({}, b, { plans });
      });
      if (typeof parsed.socioCounter !== 'number') parsed.socioCounter = 0;
      parsed.payment_config = parsed.payment_config || JSON.parse(JSON.stringify(C.PAYMENT_DEFAULTS));

      parsed.profiles = parsed.profiles || {};
      normalizeProfilesV61(parsed);

      // Si no hay perfiles, sembrar el demo.
      if (Object.keys(parsed.profiles).length === 0) {
        parsed.profiles = seed.profiles;
        parsed.socioCounter = seed.socioCounter;
        parsed.context = parsed.context || {};
        parsed.context.activeProfileDni = seed.context.activeProfileDni;
      }

      parsed.version = STORAGE_VERSION;
      return parsed;
    }

    return buildSeed();
  }

  // v6.1: agrega cuil, familyGroup, orden, filial si faltan.
  function normalizeProfilesV61(state) {
    const profiles = state.profiles || {};
    Object.keys(profiles).forEach((dni) => {
      const p = profiles[dni];
      if (!p) return;
      if (!p.plan) p.plan = C.DEFAULT_PLAN;
      if (!p.carnetToken) p.carnetToken = null;
      if (!p.carnetStatus) p.carnetStatus = 'activo';
      if (!p.carnetValidUntil) p.carnetValidUntil = null;
      if (!p.socioNumber) p.socioNumber = null;
      if (p.pulseraToken === undefined) p.pulseraToken = null;
      if (p.pulseraStatus === undefined) p.pulseraStatus = PULSERA_DEFAULTS.pulseraStatus;
      if (p.homeCoords === undefined) p.homeCoords = null;
      if (p.homeAddress === undefined) p.homeAddress = '';
      // v6.1
      if (p.cuil === undefined) p.cuil = '';
      if (p.orden === undefined) p.orden = '00';
      if (p.filial === undefined) p.filial = p.baseId || 'DOLORES';
      if (!Array.isArray(p.familyGroup)) {
        p.familyGroup = [{
          id: 'fam_' + (dni || 'x'),
          nombre: p.nombre || '—',
          dni: dni,
          cuil: p.cuil || '',
          orden: p.orden || '00',
          filial: p.filial || 'DOLORES'
        }];
      }
    });
  }

  // ============================================================
  // PERSISTENCIA
  // ============================================================
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
      if (migrated !== parsed) localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));

      if (!migrated.context) migrated.context = { activeBaseId:'DOLORES', platformMode:C.MODE, activeProfileDni:null };
      if (migrated.context.activeProfileDni === undefined) migrated.context.activeProfileDni = null;
      if (!Array.isArray(migrated.b2b_establishments)) migrated.b2b_establishments = [];
      if (!Array.isArray(migrated.benefits)) migrated.benefits = [];
      if (!Array.isArray(migrated.audit_logs)) migrated.audit_logs = [];
      if (!migrated.external_services) migrated.external_services = { medicoVirtualUrl:'', seguroViajeroUrl:'', updatedAt:null, updatedBy:null };
      if (!migrated.payment_config) migrated.payment_config = JSON.parse(JSON.stringify(C.PAYMENT_DEFAULTS));
      if (typeof migrated.socioCounter !== 'number') migrated.socioCounter = 0;
      return migrated;
    } catch (e) {
      console.error('[E360Store] Error cargando estado, usando seed.', e);
      const seed = buildSeed();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(seed)); } catch (_) {}
      return seed;
    }
  }

  function saveState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { console.error('[E360Store] Error guardando estado.', e); }
    if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now() });
  }

  function uid(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function nowISO() { return new Date().toISOString(); }

  function requireOperator(n) { const s = String(n || '').trim(); if (!s) throw new Error('Se requiere identificación del operador en turno.'); return s; }
  function requireAdmin(n) { const s = String(n || '').trim(); if (!s) throw new Error('Se requiere identificación del administrador.'); return s; }

  function appendAudit(state, action, payload, actor) {
    state.audit_logs.unshift({ id: uid('aud'), ts: nowISO(), action, payload: payload || {}, actor: actor || 'system' });
    if (state.audit_logs.length > C.AUDIT_MAX_ENTRIES) state.audit_logs.length = C.AUDIT_MAX_ENTRIES;
  }

  function findIncident(state, id) {
    const inc = state.incidents.find(i => i.id === id);
    if (!inc) throw new Error('Incidente no encontrado.');
    return inc;
  }

  function pushStatus(incident, status, actor, detail) {
    incident.status = status;
    incident.statusHistory.push({ status, ts: nowISO(), actor: actor || 'system', detail: detail || '' });
  }

  function releaseUnitIfAny(state, incident) {
    if (!incident.assignedUnitId) return;
    const unit = state.moviles.find(m => m.id === incident.assignedUnitId);
    if (unit && unit.status !== UNIT_STATUS.MANTENIMIENTO) unit.status = UNIT_STATUS.DISPONIBLE;
  }

  function calcCarnetStatus(profile) {
    if (!profile) return 'vencido';
    if (profile.carnetStatus === 'suspendido') return 'suspendido';
    if (!profile.carnetValidUntil) return 'vencido';
    const now = Date.now();
    const exp = new Date(profile.carnetValidUntil).getTime();
    return exp > now ? 'activo' : 'vencido';
  }

  function daysToExpire(profile) {
    if (!profile || !profile.carnetValidUntil) return null;
    const now = Date.now();
    const exp = new Date(profile.carnetValidUntil).getTime();
    return Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
  }

  function requireCrewForIncident(state, incidentId, unitId, crewName) {
    const crew = String(crewName || '').trim();
    if (!crew) throw new Error('Se requiere identificación del personal de guardia.');
    const inc = findIncident(state, incidentId);
    if (inc.assignedUnitId !== unitId) throw new Error('El incidente no está asignado a tu móvil.');
    return { inc, crew };
  }

  // ============================================================
  // API PÚBLICA
  // ============================================================
  const E360Store = {

    INCIDENT_STATES, TRANSITION_ORDER, PRIORITIES, UNIT_STATUS, BENEFIT_STATUSES, B2B_STATUSES,
    PLAN_IDS: C.PLAN_IDS,
    PLANS: C.PLANS,
    PULSERA_STATUSES,

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

    getOrganizations() { return loadState().organizations.map(o => ({ ...o })); },

    updateOrganizationFlags(orgId, lineA, lineB, adminName) {
      const actor = requireAdmin(adminName);
      const state = loadState();
      const org = state.organizations.find(o => o.id === orgId);
      if (!org) throw new Error('Organización no encontrada.');
      org.lineAEnabled = !!lineA; org.lineBEnabled = !!lineB;
      appendAudit(state, 'UPDATE_ORG_FLAGS', { orgId, lineA: !!lineA, lineB: !!lineB }, actor);
      saveState(state);
      return { ...org };
    },

    // ======================= PERFILES =======================
    saveProfile(profile) {
      const state = loadState();
      const dni = String(profile.dni || '').trim();
      if (!dni) throw new Error('DNI requerido para guardar ficha.');
      const existing = state.profiles[dni] || null;

      const isNew = !existing;
      let socioNumber = existing ? existing.socioNumber : null;
      let carnetToken = existing ? existing.carnetToken : null;
      let carnetStatus = existing ? existing.carnetStatus : 'activo';
      let carnetValidUntil = existing ? existing.carnetValidUntil : null;
      let plan = existing && existing.plan ? existing.plan : (profile.plan || C.DEFAULT_PLAN);
      let pulseraToken = existing ? existing.pulseraToken : null;
      let pulseraStatus = existing ? existing.pulseraStatus : PULSERA_DEFAULTS.pulseraStatus;
      let homeCoords = existing ? existing.homeCoords : null;
      let homeAddress = existing ? existing.homeAddress : '';

      if (C.PLAN_IDS.indexOf(plan) === -1) plan = C.DEFAULT_PLAN;
      const planDef = C.PLANS[plan] || {};

      if (isNew) {
        state.socioCounter = (state.socioCounter || 0) + 1;
        socioNumber = C.SOCIO_PREFIX + '-' + padNum(state.socioCounter, C.SOCIO_DIGITS);
        carnetToken = uuidv4();
        carnetValidUntil = addMonthsISO(nowISO(), C.CARNET_VALIDITY_MONTHS);
        carnetStatus = 'activo';
        if (planDef.hasPulsera) {
          pulseraToken = uuidv4();
          pulseraStatus = 'activo';
        }
      } else {
        if (planDef.hasPulsera && !pulseraToken) {
          pulseraToken = uuidv4();
          pulseraStatus = 'activo';
        }
        if (!planDef.hasPulsera && pulseraStatus === 'activo') {
          pulseraStatus = 'inactivo';
        }
      }

      if (profile.homeCoords !== undefined) homeCoords = profile.homeCoords;
      if (profile.homeAddress !== undefined) homeAddress = profile.homeAddress;

      const record = Object.assign({}, profile, {
        dni,
        plan,
        socioNumber,
        carnetToken,
        carnetStatus,
        carnetValidUntil,
        pulseraToken,
        pulseraStatus,
        homeCoords,
        homeAddress,
        updatedAt: nowISO()
      });

      // v6.1: normalizar campos nuevos si vienen en profile
      if (profile.cuil !== undefined) record.cuil = String(profile.cuil || '').trim();
      if (profile.familyGroup !== undefined && Array.isArray(profile.familyGroup)) record.familyGroup = profile.familyGroup;
      if (profile.orden !== undefined) record.orden = String(profile.orden || '00');
      if (profile.filial !== undefined) record.filial = String(profile.filial || 'DOLORES');

      delete record.planField;
      state.profiles[dni] = record;
      state.context.activeProfileDni = dni;
      appendAudit(state, isNew ? 'CREATE_PROFILE' : 'SAVE_PROFILE', { dni, socioNumber, plan, pulseraStatus }, 'socio_app');
      saveState(state);

      // Sync Supabase (no bloqueante)
      tryUpsert('profiles', {
        dni: record.dni,
        nombre: record.nombre,
        cuil: record.cuil || '',
        socio_number: record.socioNumber,
        plan: record.plan,
        base_id: record.baseId || state.context.activeBaseId,
        telefono: record.telefono || '',
        grupo_sanguineo: record.grupoSanguineo || '',
        alergias: record.alergias || '',
        patologias: record.patologias || '',
        contacto: record.contacto || '',
        family_group: record.familyGroup || [],
        carnet_token: record.carnetToken,
        pulsera_token: record.pulseraToken,
        pulsera_status: record.pulseraStatus,
        home_coords: record.homeCoords,
        home_address: record.homeAddress || '',
        updated_at: record.updatedAt
      });

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

    getProfileByCarnetToken(token) {
      const t = String(token || '').trim();
      if (!t) return null;
      const state = loadState();
      const dni = Object.keys(state.profiles).find(k => state.profiles[k].carnetToken === t);
      if (!dni) return null;
      const p = state.profiles[dni];
      const effective = calcCarnetStatus(p);
      return {
        socioNumber: p.socioNumber || null,
        nombre: p.nombre || '—',
        plan: p.plan || C.DEFAULT_PLAN,
        planLabel: (C.PLANS[p.plan] && C.PLANS[p.plan].label) || p.plan,
        carnetStatus: effective,
        carnetValidUntil: p.carnetValidUntil || null,
        daysToExpire: daysToExpire(p),
        dniMasked: p.dni ? ('••••' + String(p.dni).slice(-3)) : '—'
      };
    },

    // ======================= PULSERA SOS =======================
    getProfileByPulseraToken(token) {
      const t = String(token || '').trim();
      if (!t) return null;
      const state = loadState();
      const dni = Object.keys(state.profiles).find(k => state.profiles[k].pulseraToken === t);
      if (!dni) return null;
      const p = state.profiles[dni];
      const planDef = C.PLANS[p.plan] || {};
      const effectivePulseraStatus = (p.pulseraStatus === 'activo' && planDef.hasPulsera) ? 'activo' : 'inactivo';
      return {
        dni: p.dni,
        socioNumber: p.socioNumber || null,
        nombre: p.nombre || '—',
        plan: p.plan || C.DEFAULT_PLAN,
        planLabel: planDef.label || p.plan,
        pulseraStatus: effectivePulseraStatus,
        telefono: p.telefono || '',
        grupoSanguineo: p.grupoSanguineo || '',
        alergias: p.alergias || '',
        patologias: p.patologias || '',
        contacto: p.contacto || '',
        homeCoords: p.homeCoords || null,
        homeAddress: p.homeAddress || ''
      };
    },

    setPulseraStatus(dni, status, adminName) {
      const actor = requireAdmin(adminName);
      if (PULSERA_STATUSES.indexOf(status) === -1) throw new Error('Estado de pulsera inválido.');
      const state = loadState();
      const key = String(dni || '').trim();
      const p = state.profiles[key];
      if (!p) throw new Error('Socio no encontrado.');
      const planDef = C.PLANS[p.plan] || {};
      if (status === 'activo' && !planDef.hasPulsera) {
        throw new Error('El plan actual no incluye pulsera SOS. Cambiá el plan a ORO o PLATINO primero.');
      }
      p.pulseraStatus = status;
      if (status === 'activo' && !p.pulseraToken) p.pulseraToken = uuidv4();
      p.updatedAt = nowISO();
      appendAudit(state, 'SET_PULSERA_STATUS', { dni: key, status, actor }, actor);
      saveState(state);
      return { ...p };
    },

    regeneratePulseraToken(dni, adminName) {
      const actor = requireAdmin(adminName);
      const state = loadState();
      const key = String(dni || '').trim();
      const p = state.profiles[key];
      if (!p) throw new Error('Socio no encontrado.');
      const planDef = C.PLANS[p.plan] || {};
      if (!planDef.hasPulsera) throw new Error('El plan actual no incluye pulsera SOS.');
      p.pulseraToken = uuidv4();
      p.pulseraStatus = 'activo';
      p.updatedAt = nowISO();
      appendAudit(state, 'REGENERATE_PULSERA_TOKEN', { dni: key, actor }, actor);
      saveState(state);
      return { ...p };
    },

    setHomeCoords(dni, coords, address, adminName) {
      const actor = requireAdmin(adminName);
      const state = loadState();
      const key = String(dni || '').trim();
      const p = state.profiles[key];
      if (!p) throw new Error('Socio no encontrado.');
      const planDef = C.PLANS[p.plan] || {};
      if (!planDef.hasHomeButton) throw new Error('El plan actual no incluye botón domiciliario (solo PLATINO).');
      if (coords && (typeof coords.lat !== 'number' || typeof coords.lng !== 'number')) {
        throw new Error('Coordenadas inválidas.');
      }
      p.homeCoords = coords || null;
      if (address !== undefined) p.homeAddress = String(address || '').trim();
      p.updatedAt = nowISO();
      appendAudit(state, 'SET_HOME_COORDS', { dni: key, hasCoords: !!coords, actor }, actor);
      saveState(state);
      return { ...p };
    },

    setProfilePlan(dni, plan, adminName) {
      const actor = requireAdmin(adminName);
      if (C.PLAN_IDS.indexOf(plan) === -1) throw new Error('Plan inválido.');
      const state = loadState();
      const key = String(dni || '').trim();
      const p = state.profiles[key];
      if (!p) throw new Error('Socio no encontrado.');
      const prev = p.plan;
      const planDef = C.PLANS[plan] || {};
      p.plan = plan;
      if (planDef.hasPulsera) {
        if (!p.pulseraToken) p.pulseraToken = uuidv4();
        p.pulseraStatus = 'activo';
      } else {
        p.pulseraStatus = 'inactivo';
      }
      if (!planDef.hasHomeButton) {
        p.homeCoords = null;
      }
      p.updatedAt = nowISO();
      appendAudit(state, 'SET_PROFILE_PLAN', { dni: key, from: prev, to: plan, actor }, actor);
      saveState(state);
      return { ...p };
    },

    setCarnetStatus(dni, status, adminName) {
      const actor = requireAdmin(adminName);
      if (C.CARNET_STATUSES.indexOf(status) === -1) throw new Error('Estado de carnet inválido.');
      const state = loadState();
      const key = String(dni || '').trim();
      const p = state.profiles[key];
      if (!p) throw new Error('Socio no encontrado.');
      p.carnetStatus = status;
      p.updatedAt = nowISO();
      appendAudit(state, 'SET_CARNET_STATUS', { dni: key, status, actor }, actor);
      saveState(state);
      return { ...p };
    },

    renewCarnet(dni, adminName) {
      const actor = requireAdmin(adminName);
      const state = loadState();
      const key = String(dni || '').trim();
      const p = state.profiles[key];
      if (!p) throw new Error('Socio no encontrado.');
      p.carnetValidUntil = addMonthsISO(nowISO(), C.CARNET_VALIDITY_MONTHS);
      p.carnetStatus = 'activo';
      if (!p.carnetToken) p.carnetToken = uuidv4();
      p.updatedAt = nowISO();
      appendAudit(state, 'RENEW_CARNET', { dni: key, validUntil: p.carnetValidUntil, actor }, actor);
      saveState(state);
      return { ...p };
    },

    listProfiles() {
      const state = loadState();
      return Object.keys(state.profiles).map(k => ({ ...state.profiles[k] }));
    },

    // ======================= INCIDENTES =======================
    createSOSIncident(payload) {
      const state = loadState();
      const dni = payload.profileDni || state.context.activeProfileDni || null;
      const incident = {
        id: uid('inc'), createdAt: nowISO(), baseId: state.context.activeBaseId,
        status: INCIDENT_STATES.RECIBIDA_SERVIDOR, priority: null, assignedUnitId: null,
        clinicalNotes: '', crewNotes: '', destinationCenter: '', closureReason: '', outcomeNotes: '',
        location: payload.location || null, manualAddress: payload.manualAddress || '',
        b2bEstablishmentId: payload.b2bEstablishmentId || null,
        profileDni: dni, notes: payload.notes || '',
        source: payload.source || 'socio_app',
        pulseraToken: payload.pulseraToken || null,
        statusHistory: [{ status: INCIDENT_STATES.RECIBIDA_SERVIDOR, ts: nowISO(), actor: payload.source || 'socio_app', detail: payload.detail || 'Alerta emitida.' }]
      };
      state.incidents.unshift(incident);
      appendAudit(state, 'CREATE_SOS_INCIDENT', { incidentId: incident.id, baseId: incident.baseId, dni, b2b: incident.b2bEstablishmentId, source: incident.source }, payload.source || 'socio_app');
      saveState(state);

      // Sync Supabase (no bloqueante)
      tryUpsert('incidents', {
        id: incident.id,
        created_at: incident.createdAt,
        base_id: incident.baseId,
        status: incident.status,
        priority: incident.priority,
        assigned_unit_id: incident.assignedUnitId,
        profile_dni: incident.profileDni,
        location: incident.location,
        manual_address: incident.manualAddress,
        b2b_establishment_id: incident.b2bEstablishmentId,
        source: incident.source,
        status_history: incident.statusHistory,
        clinical_notes: incident.clinicalNotes,
        crew_notes: incident.crewNotes,
        destination_center: incident.destinationCenter,
        closure_reason: incident.closureReason,
        outcome_notes: incident.outcomeNotes,
        unit_location: incident.unitLocation || null
      });

      return JSON.parse(JSON.stringify(incident));
    },

    createSOSPulseraIncident(payload) {
      const token = String(payload && payload.pulseraToken || '').trim();
      if (!token) throw new Error('Token de pulsera requerido.');
      const profile = this.getProfileByPulseraToken(token);
      if (!profile) throw new Error('Pulsera no registrada.');
      if (profile.pulseraStatus !== 'activo') throw new Error('La pulsera no está activa. Contactá a administración.');

      const gps = payload.location || null;
      const fallback = profile.homeCoords || null;
      const location = gps || (fallback ? { lat: fallback.lat, lng: fallback.lng, accuracy: fallback.accuracy || 0, source: 'homeCoords' } : null);

      return this.createSOSIncident({
        profileDni: profile.dni,
        location,
        manualAddress: payload.manualAddress || profile.homeAddress || '',
        b2bEstablishmentId: payload.b2bEstablishmentId || null,
        notes: payload.notes || 'Alerta emitida por pulsera SOS.',
        source: 'pulsera',
        pulseraToken: token,
        detail: 'Alerta emitida por pulsera SOS. Escaneada desde: ' + (gps ? 'GPS del dispositivo' : 'coordenadas de domicilio')
      });
    },

    getLatestIncident() {
      const state = loadState();
      return state.incidents[0] ? JSON.parse(JSON.stringify(state.incidents[0])) : null;
    },

    getIncidents(filterBaseId) {
      const state = loadState();
      let list = state.incidents.slice();
      if (filterBaseId && filterBaseId !== 'ALL') list = list.filter(i => i.baseId === filterBaseId);
      return list.map(i => JSON.parse(JSON.stringify(i)));
    },

    getIncidentById(id) {
      const state = loadState();
      const inc = state.incidents.find(i => i.id === id);
      return inc ? JSON.parse(JSON.stringify(inc)) : null;
    },

    // v6.1: ETA referencial para un incidente.
    // Devuelve { hasEta, etaMinutes, source, disclaimer }.
    // Cálculo local conservador: si el móvil tiene unitLocation y el incidente
    // tiene location, estima minutos con haversine a 40 km/h promedio.
    // Si no hay datos, hasEta=false y etaMinutes=null.
    getIncidentEta(incidentId) {
      const disclaimer = 'Tiempo estimado de forma referencial (sujeto a tránsito y condiciones operativas).';
      const state = loadState();
      const inc = state.incidents.find(i => i.id === incidentId);
      if (!inc) return { hasEta: false, etaMinutes: null, source: 'sin_incidente', disclaimer };

      const closed = ['CERRADA','CANCELADA'];
      if (closed.indexOf(inc.status) !== -1) {
        return { hasEta: false, etaMinutes: null, source: 'incidente_cerrado', disclaimer };
      }

      const origin = inc.unitLocation || null;
      const dest = inc.location || null;
      if (!origin || !dest || typeof origin.lat !== 'number' || typeof origin.lng !== 'number' ||
          typeof dest.lat !== 'number' || typeof dest.lng !== 'number') {
        return { hasEta: false, etaMinutes: null, source: 'sin_coordenadas', disclaimer };
      }

      // Haversine
      const toRad = (x) => x * Math.PI / 180;
      const R = 6371;
      const dLat = toRad(dest.lat - origin.lat);
      const dLng = toRad(dest.lng - origin.lng);
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(toRad(origin.lat)) * Math.cos(toRad(dest.lat)) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const km = R * c;
      const speedKmh = 40;
      const etaMinutes = Math.max(1, Math.round((km / speedKmh) * 60));
      return { hasEta: true, etaMinutes, source: 'haversine_40kmh', disclaimer };
    },

    canTransitionIncident(from, to) { return SM.canTransitionIncident(from, to); },
    getAllowedNextStatesIncident(s) { return SM.getAllowedNextStatesIncident(s); },

    acknowledgeIncident(incidentId, operatorName) {
      const actor = requireOperator(operatorName);
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.RECIBIDA_SERVIDOR) throw new Error('Solo se puede acusar recibo de incidentes en RECIBIDA_SERVIDOR.');
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.ACEPTADA_POR_CENTRAL);
      if (!check.ok) throw new Error(check.reason);
      pushStatus(inc, INCIDENT_STATES.ACEPTADA_POR_CENTRAL, actor, 'Acuse de recibo por operador.');
      appendAudit(state, 'ACK_INCIDENT', { incidentId, operatorName: actor }, actor);
      saveState(state);
      tryUpsert('incidents', { id: inc.id, status: inc.status, status_history: inc.statusHistory });
      return JSON.parse(JSON.stringify(inc));
    },

    triageIncident(incidentId, priority, clinicalNotes, operatorName) {
      const actor = requireOperator(operatorName);
      if (PRIORITIES.indexOf(priority) === -1) throw new Error('Prioridad inválida. Debe ser ROJO, AMARILLO o VERDE.');
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.ACEPTADA_POR_CENTRAL) throw new Error('El incidente debe estar en ACEPTADA_POR_CENTRAL para clasificar.');
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.CLASIFICADA);
      if (!check.ok) throw new Error(check.reason);
      inc.priority = priority;
      inc.clinicalNotes = String(clinicalNotes || '').trim();
      pushStatus(inc, INCIDENT_STATES.CLASIFICADA, actor, 'Prioridad ' + priority + '.');
      appendAudit(state, 'TRIAGE_INCIDENT', { incidentId, priority, operatorName: actor }, actor);
      saveState(state);
      tryUpsert('incidents', { id: inc.id, status: inc.status, priority: inc.priority, clinical_notes: inc.clinicalNotes, status_history: inc.statusHistory });
      return JSON.parse(JSON.stringify(inc));
    },

    assignUnitToIncident(incidentId, unitId, crewNotes, operatorName) {
      const actor = requireOperator(operatorName);
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.CLASIFICADA) throw new Error('El incidente debe estar CLASIFICADA para asignar móvil.');
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
      tryUpsert('incidents', { id: inc.id, status: inc.status, assigned_unit_id: inc.assignedUnitId, crew_notes: inc.crewNotes, status_history: inc.statusHistory });
      return JSON.parse(JSON.stringify(inc));
    },

    dispatchIncidentUnit(incidentId, operatorName) {
      const actor = requireOperator(operatorName);
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.MOVIL_ASIGNADO) throw new Error('El incidente debe estar MOVIL_ASIGNADO para despachar.');
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.EN_CAMINO);
      if (!check.ok) throw new Error(check.reason);
      const unit = state.moviles.find(m => m.id === inc.assignedUnitId);
      if (!unit) throw new Error('Móvil asignado no encontrado.');
      unit.status = UNIT_STATUS.EN_SALIDA;
      pushStatus(inc, INCIDENT_STATES.EN_CAMINO, actor, 'Móvil ' + unit.unit + ' despachado.');
      appendAudit(state, 'DISPATCH_INCIDENT', { incidentId, unitId: unit.id, operatorName: actor }, actor);
      saveState(state);
      tryUpsert('incidents', { id: inc.id, status: inc.status, status_history: inc.statusHistory });
      return JSON.parse(JSON.stringify(inc));
    },

    markIncidentOnScene(incidentId, operatorName) {
      const actor = requireOperator(operatorName);
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.EN_CAMINO) throw new Error('El incidente debe estar EN_CAMINO para marcar arribo.');
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.EN_ESCENA);
      if (!check.ok) throw new Error(check.reason);
      pushStatus(inc, INCIDENT_STATES.EN_ESCENA, actor, 'Móvil arribó al lugar.');
      appendAudit(state, 'ON_SCENE', { incidentId, operatorName: actor }, actor);
      saveState(state);
      tryUpsert('incidents', { id: inc.id, status: inc.status, status_history: inc.statusHistory });
      return JSON.parse(JSON.stringify(inc));
    },

    markIncidentInTransit(incidentId, destinationCenter, operatorName) {
      const actor = requireOperator(operatorName);
      const dest = String(destinationCenter || '').trim();
      if (!dest) throw new Error('Indicá el centro receptor para registrar el traslado.');
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.EN_ESCENA) throw new Error('El incidente debe estar EN_ESCENA para registrar traslado.');
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.EN_TRASLADO);
      if (!check.ok) throw new Error(check.reason);
      inc.destinationCenter = dest;
      pushStatus(inc, INCIDENT_STATES.EN_TRASLADO, actor, 'Derivación a ' + dest + '.');
      appendAudit(state, 'IN_TRANSIT', { incidentId, destinationCenter: dest, operatorName: actor }, actor);
      saveState(state);
      tryUpsert('incidents', { id: inc.id, status: inc.status, destination_center: inc.destinationCenter, status_history: inc.statusHistory });
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
      inc.closureReason = reason; inc.outcomeNotes = notes;
      pushStatus(inc, INCIDENT_STATES.CERRADA, actor, 'Cierre: ' + reason);
      releaseUnitIfAny(state, inc);
      appendAudit(state, 'CLOSE_INCIDENT', { incidentId, closureReason: reason, operatorName: actor }, actor);
      saveState(state);
      tryUpsert('incidents', { id: inc.id, status: inc.status, closure_reason: inc.closureReason, outcome_notes: inc.outcomeNotes, status_history: inc.statusHistory });
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
      tryUpsert('incidents', { id: inc.id, status: inc.status, closure_reason: inc.closureReason, status_history: inc.statusHistory });
      return JSON.parse(JSON.stringify(inc));
    },

    transitionIncidentStatus(id, next) { return this._genericTransition(id, next, 'simulador_socio'); },

    _genericTransition(id, next, actor) {
      const state = loadState();
      const inc = findIncident(state, id);
      const check = SM.canTransitionIncident(inc.status, next);
      if (!check.ok) throw new Error(check.reason);
      if (next === INCIDENT_STATES.CANCELADA) {
        inc.closureReason = 'Cancelado desde simulador.';
        pushStatus(inc, INCIDENT_STATES.CANCELADA, actor, 'Cancelación simulada.');
        releaseUnitIfAny(state, inc);
      } else {
        pushStatus(inc, next, actor, 'Simulación de transición.');
      }
      appendAudit(state, 'SIM_TRANSITION', { incidentId: id, nextStatus: next }, actor);
      saveState(state);
      tryUpsert('incidents', { id: inc.id, status: inc.status, status_history: inc.statusHistory });
      return JSON.parse(JSON.stringify(inc));
    },

    // ======================= FLOTA =======================
    getFleet(baseId) {
      const state = loadState();
      const list = baseId && baseId !== 'ALL' ? state.moviles.filter(m => m.baseId === baseId) : state.moviles.slice();
      return list.map(m => ({ ...m }));
    },

    getBases() { return loadState().bases.map(b => ({ ...b })); },

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

    // ======================= GUARDIA =======================
    getActiveIncidentForUnit(unitId) {
      const state = loadState();
      const closed = ['CERRADA', 'CANCELADA'];
      const inc = state.incidents.find(i => i.assignedUnitId === unitId && closed.indexOf(i.status) === -1);
      return inc ? JSON.parse(JSON.stringify(inc)) : null;
    },

    updateCrewPosition(incidentId, coords, crewName) {
      const crew = String(crewName || '').trim();
      if (!crew) throw new Error('Se requiere identificación del personal de guardia.');
      const lat = Number(coords && coords.lat);
      const lng = Number(coords && coords.lng);
      if (!isFinite(lat) || !isFinite(lng)) throw new Error('Coordenadas inválidas.');
      const state = loadState();
      const inc = findIncident(state, incidentId);
      if (inc.status !== INCIDENT_STATES.EN_CAMINO && inc.status !== INCIDENT_STATES.EN_ESCENA) {
        throw new Error('Solo se puede actualizar GPS en EN_CAMINO o EN_ESCENA.');
      }
      inc.unitLocation = {
        lat, lng,
        accuracy: Number(coords.accuracy) || 0,
        ts: nowISO(),
        actor: crew
      };
      saveState(state);
      tryUpsert('incidents', { id: inc.id, unit_location: inc.unitLocation });
      return JSON.parse(JSON.stringify(inc));
    },

    guardiaDispatchIncident(incidentId, unitId, crewName) {
      const state = loadState();
      const { inc, crew } = requireCrewForIncident(state, incidentId, unitId, crewName);
      if (inc.status !== INCIDENT_STATES.MOVIL_ASIGNADO) throw new Error('El incidente debe estar MOVIL_ASIGNADO.');
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.EN_CAMINO);
      if (!check.ok) throw new Error(check.reason);
      const unit = state.moviles.find(m => m.id === unitId);
      if (!unit) throw new Error('Móvil no encontrado.');
      unit.status = UNIT_STATUS.EN_SALIDA;
      pushStatus(inc, INCIDENT_STATES.EN_CAMINO, crew, 'Salida confirmada por guardia (móvil ' + unit.unit + ').');
      appendAudit(state, 'GUARDIA_DISPATCH', { incidentId, unitId, crewName: crew }, crew);
      saveState(state);
      tryUpsert('incidents', { id: inc.id, status: inc.status, status_history: inc.statusHistory });
      return JSON.parse(JSON.stringify(inc));
    },

    guardiaMarkOnScene(incidentId, unitId, crewName) {
      const state = loadState();
      const { inc, crew } = requireCrewForIncident(state, incidentId, unitId, crewName);
      if (inc.status !== INCIDENT_STATES.EN_CAMINO) throw new Error('El incidente debe estar EN_CAMINO.');
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.EN_ESCENA);
      if (!check.ok) throw new Error(check.reason);
      pushStatus(inc, INCIDENT_STATES.EN_ESCENA, crew, 'Arribo a escena confirmado por guardia.');
      appendAudit(state, 'GUARDIA_ON_SCENE', { incidentId, unitId, crewName: crew }, crew);
      saveState(state);
      tryUpsert('incidents', { id: inc.id, status: inc.status, status_history: inc.statusHistory });
      return JSON.parse(JSON.stringify(inc));
    },

    guardiaMarkInTransit(incidentId, unitId, destinationCenter, crewName) {
      const dest = String(destinationCenter || '').trim();
      if (!dest) throw new Error('Indicá el centro receptor.');
      const state = loadState();
      const { inc, crew } = requireCrewForIncident(state, incidentId, unitId, crewName);
      if (inc.status !== INCIDENT_STATES.EN_ESCENA) throw new Error('El incidente debe estar EN_ESCENA.');
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.EN_TRASLADO);
      if (!check.ok) throw new Error(check.reason);
      inc.destinationCenter = dest;
      pushStatus(inc, INCIDENT_STATES.EN_TRASLADO, crew, 'Traslado iniciado por guardia hacia ' + dest + '.');
      appendAudit(state, 'GUARDIA_IN_TRANSIT', { incidentId, unitId, destinationCenter: dest, crewName: crew }, crew);
      saveState(state);
      tryUpsert('incidents', { id: inc.id, status: inc.status, destination_center: inc.destinationCenter, status_history: inc.statusHistory });
      return JSON.parse(JSON.stringify(inc));
    },

    guardiaCloseIncident(incidentId, unitId, closureReason, outcomeNotes, crewName) {
      const reason = String(closureReason || '').trim();
      const notes = String(outcomeNotes || '').trim();
      if (!reason) throw new Error('El motivo de cierre es obligatorio.');
      if (!notes) throw new Error('Las notas de cierre son obligatorias.');
      const state = loadState();
      const { inc, crew } = requireCrewForIncident(state, incidentId, unitId, crewName);
      const check = SM.canTransitionIncident(inc.status, INCIDENT_STATES.CERRADA);
      if (!check.ok) throw new Error(check.reason);
      inc.closureReason = reason;
      inc.outcomeNotes = notes;
      pushStatus(inc, INCIDENT_STATES.CERRADA, crew, 'Cierre por guardia: ' + reason);
      releaseUnitIfAny(state, inc);
      appendAudit(state, 'GUARDIA_CLOSE', { incidentId, unitId, closureReason: reason, crewName: crew }, crew);
      saveState(state);
      tryUpsert('incidents', { id: inc.id, status: inc.status, closure_reason: inc.closureReason, outcome_notes: inc.outcomeNotes, status_history: inc.statusHistory });
      return JSON.parse(JSON.stringify(inc));
    },

    getGuardiaHistory(unitId, limit) {
      const state = loadState();
      const n = Math.max(1, Number(limit) || 10);
      const closed = ['CERRADA', 'CANCELADA'];
      return state.incidents
        .filter(i => i.assignedUnitId === unitId && closed.indexOf(i.status) !== -1)
        .slice(0, n)
        .map(i => JSON.parse(JSON.stringify(i)));
    },

    requestSupportFromCrew(incidentId, unitId, supportType, notes, crewName) {
      const state = loadState();
      const { inc, crew } = requireCrewForIncident(state, incidentId, unitId, crewName);
      const type = String(supportType || '').trim();
      if (!type) throw new Error('Seleccioná un tipo de apoyo.');
      if (inc.status !== INCIDENT_STATES.EN_CAMINO && inc.status !== INCIDENT_STATES.EN_ESCENA) {
        throw new Error('Solo se puede solicitar apoyo en EN_CAMINO o EN_ESCENA.');
      }
      const ts = nowISO();
      inc.supportRequests = inc.supportRequests || [];
      inc.supportRequests.push({ ts, type, notes: notes || '', requestedBy: crew });
      inc.statusHistory.push({
        status: inc.status,
        ts,
        actor: crew,
        detail: 'Solicitud de apoyo: ' + type + (notes ? ' — ' + notes : '')
      });
      appendAudit(state, 'REQUEST_SUPPORT', { incidentId, unitId, supportType: type, notes: notes || '' }, crew);
      saveState(state);
      tryUpsert('incidents', { id: inc.id, status_history: inc.statusHistory });
      return JSON.parse(JSON.stringify(inc));
    },

    // ======================= BENEFICIOS =======================
    getVisibleBenefits(locality, dni) {
      const state = loadState();
      const lineBAllowedByOrg = () => state.organizations.some(o => o.lineBEnabled);
      const effectiveDni = dni || state.context.activeProfileDni;
      const profile = effectiveDni ? state.profiles[effectiveDni] : null;
      const plan = (profile && profile.plan) || C.DEFAULT_PLAN;
      return state.benefits
        .filter(b => SM.isBenefitVisibleToSocio(b))
        .filter(b => lineBAllowedByOrg())
        .filter(b => !locality || b.locality === locality)
        .filter(b => !Array.isArray(b.plans) || b.plans.indexOf(plan) !== -1)
        .map(b => ({
          id: b.id, name: b.name, category: b.category, locality: b.locality,
          benefitDetail: b.benefitDetail, agreementRef: b.agreementRef, validUntil: b.validUntil,
          status: b.status, plans: Array.isArray(b.plans) ? b.plans.slice() : C.PLAN_IDS.slice()
        }));
    },

    getAllBenefitsRaw() { return loadState().benefits.map(b => ({ ...b })); },

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
      appendAudit(state, 'UPDATE_BENEFIT_STATUS', { benefitId, from: prevStatus, to: newStatus, agreementRef: benefit.agreementRef, validUntil: benefit.validUntil, adminName: actor }, actor);
      saveState(state);
      tryUpsert('benefits', {
        id: benefit.id, name: benefit.name, category: benefit.category,
        locality: benefit.locality, benefit_detail: benefit.benefitDetail,
        agreement_ref: benefit.agreementRef, valid_until: benefit.validUntil,
        status: benefit.status, plans: benefit.plans
      });
      return { ...benefit };
    },

    // ======================= B2B =======================
    getB2BEstablishments(baseId) {
      const state = loadState();
      const list = baseId && baseId !== 'ALL' ? state.b2b_establishments.filter(e => e.baseId === baseId) : state.b2b_establishments.slice();
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
      if (!name || !type || !baseId || !address) throw new Error('Completá nombre, rubro, base asignada y dirección.');
      if (['DOLORES','LA_COSTA'].indexOf(baseId) === -1) throw new Error('Base asignada inválida.');
      const state = loadState();
      const isNew = !data.id;
      const tipo = C.UNIT_TYPES.indexOf(data.tipoUnidadRequerida) !== -1 ? data.tipoUnidadRequerida : 'COMUN';
      const record = {
        id: data.id || uid('b2b'), name, type, baseId, address,
        coords: data.coords || null,
        referencePhone: String(data.referencePhone || '').trim(),
        protocol: String(data.protocol || '').trim(),
        tipoUnidadRequerida: tipo,
        status: B2B_STATUSES.indexOf(data.status) !== -1 ? data.status : 'en_revision',
        createdAt: isNew ? nowISO() : (data.createdAt || nowISO())
      };
      if (isNew) state.b2b_establishments.push(record);
      else {
        const idx = state.b2b_establishments.findIndex(e => e.id === record.id);
        if (idx === -1) throw new Error('Establecimiento B2B no encontrado.');
        state.b2b_establishments[idx] = record;
      }
      appendAudit(state, isNew ? 'CREATE_B2B_ESTABLISHMENT' : 'UPDATE_B2B_ESTABLISHMENT', { b2bId: record.id, name: record.name, baseId: record.baseId, tipoUnidadRequerida: tipo }, actor);
      saveState(state);
      tryUpsert('b2b_establishments', {
        id: record.id, name: record.name, type: record.type, base_id: record.baseId,
        address: record.address, coords: record.coords, reference_phone: record.referencePhone,
        protocol: record.protocol, tipo_unidad_requerida: record.tipoUnidadRequerida,
        status: record.status, created_at: record.createdAt
      });
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
      tryUpsert('b2b_establishments', { id: est.id, status: est.status });
      return { ...est };
    },

    // ======================= SERVICIOS TERCERIZADOS =======================
    getExternalServicesConfig() {
      const cfg = loadState().external_services || {};
      return { medicoVirtualUrl: cfg.medicoVirtualUrl || '', seguroViajeroUrl: cfg.seguroViajeroUrl || '', updatedAt: cfg.updatedAt || null, updatedBy: cfg.updatedBy || null };
    },

    setExternalServicesConfig(payload, adminName) {
      const actor = requireAdmin(adminName);
      const state = loadState();
      const medico = String(payload && payload.medicoVirtualUrl || '').trim();
      const seguro = String(payload && payload.seguroViajeroUrl || '').trim();
      const isUrl = (s) => { if (!s) return true; try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (_) { return false; } };
      if (!isUrl(medico)) throw new Error('URL de Médico Virtual inválida (debe ser http/https).');
      if (!isUrl(seguro)) throw new Error('URL de Seguro al Viajero inválida (debe ser http/https).');
      state.external_services = { medicoVirtualUrl: medico, seguroViajeroUrl: seguro, updatedAt: nowISO(), updatedBy: actor };
      appendAudit(state, 'UPDATE_EXTERNAL_SERVICES', { medicoVirtualUrl: medico, seguroViajeroUrl: seguro }, actor);
      saveState(state);
      return this.getExternalServicesConfig();
    },

    // ======================= PAGOS =======================
    getPaymentConfig() {
      const cfg = loadState().payment_config || {};
      const cuotas = Object.assign({ BRONCE:'', PLATA:'', ORO:'', PLATINO:'' }, cfg.cuotas || {});
      return {
        mercadoPagoEnabled: !!cfg.mercadoPagoEnabled,
        mercadoPagoPublicKey: cfg.mercadoPagoPublicKey || '',
        cuotas,
        updatedAt: cfg.updatedAt || null,
        updatedBy: cfg.updatedBy || null
      };
    },

    setPaymentConfig(payload, adminName) {
      const actor = requireAdmin(adminName);
      const state = loadState();
      const cuotas = Object.assign({ BRONCE:'', PLATA:'', ORO:'', PLATINO:'' }, payload.cuotas || {});
      Object.keys(cuotas).forEach((k) => {
        const v = String(cuotas[k] || '').trim();
        if (v && !/^\d+(\.\d{1,2})?$/.test(v)) throw new Error('Cuota ' + k + ' inválida (número o vacío).');
        cuotas[k] = v;
      });
      state.payment_config = {
        mercadoPagoEnabled: !!payload.mercadoPagoEnabled,
        mercadoPagoPublicKey: String(payload.mercadoPagoPublicKey || '').trim(),
        cuotas,
        updatedAt: nowISO(),
        updatedBy: actor
      };
      appendAudit(state, 'UPDATE_PAYMENT_CONFIG', { mercadoPagoEnabled: state.payment_config.mercadoPagoEnabled, cuotas }, actor);
      saveState(state);
      return this.getPaymentConfig();
    },

    // ======================= ADMIN / RESET =======================
    clearAndResetDemo(adminName) {
      const actor = requireAdmin(adminName);
      const seed = buildSeed();
      seed.audit_logs.unshift({ id: uid('aud'), ts: nowISO(), action: 'CLEAR_AND_RESET_DEMO', payload: {}, actor });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now() });
      return seed;
    },

    getAuditLogs() { return loadState().audit_logs.map(l => ({ ...l })); },

    subscribe(callback) {
      if (!channel) {
        const handler = (e) => { if (e.key === STORAGE_KEY) callback({ type: 'STATE_CHANGED', ts: Date.now() }); };
        global.addEventListener('storage', handler);
        return () => global.removeEventListener('storage', handler);
      }
      const handler = (msg) => { callback(msg.data); };
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },

    _resetStore() {
      const seed = buildSeed();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now() });
      return seed;
    },

    _getState() { return loadState(); },

    calcCarnetStatus(dniOrProfile) {
      if (typeof dniOrProfile === 'string') {
        const p = this.getProfile(dniOrProfile);
        return p ? calcCarnetStatus(p) : 'vencido';
      }
      return calcCarnetStatus(dniOrProfile);
    },
    daysToExpire(dniOrProfile) {
      if (typeof dniOrProfile === 'string') {
        const p = this.getProfile(dniOrProfile);
        return p ? daysToExpire(p) : null;
      }
      return daysToExpire(dniOrProfile);
    },

    // ======================= SUPABASE API =======================
    configureSupabaseConnection(url, anonKey) {
      const u = String(url || '').trim();
      const k = String(anonKey || '').trim();
      try {
        if (u) global.localStorage.setItem('e360_supabase_url', u);
        else global.localStorage.removeItem('e360_supabase_url');
        if (k) global.localStorage.setItem('e360_supabase_anon_key', k);
        else global.localStorage.removeItem('e360_supabase_anon_key');
      } catch (_) {}
      initSupabaseBridge();
      return this.getSupabaseStatus();
    },

    getSupabaseStatus() {
      return {
        connected: supabaseBridge.connected,
        mode: supabaseBridge.mode,
        url: supabaseBridge.url,
        lastError: supabaseBridge.lastError
      };
    },

    async syncWithSupabase() {
      if (!supabaseBridge.connected || !supabaseBridge.client) {
        return { ok: false, error: 'Puente Supabase inactivo (LOCAL_MVP).' };
      }
      try {
        const state = loadState();
        // Push best-effort de perfiles e incidentes recientes.
        // No es un full-sync; es defensivo.
        const profiles = Object.keys(state.profiles).map(k => state.profiles[k]);
        const incidents = state.incidents.slice(0, 50);
        let pushed = 0;
        for (const p of profiles) {
          tryUpsert('profiles', {
            dni: p.dni, nombre: p.nombre, cuil: p.cuil || '',
            socio_number: p.socioNumber, plan: p.plan,
            base_id: p.baseId || state.context.activeBaseId,
            telefono: p.telefono || '', grupo_sanguineo: p.grupoSanguineo || '',
            alergias: p.alergias || '', patologias: p.patologias || '',
            contacto: p.contacto || '', family_group: p.familyGroup || [],
            carnet_token: p.carnetToken, pulsera_token: p.pulseraToken,
            pulsera_status: p.pulseraStatus, home_coords: p.homeCoords,
            home_address: p.homeAddress || '', updated_at: p.updatedAt
          });
          pushed++;
        }
        for (const i of incidents) {
          tryUpsert('incidents', {
            id: i.id, created_at: i.createdAt, base_id: i.baseId,
            status: i.status, priority: i.priority, assigned_unit_id: i.assignedUnitId,
            profile_dni: i.profileDni, location: i.location, manual_address: i.manualAddress,
            b2b_establishment_id: i.b2bEstablishmentId, source: i.source,
            status_history: i.statusHistory, clinical_notes: i.clinicalNotes,
            crew_notes: i.crewNotes, destination_center: i.destinationCenter,
            closure_reason: i.closureReason, outcome_notes: i.outcomeNotes,
            unit_location: i.unitLocation || null
          });
          pushed++;
        }
        return { ok: true, pushed };
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : 'Error en syncWithSupabase.' };
      }
    },

    _initSupabaseBridge: initSupabaseBridge
  };

  // Inicializar puente al cargar el store (defensivo: nunca lanza).
  try { initSupabaseBridge(); } catch (_) {}

  global.E360Store = E360Store;
})(typeof window !== 'undefined' ? window : globalThis);

/* ============================================================
   SQL DE REFERENCIA PARA SUPABASE (ejecutar manualmente)
   ------------------------------------------------------------
   Estas tablas NO existen todavía. Cuando las crees en el
   SQL Editor de Supabase, el puente se activará solo (lee
   URL+KEY de localStorage).

   IMPORTANTE: habilitar RLS en todas y definir políticas
   explícitas por rol (socio / admin / guardia). Con RLS off,
   la anon key es una puerta abierta.

   create table if not exists profiles (
     dni text primary key,
     nombre text, cuil text, socio_number text, plan text,
     base_id text, telefono text, grupo_sanguineo text,
     alergias text, patologias text, contacto text,
     family_group jsonb default '[]'::jsonb,
     carnet_token uuid, pulsera_token uuid,
     pulsera_status text, home_coords jsonb, home_address text,
     updated_at timestamptz default now()
   );
   alter table profiles enable row level security;

   create table if not exists incidents (
     id text primary key,
     created_at timestamptz default now(),
     base_id text, status text, priority text,
     assigned_unit_id text, profile_dni text,
     location jsonb, manual_address text,
     b2b_establishment_id text, source text,
     status_history jsonb default '[]'::jsonb,
     clinical_notes text, crew_notes text,
     destination_center text, closure_reason text,
     outcome_notes text, unit_location jsonb
   );
   alter table incidents enable row level security;

   create table if not exists benefits (
     id text primary key, name text, category text,
     locality text, benefit_detail text, agreement_ref text,
     valid_until text, status text, plans jsonb default '[]'::jsonb
   );
   alter table benefits enable row level security;

   create table if not exists b2b_establishments (
     id text primary key, name text, type text, base_id text,
     address text, coords jsonb, reference_phone text,
     protocol text, tipo_unidad_requerida text, status text,
     created_at timestamptz default now()
   );
   alter table b2b_establishments enable row level security;

   create table if not exists audit_logs (
     id text primary key, ts timestamptz default now(),
     action text, payload jsonb default '{}'::jsonb, actor text
   );
   alter table audit_logs enable row level security;
   ============================================================ */
