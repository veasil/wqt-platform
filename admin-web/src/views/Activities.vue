<template>
  <div>
    <h1 class="page-title">活动管理</h1>
    <div class="toolbar">
      <el-button type="primary" @click="load">刷新</el-button>
      <el-button type="success" @click="openCreate">新建活动</el-button>
      <span style="color:#909399">共 {{ activities.length }} 个活动 · 按「桌-活动场次」管理</span>
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
      <el-table-column prop="participant_count" label="参与人" width="80" align="center" />
      <el-table-column prop="avg_score" label="均分" width="80" align="center" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="statusTag(row.status).type">{{ statusTag(row.status).label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="280" fixed="right">
        <template #default="{ row }">
          <template v-if="row.status === 'pending_approval'">
            <el-button size="small" type="success" @click="setStatus(row, 'active')">通过</el-button>
            <el-button size="small" type="danger" @click="setStatus(row, 'rejected')">驳回</el-button>
          </template>
          <el-button size="small" @click="openSessions(row)">查看桌次</el-button>
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialog" :title="editing ? '编辑活动' : '新建活动'" width="460px">
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
        <el-form-item label="状态" v-if="editing">
          <el-select v-model="form.status" style="width:100%">
            <el-option label="进行中 active" value="active" />
            <el-option label="已结束 ended" value="ended" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="sessDrawer" :title="`桌次明细 · ${current?.name}（${current?.activity_code}）`" size="640px">
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
      <el-empty v-if="sessions.length === 0" description="该活动暂无桌次" />
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listActivities, createActivity, updateActivity, listActivitySessions } from '../api/admin'

const activities = ref([])
const loading = ref(false)
function fmt(ts) { return ts ? new Date(Number(ts)).toLocaleString('zh-CN', { hour12: false }) : '' }

const STATUS_MAP = {
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
const pendingCount = computed(() => activities.value.filter(a => a.status === 'pending_approval').length)

async function load() {
  loading.value = true
  try {
    const { data } = await listActivities()
    // 待审核置顶，方便运营优先处理
    activities.value = (data.activities || []).sort(
      (a, b) => (a.status === 'pending_approval' ? 0 : 1) - (b.status === 'pending_approval' ? 0 : 1)
    )
  }
  catch (e) { ElMessage.error(e.response?.data?.error || '加载失败') }
  finally { loading.value = false }
}

async function setStatus(row, status) {
  const word = status === 'active' ? '通过' : '驳回'
  try {
    await ElMessageBox.confirm(`确认${word}活动「${row.name}」？`, `${word}申请`, { type: 'warning' })
  } catch { return }
  try {
    await updateActivity(row.id, { status })
    ElMessage.success(`已${word}`); load()
  } catch (e) { ElMessage.error(e.response?.data?.error || '操作失败') }
}

const dialog = ref(false)
const editing = ref(false)
const saving = ref(false)
const editId = ref(null)
const form = reactive({ name: '', organizer: '', started_at: null, ended_at: null, status: 'active', category: 'general' })

function openCreate() {
  editing.value = false; editId.value = null
  Object.assign(form, { name: '', organizer: '', started_at: null, ended_at: null, status: 'active', category: 'general' })
  dialog.value = true
}
function openEdit(row) {
  editing.value = true; editId.value = row.id
  Object.assign(form, { name: row.name, organizer: row.organizer || '', started_at: row.started_at, ended_at: row.ended_at, status: row.status })
  dialog.value = true
}
async function save() {
  if (!form.name.trim()) return ElMessage.warning('请填写活动名称')
  saving.value = true
  try {
    const body = { name: form.name, organizer: form.organizer || null, started_at: form.started_at || null, ended_at: form.ended_at || null }
    if (editing.value) { body.status = form.status; await updateActivity(editId.value, body) }
    else { body.category = form.category; await createActivity(body) }
    ElMessage.success('已保存'); dialog.value = false; load()
  } catch (e) { ElMessage.error(e.response?.data?.error || '保存失败') }
  finally { saving.value = false }
}

const sessDrawer = ref(false)
const current = ref(null)
const sessions = ref([])
async function openSessions(row) {
  current.value = row; sessDrawer.value = true; sessions.value = []
  try { const { data } = await listActivitySessions(row.id); sessions.value = data.sessions }
  catch (e) { ElMessage.error(e.response?.data?.error || '加载桌次失败') }
}

onMounted(load)
</script>
