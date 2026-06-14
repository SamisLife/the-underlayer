// =====================================================================
//  SPECTER — Replacement Boss Insert + Printed Bolt
//
//  Replaces the integral corner bosses in the base that printed rough
//  or broke.  Super-glue the inserts in place, then screw the lid down
//  with the printed bolts.
//
//  REQUIRED CHANGES in specter_enclosure.scad (already applied below):
//    screw_clear = 5.5;   // was 3.3  — fits 5 mm thread crest through lid
//    head_d      = 10.5;  // was 6.0  — fits 10 mm round bolt head
//    head_h      = 4.5;   // was 2.4  — deeper seat for round head
//
//  ASSEMBLY:
//    1. Print 4 × insert (or run part="plate" for one bed).
//    2. Print 4 × bolt.
//    3. Clean up old boss stumps in the base with a file/hobby knife.
//    4. Super-glue each insert upright at the four screw_pts corners.
//       Flat bottom sits on the back plate floor.
//    5. Drop the lid on.  Push a bolt through each 5.5 mm lid hole
//       from the front face.  Screw finger-tight into the insert.
//
//  PRINT SETTINGS:
//    Inserts : upright on bed (cylinder axis = Z).
//              0.15 mm layers, ≥ 4 perimeters, 40 % infill.
//    Bolts   : head face down on bed (smooth bearing surface).
//              0.15 mm layers, ≥ 4 perimeters.
//    No supports needed for either part.
// =====================================================================

part = "bolt";   // "insert" | "bolt" | "both" | "plate"
$fn  = 64;

// ── Thread geometry ────────────────────────────────────────────────────────────
//
//  Custom coarse FDM thread — much larger pitch than real metric so the
//  layer lines don't destroy the tooth shape.
//
//  Nominal (major) OD : 5.0 mm — must slip through the 5.5 mm lid hole.
//  Minor OD           : 3.6 mm — same as smooth shaft; threads protrude outward.
//  Pitch              : 2.5 mm — one full turn every 2.5 mm of travel.
//  Tooth height       : (5.0 - 3.6) / 2 = 0.7 mm per side.
//  Diametral clearance: 0.6 mm total (0.3 mm per side) for bolt → insert.

T_MAJOR   = 5.0;   // bolt thread crest OD
T_MINOR   = 3.6;   // bolt thread valley OD  =  shaft OD
T_PITCH   = 2.5;   // mm per turn
T_CLEAR   = 0.6;   // total diametral clearance
T_ENGAGE  = 12.0;  // thread engagement length inside insert

// Derived — do not edit
_tooth    = (T_MAJOR - T_MINOR) / 2;              // 0.7 mm
_b_hr     = (T_MAJOR + T_MINOR) / 4;             // bolt helix centre radius
_b_br     = _tooth / 2;                           // bolt ball radius
_n_crest  = T_MINOR + T_CLEAR;                    // insert tight bore  (4.2)
_n_valley = T_MAJOR + T_CLEAR;                    // insert wide valley (5.6)
_n_hr     = (_n_crest + _n_valley) / 4;           // nut helix centre radius
_n_br     = (_n_valley - _n_crest) / 4;           // nut ball radius

// ── Insert dimensions ──────────────────────────────────────────────────────────
INSERT_OD      = 10.0;   // outer diameter — large enough for good glue surface
INSERT_H       = 22.0;   // height of insert (sits inside base from floor to top)
INSERT_ENTRY_D = 5.8;    // smooth lead-in bore at the top (> thread crest)
INSERT_ENTRY_H =  3.0;   // depth of lead-in section

// ── Bolt dimensions ────────────────────────────────────────────────────────────
BOLT_HEAD_D    = 10.0;  // round head diameter (cannot pull through 5.5 mm hole)
BOLT_HEAD_H    =  4.5;  // head height (matches new head_h in main SCAD)
BOLT_SHAFT_L   =  8.0;  // no smooth shaft — threads start directly under head

eps = 0.01;

