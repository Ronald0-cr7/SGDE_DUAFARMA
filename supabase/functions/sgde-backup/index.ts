import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// Nunca colocar SUPABASE_SERVICE_ROLE_KEY en el frontend.
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
type BackupSnapshot = {
  revision: string;
  esquema: unknown[];
  tablas: Record<string, unknown[]>;
  archivos: unknown[];
};
const origins = (Deno.env.get('SGDE_BACKUP_ORIGINS') || '').split(',').map((s: string) => s.trim()).filter(Boolean);
const encoder = new TextEncoder();
const digest = async (data: BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
  .map(b => b.toString(16).padStart(2, '0')).join('');
function fail(message: string, status = 400): never { throw { message, status }; }
const checked = <T>(result: { data: T; error: unknown }): NonNullable<T> => {
  if (result.error) fail('La operación de base de datos falló. Comprueba la migración y los datos.');
  return result.data as NonNullable<T>;
};

async function admin(req: Request) {
  const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) fail('Sesión requerida.', 401);
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user?.email) fail('Sesión inválida.', 401);
  const { data, error } = await db.from('usuarios').select('username')
    .eq('auth_user_id', user.id).eq('activo', true).eq('rol', 'admin').maybeSingle();
  if (error || !data) fail('Se requiere un administrador activo.', 403);
  return { id: user.id, email: user.email, username: data.username as string };
}

async function confirmarClave(body: Record<string, unknown>, email: string, id: string) {
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 1024) fail('Credenciales inválidas.', 401);
  const auth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || data.user?.id !== id) fail('Contraseña de administrador incorrecta.', 401);
  await auth.auth.signOut({ scope: 'local' });
}

async function job(req: Request, actor: string) {
  const id = req.headers.get('x-backup-job');
  const token = req.headers.get('x-backup-token');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || !token || token.length > 200) fail('Sesión de restauración inválida.', 401);
  const { data, error } = await db.from('sgde_backup_jobs').select('*').eq('id', id).maybeSingle();
  if (error || !data || data.actor !== actor || data.token_hash !== await digest(encoder.encode(token)) ||
      data.estado !== 'preparando' || Date.parse(data.expires_at) <= Date.now()) fail('La sesión venció o no es válida.', 401);
  return data;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-backup-job, x-backup-token, x-file-bucket, x-file-sha256',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
  };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (!origins.length || !origins.includes(origin)) return reply({ error: 'Origen no autorizado. Configura SGDE_BACKUP_ORIGINS.' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);
  try {
    const action = new URL(req.url).searchParams.get('action');
    const actor = await admin(req);
    if (action === 'snapshot' || action === 'start') {
      const body = await req.json();
      await confirmarClave(body, actor.email, actor.id);
      const snapshot = checked<BackupSnapshot>(await db.rpc('sgde_backup_snapshot'));
      if (action === 'snapshot') return reply(snapshot);
      if (JSON.stringify(body.esquema) !== JSON.stringify(snapshot.esquema)) fail('La copia pertenece a otra versión de la base de datos. No se subieron archivos.');
      const id = crypto.randomUUID();
      const token = crypto.randomUUID() + crypto.randomUUID();
      checked(await db.from('sgde_backup_jobs').insert({ id, actor: actor.username, revision: snapshot.revision,
        token_hash: await digest(encoder.encode(token)) }));
      return reply({ id, token });
    }
    const session = await job(req, actor.username);
    if (action === 'upload') {
      const bucket = req.headers.get('x-file-bucket') || '';
      const expectedHash = req.headers.get('x-file-sha256') || '';
      if (!['repositorios', 'documentos'].includes(bucket) || !/^[a-f0-9]{64}$/.test(expectedHash)) fail('Archivo inválido.');
      const declared = Number(req.headers.get('content-length'));
      if (declared > 50_000_000) fail('El archivo supera 50 MB.', 413);
      const bytes = await req.arrayBuffer();
      if (bytes.byteLength > 50_000_000) fail('El archivo supera 50 MB.', 413);
      const hash = await digest(bytes);
      if (hash !== expectedHash) fail('El contenido del archivo no coincide con su huella de integridad.');
      const path = `sgde-restauraciones/${session.id}/${crypto.randomUUID()}`;
      checked(await db.storage.from(bucket).upload(path, bytes, {
        upsert: false, contentType: req.headers.get('content-type') || 'application/octet-stream',
      }));
      const objectRevision = checked<string>(await db.rpc('sgde_backup_object_revision', { p_bucket: bucket, p_path: path }));
      // Verificación de lectura: no basta con haber recibido la subida.
      const stored = checked<Blob>(await db.storage.from(bucket).download(path));
      const finalRevision = checked<string>(await db.rpc('sgde_backup_object_revision', { p_bucket: bucket, p_path: path }));
      if (!objectRevision || objectRevision !== finalRevision || await digest(await stored.arrayBuffer()) !== hash) {
        await db.storage.from(bucket).remove([path]);
        fail('No se pudo verificar el archivo almacenado.');
      }
      const record = { job_id: session.id, bucket, path, sha256: hash, bytes: bytes.byteLength, object_revision: objectRevision };
      const { error } = await db.from('sgde_backup_files').insert(record);
      if (error) { await db.storage.from(bucket).remove([path]); fail('No se pudo registrar el archivo verificado.'); }
      return reply(record);
    }
    if (action === 'commit') {
      const body = await req.json();
      // El RPC verifica en bloque las revisiones de Storage guardadas después
      // de comprobar cada SHA-256. No vuelve a descargar cientos de archivos
      // en una sola petición, evitando el timeout de la Edge Function.
      const files = body.archivos;
      if (!Array.isArray(files)) fail('Lista de archivos inválida.');
      const { data, error } = await db.rpc('sgde_backup_restore', {
        p_job: session.id, p_tablas: body.tablas, p_esquema: body.esquema, p_archivos: files,
      });
      if (error) fail(error.message || 'La restauración fue revertida.');
      return reply(data);
    }
    fail('Operación desconocida.');
  } catch (err) {
    const error = err as { status?: number; message?: string };
    // Nunca devolver objetos de base de datos ni registrar credenciales.
    return reply({ error: error.status ? error.message : 'No se pudo completar la operación. Revisa el servicio de respaldo.' }, error.status || 500);
  }
});
