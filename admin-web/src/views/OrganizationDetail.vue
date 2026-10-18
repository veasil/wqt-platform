<template>
  <div v-loading="loading">
    <div class="toolbar"><el-button @click="router.push({name:'Accounts'})">返回组织与权益</el-button><el-button @click="load">刷新</el-button></div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="organization">
      <div class="org-heading"><div><h1>{{ organization.id===0 ? '免费组织':organization.name }}</h1><p>{{ organization.location || '地点未填写' }} · {{ organization.status==='active' ? '正常':'已停用' }}</p><p>{{ organization.description || '暂无组织说明' }}</p></div><el-button type="primary" @click="openEdit">编辑组织资料</el-button></div>
      <div class="detail-metrics"><div v-for="item in metrics" :key="item.label"><strong>{{ item.value }}</strong><span>{{ item.label }}</span></div></div>
      <el-card shadow="never" class="rights-card"><h3>当前组织权益</h3><el-button v-if="organization.id!==0" type="primary" @click="openRights">调整组织权益</el-button><p>{{ plans[organization.plan]?.label || '免费权益' }} · 到期 {{ formatTime(organization.subscription_until) }}</p><p>容量 {{ organization.account_count }} · 已有账号 {{ organization.current_members }}<span v-if="organization.current_members>organization.account_count">（已超出容量，保留原账号，暂停新增）</span></p><p>已绑定 {{ organization.bound_accounts }} / {{ organization.current_members }} 个守望者账号 · {{ organization.subscription_id ? `剩余换绑 ${Math.max(0,2-organization.rebind_count)} / 2`:'换绑规则不适用' }}</p><p>在线人数按绑定本组织的用户去重，表示其登录会话有效。</p></el-card>
      <el-tabs v-model="tab" style="margin-top:24px">
        <el-tab-pane label="守望者账号" name="accounts"><el-table :data="accounts" stripe><el-table-column prop="name" label="守望者账号" min-width="150" /><el-table-column prop="guardian_name" label="当前用户" min-width="120" /><el-table-column prop="phone" label="手机号" min-width="130" /><el-table-column label="权益" min-width="200"><template #default="{row}">{{ accountEntitlement(row) }} · {{ formatTime(row.entitlement_until) }}<span v-if="!row.available">（已停用）</span></template></el-table-column><el-table-column prop="role" label="账号角色" min-width="100" /></el-table></el-tab-pane>
        <el-tab-pane label="用户" name="users"><el-table :data="users" stripe><el-table-column prop="guardian_name" label="用户" /><el-table-column prop="phone" label="手机号" /><el-table-column label="在线会话"><template #default="{row}">{{ row.online ? '登录会话有效':'离线' }}</template></el-table-column></el-table></el-tab-pane>
        <el-tab-pane label="邀请码" name="invites"><InvitePanel v-if="tab==='invites'" :organization-id="organization.id" :organizations="[organization]" /></el-tab-pane>
      </el-tabs>
      <el-dialog v-model="dialog" title="组织资料" width="min(540px,94vw)"><el-form label-position="top"><el-form-item label="组织名称"><el-input v-model="form.name" maxlength="120" /></el-form-item><el-form-item label="组织地点"><el-input v-model="form.location" placeholder="例如：广东省深圳市南山区" maxlength="200" /></el-form-item><el-form-item label="组织说明"><el-input v-model="form.description" type="textarea" maxlength="2000" /></el-form-item></el-form><template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存资料</el-button></template></el-dialog>
      <el-dialog v-model="rightsDialog" title="调整组织权益" width="min(560px,94vw)"><el-form label-position="top"><el-form-item label="权益级别"><el-select v-model="rights.plan"><el-option label="个人级" value="personal"/><el-option label="团体级" value="group"/><el-option label="城市级" value="city"/></el-select></el-form-item><el-form-item label="组织容量"><el-input-number v-model="rights.capacity" :min="1" :max="10000" :precision="0"/></el-form-item><el-form-item label="到期时间"><el-date-picker v-model="rights.until" type="datetime" placeholder="选择准确到期时间"/></el-form-item><el-form-item label="调整原因"><el-input v-model="rights.reason" type="textarea" maxlength="1000"/></el-form-item></el-form><el-alert type="info" :closable="false" title="缩容保留已有账号和历史，超额时阻止新增；调整级别不改变人员角色。"/><template #footer><el-button @click="rightsDialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="saveRights">保存权益</el-button></template></el-dialog>
      <el-alert v-if="pending" title="组织调整结果未确认" type="warning" :closable="false"><el-button :loading="saving" @click="retry">重试原操作</el-button></el-alert>
    </template>
  </div>
