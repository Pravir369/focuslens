import { boot } from './app.js';
import { MEDIAPIPE_MODULE_URL } from './config.js';
import { addLegacyExport } from './legacy-import.js';
if (location.pathname === '/study') {
  import('./study-entry.js').then(module=>module.startAccountStudy()).catch(error=>{
    const output=document.getElementById('error');output.hidden=false;output.textContent=error.message||'Account study setup failed. Return to your account and retry.';
  });
} else {
  boot(()=>import(MEDIAPIPE_MODULE_URL));
  addLegacyExport();
}
