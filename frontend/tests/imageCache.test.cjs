const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict'), ts=require('typescript');
const files=new Map(); let downloads=0, release;
const storage={cacheDirectory:'file:///cache/',
 async getInfoAsync(uri){return files.has(uri)?{exists:true,isDirectory:false,size:10,modificationTime:1}:{exists:false};},
 async makeDirectoryAsync(){},
 async downloadAsync(url,uri){downloads++;if(url==='slow')await new Promise(r=>release=r);files.set(uri,true);return{status:url==='bad'?403:200};},
 async moveAsync({from,to}){files.delete(from);files.set(to,true);},
 async deleteAsync(uri){for(const path of files.keys())if(path===uri||path.startsWith(uri.endsWith('/')?uri:uri+'/'))files.delete(path);},
 async readDirectoryAsync(dir){return [...files.keys()].filter(p=>p.startsWith(dir)).map(p=>p.slice(dir.length));}
};
function load(){const code=ts.transpileModule(fs.readFileSync(require.resolve('../src/fridgechef/imageCache.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;const context={exports:{},require:n=>n==='react-native'?{Platform:{OS:'ios'}}:storage};vm.runInNewContext(code,context);return context.exports;}
(async()=>{
 let c=load();const [a,b]=await Promise.all([c.storeImage('a','recipe',false,'signed'),c.storeImage('a','recipe',false,'signed')]);assert.equal(a,b);assert.equal(downloads,1);
 c=load();assert.equal(await c.cachedImage('a','recipe',false),a);assert.equal(await c.cachedImage('b','recipe',false),undefined);assert.equal(await c.cachedImage('a','recipe',true),undefined);
 await c.storeImage('a','recipe',false,'new-url');assert.equal(downloads,1);
 assert.equal(await c.storeImage('a','bad',false,'bad'),undefined);assert.equal(await c.cachedImage('a','bad',false),undefined);
 const work=c.storeImage('a','slow',false,'slow');while(!release)await new Promise(r=>setImmediate(r));const deleting=c.removeCachedImage('a','slow');release();await Promise.all([work,deleting]);assert.equal(await c.cachedImage('a','slow',false),undefined);
 await c.storeImage('b','recipe',false,'signed');await c.clearImageCache('a');assert.equal(await c.cachedImage('a','recipe',false),undefined);assert.ok(await c.cachedImage('b','recipe',false));
 process.stdout.write('Image cache restart, isolation, deduplication and deletion passed\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
