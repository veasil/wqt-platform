// Reuse the authenticated identity session; each app still selects its own account.
// Repeated password logins intentionally revoke the previous single-device session.
export async function existingIdentitySession() {
 const candidates=[...new Set(['WQT_AUTH_TOKEN','aw_token','ep_token'].map(key=>localStorage.getItem(key)).filter(Boolean))];
 for(const token of candidates){
  try{
   const response=await fetch('/api/auth/session',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(8000)});
   if(!response.ok)continue;
   const data=await response.json();
   if(data.user?.identityId)return {...data,token};
  }catch{/* Keep existing credentials; a failed read does not log anyone out. */}
 }
 return null;
}
