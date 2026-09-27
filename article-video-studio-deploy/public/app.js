const $ = id => document.getElementById(id);
let current = null;
let healthState = null;
let settingsState = { imageModel: 'gpt-image-2.5-flare', keys: {}, videoModels: {} };
let lastTaskKey = '';
let selectedPaid = -1;
let publicMode = false;
let account = null;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => `¥${Number(value || 0).toFixed(2)}`;
const modelList = () => Object.values(settingsState.videoModels || {}).filter(model => !publicMode || model.provider === 'local');
const showAccount = () => {if(account)$('accountLabel').textContent=`${account.email} · 导出 ${account.exportsUsed}/${account.quota.exportsPerMonth} · 动态 ${account.quota.videoSeconds} 秒`;};

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof Blob)) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...options, headers });
  const data = await response.json();
  if (response.status === 401 && publicMode) $('authView').classList.remove('hidden');
  if (!response.ok || data.error) throw new Error(data.error || `请求失败 ${response.status}`);
  return data;
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.add('hidden'), 5000);
}

async function guarded(action) {
  try { await action(); } catch (error) { toast(error.message || String(error)); }
}

function estimate(modelId, duration) {
  const model = settingsState.videoModels?.[modelId];
  if (!model) return 0;
  if (model.usdPerClip !== undefined) return Number((model.usdPerClip * 6.7).toFixed(2));
  const seconds = Math.round(Math.max(model.minSeconds || 1, Math.min(model.maxSeconds || 30, Number(duration) || 1)));
  return Number((seconds * model.usdPerSecond * 6.7).toFixed(2));
}

function billedDuration(modelId, duration) {
  const model = settingsState.videoModels?.[modelId];
  if (!model) return `${Number(duration).toFixed(1)} 秒`;
  if (model.clipSeconds) return `${model.clipSeconds} 秒/段`;
  return `${Math.round(Math.max(model.minSeconds || 1, Math.min(model.maxSeconds || 30, Number(duration) || 1)))} 秒`;
}

async function refreshSettings() {
  settingsState = await api('/api/settings');
  $('defaultImageModel').value = settingsState.imageModel;
  for (const [provider, inputId] of [['minimax', 'minimaxKey'], ['replicate', 'replicateKey'], ['fal', 'falKey']]) {
    $(inputId).placeholder = settingsState.keys?.[provider] ? '已加密保存；输入新值可覆盖' : '未保存';
  }
  const options = modelList().map(model => `<option value="${esc(model.id)}">${esc(model.name)}</option>`).join('');
  $('videoModel').innerHTML = options;
}

async function refreshHealth() {
  healthState = await api('/api/health');
  const loggedIn = /logged in/i.test(healthState.codex) && !/not logged/i.test(healthState.codex);
  $('codexStatus').textContent = publicMode ? '仅本机可用' : loggedIn ? '已连接' : '尚未连接';
  $('renderStatus').textContent = healthState.ffmpeg ? '已就绪' : '不可用';
  $('hypitStatus').textContent = healthState.hypit ? '已安装（无需套餐）' : '未找到';
  $('localVideoStatus').textContent = healthState.localVideo ? '本地模型已连接' : healthState.framepackRebootRequired ? '已配置，请重启电脑' : healthState.framepackPagefileConfigured ? '待启动本地模型' : healthState.framepackNeedsPagefile ? '需扩页面文件并重启' : '未连接';
  $('connectCodex').textContent = loggedIn ? 'Codex 已连接' : '连接现有 ChatGPT 账号';
  return loggedIn;
}

async function refreshList() {
  const list = await api('/api/projects');
  $('projectList').innerHTML = list.length ? list.map(project => `<button class="project-link ${current?.id === project.id ? 'active' : ''}" data-project="${project.id}">${esc(project.title || '未命名视频')}<small>${new Date(project.updatedAt).toLocaleString('zh-CN')}${project.output ? ' · 已导出' : ''}</small></button>`).join('') : '<div class="muted empty-list">还没有项目</div>';
}

function showNew() {
  $('newView').classList.remove('hidden');
  $('projectView').classList.add('hidden');
  current = null;
  refreshList();
}

async function loadProject(id) {
  current = await api(`/api/projects/${id}`);
  $('newView').classList.add('hidden');
  $('projectView').classList.remove('hidden');
  renderProject();
  refreshList();
}

