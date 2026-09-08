import { useCallback, useEffect, useState } from 'react';

const tabs = ['账户资料', '权益与期限', '安全设置', '我的学习', '文件与反馈'];
const tabRoutes = { 账户资料: 'account', 权益与期限: 'membership', 安全设置: 'security', 我的学习: 'learning', 文件与反馈: 'files-feedback' };
const routeTabs = Object.fromEntries(Object.entries(tabRoutes).map(([label, route]) => [route, label]));
const tabIcons = { 账户资料: '人', 权益与期限: '章', 安全设置: '盾', 我的学习: '学', 文件与反馈: '件' };
const learningUrl = import.meta.env.VITE_LEARNING_URL || '/learning/';
const formatDate = (value) => value ? new Date(Number(value)).toLocaleString('zh-CN') : '长期有效';
const maskPhone = (phone) => String(phone || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1 **** $2') || '未绑定';

export default function ProfileMode({ user, service, onOpenSupport, onUserUpdate, notify }) {
  const [active, setActive] = useState(() => routeTabs[window.location.hash.replace('#me/', '')] || '账户资料');
  const [profile, setProfile] = useState(null);
  const [devices, setDevices] = useState([]);
  const [files, setFiles] = useState([]);
  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [form, setForm] = useState({ guardianName: '', realName: '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [feedback, setFeedback] = useState('');
  const [feedbackType, setFeedbackType] = useState('product');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(user.role !== '未登录');

  const reload = useCallback(async () => {
    if (user.role === '未登录') return;
    setError(''); setLoading(true);
    try {
      const [nextProfile, nextDevices, nextFiles] = await Promise.all([service.profile(), service.devices(), service.files()]);
      setProfile(nextProfile); setDevices(nextDevices); setFiles(nextFiles);
      setForm({ guardianName: nextProfile.name || '', realName: nextProfile.real_name || '' });
    } catch (loadError) { setError(loadError.message || '账户数据读取失败'); }
    finally { setLoading(false); }
  }, [service, user.role]);

  useEffect(() => { void reload(); }, [reload]);

  async function saveProfile(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const nextProfile = await service.updateProfile(form);
      setProfile(nextProfile); onUserUpdate(nextProfile); setEditing(false); notify('账户资料已更新');
    } catch (saveError) { setError(saveError.message || '资料保存失败'); }
    finally { setBusy(false); }
  }

  async function savePassword(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await service.changePassword(passwords); setChangingPassword(false); setPasswords({ currentPassword: '', newPassword: '' }); notify('密码已更新，下次请使用新密码登录');
    } catch (saveError) { setError(saveError.message || '密码修改失败'); }
    finally { setBusy(false); }
  }

  async function submitFeedback(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await service.submitFeedback({ type: feedbackType, content: feedback }); setFeedback(''); setFeedbackOpen(false); notify(feedbackType === 'technical' ? '技术问题已提交，我们会继续跟进' : '产品反馈已提交，谢谢你'); }
    catch (submitError) { setError(submitError.message || '反馈提交失败'); }
    finally { setBusy(false); }
  }

  const display = profile || { name: user.name, phone: user.phone, organization_name: user.organization, role: user.role, valid_until: user.validUntil };
  function selectTab(tab) {
    setActive(tab); setError('');
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#me/${tabRoutes[tab]}`);
  }

  return <main className="profile-page">
    <section className="profile-hero panel-shell"><div className="profile-avatar">{String(display.name || '伍').slice(0, 1)}</div><div><small>WATCHER PROFILE · 守望师档案</small><h1>{display.name}</h1><p>{display.organization_name || user.organization} · {user.role}</p></div><div className="profile-badges"><span><i />账号有效</span><span>组织成员</span></div><div className="profile-route"><small>可分享页面</small><b>#me/{tabRoutes[active]}</b></div></section>
    <div className="profile-layout">
      <nav className="profile-nav panel-shell" aria-label="我的子页面">{tabs.map((tab) => <button key={tab} className={active === tab ? 'active' : ''} type="button" onClick={() => selectTab(tab)}><i>{tabIcons[tab]}</i><span>{tab}<small>#{tabRoutes[tab]}</small></span><em>›</em></button>)}</nav>
      <section className="profile-content panel-shell">
        {loading && <div className="profile-loading" aria-label="正在读取账户信息"><span /><span /><span /><small>正在安全读取你的账户信息…</small></div>}
        {error && <div className="form-error" role="alert"><b>账户信息暂时无法读取</b><span>{error}</span><button type="button" onClick={reload}>重新加载</button></div>}
        {!loading && <>
        {active === '账户资料' && <><header><div><small>账户资料</small><h2>基本信息</h2></div><button type="button" onClick={() => setEditing((value) => !value)}>{editing ? '取消' : '编辑资料'}</button></header>{editing ? <form className="profile-form" onSubmit={saveProfile}><label><span>守望师名</span><input value={form.guardianName} onChange={(event) => setForm((current) => ({ ...current, guardianName: event.target.value }))} /></label><label><span>真实姓名（可选）</span><input value={form.realName} onChange={(event) => setForm((current) => ({ ...current, realName: event.target.value }))} /></label><button className="primary-action" disabled={busy} type="submit">保存资料</button></form> : <div className="info-grid"><label><span>守望师名</span><b>{display.name}</b></label><label><span>所属组织</span><b>{display.organization_name || user.organization}</b></label><label><span>账号角色</span><b>{user.role}</b></label><label><span>绑定手机</span><b>{maskPhone(display.phone)}</b></label></div>}</>}
        {active === '权益与期限' && <><header><div><small>权益与期限</small><h2>账号服务</h2></div></header><div className="membership-card"><span>伍力全开 · 组织版</span><h3>{display.valid_until ? `有效期至 ${formatDate(display.valid_until)}` : '账号长期有效'}</h3><p>当前权益直接影响以下能力：</p><ul><li><i>✓</i>参与组织活动与桌游计分</li><li><i>✓</i>使用监督记录与现场录音</li><li><i>✓</i>生成、保存并下载复盘报告</li></ul><div><i style={{ width: '100%' }} /></div><small>权益状态正常，不需要采取行动。</small></div></>}
        {active === '安全设置' && <><header><div><small>安全设置</small><h2>登录与设备</h2></div><button type="button" onClick={() => setChangingPassword((value) => !value)}>{changingPassword ? '取消修改' : '修改密码'}</button></header>{changingPassword && <form className="profile-form" onSubmit={savePassword}><label><span>当前密码</span><input type="password" value={passwords.currentPassword} onChange={(event) => setPasswords((current) => ({ ...current, currentPassword: event.target.value }))} /></label><label><span>新密码</span><input type="password" minLength="6" value={passwords.newPassword} onChange={(event) => setPasswords((current) => ({ ...current, newPassword: event.target.value }))} /></label><button className="primary-action" disabled={busy} type="submit">确认修改</button></form>}<div className="setting-list"><div><span><b>手机号验证</b><small>{maskPhone(display.phone)}</small></span><em>已启用</em></div>{devices.map((device, index) => <div key={device.id}><span><b>{index === 0 ? '当前登录设备' : '登录设备'}</b><small>{device.device_info || '浏览器'} · {formatDate(device.last_seen_at)}</small></span><em>{device.ip || '已记录'}</em></div>)}</div></>}
        {active === '我的学习' && <><header><div><small>我的学习</small><h2>学习平台</h2></div></header><div className="learning-portal"><span>学</span><div><small>独立课程空间</small><h3>AI 5000天学习平台</h3><p>课程、课时与学习进度在独立 learning 网页中使用，不与本系统卡牌库混合。</p></div><a href={learningUrl}>前往学习平台 <i>↗</i></a></div></>}
        {active === '文件与反馈' && <><header><div><small>文件与反馈</small><h2>文件与帮助中心</h2></div><button type="button" onClick={() => setFeedbackOpen((value) => !value)}>{feedbackOpen ? '收起建议框' : '提交产品建议'}</button></header><div className="support-center-card"><span>工单</span><div><small>可追踪的技术支持</small><h3>录音、账号或游戏遇到问题？</h3><p>新建工单后可查看处理状态、历史消息并继续追问。</p></div><button type="button" onClick={onOpenSupport}>打开工单中心 <i>→</i></button></div>{feedbackOpen && <form className="profile-form feedback-form" onSubmit={submitFeedback}><label><span>产品建议</span><textarea rows="4" maxLength="500" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="告诉我们哪里可以做得更好" /><small>{feedback.length}/500 · 产品建议不进入技术工单队列</small></label><button className="primary-action" disabled={busy || !feedback.trim()} type="submit">{busy ? '正在发送…' : '发送产品建议'}</button></form>}<div className="file-list">{files.length ? files.map((file) => <div key={`${file.kind}-${file.id}`}><span>{file.kind === 'review' ? '报告' : '音频'}</span><p><b>{file.file_name}</b><small>{formatDate(file.created_at)}{file.size_bytes ? ` · ${Math.ceil(file.size_bytes / 1024)} KB` : ''}</small></p><button type="button" onClick={() => service.downloadFile(file.downloadUrl, file.file_name)}>{file.kind === 'review' ? '下载' : '播放/下载'}</button></div>) : <div className="empty-files"><span>暂无个人文件</span><p>完成一局游戏并生成复盘后，报告与已保存录音会出现在这里。</p><small>文件出现需要一点时间，可稍后返回查看。</small></div>}</div></>}
        </>}
      </section>
    </div>
  </main>;
}
