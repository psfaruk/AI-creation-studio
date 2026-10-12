// প্রমাণ-টেস্ট: রিয়েল OpenAI SDK (npm openai) দিয়ে প্রকৃত DeepSeek/Z.ai API-তে কল
// — ভুয়া কীতে আসল 401 ফেরাটাই "রিয়েল" হওয়ার প্রমাণ (GLM-ব্যাকএন্ড হলে অন্য রেসপন্স আসত)।
import { verifyExternalModel } from '../src/lib/agent/external-llm';
import { findChatModel, CHAT_MODELS } from '../src/lib/agent/chat-models';

async function main() {
  console.log('ক্যাটালগ: মোট', CHAT_MODELS.length, 'মডেল');
  console.log('  zai-গ্রুপ:', CHAT_MODELS.filter(m => m.provider === 'zai').length,
    '| deepseek:', CHAT_MODELS.filter(m => m.provider === 'deepseek').length,
    '| zai-api:', CHAT_MODELS.filter(m => m.provider === 'zai-api').length,
    '| glm:', CHAT_MODELS.filter(m => m.provider === 'glm').length,
    '| groq:', CHAT_MODELS.filter(m => m.provider === 'groq').length,
    '| openrouter:', CHAT_MODELS.filter(m => m.provider === 'openrouter').length);

  const pro = findChatModel('deepseek-v4-pro')!;
  const flashFast = findChatModel('deepseek-v4-flash-fast')!;
  const glm53 = findChatModel('zai-glm-5.3')!;

  // ১. কী নেই → সৎ needsKey
  console.log('\n[1] কী ছাড়া:', JSON.stringify(await verifyExternalModel(pro, null)));

  // ২. ভুয়া কী → প্রকৃত api.deepseek.com থেকে আসল 401
  console.log('\n[2] deepseek-v4-pro + ভুয়া কী:');
  console.log(JSON.stringify(await verifyExternalModel(pro, 'sk-fake-test-key-12345678'), null, 2));

  console.log('\n[3] deepseek-flash + ভুয়া কী:');
  console.log(JSON.stringify(await verifyExternalModel(flashFast, 'sk-fake-test-key-12345678'), null, 2));

  // ৩. Z.ai API endpoint-ও রিয়েল কি না
  console.log('\n[4] glm-5.3 @ api.z.ai + ভুয়া কী:');
  console.log(JSON.stringify(await verifyExternalModel(glm53, 'fake-zai-key-12345678'), null, 2));
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
