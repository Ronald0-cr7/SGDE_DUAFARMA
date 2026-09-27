let PRODUCTOS_CACHE = [];
let KARDEX_ACTUAL = [];
let LOTES_SALIDA = [];
let CARGA_LOTES = 0;
let GUARDANDO_SALIDA = false;
let SOLICITUD_SALIDA = null;
let SALIDAS_PENDIENTES = [];
let FILTRO_FECHAS = { desde:'', hasta:'' };
let ELIMINANDO_KARDEX = false;

function kardexVisibles() {
    return PRODUCTOS_CACHE.filter(k=>(!FILTRO_FECHAS.desde || k.acta_fecha>=FILTRO_FECHAS.desde)
        && (!FILTRO_FECHAS.hasta || k.acta_fecha<=FILTRO_FECHAS.hasta));
}

async function aplicarFiltroFechas(e) {
    e?.preventDefault();
    const desde=document.getElementById('kx-desde').value;
    const hasta=document.getElementById('kx-hasta').value;
    if(desde && hasta && desde>hasta) return alert('La fecha desde no puede ser posterior a la fecha hasta.');
    FILTRO_FECHAS={desde,hasta};
    await renderSeleccionKardex();
}

async function renderSeleccionKardex() {
    const selector=document.getElementById('kx-producto');
    const anterior=selector.value;
    const visibles=kardexVisibles();
    selector.innerHTML=visibles.map(p=>`<option value="${p.id}">${escaparKardex(etiquetaKardex(p))}</option>`).join('');
    selector.value=visibles.some(k=>k.id===anterior)?anterior:(visibles[0]?.id||'');
    document.getElementById('kx-filtro-estado').textContent=visibles.length
        ? `${visibles.length} Kardex encontrados por fecha del acta.` : 'No hay Kardex en este rango de fechas.';
    renderListaKardex();
    await cargarKardex();
}

async function eliminarKardexSeleccionado() {
    const sesion=sesionPuedeRegistrarSalida();
    const kardex=PRODUCTOS_CACHE.find(k=>k.id===document.getElementById('kx-producto').value);
    if(!sesion || !kardex || ELIMINANDO_KARDEX) return;
    if(SOLICITUD_SALIDA) return alert('Confirma primero la salida pendiente.');
    if(Number(kardex.salidas_pendientes)>0) return alert('Asigna primero las salidas anteriores de este producto.');
    if(!confirm(`¿Eliminar el Kardex de ${kardex.nombre}, acta ${kardex.acta_guia || kardex.recepcion_id}? Se quitarán sus ingresos y ese producto del acta, y se recalculará el stock. Si el acta queda vacía también se eliminará. Los otros productos se conservan. No se permite si este Kardex tiene salidas.`)) return;
    ELIMINANDO_KARDEX=true;
    document.getElementById('kx-eliminar').disabled=true;
    try {
        const {error}=await supabaseClient.rpc('eliminar_kardex_acta',{
            p_recepcion_id:kardex.recepcion_id,p_producto_id:kardex.producto_id,p_usuario:sesion.usuario
        });
        if(error) throw error;
        try { await refrescarKardex(); }
        catch(error) { alert('El Kardex se eliminó. Recarga la página para actualizar la lista.'); return; }
        const aviso=document.getElementById('kx-resultado');
        aviso.textContent='Kardex eliminado y stock actualizado.';
        aviso.classList.remove('d-none');
    } catch(error) {
        manejarErrorSupabase(error,error.code==='PGRST202'?'Ejecuta sql/migracion_eliminar_kardex.sql en Supabase.':error.message);
    } finally {
        ELIMINANDO_KARDEX=false;
        document.getElementById('kx-eliminar').disabled=!document.getElementById('kx-producto').value;
    }
}

function etiquetaKardex(k) {
    return `${k.codigo} - ${k.nombre} | Acta: ${k.acta_guia || 'Sin guía'} | ${k.acta_fecha} | ${k.recepcion_id.slice(0,8)}`;
}

async function leerCatalogoKardex() {
    const filas = [];
    for (let desde=0;;desde+=1000) {
        const {data,error}=await supabaseClient.from('kardex_por_acta').select('*').order('id').range(desde,desde+999);
        if(error) throw error;
        filas.push(...(data || []).map(k=>({...k.producto,...k})));
        if(!data || data.length<1000) return filas;
    }
}

