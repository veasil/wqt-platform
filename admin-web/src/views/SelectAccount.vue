<template>
  <main class="selection-page">
    <el-dialog :model-value="!adding" class="account-picker" title="选择本次使用的账号" width="min(560px, 94vw)" align-center :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false">
      <p class="intro picker-intro">{{ auth.user?.guardianName || '我的账号' }}<span>权益和权限跟随所选账号</span></p>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <div v-loading="loading" class="account-list">
        <button v-for="account in auth.accounts" :key="account.id" class="account-option" :class="{'is-current':account.id===auth.user?.accountId}" :disabled="loading" @click="choose(account)">
          <span class="account-avatar" aria-hidden="true">{{ account.name?.slice(0,1) || '账' }}</span>
          <span class="account-copy"><strong>{{ account.name }} <small class="account-number">#{{ account.id }}</small></strong><span class="organization-line">{{ account.organization_name }} · {{ roleName(account.role) }}</span><span class="entitlement-line">{{ entitlement(account) }}</span></span>
          <span class="account-arrow" aria-hidden="true">›</span>
        </button>
      </div>
      <button class="add-option" :disabled="loading" @click="error='';adding=true"><span class="add-icon" aria-hidden="true">＋</span><span><strong>新增组织或账号</strong><small>通过邀请码加入</small></span><span class="account-arrow" aria-hidden="true">›</span></button>
      <template #footer><el-button text @click="load">刷新账号</el-button><el-button text @click="exit">退出登录</el-button></template>
    </el-dialog>
    <el-dialog v-model="adding" class="join-dialog" title="新增组织或账号" width="min(480px, 94vw)" align-center :close-on-click-modal="false" :close-on-press-escape="!loading" :show-close="!loading" @closed="form.password='';form.code=''">
      <p class="intro">输入邀请码并验证本人身份，原有账号会保留。</p>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <el-form @submit.prevent="join" label-position="top" class="join-form">
        <el-form-item label="邀请码"><el-input v-model="form.inviteCode" placeholder="请输入组织或账号邀请码" /></el-form-item>
        <el-form-item label="身份验证"><el-radio-group v-model="method"><el-radio-button value="password">密码验证</el-radio-button><el-radio-button value="sms" :disabled="!smsAvailable">{{ smsAvailable ? '短信验证':'短信 · 待配置' }}</el-radio-button><el-radio-button value="wechat" disabled>微信 · 待接入</el-radio-button></el-radio-group></el-form-item>
        <el-form-item v-if="method === 'password'" label="当前用户密码"><el-input v-model="form.password" type="password" show-password autocomplete="current-password" /></el-form-item>
        <el-form-item v-else label="当前手机号的短信验证码"><div class="sms-row"><el-input v-model="form.code" /><el-button :disabled="sending || countdown > 0" @click="sendCode">{{ countdown > 0 ? countdown + 's' : '发送验证码' }}</el-button></div></el-form-item>
        <p class="verification-phone">验证手机号 <strong>{{ auth.user?.phone }}</strong></p>
        <div class="join-actions"><el-button :disabled="loading" @click="error='';adding=false">返回账号列表</el-button><el-button type="primary" native-type="submit" :loading="loading">验证并加入</el-button></div>
      </el-form>
    </el-dialog>
  </main>
