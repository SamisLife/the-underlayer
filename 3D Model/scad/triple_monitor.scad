// =====================================================================
//  TRIPLE MONITOR FLOATING CLUSTER  —  AR / XR Hacker Workstation
//
//  Three monitors connected by an industrial back-brace, floating in
//  space with no desk or base. A single data-tether cylinder drops
//  straight down from the central hub.
//
//  Coordinate system
//    X = width  (left <-> right), centred on 0
//    Y = height (bottom <-> top)
//    Z = depth  (back = -Z, front = +Z)
//    Every monitor is centred at its own world position;
//    the centre monitor sits at the world origin.
//    Front faces point in +Z; screens are slightly recessed below
//    the bezel so you can place AR / holographic text exactly on the
//    screen surface.
//
//  Export
//    F6 to render, then File > Export > STL or 3MF.
//    Set `part` before rendering to isolate components.
// =====================================================================

part = "all";   // "all" | "monitors" | "brace" | "tether"
$fn  = 48;

// =====================================================================
//  PARAMETERS  — tweak freely
// =====================================================================

// -- Central monitor --
c_w            = 340;    // width  (mm)
c_h            = 145;    // height (mm)
c_d            = 28;     // front-to-back depth

// -- Side monitors (identical symmetric pair) --
s_w            = 240;    // width
s_h            = 145;    // height — keep equal to c_h for flush top/bottom
s_d            = 24;     // depth (slightly slimmer than centre)

// -- Common to all monitors --
bezel_t        = 7;      // bezel width on all four edges
screen_recess  = 2.5;    // how far the screen surface sits below the bezel face

// -- Layout --
side_angle     = 35;     // inward rotation angle for each side monitor (degrees)
side_gap       = 4;      // gap between centre-monitor edge and side-monitor inner edge

// -- Back-panel sci-fi detail --
vent_w         = 48;     // width of each ventilation slot
vent_h         = 3.5;    // height of each ventilation slot
vent_depth     = 1.0;    // how deep each slot is cut
vent_count     = 6;      // number of slots per cluster (two clusters per monitor)
vent_step      = 6.0;    // Y spacing between slot centres
groove_depth   = 0.8;    // depth of decorative groove lines

// -- Back brace --
br_r           = 5.0;    // main structural tube radius
br_r2          = 3.5;    // secondary / diagonal tube radius
node_r         = 8.5;    // junction sphere radius
pad_r          = 10.0;   // mounting-pad radius (disc against monitor back)
pad_h          = 3.5;    // mounting-pad height

// -- Data tether --
tether_r          = 4.5;  // cable cylinder radius
tether_len        = 220;  // total length of the main tether (both segments combined)
tether_junc_above = 25;   // how far above the monitor top the junction node sits
tether_seg1_angle = 70;   // angle of first segment from horizontal (degrees); 90 = straight up
tether_seg1_frac  = 0.42; // fraction of tether_len consumed by the first (angled) segment

// =====================================================================
//  DERIVED  — do not edit
// =====================================================================

eps = 0.02;

// World X of each side-monitor's inner vertical edge (= rotation pivot)
r_pivot_x =  c_w/2 + side_gap;
l_pivot_x = -(c_w/2 + side_gap);

// World position of the inner-edge back-face mid-point of each side monitor.
//
// Transform chain for the right monitor:
//   translate([r_pivot_x, 0, 0])
//     rotate([0, -side_angle, 0])
//       translate([s_w/2, 0, 0])        <- shifts inner edge to X=0
//         monitor centred at origin     <- back face at z = -s_d/2
//
// The inner-edge back point in the intermediate frame (after first translate)
// is (0, ±s_h/2, -s_d/2).
// Rotation matrix for Y-axis rotation by angle a:
//   x' =  x*cos(a) + z*sin(a)
//   z' = -x*sin(a) + z*cos(a)
// With a = -side_angle, x = 0, z = -s_d/2:
//   x' = (s_d/2)*sin(side_angle)
//   z' = -(s_d/2)*cos(side_angle)
// Then add r_pivot_x for world X.
r_ib_x =  r_pivot_x + (s_d/2)*sin(side_angle);
r_ib_z = -(s_d/2)*cos(side_angle);
l_ib_x = -r_ib_x;   // symmetric
l_ib_z =  r_ib_z;

