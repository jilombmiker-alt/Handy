// Explicit opt-in only: uses the saved text key in memory with synthetic input.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMeetingPrep } = require('../ai/meeting-prep');
if (!process.argv.includes('--live')) { console.log('Pass --live only after permission to use the saved text API key.'); app.exit(1); }
app.setName('TO-DO Panel');
const settingsPath = path.join(app.getPath('appData'), 'Dynamic Panel', 'transcription-settings.json');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'panel-meeting-connection-')));
app.whenReady().then(async()=> {
  let prep;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath,'utf8'));
    if (!safeStorage.isEncryptionAvailable() || !settings.encryptedLlmApiKey) throw Error('key_unavailable');
    const apiKey = safeStorage.decryptString(Buffer.from(settings.encryptedLlmApiKey,'base64'));
    const config = { apiKey, baseUrl: settings.llmBaseUrl, model: settings.llmModel };
    // This diagnostic is deliberately limited to the already-confirmed provider.
    prep = createMeetingPrep({ getConfig:()=>config, validateEndpoint:async(value)=> {
      const url = new URL(value);
      if (url.protocol!=='https:' || url.hostname!=='api.deepseek.com' || url.username || url.password || url.port) throw Error('unexpected_endpoint');
      return url.href;
    } });
    const start = Date.now();
    const result = await prep.generate('synthetic-check','仅为软件连通性测试的虚构材料，不涉及真实个人资料。团队本周只有两天可用，讨论先完成笔记、会议笔记与录音悬浮条，音乐下一轮。请确定这次会议要讨论什么、会议重点和验收边界。');
    console.log(JSON.stringify({ ok:result.ok, error:result.error, model:result.model, elapsedMs:Date.now()-start,
      topicCount:result.proposal?.topics.length, hasObjective:!!result.proposal?.objective }));
    app.exit(result.ok ? 0 : 1);
  } catch { console.log(JSON.stringify({ok:false,error:'saved_key_or_config_unavailable'})); app.exit(1); }
  finally { prep?.dispose(); }
});
