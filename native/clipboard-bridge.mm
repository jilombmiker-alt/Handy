#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <node_api.h>
#include <unistd.h>

static AXUIElementRef targetApp=nullptr,targetWindow=nullptr,targetField=nullptr;
static CFTypeRef targetRange=nullptr;
static pid_t targetPid=0;
static double capturedAt=0;
static void clearTarget(){if(targetApp)CFRelease(targetApp);if(targetWindow)CFRelease(targetWindow);if(targetField)CFRelease(targetField);if(targetRange)CFRelease(targetRange);targetApp=targetWindow=targetField=nullptr;targetRange=nullptr;targetPid=0;}
static CFTypeRef attribute(AXUIElementRef el,CFStringRef key){CFTypeRef result=nullptr;if(el)AXUIElementCopyAttributeValue(el,key,&result);return result;}
static bool sameAttribute(AXUIElementRef el,CFStringRef key,CFTypeRef expected){CFTypeRef actual=attribute(el,key);bool same=actual&&expected&&CFEqual(actual,expected);if(actual)CFRelease(actual);return same;}
static napi_value boolean(napi_env env,bool value){napi_value out;napi_get_boolean(env,value,&out);return out;}
static bool validTarget(){
  if(!AXIsProcessTrusted()||!targetPid||NSDate.timeIntervalSinceReferenceDate-capturedAt>120)return false;
  auto running=[NSRunningApplication runningApplicationWithProcessIdentifier:targetPid];if(!running||running.terminated)return false;
  return sameAttribute(targetApp,kAXFocusedWindowAttribute,targetWindow)&&sameAttribute(targetApp,kAXFocusedUIElementAttribute,targetField)&&sameAttribute(targetField,kAXSelectedTextRangeAttribute,targetRange);
}
static napi_value capture(napi_env env,napi_callback_info){
  auto front=NSWorkspace.sharedWorkspace.frontmostApplication;
  if(front.processIdentifier==getpid())return boolean(env,validTarget());
  clearTarget();if(!AXIsProcessTrusted()||!front)return boolean(env,false);
  auto a=AXUIElementCreateApplication(front.processIdentifier);AXUIElementSetMessagingTimeout(a,0.15);
  auto w=(AXUIElementRef)attribute(a,kAXFocusedWindowAttribute),f=(AXUIElementRef)attribute(a,kAXFocusedUIElementAttribute);
  CFTypeRef role=attribute(f,kAXRoleAttribute),subrole=attribute(f,kAXSubroleAttribute),range=attribute(f,kAXSelectedTextRangeAttribute);
  bool editable=role&&(CFEqual(role,kAXTextFieldRole)||CFEqual(role,kAXTextAreaRole)||CFEqual(role,kAXComboBoxRole));
  bool secure=subrole&&CFEqual(subrole,kAXSecureTextFieldSubrole);
  if(editable&&!secure&&w&&f&&range){targetApp=a;targetWindow=w;targetField=f;targetRange=range;targetPid=front.processIdentifier;capturedAt=NSDate.timeIntervalSinceReferenceDate;}
  else{if(a)CFRelease(a);if(w)CFRelease(w);if(f)CFRelease(f);if(range)CFRelease(range);}
  if(role)CFRelease(role);if(subrole)CFRelease(subrole);return boolean(env,targetPid!=0);
}
static napi_value activate(napi_env env,napi_callback_info){
  if(!validTarget())return boolean(env,false);
  auto front=NSWorkspace.sharedWorkspace.frontmostApplication;
  if(front.processIdentifier!=getpid()&&front.processIdentifier!=targetPid)return boolean(env,false);
  return boolean(env,[[NSRunningApplication runningApplicationWithProcessIdentifier:targetPid] activateWithOptions:NSApplicationActivateIgnoringOtherApps]);
}
static napi_value paste(napi_env env,napi_callback_info){
  if(!validTarget()||NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier!=targetPid)return boolean(env,false);
  CGEventRef down=CGEventCreateKeyboardEvent(nullptr,9,true),up=CGEventCreateKeyboardEvent(nullptr,9,false);
  if(!down||!up){if(down)CFRelease(down);if(up)CFRelease(up);return boolean(env,false);}
  CGEventSetFlags(down,kCGEventFlagMaskCommand);CGEventSetFlags(up,kCGEventFlagMaskCommand);
  CGEventPostToPid(targetPid,down);CGEventPostToPid(targetPid,up);CFRelease(down);CFRelease(up);clearTarget();return boolean(env,true);
}
static napi_value invalidate(napi_env env,napi_callback_info){clearTarget();return boolean(env,true);}
static napi_value ready(napi_env env,napi_callback_info){return boolean(env,validTarget());}
static napi_value files(napi_env env,napi_callback_info){
  napi_value out;napi_create_array(env,&out);auto board=NSPasteboard.generalPasteboard;
  if([board.types containsObject:@"org.nspasteboard.ConcealedType"])return out;
  NSArray *urls=[board readObjectsForClasses:@[NSURL.class] options:@{NSPasteboardURLReadingFileURLsOnlyKey:@YES}];
  if(urls.count>20)return out;uint32_t i=0;for(NSURL *url in urls){if(!url.fileURL)continue;napi_value value;napi_create_string_utf8(env,url.path.UTF8String,NAPI_AUTO_LENGTH,&value);napi_set_element(env,out,i++,value);}return out;
}
static napi_value writeFiles(napi_env env,napi_callback_info info){
  size_t argc=1;napi_value args[1];napi_get_cb_info(env,info,&argc,args,nullptr,nullptr);bool array=false;if(!argc||napi_is_array(env,args[0],&array)!=napi_ok||!array)return boolean(env,false);
  uint32_t count;napi_get_array_length(env,args[0],&count);if(!count||count>20)return boolean(env,false);NSMutableArray *urls=[NSMutableArray array];
  for(uint32_t i=0;i<count;i++){napi_value value;napi_get_element(env,args[0],i,&value);char buffer[8192];size_t length=0;if(napi_get_value_string_utf8(env,value,buffer,sizeof(buffer),&length)!=napi_ok||length>=sizeof(buffer)-1)return boolean(env,false);NSString *file=[NSString stringWithUTF8String:buffer];if(!file.isAbsolutePath||![NSFileManager.defaultManager fileExistsAtPath:file])return boolean(env,false);[urls addObject:[NSURL fileURLWithPath:file]];}
  [NSPasteboard.generalPasteboard clearContents];return boolean(env,[NSPasteboard.generalPasteboard writeObjects:urls]);
}
static void cleanup(void*){clearTarget();}
static napi_value init(napi_env env,napi_value exports){
  napi_property_descriptor fields[]={
    {"capture",nullptr,capture,nullptr,nullptr,nullptr,napi_default,nullptr},{"activate",nullptr,activate,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"paste",nullptr,paste,nullptr,nullptr,nullptr,napi_default,nullptr},{"invalidate",nullptr,invalidate,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"files",nullptr,files,nullptr,nullptr,nullptr,napi_default,nullptr},{"writeFiles",nullptr,writeFiles,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"ready",nullptr,ready,nullptr,nullptr,nullptr,napi_default,nullptr}};
  napi_define_properties(env,exports,7,fields);napi_add_env_cleanup_hook(env,cleanup,nullptr);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