function taskBanner() {
  const task = current?.task;
  const element = $('taskBanner');
  if (!task) { element.classList.add('hidden'); return; }
  element.classList.remove('hidden');
  element.classList.toggle('error', task.state === 'error');
  element.textContent = `${task.state === 'running' ? '处理中' : task.state === 'done' ? '已完成' : '需要处理'} · ${task.label} · ${task.detail}`;
  const key = `${task.label}:${task.state}:${task.detail}`;
  if (task.state === 'error' && key !== lastTaskKey) toast(task.detail);
  lastTaskKey = key;
}

function renderProject() {
  if (!current) return;
  const plan = current.plan;
  const horizontal = current.aspect === '16:9';
  $('projectView').classList.toggle('landscape', horizontal);
  $('projectId').textContent = current.id.slice(0, 8);
  $('projectTitle').textContent = plan?.title || current.title;
  $('projectSummary').textContent = `${horizontal ? '横屏 16:9' : '竖屏 9:16'} · ${current.exportDuration ? `配音后约 ${current.exportDuration.toFixed(1)} 秒` : `目标 ${Number(current.duration).toFixed(1)} 秒`} · ${plan?.scenes?.length || 0} 个镜头`;
  $('planSource').textContent = `当前版本：${plan?.source || '本地草稿'}。文案、镜头时长、风格和预算都可以修改。`;
  $('narration').value = plan?.narration || '';
  const sceneTotal = (plan?.scenes || []).reduce((sum, scene) => sum + Number(scene.duration || 0), 0);
  $('scriptLength').textContent = `${plan?.narration?.length || 0} 字 · 镜头合计 ${sceneTotal.toFixed(1)} 秒`;
  $('spent').textContent = money(current.videoReservedCny);
  $('budgetLimit').textContent = money(current.budgetCny);
  $('projectBudget').value = current.budgetCny || 0;
  $('projectAspect').value = current.aspect || '9:16';
  $('budgetFill').style.width = `${Math.min(100, (current.videoReservedCny || 0) / Math.max(0.01, current.budgetCny || 0) * 100)}%`;
  $('outputSpec').textContent = `${horizontal ? '1280×720' : '720×1280'} · H.264 MP4 · AAC 音频`;
  taskBanner();
  renderShots();

  const hasAudio = Boolean(current.audio);
  $('audioPreview').classList.toggle('hidden', !hasAudio);
  if (hasAudio) $('audioPreview').src = `/media/${current.id}/assets/narration.wav?v=${Date.now()}`;
  const hasOutput = Boolean(current.output);
  $('emptyPreview').classList.toggle('hidden', hasOutput);
  $('videoPreview').classList.toggle('hidden', !hasOutput);
  $('downloadVideo').classList.toggle('hidden', !hasOutput);
  if (hasOutput) {
    const url = `/media/${current.id}/final.mp4?v=${Date.now()}`;
    $('videoPreview').src = url;
    $('downloadVideo').href = url;
  }
}

function modelOptions(selected) {
  return modelList().map(model => `<option value="${esc(model.id)}" ${model.id === selected ? 'selected' : ''}>${esc(model.name)}</option>`).join('');
}

