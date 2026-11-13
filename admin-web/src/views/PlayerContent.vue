<template>
 <div><h1 class="page-title">玩家端内容发布</h1><el-alert v-if="message" :title="message" :closable="false" :type="failed?'error':'success'"/>
 <el-card><h2>开屏品牌资源</h2><p>保存后玩家开屏重新读取时展示新内容，读取失败保留原资源。</p><el-form label-width="120px"><el-form-item label="品牌图片"><el-input v-model="brand.image" placeholder="同站图片地址，如 /player/brand-references/product-logo.png"/></el-form-item><el-form-item label="展示标题"><el-input v-model="brand.title" maxlength="200"/></el-form-item><el-form-item label="图片说明"><el-input v-model="brand.alt" maxlength="200"/></el-form-item><el-button type="primary" :loading="saving" @click="publishBrand">发布品牌资源</el-button></el-form></el-card>
 <el-card style="margin-top:20px"><h2>活动反馈问卷</h2><p>新版本适用于之后开局的场次，已经开局的问卷保持原版本。</p><div v-for="(q,i) in questions" :key="q.id" class="question-row"><el-input v-model="q.label" placeholder="问题内容" maxlength="200"/><el-select v-model="q.type"><el-option label="文字回答" value="text"/><el-option label="单选" value="select"/></el-select><el-input v-if="q.type==='select'" v-model="q.optionsText" placeholder="选项，以中文逗号分隔"/><el-button :disabled="questions.length===1" @click="questions.splice(i,1)">删除问题</el-button></div><div class="toolbar"><el-button :disabled="questions.length>=20" @click="addQuestion">新增问题</el-button><el-button type="primary" :loading="saving" @click="publishQuestions">发布问卷</el-button></div></el-card>
 <el-alert v-if="pending" title="发布结果尚未确认，请重试原操作" type="warning" :closable="false"><el-button :loading="saving" @click="retry">重试发布</el-button></el-alert>
 </div>
</template>
<script setup>
import {ref,reactive,onMounted} from 'vue'
import api from '../api'
import {useAuthStore} from '../stores/auth'
import {createOperationClient} from '../utils/entitlements'
const auth=useAuthStore(),brand=reactive({image:'/player/brand-references/product-logo.png',title:'一起探索 · 一起守护',alt:'伍力全开'}),questions=ref([]),saving=ref(false),message=ref(''),failed=ref(false)
const client=createOperationClient({storage:sessionStorage,scope:'player-content',actor:{identityId:auth.user?.identityId,accountId:auth.user?.accountId},post:async(path,body)=>(await api.put(path,body)).data}),pending=ref(client.pending)
function addQuestion(){questions.value.push({id:crypto.randomUUID(),label:'',type:'text',optionsText:''})}
async function save(key,value){if(saving.value||pending.value)return;saving.value=true;failed.value=false;try{await client.execute('/api/admin/settings',{key,value:JSON.stringify(value),description:key==='PLAYER_BRAND_RESOURCE'?'玩家开屏品牌资源':'活动反馈问卷'});message.value='内容已发布'}catch(e){failed.value=true;message.value=e.response?.data?.error||e.message}finally{saving.value=false;pending.value=client.pending}}
const publishBrand=()=>save('PLAYER_BRAND_RESOURCE',{...brand,revision:String(Date.now())})
const publishQuestions=()=>save('PLAYER_QUESTIONNAIRE',{version:String(Date.now()),questions:questions.value.map(q=>({id:q.id,label:q.label,type:q.type,...(q.type==='select'?{options:q.optionsText.split(/[,，]/).map(v=>v.trim()).filter(Boolean)}:{})}))})
async function retry(){saving.value=true;try{await client.retry();message.value='内容已发布';failed.value=false}catch(e){failed.value=true;message.value=e.response?.data?.error||e.message}finally{saving.value=false;pending.value=client.pending}}
onMounted(async()=>{try{const {data}=await api.get('/api/admin/settings');const b=data.settings.find(s=>s.key==='PLAYER_BRAND_RESOURCE'),q=data.settings.find(s=>s.key==='PLAYER_QUESTIONNAIRE');if(b)Object.assign(brand,JSON.parse(b.value));if(q)questions.value=JSON.parse(q.value).questions.map(q=>({...q,optionsText:(q.options||[]).join('，')}));else {questions.value=[{id:'participation',label:'本场参与投入程度',type:'select',optionsText:'很投入，一般，需要更多支持'},{id:'learning',label:'本场最重要的发现或收获',type:'text',optionsText:''},{id:'improvement',label:'下一场希望如何调整',type:'text',optionsText:''}]}}catch(e){failed.value=true;message.value=e.response?.data?.error||e.message}})
</script>
<style scoped>.question-row{display:flex;gap:12px;margin:15px 0;align-items:center}.question-row .el-select{width:120px;flex-shrink:0}@media(max-width:700px){.question-row{flex-direction:column;align-items:stretch}.question-row .el-select{width:100%}}</style>