async function cargarSalidasPendientes() {
    SALIDAS_PENDIENTES = [];
    for(let desde=0;;desde+=1000) {
        const {data,error}=await supabaseClient.from('kardex_movimientos').select('*')
            .is('recepcion_id',null).gt('salida',0).order('created_at').order('id').range(desde,desde+999);
        if(error) throw error;
        SALIDAS_PENDIENTES.push(...(data||[]));
        if(!data || data.length<1000) break;
    }
    document.getElementById('salidas-pendientes').classList.toggle('d-none',!SALIDAS_PENDIENTES.length);
    document.querySelector('#tabla-salidas-pendientes tbody').innerHTML = SALIDAS_PENDIENTES.map(m=>{
        const actas=PRODUCTOS_CACHE.filter(k=>k.producto_id===m.producto_id);
        return `<tr><td>${escaparKardex(actas[0]?.nombre || m.producto_id)}</td><td>${escaparKardex(m.fecha)}</td><td>${escaparKardex(m.lote)}</td><td>${escaparKardex(m.proveedor_cliente)}</td><td>${Number(m.salida)}</td>
        <td><select class="form-control" id="asignar-${m.id}"><option value="">Selecciona el acta de origen</option>${actas.map(k=>`<option value="${k.recepcion_id}">${escaparKardex(etiquetaKardex(k))}</option>`).join('')}</select></td>
        <td>${sesionPuedeRegistrarSalida()?`<button type="button" class="btn btn-warning asignar-salida" data-id="${m.id}">Asignar acta</button>`:'Solo lectura'}</td></tr>`;
    }).join('');
}

async function asignarSalidaPendiente(e) {
    const boton=e.target.closest('.asignar-salida');
    const sesion=sesionPuedeRegistrarSalida();
    if(!boton || !sesion) return;
    const acta=document.getElementById(`asignar-${boton.dataset.id}`).value;
    if(!acta) return alert('Selecciona el acta a la que realmente corresponde esta salida.');
    if(!confirm('¿Asignar esta salida anterior al acta seleccionada? Se descontará de su Kardex.')) return;
    boton.disabled=true;
    try {
        const {error}=await supabaseClient.rpc('asignar_salida_acta',{
            p_movimiento_id:boton.dataset.id,p_recepcion_id:acta,p_usuario:sesion.usuario
        });
        if(error) throw error;
        await refrescarKardex();
    } catch(error) { manejarErrorSupabase(error); }
    finally { boton.disabled=false; }
}

// Supabase limita las respuestas: recorrer páginas conserva todo el historial en el Excel.
async function leerMovimientosKardex(kardexId) {
    const kardex = PRODUCTOS_CACHE.find(k => k.id === kardexId);
    if (!kardex) throw new Error('Selecciona un Kardex de acta.');
    const movimientos = [];
    for (let desde = 0; ; desde += 1000) {
        const { data, error } = await supabaseClient.from('kardex_movimientos').select('*')
            .eq('producto_id', kardex.producto_id).eq('recepcion_id', kardex.recepcion_id).order('created_at', { ascending:true })
            .order('id', { ascending:true }).range(desde, desde + 999);
        if (error) throw error;
        movimientos.push(...(data || []));
        if (!data || data.length < 1000) return movimientos;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const sel = document.getElementById('kx-producto');
    try { PRODUCTOS_CACHE = await leerCatalogoKardex(); }
    catch (error) { manejarErrorSupabase(error, 'No se pudieron cargar los Kardex por acta. Verifica que se haya ejecutado sql/migracion_kardex_por_acta.sql.'); return; }
    sel.innerHTML = PRODUCTOS_CACHE.map(p => `<option value="${p.id}">${escaparKardex(etiquetaKardex(p))}</option>`).join('');
    renderListaKardex();
    sel.addEventListener('change', cargarKardex);
    document.querySelector('#tabla-lista-kardex tbody').addEventListener('click', descargarKardexDeLista);
    document.querySelector('#tabla-kardex tbody').addEventListener('click', manejarAccionKardex);
    document.getElementById('form-movimiento').addEventListener('submit', guardarMovimientoKardex);
    document.getElementById('kx-registrar-salida').addEventListener('click', abrirSalidaKardex);
    document.getElementById('kx-eliminar').addEventListener('click', eliminarKardexSeleccionado);
    document.getElementById('kx-filtro-fechas').addEventListener('submit', aplicarFiltroFechas);
    document.getElementById('kx-limpiar-fechas').addEventListener('click', async()=>{
        document.getElementById('kx-filtro-fechas').reset();
        await aplicarFiltroFechas();
    });
    document.getElementById('tabla-salidas-pendientes').addEventListener('click', asignarSalidaPendiente);
    document.getElementById('ks-lote').addEventListener('change', mostrarLoteSalida);
    document.getElementById('form-salida').addEventListener('submit', guardarSalidaKardex);
    $('#modal-salida').on('hide.bs.modal', e => { if (GUARDANDO_SALIDA) e.preventDefault(); });
    await renderSeleccionKardex();
    await cargarSalidasPendientes();
});

