<template>
  <div>
    <h1 class="page-title">活动管理</h1>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" style="margin-bottom:16px" />
    <el-alert v-if="pendingOperation" title="上一次活动操作结果未确认" type="warning" :closable="false"><el-button :loading="saving" @click="retry">重试原操作</el-button></el-alert>
    <el-alert v-if="notifications.length" title="新建活动通知" type="info" :closable="false" style="margin-bottom:16px">
      <div v-for="notice in notifications" :key="notice.activity_id" class="activity-notice">
        <span>{{ notice.name }} · {{ notice.organizer }} · {{ fmt(notice.created_at) }}</span>
        <el-button text :disabled="saving || !!pendingOperation" @click="acknowledge(notice.activity_id)">已知悉</el-button>
      </div>
    </el-alert>
    <div class="toolbar">
      <el-button type="primary" @click="load">刷新</el-button>
      <el-button type="success" :disabled="saving || !!pendingOperation" @click="openCreate">新建活动</el-button>
      <span v-if="loaded" style="color:#909399">共 {{ activities.length }} 个活动 · 按「桌-活动场次」管理</span>
      <el-tag v-if="pendingCount" type="warning" effect="dark">待审核申请 {{ pendingCount }}</el-tag>
    </div>

    <el-table :data="activities" v-loading="loading" border size="small">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="activity_code" label="活动码" width="150">
        <template #default="{ row }">
          <el-tag size="small" type="warning">{{ row.activity_code }}</el-tag>
          <span style="color:#909399;font-size:12px;margin-left:4px">{{ categoryLabel(row.activity_code) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="活动名称" min-width="160" />
      <el-table-column prop="organizer" label="组织方" width="130" />
      <el-table-column prop="table_count" label="桌数" width="70" align="center" />
      <el-table-column prop="participant_count" :label="auth.isAccountModel ? '参与账号':'参与人'" width="90" align="center" />
      <el-table-column prop="avg_score" label="均分" width="80" align="center" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="statusTag(row.status).type">{{ statusTag(row.status).label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="280" fixed="right">
        <template #default="{ row }">
          <template v-if="isPending(row)">
            <el-button size="small" type="success" :disabled="saving || !!pendingOperation" @click="setStatus(row, 'active')">通过</el-button>
            <el-button size="small" type="danger" :disabled="saving || !!pendingOperation" @click="setStatus(row, 'rejected')">驳回</el-button>
          </template>
          <el-button size="small" @click="openSessions(row)">查看桌次</el-button>
          <el-button size="small" :disabled="saving || !!pendingOperation" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status === 'active'" size="small" type="danger" :disabled="saving || !!pendingOperation" @click="setStatus(row, 'ended')">终止</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialog" :title="editing ? '编辑活动' : '新建活动'" width="min(460px,94vw)">
      <el-form :model="form" label-width="80px">
        <el-form-item label="活动名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="品类" v-if="!editing">
          <el-select v-model="form.category" style="width:100%">
            <el-option label="普通活动（G）" value="general" />
            <el-option label="测试活动（T）" value="test" />
            <el-option label="系列活动（S）" value="series" />
          </el-select>
          <div style="color:#909399;font-size:12px">企业级(E)/组织申请(A) 由对应入口自动生成</div>
        </el-form-item>
        <el-form-item label="组织方"><el-input v-model="form.organizer" /></el-form-item>
        <el-form-item label="开始"><el-date-picker v-model="form.started_at" type="datetime" value-format="x" style="width:100%" /></el-form-item>
        <el-form-item label="结束"><el-date-picker v-model="form.ended_at" type="datetime" value-format="x" style="width:100%" /></el-form-item>
        <template v-if="editing && form.configuration">
          <el-form-item label="卡牌组"><el-select v-model="form.configuration.cardGroupId"><el-option v-for="group in cardGroups" :key="group.id" :label="group.name" :value="group.id" /></el-select></el-form-item>
          <el-form-item label="模式"><el-input v-model="form.configuration.mode" /></el-form-item>
          <el-form-item label="时长(秒)"><el-input-number v-model="form.configuration.duration" :min="1" :max="10800" /></el-form-item>
          <el-form-item v-if="form.configuration.ageRange" label="参与年龄"><el-input-number v-model="form.configuration.ageRange.min" :min="0" :max="120" /> ～ <el-input-number v-model="form.configuration.ageRange.max" :min="0" :max="120" /></el-form-item>
          <el-form-item v-for="(phase,i) in ['启蒙期','成长期','青春期']" :key="phase" :label="phase+'卡数'"><el-input-number v-model="form.configuration.counts[i]" :min="0" :max="15" /></el-form-item>
        </template>
        <el-form-item label="状态" v-if="editing">
          <el-select v-model="form.status" style="width:100%">
            <el-option label="进行中 active" value="active" />
            <el-option label="已结束 ended" value="ended" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!!pendingOperation" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="sessDrawer" :title="`桌次明细 · ${current?.name}（${current?.activity_code}）`" size="min(640px,96vw)">
      <el-alert v-if="sessionError" :title="sessionError" type="error" :closable="false" />
      <el-table :data="sessions" size="small" border>
        <el-table-column prop="table_no" label="桌号" width="64" />
        <el-table-column prop="guardian_name" label="守望师" width="110" />
        <el-table-column prop="phone" label="手机号" width="120" />
        <el-table-column prop="game_mode" label="模式" width="90" />
        <el-table-column prop="final_score" label="得分" width="70" />
        <el-table-column label="时间" min-width="160">
          <template #default="{ row }">{{ fmt(row.started_at) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="sessionsLoaded && sessions.length === 0" description="该活动暂无桌次" />
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listActivities, createActivity, updateActivity, listActivitySessions, listCardGroups } from '../api/admin'
import api from '../api'
import {useAuthStore} from '../stores/auth'
import {createOperationClient} from '../utils/entitlements'

const activities = ref([])
const notifications=ref([]),cardGroups=ref([])
const loading = ref(false)
const error=ref(''),loaded=ref(false),auth=useAuthStore()
const client=createOperationClient({actor:{identityId:auth.user?.identityId,accountId:auth.user?.accountId},scope:'activities',storage:sessionStorage,
  post:async(path,body)=>(await (/\/\d+$/.test(path) ? api.put(path,body):api.post(path,body))).data})
const pendingOperation=ref(client.pending)
const isPending=row=>row.status===(auth.isAccountModel ? 'pending':'pending_approval')
async function write(id,body) {
  if(!auth.isAccountModel) return id==null ? createActivity(body):updateActivity(id,body)
  try {return await client.execute(id==null ? '/api/admin/activities':`/api/admin/activities/${id}`,body)}
  finally {pendingOperation.value=client.pending}
}
async function retry() {
  if(saving.value) return
  saving.value=true
  try {await client.retry();dialog.value=false;await load();ElMessage.success('活动操作已确认')}
  catch(e) {error.value=e.response?.data?.error || e.message}
  finally {pendingOperation.value=client.pending;saving.value=false}
}
async function acknowledge(id) {
  if(saving.value || pendingOperation.value)return
  saving.value=true
  try{await client.execute(`/api/admin/activities/${id}/acknowledge`,{});await load()}
  catch(e){error.value=e.response?.data?.error || e.message}
  finally{saving.value=false;pendingOperation.value=client.pending}
}
function fmt(ts) { return ts ? new Date(Number(ts)).toLocaleString('zh-CN', { hour12: false }) : '' }

const STATUS_MAP = {
  pending: {label:'待审核',type:'warning'},
  pending_approval: { label: '待审核', type: 'warning' },
  active: { label: '进行中', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
  ended: { label: '已结束', type: 'info' },
  archived: { label: '已归档', type: 'info' }
}
function statusTag(s) { return STATUS_MAP[s] || { label: s, type: 'info' } }

// 由活动码首字母反推品类（与后端 ACTIVITY_CATEGORY_PREFIX 对应；旧 ACT- 码归为 —）
const CATEGORY_BY_PREFIX = { T: '测试', S: '系列', E: '企业级', A: '组织申请', G: '普通' }
function categoryLabel(code) {
  if (!code || /^ACT-/i.test(code)) return ''
  return CATEGORY_BY_PREFIX[code[0]?.toUpperCase()] || ''
}
const pendingCount = computed(() => activities.value.filter(isPending).length)

async function load() {
  loading.value = true
  error.value='';loaded.value=false
  try {
    const { data } = await listActivities()
    // 待审核置顶，方便运营优先处理
    activities.value = (data.activities || []).sort(
      (a, b) => (isPending(a) ? 0 : 1) - (isPending(b) ? 0 : 1)
    )
    loaded.value=true
    if(auth.isAccountModel){
      notifications.value=(await api.get('/api/admin/activities/notifications')).data.notifications || []
      cardGroups.value=(await listCardGroups()).data.groups || []
    }
  }
  catch (e) { activities.value=[];error.value=e.response?.data?.error || '加载失败';ElMessage.error(error.value) }
  finally { loading.value = false }
}

async function setStatus(row, status) {
  if(saving.value || pendingOperation.value) return
  const word = status === 'active' ? '通过' : status === 'ended' ? '终止' : '驳回'
  try {
    await ElMessageBox.confirm(`确认${word}活动「${row.name}」？`, `${word}申请`, { type: 'warning' })
  } catch { return }
  try {
    saving.value=true
    await write(row.id, { status })
    ElMessage.success(`已${word}`); load()
  } catch (e) { error.value=e.response?.data?.error || e.message;ElMessage.error(error.value) }
  finally {saving.value=false}
}

const dialog = ref(false)
const editing = ref(false)
const saving = ref(false)
const editId = ref(null)
const form = reactive({ name: '', organizer: '', started_at: null, ended_at: null, status: 'active', category: 'general',configuration:null })

function openCreate() {
  editing.value = false; editId.value = null
  Object.assign(form, { name: '', organizer: '', started_at: null, ended_at: null, status: 'active', category: 'general',configuration:null })
  dialog.value = true
}
function openEdit(row) {
  editing.value = true; editId.value = row.id
  Object.assign(form, { name: row.name, organizer: row.organizer || '', started_at: row.started_at, ended_at: row.ended_at, status: row.status,configuration:row.game_config_json?JSON.parse(row.game_config_json):null })
  dialog.value = true
}
async function save() {
  if(saving.value) return
  if (!form.name.trim()) return ElMessage.warning('请填写活动名称')
  saving.value = true
  try {
    const body = { name: form.name, organizer: form.organizer || null, started_at: form.started_at || null, ended_at: form.ended_at || null }
    if (editing.value) { body.status = form.status;if(form.configuration)body.configuration=form.configuration; await write(editId.value, body) }
    else { body.category = form.category; await write(null, body) }
    ElMessage.success('已保存'); dialog.value = false; load()
  } catch (e) { ElMessage.error(e.response?.data?.error || '保存失败') }
  finally { saving.value = false }
}

const sessDrawer = ref(false)
const current = ref(null)
const sessions = ref([])
const sessionError=ref(''),sessionsLoaded=ref(false)
async function openSessions(row) {
  current.value = row; sessDrawer.value = true; sessions.value = []
  sessionError.value='';sessionsLoaded.value=false
  try { const { data } = await listActivitySessions(row.id); sessions.value = data.sessions;sessionsLoaded.value=true }
  catch (e) { sessionError.value=e.response?.data?.error || '加载桌次失败' }
}

onMounted(load)
</script>
