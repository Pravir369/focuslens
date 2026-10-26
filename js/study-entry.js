import { boot } from './app.js';
import { MEDIAPIPE_MODULE_URL } from './config.js';
import { AccountClient } from './account.js';
import { AccountApi } from './account-api.js';
import { ReportController } from './reports.js';
import { WindowSignal } from './window-signal.js';
import { renderHistory } from './history-view.js';
import { ParentAlertObserver } from './parent-alerts.js';

function renderAccountHistory(doc,records){
  renderHistory(doc,records);
  const rows=doc.getElementById('history-rows').rows;
  if(!records.length&&rows[0]?.cells[0])rows[0].cells[0].textContent='No saved sessions yet. Complete a session to start your account history.';
  records.forEach((record,index)=>{if(record.source==='legacy-summary'&&rows[index]?.cells[0])rows[index].cells[0].append(' · Imported summary');});
}

export function sessionTransport(session) {
  const ms=value=>Math.round(value);
  return {endTime:ms(session.endTime),endReason:session.endReason,
    events:session.events.map(event=>({type:event.type,start:ms(event.start),end:ms(event.end),duration:ms(event.end)-ms(event.start),...(event.triggerSource?{triggerSource:event.triggerSource}:{})})),
    activeSegments:session.activeSegments.map(row=>({...row,start:ms(row.start),end:ms(row.end)})),
    unclassifiedPeriods:session.unclassifiedPeriods.map(row=>({start:ms(row.start),end:ms(row.end)}))};
}

export class AccountStudy {
  constructor(client,user,{notify=()=>{},render=()=>{},randomUUID=()=>crypto.randomUUID()}={}) {
    Object.assign(this,{client,user,notify,render,randomUUID});this.api=new AccountApi(client);this.rows=new WeakMap();this.rowsById=new Map();this.failures=new Set();this.pending=new Set();
    this.history={data:{enabled:true,records:[]},available:true,message:'Completed sessions save to your account.',description:'History belongs to your signed-in account across devices.',load:()=>{void this.refresh().catch(error=>notify(error.message));return this.history.data;},save:session=>{
      void this.save(session).catch(()=>{});return {saved:false,message:'Saving this session to your account… Keep this tab open until saving finishes.'};},setEnabled:()=>true};
    this.pacing={message:'',suggestion:()=>this.suggestedMinutes??null,save:()=>true};
  }
  async refresh(){const data=await this.api.request('/sessions');this.history.data.records=data.sessions;this.suggestedMinutes=data.suggestedMinutes;this.render(data.sessions);return data;}
  row(session){
    if(!this.rows.has(session)){const row={id:this.randomUUID(),session,created:false};this.rows.set(session,row);this.rowsById.set(row.id,row);}
    return this.rows.get(session);
  }
  async ensureCreated(session){
    const row=this.row(session);if(row.created)return row;
    if(!row.creating)row.creating=this.api.request('/sessions',{method:'POST',body:{clientSessionId:row.id,startTime:Math.round(session.startTime),goalMinutes:session.goalMinutes,goalEngagementPct:session.goalEngagementPct,phonePolicy:session.phonePolicy}})
      .then(()=>{row.created=true;return row;}).finally(()=>{row.creating=null;});
    return row.creating;
  }
  started(session){this.current=this.row(session);void this.ensureCreated(session).catch(error=>this.notify(`${error.message} Your session continues in this tab.`));}
  save(session){
    const row=this.row(session);if(row.saved)return Promise.resolve(row.result);if(row.saving)return row.saving;
    // Convert only the transport copy to integer milliseconds. The classifier,
    // confirmed event log and browser metrics retain their original clock.
    row.payload??=sessionTransport(session);
    const work=(async()=>{
      try{await this.ensureCreated(session);const result=await this.api.request(`/sessions/${row.id}`,{method:'PATCH',body:row.payload});row.saved=true;row.result=result;this.failures.delete(row);this.notify('Session saved to your account.');await this.refresh().catch(()=>this.notify('Session saved. Refresh History from your account when the connection returns.'));return result;}
      catch(error){if(!row.saved)this.failures.add(row);this.notify(`${error.message} Keep this tab open and choose Retry saving.`);throw error;}
      finally{this.pending.delete(work);row.saving=null;}
    })();
    row.saving=work;this.pending.add(work);return work;
  }
  async flush(){await Promise.all([...this.pending]);if(this.failures.size)throw new Error('Some sessions are not saved. Retry saving before signing out.');}
  async retry(){await Promise.all([...this.failures].map(row=>this.save(row.session)));}
}

