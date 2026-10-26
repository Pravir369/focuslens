import test from 'node:test';
import assert from 'node:assert/strict';
import { bootGoogleCompanion } from '../js/google-companion.js';

const response=(data,status=200)=>({ok:status>=200&&status<300,json:async()=>data});
function harness({search='?flow='+'f'.repeat(43),verify}={}){
  const fields=new Map(),calls=[];let config;
  const get=id=>{if(!fields.has(id))fields.set(id,{hidden:false,value:'student',textContent:'',listeners:{},setAttribute(){},replaceChildren(){},focus(){},reportValidity:()=>true,addEventListener(name,fn){this.listeners[name]=fn;}});return fields.get(id);};
  const fetcher=async(path,options)=>{calls.push({path,...options});return path.includes('/config?')?response({clientId:'test.apps.googleusercontent.com',nonce:'browser-nonce',role:'parent',verificationCode:'123456'}):verify?verify(path,options):response({verified:true});};
  const result=bootGoogleCompanion({getElementById:get},{search},fetcher,{loadIdentity:async()=>({initialize:value=>{config=value;},renderButton(){},disableAutoSelect(){}})});
  return {result,get,calls,get config(){return config;}};
}
test('bridge reuses the Google nonce button but sends credentials only to the separate verification endpoint',async()=>{
  const h=harness();await h.result.ready;assert.equal(h.config.nonce,'browser-nonce');assert.equal(h.get('verification-code').textContent,'123456');assert.equal(h.get('google-role').value,'parent');
  h.config.callback({credential:'synthetic-google-id-token'});await new Promise(resolve=>setImmediate(resolve));
  const call=h.calls.at(-1);assert.equal(call.path,'/auth/google/companion/verify');assert.equal(call.credentials,'same-origin');assert.equal(call.redirect,'error');
  assert.deepEqual(JSON.parse(call.body),{flowId:'f'.repeat(43),idToken:'synthetic-google-id-token'});
  assert.equal(h.get('auth-forms').hidden,true);assert.equal(h.get('bridge-complete').hidden,false);
  assert.equal(h.calls.some(call=>call.path==='/auth/google'),false);
});
test('bridge retains password linking with cleared inputs and never sends role or claimed user IDs',async()=>{
  const h=harness({verify:(_,options)=>JSON.parse(options.body).password?response({verified:true}):response({error:'Password required',code:'password_required'},409)});
  await h.result.ready;h.config.callback({credential:'synthetic-google-id-token'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.get('google-link-form').hidden,false);h.get('google-link-password').value='test-focuslens-password';
  h.get('google-link-form').listeners.submit({preventDefault(){},currentTarget:h.get('google-link-form')});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.get('google-link-password').value,'');assert.deepEqual(Object.keys(JSON.parse(h.calls.at(-1).body)).sort(),['flowId','idToken','password']);
});
test('missing or malformed bridge links never load Google or make authentication requests',async()=>{
  for(const search of ['', '?flow=bad', '?flow=https://other.test']){const h=harness({search});await h.result.ready;assert.equal(h.calls.length,0);assert.equal(h.get('auth-forms').hidden,true);assert.match(h.get('bridge-error').textContent,/Start Google sign-in/);}
});
