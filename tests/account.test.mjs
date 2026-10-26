import test from "node:test";
import assert from "node:assert/strict";
import { AccountClient } from "../js/account.js";
import { bootGoogleSignIn, googleConfig, loadGoogleIdentity } from "../js/google-signin.js";

const memory = () => {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key,value) => map.set(key,value), removeItem: key => map.delete(key) };
};
const user = { id: "test-user", email: "student@example.test", displayName: "Student", role: "student" };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test("account client sends passwords only in JSON auth bodies and restores identity with a bearer header", async () => {
  const calls = [], storage = memory();
  const client = new AccountClient({ storage: () => storage, fetcher: async (url, options) => {
    calls.push({url,options}); return response(url === "/auth/me" ? user : { token: "test-signed-token", user });
  } });
  assert.deepEqual(await client.authenticate("signup", { email: user.email, password: "test password", role: "student" }), user);
  const restored = new AccountClient({ storage: () => storage, fetcher: client.fetcher });
  assert.deepEqual(await restored.restore(), user);
  assert.equal(calls[0].url, "/auth/signup"); assert.equal(JSON.parse(calls[0].options.body).password, "test password");
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-signed-token"); assert.equal(calls[1].options.body, undefined);
  restored.logout(); assert.equal(new AccountClient({storage: () => storage}).token, null);
});
test("failed auth does not save a token, and expired identity clears saved access", async () => {
  const storage = memory();
  const client = new AccountClient({ storage: () => storage, fetcher: async () => response({error:"Invalid credentials."},401) });
  await assert.rejects(client.authenticate("login",{}), /Invalid credentials/); assert.equal(client.token,null);
  client.save("expired-test-token"); await assert.rejects(client.restore(),/session expired/);
  assert.equal(client.token,null); assert.equal(new AccountClient({storage: () => storage}).token,null);
});
test("blocked browser storage allows in-memory sign-in; late responses cannot sign in after logout", async () => {
  let resolve;
  const client = new AccountClient({ storage: () => { throw new Error("Blocked storage"); }, fetcher: async () => response({token:"test-token",user}) });
  assert.deepEqual(await client.authenticate("login",{}),user); assert.equal(client.storageAvailable,false);
  client.fetcher=()=>new Promise(done=>{resolve=done;});
  const pending=client.authenticate("login",{}); client.logout(); resolve(response({token:"late-token",user}));
  assert.equal(await pending,null); assert.equal(client.token,null);
});

test("Google config uses same-origin cookies and rejects missing configuration", async () => {
  let options;
  const config = await googleConfig(async (url, supplied) => {
    assert.equal(url,"/auth/google/config"); options=supplied;
    return response({clientId:"test.apps.googleusercontent.com",nonce:"test-nonce"});
  });
  assert.equal(options.credentials,"same-origin"); assert.equal(config.nonce,"test-nonce");
  await assert.rejects(googleConfig(async () => response({error:"Not configured"},503)),/Not configured/);
  await assert.rejects(googleConfig(async () => response({clientId:"wrong",nonce:""})),/could not be verified/);
});

test("Google loader passes the server's style nonce to GIS without enabling arbitrary inline styles", async () => {
  const identity={initialize(){}},win={};let loaded;
  const doc={querySelector:selector=>selector==='meta[name="focuslens-google-style-nonce"]'?{content:'test-response-style-nonce'}:null,
    createElement:()=>({remove(){}}),head:{append(script){loaded=script;win.google={accounts:{id:identity}};script.onload();}}};
  assert.equal(await loadGoogleIdentity(doc,win),identity);
  assert.equal(loaded.src,'https://accounts.google.com/gsi/client');assert.equal(loaded.nonce,'test-response-style-nonce');
});

