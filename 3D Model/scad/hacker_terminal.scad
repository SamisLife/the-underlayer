// =============================================================
//  Linux Shell Terminal Window  —  OpenSCAD 3D Relief Panel
//  Modeled after kitty / bash on Ubuntu GNOME
//  210 × 150 × 5 mm flat panel with raised text relief
//
//  F5  = fast preview
//  F6  = full render  →  File → Export as STL
//  Best view: Camera → Top  (rotate=[0,0,0])
//
//  To customize: edit the CONTENT section near the bottom.
// =============================================================

$fn = 48;

// ── Panel dimensions ─────────────────────────────────────────
PW   = 210;     // width  mm
PH   = 150;     // height mm
PD   =   5;     // thickness mm
CR   =   7;     // corner radius
TB   =  18;     // title bar height
PADX =   8;     // left/right text margin
PADY =   4;     // margin below separator

// ── Typography ───────────────────────────────────────────────
FONT = "Liberation Mono:style=Regular";
FS   = 3.2;           // font size (mm)
LH   = 5.2;           // line height (mm)
TE   = 1.0;           // text extrusion height (mm)
CW   = FS * 0.601;    // monospace character width estimate

// ── Colors (preview only — irrelevant for single-material print) ──
C_PANEL  = [0.07, 0.07, 0.07];   // window body
C_TBAR   = [0.15, 0.15, 0.15];   // title bar
C_RIDGE  = [0.30, 0.30, 0.30];   // separator ridge
C_BORDER = [0.22, 0.22, 0.22];   // outer border ring
C_WHITE  = [0.90, 0.90, 0.87];   // normal output text
C_GREEN  = [0.22, 0.84, 0.22];   // prompt / commands
C_CYAN   = [0.20, 0.82, 1.00];   // directory names / highlights
C_DIM    = [0.50, 0.50, 0.50];   // secondary metadata
C_CLOSE  = [0.90, 0.24, 0.18];   // close button
C_MIN    = [0.94, 0.73, 0.08];   // minimize button
C_MAX    = [0.20, 0.72, 0.20];   // maximize button

// ── Helpers ──────────────────────────────────────────────────
// Y of the baseline for content line N  (line 0 = topmost)
function lY(n) = PH - TB - PADY - (n + 1) * LH;

// X of character column C inside the content area
function cX(c) = PADX + c * CW;

// ── Rounded panel profile (2D) ───────────────────────────────
module panel_profile() {
    hull()
        for (x = [CR, PW - CR]) for (y = [CR, PH - CR])
            translate([x, y]) circle(r = CR);
}

// ── Panel base ───────────────────────────────────────────────
module panel_base() {
    color(C_PANEL)
    linear_extrude(PD)
        panel_profile();
}

// ── Title bar tint (clipped to rounded top) ──────────────────
module title_bar() {
    color(C_TBAR)
    intersection() {
        // Title bar zone
        translate([0, PH - TB, PD - 0.02])
        linear_extrude(0.55)
            square([PW, TB + 1]);
        // Clip to panel shape
        linear_extrude(PD + 1)
            panel_profile();
    }

    // Separator ridge between title bar and content
    color(C_RIDGE)
    translate([0, PH - TB - 0.6, PD + 0.5])
    linear_extrude(0.5)
        square([PW, 1.2]);
}

// ── Window control buttons (GNOME-style: right side) ─────────
module win_buttons() {
    by  = PH - TB * 0.5;
    bxs = [PW - 14, PW - 28, PW - 42];
    bcs = [C_CLOSE, C_MIN, C_MAX];

    for (i = [0 : 2]) {
        color(bcs[i])
        translate([bxs[i], by, PD + 0.5])
            cylinder(h = TE, r = 4.6, $fn = 32);
    }

    // × glyph on close button
    color([1, 1, 1, 0.70])
    translate([bxs[0], by, PD + 0.5 + TE])
    linear_extrude(0.4)
        text("×", size = 5.8, font = "Liberation Sans:style=Regular",
             halign = "center", valign = "center");
}

// ── Title bar text ───────────────────────────────────────────
module title_text() {
    color(C_WHITE)
    translate([PADX, PH - TB + (TB - FS) * 0.45, PD + 0.6])
    linear_extrude(TE)
        text(TITLE, size = FS, font = FONT, valign = "bottom");
}

// ── Generic content line ─────────────────────────────────────
module tl(str, col, n) {
    color(col)
    translate([PADX, lY(n), PD - 0.1])
    linear_extrude(TE)
        text(str, size = FS, font = FONT, valign = "bottom");
}

// ── Cursor block ─────────────────────────────────────────────
module cursor_block(n, char_col) {
    color(C_WHITE, 0.85)
    translate([cX(char_col), lY(n), PD - 0.1])
    linear_extrude(TE)
        square([CW, FS * 1.15]);
}

// =============================================================
//  CONTENT  —  add your commands below using tl()
//
//  tl("your text here", C_GREEN, line_number);
//
//  Line numbers start at 0 (top). Each line is 5.2 mm apart.
//  Use C_GREEN for commands, C_WHITE for output.
// =============================================================

TITLE = "ubuntu@tecmint: ~";

// ── Export mode ───────────────────────────────────────────────
// Change PART to isolate one group, then File → Export → STL.
// Do this 3 times (once per part) to get 3 separate STL files.
//
//   "all"    — full preview (default, use for F5/F6)
//   "panel"  — dark background + chrome  → export as panel.stl
//   "text"   — white prompt + cursor     → export as text.stl
//   "green"  — green command lines only  → export as green.stl
PART = "all";

module terminal() {
    if (PART == "all" || PART == "panel") {
        panel_base();
        title_bar();
        win_buttons();
    }
    if (PART == "all" || PART == "text") {
        title_text();
        tl("ubuntu@tecmint:~$", C_WHITE, 0);
        cursor_block(0, 18);
    }

    // ── Add your command lines below ──────────────────────────
    // Wrap them in the green block so they export separately.
    if (PART == "all" || PART == "green") {
        // tl("your command here", C_GREEN, 1);
        // tl("output line",       C_WHITE, 2);
    }
}

// =============================================================
terminal();
