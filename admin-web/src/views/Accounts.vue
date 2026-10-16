<template>
  <div class="operations-workbench" v-loading="loading">
    <div class="workbench-heading"><div><p class="eyebrow">伍仟天 / 平台运营</p><h1 class="page-title">组织与权益</h1><p class="subtitle">看清组织、用户及每个守望者账号的当前权益。</p></div><div class="toolbar"><el-button @click="openOperations">操作记录</el-button><el-button @click="load">刷新数据</el-button></div></div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-alert v-if="pendingOperation" title="上一笔操作结果尚未确认，请先恢复原操作" type="warning" :closable="false" style="margin:16px 0"><el-button :loading="saving" @click="retryOperation">重试原操作</el-button></el-alert>
    <div class="delivery-summary" v-if="loaded">
      <div><strong>{{ stats.entitledOrganizations }}</strong><span>有权益组织</span><small>有效组织权益，不含免费组织</small></div>
      <div><strong>{{ stats.totalUsers }}</strong><span>用户人数</span><small>按用户去重</small></div>
      <div><strong>{{ stats.onlineUsers }}</strong><span>在线人数</span><small>当前登录会话有效</small></div>
    </div>
    <div class="toolbar workbench-filters"><el-input v-model="query" aria-label="搜索组织、地点、用户或手机号" placeholder="搜索组织、地点、用户或手机号" clearable style="max-width:380px" /><el-select v-model="levelFilter" aria-label="组织级别" placeholder="全部组织级别" clearable style="width:180px"><el-option v-for="(label,value) in organizationLevels" :key="value" :label="label" :value="value" /></el-select></div>
    <el-tabs v-model="activeTab">
      <el-tab-pane label="组织与权益" name="subscriptions">
        <div class="toolbar workbench-filters"><el-select v-model="entitlementFilter" aria-label="组织权益状态" style="width:180px"><el-option label="有效付费权益" value="entitled" /><el-option label="全部组织" value="" /><el-option label="无有效付费权益" value="not_entitled" /></el-select><el-button type="primary" :disabled="!!pendingOperation || saving" @click="openDelivery">新建组织权益</el-button><el-button :disabled="!loaded || loading || !filteredOrganizations.length" @click="exportOrganizations">导出组织 CSV</el-button><span>当前筛选 {{ filteredOrganizations.length }} 个组织；导出与列表一致。</span></div>
        <el-table v-if="loaded" :data="filteredOrganizations" stripe row-key="id">
          <el-table-column label="组织" min-width="170"><template #default="{row}"><el-button link type="primary" @click="router.push({name:'OrganizationDetail',params:{id:row.id}})">{{ row.id===0 ? '免费组织':row.name }}</el-button><div class="secondary">{{ row.location || '地点未填写' }}</div></template></el-table-column>
          <el-table-column label="级别" width="100"><template #default="{row}">{{ organizationLevels[row.plan] || '无付费级别' }}</template></el-table-column>
          <el-table-column label="当前组织权益" min-width="200"><template #default="{row}">{{ plans[row.plan]?.label || '免费权益' }}<div class="secondary">{{ row.subscription_until!=null ? `到期 ${formatTime(row.subscription_until)}`:'无组织付费权益' }}</div><el-tag v-if="row.subscription_id" :type="row.entitled ? 'success':'info'">{{ row.entitled ? '有效':'已到期或停用' }}</el-tag></template></el-table-column>
          <el-table-column label="守望者账号" width="130"><template #default="{row}">{{ row.bound_accounts }} 已绑定 / {{ row.current_members }} 个</template></el-table-column>
          <el-table-column prop="user_count" label="用户人数" width="95" /><el-table-column prop="online_users" label="在线人数" width="95" />
          <el-table-column label="剩余换绑" width="110"><template #default="{row}">{{ row.subscription_id ? `${Math.max(0,2-row.rebind_count)} / 2`:'不适用' }}</template></el-table-column>
          <el-table-column label="操作" min-width="290"><template #default="{row}"><el-button size="small" @click="router.push({name:'OrganizationDetail',params:{id:row.id}})">组织详情</el-button><el-button size="small" @click="showOrganization(row)">查看账号</el-button><el-button v-if="row.subscription_id" size="small" :disabled="saving || !!pendingOperation" @click="openRenewal(row)">续费一年</el-button><el-button size="small" @click="activeTab='invites';inviteOrganization=row.id">邀请码</el-button><el-button v-if="row.id!==0" size="small" :disabled="saving || !!pendingOperation" @click="changeStatus('organization',row)">{{ row.status==='active' ? '停用':'启用' }}</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="用户" name="identities">
        <div class="toolbar"><el-radio-group v-model="userFilter"><el-radio-button value="">全部用户</el-radio-button><el-radio-button v-for="category in categories" :key="category.value" :value="category.value">{{ category.label }}</el-radio-button></el-radio-group><el-button type="primary" :disabled="saving || !!pendingOperation" @click="identityDialog=true">新增用户</el-button><el-button :disabled="!loaded || loading || !filteredIdentities.length" @click="exportUsers">导出用户 CSV</el-button><span>当前筛选 {{ filteredIdentities.length }} 人（按用户去重）</span></div>
        <p class="secondary">汇总用户所有当前可用账号的权益，管理员标签可重叠；使用功能时按所选账号授权。</p>
        <el-table v-if="loaded" :data="filteredIdentities" stripe row-key="id">
          
          <el-table-column label="用户" min-width="140"><template #default="{row}"><strong>{{ row.guardian_name }}</strong><div class="secondary">{{ row.real_name }} · #{{ row.id }}</div></template></el-table-column><el-table-column prop="phone" label="手机号" min-width="130" />
          <el-table-column label="账号与权益汇总" min-width="280"><template #default="{row}"><el-tag v-for="tag in row.categories" :key="tag" size="small" style="margin:2px">{{ categoryLabel(tag) }}</el-tag><div class="secondary">{{ row.accounts.length }} 个账号 · {{ row.accounts.map(a=>a.organization_name).filter((n,i,arr)=>arr.indexOf(n)===i).join('、') }}</div><el-button v-if="row.accounts.length" link type="primary" class="view-user-accounts" @click="accountUser=row;userAccountsDialog=true">查看 {{ row.accounts.length }} 个账号</el-button><span v-else class="secondary">暂无绑定账号</span><div v-if="row.trial_until" class="secondary">体验 {{ row.trial_until>Date.now() ? '有效至':'已结束于' }} {{ formatTime(row.trial_until) }}</div></template></el-table-column>
          <el-table-column label="状态 / 会话" width="140"><template #default="{row}">{{ statusLabel(row.status) }}<div class="secondary">{{ row.online ? '在线（会话有效）':'离线' }}</div></template></el-table-column>
          <el-table-column label="操作" min-width="380"><template #default="{row}"><el-button size="small" @click="openProfile(row)">个人资料</el-button><el-button size="small" :disabled="!trialCandidates(row).length || row.trial_until>Date.now() || row.trial_granted_at>Number(row.trial_grant_consumed_at||0) || !!pendingOperation" @click="openTrial(row)">{{ row.trial_until>Date.now() ? '体验中':row.trial_granted_at>Number(row.trial_grant_consumed_at||0)?'体验待激活':'开通体验权益' }}</el-button><el-button size="small" @click="openPhone(row)">换手机号</el-button><el-button size="small" @click="sessionTarget=row;sessionDialog=true">在线会话</el-button><el-button size="small" :disabled="saving || !!pendingOperation" @click="changeStatus('identity',row)">{{ row.status==='active' ? '停用':'启用' }}</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="守望者账号" name="accounts">
        <div class="toolbar"><el-select v-model="organizationFilter" clearable placeholder="所有组织" style="width:260px"><el-option v-for="org in organizations" :key="org.id" :value="org.id" :label="org.id===0 ? '免费组织':org.name" /></el-select><span>账号属于组织，个人资料属于用户。通过“查看账号”了解用户的绑定与权益。</span></div>
        <AccountTable v-if="loaded" :accounts="filteredAccounts"><template #actions="{row}"><el-button size="small" :title="bindingRestriction(row)" :disabled="saving || !!pendingOperation || !canBind(row)" @click="openBinding(row)">{{ row.identity_id ? '换绑':'首次绑定' }}</el-button><el-button v-if="row.role==='watcher' && row.identity_id && !row.paid_valid" size="small" :disabled="row.trial_valid || row.trial_pending || !row.available || row.identity_status!=='active' || !!pendingOperation" @click="openTrialForAccount(row)">{{ row.trial_valid ? '体验中':row.trial_pending?'体验待激活':'开通体验权益' }}</el-button><el-button size="small" :disabled="saving || !!pendingOperation" @click="changeStatus('account',row)">{{ row.status==='active' ? '停用':'启用' }}</el-button></template></AccountTable>
      </el-tab-pane>
      <el-tab-pane label="邀请码" name="invites"><InvitePanel v-if="loaded && activeTab==='invites'" :key="inviteOrganization ?? 'all'" :organizations="organizations" :organization-id="inviteOrganization" /><el-button v-if="inviteOrganization!=null" text @click="inviteOrganization=null">查看全部组织邀请码</el-button></el-tab-pane>
    </el-tabs>
    <el-dialog v-model="userAccountsDialog" title="绑定的守望者账号" width="min(960px,94vw)"><p class="subtitle">{{ accountUser?.guardian_name }} · {{ accountUser?.phone }}</p><AccountTable v-if="accountUser" :accounts="accountUser.accounts" /></el-dialog>
    <el-dialog v-model="bindingDialog" :title="binding.account?.identity_id ? '账号交给另一人' : '首次绑定'" width="min(480px, 94vw)">
      <p>{{ binding.account?.name }}</p>
      <p v-if="binding.account?.identity_id">当前使用者：{{ binding.account.guardian_name }} · {{ binding.account.phone }}。换绑后旧使用者失去访问，新使用者可查看全部历史；账号角色、归属及期限保持。整份权益还剩 {{ Math.max(0,2-(organizationFor(binding.account)?.rebind_count || 0)) }} 次机会。</p>
      <p v-else>首次绑定不消耗权益换绑次数。</p>
      <el-select v-model="binding.identityId" filterable placeholder="选择已核验身份" style="width:100%">
        <el-option v-for="person in identities.filter(i=>i.status==='active' && i.id!==binding.account?.identity_id)" :key="person.id" :value="person.id" :label="`${person.guardian_name} · ${person.phone}`" />
      </el-select>
      <el-button text type="primary" @click="identityFromBinding=true;bindingDialog=false;identityDialog=true">核验并创建新使用者</el-button>
      <template #footer><el-button @click="bindingDialog=false">取消</el-button><el-button type="primary" :disabled="!binding.identityId || !!pendingOperation" :loading="saving" @click="submitBinding">确认绑定</el-button></template>
    </el-dialog>
    <el-dialog v-model="deliveryDialog" title="新建组织权益" width="min(480px, 94vw)">
      <el-form label-position="top">
        <el-form-item label="组织名称"><el-input v-model="delivery.organizationName" /></el-form-item>
        <el-form-item label="组织地点"><el-input v-model="delivery.location" placeholder="例如：广东省深圳市南山区" maxlength="200" /></el-form-item>
        <el-form-item label="组织权益"><el-select v-model="delivery.plan"><el-option label="个人合伙人 · 1个账号" value="personal" /><el-option label="团队合伙人 · 5个账号" value="group" /><el-option label="城市合伙人 · 20个账号" value="city" /></el-select></el-form-item>
        <el-form-item v-if="delivery.plan==='city'" label="首次到期时间"><el-date-picker v-model="delivery.until" type="datetime" /></el-form-item>
      </el-form>
      <div class="delivery-preview"><strong>一次交付完成</strong><p>新组织 → {{ plans[delivery.plan].label }}权益 → {{ plans[delivery.plan].count }}个守望者账号</p><p>交付后继续首次绑定使用者。</p><p>首次期限：{{ delivery.plan==='city' ? formatTime(delivery.until?.getTime()) : '交付日起一年' }}；终身换绑共两次。</p></div>
      <template #footer><el-button @click="deliveryDialog=false">取消</el-button><el-button type="primary" :disabled="!delivery.organizationName.trim() || (delivery.plan==='city' && (!delivery.until || delivery.until.getTime()<=Date.now())) || !!pendingOperation" :loading="saving" @click="submitDelivery">交付组织与账号</el-button></template>
    </el-dialog>
    <el-dialog v-model="identityDialog" title="新增用户" width="min(480px, 94vw)" @closed="clearPerson">
      <p v-if="identityFromBinding">先核验并创建这个人，再确认绑定到 {{ binding.account?.name }}。创建身份成功不代表账号已绑定。</p>
      <el-form label-position="top">
        <el-form-item label="手机号"><el-input v-model="person.phone" /></el-form-item>
        <el-form-item label="真实姓名"><el-input v-model="person.realName" /></el-form-item>
        <el-form-item label="守望师名"><el-input v-model="person.guardianName" /></el-form-item>
        <el-form-item label="初始密码"><el-input v-model="person.password" type="password" show-password /></el-form-item>
        <el-form-item label="本人核验说明"><el-input v-model="person.verificationNote" type="textarea" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="identityDialog=false">取消</el-button><el-button type="primary" :disabled="!person.phone.trim() || !person.realName.trim() || !person.guardianName.trim() || person.password.length<6 || !person.verificationNote.trim() || !!pendingOperation" :loading="saving" @click="submitPerson">确认创建</el-button></template>
    </el-dialog>
    <el-dialog v-model="phoneDialog" title="同一人换手机号" width="min(480px, 94vw)" @closed="phone.smsCode=''">
      <p>保留身份、认证、等级与全部绑定，不扣换绑次数。完成后该人需重新登录。</p>
      <el-form label-position="top">
        <el-form-item label="新手机号"><el-input v-model="phone.newPhone" /></el-form-item>
        <el-form-item label="新号码短信验证码"><el-input v-model="phone.smsCode" /><el-button :loading="sending" :disabled="countdown>0" @click="sendCode">{{ countdown>0 ? `${countdown}秒后重发` : '发送验证码' }}</el-button></el-form-item>
        <el-form-item label="本人核验说明"><el-input v-model="phone.verificationNote" type="textarea" placeholder="填写本人核验依据；旧号丢失也需明确记录" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="phoneDialog=false">取消</el-button><el-button type="primary" :disabled="!phone.newPhone.trim() || !phone.smsCode.trim() || !phone.verificationNote.trim() || !!pendingOperation" :loading="saving" @click="submitPhone">确认核验与换号</el-button></template>
    </el-dialog>
    <el-dialog v-model="renewalDialog" title="续费一年" width="min(520px,94vw)">
      <div class="delivery-preview" v-if="renewal"><strong>{{ renewal.name }} · {{ plans[renewal.plan]?.label }}</strong><p>原到期：{{ formatTime(renewal.subscription_until) }}</p><p>预计续费后：{{ formatTime(renewalPreview) }}</p><p>从原到期日与当前时间较晚者增加一年。账号与历史保持，已用 {{ renewal.rebind_count }}/2 次换绑不重置。最终到期时间以服务器提交结果为准。</p></div>
      <template #footer><el-button @click="renewalDialog=false">取消</el-button><el-button type="primary" :disabled="!!pendingOperation" :loading="saving" @click="submitRenewal">确认续费一年</el-button></template>
    </el-dialog>
    <el-dialog v-model="receiptDialog" title="交付已完成" width="min(600px,94vw)"><template v-if="receipt"><p>组织 #{{ receipt.organizationId }} · 权益 #{{ receipt.subscriptionId }}</p><p>已生成 {{ receipt.accountIds.length }} 个账号，到期 {{ formatTime(receipt.validUntil) }}</p><p>账号编号：{{ receipt.accountIds.join('、') }}</p><el-button type="primary" @click="receiptDialog=false;showOrganization({id:receipt.organizationId})">继续绑定使用者</el-button></template></el-dialog>
    <el-dialog v-model="trialDialog" title="开通体验权益" width="min(500px,94vw)"><p>{{ trialTarget?.guardian_name }}：平台开通后由用户自行激活，从激活时刻起连续30天；体验开局仍需有效活动码。</p><el-form label-position="top"><el-form-item label="免费守望者账号"><el-select v-model="trial.accountId" style="width:100%"><el-option v-for="account in trialOptions" :key="account.id" :value="account.id" :label="`${account.organization_name} · ${account.name}`" /></el-select></el-form-item><el-form-item label="开启原因"><el-input v-model="trial.reason" type="textarea" /></el-form-item></el-form><template #footer><el-button @click="trialDialog=false">取消</el-button><el-button type="primary" :disabled="!trial.accountId || !trial.reason.trim() || !!pendingOperation" :loading="saving" @click="submitTrial">开通体验权益</el-button></template></el-dialog>
    <el-dialog v-model="profileDialog" title="用户个人资料" width="min(500px,94vw)"><el-form label-position="top"><el-form-item label="真实姓名"><el-input v-model="profile.realName" /></el-form-item><el-form-item label="守望师名"><el-input v-model="profile.guardianName" /></el-form-item></el-form><p class="secondary">资料属于用户，修改后在其所有账号中保持一致；手机号通过独立核验流程修改。</p><template #footer><el-button @click="profileDialog=false">取消</el-button><el-button type="primary" :disabled="!!pendingOperation" :loading="saving" @click="submitProfile">保存资料</el-button></template></el-dialog>
    <el-dialog v-model="sessionDialog" title="用户在线会话" width="min(520px,94vw)"><template v-if="sessionTarget"><p>{{ sessionTarget.guardian_name }} · {{ sessionTarget.phone }}</p><p>{{ sessionTarget.online ? '当前登录会话有效':'当前没有有效登录会话' }}</p><p v-if="sessionTarget.session">登录 {{ formatTime(sessionTarget.session.createdAt) }}，有效至 {{ formatTime(sessionTarget.session.expiresAt) }}</p><p class="secondary">在线人数按有效登录会话统计，不表示此刻正在操作页面。</p><el-button type="danger" :disabled="!sessionTarget.online || !!pendingOperation" :loading="saving" @click="forceLogout">强制下线</el-button></template></el-dialog>
    <el-drawer v-model="operationsDialog" title="操作记录" size="min(800px,96vw)"><el-alert v-if="operationsError" :title="operationsError" type="error" :closable="false" /><el-table :data="operations" stripe><el-table-column prop="operation" label="操作" min-width="140" /><el-table-column prop="actor_identity_id" label="操作者用户" /><el-table-column prop="actor_account_id" label="执行账号" /><el-table-column prop="target_account_id" label="目标账号" /><el-table-column label="时间" min-width="180"><template #default="{row}">{{ formatTime(row.created_at) }}</template></el-table-column></el-table></el-drawer>
  </div>
