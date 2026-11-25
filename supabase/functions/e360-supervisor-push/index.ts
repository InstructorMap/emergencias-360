import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

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
    throw new Error('Firebase OAuth failed');
  }
  return data.access_token;
}

serve(async req => {
  if (req.method !== 'POST') return new Response(null,{status:405});
  const key = req.headers.get('x-worker-key');
  if (!key || !/^[0-9a-f]{64}$/.test(key)) return new Response(null,{status:403});
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false}});
  const {data: jobs,error} = await db.rpc('e360_claim_dispatch_push',{worker_key:key});
  if (error) return new Response(null,{status:error.code==='42501'?403:503});
  if (!jobs?.length) return new Response(null,{status:204});
  const account = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT')!);
  let bearer: string | undefined;
  try { bearer = await getGoogleAccessToken(account); } catch { /* Retry each claimed delivery. */ }
  await Promise.all(jobs.map(async (job: {delivery_id:string,claim_id:string,device_token:string,kind:string}) => {
    let outcome = 'retry';
    if (bearer) {
      try {
        const response = await fetch('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(account.project_id)+'/messages:send',{
          method:'POST',signal:AbortSignal.timeout(10000),
          headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},
          body:JSON.stringify({message:{token:job.device_token,notification:{title:'Emergencias 360',body:job.kind==='ack'?'Central confirmó la recepción de tu SOS.':'SOS pendiente de reconocimiento. Abrí Central.'},
            android:{priority:'high',ttl:'60s',notification:{tag:job.delivery_id}}}})
        });
        if (response.ok) outcome='accepted';
        else if ((await response.json()).error?.details?.some((d:{errorCode?:string})=>d.errorCode==='UNREGISTERED')) outcome='invalid';
      } catch { /* A transient transport failure is retryable. */ }
    }
    const {error: finishError} = await db.rpc('e360_finish_supervisor_push',{delivery_id:job.delivery_id,claim_id:job.claim_id,outcome});
    if (finishError) throw new Error('Delivery state unavailable');
  }));
  return new Response(null,{status:204});
});
