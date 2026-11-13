import axios from 'axios'
import { useAuthStore } from '../stores/auth'
import router from '../router'

const api = axios.create({ baseURL: '', timeout: 20000 })

api.interceptors.request.use(config => {
  const auth = useAuthStore()
  if (auth.token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${auth.token}`
  config.accountContextVersion=auth.contextVersion
  return config
})

api.interceptors.response.use(
  res => {
    if(res.config.accountContextVersion!==useAuthStore().contextVersion) return Promise.reject(new Error('账号已切换，请刷新当前页面'))
    return res
  },
  err => {
    if(err.config?.accountContextVersion!==useAuthStore().contextVersion) return Promise.reject(err)
    if (err.response?.status === 401 && !err.config.url.includes('/api/auth/login')) {
      const auth = useAuthStore()
      auth.logout()
      router.push({ name: 'Login' })
    } else if(['ACCOUNT_REQUIRED','ACCOUNT_UNAVAILABLE'].includes(err.response?.data?.code)) {
      router.push({name:'SelectAccount'})
    }
    return Promise.reject(err)
  }
)

export default api
