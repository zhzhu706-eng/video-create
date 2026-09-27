import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ARCHIVE_STYLE, renderArchiveFrames } from './archive-style.mjs';
import { createAuth } from './auth.mjs';
import { framepackReady,generateFramepack } from './framepack.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicMode = process.env.PUBLIC_MODE === '1';
const dataRoot = process.env.DATA_ROOT || here;
const jobsRoot = path.join(dataRoot, 'jobs');
const publicRoot = path.join(here, 'public');
const settingsRoot = path.join(dataRoot, 'settings');
const auth = createAuth(path.join(dataRoot, 'private'));
const pagefileResultFile = path.join(here, '.test-data', 'pagefile-result.json');
const settingsFile = path.join(settingsRoot, 'settings.json');
const secretsFile = path.join(settingsRoot, 'secrets.json');
const secretKeyFile = path.join(settingsRoot, 'secret.key');
const ffmpegRoot = path.join(here, 'runtime', 'ffmpeg-static');
const ffmpeg = process.env.FFMPEG_PATH || (process.platform === 'win32' ? path.join(ffmpegRoot, 'ffmpeg.exe') : 'ffmpeg');
const ffprobe = process.env.FFPROBE_PATH || (process.platform === 'win32' ? path.join(ffmpegRoot, 'ffprobe.exe') : 'ffprobe');
const port = Number(process.env.PORT || 3817);
const host = process.env.HOST || (publicMode ? '0.0.0.0' : '127.0.0.1');
const clientIp = req => process.env.TRUST_PROXY==='1' ? String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
const tasks = new Map();
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.mp4':'video/mp4', '.wav':'audio/wav', '.mp3':'audio/mpeg' };
const videoModels = {
  'minimax-h3': {name:'MiniMax H3 768P',provider:'minimax',usdPerSecond:.08,minSeconds:4,maxSeconds:15},
  'replicate-wan21': {name:'Wan 2.1 1.3B 480P',provider:'replicate',usdPerClip:.20,clipSeconds:5},
  'fal-ovi': {name:'Ovi 文生视频',provider:'fal',usdPerClip:.20,clipSeconds:5},
  'local-framepack': {name:'本地 FramePack 图生视频',provider:'local',usdPerClip:0,clipSeconds:5}
};

