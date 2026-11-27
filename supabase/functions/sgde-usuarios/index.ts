import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const origins = (Deno.env.get('SGDE_ALLOWED_ORIGINS') || '').split(',').map(origin => origin.trim());
const roles = ['admin', 'asistente', 'auxiliar'];

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const reply = (body: object, status = 200) => Response.json(body, {
    status, headers: { ...cors, 'Cache-Control': 'no-store' },
  });
  if (!origin || !origins.includes(origin)) return new Response(null, { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);

  try {
    const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return reply({ error: 'Sesión requerida.' }, 401);
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return reply({ error: 'Sesión inválida.' }, 401);

    const { data: actor, error: actorError } = await db.from('usuarios').select('id')
      .eq('auth_user_id', user.id).eq('activo', true).eq('rol', 'admin').maybeSingle();
    if (actorError || !actor) return reply({ error: 'Se requiere un administrador activo.' }, 403);

    const body = await req.json().catch(() => null);
    const password = body?.password;
    if (typeof password !== 'string' || password.length < 12 || new TextEncoder().encode(password).length > 72) {
      return reply({ error: 'Usa una contraseña de al menos 12 caracteres y hasta 72 bytes.' }, 400);
    }

    if (body.accion === 'cambiar_clave') {
      if (typeof body.id !== 'string' || !/^[\da-f-]{36}$/i.test(body.id)) {
        return reply({ error: 'Perfil inválido.' }, 400);
      }
      const { data: perfil, error } = await db.from('usuarios').select('auth_user_id')
        .eq('id', body.id).maybeSingle();
      if (error || !perfil?.auth_user_id) return reply({ error: 'El perfil no está vinculado.' }, 404);
      const { error: cambioError } = await db.auth.admin.updateUserById(perfil.auth_user_id, { password });
      if (cambioError) return reply({ error: 'No se pudo actualizar la contraseña.' }, 400);
      return reply({ id: body.id });
    }

    const { username, nombre, email, rol } = body;
    if (body.accion !== 'crear' || typeof username !== 'string' || !username.trim() ||
      typeof nombre !== 'string' || !nombre.trim() || typeof email !== 'string' || !email.trim() ||
      username.length > 200 || nombre.length > 200 || email.length > 254 || !roles.includes(rol)) {
      return reply({ error: 'Datos de usuario inválidos.' }, 400);
    }

    const { data: cuenta, error: crearError } = await db.auth.admin.createUser({
      email: email.trim(), password, email_confirm: true,
    });
    if (crearError || !cuenta.user) return reply({ error: 'No se pudo crear la cuenta de Auth.' }, 400);

    const { data: perfil, error: perfilError } = await db.from('usuarios').insert({
      auth_user_id: cuenta.user.id, username: username.trim(), nombre: nombre.trim(), rol,
    }).select('id').single();
    if (perfilError) {
      const { error: limpieza } = await db.auth.admin.deleteUser(cuenta.user.id);
      if (limpieza) console.error('Quedó una cuenta sin perfil:', cuenta.user.id);
      return reply({ error: 'No se pudo crear el perfil.' }, 409);
    }
    return reply(perfil, 201);
  } catch (error) {
    console.error('Falló la administración de usuarios:', error instanceof Error ? error.name : 'error');
    return reply({ error: 'No se pudo completar la operación.' }, 500);
  }
});
