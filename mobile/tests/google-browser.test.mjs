import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthSession } from '../src/session.js';
import { GoogleBrowserLogin } from '../src/google-browser.js';

const user={id:'verified-google-account',email:'student@example.test',displayName:'Student',role:'student'};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
async function setup() {
  let saved=null;const calls=[],urls=[];
  const api={baseUrl:'https://focuslens.example.test',request:async(path,options)=>{
    calls.push({path,...options});
    if(path.endsWith('/start'))return {flowId:'f'.repeat(43),verificationCode:'123456',expiresIn:600};
    if(path.endsWith('/check'))return {status:'ready',user};
    if(path.endsWith('/finish'))return {token:'test-app-jwt',user};
    if(path==='/auth/me')return user;
    return {cancelled:true};
  }};
  const session=new AuthSession({getToken:async()=>saved,setToken:async token=>{saved=token;},clearToken:async()=>{saved=null;}},api);
  await session.restore();
  const dependencies={makeProof:async()=>({verifier:'private-verifier-'+'v'.repeat(48),challenge:'c'.repeat(43)}),openBrowser:async url=>{urls.push(url);}};
  const flow=new GoogleBrowserLogin(session,dependencies);
  return {flow,session,api,calls,urls,saved:()=>saved};
}
test('Google browser verification never signs in until the account is explicitly confirmed',async()=>{
  const {flow,session,calls,urls,saved}=await setup();await flow.start('parent');
  assert.equal(flow.state.phase,'ready');assert.equal(session.state.phase,'signedOut');assert.equal(saved(),null);
  assert.deepEqual(calls[0].body,{challenge:'c'.repeat(43),role:'parent'});
  assert.equal(urls.length,1);const url=new URL(urls[0]);assert.deepEqual([...url.searchParams.keys()],['flow']);
  assert.equal(url.origin,'https://focuslens.example.test');assert.ok(!url.href.includes('private-verifier'));assert.ok(!url.href.includes(user.email));
  await flow.confirm();assert.equal(session.state.phase,'signedIn');assert.equal(saved(),'test-app-jwt');
  assert.deepEqual(calls.slice(-2).map(call=>call.path),['/auth/google/companion/finish','/auth/me']);
  assert.equal(calls.at(-1).token,'test-app-jwt');
});
test('an unfinished browser login can be checked or reopened, and cancellation erases its private proof',async()=>{
  const {flow,api,calls,saved}=await setup(),original=api.request;
  let ready=false;api.request=async(path,options)=>path.endsWith('/check')&&!ready?{status:'pending'}:original(path,options);
  await flow.start('student');assert.equal(flow.state.phase,'pending');await flow.confirm();assert.equal(saved(),null);
  ready=true;await flow.check();assert.equal(flow.state.phase,'ready');
  await flow.cancel();assert.equal(flow.pending,null);assert.equal(flow.state.phase,'idle');assert.equal(saved(),null);
  assert.equal(calls.at(-1).path,'/auth/google/companion/cancel');
});
test('mismatched issued identity or unverified /me never saves access',async()=>{
  for(const endpoint of ['finish','me']){
    const {flow,api,session,saved}=await setup(),original=api.request;
    api.request=async(path,options)=>path.endsWith('/'+endpoint)?(endpoint==='me'?{...user,id:'wrong-user'}:{token:'test-app-jwt',user:{...user,id:'wrong-user'}}):original(path,options);
    await flow.start('student');await flow.confirm();assert.equal(saved(),null);assert.equal(session.token,null);assert.equal(session.state.phase,'signedOut');
    assert.equal(flow.state.phase,'idle');assert.equal(flow.pending,null);
  }
});
test('logout wins over a delayed browser exchange and secure identity cannot be resurrected',async()=>{
  const {flow,api,session,saved}=await setup(),finish=deferred(),original=api.request;
  api.request=(path,options)=>path.endsWith('/finish')?finish.promise:original(path,options);
  await flow.start('student');const confirming=flow.confirm();await session.logout();finish.resolve({token:'late-jwt',user});await confirming;
  assert.equal(session.state.phase,'signedOut');assert.equal(saved(),null);
});
test('unmount and changed authentication invalidate late browser callbacks',async()=>{
  const {flow,api,session,calls,saved}=await setup(),check=deferred(),original=api.request;
  api.request=(path,options)=>path.endsWith('/check')?check.promise:original(path,options);
  const starting=flow.start('student');await new Promise(resolve=>setImmediate(resolve));flow.dispose();
  check.resolve({status:'ready',user});await starting;assert.equal(saved(),null);assert.equal(session.state.phase,'signedOut');
  assert.equal(calls.filter(call=>call.path.endsWith('/finish')).length,0);
});
test('provider and browser errors cannot expose private messages, and duplicate confirms issue one exchange',async()=>{
  const {flow,api,calls}=await setup(),original=api.request,finish=deferred();await flow.start('student');
  api.request=(path,options)=>{if(path.endsWith('/finish')){calls.push({path,...options});return finish.promise;}return original(path,options);};
  const first=flow.confirm();await flow.confirm();finish.resolve({token:'test-app-jwt',user});await first;
  assert.equal(calls.filter(call=>call.path.endsWith('/finish')).length,1);
  const other=await setup();other.api.request=async()=>{throw Error('private-error-must-not-appear');};
  await other.flow.start('student');assert.doesNotMatch(other.flow.state.error,/private-error/);
});