const settle = () => new Promise(resolve=>setImmediate(resolve));
function googleHarness(client, changes={}) {
  const fields=new Map();
  const get=id=>{
    if (!fields.has(id)) fields.set(id,{value:id==="google-role"?"student":"",hidden:false,textContent:"",listeners:{},
      replaceChildren(){},setAttribute(){},focus(){},reportValidity:()=>true,addEventListener(name,fn){this.listeners[name]=fn;}});
    return fields.get(id);
  };
  let configuration, busy=false, signedIn=null; const errors=[];
  const identity={initialize(config){configuration=config;},renderButton(){},disableAutoSelect(){}};
  const flow=bootGoogleSignIn({getElementById:get},client,{onUser:user=>{signedIn=user;},setBusy:value=>{busy=value;},isBusy:()=>busy,
    onError:error=>errors.push(error),onStatus(){},loadIdentity:async()=>identity,
    getConfig:async()=>({clientId:"test.apps.googleusercontent.com",nonce:"browser-challenge"}),...changes});
  return {flow,get,errors,get configuration(){return configuration;},get signedIn(){return signedIn;}};
}

test("Google callback posts the ID token only to our API and saves only the app token", async () => {
  const storage=memory(); let sent;
  const client=new AccountClient({storage:()=>storage,fetcher:async(url,options)=>{
    sent={url,options}; return response({token:"app-token",user},201);
  }});
  const harness=googleHarness(client); await harness.flow.start();
  assert.equal(harness.configuration.nonce,"browser-challenge"); assert.equal(harness.configuration.auto_select,false);
  harness.configuration.callback({credential:"google-id-token"}); await settle();
  assert.equal(sent.url,"/auth/google"); assert.equal(sent.options.credentials,"same-origin");
  assert.deepEqual(JSON.parse(sent.options.body),{idToken:"google-id-token",role:"student"});
  assert.equal(client.token,"app-token"); assert.deepEqual(harness.signedIn,user);
  assert.equal(storage.getItem("focuslens.auth.token.v1"),"app-token");
});

test("Google linking asks for the FocusLens password, clears it, and cancellation rejects old callbacks", async () => {
  const sent=[];
  const client=new AccountClient({storage:memory,fetcher:async(url,options)=>{
    const fields=JSON.parse(options.body); sent.push(fields);
    if (!fields.password) return response({error:"Password required",code:"password_required"},409);
    return fields.password==="right test password" ? response({token:"app-token",user}) : response({error:"Invalid credentials."},401);
  }});
  const harness=googleHarness(client); await harness.flow.start();
  harness.configuration.callback({credential:"google-id-token"}); await settle();
  assert.equal(harness.get("google-link-form").hidden,false); assert.equal(client.token,null);
  const submit=()=>harness.get("google-link-form").listeners.submit({preventDefault(){},currentTarget:harness.get("google-link-form")});
  harness.get("google-link-password").value="wrong test password"; submit(); await settle();
  assert.equal(harness.get("google-link-password").value,""); assert.equal(client.token,null);
  assert.ok(harness.errors.includes("Invalid credentials."));
  harness.get("google-link-password").value="right test password"; submit(); await settle();
  assert.deepEqual(harness.signedIn,user); assert.equal(harness.get("google-link-password").value,"");
  await harness.flow.start(); const oldCallback=harness.configuration.callback;
  harness.flow.cancel(); const previous=sent.length; oldCallback({credential:"old-token"}); await settle();
  assert.equal(sent.length,previous); assert.equal(harness.get("google-link-form").hidden,true);
});

test("Google failures leave retry available and an expired challenge clears linking credentials", async () => {
  const client=new AccountClient({storage:memory,fetcher:async()=>response({error:"Expired",code:"google_restart"},401)});
  const harness=googleHarness(client); await harness.flow.start();
  harness.configuration.callback({credential:"expired-id-token"}); await settle();
  assert.equal(client.token,null); assert.equal(harness.get("google-retry").hidden,false);
  assert.equal(harness.get("google-link-form").hidden,true);
  const unavailable=googleHarness(client,{getConfig:async()=>{throw new Error("Not configured");}});
  await unavailable.flow.start(); assert.equal(unavailable.get("google-status").textContent,"Not configured");
  assert.equal(unavailable.get("google-retry").hidden,false);
});