function escaparKardex(texto) {
    return String(texto ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]);
}

function renderListaKardex() {
    document.querySelector('#tabla-lista-kardex tbody').innerHTML = kardexVisibles().map(producto => `<tr>
        <td><strong>${escaparKardex(producto.codigo)}</strong></td>
        <td>${escaparKardex(producto.nombre)}</td>
        <td>${escaparKardex(producto.acta_guia || producto.recepcion_id)} · ${escaparKardex(producto.acta_fecha)}</td>
        <td><strong>${Number(producto.stock || 0)}</strong>${Number(producto.salidas_pendientes)>0 ? ' <span class="text-danger">Pendiente de asignación</span>' : ''}</td>
        <td><button type="button" class="btn btn-success btn-sm descargar-kardex-producto" data-id="${producto.id}">
            <i class="fas fa-file-excel"></i> Descargar Kardex
        </button></td></tr>`).join('');
}

async function descargarKardexDeLista(e) {
    const boton = e.target.closest('.descargar-kardex-producto');
    if (!boton) return;
    const producto = PRODUCTOS_CACHE.find(p => p.id === boton.dataset.id);
    if (!producto) return;
    if (Number(producto.salidas_pendientes)>0) return alert('Asigna primero las salidas anteriores de este producto.');
    boton.disabled = true;
    try {
        await SGDEExcel.exportarKardexPlantilla(producto, await leerMovimientosKardex(producto.id));
    } catch (error) {
        console.error('[Kardex Excel]', error);
        alert(`No se pudo generar el Kardex: ${error?.message || 'error desconocido'}`);
    } finally {
        boton.disabled = false;
    }
}

async function cargarKardex() {
    document.getElementById('kx-resultado').classList.add('d-none');
    document.getElementById('kx-resultado').textContent = '';
    const productoId = document.getElementById('kx-producto').value;
    const producto = PRODUCTOS_CACHE.find(p => p.id === productoId);
    document.getElementById('kx-cabecera').innerHTML = producto ? `<div class="row">
        <div class="col-md-3"><strong>Código:</strong> ${escaparKardex(producto.codigo)}</div>
        <div class="col-md-3"><strong>Presentación:</strong> ${escaparKardex(producto.presentacion)}</div>
        <div class="col-md-3"><strong>Acta:</strong> ${escaparKardex(producto.acta_guia || producto.recepcion_id)} · ${escaparKardex(producto.acta_fecha)}</div>
        <div class="col-md-3"><strong>Saldo de este Kardex:</strong> <span class="font-weight-bold">${producto.stock || 0}</span></div></div>` : '';
    document.getElementById('kx-registrar-salida').disabled = !producto || Number(producto.salidas_pendientes)>0;
    document.getElementById('kx-eliminar').disabled = !producto || ELIMINANDO_KARDEX;
    KARDEX_ACTUAL = [];
    document.querySelector('#tabla-kardex tbody').innerHTML = '';
    if (!productoId) return;
    try {
        const movimientos = await leerMovimientosKardex(productoId);
        if (document.getElementById('kx-producto').value !== productoId) return;
        KARDEX_ACTUAL = movimientos;
    } catch (error) { manejarErrorSupabase(error); throw error; }
    const puedeEditar = JSON.parse(localStorage.getItem('sesion_usuario') || 'null')?.rol !== 'auxiliar';
    document.querySelector('#tabla-kardex tbody').innerHTML = KARDEX_ACTUAL.map(m => `<tr>
        <td>${escaparKardex(m.fecha)}</td><td>${escaparKardex(m.guia_numero)}</td><td>${escaparKardex([m.tipo_doc, m.num_doc].filter(Boolean).join(' · '))}</td><td>${escaparKardex(m.proveedor_cliente)}</td>
        <td>${escaparKardex(m.lote)}</td><td>${escaparKardex(m.fecha_venc)}</td><td>${m.ingreso || 0}</td><td>${m.salida || 0}</td>
        <td><strong>${m.saldo || 0}</strong></td><td>${escaparKardex(m.observaciones)}</td>
        <td class="text-nowrap">${!puedeEditar ? '<span class="text-muted">Solo lectura</span>' : (m.recepcion_id && Number(m.ingreso)>0) ? '<span class="text-muted" title="Movimiento generado por un acta">Acta vinculada</span>' : `
            <button type="button" class="btn btn-sm btn-outline-primary editar-movimiento" data-id="${m.id}" title="Editar movimiento" aria-label="Editar movimiento"><i class="fas fa-pen"></i></button>
            <button type="button" class="btn btn-sm btn-outline-danger eliminar-movimiento" data-id="${m.id}" title="Eliminar movimiento" aria-label="Eliminar movimiento"><i class="fas fa-trash"></i></button>`}</td></tr>`).join('');
}

