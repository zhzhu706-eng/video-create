import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

test('public accounts isolate projects and block owner credentials', async () => {
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'article-video-auth-'));
  const port=40000+Math.floor(Math.random()*10000);
  const server=spawn(process.execPath,['server.mjs'],{cwd:path.resolve('.'),env:{...process.env,PUBLIC_MODE:'1',DATA_ROOT:data,HOST:'127.0.0.1',PORT:String(port),COOKIE_SECURE:'0',REGISTRATION_CODE:'test-invite'},stdio:'ignore'});
  const base=`http://127.0.0.1:${port}`;
  async function request(route,method='GET',body,cookie='') {const response=await fetch(base+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  try {
    let ready=false;for(let i=0;i<60;i++){try{if((await request('/api/session')).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
    assert.equal(ready,true);
    assert.equal((await request('/api/projects')).status,401);
    assert.equal((await request('/api/auth/register','POST',{email:'blocked@example.com',password:'secure-pass-000'})).status,400);
    const a=await request('/api/auth/register','POST',{email:'a@example.com',password:'secure-pass-123',inviteCode:'test-invite'});
    const b=await request('/api/auth/register','POST',{email:'b@example.com',password:'secure-pass-456',inviteCode:'test-invite'});
    assert.equal(a.status,201);assert.equal(b.status,201);
    const created=await request('/api/projects','POST',{article:'这是一个用于测试的视频文案。第一次失败之后，我们重新检查线索。最后找到真正原因。',duration:15,style:'复古档案拼贴动画'},a.cookie);
    assert.equal(created.status,201);
    assert.equal((await request(`/api/projects/${created.data.id}`,'GET',null,b.cookie)).status,404);
    assert.equal((await request('/api/projects','GET',null,b.cookie)).data.length,0);
    assert.equal((await request('/api/settings','PUT',{keys:{minimax:'steal'}},b.cookie)).status,400);
    assert.equal((await request('/api/codex/login','POST',{},b.cookie)).status,400);
    assert.equal((await request(`/api/projects/${created.data.id}/paid-video`,'POST',{confirm:true},a.cookie)).status,400);
    assert.equal((await request(`/api/projects/${created.data.id}`,'DELETE',null,b.cookie)).status,404);
    assert.equal((await request(`/api/projects/${created.data.id}`,'DELETE',null,a.cookie)).data.deleted,true);
    assert.equal((await request('/api/projects','GET',null,a.cookie)).data.length,0);
  } finally {server.kill();await fs.rm(data,{recursive:true,force:true});}
});
