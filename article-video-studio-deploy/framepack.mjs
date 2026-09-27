import fs from 'node:fs/promises';
import path from 'node:path';
import {Client,handle_file} from '@gradio/client';

export const framepackUrl = process.env.FRAMEPACK_URL || 'http://127.0.0.1:7860';

export async function framepackReady() {
  try {const url=new URL('/config',framepackUrl);const response=await fetch(url,{signal:AbortSignal.timeout(1200)});return response.ok;}catch{return false;}
}

export async function generateFramepack({imagePath,prompt,duration,out,update}) {
  await fs.access(imagePath).catch(()=>{throw new Error('FramePack 是图生视频模型。请先为这个镜头上传或生成一张 PNG 插画。');});
  if(!await framepackReady())throw new Error('FramePack 尚未启动。请先在本机安装官方 FramePack 并启动 7860 端口。');
  const client=await Client.connect(framepackUrl);
  try {
    const api=await client.view_api();
    const endpoint=Object.keys(api.named_endpoints||{}).find(name=>name.endsWith('/process'))||'/process';
    update?.('FramePack 正在按插画生成动态镜头；6GB 显卡可能需要较长时间');
    const result=await client.predict(endpoint,[handle_file(imagePath),prompt,'',31337,Math.min(5,Math.max(1,duration)),9,25,1,10,0,6,true,16]);
    const item=result.data?.[0];
    const value=typeof item==='string'?item:item?.video?.url||item?.url||item?.video?.path||item?.path;
    if(!value)throw new Error('FramePack 没有返回视频文件');
    if(/^https?:\/\//.test(value)){
      const source=new URL(value),allowed=new URL(framepackUrl);
      if(source.origin!==allowed.origin)throw new Error('FramePack 返回了非本机的视频地址');
      const response=await fetch(source);if(!response.ok)throw new Error(`FramePack 视频读取失败：${response.status}`);
      const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>150*1024*1024)throw new Error('视频超过 150 MB');
      await fs.writeFile(out,bytes);
    }else{
      const root=path.resolve(process.env.FRAMEPACK_ROOT||path.dirname(imagePath));
      const file=path.resolve(value);
      if(!file.toLowerCase().startsWith((root+path.sep).toLowerCase()))throw new Error('FramePack 文件路径不在允许目录内，请设置 FRAMEPACK_ROOT');
      await fs.copyFile(file,out);
    }
    return out;
  }finally{client.close();}
}
