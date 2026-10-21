<template>
  <el-container class="platform-layout" style="min-height:100vh">
    <el-aside v-if="!mobile" :width="isCollapsed ? '64px' : '220px'" style="transition:width .3s; background:#1f2d3d">
      <div style="padding:18px; text-align:center; color:#fff; font-size:16px; font-weight:600; white-space:nowrap; overflow:hidden">
        {{ isCollapsed ? '伍' : '伍仟天平台管理' }}
      </div>
      <el-menu :default-active="route.name" :collapse="isCollapsed"
        background-color="#1f2d3d" text-color="#bfcbd9" active-text-color="#aed4c8" router>
        <el-menu-item v-for="m in menus" :key="m.name" :index="m.name" :route="{ name: m.name }">
          <el-icon><component :is="m.icon" /></el-icon>
          <template #title>{{ m.title }}</template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header style="display:flex; align-items:center; justify-content:space-between; background:#fff; border-bottom:1px solid #e6e6e6; padding:0 20px">
        <el-button :icon="mobile || isCollapsed ? Expand : Fold" :aria-label="mobile ? '打开导航':(isCollapsed ? '展开导航':'收起导航')" text @click="mobile ? mobileNav=true:isCollapsed=!isCollapsed" />
        <div class="context-bar" style="display:flex; align-items:center; gap:12px">
          <span v-if="auth.isAccountModel" class="account-context">{{ auth.currentAccount?.organization_name }} · {{ auth.currentAccount?.name || `账号 #${auth.user?.accountId}` }}</span>
          <el-badge v-if="activityNotices" :value="activityNotices"><el-button text @click="router.push({name:'Activities'})">新活动通知</el-button></el-badge>
          <el-tag size="small" type="info">{{ auth.user?.role==='boss' ? '平台管理员':(!auth.isAccountModel && auth.user?.role==='operator' ? '运营':'权限不足') }}</el-tag>
          <span style="font-size:14px; color:#666">{{ auth.user?.guardianName || auth.user?.username || auth.user?.phone }}</span>
          <el-button v-if="auth.user?.accountId" text @click="router.push({name:'SelectAccount'})">切换账号</el-button>
          <el-button text type="danger" @click="handleLogout">退出</el-button>
        </div>
      </el-header>
      <el-main style="background:#f5f7fa; padding:20px">
        <router-view :key="`${auth.contextVersion}:${route.fullPath}`" />
      </el-main>
    </el-container>
    <el-drawer v-model="mobileNav" title="伍仟天平台管理" direction="ltr" size="min(280px,85vw)">
      <el-menu :default-active="route.name" router>
        <el-menu-item v-for="m in menus" :key="m.name" :index="m.name" :route="{name:m.name}" @click="mobileNav=false">
          <el-icon><component :is="m.icon" /></el-icon><span>{{ m.title }}</span>
        </el-menu-item>
      </el-menu>
    </el-drawer>
  </el-container>
</template>

<script setup>
import { ref, markRaw, computed, onBeforeUnmount, onMounted, watch } from 'vue'
import api from '../api'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import {ElMessage} from 'element-plus'
import {
  Expand, Fold, DataAnalysis, User, OfficeBuilding, Postcard,
  Calendar, Folder, Setting
} from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const activityNotices=ref(0)
let noticeTimer
async function refreshActivityNotices(){
  if(!auth.isAccountModel || auth.user?.role!=='boss'){activityNotices.value=0;return}
  try{activityNotices.value=((await api.get('/api/admin/activities/notifications')).data.notifications||[]).length}catch{/* Retry on the next refresh; the durable notice remains unread. */}
}
onMounted(()=>{refreshActivityNotices();noticeTimer=setInterval(refreshActivityNotices,30000)})
watch(()=>[route.fullPath,auth.contextVersion],refreshActivityNotices)
onBeforeUnmount(()=>clearInterval(noticeTimer))
const isCollapsed = ref(false)
const media=window.matchMedia('(max-width:700px)')
const mobile=ref(media.matches),mobileNav=ref(false)
const updateMobile=event=>{mobile.value=event.matches;mobileNav.value=false}
media.addEventListener('change',updateMobile)
onBeforeUnmount(()=>media.removeEventListener('change',updateMobile))
const menuItems = [
  { name: 'Overview', title: '驾驶舱', icon: markRaw(DataAnalysis) },
  { name: 'Users', title: '用户管理', icon: markRaw(User) },
  { name: 'Accounts', title: '组织与权益', icon: markRaw(User) },
  { name: 'Organizations', title: '组织管理', icon: markRaw(OfficeBuilding) },
  { name: 'Cards', title: '卡牌管理', icon: markRaw(Postcard) },
  { name: 'Activities', title: '活动管理', icon: markRaw(Calendar) },
  { name:'PlayerContent', title:'玩家端内容',icon:markRaw(Postcard)},
  { name: 'Downloads', title: '下载中心', icon: markRaw(Folder) },
  { name: 'Oss', title: 'OSS 文件', icon: markRaw(Folder) },
  { name: 'Settings', title: '系统设置', icon: markRaw(Setting) }
]
const menus=computed(()=>menuItems.filter(item=>{
  if (item.name==='Accounts') return !!auth.user?.accountId && auth.user?.role==='boss'
  if (auth.user?.accountId && ['Users','Organizations'].includes(item.name)) return false
  return true
}))

async function handleLogout() {
  try {await auth.endSession();await router.push({name:'Login'})}
  catch {ElMessage.error('服务器注销未完成，请重试')}
}
</script>

<style scoped>
.platform-layout{--el-color-primary:#367467;--el-color-primary-light-3:#719e93;--el-color-primary-light-5:#a0beb7;--el-color-primary-light-9:#eff6f3}
.platform-layout :deep(.el-aside .el-menu){border-right:0;padding:8px}
.platform-layout :deep(.el-aside .el-menu-item){border-radius:8px;margin:3px 0;font-size:13px;gap:2px}
.platform-layout :deep(.el-aside .el-menu-item.is-active){background:#ffffff0b}

.account-context {font-size:13px;color:#526d66;} .context-bar {flex-wrap:wrap;}
@media(max-width:700px) {.platform-layout :deep(.el-main){padding:12px!important} .platform-layout :deep(.el-header){height:auto;min-height:80px;padding:10px!important} .context-bar{gap:6px!important;justify-content:flex-end} .account-context{width:100%;text-align:right}}
</style>
