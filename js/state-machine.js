/* ============================================================
   state-machine.js — Reglas puras de transición (sin side effects)
   Cargado ANTES de store.js. Consume E360Config.
   - Incidentes SOS: canTransition, getAllowedNextStates, etc.
   - Prestadores de beneficios: canTransitionBenefit, isVisibleToSocio
   - Móviles: canChangeUnitStatus
   - B2B: canTransitionB2B
   - Bases: canToggleBaseOperationalStatus
   ============================================================ */

(function (global) {
  'use strict';

  const C = global.E360Config;
  if (!C) {
    console.error('[state-machine] E360Config no disponible. Cargá config.js antes.');
    return;
  }

  const INC = C.INCIDENT_STATES;
  const UNIT = C.UNIT_STATUS;

  function idx(arr, v) { return arr.indexOf(v); }

  // ============================================================
  // INCIDENTES SOS
  // ============================================================

  /**
   * ¿Se puede pasar de fromStatus a toStatus?
   * Reglas:
   *  - CANCELADA: permitida desde CANCELABLE_FROM (no desde EN_ESCENA+, no desde terminales).
   *  - CERRADA: permitida solo desde CLOSABLE_FROM.
   *  - Resto: debe avanzar exactamente un paso en TRANSITION_ORDER.
   */
  function canTransitionIncident(fromStatus, toStatus) {
    if (!fromStatus || !toStatus) return { ok: false, reason: 'Estados vacíos.' };

    if (fromStatus === toStatus) {
      return { ok: false, reason: 'El incidente ya está en estado ' + fromStatus + '.' };
    }

    // Terminales: no se puede salir
    if (fromStatus === INC.CERRADA) {
      return { ok: false, reason: 'El incidente ya está CERRADO (terminal).' };
    }
    if (fromStatus === INC.CANCELADA) {
      return { ok: false, reason: 'El incidente ya está CANCELADO (terminal).' };
    }

    if (toStatus === INC.CANCELADA) {
      if (C.CANCELABLE_FROM.indexOf(fromStatus) === -1) {
        return {
          ok: false,
          reason: 'No se puede cancelar desde ' + fromStatus + '. Solo desde: ' + C.CANCELABLE_FROM.join(', ') + '.'
        };
      }
      return { ok: true };
    }

    if (toStatus === INC.CERRADA) {
      if (C.CLOSABLE_FROM.indexOf(fromStatus) === -1) {
        return {
          ok: false,
          reason: 'Solo se puede cerrar desde ' + C.CLOSABLE_FROM.join(' o ') + '. Estado actual: ' + fromStatus + '.'
        };
      }
      return { ok: true };
    }

    const fromIdx = idx(C.TRANSITION_ORDER, fromStatus);
    const toIdx = idx(C.TRANSITION_ORDER, toStatus);

    if (fromIdx === -1) return { ok: false, reason: 'Estado de origen inválido: ' + fromStatus };
    if (toIdx === -1) return { ok: false, reason: 'Estado destino inválido: ' + toStatus };

    if (toIdx !== fromIdx + 1) {
      return {
        ok: false,
        reason: 'Transición no permitida: ' + fromStatus + ' → ' + toStatus + '. Solo se avanza un paso.'
      };
    }

    return { ok: true };
  }

  /**
   * Devuelve la lista de estados a los que se puede transicionar desde currentStatus.
   */
  function getAllowedNextStatesIncident(currentStatus) {
    if (!currentStatus) return [];
    if (currentStatus === INC.CERRADA || currentStatus === INC.CANCELADA) return [];

    const allowed = [];
    const curIdx = idx(C.TRANSITION_ORDER, currentStatus);

    if (curIdx !== -1 && curIdx + 1 < C.TRANSITION_ORDER.length) {
      const nextLinear = C.TRANSITION_ORDER[curIdx + 1];
      // Si el siguiente es CERRADA, igual se permite (con closeIncident)
      allowed.push(nextLinear);
    }

    if (C.CANCELABLE_FROM.indexOf(currentStatus) !== -1) {
      allowed.push(INC.CANCELADA);
    }

    return allowed;
  }

  function isIncidentTerminal(status) {
    return status === INC.CERRADA || status === INC.CANCELADA;
  }

  // ============================================================
  // PRESTADORES DE BENEFICIOS
  // ============================================================

  /**
   * ¿Se puede cambiar benefit de fromStatus a toStatus?
   * Reglas:
   *  - toStatus debe ser un estado válido.
   *  - Si toStatus === 'activo': se exige agreementRef no vacío y != 'Pendiente de firma'.
   */
  function canTransitionBenefit(fromStatus, toStatus, agreementRef) {
    if (C.BENEFIT_STATUSES.indexOf(toStatus) === -1) {
      return { ok: false, reason: 'Estado de beneficio inválido: ' + toStatus };
    }
    if (fromStatus === toStatus) {
      return { ok: false, reason: 'El prestador ya está en estado ' + fromStatus + '.' };
    }
    if (C.BENEFIT_STATUSES_REQUIRING_REF.indexOf(toStatus) !== -1) {
      const ref = String(agreementRef || '').trim();
      if (!ref || ref.toLowerCase() === 'pendiente de firma') {
        return {
          ok: false,
          reason: 'Para activar el convenio se requiere N° de Convenio / Respaldo Documental verificable.'
        };
      }
    }
    return { ok: true };
  }

  /**
   * Regla innegociable del socio: solo ve prestadores activos con convenio válido.
   */
  function isBenefitVisibleToSocio(benefit) {
    if (!benefit) return false;
    if (benefit.status !== 'activo') return false;
    const ref = String(benefit.agreementRef || '').trim();
    if (!ref || ref.toLowerCase() === 'pendiente de firma') return false;
    return true;
  }

  // ============================================================
  // MÓVILES
  // ============================================================

  /**
   * ¿Se puede cambiar el estado del móvil?
   * Reglas:
   *  - Solo se permite alternar entre disponible y mantenimiento.
   *  - No se permite tocar un móvil asignado o en salida.
   */
  function canChangeUnitStatus(currentStatus, newStatus) {
    if (currentStatus === newStatus) {
      return { ok: false, reason: 'El móvil ya está en estado ' + currentStatus + '.' };
    }
    const allowed = [UNIT.DISPONIBLE, UNIT.MANTENIMIENTO];
    if (allowed.indexOf(newStatus) === -1) {
      return { ok: false, reason: 'Estado de móvil no permitido: ' + newStatus + '. Solo disponible|mantenimiento.' };
    }
    if (currentStatus === UNIT.ASIGNADO || currentStatus === UNIT.EN_SALIDA) {
      return { ok: false, reason: 'No se puede cambiar el estado de un móvil asignado o en salida.' };
    }
    return { ok: true };
  }

  // ============================================================
  // B2B
  // ============================================================

  function canTransitionB2B(fromStatus, toStatus) {
    if (C.B2B_STATUSES.indexOf(toStatus) === -1) {
      return { ok: false, reason: 'Estado B2B inválido: ' + toStatus };
    }
    if (fromStatus === toStatus) {
      return { ok: false, reason: 'El establecimiento ya está en estado ' + toStatus + '.' };
    }
    return { ok: true };
  }

  // ============================================================
  // BASES
  // ============================================================

  function canToggleBaseOperationalStatus(base) {
    if (!base) return { ok: false, reason: 'Base inexistente.' };
    return { ok: true };
  }

  // ============================================================
  // EXPORT
  // ============================================================
  global.E360StateMachine = {
    // Incidentes
    canTransitionIncident,
    getAllowedNextStatesIncident,
    isIncidentTerminal,
    // Beneficios
    canTransitionBenefit,
    isBenefitVisibleToSocio,
    // Móviles
    canChangeUnitStatus,
    // B2B
    canTransitionB2B,
    // Bases
    canToggleBaseOperationalStatus
  };
})(typeof window !== 'undefined' ? window : globalThis);
