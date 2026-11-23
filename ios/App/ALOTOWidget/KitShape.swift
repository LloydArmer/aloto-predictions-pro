//
//  KitShape.swift
//  ALOTOWidget
//
//  Draws a football kit from the same spec string the web app uses:
//
//      pattern:primary[:secondary[:sleeve[:shorts]]]
//
//      stripes:#e63946:#ffffff                    shirt and pattern
//      stripes:#e63946:#ffffff:#1a1a1a            + sleeves
//      stripes:#e63946:#ffffff:#1a1a1a:#1a1a1a    + shorts
//
//  Drawn rather than shipped as images so a kit looks identical on the lock
//  screen and in the app, and so adding a pattern needs no new assets. The
//  coordinates match the SVG in Shirt.jsx exactly, on the same 48-wide grid.
//
//  Sleeves and shorts are optional: a spec saved before they existed still
//  parses, with sleeves matching the shirt and no shorts.
//

import SwiftUI

struct Kit {
    let pattern: String
    let primary: Color
    let secondary: Color
    /// nil means "same as the shirt", which is what most kits are.
    let sleeve: Color?
    /// nil means no shorts — the shirt is drawn on its own.
    let shorts: Color?

    /// Returns nil for anything malformed, so a bad value shows initials
    /// rather than a broken shape.
    static func parse(_ spec: String?) -> Kit? {
        guard let spec, !spec.isEmpty else { return nil }
        let parts = spec.split(separator: ":").map(String.init)
        guard parts.count >= 2 else { return nil }

        let valid = ["plain", "stripes", "hoops", "halves", "sash", "quarters"]
        guard valid.contains(parts[0]) else { return nil }
        guard let primary = Color(hex: parts[1]) else { return nil }

        let secondary = parts.count > 2 ? (Color(hex: parts[2]) ?? .white) : .white

        // Both optional. An older three-part spec falls through with nil for
        // each, which draws exactly as it always did.
        let sleeve = parts.count > 3 ? Color(hex: parts[3]) : nil
        let shorts = parts.count > 4 ? Color(hex: parts[4]) : nil

        return Kit(pattern: parts[0], primary: primary, secondary: secondary,
                   sleeve: sleeve, shorts: shorts)
    }
}

extension Color {
    /// "#e63946" to a Color. Nil if it isn't six hex digits.
    init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt64(s, radix: 16) else { return nil }
        self.init(
            .sRGB,
            red:   Double((v >> 16) & 0xFF) / 255,
            green: Double((v >> 8)  & 0xFF) / 255,
            blue:  Double(v         & 0xFF) / 255,
            opacity: 1
        )
    }
}

/// The shirt outline, on the same 48-wide grid as the web version so the two
/// shapes match.
///
/// Two hems, as in the web app: full length when the shirt is drawn alone, and
/// cut shorter when shorts sit beneath it. A full-length shirt over shorts
/// reads as a nightie and leaves the shorts a sliver at the bottom.
struct ShirtShape: Shape {
    var shortHem: Bool = false

    func path(in rect: CGRect) -> Path {
        // Scale from the WIDTH only. Using min(width, height) would shrink the
        // shirt whenever the frame is made taller to fit shorts.
        let s = rect.width / 48
        let hem: CGFloat = shortHem ? 36 : 44
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * s, y: rect.minY + y * s)
        }

        var path = Path()
        path.move(to: p(22, 8))
        path.addLine(to: p(32, 4))
        path.addQuadCurve(to: p(40, 10), control: p(40, 10))
        path.addLine(to: p(46, 16))
        path.addLine(to: p(40, 24))
        path.addLine(to: p(36, 21))
        path.addLine(to: p(36, hem))
        path.addQuadCurve(to: p(24, hem + 2), control: p(32, hem + 2))
        path.addQuadCurve(to: p(12, hem), control: p(16, hem + 2))
        path.addLine(to: p(12, 21))
        path.addLine(to: p(8, 24))
        path.addLine(to: p(2, 16))
        path.addLine(to: p(8, 10))
        path.addQuadCurve(to: p(16, 4), control: p(8, 10))
        path.addLine(to: p(26, 8))
        path.closeSubpath()
        return path
    }
}

/// The two sleeve wings, drawn over the shirt and its pattern so a striped
/// shirt can still have plain sleeves.
struct SleevesShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = rect.width / 48
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * s, y: rect.minY + y * s)
        }

        var path = Path()

        // Left.
        path.move(to: p(12, 21))
        path.addLine(to: p(8, 24))
        path.addLine(to: p(2, 16))
        path.addLine(to: p(8, 10))
        path.addQuadCurve(to: p(16, 4), control: p(8, 10))
        path.addLine(to: p(22, 8))
        path.addLine(to: p(12, 12))
        path.closeSubpath()

        // Right.
        path.move(to: p(36, 21))
        path.addLine(to: p(40, 24))
        path.addLine(to: p(46, 16))
        path.addLine(to: p(40, 10))
        path.addQuadCurve(to: p(32, 4), control: p(40, 10))
        path.addLine(to: p(26, 8))
        path.addLine(to: p(36, 12))
        path.closeSubpath()

        return path
    }
}