export function accountWindowFetcher(bridge,user){
  return async(url,request={})=>{
    const body=request.method==='PUT'?JSON.parse(request.body):null;
    // A late stop/heartbeat must stay attached to its original session, even
    // after a new session becomes current. Unknown IDs never become requests.
    const row=body?bridge.rowsById.get(body.sessionId):bridge.current;
    if(!row)throw new Error('No account session');
    await bridge.ensureCreated(row.session);
    if(body){
      const result=await bridge.api.request(`/sessions/${row.id}/activity`,{method:'PUT',body:{revision:body.revision,active:body.active,monitorEnabled:body.monitorEnabled,allowedApps:body.allowedApps},signal:request.signal});
      return {ok:true,json:async()=>result};
    }
    const result=await bridge.api.request(`/active-window-status?sessionId=${encodeURIComponent(row.id)}`,{signal:request.signal});
    return {ok:true,json:async()=>({...result,profileId:user.id})};
  };
}

export async function startAccountStudy(doc=document,host=window,{appDependencies={},loadVision=()=>import(MEDIAPIPE_MODULE_URL)}={}){
  const client=new AccountClient();const user=await client.restore();
  if(!user){host.location.replace('/');return;}
  const preferences=await new AccountApi(client).request('/preferences');
  if(!preferences.onboardingComplete){host.location.replace('/?setup=1');return;}
  doc.getElementById('phone-policy').value=preferences.phonePolicy;
  const preset=[...doc.getElementById('session-length').options].some(option=>option.value===String(preferences.goalMinutes));
  doc.getElementById('session-length').value=preset?String(preferences.goalMinutes):'custom';
  doc.getElementById('custom-length').value=preferences.goalMinutes;
  doc.getElementById('custom-length').disabled=preset;doc.getElementById('custom-length').required=!preset;doc.getElementById('custom-length-field').hidden=preset;
  doc.getElementById('engagement-goal').value=preferences.goalEngagementPct;doc.getElementById('goal-range').value=preferences.goalEngagementPct;
  const top=doc.createElement('section');top.className='card';
  const title=doc.createElement('p');title.textContent=`Signed in as ${user.displayName} · ${user.email}`;
  const status=doc.createElement('p');status.id='account-sync-status';status.setAttribute('role','status');
  const retry=doc.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='Retry saving';retry.hidden=true;
  const account=doc.createElement('a');account.href='/';account.textContent='Account and family links';
  const logout=doc.createElement('button');logout.type='button';logout.className='secondary';logout.textContent='End session and sign out';
  top.append(title,status,retry,doc.createTextNode(' '),account,doc.createTextNode(' '),logout);doc.querySelector('main header').after(top);
  const bridge=new AccountStudy(client,user,{notify:message=>{status.textContent=message;retry.hidden=!bridge.failures.size;
    const saved=doc.getElementById('summary-save-status');if(saved&&message==='Session saved to your account.')saved.textContent=message;},render:records=>renderAccountHistory(doc,records)});
  const alertStatus=doc.createElement('p');alertStatus.setAttribute('role','status');top.append(alertStatus);
  const alerts=new ParentAlertObserver(async(session,payload,isCurrent)=>{
    await bridge.ensureCreated(session);
    // An expired connection must not send an alert for a finished/paused event.
    const event=session.events.at(-1);
    if(!isCurrent()||doc.hidden||session.state!=='running'||event?.end!==null||Math.round(event.start)!==payload.eventStartMs)return null;
    return bridge.api.request('/notify-parent',{method:'POST',body:{sessionId:bridge.row(session).id,...payload}});
  },{notify:message=>{alertStatus.textContent=message;}});
  const alertInfo=doc.createElement('p');alertInfo.textContent='If you have linked parents with connected phones, ten continuous minutes of confirmed distraction requests one generic check-in notification. Camera images stay on this device. Pauses and unusable readings reset this timer.';top.append(alertInfo);
  await bridge.refresh();const email=await bridge.api.request('/report-config');
  // Account-mode copy replaces only obsolete local-storage/privacy statements.
  for(const paragraph of doc.querySelectorAll('p')){
    if(paragraph.textContent.includes('Optional history keeps summary statistics'))paragraph.textContent='Tracking libraries and models download over the network. Camera processing stays in your browser. When a session ends, its confirmed states, timing and summary are saved to your account; images, calibration and head-pose readings are never uploaded.';
    if(paragraph.textContent.includes('A random local profile ID'))paragraph.textContent='Your signed-in account owns saved sessions and pacing suggestions across devices.';
    if(paragraph.textContent.includes('History is off by default.'))paragraph.textContent='Completed sessions save to your account automatically. Saving errors keep the session in this tab so you can retry.';
    if(paragraph.textContent.includes('First-distraction timing is saved locally'))paragraph.textContent='Pacing suggestions use your saved account sessions.';
  }
  for(const id of ['save-history','history-enabled'])doc.getElementById(id).closest('label').hidden=true;
  doc.querySelector('.history-settings').hidden=true;
  doc.querySelector('[data-view="history"] caption').textContent='Account session summaries · oldest first';
  doc.getElementById('profile-status').textContent='Account-backed sessions. Confirmed event records sync at session completion.';
  const reportFactory=(document)=>{
    let controller;
    const form=document.getElementById('report-form');
    form.querySelector('label[for="report-email"]').textContent='Recipient 1';
    form.querySelector('label[for="report-email-extra"]').textContent='Recipient 2 (optional)';
    const label=document.createElement('label');label.htmlFor='report-email-third';label.textContent='Recipient 3 (optional)';
    const third=document.createElement('input');third.id='report-email-third';third.type='email';third.autocomplete='off';third.maxLength=254;
    form.insertBefore(label,document.getElementById('send-report'));form.insertBefore(third,document.getElementById('send-report'));
    form.querySelector('p').textContent='These are your saved report recipients. Changes here apply to this report only. Nothing sends until you choose Send Report.';
    const recipientIds=['report-email','report-email-extra','report-email-third'];
    const fetcher=async(url,options={})=>{
      if(url==='/send-report'){
        const session=controller.session;await bridge.save(session);
        const data=JSON.parse(options.body);
        const result=await bridge.api.request('/send-report',{method:'POST',body:{sessionId:bridge.row(session).id,recipientEmails:data.recipientEmails},signal:options.signal});
        return {ok:true,json:async()=>result};
      }
      const result=await bridge.api.request(url.split('?')[0],{signal:options.signal});return {ok:true,json:async()=>result};
    };
    controller=new ReportController(document,user.id,{fetcher,recipientIds});
    const original=controller.setSession.bind(controller);
    controller.setSession=session=>{original(session);if(session){recipientIds.forEach((id,index)=>{document.getElementById(id).value=preferences.recipientEmails[index]||'';});
      controller.output.textContent=email.configured?'Sending uses the saved account session. You can change any recipient.':'Email-provider setup is still needed on this service.';}};
    return controller;
  };
  const windowsFactory=(ignored,options)=>new WindowSignal(user.id,{...options,fetcher:accountWindowFetcher(bridge,user)});
  const app=boot(loadVision,{document:doc,createProfile:()=>({getId:()=>user.id,message:'Signed in. No local profile ID is used for authorization.'}),
    createHistoryStore:()=>bridge.history,createPacingStore:()=>bridge.pacing,createReportController:reportFactory,createWindowSignal:windowsFactory,
    ...appDependencies,onSessionStarted:session=>{bridge.started(session);appDependencies.onSessionStarted?.(session);},
    onSessionObserved:(session,now,usable)=>{alerts.update(session,now,usable);appDependencies.onSessionObserved?.(session,now,usable);},makeSessionId:()=>bridge.current.id});
  doc.getElementById('history-start-status').textContent='Completed sessions save to your account.';
  retry.addEventListener('click',()=>{void bridge.retry().catch(()=>{});});
  logout.addEventListener('click',async()=>{logout.disabled=true;try{app.endSession();await bridge.flush();await bridge.api.request('/monitor/revoke',{method:'POST',body:{}});alerts.dispose();app.dispose();client.logout();host.location.assign('/');}catch(error){status.textContent=error.message;logout.disabled=false;}});
  host.addEventListener('pagehide',()=>alerts.dispose(),{once:true});
  host.addEventListener('beforeunload',event=>{if(bridge.pending.size||bridge.failures.size){event.preventDefault();event.returnValue='';}});
  return {app,bridge};
}
