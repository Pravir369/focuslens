import { AccountClient } from '/js/account.js';
import { startAccountStudy } from '/js/study-entry.js';
import { sessionMetrics } from '/js/session.js';
import { MEDIAPIPE_MODULE_URL } from '/js/config.js';
import { createLandmarker } from '/js/tracking.js';
const get=id=>document.getElementById(id), wait=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(fn,message){for(let i=0;i<400;i++){if(fn())return;await wait();}throw new Error(message);}
get('models').addEventListener('click',async()=>{
  get('models').disabled=true;get('model-result').textContent='Loading the real face model and phone worker…';let face,worker;
  try{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;canvas.getContext('2d').fillRect(0,0,64,64);
    face=await createLandmarker(await import(MEDIAPIPE_MODULE_URL));const result=face.detectForVideo(canvas,1);
    if(result.faceLandmarks.length)throw new Error('Blank synthetic canvas unexpectedly contained a face');
    worker=new Worker('/js/phone-worker.js',{type:'module'});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Phone worker timed out')),60000);worker.onerror=()=>{clearTimeout(timer);reject(new Error('Phone worker failed'));};worker.onmessage=event=>{if(event.data.type==='ready'){clearTimeout(timer);resolve();}if(event.data.type==='error'){clearTimeout(timer);reject(new Error('Phone worker: '+event.data.message));}};worker.postMessage({type:'init'});});
    const bitmap=await createImageBitmap(canvas);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Phone inference timed out')),10000);worker.onmessage=event=>{if(event.data.type==='result'){clearTimeout(timer);if(event.data.sample.present)reject(new Error('Blank canvas unexpectedly contained a phone'));else resolve();}if(event.data.type==='error'){clearTimeout(timer);reject(new Error(event.data.message));}};worker.postMessage({type:'frame',id:'synthetic-check',generation:0,source:'cameraA',capturedAt:1,inferenceAt:1,bitmap},[bitmap]);});
    get('model-result').textContent='PASS · Actual face model and phone worker loaded and processed a blank synthetic canvas under the study CSP. No camera used.';
  }catch(error){get('model-result').textContent='FAIL · '+error.message;}finally{face?.close();worker?.terminate();get('models').disabled=false;}
});
get('run').addEventListener('click',async()=>{
  get('run').disabled=true;get('result').textContent='Signing into an isolated synthetic test account…';let integration;
  try{
    const client=new AccountClient();await client.authenticate('signup',{email:`browser-${crypto.randomUUID()}@example.test`,password:crypto.randomUUID(),displayName:'Phase 2 browser test',role:'student'});
    const apiHeaders={Authorization:`Bearer ${client.token}`,'Content-Type':'application/json'};
    const prefs=await fetch('/preferences',{method:'PUT',headers:apiHeaders,body:JSON.stringify({goalMinutes:35,goalEngagementPct:75,phonePolicy:'phone-free',recipientEmails:['one@gmail.com','two@example.test','three@gmail.com']})});
    if(!prefs.ok)throw new Error('Synthetic account preferences could not be saved');
    const source=new DOMParser().parseFromString(await fetch('/study').then(response=>response.text()),'text/html');
    document.querySelector('main')?.remove();document.body.append(source.querySelector('main'));
    let time=0,callbacks,tick;const epoch=Date.now();let stopped=0;
    integration=await startAccountStudy(document,window,{loadVision:async()=>({}),appDependencies:{
      now:()=>time,epochAt:now=>epoch+now,setInterval:fn=>{tick=fn;return 1;},clearInterval(){},
      startCamera:async()=>({getTracks:()=>[{stop(){stopped++;}}],getVideoTracks:()=>[{getSettings:()=>({deviceId:'synthetic'})}]}),
      stopCamera:(video,stream)=>stream?.getTracks().forEach(track=>track.stop()),createLandmarker:async()=>({close(){}}),
      startTracking(video,model,handlers){callbacks=handlers;return()=>{callbacks=null;};},listDeskCameras:async()=>[],
      createAudioCues:()=>({unlock:async()=>true,play:()=>true,cancel(){},close:async()=>{}}),
      createPhoneTracker:()=>({ready:false,latest:null,async start(){this.ready=true;},async sampleNext(video,desk,now){this.latest={capturedAt:now,present:false,confidence:null,boxes:[]};},invalidateSource(){this.latest=null;},invalidate(){this.latest=null;},stop(){this.ready=false;this.latest=null;}})
    }});
    if(get('session-length').value!=='custom'||get('custom-length').value!=='35'||get('engagement-goal').value!=='75')throw new Error('Saved session defaults were not applied');
    const feed=(duration,pose='screen')=>{for(let elapsed=0;elapsed<duration;elapsed+=100){time+=100;callbacks?.onFrame({faceDetected:true,pose:{yaw:pose==='side'?40:0,pitch:pose==='notes'?30:0,roll:0},eyeClosedScore:.1,eyeBlinkLeft:.1,eyeBlinkRight:.1},time);tick?.();}};
    get('begin').click();await until(()=>callbacks,'Controlled tracking did not start');feed(200);
    get('calibrate').click();feed(5100);feed(5100,'notes');feed(3100,'side');
    if(document.querySelector('[data-view="setup"]').hidden)throw new Error('Calibration did not reach Setup');
    feed(300);get('session-length').value='15';get('session-length').dispatchEvent(new Event('change'));get('setup-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await until(()=>!document.querySelector('[data-view="live"]').hidden,'Session did not start');
    feed(2200);feed(6200,'side');feed(2400);get('pause-session').click();time+=2000;
    // Resume requires a fresh controlled camera frame after the pause.
    feed(200);get('resume-session').click();await until(()=>get('resume-session').hidden,'Resume did not finish');feed(1600);
    get('end-session').click();await integration.bridge.flush();
    if(get('report-email').value!=='one@gmail.com'||get('report-email-extra').value!=='two@example.test'||get('report-email-third').value!=='three@gmail.com')throw new Error('All three saved recipients must prefill the report');
    const row=integration.bridge.current,expected=sessionMetrics(row.session);const stored=await integration.bridge.api.request('/sessions/'+row.id);
    if(stored.distractionCount!==expected.distractionCount||stored.recoveryCount!==expected.recoveryCount||Math.abs(stored.engagedPct-expected.engagedPct)>.01)throw new Error('Stored metrics differ from the existing session metrics');
    if(!stored.activeSegments||stored.activeSegments.length!==2)throw new Error('Pause boundaries were not saved');
    if(stopped<1)throw new Error('Camera cleanup was not called');
    const history=await integration.bridge.api.request('/sessions');if(!history.sessions.some(entry=>entry.id===row.id))throw new Error('Account history did not include the saved session');
    get('result').textContent='PASS · Real auth, controlled calibration, session start, pause/resume, ending, database events, server metrics and account history. No camera/audio/email used.';
  }catch(error){get('result').textContent='FAIL · '+error.message;}finally{integration?.app.dispose();get('run').disabled=false;}
});
