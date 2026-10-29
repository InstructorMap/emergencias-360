/* ============================================================
   E360Store v8.1 — Supabase Auth + caché híbrido + público carnet/pulsera
   - loginWithEmail(email, password): login del admin por email
   - getPublicCarnetInfo / getPublicPulseraInfo
   - getIncidentsByDni, getMedicationsForProfile
   - submitRecategorizacion
   - getExternalServices / setExternalServices
   - getPaymentConfigPublic / getPaymentConfigAdmin / setPaymentConfig
   - getAuditLogs / getOrganizations / updateOrganizationFlags
   - getBranding / loadBranding / setBranding / uploadBrandingFile
   - API síncrona intacta (getProfile, getIncidents, etc.)
   - Offline: lee de localStorage con TTL 7 días.
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

  const CACHE_KEY = 'e360_cache_v8';
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  const channel = (typeof BroadcastChannel !== 'undefined')
    ? new BroadcastChannel(CHANNEL_NAME) : null;

  const state = {
    supabase: null,
    connected: false,
    mode: 'LOCAL_MVP',
    url: '',
    lastError: null,
    session: null,
    user: null,
    profile: null,
    profiles: [],
    incidents: [],
    myIncidents: [],
    fleet: [],
    bases: [],
    benefits: [],
    b2b: [],
    medications: [],
    medicationsByProfile: {},
    doseLogs: [],
    socioRequests: [],
    auditLogs: [],
    externalServices: { medicoVirtualUrl: '', seguroViajeroUrl: '' },
    paymentConfig: null,
    branding: null,
    context: { activeBaseId: 'DOLORES', platformMode: 'LOCAL_MVP' },
    lastSync: null
  };

  function nowISO() { return new Date().toISOString(); }
  function uid(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

  function calcCarnetStatus(p) {
    if (!p) return 'vencido';
    if (p.carnetStatus === 'suspendido') return 'suspendido';
    if (!p.carnetValidUntil) return 'vencido';
    return new Date(p.carnetValidUntil).getTime() > Date.now() ? 'activo' : 'vencido';
  }
  function daysToExpire(p) {
    if (!p || !p.carnetValidUntil) return null;
    return Math.ceil((new Date(p.carnetValidUntil).getTime() - Date.now()) / 86400000);
  }
  function requireAdmin() {
    if (!state.profile || state.profile.role !== 'admin') throw new Error('Se requieren permisos de administrador.');
    return state.profile.nombre || state.profile.dni;
  }
  function requireUser() {
    if (!state.session || !state.profile) throw new Error('Debés iniciar sesión.');
    return state.profile;
  }

  function initSupabase() {
    const cfg = global.E360SupabaseConfig || {};
    const url = String(cfg.URL || '').trim();
    const anonKey = String(cfg.ANON_KEY || '').trim();
    state.url = url;
    if (!url || !anonKey) { state.connected = false; state.mode = 'LOCAL_MVP'; return false; }
    if (!global.supabase || typeof global.supabase.createClient !== 'function') {
      state.connected = false; state.lastError = 'SDK Supabase no cargado.'; return false;
    }
    try {
      state.supabase = global.supabase.createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      state.connected = true; state.mode = 'SUPABASE_LIVE'; state.lastError = null;
      return true;
    } catch (e) {
      state.connected = false; state.lastError = e.message; return false;
    }
  }

  function saveCache() {
    try {
      const cache = {
        cachedAt: nowISO(),
        profile: state.profile,
        profiles: state.profiles,
        incidents: state.incidents.slice(0, 100),
        myIncidents: state.myIncidents.slice(0, 50),
        fleet: state.fleet,
        bases: state.bases,
        benefits: state.benefits,
        b2b: state.b2b,
        medications: state.medications,
        doseLogs: state.doseLogs,
        externalServices: state.externalServices,
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
      if (Date.now() - new Date(cache.cachedAt).getTime() > CACHE_TTL_MS) return false;
      state.profile = cache.profile || null;
      state.profiles = cache.profiles || [];
      state.incidents = cache.incidents || [];
      state.myIncidents = cache.myIncidents || [];
      state.fleet = cache.fleet || [];
      state.bases = cache.bases || [];
      state.benefits = cache.benefits || [];
      state.b2b = cache.b2b || [];
      state.medications = cache.medications || [];
      state.doseLogs = cache.doseLogs || [];
      state.externalServices = cache.externalServices || state.externalServices;
      state.context = cache.context || state.context;
      return true;
    } catch (_) { return false; }
  }
  function clearCache() {
    try { global.localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  // ============ MAPPERS ============
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
      id: i.id, createdAt: i.created_at, baseId: i.base_id, status: i.status,
      priority: i.priority, assignedUnitId: i.assigned_unit_id, profileDni: i.profile_dni,
      location: i.location, manualAddress: i.manual_address || '',
      b2bEstablishmentId: i.b2b_establishment_id, source: i.source,
      statusHistory: i.status_history || [], clinicalNotes: i.clinical_notes || '',
      crewNotes: i.crew_notes || '', destinationCenter: i.destination_center || '',
      closureReason: i.closure_reason || '', outcomeNotes: i.outcome_notes || '',
      unitLocation: i.unit_location
    };
  }
  function mapMedicationFromDB(m) {
    if (!m) return null;
    return {
      id: m.id, profileId: m.profile_id, nombre: m.nombre, dosis: m.dosis || '',
      frecuencia: m.frecuencia || '', horarios: m.horarios || [], activo: !!m.activo,
      notas: m.notas || '', createdAt: m.created_at, updatedAt: m.updated_at
    };
  }
  function mapDoseLogFromDB(d) {
    if (!d) return null;
    return {
      id: d.id, medicationId: d.medication_id, profileId: d.profile_id,
      scheduledAt: d.scheduled_at, takenAt: d.taken_at,
      status: d.status || 'pendiente', notas: d.notas || ''
    };
  }
  function mapBenefitFromDB(b) {
    return {
      id: b.id, name: b.name, category: b.category || '', locality: b.locality || '',
      benefitDetail: b.benefit_detail || '', agreementRef: b.agreement_ref || '',
      validUntil: b.valid_until || '', status: b.status || 'en_negociacion', plans: b.plans || []
    };
  }
  function mapB2BFromDB(e) {
    return {
      id: e.id, name: e.name, type: e.type || '', baseId: e.base_id || '',
      address: e.address || '', coords: e.coords || null, referencePhone: e.reference_phone || '',
      protocol: e.protocol || '', tipoUnidadRequerida: e.tipo_unidad_requerida || 'COMUN',
      status: e.status || 'en_revision', createdAt: e.created_at
    };
  }

  // ============ AUTH ============
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

  async function loginWithEmail(email, password) {
    if (!state.connected || !state.supabase) throw new Error('Supabase no configurado.');
    const emailStr = String(email || '').trim().toLowerCase();
    if (!emailStr || !emailStr.includes('@')) throw new Error('Email inválido.');
    const { data, error } = await state.supabase.auth.signInWithPassword({ email: emailStr, password });
    if (error) throw new Error('Email o contraseña incorrectos.');
    state.session = data.session;
    state.user = data.user;
    await loadAllData();
    saveCache();
    return state.profile;
  }

  async function logout() {
    if (state.supabase) await state.supabase.auth.signOut();
    state.session = null; state.user = null; state.profile = null;
    state.profiles = []; state.incidents = []; state.myIncidents = [];
    state.medications = []; state.doseLogs = []; state.socioRequests = [];
    clearCache();
    if (channel) channel.postMessage({ type: 'AUTH_CHANGED', ts: Date.now() });
  }

  async function changePassword(newPassword) {
    if (!state.supabase) throw new Error('Supabase no configurado.');
    if (!newPassword || newPassword.length < 6) throw new Error('Mínimo 6 caracteres.');
    const { error } = await state.supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
    if (state.profile) {
      await state.supabase.from('profiles').update({ must_change_password: false }).eq('id', state.profile.id);
      state.profile.mustChangePassword = false;
      saveCache();
    }
    return true;
  }

  // ============ CARGA ============
  async function loadAllData() {
    if (!state.connected || !state.supabase) return;
    const sb = state.supabase;
    try {
      const userId = state.user && state.user.id;
      if (userId) {
        const { data: p } = await sb.from('profiles').select('*').eq('user_id', userId).maybeSingle();
        if (p) state.profile = mapProfileFromDB(p);
      }

      state.bases = Object.keys(C.BASES).map(k => ({ ...C.BASES[k], isActive: true }));

      const { data: inc } = await sb.from('incidents').select('*').order('created_at', { ascending: false }).limit(200);
      if (inc) state.incidents = inc.map(mapIncidentFromDB);

      if (state.profile) {
        const { data: myInc } = await sb.from('incidents').select('*').eq('profile_dni', state.profile.dni).order('created_at', { ascending: false }).limit(50);
        if (myInc) state.myIncidents = myInc.map(mapIncidentFromDB);

        const { data: meds } = await sb.from('medications').select('*').eq('profile_id', state.profile.id).eq('activo', true);
        if (meds) state.medications = meds.map(mapMedicationFromDB);

        const { data: doses } = await sb.from('dose_logs').select('*').eq('profile_id', state.profile.id).order('scheduled_at', { ascending: false }).limit(100);
        if (doses) state.doseLogs = doses.map(mapDoseLogFromDB);
      }

      const { data: ben } = await sb.from('benefits').select('*');
      if (ben) state.benefits = ben.map(mapBenefitFromDB);

      const { data: b2b } = await sb.from('b2b_establishments').select('*');
      if (b2b) state.b2b = b2b.map(mapB2BFromDB);

      const { data: ext } = await sb.from('external_services').select('*').eq('id', 1).maybeSingle();
      if (ext) {
        state.externalServices = {
          medicoVirtualUrl: ext.medico_virtual_url || '',
          seguroViajeroUrl: ext.seguro_viajero_url || ''
        };
      }

      if (state.profile && state.profile.role === 'admin') {
        const { data: pay } = await sb.from('payment_config').select('*').eq('id', 1).maybeSingle();
        if (pay) state.paymentConfig = pay;
      } else {
        const { data: pay } = await sb.from('payment_config').select('mercado_pago_enabled, mercado_pago_public_key, cuota_bronce, cuota_plata, cuota_oro, cuota_platino').eq('id', 1).maybeSingle();
        if (pay) state.paymentConfig = pay;
      }

      if (state.profile && state.profile.role === 'admin') {
        const { data: profs } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
        if (profs) state.profiles = profs.map(mapProfileFromDB);

        const { data: reqs } = await sb.from('socio_requests').select('*').order('created_at', { ascending: false });
        if (reqs) state.socioRequests = reqs;
      }

      state.lastSync = nowISO();
    } catch (e) {
      state.lastError = e.message;
    }
  }

  // ============ REALTIME ============
  function subscribeRealtime() {
    if (!state.connected || !state.supabase) return;
    try {
      state.supabase.channel('e360_incidents')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, async () => {
          const { data } = await state.supabase.from('incidents').select('*').order('created_at', { ascending: false }).limit(200);
          if (data) state.incidents = data.map(mapIncidentFromDB);
          if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now(), source: 'realtime' });
        }).subscribe();

      state.supabase.channel('e360_medications')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'medications' }, async () => {
          if (!state.profile) return;
          const { data } = await state.supabase.from('medications').select('*').eq('profile_id', state.profile.id).eq('activo', true);
          if (data) state.medications = data.map(mapMedicationFromDB);
          if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now(), source: 'realtime' });
        }).subscribe();
    } catch (_) {}
  }

  // ============ API PÚBLICA ============
  const E360Store = {

    async initSession() {
      initSupabase();
      if (!state.connected) { loadCache(); return { loggedIn: false, mode: 'LOCAL_MVP' }; }
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

    login, loginWithEmail, logout, changePassword,
    getSession() { return state.session ? { ...state.session } : null; },
    getUser() { return state.user ? { ...state.user } : null; },
    isLoggedIn() { return !!(state.session && state.profile); },
    isAdmin() { return !!(state.profile && state.profile.role === 'admin'); },

    // ============ CARNET / PULSERA PÚBLICOS ============
    async getPublicCarnetInfo(token) {
      if (!state.connected || !state.supabase) throw new Error('Supabase no configurado.');
      const t = String(token || '').trim();
      if (!t) return null;
      const { data } = await state.supabase
        .from('profiles')
        .select('nombre, dni, plan, carnet_status, carnet_valid_until, carnet_token')
        .eq('carnet_token', t)
        .maybeSingle();
      if (!data) return null;
      const effective = (data.carnet_status === 'suspendido') ? 'suspendido'
        : (data.carnet_valid_until && new Date(data.carnet_valid_until).getTime() > Date.now()) ? 'activo' : 'vencido';
      return {
        nombre: data.nombre,
        socioNumber: data.dni ? ('EMP-' + String(data.dni).padStart(6, '0')) : null,
        plan: data.plan || 'BRONCE',
        planLabel: (C.PLANS[data.plan] && C.PLANS[data.plan].label) || data.plan,
        carnetStatus: effective,
        carnetValidUntil: data.carnet_valid_until,
        daysToExpire: data.carnet_valid_until ? Math.ceil((new Date(data.carnet_valid_until).getTime() - Date.now()) / 86400000) : null,
        dniMasked: data.dni ? ('••••' + String(data.dni).slice(-3)) : '—'
      };
    },

    async getPublicPulseraInfo(token) {
      if (!state.connected || !state.supabase) throw new Error('Supabase no configurado.');
      const t = String(token || '').trim();
      if (!t) return null;
      const { data } = await state.supabase
        .from('profiles')
        .select('id, nombre, dni, plan, telefono, grupo_sanguineo, alergias, patologias, contacto, pulsera_status, home_address, family_group')
        .eq('pulsera_token', t)
        .maybeSingle();
      if (!data) return null;
      const { data: meds } = await state.supabase
        .from('medications')
        .select('nombre, dosis, frecuencia, horarios, notas')
        .eq('profile_id', data.id)
        .eq('activo', true);
      const effective = (data.pulsera_status === 'activo') ? 'activo' : 'inactivo';
      return {
        nombre: data.nombre,
        dni: data.dni,
        socioNumber: data.dni ? ('EMP-' + String(data.dni).padStart(6, '0')) : null,
        plan: data.plan || 'BRONCE',
        planLabel: (C.PLANS[data.plan] && C.PLANS[data.plan].label) || data.plan,
        pulseraStatus: effective,
        telefono: data.telefono || '',
        grupoSanguineo: data.grupo_sanguineo || '',
        alergias: data.alergias || '',
        patologias: data.patologias || '',
        contacto: data.contacto || '',
        homeAddress: data.home_address || '',
        familyGroup: data.family_group || [],
        medications: (meds || []).map(m => ({
          nombre: m.nombre, dosis: m.dosis || '', frecuencia: m.frecuencia || '',
          horarios: m.horarios || [], notas: m.notas || ''
        }))
      };
    },

    // ============ PERFILES ============
    getActiveProfile() { return state.profile ? { ...state.profile } : null; },
    getProfile(dni) {
      const found = state.profiles.find(p => p.dni === String(dni || '').trim());
      return found ? { ...found } : null;
    },
    listProfiles() { return state.profiles.map(p => ({ ...p })); },

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

    async setProfilePlan(dni, plan, adminName) {
      requireAdmin();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      if (C.PLAN_IDS.indexOf(plan) === -1) throw new Error('Plan inválido.');
      const { data: updated, error } = await state.supabase.from('profiles').update({ plan }).eq('dni', dni).select().single();
      if (error) throw new Error(error.message);
      const mapped = mapProfileFromDB(updated);
      const idx = state.profiles.findIndex(p => p.dni === dni);
      if (idx !== -1) state.profiles[idx] = mapped;
      if (state.profile && state.profile.dni === dni) state.profile = mapped;
      saveCache();
      return mapped;
    },

    async setCarnetStatus(dni, status, adminName) {
      requireAdmin();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const { data: updated, error } = await state.supabase.from('profiles').update({ carnet_status: status }).eq('dni', dni).select().single();
      if (error) throw new Error(error.message);
      return mapProfileFromDB(updated);
    },

    async renewCarnet(dni, adminName) {
      requireAdmin();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const validUntil = new Date();
      validUntil.setFullYear(validUntil.getFullYear() + 1);
      const { data: updated, error } = await state.supabase.from('profiles').update({ carnet_status: 'activo', carnet_valid_until: validUntil.toISOString() }).eq('dni', dni).select().single();
      if (error) throw new Error(error.message);
      return mapProfileFromDB(updated);
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
    getLatestIncident() { return state.incidents[0] ? { ...state.incidents[0] } : null; },
    getMyIncidents() { return state.myIncidents.map(i => ({ ...i })); },
    getActiveIncidentForUnit(unitId) {
      const closed = ['CERRADA', 'CANCELADA'];
      const inc = state.incidents.find(i => i.assignedUnitId === unitId && closed.indexOf(i.status) === -1);
      return inc ? { ...inc } : null;
    },
    getIncidentEta(incidentId) {
      const disclaimer = 'Tiempo estimado de forma referencial.';
      const inc = state.incidents.find(i => i.id === incidentId);
      if (!inc) return { hasEta: false, etaMinutes: null, source: 'sin_incidente', disclaimer };
      if (['CERRADA','CANCELADA'].indexOf(inc.status) !== -1) return { hasEta: false, etaMinutes: null, source: 'cerrado', disclaimer };
      const o = inc.unitLocation, d = inc.location;
      if (!o || !d || typeof o.lat !== 'number' || typeof d.lat !== 'number') return { hasEta: false, etaMinutes: null, source: 'sin_coords', disclaimer };
      const toRad = x => x * Math.PI / 180;
      const dLat = toRad(d.lat - o.lat), dLng = toRad(d.lng - o.lng);
      const a = Math.sin(dLat/2)**2 + Math.cos(toRad(o.lat)) * Math.cos(toRad(d.lat)) * Math.sin(dLng/2)**2;
      const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return { hasEta: true, etaMinutes: Math.max(1, Math.round(km / 40 * 60)), source: 'haversine_40kmh', disclaimer };
    },

    async createSOSIncident(payload) {
      const dni = payload.profileDni || (state.profile && state.profile.dni);
      const id = uid('inc');
      const record = {
        id, base_id: state.context.activeBaseId,
        status: INCIDENT_STATES.RECIBIDA_SERVIDOR, priority: null, assigned_unit_id: null,
        profile_dni: dni, location: payload.location || null,
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
      const newHistory = (current.status_history || []).concat([{ status: next, ts: nowISO(), actor: state.profile ? state.profile.nombre : 'sistema', detail: 'Transición' }]);
      const { data, error } = await state.supabase.from('incidents').update({ status: next, status_history: newHistory }).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      const mapped = mapIncidentFromDB(data);
      const idx = state.incidents.findIndex(i => i.id === id);
      if (idx !== -1) state.incidents[idx] = mapped;
      saveCache();
      if (channel) channel.postMessage({ type: 'STATE_CHANGED', ts: Date.now() });
      return mapped;
    },
    async acknowledgeIncident(id, op) { return this.transitionIncidentStatus(id, INCIDENT_STATES.ACEPTADA_POR_CENTRAL); },
    async dispatchIncidentUnit(id, op) { return this.transitionIncidentStatus(id, INCIDENT_STATES.EN_CAMINO); },
    async markIncidentOnScene(id, op) { return this.transitionIncidentStatus(id, INCIDENT_STATES.EN_ESCENA); },
    async markIncidentInTransit(id, dest, op) {
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const { data: current } = await state.supabase.from('incidents').select('status, status_history').eq('id', id).single();
      const newHistory = (current.status_history || []).concat([{ status: INCIDENT_STATES.EN_TRASLADO, ts: nowISO(), actor: op || 'central', detail: 'Derivación a ' + dest }]);
      const { data, error } = await state.supabase.from('incidents').update({ status: INCIDENT_STATES.EN_TRASLADO, destination_center: dest, status_history: newHistory }).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      const mapped = mapIncidentFromDB(data);
      const idx = state.incidents.findIndex(i => i.id === id);
      if (idx !== -1) state.incidents[idx] = mapped;
      saveCache();
      return mapped;
    },
    async closeIncident(id, reason, notes, op) {
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const { data: current } = await state.supabase.from('incidents').select('status, status_history').eq('id', id).single();
      const newHistory = (current.status_history || []).concat([{ status: INCIDENT_STATES.CERRADA, ts: nowISO(), actor: op || 'central', detail: 'Cierre: ' + reason }]);
      const { data, error } = await state.supabase.from('incidents').update({ status: INCIDENT_STATES.CERRADA, closure_reason: reason, outcome_notes: notes, status_history: newHistory }).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      const mapped = mapIncidentFromDB(data);
      const idx = state.incidents.findIndex(i => i.id === id);
      if (idx !== -1) state.incidents[idx] = mapped;
      saveCache();
      return mapped;
    },
    async cancelIncident(id, reason, op) {
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const { data: current } = await state.supabase.from('incidents').select('status, status_history').eq('id', id).single();
      const newHistory = (current.status_history || []).concat([{ status: INCIDENT_STATES.CANCELADA, ts: nowISO(), actor: op || 'central', detail: 'Cancelación: ' + reason }]);
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
      const all = [
        { id:'mov_dol_01', baseId:'DOLORES', unit:'AMB-01', tipoUnidad:'UTIM', status:UNIT_STATUS.DISPONIBLE },
        { id:'mov_dol_02', baseId:'DOLORES', unit:'AMB-02', tipoUnidad:'COMUN', status:UNIT_STATUS.DISPONIBLE },
        { id:'mov_cos_01', baseId:'LA_COSTA', unit:'AMB-11', tipoUnidad:'UTIM', status:UNIT_STATUS.DISPONIBLE },
        { id:'mov_cos_02', baseId:'LA_COSTA', unit:'AMB-12', tipoUnidad:'PEDIATRICA_CON_INCUBADORA', status:UNIT_STATUS.DISPONIBLE }
      ];
      if (baseId && baseId !== 'ALL') return all.filter(m => m.baseId === baseId);
      return all;
    },
    getBases() { return Object.keys(C.BASES).map(k => ({ ...C.BASES[k], isActive: true })); },

    // ============ MEDICACIÓN ============
    getMedications() { return state.medications.map(m => ({ ...m })); },
    async getMedicationsForProfile(profileId) {
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const { data } = await state.supabase.from('medications').select('*').eq('profile_id', profileId).eq('activo', true);
      return (data || []).map(mapMedicationFromDB);
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
      const update = { status: status || 'tomada', taken_at: status === 'tomada' ? nowISO() : null, notas: notas || '' };
      const { data, error } = await state.supabase.from('dose_logs').update(update).eq('id', doseId).select().single();
      if (error) throw new Error(error.message);
      const mapped = mapDoseLogFromDB(data);
      const idx = state.doseLogs.findIndex(d => d.id === doseId);
      if (idx !== -1) state.doseLogs[idx] = mapped;
      saveCache();
      return mapped;
    },
    async scheduleDosesForMedication(medicationId, dateISO) {
      requireUser();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const med = state.medications.find(m => m.id === medicationId);
      if (!med) throw new Error('Medicación no encontrada.');
      const horarios = Array.isArray(med.horarios) ? med.horarios : [];
      if (!horarios.length) return [];
      const base = new Date(dateISO);
      const created = [];
      for (const h of horarios) {
        const [hh, mm] = String(h).split(':').map(Number);
        const dt = new Date(base);
        dt.setHours(hh || 0, mm || 0, 0, 0);
        const record = {
          medication_id: medicationId,
          profile_id: state.profile.id,
          scheduled_at: dt.toISOString(),
          status: 'pendiente'
        };
        const { data, error } = await state.supabase.from('dose_logs').insert(record).select().single();
        if (!error && data) created.push(mapDoseLogFromDB(data));
      }
      return created;
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
        mensaje: data.mensaje || '',
        tipo: data.tipo || 'adhesion',
        plan_actual: data.planActual || '',
        plan_solicitado: data.planSolicitado || ''
      };
      const { data: inserted, error } = await state.supabase.from('socio_requests').insert(record).select().single();
      if (error) throw new Error(error.message);
      return inserted;
    },
    async submitRecategorizacion(dni, planActual, planSolicitado, mensaje) {
      requireUser();
      return this.submitSocioRequest({
        nombre: state.profile.nombre, dni: dni || state.profile.dni,
        telefono: state.profile.telefono, planInteres: planSolicitado,
        planActual, planSolicitado, mensaje: mensaje || '',
        tipo: 'recategorizacion'
      });
    },
    getSocioRequests() { return state.socioRequests.map(r => ({ ...r })); },
    async approveSocioRequest(requestId, plan) {
      requireAdmin();
      const req = state.socioRequests.find(r => r.id === requestId);
      if (!req) throw new Error('Solicitud no encontrada.');
      const result = await this.createSocio({
        nombre: req.nombre, dni: req.dni, telefono: req.telefono,
        plan: plan || req.plan_solicitado || req.plan_interes || 'BRONCE',
        base_id: 'DOLORES', cuil: '', grupo_sanguineo: '',
        alergias: '', patologias: '', contacto: '', cuota: ''
      });
      await state.supabase.from('socio_requests').update({ status: 'aprobada', reviewed_at: nowISO(), reviewed_by: state.profile.dni }).eq('id', requestId);
      await loadAllData();
      saveCache();
      return result;
    },
    async rejectSocioRequest(requestId, motivo) {
      requireAdmin();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      await state.supabase.from('socio_requests').update({ status: 'rechazada', reviewed_at: nowISO(), reviewed_by: state.profile.dni, mensaje: motivo || '' }).eq('id', requestId);
      await loadAllData();
      saveCache();
      return true;
    },

    // ============ BENEFICIOS ============
    getVisibleBenefits(locality) {
      const plan = (state.profile && state.profile.plan) || C.DEFAULT_PLAN;
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

    // ============ SERVICIOS TERCERIZADOS ============
    getExternalServices() {
      return { ...state.externalServices };
    },
    async setExternalServices(data) {
      requireAdmin();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const record = {
        medico_virtual_url: data.medicoVirtualUrl || '',
        seguro_viajero_url: data.seguroViajeroUrl || '',
        updated_at: nowISO(),
        updated_by: state.profile.dni
      };
      const { data: updated, error } = await state.supabase.from('external_services').update(record).eq('id', 1).select().single();
      if (error) throw new Error(error.message);
      state.externalServices = {
        medicoVirtualUrl: updated.medico_virtual_url || '',
        seguroViajeroUrl: updated.seguro_viajero_url || ''
      };
      return { ...state.externalServices };
    },

    // ============ PAGOS ============
    getPaymentConfigPublic() {
      const p = state.paymentConfig;
      if (!p) return { mercadoPagoEnabled: false, mercadoPagoPublicKey: '', cuotas: { BRONCE:'', PLATA:'', ORO:'', PLATINO:'' } };
      return {
        mercadoPagoEnabled: !!p.mercado_pago_enabled,
        mercadoPagoPublicKey: p.mercado_pago_public_key || '',
        cuotas: {
          BRONCE: p.cuota_bronce || '',
          PLATA: p.cuota_plata || '',
          ORO: p.cuota_oro || '',
          PLATINO: p.cuota_platino || ''
        }
      };
    },
    getPaymentConfigAdmin() {
      requireAdmin();
      const p = state.paymentConfig || {};
      return {
        mercadoPagoEnabled: !!p.mercado_pago_enabled,
        mercadoPagoPublicKey: p.mercado_pago_public_key || '',
        mercadoPagoAccessToken: p.mercado_pago_access_token || '',
        cuotas: {
          BRONCE: p.cuota_bronce || '',
          PLATA: p.cuota_plata || '',
          ORO: p.cuota_oro || '',
          PLATINO: p.cuota_platino || ''
        },
        updatedAt: p.updated_at,
        updatedBy: p.updated_by
      };
    },
    async setPaymentConfig(data) {
      requireAdmin();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const record = {
        mercado_pago_enabled: !!data.mercadoPagoEnabled,
        mercado_pago_public_key: data.mercadoPagoPublicKey || '',
        mercado_pago_access_token: data.mercadoPagoAccessToken || '',
        cuota_bronce: data.cuotas && data.cuotas.BRONCE || '',
        cuota_plata: data.cuotas && data.cuotas.PLATA || '',
        cuota_oro: data.cuotas && data.cuotas.ORO || '',
        cuota_platino: data.cuotas && data.cuotas.PLATINO || '',
        updated_at: nowISO(),
        updated_by: state.profile.dni
      };
      const { data: updated, error } = await state.supabase.from('payment_config').update(record).eq('id', 1).select().single();
      if (error) throw new Error(error.message);
      state.paymentConfig = updated;
      return this.getPaymentConfigAdmin();
    },

    // ============ AUDITORÍA ============
    async getAuditLogs() {
      if (!state.connected || !state.supabase) {
        return (state.auditLogs || []).map(l => ({ ...l }));
      }
      try {
        const { data } = await state.supabase.from('audit_logs').select('*').order('ts', { ascending: false }).limit(200);
        if (data) state.auditLogs = data;
        return (state.auditLogs || []).map(l => ({ ...l }));
      } catch (_) {
        return (state.auditLogs || []).map(l => ({ ...l }));
      }
    },

    // ============ ORGANIZACIONES ============
    getOrganizations() {
      return [
        { id: 'org_asari', name: 'ASARI S.A.S.', role: 'platform_owner', lineAEnabled: true, lineBEnabled: true },
        { id: 'org_emp', name: 'EMP - Emergencias Médicas Privadas', role: 'emergency_provider', lineAEnabled: true, lineBEnabled: true }
      ];
    },

    async updateOrganizationFlags(orgId, lineA, lineB, adminName) {
      requireAdmin();
      if (state.supabase) {
        try {
          await state.supabase.from('audit_logs').insert({
            id: uid('aud'),
            action: 'UPDATE_ORG_FLAGS',
            payload: { orgId, lineA: !!lineA, lineB: !!lineB },
            actor: adminName || state.profile.dni
          });
        } catch (_) {}
      }
      return { id: orgId, lineAEnabled: !!lineA, lineBEnabled: !!lineB };
    },

    // ============ CONTEXTO ============
    getActiveContext() {
      const baseId = state.context.activeBaseId || 'DOLORES';
      const base = state.bases.find(b => b.id === baseId) || C.BASES.DOLORES;
      return {
        activeBaseId: baseId, base: { ...base }, platformMode: state.mode,
        organizations: [], activeProfileDni: state.profile ? state.profile.dni : null
      };
    },
    setActiveBase(baseId) {
      if (!C.BASES[baseId]) return false;
      state.context.activeBaseId = baseId;
      saveCache();
      return true;
    },

    getSupabaseStatus() {
      return { connected: state.connected, mode: state.mode, url: state.url, lastError: state.lastError, lastSync: state.lastSync };
    },

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

    _getState() { return state; },
    _reload: loadAllData,
    calcCarnetStatus, daysToExpire,
    INCIDENT_STATES, UNIT_STATUS, PRIORITIES, BENEFIT_STATUSES, B2B_STATUSES,

    // ============ BRANDING ============
    getBranding() {
      try {
        const raw = global.localStorage.getItem('e360_branding');
        if (raw) {
          const parsed = JSON.parse(raw);
          const age = Date.now() - new Date(parsed.cachedAt).getTime();
          if (age < 24 * 60 * 60 * 1000) return { ...parsed.data };
        }
      } catch (_) {}
      return {
        logoUrl: '',
        logoDarkUrl: '',
        faviconUrl: '',
        colorPrimary: '#0B3C78',
        colorSecondary: '#7A1C32',
        colorAccent: '#EA580C',
        colorSos: '#DC2626'
      };
    },

    async loadBranding() {
      if (!state.connected || !state.supabase) {
        return this.getBranding();
      }
      try {
        const { data } = await state.supabase.from('branding').select('*').eq('id', 1).maybeSingle();
        if (!data) return this.getBranding();
        const branding = {
          logoUrl: data.logo_url || '',
          logoDarkUrl: data.logo_dark_url || '',
          faviconUrl: data.favicon_url || '',
          colorPrimary: data.color_primary || '#0B3C78',
          colorSecondary: data.color_secondary || '#7A1C32',
          colorAccent: data.color_accent || '#EA580C',
          colorSos: data.color_sos || '#DC2626'
        };
        try {
          global.localStorage.setItem('e360_branding', JSON.stringify({ cachedAt: new Date().toISOString(), data: branding }));
        } catch (_) {}
        state.branding = branding;
        return { ...branding };
      } catch (_) {
        return this.getBranding();
      }
    },

    async setBranding(data) {
      requireAdmin();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      const record = {
        logo_url: data.logoUrl || '',
        logo_dark_url: data.logoDarkUrl || '',
        favicon_url: data.faviconUrl || '',
        color_primary: data.colorPrimary || '#0B3C78',
        color_secondary: data.colorSecondary || '#7A1C32',
        color_accent: data.colorAccent || '#EA580C',
        color_sos: data.colorSos || '#DC2626',
        updated_at: nowISO(),
        updated_by: state.profile.dni
      };
      const { data: updated, error } = await state.supabase.from('branding').update(record).eq('id', 1).select().single();
      if (error) throw new Error(error.message);
      try {
        global.localStorage.removeItem('e360_branding');
      } catch (_) {}
      return this.loadBranding();
    },

    async uploadBrandingFile(file, tipo) {
      requireAdmin();
      if (!state.supabase) throw new Error('Supabase no configurado.');
      if (!file) throw new Error('No se seleccionó archivo.');
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const fileName = `${tipo}_${Date.now()}.${ext}`;
      const { data, error } = await state.supabase.storage
        .from('branding')
        .upload(fileName, file, { cacheControl: '3600', upsert: false });
      if (error) throw new Error(error.message);
      const { data: urlData } = state.supabase.storage.from('branding').getPublicUrl(fileName);
      return urlData.publicUrl;
    },
  };

  global.E360Store = E360Store;
})(typeof window !== 'undefined' ? window : globalThis);
