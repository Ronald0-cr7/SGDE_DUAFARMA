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
});

async function cargarUsuarios() {
    const { data, error } = await supabaseClient.from('usuarios').select('*').order('created_at');
    if (error) return manejarErrorSupabase(error);

    const tbody = document.querySelector('#tabla-usuarios tbody');
    tbody.innerHTML = data.map(u => `
        <tr>
            <td>${u.username}</td><td>${u.nombre}</td>
            <td><span class="badge badge-primary">${u.rol}</span></td>
            <td>${u.activo ? '✅' : '❌'}</td>
            <td><button class="btn btn-sm btn-outline-danger" onclick="toggleActivo('${u.id}', ${u.activo})">
                ${u.activo ? 'Desactivar' : 'Activar'}</button></td>
        </tr>`).join('');
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
