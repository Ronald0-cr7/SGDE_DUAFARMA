// Agrega el código a una copia descargable del paquete Word.
async function agregarCodigoWord(archivo, codigo) {
    const zip = await JSZip.loadAsync(await archivo.arrayBuffer());
    const parser = new DOMParser();
    const serializer = new XMLSerializer();
    const leerXml = async ruta => {
        const parte = zip.file(ruta);
        if (!parte) throw new Error('El archivo .docx está incompleto.');
        const xml = parser.parseFromString(await parte.async('string'), 'application/xml');
        if (xml.getElementsByTagNameNS('*', 'parsererror').length) throw new Error('El archivo .docx contiene XML inválido.');
        return xml;
    };
    const escribirXml = (ruta, xml) => zip.file(ruta, serializer.serializeToString(xml));
    const rutaDocumento = 'word/document.xml';
    const rutaRelaciones = 'word/_rels/document.xml.rels';
    const documento = await leerXml(rutaDocumento);
    const w = documento.documentElement.namespaceURI;
    const r = w === 'http://purl.oclc.org/ooxml/wordprocessingml/main'
        ? 'http://purl.oclc.org/ooxml/officeDocument/relationships'
        : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const paquete = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const relaciones = zip.file(rutaRelaciones) ? await leerXml(rutaRelaciones)
        : document.implementation.createDocument(paquete, 'Relationships');
    const tipos = await leerXml('[Content_Types].xml');
    const body = documento.getElementsByTagNameNS(w, 'body')[0];
    if (!body) throw new Error('El archivo no contiene un documento Word válido.');

    const secciones = [...body.getElementsByTagNameNS(w, 'sectPr')].filter(seccion => {
        const padre = seccion.parentElement;
        return padre === body || (padre.localName === 'pPr' && padre.parentElement?.parentElement === body);
    });
    if (!secciones.some(seccion => seccion.parentElement === body)) {
        const seccion = documento.createElementNS(w, 'w:sectPr');
        body.append(seccion);
        secciones.push(seccion);
    }

    const mapa = new Map([...relaciones.documentElement.children].map(rel => [rel.getAttribute('Id'), rel]));
    const rutas = new Set();
    const tiposVistos = new Set();
    const ajustes = zip.file('word/settings.xml') ? await leerXml('word/settings.xml') : null;
    const opcionActiva = nodo => nodo && !['0', 'false', 'off'].includes(nodo.getAttributeNS(w, 'val'));
    const paginasPares = opcionActiva(ajustes?.getElementsByTagNameNS(w, 'evenAndOddHeaders')[0]);
    let nuevoId;
    for (const seccion of secciones) {
        const referencias = [...seccion.children].filter(nodo => nodo.namespaceURI === w && nodo.localName === 'headerReference');
        for (const ref of referencias) {
            const rel = mapa.get(ref.getAttributeNS(r, 'id'));
            if (!rel || !rel.getAttribute('Type')?.endsWith('/header') || rel.getAttribute('TargetMode') === 'External') {
                throw new Error('El archivo tiene una referencia de encabezado inválida.');
            }
            const destino = new URL(rel.getAttribute('Target'), 'https://paquete.invalid/word/document.xml');
            if (destino.origin !== 'https://paquete.invalid') throw new Error('El encabezado tiene una ruta externa.');
            rutas.add(decodeURIComponent(destino.pathname.slice(1)));
            tiposVistos.add(ref.getAttributeNS(w, 'type'));
        }
        const requeridos = ['default'];
        if (opcionActiva([...seccion.children].find(nodo => nodo.namespaceURI === w && nodo.localName === 'titlePg'))) requeridos.push('first');
        if (paginasPares) requeridos.push('even');
        for (const tipo of requeridos) {
            if (tiposVistos.has(tipo)) continue;
            if (!nuevoId) {
                let n = 1;
                while (mapa.has(`rIdSGDE${n}`) || zip.file(`word/headerSGDE${n}.xml`)) n++;
                nuevoId = `rIdSGDE${n}`;
                const nombre = `headerSGDE${n}.xml`;
                const ruta = `word/${nombre}`;
                escribirXml(ruta, document.implementation.createDocument(w, 'w:hdr'));
                rutas.add(ruta);
                const rel = relaciones.createElementNS(paquete, 'Relationship');
                rel.setAttribute('Id', nuevoId);
                rel.setAttribute('Type', `${r}/header`);
                rel.setAttribute('Target', nombre);
                relaciones.documentElement.append(rel);
                const tipoParte = tipos.createElementNS(tipos.documentElement.namespaceURI, 'Override');
                tipoParte.setAttribute('PartName', `/${ruta}`);
                tipoParte.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml');
                tipos.documentElement.append(tipoParte);
            }
            const ref = documento.createElementNS(w, 'w:headerReference');
            ref.setAttributeNS(w, 'w:type', tipo);
            ref.setAttributeNS(r, 'r:id', nuevoId);
            seccion.prepend(ref);
            tiposVistos.add(tipo);
        }
    }

    for (const ruta of rutas) {
        const encabezado = await leerXml(ruta);
        const elemento = nombre => encabezado.createElementNS(w, `w:${nombre}`);
        const marca = 'SGDE_CODIGO_DOCUMENTO';
        const anterior = [...encabezado.documentElement.children].find(nodo =>
            nodo.namespaceURI === w && nodo.localName === 'sdt'
                && nodo.getElementsByTagNameNS(w, 'tag')[0]?.getAttributeNS(w, 'val') === marca);
        const control = elemento('sdt');
        const propiedades = elemento('sdtPr');
        const etiqueta = elemento('tag');
        etiqueta.setAttributeNS(w, 'w:val', marca);
        propiedades.append(etiqueta);
        const contenido = elemento('sdtContent');
        const parrafo = elemento('p');
        const segmento = elemento('r');
        const texto = elemento('t');
        texto.textContent = `Código: ${codigo}`;
        segmento.append(texto);
        parrafo.append(segmento);
        contenido.append(parrafo);
        control.append(propiedades, contenido);
        if (anterior) anterior.replaceWith(control);
        else encabezado.documentElement.append(control);
        escribirXml(ruta, encabezado);
    }
    if (nuevoId) {
        escribirXml(rutaDocumento, documento);
        escribirXml(rutaRelaciones, relaciones);
        escribirXml('[Content_Types].xml', tipos);
    }
    return zip.generateAsync({
        type: 'blob', compression: 'DEFLATE',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
}
