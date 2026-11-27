const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto,randomUUID}=require('node:crypto');
(async()=>{
    let handler,role='admin',active=true,corrupt=false,commits=0;
    const jobs=new Map(),objects=new Map(),files=[];
    const snapshot={revision:'revision-inicial',esquema:[{tabla:'usuarios',columna:'id'}],tablas:{},archivos:[]};
    const db={
        auth:{
            async getUser(token){return {data:{user:token==='token-admin'?{id:'auth-admin',email:'admin@example.com'}:null}};},
            async signInWithPassword({email,password}){
                return {data:{user:email==='admin@example.com'&&password==='clave-admin'?{id:'auth-admin'}:null}};
            },
            async signOut(){return {error:null};},
        },
        from(table){
            const filters={};
            return {select(){return this;},eq(k,v){filters[k]=v;return this;},
                async maybeSingle(){
                    if(table==='usuarios')return {data:filters.auth_user_id==='auth-admin'&&role===filters.rol&&active===filters.activo?{username:'admin'}:null,error:null};
                    if(table==='sgde_backup_jobs')return {data:jobs.get(filters.id)||null,error:null};
                    throw Error(`Consulta inesperada: ${table}`);
                },
                async insert(row){
                    if(table==='sgde_backup_jobs')jobs.set(row.id,{...row,estado:'preparando',expires_at:new Date(Date.now()+3600000).toISOString()});
                    else if(table==='sgde_backup_files')files.push(row);
                    else throw Error(`Inserción inesperada: ${table}`);
                    return {data:null,error:null};
                }};
        },
        storage:{from(bucket){return {
            async upload(path,bytes){objects.set(`${bucket}/${path}`,{bytes:bytes.slice(0),revision:randomUUID()});return {data:{path},error:null};},
            async download(path){const object=objects.get(`${bucket}/${path}`);return {data:new Blob([corrupt?'alterado':object.bytes]),error:null};},
            async remove(paths){for(const path of paths)objects.delete(`${bucket}/${path}`);return {data:null,error:null};},
        };}},
        async rpc(name,args){
            if(name==='sgde_backup_snapshot')return {data:structuredClone(snapshot),error:null};
            if(name==='sgde_backup_object_revision')return {data:objects.get(`${args.p_bucket}/${args.p_path}`)?.revision,error:null};
            if(name==='sgde_backup_restore'){commits++;jobs.get(args.p_job).estado='completado';return {data:{registros:1,archivos:args.p_archivos.length},error:null};}
            throw Error(`RPC inesperado: ${name}`);
        },
    };
    const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/sgde-backup/index.ts','utf8').replace(/^import .*;\s*$/m,''));
    vm.runInNewContext(source,{createClient:()=>db,crypto:webcrypto,TextEncoder,Uint8Array,Response,URL,Date,
        Deno:{env:{get:key=>key==='SGDE_BACKUP_ORIGINS'?'https://sgde.example':'test'},serve:fn=>{handler=fn;}}});
    const request=async(action,body,session,extra={},origin='https://sgde.example')=>{
        const raw=body instanceof Blob;
        const response=await handler(new Request(`https://proyecto.supabase.co/functions/v1/sgde-backup?action=${action}`,{
            method:'POST',headers:{Origin:origin,Authorization:'Bearer token-admin','Content-Type':raw?body.type:'application/json',
                ...(session?{'x-backup-job':session.id,'x-backup-token':session.token}:{}),...extra},
            body:raw?body:JSON.stringify(body),
        }));
        return {status:response.status,data:await response.json()};
    };
    const credentials={usuario:'admin',password:'clave-admin',esquema:snapshot.esquema};
    assert.equal((await request('snapshot',credentials,null,{},'https://otro.example')).status,403);
    assert.equal((await request('snapshot',{usuario:'admin',password:'incorrecta'})).status,401);
    assert.equal((await request('snapshot',credentials,null,{Authorization:'Bearer anon-test'})).status,401);
    role='auxiliar';assert.equal((await request('snapshot',credentials)).status,403);role='admin';
    active=false;assert.equal((await request('start',credentials)).status,403);active=true;
    assert.equal((await request('snapshot',credentials)).status,200);
    assert.equal((await request('start',{...credentials,esquema:[]})).status,400);
    const session=(await request('start',credentials)).data;
    assert.ok(jobs.get(session.id).token_hash!==session.token);
    const blob=new Blob(['archivo'],{type:'application/pdf'});
    const sha=Buffer.from(await webcrypto.subtle.digest('SHA-256',await blob.arrayBuffer())).toString('hex');
    const headers={'x-file-bucket':'documentos','x-file-sha256':sha};
    assert.equal((await request('upload',blob,{...session,token:'incorrecto'},headers)).status,401);
    assert.equal((await request('upload',blob,session,{...headers,'x-file-bucket':'otro'})).status,400);
    assert.equal((await request('upload',blob,session,{...headers,'x-file-sha256':'0'.repeat(64)})).status,400);
    assert.equal(objects.size,0);
    corrupt=true;assert.equal((await request('upload',blob,session,headers)).status,400);
    assert.equal(objects.size,0);assert.equal(files.length,0);corrupt=false;
    const uploaded=await request('upload',blob,session,headers);
    assert.equal(uploaded.status,200);assert.equal(files.length,1);
    assert.equal(uploaded.data.sha256,sha);assert.ok(uploaded.data.path.startsWith(`sgde-restauraciones/${session.id}/`));
    active=false;assert.equal((await request('commit',{archivos:[uploaded.data]},session)).status,403);active=true;
    const committed=await request('commit',{tablas:{},esquema:snapshot.esquema,archivos:[uploaded.data]},session);
    assert.equal(committed.status,200);assert.equal(commits,1);
    assert.equal((await request('commit',{archivos:[]},session)).status,401);assert.equal(commits,1);
    const expired=(await request('start',credentials)).data;jobs.get(expired.id).expires_at='2000-01-01';
    assert.equal((await request('upload',blob,expired,headers)).status,401);
    console.log('OK servidor: orígenes, credenciales, rol activo, esquema, tokens, hash y lectura de archivos, vencimiento y rechazo de reutilización.');
})().catch(e=>{console.error(e);process.exitCode=1;});
