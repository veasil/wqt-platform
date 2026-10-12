import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('../components/AppLayout.vue'),
    children: [
      { path: '', name: 'Overview', component: () => import('../views/Overview.vue') },
      { path: 'users', name: 'Users', component: () => import('../views/Users.vue') },
      { path: 'organizations', name: 'Organizations', component: () => import('../views/Organizations.vue') },
      { path: 'cards', name: 'Cards', component: () => import('../views/Cards.vue') },
      { path: 'activities', name: 'Activities', component: () => import('../views/Activities.vue') },
      { path: 'downloads', name: 'Downloads', component: () => import('../views/Downloads.vue') },
      { path: 'oss', name: 'Oss', component: () => import('../views/Oss.vue') },
      { path: 'analysis', name: 'GameAnalysis', component: () => import('../views/GameAnalysis.vue') },
      { path: 'audit', name: 'DataAudit', component: () => import('../views/DataAudit.vue') },
      { path: 'review', name: 'ReviewTesting', component: () => import('../views/ReviewTesting.vue') },
      { path: 'settings', name: 'Settings', component: () => import('../views/Settings.vue') }
    ]
  }
]

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.token) return { name: 'Login' }
})

export default router
