// Isolated interactive preview: never opens the installed app's userData.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
process.env.PANEL_TEST_MODE = '1';
process.env.PANEL_TEST_USER_DATA_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-notebook-preview-'));
delete process.env.NOTCH_LLM_API_KEY;
delete process.env.DASHSCOPE_API_KEY;
require('../main');
app.whenReady().then(async () => {
  let host;
  for (let i = 0; i < 200; i++) {
    host = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/renderer/index.html'));
    if (host && await host.webContents.executeJavaScript('!!window.Notebook').catch(() => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  if (!host) throw Error('preview_start_failed');
  await host.webContents.executeJavaScript(String.raw`(async () => {
    const meeting = await Notebook.create('meeting');
    const draft = {...meeting.note, title:'本周工作讨论 · 演示', meeting:NotebookModel.meeting({
      objective:'确定本周最重要的交付内容与验收标准',
      background:'演示材料：时间有限，先完成笔记与会议记录，再考虑音乐。希望讨论优先级与边界。',
      topics:[{id:'scope',title:'本周先交付哪些功能',focus:'确定必做项和暂缓项',notes:''},
        {id:'acceptance',title:'怎样判断已经完成',focus:'列出可操作、可检查的验收结果',notes:''}]
    })};
    Notebook.save(draft,NotebookModel.version(meeting.note));
    const reference = await Notebook.create('note','这是隔离开发预览中的演示笔记。\n\n可以同时打开多篇笔记，修改内容、调整大小，或者点击收回。\n这里不读取你的正式笔记，也没有复制模型密钥。');
    if (${process.argv.includes('--detach') ? 'true' : 'false'}) {
      document.getElementById('home-note').value='拖拽试用 · 演示数据\n\n鼠标停留 3 秒，上方居中出现「拖出」。\n显示后 3 秒无操作就隐藏；移出再移入可重新唤出。\n按住它拖到面板外，松手即可悬浮。\n\n也可以单击「拖出」，或到笔记页拖出不同笔记。\n本预览不读取正式笔记和密钥。';
      document.getElementById('home-note').dispatchEvent(new Event('input',{bubbles:true}));
      await setMode(true); await setActiveTab('home');
    } else {
      await Notebook.detach('note',meeting.note.id);
      await Notebook.detach('note',reference.note.id);
      await Notebook.detach('recorder');
    }
  })()`);
  if (process.argv.includes('--detach')) { host.setTitle('TO-DO Panel · 3 秒悬停试用'); await app.dock?.show(); host.show(); host.focus(); }
  console.log(`Notebook preview ready. Isolated data: ${process.env.PANEL_TEST_USER_DATA_PATH}`);
}).catch((error) => { console.error(error.message); app.exit(1); });
