<template>
  <el-card shadow="never">
    <h1 class="page-title">{{ route.query.title || '当前功能' }} · 待接通</h1>
    <p>本页尚未完成新账号模型的接口适配，暂不提供数据与操作。</p>
    <p>账号交付、套餐续费、身份核验与绑定可在“账号与权益”完成。</p>
    <el-button type="primary" @click="router.push({name:'Accounts'})">进入账号与权益</el-button>
  </el-card>
</template>
<script setup>
import {useRoute,useRouter} from 'vue-router'
const route=useRoute(),router=useRouter()
</script>
<style scoped>p{color:#67767b;line-height:1.8}</style>