async function manejarAccionKardex(e) {
    if (JSON.parse(localStorage.getItem('sesion_usuario') || 'null')?.rol === 'auxiliar') return;
    const boton = e.target.closest('.editar-movimiento, .eliminar-movimiento');
    if (!boton) return;
    const movimiento = KARDEX_ACTUAL.find(m => m.id === boton.dataset.id);
    if (!movimiento || Number(movimiento.ingreso)>0) return;
    if (boton.classList.contains('editar-movimiento')) {
        for (const [campo, valor] of Object.entries({
            id: movimiento.id, fecha: movimiento.fecha, guia: movimiento.guia_numero,
            proveedor: movimiento.proveedor_cliente, lote: movimiento.lote,
            vencimiento: movimiento.fecha_venc, ingreso: movimiento.ingreso ?? 0,
            salida: movimiento.salida ?? 0, observaciones: movimiento.observaciones
        })) document.getElementById(`km-${campo}`).value = valor ?? '';
        document.getElementById('km-ingreso').readOnly = true;
        $('#modal-movimiento').modal('show');
        return;
    }
    if (!confirm('¿Eliminar este movimiento de Kardex? Los saldos y el stock se recalcularán.')) return;
    boton.disabled = true;
    try {
        const { data, error } = await supabaseClient.from('kardex_movimientos').delete()
            .eq('id', movimiento.id).eq('recepcion_id', movimiento.recepcion_id).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se eliminó el movimiento. Actualiza la página e inténtalo de nuevo.');
        await registrarAuditoria('DELETE', 'kardex_movimientos', movimiento.id, `Movimiento eliminado del producto ${movimiento.producto_id}`);
        await refrescarKardex();
    } catch (error) {
        manejarErrorSupabase(error, `No se pudo eliminar el movimiento: ${error.message}`);
    } finally { boton.disabled = false; }
}

async function guardarMovimientoKardex(e) {
    e.preventDefault();
    if (JSON.parse(localStorage.getItem('sesion_usuario') || 'null')?.rol === 'auxiliar') return;
    const form = e.currentTarget;
    const boton = form.querySelector('[type="submit"]');
    const id = document.getElementById('km-id').value;
    const anterior = KARDEX_ACTUAL.find(m => m.id === id);
    if (!anterior || Number(anterior.ingreso)>0) return;
    const ingreso = Number(document.getElementById('km-ingreso').value);
    const salida = Number(document.getElementById('km-salida').value);
    if (!Number.isFinite(ingreso) || !Number.isFinite(salida) || ingreso < 0 || salida < 0) {
        alert('Ingreso y salida deben ser números no negativos.'); return;
    }
    const registro = {
        fecha: document.getElementById('km-fecha').value,
        guia_numero: document.getElementById('km-guia').value.trim(),
        proveedor_cliente: document.getElementById('km-proveedor').value.trim(),
        lote: document.getElementById('km-lote').value.trim(),
        fecha_venc: document.getElementById('km-vencimiento').value || null,
        ingreso, salida,
        observaciones: document.getElementById('km-observaciones').value.trim()
    };
    boton.disabled = true;
    try {
        const { data, error } = await supabaseClient.from('kardex_movimientos').update(registro)
            .eq('id', id).eq('recepcion_id', anterior.recepcion_id).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se actualizó el movimiento. Actualiza la página e inténtalo de nuevo.');
        await registrarAuditoria('UPDATE', 'kardex_movimientos', id, `Movimiento actualizado del producto ${anterior.producto_id}`);
        $('#modal-movimiento').modal('hide');
        await refrescarKardex();
    } catch (error) {
        manejarErrorSupabase(error, `No se pudo actualizar el movimiento: ${error.message}`);
    } finally { boton.disabled = false; }
}

