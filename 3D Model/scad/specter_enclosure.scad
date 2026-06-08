// =====================================================================
//  SPECTER  —  Chest-mounted ESP32 scanner enclosure
//  Parametric two-part case (base tray + front lid), M3 screw-closed.
//
//  Coordinate system:
//    X = width  (left  <->  right)        centered on 0
//    Y = height (bottom <-> top as worn)  centered on 0
//    Z = depth  (Z=0 back/chest  ->  Z=outer_d front/outer face)
//
//  HOW TO USE
//    Set  part = "base" | "lid" | "preview"  below, then render (F6).
//    - "preview"  shows both halves exploded for inspection.
//    - "base"     is print-ready, sits flat on its back (Z=0) on the bed.
//    - "lid"      is print-ready, lay it flat (front face down) on the bed.
//    Every dimension you might want to tweak lives in the PARAMETERS block.
//    When a cutout is off, change ONE number and re-render.
// =====================================================================

part = "base";          // "base" | "lid" | "preview"
$fn  = 64;                 // smoothness of curves

// ----- unit helper ----------------------------------------------------
function in(x) = x * 25.4; // inches -> millimeters

// =====================================================================
//  PARAMETERS
// =====================================================================

// ---- outer shell ----
outer_w      = 95;   // total width
outer_h      = 70;   // total height
outer_d      = 38;   // total depth (chest -> outer face)
corner_r     = 6;    // rounding of the faceted vertical corners
case_chamfer = 13;   // angled corner cut for the tactical/octagonal outline
wall         = 2.4;  // side wall thickness
back_thick   = 3.5;  // back plate (against chest) thickness
lid_thick    = 2.4;  // front face plate thickness

// ---- two-part split ----
base_depth   = 28;   // depth of the base tray (Z = 0 .. base_depth)
                     // lid then fills Z = base_depth .. outer_d
lip_h        = 4;    // alignment lip height rising from base into lid
lip_thick    = 1.6;  // thickness of that lip
lip_clear    = 0.25; // clearance so the lid drops over the lip
lip_root_h   = 1.2;  // anchored root height below the split plane
lip_root_ov  = 1.0;  // overlap into the base wall so the lip is supported

// ---- ESP32 board (ELEGOO ESP-32 USB-C) ----
esp_l        = 51.8; // along Y
esp_w        = 29.0; // along X
esp_standoff = 5.0;  // height the board floats above the back plate
esp_center_y = 3;    // shift board toward top so USB sits near top wall
post_d       = 4.5;  // diameter of the 4 corner cradle posts
post_clear   = 0.6;  // gap added around board so it drops in

// ---- USB-C port (exits the TOP wall, +Y) ----
usbc_slot_w  = 13;   // along X
usbc_slot_h  = 7;    // along Z
usbc_z       = 8;    // Z center of the slot (port height above back plate)
usbc_x       = 0;    // X center (nudge if your port is off-center)
usbc_cradle_w = 17;  // notch width through ESP32 guide frame
usbc_cradle_d = 8;   // notch depth through ESP32 guide frame

// ---- TFT 2.0" ST7789 LCD (landscape, mounts to lid) ----
// Common 2.0" ST7789 breakouts are about 58-59.2mm x 35-35.5mm,
// with a visible display area around 40.8mm x 30.6mm.
tft_board_w    = 59.5; // board keepout/reference width (X)
tft_board_h    = 36.0; // board keepout/reference height (Y)
tft_win_w      = 42.0; // visible window width (X), display + clearance
tft_win_h      = 31.6; // visible window height (Y), display + clearance
tft_bezel_w    = 50.0; // shallow front recess around the screen window
tft_bezel_h    = 36.0;
tft_bezel_depth = 0.6;
tft_x          = 0;    // window X center
tft_y          = 13.0; // top-middle screen position

