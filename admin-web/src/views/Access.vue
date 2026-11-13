<template>
  <main class="access-page">
    <h1>平台管理暂不可用</h1><p>{{ auth.accessError || '请确认当前账号的管理权限' }}</p>
    <el-button type="primary" @click="router.push({name:'Overview'})">重新检查</el-button>
    <el-button v-if="auth.isAccountModel" @click="router.push({name:'SelectAccount'})">选择其他账号</el-button>
    <el-button @click="exit">退出登录</el-button>
  </main>
</template>
<script setup>
import {useRouter} from 'vue-router'
import {ElMessage} from 'element-plus'
import {useAuthStore} from '../stores/auth'
const auth=useAuthStore(),router=useRouter()
async function exit() {
  try {await auth.endSession();router.push({name:'Login'})}
  catch {ElMessage.error('服务器注销未完成，请重试')}
}
</script>
<style scoped>.access-page{max-width:680px;margin:12vh auto;padding:24px} p{color:#626d79;line-height:1.8}</style>
