<template>
  <div>
    <h1 class="page-title">用户管理</h1>
    <div class="toolbar">
      <el-input v-model="q" placeholder="搜索 手机号/用户名/守望师名" clearable style="width:260px" @keyup.enter="load" />
      <el-select v-model="role" placeholder="角色" clearable style="width:140px" @change="load">
        <el-option v-for="r in roles" :key="r" :label="r" :value="r" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <el-button type="success" @click="openCreate">新建用户</el-button>
      <el-button @click="openInvites">🎟️ 邀请码</el-button>
      <span style="color:#909399">共 {{ total }} 人</span>
    </div>

    <el-table :data="users" v-loading="loading" border size="small">
      <el-table-column prop="id" label="ID" width="64" />
      <el-table-column prop="phone" label="手机号" width="130" />
      <el-table-column prop="username" label="用户名" width="120" />
      <el-table-column prop="guardian_name" label="守望师名" width="120" />
      <el-table-column prop="role" label="角色" width="100" />
      <el-table-column prop="enterprise_name" label="所属组织" />
      <el-table-column label="会员有效期" width="140">
        <template #default="{ row }">
          <span v-if="isExempt(row)" style="color:#909399">— 运营豁免</span>
          <el-tag v-else-if="row.enterprise_id" size="small" type="info">跟随组织</el-tag>
          <el-tag v-else size="small" :type="membershipTag(row.valid_until).type">{{ membershipTag(row.valid_until).text }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="270" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="!isExempt(row) && !row.enterprise_id" size="small" type="warning" @click="openValidity(row)">续期</el-button>
          <el-button size="small" @click="openDevices(row)">设备</el-button>
          <el-popconfirm title="确认删除该用户及其全部数据？" @confirm="remove(row)">
            <template #reference><el-button size="small" type="danger">删除</el-button></template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:16px" layout="prev, pager, next" :total="total"
      :page-size="limit" :current-page="page" @current-change="onPage" />

    <el-dialog v-model="dialog" :title="editing ? '编辑用户' : '新建用户'" width="460px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="手机号"><el-input v-model="form.phone" :disabled="editing" /></el-form-item>
        <el-form-item label="用户名"><el-input v-model="form.username" /></el-form-item>
        <el-form-item label="守望师名"><el-input v-model="form.guardianName" /></el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width:100%">
            <el-option v-for="r in roles" :key="r" :label="r" :value="r" />
          </el-select>
        </el-form-item>
        <el-form-item label="组织ID"><el-input v-model="form.enterpriseId" placeholder="独立用户留空" /></el-form-item>
        <template v-if="!editing && !form.enterpriseId">
          <el-form-item label="初始有效期">
            <el-radio-group v-model="form.validMode">
              <el-radio-button value="permanent">永久</el-radio-button>
              <el-radio-button value="date">指定</el-radio-button>
              <el-radio-button value="none">未开通</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.validMode === 'date'" label="到期日">
            <el-date-picker v-model="form.validDay" type="date" value-format="x" placeholder="选择到期日" style="width:100%" />
          </el-form-item>
        </template>
        <el-form-item :label="editing ? '重置密码' : '初始密码'">
          <el-input v-model="form.password" :placeholder="editing ? '留空不改' : '留空=手机号后6位'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 续期（仅独立用户）-->
    <ValidityEditor v-model:visible="validityDialog" :title="`续期 · ${validityTarget?.phone || ''}`"
      :current="validityTarget?.valid_until" :loading="savingValidity" @save="onSaveValidity" />

    <!-- 在线设备 -->
    <el-dialog v-model="deviceDialog" :title="`在线设备 · ${deviceTarget?.phone || ''}`" width="460px">
      <div v-loading="deviceLoading">
        <el-empty v-if="!deviceSessions.length" description="当前离线（无有效会话）" :image-size="60" />
        <div v-for="s in deviceSessions" :key="s.id" class="device-row">
          <div><b>设备</b>：{{ s.device_info || '未知设备' }}</div>
          <div><b>IP</b>：{{ s.ip || '-' }}</div>
          <div><b>最近活跃</b>：{{ fmt(s.last_seen_at) }}</div>
          <div><b>登录于</b>：{{ fmt(s.created_at) }}</div>
        </div>
      </div>
      <template #footer>
        <el-button @click="deviceDialog = false">关闭</el-button>
        <el-button type="danger" :disabled="!deviceSessions.length" :loading="revoking" @click="forceLogout">强制下线</el-button>
      </template>
    </el-dialog>

    <!-- 邀请码 -->
    <el-dialog v-model="inviteDialog" title="🎟️ 邀请码管理" width="760px">
      <el-form :inline="true" :model="inviteForm" class="invite-form">
        <el-form-item label="可用次数">
          <el-input-number v-model="inviteForm.maxUses" :min="1" :max="9999" />
        </el-form-item>
        <el-form-item label="有效期(天)">
          <el-input-number v-model="inviteForm.expiresInDays" :min="1" :max="365" />
        </el-form-item>
        <el-form-item label="组织ID">
          <el-input v-model="inviteForm.organizationId" placeholder="留空=通用码" style="width:140px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="inviteCreating" @click="genInvite">生成邀请码</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="invites" v-loading="inviteLoading" border size="small" max-height="380">
        <el-table-column label="邀请码" width="200">
          <template #default="{ row }">
            <span style="font-family:monospace;font-weight:600">{{ row.code }}</span>
            <el-button link type="primary" size="small" @click="copyCode(row.code)">复制</el-button>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.type === 'organization' ? 'warning' : 'info'">
              {{ row.type === 'organization' ? '组织' : '通用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="org_name" label="所属组织" width="120" />
        <el-table-column label="使用" width="80">
          <template #default="{ row }">{{ row.used_count || 0 }}/{{ row.max_uses }}</template>
        </el-table-column>
        <el-table-column label="有效期至" width="170">
          <template #default="{ row }">{{ fmt(row.expires_at) }}</template>
        </el-table-column>
        <el-table-column prop="creator_name" label="创建人" />
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { listUsers, createUser, updateUser, deleteUser, setUserValidity, getUserSessions, revokeUserSessions, listInviteCodes, createInviteCode } from '../api/admin'
import ValidityEditor from '../components/ValidityEditor.vue'
import { PERMANENT_UNTIL, endOfDay, membershipTag } from '../utils/membership'

const isExempt = (row) => row.role === 'boss' || row.role === 'operator'
const fmt = (ts) => ts ? new Date(Number(ts)).toLocaleString('zh-CN', { hour12: false }) : '-'

const roles = ['boss', 'operator', 'enterprise', 'watcher']
const users = ref([])
const total = ref(0)
const loading = ref(false)
const q = ref('')
const role = ref('')
const limit = 20
const page = ref(1)

const dialog = ref(false)
const editing = ref(false)
const saving = ref(false)
const editId = ref(null)
const form = reactive({ phone: '', username: '', guardianName: '', role: 'watcher', enterpriseId: '', password: '', validMode: 'permanent', validDay: null })

async function load() {
  loading.value = true
  try {
    const { data } = await listUsers({ q: q.value || undefined, role: role.value || undefined, limit, offset: (page.value - 1) * limit })
    users.value = data.users
    total.value = data.total
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '加载失败')
  } finally { loading.value = false }
}
function onPage(p) { page.value = p; load() }

function openCreate() {
  editing.value = false; editId.value = null
  Object.assign(form, { phone: '', username: '', guardianName: '', role: 'watcher', enterpriseId: '', password: '', validMode: 'permanent', validDay: null })
  dialog.value = true
}

function initialValidity() {
  if (form.validMode === 'permanent') return PERMANENT_UNTIL
  if (form.validMode === 'none') return null
  return form.validDay ? endOfDay(form.validDay) : PERMANENT_UNTIL
}
function openEdit(row) {
  editing.value = true; editId.value = row.id
  Object.assign(form, {
    phone: row.phone || '', username: row.username || '', guardianName: row.guardian_name || '',
    role: row.role || 'watcher', enterpriseId: row.enterprise_id || '', password: ''
  })
  dialog.value = true
}

async function save() {
  saving.value = true
  try {
    const body = {
      username: form.username || null, guardianName: form.guardianName || null,
      role: form.role, enterpriseId: form.enterpriseId || null
    }
    if (form.password) body.password = form.password
    if (editing.value) {
      await updateUser(editId.value, body)
    } else {
      const { data } = await createUser({ ...body, phone: form.phone || null })
      // 独立用户：按初始有效期开通（企业成员跟随组织，不单独设）
      if (!body.enterpriseId && data?.id) {
        const vu = initialValidity()
        if (vu != null) await setUserValidity(data.id, vu)
      }
    }
    ElMessage.success('已保存')
    dialog.value = false
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '保存失败')
  } finally { saving.value = false }
}

async function remove(row) {
  try {
    await deleteUser(row.id)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '删除失败')
  }
}