// =====================================================================
//  MONITOR BODY
// =====================================================================

// Single monitor block centred at origin, front face at +Z = d/2.
// The screen area is a rectangular pit in that front face.
module monitor_body(w, h, d) {
    difference() {
        cube([w, h, d], center = true);
        // Recessed screen area (sits below the bezel face)
        translate([0, 0, (d - screen_recess) / 2])
            cube([w - 2*bezel_t, h - 2*bezel_t, screen_recess + eps], center = true);
    }
}

// Vent slots cut into the back face  (call inside difference{})
module back_vents(w, h, d) {
    for (sx = [-1, 1])
        for (i = [0 : vent_count - 1]) {
            y = (i - (vent_count - 1) / 2.0) * vent_step;
            // Start just outside the back face; extrude inward (+Z)
            translate([sx * w / 4, y, -d/2 - eps])
                linear_extrude(vent_depth + eps)
                    square([vent_w, vent_h], center = true);
        }
}

// Geometric groove lines on the back face  (call inside difference{})
module back_grooves(w, h, d) {
    bz = -d/2 - eps;
    gd = groove_depth + eps;
    // Horizontal dividers
    for (y = [-h/4, h/4])
        translate([0, y, bz])
            linear_extrude(gd)
                square([w - 6, groove_depth], center = true);
    // Vertical centre line
    translate([0, 0, bz])
        linear_extrude(gd)
            square([groove_depth, h - 6], center = true);
    // 45-degree accent marks near each corner (tactical panel look)
    for (sx = [-1, 1]) for (sy = [-1, 1])
        translate([sx*(w/2 - 10), sy*(h/2 - 10), bz])
            rotate([0, 0, 45])
                linear_extrude(gd)
                    square([14, groove_depth], center = true);
}

// Full monitor with all details
module monitor_full(w, h, d) {
    difference() {
        monitor_body(w, h, d);
        back_vents(w, h, d);
        back_grooves(w, h, d);
    }
}

// =====================================================================
//  BRACE PRIMITIVES
// =====================================================================

// Smooth rounded tube: hull of two sphere caps
module tube(a, b, r) {
    hull() {
        translate(a) sphere(r = r, $fn = 12);
        translate(b) sphere(r = r, $fn = 12);
    }
}

// Solid junction node
module jnode(p, r) {
    translate(p) sphere(r = r, $fn = 16);
}

// Flat disc mounting pad that protrudes behind a back face.
// p = a point on the back face; pad extends in −Z.
module mpad(p) {
    translate([p[0], p[1], p[2] - pad_h])
        cylinder(r = pad_r, h = pad_h, $fn = 24);
}

// =====================================================================
//  BACK BRACE SYSTEM
// =====================================================================

module back_brace() {
    c_bz = -c_d / 2;         // Z of centre monitor back face
    t_y  =  c_h/2 - 12;      // top rail Y  (inset from monitor edge)
    b_y  = -(c_h/2 - 12);    // bottom rail Y
    xi   =  c_w/2 - 14;      // X inset of rail corners

    // Four corner attachment points on centre monitor back
    TL = [-xi,  t_y, c_bz];
    TR = [ xi,  t_y, c_bz];
    BL = [-xi,  b_y, c_bz];
    BR = [ xi,  b_y, c_bz];
    // Central hub node — pulled 8 mm further behind the back face
    HB = [0, 0, c_bz - 8];

    // Rectangular frame on centre monitor back
    tube(TL, TR, br_r);  tube(BL, BR, br_r);
    tube(TL, BL, br_r);  tube(TR, BR, br_r);
    // Diagonal X-cross bracing
    tube(TL, BR, br_r2);  tube(TR, BL, br_r2);
    // Spars from all four corners into the central hub
    for (p = [TL, TR, BL, BR]) tube(p, HB, br_r2);

    // Hub and corner nodes + mounting pads
    jnode(HB, node_r);
    for (p = [TL, TR, BL, BR]) { jnode(p, node_r*0.75); mpad(p); }

    // ── Right articulating arm ─────────────────────────────────────
    RT = [r_ib_x, t_y, r_ib_z];   // upper attachment on right side monitor
    RB = [r_ib_x, b_y, r_ib_z];   // lower attachment on right side monitor

