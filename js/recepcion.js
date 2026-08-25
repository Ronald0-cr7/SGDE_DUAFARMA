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
        recepcion_termino: document.getElementById('rc-recepcion-termino').value || null,
        director_tecnico: document.getElementById('rc-director').value.trim()
    };
    btn.disabled = true;
    try {
        const { data: recepcionId, error } = await supabaseClient.rpc('registrar_recepcion_completa', { p_cabecera:cabecera, p_detalles:detalles });
        if (error) throw error;
        await registrarAuditoria('INSERT', 'recepciones', recepcionId, `Acta ${cabecera.guia_numero} con ${detalles.length} producto(s); Kardex generado automáticamente`);
        alert('✅ Acta registrada y Kardex de cada producto actualizado.');
        form.reset();
        document.getElementById('rc-fecha').value = new Date().toISOString().slice(0, 10);
        document.getElementById('rc-recibido-por').value = sesion.nombre || '';
        document.querySelector('#tabla-detalle-editor tbody').innerHTML = '';
        agregarFilaProducto(); await cargarRecepciones();
    } catch (err) {
        manejarErrorSupabase(err, err?.message?.includes('registrar_recepcion_completa')
            ? 'Falta ejecutar sql/migracion_actas_kardex_excel.sql en Supabase.' : 'No se pudo registrar el acta. No se guardó ningún producto.');
    } finally { btn.disabled = false; }
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
        <button class="btn btn-success btn-sm descargar-acta" data-id="${r.id}"><i class="fas fa-file-excel"></i> Excel</button></td></tr>`).join('');
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
    const boton = e.target.closest('.ver-acta, .descargar-acta');
    if (!boton) return;
    boton.disabled = true;
    try {
        const acta = await obtenerActaCompleta(boton.dataset.id);
        if (boton.classList.contains('descargar-acta')) await SGDEExcel.exportarActaExcel(acta); else mostrarDetalleActa(acta);
    } catch (err) {
        console.error('[Acta/Excel] No se pudo preparar el acta:', err);
        manejarErrorSupabase(err, `No se pudo preparar el acta para descargar: ${err?.message || 'error desconocido'}`);
    }
    finally { boton.disabled = false; }
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
