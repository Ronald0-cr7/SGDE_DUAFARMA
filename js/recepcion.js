// ============================================================
// recepcion.js — Al registrar la recepción de un producto:
//  1) crea la cabecera del Acta (recepciones)
//  2) crea el detalle (recepcion_detalle)
//  3) genera automáticamente el movimiento de Kardex correspondiente
//     (el saldo se calcula solo mediante el trigger de la BD)
//  4) registra todo en la bitácora de auditoría (6.2.5.16)
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
    await cargarProductos();
    await cargarRecepciones();

    const form = document.getElementById('form-recepcion');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;

        try {
            const productoId = document.getElementById('rc-producto').value;
            const guia = document.getElementById('rc-guia').value.trim();
            const proveedor = document.getElementById('rc-proveedor').value.trim();
            const tipo = document.getElementById('rc-tipo').value;
            const lote = document.getElementById('rc-lote').value.trim();
            const venc = document.getElementById('rc-venc').value || null;
            const solicit = parseFloat(document.getElementById('rc-solicit').value) || 0;
            const recib = parseFloat(document.getElementById('rc-recib').value) || 0;
            const estado = document.getElementById('rc-estado').value;

            // 1) cabecera del acta
            const { data: recepcion, error: e1 } = await supabaseClient
                .from('recepciones')
                .insert([{ guia_numero: guia, proveedor, tipo_ingreso: tipo, usuario_registro: sesion.usuario }])
                .select().single();
            if (e1) throw e1;
            await registrarAuditoria('INSERT', 'recepciones', recepcion.id, `Acta de recepción ${guia} - ${proveedor}`);

            // 2) detalle del acta
            const { data: detalle, error: e2 } = await supabaseClient
                .from('recepcion_detalle')
                .insert([{
                    recepcion_id: recepcion.id, producto_id: productoId, lote,
                    fecha_venc: venc, cant_solicitada: solicit, cant_recibida: recib, estado_embalaje: estado
                }]).select().single();
            if (e2) throw e2;
            await registrarAuditoria('INSERT', 'recepcion_detalle', detalle.id, `Producto recibido, cantidad ${recib}`);

            // 3) movimiento de kardex (el saldo lo calcula el trigger fn_calcular_saldo_kardex)
            const { data: mov, error: e3 } = await supabaseClient
                .from('kardex_movimientos')
                .insert([{
                    producto_id: productoId, guia_numero: guia, proveedor_cliente: proveedor,
                    lote, fecha_venc: venc, ingreso: recib, salida: 0,
                    observaciones: estado, realizado_por: sesion.nombre
                }]).select().single();
            if (e3) throw e3;
            await registrarAuditoria('INSERT', 'kardex_movimientos', mov.id, `Ingreso automático de ${recib} unidades (saldo: ${mov.saldo})`);

            alert('✅ Acta registrada y Kardex actualizado automáticamente.');
            form.reset();
            await cargarRecepciones();
        } catch (err) {
            manejarErrorSupabase(err, 'No se pudo registrar la recepción.');
        } finally {
            btn.disabled = false;
        }
    });
});

async function cargarProductos() {
    const { data, error } = await supabaseClient.from('productos').select('id, codigo, nombre').order('nombre');
    if (error) return manejarErrorSupabase(error);
    const sel = document.getElementById('rc-producto');
    sel.innerHTML = data.map(p => `<option value="${p.id}">${p.codigo} - ${p.nombre}</option>`).join('');
}

async function cargarRecepciones() {
    const { data, error } = await supabaseClient
        .from('recepciones')
        .select('fecha, guia_numero, proveedor, tipo_ingreso, usuario_registro')
        .order('created_at', { ascending: false })
        .limit(15);
    if (error) return manejarErrorSupabase(error);
    const tbody = document.querySelector('#tabla-recepciones tbody');
    tbody.innerHTML = data.map(r => `
        <tr>
            <td>${r.fecha}</td><td>${r.guia_numero || ''}</td><td>${r.proveedor || ''}</td>
            <td>${r.tipo_ingreso || ''}</td><td>${r.usuario_registro}</td>
        </tr>`).join('');
}
