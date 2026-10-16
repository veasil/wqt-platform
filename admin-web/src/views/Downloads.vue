<template>
  <div>
    <h2>下载中心</h2>
    <p>
      发布新的桌游资料后，用户下载入口将显示最新版本。单文件最大 50
      MB，可上传资料压缩包。
    </p>
    <el-card
      ><el-form @submit.prevent="publish" label-width="90px">
        <el-form-item label="资料名称"
          ><el-input v-model="title" maxlength="120"
        /></el-form-item>
        <el-form-item label="版本"
          ><el-input
            v-model="version"
            maxlength="80"
            placeholder="例如 2026.10"
        /></el-form-item>
        <el-form-item label="文件"
          ><input
            type="file"
            aria-label="选择桌游资料"
            @change="file = $event.target.files[0]"
        /></el-form-item>
        <el-button type="primary" :loading="busy" @click="publish"
          >上传并发布</el-button
        >
      </el-form></el-card
    >
    <p role="status">{{ message }}</p>
    <el-button @click="load">刷新版本与审计</el-button>
    <h3>资料版本</h3>
    <el-table :data="releases"
      ><el-table-column prop="title" label="资料" /><el-table-column
        prop="version"
        label="版本"
      /><el-table-column prop="filename" label="文件" /><el-table-column
        label="发布于"
        ><template #default="{ row }">{{
          time(row.created_at)
        }}</template></el-table-column
      ></el-table
    >
    <h3>审计记录（最近 200 条）</h3>
    <p>传输结束表示服务器发送结束；请求后没有结束事件的记录需要排查。</p>
    <el-table :data="events"
      ><el-table-column label="时间" width="180"
        ><template #default="{ row }">{{
          time(row.created_at)
        }}</template></el-table-column
      ><el-table-column label="行为"
        ><template #default="{ row }">{{
          labels[row.event] || row.event
        }}</template></el-table-column
      ><el-table-column prop="version" label="版本" /><el-table-column
        prop="identity_id"
        label="身份 ID" /><el-table-column
        prop="account_id"
        label="账号 ID" /><el-table-column
        prop="user_id"
        label="旧用户 ID" /><el-table-column
        prop="organization_id"
        label="组织 ID" /><el-table-column
        prop="status"
        label="状态" /><el-table-column
        prop="request_id"
        label="请求 ID"
        min-width="260"
    /></el-table>
  </div>
</template>
<script setup>
import { ref, onMounted } from "vue";
import api from "../api";
const title = ref("伍力全开桌游资料"),
  version = ref(""),
  file = ref(null),
  busy = ref(false),
  message = ref(""),
  releases = ref([]),
  events = ref([]);
const labels = {
  published: "发布资料",
  requested: "请求下载",
  denied: "权限拒绝",
  unavailable: "资料不存在或已更新",
  server_sent: "服务器传输结束",
  failed: "传输失败",
};
const time = (value) => new Date(value).toLocaleString("zh-CN");
async function load() {
  try {
    const [r, e] = await Promise.all([
      api.get("/api/admin/downloads"),
      api.get("/api/admin/downloads/events"),
    ]);
    releases.value = r.data.releases;
    events.value = e.data.events;
  } catch (e) {
    message.value = e.response?.data?.error || e.message;
  }
}
async function publish() {
  if (!title.value.trim() || !version.value.trim() || !file.value) {
    message.value = "请填写名称、版本并选择文件";
    return;
  }
  if (!file.value.size || file.value.size > 50 * 1024 * 1024) {
    message.value = "文件须非空且不超过 50 MB";
    return;
  }
  busy.value = true;
  const body = new FormData();
  body.append("title", title.value);
  body.append("version", version.value);
  body.append("file", file.value);
  try {
    await api.post("/api/admin/downloads", body, { timeout: 120000 });
    message.value = "发布成功";
    await load();
  } catch (e) {
    message.value = e.response?.data?.error || e.message;
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
