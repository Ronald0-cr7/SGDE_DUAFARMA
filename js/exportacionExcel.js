// Formatos Excel institucionales para Acta multiproducto y Kardex.
(function () {
    const C = { azul:'8DB3E2', barra:'95B3D7', verde:'92D050', amarillo:'FFF2CC', blanco:'FFFFFF', negro:'000000' };
    const borde = () => { const l={style:'thin',color:{argb:C.negro}}; return {top:l,left:l,bottom:l,right:l}; };

    function celda(c, o={}) {
        c.font={name:'Arial',size:o.size||8,bold:Boolean(o.bold),color:{argb:o.color||C.negro}};
        c.alignment={vertical:o.vertical||'middle',horizontal:o.align||'center',wrapText:o.wrap!==false};
        if(o.fill) c.fill={type:'pattern',pattern:'solid',fgColor:{argb:o.fill}};
        if(o.border!==false) c.border=borde();
    }
    function rango(ws, ref, o={}) {
        const [a,b=a]=ref.split(':'); const x=ws.getCell(a), y=ws.getCell(b);
        for(let f=x.row;f<=y.row;f++) for(let c=x.col;c<=y.col;c++) celda(ws.getCell(f,c),o);
    }
    function unir(ws, ref, valor, o={}) {
        const [inicio,fin]=ref.split(':');
        if(fin && inicio!==fin) ws.mergeCells(ref);
        ws.getCell(inicio).value=valor; rango(ws,ref,o); return ws.getCell(inicio);
    }
    function fecha(valor, hora=false) {
        if(!valor) return '';
        // El formulario histórico guarda datetime-local sin zona y, al editar,
        // recupera los primeros 16 caracteres del TIMESTAMPTZ de Supabase.
        // Estos campos representan la hora escrita en el acta: convertirlos
        // con new Date(valor) restaba cinco horas en Perú. Conservar los mismos
        // componentes que muestra el formulario, sin alterar registros previos.
        const partes=String(valor).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
        if(!partes) return String(valor);
        const [,anio,mes,dia,horas,minutos]=partes;
        const calendario=`${dia}/${mes}/${anio}`;
        return hora && horas!==undefined ? `${calendario}, ${horas}:${minutos}` : calendario;
    }
    function hoyPeru() {
        const partes=new Intl.DateTimeFormat('en-US',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'})
            .formatToParts(new Date());
        const valor=tipo=>partes.find(p=>p.type===tipo).value;
        return `${valor('year')}-${valor('month')}-${valor('day')}`;
    }
    const seguro = t => String(t||'documento').replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,'_');

    async function logo(wb,ws,ref) {
        try {
            const res=await fetch('../imagen.png'); if(!res.ok) return;
            const blob=await res.blob();
            const base64=await new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=fail;r.readAsDataURL(blob);});
            ws.addImage(wb.addImage({base64,extension:'png'}),ref);
        } catch(e) { console.warn('No se pudo insertar el logo:',e); }
    }
    async function descargar(wb,nombre) {
        const buf=await wb.xlsx.writeBuffer();
        const url=URL.createObjectURL(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
        const a=document.createElement('a');a.href=url;a.download=nombre;document.body.appendChild(a);a.click();a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    const pagina = () => ({orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:1,
        margins:{left:.2,right:.2,top:.3,bottom:.3,header:.1,footer:.1}});

    function formatoCantidades(fila, columnas) {
        for (const columna of columnas) {
            const cantidad = fila.getCell(columna);
            cantidad.numFmt = Number.isInteger(cantidad.value) ? '0' : 'General';
        }
    }

    async function exportarActaExcel(acta) {
        const wb=new ExcelJS.Workbook();wb.creator='SGDE DUA FARMA';wb.created=new Date();
        const ws=wb.addWorksheet('ACTA DE RECEPCIÓN',{pageSetup:pagina()});
        ws.views=[{showGridLines:false}];ws.properties.defaultRowHeight=18;
        ws.columns=[7,7,10,31,29,25,22,15,14,13,15,19,20].map(width=>({width}));

        ws.mergeCells('A2:B3');rango(ws,'A2:B3',{border:false});await logo(wb,ws,'A2:B3');
        unir(ws,'C2:J3','ACTA DE RECEPCIÓN DE PRODUCTOS',{bold:true,size:12});
        unir(ws,'K2:M3',`N°: ${acta.guia_numero||'................'}`,{bold:true,size:9});
        ws.getRow(2).height=24;ws.getRow(3).height=24;
        unir(ws,'A4:J4','DATOS GENERALES',{bold:true,align:'left'});unir(ws,'K4:L4','TIPO DE INGRESO:',{bold:true,align:'left'});celda(ws.getCell('M4'),{bold:true});
        unir(ws,'A5:J5',`GUÍA REMISIÓN/FACTURA:  ${acta.guia_numero||''}                                      DAM: N.A`,{bold:true,align:'left'});
        unir(ws,'K5:L5','COMPRA LOCAL',{align:'left'});celda(ws.getCell('M5'),{bold:true});
        unir(ws,'A6:H6',`PROVEEDOR:  ${acta.proveedor||''}`,{bold:true,align:'left'});unir(ws,'I6:K6','IMPORTACIÓN',{align:'left'});celda(ws.getCell('M6'),{bold:true});
        unir(ws,'A7:H7',`FECHA DE RECEPCIÓN:  ${fecha(acta.fecha)}`,{bold:true,align:'left'});unir(ws,'I7:K7','OTROS',{align:'left'});celda(ws.getCell('M7'),{bold:true});
        const tipo=String(acta.tipo_ingreso||'').toUpperCase();ws.getCell(tipo.includes('LOCAL')?'M5':tipo.includes('IMPORT')?'M6':'M7').value='X';

        ws.getRow(8).values=['CANT.\nSOLICIT.','CANT.\nRECIB.','CÓDIGO','NOMBRE DEL PRODUCTO','PRESENTACIÓN','CONCENTRACIÓN Y FORMA\nFARMACÉUTICA','FABRICANTE','PAÍS DE\nPROCEDENCIA','LOTE / SERIE','F.VENC.','N° R.S./NSO','COND. DE ALMAC.','ESTADO DEL EMBALAJE'];
        ws.getRow(8).height=40;rango(ws,'A8:M8',{bold:true,size:7});
        const detalles=acta.recepcion_detalle||[], total=Math.max(15,detalles.length);
        if (detalles.length > 15) {
            ws.pageSetup.fitToHeight = 0;
            ws.pageSetup.printTitlesRow = '2:8';
        }
        for(let i=0;i<total;i++) {
            const f=9+i,d=detalles[i];
            if(d){const p={...(d.productos||{}),...(d.producto_snapshot||{})};ws.getRow(f).values=[Number(d.cant_solicitada||0),Number(d.cant_recibida||0),p.codigo||'',p.nombre||'',p.presentacion||'',p.concentracion_forma||'',p.fabricante||'',p.procedencia||'',d.lote||'',fecha(d.fecha_venc),p.reg_sanitario||'',p.condicion_almacen||'',d.estado_embalaje||''];}
            ws.getRow(f).height=d?47:18;rango(ws,`A${f}:M${f}`,{size:7});celda(ws.getCell(f,1),{fill:C.amarillo,size:7});celda(ws.getCell(f,2),{fill:C.amarillo,size:7});
            if (d) formatoCantidades(ws.getRow(f), [1, 2]);
        }
        const fr=9+total;
        unir(ws,`A${fr}:E${fr}`,'Entregado por (Transportista):',{align:'left',size:7});unir(ws,`F${fr}:M${fr}`,'Recibido por (Almacén):',{align:'left',size:7});
        const iz=[`Nombre: ${acta.transportista_nombre||''}`,`Fecha y hora de inicio: ${fecha(acta.entrega_inicio,true)}`,`Fecha y hora de término: ${fecha(acta.entrega_termino,true)}`];
        const de=[`Nombre: ${acta.recibido_por||''}`,`Fecha y hora de inicio: ${fecha(acta.recepcion_inicio,true)}`,`Fecha y hora de término: ${fecha(acta.recepcion_termino,true)}`];
        iz.forEach((t,i)=>{unir(ws,`A${fr+1+i}:E${fr+1+i}`,t,{align:'left',size:7});unir(ws,`F${fr+1+i}:M${fr+1+i}`,de[i],{align:'left',size:7});});
        const ff=fr+4;unir(ws,`A${ff}:E${ff+4}`,'',{});unir(ws,`F${ff}:M${ff+4}`,'',{});
        unir(ws,`A${ff+5}:E${ff+5}`,'FIRMA:',{bold:true,align:'left'});unir(ws,`F${ff+5}:M${ff+5}`,'FIRMA:',{bold:true,align:'left'});
        unir(ws,`A${ff+7}:M${ff+7}`,'OBSERVACIONES:',{bold:true,align:'left'});unir(ws,`A${ff+8}:M${ff+9}`,'',{});
        unir(ws,`E${ff+11}:K${ff+11}`,'',{border:false});
        for(let col=5;col<=11;col++) ws.getCell(ff+11,col).border={bottom:{style:'thin',color:{argb:C.negro}}};
        unir(ws,`E${ff+12}:K${ff+12}`,'DIRECTOR TÉCNICO',{border:false});
        unir(ws,`E${ff+13}:K${ff+13}`,'DROGUERÍA DUA FARMA S.A.C.',{border:false});
        ws.pageSetup.printArea=`A2:M${ff+13}`;ws.headerFooter.oddFooter='&LDUA FARMA S.A.C.&CActa de recepción&R&P de &N';
        await descargar(wb,`Acta_${seguro(acta.guia_numero)}_${acta.fecha||''}.xlsx`);
    }

    async function exportarKardexPlantilla(producto,movimientos) {
        if(!producto) throw new Error('No se encontró el producto seleccionado.');
        if (movimientos.some(m => producto.actas
            ? m.kardex_lote_id !== producto.id || m.producto_id !== producto.producto_id
            : producto.recepcion_id && (m.recepcion_id !== producto.recepcion_id || m.producto_id !== producto.producto_id))) {
            throw new Error('El archivo contiene movimientos de otro Kardex.');
        }
        const wb=new ExcelJS.Workbook();wb.creator='SGDE DUA FARMA';const ws=wb.addWorksheet('KARDEX',{pageSetup:pagina()});
        ws.views=[{showGridLines:false,state:'frozen',ySplit:10}];ws.columns=[11,23,11,11,11,40,21,17,11,11,11,11,11,16].map(width=>({width}));
        unir(ws,'A1:N1','FORMATO',{bold:true,size:9,fill:C.barra});ws.mergeCells('A2:E3');rango(ws,'A2:E3',{border:false});await logo(wb,ws,'A2:B3');
        unir(ws,'F2:M3','CONTROL DE EXISTENCIAS DE PRODUCTOS_DUA FARMA S.A.C.',{bold:true,size:14});
        if (producto.actas) {
            unir(ws,'A4:N4',`LOTE: ${producto.lote || 'Sin lote'} | VENCIMIENTO: ${fecha(producto.fecha_venc)} | ACTAS DE ORIGEN: ${producto.actas.length}`,{align:'left',size:8,border:false});
        } else if(producto.recepcion_id) unir(ws,'A4:N4',`ACTA: ${producto.acta_guia || 'Sin guía'} | FECHA: ${fecha(producto.acta_fecha)} | ID: ${producto.recepcion_id}`,{align:'left',size:8,border:false});
        ws.getCell('N2').value='ÁREA: ALMACÉN';ws.getCell('N3').value='PÁGINA: 1 DE 1';celda(ws.getCell('N2'),{align:'left'});celda(ws.getCell('N3'),{align:'left'});ws.getRow(2).height=27;ws.getRow(3).height=27;
        unir(ws,'A5:E5','NOMBRE DEL PRODUCTO',{bold:true,align:'left',size:10,fill:C.azul});unir(ws,'F5:N5',producto.nombre||'',{bold:true,align:'left',size:10});ws.getRow(5).height=38;
        unir(ws,'A6:E6','CÓDIGO',{bold:true,align:'left',size:10,fill:C.azul});unir(ws,'F6:F6',producto.codigo||'',{bold:true,align:'left',size:9});
        unir(ws,'G6:H6','PRESENTACIÓN',{bold:true,align:'left',size:10,fill:C.azul});unir(ws,'I6:K6',producto.presentacion||'',{bold:true,size:9});
        unir(ws,'L6:M6','REG.SANITARIO N°',{bold:true,align:'left',size:9,fill:C.azul});unir(ws,'N6:N6',producto.reg_sanitario||'',{bold:true,size:9});ws.getRow(6).height=95;
        unir(ws,'A7:E7','FABRICANTE',{bold:true,align:'left',size:9,fill:C.azul});unir(ws,'F7:F7',producto.fabricante||'',{bold:true,align:'left'});
        unir(ws,'G7:H7','DAM',{bold:true,align:'left',size:9,fill:C.azul});unir(ws,'I7:K7',producto.dam||'N.A',{bold:true});
        unir(ws,'L7:M7','PROCEDENCIA',{bold:true,align:'left',size:9,fill:C.azul});unir(ws,'N7:N7',producto.procedencia||'',{bold:true});
        unir(ws,'A9:B9','GUÍA R.',{bold:true,fill:C.azul});unir(ws,'C9:E9','DOCUMENTO',{bold:true,fill:C.azul});unir(ws,'F9:F10','PROVEEDOR / CLIENTE',{bold:true,fill:C.azul});
        unir(ws,'G9:H9','PRODUCTO',{bold:true,fill:C.azul});unir(ws,'I9:K9','OPERACIÓN / CANTIDAD',{bold:true,fill:C.azul});unir(ws,'L9:L10','REALIZADO\nPOR',{bold:true,fill:C.azul});unir(ws,'M9:M10','VERIFICADO\nPOR',{bold:true,fill:C.azul});unir(ws,'N9:N10','OBSERVACIONES',{bold:true,fill:C.azul});
        ['A10','B10','C10','D10','E10','G10','H10','I10','J10','K10'].forEach((ref,i)=>{ws.getCell(ref).value=['FECHA','NÚM.','TIPO','N°','FECHA','N° LOTE /\nSERIE','FECHA DE\nVENC.','INGRESO','SALIDA','SALDO'][i];celda(ws.getCell(ref),{bold:true,size:7,fill:C.azul});});ws.getRow(9).height=27;ws.getRow(10).height=34;
        const total=Math.max(16,movimientos.length+1);
        if (movimientos.length > 16) {
            ws.pageSetup.fitToHeight = 0;
            ws.pageSetup.printTitlesRow = '1:10';
            ws.getCell('N3').value = 'PÁGINA: ver pie';
        }
        for(let i=0;i<total;i++){const f=11+i,m=movimientos[i];if(m)ws.getRow(f).values=[Number(m.salida)>0 && m.tipo_doc && m.tipo_doc!=='Guía de remisión'?'':fecha(m.fecha),Number(m.salida)>0 && m.tipo_doc && m.tipo_doc!=='Guía de remisión'?'':m.guia_numero||m.num_doc||'',m.tipo_doc==='Guía de remisión'?'':m.tipo_doc||'',m.tipo_doc==='Guía de remisión'?'':m.num_doc||'',m.tipo_doc==='Guía de remisión'?'':fecha(m.fecha_doc),m.proveedor_cliente||'',m.lote||'',fecha(m.fecha_venc),Number(m.ingreso||0),Number(m.salida||0),Number(m.saldo||0),m.realizado_por||'',m.verificado_por||'',m.observaciones||''];ws.getRow(f).height=m?34:18;rango(ws,`A${f}:N${f}`,{size:7,fill:m && Number(m.ingreso)>0?C.verde:C.blanco});}
        for (let i = 0; i < movimientos.length; i++) formatoCantidades(ws.getRow(11 + i), [9, 10, 11]);
        const fs=11+movimientos.length;unir(ws,`F${fs}:F${fs}`,`STOCK: ${movimientos.length?movimientos[movimientos.length-1].saldo:(producto.stock||0)}`,{bold:true,size:10});
        const fp=11+total+2;unir(ws,`A${fp}:N${fp}`,'FOR-ALM-011 / VERSIÓN 001',{bold:true,align:'left',border:false});ws.pageSetup.printArea=`A1:N${fp}`;ws.headerFooter.oddFooter='&LDUA FARMA S.A.C.&CKardex de producto&R&P de &N';
        const identificador = producto.actas ? `${seguro(producto.lote || 'Sin lote')}_${producto.id.slice(0,12)}_`
            : producto.recepcion_id ? `${seguro(producto.acta_guia || 'Acta')}_${producto.recepcion_id}_` : '';
        await descargar(wb,`Kardex_${seguro(producto.codigo)}_${identificador}${hoyPeru()}.xlsx`);
    }
    window.SGDEExcel={exportarActaExcel,exportarKardexPlantilla};
})();
