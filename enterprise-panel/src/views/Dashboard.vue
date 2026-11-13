<template>
  <div v-loading="loading">
    <h3 style="margin-bottom:20px">驾驶舱</h3>

    <el-card v-if="org" shadow="hover" style="margin-bottom:20px"
      :body-style="{ display:'flex', alignItems:'center', gap:'16px', flexWrap:'wrap' }">
      <span style="font-weight:600">会员状态</span>
      <el-tag :type="badge.type" size="large">{{ badge.text }}</el-tag>
      <el-tag type="info" effect="plain">成员 {{ org.currentMembers }} / {{ org.maxMembers }}</el-tag>
      <span v-if="badge.days != null && badge.days >= 0 && badge.days <= 7" style="color:#e6a23c">
        ⚠ 会员将于 {{ badge.days }} 天后到期，请联系平台客服续费；到期后保留登录与历史查看，无法新开局。
      </span>
    </el-card>

    <el-row :gutter="20" style="margin-bottom:20px">
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="总成员数" :value="data.totalMembers" />
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="近30天活跃" :value="data.activeMembers" />
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="总场次" :value="data.totalSessions" />
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="平均分" :value="data.avgScore || 0" />
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="hover">
      <template #header>近期场次</template>
      <el-table :data="data.recentSessions" stripe size="small" empty-text="暂无数据">
        <el-table-column prop="guardian_name" label="守望师" width="120" />
        <el-table-column label="开始时间" width="180">
          <template #default="{ row }">{{ formatDate(row.started_at) }}</template>
        </el-table-column>
        <el-table-column prop="game_mode" label="模式" width="100" />
        <el-table-column prop="final_score" label="得分" width="80" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { getDashboard, getOrgInfo } from '../api/dashboard'
import { formatDate, membershipBadge } from '../utils/format'

const loading = ref(false)
const data = ref({ totalMembers: 0, activeMembers: 0, totalSessions: 0, avgScore: 0, recentSessions: [] })
const org = ref(null)
const badge = computed(() => membershipBadge(org.value?.validUntil))

onMounted(async () => {
  loading.value = true
  try {
    const [dash, info] = await Promise.all([getDashboard(), getOrgInfo()])
    data.value = dash.data
    org.value = info.data.organization
  } catch { /* empty */ }
  loading.value = false
})
</script>
