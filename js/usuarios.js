let usuariosRegistrados = new Map();

async function administrarUsuarios(body) {
    const { data, error } = await supabaseClient.functions.invoke('sgde-usuarios', { body });
    if (error) {
        const respuesta = await error.context?.json?.().catch(() => null);
        throw new Error(respuesta?.error || 'No se pudo comunicar con la administración de usuarios.');
    }
    return data;
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.perfilSGDEListo) return;
    await cargarUsuarios();

    const form = document.getElementById('form-usuario');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
            const registro = {
                email: document.getElementById('us-email').value.trim(),
                password: document.getElementById('us-password').value,
                nombre: document.getElementById('us-nombre').value.trim(),
                rol: document.getElementById('us-rol').value
            };
            await administrarUsuarios({ accion: 'crear', ...registro });
            alert('✅ Usuario creado.');
            form.reset();
            await cargarUsuarios();
        } catch (err) {
            manejarErrorSupabase(err, err.message);
        } finally {
            btn.disabled = false;
        }
    });

    document.getElementById('form-editar-usuario').addEventListener('submit', actualizarUsuario);
    document.getElementById('edit-us-vincular').addEventListener('change', actualizarCamposPerfil);
});

async function cargarUsuarios() {
    const estado = document.getElementById('estado-usuarios');
    estado.hidden = false;
    estado.textContent = 'Cargando cuentas de Authentication…';
    let resultado;
    try {
        resultado = await administrarUsuarios({ accion: 'listar' });
        if (!Array.isArray(resultado?.usuarios)) throw new Error('La función no devolvió la lista de cuentas.');
    } catch (error) {
        estado.textContent = error.message.includes('12 caracteres')
            ? 'La función sgde-usuarios desplegada en Supabase todavía no admite el listado. Actualízala y recarga esta página.'
            : `No se pudo cargar la lista. ${error.message}`;
        return;
    }
    const { usuarios: data, administrador_id } = resultado;
    estado.hidden = data.length > 0;
    estado.textContent = data.length ? '' : 'No hay cuentas ni perfiles para mostrar.';
    usuariosRegistrados = new Map(data.map(usuario => [usuario.id || usuario.auth_user_id, usuario]));
    const tbody = document.querySelector('#tabla-usuarios tbody');
    tbody.innerHTML = data.map(u => `
        <tr>
            <td></td><td></td>
            <td><span class="badge badge-primary">${u.rol || 'Sin perfil'}</span></td>
            <td>${u.activo && u.auth_user_id ? 'Sí' : 'No'}</td>
            <td class="text-nowrap">
                <button type="button" class="btn btn-sm btn-outline-primary mr-1" onclick="abrirEditarUsuario('${u.id || u.auth_user_id}')">
                    <i class="fas fa-user-edit"></i> Actualizar
                </button>
                ${u.auth_user_id && u.id && u.id !== administrador_id ? `
                    <button type="button" class="btn btn-sm btn-outline-secondary mr-1" onclick="toggleActivo('${u.id}', ${u.activo}, this)">
                        ${u.activo ? 'Desactivar' : 'Activar'}
                    </button>` : ''}
                ${u.auth_user_id && u.id !== administrador_id ? `
                    <button type="button" class="btn btn-sm btn-outline-danger" onclick="eliminarUsuario('${u.id || u.auth_user_id}', this)">
                        Eliminar cuenta
                    </button>` : ''}
            </td>
        </tr>`).join('');
    data.forEach((usuario, index) => {
        tbody.rows[index].cells[0].textContent = usuario.email || (usuario.auth_user_id ? 'Sin correo' : 'Sin cuenta vinculada');
        tbody.rows[index].cells[1].textContent = usuario.nombre || '—';
    });
}

function abrirEditarUsuario(id) {
    const usuario = usuariosRegistrados.get(String(id));
    if (!usuario) return;

    document.getElementById('edit-us-id').value = id;
    document.getElementById('edit-us-nombre').value = usuario.nombre || '';
    document.getElementById('edit-us-rol').value = usuario.rol || '';
    document.getElementById('edit-us-vincular-grupo').hidden = Boolean(usuario.id);
    document.getElementById('edit-us-vincular').checked = false;
    actualizarCamposPerfil();
    const correo = document.getElementById('edit-us-email');
    correo.value = usuario.email || '';
    correo.disabled = !usuario.auth_user_id;
    const clave = document.getElementById('edit-us-password');
    clave.value = '';
    clave.disabled = !usuario.auth_user_id;
    $('#modal-editar-usuario').modal('show');
}

function actualizarCamposPerfil() {
    const id = document.getElementById('edit-us-id').value;
    const habilitar = usuariosRegistrados.get(id)?.id || document.getElementById('edit-us-vincular').checked;
    for (const campo of ['nombre', 'rol']) {
        document.getElementById(`edit-us-${campo}`).disabled = !habilitar;
    }
}

async function actualizarUsuario(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector('button[type="submit"]');
    const id = document.getElementById('edit-us-id').value;
    const cambios = {
        nombre: document.getElementById('edit-us-nombre').value.trim(),
        rol: document.getElementById('edit-us-rol').value
    };
    const nuevaPassword = document.getElementById('edit-us-password').value;
    const correo = document.getElementById('edit-us-email').value.trim();
    const usuario = usuariosRegistrados.get(id);
    if (!usuario) return;
    const vincular = !usuario.id && document.getElementById('edit-us-vincular').checked;

    btn.disabled = true;
    try {
        await administrarUsuarios({
            accion: 'editar',
            ...(usuario.id ? { id: usuario.id, ...cambios } : { auth_user_id: usuario.auth_user_id }),
            ...(vincular ? { vincular, ...cambios } : {}),
            ...(usuario.auth_user_id && correo !== (usuario.email || '') ? { email: correo } : {}),
            ...(nuevaPassword ? { password: nuevaPassword } : {})
        });
        const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
        if (sesion?.id === id) guardarPerfilSGDE({ id, username: usuario.username, ...cambios });

        $('#modal-editar-usuario').modal('hide');
        alert('Usuario actualizado correctamente.');
        await cargarUsuarios();
    } catch (err) {
        manejarErrorSupabase(err, err.message);
        await cargarUsuarios();
    } finally {
        btn.disabled = false;
    }
}

async function aplicarAccionUsuario(body, boton) {
    boton.disabled = true;
    try {
        await administrarUsuarios(body);
    } catch (err) {
        manejarErrorSupabase(err, err.message);
    } finally {
        await cargarUsuarios();
        boton.disabled = false;
    }
}

function toggleActivo(id, activoActual, boton) {
    return aplicarAccionUsuario({ accion: 'estado', id, activo: !activoActual }, boton);
}

function eliminarUsuario(id, boton) {
    const usuario = usuariosRegistrados.get(id);
    if (!usuario?.auth_user_id) return;
    if (!confirm(`¿Eliminar definitivamente la cuenta de ${usuario.email || usuario.username}? Se conservará su perfil inactivo para el historial.`)) return;
    return aplicarAccionUsuario({
        accion: 'eliminar',
        ...(usuario.id ? { id: usuario.id } : { auth_user_id: usuario.auth_user_id }),
    }, boton);
}
