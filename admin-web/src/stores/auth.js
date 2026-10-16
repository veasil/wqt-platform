import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api'
function readUser() {
  try {return JSON.parse(localStorage.getItem('aw_user') || 'null')}
  catch {return null}
}

// 注意：用独立的 storage key（aw_*），与 enterprise-panel(ep_*) 隔离，避免同域 token 串号
export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('aw_token') || '')
  const user = ref(readUser())
  const accounts = ref([]), accessError = ref(''), contextVersion = ref(0)
  const isAccountModel = computed(() => user.value?.identityId != null)
  const currentAccount = computed(() => accounts.value.find(a=>a.id===user.value?.accountId))

  const isLoggedIn = computed(() => !!token.value)

  function setAuth(t, u) {
    contextVersion.value++
    accounts.value=[];accessError.value=''
    token.value = t
    user.value = u
    localStorage.setItem('aw_token', t)
    localStorage.setItem('aw_user', JSON.stringify(u))
  }

  function logout() {
    contextVersion.value++
    accounts.value=[]
    token.value = ''
    user.value = null
    localStorage.removeItem('aw_token')
    localStorage.removeItem('aw_user')
  }

  async function fetchMe() {
    const { data } = await api.get('/api/me')
    user.value = data.user
    localStorage.setItem('aw_user', JSON.stringify(user.value))
    if (isAccountModel.value) await fetchAccounts()
    accessError.value=''
  }

  async function availableAccounts() {
    await fetchAccounts()
    return accounts.value.filter(account=>account.role==='boss')
  }
  async function fetchAccounts() {
    const {data}=await api.get('/api/auth/accounts')
    accounts.value=data.accounts || []
  }
  async function switchAccount(accountId) {
    const {data}=await api.post('/api/auth/select-account',{accountId})
    setAuth(data.token,data.user)
  }
  async function endSession() {
    await api.post('/api/auth/logout')
    logout()
  }

  window.addEventListener('storage',event=>{
    if(event.key==='aw_token' && event.newValue!==token.value) window.location.reload()
  })
  return { token, user, accounts,accessError,contextVersion,isAccountModel,currentAccount,isLoggedIn, setAuth, logout, fetchMe,fetchAccounts,availableAccounts,switchAccount,endSession }
})
