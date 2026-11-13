<template>
  <el-container style="min-height:100vh">
    <el-aside :width="isCollapsed ? '64px' : '220px'" style="transition: width .3s; background:#304156">
      <div style="padding:16px; text-align:center; color:#fff; font-size:16px; white-space:nowrap; overflow:hidden">
        {{ isCollapsed ? '组' : '组织管理' }}
      </div>
      <el-menu
        :default-active="route.name"
        :collapse="isCollapsed"
        background-color="#304156"
        text-color="#bfcbd9"
        active-text-color="#409eff"
        router
      >
        <el-menu-item index="Dashboard" :route="{ name: 'Dashboard' }">
          <el-icon><DataAnalysis /></el-icon>
          <template #title>驾驶舱</template>
        </el-menu-item>
        <el-menu-item index="Members" :route="{ name: 'Members' }">
          <el-icon><User /></el-icon>
          <template #title>成员管理</template>
        </el-menu-item>
        <el-menu-item index="Activities" :route="{ name: 'Activities' }">
          <el-icon><Calendar /></el-icon>
          <template #title>活动管理</template>
        </el-menu-item>
        <el-menu-item index="Sessions" :route="{ name: 'Sessions' }">
          <el-icon><List /></el-icon>
          <template #title>游戏场次</template>
        </el-menu-item>
        <el-menu-item index="InviteCodes" :route="{ name: 'InviteCodes' }">
          <el-icon><Ticket /></el-icon>
          <template #title>邀请码</template>
        </el-menu-item>
        <el-menu-item index="Settings" :route="{ name: 'Settings' }">
          <el-icon><Setting /></el-icon>
          <template #title>组织设置</template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header style="display:flex; align-items:center; justify-content:space-between; background:#fff; border-bottom:1px solid #e6e6e6; padding:0 20px">
        <el-button :icon="isCollapsed ? Expand : Fold" text @click="isCollapsed = !isCollapsed" />
        <div style="display:flex; align-items:center; gap:12px">
          <span style="font-size:14px; color:#666">{{ auth.user?.guardianName || auth.user?.phone }}</span>
          <el-button v-if="auth.user?.accountId" text @click="openAccounts">切换账号</el-button>
          <el-button text type="danger" @click="handleLogout">退出</el-button>
        </div>
      </el-header>
      <el-main style="background:#f5f7fa; padding:20px">
        <router-view :key="auth.user?.accountId || 'legacy'" />
      </el-main>
    </el-container>
    <el-dialog v-model="accountDialog" title="选择城市级管理账号" width="min(480px,94vw)">
      <el-select v-model="selectedAccount" placeholder="请选择账号" style="width:100%"><el-option v-for="account in accounts" :key="account.id" :value="account.id" :label="`${account.organization_name} · ${account.name}`" /></el-select>
      <template #footer><el-button @click="accountDialog=false">取消</el-button><el-button type="primary" :disabled="!selectedAccount" :loading="switching" @click="confirmAccount">确认账号</el-button></template>
    </el-dialog>
  </el-container>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import {ElMessage} from 'element-plus'
import { Expand, Fold } from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const isCollapsed = ref(false)
const accountDialog=ref(false),accounts=ref([]),selectedAccount=ref(null),switching=ref(false)
async function openAccounts() {
  try {accounts.value=await auth.availableAccounts();selectedAccount.value=null;accountDialog.value=true}
  catch(e) {ElMessage.error(e.response?.data?.error || e.message)}
}
async function confirmAccount() {
  switching.value=true
  try {await auth.switchAccount(selectedAccount.value);accountDialog.value=false;await router.push({name:'Dashboard'})}
  catch(e) {ElMessage.error(e.response?.data?.error || e.message)}
  finally {switching.value=false}
}

async function handleLogout() {
  try {await auth.endSession()} catch { /* Local credentials are cleared even when the service is unavailable. */ }
  await router.push({ name: 'Login' })
}
</script>
