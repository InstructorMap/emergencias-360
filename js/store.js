/* ============================================================
   E360Store v7 — Capa de datos con Supabase Auth + caché híbrido
   - API síncrona intacta (getProfile, getIncidents, etc.) para
     no romper app-socio, app-central, app-guardia, app-b2b, app-admin.
   - Mutaciones async internas con await a Supabase.
   - initSession() llena caché al login.
   - Offline: lee de localStorage si no hay red.
   - Medicación: getMedications, saveMedication, logDose, getDosesForDay.
   - Socio requests: submitSocioRequest, getSocioRequests, approveSocioRequest.
   - Alta socios: createSocio (Edge Function), bulkCreateSocios.
   - Realtime: supabase.channel('incidents') + BroadcastChannel.
   - Fallback: si Supabase no está configurado, cae a LOCAL_MVP.
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
  const CHANNEL_NAME = C.CHANNEL_NAME;
  const INCIDENT_STATES = C.INCIDENT_STATES;
  const UNIT_STATUS = C.UNIT_STATUS;
  const PRIORITIES = C.PRIORITIES;
  const BENEFIT_STATUSES = C.BENEFIT_STATUSES;
  const B2B_STATUSES = C.B2B_STATUSES;

  const CACHE_KEY = 'e360_cache_v7';
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

  const channel = (typeof BroadcastChannel !== 'undefined')
    ? new BroadcastChannel(CHANNEL_NAME) : null;

  // ============================================================
  // ESTADO INTERNO
  // ============================================================
  const state = {
    supabase: null,
    connected: false,
    mode: 'LOCAL_MVP',
    url: '',
    lastError: null,
    session: null,
    user: null,
    profile: null,
    profiles: [],       // lista de socios (para admin)
    incidents: [],
    fleet: [],
    bases: [],
    benefits: [],
    b2b: [],
    medications: [],
    doseLogs: [],
    socioRequests: [],
    auditLogs: [],
    context: { activeBaseId: 'DOLORES', platformMode: 'LOCAL_MVP' },
    lastSync: null
  };

  // ============================================================
  // HELPERS
  // ============================================================
  function nowISO() { return new Date().toISOString(); }
  function uid(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function addMonthsISO(iso, months) {
    const d = new Date(iso);
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day) d.setDate(0);
    return d.toISOString();
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
  function requireAdmin() {
    if (!state.profile || state.profile.role !== 'admin') {
      throw new Error('Se requieren permisos de administrador.');
    }
    return state.profile.nombre || state.profile.dni;
  }
  function requireUser() {
    if (!state.session || !state.profile) throw new Error('Debés iniciar sesión.');
    return state.profile;
  }

  // ============================================================
  // SUPABASE INIT
  // ============================================================
  function initSupabase() {
    const cfg = global.E360SupabaseConfig || {};
    const url = String(cfg.URL || '').trim();
    const anonKey = String(cfg.ANON_KEY || '').trim();
    state.url = url;
    if (!url || !anonKey) {
      state.connected = false;
      state.mode = 'LOCAL_MVP';
      return false;
    }
    if (!global.supabase || typeof global.supabase.createClient !== 'function') {
      state.connected = false;
      state.lastError = 'SDK Supabase no cargado.';
      return false;
    }
    try {
      state.supabase = global.supabase.createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      state.connected = true;
      state.mode = 'SUPABASE_LIVE';
      state.lastError = null;
      return true;
    } catch (e) {
      state.connected = false;
      state.lastError = e.message;
      return false;
    }
  }

  // ============================================================
  // CACHÉ LOCAL
  // ============================================================
  function saveCache() {
    try {
      const cache = {
        cachedAt: nowISO(),
        profile: state.profile,
        profiles: state.profiles,
        incidents: state.incidents.slice(0, 100),
        fleet: state.fleet,
        bases: state.bases,
        benefits: state.benefits,
        b2b: state.b2b,
        medications: state.medications,
        doseLogs: state.doseLogs,
        context: state.context
      };
      global.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (_) {}
  }

  function loadCache() {
    try {
      const raw = global.localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const cache = JSON.parse(raw);
      const age = Date.now() - new Date(cache.cachedAt).getTime();
      if (age > CACHE_TTL_MS) return false;
      state.profile = cache.profile || null;
      state.profiles = cache.profiles || [];
      state.incidents = cache.incidents || [];
      state.fleet = cache.fleet || [];
      state.bases = cache.bases || [];
      state.benefits = cache.benefits || [];
      state.b2b = cache.b2b || [];
      state.medications = cache.medications || [];
      state.doseLogs = cache.doseLogs || [];
      state.context = cache.context || state.context;
      return true;
    } catch (_) { return false; }
  }

  function clearCache() {
    try { global.localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  // ============================================================
  // MAPPERS (Supabase snake_case ↔ app camelCase)
  // ============================================================
  function mapProfileFromDB(p) {
    if (!p) return null;
    return {
      id: p.id,
      userId: p.user_id,
      nombre: p.nombre,
      dni: p.dni,
      cuil: p.cuil || '',
      plan: p.plan || 'BRONCE',
      baseId: p.base_id || 'DOLORES',
      filial: p.base_id || 'DOLORES',
      telefono: p.telefono || '',
      grupoSanguineo: p.grupo_sanguineo || '',
      alergias: p.alergias || '',
      patologias: p.patologias || '',
      contacto: p.contacto || '',
      cuota: p.cuota || '',
      role: p.role || 'socio',
      mustChangePassword: !!p.must_change_password,
      carnetToken: p.carnet_token,
      carnetStatus: p.carnet_status || 'activo',
      carnetValidUntil: p.carnet_valid_until,
      pulseraToken: p.pulsera_token,
      pulseraStatus: p.pulsera_status || 'inactivo',
      homeCoords: p.home_coords,
      homeAddress: p.home_address || '',
      familyGroup: p.family_group || [],
      orden: (p.family_group && p.family_group[0] && p.family_group[0].orden) || '00',
      socioNumber: p.dni ? ('EMP-' + String(p.dni).padStart(6, '0')) : null,
      createdAt: p.created_at,
      updatedAt: p.updated_at
    };
  }

  function mapIncidentFromDB(i) {
    if (!i) return null;
    return {
      id: i.id,
      createdAt: i.created_at,
      baseId: i.base_id,
      status: i.status,
      priority: i.priority,
      assignedUnitId: i.assigned_unit_id,
      profileDni: i.profile_dni,
      location: i.location,
      manualAddress: i.manual_address || '',
      b2bEstablishmentId: i.b2b_establishment_id,
      source: i.source,
      statusHistory: i.status_history || [],
      clinicalNotes: i.clinical_notes || '',
      crewNotes: i.crew_notes || '',
      destinationCenter: i.destination_center || '',
      closureReason: i.closure_reason || '',
      outcomeNotes: i.outcome_notes || '',
      unitLocation: i.unit_location
    };
  }

  function mapMedicationFromDB(m) {
    if (!m) return null;
    return {
      id: m.id,
      profileId: m.profile_id,
      nombre: m.nombre,
      dosis: m.dosis || '',
      frecuencia: m.frecuencia || '',
      horarios: m.horarios || [],
      activo: !!m.activo,
      notas: m.notas || '',
      createdAt: m.created_at,
      updatedAt: m.updated_at
    };
  }

  function mapDoseLogFromDB(d) {
    if (!d) return null;
    return {
      id: d.id,
      medicationId: d.medication_id,
      profileId: d.profile_id,
      scheduledAt: d.scheduled_at,
      takenAt: d.taken_at,
      status: d.status || 'pendiente',
      notas: d.notas || ''
    };
  }

  function mapBenefitFromDB(b) {
    return {
      id: b.id, name: b.name, category: b.category || '',
      locality: b.locality || '', benefitDetail: b.benefit_detail || '',
      agreementRef: b.agreement_ref || '', validUntil: b.valid_until || '',
      status: b.status || 'en_negociacion', plans: b.plans || []
    };
  }

  function mapB2BFromDB(e) {
    return {
      id: e.id, name: e.name, type: e.type || '', baseId: e.base_id || '',
      address: e.address || '', coords: e.coords || null,
      referencePhone: e.reference_phone || '', protocol: e.protocol || '',
      tipoUnidadRequerida: e.tipo_unidad_requerida || 'COMUN',
      status: e.status || 'en_revision', createdAt: e.created_at
    };
  }

  // ============================================================
  // AUTH
  // ============================================================
  async function login(dni, password) {
    if (!state.connected || !state.supabase) throw new Error('Supabase no configurado.');
    const dniStr = String(dni).replace(/\D/g, '');
    if (!dniStr) throw new Error('DNI inválido.');
    const email = `${dniStr}@emp.local`;
    const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('DNI o contraseña incorrectos.');
    state.session = data.session;
    state.user = data.user;
    await loadAllData();
    saveCache();
    return state.profile;
  }

  async function logout() {
    if (state.supabase) await state.supabase.auth.signOut();
    state.session = null;
    state.user = null;
    state.profile = null;
    state.profiles = [];
    state.incidents = [];
    state.medications = [];
    state.doseLogs = [];
    state.socioRequests = [];
    clearCache();
    if (channel) channel.postMessage({ type: 'AUTH_CHANGED', ts: Date.now() });
  }

  async function changePassword(newPassword) {
    if (!state.supabase) throw new Error('Supabase no configurado.');
    if (!newPassword || newPassword.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
    const { error } = await state.supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
    if (state.profile) {
      await state.supabase.from('profiles').update({ must_change_password: false }).eq('id', state.profile.id);
      state.profile.mustChangePassword = false;
      saveCache();
    }
    return true;
  }

  function getSession() {
    return state.session ? { ...state.session } : null;
  }

  function getUser() {
    return state.user ? { ...state.user } : null;
  }

  function isLoggedIn() {
    return !!(state.session && state.profile);
  }

  function isAdmin() {
    return !!(state.profile && state.profile.role === 'admin');
  }

  // ============================================================
  // CARGA MASIVA DE DATOS
  // ============================================================
  async function loadAllData() {
    if (!state.connected || !state.supabase) return;
    const sb = state.supabase;
    try {
      // Perfil propio
      const userId = state.user && state.user.id;
      if (userId) {
        const { data: profileData } = await sb.from('profiles').select('*').eq('user_id', userId).maybeSingle();
        if (profileData) state.profile = mapProfileFromDB(profileData);
      }

      // Bases (siempre del config, no de DB)
      state.bases = Object.keys(C.BASES).map(k => ({ ...C.BASES[k], isActive: true }));

      // Incidents: admin ve todos, socio ve los suyos (RLS)
      const { data: incidentsData } = await sb.from('incidents').select('*').order('created_at', { ascending: false }).limit(200);
      if (incidentsData) state.incidents = incidentsData.map(mapIncidentFromDB);

      // Benefits (público)
      const { data: benefitsData } = await sb.from('benefits').select('*');
      if (benefitsData) state.benefits = benefitsData.map(mapBenefitFromDB);

      // B2B (público)
      const { data: b2bData } = await sb.from('b2b_establishments').select('*');
      if (b2bData) state.b2b = b2bData.map(mapB2BFromDB);

      // Medicación (solo el socio propio)
      if (state.profile) {
        const { data: medsData } = await sb.from('medications').select('*').eq('profile_id', state.profile.id).eq('activo', true);
        if (medsData) state.medications = medsData.map(mapMedicationFromDB);

        const { data: dosesData } = await sb.from('dose_logs').select('*').eq('profile_id', state.profile.id).order('scheduled_at', { ascending: false }).limit(100);
        if (dosesData) state.doseLogs = dosesData.map(mapDoseLogFromDB);
      }

      // Admin: lista de socios + socio_requests
      if (state.profile && state.profile.role === 'admin') {
        const { data: profilesData } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
        if (profilesData) state.profiles = profilesData.map(mapProfileFromDB);

        const { data: reqData } = await sb.from('socio_requests').select('*').order('created_at', { ascending: false });
        if (reqData) state.socioRequests = reqData;
      }

      state.lastSync = nowISO();
    } catch (e) {
      state.lastError = e.message;
    }
  }

  // ============================================================
  // REALTIME
  // ============================================================
  function subscribeRealtime() {
    if (!state.connected || !state.supabase) return;
    try {
      state.supabase
        .channel('e360_incidents')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, async () => {
          const { data } = await state.supabase.from('incidents').select('*').order('created_at', { ascending: false }).limit(200);
          if (data) state.incidents = data.map(mapIncidentFromDB);
          if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now(), source: 'realtime' });
        })
        .subscribe();

      state.supabase
        .channel('e360_medications')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'medications' }, async () => {
          if (!state.profile) return;
          const { data } = await state.supabase.from('medications').select('*').eq('profile_id', state.profile.id).eq('activo', true);
          if (data) state.medications = data.map(mapMedicationFromDB);
          if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now(), source: 'realtime' });
        })
        .subscribe();
    } catch (_) {}
  }

  // ============================================================
  // API PÚBLICA
  // ============================================================
  const E360Store = {

    // ============ INIT ============
    async initSession() {
      initSupabase();
      if (!state.connected) {
        loadCache();
        return { loggedIn: false, mode: 'LOCAL_MVP' };
      }
      const { data } = await state.supabase.auth.getSession();
      if (data && data.session) {
        state.session = data.session;
        state.user = data.session.user;
        await loadAllData();
        subscribeRealtime();
        saveCache();
        return { loggedIn: true, profile: state.profile, mustChangePassword: !!(state.profile && state.profile.mustChangePassword) };
      }
      loadCache();
      return { loggedIn: false, mode: 'SUPABASE_LIVE' };
    },

    // ============ AUTH ============
    login,
    logout,
    changePassword,
    getSession,
    getUser,
    isLoggedIn,
    isAdmin,

    // ============ PERFILES ============
    getActiveProfile() {
      return state.profile ? { ...state.profile } : null;
    },

    getProfile(dni) {
      if (!state.profiles || !state.profiles.length) return null;
      const key = String(dni || '').trim();
      const found = state.profiles.find(p => p.dni === key);
      return found ? { ...found } : null;
    },

    listProfiles() {
      return state.profiles.map(p => ({ ...p }));
    },

    async saveProfile(data) {
      requireUser();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const update = {
        nombre: data.nombre,
        telefono: data.telefono || '',
        cuil: data.cuil || '',
        grupo_sanguineo: data.grupoSanguineo || '',
        alergias: data.alergias || '',
        patologias: data.patologias || '',
        contacto: data.contacto || ''
      };
      const { data: updated, error } = await state.supabase.from('profiles').update(update).eq('id', state.profile.id).select().single();
      if (error) throw new Error(error.message);
      state.profile = mapProfileFromDB(updated);
      saveCache();
      if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now() });
      return { ...state.profile };
    },

    async createSocio(data) {
      requireAdmin();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const { data: result, error } = await state.supabase.functions.invoke('create-socio', { body: data });
      if (error) throw new Error(error.message);
      if (result && result.error) throw new Error(result.error);
      await loadAllData();
      saveCache();
      return result;
    },

    async bulkCreateSocios(socios) {
      requireAdmin();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const { data: result, error } = await state.supabase.functions.invoke('bulk-create-socios', { body: { socios } });
      if (error) throw new Error(error.message);
      if (result && result.error) throw new Error(result.error);
      await loadAllData();
      saveCache();
      return result;
    },

    // ============ INCIDENTES ============
    getIncidents(filterBaseId) {
      let list = state.incidents.slice();
      if (filterBaseId && filterBaseId !== 'ALL') list = list.filter(i => i.baseId === filterBaseId);
      return list.map(i => ({ ...i }));
    },

    getIncidentById(id) {
      const inc = state.incidents.find(i => i.id === id);
      return inc ? { ...inc } : null;
    },

    getLatestIncident() {
      return state.incidents[0] ? { ...state.incidents[0] } : null;
    },

    getActiveIncidentForUnit(unitId) {
      const closed = ['CERRADA', 'CANCELADA'];
      const inc = state.incidents.find(i => i.assignedUnitId === unitId && closed.indexOf(i.status) === -1);
      return inc ? { ...inc } : null;
    },

    getIncidentEta(incidentId) {
      const disclaimer = 'Tiempo estimado de forma referencial (sujeto a tránsito y condiciones operativas).';
      const inc = state.incidents.find(i => i.id === incidentId);
      if (!inc) return { hasEta: false, etaMinutes: null, source: 'sin_incidente', disclaimer };
      const closed = ['CERRADA', 'CANCELADA'];
      if (closed.indexOf(inc.status) !== -1) return { hasEta: false, etaMinutes: null, source: 'incidente_cerrado', disclaimer };
      const origin = inc.unitLocation, dest = inc.location;
      if (!origin || !dest || typeof origin.lat !== 'number' || typeof dest.lat !== 'number') {
        return { hasEta: false, etaMinutes: null, source: 'sin_coordenadas', disclaimer };
      }
      const toRad = (x) => x * Math.PI / 180;
      const R = 6371;
      const dLat = toRad(dest.lat - origin.lat);
      const dLng = toRad(dest.lng - origin.lng);
      const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(origin.lat)) * Math.cos(toRad(dest.lat)) * Math.sin(dLng/2) ** 2;
      const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const etaMinutes = Math.max(1, Math.round((km / 40) * 60));
      return { hasEta: true, etaMinutes, source: 'haversine_40kmh', disclaimer };
    },

    async createSOSIncident(payload) {
      const dni = payload.profileDni || (state.profile && state.profile.dni);
      const id = uid('inc');
      const record = {
        id,
        base_id: state.context.activeBaseId,
        status: INCIDENT_STATES.RECIBIDA_SERVIDOR,
        priority: null,
        assigned_unit_id: null,
        profile_dni: dni,
        location: payload.location || null,
        manual_address: payload.manualAddress || '',
        b2b_establishment_id: payload.b2bEstablishmentId || null,
        source: payload.source || 'socio_app',
        status_history: [{ status: INCIDENT_STATES.RECIBIDA_SERVIDOR, ts: nowISO(), actor: payload.source || 'socio_app', detail: payload.detail || 'Alerta emitida.' }]
      };
      if (state.supabase && navigator.onLine) {
        const { data, error } = await state.supabase.from('incidents').insert(record).select().single();
        if (error) throw new Error(error.message);
        const mapped = mapIncidentFromDB(data);
        state.incidents.unshift(mapped);
        saveCache();
        if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now() });
        return mapped;
      } else {
        // Offline: encolar (simplificado: guardamos en caché y reintentamos al volver)
        const mapped = mapIncidentFromDB({ ...record, created_at: nowISO() });
        state.incidents.unshift(mapped);
        saveCache();
        return mapped;
      }
    },

    async transitionIncidentStatus(id, next) {
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const { data: current } = await state.supabase.from('incidents').select('*').eq('id', id).single();
      if (!current) throw new Error('Incidente no encontrado.');
      const check = SM.canTransitionIncident(current.status, next);
      if (!check.ok) throw new Error(check.reason);
      const newHistory = (current.status_history || []).concat([{ status: next, ts: nowISO(), actor: 'sistema', detail: 'Transición' }]);
      const { data, error } = await state.supabase.from('incidents').update({ status: next, status_history: newHistory }).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      const mapped = mapIncidentFromDB(data);
      const idx = state.incidents.findIndex(i => i.id === id);
      if (idx !== -1) state.incidents[idx] = mapped;
      saveCache();
      if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now() });
      return mapped;
    },

    async acknowledgeIncident(id, operatorName) { return this.transitionIncidentStatus(id, INCIDENT_STATES.ACEPTADA_POR_CENTRAL); },
    async dispatchIncidentUnit(id, operatorName) { return this.transitionIncidentStatus(id, INCIDENT_STATES.EN_CAMINO); },
    async markIncidentOnScene(id, operatorName) { return this.transitionIncidentStatus(id, INCIDENT_STATES.EN_ESCENA); },
    async markIncidentInTransit(id, dest, operatorName) {
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const { data: current } = await state.supabase.from('incidents').select('status, status_history').eq('id', id).single();
      const newHistory = (current.status_history || []).concat([{ status: INCIDENT_STATES.EN_TRASLADO, ts: nowISO(), actor: operatorName || 'central', detail: 'Derivación a ' + dest }]);
      const { data, error } = await state.supabase.from('incidents').update({ status: INCIDENT_STATES.EN_TRASLADO, destination_center: dest, status_history: newHistory }).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      const mapped = mapIncidentFromDB(data);
      const idx = state.incidents.findIndex(i => i.id === id);
      if (idx !== -1) state.incidents[idx] = mapped;
      saveCache();
      return mapped;
    },
    async closeIncident(id, reason, notes, operatorName) {
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const { data: current } = await state.supabase.from('incidents').select('status, status_history').eq('id', id).single();
      const newHistory = (current.status_history || []).concat([{ status: INCIDENT_STATES.CERRADA, ts: nowISO(), actor: operatorName || 'central', detail: 'Cierre: ' + reason }]);
      const { data, error } = await state.supabase.from('incidents').update({ status: INCIDENT_STATES.CERRADA, closure_reason: reason, outcome_notes: notes, status_history: newHistory }).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      const mapped = mapIncidentFromDB(data);
      const idx = state.incidents.findIndex(i => i.id === id);
      if (idx !== -1) state.incidents[idx] = mapped;
      saveCache();
      return mapped;
    },
    async cancelIncident(id, reason, operatorName) {
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const { data: current } = await state.supabase.from('incidents').select('status, status_history').eq('id', id).single();
      const newHistory = (current.status_history || []).concat([{ status: INCIDENT_STATES.CANCELADA, ts: nowISO(), actor: operatorName || 'central', detail: 'Cancelación: ' + reason }]);
      const { data, error } = await state.supabase.from('incidents').update({ status: INCIDENT_STATES.CANCELADA, closure_reason: reason, status_history: newHistory }).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      const mapped = mapIncidentFromDB(data);
      const idx = state.incidents.findIndex(i => i.id === id);
      if (idx !== -1) state.incidents[idx] = mapped;
      saveCache();
      return mapped;
    },
    async updateCrewPosition(id, coords, crewName) {
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const { error } = await state.supabase.from('incidents').update({ unit_location: { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy || 0, ts: nowISO(), actor: crewName } }).eq('id', id);
      if (error) throw new Error(error.message);
      return true;
    },

    // ============ FLOTA ============
    getFleet(baseId) {
      const cfg = C.BASES || {};
      const all = [
        { id:'mov_dol_01', baseId:'DOLORES', unit:'AMB-01', tipoUnidad:'UTIM', status:UNIT_STATUS.DISPONIBLE },
        { id:'mov_dol_02', baseId:'DOLORES', unit:'AMB-02', tipoUnidad:'COMUN', status:UNIT_STATUS.DISPONIBLE },
        { id:'mov_cos_01', baseId:'LA_COSTA', unit:'AMB-11', tipoUnidad:'UTIM', status:UNIT_STATUS.DISPONIBLE },
        { id:'mov_cos_02', baseId:'LA_COSTA', unit:'AMB-12', tipoUnidad:'PEDIATRICA_CON_INCUBADORA', status:UNIT_STATUS.DISPONIBLE }
      ];
      if (baseId && baseId !== 'ALL') return all.filter(m => m.baseId === baseId);
      return all;
    },

    getBases() {
      return Object.keys(C.BASES).map(k => ({ ...C.BASES[k], isActive: true }));
    },

    // ============ MEDICACIÓN ============
    getMedications() {
      return state.medications.map(m => ({ ...m }));
    },

    async saveMedication(data) {
      requireUser();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const record = {
        profile_id: state.profile.id,
        nombre: data.nombre,
        dosis: data.dosis || '',
        frecuencia: data.frecuencia || '',
        horarios: data.horarios || [],
        activo: data.activo !== false,
        notas: data.notas || ''
      };
      let result;
      if (data.id) {
        const { data: updated, error } = await state.supabase.from('medications').update(record).eq('id', data.id).select().single();
        if (error) throw new Error(error.message);
        result = updated;
        const idx = state.medications.findIndex(m => m.id === data.id);
        if (idx !== -1) state.medications[idx] = mapMedicationFromDB(result);
      } else {
        const { data: inserted, error } = await state.supabase.from('medications').insert(record).select().single();
        if (error) throw new Error(error.message);
        result = inserted;
        state.medications.push(mapMedicationFromDB(result));
      }
      saveCache();
      if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now() });
      return mapMedicationFromDB(result);
    },

    async deleteMedication(id) {
      requireUser();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const { error } = await state.supabase.from('medications').update({ activo: false }).eq('id', id);
      if (error) throw new Error(error.message);
      state.medications = state.medications.filter(m => m.id !== id);
      saveCache();
      return true;
    },

    async logDose(doseId, status, notas) {
      requireUser();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const update = {
        status: status || 'tomada',
        taken_at: status === 'tomada' ? nowISO() : null,
        notas: notas || ''
      };
      const { data, error } = await state.supabase.from('dose_logs').update(update).eq('id', doseId).select().single();
      if (error) throw new Error(error.message);
      const mapped = mapDoseLogFromDB(data);
      const idx = state.doseLogs.findIndex(d => d.id === doseId);
      if (idx !== -1) state.doseLogs[idx] = mapped;
      saveCache();
      return mapped;
    },

    getDosesForDay(dateISO) {
      const day = new Date(dateISO).toDateString();
      return state.doseLogs.filter(d => new Date(d.scheduledAt).toDateString() === day);
    },

    // ============ SOCIO REQUESTS ============
    async submitSocioRequest(data) {
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const record = {
        nombre: data.nombre,
        dni: String(data.dni || '').replace(/\D/g, ''),
        telefono: data.telefono || '',
        email: data.email || '',
        plan_interes: data.planInteres || '',
        localidad: data.localidad || '',
        mensaje: data.mensaje || ''
      };
      const { data: inserted, error } = await state.supabase.from('socio_requests').insert(record).select().single();
      if (error) throw new Error(error.message);
      return inserted;
    },

    getSocioRequests() {
      return state.socioRequests.map(r => ({ ...r }));
    },

    async approveSocioRequest(requestId, plan) {
      requireAdmin();
      const req = state.socioRequests.find(r => r.id === requestId);
      if (!req) throw new Error('Solicitud no encontrada.');
      const result = await this.createSocio({
        nombre: req.nombre,
        dni: req.dni,
        telefono: req.telefono,
        plan: plan || req.plan_interes || 'BRONCE',
        base_id: 'DOLORES',
        cuil: '',
        grupo_sanguineo: '',
        alergias: '',
        patologias: '',
        contacto: '',
        cuota: ''
      });
      if (state.supabase) {
        await state.supabase.from('socio_requests').update({ status: 'aprobada', reviewed_at: nowISO(), reviewed_by: state.profile.dni }).eq('id', requestId);
      }
      await loadAllData();
      saveCache();
      return result;
    },

    async rejectSocioRequest(requestId, motivo) {
      requireAdmin();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      await state.supabase.from('socio_requests').update({ status: 'rechazada', reviewed_at: nowISO(), reviewed_by: state.profile.dni, mensaje: (motivo || '') }).eq('id', requestId);
      await loadAllData();
      saveCache();
      return true;
    },

    // ============ BENEFICIOS ============
    getVisibleBenefits(locality) {
      const profile = state.profile;
      const plan = (profile && profile.plan) || C.DEFAULT_PLAN;
      return state.benefits
        .filter(b => SM.isBenefitVisibleToSocio(b))
        .filter(b => !locality || b.locality === locality)
        .filter(b => !Array.isArray(b.plans) || b.plans.indexOf(plan) !== -1);
    },

    getAllBenefitsRaw() { return state.benefits.map(b => ({ ...b })); },

    // ============ B2B ============
    getB2BEstablishments(baseId) {
      let list = state.b2b.slice();
      if (baseId && baseId !== 'ALL') list = list.filter(e => e.baseId === baseId);
      return list.map(e => ({ ...e }));
    },

    getB2BById(id) {
      const est = state.b2b.find(e => e.id === id);
      return est ? { ...est } : null;
    },

    // ============ CONTEXTO ============
    getActiveContext() {
      const baseId = state.context.activeBaseId || 'DOLORES';
      const base = state.bases.find(b => b.id === baseId) || C.BASES.DOLORES;
      return {
        activeBaseId: baseId,
        base: { ...base },
        platformMode: state.mode,
        organizations: [],
        activeProfileDni: state.profile ? state.profile.dni : null
      };
    },

    setActiveBase(baseId) {
      if (!C.BASES[baseId]) return false;
      state.context.activeBaseId = baseId;
      saveCache();
      return true;
    },

    // ============ STATUS ============
    getSupabaseStatus() {
      return {
        connected: state.connected,
        mode: state.mode,
        url: state.url,
        lastError: state.lastError,
        lastSync: state.lastSync
      };
    },

    // ============ SUBSCRIBE ============
    subscribe(callback) {
      if (!channel) {
        const handler = (e) => { if (e.key === CACHE_KEY) callback({ type: 'STATE_CHANGED', ts: Date.now() }); };
        global.addEventListener('storage', handler);
        return () => global.removeEventListener('storage', handler);
      }
      const handler = (msg) => callback(msg.data);
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },

    // ============ DEBUG ============
    _getState() { return state; },
    _reload: loadAllData,
    _saveCache: saveCache,
    _loadCache: loadCache,

    // ============ UTILS ============
    calcCarnetStatus,
    daysToExpire,
    INCIDENT_STATES, UNIT_STATUS, PRIORITIES, BENEFIT_STATUSES, B2B_STATUSES,
    PLAN_IDS: C.PLAN_IDS, PLANS: C.PLANS
  };

  global.E360Store = E360Store;
})(typeof window !== 'undefined' ? window : globalThis);
