const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let homeDevices = [];
let currentDevice = 0;
let homeLoadError = '';
const steps = [
  ['01','找到所需设备','从设备名称或实验室位置开始搜索。','设备目录'],
  ['02','了解可用情况','设备详情显示用途、位置与当前状态。','设备详情'],
  ['03','选择实验时段','日期和时间确认后，检查现有预约是否冲突。','时段选择'],
  ['04','提交预约申请','申请进入待审核状态，学生可在记录中追踪。','待审核'],
  ['05','收到审核结果','教师完成审批，学生查看预约状态。','审核完成']
];
function renderHomeDevice() {
  const device = homeDevices[currentDevice];
  const display = document.getElementById('equipmentDisplay');
  if (!device) { display.innerHTML = `<h3>${escapeHTML(homeLoadError || '正在读取设备目录…')}</h3><p>${homeLoadError ? '请确认实验室服务器已启动。' : '设备目录由后端数据库实时提供。'}</p>`;document.getElementById('equipmentCurrent').textContent='00';document.getElementById('equipmentTotal').textContent='00';return; }
  const state = device.status;
  display.innerHTML = `<h3>${escapeHTML(device.name)}</h3><p>${escapeHTML(device.description)}</p><p>${escapeHTML(device.room)}</p><span class="equipment-status">${escapeHTML(getStatusText(state))}</span><br><a href="login.html?role=student">进入工作台查看设备 ↗</a>`;
  document.getElementById('equipmentCurrent').textContent = String(currentDevice + 1).padStart(2,'0');
  document.getElementById('equipmentTotal').textContent = String(homeDevices.length).padStart(2,'0');
  document.querySelectorAll('#equipmentTicker button').forEach((b,i)=>b.classList.toggle('active',i===currentDevice));
  if (!reduceMotion.matches) display.animate([{opacity:.4,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:350,easing:'cubic-bezier(.16,1,.3,1)'});
}
const ticker = document.getElementById('equipmentTicker');
function renderTicker(){ticker.replaceChildren();homeDevices.forEach((device,i)=>{const button=document.createElement('button');button.type='button';button.textContent=device.name;button.addEventListener('click',()=>{currentDevice=i;renderHomeDevice()});ticker.append(button)})}
renderTicker();
document.getElementById('equipmentPrev').addEventListener('click',()=>{if(!homeDevices.length)return;currentDevice=(currentDevice-1+homeDevices.length)%homeDevices.length;renderHomeDevice()});
document.getElementById('equipmentNext').addEventListener('click',()=>{if(!homeDevices.length)return;currentDevice=(currentDevice+1)%homeDevices.length;renderHomeDevice()});
renderHomeDevice();
async function loadHomeDevices(){
  try {
    const data = await api('/public/devices');
    homeDevices = data.devices;
    homeLoadError = '';
    currentDevice = Math.min(currentDevice, Math.max(0, homeDevices.length - 1));
    renderTicker();
    renderHomeDevice();
  } catch (error) {
    homeLoadError = '设备目录暂时不可用';
    renderTicker();
    renderHomeDevice();
  }
}
loadHomeDevices();
setInterval(()=>{if(!document.hidden)loadHomeDevices()},60000);
addEventListener('focus',()=>{if(!document.hidden)loadHomeDevices()});
let activeStep = -1;
function showProcessStep(i){if(i===activeStep)return;activeStep=i;document.querySelectorAll('.process-step').forEach((el,n)=>{el.classList.toggle('active',n===i);el.setAttribute('aria-current',n===i?'step':'false')});const [glyph,title,description,status]=steps[i];document.getElementById('processGlyph').textContent=glyph;document.getElementById('processTitle').textContent=title;document.getElementById('processDescription').textContent=description;document.getElementById('processStatus').textContent=status;document.getElementById('processFraction').textContent=`0${i+1} / 05`}
document.querySelectorAll('.process-step').forEach((el,i)=>{
  el.setAttribute('role','button');
  el.setAttribute('tabindex','0');
  el.setAttribute('aria-label',`查看流程第 ${i+1} 步：${el.querySelector('h3').textContent}`);
  el.addEventListener('click',()=>showProcessStep(i));
  el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showProcessStep(i)}});
});
showProcessStep(0);
let scheduled=false;
function updateScroll(){scheduled=false;const max=document.documentElement.scrollHeight-innerHeight;document.querySelector('.scroll-progress').style.transform=`scaleX(${max>0?scrollY/max:0})`;
  const story=document.querySelector('.story-section');const storyProgress=Math.min(100,Math.max(0,((innerHeight-story.getBoundingClientRect().top)/(innerHeight+story.offsetHeight))*150));document.documentElement.style.setProperty('--mask-progress',storyProgress+'%');
  const process=document.querySelector('.process-scroll');const rect=process.getBoundingClientRect();const range=Math.max(1,process.offsetHeight-innerHeight);const progress=Math.min(1,Math.max(0,-rect.top/range));if(rect.top<innerHeight&&rect.bottom>0)showProcessStep(Math.min(4,Math.floor(progress*5)));
  if(!reduceMotion.matches){document.documentElement.style.setProperty('--hero-shift',Math.min(scrollY,900)*.12+'px');const campus=document.querySelector('.campus-section').getBoundingClientRect();if(campus.top<innerHeight&&campus.bottom>0){document.documentElement.style.setProperty('--campus-shift',Math.max(-25,Math.min(25,campus.top*.035))+'px')}const eq=document.querySelector('.equipment-section').getBoundingClientRect();if(eq.top<innerHeight&&eq.bottom>0)document.documentElement.style.setProperty('--equipment-shift',Math.max(-20,Math.min(20,eq.top*.035))+'px')}
}
addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(updateScroll)}},{passive:true});addEventListener('resize',updateScroll);updateScroll();