// ---- Knob (Arduino Modulino ABX00107) ----
knob_dia     = 16;   // clearance hole for the knob cap/shaft
knob_x       = 0;    // X center
knob_y       = -19.25;  // Y center (lower area, thumb-reachable)

// ---- LEDs (legacy, not cut in the TFT lid) ----
led_dia        = 10.4;  // hole diameter (10 mm dome + clearance)
led_per_side   = 3;
led_edge_marg  = 19;    // distance of LED centers from the L/R edges
led_y_spacing  = 16;    // vertical gap between the 3 LEDs on a side
led_y_offset   = 0;     // vertical centering of the LED column

// ---- M3 corner screws ----
screw_inset    = 11;    // distance of screw centers from the corners
screw_clear    = 3.3;   // clearance hole through the lid
screw_pilot    = 2.5;   // self-tap pilot hole into the base bosses
boss_d         = 7;     // outer diameter of the screw bosses
head_d         = 6.0;   // counterbore diameter for the screw head
head_h         = 2.4;   // counterbore depth

// ---- front engraving (shallow recesses in the lid face) ----
engrave_on         = false;
engrave_depth      = 0.6;
engrave_font       = "Arial:style=Bold";
engrave_primary    = "REALITY HACK";
engrave_primary_y  = 29;
engrave_primary_sz = 4.2;
engrave_second     = "AWE 2026";
engrave_second_y   = 7;
engrave_second_sz  = 4.0;
engrave_third      = "MIT";
engrave_third_y    = -29;
engrave_third_sz   = 3.2;

// ---- strap slots (back plate, vertical webbing left & right) ----
strap_on       = true;  // set false to remove
strap_w        = 6;     // slot width (X) -> webbing thickness + clearance
strap_h        = 38;    // slot length (Y) -> your vest webbing width
strap_x        = 30;    // distance of each slot from center (left & right)

// =====================================================================
//  DERIVED VALUES  (no need to edit)
// =====================================================================
hw = outer_w/2;
hh = outer_h/2;
inner_w = outer_w - 2*wall;
inner_h = outer_h - 2*wall;
lid_d   = outer_d - base_depth;   // pure lid depth
eps = 0.01;                       // tiny overlap to keep cuts manifold

// screw center positions (4 corners)
screw_pts = [
  [ hw - screw_inset,  hh - screw_inset],
  [-hw + screw_inset,  hh - screw_inset],
  [ hw - screw_inset, -hh + screw_inset],
  [-hw + screw_inset, -hh + screw_inset]
];

// ESP32 corner-post positions
// Board is portrait: long axis (esp_l=51.8) along Y, short axis (esp_w=29) along X.
// USB-C port is on the +Y short end, pointing straight out through the top wall.
esp_pts = [
  [ esp_w/2 - 2,  esp_center_y + esp_l/2 - 2],
  [-esp_w/2 + 2,  esp_center_y + esp_l/2 - 2],
  [ esp_w/2 - 2,  esp_center_y - esp_l/2 + 2],
  [-esp_w/2 + 2,  esp_center_y - esp_l/2 + 2]
];

// =====================================================================
//  PRIMITIVES
// =====================================================================

// 2D rounded rectangle centered on origin
module rrect2d(w, h, r) {
    offset(r = r) square([w - 2*r, h - 2*r], center = true);
}

// Chamfer amount adjusted for outlines inset from the outer case.
function case_chamfer_for(w, h, r) =
    max(r + 0.5,
        min(case_chamfer - max((outer_w - w)/2, (outer_h - h)/2),
            min(w, h)/2 - 0.5));

// 2D rounded octagonal case footprint centered on origin.
module case2d(w, h, r) {
    cham = case_chamfer_for(w, h, r);
    core_w = w - 2*r;
    core_h = h - 2*r;
    core_cham = max(0.1, cham - r);

