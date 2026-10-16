<template>
  <div class="login-wrapper">
    <el-card class="login-card" shadow="hover">
      <template #header>
        <h2 style="text-align:center; margin:0">组织管理后台</h2>
      </template>
      <el-form v-if="!pendingToken" :model="form" @submit.prevent="handleLogin" label-position="top">
        <el-form-item label="手机号">
          <el-input v-model="form.phone" placeholder="请输入手机号" :prefix-icon="Phone" />
        </el-form-item>
        <el-radio-group v-if="!legacy" v-model="method" style="margin-bottom:20px"><el-radio-button value="password">账号密码登录</el-radio-button><el-radio-button value="sms" :disabled="!smsAvailable">账号验证码登录</el-radio-button></el-radio-group>
        <el-form-item v-if="legacy || method === 'password'" label="密码">
          <el-input v-model="form.password" type="password" placeholder="请输入密码"
            :prefix-icon="Lock" show-password />
        </el-form-item>
        <el-form-item v-if="legacy || method === 'sms'" label="验证码">
          <div style="display:flex; gap:8px; width:100%">
            <el-input v-model="form.code" placeholder="请输入短信验证码" :prefix-icon="Message"
              @keyup.enter="handleLogin" style="flex:1" />
            <el-button :disabled="countdown > 0 || sending" :loading="sending" @click="handleSendCode"
              style="width:120px">
              {{ countdown > 0 ? `${countdown}s` : '发送验证码' }}
            </el-button>
          </div>
        </el-form-item>
        <el-button type="primary" :loading="loading" @click="handleLogin" style="width:100%">
          登 录
        </el-button>
      </el-form>
      <el-form v-else @submit.prevent="handleAccount" label-position="top">
        <el-form-item label="选择城市级管理账号">
          <el-select v-model="selectedAccount" placeholder="请选择账号" style="width:100%">
            <el-option v-for="account in accounts" :key="account.id" :value="account.id" :label="`${account.organization_name} · ${account.name}`" />
          </el-select>
        </el-form-item>
        <el-button type="primary" :disabled="!selectedAccount" :loading="loading" @click="handleAccount" style="width:100%">确认账号</el-button>
        <el-button text @click="pendingToken = ''; accounts = []; selectedAccount = null">返回登录</el-button>
      </el-form>
      <el-button v-if="currentSession && !pendingToken" style="width:100%; margin-top:12px" @click="continueSession">使用当前登录身份继续</el-button>
      <div v-if="error" style="color:#f56c6c; text-align:center; margin-top:12px; font-size:14px">
        {{ error }}
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref, onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import { loginByPassword, sendSmsCode, selectAccount } from '../api/auth'
import { Phone, Lock, Message } from '@element-plus/icons-vue'
import api from '../api'
import { captchaProof } from '../utils/captcha'
import {existingIdentitySession} from '../../../shared/browser/identity-session.js'

const router = useRouter()
const auth = useAuthStore()
const form = reactive({ phone: '', password: '', code: '' })
const loading = ref(false)
const error = ref('')
const pendingToken = ref('')
const accounts = ref([])
const selectedAccount = ref(null)
const method=ref('password'),legacy=ref(false),smsAvailable=ref(true)
const currentSession=ref(null)
onMounted(async()=>{
 try{const {data}=await api.get('/api/settings');legacy.value=data.accountModel==='legacy'}catch{/* Server validates the actual account model. */}
 try{const {data}=await api.get('/api/auth/verification-options');smsAvailable.value=data.sms!==false}catch{smsAvailable.value=false}
 const existing=await existingIdentitySession();if(existing?.accounts?.some(a=>a.role==='enterprise'&&a.plan==='city'))currentSession.value=existing
})
function continueSession(){accounts.value=currentSession.value.accounts.filter(a=>a.role==='enterprise'&&a.plan==='city');pendingToken.value=currentSession.value.token;selectedAccount.value=null;error.value=''}

// 发送验证码 + 60 秒倒计时
const sending = ref(false)
const countdown = ref(0)
let timer = null
function startCountdown() {
  countdown.value = 60
  timer = setInterval(() => {
    if (--countdown.value <= 0) clearInterval(timer)
  }, 1000)
}
onBeforeUnmount(() => clearInterval(timer))

async function handleSendCode() {
  error.value = ''
  if (!form.phone) { error.value = '请先填写手机号'; return }
  sending.value = true
  try {
    const { data } = await sendSmsCode(form.phone, await captchaProof())
    // 开发环境会直接返回模拟验证码，方便测试
    ElMessage.success(data.mockCode ? `验证码已发送（测试码：${data.mockCode}）` : '验证码已发送')
    startCountdown()
  } catch (e) {
    error.value = e.response?.data?.error || e.message || '验证码发送失败'
  } finally {
    sending.value = false
  }
}

async function handleLogin() {
  error.value = ''
  if (!form.phone || (legacy.value ? !form.password || !form.code : method.value==='password' ? !form.password : !form.code)) { error.value = '请填写手机号和所选登录凭据'; return }
  loading.value = true
  try {
    const proof=legacy.value || method.value==='password' ? await captchaProof() : {}
    const { data } = await loginByPassword(form.phone, legacy.value || method.value==='password' ? form.password:undefined, legacy.value || method.value==='sms' ? form.code:undefined, legacy.value ? undefined:method.value, proof)
    if (data.requiresAccountSelection) {
      accounts.value = (data.accounts || []).filter(account => account.role === 'enterprise' && account.plan === 'city')
      if (!accounts.value.length) { error.value = '没有可用的城市级管理账号'; return }
      pendingToken.value = data.token
      selectedAccount.value = null
      return
    }
    if (data.user.role !== 'enterprise') {
      error.value = '该账号不是组织管理员'
      return
    }
    auth.setAuth(data.token, data.user)
    router.push({ name: 'Dashboard' })
  } catch (e) {
    error.value = e.response?.data?.error || e.message || '登录失败'
  } finally {
    loading.value = false
  }
}
async function handleAccount() {
  error.value = ''
  loading.value = true
  try {
    const { data } = await selectAccount(pendingToken.value, selectedAccount.value)
    if (data.user.role !== 'enterprise') throw new Error('该账号不是城市级组织管理员')
    auth.setAuth(data.token, data.user)
    router.push({ name: 'Dashboard' })
  } catch (e) { error.value = e.response?.data?.error || e.message || '账号选择失败' }
  finally { loading.value = false }
}
</script>

<style scoped>
.login-wrapper {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
.login-card {
  width: 400px;
  max-width: 90vw;
}
</style>
