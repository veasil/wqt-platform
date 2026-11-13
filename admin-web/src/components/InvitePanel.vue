<template>
  <section>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-alert v-if="pending" title="邀请码操作结果未确认" type="warning" :closable="false"><el-button :loading="saving" @click="retry">重试原操作</el-button></el-alert>
    <div class="toolbar" style="margin-top:16px">
      <el-select v-if="organizationId==null" v-model="filterOrg" placeholder="所有组织" clearable style="width:230px" @change="load"><el-option v-for="org in organizations" :key="org.id" :value="org.id" :label="org.id===0 ? '免费组织':org.name" /></el-select>
      <el-button type="primary" :disabled="!!pending" @click="openCreate">生成邀请码</el-button><el-button @click="load">刷新</el-button>
    </div>
    <p class="note">组织邀请码绑定该组织首次空闲的守望者账号，直接享有其权益；已有用户须验证原密码和短信，个人资料保留。</p>
    <el-table v-if="loaded" :data="codes" v-loading="loading" stripe>
      <el-table-column prop="code" label="邀请码" min-width="140" /><el-table-column label="组织" min-width="140"><template #default="{row}">{{ row.organization_id===0 || row.type==='general' ? '免费组织':row.org_name }}</template></el-table-column>
      <el-table-column label="使用次数" width="100"><template #default="{row}">{{ row.used_count }}/{{ row.max_uses }}</template></el-table-column>
      <el-table-column label="有效期" min-width="190"><template #default="{row}">{{ formatTime(row.expires_at) }}</template></el-table-column>
      <el-table-column label="状态" width="100"><template #default="{row}">{{ row.status!=='active' ? '已停用':row.expires_at<=Date.now() ? '已过期':row.used_count>=row.max_uses ? '已用完':'可使用' }}</template></el-table-column>
      <el-table-column label="操作" min-width="200"><template #default="{row}"><el-button size="small" @click="copy(row.code)">复制邀请码</el-button><el-button size="small" @click="copy(link(row.code))">复制邀请链接</el-button></template></el-table-column>
    </el-table>
    <el-dialog v-model="dialog" title="生成组织邀请码" width="min(500px,94vw)">
      <el-form label-position="top">
        <el-form-item label="目标组织"><el-select v-model="form.organizationId" style="width:100%"><el-option v-for="org in organizations" :key="org.id" :value="org.id" :label="org.id===0 ? '免费组织':org.name" :disabled="org.status!=='active'" /></el-select></el-form-item>
        <el-form-item label="最多使用次数"><el-input-number v-model="form.maxUses" :min="1" :max="10000" /></el-form-item>
        <el-form-item label="有效天数"><el-input-number v-model="form.expiresInDays" :min="1" :max="365" /></el-form-item>
      </el-form>
      <p class="note">邀请码不增加组织的守望者账号名额；使用时须有可首次绑定的空位。</p>
      <template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" :loading="saving" :disabled="!!pending" @click="generate">生成邀请码</el-button></template>
    </el-dialog>
  </section>
</template>
<script setup>
import {ref,reactive,onMounted} from 'vue'
import {ElMessage} from 'element-plus'
import api from '../api'
import {useAuthStore} from '../stores/auth'
import {createOperationClient,formatTime} from '../utils/entitlements'
const props=defineProps({organizations:{type:Array,default:()=>[]},organizationId:{type:Number,default:null}})
const auth=useAuthStore(),codes=ref([]),error=ref(''),loading=ref(false),loaded=ref(false),saving=ref(false),dialog=ref(false),filterOrg=ref(null)
const form=reactive({organizationId:props.organizationId ?? 0,maxUses:1,expiresInDays:7})
const client=createOperationClient({storage:sessionStorage,scope:`invites:${props.organizationId ?? 'all'}`,actor:{identityId:auth.user.identityId,accountId:auth.user.accountId},post:async(path,body)=>(await api.post(path,body)).data})
const pending=ref(client.pending)
function link(code) {const url=new URL('/register.html',window.location.origin);url.searchParams.set('inviteCode',code);return url.href}
async function copy(value) {try {await navigator.clipboard.writeText(value);ElMessage.success('已复制')} catch {ElMessage.warning(`请手动复制：${value}`)}}
async function load() {
  loading.value=true;error.value=''
  try {const {data}=await api.get('/api/admin/invite-codes',{params:{organizationId:props.organizationId ?? filterOrg.value ?? undefined}});codes.value=data.codes;loaded.value=true}
  catch(e) {loaded.value=false;error.value=e.response?.data?.error || e.message}
  finally {loading.value=false}
}
function openCreate() {form.organizationId=props.organizationId ?? filterOrg.value ?? 0;dialog.value=true}
async function save(action) {
  if(saving.value) return
  saving.value=true
  try {const result=await action();dialog.value=false;await load();ElMessage.success(`已生成邀请码：${result.code}`)}
  catch(e) {error.value=e.response?.data?.error || e.message}
  finally {pending.value=client.pending;saving.value=false}
}
const generate=()=>save(()=>client.execute('/api/admin/invite-codes',{...form}))
const retry=()=>save(()=>client.retry())
defineExpose({openCreate})
onMounted(load)
</script>
<style scoped>.note{color:#66777c;font-size:13px;line-height:1.8}</style>
