/* ============================================================
   capacitor-bridge.js v8.4 — Puente Capacitor (F1 + C1 + F2)
   - F1: scheduleMedicationReminders con smallIcon configurable
     y fallback si el ícono no existe (fix notificaciones)
   - F1: ensureNotificationPermission() al arrancar
   - C1: showLocalNotification sin smallIcon hardcodeado
   - F2: registerPushToken con @capacitor-firebase/messaging
   ============================================================ */

(function (global) {
  'use strict';

  const isNative = !!(
    global.Capacitor &&
    typeof global.Capacitor.isNativePlatform === 'function' &&
    global.Capacitor.isNativePlatform()
  );

  if (!isNative) {
    global.E360Capacitor = {
      isNative: false,
      available: false,
      requestPermissions: async function () {
        return { granted: false, reason: 'No es entorno nativo Capacitor.' };
      },
      ensureNotificationPermission: async function () {
        return { granted: false, reason: 'No es entorno nativo Capacitor.' };
      },
      scheduleMedicationReminders: async function () {
        return { ok: false, scheduled: 0, reason: 'web_mode' };
      },
      cancelMedicationReminders: async function () {},
      getScheduledCount: async function () { return 0; },
      showLocalNotification: async function () { return false; },
      registerPushToken: async function () {
        return { ok: false, error: 'Push FCM nativo solo disponible en APK Android.' };
      }
    };
    return;
  }

  const Plugins = (global.Capacitor && global.Capacitor.Plugins) || {};
  const LN = Plugins.LocalNotifications || null;
  const App = Plugins.App || null;

  let channelsReady = false;
  let pushListenersBound = false;

  // Ícono de notificación: si el proyecto no tiene un drawable propio,
  // Android usa el ícono de la app. Evitamos hardcodear uno que no exista.
  // Si tenés un drawable propio, cambialo acá (ej: 'ic_stat_emp').
  const SMALL_ICON = null; // null = usar el ícono por defecto de la app

  async function ensureChannels() {
    if (channelsReady || !LN || typeof LN.createChannel !== 'function') return;
    try {
      await LN.createChannel({
        id: 'medicacion',
        name: 'Recordatorios de medicación',
        description: 'Avisos programados para tomar tus medicamentos',
        importance: 5,
        visibility: 1,
        vibration: true
      });
    } catch (e) {
      console.warn('[capacitor-bridge] Error creando canal medicacion:', e);
    }

    try {
      await LN.createChannel({
        id: 'emp_sos_channel',
        name: 'Alertas SOS de Emergencia EMP',
        description: 'Canal crítico de despacho y alertas SOS entrantes',
        importance: 5,
        visibility: 1,
        vibration: true,
        lights: true
      });
      channelsReady = true;
    } catch (e) {
      console.warn('[capacitor-bridge] Error creando canal emp_sos_channel:', e);
    }
  }

  async function openExactAlarmSettings() {
    if (!global.Capacitor.getPlatform || global.Capacitor.getPlatform() !== 'android') return false;
    if (!LN) return false;

    try {
      if (typeof LN.changeExactNotificationSetting === 'function') {
        const recheck = await LN.changeExactNotificationSetting();
        if (recheck && recheck.exact_alarm === 'granted') return true;
      }
    } catch (e) {
      console.warn('[capacitor-bridge] changeExactNotificationSetting falló:', e);
    }

    if (App && typeof App.openSettings === 'function') {
      try {
        await App.openSettings();
        return false;
      } catch (e) {
        console.warn('[capacitor-bridge] App.openSettings falló:', e);
      }
    }

    return false;
  }

  async function requestPermissions() {
    if (!LN) return { granted: false, reason: 'Plugin LocalNotifications no disponible.' };
    try {
      const perm = await LN.requestPermissions();
      if (perm.display !== 'granted') {
        return { granted: false, reason: 'Permiso de notificaciones denegado.' };
      }

      if (global.Capacitor.getPlatform && global.Capacitor.getPlatform() === 'android') {
        try {
          const exact = await LN.checkExactNotificationSetting();
          if (!exact || exact.exact_alarm !== 'granted') {
            const granted = await openExactAlarmSettings();
            if (granted) {
              return { granted: true, exactAlarm: true };
            }
            return {
              granted: true,
              exactAlarm: false,
              reason: 'Notificaciones permitidas, pero las alarmas exactas están desactivadas. Activá "Alarmas y recordatorios" en Ajustes de Android.'
            };
          }
        } catch (e) {
          console.warn('[capacitor-bridge] No se pudo verificar exact_alarm:', e);
          return { granted: true, exactAlarm: false, reason: 'No se pudo verificar el permiso de alarmas exactas.' };
        }
      }

      return { granted: true, exactAlarm: true };
    } catch (e) {
      return { granted: false, reason: e.message || 'Error al pedir permisos.' };
    }
  }

  // C2/F1: chequeo de permiso sin abrir diálogo (para el arranque de la app)
  async function ensureNotificationPermission() {
    if (!LN) return { granted: false, reason: 'LocalNotifications no disponible.' };
    try {
      await ensureChannels();
      if (typeof LN.checkPermissions === 'function') {
        const cur = await LN.checkPermissions();
        if (cur && cur.display === 'granted') {
          return { granted: true, alreadyGranted: true };
        }
      }
      return await requestPermissions();
    } catch (e) {
      return { granted: false, reason: e.message || 'Error verificando permisos.' };
    }
  }

  function parseHorario(h) {
    const [hh, mm] = String(h || '').split(':').map(Number);
    if (!isFinite(hh) || !isFinite(mm)) return null;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return { hour: hh, minute: mm };
  }

  function notifId(medId, idx) {
    let hash = 0;
    const s = String(medId) + '_' + idx;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 2147483647;
  }

  // F1: agenda próxima ocurrencia de cada horario, repitiendo todos los días.
  // El truco: usamos 'on: { hour, minute }' + repeats: true (el plugin lo
  // interpreta como "próxima vez que sean las HH:MM, y luego cada día").
  // Si el plugin no soporta 'on', caemos a 'at' con la próxima fecha.
  async function scheduleMedicationReminders(med) {
    if (!LN) return { ok: false, error: 'LocalNotifications no disponible' };
    if (!med || !med.id || !Array.isArray(med.horarios) || !med.horarios.length) {
      return { ok: true, scheduled: 0 };
    }

    await ensureChannels();

    const notifications = [];
    med.horarios.forEach((h, idx) => {
      const time = parseHorario(h);
      if (!time) return;

      const baseNotif = {
        id: notifId(med.id, idx),
        title: '💊 Recordatorio de medicación',
        body: `Es hora de tomar: ${med.nombre}${med.dosis ? ' — ' + med.dosis : ''}`,
        channelId: 'medicacion',
        autoCancel: false,
        ongoing: false,
        extra: { medicationId: med.id, horario: h }
      };
      if (SMALL_ICON) baseNotif.smallIcon = SMALL_ICON;

      // Preferido: 'on' con repeats (el plugin agenda "todos los días a las HH:MM")
      notifications.push(Object.assign({}, baseNotif, {
        schedule: {
          on: { hour: time.hour, minute: time.minute },
          repeats: true,
          allowWhileIdle: true
        }
      }));
    });

    if (!notifications.length) return { ok: true, scheduled: 0 };

    try {
      await cancelMedicationReminders(med.id);

      // Intento 1: con 'on' + repeats
      try {
        const result = await LN.schedule({ notifications });
        return { ok: true, scheduled: result && result.notifications ? result.notifications.length : notifications.length };
      } catch (e1) {
        console.warn('[capacitor-bridge] schedule con "on" falló, reintentando con "at":', e1);
        // Fallback: 'at' con la próxima fecha de cada horario (una sola vez)
        const fallback = med.horarios.map((h, idx) => {
          const time = parseHorario(h);
          if (!time) return null;
          const next = new Date();
          next.setHours(time.hour, time.minute, 0, 0);
          if (next.getTime() <= Date.now()) next.setTime(next.getTime() + 86400000);
          const n = {
            id: notifId(med.id, idx),
            title: '💊 Recordatorio de medicación',
            body: `Es hora de tomar: ${med.nombre}${med.dosis ? ' — ' + med.dosis : ''}`,
            schedule: { at: next, allowWhileIdle: true },
            channelId: 'medicacion',
            autoCancel: false,
            ongoing: false,
            extra: { medicationId: med.id, horario: h }
          };
          if (SMALL_ICON) n.smallIcon = SMALL_ICON;
          return n;
        }).filter(Boolean);
        const r2 = await LN.schedule({ notifications: fallback });
        return { ok: true, scheduled: r2 && r2.notifications ? r2.notifications.length : fallback.length, fallback: true };
      }
    } catch (e) {
      console.warn('[capacitor-bridge] Error programando recordatorios:', e);
      return { ok: false, error: e.message };
    }
  }

  async function cancelMedicationReminders(medId) {
    if (!medId || !LN) return;
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
    if (!LN) return 0;
    try {
      const pending = await LN.getPending();
      return (pending.notifications || []).length;
    } catch (_) { return 0; }
  }

  async function showLocalNotification(titleOrOpts, bodyArg) {
    if (!LN) return false;
    try {
      await ensureChannels();
      let title = 'EMP Emergencias';
      let body = '';
      let id = Math.floor(Math.random() * 2147483000) + 1;
      let extra = {};
      let channelId = 'emp_sos_channel';

      if (titleOrOpts && typeof titleOrOpts === 'object') {
        title = titleOrOpts.title || title;
        body = titleOrOpts.body || '';
        if (typeof titleOrOpts.id === 'number') id = titleOrOpts.id;
        if (titleOrOpts.extra) extra = titleOrOpts.extra;
        if (titleOrOpts.channelId) channelId = titleOrOpts.channelId;
      } else {
        title = titleOrOpts || title;
        body = bodyArg || '';
      }

      const notif = {
        id,
        title,
        body,
        schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true },
        channelId,
        autoCancel: true,
        extra
      };
      if (SMALL_ICON) notif.smallIcon = SMALL_ICON;

      await LN.schedule({ notifications: [notif] });
      return true;
    } catch (e) {
      console.warn('[capacitor-bridge] Error showLocalNotification:', e);
      return false;
    }
  }

  // ============ F2: FIREBASE CLOUD MESSAGING ============
  async function getFirebaseMessagingPlugin() {
    if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.FirebaseMessaging) {
      return global.Capacitor.Plugins.FirebaseMessaging;
    }
    try {
      const mod = await import('@capacitor-firebase/messaging');
      if (mod && mod.FirebaseMessaging) return mod.FirebaseMessaging;
    } catch (_) {}
    return null;
  }

  async function saveTokenToSupabase(supabaseClient, userId, token) {
    if (!supabaseClient || !userId || !token) return { ok: false, error: 'Datos incompletos para guardar token.' };
    const platform = (global.Capacitor && typeof global.Capacitor.getPlatform === 'function')
      ? global.Capacitor.getPlatform()
      : 'android';
    const { error } = await supabaseClient
      .from('device_tokens')
      .upsert(
        {
          user_id: userId,
          token: String(token),
          platform,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_id,token' }
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true, token };
  }

  async function registerPushToken(supabaseClient, userId) {
    try {
      if (!supabaseClient || !userId) {
        return { ok: false, error: 'Falta supabaseClient o userId.' };
      }

      await ensureChannels();

      const FM = await getFirebaseMessagingPlugin();
      if (!FM) {
        return { ok: false, error: 'Plugin FirebaseMessaging no disponible en esta compilación.' };
      }

      const perm = await FM.requestPermissions();
      if (!perm || perm.receive !== 'granted') {
        return { ok: false, error: 'Permiso de notificaciones Push denegado.' };
      }

      const tokenRes = await FM.getToken();
      const token = tokenRes && tokenRes.token ? String(tokenRes.token).trim() : '';
      if (!token) {
        return { ok: false, error: 'FCM no devolvió un token válido.' };
      }

      const saved = await saveTokenToSupabase(supabaseClient, userId, token);
      if (!saved.ok) return saved;

      if (!pushListenersBound && typeof FM.addListener === 'function') {
        pushListenersBound = true;

        FM.addListener('tokenReceived', async (event) => {
          if (event && event.token) {
            await saveTokenToSupabase(supabaseClient, userId, event.token);
          }
        });

        FM.addListener('notificationReceived', async (event) => {
          const n = (event && event.notification) || {};
          const data = n.data || {};
          await showLocalNotification({
            title: n.title || data.title || '🚨 Alerta SOS — EMP',
            body: n.body || data.body || 'Nuevo incidente recibido en Central.',
            channelId: 'emp_sos_channel',
            extra: data
          });
        });

        FM.addListener('notificationActionPerformed', (event) => {
          const n = (event && event.notification) || {};
          const data = n.data || {};
          if (data && data.deep_link) {
            global.location.href = data.deep_link;
          }
        });
      }

      return { ok: true, token };
    } catch (e) {
      console.warn('[capacitor-bridge] Error en registerPushToken:', e);
      return { ok: false, error: e.message || String(e) };
    }
  }

  global.E360Capacitor = {
    isNative: true,
    available: !!LN,
    requestPermissions,
    ensureNotificationPermission,
    scheduleMedicationReminders,
    cancelMedicationReminders,
    getScheduledCount,
    showLocalNotification,
    registerPushToken
  };
})(typeof window !== 'undefined' ? window : globalThis);