function jobPath(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效项目编号');
  return path.join(jobsRoot, id);
}
function trimText(s, max=20000) { return String(s || '').trim().slice(0,max); }
function clamp(n,min,max) { return Math.max(min, Math.min(max, Number(n) || min)); }
function formatOf(m){return m.aspect==='16:9'?{aspect:'16:9',width:1280,height:720,label:'横屏'}:{aspect:'9:16',width:720,height:1280,label:'竖屏'};}
function json(res, value, status=200) { const body=JSON.stringify(value); res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(body); }
async function readBody(req, max=1024*1024) { const chunks=[]; let size=0; for await (const c of req) { size+=c.length; if(size>max) throw new Error('文件或文本过大'); chunks.push(c); } return Buffer.concat(chunks); }
async function readJson(req) { return JSON.parse((await readBody(req)).toString('utf8')); }
async function load(id) { const m=JSON.parse(await fs.readFile(path.join(jobPath(id),'manifest.json'),'utf8')); m.assetMap={}; for(const s of m.plan?.scenes||[]){const n=String(s.index+1).padStart(2,'0'),base=path.join(jobPath(id),'assets',`scene-${n}`);m.assetMap[s.index]={image:await fs.access(base+'.png').then(()=>true).catch(()=>false),video:await fs.access(base+'.mp4').then(()=>true).catch(()=>false)};} return m; }
async function save(m) { m.updatedAt=new Date().toISOString(); await fs.writeFile(path.join(jobPath(m.id),'manifest.json'),JSON.stringify(m,null,2),'utf8'); }
function publicManifest(m) { return { ...m, task: tasks.get(m.id) || null }; }
async function run(command,args,opts={}) { return new Promise((resolve,reject)=>{ const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...opts}); let stdout='',stderr=''; child.stdout?.on('data',d=>{stdout+=d.toString(); if(stdout.length>16000)stdout=stdout.slice(-16000);}); child.stderr?.on('data',d=>{stderr+=d.toString();if(stderr.length>16000)stderr=stderr.slice(-16000);}); child.on('error',reject); child.on('exit',code=>code===0?resolve({stdout,stderr}):reject(new Error((stderr||stdout||`${command} 退出码 ${code}`).slice(-3000)))); }); }
async function runInput(command,args,input,opts={}) { return new Promise((resolve,reject)=>{ const child=spawn(command,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],...opts});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('exit',code=>code===0?resolve({stdout,stderr}):reject(new Error(stderr||stdout||`退出码 ${code}`)));child.stdin.end(input);});}
async function codexExecutable(){if(process.env.CODEX_BIN)return process.env.CODEX_BIN;const root=path.join(process.env.LOCALAPPDATA||'', 'OpenAI','Codex','bin');for(const folder of await fs.readdir(root).catch(()=>[])){const candidate=path.join(root,folder,'codex.exe');if(await fs.access(candidate).then(()=>true).catch(()=>false))return candidate;}return 'codex';}
async function readSettings(){return fs.readFile(settingsFile,'utf8').then(JSON.parse).catch(()=>({imageModel:'gpt-image-2.5-flare'}));}
async function saveSettings(s){await fs.mkdir(settingsRoot,{recursive:true});await fs.writeFile(settingsFile,JSON.stringify(s,null,2),'utf8');}
async function secretFlags(){const data=await fs.readFile(secretsFile,'utf8').then(JSON.parse).catch(()=>({}));return Object.fromEntries(Object.keys(data).map(k=>[k,true]));}
async function saveSecret(provider,key){const encrypted=(await runInput('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(here,'secret.ps1'),'-Mode','protect','-KeyPath',secretKeyFile],key)).stdout.trim();const data=await fs.readFile(secretsFile,'utf8').then(JSON.parse).catch(()=>({}));data[provider]=encrypted;await fs.mkdir(settingsRoot,{recursive:true});await fs.writeFile(secretsFile,JSON.stringify(data,null,2),'utf8');}
async function loadSecret(provider){const data=await fs.readFile(secretsFile,'utf8').then(JSON.parse).catch(()=>({}));if(!data[provider])return '';return (await runInput('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(here,'secret.ps1'),'-Mode','unprotect','-KeyPath',secretKeyFile],data[provider])).stdout.trim();}
async function task(id,label,fn) { if(tasks.get(id)?.state==='running') throw new Error('当前项目已有任务在运行');if(publicMode&&[...tasks.values()].filter(t=>t.state==='running').length>=2)throw new Error('服务器正在处理其他视频，请稍后再试');if(label.includes('FramePack')&&[...tasks.values()].some(t=>t.state==='running'&&t.label.includes('FramePack')))throw new Error('本地视频模型正在生成其他镜头，请稍后再试'); tasks.set(id,{label,state:'running',startedAt:new Date().toISOString(),detail:'正在准备'}); Promise.resolve().then(fn).then(()=>tasks.set(id,{label,state:'done',detail:'完成'})).catch(e=>tasks.set(id,{label,state:'error',detail:String(e.message||e).slice(0,1000)})); }
function updateTask(id,detail) { const t=tasks.get(id); if(t)tasks.set(id,{...t,detail}); }
function splitSentences(t) { return t.replace(/\s+/g,' ').split(/(?<=[。！？!?；;])/u).map(x=>x.trim()).filter(Boolean); }
function localPlan(article,duration,style,aspect='9:16') {
  const sentences=splitSentences(article),limit=Math.round(duration*4.5),chosen=[]; let total=0;
  for(const sentence of sentences){ if(total+sentence.length<=limit||chosen.length===0){chosen.push(sentence);total+=sentence.length;} else break; }
  const closing=sentences.at(-1); if(closing&&!chosen.includes(closing)&&total+closing.length<=limit+10)chosen.push(closing);
  const narration=chosen.join(''); let chunks=chosen.flatMap(x=>x.length>38?x.split(/(?<=[，,])/u).filter(Boolean):[x]);
  if(chunks.length<2){const only=chunks[0]||article;const midpoint=Math.max(1,Math.round(only.length/2));chunks=[only.slice(0,midpoint),only.slice(midpoint)];}
  const count=Math.min(6,chunks.length); const scenes=[];
  const orientation=aspect==='16:9'?'横屏 16:9':'竖屏 9:16';
  for(let i=0;i<count;i++){ const a=Math.floor(i*chunks.length/count),b=Math.floor((i+1)*chunks.length/count); const caption=chunks.slice(a,b).join(''); const archive=style===ARCHIVE_STYLE; scenes.push({caption,visualPrompt:archive?`复古新闻档案照片，真实纸张、旧报纸剪贴、粗糙边缘、暗棕与档案红；主体对应「${caption}」，留出可叠加标签的空间，画面内不要生成文字。`:`${style}，${orientation}短视频分镜：${caption} 画面无文字，主体清晰。`,videoPrompt:archive?`Archival documentary collage, weathered newsprint, cut paper, restrained sepia palette, scarlet hand-drawn trajectory; subject: ${caption}. Camera drifts across layered evidence, no generated text.`:`Cinematic ${aspect} B-roll illustrating: ${caption} Natural motion, no text, no logos.`,duration:duration/count,style,budgetCny:0,videoReservedCny:0,videoModel:'minimax-h3',priority:i===0?3:1}); }
  return {title:(sentences[0]||article).slice(0,22),hook:(sentences[0]||article).slice(0,40),narration,scenes,source:'本地草稿（可用 Codex 优化）'};
}
function normalizePlan(p,duration,scale=true,defaultStyle='温暖手绘插画') {
  if(!Array.isArray(p.scenes)||p.scenes.length<2)throw new Error('分镜数据不足');
  const scenes=p.scenes.slice(0,8).map((s,i)=>({caption:trimText(s.caption,100),visualPrompt:trimText(s.visualPrompt,600),videoPrompt:trimText(s.videoPrompt,700),duration:clamp(s.duration,1,30),manualDuration:Boolean(s.manualDuration),style:trimText(s.style,100)||defaultStyle,budgetCny:clamp(s.budgetCny??0,0,10000),videoReservedCny:clamp(s.videoReservedCny??0,0,10000),videoModel:videoModels[s.videoModel]?s.videoModel:'minimax-h3',priority:Math.round(clamp(s.priority,0,3)),index:i}));
  if(scale){const total=scenes.reduce((n,s)=>n+s.duration,0);for(const s of scenes)s.duration=Number((s.duration*duration/total).toFixed(2));scenes.at(-1).duration=Number((duration-scenes.slice(0,-1).reduce((n,s)=>n+s.duration,0)).toFixed(2));}
  return {title:trimText(p.title,80),hook:trimText(p.hook,120),narration:trimText(p.narration,1000),scenes,source:p.source||'Codex'};
}
async function fitVoice(m, audioFile) {
  const probe=await run(ffprobe,['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',audioFile]);
  const length=Number(probe.stdout.trim());
  if(!Number.isFinite(length)||length<1)throw new Error('无法读取旁白时长');
  m.audioDuration=Number(length.toFixed(2));
  m.exportDuration=Number(Math.min(90,Math.max(5,length+1)).toFixed(2));
  const scenes=m.plan.scenes, weights=scenes.map(s=>s.manualDuration?Math.max(1,s.duration):Math.max(1,s.caption.replace(/[\s，。！？、；,.!?;]/g,'').length));
  const total=weights.reduce((a,b)=>a+b,0),min=Math.min(1,m.exportDuration/scenes.length/2),remaining=m.exportDuration-scenes.length*min;
  for(let i=0;i<scenes.length;i++)scenes[i].duration=Number((min+Math.max(0,remaining)*weights[i]/total).toFixed(2));
  scenes.at(-1).duration=Number((m.exportDuration-scenes.slice(0,-1).reduce((n,s)=>n+s.duration,0)).toFixed(2));
  m.output=null;
}
async function health() { const c=publicMode?'公共版不使用站长账号':await run(await codexExecutable(),['login','status']).then(x=>(x.stdout||x.stderr).trim()).catch(()=> '未登录');const localVideo=await framepackReady();const systemRamGB=Number((os.totalmem()/1024**3).toFixed(1));const marker=process.platform==='win32'?await fs.stat(pagefileResultFile).catch(()=>null):null;const framepackPagefileConfigured=!!marker;const framepackRebootRequired=!!marker&&marker.mtimeMs>Date.now()-os.uptime()*1000;return {codex:c,ffmpeg:process.platform==='win32'?await fs.access(ffmpeg).then(()=>true).catch(()=>false):true,hypit:!publicMode&&await fs.access('D:/codex/Apps/Hypit/hypit.cmd').then(()=>true).catch(()=>false),localVideo,publicMode,systemRamGB,framepackPagefileConfigured,framepackRebootRequired,framepackNeedsPagefile:process.platform==='win32'&&!localVideo&&systemRamGB<24&&!framepackPagefileConfigured}; }
async function generatePlan(m) {
  const dir=jobPath(m.id); updateTask(m.id,'Codex 正在改写口语稿与分镜');
  const f=formatOf(m);const prompt=`请把当前目录 article.txt 中的文章改编成约 ${m.duration} 秒的中文${f.label}${f.aspect}短视频。风格：${m.style}。要求：保留原文事实，不编造数据；开头 3 秒给明确钩子；口语自然，每秒约 4～5 个汉字；拆成 5～7 个镜头；每个镜头的 caption 必须是对应旁白原句，按顺序拼接所有 caption 应等于 narration，便于字幕跟随配音；每个镜头再给无字插画提示词、英文动态 B-roll 提示词、秒数与 0～3 的动态优先级。画面角色和配色保持统一。不调用任何付费 API，不制作图片或视频，只输出符合 schema 的 JSON。`;
  await run(await codexExecutable(),['exec','--skip-git-repo-check','--ephemeral','--sandbox','read-only','--output-schema',path.join(here,'plan.schema.json'),'-o',path.join(dir,'codex-plan.json'),prompt],{cwd:dir});
  const p=JSON.parse(await fs.readFile(path.join(dir,'codex-plan.json'),'utf8')); m.plan=normalizePlan(p,m.duration,true,m.style);m.audio=null;m.audioDuration=null;m.exportDuration=null;m.output=null;await save(m);
}
async function generateImages(m) {
  const dir=jobPath(m.id); if(!m.plan)throw new Error('请先生成分镜');
  const settings=await readSettings(),f=formatOf(m);const imageModel=m.imageModel||settings.imageModel||'gpt-image-2.5-flare';const style=`统一角色设定和色彩，${f.label} ${f.aspect}，预留底部字幕空间，无文字无水印。`;
  for(const s of m.plan.scenes){ const filename=`scene-${String(s.index+1).padStart(2,'0')}.png`; if(await fs.access(path.join(dir,'assets',filename)).then(()=>true).catch(()=>false))continue;
    updateTask(m.id,`生成插画 ${s.index+1}/${m.plan.scenes.length}`);
    const prompt=`$imagegen 请使用 ${imageModel} 图片模型，为短视频生成恰好一张插画。镜头风格：${s.style||m.style}。${style} 镜头描述：${s.visualPrompt}。把最终 PNG 复制到当前项目 assets/${filename}。不得调用 OpenAI API 密钥、HypiHub 或任何收费第三方 API。完成后确认文件存在。`;
    await run(await codexExecutable(),['exec','--skip-git-repo-check','--ephemeral','--sandbox','workspace-write',prompt],{cwd:dir});
    await fs.access(path.join(dir,'assets',filename));
  }
  m.imagesReady=true; await save(m);
}
async function synthesize(m) { if(!m.plan)throw new Error('请先生成分镜'); const dir=jobPath(m.id); const textPath=path.join(dir,'narration.txt'),output=path.join(dir,'assets','narration.wav'); await fs.writeFile(textPath,m.plan.narration,'utf8'); updateTask(m.id,'本地中文语音正在生成旁白'); const bundledModel=path.join(here,'runtime','piper-voices','zh_CN-huayan-medium.onnx'),bundledPython=path.join(here,'runtime','piper-venv','Scripts','python.exe');const piperModel=process.env.PIPER_MODEL||await fs.access(bundledModel).then(()=>bundledModel).catch(()=>null);if(piperModel){const python=process.env.PIPER_PYTHON||await fs.access(bundledPython).then(()=>bundledPython).catch(()=>process.platform==='win32'?'python':'python3');await run(python,['-m','piper','-m',piperModel,'-f',output,'--input-file',textPath],{cwd:dir});}else if(process.platform==='win32'){await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(here,'tts.ps1'),'-TextPath',textPath,'-OutputPath',output],{cwd:dir});}else{await run('espeak-ng',['-v','cmn','-s','170','-f',textPath,'-w',output],{cwd:dir});} m.audio='assets/narration.wav'; await fitVoice(m,output); await save(m); }
function xml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function escapeAss(s){return String(s).replace(/[{}]/g,'').replace(/\\/g,'').replace(/\r?\n/g,' ').replace(/(.{16})/gu,'$1\\N');}
function assTime(sec){ const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=(sec%60).toFixed(2).padStart(5,'0'); return `${h}:${String(m).padStart(2,'0')}:${s}`; }
async function createGraphic(m,s){ const dir=jobPath(m.id), out=path.join(dir,'assets',`card-${String(s.index+1).padStart(2,'0')}.png`),f=formatOf(m); const palette=['#161b38','#273c59','#4a3154','#263d3d','#4b3432','#273146']; const bg=palette[s.index%palette.length],label=s.caption.slice(0,72),title=xml(m.plan.title.slice(0,28)),pad=Math.round(f.width*.075),top=Math.round(f.height*.14),panelW=f.width-pad*2,panelH=Math.round(f.height*.72),titleY=Math.round(f.height*.42),captionY=Math.round(f.height*.61),font=Math.round(Math.min(f.width,f.height)*.052); const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${f.width}" height="${f.height}"><rect width="100%" height="100%" fill="${bg}"/><circle cx="${f.width*.84}" cy="${f.height*.14}" r="${Math.min(f.width,f.height)*.36}" fill="#fff" opacity=".055"/><rect x="${pad}" y="${top}" width="${panelW}" height="${panelH}" rx="42" fill="#fff" opacity=".07"/><text x="${pad+26}" y="${top+76}" fill="#a8ffe8" font-family="Microsoft YaHei" font-size="${font*.66}">第 ${s.index+1} 幕 / ${m.plan.scenes.length}</text><text x="${pad+26}" y="${titleY}" fill="#fff" font-family="Microsoft YaHei" font-size="${font}" font-weight="bold">${title}</text><text x="${pad+26}" y="${captionY}" fill="#fff" font-family="Microsoft YaHei" font-size="${font*.77}">${xml(label.slice(0,20))}</text><text x="${pad+26}" y="${captionY+font}" fill="#fff" font-family="Microsoft YaHei" font-size="${font*.77}">${xml(label.slice(20,40))}</text><text x="${pad+26}" y="${captionY+font*2}" fill="#fff" font-family="Microsoft YaHei" font-size="${font*.77}">${xml(label.slice(40,60))}</text></svg>`;
  try { await sharp(Buffer.from(svg)).png().toFile(out); } catch(e){ throw new Error(`本地图卡生成失败：${e.message}`); } return out; }
async function render(m){ if(!m.plan)throw new Error('请先生成分镜'); const dir=jobPath(m.id), segdir=path.join(dir,'segments'),f=formatOf(m); await fs.mkdir(segdir,{recursive:true}); const lines=[]; let current=0; const fontSize=f.aspect==='16:9'?34:42,marginV=f.aspect==='16:9'?55:105;const ass=['[Script Info]','ScriptType: v4.00+',`PlayResX: ${f.width}`,`PlayResY: ${f.height}`,'[V4+ Styles]','Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',`Style: Default,Microsoft YaHei,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,1,2,50,50,${marginV},1`,`Style: Archive,Microsoft YaHei,${fontSize+6},&H0028D6FF,&H0028D6FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,1,2,50,50,${marginV},1`,'[Events]','Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text'];
  for(const s of m.plan.scenes){ updateTask(m.id,`渲染镜头 ${s.index+1}/${m.plan.scenes.length}`); const n=String(s.index+1).padStart(2,'0'), video=path.join(dir,'assets',`scene-${n}.mp4`), image=path.join(dir,'assets',`scene-${n}.png`); let source, isVideo=false;
    if(await fs.access(video).then(()=>true).catch(()=>false)){source=video;isVideo=true;}else if(await fs.access(image).then(()=>true).catch(()=>false)){source=image;}else if(s.style!==ARCHIVE_STYLE)source=await createGraphic(m,s);
    const segment=path.join(segdir,`segment-${n}.mp4`), duration=s.duration.toFixed(2);
    if(s.style===ARCHIVE_STYLE&&!isVideo){ const frameDir=path.join(segdir,`archive-${n}`);await renderArchiveFrames({dir:frameDir,scene:s,title:m.plan.title||m.title,imagePath:source===image?image:null,width:f.width,height:f.height,duration:s.duration,count:m.plan.scenes.length});await run(ffmpeg,['-y','-framerate','8','-i',path.join(frameDir,'frame-%04d.png'),'-vf','fps=30,format=yuv420p','-an','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p',segment],{cwd:dir});await fs.rm(frameDir,{recursive:true,force:true});lines.push(`file '${segment.replaceAll("'","'\\''").replaceAll('\\','/')}'`);ass.push(`Dialogue: 0,${assTime(current)},${assTime(current+s.duration)},Archive,,0,0,0,,${escapeAss(s.caption)}`);current+=s.duration;continue;}
    const vf=isVideo?`scale=${f.width}:${f.height}:force_original_aspect_ratio=increase,crop=${f.width}:${f.height},fps=30,format=yuv420p`:`scale=${f.width+40}:${f.height+72}:force_original_aspect_ratio=increase,crop=${f.width+40}:${f.height+72},zoompan=z='min(zoom+0.0008,1.08)':d=1:s=${f.width}x${f.height}:fps=30,format=yuv420p`;
    const args=['-y']; if(isVideo)args.push('-stream_loop','-1','-i',source);else args.push('-loop','1','-framerate','30','-i',source); args.push('-t',duration,'-vf',vf,'-an','-c:v','libx264','-preset','veryfast','-crf','23','-r','30','-pix_fmt','yuv420p',segment); await run(ffmpeg,args,{cwd:dir});
    lines.push(`file '${segment.replaceAll("'","'\\''").replaceAll('\\','/')}'`); ass.push(`Dialogue: 0,${assTime(current)},${assTime(current+s.duration)},${s.style===ARCHIVE_STYLE?'Archive':'Default'},,0,0,0,,${escapeAss(s.caption)}`); current+=s.duration;
  }
  await fs.writeFile(path.join(dir,'concat.txt'),lines.join('\n'),'utf8'); await fs.writeFile(path.join(dir,'captions.ass'),ass.join('\n'),'utf8'); updateTask(m.id,'合成旁白与字幕');
  const joined=path.join(dir,'joined.mp4'); await run(ffmpeg,['-y','-f','concat','-safe','0','-i','concat.txt','-c','copy',joined],{cwd:dir}); const final=path.join(dir,'final.mp4'); const audio=path.join(dir,m.audio||'assets/narration.wav');
  const hasAudio=await fs.access(audio).then(()=>true).catch(()=>false); const args=['-y','-i',joined]; if(hasAudio)args.push('-i',audio); args.push('-vf','ass=captions.ass','-map','0:v:0'); if(hasAudio)args.push('-map','1:a:0','-af','apad','-c:a','aac','-b:a','128k'); args.push('-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-t',String(m.exportDuration||m.duration),'-movflags','+faststart',final); await run(ffmpeg,args,{cwd:dir}); m.output='final.mp4'; await save(m);
  await fs.writeFile(path.join(dir,'production.json'),JSON.stringify({format:'article-video-workflow@1',engine:'local-ffmpeg',hypitCliAvailable:true,aspect:f.aspect,resolution:[f.width,f.height],plan:m.plan,assets:m.plan.scenes.map(s=>`assets/scene-${String(s.index+1).padStart(2,'0')}`)},null,2),'utf8');
}
function videoEstimate(modelId,duration){const model=videoModels[modelId]||videoModels['minimax-h3'];return Number(((model.usdPerClip??Math.round(clamp(duration,model.minSeconds,model.maxSeconds))*model.usdPerSecond)*6.70).toFixed(2));}
async function fetchVideoFile(url,out){if(!url||!/^https:\/\//.test(url))throw new Error('服务没有返回安全的视频地址');const response=await fetch(url);if(!response.ok)throw new Error(`视频下载失败：${response.status}`);const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>150*1024*1024)throw new Error('生成视频超过 150 MB');await fs.writeFile(out,bytes);}
async function generatePaidVideo(m,sceneIndex,modelId,key){
  if(!m.plan)throw new Error('请先生成分镜');const s=m.plan.scenes[sceneIndex];if(!s)throw new Error('镜头不存在');const model=videoModels[modelId];if(!model)throw new Error('不支持的视频模型');const estimate=videoEstimate(modelId,s.duration),projectLeft=m.budgetCny-(m.videoReservedCny||0),sceneLeft=(s.budgetCny||0)-(s.videoReservedCny||0);
  if(estimate>projectLeft)throw new Error(`预计 ¥${estimate} 超过项目剩余预算 ¥${projectLeft.toFixed(2)}`);if(estimate>sceneLeft)throw new Error(`预计 ¥${estimate} 超过本镜头剩余预算 ¥${sceneLeft.toFixed(2)}`);
  const f=formatOf(m),prompt=s.videoPrompt||s.visualPrompt,n=String(sceneIndex+1).padStart(2,'0'),out=path.join(jobPath(m.id),'assets',`scene-${n}.mp4`);updateTask(m.id,`提交 ${model.name}，预估 ¥${estimate}`);let taskId='',url='';
  if(model.provider==='local'){await generateFramepack({imagePath:path.join(jobPath(m.id),'assets',`scene-${n}.png`),prompt,duration:s.duration,out,update:detail=>updateTask(m.id,detail)});s.videoModel=modelId;m.output=null;await save(m);return;}
  if(!key)throw new Error(`请填写或在设置中保存 ${model.name} 的 API Key`);
  if(model.provider==='minimax'){
    const seconds=Math.round(clamp(s.duration,4,15)),res=await fetch('https://api.minimax.io/v2/video_generation',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'MiniMax-H3',content:[{type:'text',text:prompt}],resolution:'768P',duration:seconds,ratio:f.aspect})}),body=await res.json();if(!res.ok||!body.task_id)throw new Error(`MiniMax 提交失败：${body.error?.message||res.status}`);taskId=body.task_id;
    for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,10000));const q=await fetch(`https://api.minimax.io/v2/query/video_generation/${encodeURIComponent(taskId)}`,{headers:{Authorization:`Bearer ${key}`}}),data=await q.json();if(!q.ok)throw new Error(`MiniMax 查询失败：${data.error?.message||q.status}`);updateTask(m.id,`MiniMax：${data.task?.status||'处理中'}`);if(data.task?.status==='succeeded'){url=data.task.content?.url;break;}if(['failed','cancelled'].includes(data.task?.status))throw new Error(`MiniMax 生成失败：${data.task?.error?.message||data.task.status}`);}
  } else if(model.provider==='replicate'){
    const res=await fetch('https://api.replicate.com/v1/models/wan-video/wan-2.1-1.3b/predictions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'wait=60'},body:JSON.stringify({input:{prompt,aspect_ratio:f.aspect}})}),body=await res.json();if(!res.ok)throw new Error(`Replicate 提交失败：${body.detail||res.status}`);taskId=body.id;let data=body;for(let i=0;i<90&&!['succeeded','failed','canceled'].includes(data.status);i++){await new Promise(r=>setTimeout(r,3000));const q=await fetch(data.urls?.get||`https://api.replicate.com/v1/predictions/${taskId}`,{headers:{Authorization:`Bearer ${key}`}});data=await q.json();updateTask(m.id,`Wan：${data.status||'处理中'}`);}if(data.status!=='succeeded')throw new Error(`Wan 生成失败：${data.error||data.status}`);url=typeof data.output==='string'?data.output:data.output?.url;
  } else if(model.provider==='fal'){
    const resolution=f.aspect==='16:9'?'992x512':'512x992',res=await fetch('https://queue.fal.run/fal-ai/ovi',{method:'POST',headers:{Authorization:`Key ${key}`,'Content-Type':'application/json'},body:JSON.stringify({prompt,resolution})}),body=await res.json();if(!res.ok||!body.request_id)throw new Error(`fal Ovi 提交失败：${body.detail||body.error||res.status}`);taskId=body.request_id;const statusUrl=body.status_url||`https://queue.fal.run/fal-ai/ovi/requests/${taskId}/status`,responseUrl=body.response_url||`https://queue.fal.run/fal-ai/ovi/requests/${taskId}`;let completed=false;
    for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,3000));const q=await fetch(statusUrl,{headers:{Authorization:`Key ${key}`}}),data=await q.json();if(!q.ok)throw new Error(`fal Ovi 查询失败：${data.detail||q.status}`);updateTask(m.id,`Ovi：${data.status||'处理中'}`);if(data.status==='COMPLETED'){completed=true;break;}if(['FAILED','CANCELLED'].includes(data.status))throw new Error(`fal Ovi 生成失败：${data.error||data.status}`);}
    if(!completed)throw new Error('fal Ovi 生成超时');const resultResponse=await fetch(responseUrl,{headers:{Authorization:`Key ${key}`}}),result=await resultResponse.json();if(!resultResponse.ok)throw new Error(`fal Ovi 结果读取失败：${result.detail||resultResponse.status}`);url=result.video?.url||result.data?.video?.url;
  }
  if(!url)throw new Error(`${model.name} 尚未返回视频地址，请稍后重试`);await fetchVideoFile(url,out);m.videoReservedCny=Number(((m.videoReservedCny||0)+estimate).toFixed(2));s.videoReservedCny=Number(((s.videoReservedCny||0)+estimate).toFixed(2));s.videoModel=modelId;m.videoTasks=m.videoTasks||[];m.videoTasks.push({sceneIndex,modelId,taskId,estimateCny:estimate,status:'succeeded'});m.output=null;await save(m);
}

