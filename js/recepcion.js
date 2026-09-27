let PRODUCTOS_RECEPCION = [];
let ACTAS_CACHE = [];

document.addEventListener('DOMContentLoaded', async () => {
    const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
    document.getElementById('rc-fecha').value = new Date().toISOString().slice(0, 10);
    document.getElementById('rc-recibido-por').value = sesion?.nombre || '';
    await cargarProductos();
    agregarFilaProducto();
    await cargarRecepciones();
    document.getElementById('btn-agregar-producto').addEventListener('click', agregarFilaProducto);
    document.querySelector('#tabla-detalle-editor tbody').addEventListener('change', manejarCambioDetalle);
    document.querySelector('#tabla-detalle-editor tbody').addEventListener('click', manejarClickDetalle);
    document.querySelector('#tabla-recepciones tbody').addEventListener('click', manejarAccionActa);
    document.getElementById('form-recepcion').addEventListener('submit', guardarActa);
    document.getElementById('btn-cancelar-edicion-acta').addEventListener('click', reiniciarFormularioActa);
});

function escapar(texto) {
    return String(texto ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]);
}

async function cargarProductos() {
    const { data, error } = await supabaseClient.from('productos')
        .select('id,codigo,nombre,presentacion,concentracion_forma,fabricante,procedencia,reg_sanitario,condicion_almacen,dam,lote,fecha_venc,estado_embalaje').order('nombre');
    if (error) {
        manejarErrorSupabase(error, 'No se pudo cargar el catálogo. Ejecuta primero sql/migracion_actas_kardex_excel.sql en Supabase.');
        return;
    }
    PRODUCTOS_RECEPCION = data || [];
}

function opcionesProductos() {
    return '<option value="">Seleccionar...</option>' + PRODUCTOS_RECEPCION.map(p =>
        `<option value="${p.id}">${escapar(p.codigo)} - ${escapar(p.nombre)}</option>`).join('');
}