    offset(r = r)
        polygon(points = [
            [ core_w/2 - core_cham,  core_h/2],
            [-core_w/2 + core_cham,  core_h/2],
            [-core_w/2,               core_h/2 - core_cham],
            [-core_w/2,              -core_h/2 + core_cham],
            [-core_w/2 + core_cham, -core_h/2],
            [ core_w/2 - core_cham, -core_h/2],
            [ core_w/2,              -core_h/2 + core_cham],
            [ core_w/2,               core_h/2 - core_cham]
        ]);
}

// Solid rounded-corner prism, from z0 to z1
module shell_block(w, h, r, z0, z1) {
    translate([0, 0, z0])
        linear_extrude(height = z1 - z0)
            case2d(w, h, r);
}

// =====================================================================
//  CUTOUT TOOLS  (each is a solid to subtract)
// =====================================================================

module tft_bezel_recess() {
    translate([tft_x, tft_y, outer_d - tft_bezel_depth - eps])
        linear_extrude(height = tft_bezel_depth + 2*eps)
            rrect2d(tft_bezel_w, tft_bezel_h, 2.0);
}

module tft_window_cut() {
    translate([tft_x, tft_y, outer_d - lid_thick - eps])
        linear_extrude(height = lid_thick + 2*eps)
            rrect2d(tft_win_w, tft_win_h, 1.5);
}

module knob_cut() {
    translate([knob_x, knob_y, outer_d - lid_thick - eps])
        cylinder(h = lid_thick + 2*eps, d = knob_dia);
}

module led_cuts() {
    for (sx = [-1, 1])
        for (i = [0 : led_per_side - 1])
            translate([ sx * (hw - led_edge_marg),
                        led_y_offset + (i - (led_per_side-1)/2) * led_y_spacing,
                        outer_d - lid_thick - eps ])
                cylinder(h = lid_thick + 2*eps, d = led_dia);
}

module usbc_cut() {
    // slot through the TOP wall (+Y face)
    translate([usbc_x, hh - wall - eps, usbc_z])
        rotate([-90, 0, 0])
            linear_extrude(height = wall + 2*eps)
                rrect2d(usbc_slot_w, usbc_slot_h, 1.5);
}

module strap_cuts() {
    if (strap_on)
        for (sx = [-1, 1])
            translate([sx * strap_x, 0, -eps])
            linear_extrude(height = back_thick + 2*eps)
                    rrect2d(strap_w, strap_h, strap_w/2 - 0.01);
}

module engrave_line(label, y, size) {
    translate([0, y, outer_d - engrave_depth - eps])
        linear_extrude(height = engrave_depth + 2*eps)
            text(label, size = size, font = engrave_font,
                 halign = "center", valign = "center");
}

module engrave_cuts() {
    if (engrave_on) {
        engrave_line(engrave_primary, engrave_primary_y, engrave_primary_sz);
        engrave_line(engrave_second, engrave_second_y, engrave_second_sz);
        engrave_line(engrave_third, engrave_third_y, engrave_third_sz);
    }
}

// =====================================================================
//  HARDWARE FEATURES
// =====================================================================

// ESP32 cradle: 4 posts the board rests on + low guide walls
module esp_cradle() {
    // corner posts start at Z=0 so they merge through the back plate and
    // avoid near-coplanar faces at the cavity floor.
    for (p = esp_pts)
        translate([p[0], p[1], 0])
            cylinder(h = back_thick + esp_standoff, d = post_d);
    // thin guide frame; dimensions match portrait orientation
    difference() {
        translate([0, esp_center_y, 0])
            linear_extrude(height = back_thick + esp_standoff + 2.0)
                rrect2d(esp_w + 2*1.2, esp_l + 2*1.2, 1.5);
        translate([0, esp_center_y, 0])
            linear_extrude(height = back_thick + esp_standoff + 2.0 + eps)
                rrect2d(esp_w + 2*post_clear, esp_l + 2*post_clear, 1.0);
        translate([usbc_x,
                   esp_center_y + esp_l/2 + usbc_cradle_d/2 - 1,
                   -eps])
            linear_extrude(height = back_thick + esp_standoff + 2.0 + 2*eps)
                rrect2d(usbc_cradle_w, usbc_cradle_d, 1.5);
    }
}

