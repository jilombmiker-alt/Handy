#pragma once
// No key text is stored. Only the two left modifiers and cancellation state.
struct ModifierChord {
  bool active=false, armed=false, blocked=false;
  double began=0;
  void reset() { active=armed=blocked=false; began=0; }
  bool update(bool leftOption, bool leftCommand, bool otherModifier, bool otherEvent, double now) {
    if (!active && (leftOption || leftCommand)) { active=true; began=now; }
    if (!active) return false;
    if (otherModifier || otherEvent || now-began>1.0) blocked=true;
    if (leftOption && leftCommand && !blocked) armed=true;
    if (!leftOption && !leftCommand) {
      const bool fire=armed && !blocked;
      reset(); return fire;
    }
    return false;
  }
};
