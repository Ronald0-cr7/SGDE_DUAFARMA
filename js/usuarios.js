let usuariosRegistrados = new Map();

document.addEventListener('DOMContentLoaded', async () => {
    await cargarUsuarios();

    const form = document.getElementById('form-usuario');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
            const registro = {
                username: document.getElementById('us-username').value.trim(),
                password: document.getElementById('us-password').value.trim(),
                nombre: document.getElementById('us-nombre').value.trim(),
                rol: document.getElementById('us-rol').value
            };
            const { data, error } = await supabaseClient.from('usuarios').insert([registro]).select().single();
            if (error) throw error;
            await registrarAuditoria('INSERT', 'usuarios', data.id, `Usuario creado: ${registro.username} (${registro.rol})`);
            alert('✅ Usuario creado.');
            form.reset();
            await cargarUsuarios();
        } catch (err) {
            manejarErrorSupabase(err, 'No se pudo crear el usuario. (¿El username ya existe?)');
        } finally {
            btn.disabled = false;
        }
    });

    document.getElementById('form-editar-usuario').addEventListener('submit', actualizarUsuario);
});

async function cargarUsuarios() {
    const { data, error } = await supabaseClient.from('usuarios').select('*').order('created_at');
    if (error) return manejarErrorSupabase(error);

    usuariosRegistrados = new Map(data.map(usuario => [String(usuario.id), usuario]));
    const tbody = document.querySelector('#tabla-usuarios tbody');
    tbody.innerHTML = data.map(u => `
        <tr>
            <td>${u.username}</td><td>${u.nombre}</td>
            <td><span class="badge badge-primary">${u.rol}</span></td>
            <td>${u.activo ? '✅' : '❌'}</td>
            <td class="text-nowrap">
                <button type="button" class="btn btn-sm btn-outline-primary mr-1" onclick="abrirEditarUsuario('${u.id}')">
                    <i class="fas fa-user-edit"></i> Actualizar
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="toggleActivo('${u.id}', ${u.activo})">
                    ${u.activo ? 'Desactivar' : 'Activar'}
                </button>
            </td>
        </tr>`).join('');
}

function abrirEditarUsuario(id) {
    const usuario = usuariosRegistrados.get(String(id));
    if (!usuario) return;

    document.getElementById('edit-us-id').value = usuario.id;
    document.getElementById('edit-us-username').value = usuario.username;
    document.getElementById('edit-us-nombre').value = usuario.nombre;
    document.getElementById('edit-us-rol').value = usuario.rol;
    document.getElementById('edit-us-password').value = '';
    $('#modal-editar-usuario').modal('show');
}

async function actualizarUsuario(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector('button[type="submit"]');
    const id = document.getElementById('edit-us-id').value;
    const usuarioAnterior = usuariosRegistrados.get(String(id));
    const cambios = {
        username: document.getElementById('edit-us-username').value.trim(),
        nombre: document.getElementById('edit-us-nombre').value.trim(),
        rol: document.getElementById('edit-us-rol').value
    };
    const nuevaPassword = document.getElementById('edit-us-password').value.trim();
    if (nuevaPassword) cambios.password = nuevaPassword;

    btn.disabled = true;
    try {
        const { error } = await supabaseClient.from('usuarios').update(cambios).eq('id', id);
        if (error) throw error;
        await registrarAuditoria('UPDATE', 'usuarios', id, `Usuario actualizado: ${cambios.username} (${cambios.rol})`);

        const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
        if (sesion && usuarioAnterior && sesion.usuario === usuarioAnterior.username) {
            const accesosPorRol = {
                admin: ['dashboard', 'recepcion', 'productos', 'kardex', 'documentos', 'repositorios', 'auditoria', 'usuarios'],
                asistente: ['dashboard', 'recepcion', 'productos', 'kardex', 'documentos', 'repositorios'],
                auxiliar: ['dashboard', 'productos', 'kardex', 'documentos', 'repositorios']
            };
            localStorage.setItem('sesion_usuario', JSON.stringify({
                ...sesion,
                usuario: cambios.username,
                nombre: cambios.nombre,
                rol: cambios.rol,
                acceso: accesosPorRol[cambios.rol] || []
            }));
        }

        $('#modal-editar-usuario').modal('hide');
        alert('Usuario actualizado correctamente.');
        if (sesion && usuarioAnterior && sesion.usuario === usuarioAnterior.username && cambios.rol !== 'admin') {
            window.location.href = 'dashboard.html';
            return;
        }
        await cargarUsuarios();
    } catch (err) {
        manejarErrorSupabase(err, 'No se pudo actualizar el usuario. (¿El username ya existe?)');
    } finally {
        btn.disabled = false;
    }
}

async function toggleActivo(id, activoActual) {
    try {
        const { error } = await supabaseClient.from('usuarios').update({ activo: !activoActual }).eq('id', id);
        if (error) throw error;
        await registrarAuditoria('UPDATE', 'usuarios', id, `Usuario ${!activoActual ? 'activado' : 'desactivado'}`);
        await cargarUsuarios();
    } catch (err) {
        manejarErrorSupabase(err);
    }
}
