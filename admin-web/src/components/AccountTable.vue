<template>
  <el-table :data="accounts" stripe row-key="id">
    <el-table-column label="守望者账号" min-width="150"><template #default="{row}"><strong>{{ row.name }}</strong><div class="secondary">#{{ row.id }} · {{ row.status==='active' ? '正常':'已停用' }}</div></template></el-table-column>
    <el-table-column label="所属组织" min-width="145"><template #default="{row}"><el-button link type="primary" @click="router.push({name:'OrganizationDetail',params:{id:row.organization_id}})">{{ row.organization_id===0 ? '免费组织':row.organization_name }}</el-button></template></el-table-column>
    <el-table-column label="当前用户" min-width="140"><template #default="{row}">{{ row.guardian_name || (row.identity_id ? `用户 #${row.identity_id}`:'未绑定') }}<div class="secondary">{{ row.phone }}</div></template></el-table-column>
    <el-table-column label="当前权益" min-width="210"><template #default="{row}"><el-tag :type="row.paid_valid ? 'success':row.trial_valid ? 'warning':'info'">{{ accountEntitlement(row) }}</el-tag><div class="secondary">{{ row.entitlement_until!=null ? `到期 ${formatTime(row.entitlement_until)}`:'免费内容' }}</div><div v-if="row.identity_status==='suspended'" class="secondary">用户已停用，当前不能使用</div></template></el-table-column>
    <el-table-column label="角色" min-width="120"><template #default="{row}">{{ roles[row.role] || row.role }}</template></el-table-column>
    <el-table-column v-if="$slots.actions" label="操作" min-width="300"><template #default="{row}"><slot name="actions" :row="row" /></template></el-table-column>
  </el-table>
</template>
<script setup>
import {useRouter} from 'vue-router'
import {accountEntitlement,formatTime} from '../utils/entitlements'
defineProps({accounts:{type:Array,default:()=>[]}})
const router=useRouter(),roles={watcher:'普通账号',enterprise:'组织管理员',boss:'平台管理员',operator:'运营（保留）'}
</script>
<style scoped>.secondary{font-size:12px;color:#7a898d;line-height:1.8}strong{font-weight:500}</style>
