// =====================================================================
//  Ender 3 circle / first-layer test
//
//  Export this as STL and slice it flat on the bed.
//  It should print quickly and reveal whether circles are actually round.
// =====================================================================

$fn = 96;

// ---- parameters ------------------------------------------------------
plate_d      = 60;    // overall round test plate diameter
plate_h      = 1.2;   // about 4-6 layers at common layer heights

big_hole_d   = 25;
mid_hole_d   = 16;
led_hole_d   = 10.4;  // same as Specter LED holes
small_hole_d = 5;

boss_d       = 10.4;  // raised circle, same diameter as LED hole
boss_h       = 1.0;

eps = 0.01;

// ---- model -----------------------------------------------------------
module circle_test() {
    difference() {
        cylinder(h = plate_h, d = plate_d);

        // Center reference hole.
        translate([0, 0, -eps])
            cylinder(h = plate_h + 2*eps, d = big_hole_d);

        // Holes similar to the enclosure features.
        translate([-18, 0, -eps])
            cylinder(h = plate_h + 2*eps, d = led_hole_d);

        translate([18, 0, -eps])
            cylinder(h = plate_h + 2*eps, d = mid_hole_d);

        translate([0, 20, -eps])
            cylinder(h = plate_h + 2*eps, d = small_hole_d);
    }

    // Raised circular boss: should print as a clean round island.
    translate([0, -20, plate_h - eps])
        cylinder(h = boss_h + eps, d = boss_d);
}

circle_test();
