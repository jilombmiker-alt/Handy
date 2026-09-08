const quickClipboardView=new window.QuickClipboardView(document.getElementById('quick-clipboard'),window.clipAPI);
window.clipAPI.onChanged(()=>quickClipboardView.refresh());
window.clipAPI.onFocus(()=>quickClipboardView.focus());
window.clipAPI.onClose(()=>quickClipboardView.close());
window.clipAPI.onDisabled(()=>quickClipboardView.disabled());
window.clipAPI.onQuit(()=>quickClipboardView.quit());
void quickClipboardView.refresh().then(()=>quickClipboardView.focus());
