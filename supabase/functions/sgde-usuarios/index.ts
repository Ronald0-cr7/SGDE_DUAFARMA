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

    const { data: actor, error: actorError } = await db.from('usuarios').select('id, username')
      .eq('auth_user_id', user.id).eq('activo', true).eq('rol', 'admin').maybeSingle();
    if (actorError || !actor) return reply({ error: 'Se requiere un administrador activo.' }, 403);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return reply({ error: 'Solicitud inválida.' }, 400);
    const { accion } = body;
    const admin = db.auth.admin;
    const crearPerfil = async (cuentaId: string, correo: string | undefined, nombre: string, rol: string) => {
      const insertar = (username: string) => db.from('usuarios').insert({
        auth_user_id: cuentaId, username, nombre: nombre.trim(), rol, activo: true,
      }).select('id').single();
      const identificador = `auth:${cuentaId}`;
      const username = correo || identificador;
      const resultado = await insertar(username);
      return resultado.error?.code === '23505' && username !== identificador
        ? insertar(identificador) : resultado;
    };
    const auditar = async (accion: string, id: string, detalle: string) => {
      const { error } = await db.from('log_auditoria').insert({
        usuario: actor.username, accion, tabla: 'usuarios', registro_id: id, detalle,
      });
      if (error) console.error('No se registró la auditoría de usuarios:', error.code);
    };

    if (accion === 'listar') {
      const usuarios = [];
      const limite = 100;
      for (let inicio = 0; ; inicio += limite) {
        const { data: perfiles, error } = await db.from('usuarios')
          .select('id, username, nombre, rol, activo, auth_user_id')
          .order('created_at').order('id').range(inicio, inicio + limite - 1);
        if (error) return reply({ error: 'No se pudieron cargar los perfiles.' }, 500);
        usuarios.push(...perfiles);
        if (perfiles.length < limite) break;
      }
      const perfilesPorCuenta = new Map(usuarios.filter(perfil => perfil.auth_user_id)
        .map(perfil => [perfil.auth_user_id, perfil]));
      const cuentas = [];
      for (let page = 1; ; page++) {
        const { data, error } = await admin.listUsers({ page, perPage: limite });
        if (error) return reply({ error: 'No se pudieron cargar las cuentas de Authentication.' }, 500);
        for (const cuenta of data.users) {
          const perfil = perfilesPorCuenta.get(cuenta.id);
          cuentas.push({
            ...perfil, id: perfil?.id ?? null, auth_user_id: cuenta.id, email: cuenta.email ?? null,
          });
          perfilesPorCuenta.delete(cuenta.id);
        }
        if (data.users.length < limite) break;
      }
      return reply({
        usuarios: [...cuentas, ...usuarios.filter(perfil => !perfil.auth_user_id).map(perfil => ({ ...perfil, email: null }))],
        administrador_id: actor.id,
      });
    }

    const password = body?.password;
    if ((accion === 'crear' || password !== undefined) &&
      (typeof password !== 'string' || password.length < 6 || new TextEncoder().encode(password).length > 72)) {
      return reply({ error: 'Usa una contraseña de al menos 6 caracteres y hasta 72 bytes.' }, 400);
    }

    const { nombre, email, rol } = body;
    const correoValido = typeof email === 'string' && email.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const editarPerfil = accion === 'editar' && (body.id !== undefined || body.vincular === true);
    if ((accion === 'crear' || editarPerfil) &&
      (typeof nombre !== 'string' || !nombre.trim() || nombre.length > 200 || !roles.includes(rol) ||
        ((accion === 'crear' || email !== undefined) && !correoValido))) {
      return reply({ error: 'Datos de usuario inválidos.' }, 400);
    }

    if (accion === 'crear') {
      const { data: cuenta, error: crearError } = await admin.createUser({
        email: email.trim(), password, email_confirm: true,
      });
      if (crearError || !cuenta.user) return reply({ error: 'No se pudo crear la cuenta de Auth.' }, 400);

      const { data: perfil, error: perfilError } = await crearPerfil(
        cuenta.user.id, cuenta.user.email || email.trim(), nombre, rol,
      );
      if (perfilError) {
        const { error: limpieza } = await admin.deleteUser(cuenta.user.id);
        if (limpieza) console.error('Quedó una cuenta sin perfil:', cuenta.user.id);
        return reply({ error: 'No se pudo crear el perfil.' }, 409);
      }
      await auditar('INSERT', perfil.id, 'Cuenta de Auth creada y vinculada.');
      return reply(perfil, 201);
    }

    const porCuenta = body.id === undefined;
    const identificador = porCuenta ? body.auth_user_id : body.id;
    if (!['editar', 'cambiar_clave', 'estado', 'eliminar'].includes(accion) ||
      typeof identificador !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(identificador) ||
      (email !== undefined && !correoValido)) {
      return reply({ error: 'Operación o perfil inválido.' }, 400);
    }
    const { data: perfil, error } = await db.from('usuarios').select('id, auth_user_id')
      .eq(porCuenta ? 'auth_user_id' : 'id', identificador).maybeSingle();
    if (error) return reply({ error: 'No se pudo consultar el perfil.' }, 500);
    if (!perfil) {
      if (!porCuenta || !['editar', 'eliminar'].includes(accion)) {
        return reply({ error: 'Perfil no encontrado.' }, 404);
      }
      if (accion === 'eliminar') {
        const { error } = await admin.deleteUser(identificador);
        if (error) return reply({ error: 'Auth rechazó la eliminación de la cuenta.' }, 409);
        await auditar('DELETE', identificador, 'Cuenta de Auth sin perfil eliminada.');
        return reply({ id: identificador });
      }
      if (email !== undefined || password !== undefined) {
        const { error } = await admin.updateUserById(identificador, {
          ...(email !== undefined ? { email: email.trim(), email_confirm: true } : {}),
          ...(password !== undefined ? { password } : {}),
        });
        if (error) return reply({ error: 'Auth rechazó el correo o la contraseña.' }, 409);
        await auditar('UPDATE', identificador, 'Credenciales de Auth actualizadas.');
      }
      if (body.vincular === true) {
        const { data: cuenta, error: cuentaError } = await admin.getUserById(identificador);
        if (cuentaError || !cuenta.user) return reply({ error: 'No se pudo consultar la cuenta de Auth.' }, 409);
        const { data, error } = await crearPerfil(identificador, cuenta.user.email, nombre, rol);
        if (error) return reply({ error: 'No se pudo vincular el perfil. Vuelve a cargar la lista.' }, 409);
        await auditar('INSERT', data.id, 'Cuenta existente de Auth vinculada al SGDE.');
        return reply({ id: data.id });
      }
      return reply({ id: identificador });
    }
    const cuentaId = perfil.auth_user_id;
    const { id } = perfil;
    if (id === actor.id && (accion === 'eliminar' || accion === 'estado' ||
      (editarPerfil && rol !== 'admin'))) {
      return reply({ error: 'Tu propia cuenta debe conservar el acceso de administrador.' }, 409);
    }

    if (accion === 'editar' || accion === 'cambiar_clave') {
      if ((!cuentaId && (email !== undefined || password !== undefined)) ||
        (accion === 'cambiar_clave' && password === undefined)) {
        return reply({ error: 'Se requiere una cuenta vinculada y credenciales válidas.' }, 400);
      }
      if (editarPerfil) {
        const { error } = await db.from('usuarios').update({
          nombre: nombre.trim(), rol,
        }).eq('id', id);
        if (error) return reply({ error: 'No se pudo guardar el perfil. Debe quedar un administrador activo.' }, 409);
        await auditar('UPDATE', id, 'Perfil actualizado.');
      }
      if (email !== undefined || password !== undefined) {
        const { error } = await admin.updateUserById(cuentaId, {
          ...(email !== undefined ? { email: email.trim(), email_confirm: true } : {}),
          ...(password !== undefined ? { password } : {}),
        });
        if (error) return reply({ error: editarPerfil ?
          'Se guardó el perfil, pero Auth rechazó el correo o la contraseña.' :
          'Auth rechazó la contraseña.' }, 409);
        await auditar('UPDATE', id, 'Credenciales de Auth actualizadas.');
      }
      return reply({ id });
    }

    if (!cuentaId || (accion === 'estado' && typeof body.activo !== 'boolean')) {
      return reply({ error: 'Se requiere una cuenta de Auth vinculada y un estado válido.' }, 400);
    }
    const activar = accion === 'estado' && body.activo;
    const cambiarEstadoPerfil = (activo: boolean) => db.from('usuarios').update({ activo })
      .eq('id', id).eq('auth_user_id', cuentaId).select('id').single();
    if (!activar) {
      const { error } = await cambiarEstadoPerfil(false);
      if (error) return reply({ error: 'No se pudo desactivar el perfil. Debe quedar un administrador activo.' }, 409);
    }
    if (accion === 'eliminar') {
      const { error } = await admin.deleteUser(cuentaId);
      if (error) return reply({ error: 'El perfil quedó inactivo. Auth rechazó la eliminación de la cuenta.' }, 409);
      await auditar('DELETE', id, 'Cuenta de Auth eliminada. Perfil conservado.');
      return reply({ id });
    }

    const { error: bloqueoError } = await admin.updateUserById(cuentaId, {
      ban_duration: activar ? 'none' : '876000h',
    });
    if (bloqueoError) return reply({ error: activar ? 'Auth rechazó la activación.' :
      'El perfil quedó inactivo. Auth rechazó el bloqueo de la cuenta.' }, 409);
    if (activar) {
      const { error } = await cambiarEstadoPerfil(true);
      if (error) return reply({ error: 'Auth desbloqueó la cuenta, pero el perfil sigue inactivo.' }, 409);
    }
    await auditar('UPDATE', id, activar ? 'Cuenta activada.' : 'Cuenta desactivada.');
    return reply({ id });
  } catch (error) {
    console.error('Falló la administración de usuarios:', error instanceof Error ? error.name : 'error');
    return reply({ error: 'No se pudo completar la operación.' }, 500);
  }
});
