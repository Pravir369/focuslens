import test from 'node:test';
import assert from 'node:assert/strict';
import { legacySnapshot, acknowledgeLegacy } from '../js/legacy-import.js';
import { AccountStudy, accountWindowFetcher, sessionTransport } from '../js/study-entry.js';
import { AccountApi } from '../js/account-api.js';
const memory=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};};
const summary={id:'old',profileId:'old-browser',startTime:1,endTime:1001,goalMinutes:1,goalEngagementPct:80,phonePolicy:'phone-free',endReason:'ended-early',activeMs:1000,engagedPct:50,averageRecoveryMs:null,distractionCount:1,recoveryCount:0,longestDistractionMs:500};
function legacy(){const storage=memory();storage.setItem('focuslens_profile_id','old-browser');storage.setItem('focuslens.history.v1',JSON.stringify({version:1,enabled:true,records:[{...summary,images:['never-upload']}]}));storage.setItem('focuslens.pacing.v1',JSON.stringify([{profileId:'old-browser',date:'2026-10-25T12:00:00Z',timeToFirstDistraction:null}]));return storage;}
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});

test('legacy export contains only summary/pacing fields and clears only after acknowledgement',()=>{
 const storage=legacy(),snapshot=legacySnapshot(storage);assert.equal(snapshot.payload.localSessionHistory[0].images,undefined);
 assert.equal(acknowledgeLegacy(snapshot,{status:'failed'},storage),false);assert.equal(storage.getItem('focuslens_profile_id'),'old-browser');
 assert.equal(acknowledgeLegacy(snapshot,{status:'complete',acknowledged:2},storage),true);assert.equal(storage.getItem('focuslens_profile_id'),null);assert.equal(storage.getItem('focuslens.history.v1'),null);
});
test('late import acknowledgements preserve newer writes and other profiles',()=>{
 const storage=legacy(),snapshot=legacySnapshot(storage);storage.setItem('focuslens.pacing.v1','[]');
 assert.equal(acknowledgeLegacy(snapshot,{status:'complete',acknowledged:2},storage),false);assert.ok(storage.getItem('focuslens.history.v1'));
 const history=JSON.parse(storage.getItem('focuslens.history.v1'));history.records.push({...summary,id:'other',profileId:'someone-else'});storage.setItem('focuslens.history.v1',JSON.stringify(history));
 const fresh=legacySnapshot(storage);assert.equal(acknowledgeLegacy(fresh,{status:'complete',acknowledged:1},storage),true);
 assert.equal(JSON.parse(storage.getItem('focuslens.history.v1')).records[0].id,'other');
});
const session=()=>({state:'ended',startTime:100000.2,endTime:106000.3,goalMinutes:1,goalEngagementPct:80,phonePolicy:'phone-free',endReason:'ended-early',events:[{type:'distracted',start:100000.2,end:103000.4,duration:3000.2,triggerSource:'cameraB'},{type:'engaged',start:103000.4,end:106000.3,duration:2999.9}],activeSegments:[{start:100000.2,end:106000.3,eventStartIndex:0,eventEndIndex:2}],unclassifiedPeriods:[]});
test('account save creates one session, uploads a whitelisted copy, and retries without changing event logging',async()=>{
 const calls=[];let fail=true;const current=session(),original=structuredClone(current);
 const client={token:'test-account-token',logout(){this.token=null;},async fetcher(url,options){calls.push({url,options});
  if(url==='/sessions'&&options.method==='GET')return response({sessions:[],suggestedMinutes:15});
  if(options.method==='PATCH'&&fail){fail=false;return response({error:'Temporary failure'},503);}return response({id:'session-id'});
 }};
 const bridge=new AccountStudy(client,{id:'verified-user'},{randomUUID:()=> 'session-id'});bridge.started(current);
 await assert.rejects(bridge.save(current),/Temporary failure/);assert.equal(bridge.failures.size,1);await bridge.retry();
 assert.equal(bridge.failures.size,0);assert.deepEqual(current,original);
 const creates=calls.filter(row=>row.options.method==='POST');assert.equal(creates.length,1);
 assert.equal(creates[0].options.headers.Authorization,'Bearer test-account-token');assert.equal(JSON.parse(creates[0].options.body).userId,undefined);
 const patches=calls.filter(row=>row.options.method==='PATCH');assert.equal(patches.length,2);assert.equal(patches[0].options.body,patches[1].options.body);
 assert.deepEqual(JSON.parse(patches[1].options.body),sessionTransport(current));assert.equal(bridge.pacing.suggestion(),15);
 await bridge.flush();
});
test('unauthenticated requests clear expired access and never fall back to profile identity',async()=>{
 let loggedOut=false;const client={token:'expired-test-token',logout(){this.token=null;loggedOut=true;},fetcher:async()=>response({},401)};
 await assert.rejects(new AccountApi(client).request('/sessions'),/sign-in expired/);assert.equal(loggedOut,true);
 await assert.rejects(new AccountApi(client).request('/sessions'),/sign in first/);
});
test('a delayed monitor stop remains scoped to the earlier account session',async()=>{
 const calls=[],user={id:'verified-user'};let serial=0;
 const client={token:'test-token',logout(){},fetcher:async(url,options)=>{calls.push({url,options});return response({});}};
 const bridge=new AccountStudy(client,user,{randomUUID:()=>`session-${++serial}`});
 const earlier=session(),later=session();bridge.started(earlier);const oldId=bridge.current.id;bridge.started(later);const newId=bridge.current.id;
 const fetcher=accountWindowFetcher(bridge,user);
 await fetcher(`/sessions/${oldId}`,{method:'PUT',body:JSON.stringify({sessionId:oldId,profileId:'untrusted',revision:2,active:false,monitorEnabled:true,allowedApps:[]})});
 const stop=calls.find(row=>row.options.method==='PUT');assert.equal(stop.url,`/sessions/${oldId}/activity`);assert.notEqual(oldId,newId);assert.equal(JSON.parse(stop.options.body).profileId,undefined);
 await assert.rejects(fetcher('/sessions/unknown',{method:'PUT',body:JSON.stringify({sessionId:'unknown'})}),/No account session/);
});