// 续期（仅独立用户）
const validityDialog = ref(false)
const validityTarget = ref(null)
const savingValidity = ref(false)
function openValidity(row) { validityTarget.value = row; validityDialog.value = true }
async function onSaveValidity(validUntil) {
  savingValidity.value = true
  try {
    await setUserValidity(validityTarget.value.id, validUntil)
    ElMessage.success('已更新会员有效期')
    validityDialog.value = false
    load()
  } catch (e) { ElMessage.error(e.response?.data?.error || '更新失败') }
  finally { savingValidity.value = false }
}

// 在线设备
const deviceDialog = ref(false)
const deviceTarget = ref(null)
const deviceSessions = ref([])
const deviceLoading = ref(false)
const revoking = ref(false)
async function openDevices(row) {
  deviceTarget.value = row; deviceSessions.value = []; deviceDialog.value = true; deviceLoading.value = true
  try { const { data } = await getUserSessions(row.id); deviceSessions.value = data.sessions || [] }
  catch (e) { ElMessage.error(e.response?.data?.error || '加载设备失败') }
  finally { deviceLoading.value = false }
}
async function forceLogout() {
  revoking.value = true
  try {
    await revokeUserSessions(deviceTarget.value.id)
    ElMessage.success('已强制下线')
    deviceSessions.value = []
  } catch (e) { ElMessage.error(e.response?.data?.error || '操作失败') }
  finally { revoking.value = false }
}

