<template>
  <div>
    <h1 class="page-title">系统设置</h1>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-alert v-if="pending" title="配置保存结果未确认" type="warning" :closable="false"><el-button :loading="saving" @click="retry">重试原操作</el-button></el-alert>
    <p style="color:#68777b;font-size:13px">服务配置保存后，由服务重启加载；认证和数据库连接配置由部署环境管理。</p>

    <el-tabs v-model="tab">
      <el-tab-pane label="系统配置" name="settings">
        <div class="toolbar">
          <el-button type="primary" @click="loadSettings">刷新</el-button>
          <el-button type="success" :disabled="!!pending" @click="openCreate">新增配置项</el-button>
          <el-button :disabled="!!pending" @click="openPlayerConfig('PLAYER_BRAND_RESOURCE')">开屏品牌资源</el-button><el-button :disabled="!!pending" @click="openPlayerConfig('PLAYER_QUESTIONNAIRE')">活动反馈问卷</el-button><span style="color:#909399">敏感项（含 KEY/SECRET）以 AES 加密落库，列表已脱敏显示</span>
        </div>
        <el-table :data="settings" v-loading="loading" border size="small">
          <el-table-column prop="key" label="键" width="240" />
          <el-table-column label="值" min-width="240">
            <template #default="{ row }">
              <span v-if="row.sensitive" style="color:#e6a23c">{{ auth.isAccountModel ? (row.configured ? '已配置（隐藏）':'未配置'):mask(row.value) }}</span>
              <span v-else>{{ row.value }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="description" label="说明" min-width="160" />
          <el-table-column label="敏感" width="70" align="center">
            <template #default="{ row }"><el-tag v-if="row.sensitive" size="small" type="warning">敏感</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }"><el-button size="small" :disabled="row.editable===false || !!pending" :title="row.editReason" @click="openEdit(row)">编辑</el-button></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="运营账号" name="operators">
        <div class="toolbar">
          <el-button type="primary" @click="loadOperators">刷新</el-button>
          <span style="color:#909399">保留的运营账号记录，平台管理入口使用平台管理员账号。</span>
        </div>
        <el-table :data="operators" border size="small">
          <el-table-column prop="id" label="ID" width="60" />
          <el-table-column prop="guardian_name" label="姓名" width="140" />
          <el-table-column prop="phone" label="手机号" width="140" />
          <el-table-column prop="username" label="用户名" />
          <el-table-column label="创建时间" min-width="160">
            <template #default="{ row }">{{ fmt(row.created_at) }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-if="operatorsLoaded && operators.length === 0" description="暂无保留的运营账号" />
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="dialog" :title="creating ? '新增配置项' : `编辑 ${form.key}`" width="min(540px,94vw)" @closed="form.value=''">
      <el-form :model="form" label-width="80px">
        <el-form-item label="键"><el-input v-model="form.key" :disabled="!creating" /></el-form-item>
        <el-form-item label="值"><el-input v-model="form.value" type="textarea" :rows="2" :placeholder="form.sensitive && auth.isAccountModel && !creating ? '填写新值；留空保持当前值':''" /></el-form-item>
        <el-checkbox v-if="form.sensitive && auth.isAccountModel && !creating" v-model="form.clearValue">明确清空已保存的值</el-checkbox>
        <el-form-item label="说明"><el-input v-model="form.description" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!!pending" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getSettings, putSetting, listOperators } from '../api/admin'
import api from '../api'
import {useAuthStore} from '../stores/auth'
import {createOperationClient} from '../utils/entitlements'

const tab = ref('settings')
const settings = ref([])
const operators = ref([])
const loading = ref(false)
const auth=useAuthStore(),error=ref(''),operatorsLoaded=ref(false)
const client=createOperationClient({storage:sessionStorage,scope:'settings',actor:{identityId:auth.user?.identityId,accountId:auth.user?.accountId},post:async(path,body)=>(await api.put(path,body)).data}),pending=ref(client.pending)
function fmt(ts) { return ts ? new Date(Number(ts)).toLocaleString('zh-CN', { hour12: false }) : '' }
function mask(v) { if (!v) return '(空)'; const s = String(v); return s.length <= 4 ? '****' : s.slice(0, 2) + '****' + s.slice(-2) }

async function loadSettings() {
  loading.value = true
  try { const { data } = await getSettings(); settings.value = data.settings }
  catch (e) { ElMessage.error(e.response?.data?.error || '加载失败') }
  finally { loading.value = false }
}
async function loadOperators() {
  try { const { data } = await listOperators(); operators.value = data.operators;operatorsLoaded.value=true }
  catch (e) { ElMessage.error(e.response?.data?.error || '加载失败') }
}

const dialog = ref(false)
const creating = ref(false)
const saving = ref(false)
const form = reactive({ key: '', value: '', description: '',sensitive:false,clearValue:false })

function openPlayerConfig(key) {
 const existing=settings.value.find(row=>row.key===key)
 if(existing){openEdit(existing);return}
 openCreate()
 form.key=key
 form.description=key==='PLAYER_BRAND_RESOURCE'?'玩家开屏品牌资源（保存后即时读取）':'玩家活动反馈问卷（按开局版本保留）'
 form.value=JSON.stringify(key==='PLAYER_BRAND_RESOURCE'?{revision:String(Date.now()),image:'/player/brand-references/product-logo.png',title:'一起探索 · 一起守护',alt:'伍力全开'}:{version:String(Date.now()),questions:[{id:'learning',label:'本场最重要的发现或收获',type:'text'},{id:'improvement',label:'下一场希望如何调整',type:'text'}]},null,2)
}
function openCreate() { creating.value = true; Object.assign(form, { key: '', value: '', description: '',sensitive:false,clearValue:false }); dialog.value = true }
function openEdit(row) { creating.value = false; Object.assign(form, { key: row.key, value: auth.isAccountModel && row.sensitive ? '':row.value || '', description: row.description || '',sensitive:row.sensitive,clearValue:false }); dialog.value = true }
async function save() {
  if(saving.value) return
  if (!form.key.trim()) return ElMessage.warning('请填写键')
  saving.value = true
  try {
    if(auth.isAccountModel) await client.execute('/api/admin/settings',{key:form.key,value:form.clearValue ? '':form.value,description:form.description,
      keepExisting:!creating.value && form.sensitive && !form.value && !form.clearValue})
    else await putSetting(form.key, form.value, form.description || null)
    ElMessage.success('已保存'); dialog.value = false; loadSettings()
  } catch (e) { ElMessage.error(e.response?.data?.error || '保存失败') }
  finally { saving.value = false;pending.value=client.pending }
}
async function retry() {
  saving.value=true
  try {await client.retry();dialog.value=false;await loadSettings();ElMessage.success('配置已保存')}
  catch(e) {error.value=e.response?.data?.error || e.message}
  finally {pending.value=client.pending;saving.value=false}
}

onMounted(() => { loadSettings(); loadOperators() })
</script>
