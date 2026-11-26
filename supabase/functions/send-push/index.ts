// ============================================================
// Edge Function: send-push (Deno / Supabase)
// Dispara notificaciones Push FCM HTTP v1 a todos los operadores/admins
// con profiles.on_duty = true cuando ingresa un incidente SOS.
// Requiere Secret: FCM_SERVICE_ACCOUNT (JSON del Service Account de Firebase)
// ============================================================

import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getGoogleAccessToken(serviceAccount: {
  client_email: string;
  private_key: string;
  token_uri?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = serviceAccount.token_uri || 'https://oauth2.googleapis.com/token';

  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };

  const unsignedJwt = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claimSet))}`;
  const keyBuffer = pemToArrayBuffer(serviceAccount.private_key);

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedJwt)
  );

  const signedJwt = `${unsignedJwt}.${base64UrlEncode(new Uint8Array(signature))}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('Error obteniendo OAuth token de Google: ' + JSON.stringify(data));
  }
  return data.access_token;
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(null,{status:405});
  const candidate = req.headers.get('x-emp-trigger');
  if (!candidate || !/^[a-f0-9]{64}$/.test(candidate)) return new Response(null,{status:403});
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const auth = await sb.rpc('e360_verify_send_push',{candidate});
    if (auth.error) return new Response(null,{status:503});
    if (auth.data !== true) return new Response(null,{status:403});
    const payload = await req.json();
    const incidentId = payload?.record?.id;
    if (payload.type !== 'INSERT' || payload.table !== 'incidents' || typeof incidentId !== 'string' || !incidentId)
      return new Response(null,{status:400});
    const incident = await sb.from('incidents').select('base_id').eq('id',incidentId).maybeSingle();
    if (incident.error) return new Response(null,{status:503});
    if (!incident.data) return new Response(null,{status:204});
    const baseId = incident.data.base_id || '';
    const serviceAccount = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT')!);
    const projectId = serviceAccount.project_id;
    const pushTitle = 'Emergencias 360';
    const pushBody = 'Nuevo incidente. Abrí Central.';
    const deepLink = `central.html?incident=${encodeURIComponent(incidentId)}`;

    // 2. Buscar operadores/admins en guardia activa (on_duty = true)
    const { data: onDutyProfiles, error: profErr } = await sb
      .from('profiles')
      .select('id, user_id')
      .in('role', ['admin', 'operador'])
      .eq('on_duty', true);

    if (profErr) throw new Error(profErr.message);

    const userIds = Array.from(
      new Set(
        (onDutyProfiles || [])
          .flatMap((p: { id?: string; user_id?: string }) => [p.user_id, p.id])
          .filter(Boolean)
      )
    );

    console.log('[send-push] Operadores on_duty:', userIds.length);

    if (userIds.length === 0) {
      const msg = 'Sin operadores con on_duty = true';
      console.log('[send-push] Resultado:', msg);
      return new Response(
        JSON.stringify({ ok: true, sent: 0, reason: msg }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // 3. Obtener tokens FCM en device_tokens
    const { data: tokenRows, error: tokErr } = await sb
      .from('device_tokens')
      .select('token')
      .in('user_id', userIds);

    if (tokErr) throw new Error(tokErr.message);

    const tokens = Array.from(new Set((tokenRows || []).map((r: { token: string }) => r.token).filter(Boolean)));

    console.log('[send-push] Tokens encontrados:', tokens.length);

    if (tokens.length === 0) {
      const msg = 'Operadores en guardia sin device_tokens registrados';
      console.log('[send-push] Resultado:', msg);
      return new Response(
        JSON.stringify({ ok: true, sent: 0, reason: msg }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // 4. Obtener Access Token OAuth2 de Google y enviar por FCM v1
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const fcmEndpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    let sent = 0;
    const errors: string[] = [];

    for (const token of tokens) {
      const fcmMessage = {
        message: {
          token,
          notification: {
            title: pushTitle,
            body: pushBody,
          },
          data: {
            incident_id: incidentId,
            base_id: baseId,
            deep_link: deepLink,
            title: pushTitle,
            body: pushBody,
          },
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: 'emp_sos_channel',
              sound: 'default',
              default_vibrate_timings: true,
              priority: 'MAX',
            },
          },
        },
      };

      const resp = await fetch(fcmEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fcmMessage),
      });

      if (resp.ok) {
        sent++;
      } else {
        const errTxt = await resp.text();
        errors.push('FCM HTTP ' + resp.status);
        console.log('[send-push] FCM HTTP', resp.status);
        // Si el token quedó inválido/desinstalado, limpiarlo
        if (errTxt.includes('UNREGISTERED')) {
          await sb.from('device_tokens').delete().eq('token', token);
        }
      }
    }

    const result = { ok: true, sent, totalTokens: tokens.length, errors };
    console.log('[send-push] Resultado final:', JSON.stringify(result));

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log('[send-push] ERROR:', message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
