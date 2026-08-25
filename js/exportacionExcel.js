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
        const d=new Date(String(valor).length===10?`${valor}T00:00:00`:valor);
        if(Number.isNaN(d.getTime())) return valor;
        return new Intl.DateTimeFormat('es-PE',hora
            ? {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}
            : {day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
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
        unir(ws,'A6:J6',`PROVEEDOR:  ${acta.proveedor||''}`,{bold:true,align:'left'});unir(ws,'K6:L6','IMPORTACIÓN',{align:'left'});celda(ws.getCell('M6'),{bold:true});
        unir(ws,'A7:J7',`FECHA DE RECEPCIÓN:  ${fecha(acta.fecha)}`,{bold:true,align:'left'});unir(ws,'K7:L7','OTROS',{align:'left'});celda(ws.getCell('M7'),{bold:true});
        const tipo=String(acta.tipo_ingreso||'').toUpperCase();ws.getCell(tipo.includes('LOCAL')?'M5':tipo.includes('IMPORT')?'M6':'M7').value='X';

        ws.getRow(8).values=['CANT.\nSOLICIT.','CANT.\nRECIB.','CÓDIGO','NOMBRE DEL PRODUCTO','PRESENTACIÓN','CONCENTRACIÓN Y FORMA\nFARMACÉUTICA','FABRICANTE','PAÍS DE\nPROCEDENCIA','LOTE / SERIE','F.VENC.','N° R.S./NSO','COND. DE ALMAC.','ESTADO DEL EMBALAJE'];
        ws.getRow(8).height=40;rango(ws,'A8:M8',{bold:true,size:7});
        const detalles=acta.recepcion_detalle||[], total=Math.max(15,detalles.length);
        for(let i=0;i<total;i++) {
            const f=9+i,d=detalles[i];
            if(d){const p={...(d.productos||{}),...(d.producto_snapshot||{})};ws.getRow(f).values=[Number(d.cant_solicitada||0),Number(d.cant_recibida||0),p.codigo||'',p.nombre||'',p.presentacion||'',p.concentracion_forma||'',p.fabricante||'',p.procedencia||'',d.lote||'',fecha(d.fecha_venc),p.reg_sanitario||'',p.condicion_almacen||'',d.estado_embalaje||''];}
            ws.getRow(f).height=d?47:18;rango(ws,`A${f}:M${f}`,{size:7});celda(ws.getCell(f,1),{fill:C.amarillo,size:7});celda(ws.getCell(f,2),{fill:C.amarillo,size:7});
        }
        const fr=9+total;
        unir(ws,`A${fr}:E${fr}`,'Entregado por (Transportista):',{align:'left',size:7});unir(ws,`F${fr}:M${fr}`,'Recibido por (Almacén):',{align:'left',size:7});
        const iz=[`Nombre: ${acta.transportista_nombre||''}`,`Fecha y hora de inicio: ${fecha(acta.entrega_inicio,true)}`,`Fecha y hora de término: ${fecha(acta.entrega_termino,true)}`];
        const de=[`Nombre: ${acta.recibido_por||''}`,`Fecha y hora de inicio: ${fecha(acta.recepcion_inicio,true)}`,`Fecha y hora de término: ${fecha(acta.recepcion_termino,true)}`];
        iz.forEach((t,i)=>{unir(ws,`A${fr+1+i}:E${fr+1+i}`,t,{align:'left',size:7});unir(ws,`F${fr+1+i}:M${fr+1+i}`,de[i],{align:'left',size:7});});
        const ff=fr+4;unir(ws,`A${ff}:E${ff+4}`,'',{});unir(ws,`F${ff}:M${ff+4}`,'',{});
        unir(ws,`A${ff+5}:E${ff+5}`,'FIRMA:',{bold:true,align:'left'});unir(ws,`F${ff+5}:M${ff+5}`,'FIRMA:',{bold:true,align:'left'});
        unir(ws,`A${ff+7}:M${ff+7}`,'OBSERVACIONES:',{bold:true,align:'left'});unir(ws,`A${ff+8}:M${ff+9}`,'',{});
        ws.pageSetup.printArea=`A2:M${ff+9}`;ws.headerFooter.oddFooter='&LDUA FARMA S.A.C.&CActa de recepción&R&P de &N';
        await descargar(wb,`Acta_${seguro(acta.guia_numero)}_${acta.fecha||''}.xlsx`);
    }

    async function exportarKardexPlantilla(producto,movimientos) {
        if(!producto) throw new Error('No se encontró el producto seleccionado.');
        const wb=new ExcelJS.Workbook();wb.creator='SGDE DUA FARMA';const ws=wb.addWorksheet('KARDEX',{pageSetup:pagina()});
        ws.views=[{showGridLines:false,state:'frozen',ySplit:10}];ws.columns=[11,17,10,10,10,28,16,16,12,12,12,16,16,16].map(width=>({width}));
        unir(ws,'A1:N1','FORMATO',{bold:true,size:9,fill:C.barra});ws.mergeCells('A2:E3');rango(ws,'A2:E3',{border:false});await logo(wb,ws,'A2:B3');
        unir(ws,'F2:M3','CONTROL DE EXISTENCIAS DE PRODUCTOS_DUA FARMA S.A.C.',{bold:true,size:14});
        ws.getCell('N2').value='ÁREA: ALMACÉN';ws.getCell('N3').value='PÁGINA: 1 DE 1';celda(ws.getCell('N2'),{align:'left'});celda(ws.getCell('N3'),{align:'left'});ws.getRow(2).height=27;ws.getRow(3).height=27;
        unir(ws,'A5:E5','NOMBRE DEL PRODUCTO',{bold:true,align:'left',size:10,fill:C.azul});unir(ws,'F5:N5',producto.nombre||'',{bold:true,align:'left',size:10});ws.getRow(5).height=38;
        unir(ws,'A6:E6','CÓDIGO',{bold:true,align:'left',size:10,fill:C.azul});unir(ws,'F6:H6',producto.codigo||'',{bold:true,align:'left',size:9});
        unir(ws,'I6:J6','PRESENTACIÓN',{bold:true,align:'left',size:10,fill:C.azul});unir(ws,'K6:L6',producto.presentacion||'',{bold:true,size:9});
        unir(ws,'M6:M6','REG.SANITARIO N°',{bold:true,align:'left',size:9,fill:C.azul});unir(ws,'N6:N6',producto.reg_sanitario||'',{bold:true,size:9});ws.getRow(6).height=95;
        unir(ws,'A7:E7','FABRICANTE',{bold:true,align:'left',size:9,fill:C.azul});unir(ws,'F7:H7',producto.fabricante||'',{bold:true,align:'left'});
        unir(ws,'I7:J7','DAM',{bold:true,align:'left',size:9,fill:C.azul});unir(ws,'K7:L7',producto.dam||'N.A',{bold:true});
        unir(ws,'M7:M7','PROCEDENCIA',{bold:true,align:'left',size:9,fill:C.azul});unir(ws,'N7:N7',producto.procedencia||'',{bold:true});
        unir(ws,'A9:B9','GUÍA R.',{bold:true,fill:C.azul});unir(ws,'C9:E9','DOCUMENTO',{bold:true,fill:C.azul});unir(ws,'F9:F10','PROVEEDOR / CLIENTE',{bold:true,fill:C.azul});
        unir(ws,'G9:H9','PRODUCTO',{bold:true,fill:C.azul});unir(ws,'I9:K9','OPERACIÓN / CANTIDAD',{bold:true,fill:C.azul});unir(ws,'L9:L10','REALIZADO\nPOR',{bold:true,fill:C.azul});unir(ws,'M9:M10','VERIFICADO\nPOR',{bold:true,fill:C.azul});unir(ws,'N9:N10','OBSERVACIONES',{bold:true,fill:C.azul});
        ['A10','B10','C10','D10','E10','G10','H10','I10','J10','K10'].forEach((ref,i)=>{ws.getCell(ref).value=['FECHA','NÚM.','TIPO','N°','FECHA','N° LOTE /\nSERIE','FECHA DE\nVENC.','INGRESO','SALIDA','SALDO'][i];celda(ws.getCell(ref),{bold:true,size:7,fill:C.azul});});ws.getRow(9).height=27;ws.getRow(10).height=34;
        const total=Math.max(16,movimientos.length);
        for(let i=0;i<total;i++){const f=11+i,m=movimientos[i];if(m)ws.getRow(f).values=[fecha(m.fecha),m.guia_numero||'',m.tipo_doc||'',m.num_doc||'',fecha(m.fecha_doc),m.proveedor_cliente||'',m.lote||'',fecha(m.fecha_venc),Number(m.ingreso||0),Number(m.salida||0),Number(m.saldo||0),m.realizado_por||'',m.verificado_por||'',m.observaciones||''];ws.getRow(f).height=m?34:18;rango(ws,`A${f}:N${f}`,{size:7,fill:m?C.verde:C.blanco});}
        const fs=11+Math.max(movimientos.length,3);unir(ws,`F${fs}:K${fs}`,`STOCK: ${movimientos.length?movimientos[movimientos.length-1].saldo:(producto.stock||0)}`,{bold:true,size:10,border:false});
        const fp=11+total+2;unir(ws,`A${fp}:N${fp}`,'FOR-ALM-011 / VERSIÓN 001',{bold:true,align:'left',border:false});ws.pageSetup.printArea=`A1:N${fp}`;ws.headerFooter.oddFooter='&LDUA FARMA S.A.C.&CKardex de producto&R&P de &N';
        await descargar(wb,`Kardex_${seguro(producto.codigo)}_${new Date().toISOString().slice(0,10)}.xlsx`);
    }
    window.SGDEExcel={exportarActaExcel,exportarKardexPlantilla};
})();
