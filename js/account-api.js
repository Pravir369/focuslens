import { ACCOUNT_REQUEST_TIMEOUT_MS, readAccountJson } from './account-network.js';

export class AccountApi {
  constructor(client) { this.client=client; }
  async request(path,{method='GET',body,signal}={}) {
    if (!this.client.token) throw new Error('Please sign in first.');
    const abort=new AbortController(); const timer=setTimeout(()=>abort.abort(),ACCOUNT_REQUEST_TIMEOUT_MS);
    const relay=()=>abort.abort(); signal?.addEventListener('abort',relay,{once:true});
    if (signal?.aborted) abort.abort();
    try {
      const response=await this.client.fetcher(path,{method,headers:{Authorization:`Bearer ${this.client.token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:abort.signal,credentials:'omit'});
      const data=await readAccountJson(response);
      if (!response.ok) {
        if (response.status===401) { this.client.logout(); throw new Error('Your sign-in expired. Return to your account to sign in again.'); }
        throw new Error(data.error || 'Your account request could not be completed.');
      }
      return data;
    } catch(error) { if (error.name==='AbortError') throw new Error('The account request timed out. Your current session is still available in this tab.'); throw error; }
    finally {clearTimeout(timer); signal?.removeEventListener('abort',relay);}
  }
}
