<template>
  <div>
    <h1 class="page-title">驾驶舱</h1>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" style="margin-bottom:16px" />
    <el-row :gutter="16" v-loading="loading">
      <template v-if="auth.isAccountModel"><el-col :xs="24" :sm="8"><stat-card title="有权益组织" :value="d.entitledOrganizations" color="#318a7b" /></el-col><el-col :xs="24" :sm="8"><stat-card title="用户人数" :value="d.totalUsers" color="#409eff" /></el-col><el-col :xs="24" :sm="8"><stat-card title="在线人数（有效登录会话）" :value="d.onlineUsers" color="#67c23a" /></el-col></template>
      <template v-else><el-col :span="6"><stat-card title="用户总数" :value="d.totalUsers" color="#409eff" /></el-col><el-col :span="6"><stat-card title="近14天新增用户" :value="recentSignups" color="#318a7b" /></el-col><el-col :span="6"><stat-card title="组织数" :value="d.totalOrgs" color="#67c23a" /></el-col><el-col :span="6"><stat-card title="对局总数" :value="d.totalSessions" color="#e6a23c" /></el-col></template>
    </el-row>

    <el-row :gutter="16" style="margin-top:16px">
      <el-col :span="12">
        <el-card :header="auth.isAccountModel ? '业务账号角色分布':'用户角色分布'">
          <el-table :data="d.usersByRole" size="small">
            <el-table-column prop="role" label="角色" />
            <el-table-column prop="c" label="数量" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card header="对局状态分布">
          <el-table :data="d.sessionsByStatus" size="small">
            <el-table-column prop="status" label="状态" />
            <el-table-column prop="c" label="数量" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-card header="近 14 天对局趋势" style="margin-top:16px">
      <el-table :data="d.dailySessions" size="small" max-height="260">
        <el-table-column prop="d" label="日期" />
        <el-table-column prop="c" label="对局数" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, h } from 'vue'
import { ElMessage } from 'element-plus'
import { getOverview } from '../api/admin'
import {useAuthStore} from '../stores/auth'

const loading = ref(false)
const error = ref('')
const auth=useAuthStore()
const d = reactive({
  totalUsers: null, totalAccounts: null, totalOrgs: null, totalSessions: null,entitledOrganizations:null,onlineUsers:null,
  usersByRole: [], sessionsByStatus: [], dailySignups: [], dailySessions: []
})
const recentSignups=computed(()=>d.totalUsers==null ? null:d.dailySignups.reduce((sum,row)=>sum+Number(row.c),0))

const StatCard = {
  props: ['title', 'value', 'color'],
  render() {
    return h('div', { style: `background:#fff;border-radius:8px;padding:20px;border-left:4px solid ${this.color}` }, [
      h('div', { style: 'color:#909399;font-size:13px' }, this.title),
      h('div', { style: 'font-size:28px;font-weight:700;margin-top:8px' }, String(this.value ?? '—'))
    ])
  }
}

onMounted(async () => {
  loading.value = true
  try {
    const { data } = await getOverview()
    Object.assign(d, data)
  } catch (e) {
    error.value=e.response?.data?.error || '加载失败，计数暂不可用'
    ElMessage.error(e.response?.data?.error || '加载失败')
  } finally { loading.value = false }
})
</script>