    tube(TR, RT, br_r2);           // upper diagonal arm
    tube(BR, RB, br_r2);           // lower diagonal arm
    tube(TR, RB, br_r2 * 0.75);    // cross brace between the two arms
    tube(RT, RB, br_r2);           // vertical spar along side monitor inner edge

    jnode(RT, node_r*0.75);  mpad(RT);
    jnode(RB, node_r*0.75);  mpad(RB);

    // ── Left articulating arm (mirror) ────────────────────────────
    LT = [l_ib_x, t_y, l_ib_z];
    LB = [l_ib_x, b_y, l_ib_z];

    tube(TL, LT, br_r2);
    tube(BL, LB, br_r2);
    tube(TL, LB, br_r2 * 0.75);
    tube(LT, LB, br_r2);

    jnode(LT, node_r*0.75);  mpad(LT);
    jnode(LB, node_r*0.75);  mpad(LB);
}

// =====================================================================
//  DATA TETHER
//
//  Structure (two segments, one junction):
//    • Main tether  — exits straight up (+Y) from a junction node that
//                     floats just above the monitor cluster.
//    • Branch tether — drops from that same junction node straight down
//                     to the centre of the centre monitor's back face,
//                     where a tapered plug sits as a port connection.
// =====================================================================

module data_tether() {
    c_bz = -c_d / 2;
    jy   = c_h/2 + tether_junc_above;
    J    = [0, jy, c_bz];

    // Segment lengths from the total budget
    seg1_len = tether_len * tether_seg1_frac;
    seg2_len = tether_len * (1 - tether_seg1_frac);

    // ── Segment 1 — rises at tether_seg1_angle from horizontal, in YZ plane.
    //    Both sin/cos in OpenSCAD take degrees.
    //      dy = sin(angle) * len  → upward travel
    //      dz = -cos(angle) * len → backward tilt (away from user, deeper in -Z)
    knee_y = jy  + sin(tether_seg1_angle) * seg1_len;
    knee_z = c_bz - cos(tether_seg1_angle) * seg1_len;
    knee   = [0, knee_y, knee_z];
    tube(J, knee, tether_r);

    // ── Segment 2 — rises straight vertical (90° from horizontal).
    top = [0, knee_y + seg2_len, knee_z];
    tube(knee, top, tether_r);

    // Knee elbow node
    translate(knee) sphere(r = tether_r * 1.9, $fn = 16);

    // ── Branch — drops from junction to centre of monitor back face ─
    BC = [0, 0, c_bz];
    tube(J, BC, tether_r * 0.72);
    // Tapered connector plug at the back-face end
    translate(BC)
        cylinder(r1 = tether_r*2.4, r2 = tether_r*0.9, h = 7, $fn = 24);

    // ── Junction connector ring (perpendicular to the rising cable) ─
    translate(J)
        rotate([90, 0, 0])
            difference() {
                cylinder(r = tether_r*2.8, h = 6, center = true, $fn = 24);
                cylinder(r = tether_r*1.3, h = 7, center = true, $fn = 24);
            }
}

// =====================================================================
//  MONITORS ASSEMBLY
// =====================================================================

module monitors() {
    // Central monitor — already at world origin
    monitor_full(c_w, c_h, c_d);

    // Right side monitor
    //   1. translate([s_w/2, 0, 0])  — shift so inner (left) edge is at X=0
    //   2. rotate([0, -side_angle, 0])  — tilt face inward (-Y rotation for right)
    //   3. translate([r_pivot_x, 0, 0]) — move pivot to world position
    translate([r_pivot_x, 0, 0])
        rotate([0, -side_angle, 0])
            translate([s_w/2, 0, 0])
                monitor_full(s_w, s_h, s_d);

    // Left side monitor (mirror: +Y rotation, negative pivot X)
    translate([l_pivot_x, 0, 0])
        rotate([0, side_angle, 0])
            translate([-s_w/2, 0, 0])
                monitor_full(s_w, s_h, s_d);
}

// =====================================================================
//  RENDER SELECTOR
// =====================================================================

if (part == "all" || part == "monitors") monitors();
if (part == "all" || part == "brace")    back_brace();
if (part == "all" || part == "tether")   data_tether();