</template>
<script setup>
import {ref,reactive,onMounted,onBeforeUnmount} from 'vue'
import {useRouter} from 'vue-router'
import {ElMessage} from 'element-plus'
import {useAuthStore} from '../stores/auth'
import {selectAccount,sendSmsCode} from '../api/auth'
import api from '../api'
import {accountEntitlement} from '../utils/entitlements'
import {captchaProof} from '../utils/captcha'
const auth=useAuthStore(),router=useRouter(),loading=ref(false),error=ref(''),adding=ref(false),method=ref('password'),sending=ref(false),countdown=ref(0),smsAvailable=ref(true)
const form=reactive({inviteCode:'',password:'',code:''})
let timer,attempt
const entitlement=account=>{
  const paid=Number(account.valid_until)>Date.now(),trial=Number(auth.user?.trialUntil)>Date.now()
  const until=paid ? account.valid_until:trial ? auth.user.trialUntil:account.valid_until
  const label=accountEntitlement({...account,available:true,paid_valid:paid,trial_valid:trial,entitlement_until:until})
  return paid || trial ? label+' · 至 '+new Date(until).toLocaleDateString('zh-CN'):label
}
const roleName=role=>({boss:'平台管理员',enterprise:'组织管理员',operator:'运营人员',watcher:'守望者账号'}[role] || '守望者账号')
async function load() {
  loading.value=true;error.value=''
  try {await auth.fetchAccounts()} catch(e) {auth.accounts=[];error.value=e.response?.data?.error || '账号列表暂不可用'}
  finally {loading.value=false}
}
async function choose(account) {
  loading.value=true;error.value=''
  try {
    const {data}=await selectAccount(auth.token,account.id);auth.setAuth(data.token,data.user)
    if (account.role==='boss') await router.push({name:'Overview'})
    else if (account.role==='enterprise' && account.plan==='city') {localStorage.setItem('ep_token',data.token);localStorage.setItem('ep_user',JSON.stringify(data.user));window.location.assign('/enterprise/')}
    else {localStorage.setItem('WQT_AUTH_TOKEN',data.token);localStorage.setItem('WQT_USER_CACHE',JSON.stringify(data.user));window.location.assign('/')}
  } catch(e) {error.value=e.response?.data?.error || e.message}
  finally {loading.value=false}
}
async function sendCode() {
  error.value='';sending.value=true
  try {
    const {data}=await sendSmsCode(auth.user.phone,await captchaProof())
    ElMessage.success(data.mockCode ? `验证码已发送（测试码：${data.mockCode}）`:'验证码已发送')
    countdown.value=60;clearInterval(timer);timer=setInterval(()=>{if (--countdown.value<=0) clearInterval(timer)},1000)
  } catch(e) {error.value=e.response?.data?.error || e.message}
  finally {sending.value=false}
}
async function join() {
  error.value=''
  if (!form.inviteCode.trim() || (method.value==='password' ? !form.password:!form.code)) {error.value='请输入邀请码并完成所选身份验证';return}
  const code=form.inviteCode.trim().toUpperCase()
  if (!attempt || attempt.code!==code) attempt={code,id:crypto.randomUUID()}
  loading.value=true
  try {
    await api.post('/api/auth/join-with-invite',{inviteCode:code,requestId:attempt.id,verificationMethod:method.value,...(method.value==='password' ? {password:form.password}:{code:form.code})})
    form.password='';form.code='';attempt=null;adding.value=false
    await auth.fetchAccounts();ElMessage.success('已加入，请选择新账号查看组织权益')
  } catch(e) {error.value=e.response?.data?.error || e.message}
  finally {loading.value=false}
}
async function exit() {
  try {await auth.endSession();router.push({name:'Login'})}
  catch(e) {error.value=e.response?.data?.error || '服务器注销未完成，请重试'}
}
onMounted(async()=>{await load();try {const {data}=await api.get('/api/auth/verification-options');smsAvailable.value=data.sms!==false} catch {smsAvailable.value=false}})
onBeforeUnmount(()=>clearInterval(timer))
</script>
<style scoped>
.selection-page{min-height:100vh;background:#f3f5f7}
:deep(.el-dialog){--el-color-primary:#367467;--el-color-primary-light-3:#719e93;--el-color-primary-light-5:#a0beb7;--el-color-primary-light-9:#eff6f3;border-radius:18px;padding:28px;box-shadow:0 24px 80px #182b3c24}
:deep(.el-dialog__title){font-size:22px;font-weight:600;color:#223644;letter-spacing:-.5px}
:deep(.el-dialog__header){padding-bottom:4px}:deep(.el-dialog__footer){padding-top:18px;border-top:1px solid #edf0f2;margin-top:18px}
.intro{color:#7a8790;font-size:13px;line-height:1.7;margin:12px 0 24px}.picker-intro{display:flex;justify-content:space-between;gap:8px}
.account-list{max-height:min(390px,48vh);overflow:auto;display:flex;flex-direction:column;gap:10px;padding:2px}
.account-option{display:flex;align-items:center;gap:16px;width:100%;text-align:left;background:#fff;border:1px solid #e5eaed;border-radius:12px;padding:18px;cursor:pointer;color:#263847;transition:border-color .15s,background .15s}
.account-option:hover:enabled,.account-option.is-current{border-color:#94b9ae;background:#f7fbf9}.account-option:focus-visible,.add-option:focus-visible{outline:2px solid #2f7465;outline-offset:2px}.account-option:disabled{opacity:.55;cursor:wait}
.account-avatar{display:grid;place-items:center;flex:none;width:44px;height:44px;background:#eef3f4;border-radius:12px;font-size:20px;font-weight:500;color:#526e76}.account-copy{display:flex;flex-direction:column;gap:5px;flex:1;min-width:0}.account-copy strong{font-size:15px;font-weight:600;overflow-wrap:anywhere}.account-number{font-size:11px;color:#98a5ad;font-weight:400;margin-left:6px}.organization-line{font-size:12px;color:#7a8790}.entitlement-line{font-size:12px;color:#55776b}.account-arrow{font-size:25px;color:#a9b5bc;flex:none;font-weight:300}
.add-option{display:flex;align-items:center;gap:16px;width:100%;text-align:left;margin-top:16px;border:1px dashed #ccd7dc;border-radius:12px;padding:16px 18px;background:#f9fbfc;color:#47616b;cursor:pointer}.add-option>span:nth-child(2){display:flex;flex-direction:column;gap:5px;flex:1}.add-option strong{font-size:14px;font-weight:500}.add-option small{font-size:12px;color:#8b979e}.add-icon{display:grid;place-items:center;width:44px;font-size:24px;font-weight:300}.add-option:hover{background:#f0f6f4;border-color:#94b9ae}
.join-form :deep(.el-input__wrapper){min-height:42px;border-radius:8px}.join-form :deep(.el-form-item){margin-bottom:22px}.verification-phone{font-size:12px;color:#8a979e;padding-top:0;margin:0 0 24px}.verification-phone strong{margin-left:12px;font-weight:500;color:#566b76}.join-actions{display:flex;justify-content:flex-end;gap:4px;padding-top:18px;border-top:1px solid #edf0f2}.sms-row{display:flex;gap:8px;width:100%}
@media(max-width:600px){:deep(.el-dialog){padding:22px}.picker-intro{flex-direction:column;gap:2px}.account-option{padding:14px;gap:12px}.account-avatar{width:36px;height:36px}.account-copy strong{font-size:14px}.account-list{max-height:42vh}.join-form :deep(.el-radio-button__inner){padding:10px}}
@media(prefers-reduced-motion:reduce){.account-option{transition:none}}
</style>
