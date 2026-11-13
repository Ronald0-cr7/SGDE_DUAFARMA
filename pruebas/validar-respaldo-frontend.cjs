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
    data.documentos=[{id:'doc',archivo_path:'poe.pdf',estado:'obsoleto'}];
    data.archivos_repositorio=[{id:'archivo',storage_path:'manual.pdf'}];
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
    w.eval(fs.readFileSync('js/respaldoCompleto.js','utf8'));
    answers=['clave-actual','contraseña-respaldo-123'];await w.SGDEBackup.crear();
    assert.ok(saved,JSON.stringify({alerts,calls}));assert.equal(alerts.length,0);
    const encrypted=new Uint8Array(await saved.arrayBuffer());
    assert.equal(new TextDecoder().decode(encrypted.slice(0,8)),'SGDEBK02');
    assert.ok(!Buffer.from(encrypted).includes(Buffer.from('clave-actual')));
    const material=await webcrypto.subtle.importKey('raw',new TextEncoder().encode('contraseña-respaldo-123'),'PBKDF2',false,['deriveKey']);
    const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt:encrypted.slice(8,24),iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
    const clear=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:encrypted.slice(24,36),additionalData:encrypted.slice(0,8)},key,encrypted.slice(36));
    const zip=await JSZip.loadAsync(clear);const manifest=JSON.parse(await zip.file('sgde.json').async('string'));
    assert.equal(Object.keys(manifest.tablas).length,10);assert.equal(manifest.tablas.log_auditoria.length,1100);
    assert.equal(manifest.archivos.length,2);
    for(const file of manifest.archivos)assert.equal(await digest(await zip.file(file.zip_path).async('uint8array')),file.sha256);
    const before=calls.length;
    answers=['incorrecta'];await w.SGDEBackup.restaurar(saved);
    assert.match(alerts.pop(),/incorrecta o archivo dañado/);assert.equal(calls.length,before);assert.equal(confirmed,0);
    const damaged=encrypted.slice();damaged[damaged.length-1]^=1;
    answers=['contraseña-respaldo-123'];await w.SGDEBackup.restaurar(new Blob([damaged]));
    assert.match(alerts.pop(),/incorrecta o archivo dañado/);assert.equal(calls.length,before);
    answers=['contraseña-respaldo-123','clave-actual'];await w.SGDEBackup.restaurar(saved);
    assert.equal(calls.filter(x=>x==='commit').length,1);
    assert.equal(confirmed,1);assert.match(alerts.pop(),/finalizada/);
    saved=null;changed=true;answers=['clave-actual','contraseña-respaldo-123'];await w.SGDEBackup.crear();
    assert.equal(saved,null);assert.match(alerts.pop(),/Hubo cambios/);
    assert.equal(w.document.getElementById('btn-crear-backup').disabled,false);
    dom.window.close();
    console.log('OK frontend: cifrado autenticado, contraseña errónea, copia alterada, diez tablas y más de mil filas, hashes, remapeo de archivos y rechazo por cambios.');
})().catch(e=>{console.error(e);process.exitCode=1;});