</template>

<script setup>
import {ref,reactive,computed,onMounted,onBeforeUnmount} from 'vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import api from '../api'
import {sendSmsCode} from '../api/auth'
import {useAuthStore} from '../stores/auth'
import {useRouter} from 'vue-router'
import AccountTable from '../components/AccountTable.vue'
import InvitePanel from '../components/InvitePanel.vue'
import {plans,formatTime,renewalUntil,createOperationClient} from '../utils/entitlements'
import {organizationLevels,filterOrganizations,filterUsers,organizationsCsv,usersCsv,downloadCsv} from '../utils/operations-export.mjs'

const loading=ref(false),saving=ref(false),sending=ref(false),error=ref('')
const accounts=ref([]),identities=ref([]),organizations=ref([])
const auth=useAuthStore()
const router=useRouter(),stats=ref({}),userFilter=ref(''),inviteOrganization=ref(null)
const categories=[{value:'free',label:'免费用户'},{value:'trial',label:'体验中用户'},{value:'entitled',label:'有权益用户'},{value:'organization_admin',label:'组织管理员'},{value:'platform_admin',label:'平台管理员'}]
const categoryLabel=value=>categories.find(c=>c.value===value)?.label || value
const trialDialog=ref(false),trialTarget=ref(null),trialOptions=ref([]),trial=reactive({accountId:null,reason:'平台开启30天体验'})
const profileDialog=ref(false),profile=reactive({identityId:null,guardianName:'',realName:''}),sessionDialog=ref(false),sessionTarget=ref(null)
const accountUser=ref(null),userAccountsDialog=ref(false)
const operationsDialog=ref(false),operationsError=ref('')
const levelFilter=ref(''),entitlementFilter=ref('entitled')
const operations=ref([]),loaded=ref(false),query=ref(''),activeTab=ref('subscriptions'),organizationFilter=ref(null)
const receipt=ref(null),receiptDialog=ref(false),renewal=ref(null),renewalDialog=ref(false),renewalPreview=ref(null)
const client=createOperationClient({post:async(path,body)=>(await api.post(path,body)).data,storage:sessionStorage,actor:{identityId:auth.user?.identityId,accountId:auth.user?.accountId}})
const pendingOperation=ref(client.pending)
const identityFromBinding=ref(false)
const matches=row=>JSON.stringify(row).toLowerCase().includes(query.value.trim().toLowerCase())
const filteredOrganizations=computed(()=>filterOrganizations(organizations.value,{query:query.value,level:levelFilter.value,entitlement:entitlementFilter.value}))
const filteredIdentities=computed(()=>filterUsers(identities.value,{query:query.value,level:levelFilter.value,category:userFilter.value}))
function exportOrganizations() {downloadCsv('组织.csv',organizationsCsv(filteredOrganizations.value));ElMessage.success(`已导出 ${filteredOrganizations.value.length} 个组织`)}
function exportUsers() {downloadCsv('用户.csv',usersCsv(filteredIdentities.value));ElMessage.success(`已导出 ${filteredIdentities.value.length} 位用户`)}
const organizationFor=account=>organizations.value.find(o=>o.id===account?.organization_id)
const roleLabel=role=>({watcher:'普通账号',enterprise:'组织管理员',boss:'平台管理员',operator:'运营（保留）'}[role] || role)
const statusLabel=status=>status==='active' ? '正常':'已停用'
function bindingRestriction(account) {
  if(['boss','operator','enterprise'].includes(account.role)) return '管理员账号绑定需受控处理，本页暂不开放'
  if(account.status!=='active' || organizationFor(account)?.status!=='active') return '账号或组织已停用'
  if(account.identity_id && !account.subscription_id) return '非商业账号换绑规则暂未开放'
  if(account.identity_id && organizationFor(account)?.rebind_count>=2) return '整份权益两次换绑已用完'
  return ''
}
const filteredAccounts=computed(()=>accounts.value.filter(a=>(!levelFilter.value || a.plan===levelFilter.value) && (organizationFilter.value==null || a.organization_id===organizationFilter.value) && matches({...a,organization_name:organizationFor(a)?.name})))
const canBind=account=>account.status==='active' && organizationFor(account)?.status==='active' && !['boss','operator','enterprise'].includes(account.role) && (!account.identity_id || (account.subscription_id && organizationFor(account)?.rebind_count<2))
function showOrganization(org) {organizationFilter.value=org.id;levelFilter.value='';query.value='';activeTab.value='accounts'}
function openDelivery() {Object.assign(delivery,{organizationName:'',location:'',plan:'personal',until:null});deliveryDialog.value=true}
function openRenewal(org) {renewal.value=org;renewalPreview.value=renewalUntil(org.subscription_until);renewalDialog.value=true}
const bindingDialog=ref(false),deliveryDialog=ref(false),identityDialog=ref(false),phoneDialog=ref(false)
const binding=reactive({account:null,identityId:null})
const delivery=reactive({organizationName:'',location:'',plan:'personal',until:null})
const person=reactive({phone:'',realName:'',guardianName:'',password:'',verificationNote:''})
const phone=reactive({identityId:null,newPhone:'',smsCode:'',verificationNote:''})
const countdown=ref(0)
let timer

