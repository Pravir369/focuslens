const PROFILE = 'focuslens_profile_id', HISTORY = 'focuslens.history.v1', PACING = 'focuslens.pacing.v1';
const SUMMARY = ['id','profileId','startTime','endTime','goalMinutes','goalEngagementPct','phonePolicy','endReason','activeMs','engagedPct','averageRecoveryMs','distractionCount','recoveryCount','longestDistractionMs'];
const pick = (row, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(row,key)).map(key => [key,row[key]]));

export function legacySnapshot(storage = globalThis.localStorage) {
  if (!storage) return null;
  const raw = { profile: storage.getItem(PROFILE), history: storage.getItem(HISTORY), pacing: storage.getItem(PACING) };
  if (!raw.profile) return null;
  const history = raw.history === null ? {version:1,enabled:false,records:[]} : JSON.parse(raw.history);
  const pacing = raw.pacing === null ? [] : JSON.parse(raw.pacing);
  if (history?.version !== 1 || !Array.isArray(history.records) || !Array.isArray(pacing)) throw new Error('Old browser history could not be read. Your original data was kept.');
  const records = history.records.filter(row => row && (row.profileId === undefined || row.profileId === raw.profile));
  const timings = pacing.filter(row => row?.profileId === raw.profile);
  if (!records.length && !timings.length) return null;
  return { raw, payload: { localProfileId:raw.profile,
    localSessionHistory:records.map(row => ({...pick(row,SUMMARY),profileId:raw.profile})),
    localPacingHistory:timings.map(row => pick(row,['profileId','date','timeToFirstDistraction'])) } };
}

export function acknowledgeLegacy(snapshot, ack, storage = globalThis.localStorage) {
  if (!snapshot || ack?.status !== 'complete' || ack.acknowledged !== snapshot.payload.localSessionHistory.length + snapshot.payload.localPacingHistory.length) return false;
  const { raw } = snapshot;
  // A new save in another tab must never be removed by an older acknowledgement.
  if (storage.getItem(PROFILE)!==raw.profile || storage.getItem(HISTORY)!==raw.history || storage.getItem(PACING)!==raw.pacing) return false;
  const history = raw.history ? JSON.parse(raw.history) : {version:1,enabled:false,records:[]};
  const others = history.records.filter(row => row?.profileId && row.profileId!==raw.profile);
  const pacing = (raw.pacing ? JSON.parse(raw.pacing) : []).filter(row => row?.profileId!==raw.profile);
  if (others.length) storage.setItem(HISTORY,JSON.stringify({...history,records:others})); else storage.removeItem(HISTORY);
  if (pacing.length) storage.setItem(PACING,JSON.stringify(pacing)); else storage.removeItem(PACING);
  storage.removeItem(PROFILE);
  return true;
}

export function addLegacyExport(doc = document) {
  const button = doc.createElement('button'); button.type='button'; button.className='secondary'; button.textContent='Export old history for my account';
  const output = doc.createElement('p'); output.className='muted'; output.setAttribute('role','status');
  doc.querySelector('[data-view="start"] .actions').append(button);
  doc.querySelector('[data-view="start"]').append(output);
  button.addEventListener('click',() => {
    try {
      const snapshot=legacySnapshot();
      if (!snapshot) { output.textContent='No saved summaries or pacing timings to export.'; return; }
      const blob=new Blob([JSON.stringify(snapshot.payload,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob); const link=doc.createElement('a'); link.href=url; link.download='FocusLens-history.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
      output.textContent='Exported. Sign into your account and choose Import old history. Your originals remain here until you choose to clear them after checking the import.';
    } catch { output.textContent='Export could not be completed. Your original browser data was kept.'; }
  });
}