/// Shorts, with the notch between the legs. Drawn in its own frame beneath the
/// shirt rather than as part of it.
struct ShortsShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = rect.width / 48
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * s, y: rect.minY + y * s)
        }

        var path = Path()
        path.move(to: p(12, 0))
        path.addLine(to: p(36, 0))
        path.addLine(to: p(37, 19))
        path.addLine(to: p(26, 19))
        path.addLine(to: p(24, 8))
        path.addLine(to: p(22, 19))
        path.addLine(to: p(11, 19))
        path.closeSubpath()
        return path
    }
}

/// A player's kit, or their initials where they haven't chosen one.
struct PlayerBadge: View {
    let kit: String?
    let name: String
    var size: CGFloat = 34

    var body: some View {
        if let h = Helmet.parse(kit) {
            // NFL / F1: a helmet in the player's colours with their initials.
            HelmetView(helmet: h, initials: Helmet.initials(from: name))
                .frame(width: size, height: size)
        } else if let k = Kit.parse(kit) {
            // Taller frame when shorts will be drawn, or the kit is squashed
            // into a square and the proportions go wrong. The ratio matches the
            // web app's viewBox: 64 tall against 48 wide.
            let withShorts = k.shorts != nil && size >= 26
            KitView(kit: k)
                .frame(width: size, height: withShorts ? size * 64 / 48 : size)
        } else {
            Text(Self.mark(from: name))
                .font(.system(size: size * 0.34, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: size, height: size)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: size * 0.28))
        }
    }

    /// Never a single letter — "J" identifies nobody in a two-player tie.
    /// Matches playerMark() in the web app exactly, so the same person shows
    /// the same mark in both places.
    static func mark(from name: String) -> String {
        let words = name.split(separator: " ").map(String.init).filter { !$0.isEmpty }
        guard !words.isEmpty else { return "?" }
        if words.count == 1 { return String(words[0].prefix(3)).uppercased() }
        return words.prefix(3).compactMap { $0.first }.map(String.init).joined().uppercased()
    }
}

struct KitView: View {
    let kit: Kit

    /// Below this, shorts are left off.
    ///
    /// Matches the web app. At Dynamic Island sizes the shorts are two or three
    /// pixels tall, and including them means shrinking the shirt to make room —
    /// so the compact states would get a smaller shirt AND an unreadable smudge
    /// beneath it.
    private static let shortsMinSize: CGFloat = 26

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let s = w / 48
            let withShorts = kit.shorts != nil && w >= Self.shortsMinSize

            // ONE coordinate space for the whole kit, exactly as the SVG does
            // it: 48 units wide, with the shirt always occupying the first 48
            // units of height whether or not shorts are drawn beneath it.
            //
            // This used to be a VStack whose shirt box shrank to 40 units when
            // shorts were added. Every pattern is positioned from the centre of
            // that box, so shrinking it moved the centre from 24 to 20 and
            // dragged hoops, quarters and the sash four units up the shirt —
            // but only on kits that have shorts. Vertical stripes are offset on
            // x, which never changes, so they were unaffected: that is why this
            // looked like one player's kit being wrong rather than the drawing.
            ZStack(alignment: .top) {
                ZStack {
                    ShirtShape(shortHem: withShorts).fill(kit.primary)

                    // The pattern, clipped to the shirt so nothing bleeds past
                    // the edge.
                    patternLayer(scale: s)
                        .clipShape(ShirtShape(shortHem: withShorts))

                    // Sleeves over the pattern — a striped shirt with plain
                    // sleeves is a common kit and the stripes must not run
                    // through them.
                    if let sleeve = kit.sleeve, sleeve != kit.primary {
                        SleevesShape().fill(sleeve)
                    }

                    // Outline last, over everything.
                    ShirtShape(shortHem: withShorts)
                        .stroke(Color.black.opacity(0.35), lineWidth: 1.5 * s)
                }
                .frame(width: 48 * s, height: 48 * s)

                if withShorts, let shorts = kit.shorts {
                    ZStack {
                        ShortsShape().fill(shorts)
                        ShortsShape().stroke(Color.black.opacity(0.35), lineWidth: 1.5 * s)
                    }
                    .frame(width: 48 * s, height: 20 * s)
                    // The SVG's translate(0,41). The short hem ends at 38, so
                    // the shorts tuck under it rather than butting against it.
                    .offset(y: 41 * s)
                }
            }
        }
    }

    @ViewBuilder
    private func patternLayer(scale s: CGFloat) -> some View {
        switch kit.pattern {
        case "stripes":
            ForEach(0..<4, id: \.self) { i in
                Rectangle().fill(kit.secondary)
                    .frame(width: 5 * s, height: 48 * s)
                    .offset(x: (8 + CGFloat(i) * 9) * s - 24 * s + 2.5 * s)
            }
        case "hoops":
            ForEach(0..<3, id: \.self) { i in
                Rectangle().fill(kit.secondary)
                    .frame(width: 48 * s, height: 5 * s)
                    .offset(y: (16 + CGFloat(i) * 10) * s - 24 * s + 2.5 * s)
            }
        case "halves":
            Rectangle().fill(kit.secondary)
                .frame(width: 24 * s, height: 48 * s)
                .offset(x: 12 * s)
        case "quarters":
            ZStack {
                Rectangle().fill(kit.secondary)
                    .frame(width: 24 * s, height: 24 * s)
                    .offset(x: 12 * s, y: -12 * s)
                Rectangle().fill(kit.secondary)
                    .frame(width: 24 * s, height: 24 * s)
                    .offset(x: -12 * s, y: 12 * s)
            }
        case "sash":
            Rectangle().fill(kit.secondary)
                .frame(width: 70 * s, height: 10 * s)
                .rotationEffect(.degrees(-35))
        default:
            EmptyView()   // plain — the base colour is the whole shirt
        }
    }
}

