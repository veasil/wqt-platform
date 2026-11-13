import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('ep_token') || '')
  const user = ref(JSON.parse(localStorage.getItem('ep_user') || 'null'))

  const isLoggedIn = computed(() => !!token.value)

  function setAuth(t, u) {
    token.value = t
    user.value = u
    localStorage.setItem('ep_token', t)
    localStorage.setItem('ep_user', JSON.stringify(u))
  }

  function logout() {
    token.value = ''
    user.value = null
    localStorage.removeItem('ep_token')
    localStorage.removeItem('ep_user')
  }

  async function fetchMe() {
    try {
      const { data } = await api.get('/api/me')
      user.value = data.user
      localStorage.setItem('ep_user', JSON.stringify(data.user))
    } catch {
      logout()
    }
  }

  async function availableAccounts() {
    const {data}=await api.get('/api/auth/accounts')
    return data.accounts.filter(account=>account.role==='enterprise' && account.plan==='city')
  }
  async function switchAccount(accountId) {
    const {data}=await api.post('/api/auth/select-account',{accountId})
    setAuth(data.token,data.user)
  }
  async function endSession() {
    try {await api.post('/api/auth/logout')} finally {logout()}
  }

  return { token, user, isLoggedIn, setAuth, logout, fetchMe,availableAccounts,switchAccount,endSession }
})