</template>
<script setup>
import {ref,reactive,computed,onMounted} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {ElMessage} from 'element-plus'
import api from '../api'
import InvitePanel from '../components/InvitePanel.vue'
import {useAuthStore} from '../stores/auth'
import {plans,accountEntitlement,formatTime,createOperationClient} from '../utils/entitlements'
const route=useRoute(),router=useRouter(),auth=useAuthStore(),organization=ref(null),accounts=ref([]),users=ref([]),loading=ref(false),saving=ref(false),error=ref(''),dialog=ref(false),tab=ref('accounts')
const rightsDialog=ref(false),rights=reactive({plan:'personal',capacity:1,until:null,reason:''})
function openRights(){Object.assign(rights,{plan:organization.value.plan||'personal',capacity:Number(organization.value.account_count||organization.value.max_members),until:organization.value.subscription_until?new Date(Number(organization.value.subscription_until)):organization.value.valid_until?new Date(Number(organization.value.valid_until)):null,reason:''});rightsDialog.value=true}
const saveRights=()=>{if(!rights.until||!rights.reason.trim()){error.value='请选择到期时间并填写调整原因';return}return run(()=>client.execute('/api/admin/organizations/update-entitlements',{organizationId:organization.value.id,plan:rights.plan,capacity:rights.capacity,validUntil:rights.until.getTime(),reason:rights.reason.trim()}))}
const form=reactive({name:'',location:'',description:''})
const client=createOperationClient({storage:sessionStorage,scope:`organization:${route.params.id}`,actor:{identityId:auth.user.identityId,accountId:auth.user.accountId},post:async(path,body)=>(await api.post(path,body)).data}),pending=ref(client.pending)
const metrics=computed(()=>organization.value ? [
  {label:'守望者账号',value:organization.value.current_members},{label:'用户（去重）',value:organization.value.user_count},{label:'在线用户',value:organization.value.online_users},
  {label:'场次数',value:organization.value.total_sessions},{label:'进行中场次',value:organization.value.active_sessions},{label:'平均得分',value:organization.value.avg_score ?? '—'}]:[])
async function load() {
  loading.value=true;error.value=''
  try {const {data}=await api.get(`/api/admin/organizations/${route.params.id}`);organization.value=data.organization;accounts.value=data.accounts;users.value=data.users}
  catch(e) {organization.value=null;error.value=e.response?.data?.error || e.message}
  finally {loading.value=false}
}
function openEdit() {Object.assign(form,{name:organization.value.name,location:organization.value.location || '',description:organization.value.description || ''});dialog.value=true}
async function run(action) {
  if(saving.value) return
  saving.value=true
  try {await action();dialog.value=false;rightsDialog.value=false;await load();ElMessage.success('组织调整已保存')}
  catch(e) {error.value=e.response?.data?.error || e.message}
  finally {pending.value=client.pending;saving.value=false}
}
const save=()=>run(()=>client.execute('/api/admin/organizations/update-info',{organizationId:organization.value.id,...form}))
const retry=()=>run(()=>client.retry())
onMounted(load)
</script>
<style scoped>.org-heading{display:flex;justify-content:space-between;align-items:center;gap:20px}.org-heading p,.rights-card p{color:#68777b;line-height:1.8}.detail-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:24px 0}.detail-metrics>div{background:white;border:1px solid #dde6e4;padding:20px;border-radius:8px;display:flex;flex-direction:column;gap:8px}.detail-metrics strong{font-size:26px;color:#274740}.detail-metrics span{font-size:13px;color:#68777b}@media(max-width:650px){.detail-metrics{grid-template-columns:repeat(2,1fr)}.org-heading{align-items:flex-start;flex-wrap:wrap}}</style>
