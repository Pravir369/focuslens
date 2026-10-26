import { AccountApi } from './account-api.js';
import { legacySnapshot, acknowledgeLegacy } from './legacy-import.js';

export function bootAccountDashboard(doc,client) {
  const get=id=>doc.getElementById(id), api=new AccountApi(client);
  if (!get('account-dashboard')) return {setUser:async()=>{}};
  let user=null,generation=0,pairTimer;
  const status=message=>{get('dashboard-status').textContent=message;};
  async function load(current=generation) {
    const results=await Promise.allSettled([api.request('/sessions'),api.request('/family-link'),api.request('/report-config')]);
    if (current!==generation) return;
    const [history,family,email]=results;
    if (history.status==='fulfilled') {
      const data=history.value; get('account-pacing').textContent=data.suggestedMinutes===null?'Your pacing suggestion appears after a session with a distraction.':`Suggested next study block: ${data.suggestedMinutes} minutes. You can change it in Setup.`;
      get('account-history').replaceChildren();
      for (const row of data.sessions.slice().reverse()) {
        const tr=doc.createElement('tr');
        for(const value of [new Date(row.endTime).toLocaleString(),row.source==='legacy-summary'?'Imported summary':`${Math.round(row.activeMs/60000*10)/10} min`,row.engagedPct===null?'No classified time':`${row.engagedPct.toFixed(1)}%`,row.averageRecoveryMs===null?(row.distractionCount?'No recoveries recorded':'No distractions this session'):`${(row.averageRecoveryMs/1000).toFixed(1)} s`]) {
          const td=doc.createElement('td'); td.textContent=value; tr.append(td);
        }
        get('account-history').append(tr);
      }
      get('account-history-empty').hidden=Boolean(data.sessions.length);
    } else status(history.reason.message);
    if (family.status==='fulfilled') {
      get('family-links').textContent=family.value.links.length?`Linked ${user.role==='parent'?'students':'parents'}: ${family.value.links.map(link=>link.email).join(', ')}`:'No family links yet.';
    } else get('family-links').textContent=family.reason.message;
    get('account-email-status').textContent=email.status==='fulfilled'?(email.value.configured?'Email reports are configured. Sending always requires Send Report after a saved session.':'Email provider setup is still needed. Sessions and history work while email is unavailable.'):email.reason.message;
  }
  async function importPayload(payload,current=generation,snapshot=null) {
    const ack=await api.request('/imports/local',{method:'POST',body:payload});
    if(current!==generation)return;
    if(ack.status!=='complete')throw new Error('Import was not acknowledged. Your original data was kept.');
    let cleared=false;
    if(snapshot)try{cleared=acknowledgeLegacy(snapshot,ack);}catch{/* Server import is safe to retry. */}
    status(`Imported ${ack.imported} old records; ${ack.acknowledged} acknowledged. ${snapshot&&cleared?'Original browser records were cleared after acknowledgement.':'Your export or newer browser records were kept.'}`);
    await load(current);
  }
  async function setUser(next) {
    user=next; const current=++generation; clearTimeout(pairTimer); get('monitor-pair-code').textContent='';
    get('account-dashboard').hidden=!user;
    if(!user)return;
    get('family-link-form').hidden=user.role!=='parent'; status(client.migrationMessage||'Your study records belong to this signed-in account.');
    try { const snapshot=legacySnapshot(); if(snapshot)await importPayload(snapshot.payload,current,snapshot); }
    catch(error){if(current===generation)status(error.message);}
    if(current===generation)await load(current);
  }
  get('family-link-form').addEventListener('submit',async event=>{
    event.preventDefault(); const current=generation;
    try { await api.request('/family-link',{method:'POST',body:{studentEmail:get('student-email').value.trim()}}); if(current!==generation)return; get('family-link-form').reset();status('Student linked. Their email-report defaults now include your stored parent address.');await load(current); }
    catch(error){if(current===generation)status(error.message);}
  });
  get('legacy-import-file').addEventListener('change',async()=>{
    const file=get('legacy-import-file').files?.[0],current=generation;
    if(!file)return;
    try{if(file.size>2000000)throw new Error('This export is too large. Your original file was kept.');await importPayload(JSON.parse(await file.text()),current);}
    catch(error){if(current===generation)status(error.message);}
    finally{get('legacy-import-file').value='';}
  });
  get('pair-monitor').addEventListener('click',async()=>{
    const current=generation;
    try{const data=await api.request('/monitor/pair',{method:'POST',body:{}});if(current!==generation)return;get('monitor-pair-code').textContent=data.pairCode;clearTimeout(pairTimer);pairTimer=setTimeout(()=>{get('monitor-pair-code').textContent='Expired. Generate another code.';},120000);}
    catch(error){if(current===generation)status(error.message);}
  });
  get('revoke-monitor').addEventListener('click',async()=>{
    try{await api.request('/monitor/revoke',{method:'POST',body:{}});get('monitor-pair-code').textContent='';clearTimeout(pairTimer);status('Desktop helpers disconnected.');}catch(error){status(error.message);}
  });
  get('refresh-account-history').addEventListener('click',()=>{void load();});
  return {setUser};
}
