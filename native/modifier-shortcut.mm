#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <IOKit/hidsystem/IOLLEvent.h>
#include <node_api.h>
#include "modifier-chord.h"

static id globalMonitor=nil, localMonitor=nil;
static ModifierChord chord;
static uint32_t triggers=0;
static void observe(NSEvent *event) {
  const auto flags=event.modifierFlags;
  const bool leftOption=(flags & NX_DEVICELALTKEYMASK)!=0;
  const bool leftCommand=(flags & NX_DEVICELCMDKEYMASK)!=0;
  const auto unwanted=NX_DEVICERALTKEYMASK|NX_DEVICERCMDKEYMASK|NSEventModifierFlagControl|NSEventModifierFlagShift|NSEventModifierFlagFunction;
  const bool otherEvent=event.type!=NSEventTypeFlagsChanged || (event.keyCode!=55 && event.keyCode!=58);
  if(chord.update(leftOption,leftCommand,(flags&unwanted)!=0,otherEvent,event.timestamp)) ++triggers;
}
static void stopMonitor() {
  if(globalMonitor) [NSEvent removeMonitor:globalMonitor];
  if(localMonitor) [NSEvent removeMonitor:localMonitor];
  globalMonitor=localMonitor=nil; chord.reset();triggers=0;
}
static napi_value start(napi_env env,napi_callback_info) {
  stopMonitor();
  bool ok=AXIsProcessTrusted(); // Passive only: never request or reset TCC here.
  if(ok) {
    const auto mask=NSEventMaskFlagsChanged|NSEventMaskKeyDown|NSEventMaskLeftMouseDown|NSEventMaskRightMouseDown|NSEventMaskOtherMouseDown;
    globalMonitor=[NSEvent addGlobalMonitorForEventsMatchingMask:mask handler:^(NSEvent *event){observe(event);}];
    localMonitor=[NSEvent addLocalMonitorForEventsMatchingMask:mask handler:^NSEvent *(NSEvent *event){observe(event);return event;}];
    ok=globalMonitor!=nil && localMonitor!=nil;
    if(!ok) stopMonitor();
  }
  napi_value value;napi_get_boolean(env,ok,&value);return value;
}
static napi_value stop(napi_env env,napi_callback_info) { stopMonitor();napi_value value;napi_get_undefined(env,&value);return value; }
static napi_value poll(napi_env env,napi_callback_info) {
  napi_value value;napi_create_uint32(env,triggers,&value);triggers=0;return value;
}
// Read system presentation mode only. No accessibility prompts or screen capture.
static napi_value presentation(napi_env env,napi_callback_info) {
  const auto options=NSApp.currentSystemPresentationOptions;
  const bool busy=(options & NSApplicationPresentationFullScreen) ||
    ((options & NSApplicationPresentationHideDock) && (options & NSApplicationPresentationHideMenuBar));
  napi_value value;napi_get_boolean(env,busy,&value);return value;
}
static void cleanup(void *) { stopMonitor(); }
static napi_value init(napi_env env,napi_value exports) {
  napi_property_descriptor fields[]={
    {"start",nullptr,start,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"stop",nullptr,stop,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"poll",nullptr,poll,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"presentation",nullptr,presentation,nullptr,nullptr,nullptr,napi_default,nullptr}};
  napi_define_properties(env,exports,4,fields);napi_add_env_cleanup_hook(env,cleanup,nullptr);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