async function refrescarKardex() {
    PRODUCTOS_CACHE = await leerCatalogoKardex();
    await renderSeleccionKardex();
    await cargarSalidasPendientes();
}

async function exportarKardexExcel() {
    if (!KARDEX_ACTUAL.length) return alert('No hay movimientos para exportar.');
    const producto = PRODUCTOS_CACHE.find(p => p.id === document.getElementById('kx-producto').value);
    if (Number(producto?.salidas_pendientes)>0) return alert('Asigna primero las salidas anteriores de este producto.');
    try { await SGDEExcel.exportarKardexPlantilla(producto, KARDEX_ACTUAL); }
    catch (error) { console.error(error); alert('No se pudo generar el archivo Excel. Verifica tu conexión e inténtalo nuevamente.'); }
}

function sesionPuedeRegistrarSalida() {
    const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
    return sesion && ['admin', 'asistente'].includes(sesion.rol) ? sesion : null;
}

function errorSalida(mensaje = '') {
    const el = document.getElementById('ks-error');
    el.textContent = mensaje;
    el.classList.toggle('d-none', !mensaje);
}

async function abrirSalidaKardex() {
    if (!sesionPuedeRegistrarSalida()) return;
    if (SOLICITUD_SALIDA) {
        $('#modal-salida').modal('show');
        errorSalida('Hay una salida pendiente de confirmar. Pulsa Registrar salida para reintentar la misma operación.');
        return;
    }
    const seleccionado = PRODUCTOS_CACHE.find(k=>k.id===document.getElementById('kx-producto').value);
    if (!seleccionado) return alert('Selecciona un Kardex de acta.');
    if (Number(seleccionado.salidas_pendientes)>0) return alert('Asigna primero las salidas anteriores de este producto.');
    document.getElementById('form-salida').reset();
    SOLICITUD_SALIDA = null;
    document.getElementById('ks-campos').disabled = false;
    errorSalida();
    const selector = document.getElementById('ks-producto');
    selector.innerHTML = `<option value="${seleccionado.id}">${escaparKardex(etiquetaKardex(seleccionado))}</option>`;
    selector.value = seleccionado.id;
    const ahora = new Date();
    document.getElementById('ks-fecha').value = `${ahora.getFullYear()}-${String(ahora.getMonth()+1).padStart(2,'0')}-${String(ahora.getDate()).padStart(2,'0')}`;
    $('#modal-salida').modal('show');
    await cargarLotesSalida();
}

async function cargarLotesSalida() {
    const carga = ++CARGA_LOTES;
    LOTES_SALIDA = [];
    const selector = document.getElementById('ks-lote');
    selector.innerHTML = '<option value="">Cargando lotes…</option>';
    document.getElementById('ks-guardar').disabled = true;
    document.getElementById('ks-vencimiento').value = '';
    document.getElementById('ks-disponible').textContent = '';
    errorSalida();
    try {
        const kardex = PRODUCTOS_CACHE.find(k=>k.id===document.getElementById('ks-producto').value);
        const { data, error } = await supabaseClient.rpc('consultar_lotes_kardex', {
            p_producto_id: kardex.producto_id, p_recepcion_id: kardex.recepcion_id
        });
        if (carga !== CARGA_LOTES) return;
        if (error) throw error;
        LOTES_SALIDA = data || [];
        selector.innerHTML = LOTES_SALIDA.length ? LOTES_SALIDA.map((l, i) =>
            `<option value="${i}">${escaparKardex(l.lote || 'Sin lote')} · Vence: ${escaparKardex(l.fecha_venc || 'Sin fecha')} · Disponible: ${Number(l.disponible)}</option>`).join('') : '<option value="">Sin existencias disponibles</option>';
        mostrarLoteSalida();
    } catch (error) {
        if (carga !== CARGA_LOTES) return;
        selector.innerHTML = '<option value="">No se pudieron consultar los lotes</option>';
        errorSalida(error.code === 'PGRST202' ? 'Falta instalar la migración de registro de salidas en Supabase.' : error.message);
    }
}

