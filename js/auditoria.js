document.addEventListener('DOMContentLoaded', async () => {
    const { data, error } = await supabaseClient
        .from('log_auditoria')
        .select('*')
        .order('fecha', { ascending: false })
        .limit(200);
    if (error) return manejarErrorSupabase(error);

    const tbody = document.querySelector('#tabla-auditoria tbody');
    tbody.innerHTML = data.map(r => `
        <tr>
            <td>${new Date(r.fecha).toLocaleString('es-PE')}</td>
            <td>${r.usuario}</td>
            <td><span class="badge badge-info">${r.accion}</span></td>
            <td>${r.tabla}</td>
            <td>${r.detalle || ''}</td>
        </tr>`).join('');
});
