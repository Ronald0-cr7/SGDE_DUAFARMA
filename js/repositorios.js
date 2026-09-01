// ============================================================
// repositorios.js — Módulo de Repositorios Digitales
// Repositorios > Carpetas/Subcarpetas > Archivos, con subida,
// descarga, renombrado, eliminación y búsqueda por nombre.
// Requiere: tablas repositorios/carpetas/archivos_repositorio y
// el bucket "repositorios" en Supabase Storage (ver sql/repositorios.sql)
// ============================================================

const BUCKET_REPO = 'repositorios';
const TAMANIO_MAXIMO_ARCHIVO = 50 * 1000 * 1000;
const CLAVE_ELIMINAR_REPOSITORIO = '123456';

let SESION = null;
let REPOS = [];
let ESTADO = { repoId: null, carpetaId: null, ruta: [] }; // ruta: [{id:null,nombre:repoNombre}, {id, nombre}, ...]

function esAdminRepositorio() {
    return Boolean(SESION && SESION.rol === 'admin');
}

function exigirAdminRepositorio() {
    if (esAdminRepositorio()) return true;
    alert('Solo el administrador puede crear, subir, renombrar o eliminar contenido del repositorio.');
    return false;
}

document.addEventListener('DOMContentLoaded', async () => {
    SESION = JSON.parse(localStorage.getItem('sesion_usuario') || 'null');
    await cargarRepositorios();
    enlazarEventos();
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.rp-dropdown.show').forEach(d => {
            if (!d.contains(e.target) && !d.previousElementSibling.contains(e.target)) d.classList.remove('show');
        });
    });
});

// ------------------------------------------------------------
// REPOSITORIOS
// ------------------------------------------------------------
async function cargarRepositorios() {
    const { data, error } = await supabaseClient.from('repositorios').select('*').order('nombre');
    if (error) return manejarErrorSupabase(error);
    REPOS = data;

    const sel = document.getElementById('rp-select-repo');
    sel.innerHTML = data.map(r => `<option value="${r.id}">${r.nombre}</option>`).join('');

    document.getElementById('rp-sin-repo-card').style.display = data.length ? 'none' : 'block';
    document.getElementById('rp-selector-card').style.display = data.length ? 'block' : 'block';

    if (data.length) {
        const idAConservar = ESTADO.repoId && data.some(r => r.id === ESTADO.repoId) ? ESTADO.repoId : data[0].id;
        sel.value = idAConservar;
        abrirRepo(idAConservar);
    } else {
        document.getElementById('rp-explorador-card').style.display = 'none';
    }
}

function abrirRepo(repoId) {
    const repo = REPOS.find(r => r.id === repoId);
    ESTADO.repoId = repoId;
    ESTADO.carpetaId = null;
    ESTADO.ruta = [{ id: null, nombre: repo ? repo.nombre : 'Repositorio' }];
    document.getElementById('rp-explorador-card').style.display = 'block';
    document.getElementById('rp-buscar').value = '';
    cargarContenido();
}

async function crearRepositorio(nombre, descripcion) {
    if (!exigirAdminRepositorio()) return;
    const { data, error } = await supabaseClient
        .from('repositorios')
        .insert([{ nombre, descripcion, creado_por: SESION.usuario }])
        .select().single();
    if (error) return manejarErrorSupabase(error, 'No se pudo crear el repositorio.');
    await registrarAuditoria('INSERT', 'repositorios', data.id, `Repositorio creado: ${nombre}`);
    await cargarRepositorios();
    document.getElementById('rp-select-repo').value = data.id;
    abrirRepo(data.id);
}

async function eliminarRepositorioActual() {
    if (!exigirAdminRepositorio()) return;
    const repo = REPOS.find(r => r.id === ESTADO.repoId);
    if (!repo) return;
    if (!confirm(`¿Eliminar el repositorio "${repo.nombre}" y TODO su contenido? Esta acción no se puede deshacer.`)) return;

    try {
        const { data: archivos } = await supabaseClient
            .from('archivos_repositorio').select('storage_path').eq('repositorio_id', repo.id);
        if (archivos && archivos.length) {
            await supabaseClient.storage.from(BUCKET_REPO).remove(archivos.map(a => a.storage_path));
        }
        const { error } = await supabaseClient.from('repositorios').delete().eq('id', repo.id);
        if (error) throw error;
        await registrarAuditoria('DELETE', 'repositorios', repo.id, `Repositorio eliminado: ${repo.nombre}`);
        ESTADO = { repoId: null, carpetaId: null, ruta: [] };
        await cargarRepositorios();
    } catch (err) {
        manejarErrorSupabase(err, 'No se pudo eliminar el repositorio.');
    }
}