function mostrarLoteSalida() {
    const valor = document.getElementById('ks-lote').value;
    const lote = valor === '' ? null : LOTES_SALIDA[Number(valor)];
    document.getElementById('ks-vencimiento').value = lote?.fecha_venc || '';
    document.getElementById('ks-disponible').textContent = lote ? `Disponible en este lote: ${Number(lote.disponible)} unidades.` : 'El producto no tiene stock disponible.';
    document.getElementById('ks-guardar').disabled = !lote || GUARDANDO_SALIDA;
}

async function guardarSalidaKardex(e) {
    e.preventDefault();
    const sesion = sesionPuedeRegistrarSalida();
    if (!sesion || GUARDANDO_SALIDA) return;
    const valor = document.getElementById('ks-lote').value;
    const lote = valor === '' ? null : LOTES_SALIDA[Number(valor)];
    const cantidad = Number(document.getElementById('ks-cantidad').value);
    const texto = id => document.getElementById(id).value.trim();
    if (!SOLICITUD_SALIDA) {
        if (!lote) return errorSalida('Selecciona un lote disponible.');
        if (!Number.isFinite(cantidad) || cantidad <= 0) return errorSalida('La cantidad retirada debe ser mayor que cero.');
        if (cantidad > Number(lote.disponible)) return errorSalida(`Stock insuficiente. Disponible: ${Number(lote.disponible)} unidades.`);
        if (!texto('ks-cliente') || !texto('ks-tipo-doc') || !texto('ks-num-doc') || !texto('ks-fecha')) return errorSalida('Completa fecha, cliente y documento.');
        const kardex = PRODUCTOS_CACHE.find(k=>k.id===texto('ks-producto'));
        if (!kardex) return errorSalida('Selecciona un Kardex de acta.');
        SOLICITUD_SALIDA = {
            p_id: crypto.randomUUID(), p_usuario: sesion.usuario,
            p_registro: {
                producto_id: kardex.producto_id, recepcion_id: kardex.recepcion_id, fecha: texto('ks-fecha'),
                proveedor_cliente: texto('ks-cliente'), tipo_doc: texto('ks-tipo-doc'),
                num_doc: texto('ks-num-doc'), guia_numero: texto('ks-guia') || (texto('ks-tipo-doc') === 'Guía de remisión' ? texto('ks-num-doc') : ''),
                lote: lote.lote, fecha_venc: lote.fecha_venc, salida: cantidad,
                observaciones: texto('ks-observaciones')
            }
        };
    }
    GUARDANDO_SALIDA = true;
    document.getElementById('ks-campos').disabled = true;
    document.getElementById('ks-guardar').disabled = true;
    errorSalida();
    let resultado;
    try {
        const { data, error } = await supabaseClient.rpc('registrar_salida_kardex', SOLICITUD_SALIDA);
        if (error) throw error;
        resultado = data;
    } catch (error) {
        // Un fallo de transporte puede ocurrir después del COMMIT. Reintentar el mismo
        // identificador evita registrar dos veces la salida y su auditoría.
        const rechazo = error.code && !String(error.code).startsWith('08');
        if (rechazo) {
            SOLICITUD_SALIDA = null;
            document.getElementById('ks-campos').disabled = false;
        }
        errorSalida(error.code === 'PGRST202' ? 'Falta instalar la migración de registro de salidas en Supabase.' : `${error.message || 'No se pudo confirmar la salida.'}${rechazo ? '' : ' Pulsa Registrar salida para reintentar la misma operación.'}`);
        return;
    } finally {
        GUARDANDO_SALIDA = false;
        document.getElementById('ks-guardar').disabled = false;
    }
    const productoId = `${SOLICITUD_SALIDA.p_registro.recepcion_id}:${SOLICITUD_SALIDA.p_registro.producto_id}`;
    SOLICITUD_SALIDA = null;
    $('#modal-salida').modal('hide');
    document.getElementById('kx-producto').value = productoId;
    let falloActualizacion = false;
    try { await refrescarKardex(); } catch (error) { falloActualizacion = true; }
    const aviso = document.getElementById('kx-resultado');
    aviso.textContent = `Salida registrada en este Kardex. Saldo: ${resultado.saldo} unidades.`;
    aviso.classList.remove('d-none');
    if (falloActualizacion) aviso.textContent += ' No se pudo actualizar la vista. Recarga para consultar el movimiento guardado.';
}
