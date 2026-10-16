import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue'), meta: { public: true } },
  { path: '/select-account', name: 'SelectAccount', component: () => import('../views/SelectAccount.vue'), meta: {public:true} },
  { path: '/access', name: 'Access', component: () => import('../views/Access.vue'), meta: {public:true} },
  {
    path: '/',
    component: () => import('../components/AppLayout.vue'),
    children: [
      { path: '', name: 'Overview', component: () => import('../views/Overview.vue') },
      { path: 'users', name: 'Users', component: () => import('../views/Users.vue') },
      { path: 'accounts', name: 'Accounts', component: () => import('../views/Accounts.vue'), meta: {bossOnly:true} },
      { path: 'unavailable', name: 'FeatureUnavailable', component: () => import('../views/FeatureUnavailable.vue') },
      { path: 'organizations', name: 'Organizations', component: () => import('../views/Organizations.vue') },
      { path: 'organizations/:id', name: 'OrganizationDetail', component: () => import('../views/OrganizationDetail.vue') },
      { path: 'cards', name: 'Cards', component: () => import('../views/Cards.vue') },
      { path: 'activities', name: 'Activities', component: () => import('../views/Activities.vue') },
      { path: 'oss', name: 'Oss', component: () => import('../views/Oss.vue') },
      { path: 'analysis', redirect: {name:'Accounts'} },
      { path: 'audit', redirect: {name:'Accounts'} },
      { path: 'review', redirect: {name:'Accounts'} },
      {path:'player-content',name:'PlayerContent',component:()=>import('../views/PlayerContent.vue'),meta:{bossOnly:true}},
      { path: 'downloads', name:'Downloads', component:()=>import('../views/Downloads.vue') },
      { path: 'settings', name: 'Settings', component: () => import('../views/Settings.vue') }
    ]
  }
]

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.token) return { name: 'Login' }
  if(['SelectAccount','Access'].includes(to.name) && !auth.token) return {name:'Login'}
  if(to.meta.public) return
  try {await auth.fetchMe()}
  catch(e) {
    if(e.response?.status===401) return {name:'Login'}
    if(['ACCOUNT_REQUIRED','ACCOUNT_UNAVAILABLE'].includes(e.response?.data?.code)) return {name:'SelectAccount'}
    auth.accessError=e.response?.data?.error || '服务暂不可用，请重试'
    return {name:'Access'}
  }
  if(auth.isAccountModel && auth.user?.role!=='boss') {
    auth.accessError='当前账号没有平台管理权限；运营角色仍保留，本轮未开放其管理操作。'
    return {name:'Access'}
  }
  if(!auth.isAccountModel && ['Accounts','OrganizationDetail'].includes(to.name)) return {name:'Organizations'}
  if(auth.isAccountModel && ['Users','Organizations'].includes(to.name)) return {name:'Accounts'}
})

export default router
