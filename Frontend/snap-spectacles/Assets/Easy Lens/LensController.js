// Main Controller
//
// Made with Easy Lens

//@input Component.ScriptComponent holo_sparkles
//@input Component.ScriptComponent holo_grade


try {

// Tunable parameters
var holoContrast = 1.35;
var holoSaturation = 0.35;
var holoVibrance = 0.2;
var holoWarmth = -0.2;
var holoTint = 0.15;
var holoSharpen = 0.6;
var holoGrain = 0.15;
var holoLutIndex = 24; // Spectrum LUT for hologram vibe
var holoLutIntensity = 0.85;

var sparklesDensityOn = 0.55;
var sparklesSpeedOn = 0.22;
var sparklesRotationSpeedOn = 0.25;
var sparklesScaleOn = 0.35;
var sparklesBrightnessOn = 0.9;
var sparklesColor = new vec3(0.2, 0.9, 1.0); // cyan-blue hologram

var buttonLabelOn = "HOLO ON";
var buttonLabelOff = "HOLO OFF";

var pressScaleDown = 0.92;
var pressScaleRestoreDelay = 0.06;

// Flags
var startWithHoloOn = false;
var animatePressFeedback = true;

// Internal state
var holoEnabled = false;

// Helpers
function applyHoloSettings() {
    // Configure the grade only when turning on, avoid static init at load
    script.holo_grade.contrast = holoContrast;
    script.holo_grade.saturation = holoSaturation;
    script.holo_grade.vibrance = holoVibrance;
    script.holo_grade.warmth = holoWarmth;
    script.holo_grade.tint = holoTint;
    script.holo_grade.sharpen = holoSharpen;
    script.holo_grade.grain = holoGrain;
    script.holo_grade.colorCorrection = holoLutIndex;
    script.holo_grade.colorCorrectionIntensity = holoLutIntensity;

    // Configure sparkles only when turning on
    script.holo_sparkles.sparklesDensity = sparklesDensityOn;
    script.holo_sparkles.speed = sparklesSpeedOn;
    script.holo_sparkles.rotationSpeed = sparklesRotationSpeedOn;
    script.holo_sparkles.scale = sparklesScaleOn;
    script.holo_sparkles.brightness = sparklesBrightnessOn;
    script.holo_sparkles.color = sparklesColor;
}

function setHoloState(enabled) {
    holoEnabled = enabled;

    // Enable/disable blocks
    script.holo_grade.enabled = enabled;
    script.holo_sparkles.enabled = enabled;

    // Update label
    script.toggle_holo_btn.label = enabled ? buttonLabelOn : buttonLabelOff;

    // Only push property changes to blocks when enabling (dynamic need)
    if (enabled) {
        applyHoloSettings();
    }
}

function toggleHolo() {
    setHoloState(!holoEnabled);
}

function pressFeedback() {
    if (!animatePressFeedback) {
        return;
    }
    var originalScale = script.toggle_holo_btn.scale;
    script.toggle_holo_btn.scale = originalScale * pressScaleDown;

    var restoreEvent = script.createEvent("DelayedCallbackEvent");
    restoreEvent.bind(function() {
        script.toggle_holo_btn.scale = originalScale;
    });
    restoreEvent.reset(pressScaleRestoreDelay);
}

// Events
var onStart = script.createEvent("OnStartEvent");
onStart.bind(function() {
    // Ensure hologram starts off unless overridden
    setHoloState(startWithHoloOn);

    // Subscribe to button interactions
    script.toggle_holo_btn.onTap.add(function() {
        toggleHolo();
    });

    script.toggle_holo_btn.onPressStart.add(function() {
        pressFeedback();
    });
});

} catch(e) {
  print("error in controller");
  print(e);
}
