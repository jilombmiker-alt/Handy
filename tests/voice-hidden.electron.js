// Existing audio persistence regression with no second visible app beside Handy.
const {app}=require('electron');
app.on('browser-window-created',(_event,win)=>{win.show=()=>{};win.showInactive=()=>{};win.focus=()=>{};});
require('./voice-memo.electron');