function renderShots() {
  const plan = current?.plan;
  if (!plan) return;
  $('shotList').innerHTML = plan.scenes.map((scene, index) => {
    const number = String(index + 1).padStart(2, '0');
    const assets = current.assetMap?.[index] || {};
    const media = assets.video ? `<video src="/media/${current.id}/assets/scene-${number}.mp4" muted loop autoplay playsinline></video>` : assets.image ? `<img src="/media/${current.id}/assets/scene-${number}.png" alt="镜头 ${index + 1} 插画" />` : `<span>镜头 ${number}<br>无素材时自动使用文字图卡</span>`;
    const modelId = publicMode ? 'local-framepack' : scene.videoModel || 'minimax-h3';
    const cost = estimate(modelId, scene.duration);
    return `<article class="shot" data-shot="${index}">
      <div class="shot-media">${media}</div>
      <div class="shot-content">
        <div class="shot-top"><span class="shot-number">镜头 ${number}${index === 0 ? ' · 开头钩子' : ''}</span><span class="shot-time">已用 ${money(scene.videoReservedCny)}</span></div>
        <input class="shot-caption" data-field="caption" value="${esc(scene.caption)}" aria-label="镜头 ${index + 1} 字幕" />
        <p class="shot-prompt">${esc(scene.visualPrompt)}</p>
        <div class="shot-controls">
          <label class="mini-field">目标时长（秒）<input data-field="duration" type="number" min="1" max="30" step="0.5" value="${Number(scene.duration).toFixed(1)}" /></label>
          <label class="mini-field">画面风格<input data-field="style" value="${esc(scene.style || current.style)}" /></label>
          <label class="mini-field">本镜头预算（¥）<input data-field="budgetCny" type="number" min="0" max="10000" step="0.5" value="${Number(scene.budgetCny || 0).toFixed(2)}" /></label>
          <label class="mini-field">动态模型<select data-field="videoModel">${modelOptions(modelId)}</select></label>
        </div>
        <div class="shot-actions"><label class="button ghost upload-label">上传 PNG/JPG<input data-upload="image:${index}" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden /></label><label class="button ghost upload-label">上传 MP4<input data-upload="video:${index}" type="file" accept="video/mp4,.mp4" hidden /></label>${publicMode&&!(account?.quota?.videoSeconds>0)?'':`<button class="button secondary" data-paid="${index}">${publicMode?'本地模型生成':'动态 B-roll · 约 '+money(cost)}</button>`}</div>
      </div>
    </article>`;
  }).join('');
}

async function createProject() {
  const body = { title: $('title').value, article: $('article').value, duration: Number($('duration').value), aspect: $('aspect').value, style: $('style').value, imageModel: $('imageModel').value, budgetCny: Number($('budget').value) };
  const project = await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
  await loadProject(project.id);
  toast('项目已创建，本地初稿已经可以编辑。');
}

function scenesFromForm() {
  return current.plan.scenes.map((scene, index) => {
    const root = document.querySelector(`[data-shot="${index}"]`);
    return { ...scene, caption: root.querySelector('[data-field="caption"]').value, duration: Number(root.querySelector('[data-field="duration"]').value), manualDuration: true, style: root.querySelector('[data-field="style"]').value, budgetCny: Number(root.querySelector('[data-field="budgetCny"]').value), videoModel: root.querySelector('[data-field="videoModel"]').value };
  });
}

async function savePlan(showToast = true) {
  if (!current) return;
  current = await api(`/api/projects/${current.id}/plan`, { method: 'PUT', body: JSON.stringify({ narration: $('narration').value, scenes: scenesFromForm() }) });
  renderProject();
  if (showToast) toast('口语稿和镜头设置已保存');
}

async function saveProjectSettings() {
  current = await api(`/api/projects/${current.id}/settings`, { method: 'PUT', body: JSON.stringify({ budgetCny: Number($('projectBudget').value), aspect: $('projectAspect').value }) });
  renderProject();
  toast('全片预算和画面比例已保存');
}

async function startAction(action) {
  if (!current) return;
  await api(`/api/projects/${current.id}/${action}`, { method: 'POST', body: '{}' });
  await loadProject(current.id);
}

async function uploadFile(kind, index, file) {
  if (!file) return;
  let blob = file;
  if (kind === 'image') {
    const image = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }
  const url = `/api/projects/${current.id}/assets/${index}?kind=${kind}`;
  await api(url, { method: 'PUT', body: blob, headers: { 'Content-Type': kind === 'video' ? 'video/mp4' : kind === 'voice' ? 'audio/wav' : 'image/png' } });
  await loadProject(current.id);
  toast('素材已添加');
}

