#include <cassert>
#include "../native/modifier-chord.h"
#include "../native/press-gesture.h"
int main(){
 PressGesture p;p.down(0);assert(p.tick(.3)==0);assert(p.up(.4)==1);assert(p.up(.5)==0);
 p.down(1);assert(p.tick(1.61)==2);assert(p.tick(2)==0);assert(p.up(3)==0);
 p.down(4);p.cancel();assert(p.tick(5)==0);assert(p.up(6)==0);
 p.down(7);assert(p.up(7.7)==2);assert(p.up(8)==0);
 ModifierChord c;
 assert(!c.update(true,false,false,false,0));assert(!c.update(true,true,false,false,.1));
 assert(!c.update(false,true,false,false,.2));assert(c.update(false,false,false,false,.3));
 assert(!c.update(false,false,false,false,.4)); // one trigger per gesture
 c.update(false,true,false,false,1);c.update(true,true,false,false,1.1);
 c.update(true,true,false,true,1.2);assert(!c.update(false,false,false,false,1.3)); // third key
 c.update(true,false,false,false,2);c.update(true,true,true,false,2.1);assert(!c.update(false,false,false,false,2.2)); // right/shift
 c.update(true,true,false,false,3);assert(!c.update(false,false,false,false,4.2)); // long hold
 c.update(true,false,false,false,5);assert(!c.update(false,false,false,false,5.1)); // one modifier
 c.update(false,true,false,false,6);c.update(true,true,false,false,6.1);assert(c.update(false,false,false,false,6.2)); // reverse order
 c.update(true,true,false,false,7);c.update(true,true,false,true,7.1);c.update(true,true,false,false,7.2);assert(!c.update(false,false,false,false,7.3)); // no rearm until release
}
