const assert=require('node:assert/strict');
const fs=require('node:fs');
const ExcelJS=require('../.test-tools/node_modules/exceljs');

(async()=>{
    const previousTZ=process.env.TZ;
    try {
        for(const zone of ['America/Lima','UTC','Asia/Tokyo','America/Los_Angeles']) {
            process.env.TZ=zone;
            let archivo,nombre;
            class Reloj extends Date {
                constructor(...args){super(...(args.length?args:['2026-11-13T02:30:00Z']));}
            }
            const context={window:{},ExcelJS,Blob,Date:Reloj,Intl,
                fetch:async()=>({ok:false}),setTimeout:fn=>fn(),
                URL:{createObjectURL:b=>{archivo=b;return 'blob:test';},revokeObjectURL:()=>{}},
                document:{body:{appendChild(){}},createElement:()=>({click(){nombre=this.download;},remove(){}})},
            };
            Function(...Object.keys(context),fs.readFileSync('js/exportacionExcel.js','utf8'))(...Object.values(context));
            const acta={guia_numero:'PRUEBA',fecha:'2026-11-12',
                entrega_inicio:'2026-11-12T08:50:00+00:00',entrega_termino:'2026-11-12T08:55:00+00:00',
                recepcion_inicio:'2026-11-12T08:56:00+00:00',recepcion_termino:'2026-11-12T09:25:00+00:00',
                recepcion_detalle:[{cant_solicitada:10,cant_recibida:10,fecha_venc:'2028-01-01',productos:{nombre:'Producto'}}]};
            await context.window.SGDEExcel.exportarActaExcel(acta);
            let wb=new ExcelJS.Workbook();await wb.xlsx.load(await archivo.arrayBuffer());
            const textos=[];wb.worksheets[0].eachRow(row=>row.eachCell(cell=>{if(typeof cell.value==='string')textos.push(cell.value);}));
            for(const expected of ['Fecha y hora de inicio: 12/11/2026, 08:50',
                'Fecha y hora de término: 12/11/2026, 08:55',
                'Fecha y hora de inicio: 12/11/2026, 08:56',
                'Fecha y hora de término: 12/11/2026, 09:25']) assert.ok(textos.includes(expected),`${zone}: ${expected}`);
            // Cruce de medianoche: conservar la fecha/hora que muestra el acta.
            await context.window.SGDEExcel.exportarActaExcel({...acta,
                entrega_inicio:'2026-11-12T23:59:00Z',recepcion_inicio:'2026-11-13T00:01'});
            wb=new ExcelJS.Workbook();await wb.xlsx.load(await archivo.arrayBuffer());
            const midnight=[];wb.worksheets[0].eachRow(r=>r.eachCell(c=>{if(typeof c.value==='string')midnight.push(c.value);}));
            assert.ok(midnight.includes('Fecha y hora de inicio: 12/11/2026, 23:59'));
            assert.ok(midnight.includes('Fecha y hora de inicio: 13/11/2026, 00:01'));
            await context.window.SGDEExcel.exportarKardexPlantilla({codigo:'P1',nombre:'Producto'},[
                {fecha:'2026-11-12',fecha_doc:'2026-11-12',fecha_venc:'2028-01-01',ingreso:10,salida:0,saldo:10},
            ]);
            wb=new ExcelJS.Workbook();await wb.xlsx.load(await archivo.arrayBuffer());
            const sheet=wb.getWorksheet('KARDEX');
            assert.equal(sheet.getCell('A11').value,'12/11/2026');
            assert.equal(sheet.getCell('E11').value,'12/11/2026');
            assert.equal(sheet.getCell('H11').value,'01/01/2028');
            assert.match(nombre,/_2026-11-12\.xlsx$/); // 02:30 UTC todavía es 12/11 en Perú.
        }
    } finally {if(previousTZ===undefined)delete process.env.TZ;else process.env.TZ=previousTZ;}
    console.log('OK Excel: horas del acta iguales al formulario, medianoche y fechas de Kardex en cuatro zonas; nombre del archivo con fecha de Perú.');
})().catch(e=>{console.error(e);process.exitCode=1;});