function agregarFilaProducto() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="number" min="0" step="any" class="form-control form-control-sm campo-manual cant-solicitada" value="0"></td>
        <td><input type="number" min="0.01" step="any" class="form-control form-control-sm campo-manual cant-recibida" required></td>
        <td><select class="form-control form-control-sm campo-manual producto-select" required>${opcionesProductos()}</select></td>
        <td><span class="dato-producto dato-nombre"></span></td><td><span class="dato-producto dato-presentacion"></span></td>
        <td><span class="dato-producto dato-concentracion"></span></td><td><span class="dato-producto dato-fabricante"></span></td>
        <td><span class="dato-producto dato-procedencia"></span></td>
        <td><input type="text" class="form-control form-control-sm campo-manual lote"></td>
        <td><input type="date" class="form-control form-control-sm campo-manual fecha-venc"></td>
        <td><span class="dato-producto dato-registro"></span></td><td><span class="dato-producto dato-condicion"></span></td>
        <td><select class="form-control form-control-sm campo-manual estado"><option>CONFORME</option><option>NO CONFORME</option></select></td>
        <td><button type="button" class="btn btn-outline-danger btn-sm quitar-fila" title="Quitar"><i class="fas fa-times"></i></button></td>`;
    document.querySelector('#tabla-detalle-editor tbody').appendChild(tr);
    actualizarContadorProductos();
}

function actualizarContadorProductos() {
    const total = document.querySelectorAll('#tabla-detalle-editor tbody tr').length;
    const contador = document.getElementById('contador-productos-acta');
    if (contador) contador.textContent = `${total} ${total === 1 ? 'producto' : 'productos'}`;
}

function manejarCambioDetalle(e) {
    if (!e.target.classList.contains('producto-select')) return;
    const tr = e.target.closest('tr');
    const p = PRODUCTOS_RECEPCION.find(item => item.id === e.target.value);
    const valores = { '.dato-nombre':p?.nombre, '.dato-presentacion':p?.presentacion, '.dato-concentracion':p?.concentracion_forma,
        '.dato-fabricante':p?.fabricante, '.dato-procedencia':p?.procedencia, '.dato-registro':p?.reg_sanitario,
        '.dato-condicion':p?.condicion_almacen };
    Object.entries(valores).forEach(([selector, valor]) => { tr.querySelector(selector).textContent = valor || ''; });
    tr.querySelector('.lote').value = p?.lote || '';
    tr.querySelector('.fecha-venc').value = p?.fecha_venc || '';
    tr.querySelector('.estado').value = p?.estado_embalaje || 'CONFORME';
}

function manejarClickDetalle(e) {
    const boton = e.target.closest('.quitar-fila');
    if (!boton) return;
    if (document.querySelectorAll('#tabla-detalle-editor tbody tr').length === 1) return alert('El acta debe tener al menos un producto.');
    boton.closest('tr').remove();
    actualizarContadorProductos();
}

function leerDetalles() {
    return [...document.querySelectorAll('#tabla-detalle-editor tbody tr')].map(tr => ({
        producto_id: tr.querySelector('.producto-select').value,
        cant_solicitada: Number(tr.querySelector('.cant-solicitada').value || 0),
        cant_recibida: Number(tr.querySelector('.cant-recibida').value || 0),
        lote: tr.querySelector('.lote').value.trim(), fecha_venc: tr.querySelector('.fecha-venc').value || null,
        estado_embalaje: tr.querySelector('.estado').value
    }));
}

async function guardarActa(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector('button[type="submit"]');
    const detalles = leerDetalles();
    const actaId = document.getElementById('rc-id').value;
    if (!detalles.length || detalles.some(d => !d.producto_id || d.cant_recibida <= 0)) {
        alert('Selecciona cada producto e ingresa una cantidad recibida mayor que cero.'); return;
    }
    const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
    const cabecera = {
        fecha: document.getElementById('rc-fecha').value, guia_numero: document.getElementById('rc-guia').value.trim(),
        proveedor: document.getElementById('rc-proveedor').value.trim(), tipo_ingreso: document.getElementById('rc-tipo').value,
        usuario_registro: sesion.usuario, transportista_nombre: document.getElementById('rc-transportista').value.trim(),
        entrega_inicio: document.getElementById('rc-entrega-inicio').value || null,
        entrega_termino: document.getElementById('rc-entrega-termino').value || null,
        recibido_por: document.getElementById('rc-recibido-por').value.trim(),
        recepcion_inicio: document.getElementById('rc-recepcion-inicio').value || null,
        recepcion_termino: document.getElementById('rc-recepcion-termino').value || null
    };
    btn.disabled = true;
    try {
        const { data: recepcionId, error } = actaId
            ? await supabaseClient.rpc('actualizar_acta_completa', { p_recepcion_id:actaId, p_cabecera:cabecera, p_detalles:detalles })
            : await supabaseClient.rpc('registrar_recepcion_completa', { p_cabecera:cabecera, p_detalles:detalles });
        if (error) throw error;
        await registrarAuditoria(actaId ? 'UPDATE' : 'INSERT', 'recepciones', actaId || recepcionId,
            `Acta ${cabecera.guia_numero} con ${detalles.length} producto(s); Kardex actualizado`);
        alert(actaId ? 'Acta y Kardex actualizados.' : 'Acta registrada y Kardex actualizado.');
        reiniciarFormularioActa();
        await cargarRecepciones();
    } catch (err) {
        manejarErrorSupabase(err, err?.code === 'PGRST202'
            ? `Falta ejecutar ${actaId ? 'sql/migracion_edicion_actas.sql' : 'sql/migracion_actas_kardex_excel.sql'} en Supabase.`
            : `No se pudo ${actaId ? 'actualizar' : 'registrar'} el acta: ${err?.message || 'error desconocido'}`);
    } finally { btn.disabled = false; }
}

function reiniciarFormularioActa() {
    const form = document.getElementById('form-recepcion');
    form.reset();
    document.getElementById('rc-id').value = '';
    document.getElementById('rc-fecha').value = new Date().toISOString().slice(0, 10);
    document.getElementById('rc-recibido-por').value = JSON.parse(localStorage.getItem('sesion_usuario') || 'null')?.nombre || '';
    document.querySelector('#tabla-detalle-editor tbody').innerHTML = '';
    agregarFilaProducto();
    document.getElementById('btn-guardar-acta').innerHTML = '<i class="fas fa-save"></i> Registrar acta y generar Kardex';
    document.getElementById('btn-cancelar-edicion-acta').classList.add('d-none');
}

async function cargarRecepciones() {
    const { data, error } = await supabaseClient.from('recepciones')
        .select('id,fecha,guia_numero,proveedor,tipo_ingreso,usuario_registro,recepcion_detalle(id)')
        .order('created_at', { ascending:false }).limit(15);
    if (error) return manejarErrorSupabase(error);
    ACTAS_CACHE = data || [];
    document.querySelector('#tabla-recepciones tbody').innerHTML = ACTAS_CACHE.map(r => `<tr>
        <td>${escapar(r.fecha)}</td><td>${escapar(r.guia_numero)}</td><td>${escapar(r.proveedor)}</td><td>${escapar(r.tipo_ingreso)}</td>
        <td>${r.recepcion_detalle?.length || 0}</td><td>${escapar(r.usuario_registro)}</td><td class="text-nowrap">
        <button class="btn btn-info btn-sm ver-acta" data-id="${r.id}"><i class="fas fa-eye"></i> Ver</button>
        <button class="btn btn-success btn-sm descargar-acta" data-id="${r.id}"><i class="fas fa-file-excel"></i> Excel</button>
        <button class="btn btn-outline-primary btn-sm editar-acta solo-escritura" data-id="${r.id}"><i class="fas fa-pen"></i> Editar</button>
        <button class="btn btn-outline-danger btn-sm eliminar-acta solo-escritura" data-id="${r.id}"><i class="fas fa-trash"></i> Eliminar</button></td></tr>`).join('');
    if (JSON.parse(localStorage.getItem('sesion_usuario') || 'null')?.rol === 'auxiliar') {
        document.querySelectorAll('#tabla-recepciones .solo-escritura').forEach(boton => boton.style.display = 'none');
    }
}

async function obtenerActaCompleta(id) {
    // Se consulta por partes para no depender de la relación embebida de
    // PostgREST, que puede no estar disponible hasta refrescar su caché.
    const { data: acta, error: errorActa } = await supabaseClient
        .from('recepciones').select('*').eq('id', id).single();
    if (errorActa) throw errorActa;

    const { data: detalles, error: errorDetalles } = await supabaseClient
        .from('recepcion_detalle').select('*').eq('recepcion_id', id).order('created_at', { ascending: true });
    if (errorDetalles) {
        // Algunas instalaciones antiguas no tienen created_at en el detalle.
        const { data: detallesSinOrden, error: errorAlternativo } = await supabaseClient
            .from('recepcion_detalle').select('*').eq('recepcion_id', id);
        if (errorAlternativo) throw errorAlternativo;
        return completarProductosActa(acta, detallesSinOrden || []);
    }

    return completarProductosActa(acta, detalles || []);
}

async function completarProductosActa(acta, detalles) {
    const idsProductos = [...new Set(detalles.map(d => d.producto_id).filter(Boolean))];
    let productos = [];
    if (idsProductos.length) {
        const { data, error } = await supabaseClient.from('productos')
            .select('id,codigo,nombre,presentacion,concentracion_forma,fabricante,procedencia,reg_sanitario,condicion_almacen,dam')
            .in('id', idsProductos);
        if (error) throw error;
        productos = data || [];
    }
    const productosPorId = new Map(productos.map(p => [String(p.id), p]));
    return {
        ...acta,
        recepcion_detalle: detalles.map(detalle => ({
            ...detalle,
            productos: productosPorId.get(String(detalle.producto_id)) || null
        }))
    };
}

async function manejarAccionActa(e) {
    const boton = e.target.closest('.ver-acta, .descargar-acta, .editar-acta, .eliminar-acta');
    if (!boton) return;
    const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
    if ((boton.classList.contains('editar-acta') || boton.classList.contains('eliminar-acta')) && sesion?.rol === 'auxiliar') return;
    if (boton.classList.contains('eliminar-acta')) {
        const acta = ACTAS_CACHE.find(item => item.id === boton.dataset.id);
        if (!confirm(`¿Eliminar el acta ${acta?.guia_numero || ''}? También se quitarán sus movimientos de Kardex y se recalculará el stock.`)) return;
        boton.disabled = true;
        try {
            const { error } = await supabaseClient.rpc('eliminar_acta_completa', { p_recepcion_id:boton.dataset.id });
            if (error) throw error;
            await registrarAuditoria('DELETE', 'recepciones', boton.dataset.id, `Acta eliminada: ${acta?.guia_numero || ''}; Kardex y stock recalculados`);
            if (document.getElementById('rc-id').value === boton.dataset.id) reiniciarFormularioActa();
            await cargarRecepciones();
        } catch (err) { manejarErrorSupabase(err, `No se pudo eliminar el acta: ${err?.message || 'error desconocido'}`); }
        finally { boton.disabled = false; }
        return;
    }
    boton.disabled = true;
    try {
        const acta = await obtenerActaCompleta(boton.dataset.id);
        if (boton.classList.contains('descargar-acta')) await SGDEExcel.exportarActaExcel(acta);
        else if (boton.classList.contains('editar-acta')) cargarActaEnFormulario(acta);
        else mostrarDetalleActa(acta);
    } catch (err) {
        console.error('[Acta/Excel] No se pudo preparar el acta:', err);
        manejarErrorSupabase(err, `No se pudo preparar el acta para descargar: ${err?.message || 'error desconocido'}`);
    }
    finally { boton.disabled = false; }
}

function cargarActaEnFormulario(acta) {
    const campos = {
        'rc-guia':acta.guia_numero, 'rc-proveedor':acta.proveedor, 'rc-fecha':acta.fecha,
        'rc-tipo':acta.tipo_ingreso, 'rc-transportista':acta.transportista_nombre,
        'rc-entrega-inicio':acta.entrega_inicio?.slice(0, 16), 'rc-entrega-termino':acta.entrega_termino?.slice(0, 16),
        'rc-recibido-por':acta.recibido_por, 'rc-recepcion-inicio':acta.recepcion_inicio?.slice(0, 16),
        'rc-recepcion-termino':acta.recepcion_termino?.slice(0, 16)
    };
    Object.entries(campos).forEach(([id, valor]) => { document.getElementById(id).value = valor || ''; });
    const tbody = document.querySelector('#tabla-detalle-editor tbody');
    tbody.innerHTML = '';
    for (const detalle of acta.recepcion_detalle || []) {
        agregarFilaProducto();
        const fila = tbody.lastElementChild;
        fila.querySelector('.producto-select').value = detalle.producto_id || '';
        fila.querySelector('.producto-select').dispatchEvent(new Event('change', { bubbles:true }));
        fila.querySelector('.cant-solicitada').value = detalle.cant_solicitada ?? 0;
        fila.querySelector('.cant-recibida').value = detalle.cant_recibida ?? 0;
        fila.querySelector('.lote').value = detalle.lote || '';
        fila.querySelector('.fecha-venc').value = detalle.fecha_venc || '';
        fila.querySelector('.estado').value = detalle.estado_embalaje || 'CONFORME';
    }
    document.getElementById('rc-id').value = acta.id;
    document.getElementById('btn-guardar-acta').innerHTML = '<i class="fas fa-save"></i> Guardar cambios del acta';
    document.getElementById('btn-cancelar-edicion-acta').classList.remove('d-none');
    document.getElementById('form-recepcion').scrollIntoView({ behavior:'smooth', block:'start' });
}

function mostrarDetalleActa(acta) {
    document.getElementById('modal-detalle-acta')?.remove();
    const filas = (acta.recepcion_detalle || []).map(d => {
        const p = { ...(d.productos || {}), ...(d.producto_snapshot || {}) };
        return `<tr><td>${escapar(p.codigo)}</td><td>${escapar(p.nombre)}</td><td>${escapar(d.lote)}</td><td>${escapar(d.fecha_venc)}</td>
            <td>${d.cant_solicitada || 0}</td><td>${d.cant_recibida || 0}</td><td>${escapar(d.estado_embalaje)}</td></tr>`;
    }).join('');
    document.body.insertAdjacentHTML('beforeend', `<div class="modal fade" id="modal-detalle-acta" tabindex="-1"><div class="modal-dialog modal-xl"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">Acta ${escapar(acta.guia_numero)}</h5><button class="close" data-dismiss="modal">&times;</button></div>
      <div class="modal-body"><p><strong>Fecha:</strong> ${escapar(acta.fecha)} &nbsp; <strong>Proveedor:</strong> ${escapar(acta.proveedor)} &nbsp; <strong>Tipo:</strong> ${escapar(acta.tipo_ingreso)}</p>
      <div class="table-responsive"><table class="table table-bordered table-sm"><thead><tr><th>Código</th><th>Producto</th><th>Lote</th><th>Vencimiento</th><th>Solicitada</th><th>Recibida</th><th>Embalaje</th></tr></thead><tbody>${filas}</tbody></table></div></div>
      <div class="modal-footer"><button class="btn btn-secondary" data-dismiss="modal">Cerrar</button></div></div></div></div>`);
    $('#modal-detalle-acta').modal('show').on('hidden.bs.modal', function () { this.remove(); });
}