// MARK: - NFL and F1 helmets

/// A player's helmet, sent by the server in the kit field as
///
///     helmet:#6a4c93:#f5f5f5        NFL
///     racehelmet:#6a4c93:#f5f5f5    F1
///
/// shell colour, then stripe (also used for the initials). Drawn on the same
/// 100-unit grid as src/components/ui/Helmet.jsx so the two match.
struct Helmet {
    let racing: Bool
    let shell: Color
    let stripe: Color
    let darkShell: Bool
    let sameColours: Bool

    static func parse(_ spec: String?) -> Helmet? {
        guard let spec, !spec.isEmpty else { return nil }
        let parts = spec.split(separator: ":").map(String.init)
        guard parts.count >= 2, parts[0] == "helmet" || parts[0] == "racehelmet" else { return nil }
        let shellHex = parts[1]
        guard let shell = Color(hex: shellHex) else { return nil }
        let stripeHex = (parts.count > 2 && Color(hex: parts[2]) != nil) ? parts[2] : "#f5f5f5"
        return Helmet(racing: parts[0] == "racehelmet",
                      shell: shell,
                      stripe: Color(hex: stripeHex) ?? .white,
                      darkShell: luminance(shellHex) < 70,
                      sameColours: shellHex.lowercased() == stripeHex.lowercased())
    }

    /// Two letters at most, matching helmetInitials() in Helmet.jsx.
    static func initials(from name: String) -> String {
        let words = name.split(separator: " ").map(String.init).filter { !$0.isEmpty }
        guard let first = words.first else { return "?" }
        if words.count == 1 { return String(first.prefix(2)).uppercased() }
        return (String(first.prefix(1)) + String(words[1].prefix(1))).uppercased()
    }

    private static func luminance(_ hex: String) -> Double {
        var s = hex
        if s.hasPrefix("#") { s.removeFirst() }
        guard let v = UInt64(s, radix: 16) else { return 255 }
        return 0.299 * Double((v >> 16) & 0xFF) + 0.587 * Double((v >> 8) & 0xFF) + 0.114 * Double(v & 0xFF)
    }

    /// Initials in the stripe colour, unless it matches the shell.
    var markColour: Color {
        if !sameColours { return stripe }
        return darkShell ? .white : Color(white: 0.07)
    }

    /// A dark helmet vanishes on a dark lock screen, so it gets a light edge.
    var rimColour: Color { darkShell ? Color.white.opacity(0.55) : Color.black.opacity(0.25) }
}

/// Scales SVG-style coordinates on a 100 grid into the given rect.
private struct HelmetGrid {
    let rect: CGRect
    var s: CGFloat { min(rect.width, rect.height) / 100 }
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
}

struct NflShellShape: Shape {
    func path(in rect: CGRect) -> Path {
        let g = HelmetGrid(rect: rect); var p = Path()
        p.move(to: g.p(12, 58))
        p.addCurve(to: g.p(54, 10), control1: g.p(8, 32), control2: g.p(28, 10))
        p.addCurve(to: g.p(88, 42), control1: g.p(74, 10), control2: g.p(86, 24))
        p.addLine(to: g.p(74, 47))
        p.addLine(to: g.p(66, 74))
        p.addCurve(to: g.p(32, 80), control1: g.p(58, 82), control2: g.p(44, 84))
        p.addCurve(to: g.p(12, 58), control1: g.p(20, 76), control2: g.p(14, 68))
        p.closeSubpath(); return p
    }
}

