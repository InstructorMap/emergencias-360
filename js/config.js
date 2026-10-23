/* ============================================================
   config.js — Constantes y modo de la plataforma Emergencias 360
   Identidad EMP + Sello ASARI. Datos operativos reales.
   Cargado ANTES de state-machine.js y store.js en los 6 HTML.
   ============================================================ */

(function (global) {
  'use strict';

  const CONFIG = {
    // -------- Modo de la plataforma --------
    // 'LOCAL_MVP'      -> localStorage + BroadcastChannel (hoy)
    // 'SUPABASE_LIVE'  -> Supabase (futuro)
    MODE: 'LOCAL_MVP',

    // -------- Persistencia local --------
    STORAGE_KEY: 'e360_mvp_v4',
    STORAGE_VERSION: 4,
    CHANNEL_NAME: 'e360_mvp_channel',

    // -------- Timeouts y ergonomía --------
    SOS_HOLD_MS: 1500,
    GPS_TIMEOUT_MS: 8000,
    GPS_MAX_AGE_MS: 30000,
    AUDIT_MAX_ENTRIES: 2000,

    // -------- Marca oficial EMP --------
    BRAND: {
      NAME: 'EMP - Emergencias Médicas Privadas',
      SHORT: 'EMP',
      CLAIM: 'Más de 16 años brindando atención médica profesional. Emergencias Médicas Privadas las 24 Horas.',
      ASARI_LEGAL: 'Tecnología provista por ASARI S.A.S. — Proveedor Tecnológico. EMP - Emergencias Médicas Privadas es Prestador Operativo en Dolores y Partido de La Costa. Esta app NO sustituye al 107 / 911 / Bomberos.',
      PALETTE: {
        BLUE: '#3D5CA4',
        BLUE_DARK: '#0B3C78',
        BLUE_DEEP: '#1D4ED8',
        RED: '#FB0100',
        RED_DARK: '#DC2626',
        RED_ROSE: '#E11D48',
        BURGUNDY: '#740821',
        BLACK: '#000000',
        WHITE: '#FFFFFF',
        OFFWHITE: '#F8FAFC',
        GRAY: '#ACA3A1'
      }
    },

    // -------- Teléfonos de emergencia pública (fijos) --------
    EMERGENCY_PHONES: {
      SAME_107: '107',
      POLICE_911: '911',
      FIRE_100: '100'
    },

    // -------- Bases y datos operativos REALES --------
    // Dolores: J. Vucetich 88, Local 1
    // La Costa: Sucursal Santa Teresita — Partido de La Costa
    BASES: {
      DOLORES: {
        id: 'DOLORES',
        name: 'EMP Sede Dolores',
        address: 'J. Vucetich 88, Local 1 — Dolores',
        phone: '2245-444600',         // emergencias
        phoneAlt: '2245-444601',      // emergencias (alternativo)
        adminPhone: '2245-444602',    // administración
        whatsapp: '2245-406323',
        orgId: 'org_emp'
      },
      LA_COSTA: {
        id: 'LA_COSTA',
        name: 'EMP Sucursal Santa Teresita',
        address: 'Santa Teresita — Partido de La Costa',
        phone: '2246-529000',         // emergencias
        phoneAlt: null,
        adminPhone: '2246-526777',    // administración
        whatsapp: '2245-406323',
        orgId: 'org_emp'
      }
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

    CANCELABLE_FROM: [
      'RECIBIDA_SERVIDOR',
      'ACEPTADA_POR_CENTRAL',
      'CLASIFICADA',
      'MOVIL_ASIGNADO',
      'EN_CAMINO'
    ],

    CLOSABLE_FROM: ['EN_ESCENA', 'EN_TRASLADO'],

    PRIORITIES: ['ROJO', 'AMARILLO', 'VERDE'],

    UNIT_STATUS: {
      DISPONIBLE: 'disponible',
      ASIGNADO: 'asignado',
      EN_SALIDA: 'en_salida',
      MANTENIMIENTO: 'mantenimiento'
    },

    // Tipos de unidad (Etapa E los usará por establecimiento B2B)
    UNIT_TYPES: ['UTIM', 'PEDIATRICA_CON_INCUBADORA', 'TRASLADO_PROGRAMADO', 'COMUN'],

    BENEFIT_STATUSES: ['propuesto', 'en_negociacion', 'activo', 'suspendido', 'vencido'],

    BENEFIT_STATUSES_REQUIRING_REF: ['activo'],

    B2B_STATUSES: ['activo', 'en_revision', 'suspendido'],

    // -------- Servicios tercerizados (Médico Virtual / Seguro al viajero) --------
    // Las URLs se configuran desde el Panel Admin y se persisten en el store.
    // Estos son los defaults; el store guarda el valor efectivo.
    EXTERNAL_SERVICES_DEFAULTS: {
      medicoVirtualUrl: '',
      seguroViajeroUrl: ''
    },

    EXTERNAL_SERVICES_LABELS: {
      medicoVirtual: 'Médico Virtual (5 especialistas, 24/365)',
      seguroViajero: 'Seguro al Viajero'
    },

    EXTERNAL_SERVICES_DISCLAIMER: 'Servicios prestados por terceros. No son operados ni garantizados por ASARI S.A.S. ni por EMP - Emergencias Médicas Privadas.',

    // -------- Supabase (placeholder para Etapa F) --------
    SUPABASE: {
      URL: '',
      ANON_KEY: '',
      TABLES: {
        ORGANIZATIONS: 'organizations',
        BASES: 'bases',
        MOVILES: 'moviles',
        BENEFITS: 'benefits',
        B2B_ESTABLISHMENTS: 'b2b_establishments',
        PROFILES: 'profiles',
        INCIDENTS: 'incidents',
        AUDIT_LOGS: 'audit_logs',
        EXTERNAL_SERVICES: 'external_services'
      }
    },

    ROLES: {
      PLATFORM_OWNER: 'platform_owner',
      EMERGENCY_PROVIDER: 'emergency_provider'
    }
  };

  Object.freeze(CONFIG);
  Object.freeze(CONFIG.BRAND);
  Object.freeze(CONFIG.BRAND.PALETTE);
  Object.freeze(CONFIG.EMERGENCY_PHONES);
  Object.freeze(CONFIG.BASES);
  Object.freeze(CONFIG.BASES.DOLORES);
  Object.freeze(CONFIG.BASES.LA_COSTA);
  Object.freeze(CONFIG.INCIDENT_STATES);
  Object.freeze(CONFIG.TRANSITION_ORDER);
  Object.freeze(CONFIG.CANCELABLE_FROM);
  Object.freeze(CONFIG.CLOSABLE_FROM);
  Object.freeze(CONFIG.PRIORITIES);
  Object.freeze(CONFIG.UNIT_STATUS);
  Object.freeze(CONFIG.UNIT_TYPES);
  Object.freeze(CONFIG.BENEFIT_STATUSES);
  Object.freeze(CONFIG.B2B_STATUSES);
  Object.freeze(CONFIG.EXTERNAL_SERVICES_DEFAULTS);
  Object.freeze(CONFIG.EXTERNAL_SERVICES_LABELS);
  Object.freeze(CONFIG.ROLES);
  Object.freeze(CONFIG.SUPABASE);

  global.E360Config = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
