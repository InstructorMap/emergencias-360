/* ============================================================
   js/ptt.js — Push-to-Talk EMP (F3) + debug()
   - unlockRemoteAudioEarly espera play() antes de pause()
   - startRecording recrea localStream si el track está muerto
   - private: true (canal privado con RLS)
   - ptt_start desmutea, ptt_stop mutea
   ============================================================ */

(function (global) {
  'use strict';

  let pc = null;
  let localStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let currentIncidentId = null;
  let currentRole = null;
  let signalChannel = null;
  let remoteAudio = null;
  let isPressing = false;
  let isInitialized = false;

  let cachedIceServers = null;
  let iceServersExpiry = 0;
  let lastIceError = null;
  let lastSignalingError = null;

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
      cachedIceServers = [{ urls: 'stun:stun.l.google.com:19302' }, ...servers];
      iceServersExpiry = Date.now() + (50 * 60 * 1000);
      lastIceError = null;
      return cachedIceServers;
    } catch (e) {
      lastIceError = e.message || String(e);
      console.warn('[ptt] Sin credenciales TURN, usando solo STUN:', e);
      return [{ urls: 'stun:stun.l.google.com:19302' }];
    }
  }

  async function unlockRemoteAudioEarly() {
    if (!remoteAudio) {
      remoteAudio = new Audio();
      remoteAudio.autoplay = true;
      remoteAudio.playsInline = true;
    }
    try {
      const prevMuted = remoteAudio.muted;
      remoteAudio.muted = true;
      const playPromise = remoteAudio.play();
      if (playPromise !== undefined) {
        await playPromise;
        remoteAudio.pause();
      }
      remoteAudio.muted = prevMuted;
    } catch (e) {
      try { remoteAudio.muted = false; } catch (_) {}
      console.warn('[ptt] Unlock anticipado falló (se reintentará con el click):', e);
    }
  }

  async function initSignaling(supabase, incidentId, role) {
    currentIncidentId = incidentId;
    currentRole = role;

    unlockRemoteAudioEarly().catch(() => {});

    signalChannel = supabase.channel('ptt_' + incidentId, {
      config: {
        broadcast: { self: false, acknowledgeBroadcasts: true },
        private: true
      }
    });

    await new Promise((resolve, reject) => {
      signalChannel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          lastSignalingError = 'subscribe: ' + status + ' — ' + (err ? err.message : 'sin detalle');
          reject(new Error('Canal de señalización falló: ' + status + ' — ' + (err ? err.message : 'sin detalle')));
        }
      });
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
            lastSignalingError = 'answer: ' + e.message;
            console.warn('[ptt] Error aplicando answer:', e);
          }
        }
      })
      .on('broadcast', { event: 'ptt_ice' }, async ({ payload }) => {
        if (pc && payload.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch (e) {
            lastSignalingError = 'ice: ' + e.message;
            console.warn('[ptt] ICE error:', e);
          }
        }
      })
      .on('broadcast', { event: 'ptt_start' }, () => {
        if (remoteAudio) {
          try {
            remoteAudio.muted = false;
            const p = remoteAudio.play();
            if (p !== undefined) p.catch(() => {});
          } catch (_) {}
        }
      })
      .on('broadcast', { event: 'ptt_stop' }, () => {
        if (remoteAudio) { try { remoteAudio.muted = true; } catch (_) {} }
      });
  }

  async function createPeerConnection(supabase) {
    if (pc) { try { pc.close(); } catch (_) {} pc = null; }
    const iceServers = await fetchIceServers(supabase);
    pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate && signalChannel) {
        signalChannel.send({
          type: 'broadcast', event: 'ptt_ice',
          payload: { candidate: event.candidate.toJSON() }
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc) console.log('[ptt] ICE state:', pc.iceConnectionState);
    };

    pc.ontrack = (event) => {
      if (!remoteAudio) {
        remoteAudio = new Audio();
        remoteAudio.autoplay = true;
        remoteAudio.playsInline = true;
      }
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.muted = false;
      const playPromise = remoteAudio.play();
      if (playPromise !== undefined) {
        playPromise.catch((e) => {
          console.warn('[ptt] Autoplay bloqueado en ontrack, reintentando con click:', e);
          const unlock = () => {
            if (remoteAudio) remoteAudio.play().catch(() => {});
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
          };
          document.addEventListener('click', unlock);
          document.addEventListener('touchstart', unlock);
        });
      }
    };

    return pc;
  }

  async function startAsCaller(supabase) {
    if (!localStream) throw new Error('Sin micrófono');
    if (!signalChannel) throw new Error('Canal de señalización no inicializado');

    await createPeerConnection(supabase);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sendResult = await signalChannel.send({
      type: 'broadcast',
      event: 'ptt_offer',
      payload: { sdp: pc.localDescription.toJSON() }
    });

    if (sendResult && sendResult.ok === false) {
      throw new Error('El servidor Realtime rechazó la oferta SDP. ¿Política RLS?');
    }
  }

  async function handleOffer(supabase, sdp) {
    if (!localStream) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        lastSignalingError = 'getUserMedia: ' + e.message;
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
        type: 'broadcast', event: 'ptt_answer',
        payload: { sdp: pc.localDescription.toJSON() }
      });
    } catch (e) {
      lastSignalingError = 'handleOffer: ' + e.message;
      console.warn('[ptt] Error respondiendo oferta:', e);
    }
  }

  async function startRecording() {
    let streamOk = localStream && localStream.getAudioTracks().some(t => t.readyState === 'live');
    if (!streamOk) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
      } catch (e) {
        console.warn('[ptt] No se pudo recrear el micrófono:', e);
        return;
      }
    }

    recordedChunks = [];
    try {
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      mediaRecorder = new MediaRecorder(localStream, { mimeType: mime });
    } catch (e) { return; }
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
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
            incident_id: currentIncidentId, type: 'audio',
            storage_path: data.path,
            uploaded_by: userData?.user?.email || 'desconocido',
            duration_seconds: Math.max(1, Math.round(blob.size / 16000))
          });
          resolve(data.path);
        } catch (e) { resolve(null); }
      };
      try { mediaRecorder.stop(); } catch (_) { resolve(null); }
    });
  }

  global.E360PTT = {
    async init(supabase, incidentId, role) {
      if (isInitialized) this.destroy();
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
      } catch (e) {
        lastSignalingError = 'getUserMedia: ' + e.message;
        return false;
      }
      await initSignaling(supabase, incidentId, role);
      isInitialized = true;
      return true;
    },

    async startTalking(supabase) {
      if (!isInitialized || isPressing) return;
      isPressing = true;
      try {
        if (currentRole === 'guardia') {
          await startAsCaller(supabase);
        }
        await startRecording();
        if (signalChannel) {
          signalChannel.send({ type: 'broadcast', event: 'ptt_start', payload: {} });
        }
      } catch (e) {
        isPressing = false;
        lastSignalingError = 'startTalking: ' + e.message;
        console.error('[ptt] startTalking falló:', e);
        throw e;
      }
    },

    async stopTalking(supabase) {
      if (!isPressing) return null;
      isPressing = false;
      if (signalChannel) signalChannel.send({ type: 'broadcast', event: 'ptt_stop', payload: {} });
      const path = await stopRecordingAndUpload(supabase);
      if (pc) { try { pc.close(); } catch (_) {} pc = null; }
      return path;
    },

    isActive() { return isPressing; },
    isReady() { return isInitialized; },

    debug() {
      return {
        initialized: isInitialized,
        pressing: isPressing,
        incidentId: currentIncidentId,
        role: currentRole,
        channelState: signalChannel ? signalChannel.state : 'none',
        pcExists: !!pc,
        pcConnectionState: pc ? pc.connectionState : 'none',
        pcIceState: pc ? pc.iceConnectionState : 'none',
        pcSignalingState: pc ? pc.signalingState : 'none',
        localStreamActive: localStream ? localStream.getAudioTracks().some(t => t.enabled && !t.muted) : false,
        localStreamTracks: localStream ? localStream.getAudioTracks().length : 0,
        remoteAudioExists: !!remoteAudio,
        remoteAudioPaused: remoteAudio ? remoteAudio.paused : null,
        remoteAudioMuted: remoteAudio ? remoteAudio.muted : null,
        remoteAudioVolume: remoteAudio ? remoteAudio.volume : null,
        remoteAudioHasStream: remoteAudio && remoteAudio.srcObject ? true : false,
        turnCached: !!cachedIceServers,
        turnExpiryIn: cachedIceServers ? Math.max(0, Math.round((iceServersExpiry - Date.now()) / 1000)) : 0,
        lastIceError: lastIceError,
        lastSignalingError: lastSignalingError
      };
    },

    unlockAudio() {
      if (!remoteAudio) return Promise.resolve(false);
      remoteAudio.muted = false;
      const p = remoteAudio.play();
      if (p === undefined) return Promise.resolve(true);
      return p.then(() => true).catch(() => false);
    },

    destroy() {
      if (pc) { try { pc.close(); } catch (_) {} pc = null; }
      if (localStream) { localStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} }); localStream = null; }
      if (signalChannel) { try { signalChannel.unsubscribe(); } catch (_) {} signalChannel = null; }
      if (remoteAudio) { try { remoteAudio.pause(); } catch (_) {} remoteAudio.srcObject = null; remoteAudio = null; }
      isPressing = false;
      isInitialized = false;
      currentIncidentId = null;
      currentRole = null;
      lastIceError = null;
      lastSignalingError = null;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
