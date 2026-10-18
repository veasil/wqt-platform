// A user-initiated, exact-origin handoff. The existing backend session remains authoritative.
export function playerIdentitySession({timeout=10000}={}) {
  const origin='https://scoring.ai5000days.com';
  const requestId=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const frame=document.createElement('iframe');
    frame.hidden=true;frame.title='接续桌游登录身份';
    let timer;
    const finish=(error,token)=>{clearTimeout(timer);window.removeEventListener('message',receive);frame.remove();error?reject(error):resolve(token)};
    const receive=event=>{
      if(event.origin!==origin || event.source!==frame.contentWindow || event.data?.requestId!==requestId || event.data?.type!=='wqt:admin-session-result')return;
      const token=event.data.token;
      if(typeof token!=='string'||!token||token.length>10000)return finish(new Error('桌游端尚未登录，请先在桌游端登录'));
      finish(null,token);
    };
    window.addEventListener('message',receive);
    frame.onload=()=>frame.contentWindow.postMessage({type:'wqt:admin-session-request',requestId},origin);
    frame.onerror=()=>finish(new Error('桌游登录状态暂时无法读取，请重试'));
    timer=setTimeout(()=>finish(new Error('读取桌游登录状态超时，请重试')),timeout);
    frame.src=origin+'/player/admin-session.html';document.body.append(frame);
  });
}
