import assert from 'node:assert/strict';
import {test} from 'node:test';
import {selectLlmDefaults} from '../../src/services/llm-selection.js';

test('report and feedback use deployment defaults when database defaults are absent',()=>{
 assert.deepEqual(selectLlmDefaults({}, {}, {DEFAULT_LLM_PROVIDER:'阿里云 DashScope',DEFAULT_LLM_MODEL:'qwen-plus'}),{provider:'阿里云 DashScope',model:'qwen-plus'});
 assert.deepEqual(selectLlmDefaults({}, {}, {DEFAULT_LLM_PROVIDER:'DeepSeek',DEEPSEEK_MODEL:'deepseek-chat'}),{provider:'DeepSeek',model:'deepseek-chat'});
});
test('explicit and database selections retain priority over deployment defaults',()=>{
 const env={DEFAULT_LLM_PROVIDER:'OpenAI',DEFAULT_LLM_MODEL:'gpt-4o-mini'};
 assert.deepEqual(selectLlmDefaults({}, {DEFAULT_LLM_PROVIDER:'阿里云 DashScope',DEFAULT_LLM_MODEL:'qwen-turbo'}, env),{provider:'阿里云 DashScope',model:'qwen-turbo'});
 assert.deepEqual(selectLlmDefaults({provider:'DeepSeek',model:'deepseek-chat'}, {}, env),{provider:'DeepSeek',model:'deepseek-chat'});
});