struct NflStripeShape: Shape {
    func path(in rect: CGRect) -> Path {
        let g = HelmetGrid(rect: rect); var p = Path()
        p.move(to: g.p(28, 28))
        p.addCurve(to: g.p(66, 21), control1: g.p(38, 19), control2: g.p(54, 16))
        return p
    }
}

struct FaceMaskShape: Shape {
    func path(in rect: CGRect) -> Path {
        let g = HelmetGrid(rect: rect); var p = Path()
        p.move(to: g.p(70, 50)); p.addLine(to: g.p(91, 47))
        p.addCurve(to: g.p(88, 81), control1: g.p(95, 58), control2: g.p(94, 72))
        p.addLine(to: g.p(64, 83))
        p.move(to: g.p(71, 65)); p.addLine(to: g.p(93, 63))
        p.move(to: g.p(80, 49)); p.addLine(to: g.p(78, 82))
        return p
    }
}

struct RaceShellShape: Shape {
    func path(in rect: CGRect) -> Path {
        let g = HelmetGrid(rect: rect); var p = Path()
        p.move(to: g.p(10, 56))
        p.addCurve(to: g.p(56, 10), control1: g.p(8, 30), control2: g.p(28, 10))
        p.addCurve(to: g.p(94, 50), control1: g.p(80, 10), control2: g.p(94, 30))
        p.addCurve(to: g.p(84, 78), control1: g.p(94, 62), control2: g.p(90, 72))
        p.addLine(to: g.p(80, 84))
        p.addCurve(to: g.p(24, 85), control1: g.p(66, 91), control2: g.p(40, 91))
        p.addCurve(to: g.p(10, 56), control1: g.p(16, 78), control2: g.p(11, 68))
        p.closeSubpath(); return p
    }
}

struct RaceStripeShape: Shape {
    func path(in rect: CGRect) -> Path {
        let g = HelmetGrid(rect: rect); var p = Path()
        p.move(to: g.p(18, 70))
        p.addCurve(to: g.p(68, 66), control1: g.p(34, 63), control2: g.p(50, 72))
        return p
    }
}

struct VisorShape: Shape {
    func path(in rect: CGRect) -> Path {
        let g = HelmetGrid(rect: rect); var p = Path()
        p.move(to: g.p(44, 38)); p.addLine(to: g.p(88, 36))
        p.addCurve(to: g.p(89, 55), control1: g.p(90, 42), control2: g.p(90, 49))
        p.addLine(to: g.p(50, 57))
        p.addCurve(to: g.p(44, 51), control1: g.p(46, 57), control2: g.p(44, 54))
        p.closeSubpath(); return p
    }
}

struct HelmetView: View {
    let helmet: Helmet
    let initials: String

    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height) / 100
            ZStack(alignment: .topLeading) {
                if helmet.racing {
                    RaceShellShape().fill(helmet.shell)
                    RaceShellShape().stroke(helmet.rimColour, lineWidth: 2 * s)
                    RaceStripeShape().stroke(helmet.stripe, style: StrokeStyle(lineWidth: 4 * s, lineCap: .round))
                    VisorShape().fill(Color(red: 0.10, green: 0.10, blue: 0.13))
                    mark(size: 18 * s, centreX: 27 * s, baseline: 56 * s)
                } else {
                    NflShellShape().fill(helmet.shell)
                    NflShellShape().stroke(helmet.rimColour, lineWidth: 2 * s)
                    NflStripeShape().stroke(helmet.stripe, style: StrokeStyle(lineWidth: 4 * s, lineCap: .round))
                    mark(size: 22 * s, centreX: 42 * s, baseline: 61 * s)
                    FaceMaskShape().stroke(Color(red: 0.60, green: 0.63, blue: 0.66),
                                           style: StrokeStyle(lineWidth: 5 * s, lineCap: .round, lineJoin: .round))
                }
            }
            .frame(width: 100 * s, height: 100 * s)
        }
    }

    /// The initials, centred on x with their baseline where the SVG puts it.
    private func mark(size: CGFloat, centreX: CGFloat, baseline: CGFloat) -> some View {
        Text(initials)
            .font(.system(size: size, weight: .black))
            .foregroundStyle(helmet.markColour)
            .lineLimit(1)
            .fixedSize()
            .position(x: centreX, y: baseline - size * 0.36)
    }
}
