// Keep the feedback and report proxies on the same effective defaults.
// Database values take priority; deployment defaults fill only missing values.
export function selectLlmDefaults({provider,model}={}, settings={}, env=process.env) {
  provider=provider || settings.DEFAULT_LLM_PROVIDER || env.DEFAULT_LLM_PROVIDER || 'OpenAI';
  model=model || settings.DEFAULT_LLM_MODEL || env.DEFAULT_LLM_MODEL || {
    OpenAI:'gpt-4o-mini', 'Google Gemini':'gemini-2.0-flash',
    '阿里云 DashScope':'qwen-plus', DeepSeek:env.DEEPSEEK_MODEL || 'deepseek-chat',
  }[provider] || 'gpt-4o-mini';
  return {provider,model};
}
