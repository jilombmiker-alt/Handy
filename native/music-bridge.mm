#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <node_api.h>
#include <cstring>
#include <string>
#include <chrono>
#include <atomic>
static std::atomic<unsigned long> actionGeneration{0};

// Read-only, narrowly scoped AX metadata. Runs off the Electron main thread.
static id attribute(AXUIElementRef element,CFStringRef name) {
  CFTypeRef value=nullptr;
  if(AXUIElementCopyAttributeValue(element,name,&value)!=kAXErrorSuccess)return nil;
  return CFBridgingRelease(value);
}
static NSString *label(AXUIElementRef element) {
  NSString *role=attribute(element,kAXRoleAttribute);
  NSArray *keys=[role isEqualToString:@"AXStaticText"]?@[@"AXValue",@"AXTitle",@"AXDescription"]:@[@"AXTitle",@"AXDescription"];
  for(NSString *key in keys){
    id v=attribute(element,(__bridge CFStringRef)key);
    if([v isKindOfClass:NSString.class]&&[v length]>0&&[v length]<512)return v;
  }
  return @"";
}
struct Scan { int count=0; int limit=600; std::chrono::steady_clock::time_point end=std::chrono::steady_clock::now()+std::chrono::milliseconds(900); };
static bool allowed(Scan &s){return ++s.count<=s.limit&&std::chrono::steady_clock::now()<s.end;}
static NSArray *children(AXUIElementRef element) {id v=attribute(element,kAXChildrenAttribute);return [v isKindOfClass:NSArray.class]?v:@[];}
static NSString *linkText(AXUIElementRef element,Scan &s,int depth){
  if(depth>4||!allowed(s))return @"";
  NSString *role=attribute(element,kAXRoleAttribute);
  if([role isEqualToString:@"AXStaticText"]){NSString *v=label(element);return [v isEqualToString:@"VIP"]?@"":v;}
  if(![role isEqualToString:@"AXLink"]&&![role isEqualToString:@"AXGroup"])return @"";
  for(id child in children(element)){
    if(CFGetTypeID((__bridge CFTypeRef)child)!=AXUIElementGetTypeID())continue;
    NSString *v=linkText((__bridge AXUIElementRef)child,s,depth+1);if(v.length)return v;
  }
  return @"";
}
static void linksIn(AXUIElementRef element,NSMutableArray *links,Scan &s,int depth) {
  if(depth>6||!allowed(s))return;
  NSString *role=attribute(element,kAXRoleAttribute);
  if([role isEqualToString:@"AXTextField"]||[role isEqualToString:@"AXTextArea"]||[role isEqualToString:@"AXComboBox"])return;
  if([role isEqualToString:@"AXLink"]){NSString *v=linkText(element,s,0);if(!v.length)v=label(element);if(v.length)[links addObject:v];return;}
  for(id child in children(element)){if(CFGetTypeID((__bridge CFTypeRef)child)==AXUIElementGetTypeID())linksIn((__bridge AXUIElementRef)child,links,s,depth+1);}
}
static NSDictionary *findPlayer(AXUIElementRef element,Scan &s,int depth){
  if(depth>18||!allowed(s))return nil;
  NSString *role=attribute(element,kAXRoleAttribute);
  if([role isEqualToString:@"AXTextField"]||[role isEqualToString:@"AXTextArea"]||[role isEqualToString:@"AXComboBox"])return nil;
  if([role isEqualToString:@"AXStaticText"]){
    NSString *v=label(element);
    if([v rangeOfString:@"^\\d{1,3}:\\d{2}(?::\\d{2})?\\s*/\\s*\\d{1,3}:\\d{2}(?::\\d{2})?$" options:NSRegularExpressionSearch].location!=NSNotFound){
      id parent=attribute(element,kAXParentAttribute);
      for(int i=0;i<4&&parent;i++){
        if(CFGetTypeID((__bridge CFTypeRef)parent)!=AXUIElementGetTypeID())break;
        NSMutableArray *links=[NSMutableArray array];linksIn((__bridge AXUIElementRef)parent,links,s,0);
        if(links.count>=2&&links.count<=5&&![links containsObject:@"推荐"]&&![links containsObject:@"听歌模式"]&&![links containsObject:@"我喜欢的音乐"])return @{@"title":links[0],@"artist":[[links subarrayWithRange:NSMakeRange(1,links.count-1)] componentsJoinedByString:@" / "],@"timeline":v};
        parent=attribute((__bridge AXUIElementRef)parent,kAXParentAttribute);
      }
    }
  }
  // The player is at the end of Soda's tree. Reverse traversal avoids scanning
  // the song list first, and never returns playlist items as the playing song.
  for(id child in [children(element) reverseObjectEnumerator]){
    if(CFGetTypeID((__bridge CFTypeRef)child)!=AXUIElementGetTypeID())continue;
    NSDictionary *found=findPlayer((__bridge AXUIElementRef)child,s,depth+1);if(found)return found;
  }
  return nil;
}

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
struct ReadWork { napi_async_work work; napi_deferred deferred; pid_t pid; std::string json; };
static void readExecute(napi_env,void *data){
  auto *job=(ReadWork*)data;
  @autoreleasepool {
    AXUIElementRef ax=AXUIElementCreateApplication(job->pid);AXUIElementSetMessagingTimeout(ax,0.06);
    // Electron applications may not expose their complete tree until a client
    // explicitly requests enhanced accessibility. This does not grant TCC.
    AXUIElementSetAttributeValue(ax,CFSTR("AXManualAccessibility"),kCFBooleanTrue);
    Scan scan;NSDictionary *value=nil;
    id windows=attribute(ax,kAXWindowsAttribute);
    if([windows isKindOfClass:NSArray.class])for(id window in windows){
      if(CFGetTypeID((__bridge CFTypeRef)window)!=AXUIElementGetTypeID())continue;
      value=findPlayer((__bridge AXUIElementRef)window,scan,0);if(value)break;
    }
    CFRelease(ax);
    NSData *json=[NSJSONSerialization dataWithJSONObject:value?:@{} options:0 error:nil];
    job->json=std::string((const char*)json.bytes,json.length);
  }
}
static void readComplete(napi_env env,napi_status status,void *data){
  auto *job=(ReadWork*)data;napi_resolve_deferred(env,job->deferred,result(env,status==napi_ok?job->json.c_str():"{\"error\":\"metadata_unavailable\"}"));napi_delete_async_work(env,job->work);delete job;
}
static napi_value readStatus(napi_env env,napi_callback_info){
  if(!AXIsProcessTrusted())return result(env,"{\"error\":\"accessibility_permission_required\"}");
  auto app=soda();if(!app)return result(env,"{}");
  auto *job=new ReadWork{};job->pid=app.processIdentifier;napi_value promise,name;
  napi_create_promise(env,&job->deferred,&promise);napi_create_string_utf8(env,"Soda playback metadata",NAPI_AUTO_LENGTH,&name);
  napi_create_async_work(env,nullptr,name,readExecute,readComplete,job,&job->work);napi_queue_async_work(env,job->work);return promise;
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
// Fixed Soda adapter, not a generic typing API. Only its labelled song search
// field may receive text; key events are addressed to Soda, never globally.
static AXUIElementRef findSearch(AXUIElementRef e,Scan &s,int depth){
  id windows=attribute(e,kAXWindowsAttribute);if(![windows isKindOfClass:NSArray.class])return nullptr;
  NSMutableArray *queue=[windows mutableCopy];
  for(NSUInteger i=0;i<queue.count&&allowed(s);i++){
    id entry=queue[i];if(CFGetTypeID((__bridge CFTypeRef)entry)!=AXUIElementGetTypeID())continue;
    AXUIElementRef item=(__bridge AXUIElementRef)entry;NSString *role=attribute(item,kAXRoleAttribute);
    if([role isEqualToString:@"AXTextField"]){
      for(NSString *name in @[@"AXPlaceholderValue",@"AXDescription",@"AXTitle"]){
        id value=attribute(item,(__bridge CFStringRef)name);
        if([value isKindOfClass:NSString.class]&&[value isEqualToString:@"歌手、歌曲或专辑名"])return (AXUIElementRef)CFRetain(item);
      }
    }else if(![role isEqual:@"AXStaticText"]&&![role isEqual:@"AXImage"]&&queue.count<4000){[queue addObjectsFromArray:children(item)];}
  }
  return nullptr;
}
struct SearchWork { napi_async_work work; napi_deferred deferred; pid_t pid; std::string query; std::string error; unsigned long generation; };
static void searchExecute(napi_env,void *data){
  auto *job=(SearchWork*)data;
  @autoreleasepool {
    AXUIElementRef ax=AXUIElementCreateApplication(job->pid);AXUIElementSetMessagingTimeout(ax,0.06);
    AXUIElementSetAttributeValue(ax,CFSTR("AXManualAccessibility"),kCFBooleanTrue);
    Scan scan;scan.limit=3000;scan.end=std::chrono::steady_clock::now()+std::chrono::milliseconds(1800);
    auto field=findSearch(ax,scan,0);
    if(job->generation!=actionGeneration)job->error="cancelled";
    else if(!field)job->error="search_field_missing";
    else {
      NSString *query=[NSString stringWithUTF8String:job->query.c_str()];
      auto focus=AXUIElementSetAttributeValue(field,kAXFocusedAttribute,kCFBooleanTrue);
      auto value=AXUIElementSetAttributeValue(field,kAXValueAttribute,(__bridge CFStringRef)query);
      id actual=attribute(field,kAXValueAttribute);
      id focused=attribute(ax,kAXFocusedUIElementAttribute);
      if(value!=kAXErrorSuccess||![actual isEqual:query])job->error="search_value_failed";
      else if(!focused||!CFEqual((__bridge CFTypeRef)focused,field))job->error="search_focus_failed";
      else if(job->generation!=actionGeneration)job->error="cancelled";
      else {
        CGEventRef down=CGEventCreateKeyboardEvent(nullptr,36,true),up=CGEventCreateKeyboardEvent(nullptr,36,false);
        if(down&&up){CGEventPostToPid(job->pid,down);CGEventPostToPid(job->pid,up);}else job->error="search_unavailable";
        if(down)CFRelease(down);if(up)CFRelease(up);
      }
      CFRelease(field);
    }
    CFRelease(ax);
  }
}
static void searchComplete(napi_env env,napi_status status,void *data){
  auto *job=(SearchWork*)data;napi_resolve_deferred(env,job->deferred,result(env,status==napi_ok?(job->error.empty()?"searched":job->error.c_str()):"search_unavailable"));napi_delete_async_work(env,job->work);delete job;
}
static napi_value search(napi_env env,napi_callback_info info){
  size_t argc=1,length=0;napi_value args[1];char query[801]={0};napi_get_cb_info(env,info,&argc,args,nullptr,nullptr);
  if(!argc||napi_get_value_string_utf8(env,args[0],query,sizeof(query),&length)!=napi_ok||!length||length>=800)return result(env,"invalid_query");
  for(size_t i=0;i<length;i++)if((unsigned char)query[i]<32)return result(env,"invalid_query");
  if(!AXIsProcessTrusted())return result(env,"accessibility_permission_required");
  auto app=soda();if(!app)return result(env,"no_active_session");
  auto *job=new SearchWork{};job->pid=app.processIdentifier;job->query=query;job->generation=actionGeneration;napi_value promise,name;
  napi_create_promise(env,&job->deferred,&promise);napi_create_string_utf8(env,"Soda fixed search",NAPI_AUTO_LENGTH,&name);
  napi_create_async_work(env,nullptr,name,searchExecute,searchComplete,job,&job->work);napi_queue_async_work(env,job->work);return promise;
}
static void rowTexts(AXUIElementRef e,NSMutableArray *texts,int depth){
  if(depth>4||texts.count>30)return;
  NSString *role=attribute(e,kAXRoleAttribute);
  if([role isEqual:@"AXImage"]||[role isEqual:@"AXTextField"])return;
  if([role isEqual:@"AXLink"]){NSString *v=label(e);if(v.length)[texts addObject:v];return;}
  id value=attribute(e,kAXValueAttribute);NSString *v=[value isKindOfClass:NSString.class]?value:label(e);
  if(v.length&&v.length<300)[texts addObject:v];
  for(id child in children(e))if(CFGetTypeID((__bridge CFTypeRef)child)==AXUIElementGetTypeID())rowTexts((__bridge AXUIElementRef)child,texts,depth+1);
}
static bool songRow(NSArray *texts){
  return texts.count>=4&&texts.count<20&&[texts[0] rangeOfString:@"^\\d{1,3}$" options:NSRegularExpressionSearch].location!=NSNotFound&&[[texts lastObject] rangeOfString:@"^\\d{1,2}:\\d{2}$" options:NSRegularExpressionSearch].location!=NSNotFound;
}
static void collectRows(AXUIElementRef e,Scan &s,int depth,NSMutableArray *rows,NSMutableArray *elements){
  if(depth>20||!allowed(s)||rows.count>=30)return;
  NSString *role=attribute(e,kAXRoleAttribute);
  if([role isEqual:@"AXGroup"]){
    NSArray *parts=children(e);
    if(parts.count>=4&&parts.count<=12){
      id first=parts[0];NSString *index=CFGetTypeID((__bridge CFTypeRef)first)==AXUIElementGetTypeID()?label((__bridge AXUIElementRef)first):@"";
      if([index rangeOfString:@"^\\d{1,3}$" options:NSRegularExpressionSearch].location!=NSNotFound){
        NSMutableArray *texts=[NSMutableArray array];rowTexts(e,texts,0);
        if(songRow(texts)){[rows addObject:texts];[elements addObject:(__bridge id)e];return;}
      }
    }
  }
  NSArray *branch=depth==0?attribute(e,kAXWindowsAttribute):children(e);
  if([branch isKindOfClass:NSArray.class])for(id child in branch)if(CFGetTypeID((__bridge CFTypeRef)child)==AXUIElementGetTypeID())collectRows((__bridge AXUIElementRef)child,s,depth+1,rows,elements);
}
struct RowsWork { napi_async_work work;napi_deferred deferred;pid_t pid;std::string query;bool play;std::string json;unsigned long generation; };
static void rowsExecute(napi_env,void *data){
  auto *job=(RowsWork*)data;
  @autoreleasepool {
    AXUIElementRef ax=AXUIElementCreateApplication(job->pid);AXUIElementSetMessagingTimeout(ax,0.06);
    AXUIElementSetAttributeValue(ax,CFSTR("AXManualAccessibility"),kCFBooleanTrue);
    Scan scan;scan.limit=3000;scan.end=std::chrono::steady_clock::now()+std::chrono::milliseconds(1800);
    auto field=findSearch(ax,scan,0);NSString *query=[NSString stringWithUTF8String:job->query.c_str()];
    NSMutableDictionary *out=[NSMutableDictionary dictionary];
    if(!field||![attribute(field,kAXValueAttribute) isEqual:query])out[@"error"]=@"search_changed";
    else {
      NSMutableArray *rows=[NSMutableArray array],*elements=[NSMutableArray array];scan.count=0;
      collectRows(ax,scan,0,rows,elements);out[@"rows"]=rows;
      if(job->play){
        NSArray *terms=[[query stringByReplacingOccurrencesOfString:@"的" withString:@" "] componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@" 《》\t"]];
        NSInteger found=-1;
        for(NSUInteger i=0;i<rows.count;i++){
          NSString *text=[rows[i] componentsJoinedByString:@" "];bool match=true;
          for(NSString *term in terms)if(term.length&&[text rangeOfString:term options:NSCaseInsensitiveSearch].location==NSNotFound)match=false;
          if(match){found=i;break;}
        }
        if(found<0)out[@"error"]=@"song_not_found";
        else if(job->generation!=actionGeneration)out[@"error"]=@"cancelled";
        else if(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier!=job->pid)out[@"error"]=@"focus_changed";
        else {
          AXUIElementRef row=(__bridge AXUIElementRef)elements[found];
          id position=attribute(row,kAXPositionAttribute),size=attribute(row,kAXSizeAttribute);CGPoint point;CGSize dimensions;
          if(!position||!size||CFGetTypeID((__bridge CFTypeRef)position)!=AXValueGetTypeID()||CFGetTypeID((__bridge CFTypeRef)size)!=AXValueGetTypeID()||!AXValueGetValue((__bridge AXValueRef)position,(AXValueType)kAXValueCGPointType,&point)||!AXValueGetValue((__bridge AXValueRef)size,(AXValueType)kAXValueCGSizeType,&dimensions)||dimensions.width<100||dimensions.height<20)out[@"error"]=@"play_control_unavailable";
          else {
            // Song row only, away from favourite/download/context buttons. Never
            // click login/subscription controls; a focus change aborts execution.
            point.x+=MIN(90.0,dimensions.width/3);point.y+=dimensions.height/2;
            AXUIElementRef hit=nullptr;bool within=false;
            if(AXUIElementCopyElementAtPosition(ax,point.x,point.y,&hit)==kAXErrorSuccess&&hit){
              id cursor=CFBridgingRelease(hit);
              for(int i=0;i<8&&cursor;i++){if(CFEqual((__bridge CFTypeRef)cursor,row)){within=true;break;}cursor=attribute((__bridge AXUIElementRef)cursor,kAXParentAttribute);}
            }
            if(!within||job->generation!=actionGeneration||![attribute(field,kAXValueAttribute) isEqual:query]||NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier!=job->pid){out[@"error"]=@"play_control_obscured";}
            else {
            for(int click=1;click<=2;click++){
              CGEventRef down=CGEventCreateMouseEvent(nullptr,kCGEventLeftMouseDown,point,kCGMouseButtonLeft),up=CGEventCreateMouseEvent(nullptr,kCGEventLeftMouseUp,point,kCGMouseButtonLeft);
              if(down&&up){CGEventSetIntegerValueField(down,kCGMouseEventClickState,click);CGEventSetIntegerValueField(up,kCGMouseEventClickState,click);CGEventPostToPid(job->pid,down);CGEventPostToPid(job->pid,up);}
              if(down)CFRelease(down);if(up)CFRelease(up);
            }
            out[@"selected"]=rows[found];out[@"dispatched"]=@YES;
            }
          }
        }
      }
    }
    if(field)CFRelease(field);CFRelease(ax);
    NSData *bytes=[NSJSONSerialization dataWithJSONObject:out options:0 error:nil];job->json=std::string((const char*)bytes.bytes,bytes.length);
  }
}
static void rowsComplete(napi_env env,napi_status status,void *data){auto *job=(RowsWork*)data;napi_resolve_deferred(env,job->deferred,result(env,status==napi_ok?job->json.c_str():"{\"error\":\"search_unavailable\"}"));napi_delete_async_work(env,job->work);delete job;}
static napi_value searchRows(napi_env env,napi_callback_info info){
  size_t argc=2,length=0;napi_value args[2];char query[801]={0};bool play=false;napi_get_cb_info(env,info,&argc,args,nullptr,nullptr);
  if(!argc||napi_get_value_string_utf8(env,args[0],query,sizeof(query),&length)!=napi_ok||!length||length>=800)return result(env,"{\"error\":\"invalid_query\"}");
  if(argc>1)napi_get_value_bool(env,args[1],&play);
  if(!AXIsProcessTrusted())return result(env,"{\"error\":\"accessibility_permission_required\"}");
  auto app=soda();if(!app)return result(env,"{\"error\":\"no_active_session\"}");
  auto *job=new RowsWork{};job->pid=app.processIdentifier;job->query=query;job->play=play;job->generation=actionGeneration;napi_value promise,name;
  napi_create_promise(env,&job->deferred,&promise);napi_create_string_utf8(env,"Soda song rows",NAPI_AUTO_LENGTH,&name);
  napi_create_async_work(env,nullptr,name,rowsExecute,rowsComplete,job,&job->work);napi_queue_async_work(env,job->work);return promise;
}
static napi_value cancelAction(napi_env env,napi_callback_info){actionGeneration++;return result(env,"cancelled");}
static napi_value init(napi_env env,napi_value exports) {
  napi_property_descriptor fields[]={
    {"running",nullptr,running,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"status",nullptr,readStatus,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"send",nullptr,send,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"search",nullptr,search,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"searchRows",nullptr,searchRows,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"cancel",nullptr,cancelAction,nullptr,nullptr,nullptr,napi_default,nullptr}};
  napi_define_properties(env,exports,6,fields);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
