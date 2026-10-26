import test from "node:test";
import assert from "node:assert/strict";
import { AccountClient } from "../js/account.js";

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
