import assert from 'node:assert/strict';
import { createTableWithDb } from '../src/server/tableService.ts';

class Ref { constructor(db,path){this.db=db;this.path=path;this.id=path.split('/').at(-1);} collection(n){return new Col(this.db,this.path+'/'+n);} }
class Col { constructor(db,path){this.db=db;this.path=path;} doc(id){return new Ref(this.db,this.path+'/'+id);} }
class DB {
  constructor(){this.data=new Map();this.lock=Promise.resolve();}
  collection(n){return new Col(this,n);}
  seed(p,v){this.data.set(p,structuredClone(v));}
  async runTransaction(fn){
    const run=this.lock.then(async()=>{
      const writes=[];
      const tx={
        get:async ref=>{
          if(ref instanceof Col){
            const prefix=ref.path+'/';
            const docs=[...this.data.entries()].filter(([p])=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/'))
              .map(([p,v])=>({id:p.split('/').at(-1),data:()=>structuredClone(v)}));
            return {docs};
          }
          const v=this.data.get(ref.path);
          return {exists:v!==undefined,data:()=>v===undefined?undefined:structuredClone(v)};
        },
        create:(ref,v)=>writes.push(['create',ref.path,structuredClone(v)]),
        update:(ref,v)=>writes.push(['update',ref.path,structuredClone(v)])
      };
      const result=await fn(tx);
      for(const [kind,p,v] of writes){
        if(kind==='create'&&this.data.has(p))throw Error('already exists');
        this.data.set(p,kind==='update'?{...this.data.get(p),...v}:v);
      }
      return result;
    });
    this.lock=run.catch(()=>{});
    return run;
  }
}
const db=new DB();db.seed('restaurants/demo',{status:'active',isActive:true});
const table=(id,number)=>({id,tableNumber:number,section:'salle',capacity:4,isActive:true});
const [first,second]=await Promise.all([
  createTableWithDb(db,'demo',table('tbl-1','Table 4'),1000),
  createTableWithDb(db,'demo',table('tbl-2',' table   4 '),1001)
]);
assert.equal([first,second].filter(x=>x.success).length,1,'only one concurrent reservation of the same normalized table number succeeds');
assert.equal([...db.data.keys()].filter(x=>x.includes('/tables/')).length,1,'only one table document is created');
const other=await createTableWithDb(db,'demo',table('tbl-3','Terrasse A'),1002);
assert.equal(other.success,true,'a different table number can be created');
const reused=await createTableWithDb(db,'demo',table('tbl-1','Table 4'),1003);
assert.equal(reused.success,false,'an existing table ID cannot be reused');
const legacyDb=new DB();legacyDb.seed('restaurants/demo',{status:'active'});
legacyDb.seed('restaurants/demo/tables/legacy',{id:'legacy',tableNumber:'Bar 1',capacity:2,isActive:true});
const legacy=await createTableWithDb(legacyDb,'demo',table('tbl-new','bar 1'),1004);
assert.equal(legacy.success,false,'legacy tables without an index still block duplicate numbers');
console.log('✓ Création de tables transactionnelle : unicité concurrente, normalisation, legacy et tenant validés.');
