const { app, BrowserWindow, screen } = require('electron');

app.whenReady().then(async () => {
  const cursor = screen.getCursorScreenPoint();
  const displays = screen.getAllDisplays().map((display) => ({
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    internal: display.internal,
    rotation: display.rotation,
  }));
  const target = screen.getDisplayNearestPoint(cursor);
  const menuBarHeight = Math.max(0, target.workArea.y - target.bounds.y) || 38;
  const expected = {
    x: Math.round(target.bounds.x + (target.bounds.width - 200) / 2),
    y: target.bounds.y,
    width: 200,
    height: menuBarHeight,
  };
  const window = new BrowserWindow({
    ...expected,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: false,
    show: false,
  });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await window.loadURL('data:text/html,<body style="margin:0;background:black"></body>');
  const beforeShow = window.getBounds();
  window.show();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const afterShow = window.getBounds();
  window.setBounds(expected);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const afterReset = window.getBounds();
  console.log(JSON.stringify({ cursor, displays, expected, beforeShow, afterShow, afterReset }));
  window.destroy();
  app.quit();
});
