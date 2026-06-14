// Main Controller
//
// Made with Easy Lens



try {

// No blocks available; previous hologram feature removed per request.
// Keep a minimal OnStart event to ensure script validity without referencing removed blocks.

// Flags (retained for future use if blocks are re-added)
var startWithHoloOn = false;

var onStart = script.createEvent("OnStartEvent");
onStart.bind(function() {
    // No-op: hologram effect and UI have been removed. Nothing to initialize.
});

} catch(e) {
  print("error in controller");
  print(e);
}