// 邀请码
const inviteDialog = ref(false)
const invites = ref([])
const inviteLoading = ref(false)
const inviteCreating = ref(false)
const inviteForm = reactive({ maxUses: 1, expiresInDays: 7, organizationId: '' })

async function openInvites() {
  inviteDialog.value = true
  await loadInvites()
}
async function loadInvites() {
  inviteLoading.value = true
  try { const { data } = await listInviteCodes(); invites.value = data.codes || [] }
  catch (e) { ElMessage.error(e.response?.data?.error || '加载邀请码失败') }
  finally { inviteLoading.value = false }
}
async function genInvite() {
  inviteCreating.value = true
  try {
    const { data } = await createInviteCode({
      maxUses: inviteForm.maxUses,
      expiresInDays: inviteForm.expiresInDays,
      organizationId: inviteForm.organizationId || null
    })
    ElMessage.success('已生成邀请码：' + data.code)
    await loadInvites()
  } catch (e) { ElMessage.error(e.response?.data?.error || '生成失败') }
  finally { inviteCreating.value = false }
}
async function copyCode(code) {
  try { await navigator.clipboard.writeText(code); ElMessage.success('已复制：' + code) }
  catch { ElMessage.warning('复制失败，请手动复制：' + code) }
}

onMounted(load)
</script>
