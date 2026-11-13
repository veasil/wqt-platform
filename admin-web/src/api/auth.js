import api from './index'

// 发送短信验证码
export const sendSmsCode = (phone, proof = {}) => api.post('/api/auth/sms/send', { phone, ...proof })

// 三要素登录（手机号 + 密码 + 验证码），返回 role 由前端校验是否可进后台
export const loginByPassword = (phone, password, code, verificationMethod, proof = {}) =>
  api.post('/api/auth/login', { phone, password, code, verificationMethod, ...proof })

export const selectAccount = (token, accountId) =>
  api.post('/api/auth/select-account', { accountId }, { headers: { Authorization: `Bearer ${token}` } })