async function load() {
  loading.value=true
  error.value=''
  try {
    const {data}=await api.get('/api/admin/operations-snapshot')
    accounts.value=data.accounts;identities.value=data.users;organizations.value=data.organizations;stats.value=data.stats;loaded.value=true
  } catch(e) {accounts.value=[];identities.value=[];organizations.value=[];operations.value=[];loaded.value=false;error.value=e.response?.data?.error || e.message}
  finally {loading.value=false}
}
async function openOperations() {
  operationsDialog.value=true;operationsError.value=''
  try {const {data}=await api.get('/api/admin/account-operations');operations.value=data.operations}
  catch(e) {operations.value=[];operationsError.value=e.response?.data?.error || e.message}
}
const trialCandidates=user=>user.status==='active' ? user.accounts.filter(a=>a.role==='watcher' && a.available && !a.paid_valid):[]
function openTrial(user) {trialTarget.value=user;trialOptions.value=trialCandidates(user);trial.accountId=trialOptions.value[0]?.id ?? null;trialDialog.value=true}
function openTrialForAccount(account) {const user=identities.value.find(u=>u.id===account.identity_id);if(user) {openTrial(user);trial.accountId=account.id}}
const submitTrial=()=>save(async()=>{await mutate('/api/admin/trials/activate',{...trial});trialDialog.value=false;return '已开通体验权益，等待用户激活'})
function openProfile(user) {Object.assign(profile,{identityId:user.id,guardianName:user.guardian_name || '',realName:user.real_name || ''});profileDialog.value=true}
const submitProfile=()=>save(async()=>{await mutate('/api/admin/identities/update-profile',{...profile});profileDialog.value=false})
async function forceLogout() {
  try {await ElMessageBox.confirm('将结束此用户当前登录会话，其需要重新登录。','强制下线');await save(async()=>{await mutate('/api/admin/identities/revoke-session',{identityId:sessionTarget.value.id});sessionDialog.value=false})}
  catch(e) {if(!['cancel','close'].includes(e)) error.value=e.message}
}
async function mutate(path,body) {
  try {return await client.execute(path,body)}
  finally {pendingOperation.value=client.pending}
}
async function save(action) {
  if(saving.value) return
  saving.value=true;error.value=''
  try {const message=await action();ElMessage.success(typeof message==='string' ? message:'操作已完成');await load()}
  catch(e) {error.value=e.response?.data?.error || e.message;ElMessage.error(error.value)}
  finally {saving.value=false}
}
function openBinding(account) {binding.account=account;binding.identityId=null;bindingDialog.value=true}
function openPhone(identity) {Object.assign(phone,{identityId:identity.id,newPhone:'',smsCode:'',verificationNote:''});phoneDialog.value=true}
function clearPerson() {
  person.password=''
  if(!pendingOperation.value) Object.assign(person,{phone:'',realName:'',guardianName:'',verificationNote:''})
  identityFromBinding.value=false
}
const submitBinding=()=>save(async()=>{await mutate('/api/admin/account-bindings',{accountId:binding.account.id,identityId:binding.identityId});bindingDialog.value=false})
const submitDelivery=()=>save(async()=>{receipt.value=await mutate('/api/admin/subscriptions',{organizationName:delivery.organizationName.trim(),...(delivery.location.trim() ? {location:delivery.location.trim()}:{}),plan:delivery.plan,...(delivery.plan==='city' ? {validUntil:delivery.until?.getTime()}: {})});deliveryDialog.value=false;receiptDialog.value=true})
const submitPerson=()=>save(async()=>{
  const result=await mutate('/api/admin/identities',{...person})
  if(identityFromBinding.value) {binding.identityId=result.identityId;bindingDialog.value=true}
  identityDialog.value=false;person.password=''
})
const submitPhone=()=>save(async()=>{await mutate('/api/admin/identities/change-phone',{...phone});phoneDialog.value=false;phone.smsCode=''})
const submitRenewal=()=>save(async()=>{
  const result=await mutate('/api/admin/subscriptions/renew',{subscriptionId:renewal.value.subscription_id})
  renewalDialog.value=false;return `已续费至 ${formatTime(result.validUntil)}`
})
async function retryOperation() {
  const path=client.pending?.path
  await save(async()=>{
    const result=await client.retry();pendingOperation.value=client.pending
    if(path==='/api/admin/subscriptions') {receipt.value=result;receiptDialog.value=true}
    bindingDialog.value=false;deliveryDialog.value=false;renewalDialog.value=false;identityDialog.value=false;phoneDialog.value=false
    trialDialog.value=false;profileDialog.value=false;sessionDialog.value=false
    person.password='';phone.smsCode=''
  })
  pendingOperation.value=client.pending
}
async function changeStatus(type,row) {
  try {
    const effects={identity:'影响此人的全部绑定账号，撤销其登录凭据。',account:'仅影响这个业务账号，不停用此人的其他账号。',organization:'影响本组织所有账号，不影响其他组织。'}
    const {value}=await ElMessageBox.prompt(`${effects[type]} 请填写审计原因。`,'确认状态变更',{inputValidator:value=>!!value?.trim() || '原因不能为空'})
    await save(()=>mutate('/api/admin/status',{type,id:row.id,status:row.status==='active' ? 'suspended':'active',reason:value}))
  } catch(e) {if(e!=='cancel' && e!=='close') error.value=e.message}
}
async function sendCode() {
  sending.value=true
  try {const {data}=await sendSmsCode(phone.newPhone);ElMessage.success(data.mockCode ? `测试验证码：${data.mockCode}`:'验证码已发送');countdown.value=60;clearInterval(timer);timer=setInterval(()=>{if(--countdown.value<=0) clearInterval(timer)},1000)}
  catch(e) {ElMessage.error(e.response?.data?.error || e.message)}
  finally {sending.value=false}
}
onBeforeUnmount(()=>clearInterval(timer))
onMounted(load)
</script>
<style scoped>
.operations-workbench{--el-color-primary:#367467;--el-color-primary-light-3:#719e93;--el-color-primary-light-5:#a0beb7;--el-color-primary-light-9:#eff6f3}
.operations-workbench :deep(.el-tabs__nav-wrap::after){height:1px;background:#e2e8eb}
.operations-workbench :deep(.el-tabs__item){font-size:14px;height:52px;color:#7b8b92}.operations-workbench :deep(.el-tabs__item.is-active){color:#285f53;font-weight:600}
.operations-workbench :deep(.el-table){border:1px solid #e6ebed;border-radius:12px;--el-table-header-bg-color:#f8fafb;--el-table-row-hover-bg-color:#f4f8f6;--el-table-border-color:#edf1f3}
.operations-workbench :deep(.el-table th.el-table__cell){height:48px;font-size:12px;font-weight:500;color:#819097}
.operations-workbench :deep(.el-table td.el-table__cell){padding:16px 0;color:#415663}
.operations-workbench :deep(.el-table .el-button--small){border-radius:6px;margin:3px 4px 3px 0;font-weight:400}
.operations-workbench :deep(.el-dialog){border-radius:16px;padding:26px}.operations-workbench :deep(.el-dialog__title){font-size:19px;font-weight:600;color:#29404b}
.operations-workbench :deep(.el-radio-button__inner){padding:10px 14px;font-size:12px}.operations-workbench :deep(.el-input__wrapper){border-radius:8px;min-height:38px}
.view-user-accounts{font-size:12px;margin:5px 0}

.workbench-filters{flex-wrap:wrap;gap:12px}.workbench-filters .el-select{max-width:100%}
.workbench-heading {display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px;}
.eyebrow {font-size:11px;letter-spacing:2px;color:#618076;margin:0 0 10px;} .page-title {font-size:27px;color:#263b40;margin-bottom:8px;}
.subtitle {color:#66777c;font-size:14px;margin:0;line-height:1.7;}
.delivery-summary {display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0;}
.delivery-summary>div {display:flex;flex-direction:column;gap:8px;background:#fff;border:1px solid #e6ebed;padding:22px 26px;border-radius:12px;}
.delivery-summary strong {font-size:34px;font-weight:600;letter-spacing:-1px;color:#263b40;font-variant-numeric:tabular-nums;} .delivery-summary span,.toolbar span {font-size:13px;color:#65767b;}
.secondary,.delivery-summary small{font-size:12px;color:#7b898d;line-height:1.8}
.delivery-preview {background:#f0f7f5;border-left:3px solid #318a7b;border-radius:4px;padding:16px;margin-top:16px;color:#294d45;line-height:1.7;}
.delivery-preview p {font-size:14px;margin:8px 0 0;}
@media(max-width:700px) {.delivery-summary {grid-template-columns:repeat(2,1fr)} .workbench-heading {align-items:flex-start;} }
</style>
