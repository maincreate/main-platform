// Shared pre-flash gate. An adapter must additionally hold the device lock and
// recheck chip identity, security state, image compatibility and mount identity.
export function backupGate({mode='required',skipAcknowledged=false,deviceId,jobId,backup}={}){
 if(!['required','skip'].includes(mode))throw new Error('Unknown backup mode');
 if(typeof deviceId!=='string'||!deviceId||typeof jobId!=='string'||!jobId)throw new Error('Device and job identity required');
 if(mode==='skip')return {allowed:skipAcknowledged===true,mode,reason:skipAcknowledged===true?'Explicitly proceeding without a new backup':'Confirm flash without backup'};
 const valid=backup?.status==='verified'&&backup.deviceId===deviceId&&backup.jobId===jobId&&
  /^[a-f0-9]{64}$/.test(backup.sha256||'')&&Number.isSafeInteger(backup.size)&&backup.size>0;
 return {allowed:!!valid,mode,reason:valid?'Backup verified for this device and job':'A verified backup for this device and job is required'};
}
