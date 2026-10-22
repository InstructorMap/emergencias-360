/* ============================================================
   config.js — Constantes y modo de la plataforma Emergencias 360
   Cargado ANTES de state-machine.js y store.js en los 4 HTML.
   ============================================================ */

(function (global) {
  'use strict';

  const CONFIG = {
    // -------- Modo de la plataforma --------
    // 'LOCAL_MVP'      -> localStorage + BroadcastChannel (hoy)
    // 'SUPABASE_LIVE'  -> Supabase (futuro, Entrega 4)
    MODE: 'LOCAL_MVP',

    // -------- Persistencia local --------
    STORAGE_KEY: 'e360_mvp_v3',
    STORAGE_VERSION: 3,
    CHANNEL_NAME: 'e360_mvp_channel',

    // -------- Timeouts y ergonomía --------
    SOS_HOLD_MS: 1500,
    GPS_TIMEOUT_MS: 8000,
    GPS_MAX_AGE_MS: 30000,
    AUDIT_MAX_ENTRIES: 2000,

    // -------- Catálogos --------
    BASES: {
      DOLORES: { id: 'DOLORES', name: 'EMP Base Dolores', phone: '02245431234' },
      LA_COSTA: { id: 'LA_COSTA', name: 'EMP Base Partido de La Costa', phone: '02246421234' }
    },

    INCIDENT_STATES: {
      RECIBIDA_SERVIDOR: 'RECIBIDA_SERVIDOR',
      ACEPTADA_POR_CENTRAL: 'ACEPTADA_POR_CENTRAL',
      CLASIFICADA: 'CLASIFICADA',
      MOVIL_ASIGNADO: 'MOVIL_ASIGNADO',
      EN_CAMINO: 'EN_CAMINO',
      EN_ESCENA: 'EN_ESCENA',
      EN_TRASLADO: 'EN_TRASLADO',
      CERRADA: 'CERRADA',
      CANCELADA: 'CANCELADA'
    },

    // Orden lineal de avance (sin ramificaciones). CANCELADA es terminal paralela.
    TRANSITION_ORDER: [
      'RECIBIDA_SERVIDOR',
      'ACEPTADA_POR_CENTRAL',
      'CLASIFICADA',
      'MOVIL_ASIGNADO',
      'EN_CAMINO',
      'EN_ESCENA',
      'EN_TRASLADO',
      'CERRADA'
    ],

    // Estados desde los que se permite cancelar (sin exigir cerrar)
    CANCELABLE_FROM: [
      'RECIBIDA_SERVIDOR',
      'ACEPTADA_POR_CENTRAL',
      'CLASIFICADA',
      'MOVIL_ASIGNADO',
      'EN_CAMINO'
    ],

    // Estados desde los que se permite cerrar (exige motivo + notas)
    CLOSABLE_FROM: ['EN_ESCENA', 'EN_TRASLADO'],

    PRIORITIES: ['ROJO', 'AMARILLO', 'VERDE'],

    UNIT_STATUS: {
      DISPONIBLE: 'disponible',
      ASIGNADO: 'asignado',
      EN_SALIDA: 'en_salida',
      MANTENIMIENTO: 'mantenimiento'
    },

    BENEFIT_STATUSES: ['propuesto', 'en_negociacion', 'activo', 'suspendido', 'vencido'],

    // Estados de prestador desde los que NO se puede saltar directo a "activo"
    BENEFIT_STATUSES_REQUIRING_REF: ['activo'],

    B2B_STATUSES: ['activo', 'en_revision', 'suspendido'],

    // -------- Supabase (placeholder para Entrega 4) --------
    SUPABASE: {
      URL: '',        // se completará cuando se conecte Supabase
      ANON_KEY: '',   // ídem
      TABLES: {
        ORGANIZATIONS: 'organizations',
        BASES: 'bases',
        MOVILES: 'moviles',
        BENEFITS: 'benefits',
        B2B_ESTABLISHMENTS: 'b2b_establishments',
        PROFILES: 'profiles',
        INCIDENTS: 'incidents',
        AUDIT_LOGS: 'audit_logs'
      }
    },

    // -------- Roles --------
    ROLES: {
      PLATFORM_OWNER: 'platform_owner',
      EMERGENCY_PROVIDER: 'emergency_provider'
    }
  };

  // Congelado para evitar mutaciones accidentales en runtime
  Object.freeze(CONFIG);
  Object.freeze(CONFIG.INCIDENT_STATES);
  Object.freeze(CONFIG.TRANSITION_ORDER);
  Object.freeze(CONFIG.CANCELABLE_FROM);
  Object.freeze(CONFIG.CLOSABLE_FROM);
  Object.freeze(CONFIG.PRIORITIES);
  Object.freeze(CONFIG.UNIT_STATUS);
  Object.freeze(CONFIG.BENEFIT_STATUSES);
  Object.freeze(CONFIG.B2B_STATUSES);
  Object.freeze(CONFIG.ROLES);
  Object.freeze(CONFIG.SUPABASE);

  global.E360Config = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
