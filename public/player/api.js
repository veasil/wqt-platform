export class ApiError extends Error {
  constructor(message, status, code, retryAfterSeconds) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
export async function request(
  path,
  {
    body,
    method = body ? "POST" : "GET",
    token = localStorage.getItem("WQT_AUTH_TOKEN"),
    signal,
  } = {},
) {
  const controller = new AbortController(),
    timeout = setTimeout(
      () => controller.abort(),
      path.includes("ai-feedback") ? 25000 : 15000,
    );
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  let dispatched = false, receivedStatus = null;
  const requestMethod = method.toUpperCase();
  const writes = !['GET', 'HEAD', 'OPTIONS'].includes(requestMethod);
  try {
    if (controller.signal.aborted) throw new ApiError('本次操作已取消', 0, 'REQUEST_CANCELLED');
    const options = {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    };
    dispatched = true;
    const res = await fetch(path, options);
    receivedStatus = res.status;
    let data;
    try { data = await res.json(); }
    catch {
      if (res.ok) throw new ApiError('收到的数据格式不完整，请稍后重试', res.status, 'RESPONSE_INVALID');
      data = {};
    }
    if (res.ok && (data === null || typeof data !== 'object'))
      throw new ApiError('收到的数据格式不完整，请稍后重试', res.status, 'RESPONSE_INVALID');
    if (token && token !== localStorage.getItem("WQT_AUTH_TOKEN"))
      throw new ApiError("账号已变化，请刷新当前页面", 409);
    if (!res.ok)
      throw new ApiError(
        data?.error || `请求失败(${res.status})`,
        res.status,
        data?.code,
        data?.retryAfterSeconds,
      );
    return data;
  } catch (error) {
    if (error.name === "AbortError")
      error = Object.assign(new ApiError("连接暂时未能完成，请检查网络后重试。", 0, 'REQUEST_TIMEOUT'), { cause: error });
    else if (dispatched && receivedStatus === null && error.name === 'TypeError')
      error = Object.assign(new ApiError('连接暂时未能完成，请检查网络后重试。', 0, 'NETWORK_ERROR'), { cause: error });
    error.requestMethod = requestMethod;
    error.outcomeUnknown = writes && dispatched && (receivedStatus === null || receivedStatus >= 500 || receivedStatus === 408 || (receivedStatus >= 200 && receivedStatus < 300));
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
