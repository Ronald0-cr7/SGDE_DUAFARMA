const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('../.test-tools/node_modules/@electric-sql/pglite');

(async () => {
    const db = new PGlite();
    const sql = f => fs.readFileSync(`sql/${f}`, 'utf8');
    await db.exec(`create role anon; create role authenticated; create role service_role;
        create schema storage;
        create table storage.buckets(id text primary key,name text,public boolean);
        create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,
            name text,metadata jsonb,updated_at timestamptz default now(),unique(bucket_id,name));`);
    await db.exec(sql('schema.sql').replace('create extension if not exists "pgcrypto";', ''));
    for (const f of ['migracion_actas_kardex_excel.sql','migracion_edicion_kardex.sql',
        'migracion_edicion_actas.sql','migracion_salidas_kardex.sql','migracion_kardex_por_acta.sql',
        'migracion_eliminar_kardex.sql','migracion_documentos_salidas_kardex.sql','repositorios.sql',
        'respaldo_completo.sql']) await db.exec(sql(f));
    await db.exec(sql('respaldo_completo.sql')); // instalación repetible
    const query = async (q,p=[]) => (await db.query(q,p)).rows;
    const snapshot = async () => (await query('select sgde_backup_snapshot() s'))[0].s;
    const p = (await query('select id from productos order by codigo'))[0].id;
    await query('select registrar_recepcion_completa($1,$2)',[
        JSON.stringify({fecha:'2026-11-13',guia_numero:'PRUEBA',proveedor:'Proveedor',usuario_registro:'admin'}),
        JSON.stringify([{producto_id:p,cant_recibida:'100.1234567890123456789',cant_solicitada:'100.1234567890123456789',lote:'L1'}])]);
    const repo=(await query("insert into repositorios(nombre,creado_por) values('Prueba','admin') returning id"))[0].id;
    const parent=randomUUID(), child=randomUUID();
    await query("insert into carpetas(id,repositorio_id,nombre,creado_por) values($1,$2,'Padre','admin')",[parent,repo]);
    await query("insert into carpetas(id,repositorio_id,carpeta_padre_id,nombre,creado_por) values($1,$2,$3,'Hija','admin')",[child,repo,parent]);
    await query("insert into archivos_repositorio(repositorio_id,carpeta_id,nombre,nombre_original,storage_path,subido_por,tamanio_bytes) values($1,$2,'Manual','manual.pdf','original/manual.pdf','admin',5)",[repo,child]);
    await query("update documentos set archivo_path='original/poe.pdf' where id=(select id from documentos limit 1)");
    await db.exec("insert into storage.objects(bucket_id,name,metadata) values('repositorios','original/manual.pdf','{\"size\":5}'),('documentos','original/poe.pdf','{\"size\":5}')");
    await db.exec("insert into log_auditoria(usuario,accion,tabla,detalle) select 'admin','PRUEBA','sistema',i::text from generate_series(1,1105) i");
    const original=await snapshot();
    assert.equal(original.tablas.log_auditoria.length,1105);
    assert.equal(original.tablas.productos.find(x=>x.id===p).stock,'100.1234567890123456789');
    const flags=async()=>await query("select tgname,tgenabled from pg_trigger where not tgisinternal order by tgname");
    const initialFlags=await flags();
    const restore=async(tables,options={})=>{
        const before=await snapshot();
        const id=randomUUID();
        await query("insert into sgde_backup_jobs(id,token_hash,actor,revision) values($1,'hash','admin',$2)",[id,before.revision]);
        const files=[];
        const data=structuredClone(tables);
        for(const [table,field,bucket] of [['archivos_repositorio','storage_path','repositorios'],['documentos','archivo_path','documentos']]){
            for(const row of data[table]) if(row[field]) {
                const path=`sgde-restauraciones/${id}/${randomUUID()}`;
                await query("insert into storage.objects(bucket_id,name,metadata) values($1,$2,'{\"size\":5}')",[bucket,path]);
                const revision=(await query('select sgde_backup_object_revision($1,$2) r',[bucket,path]))[0].r;
                await query("insert into sgde_backup_files(job_id,bucket,path,sha256,bytes,object_revision) values($1,$2,$3,'abc',5,$4)",[id,bucket,path,revision]);
                row[field]=path;files.push({bucket,path,sha256:'abc',bytes:5});
            }
        }
        if(options.changed)await db.exec("update productos set nombre=nombre||' cambiado' where codigo='D00031'");
        if(options.tampered)await query("update storage.objects set updated_at=updated_at+interval '1 second' where name=$1",[files[0].path]);
        if(options.missing) files.pop();
        const result=await query('select sgde_backup_restore($1,$2,$3,$4) r',[
            id,JSON.stringify(data),JSON.stringify(original.esquema),JSON.stringify(files)]);
        return {result:result[0].r,id,files};
    };
    const badStock=structuredClone(original.tablas);badStock.productos.find(x=>x.id===p).stock=999;
    await assert.rejects(restore(badStock),/stock y movimientos/);
    assert.deepEqual((await snapshot()).tablas,original.tablas);
    assert.deepEqual(await flags(),initialFlags);
    const badFK=structuredClone(original.tablas);badFK.recepcion_detalle[0].producto_id=randomUUID();
    await assert.rejects(restore(badFK),/foreign key/i);
    assert.deepEqual((await snapshot()).tablas,original.tablas);
    const cycle=structuredClone(original.tablas);cycle.carpetas.find(x=>x.id===parent).carpeta_padre_id=child;
    await assert.rejects(restore(cycle),/jerarquía/);
    assert.deepEqual((await snapshot()).tablas,original.tablas);
    await assert.rejects(restore(original.tablas,{missing:true}),/no fue restaurado/);
    await assert.rejects(restore(original.tablas,{tampered:true}),/sin verificar/);
    await assert.rejects(restore(original.tablas,{changed:true}),/información cambió/);
    await query('update productos set nombre=$1 where id=$2',[original.tablas.productos.find(x=>x.id===p).nombre,p]);
    // Una falla de auditoría debe revertir también el TRUNCATE y los triggers.
    await db.exec(`create function prueba_respaldo_falla() returns trigger language plpgsql as $$
        begin if new.accion='RESTORE' then raise exception 'Auditoria de restauracion falla'; end if; return new; end $$;
        create trigger prueba_respaldo_falla before insert on log_auditoria for each row execute function prueba_respaldo_falla();`);
    await assert.rejects(restore(original.tablas),/Auditoria de restauracion falla/);
    assert.deepEqual((await snapshot()).tablas,original.tablas);
    await db.exec('drop trigger prueba_respaldo_falla on log_auditoria');
    const ok=await restore(original.tablas);
    assert.equal(ok.result.archivos,2);
    const restored=await snapshot();
    for(const t of ['usuarios','productos','recepciones','recepcion_detalle','kardex_movimientos','carpetas','repositorios'])
        assert.deepEqual(restored.tablas[t],original.tablas[t],t);
    assert.equal(restored.tablas.documentos.length,original.tablas.documentos.length);
    assert.equal(restored.tablas.log_auditoria.filter(x=>x.accion==='RESTORE').length,1);
    assert.ok(restored.tablas.archivos_repositorio[0].storage_path.startsWith(`sgde-restauraciones/${ok.id}/`));
    assert.equal((await query("select count(*)::int n from storage.objects where name like 'original/%'"))[0].n,2);
    assert.deepEqual(await flags(),initialFlags);
    await assert.rejects(query('select sgde_backup_restore($1,$2,$3,$4)',[ok.id,JSON.stringify(original.tablas),JSON.stringify(original.esquema),'[]']),/completada/);
    await db.exec('set role anon');
    await assert.rejects(snapshot(),/permission denied/);
    await assert.rejects(query('select * from sgde_backup_jobs'),/permission denied/);
    await assert.rejects(query('select sgde_backup_restore($1,$2,$3,$4)',[randomUUID(),'{}','[]','[]']),/permission denied/);
    await db.exec('reset role');
    await db.close();
    console.log('OK respaldo SQL: diez tablas, archivos, versiones, saldos, permisos, cambios concurrentes, referencias, atomicidad, auditoría y conservación de originales.');
})().catch(e=>{console.error(e);process.exitCode=1;});
