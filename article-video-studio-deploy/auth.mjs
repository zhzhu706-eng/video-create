import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes, scryptSync, createHash, timingSafeEqual, randomUUID} from 'node:crypto';

const cookieName = 'studio_session';
const hash = value => createHash('sha256').update(value).digest('hex');
const attempts = new Map();
const safeCompare = (a,b) => {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};

export function createAuth(root) {
  const file = path.join(root, 'accounts.json');
  let lock = Promise.resolve();
  function exclusive(fn) {const next=lock.then(fn);lock=next.catch(()=>{});return next;}
  async function read() {return fs.readFile(file,'utf8').then(JSON.parse).catch(e=>e.code==='ENOENT'?{accounts:[]}:Promise.reject(e));}
  async function write(data) {await fs.mkdir(root,{recursive:true});const temp=`${file}.${randomUUID()}.tmp`;await fs.writeFile(temp,JSON.stringify(data,null,2),{mode:0o600});await fs.rename(temp,file);}
  function limit(key,max=8) {const now=Date.now(),v=attempts.get(key)||[];const next=v.filter(t=>now-t<3600000);if(next.length>=max)throw new Error('操作太频繁，请一小时后再试');next.push(now);attempts.set(key,next);}
  function sessionCookie(token, secure) {return `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure?'; Secure':''}`;}
  async function register({email,password,inviteCode},ip,secure) {
    limit(`register:${ip}`,3);
    email=String(email||'').trim().toLowerCase();password=String(password||'');
    if(process.env.REGISTRATION_CODE&&!safeCompare(hash(String(inviteCode||'')),hash(process.env.REGISTRATION_CODE)))throw new Error('邀请码错误');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>120)throw new Error('请输入有效邮箱');
    if(password.length<10||password.length>128)throw new Error('密码至少 10 位');
    const data=await read();if(data.accounts.some(a=>a.email===email))throw new Error('邮箱已注册');
    const salt=randomBytes(16).toString('hex'),token=randomBytes(32).toString('hex');
    const account={id:randomUUID(),email,salt,passwordHash:scryptSync(password,salt,64).toString('hex'),sessions:[{hash:hash(token),expires:Date.now()+2592000000}],quota:{projects:3,exportsPerMonth:5,videoSeconds:0},createdAt:new Date().toISOString()};
    data.accounts.push(account);await write(data);return {account:publicAccount(account),cookie:sessionCookie(token,secure)};
  }
  async function login({email,password},ip,secure) {
    limit(`login:${ip}`,12);
    const data=await read(),account=data.accounts.find(a=>a.email===String(email||'').trim().toLowerCase());
    const candidate=scryptSync(String(password||''),account?.salt||'invalid',64).toString('hex');
    if(!account||!safeCompare(candidate,account.passwordHash))throw new Error('邮箱或密码错误');
    const token=randomBytes(32).toString('hex');account.sessions=(account.sessions||[]).filter(s=>s.expires>Date.now()).slice(-4);account.sessions.push({hash:hash(token),expires:Date.now()+2592000000});await write(data);
    return {account:publicAccount(account),cookie:sessionCookie(token,secure)};
  }
  async function session(req) {
    const match=String(req.headers.cookie||'').match(/(?:^|;\s*)studio_session=([a-f0-9]{64})(?:;|$)/);if(!match)return null;
    const data=await read(),h=hash(match[1]);const account=data.accounts.find(a=>a.sessions?.some(s=>s.hash===h&&s.expires>Date.now()));
    return account?publicAccount(account):null;
  }
  async function logout(req) {const match=String(req.headers.cookie||'').match(/(?:^|;\s*)studio_session=([a-f0-9]{64})(?:;|$)/);if(match){const data=await read(),h=hash(match[1]);for(const a of data.accounts)a.sessions=(a.sessions||[]).filter(s=>s.hash!==h);await write(data);}return `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;}
  async function useExport(id) {const data=await read(),a=data.accounts.find(x=>x.id===id);if(!a)throw new Error('账号不存在');const month=new Date().toISOString().slice(0,7);if(a.exportMonth!==month){a.exportMonth=month;a.exportsUsed=0;}if((a.exportsUsed||0)>=(a.quota?.exportsPerMonth||0))throw new Error('本月导出配额已用完');a.exportsUsed=(a.exportsUsed||0)+1;await write(data);}
  async function refundExport(id) {const data=await read(),a=data.accounts.find(x=>x.id===id);if(a&&a.exportMonth===new Date().toISOString().slice(0,7)){a.exportsUsed=Math.max(0,(a.exportsUsed||0)-1);await write(data);}}
  async function useVideoSeconds(id,seconds) {const data=await read(),a=data.accounts.find(x=>x.id===id);if(!a)throw new Error('账号不存在');if((a.quota.videoSeconds||0)<seconds)throw new Error('动态视频秒数配额不足');a.quota.videoSeconds-=seconds;await write(data);}
  async function refundVideoSeconds(id,seconds) {const data=await read(),a=data.accounts.find(x=>x.id===id);if(a){a.quota.videoSeconds=(a.quota.videoSeconds||0)+seconds;await write(data);}}
  return {register:(...args)=>exclusive(()=>register(...args)),login:(...args)=>exclusive(()=>login(...args)),session,logout:(...args)=>exclusive(()=>logout(...args)),useExport:(...args)=>exclusive(()=>useExport(...args)),refundExport:(...args)=>exclusive(()=>refundExport(...args)),useVideoSeconds:(...args)=>exclusive(()=>useVideoSeconds(...args)),refundVideoSeconds:(...args)=>exclusive(()=>refundVideoSeconds(...args))};
}

function publicAccount(a){return {id:a.id,email:a.email,quota:a.quota,exportsUsed:a.exportMonth===new Date().toISOString().slice(0,7)?a.exportsUsed||0:0};}