function solicitarClaveEliminarRepositorio() {
    if (!exigirAdminRepositorio()) return;
    const repo = REPOS.find(r => r.id === ESTADO.repoId);
    if (!repo) return;

    const input = document.getElementById('rp-clave-eliminar');
    input.value = '';
    input.classList.remove('is-invalid');
    $('#modal-clave-eliminar-repo').modal('show');
    $('#modal-clave-eliminar-repo').one('shown.bs.modal', () => input.focus());
}

async function validarClaveYEliminarRepositorio(e) {
    e.preventDefault();
    const input = document.getElementById('rp-clave-eliminar');
    if (input.value !== CLAVE_ELIMINAR_REPOSITORIO) {
        input.classList.add('is-invalid');
        input.focus();
        input.select();
        return;
    }

    input.classList.remove('is-invalid');
    $('#modal-clave-eliminar-repo').modal('hide');
    await eliminarRepositorioActual();
}

// ------------------------------------------------------------
// NAVEGACIÓN (carpetas / breadcrumb)
// ------------------------------------------------------------
async function cargarContenido() {
    document.getElementById('rp-resultados-busqueda').style.display = 'none';
    document.getElementById('rp-grid').style.display = 'grid';
    renderBreadcrumb();

    const [{ data: carpetas, error: e1 }, { data: archivos, error: e2 }] = await Promise.all([
        supabaseClient.from('carpetas').select('*')
            .eq('repositorio_id', ESTADO.repoId)
            .filter('carpeta_padre_id', ESTADO.carpetaId ? 'eq' : 'is', ESTADO.carpetaId ?? null)
            .order('nombre'),
        supabaseClient.from('archivos_repositorio').select('*')
            .eq('repositorio_id', ESTADO.repoId)
            .filter('carpeta_id', ESTADO.carpetaId ? 'eq' : 'is', ESTADO.carpetaId ?? null)
            .order('nombre')
    ]);
    if (e1) return manejarErrorSupabase(e1);
    if (e2) return manejarErrorSupabase(e2);

    renderGrid(carpetas || [], archivos || []);
}

function renderBreadcrumb() {
    const bc = document.getElementById('rp-breadcrumb');
    bc.innerHTML = ESTADO.ruta.map((nodo, i) => {
        const esUltimo = i === ESTADO.ruta.length - 1;
        return `<li class="breadcrumb-item ${esUltimo ? 'active' : ''}">
            ${esUltimo ? nodo.nombre : `<a onclick="irBreadcrumb(${i})">${nodo.nombre}</a>`}
        </li>`;
    }).join('');
}

function irBreadcrumb(indice) {
    ESTADO.ruta = ESTADO.ruta.slice(0, indice + 1);
    ESTADO.carpetaId = ESTADO.ruta[indice].id;
    cargarContenido();
}

function entrarCarpeta(carpeta) {
    ESTADO.ruta.push({ id: carpeta.id, nombre: carpeta.nombre });
    ESTADO.carpetaId = carpeta.id;
    cargarContenido();
}

// ------------------------------------------------------------
// RENDER DE LA GRILLA
// ------------------------------------------------------------
function iconoPorExtension(ext) {
    ext = (ext || '').toLowerCase();
    if (ext === 'pdf') return { icon: 'fa-file-pdf', clase: 'pdf' };
    if (['doc', 'docx'].includes(ext)) return { icon: 'fa-file-word', clase: 'word' };
    if (['xls', 'xlsx', 'csv'].includes(ext)) return { icon: 'fa-file-excel', clase: 'excel' };
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return { icon: 'fa-file-image', clase: 'imagen' };
    return { icon: 'fa-file', clase: 'otro' };
}

function formatoTamanio(bytes) {
    if (!bytes) return '0 KB';
    const unidades = ['B', 'KB', 'MB', 'GB'];
    let i = 0, val = bytes;
    while (val >= 1024 && i < unidades.length - 1) { val /= 1024; i++; }
    return `${val.toFixed(1)} ${unidades[i]}`;
}