// Screw boss in the base (solid post with pilot hole)
module base_bosses() {
    for (p = screw_pts)
        difference() {
            translate([p[0], p[1], 0])
                cylinder(h = base_depth, d = boss_d);
            translate([p[0], p[1], back_thick + 2])
                cylinder(h = base_depth, d = screw_pilot);
        }
}

// Alignment lip rising from the base top into the lid.
// A lower root overlaps the base wall for support; the raised lip remains
// inset by lip_clear so the lid can slide over it.
module align_lip() {
    union() {
        // Root overlaps the base wall below the split so the raised lip is not
        // a separate floating ring.
        translate([0, 0, base_depth - lip_root_h])
        difference() {
            linear_extrude(height = lip_root_h - eps)
                rrect2d(inner_w + 2*lip_root_ov,
                        inner_h + 2*lip_root_ov,
                        max(0.5, corner_r - wall + lip_root_ov));
            translate([0, 0, -eps])
            linear_extrude(height = lip_root_h + eps)
                rrect2d(inner_w - 2*lip_clear - 2*lip_thick,
                        inner_h - 2*lip_clear - 2*lip_thick,
                        max(0.5, corner_r - wall - lip_thick));
        }

        translate([0, 0, base_depth - 2*eps])
        difference() {
            linear_extrude(height = lip_h + 2*eps)
                rrect2d(inner_w - 2*lip_clear, inner_h - 2*lip_clear,
                        max(0.5, corner_r - wall));
            translate([0, 0, -eps])
            linear_extrude(height = lip_h + 4*eps)
                rrect2d(inner_w - 2*lip_clear - 2*lip_thick,
                        inner_h - 2*lip_clear - 2*lip_thick,
                        max(0.5, corner_r - wall - lip_thick));
        }
    }
}


// =====================================================================
//  BASE  (back + walls + tray, Z = 0 .. base_depth)
// =====================================================================
module base() {
    union() {
        // shell with the cavity and external cuts removed
        difference() {
            shell_block(outer_w, outer_h, corner_r, 0, base_depth);
            // hollow the cavity: spans back_thick .. base_depth (stops at split)
            translate([0, 0, back_thick])
                shell_block(inner_w, inner_h, max(0.5, corner_r - wall),
                            0, base_depth - back_thick + eps);
            usbc_cut();
            strap_cuts();
        }
        // internal features added back AFTER hollowing so they survive
        esp_cradle();
        base_bosses();
        align_lip();
    }
}

// =====================================================================
//  LID  (front face, Z = base_depth .. outer_d)
// =====================================================================
module lid() {
    difference() {
        union() {
            // outer shell of the lid
            shell_block(outer_w, outer_h, corner_r, base_depth, outer_d);
        }
        // hollow the inside of the lid (leave lid_thick front face + walls).
        // This cavity also receives the base's alignment lip with clearance.
        translate([0, 0, base_depth - eps])
            shell_block(inner_w, inner_h, max(0.5, corner_r - wall),
                        0, lid_d - lid_thick + eps);
        // face cutouts
        tft_bezel_recess();
        tft_window_cut();
        knob_cut();
        engrave_cuts();
        // screw clearance holes + counterbores (from the front)
        for (p = screw_pts) {
            translate([p[0], p[1], base_depth - eps])
                cylinder(h = lid_d + 2*eps, d = screw_clear);
            translate([p[0], p[1], outer_d - head_h])
                cylinder(h = head_h + eps, d = head_d);
        }
    }
}

// =====================================================================
//  RENDER SELECTOR
// =====================================================================
if (part == "base") base();
else if (part == "lid") lid();
else {
    // preview: base in place, lid lifted up the Z axis (exploded)
    base();
    color("LightSteelBlue", 0.85)
        translate([0, 0, 22]) lid();
}
