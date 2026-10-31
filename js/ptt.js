/* ============================================================
   js/ptt.js — Push-to-Talk EMP (F3)
   - Señalización por Supabase Realtime (canal ptt_<incident_id>)
   - WebRTC 1-a-1 entre guardia y central
   - Grabación con MediaRecorder al emitir
   - Sube el clip a Storage (incident-media) al soltar
   - Usa Cloudflare TURN para NAT traversal
   ============================================================ */

(function (global) {
  'use strict';

  const C = global.E360Config;

  let pc = null;              // RTCPeerConnection
  let localStream = null;     // MediaStream del micrófono
  let mediaRecorder = null;
  let recordedChunks = [];
  let currentIncidentId = null;
  let currentRole = null;     // 'guardia' | 'central'
  let signalChannel = null;
  let remoteAudio = null;
  let isPressing = false;

  // ============ TURN (Cloudflare) ============
  // Configurá esto con tus credenciales de Cloudflare TURN
  const TURN_CONFIG = {
    urls: 'turn:turn.cloudflare.com:3478?transport=udp',
    username: '',  // Key ID
    credential: '' // API Token
  };

  function getIceServers() {
    const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (TURN_CONFIG.username && TURN_CONFIG.credential) {
      servers.push({
        urls: TURN_CONFIG.urls,
        username: TURN_CONFIG.username,
        credential: TURN_CONFIG.credential
      });
    }
    return servers;
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
        await handleOffer(payload.sdp);
      })
      .on('broadcast', { event: 'ptt_answer' }, async ({ payload }) => {
        if (role !== 'guardia') return;
        if (pc && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
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
        // El peer remoto dejó de hablar
        if (remoteAudio) remoteAudio.pause();
      })
      .subscribe();
  }

  // ============ PEER CONNECTION ============
  function createPeerConnection() {
    pc = new RTCPeerConnection({ iceServers: getIceServers() });

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
    };

    return pc;
  }

  // Guardia inicia la oferta (es quien presiona el botón)
  async function startAsCaller() {
    if (!localStream) return;
    createPeerConnection();
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
  async function handleOffer(sdp) {
    if (!localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        console.warn('[ptt] Sin micrófono en central:', e);
        return;
      }
    }
    createPeerConnection();
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    signalChannel.send({
      type: 'broadcast',
      event: 'ptt_answer',
      payload: { sdp: pc.localDescription.toJSON() }
    });
  }

  // ============ GRABACIÓN ============
  function startRecording() {
    if (!localStream) return;
    recordedChunks = [];
    try {
      mediaRecorder = new MediaRecorder(localStream, { mimeType: 'audio/webm;codecs=opus' });
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
            duration_seconds: Math.round(blob.size / 16000) // estimación
          });

          resolve(data.path);
        } catch (e) {
          console.warn('[ptt] Error subiendo clip:', e);
          resolve(null);
        }
      };
      mediaRecorder.stop();
    });
  }

  // ============ API PÚBLICA ============
  global.E360PTT = {
    async init(supabase, incidentId, role) {
      await initSignaling(supabase, incidentId, role);
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        console.warn('[ptt] Sin micrófono:', e);
        return false;
      }
      return true;
    },

    async startTalking(supabase) {
      if (isPressing) return;
      isPressing = true;

      if (currentRole === 'guardia') {
        await startAsCaller();
      }

      startRecording();

      if (signalChannel) {
        signalChannel.send({ type: 'broadcast', event: 'ptt_start', payload: {} });
      }
    },

    async stopTalking(supabase) {
      if (!isPressing) return;
      isPressing = false;

      if (signalChannel) {
        signalChannel.send({ type: 'broadcast', event: 'ptt_stop', payload: {} });
      }

      const path = await stopRecordingAndUpload(supabase);

      if (pc) {
        pc.close();
        pc = null;
      }

      return path;
    },

    isActive() {
      return isPressing;
    },

    destroy() {
      if (pc) { pc.close(); pc = null; }
      if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
      if (signalChannel) { signalChannel.unsubscribe(); signalChannel = null; }
      if (remoteAudio) { remoteAudio.srcObject = null; remoteAudio = null; }
      isPressing = false;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