// ── Thread helix generator ─────────────────────────────────────────────────────
//  Produces a helical "rope" of hull()-ed spheres.
//  Add this to create male thread ridges on a shaft.
//  Subtract this to create female thread valleys in a bore.
module thread_helix(r, pitch, length, ball_r) {
    spt  = 18;   // segments per turn: more = smoother, slower to render
    segs = ceil((length / pitch) + 1) * spt;
    for (i = [0 : segs - 1]) {
        z0 = i       * pitch / spt;
        z1 = (i + 1) * pitch / spt;
        if (z0 < length) {
            hull() {
                rotate([0, 0, i       * 360 / spt])
                    translate([r, 0, z0])
                        sphere(r = ball_r, $fn = 6);
                rotate([0, 0, (i + 1) * 360 / spt])
                    translate([r, 0, z1])
                        sphere(r = ball_r, $fn = 6);
            }
        }
    }
}

// ── Boss insert (female thread) ────────────────────────────────────────────────
module bolt_insert() {
    difference() {
        // Solid outer cylinder — super-glue bonds to this surface
        cylinder(d = INSERT_OD, h = INSERT_H);

        // Lead-in bore at the top: smooth, wider than thread crests so the
        // bolt tip enters easily before threads engage.
        translate([0, 0, INSERT_H - INSERT_ENTRY_H])
            cylinder(d = INSERT_ENTRY_D, h = INSERT_ENTRY_H + eps);

        // Funnel chamfer bridging lead-in to thread bore (guides bolt start).
        translate([0, 0, INSERT_H - INSERT_ENTRY_H - 2.0])
            cylinder(d1 = _n_crest, d2 = INSERT_ENTRY_D, h = 2.0 + eps);

        // Core bore at nut-crest diameter (tight sections between thread teeth).
        translate([0, 0, -eps])
            cylinder(d = _n_crest, h = T_ENGAGE + eps);

        // Helical valleys cut into the bore to form female thread teeth.
        translate([0, 0, -eps])
            thread_helix(
                r      = _n_hr,
                pitch  = T_PITCH,
                length = T_ENGAGE + 2 * eps,
                ball_r = _n_br
            );
    }
}

// ── Printed bolt (male thread) ─────────────────────────────────────────────────
module printed_bolt() {
    // Round head — sits in the lid counterbore or flush on the lid face.
    // Wide enough that it can never pull through the 5.5 mm clearance hole.
    cylinder(d = BOLT_HEAD_D, h = BOLT_HEAD_H);

    // Smooth shaft — passes through the lid clearance hole without threading it.
    // Shaft OD = T_MINOR so there is no step down to the thread valley.
    translate([0, 0, BOLT_HEAD_H])
        cylinder(d = T_MINOR, h = BOLT_SHAFT_L);

    // Threaded tip: minor-diameter core + helical ridges protruding outward.
    translate([0, 0, BOLT_HEAD_H + BOLT_SHAFT_L]) {
        // Core (valley) cylinder
        cylinder(d = T_MINOR, h = T_ENGAGE);

        // Male thread ridges
        thread_helix(
            r      = _b_hr,
            pitch  = T_PITCH,
            length = T_ENGAGE,
            ball_r = _b_br
        );

        // Lead-in chamfer at the very tip: tapers from a point up to T_MINOR,
        // so the bolt self-centres into the insert bore.
        translate([0, 0, -eps])
            cylinder(d1 = 1.5, d2 = T_MINOR, h = 2.5 + eps);
    }
}

// ── Render ─────────────────────────────────────────────────────────────────────
if (part == "insert") {
    bolt_insert();

} else if (part == "bolt") {
    printed_bolt();

} else if (part == "both") {
    // Side-by-side preview
    bolt_insert();
    translate([INSERT_OD + 8, 0, 0])
        printed_bolt();

} else if (part == "plate") {
    // One print bed: 4 inserts (back row) + 4 bolts (front row).
    // All parts print without support in these orientations.
    for (i = [0 : 3])
        translate([i * (INSERT_OD + 4), 0, 0])
            bolt_insert();
    for (i = [0 : 3])
        translate([i * (INSERT_OD + 4), INSERT_OD + 8, 0])
            printed_bolt();
}
