# 文案成片工作台

把公众号、小红书或口播文案变成分镜、画面、旁白和 MP4。默认选中的“复古档案拼贴动画”按本地代码生成纸张层叠、编号证据、红色轨迹和逐层入场动作，不调用付费视频 API。上传 PNG 后，图片会成为拼贴主画面。支持 9:16 和 16:9。

## Windows 本机

双击 `启动工作台.cmd`，打开 <http://127.0.0.1:3817/>。运行一次 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-autostart.ps1` 可设置登录自启和意外退出后重启。项目在 `jobs/`，密钥在 `settings/`，都不会进入 Git。

1. 粘贴文案，选择时长、比例和风格，创建项目。本地立即生成可编辑分镜。
2. 可调用已登录的 Codex 优化口语稿和插画，也可自行编辑或逐镜头上传 PNG、MP4。
3. 生成中文旁白或上传 WAV。默认使用 Windows 中文语音。
4. 导出 MP4，页面内预览和下载。档案拼贴模式即使没有插画，也能生成有动态画面的成片。
5. MiniMax、Replicate、fal 视频 API 依旧按镜头可选，预算默认为 ¥0。API Key 可单次输入或本机加密保存。

### FramePack 本地视频模型

工作台已接入官方 FramePack 的 Gradio 图生视频接口，入口叫“本地 FramePack 图生视频”。先为镜头准备 PNG，再启动 FramePack，待工具连接状态显示“本地模型已连接”后即可按镜头调用。默认连接 `http://127.0.0.1:7860`，可用 `FRAMEPACK_URL` 修改。生成 1～5 秒的模型片段，较长镜头由剪辑器循环/裁切填满。

本机已解压官方 Windows 运行包时，可执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-framepack.ps1` 启动。脚本优先读取 `FRAMEPACK_PACKAGE`，其次使用本机短路径 `D:\codex\FramePack\framepack_cu126_torch26`，以避开 Windows 的长路径缓存问题；其他电脑可放在项目 `runtime/`。脚本默认使用 `https://hf-mirror.com` 下载并续传模型；需要官方源时先设置 `HF_ENDPOINT=https://huggingface.co`。运行包和模型权重不会推送到 GitHub。

国内网络或旧版 Hugging Face 缓存中断时，可使用项目自带的分块续传器。它只下载 FramePack 实际加载的约 40GB 文件，并行下载、断点续传，完成后 `start-framepack.ps1` 会自动切换到这些本地目录：

```powershell
& D:\codex\FramePack\framepack_cu126_torch26\system\python\python.exe .\tools\download-framepack-models.py --output D:\codex\FramePack\models --workers 4
```

官方 [FramePack](https://github.com/lllyasviel/FramePack) 标注 RTX 30 系 6GB 显存可用，但 Windows 安装包约 1.69GB，本项目所需模型约 40GB。3060 Laptop 可以进入低显存模式；16GB 系统内存还需较大的 Windows 页面文件，否则进程可能在 `Loading checkpoint shards` 阶段退出。本项目附带管理员脚本，可保留 C 盘 11GB，并在 D 盘配置 48GB 页面文件：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\configure-framepack-pagefile.ps1
```

也可以双击项目根目录的 `配置FramePack页面文件.cmd`，在 Windows 管理员确认窗口中选择“是”。运行后重启 Windows，再启动 FramePack。页面文件会占用约 48GB D 盘空间；可通过脚本参数 `-ModelDriveMB` 调整。安装后请先在 FramePack 自身界面生成一条测试片段。工作台只有在 `/config` 返回正常时才允许提交，不会把未启动的入口伪装成可用。

## 腾讯云公开版

仓库已包含 `Dockerfile`、`compose.yaml` 和 `Caddyfile`。公开版有独立账号、项目隔离与配额。新账号默认最多 3 个项目、每月 5 次导出、0 秒本地视频模型额度。站长可在服务器运行：

```sh
docker compose exec studio node tools/grant-quota.mjs user@example.com videoSeconds 30
```

公开版的图文分镜、档案拼贴动画和导出可在 CPU 服务器运行。模型视频需要另配 GPU 机器上的 FramePack；`FRAMEPACK_URL` 必须指向服务器本机或受保护的私有网络地址。公开版不会调用站长的 Codex 登录态，也不会向访客开放站长密钥。服务器没有 Piper 时采用 `espeak-ng` 中文语音；可上传自己的 WAV。`PIPER_MODEL` 和 `PIPER_PYTHON` 指向已安装的 Piper 中文语音时会自动使用它。

部署到已有 Linux 腾讯云服务器：

1. 将此目录推送到你的 GitHub 仓库，在服务器克隆。不要提交 `jobs/`、`settings/`、`runtime/`、`.env`。
2. 复制 `.env.example` 为 `.env`，设置实际域名 `SITE_DOMAIN`。将域名 A 记录指向服务器，并放通 TCP 80、443。
3. 在项目目录执行 `docker compose up -d --build`。Caddy 会为已解析的域名申请 HTTPS 证书。
4. 登录网站，注册一个账号；通过上面的命令调整账号配额。数据位于 Docker 卷 `studio_data`，更新容器时保留。

`.env` 中的 `REGISTRATION_CODE` 是访客注册邀请码，部署时必须改成一段较长的私密字符串。登录不需要邀请码。这样新用户仍有独立账号与配额，同时不能通过批量注册绕过导出额度。

中国内地腾讯云服务器向公众提供网站服务前，需完成相应 [ICP 备案](https://cloud.tencent.com/document/product/243/37402)。香港或海外地域的备案要求不同，访问速度也需自行验证。

## 目前边界

- 本机项目可使用已有 Codex 账号；**公开版不能共享站长的 ChatGPT/Codex 账号**，访客先用本地拆稿、素材上传与档案拼贴渲染。公开版的 Codex 优化与图片生成按钮会隐藏。
- FramePack 模型的实际生成速度、显存占用和输出质量，要以本机安装后的试片为准。安装包与模型文件不进入 Git。
- 公开版账号目前为邮箱加密码注册，未接入邮箱验证和支付；配额由站长通过服务器命令调整。对外大规模开放前应增加验证码、监控和清理策略。

运行 `npm test` 可验证账号隔离与站长密钥入口的保护。
