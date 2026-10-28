/* ============================================================
   config.js — Constantes y modo de la plataforma Emergencias 360
   v6.1: EMP rediseño (azul/bordó/naranja) + planes extendidos
         + Supabase híbrido + altPhone/coords en bases.
         Sin romper API v6: mantiene flags viejos de PLANS.
   Cargado ANTES de state-machine.js, store.js y app-*.js.
   ============================================================ */

(function (global) {
  'use strict';

  const CONFIG = {
    MODE: 'LOCAL_MVP',

    STORAGE_KEY: 'e360_mvp_v6',
    STORAGE_VERSION: 6.1,
    CHANNEL_NAME: 'e360_mvp_channel',

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
        BLUE: '#0B3C78',
        BLUE_LIGHT: '#1E6091',
        BLUE_DEEP: '#1D4ED8',
        BURGUNDY: '#7A1C32',
        BURGUNDY_DARK: '#581122',
        BURGUNDY_ALT: '#881337',
        ORANGE: '#EA580C',
        ORANGE_BG: '#FFF3E0',
        SOS: '#DC2626',
        RED: '#FB0100',
        RED_DARK: '#DC2626',
        RED_ROSE: '#E11D48',
        BLACK: '#000000',
        WHITE: '#FFFFFF',
        OFFWHITE: '#F8FAFC',
        GRAY: '#ACA3A1'
      }
    },

    EMERGENCY_PHONES: { SAME_107: '107', POLICE_911: '911', FIRE_100: '100' },

    // -------- BASES EMP --------
    // Se mantienen phoneAlt (v6) y altPhone (v6.1) para compatibilidad.
    BASES: {
      DOLORES: {
        id: 'DOLORES',
        name: 'EMP Sede Dolores',
        address: 'Juan Vucetich 88 (Local 1), Dolores',
        phone: '2245-444600',
        phoneAlt: '2245-444601',
        altPhone: '2245-444601',
        adminPhone: '2245-444602',
        whatsapp: '2245-406323',
        whatsappIntl: '5492245406323',
        coords: { lat: -36.3133, lng: -56.6644 },
        orgId: 'org_emp'
      },
      LA_COSTA: {
        id: 'LA_COSTA',
        name: 'EMP Sucursal Santa Teresita (La Costa)',
        address: 'Santa Teresita, Partido de La Costa',
        phone: '2246-529000',
        phoneAlt: null,
        altPhone: null,
        adminPhone: '2246-526777',
        whatsapp: '2245-406323',
        whatsappIntl: '5492245406323',
        coords: { lat: -36.5286, lng: -56.6823 },
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

    TRANSITION_ORDER: ['RECIBIDA_SERVIDOR','ACEPTADA_POR_CENTRAL','CLASIFICADA','MOVIL_ASIGNADO','EN_CAMINO','EN_ESCENA','EN_TRASLADO','CERRADA'],
    CANCELABLE_FROM: ['RECIBIDA_SERVIDOR','ACEPTADA_POR_CENTRAL','CLASIFICADA','MOVIL_ASIGNADO','EN_CAMINO'],
    CLOSABLE_FROM: ['EN_ESCENA','EN_TRASLADO'],
    PRIORITIES: ['ROJO','AMARILLO','VERDE'],

    UNIT_STATUS: { DISPONIBLE:'disponible', ASIGNADO:'asignado', EN_SALIDA:'en_salida', MANTENIMIENTO:'mantenimiento' },
    UNIT_TYPES: ['UTIM','PEDIATRICA_CON_INCUBADORA','TRASLADO_PROGRAMADO','COMUN'],

    BENEFIT_STATUSES: ['propuesto','en_negociacion','activo','suspendido','vencido'],
    BENEFIT_STATUSES_REQUIRING_REF: ['activo'],
    B2B_STATUSES: ['activo','en_revision','suspendido'],

    // -------- PLANES DEL SOCIO (v6 + v6.1) --------
    // Se mantienen flags v6 (hasRemis/hasApp/hasTravel/hasVirtualDoc/hasPulsera/hasHomeButton)
    // y se agregan flags v6.1 (hasWheelchairTransfer/hasTelemedicine/hasTravelerAssistance/hasSosBracelet).
    PLANS: {
      BRONCE: {
        id: 'BRONCE', label: 'Bronce', order: 1,
        pharmacyDiscount: 20,
        pharmacyDiscountLabel: '20% med / 15% perf',
        hasRemis: false, hasApp: false, hasTravel: false, hasVirtualDoc: false, hasPulsera: false, hasHomeButton: false,
        hasWheelchairTransfer: false, hasTelemedicine: false, hasTravelerAssistance: false, hasSosBracelet: false,
        badgeColor: '#92400E'
      },
      PLATA: {
        id: 'PLATA', label: 'Plata', order: 2,
        pharmacyDiscount: 20,
        pharmacyDiscountLabel: '20% med / 15% perf',
        hasRemis: true, hasApp: false, hasTravel: false, hasVirtualDoc: false, hasPulsera: false, hasHomeButton: false,
        hasWheelchairTransfer: true, hasTelemedicine: false, hasTravelerAssistance: false, hasSosBracelet: false,
        badgeColor: '#475569'
      },
      ORO: {
        id: 'ORO', label: 'Oro', order: 3,
        pharmacyDiscount: 50,
        pharmacyDiscountLabel: '50% en medicamentos (según cartilla)',
        hasRemis: true, hasApp: true, hasTravel: true, hasVirtualDoc: true, hasPulsera: true, hasHomeButton: false,
        hasWheelchairTransfer: true, hasTelemedicine: true, hasTravelerAssistance: true, hasSosBracelet: false,
        badgeColor: '#B45309'
      },
      PLATINO: {
        id: 'PLATINO', label: 'Platino', order: 4,
        pharmacyDiscount: 50,
        pharmacyDiscountLabel: '50% en medicamentos (según cartilla)',
        hasRemis: true, hasApp: true, hasTravel: true, hasVirtualDoc: true, hasPulsera: true, hasHomeButton: true,
        hasWheelchairTransfer: true, hasTelemedicine: true, hasTravelerAssistance: true, hasSosBracelet: true,
        badgeColor: '#7A1C32'
      }
    },
    PLAN_IDS: ['BRONCE','PLATA','ORO','PLATINO'],
    DEFAULT_PLAN: 'BRONCE',

    // -------- CARNET DEL SOCIO --------
    SOCIO_PREFIX: 'EMP',
    SOCIO_DIGITS: 6,
    CARNET_VALIDITY_MONTHS: 12,
    CARNET_STATUSES: ['activo','vencido','suspendido'],
    CARNET_WARN_DAYS: 15,

    // -------- PULSERA SOS / BOTÓN DOMICILIARIO --------
    PULSERA_STATUSES: ['activo','inactivo'],
    PULSERA_DEFAULTS: { pulseraStatus:'inactivo', homeCoords:null, homeAddress:'' },
    PULSERA_QR_MAX_BYTES: 76,
    PULSERA_TOKEN_PREFIX: '',
    HOME_BUTTON_RADIUS_M: 150,

    // -------- PAGOS (placeholder Mercado Pago) --------
    PAYMENT_DEFAULTS: {
      mercadoPagoEnabled: false,
      mercadoPagoPublicKey: '',
      cuotas: { BRONCE:'', PLATA:'', ORO:'', PLATINO:'' },
      updatedAt: null,
      updatedBy: null
    },

    EXTERNAL_SERVICES_DEFAULTS: { medicoVirtualUrl:'', seguroViajeroUrl:'' },
    EXTERNAL_SERVICES_LABELS: {
      medicoVirtual: 'Médico Virtual (5 especialistas, 24/365)',
      seguroViajero: 'Seguro al Viajero'
    },
    EXTERNAL_SERVICES_DISCLAIMER: 'Servicios prestados por terceros. No son operados ni garantizados por ASARI S.A.S. ni por EMP - Emergencias Médicas Privadas.',

    // -------- SUPABASE (híbrido, inactivo hasta configurar) --------
    // El store lee de localStorage primero:
    //   localStorage.getItem('e360_supabase_url')
    //   localStorage.getItem('e360_supabase_anon_key')
    // Si están vacíos acá y en localStorage, el puente queda en LOCAL_MVP.
        // -------- SUPABASE (híbrido, lee de supabase.config.js) --------
    // Prioridad: window.E360SupabaseConfig > localStorage > vacío.
    // Si no hay URL/KEY, el puente queda en LOCAL_MVP.
    SUPABASE: (function () {
      var ext = (typeof window !== 'undefined' && window.E360SupabaseConfig) || {};
      var lsUrl = '';
      var lsKey = '';
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          lsUrl = window.localStorage.getItem('e360_supabase_url') || '';
          lsKey = window.localStorage.getItem('e360_supabase_anon_key') || '';
        }
      } catch (_) {}
      return {
        URL: String(ext.URL || lsUrl || '').trim(),
        ANON_KEY: String(ext.ANON_KEY || lsKey || '').trim(),
        TABLES: ext.TABLES || {}
      };
    })(),
    ROLES: { PLATFORM_OWNER:'platform_owner', EMERGENCY_PROVIDER:'emergency_provider' }
  };

  function deepFreeze(obj) {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
      Object.getOwnPropertyNames(obj).forEach((k) => deepFreeze(obj[k]));
      Object.freeze(obj);
    }
    return obj;
  }
  deepFreeze(CONFIG);

  global.E360Config = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
