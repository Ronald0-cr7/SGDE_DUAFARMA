let PRODUCTOS_CRUD = [];

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('btn-nuevo-producto').addEventListener('click', abrirNuevoProducto);
    document.getElementById('form-producto').addEventListener('submit', guardarProducto);
    document.getElementById('buscar-producto').addEventListener('input', renderProductos);
    document.querySelector('#tabla-productos tbody').addEventListener('click', manejarAccionProducto);
    await cargarProductosCrud();
});

function escaparProducto(valor) {
    return String(valor ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
}

async function cargarProductosCrud() {
    const { data, error } = await supabaseClient.from('productos').select('*').order('codigo');
    if (error) return manejarErrorSupabase(error, 'No se pudo cargar el catálogo. Ejecuta sql/migracion_crud_productos.sql en Supabase.');
    PRODUCTOS_CRUD = data || [];
    renderProductos();
}

function renderProductos() {
    const texto = document.getElementById('buscar-producto').value.trim().toLowerCase();
    const sesion = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
    const puedeEditar = sesion?.rol !== 'auxiliar';
    const lista = PRODUCTOS_CRUD.filter(p => [p.codigo,p.nombre,p.fabricante,p.procedencia,p.reg_sanitario].some(v => String(v || '').toLowerCase().includes(texto)));
    document.querySelector('#tabla-productos tbody').innerHTML = lista.map(p => `<tr>
        <td><strong>${escaparProducto(p.codigo)}</strong></td><td>${escaparProducto(p.nombre)}</td><td>${escaparProducto(p.presentacion)}</td>
        <td>${escaparProducto(p.concentracion_forma)}</td><td>${escaparProducto(p.fabricante)}</td><td>${escaparProducto(p.procedencia)}</td>
        <td>${escaparProducto(p.lote)}</td><td>${escaparProducto(p.fecha_venc)}</td><td>${escaparProducto(p.reg_sanitario)}</td>
        <td>${escaparProducto(p.condicion_almacen)}</td><td><span class="badge ${p.estado_embalaje === 'NO CONFORME' ? 'badge-danger' : 'badge-success'}">${escaparProducto(p.estado_embalaje || 'CONFORME')}</span></td>
        <td><strong>${Number(p.stock || 0)}</strong></td><td class="text-nowrap">
        ${puedeEditar ? `<button class="btn btn-sm btn-outline-primary editar-producto" data-id="${p.id}" title="Editar"><i class="fas fa-pen"></i></button>
        <button class="btn btn-sm btn-outline-danger eliminar-producto" data-id="${p.id}" title="Eliminar"><i class="fas fa-trash"></i></button>` : '<span class="text-muted">Solo lectura</span>'}</td></tr>`).join('');
    document.getElementById('sin-productos').style.display = lista.length ? 'none' : 'block';
}

function abrirNuevoProducto() {
    document.getElementById('form-producto').reset();
    document.getElementById('pr-id').value = '';
    document.getElementById('pr-dam').value = 'N.A';
    document.getElementById('pr-condicion').value = 'T° Ambiente Controlada';
    document.getElementById('titulo-modal-producto').textContent = 'Nuevo producto';
    $('#modal-producto').modal('show');
}

function abrirEditarProducto(id) {
    const p = PRODUCTOS_CRUD.find(item => item.id === id);
    if (!p) return;
    document.getElementById('pr-id').value=p.id; document.getElementById('pr-codigo').value=p.codigo||'';
    document.getElementById('pr-nombre').value=p.nombre||''; document.getElementById('pr-registro').value=p.reg_sanitario||'';
    document.getElementById('pr-presentacion').value=p.presentacion||''; document.getElementById('pr-concentracion').value=p.concentracion_forma||'';
    document.getElementById('pr-fabricante').value=p.fabricante||''; document.getElementById('pr-procedencia').value=p.procedencia||'';
    document.getElementById('pr-dam').value=p.dam||'N.A'; document.getElementById('pr-lote').value=p.lote||'';
    document.getElementById('pr-vencimiento').value=p.fecha_venc||''; document.getElementById('pr-condicion').value=p.condicion_almacen||'';
    document.getElementById('pr-embalaje').value=p.estado_embalaje||'CONFORME';
    document.getElementById('titulo-modal-producto').textContent='Actualizar producto';
    $('#modal-producto').modal('show');
}

function leerProductoFormulario() {
    return { codigo:document.getElementById('pr-codigo').value.trim(), nombre:document.getElementById('pr-nombre').value.trim(),
        presentacion:document.getElementById('pr-presentacion').value.trim(), concentracion_forma:document.getElementById('pr-concentracion').value.trim(),
        fabricante:document.getElementById('pr-fabricante').value.trim(), procedencia:document.getElementById('pr-procedencia').value.trim(),
        lote:document.getElementById('pr-lote').value.trim(), fecha_venc:document.getElementById('pr-vencimiento').value||null,
        reg_sanitario:document.getElementById('pr-registro').value.trim(), condicion_almacen:document.getElementById('pr-condicion').value.trim(),
        estado_embalaje:document.getElementById('pr-embalaje').value, dam:document.getElementById('pr-dam').value.trim()||'N.A' };
}

async function guardarProducto(e) {
    e.preventDefault(); const form=e.currentTarget, btn=form.querySelector('[type="submit"]'), id=document.getElementById('pr-id').value;
    const registro=leerProductoFormulario(); btn.disabled=true;
    try {
        const consulta=id ? supabaseClient.from('productos').update(registro).eq('id',id).select().single()
            : supabaseClient.from('productos').insert([{...registro,stock:0}]).select().single();
        const {data,error}=await consulta; if(error) throw error;
        await registrarAuditoria(id?'UPDATE':'INSERT','productos',data.id,`${id?'Producto actualizado':'Producto creado'}: ${registro.codigo} - ${registro.nombre}`);
        $('#modal-producto').modal('hide'); await cargarProductosCrud(); alert(id?'Producto actualizado correctamente.':'Producto registrado correctamente.');
    } catch(error) { manejarErrorSupabase(error,error?.code==='23505'?'Ya existe un producto con ese código.':'No se pudo guardar el producto. Verifica que ejecutaste la migración SQL.'); }
    finally { btn.disabled=false; }
}

async function manejarAccionProducto(e) {
    const editar=e.target.closest('.editar-producto'), eliminar=e.target.closest('.eliminar-producto');
    if(editar) return abrirEditarProducto(editar.dataset.id);
    if(!eliminar) return; const p=PRODUCTOS_CRUD.find(item=>item.id===eliminar.dataset.id); if(!p) return;
    if(!confirm(`¿Eliminar el producto "${p.codigo} - ${p.nombre}"?`)) return;
    try {
        const {error}=await supabaseClient.from('productos').delete().eq('id',p.id); if(error) throw error;
        await registrarAuditoria('DELETE','productos',p.id,`Producto eliminado: ${p.codigo} - ${p.nombre}`); await cargarProductosCrud();
    } catch(error) { manejarErrorSupabase(error,error?.code==='23503'?'No se puede eliminar porque el producto tiene actas o movimientos de Kardex asociados. Puedes editarlo sin perder su historial.':'No se pudo eliminar el producto.'); }
}
