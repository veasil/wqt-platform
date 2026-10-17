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
  try {
    const res = await fetch(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (token && token !== localStorage.getItem("WQT_AUTH_TOKEN"))
      throw new ApiError("账号已变化，请刷新当前页面", 409);
    if (!res.ok)
      throw new ApiError(
        data.error || `请求失败(${res.status})`,
        res.status,
        data.code,
        data.retryAfterSeconds,
      );
    return data;
  } catch (error) {
    if (error.name === "AbortError")
      throw new ApiError("请求超时，结果尚未确认，请重试", 0);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
