<template>
  <div class="login-wrapper">
    <el-card class="login-card" shadow="hover">
      <template #header>
        <h2 style="text-align:center; margin:0">伍仟天平台管理</h2>
      </template>
      <el-form :model="form" @submit.prevent="handlePhone" label-position="top">
        <el-form-item label="平台管理员手机号">
          <el-input v-model="form.phone" placeholder="请输入手机号" :prefix-icon="Phone" />
        </el-form-item>
        <el-radio-group v-if="!legacy" v-model="method" style="margin-bottom:20px"><el-radio-button value="password">密码验证</el-radio-button><el-radio-button value="sms" :disabled="!smsAvailable">{{ smsAvailable ? '短信验证':'短信 · 待配置' }}</el-radio-button><el-radio-button value="wechat" disabled>微信 · 待接入</el-radio-button></el-radio-group>
        <el-form-item v-if="legacy || method === 'password'" label="密码">
          <el-input v-model="form.password" type="password" placeholder="请输入密码"
            :prefix-icon="Lock" show-password />
        </el-form-item>
        <el-form-item v-if="legacy || method === 'sms'" label="验证码">
          <div style="display:flex; gap:8px; width:100%">
            <el-input v-model="form.code" placeholder="请输入短信验证码" :prefix-icon="Message"
              @keyup.enter="handlePhone" style="flex:1" />
            <el-button :disabled="countdown > 0 || sending" :loading="sending" @click="handleSendCode"
              style="width:120px">
              {{ countdown > 0 ? `${countdown}s` : '发送验证码' }}
            </el-button>
          </div>
        </el-form-item>
        <el-button type="primary" :loading="loading" @click="handlePhone" style="width:100%">登 录</el-button>
      </el-form>
      <el-button v-if="currentSession" style="width:100%; margin-top:12px" :loading="loading" @click="continueSession">使用当前登录身份继续</el-button>
      <el-button v-if="!legacy" style="width:100%; margin-top:12px" :loading="loading" @click="continuePlayerSession">沿用桌游端登录身份</el-button>


      <p v-if="cooldownNotice" role="status" style="text-align:center">{{ cooldownMessage }}</p>
      <div v-if="error" style="color:#f56c6c; text-align:center; margin-top:12px; font-size:14px">{{ error }}</div>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref, watch, onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import { loginByPassword, sendSmsCode } from '../api/auth'
import api from '../api'
import { captchaProof } from '../utils/captcha'
import { Phone, Lock, Message } from '@element-plus/icons-vue'
import {existingIdentitySession} from '../../../shared/browser/identity-session.js'
import {createSmsCooldown} from '../../../shared/browser/sms-cooldown.js'
import {playerIdentitySession} from '../../../shared/browser/admin-session-bridge.js'

const router = useRouter()
const auth = useAuthStore()
const form = reactive({ phone: '', password: '', code: '' })
const method = ref('password'), legacy=ref(false), smsAvailable=ref(true)
const currentSession=ref(null)
onMounted(async()=>{
  try {const {data}=await api.get('/api/settings');legacy.value=data.accountModel==='legacy'} catch { /* Backend still validates the chosen proof. */ }
  try {const {data}=await api.get('/api/auth/verification-options');smsAvailable.value=data.sms!==false} catch {smsAvailable.value=false}
  const existing=await existingIdentitySession();if(existing?.accounts?.some(a=>a.role==='boss'))currentSession.value=existing
})
const loading = ref(false)
const error = ref('')
async function continueSession(){
 loading.value=true;error.value=''
 try{auth.setAuth(currentSession.value.token,currentSession.value.user);await router.push({name:'SelectAccount'})}
 catch(e){error.value=e.message || '登录恢复失败'}finally{loading.value=false}
}
async function continuePlayerSession(){
 loading.value=true;error.value=''
 try{
  const token=location.hostname==='admin.ai5000days.com' ? await playerIdentitySession():(await existingIdentitySession())?.token
  if(!token)throw new Error('桌游端尚未登录，请先在桌游端登录')
  // A failed handoff must not let the shared HTTP interceptor clear another valid admin login.
  const response=await fetch('/api/auth/session',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(8000)})
  const data=await response.json()
  if(!response.ok)throw new Error(data.error||'桌游登录已失效，请重新登录')
  if(!data.accounts?.some(a=>a.role==='boss'))throw new Error('当前桌游身份没有可用的平台管理账号')
  auth.setAuth(token,data.user)
  await router.push({name:'SelectAccount'})
 }catch(e){error.value=e.response?.data?.error || e.message || '登录接续失败'}finally{loading.value=false}
}

// The server supplies the remaining wait; use a deadline so background tabs catch up.
const sending = ref(false)
const countdown = ref(0)
const cooldownNotice = ref(false)
const cooldownMessage = ref('')
const cooldown = createSmsCooldown(seconds => {
  countdown.value = seconds
  cooldownMessage.value = seconds > 0 ? `请等待 ${seconds} 秒后重试` : '现在可以重新获取验证码'
})
watch(() => form.phone, phone => { cooldownNotice.value = false; cooldown.select(phone) }, {immediate:true})
onBeforeUnmount(() => cooldown.dispose())

async function handleSendCode() {
  if (sending.value || countdown.value > 0) return
  error.value = ''; cooldownNotice.value = false
  const phone = form.phone
  if (!phone) { error.value = '请先填写手机号'; return }
  sending.value = true
  try {
    const { data } = await sendSmsCode(phone, await captchaProof())
    // 开发环境会直接返回模拟验证码，方便测试
    ElMessage.success(data.mockCode ? `验证码已发送（测试码：${data.mockCode}）` : '验证码已发送')
    cooldown.start(phone, data.resendAfterSeconds ?? 60)
  } catch (e) {
    const data = e.response?.data
    if (data?.code === 'SMS_RESEND_COOLDOWN' && data.retryAfterSeconds > 0) {
      cooldownNotice.value = form.phone === phone
      cooldown.start(phone, data.retryAfterSeconds)
    } else error.value = data?.error || e.message || '验证码发送失败'
  } finally {
    sending.value = false
  }
}

async function finish(data) {
  auth.setAuth(data.token, data.user)
  router.push({ name: 'Overview' })
}

async function handlePhone() {
  error.value = ''
  if (!form.phone || (legacy.value ? !form.password || !form.code : method.value === 'password' ? !form.password : !form.code)) { error.value = '请填写手机号和所选验证方式的凭据'; return }
  loading.value = true
  try {
    const proof=legacy.value || method.value==='password' ? await captchaProof() : {}
    const { data } = await loginByPassword(form.phone, legacy.value || method.value === 'password' ? form.password : undefined, legacy.value || method.value === 'sms' ? form.code : undefined, legacy.value ? undefined:method.value, proof)
    if (data.user.identityId != null || data.requiresAccountSelection) {
      auth.setAuth(data.token,data.user)
      form.password='';form.code=''
      await router.push({name:'SelectAccount'})
      return
    }
    const allowed = data.user.identityId!=null ? ['boss']:['boss','operator']
    if (!allowed.includes(data.user.role)) {
      auth.setAuth(data.token,data.user)
      auth.accessError='当前账号没有平台管理权限，请使用 boss 账号'
      form.password='';form.code=''
      await router.push({name:'Access'})
      return
    }
    await finish(data)
  } catch (e) {
    error.value = e.response?.data?.error || e.message || '登录失败'
  } finally { loading.value = false }
}

</script>

<style scoped>
.login-wrapper {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #1f2d3d 0%, #409eff 100%);
}
.login-card { width: 420px; max-width: 90vw; }
</style>
