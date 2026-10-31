/* ============================================================
   capacitor-bridge.js v8.3 — Puente Capacitor (F1 Medicación + C1 SOS + F2 Push FCM)
   - Detecta si corre en Capacitor (APK nativa)
   - Crea canales Android: 'medicacion' y 'emp_sos_channel' (importancia MAX)
   - F1: scheduleMedicationReminders / cancelMedicationReminders / SCHEDULE_EXACT_ALARM
   - C1: showLocalNotification (acepta objeto { title, body, id, extra } o (title, body))
   - F2: registerPushToken(supabaseClient, userId) con @capacitor-firebase/messaging
   ============================================================ */

(function (global) {
  'use strict';

  const isNative = !!(
    global.Capacitor &&
    typeof global.Capacitor.isNativePlatform === 'function' &&
    global.Capacitor.isNativePlatform()
  );

  // En Web (no nativo), exponemos la interfaz completa con no-ops seguros
  // para que healthcheck.js y los controladores no fallen al verificar métodos.
  if (!isNative) {
    global.E360Capacitor = {
      isNative: false,
      available: false,
      requestPermissions: async function () {
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

  // Intenta abrir la pantalla de ajustes de alarmas exactas (Android 12+)
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
      await cancelMedicationReminders(med.id);
      const result = await LN.schedule({ notifications });
      return { ok: true, scheduled: result && result.notifications ? result.notifications.length : notifications.length };
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

  // Soporta tanto showLocalNotification({ title, body, id, extra }) como showLocalNotification(title, body)
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

      await LN.schedule({
        notifications: [{
          id,
          title,
          body,
          schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true },
          channelId,
          smallIcon: 'ic_stat_icon_config_sample',
          autoCancel: true,
          extra
        }]
      });
      return true;
    } catch (e) {
      console.warn('[capacitor-bridge] Error showLocalNotification:', e);
      return false;
    }
  }

  // ============ F2: FIREBASE CLOUD MESSAGING (@capacitor-firebase/messaging) ============
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

      // Listeners para refresco de token y recepción con la app en primer plano o al tocar la notificación
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
    scheduleMedicationReminders,
    cancelMedicationReminders,
    getScheduledCount,
    showLocalNotification,
    registerPushToken
  };
})(typeof window !== 'undefined' ? window : globalThis);
