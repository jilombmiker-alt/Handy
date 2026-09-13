#pragma once
// No text is collected. 1 = short release, 2 = held for threshold.
struct PressGesture {
  bool active=false, blocked=false, longFired=false;
  double began=0;
  void reset(){active=blocked=longFired=false;began=0;}
  void down(double now){if(!active){active=true;began=now;blocked=longFired=false;}}
  void cancel(){if(active)blocked=true;}
  int tick(double now){if(active&&!blocked&&!longFired&&now-began>=.6){longFired=true;return 2;}return 0;}
  int up(double now){if(!active)return 0;const int value=blocked||longFired?0:now-began>=.6?2:1;reset();return value;}
};
