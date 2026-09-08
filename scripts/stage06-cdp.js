#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const HOST = '127.0.0.1';
const PORT = 9333;

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: HOST, port: PORT, path: pathname, timeout: 10000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('cdp_http_timeout')));
    request.on('error', reject);
  });
}

async function connect() {
  const targets = await getJson('/json/list');
  const target = targets.find((item) => item.type === 'page' && item.title === 'TO-DO Panel');
  if (!target?.webSocketDebuggerUrl) throw new Error('todo_panel_target_not_found');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  let nextId = 0;
  const pending = new Map();
  socket.on('message', (payload) => {
    const message = JSON.parse(String(payload));
    if (!message.id || !pending.has(message.id)) return;
    const operation = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) operation.reject(new Error(message.error.message || 'cdp_error'));
    else operation.resolve(message.result || {});
  });
  return {
    socket,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

function selectorExpression(selector) {
  return `document.querySelector(${JSON.stringify(selector)})`;
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'runtime_evaluation_failed');
  return result.result?.value;
}

async function main() {
  const command = process.argv[2] || 'state';
  const client = await connect();
  try {
    if (command === 'state') {
      const value = await evaluate(client, `(() => ({
        title: document.title,
        appClass: document.getElementById('app')?.className || '',
        activeTab: document.querySelector('.tab.active')?.dataset.tab || '',
        inboxTabHidden: document.getElementById('tab-button-inbox')?.hidden === true,
        runState: document.getElementById('ai-run-status')?.dataset.state || '',
        runStatus: document.getElementById('ai-run-status')?.textContent?.trim() || '',
        proposalVisible: !document.getElementById('ai-proposal-form')?.hidden,
        proposalTarget: document.getElementById('ai-proposal-target')?.value || '',
        todoTitle: document.getElementById('ai-todo-title')?.value || '',
        todoDue: document.getElementById('ai-todo-due')?.value || '',
        noteTitle: document.getElementById('ai-note-title')?.value || '',
        linkUrl: document.getElementById('ai-link-url')?.value || '',
        formError: document.getElementById('ai-form-error')?.hidden ? '' : document.getElementById('ai-form-error')?.textContent?.trim() || '',
        stage06Todos: Array.from(document.querySelectorAll('.todo-item')).map((item) => item.textContent?.replace(/\s+/g, ' ').trim() || '').filter((text) => text.includes('Stage06')),
        stage06Notes: Array.from(document.querySelectorAll('.notes-list-item, .note-item')).map((item) => item.textContent?.replace(/\s+/g, ' ').trim() || '').filter((text) => text.includes('Stage06')),
        stage06Links: Array.from(document.querySelectorAll('.link-item')).map((item) => item.textContent?.replace(/\s+/g, ' ').trim() || '').filter((text) => text.includes('Stage06')),
        history: Array.from(document.querySelectorAll('#ai-run-history button')).slice(0, 5).map((item) => ({ text: item.querySelector('span')?.textContent || '', state: item.querySelector('small')?.dataset.state || '' })),
      }))()`);
      process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
      return;
    }

    if (command === 'expand' || command === 'collapse') {
      await evaluate(client, `setMode(${command === 'expand' ? 'true' : 'false'})`);
      process.stdout.write(`${command}\n`);
      return;
    }

    if (command === 'show') {
      await evaluate(client, `(async () => {
        await window.notchAPI.setMode('expanded');
        isExpanded = true;
        modeBusy = false;
        pendingMode = null;
        syncPanelAccessibility(true);
        app.classList.remove('collapsed', 'closing', 'opening');
        app.classList.add('expanded');
        return true;
      })()`);
      process.stdout.write('expanded\n');
      return;
    }

    if (command === 'tab') {
      const tab = String(process.argv[3] || '');
      const selector = `#tab-button-${tab}`;
      const clicked = await evaluate(client, `(() => { const item = ${selectorExpression(selector)}; if (!item) return false; item.click(); return true; })()`);
      if (!clicked) throw new Error('tab_not_found');
      process.stdout.write(`${tab}\n`);
      return;
    }

    if (command === 'feature') {
      const feature = String(process.argv[3] || '');
      const enabled = String(process.argv[4] || '') === 'true';
      const result = await evaluate(client, `window.notchAPI.setFeature(${JSON.stringify(feature)}, ${enabled})`);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }

    if (command === 'duplicate-confirm') {
      const result = await evaluate(client, `(async () => {
        const listed = await window.notchAPI.aiListRuns(1);
        const run = listed?.runs?.[0];
        if (!run) return { ok: false, error: 'run_not_found' };
        const confirmed = await window.notchAPI.aiConfirmProposal(run.id, run.proposal, true);
        return { ok: confirmed?.ok === true, status: confirmed?.run?.status || '', recordId: confirmed?.run?.toolCall?.result?.recordId || '' };
      })()`);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }

    if (command === 'latest-run') {
      const result = await evaluate(client, `(async () => {
        const listed = await window.notchAPI.aiListRuns(1);
        const run = listed?.runs?.[0];
        if (!run) return null;
        return {
          id: run.id,
          status: run.status,
          target: run.proposal?.target || '',
          needsUserEdit: run.proposal?.needsUserEdit === true,
          durationMs: run.durationMs || 0,
          errorCode: run.errorCode || '',
          retryable: run.retryable === true,
        };
      })()`);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }

    if (command === 'metrics') {
      await client.send('Performance.enable');
      const result = await client.send('Performance.getMetrics');
      const selected = new Set([
        'Timestamp',
        'Documents',
        'Frames',
        'JSEventListeners',
        'Nodes',
        'LayoutCount',
        'RecalcStyleCount',
        'LayoutDuration',
        'RecalcStyleDuration',
        'ScriptDuration',
        'TaskDuration',
        'JSHeapUsedSize',
        'JSHeapTotalSize',
      ]);
      const metrics = Object.fromEntries((result.metrics || []).filter((item) => selected.has(item.name)).map((item) => [item.name, item.value]));
      process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
      return;
    }

    if (command === 'motion') {
      const cycles = Math.max(1, Math.min(20, Number(process.argv[3]) || 5));
      const result = await evaluate(client, `(async () => {
        const samples = [];
        const frameProbe = (durationMs) => new Promise((resolve) => {
          const deltas = [];
          let previous = performance.now();
          const started = previous;
          const tick = (now) => {
            deltas.push(now - previous);
            previous = now;
            if (now - started >= durationMs) resolve(deltas);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        const percentile = (values, ratio) => {
          const sorted = [...values].sort((a, b) => a - b);
          return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
        };
        for (let index = 0; index < ${cycles}; index += 1) {
          await window.notchAPI.setMode('expanded');
          isExpanded = false;
          modeBusy = false;
          pendingMode = null;
          syncPanelAccessibility(false);
          app.classList.remove('expanded', 'closing', 'opening');
          app.classList.add('collapsed');
          const expandFrames = frameProbe(520);
          const expandStarted = performance.now();
          await setMode(true);
          const expandDuration = performance.now() - expandStarted;
          const expandDeltas = await expandFrames;
          const collapseFrames = frameProbe(520);
          const collapseStarted = performance.now();
          await setMode(false);
          const collapseDuration = performance.now() - collapseStarted;
          const collapseDeltas = await collapseFrames;
          samples.push({ expandDuration, collapseDuration, expandDeltas, collapseDeltas });
        }
        const expandFrames = samples.flatMap((item) => item.expandDeltas);
        const collapseFrames = samples.flatMap((item) => item.collapseDeltas);
        return {
          cycles: samples.length,
          expandDurationAvgMs: samples.reduce((sum, item) => sum + item.expandDuration, 0) / samples.length,
          collapseDurationAvgMs: samples.reduce((sum, item) => sum + item.collapseDuration, 0) / samples.length,
          expandFrameP95Ms: percentile(expandFrames, 0.95),
          expandFrameMaxMs: Math.max(...expandFrames),
          collapseFrameP95Ms: percentile(collapseFrames, 0.95),
          collapseFrameMaxMs: Math.max(...collapseFrames),
          perCycle: samples.map((item, index) => ({
            cycle: index + 1,
            expandMaxMs: Math.max(...item.expandDeltas),
            collapseMaxMs: Math.max(...item.collapseDeltas),
          })),
        };
      })()`);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (command === 'set') {
      const selector = String(process.argv[3] || '');
      const value = String(process.argv[4] || '');
      const changed = await evaluate(client, `(() => {
        const item = ${selectorExpression(selector)};
        if (!item || !('value' in item)) return false;
        item.value = ${JSON.stringify(value)};
        item.dispatchEvent(new Event('input', { bubbles: true }));
        item.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      if (!changed) throw new Error('editable_element_not_found');
      process.stdout.write(`${selector}\n`);
      return;
    }

    if (command === 'click') {
      const selector = String(process.argv[3] || '');
      const clicked = await evaluate(client, `(() => { const item = ${selectorExpression(selector)}; if (!item) return false; item.click(); return true; })()`);
      if (!clicked) throw new Error('click_target_not_found');
      process.stdout.write(`${selector}\n`);
      return;
    }

    if (command === 'wait') {
      const timeoutMs = Math.max(0, Math.min(30000, Number(process.argv[3]) || 0));
      await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      process.stdout.write(`${timeoutMs}\n`);
      return;
    }

    if (command === 'screenshot') {
      const outputPath = String(process.argv[3] || '');
      if (!outputPath || !outputPath.startsWith('/')) throw new Error('absolute_screenshot_path_required');
      await client.send('Page.enable');
      const capture = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(outputPath, Buffer.from(capture.data, 'base64'));
      process.stdout.write(`${outputPath}\n`);
      return;
    }

    throw new Error('unknown_command');
  } finally {
    client.socket.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
