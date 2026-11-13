import api from './index'

export const sendSmsCode = (phone, proof = {}) =>
  api.post('/api/auth/sms/send', { phone, ...proof })

export const loginByPassword = (phone, password, code, verificationMethod, proof = {}) =>
  api.post('/api/auth/login', { phone, password, code, verificationMethod, ...proof })

export const selectAccount = (token, accountId) =>
  api.post('/api/auth/select-account', { accountId }, { headers: { Authorization: `Bearer ${token}` } })