async function serveFile(res,file){ const body=await fs.readFile(file); res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':body.length,'Cache-Control':'no-store'});res.end(body); }
async function main(req,res){ try { if(req.method!=='GET'){const origin=req.headers.origin;if(origin){const expected=publicMode?req.headers.host:[`127.0.0.1:${port}`,`localhost:${port}`];if(publicMode?new URL(origin).host!==expected:!expected.includes(new URL(origin).host))throw new Error('禁止跨站请求');}}
  const u=new URL(req.url,`http://127.0.0.1:${port}`), p=u.pathname;
  if(publicMode&&p==='/api/session'&&req.method==='GET')return json(res,{publicMode:true,account:await auth.session(req)});
  if(publicMode&&p==='/api/auth/register'&&req.method==='POST'){const result=await auth.register(await readJson(req),clientIp(req),process.env.COOKIE_SECURE!=='0');res.setHeader('Set-Cookie',result.cookie);return json(res,result.account,201);}
  if(publicMode&&p==='/api/auth/login'&&req.method==='POST'){const result=await auth.login(await readJson(req),clientIp(req),process.env.COOKIE_SECURE!=='0');res.setHeader('Set-Cookie',result.cookie);return json(res,result.account);}
  if(publicMode&&p==='/api/auth/logout'&&req.method==='POST'){res.setHeader('Set-Cookie',await auth.logout(req));return json(res,{ok:true});}
  const account=publicMode?await auth.session(req):null;
  if(publicMode&&p.startsWith('/api/')&&!account)return json(res,{error:'请先登录'},401);
  if(req.method==='GET'&&p==='/api/health')return json(res,await health());
  if(req.method==='GET'&&p==='/api/settings'){const settings=await readSettings();return json(res,{imageModel:settings.imageModel||'gpt-image-2.5-flare',keys:publicMode?{}:await secretFlags(),videoModels:Object.fromEntries(Object.entries(videoModels).map(([id,v])=>[id,{id,name:v.name,provider:v.provider,usdPerSecond:v.usdPerSecond,usdPerClip:v.usdPerClip,clipSeconds:v.clipSeconds,minSeconds:v.minSeconds,maxSeconds:v.maxSeconds}]))});}
  if(req.method==='PUT'&&p==='/api/settings'){if(publicMode)throw new Error('公共版不保存站长模型密钥');const b=await readJson(req),settings=await readSettings();if(['gpt-image-2.5-flare','gpt-image-2.5-sunburst'].includes(b.imageModel))settings.imageModel=b.imageModel;if(b.keys&&typeof b.keys==='object')for(const provider of ['minimax','replicate','fal'])if(trimText(b.keys[provider],500))await saveSecret(provider,trimText(b.keys[provider],500));await saveSettings(settings);return json(res,{saved:true,imageModel:settings.imageModel,keys:await secretFlags()});}
  if(req.method==='GET'&&p==='/api/projects'){const dirs=await fs.readdir(jobsRoot,{withFileTypes:true});const list=[];for(const d of dirs)if(d.isDirectory()&&/^[a-f0-9-]{36}$/.test(d.name))try{const m=await load(d.name);if(publicMode&&m.owner!==account.id)continue;list.push({id:m.id,title:m.plan?.title||m.title,updatedAt:m.updatedAt,output:m.output});}catch{}return json(res,list.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));}
  if(req.method==='POST'&&p==='/api/projects'){const b=await readJson(req),article=trimText(b.article); if(article.length<25)throw new Error('请至少输入 25 个字的文案');if(publicMode){const dirs=await fs.readdir(jobsRoot);let owned=0;for(const dir of dirs)try{const item=await load(dir);if(item.owner===account.id)owned++;}catch{}if(owned>=(account.quota.projects||0))throw new Error('项目配额已用完');}const id=randomUUID(),m={id,owner:account?.id||null,title:trimText(b.title,80)||'未命名视频',article,duration:Math.round(clamp(b.duration,15,90)),style:trimText(b.style,100)||ARCHIVE_STYLE,aspect:b.aspect==='16:9'?'16:9':'9:16',imageModel:['gpt-image-2.5-flare','gpt-image-2.5-sunburst'].includes(b.imageModel)?b.imageModel:'gpt-image-2.5-flare',budgetCny:publicMode?0:clamp(b.budgetCny??0,0,10000),videoReservedCny:0,createdAt:new Date().toISOString()};await fs.mkdir(path.join(jobPath(id),'assets'),{recursive:true});await fs.writeFile(path.join(jobPath(id),'article.txt'),article,'utf8');m.plan=normalizePlan(localPlan(article,m.duration,m.style,m.aspect),m.duration,true,m.style);await save(m);return json(res,publicManifest(m),201);}
  if(req.method==='POST'&&p==='/api/codex/login'){if(publicMode)throw new Error('公共版不使用站长 Codex 账号');task('codex-login','连接现有 ChatGPT 账号',async()=>{await run(await codexExecutable(),['login']);});return json(res,{ok:true});}
  const match=p.match(/^\/api\/projects\/([a-f0-9-]{36})(?:\/(.+))?$/); if(match){const id=match[1],action=match[2]||'',m=await load(id);
    if(publicMode&&m.owner!==account.id)return json(res,{error:'项目不存在'},404);
    if(req.method==='GET'&&action==='')return json(res,publicManifest(m));
    if(req.method==='DELETE'&&action===''){if(tasks.get(id)?.state==='running')throw new Error('任务运行中，暂时不能删除项目');await fs.rm(jobPath(id),{recursive:true,force:true});tasks.delete(id);return json(res,{deleted:true});}
    if(req.method==='POST'&&action==='plan'){if(publicMode)throw new Error('公共版暂未开放 Codex 优化，请编辑本地分镜');await task(id,'Codex 改写与分镜',()=>generatePlan(m));return json(res,{started:true});}
    if(req.method==='PUT'&&action==='plan'){const b=await readJson(req);const changed=b.narration!==undefined&&b.narration!==m.plan.narration;m.plan=normalizePlan({...m.plan,...b,source:'人工编辑'},m.duration,false,m.style);m.duration=Number(m.plan.scenes.reduce((n,s)=>n+s.duration,0).toFixed(2));if(changed){m.audio=null;m.audioDuration=null;m.exportDuration=null;}else if(m.audio)await fitVoice(m,path.join(jobPath(id),m.audio));m.output=null;await save(m);return json(res,publicManifest(m));}
    if(req.method==='PUT'&&action==='settings'){const b=await readJson(req);m.budgetCny=clamp(b.budgetCny??m.budgetCny,0,10000);m.style=trimText(b.style,100)||m.style;if(b.aspect)m.aspect=b.aspect==='16:9'?'16:9':'9:16';m.output=null;await save(m);return json(res,publicManifest(m));}
    if(req.method==='POST'&&action==='images'){if(publicMode)throw new Error('公共版暂未开放 Codex 配图，请上传素材或使用档案拼贴动画');await task(id,'Codex 生成插画',()=>generateImages(m));return json(res,{started:true});}
    if(req.method==='POST'&&action==='voice'){await task(id,'本地中文配音',()=>synthesize(m));return json(res,{started:true});}
    if(req.method==='POST'&&action==='render'){if(tasks.get(id)?.state==='running')throw new Error('当前项目已有任务在运行');if(publicMode&&[...tasks.values()].filter(t=>t.state==='running').length>=2)throw new Error('服务器正在处理其他视频，请稍后再试');if(publicMode)await auth.useExport(account.id);await task(id,'本地渲染视频',async()=>{try{await render(m);}catch(e){if(publicMode)await auth.refundExport(account.id);throw e;}});return json(res,{started:true});}
    if(req.method==='POST'&&action==='paid-video'){const b=await readJson(req);if(b.confirm!==true)throw new Error('请先确认单次调用费用');const idx=Number(b.sceneIndex),modelId=videoModels[b.modelId]?b.modelId:(m.plan.scenes[idx]?.videoModel||'minimax-h3'),provider=videoModels[modelId].provider;if(publicMode){if(modelId!=='local-framepack')throw new Error('公共版只提供已授权的本地视频模型');if(!m.plan.scenes[idx])throw new Error('镜头不存在');if(!await framepackReady())throw new Error('云端视频模型尚未启动');const seconds=Math.min(5,Math.max(1,Math.ceil(m.plan.scenes[idx].duration)));if(tasks.get(id)?.state==='running'||[...tasks.values()].some(t=>t.state==='running'&&t.label.includes('FramePack')))throw new Error('视频模型正在处理其他任务');await auth.useVideoSeconds(account.id,seconds);await task(id,`${videoModels[modelId].name} 动态 B-roll`,async()=>{try{await generatePaidVideo(m,idx,modelId,'');}catch(e){await auth.refundVideoSeconds(account.id,seconds);throw e;}});return json(res,{started:true});}if(b.remember&&trimText(b.apiKey,500))await saveSecret(provider,trimText(b.apiKey,500));const key=trimText(b.apiKey,500)||await loadSecret(provider)||String(provider==='minimax'?process.env.MINIMAX_API_KEY||'':'');await task(id,`${videoModels[modelId].name} 动态 B-roll`,()=>generatePaidVideo(m,idx,modelId,key));return json(res,{started:true});}
    if(req.method==='PUT'&&/^assets\/\d+$/.test(action)){const idx=Number(action.split('/')[1]);if(!m.plan?.scenes[idx])throw new Error('镜头不存在');const kind=u.searchParams.get('kind');if(!['image','video','voice'].includes(kind))throw new Error('请选择素材类型');const ext=kind==='video'?'.mp4':kind==='voice'?'.wav':'.png';const name=kind==='voice'?`narration${ext}`:`scene-${String(idx+1).padStart(2,'0')}${ext}`;const data=await readBody(req,100*1024*1024);if(data.length<100)throw new Error('素材文件过小');await fs.writeFile(path.join(jobPath(id),'assets',name),data);if(kind==='voice'){m.audio=`assets/${name}`;await fitVoice(m,path.join(jobPath(id),m.audio));}m.output=null;await save(m);return json(res,{saved:name});}
  }
  const media=p.match(/^\/media\/([a-f0-9-]{36})\/(final\.mp4|assets\/(?:scene-\d{2}\.(?:png|mp4)|narration\.wav))$/);if(req.method==='GET'&&media){if(publicMode){if(!account)return json(res,{error:'请先登录'},401);const item=await load(media[1]);if(item.owner!==account.id)return json(res,{error:'素材不存在'},404);}return serveFile(res,path.join(jobPath(media[1]),media[2]));}
  if(req.method==='GET'){const name=p==='/'?'index.html':p.slice(1);if(!/^(index\.html|app\.js|style\.css)$/.test(name))return json(res,{error:'不存在'},404);return serveFile(res,path.join(publicRoot,name));}
  return json(res,{error:'不存在'},404);
}catch(e){json(res,{error:String(e.message||e)},400);} }

await fs.mkdir(jobsRoot,{recursive:true});http.createServer(main).listen(port,host,()=>console.log(`文章视频工作台：http://${host}:${port}`));