function updatePaidDetails() {
  const scene = current.plan.scenes[selectedPaid];
  const modelId = $('videoModel').value;
  const model = settingsState.videoModels[modelId];
  if (!scene || !model) return;
  const cost = estimate(modelId, scene.duration);
  const sceneLeft = Number(scene.budgetCny || 0) - Number(scene.videoReservedCny || 0);
  const projectLeft = Number(current.budgetCny || 0) - Number(current.videoReservedCny || 0);
  $('paidDetails').textContent = publicMode ? `镜头 ${selectedPaid + 1} · ${model.name} · 生成约 ${Math.min(5,Math.ceil(scene.duration))} 秒 · 账户剩余 ${account?.quota?.videoSeconds||0} 秒。` : `镜头 ${selectedPaid + 1} · ${model.name} · ${billedDuration(modelId, scene.duration)} · 预计 ${money(cost)}。镜头剩余 ${money(sceneLeft)}，全片剩余 ${money(projectLeft)}。`;
  const local = model.provider === 'local';
  $('apiKeyLabel').classList.toggle('hidden', local);
  $('providerKey').classList.toggle('hidden', local);
  $('rememberWrap').classList.toggle('hidden', local);
  const saved = settingsState.keys?.[model.provider];
  $('providerKey').placeholder = saved ? '已保存，可留空' : '请输入此服务的 API Key';
  $('paidNote').textContent = local ? `费用为 ¥0。FramePack 需要先安装并在本机启动；此模型必须先为镜头准备 PNG 插画。${healthState?.framepackRebootRequired ? '页面文件已配置成功，请重启 Windows 后再启动 FramePack。' : healthState?.framepackNeedsPagefile ? `当前内存约 ${healthState.systemRamGB}GB，需先运行 tools/configure-framepack-pagefile.ps1 并重启 Windows。` : '6GB 显卡生成几秒视频可能需要较长时间。'}` : '估价按 1 美元≈¥6.70 换算。实际费用以服务商账单与汇率为准；后台会再次检查两级预算。';
  $('confirmPaid').disabled = cost > sceneLeft || cost > projectLeft || (local && !healthState?.localVideo) || (publicMode && Math.min(5,Math.ceil(scene.duration))>(account?.quota?.videoSeconds||0));
}

function showPaid(index) {
  selectedPaid = index;
  const scene = current.plan.scenes[index];
  $('videoModel').value = publicMode ? 'local-framepack' : scene.videoModel || 'minimax-h3';
  $('providerKey').value = '';
  $('rememberKey').checked = false;
  updatePaidDetails();
  $('paidDialog').showModal();
}

async function confirmPaid() {
  if (selectedPaid < 0) return;
  await api(`/api/projects/${current.id}/paid-video`, { method: 'POST', body: JSON.stringify({ sceneIndex: selectedPaid, modelId: $('videoModel').value, apiKey: $('providerKey').value.trim(), remember: $('rememberKey').checked, confirm: true }) });
  $('providerKey').value = '';
  await loadProject(current.id);
  if(publicMode){const session=await api('/api/session');account=session.account;showAccount();}
  toast('动态视频任务已提交');
}

async function saveSettings() {
  const keys = {};
  for (const [provider, inputId] of [['minimax', 'minimaxKey'], ['replicate', 'replicateKey'], ['fal', 'falKey']]) if ($(inputId).value.trim()) keys[provider] = $(inputId).value.trim();
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ imageModel: $('defaultImageModel').value, keys }) });
  for (const id of ['minimaxKey', 'replicateKey', 'falKey']) $(id).value = '';
  await refreshSettings();
  $('imageModel').value = settingsState.imageModel;
  toast('模型和密钥设置已保存');
}

$('newProject').addEventListener('click', showNew);
$('backToNew').addEventListener('click', showNew);
$('deleteProject').addEventListener('click',()=>guarded(async()=>{if(!current||!window.confirm(`确定删除“${current.plan?.title||current.title}”及其素材和成片吗？`))return;await api(`/api/projects/${current.id}`,{method:'DELETE'});current=null;await refreshList();showNew();toast('项目已删除');}));
$('createProject').addEventListener('click', () => guarded(createProject));
$('savePlan').addEventListener('click', () => guarded(() => savePlan(true)));
$('saveBudget').addEventListener('click', () => guarded(saveProjectSettings));
$('projectAspect').addEventListener('change', () => guarded(saveProjectSettings));
$('aiPlan').addEventListener('click', () => guarded(async () => { if (!await refreshHealth()) throw new Error('请先连接现有 ChatGPT/Codex 账号'); await startAction('plan'); }));
$('generateImages').addEventListener('click', () => guarded(async () => { if (!await refreshHealth()) throw new Error('请先连接 Codex，再生成插画'); await savePlan(false); await startAction('images'); }));
$('generateVoice').addEventListener('click', () => guarded(async () => { await savePlan(false); await startAction('voice'); }));
$('renderVideo').addEventListener('click', () => guarded(async () => { await savePlan(false); await startAction('render'); }));
$('connectCodex').addEventListener('click', () => guarded(async () => { if (await refreshHealth()) return toast('Codex 已连接'); await api('/api/codex/login', { method: 'POST', body: '{}' }); toast('已启动 Codex 登录，请在浏览器中完成授权。'); }));
$('narration').addEventListener('input', () => { const total = [...document.querySelectorAll('[data-field="duration"]')].reduce((sum, input) => sum + Number(input.value || 0), 0); $('scriptLength').textContent = `${$('narration').value.length} 字 · 镜头合计 ${total.toFixed(1)} 秒`; });
$('projectList').addEventListener('click', event => { const button = event.target.closest('[data-project]'); if (button) guarded(() => loadProject(button.dataset.project)); });
  $('shotList').addEventListener('input', event => { if (event.target.matches('[data-field="duration"],[data-field="videoModel"]')) { const root = event.target.closest('[data-shot]'); const scene = current.plan.scenes[Number(root.dataset.shot)]; const modelId = root.querySelector('[data-field="videoModel"]').value; const button=root.querySelector('[data-paid]'); if(button)button.textContent = `动态 B-roll · 约 ${money(estimate(modelId, root.querySelector('[data-field="duration"]').value || scene.duration))}`; } });