function renderGrid(carpetas, archivos) {
    const grid = document.getElementById('rp-grid');
    document.getElementById('rp-vacio').style.display = (!carpetas.length && !archivos.length) ? 'block' : 'none';

    const htmlCarpetas = carpetas.map(c => `
        <div class="rp-item carpeta" onclick="entrarCarpeta(${JSON.stringify(c).replace(/"/g, '&quot;')})">
            <button class="rp-menu-btn solo-admin" onclick="event.stopPropagation(); toggleMenu(this)"><i class="fas fa-ellipsis-v"></i></button>
            <div class="rp-dropdown">
                <a onclick="event.stopPropagation(); abrirRenombrar('${c.id}','carpeta','${escapeAttr(c.nombre)}')"><i class="fas fa-pen"></i> Renombrar</a>
                <a class="text-danger solo-admin" onclick="event.stopPropagation(); eliminarCarpeta('${c.id}','${escapeAttr(c.nombre)}')"><i class="fas fa-trash"></i> Eliminar</a>
            </div>
            <div class="rp-icono"><i class="fas fa-folder"></i></div>
            <div class="rp-nombre">${c.nombre}</div>
            <div class="rp-meta">Carpeta</div>
        </div>`).join('');

    const htmlArchivos = archivos.map(a => {
        const { icon, clase } = iconoPorExtension(a.extension);
        return `
        <div class="rp-item ${clase}" onclick="abrirInfoArchivo('${a.id}')">
            <button class="rp-menu-btn" onclick="event.stopPropagation(); toggleMenu(this)"><i class="fas fa-ellipsis-v"></i></button>
            <div class="rp-dropdown">
                <a onclick="event.stopPropagation(); descargarArchivoRepo('${a.storage_path}','${escapeAttr(a.nombre_original)}')"><i class="fas fa-download"></i> Descargar</a>
                <a class="solo-admin" onclick="event.stopPropagation(); abrirRenombrar('${a.id}','archivo','${escapeAttr(a.nombre)}')"><i class="fas fa-pen"></i> Renombrar</a>
                <a class="text-danger solo-admin" onclick="event.stopPropagation(); eliminarArchivo('${a.id}','${escapeAttr(a.storage_path)}')"><i class="fas fa-trash"></i> Eliminar</a>
            </div>
            <div class="rp-icono"><i class="fas ${icon}"></i></div>
            <div class="rp-nombre">${a.nombre}</div>
            <div class="rp-meta">${formatoTamanio(a.tamanio_bytes)}</div>
        </div>`;
    }).join('');

    grid.innerHTML = htmlCarpetas + htmlArchivos;

    // aplicar visibilidad por rol a los botones recién insertados
    if (SESION.rol !== 'admin') grid.querySelectorAll('.solo-admin').forEach(el => el.style.display = 'none');
}

