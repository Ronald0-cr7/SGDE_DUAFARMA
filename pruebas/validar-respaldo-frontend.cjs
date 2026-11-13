const assert=require('node:assert/strict');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const {JSDOM}=require('../.test-tools/node_modules/jsdom');
const JSZip=require('../.test-tools/node_modules/jszip');
const tables=['usuarios','productos','recepciones','recepcion_detalle','kardex_movimientos','documentos',
    'log_auditoria','repositorios','carpetas','archivos_repositorio'];
const digest=async b=>Buffer.from(await webcrypto.subtle.digest('SHA-256',b)).toString('hex');
(async()=>{
    const dom=new JSDOM('<button id="btn-crear-backup"></button><button id="btn-restaurar-backup"></button><p id="rp-backup-estado"></p>',{url:'https://sgde.example/html/repositorios.html',runScripts:'outside-only'});
    const w=dom.window;
    Object.defineProperty(w,'crypto',{value:webcrypto});
    Object.assign(w,{TextEncoder,Uint8Array,ArrayBuffer,Blob,JSZip});
    let saved=null,answers=[],alerts=[],calls=[],confirmed=0,changed=false;
    w.URL.createObjectURL=blob=>{saved=blob;return 'blob:test';};w.URL.revokeObjectURL=()=>{};
    w.HTMLAnchorElement.prototype.click=function(){};
    let aborted=false;
    w.showSaveFilePicker=async()=>({createWritable:async()=>{
        const chunks=[];
        return {write:async bytes=>chunks.push(new Uint8Array(bytes).slice()),
            close:async()=>{saved=new Blob(chunks);},abort:async()=>{aborted=true;}};
    }});
    w.HTMLDialogElement.prototype.showModal=function(){
        const answer=answers.shift();assert.ok(answer,'Respuesta de contraseña ausente');
        for(const input of this.querySelectorAll('input'))input.value=answer;
        this.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));
    };
    w.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new w.Event('close'));};
    w.alert=s=>alerts.push(s);w.confirm=()=>{confirmed++;return true;};
    w.exigirAdminRepositorio=()=>true;w.registrarAuditoria=async()=>{};
    w.SESION={usuario:'admin',rol:'admin'};
    const data=Object.fromEntries(tables.map(t=>[t,[]]));
    data.usuarios=[{username:'admin',password:'clave-actual',rol:'admin',activo:true}];
    data.log_auditoria=Array.from({length:1100},(_,i)=>({id:`log-${i}`}));
    data.documentos=[{id:'doc',archivo_path:'poe.pdf',estado:'obsoleto',categoria:'POE',archivo_nombre:'poe.pdf'}];
    data.repositorios=[{id:'repo',nombre:'Procedimientos'}];
    data.carpetas=[{id:'carpeta',repositorio_id:'repo',nombre:'Operación',carpeta_padre_id:null}];
    data.archivos_repositorio=[{id:'archivo',storage_path:'manual.pdf',repositorio_id:'repo',carpeta_id:'carpeta',nombre:'manual.pdf',extension:'pdf'}];
    const snapshot={tablas:data,esquema:[{tabla:'usuarios',columna:'username',tipo:'text',nullable:'NO'}],
        revision:'original',archivos:[{bucket:'documentos',path:'poe.pdf',metadata:{mimetype:'application/pdf'}},
            {bucket:'repositorios',path:'manual.pdf',metadata:{mimetype:'application/pdf'}}]};
    const content=new TextEncoder().encode('documento de prueba');
    let snapshots=0;
    w.supabaseClient={supabaseUrl:'https://proyecto.supabase.co',supabaseKey:'anon-test',storage:{from:()=>({download:async()=>({data:new Blob([content])})})}};
    w.fetch=async(url,opts)=>{
        const action=new URL(url).searchParams.get('action');calls.push(action);
        let response;
        if(action==='snapshot'){
            snapshots++;response=structuredClone(snapshot);
            if(changed&&snapshots%2===0)response.revision='cambio';
        }else if(action==='start')response={id:'job',token:'secreto-temporal'};
        else if(action==='upload'){
            const bytes=await opts.body.arrayBuffer();assert.equal(await digest(bytes),opts.headers['x-file-sha256']);
            response={bucket:opts.headers['x-file-bucket'],path:`sgde-restauraciones/job/${calls.length}`,sha256:await digest(bytes),bytes:bytes.byteLength};
        }else if(action==='commit'){
            const body=JSON.parse(opts.body);
            assert.equal(body.tablas.log_auditoria.length,1100);
            assert.equal(body.tablas.documentos[0].estado,'obsoleto');
            assert.ok(body.tablas.documentos[0].archivo_path.startsWith('sgde-restauraciones/job/'));
            assert.ok(body.tablas.archivos_repositorio[0].storage_path.startsWith('sgde-restauraciones/job/'));
            assert.equal(body.archivos.length,2);response={registros:1103,archivos:2};
        }else throw Error(action);
        return {ok:true,json:async()=>response};
    };
    w.eval(fs.readFileSync('js/backupZip.js','utf8'));
    w.eval(fs.readFileSync('js/respaldoCompleto.js','utf8'));
    answers=['clave-actual'];await w.SGDEBackup.crear();
    assert.ok(saved,JSON.stringify({alerts,calls}));assert.equal(alerts.length,0);
    assert.equal(answers.length,0,'Solo debe pedir la contraseña actual');
    const clear=await saved.arrayBuffer();
    const zip=await JSZip.loadAsync(clear);const manifest=JSON.parse(await zip.file('sgde.json').async('string'));
    assert.equal(manifest.version,3);
    assert.ok(zip.file('repositorios/Procedimientos/Operación/manual.pdf'));
    assert.ok(zip.file('documentos/POE/poe.pdf'));
    for(const table of tables)assert.ok(zip.file(`datos/${table}.json`));
    assert.equal(Object.keys(manifest.tablas).length,10);assert.equal(manifest.tablas.log_auditoria.length,1100);
    assert.equal(manifest.archivos.length,2);
    for(const file of manifest.archivos)assert.equal(await digest(await zip.file(file.zip_path).async('uint8array')),file.sha256);
    const before=calls.length;
    zip.file(manifest.archivos[0].zip_path,'contenido alterado');
    await w.SGDEBackup.restaurar(await zip.generateAsync({type:'uint8array'}).then(b=>new Blob([b])));
    assert.match(alerts.pop(),/Archivo dañado/);assert.equal(calls.length,before);assert.equal(confirmed,0);
    answers=['clave-actual'];await w.SGDEBackup.restaurar(saved);
    assert.equal(calls.filter(x=>x==='commit').length,1);
    assert.equal(confirmed,1);assert.match(alerts.pop(),/finalizada/);
    saved=null;changed=true;answers=['clave-actual'];await w.SGDEBackup.crear();
    assert.equal(saved,null);assert.match(alerts.pop(),/Hubo cambios/);
    assert.equal(aborted,true,'Debe descartar el ZIP incompleto');
    assert.equal(w.document.getElementById('btn-crear-backup').disabled,false);
    dom.window.close();
    console.log('OK frontend: ZIP organizado, escritura incremental, diez tablas y más de mil filas, hashes, copia alterada, restauración y descarte por cambios.');
})().catch(e=>{console.error(e);process.exitCode=1;});
