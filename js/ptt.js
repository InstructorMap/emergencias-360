/* ============================================================
   js/ptt.js — Push-to-Talk EMP (F3)
   - Señalización por Supabase Realtime (canal ptt_<incident_id>)
   - WebRTC 1-a-1 entre guardia y central
   - Grabación con MediaRecorder al emitir
   - Sube el clip a Storage (incident-media) al soltar
   - Credenciales TURN temporales vía Edge Function get-turn-credentials
   - Cachea las credenciales TURN por 50 min
   ============================================================ */

(function (global) {
  'use strict';

  // ============ ESTADO ============
  let pc = null;
  let localStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let currentIncidentId = null;
  let currentRole = null;       // 'guardia' | 'central'
  let signalChannel = null;
  let remoteAudio = null;
  let isPressing = false;
  let isInitialized = false;

  let cachedIceServers = null;
  let iceServersExpiry = 0;

  // ============ TURN (Cloudflare vía Edge Function) ============
  async function fetchIceServers(supabase) {
    if (cachedIceServers && Date.now() < iceServersExpiry) {
      return cachedIceServers;
    }
    try {
      const { data, error } = await supabase.functions.invoke('get-turn-credentials', {
        body: { ttl: 3600 }
      });
      if (error) throw error;
      if (!data || !data.iceServers) throw new Error('Respuesta inválida de TURN');

      const servers = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
      cachedIceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        ...servers
      ];
      iceServersExpiry = Date.now() + (50 * 60 * 1000);
      return cachedIceServers;
    } catch (e) {
      console.warn('[ptt] Sin credenciales TURN, usando solo STUN:', e);
      return [{ urls: 'stun:stun.l.google.com:19302' }];
    }
  }

  // ============ SEÑALIZACIÓN ============
  async function initSignaling(supabase, incidentId, role) {
    currentIncidentId = incidentId;
    currentRole = role;

    signalChannel = supabase.channel('ptt_' + incidentId, {
      config: { broadcast: { self: false } }
    });

    signalChannel
      .on('broadcast', { event: 'ptt_offer' }, async ({ payload }) => {
        if (role !== 'central') return;
        await handleOffer(supabase, payload.sdp);
      })
      .on('broadcast', { event: 'ptt_answer' }, async ({ payload }) => {
        if (role !== 'guardia') return;
        if (pc && pc.signalingState === 'have-local-offer') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          } catch (e) {
            console.warn('[ptt] Error aplicando answer:', e);
          }
        }
      })
      .on('broadcast', { event: 'ptt_ice' }, async ({ payload }) => {
        if (pc && payload.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch (e) { console.warn('[ptt] ICE error:', e); }
        }
      })
      .on('broadcast', { event: 'ptt_stop' }, () => {
        if (remoteAudio) {
          try { remoteAudio.pause(); } catch (_) {}
        }
      })
      .subscribe();
  }

  // ============ PEER CONNECTION ============
  async function createPeerConnection(supabase) {
    if (pc) {
      try { pc.close(); } catch (_) {}
      pc = null;
    }
    const iceServers = await fetchIceServers(supabase);
    pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate && signalChannel) {
        signalChannel.send({
          type: 'broadcast',
          event: 'ptt_ice',
          payload: { candidate: event.candidate.toJSON() }
        });
      }
    };

    pc.ontrack = (event) => {
      if (!remoteAudio) {
        remoteAudio = new Audio();
        remoteAudio.autoplay = true;
      }
      remoteAudio.srcObject = event.streams[0];
      try { remoteAudio.play(); } catch (_) {}
    };

    return pc;
  }

  // Guardia inicia la oferta
  async function startAsCaller(supabase) {
    if (!localStream) return;
    await createPeerConnection(supabase);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    signalChannel.send({
      type: 'broadcast',
      event: 'ptt_offer',
      payload: { sdp: pc.localDescription.toJSON() }
    });
  }

  // Central responde a la oferta
  async function handleOffer(supabase, sdp) {
    if (!localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        console.warn('[ptt] Central sin micrófono:', e);
        return;
      }
    }
    await createPeerConnection(supabase);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      signalChannel.send({
        type: 'broadcast',
        event: 'ptt_answer',
        payload: { sdp: pc.localDescription.toJSON() }
      });
    } catch (e) {
      console.warn('[ptt] Error respondiendo oferta:', e);
    }
  }

  // ============ GRABACIÓN ============
  function startRecording() {
    if (!localStream) return;
    recordedChunks = [];
    try {
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      mediaRecorder = new MediaRecorder(localStream, { mimeType: mime });
    } catch (e) {
      console.warn('[ptt] MediaRecorder no soporta webm/opus:', e);
      return;
    }
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.start();
  }

  async function stopRecordingAndUpload(supabase) {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return null;
    return new Promise((resolve) => {
      mediaRecorder.onstop = async () => {
        if (recordedChunks.length === 0) { resolve(null); return; }
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const fileName = 'audio/' + currentIncidentId + '/ptt_' + Date.now() + '.webm';

        try {
          const { data, error } = await supabase.storage
            .from('incident-media')
            .upload(fileName, blob, { contentType: 'audio/webm', upsert: false });

          if (error) throw error;

          const { data: userData } = await supabase.auth.getUser();
          await supabase.from('incident_media').insert({
            incident_id: currentIncidentId,
            type: 'audio',
            storage_path: data.path,
            uploaded_by: userData?.user?.email || 'desconocido',
            duration_seconds: Math.max(1, Math.round(blob.size / 16000))
          });

          resolve(data.path);
        } catch (e) {
          console.warn('[ptt] Error subiendo clip:', e);
          resolve(null);
        }
      };
      try { mediaRecorder.stop(); } catch (_) { resolve(null); }
    });
  }

  // ============ API PÚBLICA ============
  global.E360PTT = {
    async init(supabase, incidentId, role) {
      if (isInitialized) this.destroy();
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
      } catch (e) {
        console.warn('[ptt] Sin micrófono:', e);
        return false;
      }
      await initSignaling(supabase, incidentId, role);
      isInitialized = true;
      return true;
    },

    async startTalking(supabase) {
      if (!isInitialized || isPressing) return;
      isPressing = true;

      if (currentRole === 'guardia') {
        await startAsCaller(supabase);
      }

      startRecording();

      if (signalChannel) {
        signalChannel.send({ type: 'broadcast', event: 'ptt_start', payload: {} });
      }
    },

    async stopTalking(supabase) {
      if (!isPressing) return null;
      isPressing = false;

      if (signalChannel) {
        signalChannel.send({ type: 'broadcast', event: 'ptt_stop', payload: {} });
      }

      const path = await stopRecordingAndUpload(supabase);

      if (pc) {
        try { pc.close(); } catch (_) {}
        pc = null;
      }

      return path;
    },

    isActive() {
      return isPressing;
    },

    isReady() {
      return isInitialized;
    },

    destroy() {
      if (pc) { try { pc.close(); } catch (_) {} pc = null; }
      if (localStream) {
        localStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
        localStream = null;
      }
      if (signalChannel) {
        try { signalChannel.unsubscribe(); } catch (_) {}
        signalChannel = null;
      }
      if (remoteAudio) {
        try { remoteAudio.pause(); } catch (_) {}
        remoteAudio.srcObject = null;
        remoteAudio = null;
      }
      isPressing = false;
      isInitialized = false;
      currentIncidentId = null;
      currentRole = null;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
