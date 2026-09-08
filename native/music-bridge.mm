#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <node_api.h>
#include <cstring>

// Deliberately not a generic keyboard API: one bundle, one canonical install,
// three commands. No activation, global event posting or automatic Escape.
static NSRunningApplication *soda() {
  for (NSRunningApplication *app in [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.soda.music"]) {
    if (!app.terminated && [app.bundleURL.path isEqualToString:@"/Applications/汽水音乐.app"]) return app;
  }
  return nil;
}
static napi_value result(napi_env env, const char *message) {
  napi_value value; napi_create_string_utf8(env,message,NAPI_AUTO_LENGTH,&value); return value;
}
static napi_value running(napi_env env,napi_callback_info) {
  napi_value value; napi_get_boolean(env,soda()!=nil,&value); return value;
}
static napi_value send(napi_env env,napi_callback_info info) {
  size_t argc=1,length=0; napi_value args[1]; char action[24]={0};
  napi_get_cb_info(env,info,&argc,args,nullptr,nullptr);
  if (!argc || napi_get_value_string_utf8(env,args[0],action,sizeof(action),&length)!=napi_ok || length>=sizeof(action)-1) return result(env,"invalid_action");
  CGKeyCode key; CGEventFlags flags=0;
  if (!strcmp(action,"toggle") || !strcmp(action,"play") || !strcmp(action,"pause")) key=49;
  else if (!strcmp(action,"next")) { key=124; flags=kCGEventFlagMaskCommand; }
  else if (!strcmp(action,"previous")) { key=123; flags=kCGEventFlagMaskCommand; }
  else return result(env,"invalid_action");
  if (!AXIsProcessTrusted()) return result(env,"accessibility_permission_required");
  auto app=soda(); if (!app) return result(env,"no_active_session");
  // Do not type into a known search/login field. Do not read the field's value.
  AXUIElementRef ax=AXUIElementCreateApplication(app.processIdentifier);
  AXUIElementSetMessagingTimeout(ax,0.15);
  CFTypeRef focused=nullptr,role=nullptr;
  AXUIElementCopyAttributeValue(ax,kAXFocusedUIElementAttribute,&focused);
  if (focused && CFGetTypeID(focused)==AXUIElementGetTypeID()) AXUIElementCopyAttributeValue((AXUIElementRef)focused,kAXRoleAttribute,&role);
  bool editing=role && (CFEqual(role,kAXTextFieldRole)||CFEqual(role,kAXTextAreaRole)||CFEqual(role,kAXComboBoxRole));
  if(role)CFRelease(role); if(focused)CFRelease(focused); CFRelease(ax);
  if (editing) return result(env,"music_input_focused");
  CGEventRef down=CGEventCreateKeyboardEvent(nullptr,key,true),up=CGEventCreateKeyboardEvent(nullptr,key,false);
  if (!down || !up) { if(down)CFRelease(down);if(up)CFRelease(up);return result(env,"soda_control_failed"); }
  CGEventSetFlags(down,flags); CGEventSetFlags(up,flags);
  CGEventPostToPid(app.processIdentifier,down); CGEventPostToPid(app.processIdentifier,up);
  CFRelease(down);CFRelease(up);
  // The OS provides no acknowledgement that the player acted on this event.
  return result(env,"sent");
}
static napi_value init(napi_env env,napi_value exports) {
  napi_property_descriptor fields[]={
    {"running",nullptr,running,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"send",nullptr,send,nullptr,nullptr,nullptr,napi_default,nullptr}};
  napi_define_properties(env,exports,2,fields);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
