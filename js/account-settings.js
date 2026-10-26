import { AccountApi } from './account-api.js';

export function bootAccountSettings(doc,client,{onSaved=()=>{}}={}) {
  const get=id=>doc.getElementById(id), section=get('account-onboarding');
  if(!section)return {setUser:async()=>true};
  const api=new AccountApi(client);
  let user=null,generation=0,saved=null,busy=false;
  const error=message=>{get('settings-error').textContent=message||'';get('settings-error').hidden=!message;};
  const step=number=>{
    get('onboarding-progress').textContent=`Step ${number} of 2`;
    get('study-settings-form').hidden=number!==1;get('recipient-settings-form').hidden=number!==2;
    get('onboarding-title').textContent=number===1?'Make FocusLens yours.':'Choose your report recipients.';
    get('onboarding-title').focus();
  };
  function refreshRecipients(){
    const rows=[...get('settings-recipients').children];
    rows.forEach((row,index)=>{
      row.querySelector('label span').textContent=`Recipient ${index+1}`;
      row.querySelector('button').hidden=rows.length===1;
    });
    get('add-settings-recipient').disabled=busy||rows.length>=3;
    get('recipient-count').textContent=`${rows.length} of 3 recipients`;
  }
  function addRecipient(value=''){
    if(get('settings-recipients').children.length>=3)return;
    const row=doc.createElement('div');row.className='recipient-row';
    const label=doc.createElement('label'),input=doc.createElement('input'),remove=doc.createElement('button');
    input.type='email';input.required=true;input.maxLength=254;input.autocomplete='off';input.placeholder='you@gmail.com';input.value=value;
    // Wrap the input so its visible label remains associated after removal.
    const text=doc.createElement('span');label.append(text,input);
    remove.type='button';remove.className='secondary';remove.textContent='Remove recipient';
    remove.addEventListener('click',()=>{if(busy)return;row.remove();refreshRecipients();get('add-settings-recipient').focus();});
    row.append(label,remove);get('settings-recipients').append(row);
    refreshRecipients();return input;
  }
  function fill(){
    get('default-minutes').value=saved.goalMinutes;get('default-goal').value=saved.goalEngagementPct;get('default-phone-policy').value=saved.phonePolicy;
    get('settings-recipients').replaceChildren();saved.recipientEmails.forEach(value=>addRecipient(value));
  }
  function show(){
    fill();error(null);get('settings-status').textContent=saved.onboardingComplete?'Update your saved defaults.':'A quick setup before your first session.';
    section.hidden=false;get('settings-cancel').hidden=!saved.onboardingComplete;get('settings-retry').hidden=true;step(1);
  }
  async function setUser(next){
    user=next;saved=null;busy=false;const current=++generation;
    section.querySelectorAll('input,select,button').forEach(input=>{input.disabled=false;});
    section.hidden=true;get('edit-settings').hidden=true;get('open-study').hidden=true;
    if(!user)return false;
    section.hidden=false;get('study-settings-form').hidden=true;get('recipient-settings-form').hidden=true;get('settings-cancel').hidden=true;
    error(null);get('settings-status').textContent='Loading your settings…';get('settings-retry').hidden=true;
    try{
      const data=await api.request('/preferences');if(current!==generation)return false;saved=data;
      get('edit-settings').hidden=!saved.onboardingComplete;get('open-study').hidden=!saved.onboardingComplete;
      if(saved.onboardingComplete)section.hidden=true;else show();
      return saved.onboardingComplete;
    }catch(failure){if(current===generation){error(failure.message);get('settings-status').textContent='Your settings could not be loaded.';get('settings-retry').hidden=false;}return false;}
  }
  get('edit-settings').addEventListener('click',()=>{if(saved&&!busy)show();});
  get('settings-cancel').addEventListener('click',()=>{if(!busy)section.hidden=true;});
  get('settings-retry').addEventListener('click',async()=>{if(await setUser(user))onSaved(user,saved);});
  get('study-settings-form').addEventListener('submit',event=>{event.preventDefault();if(!busy&&event.currentTarget.reportValidity()){error(null);step(2);}});
  get('settings-back').addEventListener('click',()=>{if(!busy){error(null);step(1);}});
  get('add-settings-recipient').addEventListener('click',()=>{if(!busy)addRecipient()?.focus();});
  get('recipient-settings-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!saved||!event.currentTarget.reportValidity())return;
    const current=generation,payload={goalMinutes:Number(get('default-minutes').value),goalEngagementPct:Number(get('default-goal').value),phonePolicy:get('default-phone-policy').value,
      recipientEmails:[...get('settings-recipients').querySelectorAll('input')].map(input=>input.value.trim())};
    busy=true;error(null);get('settings-status').textContent='Saving your settings…';
    section.querySelectorAll('input,select,button').forEach(input=>{input.disabled=true;});
    try{
      const data=await api.request('/preferences',{method:'PUT',body:payload});if(current!==generation)return;saved=data;
      section.hidden=true;get('open-study').hidden=false;get('edit-settings').hidden=false;get('settings-status').textContent='Settings saved.';
      onSaved(user,saved);get('open-study').focus();
    }catch(failure){if(current===generation){error(failure.message);get('settings-status').textContent='Your changes have not been saved. Please try again.';}}
    finally{if(current===generation){busy=false;section.querySelectorAll('input,select,button').forEach(input=>{input.disabled=false;});refreshRecipients();}}
  });
  return {setUser};
}
