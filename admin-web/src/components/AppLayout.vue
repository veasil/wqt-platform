<template>
  <el-container style="min-height:100vh">
    <el-aside :width="isCollapsed ? '64px' : '220px'" style="transition:width .3s; background:#1f2d3d">
      <div style="padding:18px; text-align:center; color:#fff; font-size:16px; font-weight:600; white-space:nowrap; overflow:hidden">
        {{ isCollapsed ? 'W' : 'WQT 中台' }}
      </div>
      <el-menu :default-active="route.name" :collapse="isCollapsed"
        background-color="#1f2d3d" text-color="#bfcbd9" active-text-color="#409eff" router>
        <el-menu-item v-for="m in menus" :key="m.name" :index="m.name" :route="{ name: m.name }">
          <el-icon><component :is="m.icon" /></el-icon>
          <template #title>{{ m.title }}</template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header style="display:flex; align-items:center; justify-content:space-between; background:#fff; border-bottom:1px solid #e6e6e6; padding:0 20px">
        <el-button :icon="isCollapsed ? Expand : Fold" text @click="isCollapsed = !isCollapsed" />
        <div style="display:flex; align-items:center; gap:12px">
          <el-tag size="small" type="info">{{ auth.user?.role }}</el-tag>
          <span style="font-size:14px; color:#666">{{ auth.user?.guardianName || auth.user?.username || auth.user?.phone }}</span>
          <el-button text type="danger" @click="handleLogout">退出</el-button>
        </div>
      </el-header>
      <el-main style="background:#f5f7fa; padding:20px">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, markRaw } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import {
  Expand, Fold, DataAnalysis, User, OfficeBuilding, Postcard,
  Calendar, Folder, TrendCharts, Cpu, MagicStick, Setting
} from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const isCollapsed = ref(false)

const menus = [
  { name: 'Overview', title: '驾驶舱', icon: markRaw(DataAnalysis) },
  { name: 'Users', title: '用户管理', icon: markRaw(User) },
  { name: 'Organizations', title: '组织管理', icon: markRaw(OfficeBuilding) },
  { name: 'Cards', title: '卡牌管理', icon: markRaw(Postcard) },
  { name: 'Activities', title: '活动管理', icon: markRaw(Calendar) },
  { name: 'Downloads', title: '下载中心', icon: markRaw(Folder) },
  { name: 'Oss', title: 'OSS 文件', icon: markRaw(Folder) },
  { name: 'GameAnalysis', title: '游戏分析', icon: markRaw(TrendCharts) },
  { name: 'DataAudit', title: '数据审计', icon: markRaw(Cpu) },
  { name: 'ReviewTesting', title: '复盘测试', icon: markRaw(MagicStick) },
  { name: 'Settings', title: '系统设置', icon: markRaw(Setting) }
]

function handleLogout() {
  auth.logout()
  router.push({ name: 'Login' })
}
</script>