$('shotList').addEventListener('click', event => { const button = event.target.closest('[data-paid]'); if (button) guarded(async () => { const index = Number(button.dataset.paid); await savePlan(false); showPaid(index); }); });
$('shotList').addEventListener('change', event => { const input = event.target.closest('[data-upload]'); if (!input) return; const [kind, index] = input.dataset.upload.split(':'); guarded(() => uploadFile(kind, Number(index), input.files[0])); });
$('voiceUpload').addEventListener('change', event => guarded(() => uploadFile('voice', 0, event.target.files[0])));
$('videoModel').addEventListener('change', updatePaidDetails);
$('paidDialog').addEventListener('close', () => { if ($('paidDialog').returnValue === 'confirm') guarded(confirmPaid); });
$('openSettings').addEventListener('click', () => guarded(async () => { await refreshSettings(); $('settingsDialog').showModal(); }));
$('settingsDialog').addEventListener('close', () => { if ($('settingsDialog').returnValue === 'save') guarded(saveSettings); });

setInterval(() => guarded(async () => {
  if (!current) return;
  const next = await api(`/api/projects/${current.id}`);
  const previousTask = current.task;
  current = next;
  if (previousTask?.state === 'running' && next.task?.state === 'done'){toast(`${next.task.label} 已完成`);if(publicMode){account=(await api('/api/session')).account;showAccount();}}
  if (previousTask?.state === 'running' && next.task?.state !== 'running') renderProject(); else taskBanner();
}), 2500);

setInterval(() => {if(!publicMode||account)guarded(refreshHealth);}, 10000);
async function signIn(action) {try {const result=await api(`/api/auth/${action}`,{method:'POST',body:JSON.stringify({email:$('authEmail').value,password:$('authPassword').value,inviteCode:$('authInvite').value})});account=result;$('authView').classList.add('hidden');$('authInvite').value='';showAccount();await initializeWorkspace();}catch(e){$('authError').textContent=e.message||String(e);}}
$('authLogin').addEventListener('click',()=>signIn('login'));
$('authRegister').addEventListener('click',()=>signIn('register'));
$('logout').addEventListener('click',()=>guarded(async()=>{await api('/api/auth/logout',{method:'POST',body:'{}'});account=null;current=null;$('authView').classList.remove('hidden');}));
async function initializeWorkspace(){await refreshSettings();$('imageModel').value=settingsState.imageModel;await refreshList();await refreshHealth();}
guarded(async () => {const session=await api('/api/session').catch(()=>({publicMode:false}));publicMode=Boolean(session.publicMode);if(publicMode){account=session.account;$('modeLabel').textContent='云端视频工作台';if(account)showAccount();else $('accountLabel').textContent='注册后保存项目';$('logout').classList.remove('hidden');for(const id of ['openSettings','connectCodex','aiPlan','generateImages'])$(id).classList.add('hidden');document.querySelector('.budget-panel').classList.add('hidden');document.querySelector('.connection').classList.add('hidden');document.querySelector('.topbar p').textContent='粘贴文案，按镜头编辑，生成档案拼贴画面、旁白和成片。';document.querySelector('.topbar .pill').textContent='横竖屏可选 · 云端导出';document.querySelector('.audio-panel p').textContent='使用服务器本地中文语音，或上传自己的 WAV。生成后会按真实音频长度调整镜头。';if(!account){$('authView').classList.remove('hidden');return;}}await initializeWorkspace();});