function escapeAttr(s) { return String(s || '').replace(/'/g, ''); }

function toggleMenu(btn) {
    document.querySelectorAll('.rp-dropdown.show').forEach(d => { if (d !== btn.nextElementSibling) d.classList.remove('show'); });
    btn.nextElementSibling.classList.toggle('show');
}

// ------------------------------------------------------------
// CREAR CARPETA / SUBIR ARCHIVO
// ------------------------------------------------------------
async function crearCarpeta(nombre) {
    if (!exigirAdminRepositorio()) return;
    const { data, error } = await supabaseClient.from('carpetas').insert([{
        repositorio_id: ESTADO.repoId, carpeta_padre_id: ESTADO.carpetaId, nombre, creado_por: SESION.usuario
    }]).select().single();
    if (error) return manejarErrorSupabase(error, 'No se pudo crear la carpeta.');
    await registrarAuditoria('INSERT', 'carpetas', data.id, `Carpeta creada: ${nombre}`);
    await cargarContenido();
}

async function subirArchivoRepo(archivo) {
    if (!esAdminRepositorio()) return { ok: false, nombre: archivo.name, error: 'Permiso denegado' };
    let rutaSegura = '';
    try {
        const extension = (archivo.name.split('.').pop() || '').toLowerCase();
        rutaSegura = `${ESTADO.repoId}/${ESTADO.carpetaId || 'raiz'}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${archivo.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;

        const { error: errUpload } = await supabaseClient.storage
            .from(BUCKET_REPO).upload(rutaSegura, archivo, { cacheControl: '3600', upsert: false });
        if (errUpload) throw errUpload;

        const registro = {
            repositorio_id: ESTADO.repoId, carpeta_id: ESTADO.carpetaId,
            nombre: archivo.name, nombre_original: archivo.name, extension,
            tipo_mime: archivo.type, tamanio_bytes: archivo.size,
            storage_path: rutaSegura, subido_por: SESION.usuario
        };
        const { data, error: errInsert } = await supabaseClient.from('archivos_repositorio').insert([registro]).select().single();
        if (errInsert) {
            await supabaseClient.storage.from(BUCKET_REPO).remove([rutaSegura]);
            throw errInsert;
        }

        await registrarAuditoria('INSERT', 'archivos_repositorio', data.id, `Archivo subido: ${archivo.name}`);
        return { ok: true, nombre: archivo.name };
    } catch (err) {
        console.error(`[Repositorio] No se pudo subir ${archivo.name}:`, err);
        return { ok: false, nombre: archivo.name, error: err.message || 'Error desconocido' };
    }
}

async function subirArchivosRepo(listaArchivos) {
    const archivos = Array.from(listaArchivos || []);
    if (!archivos.length) return;
    if (!exigirAdminRepositorio()) return;
    if (!ESTADO.repoId) {
        alert('Selecciona primero un repositorio.');
        return;
    }

    const wrap = document.getElementById('rp-progreso-wrap');
    const barra = document.getElementById('rp-progreso');
    const boton = document.getElementById('btn-subir-archivo');
    const resultados = [];
    wrap.style.display = 'flex';
    barra.style.width = '0%';
    boton.disabled = true;

    for (let i = 0; i < archivos.length; i++) {
        const archivo = archivos[i];
        if (archivo.size > TAMANIO_MAXIMO_ARCHIVO) {
            resultados.push({ ok: false, nombre: archivo.name, error: 'Supera el máximo de 50 MB' });
        } else {
            resultados.push(await subirArchivoRepo(archivo));
        }
        const porcentaje = Math.round(((i + 1) / archivos.length) * 100);
        barra.style.width = `${porcentaje}%`;
        barra.setAttribute('aria-valuenow', porcentaje);
    }

    await cargarContenido();
    setTimeout(() => { wrap.style.display = 'none'; }, 700);
    boton.disabled = false;

    const correctos = resultados.filter(r => r.ok).length;
    const fallidos = resultados.filter(r => !r.ok);
    let mensaje = `${correctos} de ${archivos.length} archivo(s) se cargaron correctamente.`;
    if (fallidos.length) {
        mensaje += `\n\nNo se pudieron cargar:\n${fallidos.map(r => `• ${r.nombre}: ${r.error}`).join('\n')}`;
    }
    alert(mensaje);
}

// ------------------------------------------------------------
// RENOMBRAR
// ------------------------------------------------------------
function abrirRenombrar(id, tipo, nombreActual) {
    if (!exigirAdminRepositorio()) return;
    document.getElementById('rn-id').value = id;
    document.getElementById('rn-tipo').value = tipo;
    document.getElementById('rn-nombre').value = nombreActual;
    $('#modal-renombrar').modal('show');
}

async function guardarRenombrado(id, tipo, nuevoNombre) {
    if (!exigirAdminRepositorio()) return;
    const tabla = tipo === 'carpeta' ? 'carpetas' : 'archivos_repositorio';
    const { error } = await supabaseClient.from(tabla).update({ nombre: nuevoNombre }).eq('id', id);
    if (error) return manejarErrorSupabase(error, 'No se pudo renombrar.');
    await registrarAuditoria('UPDATE', tabla, id, `Renombrado a: ${nuevoNombre}`);
    await cargarContenido();
}

// ------------------------------------------------------------
// ELIMINAR
// ------------------------------------------------------------
async function eliminarArchivo(id, storagePath) {
    if (!exigirAdminRepositorio()) return;
    if (!confirm('¿Eliminar este archivo? Esta acción no se puede deshacer.')) return;
    try {
        await supabaseClient.storage.from(BUCKET_REPO).remove([storagePath]);
        const { error } = await supabaseClient.from('archivos_repositorio').delete().eq('id', id);
        if (error) throw error;
        await registrarAuditoria('DELETE', 'archivos_repositorio', id, 'Archivo eliminado');
        await cargarContenido();
    } catch (err) {
        manejarErrorSupabase(err, 'No se pudo eliminar el archivo.');
    }
}

async function eliminarCarpeta(id, nombre) {
    if (!exigirAdminRepositorio()) return;
    if (!confirm(`¿Eliminar la carpeta "${nombre}" y todo su contenido (subcarpetas y archivos)?`)) return;
    try {
        const rutas = await recolectarStoragePaths(id);
        if (rutas.length) await supabaseClient.storage.from(BUCKET_REPO).remove(rutas);
        const { error } = await supabaseClient.from('carpetas').delete().eq('id', id); // cascade limpia subcarpetas/archivos en BD
        if (error) throw error;
        await registrarAuditoria('DELETE', 'carpetas', id, `Carpeta eliminada: ${nombre}`);
        await cargarContenido();
    } catch (err) {
        manejarErrorSupabase(err, 'No se pudo eliminar la carpeta.');
    }
}

// Recolecta recursivamente las rutas de Storage de todos los archivos
// dentro de una carpeta y sus subcarpetas, para poder borrarlas del bucket.
async function recolectarStoragePaths(carpetaId) {
    let rutas = [];
    const { data: archivos } = await supabaseClient.from('archivos_repositorio').select('storage_path').eq('carpeta_id', carpetaId);
    if (archivos) rutas = rutas.concat(archivos.map(a => a.storage_path));

    const { data: subcarpetas } = await supabaseClient.from('carpetas').select('id').eq('carpeta_padre_id', carpetaId);
    for (const sub of (subcarpetas || [])) {
        rutas = rutas.concat(await recolectarStoragePaths(sub.id));
    }
    return rutas;
}

// ------------------------------------------------------------
// DESCARGA E INFO
// ------------------------------------------------------------
async function descargarArchivoRepo(path, nombreOriginal) {
    try {
        const { data, error } = await supabaseClient.storage.from(BUCKET_REPO).download(path);
        if (error) throw error;
        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url; a.download = nombreOriginal || 'archivo';
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        manejarErrorSupabase(err, 'No se pudo descargar el archivo.');
    }
}

async function abrirInfoArchivo(id) {
    const { data, error } = await supabaseClient.from('archivos_repositorio').select('*').eq('id', id).single();
    if (error) return manejarErrorSupabase(error);
    document.getElementById('rp-info-body').innerHTML = `
        <p><strong>Nombre:</strong> ${data.nombre}</p>
        <p><strong>Tipo:</strong> ${data.extension ? data.extension.toUpperCase() : 'Desconocido'}</p>
        <p><strong>Tamaño:</strong> ${formatoTamanio(data.tamanio_bytes)}</p>
        <p><strong>Subido por:</strong> ${data.subido_por}</p>
        <p><strong>Fecha de carga:</strong> ${new Date(data.created_at).toLocaleString('es-PE')}</p>
        <button class="btn btn-primary btn-sm" onclick="descargarArchivoRepo('${data.storage_path}','${escapeAttr(data.nombre_original)}')"><i class="fas fa-download"></i> Descargar</button>
    `;
    $('#modal-info-archivo').modal('show');
}

// ------------------------------------------------------------
// BÚSQUEDA
// ------------------------------------------------------------
async function buscarEnRepo(texto) {
    if (!texto.trim()) { document.getElementById('rp-resultados-busqueda').style.display = 'none'; document.getElementById('rp-grid').style.display = 'grid'; return; }

    const { data, error } = await supabaseClient
        .from('archivos_repositorio').select('*')
        .eq('repositorio_id', ESTADO.repoId)
        .ilike('nombre', `%${texto}%`)
        .order('nombre');
    if (error) return manejarErrorSupabase(error);

    document.getElementById('rp-grid').style.display = 'none';
    const cont = document.getElementById('rp-resultados-busqueda');
    cont.style.display = 'block';

    if (!data.length) {
        cont.innerHTML = `<p class="text-muted text-center py-4">Sin resultados para "${texto}".</p>`;
        return;
    }

    cont.innerHTML = `<table class="table table-sm table-hover">
        <thead><tr><th>Nombre</th><th>Tamaño</th><th>Subido</th><th></th></tr></thead>
        <tbody>${data.map(a => {
            const { icon } = iconoPorExtension(a.extension);
            return `<tr>
                <td><i class="fas ${icon} mr-2"></i>${a.nombre}</td>
                <td>${formatoTamanio(a.tamanio_bytes)}</td>
                <td>${new Date(a.created_at).toLocaleDateString('es-PE')}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="descargarArchivoRepo('${a.storage_path}','${escapeAttr(a.nombre_original)}')"><i class="fas fa-download"></i></button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="irACarpetaDeArchivo('${a.carpeta_id || ''}')"><i class="fas fa-folder-open"></i> Ir a la carpeta</button>
                </td>
            </tr>`;
        }).join('')}</tbody>
    </table>`;
}

async function irACarpetaDeArchivo(carpetaId) {
    document.getElementById('rp-buscar').value = '';
    if (!carpetaId) { ESTADO.carpetaId = null; ESTADO.ruta = ESTADO.ruta.slice(0, 1); return cargarContenido(); }

    // Reconstruye la ruta de breadcrumb subiendo por carpeta_padre_id
    let cadena = [];
    let actualId = carpetaId;
    while (actualId) {
        const { data: c } = await supabaseClient.from('carpetas').select('id, nombre, carpeta_padre_id').eq('id', actualId).single();
        if (!c) break;
        cadena.unshift({ id: c.id, nombre: c.nombre });
        actualId = c.carpeta_padre_id;
    }
    ESTADO.ruta = [ESTADO.ruta[0], ...cadena];
    ESTADO.carpetaId = carpetaId;
    cargarContenido();
}

// ------------------------------------------------------------
// COPIAS DE SEGURIDAD
// ------------------------------------------------------------
function nombreSeguroZip(nombre) {
    return String(nombre || 'sin_nombre').replace(/[\\/:*?"<>|]/g, '_').replace(/\.\./g, '_');
}

function fechaHoraBackup() {
    const d = new Date();
    const dos = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}_${dos(d.getHours())}-${dos(d.getMinutes())}-${dos(d.getSeconds())}`;
}

function cambiarEstadoBackup(activo, mensaje) {
    const botones = ['btn-crear-backup', 'btn-restaurar-backup'];
    botones.forEach(id => { const b = document.getElementById(id); if (b) b.disabled = activo; });
    const boton = document.getElementById('btn-crear-backup');
    if (boton) {
        if (!boton.dataset.textoOriginal) boton.dataset.textoOriginal = boton.innerHTML;
        boton.innerHTML = activo ? `<i class="fas fa-spinner fa-spin"></i> ${mensaje || 'Procesando...'}` : boton.dataset.textoOriginal;
    }
}

function construirRutasCarpetas(carpetas) {
    const porId = new Map(carpetas.map(c => [c.id, c]));
    const cache = new Map();
    function ruta(carpetaId) {
        if (!carpetaId) return '';
        if (cache.has(carpetaId)) return cache.get(carpetaId);
        const c = porId.get(carpetaId);
        if (!c) throw new Error(`La carpeta ${carpetaId} no existe.`);
        const valor = [ruta(c.carpeta_padre_id), nombreSeguroZip(c.nombre)].filter(Boolean).join('/');
        cache.set(carpetaId, valor);
        return valor;
    }
    carpetas.forEach(c => ruta(c.id));
    return cache;
}

async function crearCopiaSeguridad() {
    if (!exigirAdminRepositorio()) return;
    if (typeof JSZip === 'undefined') return alert('No se pudo cargar el componente ZIP. Revisa tu conexión e inténtalo nuevamente.');
    cambiarEstadoBackup(true, 'Recopilando biblioteca...');
    try {
        const [rRepos, rCarpetas, rArchivos] = await Promise.all([
            supabaseClient.from('repositorios').select('*').order('nombre'),
            supabaseClient.from('carpetas').select('*').order('nombre'),
            supabaseClient.from('archivos_repositorio').select('*').order('nombre')
        ]);
        if (rRepos.error) throw rRepos.error;
        if (rCarpetas.error) throw rCarpetas.error;
        if (rArchivos.error) throw rArchivos.error;

        const repositorios = rRepos.data || [];
        const carpetas = rCarpetas.data || [];
        const archivos = rArchivos.data || [];
        const rutasCarpetas = construirRutasCarpetas(carpetas);
        const reposPorId = new Map(repositorios.map(r => [r.id, r]));
        const zip = new JSZip();
        const rutasUsadas = new Set();
        const manifiesto = {
            formato: 'SGDE_DUAFARMA_BIBLIOTECA', version: 1,
            creado_en: new Date().toISOString(),
            orden: 'nombre_ascendente', repositorios, carpetas,
            archivos: archivos.map(a => ({ ...a }))
        };

        for (let i = 0; i < archivos.length; i++) {
            const archivo = archivos[i];
            const repo = reposPorId.get(archivo.repositorio_id);
            if (!repo) throw new Error(`El archivo "${archivo.nombre}" no tiene un repositorio válido.`);
            const base = ['biblioteca', nombreSeguroZip(repo.nombre), rutasCarpetas.get(archivo.carpeta_id)].filter(Boolean).join('/');
            let rutaZip = `${base}/${nombreSeguroZip(archivo.nombre_original || archivo.nombre)}`;
            if (rutasUsadas.has(rutaZip.toLowerCase())) {
                const punto = rutaZip.lastIndexOf('.');
                rutaZip = punto > rutaZip.lastIndexOf('/')
                    ? `${rutaZip.slice(0, punto)}_${archivo.id}${rutaZip.slice(punto)}` : `${rutaZip}_${archivo.id}`;
            }
            rutasUsadas.add(rutaZip.toLowerCase());
            const { data, error } = await supabaseClient.storage.from(BUCKET_REPO).download(archivo.storage_path);
            if (error) throw new Error(`No se pudo incluir "${archivo.nombre}": ${error.message}`);
            zip.file(rutaZip, data);
            Object.assign(manifiesto.archivos[i], {
                orden: i,
                categoria: repo.nombre,
                carpeta: rutasCarpetas.get(archivo.carpeta_id) || '',
                ubicacion: [repo.nombre, rutasCarpetas.get(archivo.carpeta_id), archivo.nombre].filter(Boolean).join('/'),
                fecha: archivo.created_at,
                zip_path: rutaZip
            });
        }
        zip.file('biblioteca.json', JSON.stringify(manifiesto, null, 2));
        cambiarEstadoBackup(true, 'Comprimiendo...');
        const contenido = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        const url = URL.createObjectURL(contenido);
        const enlace = document.createElement('a');
        enlace.href = url; enlace.download = `backup_biblioteca_${fechaHoraBackup()}.zip`;
        document.body.appendChild(enlace); enlace.click(); enlace.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        await registrarAuditoria('BACKUP', 'repositorios', null, `Copia de seguridad creada: ${archivos.length} archivo(s)`);
        alert(`Copia de seguridad creada correctamente con ${archivos.length} archivo(s).`);
    } catch (err) {
        console.error('[Backup] Error:', err);
        alert(`No se pudo crear la copia de seguridad.\n\n${err.message || err}`);
    } finally {
        cambiarEstadoBackup(false);
    }
}

function validarManifiestoBackup(manifiesto, zip) {
    if (!manifiesto || manifiesto.formato !== 'SGDE_DUAFARMA_BIBLIOTECA' || manifiesto.version !== 1)
        throw new Error('El ZIP no es una copia de seguridad válida de SGDE DUA FARMA.');
    if (!Array.isArray(manifiesto.repositorios) || !Array.isArray(manifiesto.carpetas) || !Array.isArray(manifiesto.archivos))
        throw new Error('El archivo biblioteca.json está incompleto.');
    for (const archivo of manifiesto.archivos) {
        if (!archivo.zip_path || !zip.file(archivo.zip_path)) throw new Error(`Falta el archivo "${archivo.nombre || 'desconocido'}" dentro del ZIP.`);
    }
}

async function restaurarCopiaSeguridad(archivoZip) {
    if (!exigirAdminRepositorio() || !archivoZip) return;
    if (typeof JSZip === 'undefined') return alert('No se pudo cargar el componente ZIP. Revisa tu conexión e inténtalo nuevamente.');
    cambiarEstadoBackup(true, 'Validando copia...');
    try {
        const zip = await JSZip.loadAsync(archivoZip);
        const entradaManifiesto = zip.file('biblioteca.json');
        if (!entradaManifiesto) throw new Error('El ZIP no contiene biblioteca.json.');
        const manifiesto = JSON.parse(await entradaManifiesto.async('string'));
        validarManifiestoBackup(manifiesto, zip);

        const aceptar = confirm(
            `Se restaurarán ${manifiesto.archivos.length} archivo(s), ${manifiesto.carpetas.length} carpeta(s) y ${manifiesto.repositorios.length} repositorio(s).\n\n` +
            'La biblioteca actual será reemplazada completamente. ¿Deseas continuar?'
        );
        if (!aceptar) return;

        cambiarEstadoBackup(true, 'Restaurando biblioteca...');
        const { data: actuales, error: errorActuales } = await supabaseClient.from('archivos_repositorio').select('storage_path');
        if (errorActuales) throw errorActuales;
        const rutasActuales = (actuales || []).map(a => a.storage_path);
        if (rutasActuales.length) {
            for (let i = 0; i < rutasActuales.length; i += 100) {
                const { error } = await supabaseClient.storage.from(BUCKET_REPO).remove(rutasActuales.slice(i, i + 100));
                if (error) throw error;
            }
        }
        const { error: errorBorrar } = await supabaseClient.from('repositorios').delete().not('id', 'is', null);
        if (errorBorrar) throw errorBorrar;

        if (manifiesto.repositorios.length) {
            const { error } = await supabaseClient.from('repositorios').insert(manifiesto.repositorios);
            if (error) throw error;
        }
        const pendientes = [...manifiesto.carpetas];
        const insertadas = new Set();
        while (pendientes.length) {
            const listas = pendientes.filter(c => !c.carpeta_padre_id || insertadas.has(c.carpeta_padre_id));
            if (!listas.length) throw new Error('La jerarquía de carpetas del respaldo no es válida.');
            const { error } = await supabaseClient.from('carpetas').insert(listas);
            if (error) throw error;
            listas.forEach(c => insertadas.add(c.id));
            listas.forEach(c => pendientes.splice(pendientes.findIndex(p => p.id === c.id), 1));
        }

        for (let i = 0; i < manifiesto.archivos.length; i++) {
            const original = manifiesto.archivos[i];
            const blob = await zip.file(original.zip_path).async('blob');
            const storagePath = original.storage_path;
            const { error: errorSubida } = await supabaseClient.storage.from(BUCKET_REPO)
                .upload(storagePath, blob, { contentType: original.tipo_mime || blob.type, upsert: true });
            if (errorSubida) throw new Error(`No se pudo restaurar "${original.nombre}": ${errorSubida.message}`);
            const registro = {
                id: original.id,
                repositorio_id: original.repositorio_id,
                carpeta_id: original.carpeta_id,
                nombre: original.nombre,
                nombre_original: original.nombre_original,
                extension: original.extension,
                tipo_mime: original.tipo_mime,
                tamanio_bytes: original.tamanio_bytes,
                storage_path: original.storage_path,
                subido_por: original.subido_por,
                created_at: original.created_at
            };
            const { error: errorRegistro } = await supabaseClient.from('archivos_repositorio').insert([registro]);
            if (errorRegistro) throw errorRegistro;
        }
        await registrarAuditoria('RESTORE', 'repositorios', null, `Biblioteca restaurada: ${manifiesto.archivos.length} archivo(s)`);
        ESTADO = { repoId: null, carpetaId: null, ruta: [] };
        await cargarRepositorios();
        alert('Copia de seguridad restaurada correctamente. La biblioteca volvió a su organización original.');
    } catch (err) {
        console.error('[Restauración] Error:', err);
        alert(`No se pudo restaurar la copia de seguridad.\n\n${err.message || err}`);
    } finally {
        cambiarEstadoBackup(false);
    }
}

// ------------------------------------------------------------
// EVENTOS DE UI
// ------------------------------------------------------------
function enlazarEventos() {
    document.getElementById('rp-select-repo').addEventListener('change', (e) => abrirRepo(e.target.value));

    document.getElementById('btn-nuevo-repo').addEventListener('click', () => $('#modal-nuevo-repo').modal('show'));
    document.getElementById('form-nuevo-repo').addEventListener('submit', async (e) => {
        e.preventDefault();
        await crearRepositorio(document.getElementById('nr-nombre').value.trim(), document.getElementById('nr-descripcion').value.trim());
        $('#modal-nuevo-repo').modal('hide');
        e.target.reset();
    });

    document.getElementById('btn-eliminar-repo').addEventListener('click', solicitarClaveEliminarRepositorio);
    document.getElementById('form-clave-eliminar-repo').addEventListener('submit', validarClaveYEliminarRepositorio);
    document.getElementById('rp-clave-eliminar').addEventListener('input', (e) => e.target.classList.remove('is-invalid'));

    document.getElementById('btn-crear-backup').addEventListener('click', crearCopiaSeguridad);
    document.getElementById('btn-restaurar-backup').addEventListener('click', () => document.getElementById('rp-input-backup').click());
    document.getElementById('rp-input-backup').addEventListener('change', async (e) => {
        const archivo = e.target.files[0];
        e.target.value = '';
        await restaurarCopiaSeguridad(archivo);
    });

    document.getElementById('btn-nueva-carpeta').addEventListener('click', () => $('#modal-nueva-carpeta').modal('show'));
    document.getElementById('form-nueva-carpeta').addEventListener('submit', async (e) => {
        e.preventDefault();
        await crearCarpeta(document.getElementById('nc-nombre').value.trim());
        $('#modal-nueva-carpeta').modal('hide');
        e.target.reset();
    });

    document.getElementById('btn-subir-archivo').addEventListener('click', () => document.getElementById('rp-input-archivo').click());
    document.getElementById('rp-input-archivo').addEventListener('change', async (e) => {
        await subirArchivosRepo(e.target.files);
        e.target.value = '';
    });

    const zonaDrop = document.getElementById('rp-zona-drop');
    let profundidadArrastre = 0;
    zonaDrop.addEventListener('dragenter', (e) => {
        e.preventDefault();
        if (!esAdminRepositorio()) return;
        profundidadArrastre++;
        zonaDrop.classList.add('rp-arrastrando');
    });
    zonaDrop.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = esAdminRepositorio() ? 'copy' : 'none';
    });
    zonaDrop.addEventListener('dragleave', (e) => {
        e.preventDefault();
        profundidadArrastre = Math.max(0, profundidadArrastre - 1);
        if (!profundidadArrastre) zonaDrop.classList.remove('rp-arrastrando');
    });
    zonaDrop.addEventListener('drop', async (e) => {
        e.preventDefault();
        profundidadArrastre = 0;
        zonaDrop.classList.remove('rp-arrastrando');
        await subirArchivosRepo(e.dataTransfer.files);
    });

    document.getElementById('form-renombrar').addEventListener('submit', async (e) => {
        e.preventDefault();
        await guardarRenombrado(document.getElementById('rn-id').value, document.getElementById('rn-tipo').value, document.getElementById('rn-nombre').value.trim());
        $('#modal-renombrar').modal('hide');
    });

    let temporizadorBusqueda;
    document.getElementById('rp-buscar').addEventListener('input', (e) => {
        clearTimeout(temporizadorBusqueda);
        temporizadorBusqueda = setTimeout(() => buscarEnRepo(e.target.value), 300);
    });
}
