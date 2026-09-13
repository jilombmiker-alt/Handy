#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <IOKit/hidsystem/IOLLEvent.h>
#include <node_api.h>
#include "modifier-chord.h"
#include "press-gesture.h"
#include <vector>

static id globalMonitor=nil, localMonitor=nil;
static PressGesture gesture;
static bool modifierOnly=true, leftSession=false, sessionBlocked=false;
static int releasedGesture=0;
static int keyCode=-1, modifierBits=0;
static std::vector<int> triggers;
static double now(){return NSProcessInfo.processInfo.systemUptime;}
static void emit(int value){if(value&&triggers.size()<16)triggers.push_back(value);}
static int bits(NSEventModifierFlags flags){return ((flags&NSEventModifierFlagCommand)?1:0)|((flags&NSEventModifierFlagControl)?2:0)|((flags&NSEventModifierFlagOption)?4:0)|((flags&NSEventModifierFlagShift)?8:0);}
static void observe(NSEvent *event) {
  const auto flags=event.modifierFlags;
  if(!modifierOnly){
    if(event.type==NSEventTypeKeyDown&&event.keyCode==keyCode){if(!event.isARepeat&&bits(flags)==modifierBits)gesture.down(now());else if(bits(flags)!=modifierBits)gesture.cancel();}
    else if(event.type==NSEventTypeKeyUp&&event.keyCode==keyCode)emit(gesture.up(now()));
    else if(event.type==NSEventTypeFlagsChanged){if((bits(flags)&~modifierBits)!=0)gesture.cancel();}
    else if(event.type!=NSEventTypeKeyUp)gesture.cancel();
    return;
  }
  const bool leftOption=(flags & NX_DEVICELALTKEYMASK)!=0;
  const bool leftCommand=(flags & NX_DEVICELCMDKEYMASK)!=0;
  const auto unwanted=NX_DEVICERALTKEYMASK|NX_DEVICERCMDKEYMASK|NSEventModifierFlagControl|NSEventModifierFlagShift|NSEventModifierFlagFunction;
  const bool otherEvent=event.type!=NSEventTypeFlagsChanged || (event.keyCode!=55 && event.keyCode!=58);
  if(!leftSession&&(leftOption||leftCommand)){leftSession=true;sessionBlocked=false;}
  if(!leftSession)return;
  if((flags&unwanted)!=0||otherEvent){sessionBlocked=true;gesture.cancel();}
  if(leftOption&&leftCommand&&!sessionBlocked)gesture.down(now());
  if(gesture.active&&(!leftOption||!leftCommand)){releasedGesture=gesture.up(now());sessionBlocked=true;}
  if(!leftOption&&!leftCommand){emit(releasedGesture);releasedGesture=0;leftSession=sessionBlocked=false;}
}
static void stopMonitor() {
  if(globalMonitor) [NSEvent removeMonitor:globalMonitor];
  if(localMonitor) [NSEvent removeMonitor:localMonitor];
  globalMonitor=localMonitor=nil; gesture.reset();triggers.clear();leftSession=sessionBlocked=false;releasedGesture=0;
}
static napi_value start(napi_env env,napi_callback_info info) {
  stopMonitor();
  modifierOnly=true;keyCode=-1;modifierBits=0;
  size_t argc=1;napi_value args[1];napi_get_cb_info(env,info,&argc,args,nullptr,nullptr);
  if(argc){napi_value value;bool has=false;napi_has_named_property(env,args[0],"keyCode",&has);if(has){napi_get_named_property(env,args[0],"keyCode",&value);napi_get_value_int32(env,value,&keyCode);napi_get_named_property(env,args[0],"modifiers",&value);napi_get_value_int32(env,value,&modifierBits);modifierOnly=false;}}
  bool ok=AXIsProcessTrusted(); // Passive only: never request or reset TCC here.
  if(ok) {
    const auto mask=NSEventMaskFlagsChanged|NSEventMaskKeyDown|NSEventMaskKeyUp|NSEventMaskLeftMouseDown|NSEventMaskRightMouseDown|NSEventMaskOtherMouseDown;
    globalMonitor=[NSEvent addGlobalMonitorForEventsMatchingMask:mask handler:^(NSEvent *event){observe(event);}];
    localMonitor=[NSEvent addLocalMonitorForEventsMatchingMask:mask handler:^NSEvent *(NSEvent *event){observe(event);return event;}];
    ok=globalMonitor!=nil && localMonitor!=nil;
    if(!ok) stopMonitor();
  }
  napi_value value;napi_get_boolean(env,ok,&value);return value;
}
static napi_value stop(napi_env env,napi_callback_info) { stopMonitor();napi_value value;napi_get_undefined(env,&value);return value; }
static napi_value poll(napi_env env,napi_callback_info) {
  // Carbon global shortcuts can consume the NSEvent key-up; the key-state check
  // supplies the release without collecting text or installing a second tap.
  if(!modifierOnly&&gesture.active&&!CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState,(CGKeyCode)keyCode))emit(gesture.up(now()));
  else if(modifierOnly&&gesture.active&&(!CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState,55)||!CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState,58))){/* wait for the full release, no long trigger with half the chord */}
  else emit(gesture.tick(now()));
  napi_value value;napi_create_array_with_length(env,triggers.size(),&value);for(size_t i=0;i<triggers.size();i++){napi_value entry;napi_create_int32(env,triggers[i],&entry);napi_set_element(env,value,i,entry);}triggers.clear();return value;
}
static napi_value press(napi_env env,napi_callback_info){if(!modifierOnly)gesture.down(now());napi_value value;napi_get_undefined(env,&value);return value;}
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
    {"press",nullptr,press,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"presentation",nullptr,presentation,nullptr,nullptr,nullptr,napi_default,nullptr}};
  napi_define_properties(env,exports,5,fields);napi_add_env_cleanup_hook(env,cleanup,nullptr);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
