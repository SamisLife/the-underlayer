// =============================================================
//  Vulnerability Notebook  —  OpenSCAD 3D Panel
//  Single-page notepad, portrait orientation  130 × 185 × 7 mm
//
//  F5 = preview · F6 = render · File → Export as STL
//  Text is added at runtime — this is the blank shell.
// =============================================================

$fn = 32;

// ── Dimensions ───────────────────────────────────────────────
NW  = 130;
NH  = 185;
ND  =   5;    // cover thickness
PR  =   2;    // page rise above cover
CR  =   5;    // corner radius

// ── Layout zones ─────────────────────────────────────────────
BIND_H  = 16;   // spiral binding strip
PADY    =  5;   // top/bottom content margin

// ── Z levels ─────────────────────────────────────────────────
ZC = ND;
ZP = ND + PR;

// ── Colors ───────────────────────────────────────────────────
C_COVER  = [0.11, 0.11, 0.13];
C_BIND   = [0.08, 0.08, 0.10];
C_PAGE   = [0.96, 0.94, 0.89];
C_RING   = [0.48, 0.50, 0.55];
C_MARGIN = [0.82, 0.48, 0.48];
C_RULE   = [0.72, 0.80, 0.92];

// ── Cover ────────────────────────────────────────────────────
module cover() {
    color(C_COVER)
    linear_extrude(ND)
    hull()
        for (x = [CR, NW - CR]) for (y = [CR, NH - CR])
            translate([x, y]) circle(r = CR);
}

// ── Cream page ───────────────────────────────────────────────
module page() {
    inset = 3;
    color(C_PAGE)
    translate([inset, inset, ZC - 0.1])
    linear_extrude(PR + 0.1)
        square([NW - inset * 2, NH - inset * 2]);
}

// ── Binding strip ────────────────────────────────────────────
module binding_strip() {
    color(C_BIND)
    translate([0, NH - BIND_H, ZC - 0.1])
    linear_extrude(PR + ND * 0.3 + 0.1)
        square([NW, BIND_H]);
}

// ── Spiral rings ─────────────────────────────────────────────
RING_N = 8;
module rings() {
    pitch = NW / (RING_N + 1);
    by    = NH - BIND_H / 2;
    bz    = ZC + PR * 0.4;
    for (i = [1 : RING_N]) {
        color(C_RING)
        translate([i * pitch, by, bz])
        rotate([90, 0, 0])
        difference() {
            cylinder(h = BIND_H * 0.55, r = 3.8, center = true, $fn = 22);
            cylinder(h = BIND_H * 0.70, r = 2.3, center = true, $fn = 22);
        }
    }
}

// ── Red margin line ───────────────────────────────────────────
module margin_line() {
    color(C_MARGIN, 0.8)
    translate([20, PADY, ZP - 0.05])
    linear_extrude(0.4)
        square([0.7, NH - BIND_H - PADY * 2]);
}

// ── Ruled lines ───────────────────────────────────────────────
module ruled_lines() {
    LH = 6.2;
    color(C_RULE, 0.85)
    for (n = [0 : 18]) {
        y = NH - BIND_H - PADY - (n + 1) * LH;
        if (y > PADY)
            translate([5, y, ZP - 0.05])
            linear_extrude(0.2)
                square([NW - 10, 0.6]);
    }
}

// ── Assembly ─────────────────────────────────────────────────
module notebook() {
    cover();
    page();
    binding_strip();
    rings();
    margin_line();
    ruled_lines();
}

notebook();
