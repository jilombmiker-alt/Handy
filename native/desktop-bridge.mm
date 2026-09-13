#import <AppKit/AppKit.h>
#include <node_api.h>
static napi_value json(napi_env env,id value){
  NSData *data=[NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  napi_value out;napi_create_string_utf8(env,(const char*)data.bytes,data.length,&out);return out;
}
static void scan(NSString *root,NSMutableArray *rows,int depth){
  if(depth>2||rows.count>=600)return;
  for(NSString *name in [[NSFileManager defaultManager] contentsOfDirectoryAtPath:root error:nil]){
    if([name hasPrefix:@"."]||rows.count>=600)continue;
    NSString *path=[root stringByAppendingPathComponent:name];
    NSDictionary *attrs=[[NSFileManager defaultManager] attributesOfItemAtPath:path error:nil];
    if(![attrs[NSFileType] isEqual:NSFileTypeDirectory])continue;
    if([name.pathExtension isEqualToString:@"app"]){
      NSBundle *bundle=[NSBundle bundleWithPath:path];NSString *bid=bundle.bundleIdentifier;
      if(!bid.length||!bundle.executablePath.length)continue;
      NSString *display=[bundle objectForInfoDictionaryKey:@"CFBundleDisplayName"]?:[bundle objectForInfoDictionaryKey:@"CFBundleName"]?:name.stringByDeletingPathExtension;
      [rows addObject:@{@"path":path,@"bundleId":bid,@"name":display,@"filename":name.stringByDeletingPathExtension}];
    }else scan(path,rows,depth+1);
  }
}
static napi_value inventory(napi_env env,napi_callback_info){
  @autoreleasepool {
    NSMutableArray *rows=[NSMutableArray array];
    for(NSString *root in @[@"/Applications",@"/System/Applications",[NSHomeDirectory() stringByAppendingPathComponent:@"Applications"]])scan(root,rows,0);
    return json(env,rows);
  }
}
static napi_value running(napi_env env,napi_callback_info info){
  size_t argc=1,length=0;napi_value args[1];char path[4096]={0};napi_get_cb_info(env,info,&argc,args,nullptr,nullptr);
  bool found=false;
  if(argc&&napi_get_value_string_utf8(env,args[0],path,sizeof(path),&length)==napi_ok&&length<sizeof(path)-1){
    NSString *target=[NSString stringWithUTF8String:path];
    for(NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications)if(!app.terminated&&[app.bundleURL.path isEqual:target]){found=true;break;}
  }
  napi_value out;napi_get_boolean(env,found,&out);return out;
}
static napi_value init(napi_env env,napi_value exports){
  napi_property_descriptor fields[]={
    {"inventory",nullptr,inventory,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"running",nullptr,running,nullptr,nullptr,nullptr,napi_default,nullptr}};
  napi_define_properties(env,exports,2,fields);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
