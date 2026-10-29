/* ============================================================
   capacitor-bridge.js — Puente entre la app web y Capacitor
   - Detecta si corre en Capacitor (APK nativa)
   - Si es así, expone funciones para programar notificaciones
     locales de medicación con @capacitor/local-notifications
   - Si no, no hace nada (la app web sigue funcionando igual)
   ============================================================ */

(function (global) {
  'use strict';

  const isNative = global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function'
    ? global.Capacitor.isNativePlatform()
    : false;

  if (!isNative) {
    global.E360Capacitor = { isNative: false, available: false };
    return;
  }

  const LN = global.Capacitor.Plugins && global.Capacitor.Plugins.LocalNotifications;
  if (!LN) {
    console.warn('[capacitor-bridge] LocalNotifications no disponible.');
    global.E360Capacitor = { isNative: true, available: false };
    return;
  }

  let channelReady = false;

  async function ensureChannel() {
    if (channelReady) return;
    try {
      await LN.createChannel({
        id: 'medicacion',
        name: 'Recordatorios de medicación',
        description: 'Avisos para tomar tus medicamentos',
        importance: 5,
        visibility: 1,
        vibration: true
      });
      channelReady = true;
    } catch (e) {
      console.warn('[capacitor-bridge] Error creando canal:', e);
    }
  }

  async function requestPermissions() {
    try {
      const perm = await LN.requestPermissions();
      if (perm.display !== 'granted') {
        return { granted: false, reason: 'Permiso de notificaciones denegado.' };
      }

      // Android 12+: verificar permiso de alarmas exactas
      if (global.Capacitor.getPlatform && global.Capacitor.getPlatform() === 'android') {
        try {
          const exact = await LN.checkExactNotificationSetting();
          if (exact.exact_alarm !== 'granted') {
            const changed = await LN.changeExactNotificationSetting();
            if (changed.exact_alarm !== 'granted') {
              return {
                granted: true,
                exactAlarm: false,
                reason: 'Notificaciones permitidas, pero las alarmas exactas están desactivadas. Los recordatorios pueden atrasarse unos minutos.'
              };
            }
          }
        } catch (e) {
          console.warn('[capacitor-bridge] No se pudo verificar exact_alarm:', e);
        }
      }

      return { granted: true, exactAlarm: true };
    } catch (e) {
      return { granted: false, reason: e.message || 'Error al pedir permisos.' };
    }
  }

  // Convierte "08:30" a { hour: 8, minute: 30 }
  function parseHorario(h) {
    const [hh, mm] = String(h || '').split(':').map(Number);
    if (!isFinite(hh) || !isFinite(mm)) return null;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return { hour: hh, minute: mm };
  }

  // Genera un ID numérico estable a partir del ID de la medicación y el índice de horario
  function notifId(medId, idx) {
    let hash = 0;
    const s = String(medId) + '_' + idx;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 2147483647;
  }

  async function scheduleMedicationReminders(med) {
    if (!med || !med.id || !Array.isArray(med.horarios) || !med.horarios.length) {
      return { ok: true, scheduled: 0 };
    }

    await ensureChannel();

    const notifications = [];
    med.horarios.forEach((h, idx) => {
      const time = parseHorario(h);
      if (!time) return;
      notifications.push({
        id: notifId(med.id, idx),
        title: '💊 Recordatorio de medicación',
        body: `Es hora de tomar: ${med.nombre}${med.dosis ? ' — ' + med.dosis : ''}`,
        schedule: {
          on: { hour: time.hour, minute: time.minute },
          repeats: true,
          allowWhileIdle: true
        },
        channelId: 'medicacion',
        smallIcon: 'ic_stat_icon_config_sample',
        autoCancel: false,
        ongoing: false,
        extra: { medicationId: med.id, horario: h }
      });
    });

    if (!notifications.length) return { ok: true, scheduled: 0 };

    try {
      // Cancelar las anteriores de esta medicación antes de reprogramar
      await cancelMedicationReminders(med.id);
      const result = await LN.schedule({ notifications });
      return { ok: true, scheduled: result.notifications ? result.notifications.length : notifications.length };
    } catch (e) {
      console.warn('[capacitor-bridge] Error programando recordatorios:', e);
      return { ok: false, error: e.message };
    }
  }

  async function cancelMedicationReminders(medId) {
    if (!medId) return;
    try {
      const pending = await LN.getPending();
      const toCancel = (pending.notifications || []).filter(n => {
        const extra = n.extra || {};
        return extra.medicationId === medId;
      }).map(n => ({ id: n.id }));
      if (toCancel.length) {
        await LN.cancel({ notifications: toCancel });
      }
    } catch (e) {
      console.warn('[capacitor-bridge] Error cancelando recordatorios:', e);
    }
  }

  async function getScheduledCount() {
    try {
      const pending = await LN.getPending();
      return (pending.notifications || []).length;
    } catch (_) { return 0; }
  }

  global.E360Capacitor = {
    isNative: true,
    available: true,
    requestPermissions,
    scheduleMedicationReminders,
    cancelMedicationReminders,
    getScheduledCount
  };
})(typeof window !== 'undefined' ? window : globalThis);
